"""Evaluate the validation-selected MLP candidate once on the final test period."""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path
from typing import Any

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf

from train import (
    CLASS_NAMES,
    CLASS_TO_INDEX,
    MODEL_DIR,
    OUTPUT_DIR,
    _classification_report,
    _y_values,
    chronological_split,
    load_dataset,
    metrics_for,
)


ROOT = Path(__file__).resolve().parents[1]
STUDY_DIR = OUTPUT_DIR / "error_analysis"
SOURCE_MODEL = STUDY_DIR / "B_sqrt_class_weights.keras"
SOURCE_PREPROCESSOR = MODEL_DIR / "flood_risk_preprocessor.joblib"
SOURCE_FEATURE_METADATA = MODEL_DIR / "flood_risk_feature_metadata.json"
SOURCE_CLASS_MAPPING = MODEL_DIR / "flood_risk_class_mapping.json"
VERSIONED_MODEL = MODEL_DIR / "flood_risk_mlp_v2.keras"
VERSIONED_PREPROCESSOR = MODEL_DIR / "flood_risk_preprocessor_v2.joblib"
VERSIONED_FEATURE_METADATA = MODEL_DIR / "flood_risk_feature_metadata_v2.json"
VERSIONED_CLASS_MAPPING = MODEL_DIR / "flood_risk_class_mapping_v2.json"
VERSIONED_METADATA = MODEL_DIR / "flood_risk_mlp_v2_metadata.json"
TRAINING_SUMMARY = OUTPUT_DIR / "training_summary.json"
SPLIT_MANIFEST = OUTPUT_DIR / "chronological_split_manifest.json"
TEST_RESULT = STUDY_DIR / "final_test_comparison.json"


def _comparison_row(name: str, metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": name,
        "accuracy": metrics["accuracy"],
        "balanced_accuracy": metrics["balanced_accuracy"],
        "macro_precision": metrics["macro_precision"],
        "macro_recall": metrics["macro_recall"],
        "macro_f1": metrics["macro_f1"],
        "weighted_f1": metrics["weighted_f1"],
        **{
            f"{class_name.lower()}_{metric}": metrics["per_class"][class_name][metric]
            for class_name in CLASS_NAMES
            for metric in ("precision", "recall", "f1")
        },
    }


