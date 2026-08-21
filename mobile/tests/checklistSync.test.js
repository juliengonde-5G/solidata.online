import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addPendingChecklist, clearStore, getAllItems, getItem, STORES,
} from '../src/services/db.js';
import {
  sendChecklist, syncPendingChecklists, getPendingCount,
  __resetBackoffForTests,
} from '../src/services/sync.js';

// Checklist de début de journée (Checklist.jsx) — contrat de sync figé :
//   POST /tours/:id/checklist-public
//     200/201 → { ..., message_prevention: {id,titre,texte} | null }
//     409 CHECKLIST_DEJA_FAITE → { error, code, faite_le }
// Mêmes conventions offline que sendWeight/sendIncident/sendCollect
// (tests/sync.test.js) : succès → purge file ; 4xx → purge (pas de boucle) ;
// 5xx/réseau → conservé pour retry.

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
  await clearStore(STORES.pendingChecklists).catch(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('addPendingChecklist', () => {
  it('stocke les champs métier + un clientId auto-généré', async () => {
    const id = await addPendingChecklist({
      tourId: 7,
      vehicleId: 12,
      exteriorOk: true,
      fuelLevel: '1/2',
      kmStart: 45230,
      notes: 'RAS',
      degats: [{ vue: 'avant', x: 0.2, y: 0.3, type: 'rayure' }],
    });
    const row = await getItem(STORES.pendingChecklists, id);
    expect(row).toMatchObject({
      tourId: 7, vehicleId: 12, exteriorOk: true, fuelLevel: '1/2', kmStart: 45230, notes: 'RAS',
    });
    expect(row.degats).toHaveLength(1);
    expect(typeof row.clientId).toBe('string');
    expect(row.createdAt).toBeTruthy();
  });

  it('normalise les champs facultatifs absents (vehicleId/notes null, degats [])', async () => {
    const id = await addPendingChecklist({ tourId: 1, exteriorOk: true });
    const row = await getItem(STORES.pendingChecklists, id);
    expect(row.vehicleId).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.degats).toEqual([]);
  });
});

describe('sendChecklist — contrat', () => {
  it('POST checklist-public avec le body attendu (dont degats + client_id)', async () => {
    const fetchMock = makeFetchMock([
      { ok: true, status: 200, body: { message_prevention: null } },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    await sendChecklist({
      tourId: 42,
      vehicleId: 9,
      exteriorOk: true,
      fuelLevel: '1/2',
      kmStart: 100,
      notes: 'ok',
      degats: [{ vue: 'droit', x: 0.5, y: 0.5, type: 'choc' }],
      clientId: 'abc',
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/tours/42/checklist-public');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.vehicle_id).toBe(9);
    expect(body.exterior_ok).toBe(true);
    expect(body.km_start).toBe(100);
    expect(body.client_id).toBe('abc');
    expect(body.degats).toEqual([{ vue: 'droit', x: 0.5, y: 0.5, type: 'choc' }]);
  });

  it('succès : renvoie le corps (avec message_prevention le cas échéant)', async () => {
    const mp = { id: 3, titre: 'Distances de sécurité', texte: 'Garde tes distances.' };
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: true, status: 201, body: { message_prevention: mp } },
    ]));
    const data = await sendChecklist({ tourId: 1, exteriorOk: true });
    expect(data.message_prevention).toEqual(mp);
  });

  it('409 CHECKLIST_DEJA_FAITE : lève une erreur avec le corps attaché (code, faite_le)', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: false, status: 409, body: { error: 'Déjà faite', code: 'CHECKLIST_DEJA_FAITE', faite_le: '2026-08-21T06:12:00Z' } },
    ]));
    await expect(sendChecklist({ tourId: 1, exteriorOk: true })).rejects.toMatchObject({
      response: {
        status: 409,
        data: { code: 'CHECKLIST_DEJA_FAITE', faite_le: '2026-08-21T06:12:00Z' },
      },
    });
  });

  it('4xx générique : lève une erreur avec le statut attaché', async () => {
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 400, body: { error: 'invalide' } }]));
    await expect(sendChecklist({ tourId: 1, exteriorOk: true })).rejects.toMatchObject({
      response: { status: 400 },
    });
  });

  it('5xx : lève une erreur (permet au conservateur en file de la garder)', async () => {
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 500, body: {} }]));
    await expect(sendChecklist({ tourId: 1, exteriorOk: true })).rejects.toMatchObject({
      response: { status: 500 },
    });
  });
});

describe('syncPendingChecklists — politique retry', () => {
  it('succès : supprime l’élément de la file', async () => {
    await addPendingChecklist({ tourId: 1, exteriorOk: true });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: true, status: 200, body: {} }]));
    const res = await syncPendingChecklists();
    expect(res.synced).toBe(1);
    expect(await getAllItems(STORES.pendingChecklists)).toHaveLength(0);
  });

  it('409 (déjà faite au rejeu) : supprime sans boucler', async () => {
    await addPendingChecklist({ tourId: 1, exteriorOk: true });
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: false, status: 409, body: { code: 'CHECKLIST_DEJA_FAITE' } },
    ]));
    const res = await syncPendingChecklists();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(1);
    expect(await getAllItems(STORES.pendingChecklists)).toHaveLength(0);
  });

  it('4xx générique : supprime (évite la boucle) et compte en failed', async () => {
    await addPendingChecklist({ tourId: 1, exteriorOk: true });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 400, body: {} }]));
    const res = await syncPendingChecklists();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(1);
    expect(await getAllItems(STORES.pendingChecklists)).toHaveLength(0);
  });

  it('5xx : conserve pour retry (file intacte)', async () => {
    await addPendingChecklist({ tourId: 1, exteriorOk: true });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 502, body: {} }]));
    const res = await syncPendingChecklists();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
    expect(await getAllItems(STORES.pendingChecklists)).toHaveLength(1);
  });

  it('erreur réseau : conserve pour retry', async () => {
    await addPendingChecklist({ tourId: 1, exteriorOk: true });
    vi.stubGlobal('fetch', makeFetchMock([new Error('network')]));
    const res = await syncPendingChecklists();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
    expect(await getAllItems(STORES.pendingChecklists)).toHaveLength(1);
  });
});

describe('getPendingCount inclut les checklists en attente', () => {
  it('remonte le compteur checklists dans le total agrégé', async () => {
    await addPendingChecklist({ tourId: 1, exteriorOk: true });
    const counts = await getPendingCount();
    expect(counts.checklists).toBe(1);
    expect(counts.total).toBeGreaterThanOrEqual(1);
  });
});
