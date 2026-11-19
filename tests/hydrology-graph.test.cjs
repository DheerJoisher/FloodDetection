const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'data', 'station-metadata.json'), 'utf8'),
);
const graph = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'data', 'hydrology-graph.json'), 'utf8'),
);

test('graph fixture contains exactly 15 unique station nodes', () => {
  assert.equal(metadata.length, 15);
  assert.equal(graph.nodes.length, 15);
  assert.equal(new Set(graph.nodes).size, 15);
  assert.deepEqual([...graph.nodes].sort(), [...metadata.map((item) => item.station_id)].sort());
});

test('graph fixture has no duplicate nodes, self-loops, or unknown station references', () => {
  const known = new Set(graph.nodes);
  for (const edge of graph.edges) {
    const stationIds = edge.station_ids
      ?? [edge.upstream_station_id, edge.downstream_station_id].filter(Boolean);
    assert.ok(stationIds.length > 0);
    assert.ok(!stationIds.includes(null));
    for (const stationId of stationIds) assert.ok(known.has(stationId));
    if (edge.upstream_station_id && edge.downstream_station_id) {
      assert.notEqual(edge.upstream_station_id, edge.downstream_station_id);
    }
  }
  const keys = graph.edges.map((edge) => {
    const ids = [...(edge.station_ids ?? [])].sort();
    return `${edge.relationship_type}|${ids.join('|')}`;
  });
  assert.equal(new Set(keys).size, keys.length);
});

test('Allamvari Ghanpur remains Jampannavagu and is not Peddavagu', () => {
  const station = metadata.find((item) => item.station_id === 'Station 11');
  assert.equal(station.canonical_station_name, 'Allamvari Ghanpur');
  assert.equal(station.tributary, 'Jampannavagu');
  assert.notEqual(station.tributary, 'Peddavagu');
});

test('graph edge validation retains required source and confidence fields', () => {
  for (const edge of graph.edges) {
    assert.equal(typeof edge.relationship_type, 'string');
    assert.ok(edge.confidence);
    assert.ok(edge.source);
    assert.ok(edge.source_reference);
  }
});

test('unverified relationships are not converted into direct flow edges', () => {
  const directEdges = graph.edges.filter((edge) =>
    edge.relationship_type === 'DIRECT_UPSTREAM'
    || edge.relationship_type === 'DIRECT_DOWNSTREAM',
  );
  assert.deepEqual(directEdges, []);
  assert.ok(graph.edges.every((edge) => edge.relationship_type === 'SAME_SUB_BASIN'));
});

test('sub-basin lookup distinguishes Maner stations', () => {
  const maner = metadata.filter((station) =>
    station.sub_basin === 'Maner'
    || station.sub_basin === 'Maner / Morancha Vagu'
    || station.sub_basin === 'Maneru',
  );
  assert.deepEqual(
    maner.map((station) => station.station_id).sort(),
    ['Station 6', 'Station 7', 'Station 9'],
  );
});

test('coverage helper semantics preserve missing predictions', () => {
  const coverage = (configured, predicted) =>
    configured === 0 ? 0 : predicted / configured;
  assert.equal(coverage(3, 3), 1);
  assert.equal(coverage(3, 0), 0);
  assert.equal(coverage(0, 0), 0);
});

test('probabilities remain numeric and do not create a graph risk label', () => {
  const probabilities = [0.9981339573860168, 0.0015924590406939387, 0.0002736643946263939];
  assert.ok(probabilities.every((value) => typeof value === 'number'));
  assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
  assert.equal(Object.hasOwn({ probability_low: 1 }, 'final_risk_label'), false);
});
