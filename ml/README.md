# Godavari flood-risk ML pipeline

The project now contains an offline next-day risk-classification pipeline. It
has not been integrated into the Next.js application and is not a production
flood-warning system.

## Environment setup

Python 3.11 is preferred when available. It was not installed on the setup
machine; Python 3.12 was used instead.

From the repository root in PowerShell:

```powershell
py -3.12 -m venv ml/.venv
ml/.venv/Scripts/Activate.ps1
python -m pip install -r ml/requirements.txt
```

The virtual environment, generated model artifacts, generated outputs, and
processed/features datasets are excluded by the repository `.gitignore`.
The original workbook remains at `data/raw/godavari_dataset_fyp.xlsx`.

## Dataset representation

The source is an Excel workbook with one observation per date and station. The
workbook contains the original meteorological and hydrological fields, including
`date`, `doy`, `waterlevel`, `discharge`, `T2M`, `RH2M`, `PS`, `WS2M`,
`GWETTOP`, `GWETROOT`, `GWETPROF`, `rain`, `tmin`, `tmax`, `station_name`, and
`station_id`. The existing API returns these readings and computes
`risk_level` at request time; that label is not an additional source-workbook
column.

The workbook inspection found one sheet (`Sheet1`) with 34,110 rows and 16
columns. Each of the 15 stations has 2,274 observations, covering
2019-12-01 through 2026-02-20. There are no missing cells or exact duplicate
rows. Pandas reads `date` as datetime, `doy` as integer, the 12 measurement
columns as floating point, and station name/id as strings.

## Prediction problem and target construction

The task is a **next-day flood-risk classifier** for each station. The feature
date is T, and `target_risk` is the authoritative rule-based risk class for the
same station on the next calendar date, T+1. The preparation script calls
`src/lib/risk-level.js` through Node.js to derive daily labels; it does not
reimplement its thresholds. The target-day measurements are used only to
derive the label and never appear as inputs.

The source is sorted independently by station and date, then reindexed to a
daily calendar before shifts and rolling features are calculated. A target is
kept only if the next calendar day's observation exists. A gap is never treated
as a one-day step. The feature formulas are shared by dataset preparation and
standalone inference in `ml/features.py`.

## Selected features

The generated CSV's model inputs are exactly:

- Current-date readings: `waterlevel`, `discharge`, `T2M`, `RH2M`, `PS`,
  `WS2M`, `GWETTOP`, `GWETROOT`, `GWETPROF`, `rain`, `tmin`, `tmax`.
- Seasonal encoding: `doy_sin`, `doy_cos`, calculated from the feature date
  using a 365.25-day cycle. The raw integer `doy` is not included because an
  integer does not represent the year-end/year-start transition cyclically.
- Three daily lags each: `waterlevel_lag1..3`, `discharge_lag1..3`, and
  `rain_lag1..3`. Lag 1 is T-1, not the next available observation across a
  date gap.
- Trailing rolling features, including T and no future rows: `rain_sum_3d`,
  `rain_sum_7d`, `rain_mean_3d`, `rain_mean_7d`,
  `waterlevel_mean_3d`, `waterlevel_mean_7d`,
  `discharge_mean_3d`, `discharge_mean_7d`. Every window requires all
  corresponding calendar days; rolling windows are not centered.
- `station_id` as the station categorical feature. `station_name` is retained
  only as metadata to avoid duplicating station identity.

The CSV also stores `date` and `target_date` for auditability; these are not
model inputs. `target_risk` is the label and is not an input.

## Preparation results

Run the reproducible builder and its separate no-write verification mode from
the repository root:

```powershell
ml/.venv/Scripts/python.exe ml/data/prepare_dataset.py
ml/.venv/Scripts/python.exe ml/data/prepare_dataset.py --verify-only
```

The source workbook had 34,110 rows. The generated
`ml/data/processed/next_day_risk_dataset.csv` contains **34,005 usable rows**:

