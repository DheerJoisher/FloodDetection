import 'server-only';

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import ExcelJS from 'exceljs';

import { pool } from '@/lib/db';
import type {
  NextDayPredictionProvider,
  NextDayPredictionRequest,
  NextDayPredictionResult,
  PredictionStatus,
} from './prediction-provider';

const executeFile = promisify(execFile);
const projectRoot = process.cwd();
const modelDirectory = resolve(projectRoot, 'ml', 'models');
const predictorScript = resolve(projectRoot, 'ml', 'predict.py');
const observationColumns = [
  'date',
  'station_id',
  'station_name',
  'waterlevel',
  'discharge',
  'T2M',
  'RH2M',
  'PS',
  'WS2M',
  'GWETTOP',
  'GWETROOT',
  'GWETPROF',
  'rain',
  'tmin',
  'tmax',
] as const;

type RawObservation = Record<
  (typeof observationColumns)[number],
  string | number | Date | null
> & { date: string | Date };

function pythonExecutable(): string {
  const configured = process.env.ML_PYTHON_EXECUTABLE?.trim();
  if (configured) return configured;
  return process.platform === 'win32'
    ? resolve(projectRoot, 'ml', '.venv', 'Scripts', 'python.exe')
    : resolve(projectRoot, 'ml', '.venv', 'bin', 'python');
}

function isoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function nextDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function emptyResult(
  request: NextDayPredictionRequest,
  status: PredictionStatus,
  reason: string,
  featureDate: string | null = request.feature_date ?? null,
  stationName: string | null = null,
): NextDayPredictionResult {
  return {
    station_id: request.station_id,
    station_name: stationName,
    feature_date: featureDate,
    predicted_target_date: featureDate ? nextDay(featureDate) : null,
    predicted_risk: null,
    probability_low: null,
    probability_moderate: null,
    probability_high: null,
    prediction_confidence: null,
    prediction_status: status,
    status_reason: reason,
  };
}

async function writeHistoryCsv(path: string, rows: RawObservation[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('history');
  sheet.addRow([...observationColumns]);
  for (const row of rows) {
    sheet.addRow(observationColumns.map((column) => row[column]));
  }
  await workbook.csv.writeFile(path);
}

function cellText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function cellNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readPredictionCsv(path: string): Promise<Array<Record<string, unknown>>> {
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.readFile(path, { dateFormats: [] });
  const rows = sheet.getSheetValues() as unknown[][];
  const headers = rows[1]?.slice(1).map((header) => String(header ?? '')) ?? [];
  if (headers.length === 0) throw new Error('Python predictor returned an empty CSV.');
  return rows.slice(2).filter(Boolean).map((row) => {
    const values = row as unknown[];
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index + 1] ?? null]),
    );
  });
}

function numberField(row: Record<string, unknown>, name: string): number | null {
  return cellNumber(row[name]);
}

function textField(row: Record<string, unknown>, name: string): string | null {
  return cellText(row[name]);
}

async function predictFromHistory(
  request: NextDayPredictionRequest,
  rows: RawObservation[],
  featureDate: string,
): Promise<NextDayPredictionResult> {
  const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), 'godavari-ml-'));
  const inputPath = join(temporaryDirectory, 'history.csv');
  const outputPath = join(temporaryDirectory, 'prediction.csv');
  const reportPath = join(temporaryDirectory, 'report.json');
  try {
    await writeHistoryCsv(inputPath, rows);
    await executeFile(
      pythonExecutable(),
      [
        predictorScript,
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--report',
        reportPath,
        '--model-dir',
        modelDirectory,
      ],
      {
        cwd: projectRoot,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const predictions = await readPredictionCsv(outputPath);
    const matchingRows = predictions.filter(
      (row) => textField(row, 'station_id') === request.station_id
        && textField(row, 'feature_date') === featureDate,
    );
    if (matchingRows.length !== 1) {
      return emptyResult(
        request,
        'INVALID_INPUT',
        'The selected station/date did not produce exactly one prediction row.',
        featureDate,
        rows[rows.length - 1].station_name === null
          ? null
          : String(rows[rows.length - 1].station_name ?? ''),
      );
    }

    const row = matchingRows[0];
    const status = textField(row, 'prediction_status') as PredictionStatus | null;
    if (
      status !== 'PREDICTED'
      && status !== 'INSUFFICIENT_HISTORY'
      && status !== 'INVALID_INPUT'
      && status !== 'UNSUPPORTED_STATION'
    ) {
      throw new Error('Python predictor returned an unsupported prediction status.');
    }
    const risk = textField(row, 'predicted_risk');
    const predictedRisk = risk === 'LOW' || risk === 'MODERATE' || risk === 'HIGH'
      ? risk
      : null;
    return {
      station_id: request.station_id,
      station_name: textField(row, 'station_name'),
      feature_date: textField(row, 'feature_date'),
      predicted_target_date: textField(row, 'predicted_target_date'),
      predicted_risk: predictedRisk,
      probability_low: numberField(row, 'probability_low'),
      probability_moderate: numberField(row, 'probability_moderate'),
      probability_high: numberField(row, 'probability_high'),
      prediction_confidence: numberField(row, 'prediction_confidence'),
      prediction_status: status,
      status_reason: textField(row, 'status_reason') ?? 'Prediction status was not described.',
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export const mlPredictionProvider: NextDayPredictionProvider = {
  async predictNextDay(request) {
    const clauses = ['station_id = ?'];
    const values: string[] = [request.station_id];
    if (request.feature_date) {
      clauses.push('`date` <= ?');
      values.push(request.feature_date);
    }
    const [resultRows] = await pool.execute(
      `SELECT ${observationColumns.map((column) => (
        column === 'date' ? '`date`' : `\`${column}\``
      )).join(', ')}
       FROM flood_data
       WHERE ${clauses.join(' AND ')}
       ORDER BY \`date\` DESC, id DESC
       LIMIT 7`,
      values,
    );
    const rows = (resultRows as RawObservation[]).map((row) => ({
      ...row,
      date: isoDate(row.date),
    }));

    if (rows.length === 0) {
      const [knownRows] = await pool.execute(
        'SELECT station_id FROM flood_data WHERE station_id = ? LIMIT 1',
        [request.station_id],
      );
      if ((knownRows as unknown[]).length === 0) {
        return emptyResult(
          request,
          'UNSUPPORTED_STATION',
          `Station '${request.station_id}' is not present in the flood-data station set.`,
        );
      }
      return emptyResult(
        request,
        'INSUFFICIENT_HISTORY',
        'No station observations are available through the selected feature date.',
      );
    }

    const latestDate = rows[0].date as string;
    const featureDate = request.feature_date ?? latestDate;
    if (request.feature_date && latestDate !== request.feature_date) {
      return emptyResult(
        request,
        'INVALID_INPUT',
        'No observation exists for the selected station on feature_date.',
        request.feature_date,
        rows[0].station_name === null ? null : String(rows[0].station_name),
      );
    }
    const ascendingRows = rows.reverse();
    return predictFromHistory(request, ascendingRows, featureDate);
  },
};
