const pool = require('../config/database');
const logger = require('../config/logger');

/**
 * Migration idempotente du module Capteurs CAV LoRaWAN (Milesight EM400-MUD via Orange Live Objects).
 * Appelée au démarrage depuis index.js (comme migrate-exutoires, migrate-finance).
 * Toutes les opérations sont IF NOT EXISTS / DO $$ BEGIN … EXCEPTION.
 */
async function migrateCavSensors() {
  const client = await pool.connect();
  try {
    // Colonnes supplémentaires sur la table cav
    const cavColumns = [
      ['lora_deveui', 'VARCHAR(23)'],
      ['lora_appeui', 'VARCHAR(23)'],
      ['lora_appkey_encrypted', 'TEXT'],
      ['sensor_height_cm', 'INTEGER'],
      ['sensor_install_date', 'DATE'],
      ['sensor_reporting_interval_min', 'INTEGER DEFAULT 360'],
      ['sensor_status', "VARCHAR(20) DEFAULT 'inactive'"],
      ['sensor_battery_level', 'DOUBLE PRECISION'],
      ['sensor_last_rssi', 'INTEGER'],
    ];
    for (const [col, def] of cavColumns) {
      await client.query(
        `DO $$ BEGIN ALTER TABLE cav ADD COLUMN ${col} ${def}; EXCEPTION WHEN duplicate_column THEN NULL; END $$`
      );
    }
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_cav_lora_deveui ON cav(lora_deveui) WHERE lora_deveui IS NOT NULL'
    );

    // Colonnes supplémentaires sur cav_sensor_readings (diagnostic radio + alertes)
    const readingCols = [
      ['snr', 'DOUBLE PRECISION'],
      ['sf', 'SMALLINT'],
      ['fport', 'SMALLINT'],
      ['fcnt', 'INTEGER'],
      ['tilt_detected', 'BOOLEAN DEFAULT false'],
      ['alarm_type', 'VARCHAR(30)'],
    ];
    for (const [col, def] of readingCols) {
      await client.query(
        `DO $$ BEGIN ALTER TABLE cav_sensor_readings ADD COLUMN ${col} ${def}; EXCEPTION WHEN duplicate_column THEN NULL; END $$`
      );
    }

    // Assouplir le CHECK fill_level_percent pour tolérer la saturation 100-120%
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE cav_sensor_readings DROP CONSTRAINT IF EXISTS cav_sensor_readings_fill_level_percent_check;
      EXCEPTION WHEN undefined_object THEN NULL; END $$
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE cav_sensor_readings
          ADD CONSTRAINT cav_sensor_readings_fill_level_percent_check
          CHECK (fill_level_percent BETWEEN 0 AND 120);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // Table cav_sensor_alerts
    await client.query(`
      CREATE TABLE IF NOT EXISTS cav_sensor_alerts (
        id SERIAL PRIMARY KEY,
        cav_id INTEGER NOT NULL REFERENCES cav(id) ON DELETE CASCADE,
        reading_id INTEGER REFERENCES cav_sensor_readings(id) ON DELETE SET NULL,
        alert_type VARCHAR(30) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'warning',
        message TEXT,
        triggered_at TIMESTAMP NOT NULL DEFAULT NOW(),
        acknowledged_at TIMESTAMP,
        acknowledged_by INTEGER REFERENCES users(id),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_sensor_alerts_cav_open ON cav_sensor_alerts(cav_id) WHERE resolved_at IS NULL'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_sensor_alerts_type ON cav_sensor_alerts(alert_type, triggered_at DESC)'
    );

    // Enrichir collection_learning_feedback pour distinguer la source (capteur vs manuel)
    // et capturer la valeur exacte 0-120 % remontée par le capteur.
    const feedbackCols = [
      ['source', "VARCHAR(20) DEFAULT 'manual'"],
      ['observed_fill_rate', 'DOUBLE PRECISION'],
    ];
    for (const [col, def] of feedbackCols) {
      await client.query(
        `DO $$ BEGIN ALTER TABLE collection_learning_feedback ADD COLUMN ${col} ${def}; EXCEPTION WHEN duplicate_column THEN NULL; END $$`
      );
    }

    logger.info('Migration CAV Sensors (LoRaWAN) appliquée');
  } finally {
    client.release();
  }
}

module.exports = { migrateCavSensors };
