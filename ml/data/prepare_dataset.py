"""Build and validate a leakage-safe next-calendar-day flood-risk dataset."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml.features import FEATURE_COLUMNS, MEASUREMENT_FEATURES, METRICS, engineer_daily_features


SOURCE = ROOT / "data" / "raw" / "godavari_dataset_fyp.xlsx"
OUTPUT = ROOT / "ml" / "data" / "processed" / "next_day_risk_dataset.csv"
RISK_MODULE = ROOT / "src" / "lib" / "risk-level.js"
EXPECTED_STATIONS = {f"Station {number}" for number in range(1, 16)}
REQUIRED_COLUMNS = (
    "date",
    "doy",
    *MEASUREMENT_FEATURES,
    "station_name",
    "station_id",
)
OUTPUT_COLUMNS = (
    "station_id",
    "station_name",
    "date",
    "target_date",
    *FEATURE_COLUMNS[:-1],
    "target_risk",
)
TARGET_CLASSES = ("LOW", "MODERATE", "HIGH")
def _read_source() -> pd.DataFrame:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Source workbook not found: {SOURCE}")

    frame = pd.read_excel(SOURCE, engine="openpyxl")
    missing_columns = sorted(set(REQUIRED_COLUMNS) - set(frame.columns))
    if missing_columns:
        raise ValueError(f"Workbook is missing required columns: {missing_columns}")

    frame = frame.loc[:, REQUIRED_COLUMNS].copy()
    parsed_dates = pd.to_datetime(frame["date"], errors="coerce")
    if parsed_dates.isna().any():
        bad_rows = (parsed_dates[parsed_dates.isna()].index + 2).tolist()[:10]
        raise ValueError(f"Invalid date values in workbook rows: {bad_rows}")
    if (parsed_dates != parsed_dates.dt.normalize()).any():
        raise ValueError("Dates must be calendar dates without a time component.")
    frame["date"] = parsed_dates.dt.normalize()

    station_ids = set(frame["station_id"].dropna().astype(str))
    if station_ids != EXPECTED_STATIONS:
        raise ValueError(
            "Unexpected station identifiers. "
            f"Missing: {sorted(EXPECTED_STATIONS - station_ids)}; "
            f"unexpected: {sorted(station_ids - EXPECTED_STATIONS)}"
        )
    if frame["station_id"].isna().any() or frame["station_name"].isna().any():
        raise ValueError("station_id and station_name must not be missing.")

    duplicated = frame.duplicated(["station_id", "date"], keep=False)
    if duplicated.any():
        examples = frame.loc[duplicated, ["station_id", "date"]].head(10)
        raise ValueError(f"Duplicate station/date rows found:\n{examples.to_string(index=False)}")

    for column in ("doy", *MEASUREMENT_FEATURES):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
        values = frame[column].to_numpy(dtype=float)
        if not np.isfinite(values).all():
            raise ValueError(f"{column} contains missing or non-finite values.")

    doy = frame["doy"].to_numpy(dtype=float)
    if ((doy < 1) | (doy > 366) | (doy != np.floor(doy))).any():
        raise ValueError("doy must contain integer values from 1 through 366.")
    if not (frame["doy"].astype(int).to_numpy() == frame["date"].dt.day_of_year.to_numpy()).all():
        raise ValueError("doy values do not match the calendar dates.")

    name_counts = frame.groupby("station_id")["station_name"].nunique()
    if (name_counts != 1).any():
        raise ValueError("Each station_id must map to exactly one station_name.")

    return frame.sort_values(["station_id", "date"], kind="stable").reset_index(drop=True)


def _calculate_authoritative_risk(frame: pd.DataFrame) -> pd.Series:
    """Call the application's JS risk function rather than reimplementing it."""
    script = r"""
const path = require('node:path');
const root = process.argv[1];
require('dotenv').config({ path: path.join(root, '.env.local'), quiet: true });
const { calculateRisk } = require(path.join(root, 'src', 'lib', 'risk-level.js'));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const readings = JSON.parse(input);
    const labels = readings.map(reading => calculateRisk(reading));
    process.stdout.write(JSON.stringify(labels));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
});
"""
    readings = frame.loc[:, METRICS].to_dict(orient="records")
    completed = subprocess.run(
        ["node", "-e", script, str(ROOT)],
        input=json.dumps(readings, allow_nan=False),
        capture_output=True,
        check=False,
        text=True,
        cwd=ROOT,
    )
    if completed.returncode:
        raise RuntimeError(
            "Could not calculate labels using src/lib/risk-level.js: "
            f"{completed.stderr.strip()}"
        )
    labels = json.loads(completed.stdout)
    if len(labels) != len(frame) or any(label not in TARGET_CLASSES for label in labels):
        raise AssertionError("The authoritative risk module returned invalid labels.")
    return pd.Series(labels, index=frame.index, name="risk_at_observation")


