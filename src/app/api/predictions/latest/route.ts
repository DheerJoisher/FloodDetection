import { pool } from '@/lib/db';
import { withApiErrors } from '@/lib/api-errors';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const url = new URL(request.url);
    const stationId = url.searchParams.get('station_id');
    if (stationId !== null && (!stationId.trim() || stationId.length > 50)) {
      return Response.json(
        { message: 'station_id must be a non-empty string of at most 50 characters.' },
        { status: 400 },
      );
    }

    const params: string[] = [];
    const whereParts = ['sp.feature_date = (SELECT MAX(feature_date) FROM station_predictions)'];
    if (stationId !== null) {
      whereParts.push('sp.station_id = ?');
      params.push(stationId.trim());
    }

    const [rows] = await pool.execute(
      `SELECT
        sp.prediction_id,
        sp.station_id,
        sm.canonical_station_name,
        sm.dataset_station_name,
        sp.feature_date,
        sp.target_date,
        sp.predicted_class,
        sp.probability_low,
        sp.probability_moderate,
        sp.probability_high,
        sp.confidence,
        sp.prediction_status,
        sp.model_version,
        sp.generated_at,
        sp.input_latest_observation_date,
        sp.data_coverage,
        sp.status_reason
       FROM station_predictions sp
       LEFT JOIN station_metadata sm ON sm.station_id = sp.station_id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY sp.station_id ASC`,
      params,
    );
    return Response.json({ data: rows });
  });
}
