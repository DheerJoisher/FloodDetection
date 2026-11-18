const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const pool = require('./db.cjs');

const datasetPath = path.resolve(__dirname, '..', 'data', 'raw', 'godavari_dataset_fyp.xlsx');
const batchSize = 500;
const columns = [
  'date',
  'doy',
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
  'station_name',
  'station_id',
];
const insertColumns = columns.map((column) => `\`${column}\``).join(', ');

function toMysqlDate(value, rowNumber) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year
          && date.getUTCMonth() === month - 1
          && date.getUTCDate() === day) {
        return date.toISOString().slice(0, 10);
      }
    }
  }
  throw new Error(`Invalid date in dataset row ${rowNumber}.`);
}

function toNumberOrNull(value, column, rowNumber) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid number for ${column} in dataset row ${rowNumber}.`);
  }
  return number;
}

function toTextOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

async function readDataset() {
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Dataset file not found at ${datasetPath}.`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(datasetPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('The dataset workbook does not contain a worksheet.');

  const headerRow = worksheet.getRow(1);
  const headerIndexes = new Map();
  for (let columnNumber = 1; columnNumber <= headerRow.cellCount; columnNumber++) {
    const header = headerRow.getCell(columnNumber).value;
    if (header !== null && header !== undefined) {
      headerIndexes.set(String(header).trim().toLowerCase(), columnNumber);
    }
  }
  const missingColumns = columns.filter((column) => !headerIndexes.has(column.toLowerCase()));
  if (missingColumns.length > 0) {
    throw new Error(`Dataset is missing required columns: ${missingColumns.join(', ')}.`);
  }

  const records = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (row.actualCellCount === 0) continue;
    const valueFor = (column) => row.getCell(headerIndexes.get(column.toLowerCase())).value;
    const date = toMysqlDate(valueFor('date'), rowNumber);
    const stationId = toTextOrNull(valueFor('station_id'));
    if (!stationId) throw new Error(`Missing station_id in dataset row ${rowNumber}.`);
    records.push([
      date,
      toNumberOrNull(valueFor('doy'), 'doy', rowNumber),
      toNumberOrNull(valueFor('waterlevel'), 'waterlevel', rowNumber),
      toNumberOrNull(valueFor('discharge'), 'discharge', rowNumber),
      toNumberOrNull(valueFor('T2M'), 'T2M', rowNumber),
      toNumberOrNull(valueFor('RH2M'), 'RH2M', rowNumber),
      toNumberOrNull(valueFor('PS'), 'PS', rowNumber),
      toNumberOrNull(valueFor('WS2M'), 'WS2M', rowNumber),
      toNumberOrNull(valueFor('GWETTOP'), 'GWETTOP', rowNumber),
      toNumberOrNull(valueFor('GWETROOT'), 'GWETROOT', rowNumber),
      toNumberOrNull(valueFor('GWETPROF'), 'GWETPROF', rowNumber),
      toNumberOrNull(valueFor('rain'), 'rain', rowNumber),
      toNumberOrNull(valueFor('tmin'), 'tmin', rowNumber),
      toNumberOrNull(valueFor('tmax'), 'tmax', rowNumber),
      toTextOrNull(valueFor('station_name')),
      stationId,
    ]);
  }
  return records;
}

async function importDataset() {
  try {
    const records = await readDataset();
    if (process.argv.includes('--dry-run')) {
      console.log(`Dry run complete: validated ${records.length} dataset records; no rows inserted.`);
      return;
    }
    if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === 'YOUR_MYSQL_PASSWORD') {
      throw new Error('Set your actual DB_PASSWORD in .env.local before running the import.');
    }

    let inserted = 0;
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize);
      const [result] = await pool.query(
        `INSERT IGNORE INTO flood_data (${insertColumns}) VALUES ?`,
        [batch],
      );
      inserted += result.affectedRows;
    }
    console.log(
      `Import complete: ${records.length} rows processed, ${inserted} inserted, `
      + `${records.length - inserted} existing duplicates skipped.`,
    );
  } catch (error) {
    console.error('Dataset import failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importDataset();
