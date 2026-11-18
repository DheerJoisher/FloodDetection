const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const thresholdNames = [
  'RISK_MODERATE_WATERLEVEL',
  'RISK_MODERATE_DISCHARGE',
  'RISK_MODERATE_RAINFALL',
  'RISK_HIGH_WATERLEVEL',
  'RISK_HIGH_DISCHARGE',
  'RISK_HIGH_RAINFALL',
];
const originalThresholds = Object.fromEntries(
  thresholdNames.map((name) => [name, process.env[name]]),
);
const { calculateRisk } = require('../src/lib/risk-level.js');

afterEach(() => {
  for (const name of thresholdNames) {
    if (originalThresholds[name] === undefined) delete process.env[name];
    else process.env[name] = originalThresholds[name];
  }
});

test('risk calculation handles missing values and applies moderate and high thresholds', () => {
  assert.equal(calculateRisk({ waterlevel: null, discharge: null, rain: null }), 'LOW');
  assert.equal(calculateRisk({ waterlevel: 699, discharge: 999, rain: 49 }), 'LOW');
  assert.equal(calculateRisk({ waterlevel: 700, discharge: null, rain: null }), 'MODERATE');
  assert.equal(calculateRisk({ waterlevel: 700, discharge: null, rain: 100 }), 'HIGH');
});

test('risk calculation honors configured thresholds and rejects invalid ordering', () => {
  process.env.RISK_MODERATE_RAINFALL = '12';
  process.env.RISK_HIGH_RAINFALL = '18';
  assert.equal(calculateRisk({ rain: 12 }), 'MODERATE');
  assert.equal(calculateRisk({ rain: 18 }), 'HIGH');

  process.env.RISK_HIGH_RAINFALL = '12';
  assert.throws(() => calculateRisk({ rain: 0 }), /must exceed the MODERATE threshold/);
});
