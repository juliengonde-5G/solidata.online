const https = require('https');
const logger = require('../config/logger');

/**
 * Client REST Orange Live Objects — récupération de la liste des devices LoRa.
 * Utilisé par SOLIDATA pour proposer dans l'UI de provisioning un sélecteur
 * pré-rempli à partir des devices déjà déclarés côté Live Objects.
 *
 * Auth : header `X-API-Key` (même clé que le worker MQTT).
 */

const API_HOST = 'liveobjects.orange-business.com';
const API_BASE = '/api/v1';

function httpsRequest(path, apiKey, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      path,
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
      },
      timeout,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (err) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout Live Objects API')); });
    req.end();
  });
}

/**
 * Récupère la liste des devices LoRa avec leur DevEUI, AppEUI, nom, tags, dernier uplink.
 * L'AppKey n'est JAMAIS retournée par l'API Orange (contrainte de sécurité LoRaWAN).
 *
 * Essaie d'abord l'endpoint LoRa dédié (`/lora/devices`) qui expose les champs
 * LoRaWAN en natif, puis retombe sur le générique `/deviceMgt/devices`.
 *
 * @returns {Promise<Array<{devEui, appEui, id, name, tags, group, status, lastUplinkAt, properties}>>}
 */
async function listLoraDevices() {
  const apiKey = process.env.LIVEOBJECTS_API_KEY;
  if (!apiKey) throw new Error('LIVEOBJECTS_API_KEY non configurée');

  // Tentative 1 : endpoint LoRa dédié
  try {
    const res = await httpsRequest(`${API_BASE}/lora/devices?size=500`, apiKey);
    if (res.status === 200 && Array.isArray(res.data)) {
      return res.data.map(normalizeLoraDevice);
    }
    if (res.status === 200 && Array.isArray(res.data?.devices)) {
      return res.data.devices.map(normalizeLoraDevice);
    }
  } catch (err) {
    logger.debug('Live Objects /lora/devices échec, fallback /deviceMgt/devices', { error: err.message });
  }

  // Tentative 2 : endpoint générique filtré
  const res = await httpsRequest(`${API_BASE}/deviceMgt/devices?size=500`, apiKey);
  if (res.status !== 200) {
    const msg = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new Error(`Live Objects API ${res.status}: ${msg?.slice(0, 200)}`);
  }
  const items = Array.isArray(res.data) ? res.data : (res.data?.devices || []);
  return items
    .filter((d) => /^urn:(lo:nsid:)?lora:/i.test(d.id || '') || d.interface === 'lora')
    .map(normalizeGenericDevice);
}

function normalizeLoraDevice(d) {
  return {
    id: d.id || (d.devEUI ? `urn:lora:${d.devEUI}` : null),
    devEui: (d.devEUI || d.devEui || extractDevEui(d.id) || '').toUpperCase(),
    appEui: (d.appEUI || d.appEui || d.joinEUI || d.joinEui || '').toUpperCase(),
    name: d.name || d.label || null,
    tags: d.tags || [],
    group: d.group?.path || d.group || null,
    status: d.status || d.connectivity?.status || null,
    lastUplinkAt: d.lastActivity || d.statusUpdatedTime || d.lastSeen || null,
    profile: d.profile || d.deviceProfile || null,
    properties: d.properties || null,
  };
}

function normalizeGenericDevice(d) {
  const lora = d.lora || d.interfaces?.lora || {};
  return {
    id: d.id,
    devEui: (lora.devEUI || lora.devEui || extractDevEui(d.id) || '').toUpperCase(),
    appEui: (lora.appEUI || lora.appEui || lora.joinEUI || '').toUpperCase(),
    name: d.name || d.label || null,
    tags: d.tags || [],
    group: d.group?.path || d.group || null,
    status: d.status || null,
    lastUplinkAt: d.statusUpdatedTime || d.lastActivity || null,
    profile: lora.profile || null,
    properties: lora.properties || null,
  };
}

function extractDevEui(urn) {
  if (!urn) return null;
  // Formats rencontrés : `urn:lora:<DEVEUI>` (ancien) et `urn:lo:nsid:lora:<DEVEUI>` (actuel Orange)
  const m = urn.match(/^urn:(?:lo:nsid:)?lora:([0-9A-Fa-f]+)/i);
  return m ? m[1] : null;
}

async function findLoraDeviceByDevEui(devEui) {
  if (!devEui) return null;
  const target = devEui.toUpperCase();
  const all = await listLoraDevices();
  return all.find((d) => d.devEui === target) || null;
}

/**
 * Récupère le dernier dataMessage stocké côté Live Objects pour un devEUI donné.
 * `/lora/devices` ne remplit pas toujours `lastActivity` — la vraie source de
 * vérité est l'API data search.
 *
 * @returns {Promise<{ id, timestamp, payload, fcnt, rssi, snr, sf, port, gatewayCnt } | null>}
 */
async function getLastDataMessage(devEui) {
  const apiKey = process.env.LIVEOBJECTS_API_KEY;
  if (!apiKey) throw new Error('LIVEOBJECTS_API_KEY non configurée');
  if (!devEui) return null;
  const streamId = `urn:lo:nsid:lora:${devEui.toUpperCase()}`;

  const tryEndpoints = [
    `${API_BASE}/data/search/hits?q=streamId:%22${encodeURIComponent(streamId)}%22&size=1&sort=timestamp:desc`,
    `${API_BASE}/data/search/hits?q=metadata.source:%22${encodeURIComponent(streamId)}%22&size=1&sort=timestamp:desc`,
    `${API_BASE}/data/streams/${encodeURIComponent(streamId)}?limit=1`,
  ];

  for (const path of tryEndpoints) {
    try {
      const res = await httpsRequest(path, apiKey);
      if (res.status === 200) {
        const items = Array.isArray(res.data) ? res.data : (res.data?.hits || res.data?.data || []);
        if (items.length > 0) {
          const m = items[0]._source || items[0];
          const lora = m.metadata?.network?.lora || {};
          return {
            id: m.id,
            timestamp: m.timestamp || m.created || null,
            payload: m.value?.payload || null,
            model: m.model,
            fcnt: lora.fcnt ?? null,
            port: lora.port ?? null,
            rssi: lora.rssi ?? null,
            snr: lora.snr ?? null,
            sf: lora.sf ?? null,
            frequency: lora.frequency ?? null,
            gatewayCnt: lora.gatewayCnt ?? null,
            messageType: lora.messageType ?? null,
            raw: m,
          };
        }
      }
    } catch (err) {
      logger.debug(`Live Objects data search failed on ${path}`, { error: err.message });
    }
  }
  return null;
}

module.exports = { listLoraDevices, findLoraDeviceByDevEui, getLastDataMessage };
