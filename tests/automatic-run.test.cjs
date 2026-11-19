const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('setup defines prediction run audit and project alert event tables', () => {
  const setup = fs.readFileSync(path.join(root, 'scripts', 'setupDb.cjs'), 'utf8');
  assert.match(setup, /CREATE TABLE IF NOT EXISTS prediction_runs/);
  assert.match(setup, /CREATE TABLE IF NOT EXISTS project_alert_events/);
  assert.match(setup, /CREATE TABLE IF NOT EXISTS project_alert_transitions/);
  assert.match(setup, /uq_prediction_run_feature_model/);
  assert.match(setup, /uq_project_alert_identity/);
});

test('automatic run has dynamic MAX(date) discovery and target-date derivation', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'services', 'flood-monitor-orchestrator.ts'),
    'utf8',
  );
  assert.match(source, /MAX\(`date`\)/);
  assert.doesNotMatch(source, /2026-02-20|2026-02-21/);
  assert.match(source, /nextDate\(featureDate\)/);
});

test('automatic run endpoint protects internal and admin execution', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'app', 'api', 'predictions', 'run-automatic', 'route.ts'),
    'utf8',
  );
  assert.match(source, /AUTOMATIC_RUN_SECRET/);
  assert.match(source, /verifyBearerToken/);
  assert.match(source, /Administrator authorization is required/);
});

test('dashboard reads do not execute prediction orchestration', () => {
  const latestRoute = fs.readFileSync(
    path.join(root, 'src', 'app', 'api', 'predictions', 'runs', 'latest', 'route.ts'),
    'utf8',
  );
  const activeAlerts = fs.readFileSync(
    path.join(root, 'src', 'app', 'api', 'alerts', 'active', 'route.ts'),
    'utf8',
  );
  assert.doesNotMatch(latestRoute, /runFloodMonitorAutomatically|runStationPredictionOrchestration/);
  assert.doesNotMatch(activeAlerts, /runFloodMonitorAutomatically|runStationPredictionOrchestration/);
});

test('run and alert duplicates are prevented by database uniqueness', () => {
  const setup = fs.readFileSync(path.join(root, 'scripts', 'setupDb.cjs'), 'utf8');
  assert.match(setup, /UNIQUE KEY uq_prediction_run_feature_model/);
  assert.match(setup, /UNIQUE KEY uq_project_alert_identity/);
  assert.match(setup, /UNIQUE KEY uq_station_prediction_run/);
});

test('orchestrator records partial and failed run statuses', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'services', 'flood-monitor-orchestrator.ts'),
    'utf8',
  );
  assert.match(source, /'COMPLETED'/);
  assert.match(source, /'PARTIAL'/);
  assert.match(source, /'FAILED'/);
  assert.match(source, /status = 'FAILED'/);
});

test('stale RUNNING runs are reclaimed while current runs remain exclusive', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'services', 'flood-monitor-orchestrator.ts'),
    'utf8',
  );
  assert.match(source, /STALE_RUN_TIMEOUT_MINUTES/);
  assert.match(source, /TIMESTAMPDIFF\(MINUTE, started_at, CURRENT_TIMESTAMP\)/);
  assert.match(source, /Recovered an interrupted stale run before retrying/);
  assert.match(source, /AND status = 'RUNNING'/);
});
