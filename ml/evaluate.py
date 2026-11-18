"""Evaluate the saved MLP without retraining it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)

from train import (
    AUDIT_COLUMNS,
    CLASS_NAMES,
    CLASS_TO_INDEX,
    DATASET,
    FEATURE_COLUMNS,
    MODEL_DIR,
    OUTPUT_DIR,
    chronological_split,
    load_dataset,
)


def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    labels = np.arange(len(CLASS_NAMES))
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, zero_division=0
    )
    result = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macro_precision": float(
            precision_recall_fscore_support(
                y_true, y_pred, labels=labels, average="macro", zero_division=0
            )[0]
        ),
        "macro_recall": float(
            precision_recall_fscore_support(
                y_true, y_pred, labels=labels, average="macro", zero_division=0
            )[1]
        ),
        "macro_f1": float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0)),
        "weighted_f1": float(
            f1_score(y_true, y_pred, labels=labels, average="weighted", zero_division=0)
        ),
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
        "classification_report": classification_report(
            y_true,
            y_pred,
            labels=labels,
            target_names=list(CLASS_NAMES),
            output_dict=True,
            zero_division=0,
        ),
    }
    if not np.isfinite([result[key] for key in (
        "accuracy",
        "balanced_accuracy",
        "macro_precision",
        "macro_recall",
        "macro_f1",
        "weighted_f1",
    )]).all():
        raise AssertionError("Evaluation produced non-finite metrics.")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--split",
        choices=("validation", "test"),
        default="validation",
        help="test evaluation should be run once, after model selection is final",
    )
    args = parser.parse_args()

    model_path = MODEL_DIR / "flood_risk_mlp.keras"
    preprocessor_path = MODEL_DIR / "flood_risk_preprocessor.joblib"
    metadata_path = MODEL_DIR / "flood_risk_feature_metadata.json"
    manifest_path = OUTPUT_DIR / "chronological_split_manifest.json"
    for path in (model_path, preprocessor_path, metadata_path, manifest_path, DATASET):
        if not path.is_file():
            raise FileNotFoundError(f"Required evaluation artifact is missing: {path}")

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if tuple(metadata["feature_columns"]) != FEATURE_COLUMNS:
        raise ValueError("Saved feature metadata does not match the evaluation feature contract.")
    if tuple(metadata["audit_columns"]) != AUDIT_COLUMNS:
        raise ValueError("Saved audit-column metadata does not match the expected contract.")

    frame = load_dataset()
    splits, regenerated_manifest = chronological_split(frame)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest != regenerated_manifest:
        raise ValueError("Current data split differs from the split used for training.")
    selected = splits[args.split]
    preprocessor = joblib.load(preprocessor_path)
    model = tf.keras.models.load_model(model_path, compile=False)
    x = preprocessor.transform(selected.loc[:, FEATURE_COLUMNS]).astype(np.float32)
    y = selected["target_risk"].map(CLASS_TO_INDEX).to_numpy(dtype=np.int64)
    predictions = model.predict(x, verbose=0).argmax(axis=1)
    result = {
        "split": args.split,
        "rows": len(selected),
        "feature_date_range": [
            selected["date"].min().date().isoformat(),
            selected["date"].max().date().isoformat(),
        ],
        "target_date_range": [
            selected["target_date"].min().date().isoformat(),
            selected["target_date"].max().date().isoformat(),
        ],
        "class_counts": {
            name: int(count)
            for name, count in selected["target_risk"]
            .value_counts()
            .reindex(CLASS_NAMES, fill_value=0)
            .items()
        },
        "metrics": _metrics(y, predictions),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
