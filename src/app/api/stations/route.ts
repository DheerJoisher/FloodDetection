import { pool } from '@/lib/db';
import { withApiErrors } from '@/lib/api-errors';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const [rows] = await pool.execute(
      `SELECT station_id, station_name
       FROM flood_data
       GROUP BY station_id, station_name
       ORDER BY station_id`,
    );
    return Response.json({ data: rows });
  });
}
