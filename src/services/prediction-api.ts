import type {
  NextDayPredictionProvider,
  NextDayPredictionRequest,
} from './prediction-provider';

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ message }, { status });
}

export function createPredictionApiHandler(
  provider: NextDayPredictionProvider,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Request body must contain valid JSON.', 400);
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return errorResponse('Request body must be a JSON object.', 400);
    }
    const values = body as Record<string, unknown>;
    const stationId = typeof values.station_id === 'string' ? values.station_id.trim() : '';
    if (!stationId || stationId.length > 50) {
      return errorResponse('station_id must be a non-empty string of at most 50 characters.', 400);
    }

    let featureDate: string | undefined;
    if (values.feature_date !== undefined) {
      if (typeof values.feature_date !== 'string' || !isValidDate(values.feature_date)) {
        return errorResponse('feature_date must be a valid YYYY-MM-DD date.', 400);
      }
      featureDate = values.feature_date;
    }

    const predictionRequest: NextDayPredictionRequest = {
      station_id: stationId,
      ...(featureDate ? { feature_date: featureDate } : {}),
    };
    try {
      const prediction = await provider.predictNextDay(predictionRequest);
      return Response.json(prediction);
    } catch (error) {
      console.error('ML next-day prediction failed:', error);
      return errorResponse('ML prediction is temporarily unavailable.', 500);
    }
  };
}
