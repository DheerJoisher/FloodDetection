"""Predict next-day flood risk from unlabeled, station-based CSV or XLSX history."""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml.features import (
    CATEGORICAL_FEATURES,
    FEATURE_COLUMNS,
    MEASUREMENT_FEATURES,
    NUMERIC_FEATURES,
    RAW_REQUIRED_COLUMNS,
    engineer_daily_features,
)


MODEL_DIR = Path(__file__).resolve().parent / "models"
CLASS_NAMES = ("LOW", "MODERATE", "HIGH")
TARGET_ONLY_COLUMNS = ("target_risk", "target_date", "risk_at_observation")
OUTPUT_COLUMNS = (
    "station_id",
    "station_name",
    "feature_date",
    "predicted_target_date",
    *MEASUREMENT_FEATURES,
    "predicted_risk",
    "probability_low",
    "probability_moderate",
    "probability_high",
    "prediction_confidence",
    "prediction_status",
    "status_reason",
)


@dataclass(frozen=True)
class PredictionArtifacts:
    model: Any
    preprocessor: Any
    feature_metadata: dict[str, Any]
    class_mapping: dict[str, Any]
    supported_station_ids: tuple[str, ...]

    @property
    def class_names(self) -> tuple[str, ...]:
        index_to_class = self.class_mapping["index_to_class"]
        return tuple(index_to_class[str(index)] for index in range(len(CLASS_NAMES)))


def load_artifacts(model_dir: Path = MODEL_DIR) -> PredictionArtifacts:
    """Load the selected model and its matching, already-fitted preprocessor."""
    model_dir = Path(model_dir)
    paths = {
        "model": model_dir / "flood_risk_mlp_v2.keras",
        "preprocessor": model_dir / "flood_risk_preprocessor_v2.joblib",
        "feature metadata": model_dir / "flood_risk_feature_metadata_v2.json",
        "class mapping": model_dir / "flood_risk_class_mapping_v2.json",
        "model metadata": model_dir / "flood_risk_mlp_v2_metadata.json",
    }
    for label, path in paths.items():
        if not path.is_file():
            raise FileNotFoundError(f"Missing {label} artifact: {path}")

    feature_metadata = json.loads(paths["feature metadata"].read_text(encoding="utf-8"))
    class_mapping = json.loads(paths["class mapping"].read_text(encoding="utf-8"))
    model_metadata = json.loads(paths["model metadata"].read_text(encoding="utf-8"))

    if tuple(feature_metadata.get("feature_columns", ())) != FEATURE_COLUMNS:
        raise ValueError("Saved V2 feature columns do not match the shared feature contract.")
    if tuple(feature_metadata.get("numeric_features", ())) != NUMERIC_FEATURES:
        raise ValueError("Saved V2 numeric features do not match the shared feature contract.")
    if tuple(feature_metadata.get("categorical_features", ())) != CATEGORICAL_FEATURES:
        raise ValueError("Saved V2 categorical features do not match the shared feature contract.")
    expected_mapping = {name: index for index, name in enumerate(CLASS_NAMES)}
    if class_mapping.get("class_to_index") != expected_mapping:
        raise ValueError("Saved V2 class mapping has an unexpected class order.")
    if tuple(
        class_mapping.get("index_to_class", {}).get(str(index))
        for index in range(len(CLASS_NAMES))
    ) != CLASS_NAMES:
        raise ValueError("Saved V2 inverse class mapping has an unexpected class order.")
    if model_metadata.get("model") != paths["model"].name:
        raise ValueError("V2 model metadata does not identify the selected model file.")
    if model_metadata.get("preprocessor") != paths["preprocessor"].name:
        raise ValueError("V2 model metadata does not identify the matching preprocessor.")
    if model_metadata.get("feature_metadata") != paths["feature metadata"].name:
        raise ValueError("V2 model metadata does not identify its feature contract.")
    if model_metadata.get("class_mapping") != paths["class mapping"].name:
        raise ValueError("V2 model metadata does not identify its class mapping.")
    if tuple(model_metadata.get("class_names", ())) != CLASS_NAMES:
        raise ValueError("V2 model metadata class order does not match the saved mapping.")
    if model_metadata.get("selection_basis") != "validation only":
        raise ValueError("V2 model metadata does not confirm validation-only selection.")

    preprocessor = joblib.load(paths["preprocessor"])
    saved_features = tuple(getattr(preprocessor, "feature_names_in_", ()))
    if saved_features != FEATURE_COLUMNS:
        raise ValueError("Saved preprocessor feature order does not match V2 metadata.")
    try:
        station_encoder = preprocessor.named_transformers_["station"]
        if station_encoder.handle_unknown != "ignore" or len(station_encoder.categories_) != 1:
            raise ValueError("Saved station encoder has an unexpected configuration.")
        supported_station_ids = tuple(str(value) for value in station_encoder.categories_[0])
    except (AttributeError, KeyError, TypeError) as error:
        raise ValueError("Saved preprocessor does not expose the expected station encoder.") from error
    if not supported_station_ids:
        raise ValueError("Saved preprocessor contains no supported station identifiers.")

    import tensorflow as tf

    model = tf.keras.models.load_model(paths["model"], compile=False)
    if model.input_shape[-1] != int(feature_metadata["transformed_feature_count"]):
        raise ValueError("Saved V2 model input width does not match feature metadata.")
    if model.output_shape[-1] != len(CLASS_NAMES):
        raise ValueError("Saved V2 model output width does not match the class mapping.")

    return PredictionArtifacts(
        model=model,
        preprocessor=preprocessor,
        feature_metadata=feature_metadata,
        class_mapping=class_mapping,
        supported_station_ids=supported_station_ids,
    )


