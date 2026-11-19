import { pool } from '@/lib/db';
import { withApiErrors } from '@/lib/api-errors';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const [rows] = await pool.execute(
      `SELECT DISTINCT
         f.station_id,
         f.station_name,
         sm.canonical_station_name,
         sm.state,
         sm.district,
         sm.river,
         sm.tributary,
         sm.sub_basin,
         sm.latitude,
         sm.longitude,
         sm.catchment_area_km2,
         sm.station_type,
         sm.seasonal_flag,
         sm.cwc_site_code,
         sm.source,
         sm.source_confidence
       FROM flood_data f
       LEFT JOIN station_metadata sm ON sm.station_id = f.station_id
       ORDER BY f.station_id`,
    );
    return Response.json({ data: rows });
  });
}
