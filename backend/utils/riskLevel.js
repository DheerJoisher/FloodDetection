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

// Academic demonstration thresholds, not official government flood-warning thresholds.
const thresholds = {
  moderate: {
    waterlevel: readThreshold('RISK_MODERATE_WATERLEVEL', 700),
    discharge: readThreshold('RISK_MODERATE_DISCHARGE', 1000),
    rain: readThreshold('RISK_MODERATE_RAINFALL', 50),
  },
  high: {
    waterlevel: readThreshold('RISK_HIGH_WATERLEVEL', 800),
    discharge: readThreshold('RISK_HIGH_DISCHARGE', 4000),
    rain: readThreshold('RISK_HIGH_RAINFALL', 100),
  },
};

for (const metric of Object.keys(thresholds.moderate)) {
  if (thresholds.high[metric] <= thresholds.moderate[metric]) {
    throw new Error(`The HIGH ${metric} risk threshold must exceed the MODERATE threshold.`);
  }
}

function reachesThreshold(value, threshold) {
  return value !== null
    && value !== undefined
    && Number.isFinite(Number(value))
    && Number(value) >= threshold;
}

function calculateRisk(reading) {
  const metrics = {
    waterlevel: reading.waterlevel,
    discharge: reading.discharge,
    rain: reading.rain,
  };

  if (Object.keys(metrics).some((metric) => reachesThreshold(metrics[metric], thresholds.high[metric]))) {
    return 'HIGH';
  }
  if (Object.keys(metrics).some((metric) => reachesThreshold(metrics[metric], thresholds.moderate[metric]))) {
    return 'MODERATE';
  }
  return 'LOW';
}

module.exports = { calculateRisk };