def read_input(path: Path) -> pd.DataFrame:
    """Read CSV or XLSX based on its file extension."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Input file not found: {path}")
    extension = path.suffix.lower()
    if extension not in {".csv", ".xlsx"}:
        raise ValueError("Input file must have a .csv or .xlsx extension.")
    try:
        if extension == ".csv":
            frame = pd.read_csv(path, dtype={"station_id": "string"})
        else:
            frame = pd.read_excel(path, engine="openpyxl")
    except Exception as error:
        raise ValueError(f"Could not read {extension[1:].upper()} input '{path}': {error}") from error
    if not frame.columns.is_unique:
        raise ValueError("Input file contains duplicate column names.")
    return frame


def _is_missing(value: Any) -> bool:
    return value is None or value is pd.NA or bool(pd.isna(value))


def _parse_station_id(value: Any) -> str | None:
    if _is_missing(value):
        return None
    station_id = str(value).strip()
    return station_id or None


def _parse_date(value: Any) -> tuple[pd.Timestamp | None, str | None]:
    if _is_missing(value) or isinstance(value, (int, float, np.number)):
        return None, "date is missing or is not a date value"
    try:
        parsed = pd.Timestamp(value)
    except (TypeError, ValueError, OverflowError):
        return None, "date cannot be parsed"
    if pd.isna(parsed):
        return None, "date cannot be parsed"
    if parsed.tzinfo is not None:
        return None, "date must not include a timezone"
    if parsed != parsed.normalize():
        return None, "date must be a calendar date without a time component"
    return parsed.normalize(), None


def _parse_measurement(value: Any, column: str) -> tuple[float, str | None]:
    if _is_missing(value):
        return float("nan"), f"{column} is missing"
    try:
        parsed = float(pd.to_numeric(value, errors="raise"))
    except (TypeError, ValueError, OverflowError):
        return float("nan"), f"{column} is not numeric"
    if not math.isfinite(parsed):
        return float("nan"), f"{column} must be finite"
    return parsed, None


def _validate_columns(frame: pd.DataFrame) -> None:
    missing = sorted(set(RAW_REQUIRED_COLUMNS) - set(frame.columns))
    if missing:
        raise ValueError(f"Input file is missing required columns: {missing}")
    if not frame.columns.is_unique:
        raise ValueError("Input frame contains duplicate column names.")
    if frame.empty:
        raise ValueError("Input file contains no data rows.")


def _find_date_gaps(
    valid_keys: dict[str, set[pd.Timestamp]],
    rows_by_station: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    for station_id in sorted(valid_keys):
        dates = sorted(valid_keys[station_id])
        for previous, following in zip(dates, dates[1:]):
            missing_days = int((following - previous).days - 1)
            if missing_days <= 0:
                continue
            missing_timestamps = [
                previous + pd.Timedelta(days=offset)
                for offset in range(1, missing_days + 1)
            ]
            affected_window = {
                missing_date + pd.Timedelta(days=offset)
                for missing_date in missing_timestamps
                for offset in range(7)
            }
            affected_rows = [
                row
                for row in rows_by_station.get(station_id, [])
                if row["feature_date"] in affected_window
            ]
            gaps.append(
                {
                    "station_id": station_id,
                    "previous_date": previous.date().isoformat(),
                    "next_date": following.date().isoformat(),
                    "missing_dates": [date.date().isoformat() for date in missing_timestamps],
                    "affected_feature_dates": sorted(
                        {row["feature_date"].date().isoformat() for row in affected_rows}
                    ),
                    "affected_predicted_target_dates": sorted(
                        {
                            row["predicted_target_date"].date().isoformat()
                            for row in affected_rows
                            if row["predicted_target_date"] is not None
                        }
                    ),
                    "affected_input_rows": len(affected_rows),
                }
            )
    return gaps


def _history_reason(
    station_id: str,
    feature_date: pd.Timestamp,
    observed_dates: set[pd.Timestamp],
    duplicate_dates: set[pd.Timestamp],
    invalid_measurement_dates: set[pd.Timestamp],
) -> str:
    required_dates = pd.date_range(end=feature_date, periods=7, freq="D")
    missing = [date.date().isoformat() for date in required_dates if date not in observed_dates]
    duplicated = [date.date().isoformat() for date in required_dates if date in duplicate_dates]
    invalid = [
        date.date().isoformat()
        for date in required_dates
        if date in invalid_measurement_dates
    ]
    details = [
        f"requires seven consecutive observations through {feature_date.date().isoformat()}"
    ]
    if missing:
        details.append(f"missing dates: {', '.join(missing)}")
    if duplicated:
        details.append(f"duplicate station/date rows: {', '.join(duplicated)}")
    if invalid:
        details.append(f"invalid measurements on: {', '.join(invalid)}")
    return f"Insufficient historical features for station {station_id}; " + "; ".join(details) + "."


def predict_frame(
    input_frame: pd.DataFrame,
    artifacts: PredictionArtifacts,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Validate and score input rows without fitting or modifying any artifacts."""
    _validate_columns(input_frame)

    known_stations = set(artifacts.supported_station_ids)
    raw_rows: list[dict[str, Any]] = []
    duplicate_keys: dict[tuple[str, pd.Timestamp], list[int]] = defaultdict(list)
    valid_keys: dict[str, set[pd.Timestamp]] = defaultdict(set)
    rows_by_station: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for position, (_, input_row) in enumerate(input_frame.iterrows()):
        station_id = _parse_station_id(input_row["station_id"])
        feature_date, date_error = _parse_date(input_row["date"])
        measurement_values: dict[str, float] = {}
        errors: list[str] = []
        if station_id is None:
            errors.append("station_id is missing")
        if date_error:
            errors.append(date_error)
        for column in MEASUREMENT_FEATURES:
            measurement, measurement_error = _parse_measurement(input_row[column], column)
            measurement_values[column] = measurement
            if measurement_error:
                errors.append(measurement_error)

        station_name_value = input_row.get("station_name")
        station_name = (
            None if _is_missing(station_name_value) else str(station_name_value).strip()
        )
        raw_record = {
            "input_position": position,
            "input_row_number": position + 2,
            "station_id": station_id,
            "station_name": station_name,
            "feature_date": feature_date,
            "predicted_target_date": (
                feature_date + pd.Timedelta(days=1) if feature_date is not None else None
            ),
            "measurement_values": measurement_values,
            "raw_measurements": {column: input_row[column] for column in MEASUREMENT_FEATURES},
            "errors": errors,
            "status": None,
            "status_reason": None,
        }
        raw_rows.append(raw_record)
        if station_id is not None and feature_date is not None:
            duplicate_keys[(station_id, feature_date)].append(position)
            valid_keys[station_id].add(feature_date)
            rows_by_station[station_id].append(raw_record)

    duplicate_positions: set[int] = set()
    duplicate_dates_by_station: dict[str, set[pd.Timestamp]] = defaultdict(set)
    for (station_id, feature_date), positions in duplicate_keys.items():
        if len(positions) > 1:
            duplicate_positions.update(positions)
            duplicate_dates_by_station[station_id].add(feature_date)
            for position in positions:
                raw_rows[position]["errors"].append(
                    f"duplicate station_id/date key ({station_id}, {feature_date.date().isoformat()})"
                )

    invalid_measurement_dates: dict[str, set[pd.Timestamp]] = defaultdict(set)
    for row in raw_rows:
        if row["feature_date"] is not None and row["station_id"] is not None:
            if any(not math.isfinite(value) for value in row["measurement_values"].values()):
                invalid_measurement_dates[row["station_id"]].add(row["feature_date"])

        if row["errors"]:
            row["status"] = "INVALID_INPUT"
            row["status_reason"] = "; ".join(row["errors"])
        elif row["station_id"] not in known_stations:
            row["status"] = "UNSUPPORTED_STATION"
            row["status_reason"] = (
                f"station_id '{row['station_id']}' is not supported by the saved V2 model."
            )

    # Malformed measurements remain NaN in history so later windows cannot bridge them.
    history_frames: dict[str, pd.DataFrame] = {}
    for station_id in sorted(known_stations):
        records = [
            row
            for row in raw_rows
            if row["station_id"] == station_id
            and row["feature_date"] is not None
            and row["input_position"] not in duplicate_positions
        ]
        if not records:
            continue
        history = pd.DataFrame(
            [
                {
                    "date": row["feature_date"],
                    "station_id": station_id,
                    "station_name": row["station_name"],
                    **row["measurement_values"],
                }
                for row in records
            ]
        )
        history_frames[station_id] = engineer_daily_features(history)

    predict_positions: list[int] = []
    feature_records: list[pd.Series] = []
    for row in raw_rows:
        if row["status"] is not None:
            continue
        station_id = row["station_id"]
        feature_date = row["feature_date"]
        daily = history_frames.get(station_id)
        if daily is None or feature_date not in daily.index:
            row["status"] = "INSUFFICIENT_HISTORY"
            row["status_reason"] = (
                f"Insufficient historical features for station {station_id}; "
                "current observation is unavailable."
            )
            continue
        feature_values = daily.loc[feature_date, list(FEATURE_COLUMNS)]
        numeric_values = pd.to_numeric(
            feature_values.loc[list(NUMERIC_FEATURES)], errors="coerce"
        ).to_numpy(dtype=float)
        if not np.isfinite(numeric_values).all():
            row["status"] = "INSUFFICIENT_HISTORY"
            row["status_reason"] = _history_reason(
                station_id,
                feature_date,
                valid_keys[station_id],
                duplicate_dates_by_station[station_id],
                invalid_measurement_dates[station_id],
            )
            continue
        predict_positions.append(row["input_position"])
        feature_records.append(feature_values)

    if predict_positions:
        feature_frame = pd.DataFrame(feature_records, columns=FEATURE_COLUMNS)
        transformed = artifacts.preprocessor.transform(feature_frame)
        if hasattr(transformed, "toarray"):
            transformed = transformed.toarray()
        transformed = np.asarray(transformed, dtype=np.float32)
        expected_width = int(artifacts.feature_metadata["transformed_feature_count"])
        expected_shape = (len(predict_positions), expected_width)
        if transformed.ndim != 2 or transformed.shape != expected_shape:
            raise ValueError(
                "Saved preprocessor returned an unexpected feature shape: "
                f"{transformed.shape}; expected {expected_shape}."
            )
        probabilities = np.asarray(artifacts.model.predict(transformed, verbose=0), dtype=float)
        if probabilities.shape != (len(predict_positions), len(CLASS_NAMES)):
            raise ValueError(
                f"Saved model returned an unexpected probability shape: {probabilities.shape}."
            )
        if not np.isfinite(probabilities).all() or (probabilities < 0).any():
            raise ValueError("Saved model returned invalid class probabilities.")
        if not np.allclose(probabilities.sum(axis=1), 1.0, rtol=1e-5, atol=1e-6):
            raise ValueError("Saved model output does not contain normalized softmax probabilities.")

        for prediction_index, row_position in enumerate(predict_positions):
            row = raw_rows[row_position]
            row["status"] = "PREDICTED"
            row["status_reason"] = (
                "Prediction uses this date and the six preceding consecutive daily observations."
            )
            row["probabilities"] = probabilities[prediction_index]
            row["predicted_risk"] = artifacts.class_names[
                int(probabilities[prediction_index].argmax())
            ]

    output_records: list[dict[str, Any]] = []
    for row in raw_rows:
        record: dict[str, Any] = {
            "station_id": row["station_id"],
            "station_name": row["station_name"],
            "feature_date": (
                row["feature_date"].date().isoformat() if row["feature_date"] is not None else None
            ),
            "predicted_target_date": (
                row["predicted_target_date"].date().isoformat()
                if row["predicted_target_date"] is not None
                else None
            ),
            **row["raw_measurements"],
            "predicted_risk": None,
            "probability_low": None,
            "probability_moderate": None,
            "probability_high": None,
            "prediction_confidence": None,
            "prediction_status": row["status"],
            "status_reason": row["status_reason"],
        }
        if row["status"] == "PREDICTED":
            probability_values = row["probabilities"]
            record.update(
                {
                    "predicted_risk": row["predicted_risk"],
                    "probability_low": float(probability_values[0]),
                    "probability_moderate": float(probability_values[1]),
                    "probability_high": float(probability_values[2]),
                    "prediction_confidence": float(probability_values.max()),
                }
            )
        output_records.append(record)

    output_frame = pd.DataFrame(output_records, columns=OUTPUT_COLUMNS)
    status_counts = output_frame["prediction_status"].value_counts().to_dict()
    skipped_rows = [
        {
            "input_row_number": row["input_row_number"],
            "station_id": row["station_id"],
            "feature_date": (
                row["feature_date"].date().isoformat() if row["feature_date"] is not None else None
            ),
            "prediction_status": row["status"],
            "status_reason": row["status_reason"],
        }
        for row in raw_rows
        if row["status"] != "PREDICTED"
    ]
    date_gaps = _find_date_gaps(valid_keys, rows_by_station)
    report = {
        "input_rows": int(len(input_frame)),
        "status_counts": {str(key): int(value) for key, value in status_counts.items()},
        "predicted_rows": int(status_counts.get("PREDICTED", 0)),
        "skipped_rows": skipped_rows,
        "unknown_station_ids": sorted(
            {
                row["station_id"]
                for row in raw_rows
                if row["status"] == "UNSUPPORTED_STATION"
            }
        ),
        "date_gaps": date_gaps,
        "ignored_target_only_columns": [
            column for column in TARGET_ONLY_COLUMNS if column in input_frame.columns
        ],
        "decision_policy": "softmax argmax",
        "preprocessor_refitted": False,
    }
    return output_frame, report


