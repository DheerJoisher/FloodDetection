const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS flood_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`date\` DATE NOT NULL,
    doy SMALLINT UNSIGNED NULL,
    waterlevel DECIMAL(10,2) NULL,
    discharge DECIMAL(12,2) NULL,
    T2M DECIMAL(7,2) NULL,
    RH2M DECIMAL(7,2) NULL,
    PS DECIMAL(7,2) NULL,
    WS2M DECIMAL(7,2) NULL,
    GWETTOP DECIMAL(5,2) NULL,
    GWETROOT DECIMAL(5,2) NULL,
    GWETPROF DECIMAL(5,2) NULL,
    rain DECIMAL(8,2) NULL,
    tmin DECIMAL(7,2) NULL,
    tmax DECIMAL(7,2) NULL,
    station_name VARCHAR(100) NULL,
    station_id VARCHAR(50) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_flood_data_station_date (station_id, \`date\`),
    KEY idx_flood_data_date (\`date\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    risk_level VARCHAR(30) NOT NULL,
    station_name VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function setupDatabase() {
  const password = process.env.DB_PASSWORD;
  if (!password || password === 'YOUR_MYSQL_PASSWORD') {
    throw new Error('Set your actual DB_PASSWORD in backend/.env before running database commands.');
  }

  const pool = require('../config/db');
  try {
    for (const statement of schema) {
      await pool.query(statement);
    }
    console.log('Database tables are ready in the configured database.');
  } finally {
    await pool.end();
  }
}

setupDatabase().catch((error) => {
  console.error('Database setup failed:', error.message);
  process.exitCode = 1;
});
