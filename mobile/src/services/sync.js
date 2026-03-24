/**
 * Service de synchronisation offline/online
 * Synchronise les données en attente (scans, poids, GPS) avec le serveur
 * quand la connectivité est rétablie
 */

import { getAllItems, deleteItem, clearStore, putItem, STORES } from './db';
import api from './api';

let syncInProgress = false;

/**
 * Synchroniser les scans QR en attente
 * @returns {{ synced: number, failed: number }}
 */
async function syncPendingScans() {
  const scans = await getAllItems(STORES.pendingScans);
  let synced = 0;
  let failed = 0;

  for (const scan of scans) {
    try {
      await api.post(`/tours/${scan.tourId}/scan`, {
        cav_id: scan.cavId,
        scanned_at: scan.scannedAt,
      });
      await deleteItem(STORES.pendingScans, scan.id);
      synced++;
    } catch (err) {
      if (err.response?.status >= 400 && err.response?.status < 500) {
        // Erreur client (données invalides, tour terminée, etc.) — supprimer
        console.warn('[SYNC] Scan rejeté par le serveur, suppression:', err.response?.data?.error);
        await deleteItem(STORES.pendingScans, scan.id);
        failed++;
      }
      // Erreur réseau — on garde pour la prochaine tentative
    }
  }

  return { synced, failed, pending: scans.length - synced - failed };
}

/**
 * Synchroniser les pesées en attente
 * @returns {{ synced: number, failed: number }}
 */
async function syncPendingWeights() {
  const weights = await getAllItems(STORES.pendingWeights);
  let synced = 0;
  let failed = 0;

  for (const weight of weights) {
    try {
      await api.post(`/tours/${weight.tourId}/weights`, {
        weight_kg: weight.weightKg,
        recorded_at: weight.recordedAt,
      });
      await deleteItem(STORES.pendingWeights, weight.id);
      synced++;
    } catch (err) {
      if (err.response?.status >= 400 && err.response?.status < 500) {
        console.warn('[SYNC] Pesée rejetée par le serveur, suppression:', err.response?.data?.error);
        await deleteItem(STORES.pendingWeights, weight.id);
        failed++;
      }
    }
  }

  return { synced, failed, pending: weights.length - synced - failed };
}

/**
 * Synchroniser le buffer GPS
 * @returns {{ synced: number, failed: number }}
 */
async function syncGpsBuffer() {
  const positions = await getAllItems(STORES.gpsBuffer);
  let synced = 0;
  let failed = 0;

  // Envoyer par lots de 50 pour éviter de surcharger l'API
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
      // Supprimer les positions synchronisées
      for (const pos of batch) {
        await deleteItem(STORES.gpsBuffer, pos.id);
      }
      synced += batch.length;
    } catch (err) {
      if (err.response?.status >= 400 && err.response?.status < 500) {
        // Données invalides — supprimer le lot
        for (const pos of batch) {
          await deleteItem(STORES.gpsBuffer, pos.id);
        }
        failed += batch.length;
      }
      // Erreur réseau — arrêter et réessayer plus tard
      break;
    }
  }

  return { synced, failed, pending: positions.length - synced - failed };
}

/**
 * Synchroniser toutes les données en attente
 * @returns {object} résultat de la synchronisation
 */
export async function syncAll() {
  if (!navigator.onLine) {
    return { synced: false, reason: 'offline' };
  }

  if (syncInProgress) {
    return { synced: false, reason: 'sync_in_progress' };
  }

  syncInProgress = true;
  try {
    const results = {
      scans: await syncPendingScans(),
      weights: await syncPendingWeights(),
      gps: await syncGpsBuffer(),
    };

    const totalSynced = results.scans.synced + results.weights.synced + results.gps.synced;
    if (totalSynced > 0) {
      console.log(`[SYNC] Synchronisation terminée: ${totalSynced} éléments envoyés`, results);
    }

    return { synced: true, results };
  } catch (err) {
    console.error('[SYNC] Erreur synchronisation globale:', err.message);
    return { synced: false, reason: 'error', error: err.message };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Mettre en cache les données de référence pour le mode offline
 * (CAVs, profil utilisateur)
 */
export async function cacheReferenceData() {
  if (!navigator.onLine) return;

  try {
    const [cavsResponse, userResponse] = await Promise.all([
      api.get('/cav').catch(() => ({ data: [] })),
      api.get('/auth/me').catch(() => null),
    ]);

    // Stocker les CAVs
    const cavs = Array.isArray(cavsResponse.data) ? cavsResponse.data : (cavsResponse.data?.cavs || []);
    if (cavs.length > 0) {
      await clearStore(STORES.cavs);
      for (const cav of cavs) {
        await putItem(STORES.cavs, cav);
      }
      console.log(`[SYNC] ${cavs.length} CAVs mis en cache`);
    }

    // Stocker le profil utilisateur
    if (userResponse?.data) {
      await putItem(STORES.userData, {
        key: 'currentUser',
        ...userResponse.data,
        cachedAt: new Date().toISOString(),
      });
      console.log('[SYNC] Profil utilisateur mis en cache');
    }
  } catch (err) {
    console.warn('[SYNC] Erreur cache données référence:', err.message);
  }
}

/**
 * Démarrer la synchronisation automatique
 * - Écoute les événements online/offline
 * - Sync périodique toutes les 5 minutes quand connecté
 */
export function startAutoSync() {
  // Synchroniser immédiatement quand la connexion revient
  window.addEventListener('online', () => {
    console.log('[SYNC] Connexion rétablie, synchronisation...');
    syncAll();
    cacheReferenceData();
  });

  window.addEventListener('offline', () => {
    console.log('[SYNC] Connexion perdue, passage en mode offline');
  });

  // Synchronisation périodique toutes les 5 minutes quand en ligne
  setInterval(() => {
    if (navigator.onLine) {
      syncAll();
    }
  }, 5 * 60 * 1000);

  // Mise à jour du cache de référence toutes les 30 minutes
  setInterval(() => {
    if (navigator.onLine) {
      cacheReferenceData();
    }
  }, 30 * 60 * 1000);

  // Synchronisation initiale au démarrage
  if (navigator.onLine) {
    // Petit délai pour laisser l'app se charger
    setTimeout(() => {
      syncAll();
      cacheReferenceData();
    }, 3000);
  }

  console.log('[SYNC] Auto-sync démarré');
}
