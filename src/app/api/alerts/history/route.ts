import { pool } from '@/lib/db';
import { withApiErrors } from '@/lib/api-errors';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const [rows] = await pool.execute(
      `SELECT alert_id, alert_identity, alert_type, lifecycle_state, severity,
        feature_date, target_date, confidence, coverage, uncertainty,
        supporting_stations, supporting_systems, affected_states,
        affected_districts, supporting_evidence, run_id, model_version,
        headline, message, recommended_action, disclaimer,
        created_at, updated_at, resolved_at
       FROM project_alert_events
       ORDER BY created_at DESC, alert_id DESC`,
    );
    return Response.json({ data: rows });
  });
}
