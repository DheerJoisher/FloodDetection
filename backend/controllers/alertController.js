const pool = require('../config/db');

const riskLevels = new Set(['LOW', 'MODERATE', 'HIGH']);

async function getAlerts(req, res) {
  const [rows] = await pool.execute(
    `SELECT id, title, message, risk_level, station_name, created_at
     FROM alerts
     ORDER BY created_at DESC, id DESC`,
  );
  return res.json({ data: rows });
}

async function createAlert(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Request body must be a JSON object.' });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const riskLevel = typeof body.risk_level === 'string' ? body.risk_level.trim().toUpperCase() : '';
  const stationName = body.station_name === undefined || body.station_name === null
    ? null
    : typeof body.station_name === 'string' ? body.station_name.trim() : undefined;

  if (!title || !message || !riskLevel) {
    return res.status(400).json({ message: 'title, message, and risk_level are required.' });
  }
  if (title.length > 150) {
    return res.status(400).json({ message: 'title must be at most 150 characters.' });
  }
  if (Buffer.byteLength(message, 'utf8') > 65535) {
    return res.status(400).json({ message: 'message is too long.' });
  }
  if (!riskLevels.has(riskLevel)) {
    return res.status(400).json({ message: 'risk_level must be LOW, MODERATE, or HIGH.' });
  }
  if (stationName === undefined || (stationName !== null && stationName.length > 100)) {
    return res.status(400).json({ message: 'station_name must be a string of at most 100 characters.' });
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
    [result.insertId],
  );
  return res.status(201).json(rows[0]);
}

async function deleteAlert(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
    return res.status(400).json({ message: 'id must be a positive safe integer.' });
  }

  const [result] = await pool.execute('DELETE FROM alerts WHERE id = ?', [Number(req.params.id)]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Alert not found.' });
  }
  return res.json({ message: 'Alert deleted.' });
}

module.exports = { getAlerts, createAlert, deleteAlert };
