// ═══════════════════════════════════════════════════════════════════════════
// SACS COLLECTÉS CHEZ UNE ASSOCIATION — file hors ligne et envoi
// ───────────────────────────────────────────────────────────────────────────
// Doctrine du dépôt : jamais perdu, jamais bloquant. Un compteur qui ne
// survivrait pas à une coupure serait pire qu'inutile — le serveur retomberait
// sur une répartition à parts égales sans que personne le sache, et l'écran
// aurait pourtant affiché « départ enregistré ».
//
// Le piège central que ces tests verrouillent : `0 sac` est une DÉCLARATION
// (« rien chargé »), pas une absence. Un `||` au lieu d'un `??` la
// transformerait silencieusement en « non déclaré », et sortirait le point de
// la répartition du poids.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addPendingCollect, clearStore, getAllItems, STORES } from '../src/services/db.js';
import { sendCollect, syncPendingCollects, __resetBackoffForTests } from '../src/services/sync.js';

beforeEach(async () => {
  __resetBackoffForTests();
  await clearStore(STORES.pendingCollects).catch(() => {});
  localStorage.setItem('token', 'jeton-de-test');
});

afterEach(() => vi.unstubAllGlobals());

/** Le corps JSON réellement transmis au serveur. */
function corpsEnvoye(fetchMock, appel = 0) {
  return JSON.parse(fetchMock.mock.calls[appel][1].body);
}

function fetchOk() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
}

describe('file hors ligne — le compteur de sacs voyage avec la collecte', () => {
  it('conserve le nombre de sacs', async () => {
    await addPendingCollect({ tourId: 7, cavId: 42, nbSacs: 14, notes: 'porte arrière' });
    const [item] = await getAllItems(STORES.pendingCollects);
    expect(item.nbSacs).toBe(14);
  });

  it('conserve ZÉRO sac — « rien chargé » n’est pas « non déclaré »', async () => {
    await addPendingCollect({ tourId: 7, cavId: 42, nbSacs: 0 });
    const [item] = await getAllItems(STORES.pendingCollects);
    expect(item.nbSacs).toBe(0);
    expect(item.nbSacs).not.toBeNull();
  });

  it('une collecte sans compteur (borne de rue) reste à null', async () => {
    await addPendingCollect({ tourId: 7, cavId: 42, fillLevel: 3 });
    const [item] = await getAllItems(STORES.pendingCollects);
    expect(item.nbSacs).toBeNull();
  });

  it('un point SAUTÉ n’emporte aucun compteur', async () => {
    await addPendingCollect({ tourId: 7, cavId: 42, action: 'skip', skipReason: 'vide', nbSacs: 9 });
    const [item] = await getAllItems(STORES.pendingCollects);
    expect(item.nbSacs).toBeNull();
  });

  it('l’heure d’arrivée et le pourcentage réel survivent aussi à la file', async () => {
    // Ils étaient envoyés par sendCollect mais PERDUS au passage par la file :
    // une collecte rejouée après coupure repartait sans eux.
    const arrivee = '2026-08-27T09:12:00.000Z';
    await addPendingCollect({ tourId: 7, cavId: 42, nbSacs: 3, arriveeAt: arrivee, fillPercent: 110 });
    const [item] = await getAllItems(STORES.pendingCollects);
    expect(item.arriveeAt).toBe(arrivee);
    expect(item.fillPercent).toBe(110);
  });
});

describe('envoi — le serveur reçoit bien le compteur', () => {
  it('sendCollect transmet nb_sacs', async () => {
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    await sendCollect({ tourId: 7, cavId: 42, nbSacs: 14, clientId: 'c1' });
    expect(corpsEnvoye(f).nb_sacs).toBe(14);
  });

  it('sendCollect transmet ZÉRO (et non null)', async () => {
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    await sendCollect({ tourId: 7, cavId: 42, nbSacs: 0, clientId: 'c1' });
    expect(corpsEnvoye(f).nb_sacs).toBe(0);
  });

  it('aucun niveau n’est envoyé depuis l’écran association : le serveur le dérive', async () => {
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    // Charge exacte construite par AssociationStop.declarerDepart.
    await sendCollect({ tourId: 7, cavId: 42, nbSacs: 14, notes: '', qrScanned: false, arriveeAt: null, clientId: 'c1' });
    const corps = corpsEnvoye(f);
    expect(corps.nb_sacs).toBe(14);
    expect(corps.fill_level).toBeUndefined();   // JSON.stringify écarte undefined
  });

  it('un point sauté n’envoie pas de compteur', async () => {
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    await sendCollect({ tourId: 7, cavId: 42, action: 'skip', skipReason: 'vide', clientId: 'c1' });
    expect(corpsEnvoye(f).nb_sacs).toBeUndefined();
  });
});

describe('rejeu après coupure — bout en bout', () => {
  it('le compteur mis en file hors ligne repart intact à la reconnexion', async () => {
    // Hors ligne : la collecte est mise en file (aucun réseau sollicité).
    await addPendingCollect({ tourId: 7, cavId: 42, nbSacs: 14, clientId: 'c9' });
    expect(await getAllItems(STORES.pendingCollects)).toHaveLength(1);

    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    const bilan = await syncPendingCollects();

    expect(bilan.synced).toBe(1);
    expect(corpsEnvoye(f).nb_sacs).toBe(14);
    expect(await getAllItems(STORES.pendingCollects)).toHaveLength(0);
  });

  it('zéro sac survit au rejeu (contre-épreuve du piège `||`)', async () => {
    await addPendingCollect({ tourId: 7, cavId: 42, nbSacs: 0, clientId: 'c10' });
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    await syncPendingCollects();
    expect(corpsEnvoye(f).nb_sacs).toBe(0);
  });
});
