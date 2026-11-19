const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

function loadTypeScript(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (name) => {
    if (name === 'server-only') return {};
    if (name === './cumulative-risk-engine') {
      return { getCumulativeEvidence: async () => null };
    }
    if (name === './hydrology-graph') {
      return { getHydrologyNetworkContext: async () => null };
    }
    return originalRequire(name);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const metadata = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'data', 'station-metadata.json'), 'utf8'),
);
const { evaluateRegionalImpact } = loadTypeScript(
  'src/services/regional-impact-engine.ts',
);

function toRegionalMetadata() {
  return metadata.map((station) => ({
    station_id: station.station_id,
    canonical_station_name: station.canonical_station_name,
    state: station.state,
    district: station.district,
    river: station.river,
    tributary: station.tributary,
    sub_basin: station.sub_basin,
    latitude: station.latitude,
    longitude: station.longitude,
    catchment_area_km2: station.catchment_area_km2,
    metadata_confidence: station.source_confidence,
  }));
}

function prediction(stationId, riskClass, confidence = 0.95) {
  const probabilities = riskClass === 'HIGH'
    ? [0.01, 0.04, 0.95]
    : riskClass === 'MODERATE'
      ? [0.10, 0.80, 0.10]
      : [0.95, 0.04, 0.01];
  return {
    station_id: stationId,
    predicted_class: riskClass,
    probability_low: probabilities[0],
    probability_moderate: probabilities[1],
    probability_high: probabilities[2],
    confidence,
    prediction_status: 'PREDICTED',
    status_reason: null,
  };
}

function allLow() {
  return metadata.map((station) => prediction(station.station_id, 'LOW'));
}

function evaluate(predictions, overrides = {}) {
  return evaluateRegionalImpact({
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    station_predictions: predictions,
    station_metadata: toRegionalMetadata(),
    ...overrides,
  });
}

test('all LOW produces no affected state or district', () => {
  const result = evaluate(allLow());
  assert.equal(result.regional_impact_level, 'NO_ELEVATED_EVIDENCE');
  assert.deepEqual(result.potentially_affected_states, []);
  assert.deepEqual(result.potentially_affected_districts, []);
  assert.ok(result.state_impact_evidence.every((state) =>
    state.impact_level === 'NO_ELEVATED_EVIDENCE',
  ));
});

test('one isolated HIGH affects only its district and WATCHes the state', () => {
  const predictions = allLow();
  predictions[0] = prediction('Station 1', 'HIGH');
  const result = evaluate(predictions);
  assert.ok(result.potentially_affected_districts.includes('Koraput'));
  assert.ok(result.potentially_affected_states.includes('Odisha'));
  assert.equal(
    result.district_impact_evidence.find((district) => district.district === 'Koraput').impact_level,
    'WATCH',
  );
  assert.notEqual(
    result.state_impact_evidence.find((state) => state.state === 'Odisha').impact_level,
    'HIGH_POTENTIAL_IMPACT',
  );
});

test('two HIGH stations in one district strengthen regional evidence', () => {
  const predictions = allLow();
  predictions[0] = prediction('Station 1', 'HIGH');
  predictions[1] = prediction('Station 2', 'HIGH');
  const result = evaluate(predictions);
  const koraput = result.district_impact_evidence
    .find((district) => district.district === 'Koraput');
  assert.equal(koraput.high_station_count, 2);
  assert.equal(koraput.impact_level, 'HIGH_POTENTIAL_IMPACT');
  assert.equal(koraput.contradicting_stations.length, 0);
});

test('HIGH plus LOW in the same district is contradictory', () => {
  const predictions = allLow();
  predictions[0] = prediction('Station 1', 'HIGH');
  predictions[1] = prediction('Station 2', 'LOW');
  const result = evaluate(predictions);
  const koraput = result.district_impact_evidence
    .find((district) => district.district === 'Koraput');
  assert.equal(koraput.contradicting_stations.length > 0, true);
  assert.equal(koraput.uncertainty, 'MODERATE');
});

test('HIGH stations in two districts of one state strengthen state evidence', () => {
  const predictions = allLow();
  predictions[0] = prediction('Station 1', 'HIGH');
  predictions[14] = prediction('Station 15', 'HIGH');
  const result = evaluate(predictions);
  const odisha = result.state_impact_evidence
    .find((state) => state.state === 'Odisha');
  assert.equal(odisha.affected_district_count, 2);
  assert.notEqual(odisha.impact_level, 'WATCH');
});

test('HIGH stations in independent states remain separate', () => {
  const predictions = allLow();
  predictions[0] = prediction('Station 1', 'HIGH');
  predictions[3] = prediction('Station 4', 'HIGH');
  const result = evaluate(predictions);
  assert.ok(result.potentially_affected_states.includes('Odisha'));
  assert.ok(result.potentially_affected_states.includes('Andhra Pradesh'));
  assert.equal(result.state_impact_evidence.length >= 2, true);
  assert.notEqual(
    result.state_impact_evidence.find((state) => state.state === 'Odisha')
      .state,
    result.state_impact_evidence.find((state) => state.state === 'Andhra Pradesh')
      .state,
  );
});

test('missing station prediction decreases coverage and raises uncertainty', () => {
  const result = evaluate(allLow().slice(0, 8), {
    missing_station_ids: metadata.slice(8).map((station) => station.station_id),
  });
  assert.equal(result.data_quality.coverage, 8 / 15);
  assert.equal(result.data_quality.missing_stations.length, 7);
  assert.ok(result.uncertain_regions.length > 0);
});

test('unrepresented states are not fabricated', () => {
  const result = evaluate(allLow());
  assert.deepEqual(
    result.basin_geographic_coverage.unrepresented_basin_states,
    ['Chhattisgarh', 'Madhya Pradesh', 'Karnataka'],
  );
  assert.equal(result.basin_geographic_coverage.represented_state_count, 4);
  assert.equal(result.basin_geographic_coverage.geographic_coverage_status, 'PARTIAL');
});

test('missing district metadata is reported instead of crashing', () => {
  const modifiedMetadata = toRegionalMetadata();
  modifiedMetadata[12].district = null;
  const result = evaluateRegionalImpact({
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    station_predictions: allLow(),
    station_metadata: modifiedMetadata,
  });
  assert.equal(result.data_quality.missing_district_metadata.includes('Station 13'), true);
});

test('no directional graph is used for regional impact', () => {
  const graph = JSON.parse(
    fs.readFileSync(path.join(root, 'src', 'data', 'hydrology-graph.json'), 'utf8'),
  );
  assert.equal(graph.edges.length, 0);
  const result = evaluate(allLow());
  assert.equal(result.limitations.some((item) => item.includes('directional')), true);
});

test('catchment areas are not reported as affected geographic area', () => {
  const result = evaluate(allLow());
  assert.ok(result.district_impact_evidence.every((district) =>
    district.catchment_overlap_notice.includes('not summed'),
  ));
});

test('deterministic input produces deterministic regional result', () => {
  const predictions = allLow();
  const first = evaluate(predictions);
  const second = evaluate(predictions);
  assert.deepEqual(first, second);
});
