from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml.features import FEATURE_COLUMNS, MEASUREMENT_FEATURES, engineer_daily_features
from ml.predict import PredictionArtifacts, predict_frame, read_input


class FitGuardPreprocessor:
    def __init__(self) -> None:
        self.fit_calls = 0
        self.transform_calls = 0

    def fit(self, *_args, **_kwargs):
        self.fit_calls += 1
        raise AssertionError("Prediction must not fit the preprocessor.")

    def transform(self, frame: pd.DataFrame) -> np.ndarray:
        self.transform_calls += 1
        if tuple(frame.columns) != FEATURE_COLUMNS:
            raise AssertionError("Unexpected feature columns or order.")
        return np.zeros((len(frame), 46), dtype=np.float32)


class FixedProbabilityModel:
    def __init__(self, probabilities: tuple[float, float, float] = (0.2, 0.7, 0.1)) -> None:
        self.probabilities = probabilities
        self.predict_calls = 0

    def predict(self, features: np.ndarray, verbose: int = 0) -> np.ndarray:
        del verbose
        self.predict_calls += 1
        return np.tile(self.probabilities, (len(features), 1))


def _input_frame(
    row_count: int = 8,
    station_id: str = "Station 1",
    start_date: str = "2026-01-01",
    include_station_name: bool = True,
) -> pd.DataFrame:
    dates = pd.date_range(start_date, periods=row_count, freq="D")
    rows = []
    for day_index, date in enumerate(dates):
        row = {
            "date": date.strftime("%Y-%m-%d"),
            "station_id": station_id,
            **{
                column: float(day_index + feature_index + 1)
                for feature_index, column in enumerate(MEASUREMENT_FEATURES)
            },
        }
        if include_station_name:
            row["station_name"] = station_id
        rows.append(row)
    return pd.DataFrame(rows)


def _artifacts() -> tuple[PredictionArtifacts, FitGuardPreprocessor, FixedProbabilityModel]:
    preprocessor = FitGuardPreprocessor()
    model = FixedProbabilityModel()
    artifacts = PredictionArtifacts(
        model=model,
        preprocessor=preprocessor,
        feature_metadata={"transformed_feature_count": 46},
        class_mapping={
            "class_to_index": {"LOW": 0, "MODERATE": 1, "HIGH": 2},
            "index_to_class": {"0": "LOW", "1": "MODERATE", "2": "HIGH"},
        },
        supported_station_ids=("Station 1", "Station 2"),
    )
    return artifacts, preprocessor, model


