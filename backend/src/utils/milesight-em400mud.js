/**
 * Décodeur TLV pour Milesight EM400-MUD-868M (sonde ultrasonique de remplissage).
 *
 * Format : Type-Length-Value. Chaque canal fait 2 octets (channel_id + channel_type),
 * suivi d'une data dont la taille dépend du type (little-endian, sauf mention contraire).
 *
 * Référence : Milesight-IoT/SensorDecoders (github.com/Milesight-IoT/SensorDecoders,
 * chemin EM_Series/EM400/EM400-MUD/). Ré-écrit sans dépendance pour être testable unitairement.
 *
 * Canaux supportés (firmware EM400-MUD courant FPort 85) :
 *   0x01 0x75  battery (1 octet, %)
 *   0x03 0x82  distance (2 octets LE, mm)
 *   0x04 0x67  temperature (2 octets LE signed, 0.1 °C)
 *   0x05 0x00  position / tilt (1 octet : 0 normal, 1 tilt)
 *   0x83 0x67  alarm température (2 octets : valeur + 1 octet alarme)
 *   0x84 0x82  alarm distance (2 octets : valeur + 1 octet type)
 *
 * Les octets non reconnus sont ignorés (log debug uniquement).
 */

function hexToBytes(hex) {
  if (!hex || typeof hex !== 'string') return [];
  const clean = hex.replace(/\s+/g, '').toLowerCase();
  if (clean.length % 2 !== 0) throw new Error('Payload hex de longueur impaire');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substr(i, 2), 16));
  }
  return bytes;
}

function readInt16LE(bytes, offset) {
  const low = bytes[offset];
  const high = bytes[offset + 1];
  const val = (high << 8) | low;
  return val > 0x7fff ? val - 0x10000 : val;
}

function readUInt16LE(bytes, offset) {
  return (bytes[offset + 1] << 8) | bytes[offset];
}

/**
 * Décode un payload Milesight EM400-MUD.
 * @param {number} fport  — numéro de port LoRaWAN (attendu 85)
 * @param {string} hexPayload — payload hex (ex. 'fe0175643882f400046700f0')
 * @returns {{battery:number|null, distance_mm:number|null, temperature:number|null, tilt_detected:boolean, alarm_type:string|null, raw:object}}
 */
function decode(fport, hexPayload) {
  const result = {
    battery: null,
    distance_mm: null,
    temperature: null,
    tilt_detected: false,
    alarm_type: null,
    raw: { fport, channels: {} },
  };

  if (!hexPayload) return result;
  const bytes = hexToBytes(hexPayload);
  let i = 0;
  while (i < bytes.length) {
    // Certains firmwares commencent par 0xFE/0xFF comme préfixe d'installation — on le saute
    if (i + 1 >= bytes.length) break;
    const channelId = bytes[i];
    const channelType = bytes[i + 1];
    const key = `${channelId.toString(16).padStart(2, '0')}${channelType.toString(16).padStart(2, '0')}`;

    if (channelId === 0x01 && channelType === 0x75) {
      // Battery (%)
      result.battery = bytes[i + 2];
      result.raw.channels[key] = result.battery;
      i += 3;
    } else if (channelId === 0x03 && channelType === 0x82) {
      // Distance (mm, uint16 LE)
      result.distance_mm = readUInt16LE(bytes, i + 2);
      result.raw.channels[key] = result.distance_mm;
      i += 4;
    } else if (channelId === 0x04 && channelType === 0x67) {
      // Temperature (int16 LE, 0.1 °C)
      result.temperature = readInt16LE(bytes, i + 2) / 10;
      result.raw.channels[key] = result.temperature;
      i += 4;
    } else if (channelId === 0x05 && channelType === 0x00) {
      // Position / tilt (1 octet)
      result.tilt_detected = bytes[i + 2] === 1;
      result.raw.channels[key] = bytes[i + 2];
      i += 3;
    } else if (channelId === 0x83 && channelType === 0x67) {
      // Temperature avec alarme : value (2B) + alarm (1B)
      result.temperature = readInt16LE(bytes, i + 2) / 10;
      const alarmCode = bytes[i + 4];
      if (alarmCode === 1) result.alarm_type = 'temp_high';
      else if (alarmCode === 2) result.alarm_type = 'temp_low';
      result.raw.channels[key] = { value: result.temperature, alarm: alarmCode };
      i += 5;
    } else if (channelId === 0x84 && channelType === 0x82) {
      // Distance avec alarme : value (2B) + alarm type (1B)
      result.distance_mm = readUInt16LE(bytes, i + 2);
      const alarmCode = bytes[i + 4];
      if (alarmCode === 1) result.alarm_type = 'threshold_80';
      else if (alarmCode === 2) result.alarm_type = 'threshold_95';
      else if (alarmCode === 3) result.alarm_type = 'tilt';
      result.raw.channels[key] = { value: result.distance_mm, alarm: alarmCode };
      i += 5;
    } else {
      // Canal inconnu — on tente de continuer en avançant de 1 octet (le firmware
      // peut insérer des en-têtes non documentés). Si on dépasse, la boucle s'arrête.
      i += 1;
    }
  }
  return result;
}

/**
 * Calcule le % de remplissage à partir de la distance mesurée et de la hauteur
 * du CAV vide (calibration terrain).
 * @param {number} distance_cm   — distance entre le capteur et le textile, en cm
 * @param {number} sensor_height_cm — hauteur vide mesurée, en cm
 * @returns {number|null} — 0 à 100, ou null si calibration manquante
 */
function computeFillPercent(distance_cm, sensor_height_cm) {
  if (distance_cm == null || !sensor_height_cm || sensor_height_cm <= 0) return null;
  const clamped = Math.max(0, Math.min(1, 1 - distance_cm / sensor_height_cm));
  return Math.round(clamped * 1000) / 10; // 1 décimale, 0–100
}

/**
 * Encodeur minimal (utilisé par le script de simulation).
 * Génère un payload TLV valide avec battery/distance/temperature/tilt.
 */
function encodeTestPayload({ battery = 95, distance_mm = 500, temperature = 18.5, tilt = false }) {
  const bytes = [];
  // Battery
  bytes.push(0x01, 0x75, battery & 0xff);
  // Distance (uint16 LE, mm)
  const d = Math.max(0, Math.min(0xffff, Math.round(distance_mm)));
  bytes.push(0x03, 0x82, d & 0xff, (d >> 8) & 0xff);
  // Temperature (int16 LE, 0.1 °C)
  const t = Math.round(temperature * 10);
  const tEnc = t < 0 ? t + 0x10000 : t;
  bytes.push(0x04, 0x67, tEnc & 0xff, (tEnc >> 8) & 0xff);
  // Tilt
  bytes.push(0x05, 0x00, tilt ? 1 : 0);
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

module.exports = { decode, computeFillPercent, encodeTestPayload, hexToBytes };