- 15 rows excluded because each station's final observation has no next-day
  target.
- 90 rows excluded because the first six dates per station lack complete
  seven-day historical windows.
- No other rows were removed.

Each station contributes 2,267 usable rows. The feature-date range is
2019-12-07 through 2026-02-19; target dates range from 2019-12-08 through
2026-02-20. No date gaps were found in any station's source observations.

Natural target distribution (not balanced or resampled):

| Target | Rows | Percent |
| --- | ---: | ---: |
| LOW | 28,985 | 85.2375% |
| MODERATE | 408 | 1.1998% |
| HIGH | 4,612 | 13.5627% |

Example alignment: for a station's source row on 2020-01-01, features are
derived from 2020-01-01 and earlier dates, `date` is 2020-01-01,
`target_date` is 2020-01-02, and `target_risk` is the rule-derived risk of that
same station's 2020-01-02 observation.

The script executes checks for unique station/date keys, exact next-calendar-
day target alignment and station identity, authoritative target-label matching,
current-date feature values, exact-date lag values, trailing current/past
rolling windows, exclusion of target labels/dates from inputs, and omission of
each station's final source observation. The `--verify-only` mode rebuilds the
expected result in memory and compares it with the existing CSV without
overwriting the file.

## Chronological model training

Run the complete reproducible pipeline from the repository root:

```powershell
ml/.venv/Scripts/python.exe ml/train.py
```

The script splits **unique feature dates**, keeping all station rows for a date
in the same partition. The observed dataset has 2,267 feature dates:

| Split | Feature-date range | Target-date range | Dates | Rows | LOW | MODERATE | HIGH |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Train | 2019-12-07–2024-04-09 | 2019-12-08–2024-04-10 | 1,586 | 23,790 | 20,274 | 277 | 3,239 |
| Validation | 2024-04-10–2025-03-15 | 2024-04-11–2025-03-16 | 340 | 5,100 | 4,354 | 59 | 687 |
| Test | 2025-03-16–2026-02-19 | 2025-03-17–2026-02-20 | 341 | 5,115 | 4,357 | 72 | 686 |

Validation macro-F1 selects the MLP epoch; the latest test period is not used
for model selection. The training run evaluates the fixed final baselines and
MLP on test once and saves those results. `ml/evaluate.py` loads the saved model
and preprocessing without retraining; it defaults to validation. Only
explicitly run `--split test` if a new test evaluation is intentionally wanted.

## Preprocessing and models

The `ColumnTransformer` fits `StandardScaler` on the 31 numeric features and
`OneHotEncoder(handle_unknown="ignore")` on `station_id` using training data
only. This produced 46 transformed input columns. Validation and test are
transformed with that saved preprocessor. The class weights below are computed
from the training labels only:

| Class | Weight |
| --- | ---: |
| LOW | 0.391141 |
| MODERATE | 28.628159 |
| HIGH | 2.448287 |

Two baselines are evaluated: a constant training-majority classifier (LOW),
and a fixed 300-tree `RandomForestClassifier` with `max_features="sqrt"`,
`min_samples_leaf=2`, and `class_weight="balanced_subsample"`.

The MLP is a compact tabular classifier:

```text
Input(46) → Dense(64, ReLU) → Dropout(0.25)
          → Dense(32, ReLU) → Dropout(0.15)
          → Dense(3, Softmax)
```

Training uses Adam (`0.001`), sparse categorical cross-entropy, seed 42, batch
size 256, and up to 100 epochs. Early stopping monitors validation macro-F1
(not accuracy), patience 12, and restores best weights. It stopped after 67
epochs and restored epoch 55, whose validation macro-F1 was 0.69705.

## Measured validation and test results

Metrics are calculated with class order LOW, MODERATE, HIGH; undefined
per-class metrics are set to zero. Test scores are from the single final
evaluation in `train.py`.

