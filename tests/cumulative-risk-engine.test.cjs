const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTypeScript(relativePath, replacements = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const Module = require('node:module');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (name) => Object.hasOwn(replacements, name)
    ? replacements[name]
    : originalRequire(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const metadataJson = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'data', 'station-metadata.json'), 'utf8'),
);

const { evaluateCumulativeRisk } = loadTypeScript(
  'src/services/cumulative-risk-engine.ts',
  {
    'server-only': {},
    './hydrology-graph': {},
  },
);

function metadataInput() {
  return metadataJson.map((station) => ({
    station_id: station.station_id,
    canonical_station_name: station.canonical_station_name,
    state: station.state,
    district: station.district,
    river: station.river,
    tributary: station.tributary,
    sub_basin: station.sub_basin,
    catchment_area_km2: station.catchment_area_km2,
    metadata_confidence: station.source_confidence,
  }));
}

function prediction(stationId, riskClass, confidence = 0.95) {
  const probability = riskClass === 'HIGH'
    ? [0.01, 0.04, 0.95]
    : riskClass === 'MODERATE'
      ? [0.10, 0.80, 0.10]
      : [0.95, 0.04, 0.01];
  return {
    station_id: stationId,
    predicted_class: riskClass,
    probability_low: probability[0],
    probability_moderate: probability[1],
    probability_high: probability[2],
    confidence,
    prediction_status: 'PREDICTED',
    status_reason: null,
  };
}

function lowPredictions() {
  return metadataJson.map((station) => prediction(station.station_id, 'LOW'));
}

function evaluate(predictions, overrides = {}) {
  return evaluateCumulativeRisk({
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    configured_station_ids: metadataJson.map((station) => station.station_id),
    station_predictions: predictions,
    station_metadata: metadataInput(),
    ...overrides,
  });
}

test('all LOW produces LOW risk with no elevated systems', () => {
  const result = evaluate(lowPredictions());
  assert.equal(result.risk_level, 'LOW');
  assert.equal(result.cross_station_evidence.elevated_station_count, 0);
  assert.equal(result.cross_station_evidence.elevated_system_count, 0);
  assert.ok(result.risk_score >= 0 && result.risk_score < 50);
});

test('one isolated HIGH is not automatically basin HIGH', () => {
  const predictions = lowPredictions();
  predictions[0] = prediction('Station 1', 'HIGH');
  const result = evaluate(predictions);
  assert.equal(result.risk_level, 'MODERATE');
  assert.equal(result.cross_station_evidence.pattern, 'ISOLATED');
  assert.ok(result.supporting_stations.includes('Station 1'));
  assert.ok(result.uncertainty.reasons.some((reason) => reason.includes('one hydrological system')));
});

test('multiple corroborating HIGH in one system has stronger risk than isolation', () => {
  const isolated = lowPredictions();
  isolated[0] = prediction('Station 1', 'HIGH');
  const isolatedResult = evaluate(isolated);

  const corroborated = lowPredictions();
  corroborated[0] = prediction('Station 1', 'HIGH');
  corroborated[1] = prediction('Station 2', 'HIGH');
  const corroboratedResult = evaluate(corroborated);

  assert.ok(corroboratedResult.risk_score > isolatedResult.risk_score);
  assert.equal(
    corroboratedResult.river_system_evidence.find((system) =>
      system.system_name.includes('Sabari / Kolab'),
    ).evidence_status,
    'CORROBORATED',
  );
});

test('multiple MODERATE in one system increase evidence without automatically becoming HIGH', () => {
  const predictions = lowPredictions();
  predictions[0] = prediction('Station 1', 'MODERATE');
  predictions[1] = prediction('Station 2', 'MODERATE');
  const result = evaluate(predictions);
  assert.notEqual(result.risk_level, 'HIGH');
  assert.equal(result.cross_station_evidence.moderate_station_count, 2);
});

test('elevated evidence across multiple independent systems is broad evidence', () => {
  const predictions = lowPredictions();
  predictions[0] = prediction('Station 1', 'HIGH');
  predictions[10] = prediction('Station 11', 'HIGH');
  const result = evaluate(predictions);
  assert.equal(result.cross_station_evidence.pattern, 'BROAD');
  assert.ok(result.cross_station_evidence.elevated_system_count >= 2);
  assert.ok(result.risk_score > 50);
});

test('contradictory evidence is detected and uncertainty increases', () => {
  const predictions = lowPredictions();
  predictions[0] = prediction('Station 1', 'HIGH');
  predictions[1] = prediction('Station 2', 'LOW');
  const result = evaluate(predictions);
  const sabari = result.river_system_evidence.find((system) =>
    system.system_name.includes('Sabari / Kolab'),
  );
  assert.equal(sabari.contradiction, true);
  assert.equal(result.contradicting_stations.includes('Station 2'), true);
  assert.notEqual(result.uncertainty.level, 'LOW');
});

test('partial coverage is reported and missing stations are not treated as LOW', () => {
  const predictions = lowPredictions().slice(0, 8);
  const result = evaluate(predictions, {
    missing_stations: metadataJson.slice(8).map((station) => station.station_id),
  });
  assert.equal(result.station_coverage.configured, 15);
  assert.equal(result.station_coverage.available, 8);
  assert.equal(result.coverage, 8 / 15);
  assert.equal(result.data_quality.missing_stations.length, 7);
  assert.ok(result.uncertainty.reasons.some((reason) => reason.includes('coverage')));
});

test('missing metadata degrades evidence without crashing', () => {
  const result = evaluate(lowPredictions(), {
    unknown_metadata_stations: ['Station 13'],
  });
  assert.equal(result.data_quality.unknown_metadata_stations.includes('Station 13'), true);
  assert.equal(result.risk_level, 'INSUFFICIENT_EVIDENCE');
});

test('catchment areas are not summed into a physical basin area', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'services', 'cumulative-risk-engine.ts'),
    'utf8',
  );
  assert.match(source, /catchment_area_km2/);
  assert.doesNotMatch(source, /basin_area|sum_of_catchments|total.*catchment.*risk/i);
});

test('no directional propagation is invented', () => {
  const graph = JSON.parse(
    fs.readFileSync(path.join(root, 'src', 'data', 'hydrology-graph.json'), 'utf8'),
  );
  assert.equal(graph.edges.length, 0);
  const result = evaluate(lowPredictions());
  assert.equal(result.directional_propagation_used, false);
});

test('same input produces deterministic output', () => {
  const predictions = lowPredictions();
  const first = evaluate(predictions);
  const second = evaluate(predictions);
  assert.deepEqual(first, second);
});

test('cumulative risk does not depend on old threshold classifier', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'services', 'cumulative-risk-engine.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /risk-level\.js|calculateRisk|RISK_MODERATE|RISK_HIGH/);
});
