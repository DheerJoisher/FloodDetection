function readThreshold(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return value;
}

function getThresholds() {
  const moderate = {
    waterlevel: readThreshold('RISK_MODERATE_WATERLEVEL', 700),
    discharge: readThreshold('RISK_MODERATE_DISCHARGE', 1000),
    rain: readThreshold('RISK_MODERATE_RAINFALL', 50),
  };
  const high = {
    waterlevel: readThreshold('RISK_HIGH_WATERLEVEL', 800),
    discharge: readThreshold('RISK_HIGH_DISCHARGE', 4000),
    rain: readThreshold('RISK_HIGH_RAINFALL', 100),
  };

  for (const metric of Object.keys(moderate)) {
    if (high[metric] <= moderate[metric]) {
      throw new Error(`The HIGH ${metric} risk threshold must exceed the MODERATE threshold.`);
    }
  }
  return { moderate, high };
}

/**
 * Academic demonstration thresholds, not official government flood-warning thresholds.
 * @param {{waterlevel?: number|null, discharge?: number|null, rain?: number|null}} reading
 * @returns {'LOW'|'MODERATE'|'HIGH'}
 */
function calculateRisk(reading) {
  const thresholds = getThresholds();
  const values = {
    waterlevel: reading.waterlevel,
    discharge: reading.discharge,
    rain: reading.rain,
  };
  const reaches = (value, threshold) =>
    value !== null &&
    value !== undefined &&
    Number.isFinite(Number(value)) &&
    Number(value) >= threshold;

  if (Object.keys(values).some((metric) => reaches(values[metric], thresholds.high[metric]))) {
    return 'HIGH';
  }
  if (Object.keys(values).some((metric) => reaches(values[metric], thresholds.moderate[metric]))) {
    return 'MODERATE';
  }
  return 'LOW';
}

module.exports = { calculateRisk };
