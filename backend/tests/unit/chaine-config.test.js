// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — CONFIGURATEUR 2D DE LA CHAÎNE DE TRI (lot L4)
// ───────────────────────────────────────────────────────────────────────────
// Deux choses sont verrouillées ici, sans aucune base :
//   1. les règles PURES de validation d'un bloc et de calcul de l'effectif —
//      la seule protection contre un plan « enregistré » incohérent ;
//   2. l'INTÉGRITÉ DU PLAN V7 versionné (src/data/chaine-tri-v7.json), qui est
//      la retranscription du plan client. Une faute de frappe dans ce fichier
//      se verrait sur l'écran de l'atelier, pas dans un log : les 15 personnes,
//      les codes uniques et les libellés du plan sont donc contrôlés ici.
// ═══════════════════════════════════════════════════════════════════════════

// Le routeur charge le pool au require : on le neutralise (aucun test ici ne
// touche la base — la justesse du SQL est prouvée sur PostgreSQL 16 réel).
jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));

const routeur = require('../../src/routes/chaine-config');
const { normaliserBloc, effectifTotal, resumerLayout } = routeur;
const { chargerPlanV7, effectifTotalPlan, SEED_LOCK_KEY } = require('../../src/scripts/seed-chaine-v7');

const BLOC = {
  code: 'CRAQ_1', libelle: 'Crackage ligne 1', categorie: 'poste',
  x: 24, y: 25, largeur: 8, hauteur: 10,
  obligatoire: true, actif: true, effectif_min: 1, effectif_max: 1,
};

describe('normaliserBloc — ce qui est refusé', () => {
  test('un code vide ou non normalisé est refusé', () => {
    expect(normaliserBloc({ ...BLOC, code: '   ' }, 0).erreur).toMatch(/code obligatoire/);
    expect(normaliserBloc({ ...BLOC, code: 'CRAQ 1' }, 0).erreur).toMatch(/lettres, chiffres/);
    expect(normaliserBloc({ ...BLOC, code: 'A'.repeat(41) }, 0).erreur).toMatch(/trop long/);
  });

  test('un libellé vide est refusé — un bloc sans nom est illisible sur le plan', () => {
    expect(normaliserBloc({ ...BLOC, libelle: '  ' }, 0).erreur).toMatch(/libellé obligatoire/);
  });

  test('une catégorie hors référentiel est refusée', () => {
    expect(normaliserBloc({ ...BLOC, categorie: 'tapis' }, 0).erreur).toMatch(/catégorie inconnue/);
  });

  test('les effectifs négatifs ou décimaux sont refusés', () => {
    expect(normaliserBloc({ ...BLOC, effectif_max: -1 }, 0).erreur).toMatch(/entiers positifs/);
    expect(normaliserBloc({ ...BLOC, effectif_min: 1.5 }, 0).erreur).toMatch(/entiers positifs/);
  });

  test('effectif minimum > maximum : refusé, avec les DEUX valeurs dans le message', () => {
    const e = normaliserBloc({ ...BLOC, effectif_min: 3, effectif_max: 2 }, 0).erreur;
    expect(e).toMatch(/3/); expect(e).toMatch(/2/);
  });

  test('des propriétés qui ne sont pas un objet sont refusées', () => {
    expect(normaliserBloc({ ...BLOC, proprietes: 'rouge' }, 0).erreur).toMatch(/objet/);
    expect(normaliserBloc({ ...BLOC, proprietes: [1, 2] }, 0).erreur).toMatch(/objet/);
  });

  test('le rang du bloc fautif est nommé — sinon l’écran ne sait pas quoi corriger', () => {
    expect(normaliserBloc({ ...BLOC, libelle: '' }, 4).erreur).toMatch(/bloc n° 5/);
  });
});

