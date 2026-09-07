// ═══════════════════════════════════════════════════════════════════════════
// BORDEREAU DÉCHÈTERIE — file hors ligne et envoi (chantier 2.50.0)
// ───────────────────────────────────────────────────────────────────────────
// C'est la SEULE file du mobile qui transporte un blob, et c'est délibéré :
// une photo se reprend au prochain passage, la signature d'un agent de
// déchèterie ne se recueille jamais une seconde fois. La contrepartie, c'est
// que la politique de purge doit être exacte au statut près :
//   • 2xx  → purge (le serveur a le document) ;
//   • 4xx  → purge (refus DÉFINITIF : rejouer ne changerait rien) ;
//   • 401  → conservé (problème d'auth, jamais une donnée invalide) ;
//   • 5xx / réseau → conservé (le serveur reviendra).
// Un 5xx qui purgerait détruirait une pièce signée ; un 4xx qui conserverait
// ferait boucler la file jusqu'à la fin de la tournée.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addPendingBordereau, clearStore, getAllItems, STORES,
} from '../src/services/db.js';
import {
  sendBordereau, syncPendingBordereaux, syncAll, getPendingCount,
  __resetBackoffForTests,
} from '../src/services/sync.js';
import { MOTIF_AGENT_INDISPONIBLE } from '../src/services/decheterie.js';

const PNG_AGENT = `data:image/png;base64,${'A'.repeat(64)}`;
const PNG_CHAUFFEUR = `data:image/png;base64,${'B'.repeat(64)}`;

function reponse(spec) {
  return {
    ok: !!spec.ok,
    status: spec.status ?? (spec.ok ? 200 : 500),
    json: async () => spec.body || {},
  };
}

function fetchSequence(sequence) {
  const file = [...sequence];
  return vi.fn(async () => {
    const suivant = file.shift();
    if (!suivant) throw new Error('appel fetch inattendu');
    if (suivant instanceof Error) throw suivant;
    return reponse(suivant);
  });
}

/** Le corps JSON réellement transmis au serveur. */
function corpsEnvoye(fetchMock, appel = 0) {
  return JSON.parse(fetchMock.mock.calls[appel][1].body);
}

const itemComplet = {
  clientId: 'cli-1', tourId: 681, cavId: 338, poidsKg: 185,
  signatureAgent: PNG_AGENT, agentAbsentMotif: null, signatureChauffeur: PNG_CHAUFFEUR,
};

beforeEach(async () => {
  __resetBackoffForTests();
  await clearStore(STORES.pendingBordereaux).catch(() => {});
  await clearStore(STORES.pendingCollects).catch(() => {});
  localStorage.setItem('mobile_token', 'jeton-de-test');
});

afterEach(() => vi.unstubAllGlobals());

describe('file hors ligne — le bordereau et ses signatures survivent', () => {
  it('conserve les deux signatures et le poids', async () => {
    await addPendingBordereau(itemComplet);
    const [item] = await getAllItems(STORES.pendingBordereaux);
    expect(item.signatureAgent).toBe(PNG_AGENT);
    expect(item.signatureChauffeur).toBe(PNG_CHAUFFEUR);
    expect(item.poidsKg).toBe(185);
    expect(item.clientId).toBe('cli-1');
  });

  it('conserve le motif quand l’agent n’était pas là', async () => {
    await addPendingBordereau({
      ...itemComplet, signatureAgent: null, agentAbsentMotif: MOTIF_AGENT_INDISPONIBLE,
    });
    const [item] = await getAllItems(STORES.pendingBordereaux);
    expect(item.signatureAgent).toBeNull();
    expect(item.agentAbsentMotif).toBe('agent_indisponible');
  });

  it('conserve ZÉRO kg — « rien pris » n’est pas « non déclaré »', async () => {
    await addPendingBordereau({ ...itemComplet, poidsKg: 0 });
    const [item] = await getAllItems(STORES.pendingBordereaux);
    expect(item.poidsKg).toBe(0);
    expect(item.poidsKg).not.toBeNull();
  });

  it('génère un clientId quand l’appelant n’en fournit pas (idempotence)', async () => {
    await addPendingBordereau({ tourId: 1, cavId: 2, poidsKg: 5, signatureChauffeur: PNG_CHAUFFEUR });
    const [item] = await getAllItems(STORES.pendingBordereaux);
    expect(typeof item.clientId).toBe('string');
    expect(item.clientId.length).toBeGreaterThan(8);
  });

  it('est compté dans les éléments en attente', async () => {
    await addPendingBordereau(itemComplet);
    const counts = await getPendingCount();
    expect(counts.bordereaux).toBe(1);
    expect(counts.total).toBeGreaterThanOrEqual(1);
  });
});

