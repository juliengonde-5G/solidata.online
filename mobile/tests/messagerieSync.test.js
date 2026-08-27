import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addPendingMessage, getPendingMessages, clearStore, getAllItems, getItem, STORES,
} from '../src/services/db.js';
import {
  sendMessagerieMessage, syncPendingMessages, getPendingCount,
  __resetBackoffForTests,
} from '../src/services/sync.js';

// Messagerie mobile — mode conduite (lot L3, 26/08/2026). Contrat de sync
// figé (§2.3 du contrat technique) : POST
// /api/messages/conversations/:id/messages { texte } →
//   201 { message, mentions, ... }
//   400/403/404/409 → refus définitif (texte vide/trop long, périmètre,
//     conversation inconnue, conversation SOLIDATA en lecture seule)
// Mêmes conventions offline que sendChecklist/sendCollect (tests/sync.test.js,
// tests/checklistSync.test.js) : succès → purge file ; 4xx → purge (pas de
// boucle) ; 5xx/réseau → conservé pour retry — jamais de message perdu.

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
  await clearStore(STORES.pendingMessages).catch(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('addPendingMessage', () => {
  it('stocke conversationId/texte + un clientId auto-généré', async () => {
    const id = await addPendingMessage({ conversationId: 7, texte: "J'arrive" });
    const row = await getItem(STORES.pendingMessages, id);
    expect(row).toMatchObject({ conversationId: 7, texte: "J'arrive" });
    expect(typeof row.clientId).toBe('string');
    expect(row.createdAt).toBeTruthy();
  });

  it('réutilise le clientId fourni (idempotence)', async () => {
    const id = await addPendingMessage({ conversationId: 1, texte: 'test', clientId: 'abc-123' });
    const row = await getItem(STORES.pendingMessages, id);
    expect(row.clientId).toBe('abc-123');
  });
});

describe('getPendingMessages — filtre par conversation', () => {
  it("ne renvoie que les messages de LA conversation demandée", async () => {
    await addPendingMessage({ conversationId: 1, texte: 'pour la 1' });
    await addPendingMessage({ conversationId: 2, texte: 'pour la 2' });
    await addPendingMessage({ conversationId: 1, texte: 'encore la 1' });
    const pour1 = await getPendingMessages(1);
    const pour2 = await getPendingMessages(2);
    expect(pour1).toHaveLength(2);
    expect(pour2).toHaveLength(1);
    expect(pour1.every((m) => m.conversationId === 1)).toBe(true);
  });

  it('renvoie un tableau vide (jamais une exception) si la file est vide', async () => {
    expect(await getPendingMessages(999)).toEqual([]);
  });
});

describe('sendMessagerieMessage — contrat', () => {
  it('POST conversations/:id/messages avec { texte } exact', async () => {
    const fetchMock = makeFetchMock([
      { ok: true, status: 201, body: { message: { id: 42, texte: "J'ai compris" } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    await sendMessagerieMessage({ conversationId: 12, texte: "J'ai compris" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/messages/conversations/12/messages');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ texte: "J'ai compris" });
  });

  it('succès 201 : renvoie le corps (le message avec son id serveur)', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: true, status: 201, body: { message: { id: 99, texte: 'OK' } } },
    ]));
    const data = await sendMessagerieMessage({ conversationId: 1, texte: 'OK' });
    expect(data.message).toEqual({ id: 99, texte: 'OK' });
  });

  it('400 TEXTE_REQUIS : lève une erreur avec le statut et le corps attachés', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: false, status: 400, body: { error: 'Le message est vide', code: 'TEXTE_REQUIS' } },
    ]));
    await expect(sendMessagerieMessage({ conversationId: 1, texte: '' })).rejects.toMatchObject({
      response: { status: 400, data: { code: 'TEXTE_REQUIS' } },
    });
  });

  it('409 CONVERSATION_SYSTEME_LECTURE_SEULE : lève une erreur avec le code attaché', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: false, status: 409, body: { code: 'CONVERSATION_SYSTEME_LECTURE_SEULE' } },
    ]));
    await expect(sendMessagerieMessage({ conversationId: 1, texte: 'x' })).rejects.toMatchObject({
      response: { status: 409 },
    });
  });

  it('5xx : lève une erreur (permet à la file de la conserver)', async () => {
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 500, body: {} }]));
    await expect(sendMessagerieMessage({ conversationId: 1, texte: 'x' })).rejects.toMatchObject({
      response: { status: 500 },
    });
  });
});

describe('syncPendingMessages — politique retry', () => {
  it('succès : supprime l’élément de la file', async () => {
    await addPendingMessage({ conversationId: 1, texte: "J'arrive" });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: true, status: 201, body: { message: {} } }]));
    const res = await syncPendingMessages();
    expect(res.synced).toBe(1);
    expect(await getAllItems(STORES.pendingMessages)).toHaveLength(0);
  });

  it('400 (texte vide/trop long) : supprime sans boucler', async () => {
    await addPendingMessage({ conversationId: 1, texte: 'x' });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 400, body: { code: 'TEXTE_TROP_LONG' } }]));
    const res = await syncPendingMessages();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(1);
    expect(await getAllItems(STORES.pendingMessages)).toHaveLength(0);
  });

  it('409 (conversation SOLIDATA en lecture seule au rejeu) : supprime sans boucler', async () => {
    await addPendingMessage({ conversationId: 1, texte: 'x' });
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: false, status: 409, body: { code: 'CONVERSATION_SYSTEME_LECTURE_SEULE' } },
    ]));
    const res = await syncPendingMessages();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(1);
    expect(await getAllItems(STORES.pendingMessages)).toHaveLength(0);
  });

  it('5xx : conserve pour retry (jamais perdu)', async () => {
    await addPendingMessage({ conversationId: 1, texte: 'x' });
    vi.stubGlobal('fetch', makeFetchMock([{ ok: false, status: 502, body: {} }]));
    const res = await syncPendingMessages();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
    expect(await getAllItems(STORES.pendingMessages)).toHaveLength(1);
  });

  it('erreur réseau (hors couverture) : conserve pour retry (jamais perdu, jamais bloquant)', async () => {
    await addPendingMessage({ conversationId: 1, texte: 'x' });
    vi.stubGlobal('fetch', makeFetchMock([new Error('network')]));
    const res = await syncPendingMessages();
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
    expect(await getAllItems(STORES.pendingMessages)).toHaveLength(1);
  });

  it('plusieurs messages en file : les envoie dans l’ordre, un échec réseau arrête le lot', async () => {
    await addPendingMessage({ conversationId: 1, texte: 'un' });
    await addPendingMessage({ conversationId: 1, texte: 'deux' });
    vi.stubGlobal('fetch', makeFetchMock([
      { ok: true, status: 201, body: { message: {} } },
      new Error('network'),
    ]));
    const res = await syncPendingMessages();
    expect(res.synced).toBe(1);
    expect(await getAllItems(STORES.pendingMessages)).toHaveLength(1);
  });
});

describe('getPendingCount inclut les messages en attente', () => {
  it('remonte le compteur messages dans le total agrégé', async () => {
    await addPendingMessage({ conversationId: 1, texte: "J'arrive" });
    const counts = await getPendingCount();
    expect(counts.messages).toBe(1);
    expect(counts.total).toBeGreaterThanOrEqual(1);
  });
});
