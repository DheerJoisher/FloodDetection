const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('dashboard uses Leaflet React integration and client-only loading', () => {
  const component = fs.readFileSync(
    path.join(root, 'src', 'components', 'flood-monitor-app.tsx'),
    'utf8',
  );
  assert.match(component, /godavari-risk-map/);
  assert.match(component, /ssr:\s*false/);
  assert.doesNotMatch(component, /run-automatic/);
});

test('GIS map uses persisted station fields and textual risk labels', () => {
  const map = fs.readFileSync(
    path.join(root, 'src', 'components', 'godavari-risk-map.tsx'),
    'utf8',
  );
  assert.match(map, /predicted_class/);
  assert.match(map, /probability_low/);
  assert.match(map, /probability_moderate/);
  assert.match(map, /probability_high/);
  assert.match(map, /INSUFFICIENT \/ UNKNOWN/);
  assert.doesNotMatch(map, /Polyline|PolyLine|river line|basin polygon/i);
});

test('dashboard loads persisted cumulative, regional, alert and prediction APIs', () => {
  const client = fs.readFileSync(
    path.join(root, 'src', 'lib', 'api-client.ts'),
    'utf8',
  );
  assert.match(client, /cumulativeRisk/);
  assert.match(client, /regionalImpact/);
  assert.match(client, /activeAlerts/);
  assert.match(client, /persistedPredictions/);
  assert.match(client, /latestPredictionRun/);
});

test('dashboard communicates partial coverage and official warning disclaimer', () => {
  const dashboard = fs.readFileSync(
    path.join(root, 'src', 'components', 'flood-monitor-app.tsx'),
    'utf8',
  );
  assert.match(dashboard, /Geographic coverage/);
  assert.match(dashboard, /unrepresented_basin_states/);
  assert.match(dashboard, /not an official flood warning/);
  assert.match(dashboard, /CWC, NDMA\/SACHET/);
});

test('dashboard surfaces persisted alert, hydrology, and keyboard station evidence', () => {
  const dashboard = fs.readFileSync(
    path.join(root, 'src', 'components', 'flood-monitor-app.tsx'),
    'utf8',
  );
  assert.match(dashboard, /Active project early-warning evidence/);
  assert.match(dashboard, /Hydrological context/);
  assert.match(dashboard, /station-evidence-button/);
  assert.match(dashboard, /Promise\.allSettled/);
});

test('station map presents dates and prediction status without fabricated geometry', () => {
  const map = fs.readFileSync(
    path.join(root, 'src', 'components', 'godavari-risk-map.tsx'),
    'utf8',
  );
  assert.match(map, /Prediction status/);
  assert.match(map, /Feature date/);
  assert.match(map, /Station points only/);
});

test('map fixture includes no directional river geometry', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(root, 'src', 'data', 'hydrology-graph.json'),
    'utf8',
  ));
  assert.equal(graph.edges.length, 0);
});
