const pool = require('../config/database');
const logger = require('../config/logger');
const { decode, computeFillPercent } = require('../utils/milesight-em400mud');

/**
 * Orchestrateur central des uplinks capteur, appelé depuis :
 *  - le webhook HTTP /api/webhooks/liveobjects/uplink
 *  - le worker MQTT Live Objects (liveobjects-mqtt.js)
 *  - la route historique POST /api/cav/sensor-reading (compat)
 *
 * Étapes : résolution du CAV (par devEUI en priorité, fallback sensor_reference),
 * décodage du payload, insertion reading + update cav + feedback prédictif + alertes
 * + émission Socket.IO.
 */

const ALARM_THRESHOLDS = {
  BATTERY_LOW: 20,      // %
  TEMP_HIGH: 60,        // °C
  TEMP_LOW: -10,        // °C
  FILL_WARNING: 80,     // %
  FILL_CRITICAL: 95,    // %
};

/**
 * Extrait les champs utiles d'un `dataMessage` Orange Live Objects (format LoRaWAN).
 * Tolère aussi un shape simplifié (déjà aplati) utilisé par notre webhook historique.
 */
function normalizeLiveObjectsUplink(raw) {
  if (!raw) return null;

  // Format 1 : payload déjà aplati (compat webhook historique)
  //   { sensor_reference, fill_level_percent, distance_cm, battery_level, temperature, rssi, raw_data }
  if (raw.fill_level_percent != null || raw.sensor_reference) {
    return {
      devEui: null,
      sensorReference: raw.sensor_reference,
      fillLevelPrecomputed: raw.fill_level_percent,
      distanceCm: raw.distance_cm,
      battery: raw.battery_level,
      temperature: raw.temperature,
      rssi: raw.rssi,
      snr: null,
      sf: null,
      fport: null,
      fcnt: null,
      tiltDetected: false,
      alarmType: null,
      readingAt: raw.reading_at ? new Date(raw.reading_at) : new Date(),
      rawSource: raw.raw_data || null,
    };
  }

  // Format 2 : dataMessage Live Objects (LoRa)
  const payloadHex = raw.value?.payload || raw.payload || null;
  const fport = raw.value?.port ?? raw.port ?? null;
  const lora = raw.metadata?.network?.lora || raw.lora || {};
  const devEui = lora.devEUI || lora.devEui || raw.devEui || raw.devEUI || null;
  const timestamp = raw.timestamp ? new Date(raw.timestamp) : new Date();

  let decoded = { battery: null, distance_mm: null, temperature: null, tilt_detected: false, alarm_type: null, raw: {} };
  try {
    if (payloadHex) decoded = decode(fport, payloadHex);
  } catch (err) {
    logger.warn('LiveObjects: décodage payload échoué', { error: err.message, devEui, payloadHex });
  }

  return {
    devEui,
    sensorReference: null,
    fillLevelPrecomputed: null,
    distanceCm: decoded.distance_mm != null ? decoded.distance_mm / 10 : null,
    battery: decoded.battery,
    temperature: decoded.temperature,
    rssi: raw.value?.rssi ?? lora.rssi ?? null,
    snr: raw.value?.snr ?? lora.snr ?? null,
    sf: raw.value?.sf_used ?? lora.sf ?? null,
    fport,
    fcnt: raw.value?.fcnt ?? lora.fcnt ?? null,
    tiltDetected: decoded.tilt_detected,
    alarmType: decoded.alarm_type,
    readingAt: timestamp,
    rawSource: raw,
  };
}

/**
 * Résout l'ID CAV à partir du devEUI (priorité) ou du sensor_reference (fallback).
 */
async function resolveCav({ devEui, sensorReference }) {
  if (devEui) {
    const r = await pool.query(
      'SELECT id, sensor_reference, sensor_height_cm, sensor_reporting_interval_min, estimated_fill_rate FROM cav WHERE lora_deveui = $1 LIMIT 1',
      [devEui]
    );
    if (r.rows.length > 0) return r.rows[0];
  }
  if (sensorReference) {
    const r = await pool.query(
      'SELECT id, sensor_reference, sensor_height_cm, sensor_reporting_interval_min, estimated_fill_rate FROM cav WHERE sensor_reference = $1 LIMIT 1',
      [sensorReference]
    );
    if (r.rows.length > 0) return r.rows[0];
  }
  return null;
}

