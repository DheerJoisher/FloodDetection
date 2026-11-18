const pool = require('../config/db');
const { calculateRisk } = require('../utils/riskLevel');

const maximumLimit = 100;

function parsePositiveInteger(value, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function withRiskLevel(rows) {
  return rows.map((row) => ({ ...row, risk_level: calculateRisk(row) }));
}

async function getFloodData(req, res) {
  const limit = parsePositiveInteger(req.query.limit, 20, maximumLimit);
  const page = parsePositiveInteger(req.query.page, 1);
  if (limit === null) {
    return res.status(400).json({ message: `limit must be an integer from 1 to ${maximumLimit}.` });
  }
  if (page === null || (page - 1) * limit > Number.MAX_SAFE_INTEGER) {
    return res.status(400).json({ message: 'page must be a positive safe integer.' });
  }

  const filters = [];
  const parameters = [];

  if (req.query.station_id !== undefined) {
    if (typeof req.query.station_id !== 'string' || req.query.station_id.trim().length === 0) {
      return res.status(400).json({ message: 'station_id must be a non-empty string.' });
    }
    const rawStationId = req.query.station_id.trim();
    if (rawStationId.length > 50) {
      return res.status(400).json({ message: 'station_id must be at most 50 characters.' });
    }
    const stationId = /^\d+$/.test(rawStationId) ? `Station ${Number(rawStationId)}` : rawStationId;
    filters.push('station_id = ?');
    parameters.push(stationId);
  }

  if (req.query.station_name !== undefined) {
    if (typeof req.query.station_name !== 'string' || req.query.station_name.trim().length === 0) {
      return res.status(400).json({ message: 'station_name must be a non-empty string.' });
    }
    const stationName = req.query.station_name.trim();
    if (stationName.length > 100) {
      return res.status(400).json({ message: 'station_name must be at most 100 characters.' });
    }
    filters.push('station_name = ?');
    parameters.push(stationName);
  }

  for (const [parameter, operator] of [['start_date', '>='], ['end_date', '<=']]) {
    const value = req.query[parameter];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string' || !isValidDate(value)) {
      return res.status(400).json({ message: `${parameter} must be a valid date in YYYY-MM-DD format.` });
    }
    filters.push(`\`date\` ${operator} ?`);
    parameters.push(value);
  }

  if (req.query.start_date && req.query.end_date && req.query.start_date > req.query.end_date) {
    return res.status(400).json({ message: 'start_date must be on or before end_date.' });
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM flood_data ${whereClause}`,
    parameters,
  );
  const total = Number(countRows[0].total);
  const offset = (page - 1) * limit;
  const [rows] = await pool.execute(
    `SELECT * FROM flood_data ${whereClause}
     ORDER BY \`date\` DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...parameters, limit, offset],
  );

  return res.json({
    data: withRiskLevel(rows),
    pagination: {
      total,
      limit,
      page,
      total_pages: Math.ceil(total / limit),
    },
  });
}

async function getLatestFloodData(req, res) {
  const [rows] = await pool.execute(
    `SELECT * FROM flood_data
     ORDER BY \`date\` DESC, id DESC
     LIMIT 1`,
  );
  if (rows.length === 0) {
    return res.status(404).json({ message: 'No flood records are available.' });
  }
  return res.json({ ...rows[0], risk_level: calculateRisk(rows[0]) });
}

async function getFloodDataById(req, res) {
  const id = parsePositiveInteger(req.params.id, null);
  if (id === null) {
    return res.status(400).json({ message: 'id must be a positive safe integer.' });
  }

  const [rows] = await pool.execute('SELECT * FROM flood_data WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ message: 'Flood record not found.' });
  }
  return res.json({ ...rows[0], risk_level: calculateRisk(rows[0]) });
}

module.exports = { getFloodData, getLatestFloodData, getFloodDataById };
