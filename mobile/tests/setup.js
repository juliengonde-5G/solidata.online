import 'fake-indexeddb/auto';

// Shim minimal de localStorage pour les tests s'exécutant en Node.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] || null,
    get length() { return store.size; },
  };
}

// crypto.randomUUID est dispo à partir de Node 20 via globalThis.crypto,
// mais on force l'existence pour les anciens envs.
if (!globalThis.crypto) {
  // @ts-ignore
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = () => {
    return '00000000-0000-4000-8000-000000000000'.replace(/0/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  };
}

// Shim minimal navigator pour les tests sync.js hors navigateur.
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { onLine: true };
} else if (typeof globalThis.navigator.onLine === 'undefined') {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value: true, writable: true, configurable: true,
  });
}

// Shim minimal window pour les tests qui passent par startAutoSync listeners.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    location: { origin: 'http://localhost' },
  };
}

