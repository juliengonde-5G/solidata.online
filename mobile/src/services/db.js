/**
 * IndexedDB service for offline-first mobile PWA
 *
 * Stores v1 (sprint 1) :
 *   - tours, cavs, userData          (cache référentiel)
 *   - pendingScans                   (file d'envoi : scans QR)
 *   - pendingWeights                 (file d'envoi : pesées)
 *   - gpsBuffer                      (file d'envoi : positions GPS)
 *
 * Stores v2 (sprint 2) :
 *   - pendingIncidents               (file d'envoi : incidents terrain)
 *   - pendingCollects                (file d'envoi : collectes offline)
 *
 * Stores v3 (vague 2 — item 62) :
 *   - pendingMessageReads            (file d'envoi : accusés de lecture des
 *                                     consignes manager → chauffeur)
 *
 * Chaque entrée "pending*" porte un clientId (uuid) pour permettre une
 * idempotence côté serveur si le backend évolue (cf. contrat recommandé dans
 * DOCUMENTATION_MOBILE.md). Par défaut, on s'appuie sur la politique
 * "supprimer sur succès, garder sur 5xx, supprimer sur 4xx" de sync.js.
 */

const DB_NAME = 'solidata-mobile';
const DB_VERSION = 3;

export const STORES = {
  tours: 'tours',
  cavs: 'cavs',
  pendingScans: 'pendingScans',
  pendingWeights: 'pendingWeights',
  gpsBuffer: 'gpsBuffer',
  userData: 'userData',
  pendingIncidents: 'pendingIncidents',
  pendingCollects: 'pendingCollects',
  pendingMessageReads: 'pendingMessageReads',
};

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.tours)) {
        db.createObjectStore(STORES.tours, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.cavs)) {
        const cavStore = db.createObjectStore(STORES.cavs, { keyPath: 'id' });
        cavStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.pendingScans)) {
        db.createObjectStore(STORES.pendingScans, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.pendingWeights)) {
        db.createObjectStore(STORES.pendingWeights, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.gpsBuffer)) {
        db.createObjectStore(STORES.gpsBuffer, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.userData)) {
        db.createObjectStore(STORES.userData, { keyPath: 'key' });
      }

      // v2 — ajouts non destructifs
      if (!db.objectStoreNames.contains(STORES.pendingIncidents)) {
        const s = db.createObjectStore(STORES.pendingIncidents, { keyPath: 'id', autoIncrement: true });
        s.createIndex('clientId', 'clientId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.pendingCollects)) {
        const s = db.createObjectStore(STORES.pendingCollects, { keyPath: 'id', autoIncrement: true });
        s.createIndex('clientId', 'clientId', { unique: false });
      }

      // v3 — accusés de lecture des consignes manager → chauffeur (item 62)
      if (!db.objectStoreNames.contains(STORES.pendingMessageReads)) {
        const s = db.createObjectStore(STORES.pendingMessageReads, { keyPath: 'id', autoIncrement: true });
        s.createIndex('messageId', 'messageId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putItem(storeName, item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getItem(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getAllItems(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function deleteItem(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function countItems(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** Génère un identifiant client pour l'idempotence (UUID v4 si dispo, fallback timestamp+random). */
export function newClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function addPendingScan(scanData) {
  return putItem(STORES.pendingScans, {
    clientId: scanData.clientId || newClientId(),
    ...scanData,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Ajoute une pesée à synchroniser.
 * @param {object} data - {
 *   tourId, weightKg, tareKg?, isIntermediate?, finalize?, notes?, clientId?
 * }
 * - finalize=true : sync.js enchaînera un PUT /status-public status=completed
 *   après succès de la pesée.
 */
export async function addPendingWeight(data) {
  return putItem(STORES.pendingWeights, {
    clientId: data.clientId || newClientId(),
    tourId: data.tourId,
    weightKg: data.weightKg,
    tareKg: data.tareKg ?? null,
    isIntermediate: !!data.isIntermediate,
    finalize: !!data.finalize,
    notes: data.notes || null,
    createdAt: new Date().toISOString(),
  });
}

export async function addGpsPosition(gpsData) {
  return putItem(STORES.gpsBuffer, {
    ...gpsData,
    recordedAt: new Date().toISOString(),
  });
}

/**
 * Ajoute un incident à envoyer.
 * @param {object} data - { tourId, type, description?, cavId?, vehicleId? }
 * @returns id auto-incrémenté
 */
export async function addPendingIncident(data) {
  return putItem(STORES.pendingIncidents, {
    clientId: data.clientId || newClientId(),
    tourId: data.tourId ?? null,
    type: data.type,
    description: data.description || null,
    cavId: data.cavId ?? null,
    vehicleId: data.vehicleId ?? null,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Met à jour un incident en attente (ajout ou modification de description).
 * @param {number} id - identifiant IndexedDB
 * @param {object} patch - champs à mettre à jour
 */
export async function updatePendingIncident(id, patch) {
  const current = await getItem(STORES.pendingIncidents, id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await putItem(STORES.pendingIncidents, next);
  return next;
}

/**
 * Ajoute une collecte OU un saut de point en attente.
 * @param {object} data - {
 *   tourId, cavId, action?='collect'|'skip', fillLevel?, skipReason?,
 *   anomaly?, notes?, qrScanned?
 * }
 * - action='skip' : le CAV est marqué « impossible à collecter » (skipReason
 *   inaccessible/bouché/vide/…), sans niveau de remplissage.
 */
export async function addPendingCollect(data) {
  const action = data.action === 'skip' ? 'skip' : 'collect';
  return putItem(STORES.pendingCollects, {
    clientId: data.clientId || newClientId(),
    tourId: data.tourId,
    cavId: data.cavId,
    action,
    fillLevel: action === 'skip' ? null : data.fillLevel,
    skipReason: action === 'skip' ? (data.skipReason || null) : null,
    anomaly: data.anomaly || null,
    notes: data.notes || null,
    qrScanned: !!data.qrScanned,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Ajoute un accusé de lecture de consigne (« J'ai compris ») à envoyer.
 * Le chauffeur peut acquitter hors ligne — l'accusé est rejoué à la reconnexion
 * via POST /tours/messages/:id/read-public (idempotent côté serveur).
 * @param {object} data - { messageId }
 */
export async function addPendingMessageRead(data) {
  return putItem(STORES.pendingMessageReads, {
    messageId: data.messageId,
    createdAt: new Date().toISOString(),
  });
}

/** Liste les IDs de consignes acquittées localement (encore en file). */
export async function getAckedMessageIds() {
  const rows = await getAllItems(STORES.pendingMessageReads).catch(() => []);
  return rows.map((r) => r.messageId).filter((v) => v != null);
}

// ────────────────────────────────────────────────────────────────────────
// Drafts — état du dernier formulaire soumis, pour pré-remplir "Corriger".
// Stockés dans `userData` (clé = draft:*) pour éviter un nouveau store.
// ────────────────────────────────────────────────────────────────────────

/** Clé canonique d'un draft de collecte. */
export function draftKey(kind, ...parts) {
  return ['draft', kind, ...parts.filter(p => p != null)].join(':');
}

export async function saveDraft(key, data) {
  return putItem(STORES.userData, {
    key,
    draft: data,
    savedAt: new Date().toISOString(),
  });
}

export async function readDraft(key) {
  const row = await getItem(STORES.userData, key);
  return row?.draft || null;
}

export async function clearDraft(key) {
  return deleteItem(STORES.userData, key);
}