describe('normaliserBloc — ce qui est normalisé plutôt que refusé', () => {
  test('le code est mis en majuscules et détouré', () => {
    expect(normaliserBloc({ ...BLOC, code: '  craq_1 ' }, 0).valeur.code).toBe('CRAQ_1');
  });

  test('une position hors canevas est RAMENÉE dedans (un bloc à x=-40 serait inatteignable)', () => {
    const v = normaliserBloc({ ...BLOC, x: -40, y: 180 }, 0).valeur;
    expect(v.x).toBe(0); expect(v.y).toBe(100);
  });

  test('les coordonnées sont arrondies au centième — le glisser-déposer produit des flottants', () => {
    expect(normaliserBloc({ ...BLOC, x: 24.33333 }, 0).valeur.x).toBe(24.33);
  });

  test('`obligatoire` et `actif` ont des défauts explicites (facultatif / actif)', () => {
    const v = normaliserBloc({ code: 'Z1', libelle: 'Zone', categorie: 'zone_depose' }, 0).valeur;
    expect(v.obligatoire).toBe(false);
    expect(v.actif).toBe(true);
    expect(v.effectif_max).toBe(0); // une zone de dépose ne porte personne
  });

  test('un poste sans effectif saisi vaut 1 personne, une zone 0', () => {
    expect(normaliserBloc({ code: 'P', libelle: 'P', categorie: 'poste' }, 0).valeur.effectif_max).toBe(1);
    expect(normaliserBloc({ code: 'E', libelle: 'E', categorie: 'entree' }, 0).valeur.effectif_max).toBe(0);
  });
});

describe('effectif du plan', () => {
  const postes = [
    { categorie: 'poste', actif: true, effectif_max: 2 },
    { categorie: 'poste', actif: true, effectif_max: 1 },
    { categorie: 'poste', actif: false, effectif_max: 5 },   // désactivé : hors comptage
    { categorie: 'zone_depose', actif: true, effectif_max: 0 },
    { categorie: 'entree', actif: true, effectif_max: 0 },
  ];

  test('seuls les POSTES ACTIFS comptent', () => {
    expect(effectifTotal(postes)).toBe(3);
  });

  test('dépassement du plafond : signalé', () => {
    const r = resumerLayout({ id: 1, effectif_max: 2 }, postes);
    expect(r.effectif_total).toBe(3);
    expect(r.effectif_reference).toBe(2);
    expect(r.alerte_effectif).toBe(true);
    expect(r.nb_postes).toBe(3);
    expect(r.nb_blocs).toBe(5);
  });

  test('plafond NON saisi : aucune alerte inventée (jamais un 15 supposé)', () => {
    const r = resumerLayout({ id: 1, effectif_max: null }, postes);
    expect(r.effectif_reference).toBeNull();
    expect(r.alerte_effectif).toBe(false);
  });

  test('égalité au plafond : pas d’alerte (15/15 est le plan nominal)', () => {
    expect(resumerLayout({ effectif_max: 3 }, postes).alerte_effectif).toBe(false);
  });
});