def _assert_finite(value: Any, path: str = "result") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            _assert_finite(child, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _assert_finite(child, f"{path}[{index}]")
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if not np.isfinite(value):
            raise ValueError(f"Non-finite value in {path}: {value}")


def main() -> None:
    if TEST_RESULT.exists():
        raise FileExistsError(
            f"Final test evaluation already exists; refusing to evaluate again: {TEST_RESULT}"
        )

    required = (
        SOURCE_MODEL,
        SOURCE_PREPROCESSOR,
        SOURCE_FEATURE_METADATA,
        SOURCE_CLASS_MAPPING,
        STUDY_DIR / "selected_candidate.json",
        TRAINING_SUMMARY,
        SPLIT_MANIFEST,
    )
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(f"Required evaluation artifact is missing: {path}")

    selection = json.loads((STUDY_DIR / "selected_candidate.json").read_text(encoding="utf-8"))
    if (
        selection.get("candidate") != "B_sqrt_class_weights"
        or selection.get("test_predictions_for_selection") != 0
        or selection.get("test_metrics_for_selection") != 0
    ):
        raise ValueError("The selected candidate must be chosen without test-set evidence.")

    output_artifacts = (
        VERSIONED_MODEL,
        VERSIONED_PREPROCESSOR,
        VERSIONED_FEATURE_METADATA,
        VERSIONED_CLASS_MAPPING,
        VERSIONED_METADATA,
    )
    existing = [path for path in output_artifacts if path.exists()]
    if existing:
        raise FileExistsError(f"Refusing to overwrite versioned candidate files: {existing}")

    metadata = json.loads(SOURCE_FEATURE_METADATA.read_text(encoding="utf-8"))
    class_mapping = json.loads(SOURCE_CLASS_MAPPING.read_text(encoding="utf-8"))
    if metadata.get("class_names") != list(CLASS_NAMES):
        raise ValueError("Saved feature metadata class order does not match the model.")
    if metadata.get("class_to_index") != CLASS_TO_INDEX:
        raise ValueError("Saved class mapping does not match the model.")
    if class_mapping.get("class_to_index") != CLASS_TO_INDEX:
        raise ValueError("Saved class-mapping artifact does not match the model.")

    frame = load_dataset()
    splits, regenerated_manifest = chronological_split(frame)
    saved_manifest = json.loads(SPLIT_MANIFEST.read_text(encoding="utf-8"))
    if saved_manifest != regenerated_manifest:
        raise ValueError("Dataset split changed since the original training run.")
    test = splits["test"]

    preprocessor = joblib.load(SOURCE_PREPROCESSOR)
    model = tf.keras.models.load_model(SOURCE_MODEL, compile=False)
    x_test = preprocessor.transform(test.loc[:, metadata["feature_columns"]]).astype(np.float32)
    if x_test.shape[1] != int(metadata["transformed_feature_count"]):
        raise ValueError("Transformed test features do not match saved model metadata.")
    y_test = _y_values(test)

    shutil.copy2(SOURCE_MODEL, VERSIONED_MODEL)
    shutil.copy2(SOURCE_PREPROCESSOR, VERSIONED_PREPROCESSOR)
    shutil.copy2(SOURCE_FEATURE_METADATA, VERSIONED_FEATURE_METADATA)
    shutil.copy2(SOURCE_CLASS_MAPPING, VERSIONED_CLASS_MAPPING)
    candidate_metadata = {
        "model": VERSIONED_MODEL.name,
        "preprocessor": VERSIONED_PREPROCESSOR.name,
        "feature_metadata": VERSIONED_FEATURE_METADATA.name,
        "class_mapping": VERSIONED_CLASS_MAPPING.name,
        "selected_candidate": selection["candidate"],
        "selection_basis": "validation only",
        "validation_metrics": selection["validation_metrics"],
        "architecture": selection["experiment"]["architecture"],
        "class_weights": selection["experiment"]["class_weights"],
        "epochs_trained": selection["experiment"]["epochs_trained"],
        "best_epoch": selection["experiment"]["best_epoch"],
        "class_names": list(CLASS_NAMES),
    }
    VERSIONED_METADATA.write_text(
        json.dumps(candidate_metadata, indent=2, allow_nan=False), encoding="utf-8"
    )

    predictions = model.predict(x_test, verbose=0).argmax(axis=1)
    candidate_metrics = metrics_for(y_test, predictions)
    candidate_metrics["classification_report"] = _classification_report(y_test, predictions)

    training_summary = json.loads(TRAINING_SUMMARY.read_text(encoding="utf-8"))
    prior_test_metrics = training_summary["test_metrics"]
    comparison = [
        _comparison_row("Random Forest", prior_test_metrics["Random Forest"]),
        _comparison_row("Original MLP", prior_test_metrics["MLP"]),
        _comparison_row("Selected MLP v2", candidate_metrics),
    ]
    result = {
        "evaluation": "single final evaluation of the validation-selected candidate",
        "candidate": selection["candidate"],
        "rows": int(len(test)),
        "feature_date_range": [
            test["date"].min().date().isoformat(),
            test["date"].max().date().isoformat(),
        ],
        "target_date_range": [
            test["target_date"].min().date().isoformat(),
            test["target_date"].max().date().isoformat(),
        ],
        "class_counts": {
            name: int(count)
            for name, count in test["target_risk"]
            .value_counts()
            .reindex(CLASS_NAMES, fill_value=0)
            .items()
        },
        "metrics": candidate_metrics,
        "comparison": comparison,
        "comparison_source": (
            "Random Forest and original MLP metrics are the existing one-time results "
            "from training_summary.json; they were not reevaluated."
        ),
        "artifacts": {
            "model": str(VERSIONED_MODEL.relative_to(ROOT)),
            "preprocessor": str(VERSIONED_PREPROCESSOR.relative_to(ROOT)),
            "metadata": str(VERSIONED_METADATA.relative_to(ROOT)),
            "comparison_json": str(TEST_RESULT.relative_to(ROOT)),
            "comparison_csv": str((STUDY_DIR / "final_test_comparison.csv").relative_to(ROOT)),
            "confusion_matrix_plot": str(
                (STUDY_DIR / "final_test_confusion_matrix.png").relative_to(ROOT)
            ),
        },
    }
    _assert_finite(result)
    TEST_RESULT.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")

    with (STUDY_DIR / "final_test_comparison.csv").open(
        "w", newline="", encoding="utf-8"
    ) as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=list(comparison[0]))
        writer.writeheader()
        writer.writerows(comparison)

    matrix = np.asarray(candidate_metrics["confusion_matrix"])
    figure, axis = plt.subplots(figsize=(6, 5))
    image = axis.imshow(matrix, cmap="Blues")
    axis.set(
        xticks=np.arange(len(CLASS_NAMES)),
        yticks=np.arange(len(CLASS_NAMES)),
        xticklabels=CLASS_NAMES,
        yticklabels=CLASS_NAMES,
        xlabel="Predicted class",
        ylabel="Actual class",
        title="Selected MLP v2 — final test confusion matrix",
    )
    plt.setp(axis.get_xticklabels(), rotation=25, ha="right", rotation_mode="anchor")
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            axis.text(column, row, f"{matrix[row, column]:,}", ha="center", va="center")
    figure.colorbar(image, ax=axis, label="Observations")
    figure.tight_layout()
    figure.savefig(STUDY_DIR / "final_test_confusion_matrix.png", dpi=160)
    plt.close(figure)
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