def _date_gaps(frame: pd.DataFrame) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    for station_id, group in frame.groupby("station_id", sort=True):
        dates = group["date"].sort_values().reset_index(drop=True)
        differences = dates.diff().dropna()
        for index in differences[differences > pd.Timedelta(days=1)].index:
            previous = dates.iloc[index - 1]
            following = dates.iloc[index]
            missing_days = int((following - previous).days - 1)
            gaps.append(
                {
                    "station_id": station_id,
                    "previous_date": previous.date().isoformat(),
                    "next_date": following.date().isoformat(),
                    "missing_days": missing_days,
                }
            )
    return gaps


def _engineer_station(group: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    ordered_group = group.sort_values("date", kind="stable").set_index("date")
    station_id = str(ordered_group["station_id"].iloc[0])
    station_name = str(ordered_group["station_name"].iloc[0])
    daily = engineer_daily_features(group)

    daily["target_risk"] = daily["_risk"].shift(-1)
    daily["target_date"] = daily.index + pd.Timedelta(days=1)

    actual_dates = ordered_group.index
    result = daily.loc[actual_dates].copy()
    feature_values = result.loc[:, FEATURE_COLUMNS].drop(columns="station_id")
    complete_features = np.isfinite(feature_values.to_numpy(dtype=float)).all(axis=1)
    has_target = result["target_risk"].notna().to_numpy()
    included = complete_features & has_target

    stats = {
        "source_rows": len(group),
        "no_next_day_target": int((~has_target).sum()),
        "incomplete_historical_features": int((has_target & ~complete_features).sum()),
        "usable_rows": int(included.sum()),
    }

    result = result.loc[included].copy()
    result["station_id"] = station_id
    result["station_name"] = station_name
    result.index.name = "date"
    result = result.reset_index()
    result["date"] = result["date"].dt.strftime("%Y-%m-%d")
    result["target_date"] = result["target_date"].dt.strftime("%Y-%m-%d")
    result["target_risk"] = result["target_risk"].astype(str)
    return result.loc[:, OUTPUT_COLUMNS], stats


def _build_dataset() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    source = _read_source()
    source["_risk"] = _calculate_authoritative_risk(source)
    gaps = _date_gaps(source)

    station_results: list[pd.DataFrame] = []
    station_stats: dict[str, dict[str, int]] = {}
    for station_id, group in source.groupby("station_id", sort=True):
        engineered, stats = _engineer_station(group)
        station_results.append(engineered)
        station_stats[str(station_id)] = stats

    dataset = pd.concat(station_results, ignore_index=True)
    dataset = dataset.sort_values(["station_id", "date"], kind="stable").reset_index(drop=True)
    report: dict[str, Any] = {
        "original_rows": len(source),
        "station_count": int(source["station_id"].nunique()),
        "station_stats": station_stats,
        "gaps": gaps,
        "date_range": {
            "first_source_date": source["date"].min().date().isoformat(),
            "last_source_date": source["date"].max().date().isoformat(),
        },
        "feature_columns": list(FEATURE_COLUMNS),
        "usable_rows": len(dataset),
    }
    return source, dataset, report


def _check_leakage(source: pd.DataFrame, dataset: pd.DataFrame) -> dict[str, str]:
    if not dataset.columns.is_unique:
        raise AssertionError("Output contains duplicate column names.")
    if dataset.duplicated(["station_id", "date"]).any():
        raise AssertionError("Output has duplicate station/date rows.")
    if "target_risk" in FEATURE_COLUMNS:
        raise AssertionError("Target column appears in the feature list.")
    if set(FEATURE_COLUMNS) & {"station_name", "date", "target_date"}:
        raise AssertionError("Non-feature metadata or target date appears as a model feature.")
    if set(FEATURE_COLUMNS) & {"target_risk", "risk_at_observation"}:
        raise AssertionError("A risk label appears among model features.")
    if not set(FEATURE_COLUMNS).issubset(dataset.columns):
        raise AssertionError("One or more declared features are absent from the output.")
    if set(dataset["target_risk"].unique()) - set(TARGET_CLASSES):
        raise AssertionError("Unexpected target class found.")

    source_index = source.set_index(["station_id", "date"])
    if not source_index.index.is_unique:
        raise AssertionError("Source has duplicate station/date keys.")
    source_lookup = source_index.to_dict(orient="index")
    source_dates_set = set(source_lookup)
    output_dates = pd.to_datetime(dataset["date"])
    target_dates = pd.to_datetime(dataset["target_date"])
    if not ((target_dates - output_dates) == pd.Timedelta(days=1)).all():
        raise AssertionError("A target date is not exactly one calendar day after its feature date.")
    for row in dataset.itertuples(index=False):
        station_id = row.station_id
        feature_date = pd.Timestamp(row.date)
        target_date = pd.Timestamp(row.target_date)
        feature_key = (station_id, feature_date)
        target_key = (station_id, target_date)
        if feature_key not in source_dates_set or target_key not in source_dates_set:
            raise AssertionError("Feature/target date does not map to a source observation.")
        feature_record = source_lookup[feature_key]
        target_record = source_lookup[target_key]
        if target_record["_risk"] != row.target_risk:
            raise AssertionError("Target label does not match the following-day source risk.")
        if (
            feature_key[0] != target_key[0]
            or feature_record["station_name"] != row.station_name
            or target_record["station_name"] != row.station_name
        ):
            raise AssertionError("Station identity changed between feature and target observations.")

        for column in MEASUREMENT_FEATURES:
            if not math.isclose(
                float(getattr(row, column)),
                float(feature_record[column]),
                rel_tol=1e-10,
                abs_tol=1e-10,
            ):
                raise AssertionError(f"{column} is not the current-date source measurement.")
        expected_doy = float(feature_record["doy"])
        expected_sin = math.sin(2 * math.pi * (expected_doy - 1) / 365.25)
        expected_cos = math.cos(2 * math.pi * (expected_doy - 1) / 365.25)
        if not math.isclose(row.doy_sin, expected_sin, abs_tol=1e-10):
            raise AssertionError("doy_sin is not derived from the feature date.")
        if not math.isclose(row.doy_cos, expected_cos, abs_tol=1e-10):
            raise AssertionError("doy_cos is not derived from the feature date.")

        for column in METRICS:
            for lag in (1, 2, 3):
                lag_key = (station_id, feature_date - pd.Timedelta(days=lag))
                expected = (
                    float(source_lookup[lag_key][column])
                    if lag_key in source_dates_set
                    else float("nan")
                )
                actual = float(getattr(row, f"{column}_lag{lag}"))
                if not math.isfinite(expected) or not math.isclose(actual, expected, abs_tol=1e-10):
                    raise AssertionError(f"{column}_lag{lag} does not use exactly T-{lag}.")

        for window in (3, 7):
            keys = [
                (station_id, feature_date - pd.Timedelta(days=offset))
                for offset in range(window - 1, -1, -1)
            ]
            if any(key not in source_dates_set for key in keys):
                raise AssertionError("A rolling feature was emitted without complete calendar history.")
            for column, operation in (
                ("rain", "sum"),
                ("rain", "mean"),
                ("waterlevel", "mean"),
                ("discharge", "mean"),
            ):
                expected_values = [float(source_lookup[key][column]) for key in keys]
                expected = sum(expected_values) if operation == "sum" else sum(expected_values) / window
                actual = float(getattr(row, f"{column}_{operation}_{window}d"))
                if not math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-10):
                    raise AssertionError(
                        f"{column}_{operation}_{window}d includes incorrect dates."
                    )

    # Each station's final observation has no next-calendar-day target and
    # therefore must not occur in the prepared feature-date rows.
    for station_id, group in source.groupby("station_id"):
        final_date = group["date"].max().strftime("%Y-%m-%d")
        if ((dataset["station_id"] == station_id) & (dataset["date"] == final_date)).any():
            raise AssertionError(f"Final observation for {station_id} was not excluded.")

    return {
        "target_alignment": "passed: target is authoritative risk on same station at date + 1 day",
        "current_and_lag_features": "passed: measurements map to current date or exact prior calendar dates",
        "rolling_features": "passed: windows use only complete current/past calendar days",
        "target_and_label_exclusion": "passed: target/risk labels are not input features",
        "station_identity": "passed: target station matches feature station",
        "duplicate_keys": "passed: source and output station/date keys are unique",
        "final_rows": "passed: final observation of each station is excluded",
    }