describe('sendBordereau — URL et corps du contrat §2.1', () => {
  it('POST sur la route -public de la tournée ET du point', async () => {
    const f = fetchSequence([{ ok: true, status: 201, body: { bordereau: { numero: 'BD-2026-0007' } } }]);
    vi.stubGlobal('fetch', f);
    await sendBordereau(itemComplet);
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe('/api/tours/681/cav/338/bordereau-decheterie-public');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('transmet exactement les cinq champs du contrat', async () => {
    const f = fetchSequence([{ ok: true, status: 201 }]);
    vi.stubGlobal('fetch', f);
    await sendBordereau(itemComplet);
    const corps = corpsEnvoye(f);
    expect(Object.keys(corps).sort()).toEqual([
      'agent_absent_motif', 'client_id', 'poids_indicatif_kg',
      'signature_agent', 'signature_chauffeur',
    ]);
    expect(corps.client_id).toBe('cli-1');
    expect(corps.poids_indicatif_kg).toBe(185);
    expect(corps.signature_agent).toBe(PNG_AGENT);
    expect(corps.signature_chauffeur).toBe(PNG_CHAUFFEUR);
    expect(corps.agent_absent_motif).toBeNull();
  });

  it('transmet le motif d’absence quand l’agent n’a pas signé', async () => {
    const f = fetchSequence([{ ok: true, status: 201 }]);
    vi.stubGlobal('fetch', f);
    await sendBordereau({ ...itemComplet, signatureAgent: null, agentAbsentMotif: MOTIF_AGENT_INDISPONIBLE });
    const corps = corpsEnvoye(f);
    expect(corps.signature_agent).toBeNull();
    expect(corps.agent_absent_motif).toBe('agent_indisponible');
  });

  it('attache le corps de la réponse à l’erreur (motif de refus lisible)', async () => {
    vi.stubGlobal('fetch', fetchSequence([
      { ok: false, status: 409, body: { error: 'Ce point n’est pas une déchèterie', code: 'POINT_NON_DECHETERIE' } },
    ]));
    await expect(sendBordereau(itemComplet)).rejects.toMatchObject({
      response: { status: 409, data: { code: 'POINT_NON_DECHETERIE' } },
    });
  });
});

describe('syncPendingBordereaux — politique de purge (le triptyque)', () => {
  it('2xx : le bordereau est purgé de la file', async () => {
    await addPendingBordereau(itemComplet);
    const f = fetchSequence([{ ok: true, status: 201 }]);
    vi.stubGlobal('fetch', f);
    const bilan = await syncPendingBordereaux();
    expect(bilan.synced).toBe(1);
    expect(await getAllItems(STORES.pendingBordereaux)).toHaveLength(0);
    // Le corps rejoué est bien celui du contrat, signatures comprises.
    expect(corpsEnvoye(f).signature_chauffeur).toBe(PNG_CHAUFFEUR);
  });

  it('4xx : purge (refus définitif, aucune boucle)', async () => {
    await addPendingBordereau(itemComplet);
    vi.stubGlobal('fetch', fetchSequence([{ ok: false, status: 409, body: { code: 'POINT_NON_DECHETERIE' } }]));
    const bilan = await syncPendingBordereaux();
    expect(bilan.synced).toBe(0);
    expect(bilan.failed).toBe(1);
    expect(await getAllItems(STORES.pendingBordereaux)).toHaveLength(0);
  });

  it('5xx : conserve pour rejeu — on ne détruit pas une pièce signée', async () => {
    await addPendingBordereau(itemComplet);
    vi.stubGlobal('fetch', fetchSequence([{ ok: false, status: 503 }]));
    const bilan = await syncPendingBordereaux();
    expect(bilan.synced).toBe(0);
    expect(bilan.failed).toBe(0);
    expect(await getAllItems(STORES.pendingBordereaux)).toHaveLength(1);
  });

  it('panne réseau : conserve', async () => {
    await addPendingBordereau(itemComplet);
    vi.stubGlobal('fetch', fetchSequence([new Error('network')]));
    const bilan = await syncPendingBordereaux();
    expect(bilan.synced).toBe(0);
    expect(await getAllItems(STORES.pendingBordereaux)).toHaveLength(1);
  });
});

describe('syncAll rejoue bien le store', () => {
  it('un bordereau mis en file hors ligne repart intact à la reconnexion', async () => {
    await addPendingBordereau(itemComplet);
    expect(await getAllItems(STORES.pendingBordereaux)).toHaveLength(1);

    // syncAll enchaîne toutes les files ; seule celle-ci a un élément, donc un
    // seul appel réseau est attendu.
    const f = fetchSequence([{ ok: true, status: 201 }]);
    vi.stubGlobal('fetch', f);
    const bilan = await syncAll();

    expect(bilan.synced).toBe(true);
    expect(bilan.results.bordereaux.synced).toBe(1);
    expect(f.mock.calls[0][0]).toContain('/bordereau-decheterie-public');
    expect(corpsEnvoye(f).poids_indicatif_kg).toBe(185);
    expect(await getAllItems(STORES.pendingBordereaux)).toHaveLength(0);
  });
});
