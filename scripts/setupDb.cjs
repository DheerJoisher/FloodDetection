const pool = require('./db.cjs');
const fs = require('node:fs');
const path = require('node:path');

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
  `CREATE TABLE IF NOT EXISTS station_metadata (
    station_id VARCHAR(50) NOT NULL,
    dataset_station_name VARCHAR(100) NOT NULL,
    canonical_station_name VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    district VARCHAR(100) NULL,
    river VARCHAR(100) NULL,
    tributary VARCHAR(100) NULL,
    sub_basin VARCHAR(100) NULL,
    latitude DECIMAL(9,6) NULL,
    longitude DECIMAL(9,6) NULL,
    catchment_area_km2 DECIMAL(12,3) NULL,
    station_type VARCHAR(20) NULL,
    seasonal_flag BOOLEAN NOT NULL DEFAULT FALSE,
    cwc_site_code VARCHAR(50) NULL,
    source VARCHAR(255) NULL,
    source_reference VARCHAR(255) NULL,
    source_confidence VARCHAR(30) NOT NULL DEFAULT 'unknown',
    purpose VARCHAR(20) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (station_id),
    KEY idx_station_metadata_canonical_name (canonical_station_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS station_predictions (
    prediction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    station_id VARCHAR(50) NOT NULL,
    feature_date DATE NOT NULL,
    target_date DATE NULL,
    predicted_class VARCHAR(20) NULL,
    probability_low DOUBLE NULL,
    probability_moderate DOUBLE NULL,
    probability_high DOUBLE NULL,
    confidence DOUBLE NULL,
    prediction_status VARCHAR(30) NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    input_latest_observation_date DATE NULL,
    data_coverage VARCHAR(30) NOT NULL,
    status_reason TEXT NULL,
    PRIMARY KEY (prediction_id),
    UNIQUE KEY uq_station_prediction_run (
      station_id,
      feature_date,
      model_version
    ),
    KEY idx_station_predictions_feature_date (feature_date),
    KEY idx_station_predictions_status (prediction_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS prediction_runs (
    run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    feature_date DATE NOT NULL,
    target_date DATE NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    status VARCHAR(20) NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    configured_station_count INT UNSIGNED NOT NULL DEFAULT 0,
    successful_prediction_count INT UNSIGNED NOT NULL DEFAULT 0,
    insufficient_history_count INT UNSIGNED NOT NULL DEFAULT 0,
    failure_count INT UNSIGNED NOT NULL DEFAULT 0,
    cumulative_risk_result JSON NULL,
    regional_impact_result JSON NULL,
    alert_decision_result JSON NULL,
    error_summary TEXT NULL,
    PRIMARY KEY (run_id),
    UNIQUE KEY uq_prediction_run_feature_model (feature_date, model_version),
    KEY idx_prediction_runs_status (status),
    KEY idx_prediction_runs_feature_date (feature_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS project_alert_events (
    alert_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alert_identity VARCHAR(255) NOT NULL,
    alert_type VARCHAR(50) NOT NULL DEFAULT 'PROJECT_EARLY_WARNING',
    lifecycle_state VARCHAR(30) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    feature_date DATE NOT NULL,
    target_date DATE NOT NULL,
    confidence DOUBLE NULL,
    coverage DOUBLE NULL,
    uncertainty VARCHAR(20) NOT NULL,
    supporting_stations JSON NULL,
    supporting_systems JSON NULL,
    affected_states JSON NULL,
    affected_districts JSON NULL,
    supporting_evidence JSON NULL,
    run_id BIGINT UNSIGNED NULL,
    model_version VARCHAR(100) NOT NULL,
    headline VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    recommended_action TEXT NULL,
    disclaimer TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    PRIMARY KEY (alert_id),
    UNIQUE KEY uq_project_alert_identity (alert_identity),
    KEY idx_project_alert_events_target (target_date),
    KEY idx_project_alert_events_state (lifecycle_state),
    KEY idx_project_alert_events_severity (severity),
    CONSTRAINT fk_project_alert_run FOREIGN KEY (run_id)
      REFERENCES prediction_runs(run_id)
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS project_alert_transitions (
    transition_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alert_id BIGINT UNSIGNED NOT NULL,
    run_id BIGINT UNSIGNED NULL,
    previous_state VARCHAR(30) NULL,
    new_state VARCHAR(30) NOT NULL,
    previous_severity VARCHAR(20) NULL,
    new_severity VARCHAR(20) NOT NULL,
    feature_date DATE NOT NULL,
    target_date DATE NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (transition_id),
    KEY idx_project_alert_transitions_alert (alert_id),
    CONSTRAINT fk_project_alert_transition_event FOREIGN KEY (alert_id)
      REFERENCES project_alert_events(alert_id)
      ON DELETE CASCADE,
    CONSTRAINT fk_project_alert_transition_run FOREIGN KEY (run_id)
      REFERENCES prediction_runs(run_id)
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function setupDatabase() {
  const password = process.env.DB_PASSWORD;
  if (!password || password === 'YOUR_MYSQL_PASSWORD') {
    throw new Error('Set your actual DB_PASSWORD in .env.local before running database commands.');
  }

  try {
    for (const statement of schema) {
      await pool.query(statement);
    }
    const [subBasinColumns] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'station_metadata' AND COLUMN_NAME = 'sub_basin'`,
      [process.env.DB_NAME || 'flood_management'],
    );
    if (subBasinColumns.length === 0) {
      await pool.query(
        'ALTER TABLE station_metadata ADD COLUMN sub_basin VARCHAR(100) NULL AFTER tributary',
      );
    }
    const [metadataColumns] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'station_metadata'`,
      [process.env.DB_NAME || 'flood_management'],
    );
    const metadataColumnNames = new Set(metadataColumns.map((row) => row.COLUMN_NAME));
    if (!metadataColumnNames.has('source_reference')) {
      await pool.query(
        'ALTER TABLE station_metadata ADD COLUMN source_reference VARCHAR(255) NULL AFTER source',
      );
    }
    if (!metadataColumnNames.has('purpose')) {
      await pool.query(
        'ALTER TABLE station_metadata ADD COLUMN purpose VARCHAR(20) NULL AFTER source_confidence',
      );
    }
    const metadataPath = path.resolve(__dirname, '..', 'src', 'data', 'station-metadata.json');
    const stations = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    for (const station of stations) {
      await pool.execute(
        `INSERT INTO station_metadata (
          station_id, dataset_station_name, canonical_station_name, state, district,
          river, tributary, sub_basin, latitude, longitude, catchment_area_km2, station_type,
          seasonal_flag, cwc_site_code, source, source_reference, source_confidence, purpose
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          dataset_station_name = VALUES(dataset_station_name),
          canonical_station_name = VALUES(canonical_station_name),
          state = VALUES(state),
          district = VALUES(district),
          river = VALUES(river),
          tributary = VALUES(tributary),
          sub_basin = VALUES(sub_basin),
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          catchment_area_km2 = VALUES(catchment_area_km2),
          station_type = VALUES(station_type),
          seasonal_flag = VALUES(seasonal_flag),
          cwc_site_code = VALUES(cwc_site_code),
          source = VALUES(source),
          source_reference = VALUES(source_reference),
          source_confidence = VALUES(source_confidence),
          purpose = VALUES(purpose)`,
        [
          station.station_id,
          station.dataset_station_name,
          station.canonical_station_name,
          station.state,
          station.district,
          station.river,
          station.tributary,
          station.sub_basin,
          station.latitude,
          station.longitude,
          station.catchment_area_km2,
          station.station_type,
          station.seasonal_flag,
          station.cwc_site_code,
          station.source,
          station.source_reference,
          station.source_confidence,
          station.purpose,
        ],
      );
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
