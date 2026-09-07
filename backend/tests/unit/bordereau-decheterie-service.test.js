// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — services/bordereau-decheterie.js
// ───────────────────────────────────────────────────────────────────────────
// Les règles de ce service décident de ce qui entre dans un document signé par
// un tiers : une commune rapprochée à tort marque un conteneur de rue comme
// déchèterie, une signature mal décodée met un carré noir à la place d'un
// paraphe. Elles sont donc vérifiées sans base et sans HTTP.
// ═══════════════════════════════════════════════════════════════════════════
const svc = require('../../src/services/bordereau-decheterie');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;

describe('normaliserCommune — garde du rapprochement des déchèteries', () => {
  it('ignore casse, accents et tirets (les deux référentiels ne s’écrivent pas pareil)', () => {
    const attendu = 'caudebec les elbeuf';
    for (const forme of ['Caudebec-lès-Elbeuf', 'CAUDEBEC LES ELBEUF', 'caudebec lès elbeuf',
      '  Caudebec-Lès-Elbeuf  ', 'Caudebec   lès   Elbeuf']) {
      expect(svc.normaliserCommune(forme)).toBe(attendu);
    }
  });

  it('ne rapproche pas deux communes distinctes', () => {
    expect(svc.normaliserCommune('Le Petit-Quevilly')).not.toBe(svc.normaliserCommune('Grand Quevilly'));
    expect(svc.normaliserCommune('Boos')).not.toBe(svc.normaliserCommune('Bois Guillaume'));
  });

  it('conserve l’article initial (« Le Trait » n’est pas « Trait »)', () => {
    expect(svc.normaliserCommune('Le Trait')).toBe('le trait');
    expect(svc.normaliserCommune('Le Trait')).not.toBe(svc.normaliserCommune('Trait'));
  });

  it('absence de valeur → chaîne vide, jamais « undefined »', () => {
    expect(svc.normaliserCommune(null)).toBe('');
    expect(svc.normaliserCommune(undefined)).toBe('');
  });

  it('le référentiel client se rapproche des libellés du formulaire', () => {
    // Le fichier de données écrit « Le Petit Quevilly », le formulaire
    // « Petit-Quevilly » : ce n'est PAS la commune qui sert à retrouver la case
    // (c'est `code_bordereau`), mais le seed compare bien commune à commune.
    const referentiel = require('../../src/data/decheteries-metropole.json').decheteries;
    expect(referentiel).toHaveLength(15);
    const codes = referentiel.map((d) => d.code_bordereau).filter(Boolean);
    expect(codes).toHaveLength(7);
    for (const c of codes) expect(svc.estDecheterieConnue(c)).toBe(true);
  });
});

describe('validerPoids — refus net, jamais de valeur de remplacement', () => {
  it('accepte les bornes utiles', () => {
    expect(svc.validerPoids(185)).toEqual({ ok: true, valeur: 185 });
    expect(svc.validerPoids('185.4')).toEqual({ ok: true, valeur: 185.4 });
    expect(svc.validerPoids(0)).toEqual({ ok: true, valeur: 0 });      // « rien chargé »
    expect(svc.validerPoids(60000)).toEqual({ ok: true, valeur: 60000 });
  });

  it('arrondit à la décimale de la colonne NUMERIC(8,1)', () => {
    expect(svc.validerPoids(185.46).valeur).toBe(185.5);
  });

  it('refuse ce qui n’est pas un poids', () => {
    for (const v of ['beaucoup', null, undefined, '', NaN, Infinity, -1, 60001, {}]) {
      expect(svc.validerPoids(v).ok).toBe(false);
    }
  });
});

describe('decoderSignature — trois refus distincts', () => {
  it('accepte une data URL PNG', () => {
    const r = svc.decoderSignature(PNG_URL);
    expect(r.ok).toBe(true);
    expect(Buffer.isBuffer(r.buffer)).toBe(true);
    expect(svc.MOTIFS_SIGNATURE_ABSENTE.agent_indisponible).toMatch(/agent indisponible/);
  });

  it('refuse l’absence, un autre format, et un base64 qui n’est pas un PNG', () => {
    expect(svc.decoderSignature(null)).toEqual({ ok: false, motif: 'absente' });
    expect(svc.decoderSignature('')).toEqual({ ok: false, motif: 'absente' });
    expect(svc.decoderSignature('data:image/jpeg;base64,AAAA').motif).toBe('format');
    expect(svc.decoderSignature('pas une data url').motif).toBe('format');
    // En-tête data URL correcte mais contenu qui n'est pas un PNG : le magic
    // number est vérifié, pas seulement le préfixe déclaré par le client.
    expect(svc.decoderSignature(`data:image/png;base64,${Buffer.from('coucou').toString('base64')}`).motif)
      .toBe('format');
  });

  it('refuse au-delà de 200 Ko décodés', () => {
    const gros = Buffer.concat([PNG, Buffer.alloc(svc.SIGNATURE_MAX_OCTETS, 0x41)]);
    expect(svc.decoderSignature(`data:image/png;base64,${gros.toString('base64')}`).motif).toBe('taille');
  });
});

