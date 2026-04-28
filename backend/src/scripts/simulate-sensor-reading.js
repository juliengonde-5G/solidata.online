#!/usr/bin/env node
/**
 * Simule un uplink capteur Milesight EM400-MUD sans matériel réel.
 *
 * Usages :
 *   node src/scripts/simulate-sensor-reading.js --cav-id=1 --fill=75
 *   node src/scripts/simulate-sensor-reading.js --dev-eui=24E124A1B2C3D4E5 --distance=50
 *   node src/scripts/simulate-sensor-reading.js --cav-id=1 --fill=96 --battery=15 --tilt
 *
 * Par défaut : POST direct au webhook local (/api/webhooks/liveobjects/uplink)
 * avec le header X-Webhook-Secret issu de LIVEOBJECTS_WEBHOOK_SECRET.
 *
 * Options :
 *   --cav-id=<id>        ID CAV (résolu par sensor_reference pour compat)
 *   --dev-eui=<hex>      DevEUI LoRaWAN (prioritaire si fourni)
 *   --fill=<pct>         Force le % de remplissage (0-120)
 *   --distance=<cm>      Distance capteur→fond (converti via sensor_height_cm du CAV)
 *   --battery=<pct>      Batterie 0-100 (défaut 95)
 *   --temperature=<°C>   Température (défaut 18.5)
 *   --tilt               Capteur basculé
 *   --url=<url>          Override de l'URL (défaut http://localhost:3001/api/webhooks/liveobjects/uplink)
 */
require('dotenv').config();
const http = require('http');
const https = require('https');
const url = require('url');
const { encodeTestPayload } = require('../utils/milesight-em400mud');
const pool = require('../config/database');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.slice(2).split('=');
    args[k] = v == null ? true : v;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const targetUrl = args.url || 'http://localhost:3001/api/webhooks/liveobjects/uplink';
  const secret = process.env.LIVEOBJECTS_WEBHOOK_SECRET;
  if (!secret) {
    console.error('LIVEOBJECTS_WEBHOOK_SECRET manquant dans .env');
    process.exit(1);
  }

  // Résoudre le DevEUI à injecter dans le payload simulé
  let devEui = args['dev-eui'] || args.devEui;
  if (!devEui && args['cav-id']) {
    const r = await pool.query('SELECT lora_deveui, sensor_reference FROM cav WHERE id = $1', [args['cav-id']]);
    if (r.rows.length === 0) {
      console.error(`CAV #${args['cav-id']} introuvable`);
      process.exit(2);
    }
    devEui = r.rows[0].lora_deveui || 'SIMULATED-0000000000000001';
  }
  if (!devEui) devEui = 'SIMULATED-0000000000000001';

  // Calcul de la distance simulée si --fill fourni
  let distance_mm = null;
  if (args.distance != null) {
    distance_mm = parseFloat(args.distance) * 10;
  } else if (args.fill != null && args['cav-id']) {
    const r = await pool.query('SELECT sensor_height_cm FROM cav WHERE id = $1', [args['cav-id']]);
    const h = r.rows[0]?.sensor_height_cm || 200;
    distance_mm = h * (1 - parseFloat(args.fill) / 100) * 10;
  } else if (args.fill != null) {
    // Pas de CAV connu → on force un fill_level_percent brut (format aplati)
    distance_mm = null;
  }

  const battery = args.battery != null ? parseInt(args.battery, 10) : 95;
  const temperature = args.temperature != null ? parseFloat(args.temperature) : 18.5;
  const tilt = !!args.tilt;

  let body;
  if (distance_mm != null) {
    // Format Live Objects complet avec payload hex TLV valide
    const payloadHex = encodeTestPayload({ battery, distance_mm, temperature, tilt });
    body = {
      streamId: `urn:lora:${devEui}!uplink`,
      timestamp: new Date().toISOString(),
      model: 'lora_v0',
      value: {
        payload: payloadHex,
        port: 85,
        fcnt: Math.floor(Math.random() * 1000),
        rssi: -95 - Math.floor(Math.random() * 20),
        snr: 7 + Math.random() * 3,
        sf_used: 9,
      },
      metadata: {
        source: `urn:lora:${devEui}`,
        network: { lora: { devEUI: devEui } },
      },
    };
  } else {
    // Format aplati — utile pour forcer une valeur sans calibration
    body = {
      sensor_reference: args['sensor-reference'] || devEui,
      fill_level_percent: parseFloat(args.fill),
      battery_level: battery,
      temperature,
      rssi: -95,
    };
  }

  const parsed = url.parse(targetUrl);
  const client = parsed.protocol === 'https:' ? https : http;
  const data = JSON.stringify(body);

  await new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Webhook-Secret': secret,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          console.log(`HTTP ${res.statusCode}: ${buf}`);
          resolve();
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
