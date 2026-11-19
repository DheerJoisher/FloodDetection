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
  loaded.require = (name) => name === 'server-only'
    ? {}
    : loaded.require(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { evaluateAlertState } = loadTypeScript(
  'src/services/alert-engine.ts',
);

function risk(overrides = {}) {
  return {
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    coverage: 1,
    risk_level: 'LOW',
    risk_score: 15,
    cross_station_evidence: {
      elevated_station_count: 0,
      elevated_system_count: 0,
      contradicting_stations: [],
      supporting_stations: [],
    },
    river_system_evidence: [],
    uncertainty: { level: 'LOW', reasons: [] },
    ...overrides,
  };
}

function regional(overrides = {}) {
  return {
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    regional_impact_level: 'NO_ELEVATED_EVIDENCE',
    potentially_affected_states: [],
    potentially_affected_districts: [],
    supporting_stations: [],
    supporting_river_systems: [],
    data_quality: { coverage: 1 },
    uncertainty: [],
    ...overrides,
  };
}

function decision(options = {}) {
  return evaluateAlertState({
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    model_version: 'flood_risk_mlp_v2.keras',
    cumulative_risk: risk(options.cumulative ?? {}),
    regional_impact: regional(options.regional ?? {}),
    existing_alert: options.existing ?? null,
    consecutive_same_severity: options.consecutive ?? 0,
    no_new_support_after_target: options.expired ?? false,
  });
}

test('all LOW produces no alert', () => {
  const result = decision();
  assert.equal(result.persist, false);
  assert.equal(result.severity, null);
  assert.equal(result.lifecycle_state, 'NO_CHANGE');
});

test('one isolated HIGH produces conservative WATCH', () => {
  const result = decision({
    cumulative: {
      risk_level: 'MODERATE',
      risk_score: 55,
      cross_station_evidence: {
        elevated_station_count: 1,
        elevated_system_count: 1,
        supporting_stations: ['Station 1'],
        contradicting_stations: [],
      },
    },
    regional: {
      regional_impact_level: 'WATCH',
      potentially_affected_states: ['Odisha'],
      potentially_affected_districts: ['Koraput'],
      supporting_stations: ['Station 1'],
      supporting_river_systems: ['Godavari / Sabari / Kolab'],
    },
  });
  assert.equal(result.severity, 'WATCH');
  assert.equal(result.lifecycle_state, 'CREATED');
});

test('corroborating HIGH stations can produce advisory severity', () => {
  const result = decision({
    cumulative: {
      risk_level: 'MODERATE',
      risk_score: 60,
      cross_station_evidence: {
        elevated_station_count: 2,
        elevated_system_count: 2,
        supporting_stations: ['Station 1', 'Station 4'],
        contradicting_stations: [],
      },
    },
    regional: {
      regional_impact_level: 'POTENTIAL_IMPACT',
      potentially_affected_states: ['Odisha', 'Andhra Pradesh'],
      potentially_affected_districts: ['Koraput', 'Alluri Sitharama Raju'],
      supporting_stations: ['Station 1', 'Station 4'],
      supporting_river_systems: [
        'Godavari / Sabari / Kolab',
        'Godavari / Sabari / Sileru (Machkund)',
      ],
    },
    regional: {
      regional_impact_level: 'POTENTIAL_IMPACT',
      potentially_affected_states: ['Odisha', 'Andhra Pradesh'],
      potentially_affected_districts: ['Koraput', 'Alluri Sitharama Raju'],
      supporting_stations: ['Station 1', 'Station 4'],
      supporting_river_systems: [
        'Godavari / Sabari / Kolab',
        'Godavari / Sabari / Sileru (Machkund)',
      ],
    },
  });
  assert.equal(result.severity, 'ADVISORY');
});

test('contradictory evidence downgrades strong alert to WATCH', () => {
  const result = decision({
    cumulative: {
      risk_level: 'MODERATE',
      risk_score: 75,
      cross_station_evidence: {
        elevated_station_count: 2,
        elevated_system_count: 2,
        supporting_stations: ['Station 1', 'Station 4'],
        contradicting_stations: ['Station 2'],
      },
      uncertainty: { level: 'MODERATE', reasons: ['contradictory'] },
    },
  });
  assert.equal(result.severity, 'WATCH');
});

test('same severity is maintained and higher severity is upgraded', () => {
  const existing = {
    alert_identity: '2026-02-20|2026-02-21|Odisha',
    lifecycle_state: 'CREATED',
    severity: 'WATCH',
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    states: ['Odisha'],
    districts: ['Koraput'],
    systems: ['Godavari / Sabari / Kolab'],
    resolved_at: null,
  };
  const maintained = decision({
    existing,
    consecutive: 2,
    cumulative: {
      risk_level: 'MODERATE',
      risk_score: 55,
      cross_station_evidence: {
        elevated_station_count: 1,
        elevated_system_count: 1,
        supporting_stations: ['Station 1'],
        contradicting_stations: [],
      },
    },
  });
  assert.equal(maintained.lifecycle_state, 'MAINTAINED');

  const upgraded = decision({
    existing: {
      ...existing,
      lifecycle_state: 'CREATED',
      severity: 'WATCH',
    },
    cumulative: {
      risk_level: 'MODERATE',
      risk_score: 60,
      cross_station_evidence: {
        elevated_station_count: 2,
        elevated_system_count: 2,
        supporting_stations: ['Station 1', 'Station 4'],
        contradicting_stations: [],
      },
    },
    regional: {
      regional_impact_level: 'POTENTIAL_IMPACT',
      potentially_affected_states: ['Odisha', 'Andhra Pradesh'],
      potentially_affected_districts: ['Koraput', 'Alluri Sitharama Raju'],
      supporting_stations: ['Station 1', 'Station 4'],
      supporting_river_systems: [
        'Godavari / Sabari / Kolab',
        'Godavari / Sabari / Sileru (Machkund)',
      ],
    },
  });
  assert.equal(upgraded.lifecycle_state, 'UPGRADED');
});

test('expired target resolves an existing alert', () => {
  const existing = {
    alert_identity: '2026-02-20|2026-02-21|Odisha',
    lifecycle_state: 'CREATED',
    severity: 'WATCH',
    feature_date: '2026-02-20',
    target_date: '2026-02-21',
    states: ['Odisha'],
    districts: ['Koraput'],
    systems: ['Godavari / Sabari / Kolab'],
    resolved_at: null,
  };
  const result = decision({ existing, expired: true });
  assert.equal(result.lifecycle_state, 'RESOLVED');
  assert.equal(result.persist, true);
});

test('alert identity includes feature, target, and geographic scope', () => {
  const result = decision({
    cumulative: {
      risk_level: 'MODERATE',
      cross_station_evidence: {
        elevated_station_count: 1,
        elevated_system_count: 1,
        supporting_stations: ['Station 1'],
        contradicting_stations: [],
      },
    },
    regional: {
      potentially_affected_states: ['Odisha'],
      potentially_affected_districts: ['Koraput'],
      supporting_stations: ['Station 1'],
      supporting_river_systems: ['Godavari / Sabari / Kolab'],
    },
  });
  assert.match(result.alert_identity, /^2026-02-20\|2026-02-21\|/);
});

test('alert includes disclaimer and conservative official-advisory action', () => {
  const result = decision({
    cumulative: {
      risk_level: 'MODERATE',
      cross_station_evidence: {
        elevated_station_count: 1,
        elevated_system_count: 1,
        supporting_stations: ['Station 1'],
        contradicting_stations: [],
      },
    },
  });
  assert.match(result.disclaimer, /not an official government flood warning/);
  assert.match(result.recommended_action, /CWC\/NDMA/);
});