describe('motifs et identifiant de dépôt', () => {
  it('la liste des motifs d’absence de l’agent est FERMÉE', () => {
    expect(svc.motifAgentValide('agent_indisponible')).toBe(true);
    // « anonymisation » est posé par le SERVEUR sur la signature du chauffeur :
    // un mobile ne doit jamais pouvoir le déclarer pour l'agent.
    expect(svc.motifAgentValide('anonymisation')).toBe(false);
    for (const v of ['flemme', '', null, undefined, 42]) expect(svc.motifAgentValide(v)).toBe(false);
  });

  it('client_id : non vide et ≤ 64 caractères (colonne VARCHAR(64))', () => {
    expect(svc.validerClientId(' abc ')).toEqual({ ok: true, valeur: 'abc' });
    expect(svc.validerClientId('x'.repeat(64)).ok).toBe(true);
    expect(svc.validerClientId('x'.repeat(65)).ok).toBe(false);
    expect(svc.validerClientId('   ').ok).toBe(false);
    expect(svc.validerClientId(null).ok).toBe(false);
  });
});

describe('libelleSnapshot — jamais de case cochée au hasard', () => {
  it('code connu → libellé du formulaire', () => {
    expect(svc.libelleSnapshot('petit_quevilly', 'peu importe')).toBe('Petit-Quevilly');
  });
  it('hors liste → nom du point, tel qu’il est au référentiel', () => {
    expect(svc.libelleSnapshot(null, 'ROUEN - 1 Quai du Pré aux loups'))
      .toBe('ROUEN - 1 Quai du Pré aux loups');
  });
  it('ni l’un ni l’autre → un libellé neutre, jamais une chaîne vide', () => {
    expect(svc.libelleSnapshot(null, null)).toBe('Déchèterie');
  });
});

describe('numeroSuivant — BD-AAAA-NNNN', () => {
  const db = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });

  it('première de l’année → 0001', async () => {
    expect(await svc.numeroSuivant(db([]), 2026)).toBe('BD-2026-0001');
  });

  it('incrémente le dernier numéro de l’année', async () => {
    expect(await svc.numeroSuivant(db([{ numero: 'BD-2026-0006' }]), 2026)).toBe('BD-2026-0007');
    expect(await svc.numeroSuivant(db([{ numero: 'BD-2026-0099' }]), 2026)).toBe('BD-2026-0100');
  });

  it('le zéro-padding fait coïncider l’ordre lexicographique et l’ordre numérique', async () => {
    // C'est ce que suppose `ORDER BY numero DESC` : sans padding, « BD-2026-9 »
    // trierait après « BD-2026-10 » et la séquence repartirait en arrière.
    const numeros = ['BD-2026-0002', 'BD-2026-0010', 'BD-2026-0009'];
    expect([...numeros].sort().reverse()[0]).toBe('BD-2026-0010');
  });

  it('la requête est bornée à l’année demandée', async () => {
    const d = db([]);
    await svc.numeroSuivant(d, 2027);
    expect(d.query.mock.calls[0][1]).toEqual(['BD-2027-%']);
  });
});

describe('composerDonneesPdf — ce qui atteint le document', () => {
  const base = {
    numero: 'BD-2026-0007', tour_id: 90, date_enlevement: '2026-09-04',
    decheterie_code: 'petit_quevilly', decheterie_libelle: 'Petit-Quevilly',
    cav_nom: 'Déchetterie', poids_indicatif_kg: '185.0',
    signature_agent: PNG, signature_chauffeur: PNG, statut: 'a_valider',
  };

  it('code connu → la case est cochée, rien n’est écrit en clair', () => {
    const d = svc.composerDonneesPdf(base);
    expect(d.decheterie_code).toBe('petit_quevilly');
    expect(d.decheterie_libelle_libre).toBeNull();
    expect(d.validation).toBeNull();
  });

  it('hors liste → la commune passe en clair dans Remarque(s)', () => {
    const d = svc.composerDonneesPdf({ ...base, decheterie_code: null, decheterie_libelle: 'ROUEN - Déchetterie' });
    expect(d.decheterie_code).toBeNull();
    expect(d.decheterie_libelle_libre).toBe('ROUEN - Déchetterie');
  });

  it('un code inconnu n’est jamais coché (le libellé sauve le document)', () => {
    const d = svc.composerDonneesPdf({ ...base, decheterie_code: 'inconnu_xyz', decheterie_libelle: 'Ailleurs' });
    expect(d.decheterie_code).toBeNull();
    expect(d.decheterie_libelle_libre).toBe('Ailleurs');
  });

  it('bordereau validé → la mention de validation est composée', () => {
    const d = svc.composerDonneesPdf({ ...base, statut: 'valide', valide_le: '2026-09-06T10:00:00Z' });
    expect(d.validation).toEqual({ date: '2026-09-06T10:00:00Z' });
  });

  it('signature retirée par anonymisation → nommée, jamais remplacée par un trait', () => {
    const d = svc.composerDonneesPdf({
      ...base, signature_chauffeur: null, signature_chauffeur_absente_motif: 'anonymisation',
    });
    expect(d.signature_chauffeur).toBeNull();
    expect(d.signature_chauffeur_absente_motif).toBe('anonymisation');
  });
});

