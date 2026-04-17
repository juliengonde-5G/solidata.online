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
 * Backoff léger par catégorie : après N échecs réseau consécutifs sur un
 * store, on évite de réessayer pendant `backoffSeconds[n]` secondes.
 * Reset à 0 dès qu'une tentative réussit ou qu'un 4xx purge l'élément.
 */
const BACKOFF_STEPS_S = [0, 30, 60, 120, 300];
const backoffState = new Map(); // storeName → { failures, nextAttemptAt }

function canAttempt(storeName) {
  const s = backoffState.get(storeName);
  if (!s) return true;
  return Date.now() >= (s.nextAttemptAt || 0);
}

function recordFailure(storeName) {
  const prev = backoffState.get(storeName) || { failures: 0 };
  const failures = Math.min(prev.failures + 1, BACKOFF_STEPS_S.length - 1);
  const waitS = BACKOFF_STEPS_S[failures];
  backoffState.set(storeName, { failures, nextAttemptAt: Date.now() + waitS * 1000 });
}

function recordSuccess(storeName) {
  backoffState.delete(storeName);
}

/** Utilitaire de tests : force le reset de l'état de backoff. */
export function __resetBackoffForTests() {
  backoffState.clear();
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

export async function syncPendingScans() {
  const store = STORES.pendingScans;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const scans = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const scan of scans) {
    try {
      await api.post(`/tours/${scan.tourId}/scan`, {
        cav_id: scan.cavId,
        scanned_at: scan.scannedAt,
        client_id: scan.clientId || null,
      });
      await deleteItem(store, scan.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Scan rejeté, suppression:', err.response?.data?.error);
        await deleteItem(store, scan.id);
        failed++;
      } else {
        recordFailure(store);
        break; // on arrête le lot, retry ultérieur
      }
    }
  }
  if (synced > 0 || failed > 0) recordSuccess(store);
  return { synced, failed, pending: scans.length - synced - failed };
}

/**
 * Envoi unitaire d'une pesée. Gère le chaînage vers /status-public si
 * la pesée finalise la tournée (pesée finale, non intermédiaire).
 * Exporté pour usage direct depuis WeighIn.jsx.
 */
export async function sendWeight(w) {
  const weighRes = await fetch(`/api/tours/${w.tourId}/weigh-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      weight_kg: w.weightKg,
      tare_kg: w.tareKg ?? null,
      is_intermediate: !!w.isIntermediate,
      notes: w.notes || null,
      client_id: w.clientId || null, // ignoré par le backend actuel
    }),
  });
  if (!weighRes.ok) {
    const err = new Error(`HTTP ${weighRes.status}`);
    err.response = { status: weighRes.status };
    throw err;
  }
  if (w.finalize && !w.isIntermediate) {
    const statusRes = await fetch(`/api/tours/${w.tourId}/status-public`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    if (!statusRes.ok) {
      // Pesée enregistrée mais transition d'état refusée : on remonte
      // une erreur pour que l'appelant sache que la finalisation n'est
      // pas complète. 4xx = état interdit (ex : déjà complétée) —
      // traité comme succès métier (la pesée est bien passée).
      if (statusRes.status >= 400 && statusRes.status < 500) {
        return { weighOk: true, statusOk: false, statusCode: statusRes.status };
      }
      const err = new Error(`HTTP ${statusRes.status}`);
      err.response = { status: statusRes.status };
      throw err;
    }
  }
  return { weighOk: true, statusOk: true };
}

export async function syncPendingWeights() {
  const store = STORES.pendingWeights;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const weights = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const weight of weights) {
    try {
      await sendWeight(weight);
      await deleteItem(store, weight.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Pesée rejetée, suppression:', err.response?.status);
        await deleteItem(store, weight.id);
        failed++;
      } else {
        recordFailure(store);
        break;
      }
    }
  }
  if (synced > 0 || failed > 0) recordSuccess(store);
  return { synced, failed, pending: weights.length - synced - failed };
}

export async function syncGpsBuffer() {
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

export async function syncPendingIncidents() {
  const store = STORES.pendingIncidents;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const items = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendIncident(it);
      await deleteItem(store, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Incident rejeté, suppression:', err.response?.status);
        await deleteItem(store, it.id);
        failed++;
      } else {
        recordFailure(store);
        break;
      }
    }
  }
  if (synced > 0 || failed > 0) recordSuccess(store);
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

export async function syncPendingCollects() {
  const store = STORES.pendingCollects;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const items = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendCollect(it);
      await deleteItem(store, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Collecte rejetée, suppression:', err.response?.status);
        await deleteItem(store, it.id);
        failed++;
      } else {
        recordFailure(store);
        break;
      }
    }
  }
  if (synced > 0 || failed > 0) recordSuccess(store);
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
