const pool = require('../config/db');
const { calculateRisk } = require('../utils/riskLevel');

async function getDashboardStats(req, res) {
  const [summaryRows] = await pool.execute(
    `SELECT COUNT(*) AS total_records,
            COUNT(DISTINCT station_id) AS station_count
     FROM flood_data`,
  );
  const summary = summaryRows[0];
  const [latestRows] = await pool.execute(
    `SELECT \`date\`, station_id, station_name, waterlevel, discharge, rain
     FROM flood_data
     ORDER BY \`date\` DESC, id DESC
     LIMIT 1`,
  );
  const latest = latestRows[0] || null;

  return res.json({
    total_records: Number(summary.total_records),
    station_count: Number(summary.station_count),
    latest_date: latest ? latest.date : null,
    latest_waterlevel: latest ? latest.waterlevel : null,
    latest_discharge: latest ? latest.discharge : null,
    latest_rainfall: latest ? latest.rain : null,
    latest_risk_level: latest ? calculateRisk(latest) : null,
    latest_station_id: latest ? latest.station_id : null,
    latest_station_name: latest ? latest.station_name : null,
  });
}

module.exports = { getDashboardStats };