/**
 * Évalue les seuils d'alerte à partir d'une lecture décodée + CAV.
 * Retourne un tableau d'alertes à ouvrir.
 */
function evaluateAlerts({ fillPercent, battery, temperature, tiltDetected, alarmType }) {
  const alerts = [];
  if (alarmType) {
    alerts.push({ type: alarmType, severity: 'warning' });
  }
  if (tiltDetected && !alerts.some((a) => a.type === 'tilt')) {
    alerts.push({ type: 'tilt', severity: 'critical' });
  }
  if (fillPercent != null && fillPercent >= ALARM_THRESHOLDS.FILL_CRITICAL) {
    alerts.push({ type: 'threshold_95', severity: 'critical' });
  } else if (fillPercent != null && fillPercent >= ALARM_THRESHOLDS.FILL_WARNING) {
    alerts.push({ type: 'threshold_80', severity: 'warning' });
  }
  if (battery != null && battery <= ALARM_THRESHOLDS.BATTERY_LOW) {
    alerts.push({ type: 'low_battery', severity: 'warning' });
  }
  if (temperature != null && temperature >= ALARM_THRESHOLDS.TEMP_HIGH) {
    alerts.push({ type: 'temp_high', severity: 'critical' });
  } else if (temperature != null && temperature <= ALARM_THRESHOLDS.TEMP_LOW) {
    alerts.push({ type: 'temp_low', severity: 'warning' });
  }
  // Dédoublonnage par type
  const seen = new Set();
  return alerts.filter((a) => (seen.has(a.type) ? false : seen.add(a.type)));
}

/**
 * Traite un uplink (tout format). Retourne l'objet lecture stocké ou null si CAV introuvable.
 * @param {object} rawUplink — message brut (Live Objects, webhook, ou objet aplati)
 * @param {object} io — instance Socket.IO (optionnelle)
 */
