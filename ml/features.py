"""Shared historical feature contract and calendar-safe feature engineering."""

from __future__ import annotations

import numpy as np
import pandas as pd


MEASUREMENT_FEATURES = (
    "waterlevel",
    "discharge",
    "T2M",
    "RH2M",
    "PS",
    "WS2M",
    "GWETTOP",
    "GWETROOT",
    "GWETPROF",
    "rain",
    "tmin",
    "tmax",
)
METRICS = ("waterlevel", "discharge", "rain")
RAW_REQUIRED_COLUMNS = ("date", "station_id", *MEASUREMENT_FEATURES)
FEATURE_COLUMNS = (
    *MEASUREMENT_FEATURES,
    "doy_sin",
    "doy_cos",
    "waterlevel_lag1",
    "waterlevel_lag2",
    "waterlevel_lag3",
    "discharge_lag1",
    "discharge_lag2",
    "discharge_lag3",
    "rain_lag1",
    "rain_lag2",
    "rain_lag3",
    "rain_sum_3d",
    "rain_sum_7d",
    "rain_mean_3d",
    "rain_mean_7d",
    "waterlevel_mean_3d",
    "waterlevel_mean_7d",
    "discharge_mean_3d",
    "discharge_mean_7d",
    "station_id",
)
NUMERIC_FEATURES = FEATURE_COLUMNS[:-1]
CATEGORICAL_FEATURES = ("station_id",)


def engineer_daily_features(group: pd.DataFrame) -> pd.DataFrame:
    """Return date-indexed features, leaving unavailable calendar history as NaN."""
    required = {*RAW_REQUIRED_COLUMNS}
    missing = sorted(required - set(group.columns))
    if missing:
        raise ValueError(f"Station history is missing required columns: {missing}")
    if group.empty:
        raise ValueError("Station history cannot be empty.")

    ordered = group.sort_values("date", kind="stable").copy()
    if ordered["date"].isna().any():
        raise ValueError("Station history contains invalid dates.")
    if ordered["date"].duplicated().any():
        raise ValueError("Station history contains duplicate dates.")
    if ordered["station_id"].nunique(dropna=False) != 1:
        raise ValueError("Station history must contain exactly one station_id.")

    station_id = str(ordered["station_id"].iloc[0])
    station_name = ordered["station_name"].iloc[0] if "station_name" in ordered else None
    ordered = ordered.set_index("date")
    daily_index = pd.date_range(ordered.index.min(), ordered.index.max(), freq="D")
    daily = ordered.reindex(daily_index)
    daily.index.name = "date"
    daily["station_id"] = station_id
    daily["station_name"] = station_name

    day_of_year = daily.index.day_of_year
    daily["doy_sin"] = np.sin(2 * np.pi * (day_of_year - 1) / 365.25)
    daily["doy_cos"] = np.cos(2 * np.pi * (day_of_year - 1) / 365.25)
    for column in METRICS:
        for lag in (1, 2, 3):
            daily[f"{column}_lag{lag}"] = daily[column].shift(lag)

    for window in (3, 7):
        daily[f"rain_sum_{window}d"] = daily["rain"].rolling(
            window=window, min_periods=window
        ).sum()
        daily[f"rain_mean_{window}d"] = daily["rain"].rolling(
            window=window, min_periods=window
        ).mean()
        for column in ("waterlevel", "discharge"):
            daily[f"{column}_mean_{window}d"] = daily[column].rolling(
                window=window, min_periods=window
            ).mean()

    return daily