describe('projeterResume — jamais de BYTEA dans une liste', () => {
  it('rend des présences booléennes et un poids NUMÉRIQUE', () => {
    const r = svc.projeterResume({
      id: 12, numero: 'BD-2026-0007', tour_id: 90, cav_id: 7, cav_nom: 'D',
      decheterie_code: 'boos', decheterie_libelle: 'Boos', date_enlevement: '2026-09-04',
      poids_indicatif_kg: '185.0',
      signature_agent_presente: false, signature_agent_absente_motif: 'agent_indisponible',
      signature_chauffeur_presente: true, signature_chauffeur_absente_motif: null,
      statut: 'a_valider', valide_le: null, pdf_genere_le: 'x', created_at: 'y',
    });
    expect(r.poids_indicatif_kg).toBe(185);
    expect(r.signature_agent_presente).toBe(false);
    expect(r.signature_chauffeur_presente).toBe(true);
    expect(Object.keys(r)).not.toContain('pdf');
    expect(Object.keys(r)).not.toContain('signature_agent');
  });

  it('null en entrée → null (une ligne absente n’est pas un résumé vide)', () => {
    expect(svc.projeterResume(null)).toBeNull();
  });
});

describe('retirerSignatureChauffeur — anonymisation', () => {
  function client(rows, tableExiste = true) {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push([String(sql), params]);
        if (/information_schema\.tables/.test(String(sql))) {
          return { rows: tableExiste ? [{ '?column?': 1 }] : [] };
        }
        if (/SELECT .*FROM tour_decheterie_bordereaux/s.test(String(sql))) return { rows };
        return { rows: [] };
      }),
    };
  }

  const LIGNE = {
    id: 12, numero: 'BD-2026-0007', tour_id: 90, date_enlevement: '2026-09-04',
    decheterie_code: 'boos', decheterie_libelle: 'Boos', cav_nom: 'D',
    poids_indicatif_kg: '185.0', signature_agent: PNG, signature_chauffeur: PNG,
    statut: 'a_valider', vehicule: 'AB-123-CD',
  };

  it('retire la signature du chauffeur, garde celle de l’agent, régénère le PDF', async () => {
    const c = client([LIGNE]);
    const bilan = await svc.retirerSignatureChauffeur(c, 42);
    expect(bilan).toEqual({ traites: 1, pdf_regeneres: 1 });

    const upd = c.calls.find(([sql]) => /UPDATE tour_decheterie_bordereaux/.test(sql));
    expect(upd[0]).toMatch(/signature_chauffeur = NULL/);
    expect(upd[0]).toMatch(/driver_employee_id = NULL/);
    expect(upd[1][0]).toBe('anonymisation');
    // La LIGNE survit — c'est une pièce contractuelle remise à un tiers.
    expect(c.calls.some(([sql]) => /DELETE FROM tour_decheterie_bordereaux/.test(sql))).toBe(false);
    // La signature de l'AGENT n'est jamais touchée : elle appartient à un tiers.
    expect(upd[0]).not.toMatch(/signature_agent\s*=/);
    // Le document réécrit est un vrai PDF.
    expect(upd[1][1].slice(0, 5).toString()).toBe('%PDF-');
  });

  it('table absente (base non migrée) → passe sans rien faire', async () => {
    const c = client([], false);
    expect(await svc.retirerSignatureChauffeur(c, 42)).toEqual({ traites: 0, pdf_regeneres: 0 });
    expect(c.calls.some(([sql]) => /UPDATE/.test(sql))).toBe(false);
  });

  it('aucun bordereau pour ce salarié → rien à faire', async () => {
    const c = client([]);
    expect(await svc.retirerSignatureChauffeur(c, 99)).toEqual({ traites: 0, pdf_regeneres: 0 });
  });
});
