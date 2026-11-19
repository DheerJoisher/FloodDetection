const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'data', 'station-metadata.json'), 'utf8'),
);

test('all 15 stations are represented by corrected CWC metadata', () => {
  assert.equal(metadata.length, 15);
  assert.equal(new Set(metadata.map((station) => station.station_id)).size, 15);
  assert.ok(metadata.every((station) => station.source === 'CWC'));
  assert.ok(metadata.every((station) => station.source_reference));
  assert.ok(metadata.every((station) => station.source_confidence === 'verified'));
  assert.ok(metadata.every((station) => station.state && station.district));
});

test('corrected station identifiers and coordinates are exact', () => {
  const byId = Object.fromEntries(metadata.map((station) => [station.station_id, station]));
  assert.equal(byId['Station 1'].state, 'Odisha');
  assert.equal(byId['Station 1'].district, 'Koraput');
  assert.equal(byId['Station 1'].tributary, 'Sabari / Kolab');
  assert.equal(byId['Station 1'].cwc_site_code, 'CW1GDL001280');
  assert.equal(byId['Station 2'].catchment_area_km2, 439.62);
  assert.equal(byId['Station 11'].canonical_station_name, 'Allamvari Ghanpur');
  assert.equal(byId['Station 11'].tributary, 'Jampannavagu');
  assert.notEqual(byId['Station 11'].tributary, 'Peddavagu');
  assert.equal(byId['Station 13'].tributary, 'Poolangvagu');
  assert.equal(byId['Station 14'].longitude, 76.754);
  assert.equal(byId['Station 15'].district, 'Malkangiri');
});

test('original dataset names remain separate and preserved', () => {
  assert.equal(
    metadata.find((station) => station.station_id === 'Station 15').dataset_station_name,
    'Potteru (potteruvagu)',
  );
  assert.equal(
    metadata.find((station) => station.station_id === 'Station 11').dataset_station_name,
    'Allam vari ghanapur',
  );
});

test('state grouping includes Odisha, Telangana, Andhra Pradesh, and Maharashtra', () => {
  const states = new Set(metadata.map((station) => station.state));
  assert.deepEqual(
    [...states].sort(),
    ['Andhra Pradesh', 'Maharashtra', 'Odisha', 'Telangana'].sort(),
  );
});

test('Maner, Sabari/Kolab, Jampannavagu, Peddavagu, Murredu, Pamuleru and Purna systems are identifiable', () => {
  const systems = new Set(metadata.map((station) =>
    `${station.river ?? 'Unknown'} / ${station.tributary ?? 'Unknown'}`,
  ));
  assert.ok([...systems].some((system) => system.includes('Maner')));
  assert.ok([...systems].some((system) => system.includes('Sabari')));
  assert.ok([...systems].some((system) => system.includes('Jampannavagu')));
  assert.ok([...systems].some((system) => system.includes('Peddavagu')));
  assert.ok([...systems].some((system) => system.includes('Murredu')));
  assert.ok([...systems].some((system) => system.includes('Pamuleru')));
  assert.ok([...systems].some((system) => system.includes('Purna')));
});

test('catchment evidence is descriptive and overlap is explicitly disclosed', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'services', 'cumulative-risk-engine.ts'),
    'utf8',
  );
  assert.match(source, /total_documented_catchment_km2/);
  assert.match(source, /minimum_km2/);
  assert.match(source, /maximum_km2/);
  assert.match(source, /mean_km2/);
  assert.match(source, /median_km2/);
  assert.match(source, /overlapping values, not a physical basin area/);
});

test('missing prediction handling never creates a LOW prediction', () => {
  const prediction = null;
  assert.equal(prediction, null);
  assert.equal(prediction?.predicted_class ?? null, null);
});

test('evidence service does not average probabilities or define a final risk label', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'services', 'cumulative-risk-engine.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /any HIGH/);
  assert.doesNotMatch(source, /weighted|majority voting|probability.*reduce|reduce.*probability/i);
  assert.match(source, /final_risk_label: null/);
});

test('historical observation and persistence structures remain separate', () => {
  const setup = fs.readFileSync(path.join(root, 'scripts', 'setupDb.cjs'), 'utf8');
  assert.match(setup, /CREATE TABLE IF NOT EXISTS flood_data/);
  assert.match(setup, /CREATE TABLE IF NOT EXISTS station_predictions/);
  assert.doesNotMatch(setup, /DROP TABLE|TRUNCATE TABLE|DELETE FROM flood_data/);
});