def run_prediction(
    input_path: Path,
    output_path: Path,
    model_dir: Path = MODEL_DIR,
    report_path: Path | None = None,
) -> tuple[pd.DataFrame, dict[str, Any], Path]:
    input_path = Path(input_path)
    output_path = Path(output_path)
    if input_path.resolve() == output_path.resolve():
        raise ValueError("Output path must not overwrite the input file.")
    if output_path.suffix.lower() != ".csv":
        raise ValueError("Prediction output must have a .csv extension.")
    resolved_report_path = (
        Path(report_path)
        if report_path is not None
        else output_path.with_name(f"{output_path.stem}.report.json")
    )
    if resolved_report_path.resolve() in {input_path.resolve(), output_path.resolve()}:
        raise ValueError("Report path must be different from input and output paths.")

    input_frame = read_input(input_path)
    artifacts = load_artifacts(model_dir)
    output_frame, report = predict_frame(input_frame, artifacts)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    resolved_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_frame.to_csv(output_path, index=False)
    report.update(
        {
            "input_file": str(input_path.resolve()),
            "output_file": str(output_path.resolve()),
            "report_file": str(resolved_report_path.resolve()),
            "model_file": str((Path(model_dir) / "flood_risk_mlp_v2.keras").resolve()),
            "preprocessor_refitted": False,
        }
    )
    resolved_report_path.write_text(
        json.dumps(report, indent=2, allow_nan=False), encoding="utf-8"
    )
    return output_frame, report, resolved_report_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="unlabeled .csv or .xlsx history")
    parser.add_argument("--output", required=True, type=Path, help="prediction output .csv path")
    parser.add_argument(
        "--model-dir",
        type=Path,
        default=MODEL_DIR,
        help=f"directory containing the V2 model and matching artifacts (default: {MODEL_DIR})",
    )
    parser.add_argument(
        "--report",
        type=Path,
        help="optional JSON report path (default: <output stem>.report.json)",
    )
    args = parser.parse_args()
    try:
        output, report, report_path = run_prediction(
            args.input, args.output, args.model_dir, args.report
        )
    except (FileNotFoundError, ValueError, RuntimeError) as error:
        parser.exit(2, f"Error: {error}\n")

    predicted = output.loc[output["prediction_status"] == "PREDICTED"]
    print(
        json.dumps(
            {
                "input_rows": report["input_rows"],
                "status_counts": report["status_counts"],
                "output_file": str(args.output.resolve()),
                "report_file": str(report_path.resolve()),
                "example_prediction": (
                    predicted.head(1).to_dict(orient="records") or None
                ),
                "preprocessor_refitted": False,
            },
            indent=2,
            default=str,
        )
    )


if __name__ == "__main__":
    main()
