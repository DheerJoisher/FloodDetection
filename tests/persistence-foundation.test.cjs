const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'data', 'station-metadata.json'), 'utf8'),
);

test('station metadata is canonical and one row exists per configured station', () => {
  assert.equal(metadata.length, 15);
  const ids = metadata.map((station) => station.station_id);
  assert.equal(new Set(ids).size, 15);
  const allamvari = metadata.find((station) => station.station_id === 'Station 11');
  assert.equal(allamvari.canonical_station_name, 'Allamvari Ghanpur');
  assert.equal(allamvari.tributary, 'Jampannavagu');
  assert.equal(allamvari.cwc_site_code, 'CW1GDL001209');
  assert.notEqual(allamvari.tributary, 'Peddavagu');
});

test('station metadata mapping preserves original dataset names', () => {
  for (const station of metadata) {
    assert.equal(typeof station.station_id, 'string');
    assert.equal(typeof station.dataset_station_name, 'string');
  }
  assert.equal(
    metadata.find((station) => station.station_id === 'Station 15').dataset_station_name,
    'Potteru (potteruvagu)',
  );
});

test('database setup contains idempotent prediction and metadata structures', () => {
  const setup = fs.readFileSync(path.join(root, 'scripts', 'setupDb.cjs'), 'utf8');
  assert.match(setup, /CREATE TABLE IF NOT EXISTS station_metadata/);
  assert.match(setup, /CREATE TABLE IF NOT EXISTS station_predictions/);
  assert.match(setup, /UNIQUE KEY uq_station_prediction_run/);
  assert.match(setup, /INSERT INTO station_metadata/);
  assert.match(setup, /ON DUPLICATE KEY UPDATE/);
});

test('prediction orchestrator has no hardcoded 2026-02-20 value', () => {
  const orchestrator = fs.readFileSync(
    path.join(root, 'src', 'services', 'prediction-orchestrator.ts'),
    'utf8',
  );
  assert.doesNotMatch(orchestrator, /2026-02-20/);
  assert.match(orchestrator, /MAX\(`date`\) AS latest_date/);
  assert.match(orchestrator, /MODEL_VERSION = 'flood_risk_mlp_v2\.keras'/);
});

test('persisted probabilities are numeric and match the argmax contract', () => {
  const classes = ['LOW', 'MODERATE', 'HIGH'];
  const probabilities = [0.9981339573860168, 0.0015924590406939387, 0.0002736643946263939];
  assert.ok(probabilities.every((value) => typeof value === 'number'));
  assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
  const argmaxIndex = probabilities.indexOf(Math.max(...probabilities));
  assert.equal(classes[argmaxIndex], 'LOW');
});