| Model | Accuracy | Balanced accuracy | Macro F1 | Weighted F1 | LOW F1 | MODERATE F1 | HIGH F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Majority baseline | 0.8518 | 0.3333 | 0.3067 | 0.7836 | 0.9200 | 0.0000 | 0.0000 |
| Random Forest | 0.9848 | 0.6782 | 0.6877 | 0.9790 | 0.9911 | 0.0750 | 0.9971 |
| MLP | 0.8665 | 0.8687 | 0.6839 | 0.9158 | 0.9159 | 0.1387 | 0.9971 |

MLP test details (5,115 rows; feature dates 2025-03-16–2026-02-19):

| Class | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| LOW | 0.9954 | 0.8481 | 0.9159 | 4,357 |
| MODERATE | 0.0763 | 0.7639 | 0.1387 | 72 |
| HIGH | 1.0000 | 0.9942 | 0.9971 | 686 |

Overall MLP test metrics: accuracy **0.8665**, balanced accuracy **0.8687**,
macro precision **0.6906**, macro recall **0.8687**, macro F1 **0.6839**, and
weighted F1 **0.9158**. Its test confusion matrix (actual rows, predicted
columns, LOW/MODERATE/HIGH) is:

```text
[[3695, 662,   0],
 [  17,  55,   0],
 [   0,   4, 682]]
```

The MLP's macro F1 is slightly below the Random Forest's (0.6839 vs. 0.6877),
while its balanced accuracy and MODERATE recall/F1 are higher. Thus it
outperformed the majority baseline on minority-class detection, but did not
universally outperform the Random Forest; it makes a clear precision/recall
tradeoff for MODERATE predictions.

## Saved artifacts

Generated files are excluded from Git:

- `ml/models/flood_risk_mlp.keras` — trained MLP.
- `ml/models/flood_risk_preprocessor.joblib` — train-fitted scaler and encoder.
- `ml/models/flood_risk_random_forest.joblib` — fitted baseline.
- `ml/models/flood_risk_feature_metadata.json` and
  `ml/models/flood_risk_class_mapping.json` — feature and label contracts.
- `ml/outputs/chronological_split_manifest.json` — exact split boundaries/counts.
- `ml/outputs/mlp_training_history.json`, `.csv`, and `.png`.
- `ml/outputs/validation_metrics.json` and `ml/outputs/test_metrics.json`.
- `ml/outputs/test_classification_report.json`.
- `ml/outputs/model_comparison_validation.csv` and
  `ml/outputs/model_comparison_test.csv`.
- `ml/outputs/mlp_test_confusion_matrix.csv` and `.png`.
- `ml/outputs/training_summary.json`.

`ml/evaluate.py` evaluates the saved MLP and does not retrain it:

```powershell
ml/.venv/Scripts/python.exe ml/evaluate.py --split validation
```

The test set contains only 72 MODERATE targets; the MLP's MODERATE precision
is low despite higher recall than the Random Forest. Labels are derived from
existing academic thresholds, so these results do not establish official
warning capability or prove operational forecasting skill. Further
time-separated validation and domain review are needed before any integration.
No model has been integrated into Next.js.

## Existing rule-based labels

The current application calculates an academic label from water level,
discharge, and rain. These are configurable environment variables; the
implemented defaults are:

| Measure | Moderate (`>=`) | High (`>=`) |
| --- | ---: | ---: |
| Water level | 700 | 800 |
| Discharge | 1000 | 4000 |
| Rain | 50 | 100 |

Any reached high threshold produces `HIGH`. Otherwise, any reached moderate
threshold produces `MODERATE`; otherwise the result is `LOW`. Null or
non-finite values do not reach a threshold. These are academic demonstration
thresholds, **not official government flood-warning thresholds**. A future
classifier must not silently change these existing rules.

## Validation error analysis and controlled improvement study

