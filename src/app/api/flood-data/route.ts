import { pool } from '@/lib/db';
import { errorResponse, withApiErrors } from '@/lib/api-errors';
import { calculateRisk } from '@/lib/risk-level.js';

export const runtime = 'nodejs';

const maximumLimit = 100;

type FloodRecord = Record<string, unknown> & {
  waterlevel: number | null;
  discharge: number | null;
  rain: number | null;
};

function positiveInteger(value: string | null, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function singleQueryValue(search: URLSearchParams, name: string): string | null | undefined {
  const values = search.getAll(name);
  return values.length > 1 ? undefined : values[0] ?? null;
}

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const search = new URL(request.url).searchParams;
    const limitValue = singleQueryValue(search, 'limit');
    const pageValue = singleQueryValue(search, 'page');
    if (limitValue === undefined || pageValue === undefined) {
      return errorResponse('Query parameters must not be repeated.', 400);
    }
    const limit = positiveInteger(limitValue, 20, maximumLimit);
    const page = positiveInteger(pageValue, 1);
    if (limit === null) {
      return errorResponse(`limit must be an integer from 1 to ${maximumLimit}.`, 400);
    }
    if (page === null || (page - 1) * limit > Number.MAX_SAFE_INTEGER) {
      return errorResponse('page must be a positive safe integer.', 400);
    }

    const filters: string[] = [];
    const values: Array<string | number> = [];

    const stationIdParam = singleQueryValue(search, 'station_id');
    if (stationIdParam === undefined) {
      return errorResponse('station_id must not be repeated.', 400);
    }
    if (stationIdParam !== null) {
      const rawStationId = stationIdParam.trim();
      if (!rawStationId || rawStationId.length > 50) {
        return errorResponse('station_id must be a non-empty string of at most 50 characters.', 400);
      }
      const stationId = /^\d+$/.test(rawStationId) && Number.isSafeInteger(Number(rawStationId))
        ? `Station ${Number(rawStationId)}`
        : rawStationId;
      filters.push('station_id = ?');
      values.push(stationId);
    }

    const stationName = singleQueryValue(search, 'station_name');
    if (stationName === undefined) {
      return errorResponse('station_name must not be repeated.', 400);
    }
    if (stationName !== null) {
      const normalized = stationName.trim();
      if (!normalized || normalized.length > 100) {
        return errorResponse('station_name must be a non-empty string of at most 100 characters.', 400);
      }
      filters.push('station_name = ?');
      values.push(normalized);
    }

    for (const [parameter, operator] of [['start_date', '>='], ['end_date', '<=']] as const) {
      const value = singleQueryValue(search, parameter);
      if (value === undefined) {
        return errorResponse(`${parameter} must not be repeated.`, 400);
      }
      if (value === null) continue;
      if (!validDate(value)) {
        return errorResponse(`${parameter} must be a valid date in YYYY-MM-DD format.`, 400);
      }
      filters.push(`\`date\` ${operator} ?`);
      values.push(value);
    }

    const startDate = search.get('start_date');
    const endDate = search.get('end_date');
    if (startDate && endDate && startDate > endDate) {
      return errorResponse('start_date must be on or before end_date.', 400);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM flood_data ${whereClause}`,
      values,
    );
    const total = Number((countRows as Array<{ total: number | string }>)[0].total);
    const offset = (page - 1) * limit;
    const [rows] = await pool.execute(
      `SELECT * FROM flood_data ${whereClause}
       ORDER BY \`date\` DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );

    return Response.json({
      data: (rows as FloodRecord[]).map((row) => ({
        ...row,
        risk_level: calculateRisk(row),
      })),
      pagination: {
        total,
        limit,
        page,
        total_pages: Math.ceil(total / limit),
      },
    });
  });
}
