import { pool } from '@/lib/db';
import { errorResponse, withApiErrors } from '@/lib/api-errors';
import { calculateRisk } from '@/lib/risk-level.js';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const [rows] = await pool.execute(
      `SELECT * FROM flood_data
       ORDER BY \`date\` DESC, id DESC
       LIMIT 1`,
    );
    const latest = (rows as Array<Record<string, unknown> & {
      waterlevel: number | null;
      discharge: number | null;
      rain: number | null;
    }>)[0];
    if (!latest) return errorResponse('No flood records are available.', 404);
    return Response.json({ ...latest, risk_level: calculateRisk(latest) });
  });
}
