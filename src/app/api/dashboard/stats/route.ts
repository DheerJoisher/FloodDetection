import { pool } from '@/lib/db';
import { withApiErrors } from '@/lib/api-errors';
import { calculateRisk } from '@/lib/risk-level.js';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const [summaryRows] = await pool.execute(
      `SELECT COUNT(*) AS total_records,
              COUNT(DISTINCT station_id) AS station_count
       FROM flood_data`,
    );
    const summary = (summaryRows as Array<{
      total_records: number | string;
      station_count: number | string;
    }>)[0];
    const [latestRows] = await pool.execute(
      `SELECT \`date\`, station_id, station_name, waterlevel, discharge, rain
       FROM flood_data
       ORDER BY \`date\` DESC, id DESC
       LIMIT 1`,
    );
    const latest = (latestRows as Array<{
      date: string;
      station_id: string;
      station_name: string | null;
      waterlevel: number | null;
      discharge: number | null;
      rain: number | null;
    }>)[0] ?? null;

    return Response.json({
      total_records: Number(summary.total_records),
      station_count: Number(summary.station_count),
      latest_date: latest?.date ?? null,
      latest_waterlevel: latest?.waterlevel ?? null,
      latest_discharge: latest?.discharge ?? null,
      latest_rainfall: latest?.rain ?? null,
      latest_risk_level: latest ? calculateRisk(latest) : null,
      latest_station_id: latest?.station_id ?? null,
      latest_station_name: latest?.station_name ?? null,
    });
  });
}
