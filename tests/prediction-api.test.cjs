const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const ts = require('typescript');

const sourceRoot = path.resolve(__dirname, '..');
const originalConsoleError = console.error;

function loadTypeScript(relativePath, replacements = {}) {
  const filename = path.join(sourceRoot, relativePath);
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
  loaded.require = (name) => Object.hasOwn(replacements, name)
    ? replacements[name]
    : originalRequire(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { createPredictionApiHandler } = loadTypeScript('src/services/prediction-api.ts');

function prediction(overrides = {}) {
  return {
    station_id: 'Station 1',
    station_name: 'Rajahmundry',
    feature_date: '2024-08-01',
    predicted_target_date: '2024-08-02',
    predicted_risk: 'HIGH',
    probability_low: 0.02,
    probability_moderate: 0.08,
    probability_high: 0.9,
    prediction_confidence: 0.9,
    prediction_status: 'PREDICTED',
    status_reason: 'Predicted from the preceding seven daily observations.',
    ...overrides,
  };
}

function handlerFor(result) {
  return createPredictionApiHandler({
    async predictNextDay() {
      return result;
    },
  });
}

function post(body, headers = {}) {
  return new Request('http://localhost/api/predictions/next-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  console.error = originalConsoleError;
});

test('successful prediction preserves T+1 date, probabilities, and argmax class', async () => {
  const result = prediction();
  const response = await handlerFor(result)(post({ station_id: 'Station 1' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.predicted_target_date, '2024-08-02');
  assert.equal(body.prediction_status, 'PREDICTED');
  assert.deepEqual(
    [body.probability_low, body.probability_moderate, body.probability_high],
    [0.02, 0.08, 0.9],
  );
  assert.ok(Math.abs(
    body.probability_low + body.probability_moderate + body.probability_high - 1,
  ) < 1e-6);
  const probabilities = [
    body.probability_low,
    body.probability_moderate,
    body.probability_high,
  ];
  assert.equal(body.predicted_risk, ['LOW', 'MODERATE', 'HIGH'][probabilities.indexOf(Math.max(...probabilities))]);
});

test('insufficient history and date gaps return a status without a prediction', async () => {
  for (const reason of [
    'Seven consecutive daily observations are required.',
    'A date gap prevents feature construction.',
  ]) {
    const result = prediction({
      predicted_risk: null,
      probability_low: null,
      probability_moderate: null,
      probability_high: null,
      prediction_confidence: null,
      prediction_status: 'INSUFFICIENT_HISTORY',
      status_reason: reason,
    });
    const response = await handlerFor(result)(post({ station_id: 'Station 1' }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.prediction_status, 'INSUFFICIENT_HISTORY');
    assert.equal(body.predicted_risk, null);
    assert.equal(body.status_reason, reason);
  }
});

test('unknown stations return a safe unsupported status', async () => {
  const result = prediction({
    station_id: 'unknown',
    station_name: null,
    predicted_risk: null,
    probability_low: null,
    probability_moderate: null,
    probability_high: null,
    prediction_confidence: null,
    prediction_status: 'UNSUPPORTED_STATION',
    status_reason: 'Station is not supported.',
  });
  const response = await handlerFor(result)(post({ station_id: 'unknown' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).prediction_status, 'UNSUPPORTED_STATION');
});

test('invalid request fields are rejected before invoking the provider', async () => {
  let called = false;
  const handler = createPredictionApiHandler({
    async predictNextDay() {
      called = true;
      return prediction();
    },
  });
  const response = await handler(post({ station_id: 'Station 1', feature_date: '2024-02-30' }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test('prediction endpoint follows the public read-only API boundary', async () => {
  const response = await handlerFor(prediction())(
    post({ station_id: 'Station 1' }),
  );
  assert.equal(response.status, 200);
});

test('inference errors return a generic server error without internal details', async () => {
  console.error = () => {};
  const handler = createPredictionApiHandler({
    async predictNextDay() {
      throw new Error('C:\\private\\model\\stack trace');
    },
  });
  const response = await handler(post({ station_id: 'Station 1' }));
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.message, 'ML prediction is temporarily unavailable.');
  assert.equal(JSON.stringify(body).includes('private'), false);
});

test('existing rule-based risk and alerts API behavior remains intact', async () => {
  const { calculateRisk } = require('../src/lib/risk-level.js');
  assert.equal(calculateRisk({ waterlevel: 700 }), 'MODERATE');

  let queryCount = 0;
  const { GET, POST } = loadTypeScript('src/app/api/alerts/route.ts', {
    '@/lib/auth': {
      verifyBearerToken(request) {
        return request.headers.get('authorization') === 'Bearer valid'
          ? { userId: 1 }
          : Response.json({ message: 'Unauthorized.' }, { status: 401 });
      },
    },
    '@/lib/api-errors': {
      async withApiErrors(callback) {
        return callback();
      },
      errorResponse(message, status) {
        return Response.json({ message }, { status });
      },
    },
    '@/lib/db': {
      pool: {
        async execute() {
          queryCount += 1;
          return [[{
            id: 1,
            title: 'River watch',
            message: 'Monitor levels.',
            risk_level: 'MODERATE',
            station_name: 'Rajahmundry',
          }], []];
        },
      },
    },
  });
  const getResponse = await GET();
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).data[0].title, 'River watch');
  const postResponse = await POST(post({
    title: 'New alert',
    message: 'Check river level.',
    risk_level: 'HIGH',
  }));
  assert.equal(postResponse.status, 401);
  assert.equal(queryCount, 1);
});