describe('plan V7 versionné (src/data/chaine-tri-v7.json)', () => {
  const plan = chargerPlanV7();
  const postes = plan.postes.filter((p) => p.categorie === 'poste');

  test('le verrou de seed porte la clé du contrat', () => {
    expect(SEED_LOCK_KEY).toBe('tri.chaine_layout_v7_seed');
  });

  test('le plan mobilise EXACTEMENT 15 personnes, plafond du plan de référence', () => {
    expect(effectifTotalPlan(plan.postes)).toBe(15);
    expect(plan.layout.effectif_max).toBe(15);
  });

  test('les 11 postes de travail du plan sont présents, aux effectifs arrêtés', () => {
    const attendus = {
      CRAQ_1: [1, 1, true], CRAQ_2: [1, 1, true], CHAUSS_NON_TLC: [1, 1, true],
      RECYCL_REEMPLOI_1: [1, 2, true], RECYCL_REEMPLOI_2: [0, 2, false],
      QUALITES_HOMME: [1, 1, true], QUALITES_FEMME: [1, 1, true],
      STOCK_VAK_BTQ: [1, 2, true], QUALITE_ENFANT: [0, 1, false],
      AFFINAGE_RECYCLAGE: [0, 2, false], PREPA_CHIF: [0, 1, false],
    };
    expect(postes.map((p) => p.code).sort()).toEqual(Object.keys(attendus).sort());
    for (const p of postes) {
      const [mn, mx, oblig] = attendus[p.code];
      expect([p.code, p.effectif_min, p.effectif_max, p.obligatoire]).toEqual([p.code, mn, mx, oblig]);
    }
  });

  test('les deux entrées « Original entrant pour tri » ouvrent les deux lignes', () => {
    const entrees = plan.postes.filter((p) => p.categorie === 'entree');
    expect(entrees).toHaveLength(2);
    for (const e of entrees) expect(e.libelle).toBe('Original entrant pour tri');
    expect(entrees.map((e) => e.proprietes.ligne).sort()).toEqual([1, 2]);
  });

  test('les zones de dépose reprennent les libellés du plan client', () => {
    const libelles = plan.postes.filter((p) => p.categorie === 'zone_depose').map((p) => p.libelle);
    for (const attendu of [
      'Déchets non TLC', 'Poubelle jaune', 'Couettes oreiller', 'Peluches & Jouets (non DEEE)',
      'DEEE', 'Recyclage Chauss.', 'CSR Maroq.', 'Linge de maison VAK/BTQ', 'Effilo Mérinos',
      'Textiles mouillés', 'Pré-classé Chauss. Pairées', 'Déco Textiles',
      'Chaussures et Maroquinerie (accessoires) BTQ&VAK', 'Recyclage (pré-tri)',
      'Homme VAK/BTQ (pré-tri)', 'Femme VAK/BTQ (pré-tri)', 'Enfant VAK/BTQ (pré-tri)',
      'Homme VAK', 'Homme STD', 'Homme EXTRA', 'Femme VAK', 'Femme STD', 'Femme EXTRA',
      'CSR Textile', 'Effilo coton', 'Effilo Jean', 'Effilo Tricot', 'Recyclage',
    ]) {
      expect(libelles).toContain(attendu);
    }
    // Les contenants dédoublés du plan le restent (une ligne, un contenant).
    expect(libelles.filter((l) => l === 'Déchets non TLC')).toHaveLength(2);
    expect(libelles.filter((l) => l === 'Poubelle jaune')).toHaveLength(2);
    expect(libelles.filter((l) => l === 'CSR Textile')).toHaveLength(2);
    expect(libelles.filter((l) => l === 'Effilo coton')).toHaveLength(2);
    expect(libelles.filter((l) => l === 'Effilo Tricot')).toHaveLength(2);
    expect(libelles.filter((l) => l === 'Effilo Jean')).toHaveLength(1);
  });

  test('les trois blocs relevés « Homme » au-dessus de Qualités Femme portent la note du plan', () => {
    // Le PDF porte littéralement « Homme » sur les six blocs VAK/STD/EXTRA ; les
    // trois de droite surmontent « Qualités Femme ». On les nomme Femme ET on
    // conserve le constat dans les propriétés : jamais de correction muette.
    const femme = plan.postes.filter((p) => ['Femme VAK', 'Femme STD', 'Femme EXTRA'].includes(p.libelle));
    expect(femme).toHaveLength(3);
    for (const f of femme) expect(f.proprietes.note_plan).toMatch(/plan porte/);
  });

  test('chaque bloc est enregistrable tel quel par l’API (mêmes règles que la saisie)', () => {
    plan.postes.forEach((p, i) => {
      const r = normaliserBloc(p, i);
      expect(r.erreur).toBeUndefined();
    });
  });

  test('codes uniques, ≤ 40 caractères (contrainte VARCHAR), libellés ≤ 120', () => {
    const codes = plan.postes.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const p of plan.postes) {
      expect(p.code.length).toBeLessThanOrEqual(40);
      expect(p.libelle.length).toBeLessThanOrEqual(120);
    }
  });

  test('aucun bloc ne déborde du canevas — un bloc hors cadre serait invisible', () => {
    for (const p of plan.postes) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.largeur).toBeLessThanOrEqual(100.5);
      expect(p.y + p.hauteur).toBeLessThanOrEqual(100.5);
    }
  });

  test('aucun recouvrement entre blocs — le plan doit rester lisible sans être déplacé', () => {
    const chevauchements = [];
    for (let i = 0; i < plan.postes.length; i++) {
      for (let j = i + 1; j < plan.postes.length; j++) {
        const a = plan.postes[i]; const b = plan.postes[j];
        const ox = Math.min(a.x + a.largeur, b.x + b.largeur) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.hauteur, b.y + b.hauteur) - Math.max(a.y, b.y);
        if (ox > 0.3 && oy > 0.3) chevauchements.push(`${a.code}/${b.code}`);
      }
    }
    expect(chevauchements).toEqual([]);
  });
});
