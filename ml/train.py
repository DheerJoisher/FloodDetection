"""Train leakage-conscious baselines and an MLP on chronological flood data."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

os.environ.setdefault("TF_DETERMINISTIC_OPS", "1")

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.utils.class_weight import compute_class_weight

if __package__:
    from .features import CATEGORICAL_FEATURES, FEATURE_COLUMNS, NUMERIC_FEATURES
else:
    from features import CATEGORICAL_FEATURES, FEATURE_COLUMNS, NUMERIC_FEATURES


ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "ml" / "data" / "processed" / "next_day_risk_dataset.csv"
MODEL_DIR = ROOT / "ml" / "models"
OUTPUT_DIR = ROOT / "ml" / "outputs"
CLASS_NAMES = ("LOW", "MODERATE", "HIGH")
CLASS_TO_INDEX = {name: index for index, name in enumerate(CLASS_NAMES)}
INDEX_TO_CLASS = {str(index): name for name, index in CLASS_TO_INDEX.items()}
AUDIT_COLUMNS = ("station_id", "station_name", "date", "target_date", "target_risk")
SEED = 42
TRAIN_FRACTION = 0.70
VALIDATION_FRACTION = 0.15
MAX_EPOCHS = 100
BATCH_SIZE = 256
EARLY_STOPPING_PATIENCE = 12


def load_dataset() -> pd.DataFrame:
    if not DATASET.is_file():
        raise FileNotFoundError(f"Prepared dataset not found: {DATASET}")
    frame = pd.read_csv(
        DATASET,
        dtype={"station_id": str, "station_name": str, "target_risk": str},
    )
    required = {*FEATURE_COLUMNS, *AUDIT_COLUMNS}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Prepared dataset is missing columns: {missing}")
    if frame.duplicated(["station_id", "date"]).any():
        raise ValueError("Prepared dataset contains duplicate station/date rows.")
    if frame[list(required)].isna().any().any():
        raise ValueError("Prepared dataset contains missing feature, audit, or target values.")

    frame["date"] = pd.to_datetime(frame["date"], errors="raise")
    frame["target_date"] = pd.to_datetime(frame["target_date"], errors="raise")
    if not ((frame["target_date"] - frame["date"]) == pd.Timedelta(days=1)).all():
        raise ValueError("Every target_date must be exactly one day after its feature date.")
    if not (frame["target_risk"].isin(CLASS_NAMES)).all():
        raise ValueError("Unexpected target class in prepared dataset.")

    ordered = frame.sort_values(["station_id", "date"], kind="stable")
    if not ordered[["station_id", "date"]].reset_index(drop=True).equals(
        frame[["station_id", "date"]].reset_index(drop=True)
    ):
        raise ValueError("Prepared dataset must be ordered by station_id and date.")
    return frame


def chronological_split(frame: pd.DataFrame) -> tuple[dict[str, pd.DataFrame], dict[str, Any]]:
    dates = np.array(sorted(frame["date"].unique()))
    if len(dates) < 3:
        raise ValueError("Not enough unique feature dates for chronological splitting.")

    train_end = int(len(dates) * TRAIN_FRACTION)
    validation_end = int(len(dates) * (TRAIN_FRACTION + VALIDATION_FRACTION))
    if train_end == 0 or validation_end <= train_end or validation_end >= len(dates):
        raise ValueError("Chronological split produced an empty partition.")

    intervals = {
        "train": (dates[0], dates[train_end - 1]),
        "validation": (dates[train_end], dates[validation_end - 1]),
        "test": (dates[validation_end], dates[-1]),
    }
    splits = {
        name: frame.loc[frame["date"].between(start, end)].copy().reset_index(drop=True)
        for name, (start, end) in intervals.items()
    }
    manifest: dict[str, Any] = {
        "method": "ordered unique feature dates; all station rows on each date stay together",
        "date_count": len(dates),
        "target_class_order": list(CLASS_NAMES),
        "fractions": {
            "train": TRAIN_FRACTION,
            "validation": VALIDATION_FRACTION,
            "test": 1 - TRAIN_FRACTION - VALIDATION_FRACTION,
        },
        "splits": {},
    }
    for name, split in splits.items():
        if split.empty:
            raise ValueError(f"The {name} split is empty.")
        if name == "train":
            expected_dates = dates[:train_end]
        elif name == "validation":
            expected_dates = dates[train_end:validation_end]
        else:
            expected_dates = dates[validation_end:]
        if split["date"].nunique() != len(expected_dates):
            raise AssertionError(f"Station/date boundary inconsistency in {name} split.")
        manifest["splits"][name] = {
            "feature_date_start": split["date"].min().date().isoformat(),
            "feature_date_end": split["date"].max().date().isoformat(),
            "target_date_start": split["target_date"].min().date().isoformat(),
            "target_date_end": split["target_date"].max().date().isoformat(),
            "rows": int(len(split)),
            "unique_dates": int(split["date"].nunique()),
            "class_counts": {
                name: int(count)
                for name, count in split["target_risk"]
                .value_counts()
                .reindex(CLASS_NAMES, fill_value=0)
                .items()
            },
        }

    if not (
        splits["train"]["date"].max()
        < splits["validation"]["date"].min()
        <= splits["validation"]["date"].max()
        < splits["test"]["date"].min()
    ):
        raise AssertionError("Chronological split boundaries overlap or are out of order.")
    return splits, manifest


def make_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            ("numeric", StandardScaler(), list(NUMERIC_FEATURES)),
            (
                "station",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False, dtype=np.float32),
                list(CATEGORICAL_FEATURES),
            ),
        ],
        remainder="drop",
        sparse_threshold=0.0,
        verbose_feature_names_out=False,
    )


def metrics_for(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    labels = np.arange(len(CLASS_NAMES))
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true,
        y_pred,
        labels=labels,
        zero_division=0,
    )
    values = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macro_precision": float(precision_recall_fscore_support(
            y_true, y_pred, labels=labels, average="macro", zero_division=0
        )[0]),
        "macro_recall": float(precision_recall_fscore_support(
            y_true, y_pred, labels=labels, average="macro", zero_division=0
        )[1]),
        "macro_f1": float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_true, y_pred, labels=labels, average="weighted", zero_division=0)),
        "per_class": {
            name: {
                "precision": float(precision[index]),
                "recall": float(recall[index]),
                "f1": float(f1[index]),
                "support": int(support[index]),
            }
            for index, name in enumerate(CLASS_NAMES)
        },
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
    }
    numeric_values = [
        value
        for key, value in values.items()
        if key not in {"per_class", "confusion_matrix"}
    ]
    numeric_values.extend(
        score
        for class_metrics in values["per_class"].values()
        for key, score in class_metrics.items()
        if key != "support"
    )
    if not np.isfinite(numeric_values).all():
        raise AssertionError("Evaluation produced non-finite metrics.")
    return values


def _y_values(split: pd.DataFrame) -> np.ndarray:
    return split["target_risk"].map(CLASS_TO_INDEX).to_numpy(dtype=np.int64)


def _classification_report(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    return classification_report(
        y_true,
        y_pred,
        labels=np.arange(len(CLASS_NAMES)),
        target_names=list(CLASS_NAMES),
        output_dict=True,
        zero_division=0,
    )


class ValidationMacroF1(tf.keras.callbacks.Callback):
    """Track validation macro-F1 at epoch end for best-weight early stopping."""

    def __init__(self, validation_x: np.ndarray, validation_y: np.ndarray):
        super().__init__()
        self.validation_x = validation_x
        self.validation_y = validation_y
        self.scores: list[float] = []

    def on_epoch_end(self, epoch: int, logs: dict[str, Any] | None = None) -> None:
        del epoch
        if logs is None:
            raise RuntimeError("Keras did not provide epoch metrics.")
        probabilities = self.model.predict(self.validation_x, verbose=0)
        predictions = probabilities.argmax(axis=1)
        score = float(
            f1_score(
                self.validation_y,
                predictions,
                labels=np.arange(len(CLASS_NAMES)),
                average="macro",
                zero_division=0,
            )
        )
        if not np.isfinite(score):
            raise AssertionError("Validation macro-F1 is not finite.")
        self.scores.append(score)
        logs["val_macro_f1"] = score


def _plot_training(history: dict[str, list[float]]) -> None:
    epochs = range(1, len(history["loss"]) + 1)
    figure, axes = plt.subplots(1, 2, figsize=(11, 4))
    axes[0].plot(epochs, history["loss"], label="Train")
    axes[0].plot(epochs, history["val_loss"], label="Validation")
    axes[0].set(title="Loss", xlabel="Epoch", ylabel="Sparse categorical cross-entropy")
    axes[0].legend()
    axes[1].plot(epochs, history["val_macro_f1"], color="tab:purple", label="Validation macro-F1")
    axes[1].set(title="Imbalanced-class selection metric", xlabel="Epoch", ylabel="Macro-F1")
    axes[1].legend()
    figure.tight_layout()
    figure.savefig(OUTPUT_DIR / "mlp_training_history.png", dpi=160)
    plt.close(figure)


def _plot_confusion(matrix: list[list[int]]) -> None:
    figure, axis = plt.subplots(figsize=(6, 5))
    image = axis.imshow(matrix, cmap="Blues")
    axis.set(
        xticks=np.arange(len(CLASS_NAMES)),
        yticks=np.arange(len(CLASS_NAMES)),
        xticklabels=CLASS_NAMES,
        yticklabels=CLASS_NAMES,
        xlabel="Predicted class",
        ylabel="Actual class",
        title="MLP test confusion matrix",
    )
    for row in range(len(CLASS_NAMES)):
        for column in range(len(CLASS_NAMES)):
            axis.text(column, row, str(matrix[row][column]), ha="center", va="center")
    figure.colorbar(image, ax=axis)
    figure.tight_layout()
    figure.savefig(OUTPUT_DIR / "mlp_test_confusion_matrix.png", dpi=160)
    plt.close(figure)


def _comparison_row(model_name: str, metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model_name,
        "accuracy": metrics["accuracy"],
        "balanced_accuracy": metrics["balanced_accuracy"],
        "macro_f1": metrics["macro_f1"],
        "weighted_f1": metrics["weighted_f1"],
        **{
            f"{class_name.lower()}_f1": metrics["per_class"][class_name]["f1"]
            for class_name in CLASS_NAMES
        },
    }


def main() -> None:
    np.random.seed(SEED)
    tf.keras.utils.set_random_seed(SEED)
    tf.config.experimental.enable_op_determinism()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    dataset = load_dataset()
    splits, manifest = chronological_split(dataset)
    train_frame = splits["train"]
    validation_frame = splits["validation"]
    test_frame = splits["test"]

    # Fit every learned transform on training rows only.
    preprocessor = make_preprocessor()
    train_x = preprocessor.fit_transform(train_frame.loc[:, FEATURE_COLUMNS]).astype(np.float32)
    validation_x = preprocessor.transform(
        validation_frame.loc[:, FEATURE_COLUMNS]
    ).astype(np.float32)
    train_y = _y_values(train_frame)
    validation_y = _y_values(validation_frame)
    if set(np.unique(train_y)) != set(range(len(CLASS_NAMES))):
        raise ValueError("Training split must contain every target class.")

    class_weight_values = compute_class_weight(
        class_weight="balanced",
        classes=np.arange(len(CLASS_NAMES)),
        y=train_y,
    )
    class_weights = {
        int(class_index): float(weight)
        for class_index, weight in enumerate(class_weight_values)
    }

    # Baseline A: constant training majority class.
    majority_class = int(np.bincount(train_y, minlength=len(CLASS_NAMES)).argmax())
    majority_model_predictions: dict[str, np.ndarray] = {
        "validation": np.full(len(validation_y), majority_class, dtype=np.int64),
    }

    # Baseline B: fixed Random Forest configuration, not tuned on the test set.
    forest = RandomForestClassifier(
        n_estimators=300,
        max_features="sqrt",
        min_samples_leaf=2,
        class_weight="balanced_subsample",
        random_state=SEED,
        n_jobs=-1,
    )
    forest.fit(train_x, train_y)
    forest_validation_predictions = forest.predict(validation_x)

    # Compact tabular MLP. Validation macro-F1, rather than accuracy, selects
    # the best epoch; test data is not supplied to Keras or callbacks.
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(train_x.shape[1],)),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dropout(0.25, seed=SEED),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dropout(0.15, seed=SEED + 1),
            tf.keras.layers.Dense(len(CLASS_NAMES), activation="softmax"),
        ],
        name="godavari_next_day_risk_mlp",
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=[tf.keras.metrics.SparseCategoricalAccuracy(name="accuracy")],
    )
    validation_f1_callback = ValidationMacroF1(validation_x, validation_y)
    early_stopping = tf.keras.callbacks.EarlyStopping(
        monitor="val_macro_f1",
        mode="max",
        patience=EARLY_STOPPING_PATIENCE,
        restore_best_weights=True,
        verbose=1,
    )
    keras_history = model.fit(
        train_x,
        train_y,
        validation_data=(validation_x, validation_y),
        epochs=MAX_EPOCHS,
        batch_size=BATCH_SIZE,
        class_weight=class_weights,
        callbacks=[validation_f1_callback, early_stopping],
        shuffle=True,
        verbose=2,
    )
    history = {
        key: [float(value) for value in values]
        for key, values in keras_history.history.items()
    }
    history["val_macro_f1"] = validation_f1_callback.scores
    best_epoch = int(np.argmax(validation_f1_callback.scores)) + 1
    if len(history["loss"]) != len(history["val_macro_f1"]):
        raise AssertionError("Training history and validation macro-F1 epochs differ.")

    # Model selection is complete using training/validation only. Evaluate
    # each fixed finalist on the latest test period once, then persist metrics.
    test_x = preprocessor.transform(test_frame.loc[:, FEATURE_COLUMNS]).astype(np.float32)
    test_y = _y_values(test_frame)
    validation_predictions = {
        "Majority baseline": majority_model_predictions["validation"],
        "Random Forest": forest_validation_predictions,
        "MLP": model.predict(validation_x, verbose=0).argmax(axis=1),
    }
    test_predictions = {
        "Majority baseline": np.full(len(test_y), majority_class, dtype=np.int64),
        "Random Forest": forest.predict(test_x),
        "MLP": model.predict(test_x, verbose=0).argmax(axis=1),
    }
    validation_metrics = {
        name: metrics_for(validation_y, prediction)
        for name, prediction in validation_predictions.items()
    }
    test_metrics = {
        name: metrics_for(test_y, prediction)
        for name, prediction in test_predictions.items()
    }
    test_reports = {
        name: _classification_report(test_y, prediction)
        for name, prediction in test_predictions.items()
    }

    model.save(MODEL_DIR / "flood_risk_mlp.keras")
    joblib.dump(preprocessor, MODEL_DIR / "flood_risk_preprocessor.joblib")
    joblib.dump(forest, MODEL_DIR / "flood_risk_random_forest.joblib")
    feature_names = preprocessor.get_feature_names_out().tolist()
    metadata = {
        "feature_columns": list(FEATURE_COLUMNS),
        "numeric_features": list(NUMERIC_FEATURES),
        "categorical_features": list(CATEGORICAL_FEATURES),
        "transformed_feature_names": feature_names,
        "audit_columns": list(AUDIT_COLUMNS),
        "class_names": list(CLASS_NAMES),
        "class_to_index": CLASS_TO_INDEX,
        "seed": SEED,
        "preprocessing_fit_on": "training split only",
        "transformed_feature_count": len(feature_names),
    }
    (MODEL_DIR / "flood_risk_feature_metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    (MODEL_DIR / "flood_risk_class_mapping.json").write_text(
        json.dumps(
            {"class_to_index": CLASS_TO_INDEX, "index_to_class": INDEX_TO_CLASS},
            indent=2,
        ),
        encoding="utf-8",
    )
    (OUTPUT_DIR / "chronological_split_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    (OUTPUT_DIR / "mlp_training_history.json").write_text(
        json.dumps(history, indent=2), encoding="utf-8"
    )
    pd.DataFrame(history).to_csv(OUTPUT_DIR / "mlp_training_history.csv", index=False)
    (OUTPUT_DIR / "validation_metrics.json").write_text(
        json.dumps(validation_metrics, indent=2), encoding="utf-8"
    )
    (OUTPUT_DIR / "test_metrics.json").write_text(
        json.dumps(
            {
                "test_rows": len(test_frame),
                "test_feature_date_range": [
                    test_frame["date"].min().date().isoformat(),
                    test_frame["date"].max().date().isoformat(),
                ],
                "test_target_date_range": [
                    test_frame["target_date"].min().date().isoformat(),
                    test_frame["target_date"].max().date().isoformat(),
                ],
                "test_class_counts": manifest["splits"]["test"]["class_counts"],
                "metrics": test_metrics,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (OUTPUT_DIR / "test_classification_report.json").write_text(
        json.dumps(test_reports, indent=2), encoding="utf-8"
    )
    for model_name, matrix in (
        ("MLP", test_metrics["MLP"]["confusion_matrix"]),
    ):
        pd.DataFrame(matrix, index=CLASS_NAMES, columns=CLASS_NAMES).to_csv(
            OUTPUT_DIR / f"{model_name.lower()}_test_confusion_matrix.csv",
            index_label="actual",
        )
    _plot_training(history)
    _plot_confusion(test_metrics["MLP"]["confusion_matrix"])

    comparison = pd.DataFrame(
        [_comparison_row(name, metrics) for name, metrics in test_metrics.items()]
    )
    comparison.to_csv(OUTPUT_DIR / "model_comparison_test.csv", index=False)
    pd.DataFrame(
        [_comparison_row(name, metrics) for name, metrics in validation_metrics.items()]
    ).to_csv(OUTPUT_DIR / "model_comparison_validation.csv", index=False)

    summary = {
        "split_manifest": manifest,
        "class_weights_from_training_only": {
            CLASS_NAMES[index]: weight for index, weight in class_weights.items()
        },
        "training": {
            "seed": SEED,
            "max_epochs": MAX_EPOCHS,
            "epochs_trained": len(history["loss"]),
            "best_epoch_by_validation_macro_f1": best_epoch,
            "best_validation_macro_f1": validation_f1_callback.scores[best_epoch - 1],
            "stopped_early": len(history["loss"]) < MAX_EPOCHS,
            "early_stopping_patience": EARLY_STOPPING_PATIENCE,
            "batch_size": BATCH_SIZE,
            "mlp_architecture": [
                f"Input({train_x.shape[1]})",
                "Dense(64, ReLU)",
                "Dropout(0.25)",
                "Dense(32, ReLU)",
                "Dropout(0.15)",
                "Dense(3, Softmax)",
            ],
        },
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
        "test_reports": test_reports,
        "comparison_test": comparison.to_dict(orient="records"),
        "artifacts": {
            "model": str((MODEL_DIR / "flood_risk_mlp.keras").relative_to(ROOT)),
            "preprocessor": str((MODEL_DIR / "flood_risk_preprocessor.joblib").relative_to(ROOT)),
            "random_forest": str((MODEL_DIR / "flood_risk_random_forest.joblib").relative_to(ROOT)),
            "test_metrics": str((OUTPUT_DIR / "test_metrics.json").relative_to(ROOT)),
        },
    }
    (OUTPUT_DIR / "training_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
