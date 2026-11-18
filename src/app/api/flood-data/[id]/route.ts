import { pool } from '@/lib/db';
import { errorResponse, withApiErrors } from '@/lib/api-errors';
import { calculateRisk } from '@/lib/risk-level.js';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApiErrors(async () => {
    const { id: rawId } = await context.params;
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
      return errorResponse('id must be a positive safe integer.', 400);
    }

    const [rows] = await pool.execute('SELECT * FROM flood_data WHERE id = ?', [Number(rawId)]);
    const record = (rows as Array<Record<string, unknown> & {
      waterlevel: number | null;
      discharge: number | null;
      rain: number | null;
    }>)[0];
    if (!record) return errorResponse('Flood record not found.', 404);
    return Response.json({ ...record, risk_level: calculateRisk(record) });
  });
}
