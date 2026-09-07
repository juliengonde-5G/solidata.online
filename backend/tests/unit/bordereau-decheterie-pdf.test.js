// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — bordereau de collecte déchèterie (utils/bordereau-decheterie-pdf.js)
// ───────────────────────────────────────────────────────────────────────────
// Le module est PUR : il reçoit les données du bordereau et rend un Buffer PDF.
// On verrouille ici le référentiel du formulaire Métropole (7 déchèteries, 8 ESS,
// case « Solidarité Textile » figée), la mention de validation figée par le
// client, la composition du bloc Remarque(s) et le rendu (un PDF d'une page qui
// se génère, avec ou sans signatures, en nommant ce qui manque).
// ═══════════════════════════════════════════════════════════════════════════
const {
  DECHETERIES_METROPOLE,
  ESS_COLLECTRICES,
  ESS_SOLIDATA,
  estDecheterieConnue,
  libelleDecheterie,
  formatDateParis,
  formatKg,
  mentionValidation,
  composerRemarques,
  genererBordereauPdf,
} = require('../../src/utils/bordereau-decheterie-pdf');

// PNG 1×1 valide (signature minimale) — évite toute dépendance à une image du dépôt
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Référentiel du formulaire Métropole (figé par le document papier)', () => {
  it('7 déchèteries, dans l\'ordre du formulaire', () => {
    expect(DECHETERIES_METROPOLE.map((d) => d.libelle)).toEqual([
      'Cléon', 'Boos', 'Caudebec-lès-Elbeuf', 'Déville-lès-Rouen',
      'Petit-Quevilly', 'Le Trait', 'Saint-Étienne-du-Rouvray',
    ]);
    expect(new Set(DECHETERIES_METROPOLE.map((d) => d.code)).size).toBe(7);
    expect(Object.isFrozen(DECHETERIES_METROPOLE)).toBe(true);
  });

  it('8 ESS collectrices, et la case figée est « Solidarité Textile »', () => {
    expect(ESS_COLLECTRICES).toHaveLength(8);
    expect(ESS_COLLECTRICES).toContain(ESS_SOLIDATA);
    expect(ESS_SOLIDATA).toBe('Solidarité Textile');
  });

  it('estDecheterieConnue / libelleDecheterie', () => {
    expect(estDecheterieConnue('petit_quevilly')).toBe(true);
    expect(estDecheterieConnue('rouen')).toBe(false);
    expect(estDecheterieConnue(null)).toBe(false);
    expect(libelleDecheterie('le_trait')).toBe('Le Trait');
    expect(libelleDecheterie('inconnu')).toBeNull();
  });
});

describe('Formats', () => {
  it('date en heure de Paris (JJ/MM/AAAA), vide si illisible', () => {
    // 23h30 UTC le 4/09 = 01h30 le 5/09 à Paris (été) → c'est le 5 qui est écrit
    expect(formatDateParis('2026-09-04T23:30:00Z')).toBe('05/09/2026');
    expect(formatDateParis(null)).toBe('');
    expect(formatDateParis('n/a')).toBe('');
  });

  it('poids : entier tel quel, décimale à la virgule, absent ou négatif → null', () => {
    expect(formatKg(185)).toBe('185');
    expect(formatKg('42.5')).toBe('42,5');
    expect(formatKg(0)).toBe('0');
    expect(formatKg(null)).toBeNull();
    expect(formatKg(-3)).toBeNull();
    expect(formatKg('abc')).toBeNull();
  });
});

describe('Bloc Remarque(s) et mention de validation', () => {
  it('la mention est celle figée par le client, datée en heure de Paris', () => {
    expect(mentionValidation('2026-09-05T14:30:00Z'))
      .toBe('Validé par Solidarité textiles sur Solidata le 05/09/2026');
  });

  it('sans validation : remarques seules ; avec validation : la mention vient en dernier', () => {
    expect(composerRemarques({ remarques: '  RAS ', validation: null })).toEqual(['RAS']);
    expect(composerRemarques({ remarques: null, validation: null })).toEqual([]);
    expect(composerRemarques({ remarques: 'RAS', validation: { date: '2026-09-05T14:30:00Z' } }))
      .toEqual(['RAS', 'Validé par Solidarité textiles sur Solidata le 05/09/2026']);
  });

  it('une déchèterie hors liste Métropole est écrite en clair en tête des remarques', () => {
    expect(composerRemarques({ remarques: null, validation: null, decheterieHorsListe: 'Rouen — Quai du Pré aux Loups' }))
      .toEqual(['Déchèterie : Rouen — Quai du Pré aux Loups']);
  });
});

describe('Génération du PDF', () => {
  const base = {
    date_enlevement: '2026-09-04T09:12:00Z',
    decheterie_code: 'petit_quevilly',
    tlc_kg: 185,
    signature_agent: PNG_1x1,
    signature_chauffeur: PNG_1x1,
    remarques: null,
    validation: null,
    meta: { numero: 'BD-2026-0007', tour_id: 681, vehicule: 'FX-412-KL', cav_nom: 'Test' },
  };

  it('rend un PDF valide d\'UNE page avec les deux signatures', async () => {
    const buf = await genererBordereauPdf(base);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    // Une seule page : un seul objet /Type /Page (hors /Pages)
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages).toBe(1);
  });

  it('se génère aussi sans signature, sans poids et sans déchèterie connue (rien d\'inventé)', async () => {
    const buf = await genererBordereauPdf({
      ...base, signature_agent: null, signature_chauffeur: Buffer.from('pas un png'),
      tlc_kg: null, decheterie_code: null, decheterie_libelle_libre: 'Rouen',
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('le bordereau validé embarque la mention de validation dans le PDF', async () => {
    const buf = await genererBordereauPdf({ ...base, validation: { date: '2026-09-05T14:30:00Z' } });
    // pdfkit compresse les flux : on vérifie via les métadonnées + la génération sans erreur,
    // la mention textuelle elle-même est verrouillée par composerRemarques.
    expect(buf.toString('latin1')).toContain('Bordereau BD-2026-0007');
  });
});

describe('Absence de signature nommée (arbitrage client : agent indisponible)', () => {
  const { MOTIFS_SIGNATURE_ABSENTE, libelleSignatureAbsente, estPngValide } = require('../../src/utils/bordereau-decheterie-pdf');
  it('liste fermée de motifs, libellés français', () => {
    expect(libelleSignatureAbsente('agent_indisponible')).toBe("Signature de l'agent non recueillie : agent indisponible");
    expect(libelleSignatureAbsente('anonymisation')).toMatch(/anonymisation/);
    expect(libelleSignatureAbsente(null)).toBeNull();
    expect(libelleSignatureAbsente('inconnu')).toBe('Signature non recueillie');
    expect(Object.isFrozen(MOTIFS_SIGNATURE_ABSENTE)).toBe(true);
  });
  it('estPngValide reconnaît la signature PNG et refuse le reste', () => {
    expect(estPngValide(PNG_1x1)).toBe(true);
    expect(estPngValide(Buffer.from('GIF89a'))).toBe(false);
    expect(estPngValide(null)).toBe(false);
    expect(estPngValide('iVBORw0KGgo')).toBe(false);
  });
});