class PredictTests(unittest.TestCase):
    def test_csv_loading(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "readings.csv"
            _input_frame().to_csv(path, index=False)
            loaded = read_input(path)
        self.assertEqual(len(loaded), 8)
        self.assertEqual(loaded.loc[0, "station_id"], "Station 1")

    def test_xlsx_loading(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "readings.xlsx"
            _input_frame().to_excel(path, index=False)
            loaded = read_input(path)
        self.assertEqual(len(loaded), 8)
        self.assertEqual(loaded.loc[0, "station_id"], "Station 1")

    def test_missing_required_column_is_rejected(self) -> None:
        artifacts, _, _ = _artifacts()
        frame = _input_frame().drop(columns="rain")
        with self.assertRaisesRegex(ValueError, "rain"):
            predict_frame(frame, artifacts)

    def test_unknown_station_is_unsupported(self) -> None:
        artifacts, preprocessor, model = _artifacts()
        output, report = predict_frame(_input_frame(station_id="Station 999"), artifacts)
        self.assertTrue((output["prediction_status"] == "UNSUPPORTED_STATION").all())
        self.assertEqual(report["unknown_station_ids"], ["Station 999"])
        self.assertEqual(preprocessor.transform_calls, 0)
        self.assertEqual(model.predict_calls, 0)

    def test_duplicate_station_date_rows_are_invalid(self) -> None:
        artifacts, _, _ = _artifacts()
        frame = _input_frame()
        frame = pd.concat([frame, frame.iloc[[3]]], ignore_index=True)
        output, _ = predict_frame(frame, artifacts)
        duplicate_rows = output.loc[output["feature_date"] == "2026-01-04"]
        self.assertEqual(len(duplicate_rows), 2)
        self.assertTrue((duplicate_rows["prediction_status"] == "INVALID_INPUT").all())
        self.assertTrue(duplicate_rows["status_reason"].str.contains("duplicate").all())

    def test_date_gap_is_reported_and_blocks_affected_windows(self) -> None:
        artifacts, _, _ = _artifacts()
        frame = _input_frame(row_count=13).drop(index=3).reset_index(drop=True)
        output, report = predict_frame(frame, artifacts)
        self.assertEqual(report["date_gaps"][0]["missing_dates"], ["2026-01-04"])
        self.assertEqual(report["date_gaps"][0]["station_id"], "Station 1")
        affected = output.loc[output["feature_date"] == "2026-01-10"].iloc[0]
        self.assertEqual(affected["prediction_status"], "INSUFFICIENT_HISTORY")
        recovered = output.loc[output["feature_date"] == "2026-01-11"].iloc[0]
        self.assertEqual(recovered["prediction_status"], "PREDICTED")

    def test_insufficient_history_rows_receive_no_prediction(self) -> None:
        artifacts, preprocessor, model = _artifacts()
        output, report = predict_frame(_input_frame(row_count=6), artifacts)
        self.assertTrue((output["prediction_status"] == "INSUFFICIENT_HISTORY").all())
        self.assertTrue(output["predicted_risk"].isna().all())
        self.assertEqual(report["predicted_rows"], 0)
        self.assertEqual(preprocessor.transform_calls, 0)
        self.assertEqual(model.predict_calls, 0)

    def test_successful_predictions_have_correct_dates(self) -> None:
        artifacts, _, _ = _artifacts()
        output, report = predict_frame(_input_frame(row_count=8), artifacts)
        predicted = output.loc[output["prediction_status"] == "PREDICTED"]
        self.assertEqual(len(predicted), 2)
        self.assertEqual(report["predicted_rows"], 2)
        self.assertEqual(predicted.iloc[0]["feature_date"], "2026-01-07")
        self.assertEqual(predicted.iloc[0]["predicted_target_date"], "2026-01-08")

    def test_probability_values_sum_to_one(self) -> None:
        artifacts, _, _ = _artifacts()
        output, _ = predict_frame(_input_frame(), artifacts)
        predicted = output.loc[output["prediction_status"] == "PREDICTED"]
        sums = predicted[
            ["probability_low", "probability_moderate", "probability_high"]
        ].sum(axis=1)
        self.assertTrue(np.allclose(sums, 1.0, atol=1e-6))

    def test_predicted_class_matches_highest_probability(self) -> None:
        artifacts, _, _ = _artifacts()
        output, _ = predict_frame(_input_frame(), artifacts)
        predicted = output.loc[output["prediction_status"] == "PREDICTED"]
        expected = predicted[
            ["probability_low", "probability_moderate", "probability_high"]
        ].idxmax(axis=1)
        expected_names = expected.map(
            {
                "probability_low": "LOW",
                "probability_moderate": "MODERATE",
                "probability_high": "HIGH",
            }
        )
        self.assertTrue((predicted["predicted_risk"] == expected_names).all())

    def test_target_columns_are_not_required_or_emitted(self) -> None:
        artifacts, _, _ = _artifacts()
        frame = _input_frame(include_station_name=False)
        self.assertNotIn("target_risk", frame.columns)
        self.assertNotIn("target_date", frame.columns)
        output, _ = predict_frame(frame, artifacts)
        self.assertIn("station_name", output.columns)
        self.assertTrue(output["station_name"].isna().all())
        self.assertNotIn("target_risk", output.columns)
        self.assertNotIn("target_date", output.columns)
        self.assertEqual(output.loc[6, "prediction_status"], "PREDICTED")

    def test_saved_preprocessor_is_transformed_not_fitted(self) -> None:
        artifacts, preprocessor, _ = _artifacts()
        predict_frame(_input_frame(), artifacts)
        self.assertEqual(preprocessor.fit_calls, 0)
        self.assertEqual(preprocessor.transform_calls, 1)

    def test_future_measurements_do_not_change_earlier_features(self) -> None:
        frame = _input_frame(row_count=10)
        baseline = engineer_daily_features(frame)
        changed = frame.copy()
        changed.loc[9, "rain"] = 99999.0
        modified = engineer_daily_features(changed)
        feature_date = pd.Timestamp("2026-01-08")
        pd.testing.assert_series_equal(
            baseline.loc[feature_date, list(FEATURE_COLUMNS)],
            modified.loc[feature_date, list(FEATURE_COLUMNS)],
        )


if __name__ == "__main__":
    unittest.main()