The original MLP was analyzed on the validation partition only (5,100 rows,
feature dates 2024-04-10–2025-03-15; 4,354 LOW, 59 MODERATE, 687 HIGH). The
chronological split helper regenerated the split manifest, including test
date/class-count metadata, but only training and validation rows were used for
fitting and scoring; no test predictions or test metrics informed selection.
The candidate was selected before its one-time final test inference.

### Original MLP validation errors

The original model predicted 3,918 LOW, 501 MODERATE, and 681 HIGH rows. Of
its 501 MODERATE predictions, 451 were actually LOW, 43 MODERATE, and 7 HIGH.
Thus false MODERATE predictions were predominantly LOW. For actual MODERATE
rows, mean probabilities were 0.337 for LOW, 0.651 for MODERATE, and 0.012
for HIGH (the median MODERATE probability was 0.777). The original model's
MODERATE probability on LOW false positives averaged 0.723. Overall, correct
predictions had mean confidence 0.958, versus 0.727 for incorrect predictions;
the latter is still high enough to caution against treating probabilities as
calibrated risk estimates.

Feature distributions show substantial LOW/MODERATE overlap in water level:
their current water-level medians were 173.24 and 149.29, and their
interquartile ranges were 123.93–348.93 and 121.95–340.37. The seven-day
water-level mean medians were similarly close (173.23 versus 148.21).
Discharge and rainfall histories were more informative but still overlap:
current discharge medians were 5.41 versus 46.44, current-rain medians 0
versus 23.73, and seven-day rainfall-sum medians 5.45 versus 101.77 for LOW
and MODERATE respectively.

For the 59 validation MODERATE targets, 57 met the existing moderate rainfall
band and 4 met the moderate discharge band; none met the water-level moderate
threshold, and none reached a HIGH threshold. These counts can overlap. The
rule-derived MODERATE examples therefore often represent next-day rainfall
events that are difficult to infer from same-day water-level measurements.
The thresholds and target definition were not changed.

### Validation experiments and decision policy

The original model used training-derived weights LOW 0.3911, MODERATE 28.6282,
HIGH 2.4483. All experiments reused the training-fitted preprocessor and used
the same train/validation date split. B used the square roots of the original
balanced weights, normalized to mean 1. C used a compact 48/24 hidden-layer
architecture. Early stopping monitored validation macro-F1.

| Experiment | Validation accuracy | Balanced accuracy | Macro F1 | MODERATE precision | MODERATE recall | MODERATE F1 | HIGH recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A — Original MLP; 67 epochs, best epoch 55 | 0.9069 | 0.8716 | 0.6970 | 0.0858 | 0.7288 | 0.1536 | 0.9898 |
| B — Square-root weights; 22 epochs, best epoch 10 | 0.9843 | 0.7737 | 0.7779 | 0.3571 | 0.3390 | 0.3478 | 0.9898 |
| C — 48/24 architecture; 56 epochs, best epoch 44 | 0.8880 | 0.8754 | 0.6874 | 0.0749 | 0.7627 | 0.1364 | 0.9898 |

B used class weights LOW 0.2488, MODERATE 2.1287, HIGH 0.6225. It raised
validation MODERATE precision and F1 substantially while preserving HIGH
recall; MODERATE recall decreased from A, so the change is a deliberate
precision/recall tradeoff rather than an across-the-board gain.

For a decision-policy-only experiment, the original MLP's MODERATE probability
threshold was varied while preserving any HIGH argmax prediction as HIGH:

| MODERATE threshold | Accuracy | Balanced accuracy | Macro F1 | MODERATE precision | MODERATE recall | MODERATE F1 | HIGH recall |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.20 | 0.8388 | 0.8841 | 0.6666 | 0.0580 | 0.8475 | 0.1086 | 0.9898 |
| 0.30 | 0.8661 | 0.8891 | 0.6786 | 0.0680 | 0.8305 | 0.1256 | 0.9898 |
| 0.40 | 0.8882 | 0.8922 | 0.6899 | 0.0792 | 0.8136 | 0.1444 | 0.9898 |
| 0.50 | 0.9073 | 0.8718 | 0.6973 | 0.0862 | 0.7288 | 0.1541 | 0.9898 |
| 0.60 | 0.9267 | 0.8626 | 0.7090 | 0.1015 | 0.6780 | 0.1766 | 0.9898 |
| 0.70 | 0.9457 | 0.8422 | 0.7217 | 0.1224 | 0.5932 | 0.2029 | 0.9898 |
| 0.80 | 0.9625 | 0.7986 | 0.7297 | 0.1436 | 0.4407 | 0.2167 | 0.9898 |

