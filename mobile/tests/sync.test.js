import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addPendingWeight, addPendingCollect, addPendingIncident,
  clearStore, getAllItems, STORES,
} from '../src/services/db.js';
import {
  sendWeight, sendIncident, sendCollect,
  syncPendingWeights, syncPendingIncidents, syncPendingCollects,
  getPendingCount, syncEvents, __resetBackoffForTests,
} from '../src/services/sync.js';

// Utilitaire : prépare un mock fetch qui retourne la séquence donnée.
// Chaque entrée peut être :
//   - { ok: true, status: 200, body: {} }
//   - { ok: false, status: 400|500, body: {} }
//   - Error('network') — simule une panne réseau (fetch rejette)
function makeFetchMock(sequence) {
  const queue = [...sequence];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch call');
    if (next instanceof Error) throw next;
    return {
      ok: !!next.ok,
      status: next.status ?? (next.ok ? 200 : 500),
      json: async () => next.body || {},
    };
  });
}

beforeEach(async () => {
  __resetBackoffForTests();
  await Promise.all(
    [STORES.pendingWeights, STORES.pendingCollects, STORES.pendingIncidents]
      .map(s => clearStore(s).catch(() => {}))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendWeight', () => {
  it('envoie weigh-public + status-public si finalize', async () => {
    const fetchMock = makeFetchMock([
      { ok: true, status: 201 }, // weigh-public
      { ok: true, status: 200 }, // status-public
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendWeight({
      tourId: 1, weightKg: 500, tareKg: 3500, isIntermediate: false, finalize: true,
    });
    expect(res.weighOk).toBe(true);
    expect(res.statusOk).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/weigh-public');
    expect(fetchMock.mock.calls[1][0]).toContain('/status-public');
  });

  it('ne chaîne pas status-public pour une pesée intermédiaire', async () => {
    const fetchMock = makeFetchMock([{ ok: true, status: 201 }]);
    vi.stubGlobal('fetch', fetchMock);
    await sendWeight({ tourId: 1, weightKg: 500, isIntermediate: true, finalize: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tolère un 4xx sur status-public (tournée déjà complétée) sans throw', async () => {
    const fetchMock = makeFetchMock([
      { ok: true, status: 201 },           // weigh-public
      { ok: false, status: 409, body: {} }, // status-public refusé
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendWeight({ tourId: 1, weightKg: 500, finalize: true });
    expect(res.weighOk).toBe(true);
    expect(res.statusOk).toBe(false);
    expect(res.statusCode).toBe(409);
  });

  it('propage une erreur 5xx sur weigh-public', async () => {
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 500 }]));
    await expect(sendWeight({ tourId: 1, weightKg: 500 })).rejects.toMatchObject({
      response: { status: 500 },
    });
  });
});

describe('sendIncident / sendCollect contrat', () => {
  it('sendIncident POST vers incident-public avec type + client_id', async () => {
    const fetchMock = makeFetchMock([{ ok: true, status: 201, body: { id: 1 } }]);
    vi.stubGlobal('fetch', fetchMock);
    await sendIncident({ tourId: 42, type: 'accident', clientId: 'abc' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/tours/42/incident-public');
    const body = JSON.parse(opts.body);
    expect(body.type).toBe('accident');
    expect(body.client_id).toBe('abc');
  });

  it('sendCollect PUT collect-public avec fill_level', async () => {
    const fetchMock = makeFetchMock([{ ok: true, status: 200 }]);
    vi.stubGlobal('fetch', fetchMock);
    await sendCollect({
      tourId: 1, cavId: 99, fillLevel: 3, qrScanned: true, clientId: 'x',
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('PUT');
    expect(url).toContain('/tours/1/cav/99/collect-public');
    const body = JSON.parse(opts.body);
    expect(body.fill_level).toBe(3);
    expect(body.qr_scanned).toBe(true);
  });
});

describe('syncPendingWeights — politique retry', () => {
  it('succès : supprime l\u2019élément de la file', async () => {
    await addPendingWeight({ tourId: 1, weightKg: 500, finalize: false });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: true, status: 201 }]));
    const res = await syncPendingWeights();
    expect(res.synced).toBe(1);
    expect(await getAllItems(STORES.pendingWeights)).toHaveLength(0);
  });

  it('4xx : supprime (évite la boucle) et compte en failed', async () => {
    await addPendingWeight({ tourId: 1, weightKg: 500, finalize: false });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 400 }]));
    const res = await syncPendingWeights();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(1);
    expect(await getAllItems(STORES.pendingWeights)).toHaveLength(0);
  });

  it('5xx : conserve pour retry (file intacte)', async () => {
    await addPendingWeight({ tourId: 1, weightKg: 500, finalize: false });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 502 }]));
    const res = await syncPendingWeights();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
    expect(await getAllItems(STORES.pendingWeights)).toHaveLength(1);
  });

  it('network error : conserve pour retry', async () => {
    await addPendingWeight({ tourId: 1, weightKg: 500, finalize: false });
    vi.stubGlobal('fetch', makeFetchMock([new Error('network')]));
    const res = await syncPendingWeights();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
    expect(await getAllItems(STORES.pendingWeights)).toHaveLength(1);
  });

  it('après un échec réseau, backoff skip la tentative suivante', async () => {
    await addPendingWeight({ tourId: 1, weightKg: 500, finalize: false });
    vi.stubGlobal('fetch', makeFetchMock([new Error('net')]));
    await syncPendingWeights();
    // Pas de nouvel appel fetch : backoff actif
    const secondFetch = makeFetchMock([]);
    vi.stubGlobal('fetch', secondFetch);
    const res = await syncPendingWeights();
    expect(res.skipped).toBe(true);
    expect(secondFetch).not.toHaveBeenCalled();
  });
});

describe('syncPendingCollects + syncPendingIncidents', () => {
  it('collecte 2xx : file vidée', async () => {
    await addPendingCollect({ tourId: 1, cavId: 3, fillLevel: 2 });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: true, status: 200 }]));
    const res = await syncPendingCollects();
    expect(res.synced).toBe(1);
  });

  it('incident 4xx : purge', async () => {
    await addPendingIncident({ tourId: 1, type: 'accident' });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 400 }]));
    const res = await syncPendingIncidents();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(1);
    expect(await getAllItems(STORES.pendingIncidents)).toHaveLength(0);
  });

  it('incident 5xx : conserve', async () => {
    await addPendingIncident({ tourId: 1, type: 'accident' });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 500 }]));
    const res = await syncPendingIncidents();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
    expect(await getAllItems(STORES.pendingIncidents)).toHaveLength(1);
  });
});

describe('getPendingCount + syncEvents', () => {
  it('émet un event pending avec les compteurs agrégés', async () => {
    await addPendingCollect({ tourId: 1, cavId: 1, fillLevel: 2 });
    await addPendingIncident({ tourId: 1, type: 'other' });

    const detailP = new Promise((resolve) => {
      syncEvents.addEventListener('pending', (e) => resolve(e.detail), { once: true });
    });
    const counts = await getPendingCount();
    const detail = await detailP;

    expect(counts.total).toBe(2);
    expect(counts.collects).toBe(1);
    expect(counts.incidents).toBe(1);
    expect(detail.counts.total).toBe(2);
  });
});
