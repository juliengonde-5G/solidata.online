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
 *   - succès (2xx)     : élément supprimé de la file
 *   - 4xx (sauf 401)   : élément supprimé (données invalides — éviter une boucle)
 *   - 401 / `retryable`: conservé — problème d'auth, jamais une donnée invalide
 *                        (la ré-auth chauffeur d'authedFetch/api le résout)
 *   - 5xx / réseau     : conservé pour retry (boucle 5 min + reconnexion)
 *
 * Endpoints : écritures via authedFetch/api (JWT chauffeur + ré-auth). Le GPS
 * hors-couverture est bufferisé par TourMap (addGpsPosition) puis rejoué en lot
 * sur POST /tours/gps-batch-public ; les scans QR sur POST /tours/:id/scan-public.
 *
 * Messagerie interne (lot L3, 26/08/2026) : les messages (réponses rapides ET
 * saisie libre) suivent la MÊME politique — POST
 * /api/messages/conversations/:id/messages, file `pendingMessages`, voir
 * sendMessagerieMessage/syncPendingMessages plus bas.
 */

import {
  getAllItems, getItem, deleteItem, clearStore, putItem, countItems, STORES,
} from './db';
import api from './api';
import { authedFetch } from './authedFetch';

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
  const [scans, weights, gps, incidents, collects, messageReads, endOfDay, checklists, messages] = await Promise.all([
    countItems(STORES.pendingScans).catch(() => 0),
    countItems(STORES.pendingWeights).catch(() => 0),
    countItems(STORES.gpsBuffer).catch(() => 0),
    countItems(STORES.pendingIncidents).catch(() => 0),
    countItems(STORES.pendingCollects).catch(() => 0),
    countItems(STORES.pendingMessageReads).catch(() => 0),
    countItems(STORES.pendingEndOfDay).catch(() => 0),
    countItems(STORES.pendingChecklists).catch(() => 0),
    countItems(STORES.pendingMessages).catch(() => 0),
  ]);
  const counts = {
    scans, weights, gps, incidents, collects, messageReads, endOfDay, checklists, messages,
  };
  counts.total = scans + weights + gps + incidents + collects + messageReads + endOfDay + checklists + messages;
  emit('pending', { counts });
  return counts;
}

function isClientError(err) {
  // Une erreur marquée `retryable` (ré-auth chauffeur impossible : réseau coupé
  // ou token révoqué) ne DOIT jamais purger la file — ce n'est pas une donnée
  // invalide, juste un problème d'authentification temporaire.
  if (err?.retryable) return false;
  const status = err?.response?.status;
  // 401 = auth (jamais une donnée invalide) → conservé pour rejeu après ré-auth.
  if (status === 401) return false;
  return status >= 400 && status < 500;
}

