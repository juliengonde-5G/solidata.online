/**
 * IndexedDB service for offline-first mobile PWA
 * Stores tours, CAVs, and pending scans/weights/GPS for offline operation
 */

const DB_NAME = 'solidata-mobile';
const DB_VERSION = 1;

export const STORES = {
  tours: 'tours',
  cavs: 'cavs',
  pendingScans: 'pendingScans',
  pendingWeights: 'pendingWeights',
  gpsBuffer: 'gpsBuffer',
  userData: 'userData',
};

/**
 * Ouvrir (ou créer) la base IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Ajouter ou mettre à jour un élément dans un store
 * @param {string} storeName
 * @param {object} item
 * @returns {Promise<IDBValidKey>}
 */
export async function putItem(storeName, item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Récupérer un élément par sa clé
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<object|undefined>}
 */
export async function getItem(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Récupérer tous les éléments d'un store
 * @param {string} storeName
 * @returns {Promise<object[]>}
 */
export async function getAllItems(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Supprimer un élément par sa clé
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<void>}
 */
export async function deleteItem(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Vider entièrement un store
 * @param {string} storeName
 * @returns {Promise<void>}
 */
export async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Compter le nombre d'éléments dans un store
 * @param {string} storeName
 * @returns {Promise<number>}
 */
export async function countItems(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Ajouter un scan en attente de synchronisation
 * @param {object} scanData - { tourId, cavId, scannedAt }
 */
export async function addPendingScan(scanData) {
  return putItem(STORES.pendingScans, {
    ...scanData,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Ajouter un poids en attente de synchronisation
 * @param {object} weightData - { tourId, weightKg, recordedAt }
 */
export async function addPendingWeight(weightData) {
  return putItem(STORES.pendingWeights, {
    ...weightData,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Ajouter une position GPS au buffer
 * @param {object} gpsData - { tourId, vehicleId, latitude, longitude, speed }
 */
export async function addGpsPosition(gpsData) {
  return putItem(STORES.gpsBuffer, {
    ...gpsData,
    recordedAt: new Date().toISOString(),
  });
}