The 0.80 threshold had the best MODERATE F1 among these policy settings, but
did not match experiment B's MODERATE F1 or macro-F1.

### Candidate selection and one-time final test

Experiment B was selected using validation metrics: among candidates retaining
at least 0.98 HIGH recall and macro-F1 within 0.02 of the original, it had the
highest MODERATE F1. Its validation MODERATE F1 was 0.3478 versus 0.1536 for
the original MLP; macro-F1 was 0.7779 versus 0.6970. Only after that selection,
B was evaluated once on the final 5,115-row test period (feature dates
2025-03-16–2026-02-19; target dates 2025-03-17–2026-02-20; 4,357 LOW,
72 MODERATE, 686 HIGH). Original MLP and Random Forest scores below are the
already-saved test metrics; those models were not reevaluated.

| Model | Accuracy | Balanced accuracy | Macro precision | Macro recall | Macro F1 | Weighted F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Random Forest | 0.9848 | 0.6782 | 0.7862 | 0.6782 | 0.6877 | 0.9790 |
| Original MLP | 0.8665 | 0.8687 | 0.6906 | 0.8687 | 0.6839 | 0.9158 |
| Selected MLP v2 | 0.9656 | 0.7481 | 0.7097 | 0.7481 | 0.7215 | 0.9709 |

Per-class test precision/recall/F1:

| Model | LOW | MODERATE | HIGH |
| --- | --- | --- | --- |
| Random Forest | 0.9835 / 0.9989 / 0.9911 | 0.3750 / 0.0417 / 0.0750 | 1.0000 / 0.9942 / 0.9971 |
| Original MLP | 0.9954 / 0.8481 / 0.9159 | 0.0763 / 0.7639 / 0.1387 | 1.0000 / 0.9942 / 0.9971 |
| Selected MLP v2 | 0.9872 / 0.9725 / 0.9798 | 0.1418 / 0.2778 / 0.1878 | 1.0000 / 0.9942 / 0.9971 |

Selected MLP v2 confusion matrix (actual rows, predicted columns, class order
LOW/MODERATE/HIGH):

```text
[[4237, 120,   0],
 [  52,  20,   0],
 [   3,   1, 682]]
```

The test MODERATE F1 improved modestly over both the original MLP and Random
Forest, and macro-F1 improved over both. However, MODERATE recall fell from
0.7639 to 0.2778 versus the original MLP, balanced accuracy fell from 0.8687
to 0.7481, and MODERATE precision remains low. HIGH recall was unchanged at
0.9942. Overall this is a **small improvement with a notable recall tradeoff**,
not a decisive or production-ready result.

### Error-analysis artifacts and limitations

The study's generated diagnostic plots, probability summaries, reports, and
validation metrics are in `ml/outputs/error_analysis/`. The versioned candidate
and exact preprocessing/class metadata are saved separately:

- `ml/models/flood_risk_mlp_v2.keras`
- `ml/models/flood_risk_preprocessor_v2.joblib`
- `ml/models/flood_risk_feature_metadata_v2.json`
- `ml/models/flood_risk_class_mapping_v2.json`
- `ml/models/flood_risk_mlp_v2_metadata.json`
- `ml/outputs/error_analysis/selected_candidate.json`
- `ml/outputs/error_analysis/validation_experiments.json`
- `ml/outputs/error_analysis/validation_experiment_comparison.csv`
- `ml/outputs/error_analysis/validation_classification_reports.json`
- `ml/outputs/error_analysis/validation_confusion_matrices.json` and
  `validation_confusion_matrices.png`
