import { verifyBearerToken } from '@/lib/auth';
import { withApiErrors, errorResponse } from '@/lib/api-errors';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';

const riskLevels = new Set(['LOW', 'MODERATE', 'HIGH']);

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const [rows] = await pool.execute(
      `SELECT id, title, message, risk_level, station_name, created_at
       FROM alerts
       ORDER BY created_at DESC, id DESC`,
    );
    return Response.json({ data: rows });
  });
}

export async function POST(request: Request): Promise<Response> {
  const claims = verifyBearerToken(request);
  if (claims instanceof Response) return claims;

  return withApiErrors(async () => {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return errorResponse('Request body must be a JSON object.', 400);
    }

    const values = body as Record<string, unknown>;
    const title = typeof values.title === 'string' ? values.title.trim() : '';
    const message = typeof values.message === 'string' ? values.message.trim() : '';
    const riskLevel = typeof values.risk_level === 'string'
      ? values.risk_level.trim().toUpperCase()
      : '';
    const stationName = values.station_name === undefined || values.station_name === null
      ? null
      : typeof values.station_name === 'string'
        ? values.station_name.trim()
        : undefined;

    if (!title || !message || !riskLevel) {
      return errorResponse('title, message, and risk_level are required.', 400);
    }
    if (title.length > 150) {
      return errorResponse('title must be at most 150 characters.', 400);
    }
    if (Buffer.byteLength(message, 'utf8') > 65535) {
      return errorResponse('message is too long.', 400);
    }
    if (!riskLevels.has(riskLevel)) {
      return errorResponse('risk_level must be LOW, MODERATE, or HIGH.', 400);
    }
    if (stationName === undefined || (stationName !== null && stationName.length > 100)) {
      return errorResponse('station_name must be a string of at most 100 characters.', 400);
    }

    const [result] = await pool.execute(
      `INSERT INTO alerts (title, message, risk_level, station_name)
       VALUES (?, ?, ?, ?)`,
      [title, message, riskLevel, stationName || null],
    );
    const [rows] = await pool.execute(
      `SELECT id, title, message, risk_level, station_name, created_at
       FROM alerts
       WHERE id = ?`,
      [(result as { insertId: number }).insertId],
    );
    return Response.json((rows as Array<Record<string, unknown>>)[0], { status: 201 });
  });
}

