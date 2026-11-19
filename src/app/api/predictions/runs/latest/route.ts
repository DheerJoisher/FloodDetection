import { pool } from '@/lib/db';
import { withApiErrors } from '@/lib/api-errors';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const [rows] = await pool.execute(
      `SELECT run_id, feature_date, target_date, started_at, completed_at,
        status, model_version, configured_station_count,
        successful_prediction_count, insufficient_history_count,
        failure_count, cumulative_risk_result, regional_impact_result,
        alert_decision_result, error_summary
       FROM prediction_runs
       ORDER BY run_id DESC
       LIMIT 1`,
    );
    return Response.json({ data: (rows as unknown[])[0] ?? null });
  });
}
