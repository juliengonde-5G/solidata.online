/**
 * Service de synchronisation offline/online
 * Synchronise les données en attente (scans, poids, GPS, incidents, collectes)
 * avec le serveur quand la connectivité est rétablie.
 *
 * Événements exposés via `syncEvents` (EventTarget) :
 *   - 'state'   : { state: 'idle'|'syncing'|'error'|'offline', pending?, results?, error? }
 *   - 'pending' : { counts: { scans, weights, gps, incidents, collects, total } }
 *
 * Politique :
 *   - succès (2xx)  : élément supprimé de la file
 *   - 4xx           : élément supprimé (données invalides — éviter une boucle)
 *   - 5xx / réseau  : conservé pour retry (boucle périodique 5 min + reconnexion)
 */

import {
  getAllItems, getItem, deleteItem, clearStore, putItem, countItems, STORES,
} from './db';
import api from './api';

let syncInProgress = false;

export const syncEvents = new EventTarget();

function emit(type, detail) {
  syncEvents.dispatchEvent(new CustomEvent(type, { detail }));
}

/**
 * Compte les éléments en attente dans tous les stores d'envoi.
 * @returns {Promise<{ scans, weights, gps, incidents, collects, total }>}
 */
export async function getPendingCount() {
  const [scans, weights, gps, incidents, collects] = await Promise.all([
    countItems(STORES.pendingScans).catch(() => 0),
    countItems(STORES.pendingWeights).catch(() => 0),
    countItems(STORES.gpsBuffer).catch(() => 0),
    countItems(STORES.pendingIncidents).catch(() => 0),
    countItems(STORES.pendingCollects).catch(() => 0),
  ]);
  const counts = { scans, weights, gps, incidents, collects };
  counts.total = scans + weights + gps + incidents + collects;
  emit('pending', { counts });
  return counts;
}

function isClientError(err) {
  const status = err?.response?.status;
  return status >= 400 && status < 500;
}

async function syncPendingScans() {
  const scans = await getAllItems(STORES.pendingScans);
  let synced = 0; let failed = 0;
  for (const scan of scans) {
    try {
      await api.post(`/tours/${scan.tourId}/scan`, {
        cav_id: scan.cavId,
        scanned_at: scan.scannedAt,
      });
      await deleteItem(STORES.pendingScans, scan.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Scan rejeté, suppression:', err.response?.data?.error);
        await deleteItem(STORES.pendingScans, scan.id);
        failed++;
      }
    }
  }
  return { synced, failed, pending: scans.length - synced - failed };
}

async function syncPendingWeights() {
  const weights = await getAllItems(STORES.pendingWeights);
  let synced = 0; let failed = 0;
  for (const weight of weights) {
    try {
      await api.post(`/tours/${weight.tourId}/weights`, {
        weight_kg: weight.weightKg,
        recorded_at: weight.recordedAt,
      });
      await deleteItem(STORES.pendingWeights, weight.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Pesée rejetée, suppression:', err.response?.data?.error);
        await deleteItem(STORES.pendingWeights, weight.id);
        failed++;
      }
    }
  }
  return { synced, failed, pending: weights.length - synced - failed };
}

async function syncGpsBuffer() {
  const positions = await getAllItems(STORES.gpsBuffer);
  let synced = 0; let failed = 0;
  const batchSize = 50;
  for (let i = 0; i < positions.length; i += batchSize) {
    const batch = positions.slice(i, i + batchSize);
    try {
      await api.post('/tours/gps-batch', {
        positions: batch.map(p => ({
          tour_id: p.tourId,
          vehicle_id: p.vehicleId,
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speed,
          recorded_at: p.recordedAt,
        })),
      });
      for (const pos of batch) await deleteItem(STORES.gpsBuffer, pos.id);
      synced += batch.length;
    } catch (err) {
      if (isClientError(err)) {
        for (const pos of batch) await deleteItem(STORES.gpsBuffer, pos.id);
        failed += batch.length;
      }
      break; // stopper sur erreur réseau — retry global ultérieur
    }
  }
  return { synced, failed, pending: positions.length - synced - failed };
}

/**
 * Envoie un incident unitaire. Extrait pour réutilisation (envoi immédiat
 * depuis le flux rapide Incident.jsx).
 */
