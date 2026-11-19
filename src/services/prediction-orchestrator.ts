import 'server-only';

import fs from 'node:fs';
import path from 'node:path';

import { pool } from '@/lib/db';
import type { NextDayPredictionProvider, NextDayPredictionResult } from './prediction-provider';
import { mlPredictionProvider } from './ml-prediction-provider';

export const MODEL_VERSION = 'flood_risk_mlp_v2.keras';

export interface PredictionExecutionSummary {
  latest_observation_date: string;
  total_configured_stations: number;
  eligible_stations: number;
  successfully_predicted_stations: number;
  insufficient_history_stations: number;
  data_gap_stations: number;
  unsupported_error_stations: number;
  results: NextDayPredictionResult[];
}

function readConfiguredStations(): Array<{
  station_id: string;
  dataset_station_name: string;
}> {
  const metadataPath = path.resolve(process.cwd(), 'src', 'data', 'station-metadata.json');
  return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Array<{
    station_id: string;
    dataset_station_name: string;
  }>;
}

function dataCoverage(status: string): string {
  if (status === 'PREDICTED') return 'seven_consecutive_observations';
  if (status === 'INSUFFICIENT_HISTORY') return 'insufficient_history';
  if (status === 'INVALID_INPUT') return 'invalid_or_date_gap';
  if (status === 'UNSUPPORTED_STATION') return 'unsupported_station';
  return 'provider_error';
}

export async function runStationPredictionOrchestration(
  provider: NextDayPredictionProvider = mlPredictionProvider,
): Promise<PredictionExecutionSummary> {
  const [latestRows] = await pool.execute(
    'SELECT MAX(`date`) AS latest_date FROM flood_data',
  );
  const latestRow = (latestRows as Array<{ latest_date: string | null }>)[0];
  if (!latestRow?.latest_date) {
    throw new Error('No observation data exists; automatic predictions cannot run.');
  }
  const latestObservationDate = String(latestRow.latest_date).slice(0, 10);

  const stations = readConfiguredStations();
  const results: NextDayPredictionResult[] = [];
  let eligible = 0;
  let predicted = 0;
  let insufficient = 0;
  let gaps = 0;
  let unsupportedOrError = 0;

  for (const station of stations) {
    const [historyRows] = await pool.execute(
      `SELECT \`date\`
       FROM flood_data
       WHERE station_id = ? AND \`date\` <= ?
       ORDER BY \`date\` DESC
       LIMIT 7`,
      [station.station_id, latestObservationDate],
    );
    const dates = (historyRows as Array<{ date: string }>).map((row) =>
      String(row.date).slice(0, 10),
    );
    const hasSevenConsecutive = dates.length === 7
      && Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${latestObservationDate}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() - index);
        return date.toISOString().slice(0, 10);
      }).every((date) => dates.includes(date));

    let result: NextDayPredictionResult;
    if (hasSevenConsecutive) {
      eligible += 1;
      try {
        result = await provider.predictNextDay({
          station_id: station.station_id,
          feature_date: latestObservationDate,
        });
      } catch (error) {
        console.error(`Prediction failed for ${station.station_id}:`, error);
        result = {
          station_id: station.station_id,
          station_name: station.dataset_station_name,
          feature_date: latestObservationDate,
          predicted_target_date: null,
          predicted_risk: null,
          probability_low: null,
          probability_moderate: null,
          probability_high: null,
          prediction_confidence: null,
          prediction_status: 'INVALID_INPUT',
          status_reason: 'Model inference failed or returned an invalid result.',
        };
      }
    } else {
      const reason = dates.length < 7
        ? 'Insufficient history: fewer than seven station observations are available.'
        : 'Data gap: seven observations exist but the consecutive seven-day window is incomplete.';
      result = {
        station_id: station.station_id,
        station_name: station.dataset_station_name,
        feature_date: latestObservationDate,
        predicted_target_date: null,
        predicted_risk: null,
        probability_low: null,
        probability_moderate: null,
        probability_high: null,
        prediction_confidence: null,
        prediction_status: 'INSUFFICIENT_HISTORY',
        status_reason: reason,
      };
    }

    results.push(result);
    if (result.prediction_status === 'PREDICTED') predicted += 1;
    else if (result.prediction_status === 'INSUFFICIENT_HISTORY') {
      const gap = dates.length >= 7;
      if (gap) gaps += 1;
      else insufficient += 1;
    } else unsupportedOrError += 1;

    const coverage = dataCoverage(result.prediction_status);
    await pool.execute(
      `INSERT INTO station_predictions (
        station_id, feature_date, target_date, predicted_class,
        probability_low, probability_moderate, probability_high, confidence,
        prediction_status, model_version, input_latest_observation_date,
        data_coverage, status_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        target_date = VALUES(target_date),
        predicted_class = VALUES(predicted_class),
        probability_low = VALUES(probability_low),
        probability_moderate = VALUES(probability_moderate),
        probability_high = VALUES(probability_high),
        confidence = VALUES(confidence),
        prediction_status = VALUES(prediction_status),
        input_latest_observation_date = VALUES(input_latest_observation_date),
        data_coverage = VALUES(data_coverage),
        status_reason = VALUES(status_reason),
        generated_at = CURRENT_TIMESTAMP`,
      [
        station.station_id,
        latestObservationDate,
        result.predicted_target_date,
        result.predicted_risk,
        result.probability_low,
        result.probability_moderate,
        result.probability_high,
        result.prediction_confidence,
        result.prediction_status,
        MODEL_VERSION,
        latestObservationDate,
        coverage,
        result.status_reason,
      ],
    );
  }

  return {
    latest_observation_date: latestObservationDate,
    total_configured_stations: stations.length,
    eligible_stations: eligible,
    successfully_predicted_stations: predicted,
    insufficient_history_stations: insufficient,
    data_gap_stations: gaps,
    unsupported_error_stations: unsupportedOrError,
    results,
  };
}
