"""Validation-only error analysis and a small controlled MLP study."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.utils.class_weight import compute_class_weight

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "ml"))

from ml.data.prepare_dataset import _calculate_authoritative_risk, _read_source  # noqa: E402
from train import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_INDEX,
    CATEGORICAL_FEATURES,
    DATASET,
    FEATURE_COLUMNS,
    MODEL_DIR,
    NUMERIC_FEATURES,
    OUTPUT_DIR,
    SEED,
    ValidationMacroF1,
    chronological_split,
    load_dataset,
    make_preprocessor,
    metrics_for,
)


STUDY_DIR = OUTPUT_DIR / "error_analysis"
EXPERIMENTS = (
    {"name": "A_original_mlp", "kind": "original"},
    {"name": "B_sqrt_class_weights", "kind": "sqrt_weights"},
    {"name": "C_compact_architecture", "kind": "compact"},
)
PROBABILITY_THRESHOLDS = (0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80)
HIGH_RECALL_FLOOR = 0.98
MACRO_F1_TOLERANCE = 0.02


def _build_mlp(input_width: int, compact: bool = False) -> tf.keras.Model:
    tf.keras.utils.set_random_seed(SEED)
    if compact:
        widths = (48, 24)
    else:
        widths = (64, 32)
    return tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(input_width,)),
            tf.keras.layers.Dense(widths[0], activation="relu"),
            tf.keras.layers.Dropout(0.25, seed=SEED),
            tf.keras.layers.Dense(widths[1], activation="relu"),
            tf.keras.layers.Dropout(0.15, seed=SEED + 1),
            tf.keras.layers.Dense(len(CLASS_NAMES), activation="softmax"),
        ],
        name="godavari_validation_study_mlp",
    )


def _fit_candidate(
    name: str,
    train_x: np.ndarray,
    train_y: np.ndarray,
    validation_x: np.ndarray,
    validation_y: np.ndarray,
    class_weights: dict[int, float],
    compact: bool = False,
) -> tuple[tf.keras.Model, dict[str, Any]]:
    model = _build_mlp(train_x.shape[1], compact=compact)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=[tf.keras.metrics.SparseCategoricalAccuracy(name="accuracy")],
    )
    f1_callback = ValidationMacroF1(validation_x, validation_y)
    stop_callback = tf.keras.callbacks.EarlyStopping(
        monitor="val_macro_f1",
        mode="max",
        patience=12,
        restore_best_weights=True,
        verbose=1,
    )
    history = model.fit(
        train_x,
        train_y,
        validation_data=(validation_x, validation_y),
        class_weight=class_weights,
        batch_size=256,
        epochs=100,
        callbacks=[f1_callback, stop_callback],
        shuffle=True,
        verbose=2,
    )
    best_epoch = int(np.argmax(f1_callback.scores)) + 1
    result = {
        "experiment": name,
        "architecture": [train_x.shape[1], 48, 24, 3] if compact else [train_x.shape[1], 64, 32, 3],
        "epochs_trained": len(history.epoch),
        "best_epoch": best_epoch,
        "best_validation_macro_f1": float(f1_callback.scores[best_epoch - 1]),
        "early_stopped": len(history.epoch) < 100,
        "class_weights": {
            CLASS_NAMES[index]: float(value) for index, value in class_weights.items()
        },
    }
    return model, result


def _probability_summary(values: np.ndarray) -> dict[str, float]:
    quantiles = np.quantile(values, [0.1, 0.25, 0.5, 0.75, 0.9])
    return {
        "count": int(len(values)),
        "mean": float(np.mean(values)),
        "std": float(np.std(values)),
        "p10": float(quantiles[0]),
        "p25": float(quantiles[1]),
        "median": float(quantiles[2]),
        "p75": float(quantiles[3]),
        "p90": float(quantiles[4]),
    }


def _describe_probability_behavior(
    validation: pd.DataFrame,
    probabilities: np.ndarray,
    predictions: np.ndarray,
) -> tuple[dict[str, Any], pd.DataFrame]:
    actual = validation["target_risk"].map(CLASS_TO_INDEX).to_numpy(dtype=np.int64)
    class_predictions = np.asarray(CLASS_NAMES)[predictions]
    predicted_confidence = probabilities.max(axis=1)
    correct = predictions == actual
    result: dict[str, Any] = {
        "predicted_class_counts": {
            name: int((class_predictions == name).sum()) for name in CLASS_NAMES
        },
        "actual_class_counts": {
            name: int((actual == index).sum()) for index, name in enumerate(CLASS_NAMES)
        },
        "confusion_matrix_actual_rows_predicted_columns": confusion_matrix(
            actual, predictions, labels=np.arange(len(CLASS_NAMES))
        ).tolist(),
        "per_class_probability_by_actual_class": {},
        "predicted_confidence": {
            "correct": _probability_summary(predicted_confidence[correct]),
            "incorrect": _probability_summary(predicted_confidence[~correct]),
        },
        "moderate_prediction_actual_classes": {
            name: int(((predictions == CLASS_TO_INDEX["MODERATE"]) & (actual == index)).sum())
            for index, name in enumerate(CLASS_NAMES)
        },
        "moderate_prediction_false_positive_details": {},
        "actual_moderate_probabilities": {},
    }
    for actual_index, actual_name in enumerate(CLASS_NAMES):
        mask = actual == actual_index
        result["per_class_probability_by_actual_class"][actual_name] = {
            predicted_name: _probability_summary(probabilities[mask, predicted_index])
            for predicted_index, predicted_name in enumerate(CLASS_NAMES)
        }
    actual_moderate = actual == CLASS_TO_INDEX["MODERATE"]
    result["actual_moderate_probabilities"] = {
        name: _probability_summary(probabilities[actual_moderate, index])
        for index, name in enumerate(CLASS_NAMES)
    }

    predicted_moderate = predictions == CLASS_TO_INDEX["MODERATE"]
    for actual_name in CLASS_NAMES:
        mask = predicted_moderate & (actual == CLASS_TO_INDEX[actual_name])
        result["moderate_prediction_false_positive_details"][actual_name] = {
            "count": int(mask.sum()),
            "mean_predicted_moderate_probability": (
                float(probabilities[mask, CLASS_TO_INDEX["MODERATE"]].mean())
                if mask.any()
                else None
            ),
        }
    probability_frame = validation.loc[:, ["station_id", "station_name", "date", "target_date"]].copy()
    probability_frame["actual_risk"] = np.asarray(CLASS_NAMES)[actual]
    probability_frame["predicted_risk"] = class_predictions
    for index, name in enumerate(CLASS_NAMES):
        probability_frame[f"probability_{name.lower()}"] = probabilities[:, index]
    probability_frame["predicted_confidence"] = predicted_confidence
    probability_frame["correct"] = correct
    return result, probability_frame


def _feature_summary(validation: pd.DataFrame) -> dict[str, Any]:
    columns = (
        "waterlevel",
        "discharge",
        "rain",
        "rain_sum_7d",
        "waterlevel_mean_7d",
        "discharge_mean_7d",
    )
    output: dict[str, Any] = {}
    for risk in CLASS_NAMES:
        group = validation.loc[validation["target_risk"] == risk, columns]
        output[risk] = {}
        for column in columns:
            values = group[column]
            output[risk][column] = {
                "count": int(values.count()),
                "mean": float(values.mean()),
                "std": float(values.std()),
                "min": float(values.min()),
                "p25": float(values.quantile(0.25)),
                "median": float(values.median()),
                "p75": float(values.quantile(0.75)),
                "max": float(values.max()),
            }
    return output


def _target_day_analysis(validation: pd.DataFrame) -> tuple[dict[str, Any], pd.DataFrame]:
    source = _read_source()
    target_start = validation["target_date"].min()
    target_end = validation["target_date"].max()
    target_observations = source.loc[source["date"].between(target_start, target_end)].copy()
    target_observations["_risk"] = _calculate_authoritative_risk(target_observations)
    lookup = target_observations.set_index(["station_id", "date"])

    values = validation[["station_id", "target_date", "target_risk"]].copy()
    values["target_date"] = pd.to_datetime(values["target_date"])
    rows = []
    for row in values.itertuples(index=False):
        record = lookup.loc[(row.station_id, row.target_date)]
        if record["_risk"] != row.target_risk:
            raise AssertionError("Validation target label does not match the authoritative source label.")
        rows.append(
            {
                "station_id": row.station_id,
                "target_date": row.target_date,
                "target_risk": row.target_risk,
                "waterlevel": float(record["waterlevel"]),
                "discharge": float(record["discharge"]),
                "rain": float(record["rain"]),
            }
        )
    observations = pd.DataFrame(rows)
    thresholds = {
        "waterlevel": {"moderate": 700.0, "high": 800.0},
        "discharge": {"moderate": 1000.0, "high": 4000.0},
        "rain": {"moderate": 50.0, "high": 100.0},
    }
    result: dict[str, Any] = {
        "source_date_range_used": [
            target_start.date().isoformat(),
            target_end.date().isoformat(),
        ],
        "thresholds": thresholds,
        "class_measurement_summary": {},
        "moderate_threshold_proximity": {},
        "moderate_trigger_counts": {},
    }
    for risk in CLASS_NAMES:
        group = observations.loc[observations["target_risk"] == risk]
        result["class_measurement_summary"][risk] = {
            metric: {
                "count": int(group[metric].count()),
                "mean": float(group[metric].mean()),
                "std": float(group[metric].std()),
                "min": float(group[metric].min()),
                "p25": float(group[metric].quantile(0.25)),
                "median": float(group[metric].median()),
                "p75": float(group[metric].quantile(0.75)),
                "max": float(group[metric].max()),
            }
            for metric in thresholds
        }

    moderate = observations.loc[observations["target_risk"] == "MODERATE"]
    for metric, limits in thresholds.items():
        result["moderate_threshold_proximity"][metric] = {
            "moderate_boundary_minus_observation": _probability_summary(
                (limits["moderate"] - moderate[metric].to_numpy(dtype=float))
            ),
            "high_boundary_minus_observation": _probability_summary(
                (limits["high"] - moderate[metric].to_numpy(dtype=float))
            ),
            "at_or_above_moderate_boundary": int(
                (moderate[metric] >= limits["moderate"]).sum()
            ),
            "at_or_above_high_boundary": int((moderate[metric] >= limits["high"]).sum()),
        }
    for metric, limits in thresholds.items():
        result["moderate_trigger_counts"][metric] = int(
            (
                (moderate[metric] >= limits["moderate"])
                & (moderate[metric] < limits["high"])
            ).sum()
        )
    return result, observations


def _policy_predictions(probabilities: np.ndarray, threshold: float) -> np.ndarray:
    raw = probabilities.argmax(axis=1)
    moderate = CLASS_TO_INDEX["MODERATE"]
    high = CLASS_TO_INDEX["HIGH"]
    predictions = np.where(probabilities[:, moderate] >= threshold, moderate, 0)
    predictions[raw == high] = high
    return predictions.astype(np.int64)


def _plot_confusions(
    predictions: dict[str, np.ndarray],
    actual: np.ndarray,
    labels: list[str],
) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(10, 9))
    for axis, (name, predicted) in zip(axes.flat, predictions.items()):
        matrix = confusion_matrix(actual, predicted, labels=np.arange(len(CLASS_NAMES)))
        image = axis.imshow(matrix, cmap="Blues")
        axis.set(
            title=name,
            xticks=np.arange(3),
            yticks=np.arange(3),
            xticklabels=CLASS_NAMES,
            yticklabels=CLASS_NAMES,
            xlabel="Predicted",
            ylabel="Actual",
        )
        for row in range(3):
            for column in range(3):
                axis.text(column, row, str(matrix[row, column]), ha="center", va="center")
        figure.colorbar(image, ax=axis, fraction=0.046)
    figure.suptitle("Validation confusion matrices")
    figure.tight_layout()
    figure.savefig(STUDY_DIR / "validation_confusion_matrices.png", dpi=160)
    plt.close(figure)
    del labels


def _plot_probabilities(probabilities: np.ndarray, actual: np.ndarray) -> None:
    figure, axes = plt.subplots(1, 3, figsize=(13, 4))
    for index, name in enumerate(CLASS_NAMES):
        groups = [probabilities[actual == class_index, index] for class_index in range(3)]
        axes[index].boxplot(groups, tick_labels=CLASS_NAMES, showfliers=False)
        axes[index].set(
            title=f"Predicted P({name})",
            xlabel="Actual target class",
            ylabel="Probability",
            ylim=(0, 1),
        )
    figure.tight_layout()
    figure.savefig(STUDY_DIR / "validation_probabilities_by_actual_class.png", dpi=160)
    plt.close(figure)


def _plot_features(validation: pd.DataFrame, target_observations: pd.DataFrame) -> None:
    inputs = (
        ("waterlevel", "Feature-date water level"),
        ("discharge", "Feature-date discharge"),
        ("rain", "Feature-date rainfall"),
        ("rain_sum_7d", "Trailing 7-day rain sum"),
        ("waterlevel_mean_7d", "Trailing 7-day water-level mean"),
        ("discharge_mean_7d", "Trailing 7-day discharge mean"),
    )
    figure, axes = plt.subplots(2, 3, figsize=(14, 8))
    for axis, (column, title) in zip(axes.flat, inputs):
        groups = [
            validation.loc[validation["target_risk"] == risk, column].to_numpy()
            for risk in CLASS_NAMES
        ]
        axis.boxplot(groups, tick_labels=CLASS_NAMES, showfliers=False)
        axis.set(title=title, xlabel="Next-day target class")
    figure.suptitle("Validation feature distributions by next-day target")
    figure.tight_layout()
    figure.savefig(STUDY_DIR / "validation_features_by_target.png", dpi=160)
    plt.close(figure)

    thresholds = {
        "waterlevel": (700, 800),
        "discharge": (1000, 4000),
        "rain": (50, 100),
    }
    figure, axes = plt.subplots(1, 3, figsize=(14, 4))
    for axis, (column, limits) in zip(axes, thresholds.items()):
        groups = [
            target_observations.loc[target_observations["target_risk"] == risk, column].to_numpy()
            for risk in CLASS_NAMES
        ]
        axis.boxplot(groups, tick_labels=CLASS_NAMES, showfliers=False)
        axis.axhline(limits[0], color="orange", linestyle="--", label="Moderate threshold")
        axis.axhline(limits[1], color="red", linestyle=":", label="High threshold")
        axis.set(title=f"Target-day {column}", xlabel="Actual target class")
        axis.legend(fontsize=8)
    figure.suptitle("Validation target-day measurements and existing rule boundaries")
    figure.tight_layout()
    figure.savefig(STUDY_DIR / "validation_target_measurements_thresholds.png", dpi=160)
    plt.close(figure)


def main() -> None:
    STUDY_DIR.mkdir(parents=True, exist_ok=True)
    data = load_dataset()
    splits, manifest = chronological_split(data)
    train_frame = splits["train"]
    validation = splits["validation"]
    train_y = train_frame["target_risk"].map(CLASS_TO_INDEX).to_numpy(dtype=np.int64)
    validation_y = validation["target_risk"].map(CLASS_TO_INDEX).to_numpy(dtype=np.int64)

    preprocessor = joblib.load(MODEL_DIR / "flood_risk_preprocessor.joblib")
    original_model = tf.keras.models.load_model(
        MODEL_DIR / "flood_risk_mlp.keras", compile=False
    )
    train_x = preprocessor.transform(train_frame.loc[:, FEATURE_COLUMNS]).astype(np.float32)
    validation_x = preprocessor.transform(validation.loc[:, FEATURE_COLUMNS]).astype(np.float32)
    original_probabilities = original_model.predict(validation_x, verbose=0)
    original_predictions = original_probabilities.argmax(axis=1)
    base_weights = compute_class_weight(
        class_weight="balanced",
        classes=np.arange(len(CLASS_NAMES)),
        y=train_y,
    )
    balanced_weights = {int(i): float(value) for i, value in enumerate(base_weights)}
    sqrt_weights = np.sqrt(base_weights)
    sqrt_weights = sqrt_weights / sqrt_weights.mean()
    less_extreme_weights = {int(i): float(value) for i, value in enumerate(sqrt_weights)}

    experiment_results: dict[str, dict[str, Any]] = {
        "A_original_mlp": {
            "experiment": "A_original_mlp",
            "architecture": [train_x.shape[1], 64, 32, 3],
            "epochs_trained": 67,
            "best_epoch": 55,
            "best_validation_macro_f1": None,
            "class_weights": {
                CLASS_NAMES[i]: balanced_weights[i] for i in balanced_weights
            },
        }
    }
    predictions_by_experiment: dict[str, np.ndarray] = {
        "A_original_mlp": original_predictions
    }
    probabilities_by_experiment: dict[str, np.ndarray] = {
        "A_original_mlp": original_probabilities
    }
    for experiment in EXPERIMENTS[1:]:
        name = experiment["name"]
        weights = less_extreme_weights if experiment["kind"] == "sqrt_weights" else balanced_weights
        candidate_path = STUDY_DIR / f"{name}.keras"
        cached_path = STUDY_DIR / "validation_experiments.json"
        cached_experiments = (
            json.loads(cached_path.read_text(encoding="utf-8")).get("experiments", {})
            if cached_path.is_file()
            else {}
        )
        if candidate_path.is_file() and name in cached_experiments:
            candidate = tf.keras.models.load_model(candidate_path, compile=False)
            cached = cached_experiments[name]
            training_summary = {
                key: cached[key]
                for key in (
                    "experiment",
                    "architecture",
                    "epochs_trained",
                    "best_epoch",
                    "best_validation_macro_f1",
                    "class_weights",
                )
            }
        else:
            candidate, training_summary = _fit_candidate(
                name,
                train_x,
                train_y,
                validation_x,
                validation_y,
                weights,
                compact=experiment["kind"] == "compact",
            )
            candidate.save(candidate_path)
        probabilities = candidate.predict(validation_x, verbose=0)
        predictions = probabilities.argmax(axis=1)
        training_summary["class_weights"] = {
            CLASS_NAMES[i]: weights[i] for i in weights
        }
        experiment_results[name] = training_summary
        probabilities_by_experiment[name] = probabilities
        predictions_by_experiment[name] = predictions

    threshold_rows = []
    threshold_predictions: dict[float, np.ndarray] = {}
    for threshold in PROBABILITY_THRESHOLDS:
        policy_predictions = _policy_predictions(original_probabilities, threshold)
        threshold_predictions[threshold] = policy_predictions
        threshold_rows.append(
            {
                "candidate": f"A_moderate_probability_{threshold:.2f}",
                "threshold": threshold,
                "preserves_argmax_high": True,
                **metrics_for(validation_y, policy_predictions),
            }
        )

    experiment_metrics = {
        name: metrics_for(validation_y, prediction)
        for name, prediction in predictions_by_experiment.items()
    }
    comparison_rows = [
        {"candidate": name, **metrics}
        for name, metrics in experiment_metrics.items()
    ]
    for row in threshold_rows:
        comparison_rows.append(row)
    comparison = pd.DataFrame(
        [
            {
                "candidate": row["candidate"],
                "accuracy": row["accuracy"],
                "balanced_accuracy": row["balanced_accuracy"],
                "macro_f1": row["macro_f1"],
                "moderate_precision": row["per_class"]["MODERATE"]["precision"],
                "moderate_recall": row["per_class"]["MODERATE"]["recall"],
                "moderate_f1": row["per_class"]["MODERATE"]["f1"],
                "high_recall": row["per_class"]["HIGH"]["recall"],
                "high_f1": row["per_class"]["HIGH"]["f1"],
            }
            for row in comparison_rows
        ]
    )

    base_macro_f1 = experiment_metrics["A_original_mlp"]["macro_f1"]
    eligible_thresholds = [
        row
        for row in threshold_rows
        if row["per_class"]["HIGH"]["recall"] >= HIGH_RECALL_FLOOR
        and row["macro_f1"] >= base_macro_f1 - MACRO_F1_TOLERANCE
    ]
    best_threshold = max(
        eligible_thresholds,
        key=lambda row: (
            row["per_class"]["MODERATE"]["f1"],
            row["per_class"]["MODERATE"]["precision"],
            row["per_class"]["MODERATE"]["recall"],
            row["macro_f1"],
        ),
        default=None,
    )
    eligible_candidates = [
        row
        for row in comparison_rows
        if row["per_class"]["HIGH"]["recall"] >= HIGH_RECALL_FLOOR
        and row["macro_f1"] >= base_macro_f1 - MACRO_F1_TOLERANCE
    ]
    selected_candidate = max(
        eligible_candidates,
        key=lambda row: (
            row["per_class"]["MODERATE"]["f1"],
            row["per_class"]["MODERATE"]["precision"],
            row["per_class"]["MODERATE"]["recall"],
            row["per_class"]["HIGH"]["recall"],
            row["macro_f1"],
            row["balanced_accuracy"],
        ),
        default=None,
    )
    comparison.to_csv(STUDY_DIR / "validation_experiment_comparison.csv", index=False)
    metrics_for_models = {
        name: {
            **experiment_results[name],
            **experiment_metrics[name],
            "classification_report": classification_report(
                validation_y,
                predictions_by_experiment[name],
                labels=np.arange(len(CLASS_NAMES)),
                target_names=list(CLASS_NAMES),
                output_dict=True,
                zero_division=0,
            ),
        }
        for name in experiment_results
    }
    policy_results = {
        row["candidate"]: row for row in threshold_rows
    }
    (STUDY_DIR / "validation_experiments.json").write_text(
        json.dumps(
            {
                "data_used": (
                    "train and validation rows used for fitting/scoring; the chronological "
                    "split helper regenerated test date/class-count metadata, but test rows "
                    "were not predicted or scored for selection"
                ),
                "validation_rows": len(validation),
                "validation_date_range": [
                    manifest["splits"]["validation"]["feature_date_start"],
                    manifest["splits"]["validation"]["feature_date_end"],
                ],
                "experiments": metrics_for_models,
                "decision_policy_thresholds": PROBABILITY_THRESHOLDS,
                "decision_policy_selection_rule": {
                    "high_recall_at_least": HIGH_RECALL_FLOOR,
                    "macro_f1_at_least_original_minus": MACRO_F1_TOLERANCE,
                    "objective_order": [
                        "MODERATE F1",
                        "MODERATE precision",
                        "MODERATE recall",
                        "macro F1",
                    ],
                    "high_argmax_predictions_are_always_preserved": True,
                },
                "decision_policy_results": policy_results,
                "selected_validation_threshold": (
                    best_threshold["threshold"] if best_threshold is not None else None
                ),
                "selected_candidate": (
                    {
                        "name": selected_candidate["candidate"],
                        "validation_metrics": {
                            key: selected_candidate[key]
                            for key in (
                                "accuracy",
                                "balanced_accuracy",
                                "macro_f1",
                                "per_class",
                                "confusion_matrix",
                            )
                        },
                        "selection_rule": (
                            "Among candidates with HIGH recall >= "
                            f"{HIGH_RECALL_FLOOR} and macro-F1 no more than "
                            f"{MACRO_F1_TOLERANCE} below original, maximize "
                            "MODERATE F1, then precision, recall, HIGH recall, "
                            "macro-F1, and balanced accuracy."
                        ),
                    }
                    if selected_candidate is not None
                    else None
                ),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    error_summary, probability_frame = _describe_probability_behavior(
        validation,
        original_probabilities,
        original_predictions,
    )
    probability_frame.to_csv(STUDY_DIR / "validation_mlp_probabilities.csv", index=False)
    (STUDY_DIR / "validation_probability_analysis.json").write_text(
        json.dumps(error_summary, indent=2), encoding="utf-8"
    )
    (STUDY_DIR / "validation_classification_reports.json").write_text(
        json.dumps(
            {
                name: classification_report(
                    validation_y,
                    predictions_by_experiment[name],
                    labels=np.arange(len(CLASS_NAMES)),
                    target_names=list(CLASS_NAMES),
                    output_dict=True,
                    zero_division=0,
                )
                for name in predictions_by_experiment
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (STUDY_DIR / "validation_confusion_matrices.json").write_text(
        json.dumps(
            {
                name: confusion_matrix(
                    validation_y, prediction, labels=np.arange(len(CLASS_NAMES))
                ).tolist()
                for name, prediction in predictions_by_experiment.items()
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    feature_summaries = _feature_summary(validation)
    target_analysis, target_observations = _target_day_analysis(validation)
    (STUDY_DIR / "validation_feature_distributions.json").write_text(
        json.dumps(
            {
                "feature_date_measurements_by_next_day_target": feature_summaries,
                "target_date_observations_by_risk": target_analysis,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    _plot_probabilities(original_probabilities, validation_y)
    _plot_features(validation, target_observations)

    confusion_predictions = {
        name: predictions_by_experiment[name]
        for name in ("A_original_mlp", "B_sqrt_class_weights", "C_compact_architecture")
    }
    if best_threshold is not None:
        threshold = float(best_threshold["threshold"])
        confusion_predictions[f"A_moderate_threshold_{threshold:.2f}"] = threshold_predictions[threshold]
    else:
        confusion_predictions["A_no_eligible_threshold"] = original_predictions
    _plot_confusions(confusion_predictions, validation_y, list(confusion_predictions))

    print(
        json.dumps(
            {
                "validation_rows": len(validation),
                "experiment_comparison": comparison.to_dict(orient="records"),
                "selected_threshold_by_validation_rule": (
                    best_threshold["threshold"] if best_threshold is not None else None
                ),
                "selected_candidate": (
                    selected_candidate["candidate"] if selected_candidate is not None else None
                ),
                "validation_error_summary": error_summary,
                "feature_distributions": feature_summaries,
                "target_day_threshold_analysis": target_analysis,
                "output_directory": str(STUDY_DIR),
                "test_predictions_for_selection": 0,
                "test_metrics_for_selection": 0,
                "test_split_manifest_metadata_read": True,
            },
            indent=2,
        )
    )
    (STUDY_DIR / "selected_candidate.json").write_text(
        json.dumps(
            {
                "candidate": selected_candidate["candidate"] if selected_candidate else None,
                "experiment": (
                    experiment_results.get(selected_candidate["candidate"])
                    if selected_candidate
                    else None
                ),
                "validation_metrics": (
                    {
                        key: selected_candidate[key]
                        for key in (
                            "accuracy",
                            "balanced_accuracy",
                            "macro_precision",
                            "macro_recall",
                            "macro_f1",
                            "weighted_f1",
                            "per_class",
                            "confusion_matrix",
                        )
                    }
                    if selected_candidate
                    else None
                ),
                "selection_rule": (
                    "Among candidates with HIGH recall >= "
                    f"{HIGH_RECALL_FLOOR} and macro-F1 no more than "
                    f"{MACRO_F1_TOLERANCE} below original, maximize MODERATE F1, "
                    "then MODERATE precision, MODERATE recall, HIGH recall, "
                    "macro-F1, and balanced accuracy."
                ),
                "test_predictions_for_selection": 0,
                "test_metrics_for_selection": 0,
                "test_split_manifest_metadata_read": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