- `ml/outputs/error_analysis/validation_probability_analysis.json`,
  `validation_mlp_probabilities.csv`, and
  `validation_probabilities_by_actual_class.png`
- `ml/outputs/error_analysis/validation_feature_distributions.json`,
  `validation_features_by_target.png`, and
  `validation_target_measurements_thresholds.png`
- `ml/outputs/error_analysis/final_test_comparison.json`,
  `final_test_comparison.csv`, and `final_test_confusion_matrix.png`

The test set contains only 72 MODERATE cases, so its estimates are uncertain.
The improvement is limited, LOW/MODERATE feature overlap remains, and
rule-derived next-day labels do not establish operational warning skill.
These results warrant more time-separated data and domain review before any
application integration. No model has been integrated into Next.js.

## Standalone inference on unlabeled files

Run the V2 predictor from the repository root:

```powershell
ml\.venv\Scripts\python.exe ml\predict.py `
  --input ml\data\sample_unlabeled_input.csv `
  --output ml\outputs\sample_predictions.csv
```

The script selects CSV or XLSX loading from the input extension. It writes a
JSON status/gap report next to the CSV by default; `--report` changes its path,
and `--model-dir` selects a directory containing the matching V2 artifacts.
The default model directory is `ml/models/`.

Required raw columns are `date`, `station_id`, `waterlevel`, `discharge`,
`T2M`, `RH2M`, `PS`, `WS2M`, `GWETTOP`, `GWETROOT`, `GWETPROF`, `rain`,
`tmin`, and `tmax`. `station_name` is optional and is preserved as metadata.
`doy` is derived from `date`. `target_risk`, `target_date`, and other extra
columns are neither required nor used; target-only columns are omitted from
the prediction output.

**A future prediction for T+1 requires the necessary current and historical
observations through T.** The current features need seven consecutive daily
observations for the station (T and T-1 through T-6), because the trained
feature set includes trailing seven-day windows. A single isolated future row
is insufficient. The predictor never fills missing history from later dates.
Rows without complete history receive `INSUFFICIENT_HISTORY`; each skipped row
has a reason in the output CSV and JSON report. Duplicate station/date rows
and malformed row values receive `INVALID_INPUT`. Date gaps are listed by
station with missing dates and affected feature/target dates; rows whose
required windows cross a gap are not predicted until the full seven-day
history is again available.

Supported `station_id` values are read from the saved one-hot encoder.
Unknown stations receive `UNSUPPORTED_STATION`; they are not silently encoded
as a known station even though the saved encoder can ignore unknown categories.

The output includes station metadata, `feature_date`,
`predicted_target_date` (= T+1), the raw measurements, `predicted_risk`,
`probability_low`, `probability_moderate`, `probability_high`,
`prediction_confidence`, `prediction_status`, and `status_reason`. Only
`PREDICTED` rows have risk probabilities. The decision policy is the V2
softmax argmax; the experimental 0.80 MODERATE threshold is not applied.
`prediction_confidence` is the maximum class probability, **not a calibrated
probability of correctness or a guarantee**.

The V2 model, matching preprocessor, feature metadata, and class mapping are
loaded from saved files. Prediction calls only the preprocessor's
`transform`; it never refits scaling or encoding on input data.

The small `ml/data/sample_unlabeled_input.csv` contains 28 raw rows for two
stations and no target columns. Its execution produced 16 predictions and 12
`INSUFFICIENT_HISTORY` rows (the first six dates for each station); there were
no invalid rows, unsupported stations, or date gaps. Post-hoc only, the 16
predicted classes were compared with the historical labels in the processed
dataset, and all 16 matched. Those labels are not part of the prediction
input or algorithm, and this small historical check is not an estimate of
generalization performance.