def _distribution(dataset: pd.DataFrame) -> dict[str, Any]:
    counts = dataset["target_risk"].value_counts().reindex(TARGET_CLASSES, fill_value=0)
    total = len(dataset)
    return {
        "counts": {risk: int(counts[risk]) for risk in TARGET_CLASSES},
        "percentages": {
            risk: (float(counts[risk] / total * 100) if total else 0.0)
            for risk in TARGET_CLASSES
        },
        "earliest_feature_date": dataset["date"].min() if total else None,
        "latest_feature_date": dataset["date"].max() if total else None,
        "target_date_range": {
            "earliest": dataset["target_date"].min() if total else None,
            "latest": dataset["target_date"].max() if total else None,
        },
        "usable_rows_per_station": {
            str(station): int(count)
            for station, count in dataset.groupby("station_id").size().items()
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="rebuild expected data in memory and verify the existing CSV without overwriting it",
    )
    args = parser.parse_args()

    source, expected, report = _build_dataset()
    if args.verify_only:
        if not OUTPUT.is_file():
            raise FileNotFoundError(f"Processed dataset not found: {OUTPUT}")
        dataset = pd.read_csv(OUTPUT, dtype={"station_id": str, "target_risk": str})
        if list(dataset.columns) != list(expected.columns):
            raise AssertionError("Processed CSV columns differ from regenerated expected columns.")
        try:
            pd.testing.assert_frame_equal(
                dataset.reset_index(drop=True),
                expected.reset_index(drop=True),
                check_dtype=False,
                check_exact=False,
                rtol=1e-10,
                atol=1e-10,
            )
        except AssertionError as error:
            raise AssertionError(f"Processed CSV differs from regenerated source data: {error}") from error
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        expected.to_csv(OUTPUT, index=False)
        dataset = pd.read_csv(OUTPUT, dtype={"station_id": str, "target_risk": str})

    report["removed_rows"] = report["original_rows"] - len(dataset)
    report["removed_by_reason"] = {
        "no_next_day_target": sum(
            stats["no_next_day_target"] for stats in report["station_stats"].values()
        ),
        "incomplete_historical_features": sum(
            stats["incomplete_historical_features"]
            for stats in report["station_stats"].values()
        ),
    }
    report["distribution"] = _distribution(dataset)
    report["leakage_checks"] = _check_leakage(source, dataset)
    report["output"] = str(OUTPUT.relative_to(ROOT))
    report["mode"] = "verified existing CSV" if args.verify_only else "created CSV"
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