export async function syncPendingScans() {
  const store = STORES.pendingScans;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const scans = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const scan of scans) {
    try {
      await api.post(`/tours/${scan.tourId}/scan-public`, {
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
  const weighRes = await authedFetch(`/api/tours/${w.tourId}/weigh-public`, {
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
    const statusRes = await authedFetch(`/api/tours/${w.tourId}/status-public`, {
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
      await api.post('/tours/gps-batch-public', {
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
  // authedFetch : joint le JWT chauffeur + ré-auth transparente (l'endpoint
  // n'est plus public depuis l'audit 07/2026). client_id envoyé au cas où le
  // backend évolue.
  const res = await authedFetch(`/api/tours/${incident.tourId}/incident-public`, {
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
  // action='skip' : le point n'a pas pu être collecté (inaccessible, bouché,
  // vide…) → status='skipped' + skip_reason. Sinon collecte normale.
  const isSkip = collect.action === 'skip';
  const body = isSkip
    ? {
        status: 'skipped',
        skip_reason: collect.skipReason || 'autre',
        notes: collect.notes || null,
        client_id: collect.clientId || null,
      }
    : {
        status: 'collected',
        fill_level: collect.fillLevel,
        // Pourcentage réel du palier choisi (10 %, 100 %, 110 %…) : le serveur
        // l'utilise en priorité pour l'apprentissage. Absent des collectes déjà
        // en file avant cette version → le serveur retombe sur fill_level.
        fill_percent: collect.fillPercent ?? null,
        qr_scanned: !!collect.qrScanned,
        remballe: !!collect.remballe,
        notes: collect.anomaly ? `${collect.anomaly}${collect.notes ? ': ' + collect.notes : ''}` : (collect.notes || ''),
        client_id: collect.clientId || null,
        // Points ASSOCIATION : l'arrivée voyage avec le départ. Déclarée hors
        // ligne, elle n'aurait rien pour partir seule ; ici elle est rejouée
        // avec son heure d'origine et non celle du rattrapage. Absente sur une
        // borne de rue — le serveur l'ignore.
        arrivee_at: collect.arriveeAt || null,
      };
  const res = await authedFetch(`/api/tours/${collect.tourId}/cav/${collect.cavId}/collect-public`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }
  return res.json().catch(() => ({}));
}

/**
 * Envoie un incident AVEC photo en multipart (uniquement quand l'appareil est
 * en ligne — la file de sync offline reste en JSON sans photo). Le backend
 * accepte upload.single('photo') sur /incident-public. On NE fixe PAS de
 * Content-Type : le navigateur pose lui-même le boundary multipart.
 */
export async function sendIncidentWithPhoto(incident, photoFile) {
  const fd = new FormData();
  fd.append('type', incident.type);
  if (incident.description) fd.append('description', incident.description);
  if (incident.cavId != null) fd.append('cav_id', String(incident.cavId));
  if (incident.vehicleId != null) fd.append('vehicle_id', String(incident.vehicleId));
  if (incident.clientId) fd.append('client_id', incident.clientId);
  fd.append('photo', photoFile);
  const res = await authedFetch(`/api/tours/${incident.tourId}/incident-public`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }
  return res.json();
}

/**
 * Envoie une collecte AVEC photo en multipart (uniquement en ligne — comme
 * pour les incidents, la file offline reste en JSON sans photo). Utilisé pour
 * le point tiré au sort par tournée (services/auditPhoto.js).
 */
export async function sendCollectWithPhoto(collect, photoFile) {
  const fd = new FormData();
  fd.append('status', 'collected');
  fd.append('fill_level', String(collect.fillLevel));
  if (collect.fillPercent != null) fd.append('fill_percent', String(collect.fillPercent));
  fd.append('qr_scanned', String(!!collect.qrScanned));
  fd.append('remballe', String(!!collect.remballe));
  fd.append('notes', collect.anomaly ? `${collect.anomaly}${collect.notes ? ': ' + collect.notes : ''}` : (collect.notes || ''));
  if (collect.clientId) fd.append('client_id', collect.clientId);
  fd.append('photo', photoFile);
  const res = await authedFetch(`/api/tours/${collect.tourId}/cav/${collect.cavId}/collect-public`, {
    method: 'PUT',
    body: fd,
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }
  return res.json().catch(() => ({}));
}

/**
 * Envoie la photo DU POINT (CAV) prise par le chauffeur — exigence 08/2026.
 * Écrit la photo de référence du CAV (visible sur sa fiche) et remet à zéro son
 * compteur de fraîcheur. EN LIGNE UNIQUEMENT, comme les autres photos : aucun
 * blob n'est mis en file de sync. Un échec n'invalide jamais la collecte —
 * l'appelant l'absorbe et le point restera « photo à prendre » au prochain
 * passage (comportement honnête plutôt qu'une photo silencieusement perdue).
 */
export async function sendCavPhoto(tourId, cavId, photoFile) {
  const fd = new FormData();
  fd.append('photo', photoFile);
  const res = await authedFetch(`/api/tours/${tourId}/cav/${cavId}/photo-public`, {
    method: 'POST',
    body: fd,
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

/**
 * Envoie un accusé de lecture de consigne (« J'ai compris »). Idempotent côté
 * serveur (POST /tours/messages/:id/read-public répond 200 même si déjà lu).
 */
export async function sendMessageRead(item) {
  const res = await authedFetch(`/api/tours/messages/${item.messageId}/read-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }
  return res.json().catch(() => ({}));
}

export async function syncPendingMessageReads() {
  const store = STORES.pendingMessageReads;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const items = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendMessageRead(it);
      await deleteItem(store, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        // 400/404 : accusé sans objet (message supprimé) → purge, pas de boucle.
        console.warn('[SYNC] Accusé de lecture rejeté, suppression:', err.response?.status);
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
 * Envoie une déclaration de fin de journée. Le backend rejette (400) toute
 * déclaration partielle — les 6 champs sont donc toujours envoyés à true
 * (l'écran mobile ne permet pas d'envoyer autrement).
 */
export async function sendEndOfDay(item) {
  const res = await authedFetch(`/api/tours/${item.tourId}/end-of-day-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chauffeur_non_fume: item.chauffeurNonFume,
      chauffeur_pas_objet_personnel: item.chauffeurPasObjetPersonnel,
      suiveur_non_fume: item.suiveurNonFume,
      suiveur_pas_objet_personnel: item.suiveurPasObjetPersonnel,
      binome_vehicule_vide: item.binomeVehiculeVide,
      binome_vehicule_ok: item.binomeVehiculeOk,
      remarques: item.remarques || null,
      client_id: item.clientId || null, // ignoré par le backend actuel
    }),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }
  return res.json().catch(() => ({}));
}

export async function syncPendingEndOfDay() {
  const store = STORES.pendingEndOfDay;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const items = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendEndOfDay(it);
      await deleteItem(store, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        console.warn('[SYNC] Déclaration fin de journée rejetée, suppression:', err.response?.status);
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
 * Envoie la checklist de début de journée (Checklist.jsx). Contrat backend
 * (figé) :
 *  - 200/201 : { ..., message_prevention: { id, titre, texte } | null } ;
 *  - 409 CHECKLIST_DEJA_FAITE : { error, code, faite_le } — une checklist a
 *    déjà été remplie pour ce véhicule aujourd'hui. Ce n'est PAS une donnée
 *    invalide : c'est l'appelant (Checklist.jsx) qui décide de la suite pour
 *    l'envoi immédiat. Pour le REJEU en file (ci-dessous), c'est un 4xx
 *    comme un autre — on purge sans boucler, la checklist du jour existe
 *    déjà côté serveur.
 * Le corps de la réponse est TOUJOURS attaché à l'erreur
 * (`err.response.data`) quand le statut n'est pas ok, pour que l'appelant
 * puisse lire `code`/`faite_le` sans reparser.
 */
export async function sendChecklist(item) {
  const res = await authedFetch(`/api/tours/${item.tourId}/checklist-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle_id: item.vehicleId,
      exterior_ok: item.exteriorOk,
      fuel_level: item.fuelLevel,
      km_start: item.kmStart,
      notes: item.notes || null,
      degats: Array.isArray(item.degats) ? item.degats : [],
      client_id: item.clientId || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status, data };
    throw err;
  }
  return data;
}

export async function syncPendingChecklists() {
  const store = STORES.pendingChecklists;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const items = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendChecklist(it);
      await deleteItem(store, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        // Inclut le 409 « déjà faite » : rien à renvoyer, on purge sans boucler.
        console.warn('[SYNC] Checklist rejetée/déjà faite, suppression:', err.response?.status);
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
 * Envoie un message de la messagerie interne (réponse rapide ou saisie
 * libre — le serveur ne fait aucune différence entre les deux, contrat
 * §2.3). `authedFetch` porte le JWT chauffeur + la ré-auth transparente :
 * un 401 lève une erreur `retryable` (voir authedFetch.js), donc jamais
 * purgée par la file — un problème d'auth n'est pas un message invalide.
 */
export async function sendMessagerieMessage(item) {
  const res = await authedFetch(`/api/messages/conversations/${item.conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texte: item.texte }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.response = { status: res.status, data };
    throw err;
  }
  return data;
}

export async function syncPendingMessages() {
  const store = STORES.pendingMessages;
  if (!canAttempt(store)) return { synced: 0, failed: 0, pending: -1, skipped: true };
  const items = await getAllItems(store);
  let synced = 0; let failed = 0;
  for (const it of items) {
    try {
      await sendMessagerieMessage(it);
      await deleteItem(store, it.id);
      synced++;
    } catch (err) {
      if (isClientError(err)) {
        // 400 (texte vide/trop long), 403 (périmètre/bot), 404 (conversation
        // supprimée), 409 (conversation SOLIDATA en lecture seule) : rejouer
        // ne changerait rien, on purge sans boucler — comme les autres files.
        console.warn('[SYNC] Message rejeté, suppression:', err.response?.status);
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
      messageReads: await syncPendingMessageReads(),
      endOfDay: await syncPendingEndOfDay(),
      checklists: await syncPendingChecklists(),
      messages: await syncPendingMessages(),
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