async function processUplink(rawUplink, io) {
  const uplink = normalizeLiveObjectsUplink(rawUplink);
  if (!uplink) {
    logger.warn('LiveObjects: uplink vide ou non reconnu');
    return null;
  }

  const cav = await resolveCav(uplink);
  if (!cav) {
    logger.warn('LiveObjects: CAV introuvable pour uplink', {
      devEui: uplink.devEui,
      sensorReference: uplink.sensorReference,
    });
    return { error: 'cav_not_found', devEui: uplink.devEui };
  }

  // Calcul du fill_level
  let fillPercent = uplink.fillLevelPrecomputed;
  if (fillPercent == null && uplink.distanceCm != null && cav.sensor_height_cm) {
    fillPercent = computeFillPercent(uplink.distanceCm, cav.sensor_height_cm);
  }
  if (fillPercent == null) {
    logger.warn('LiveObjects: fill_level non calculable (distance ou hauteur manquante)', {
      cavId: cav.id,
      distanceCm: uplink.distanceCm,
      sensorHeight: cav.sensor_height_cm,
    });
    return { error: 'fill_not_computable', cav_id: cav.id };
  }
  fillPercent = Math.max(0, Math.min(120, fillPercent));

  const sensorRef = cav.sensor_reference || uplink.devEui || 'unknown';
  const previousFill = cav.estimated_fill_rate;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Déduplication : si on a déjà une lecture avec ce (cav_id, fcnt), on ignore.
    // Cas typique : webhook HTTP Push + MQTT FIFO actifs en même temps → chaque uplink
    // arrive en double. Le fcnt LoRaWAN est un compteur monotone unique par device.
    if (uplink.fcnt != null) {
      const dup = await client.query(
        'SELECT id FROM cav_sensor_readings WHERE cav_id = $1 AND fcnt = $2 LIMIT 1',
        [cav.id, uplink.fcnt]
      );
      if (dup.rows.length > 0) {
        await client.query('COMMIT');
        logger.debug('LiveObjects: uplink déjà reçu (dedup fcnt)', {
          cavId: cav.id, fcnt: uplink.fcnt,
        });
        return { ok: true, deduplicated: true, cav_id: cav.id, reading_id: dup.rows[0].id, fill_level: fillPercent };
      }
    }

    const readingResult = await client.query(
      `INSERT INTO cav_sensor_readings
        (cav_id, sensor_reference, fill_level_percent, distance_cm, battery_level, temperature,
         rssi, snr, sf, fport, fcnt, tilt_detected, alarm_type, raw_data, reading_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        cav.id, sensorRef, fillPercent, uplink.distanceCm, uplink.battery, uplink.temperature,
        uplink.rssi, uplink.snr, uplink.sf, uplink.fport, uplink.fcnt,
        uplink.tiltDetected, uplink.alarmType,
        uplink.rawSource ? JSON.stringify(uplink.rawSource) : null,
        uplink.readingAt,
      ]
    );
    const readingId = readingResult.rows[0].id;

    // UPDATE cav (sensor_last_reading est la source de vérité pour le realtime ; on garde
    // estimated_fill_rate pour le fallback heuristique, donc on ne l'écrase plus ici)
    const batteryLow = uplink.battery != null && uplink.battery <= ALARM_THRESHOLDS.BATTERY_LOW;
    const newStatus = batteryLow ? 'low_battery' : 'active';
    await client.query(
      `UPDATE cav SET
         sensor_last_reading = $1,
         sensor_last_reading_at = $2,
         sensor_battery_level = COALESCE($3, sensor_battery_level),
         sensor_last_rssi = COALESCE($4, sensor_last_rssi),
         sensor_status = $5
       WHERE id = $6`,
      [fillPercent, uplink.readingAt, uplink.battery, uplink.rssi, newStatus, cav.id]
    );

    // Feedback loop : capture l'ancienne heuristique vs la vérité terrain
    if (previousFill != null) {
      try {
        await client.query(
          `INSERT INTO collection_learning_feedback
             (cav_id, predicted_fill_rate, observed_fill_rate, source, created_at)
           VALUES ($1, $2, $3, 'sensor', NOW())`,
          [cav.id, previousFill, fillPercent]
        );
      } catch (err) {
        // Schéma ancien (sans les colonnes source / observed_fill_rate) : on tombe silencieusement
        logger.debug('Feedback loop non alimentée (colonnes absentes ?)', { error: err.message });
      }
    }

    // Alertes
    const alerts = evaluateAlerts({
      fillPercent,
      battery: uplink.battery,
      temperature: uplink.temperature,
      tiltDetected: uplink.tiltDetected,
      alarmType: uplink.alarmType,
    });
    for (const a of alerts) {
      // Ne pas dupliquer une alerte de même type déjà ouverte
      const existing = await client.query(
        `SELECT id FROM cav_sensor_alerts
          WHERE cav_id = $1 AND alert_type = $2 AND resolved_at IS NULL
          LIMIT 1`,
        [cav.id, a.type]
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO cav_sensor_alerts (cav_id, reading_id, alert_type, severity, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [cav.id, readingId, a.type, a.severity, alertMessage(a, fillPercent, uplink)]
        );
      }
    }

    await client.query('COMMIT');

    // Émission Socket.IO
    if (io) {
      io.emit('cav:sensor-reading', {
        cav_id: cav.id,
        fill_level: fillPercent,
        fill_source: 'sensor',
        battery: uplink.battery,
        rssi: uplink.rssi,
        temperature: uplink.temperature,
        tilt: uplink.tiltDetected,
        alarms: alerts.map((a) => a.type),
        timestamp: uplink.readingAt.toISOString(),
      });
    }

    logger.info('LiveObjects: uplink traité', {
      cavId: cav.id,
      fillPercent,
      devEui: uplink.devEui,
      alerts: alerts.length,
    });

    return { ok: true, cav_id: cav.id, reading_id: readingId, fill_level: fillPercent, alerts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('LiveObjects: erreur processUplink', { error: err.message, stack: err.stack });
    throw err;
  } finally {
    client.release();
  }
}

function alertMessage(alert, fillPercent, uplink) {
  switch (alert.type) {
    case 'threshold_80':   return `Remplissage ≥ 80 % (${fillPercent.toFixed(0)} %)`;
    case 'threshold_95':   return `Remplissage critique ≥ 95 % (${fillPercent.toFixed(0)} %)`;
    case 'tilt':           return 'Capteur basculé / CAV renversé';
    case 'temp_high':      return `Température élevée (${uplink.temperature?.toFixed(1)} °C)`;
    case 'temp_low':       return `Température basse (${uplink.temperature?.toFixed(1)} °C)`;
    case 'low_battery':    return `Batterie faible (${uplink.battery} %)`;
    default:               return alert.type;
  }
}

module.exports = { processUplink, normalizeLiveObjectsUplink, ALARM_THRESHOLDS };