export async function sendIncident(incident) {
  // Utilise fetch (endpoint public, pas d'auth JWT) pour rester aligné avec
  // le flux chauffeur actuel. client_id envoyé au cas où le backend évolue.
  const res = await fetch(`/api/tours/${incident.tourId}/incident-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: incident.type,
      description: incident.description || null,
      cav_id: incident.cavId ?? null,
      vehicle_id: incident.vehicleId ?? null,
      client_id: incident.clientId || null, // ignoré par le backend actuel
    }),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }
  return res.json();
}

async function syncPendingIncidents() {
  const items = await getAllItems(STORES.pendingIncidents);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendIncident(it);
      await deleteItem(STORES.pendingIncidents, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Incident rejeté, suppression:', err.response?.status);
        await deleteItem(STORES.pendingIncidents, it.id);
        failed++;
      }
    }
  }
  return { synced, failed, pending: items.length - synced - failed };
}

/**
 * Envoie une collecte unitaire. Extrait pour réutilisation (envoi immédiat
 * depuis FillLevel avant d'ouvrir StepConfirmScreen).
 */
export async function sendCollect(collect) {
  const res = await fetch(`/api/tours/${collect.tourId}/cav/${collect.cavId}/collect-public`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'collected',
      fill_level: collect.fillLevel,
      qr_scanned: !!collect.qrScanned,
      notes: collect.anomaly ? `${collect.anomaly}${collect.notes ? ': ' + collect.notes : ''}` : (collect.notes || ''),
      client_id: collect.clientId || null,
    }),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }
  return res.json().catch(() => ({}));
}

async function syncPendingCollects() {
  const items = await getAllItems(STORES.pendingCollects);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendCollect(it);
      await deleteItem(STORES.pendingCollects, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Collecte rejetée, suppression:', err.response?.status);
        await deleteItem(STORES.pendingCollects, it.id);
        failed++;
      }
    }
  }
  return { synced, failed, pending: items.length - synced - failed };
}

export async function syncAll() {
  if (!navigator.onLine) {
    emit('state', { state: 'offline' });
    return { synced: false, reason: 'offline' };
  }
  if (syncInProgress) {
    return { synced: false, reason: 'sync_in_progress' };
  }
  syncInProgress = true;
  emit('state', { state: 'syncing' });
  try {
    const results = {
      scans: await syncPendingScans(),
      weights: await syncPendingWeights(),
      gps: await syncGpsBuffer(),
      incidents: await syncPendingIncidents(),
      collects: await syncPendingCollects(),
    };
    const totalSynced = Object.values(results).reduce((a, r) => a + r.synced, 0);
    const totalPending = Object.values(results).reduce((a, r) => a + r.pending, 0);
    if (totalSynced > 0) {
      console.log(`[SYNC] ${totalSynced} éléments envoyés`, results);
    }
    emit('state', { state: 'idle', pending: totalPending, results });
    await getPendingCount(); // réémet le compteur agrégé
    return { synced: true, results };
  } catch (err) {
    console.error('[SYNC] Erreur globale:', err.message);
    emit('state', { state: 'error', error: err.message });
    return { synced: false, reason: 'error', error: err.message };
  } finally {
    syncInProgress = false;
  }
}

export async function cacheReferenceData() {
  if (!navigator.onLine) return;
  try {
    const [cavsResponse, userResponse] = await Promise.all([
      api.get('/cav').catch(() => ({ data: [] })),
      api.get('/auth/me').catch(() => null),
    ]);
    const cavs = Array.isArray(cavsResponse.data) ? cavsResponse.data : (cavsResponse.data?.cavs || []);
    if (cavs.length > 0) {
      await clearStore(STORES.cavs);
      for (const cav of cavs) await putItem(STORES.cavs, cav);
      console.log(`[SYNC] ${cavs.length} CAVs mis en cache`);
    }
    if (userResponse?.data) {
      await putItem(STORES.userData, {
        key: 'currentUser',
        ...userResponse.data,
        cachedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[SYNC] Erreur cache données référence:', err.message);
  }
}

export function startAutoSync() {
  window.addEventListener('online', () => {
    console.log('[SYNC] Connexion rétablie');
    emit('state', { state: 'idle' });
    syncAll();
    cacheReferenceData();
  });
  window.addEventListener('offline', () => {
    console.log('[SYNC] Connexion perdue');
    emit('state', { state: 'offline' });
  });

  setInterval(() => { if (navigator.onLine) syncAll(); }, 5 * 60 * 1000);
  setInterval(() => { if (navigator.onLine) cacheReferenceData(); }, 30 * 60 * 1000);

  if (navigator.onLine) {
    setTimeout(() => { syncAll(); cacheReferenceData(); }, 3000);
  } else {
    emit('state', { state: 'offline' });
  }

  // État initial
  getPendingCount();

  console.log('[SYNC] Auto-sync démarré');
}
