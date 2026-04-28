/**
 * Worker MQTT Orange Live Objects (LoRaWAN uplinks capteurs CAV).
 *
 * Se connecte au broker Live Objects, s'abonne à la FIFO configurée et
 * traite chaque message via processUplink() — même chemin que le webhook HTTP.
 *
 * Activé uniquement si LIVEOBJECTS_ENABLED=true et si les credentials sont fournis.
 * Reconnexion automatique gérée par la lib `mqtt`. Silencieux si la dépendance
 * `mqtt` n'est pas installée (pour permettre les builds de dev minimaux).
 */
const logger = require('../config/logger');
const { processUplink } = require('./liveobjects-processor');

let client = null;
let reconnectAttempts = 0;

function startLiveObjectsMqtt(io) {
  if (process.env.LIVEOBJECTS_ENABLED !== 'true') {
    logger.info('LiveObjects MQTT : désactivé (LIVEOBJECTS_ENABLED != true)');
    return null;
  }

  const mqttUrl = process.env.LIVEOBJECTS_MQTT_URL || 'mqtts://liveobjects.orange-business.com:8883';
  const apiKey = process.env.LIVEOBJECTS_API_KEY;
  const fifoName = process.env.LIVEOBJECTS_FIFO_NAME;

  if (!apiKey || !fifoName) {
    logger.warn('LiveObjects MQTT : LIVEOBJECTS_API_KEY ou LIVEOBJECTS_FIFO_NAME manquant, worker non démarré');
    return null;
  }

  let mqtt;
  try {
    mqtt = require('mqtt');
  } catch (err) {
    logger.warn('LiveObjects MQTT : dépendance `mqtt` non installée (npm i mqtt)');
    return null;
  }

  const topic = `fifo/${fifoName}`;
  logger.info(`LiveObjects MQTT : connexion à ${mqttUrl}, topic=${topic}`);

  client = mqtt.connect(mqttUrl, {
    username: 'application',
    password: apiKey,
    reconnectPeriod: 5000,
    connectTimeout: 20000,
    clean: true,
    rejectUnauthorized: true,
  });

  client.on('connect', () => {
    reconnectAttempts = 0;
    logger.info('LiveObjects MQTT : connecté');
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) logger.error('LiveObjects MQTT : échec subscribe', { error: err.message, topic });
      else logger.info(`LiveObjects MQTT : abonné à ${topic}`);
    });
  });

  client.on('reconnect', () => {
    reconnectAttempts += 1;
    if (reconnectAttempts <= 5 || reconnectAttempts % 12 === 0) {
      logger.warn(`LiveObjects MQTT : reconnexion #${reconnectAttempts}`);
    }
  });

  client.on('error', (err) => {
    logger.error('LiveObjects MQTT : erreur', { error: err.message });
  });

  client.on('close', () => {
    logger.debug('LiveObjects MQTT : connexion fermée');
  });

  client.on('message', async (receivedTopic, payloadBuf) => {
    let raw;
    try {
      raw = JSON.parse(payloadBuf.toString('utf8'));
    } catch (err) {
      logger.warn('LiveObjects MQTT : payload non-JSON ignoré', { topic: receivedTopic });
      return;
    }
    try {
      await processUplink(raw, io);
    } catch (err) {
      logger.error('LiveObjects MQTT : échec processUplink', { error: err.message });
    }
  });

  return client;
}

function stopLiveObjectsMqtt() {
  if (client) {
    client.end(true);
    client = null;
  }
}

module.exports = { startLiveObjectsMqtt, stopLiveObjectsMqtt };
