const pool = require('../config/db');

async function getStations(req, res) {
  const [rows] = await pool.execute(
    `SELECT station_id, station_name
     FROM flood_data
     GROUP BY station_id, station_name
     ORDER BY station_id`,
  );
  return res.json({ data: rows });
}

module.exports = { getStations };
