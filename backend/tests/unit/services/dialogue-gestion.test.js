// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Synthèse de dialogue de gestion (PR D lot 6)
//   backend/src/services/dialogue-gestion.js
//
// `pg` est simulé : on exerce la VRAIE composition et on inspecte l'objet rendu.
// Ce fichier tient les quatre promesses du document :
//   1. STRICTEMENT NON NOMINATIF — aucune des neuf clés interdites n'apparaît
//      dans la sérialisation JSON complète, y compris quand les sources
//      simulées en rendent (elles le font délibérément ici).
//   2. k-ANONYMAT — tout agrégat de 1 à 4 personnes est rendu `null`, son
//      chemin est listé dans `sous_seuil` ; ZÉRO reste zéro.
//   3. JUDICIAIRE ABSENT du bloc 3 et de l'évolution des freins, SANS mention.
//   4. MÉTHODE — une ligne par taux, « objectif non paramétré » compris.
// ═══════════════════════════════════════════════════════════════════════════

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key-0123456789abcdef';

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

// Le service du temps d'accompagnement rend délibérément sa forme COMPLÈTE,
// NOMINATIVE : ce qui est éprouvé ici, c'est la projection, pas la composition.
jest.mock('../../../src/services/temps-accompagnement', () => ({
  heuresAccompagnement: jest.fn(async () => ({
    annee: 2026,
    global_minutes: 6000,
    nb_salaries_concernes: 12,
    moyenne_minutes_par_salarie: 500,
    par_salarie: [{ employee_id: 41, nom: 'PREVOST Sandrine', minutes: 2400 }],
    par_intervenant: [{ user_id: 7, nom: 'DURAND Amel', minutes: 6000 }],
  })),
}));

// `conformiteProjet` rend la liste NOMINATIVE de ses participants : seuls les
// trois agrégats doivent en sortir.
jest.mock('../../../src/services/fse-participants', () => ({
  conformiteProjet: jest.fn(async () => ({
    projet: { id: 1, code: 'ASI-2026-2027', nom: 'Accompagnement Social Intensif' },
    participants: [{ employee_id: 41, nom: 'PREVOST', prenom: 'Sandrine', a_faire: [] }],
    nb_total: 9, nb_complets: 7, taux_completude: 78,
  })),
}));

jest.mock('../../../src/services/activite-hebdo', () => ({
  activiteHebdoCohorte: jest.fn(async () => new Map([
    [1, { nb_semaines_sous_seuil: 3 }],
    [2, { nb_semaines_sous_seuil: 0 }],
  ])),
}));

const { composerDialogueGestion, faireKAnon, bornes } = require('../../../src/services/dialogue-gestion');

/** Les neuf clés que le document ne doit JAMAIS porter (contrat 25 § 8). */
const CLES_INTERDITES = [
  'nom', 'prenom', 'employee_id', 'first_name', 'last_name',
  'birth_date', 'email', 'phone', 'matricule',
];

/** Une personne de la cohorte, telle que la requête la rend. */
const personne = (over = {}) => ({
  id: 1, gender: 'F', birth_date: '1985-04-02', brsa: true, ft_categorie: 'G',
  referent_unique_type: 'cms', niveau_formation: 'niv3', ...over,
});

/**
 * Aiguillage du faux `pg`. Chaque source a sa réponse ; `over` en surcharge une.
 * Les requêtes non reconnues rendent une liste vide : le document doit rester
 * composable sur une base presque muette.
 */
function branche(over = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: over.settings ?? [] });
    // ⚠ ORDRE : la requête des freins part elle aussi de `employees LEFT JOIN
    // insertion_diagnostics` — elle doit être reconnue AVANT celle de la
    // cohorte, sinon elle reçoit les lignes de la cohorte et le bloc 3 se
    // compose sur les mauvaises colonnes (sans jamais le dire).
    if (/AS entree_frein_/.test(s)) return Promise.resolve({ rows: over.freins ?? [] });
    if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(s)) {
      return Promise.resolve({ rows: over.cohorte ?? [personne()] });
    }
    if (/FROM employee_eligibilite/.test(s)) return Promise.resolve({ rows: over.criteres ?? [] });
    if (/nb_brsa FROM etp_asp_mensuel/.test(s)) return Promise.resolve({ rows: over.brsaAsp ?? [] });
    if (/FROM etp_asp_mensuel/.test(s)) return Promise.resolve({ rows: over.etpAsp ?? [] });
    if (/generate_series\(1, 12\)/.test(s)) return Promise.resolve({ rows: over.pondere ?? [] });
    if (/dora_resultat = 'oriente'/.test(s)) return Promise.resolve({ rows: over.actionsAxe ?? [] });
    if (/ROW_NUMBER\(\) OVER \(PARTITION BY a\.frein_type/.test(s)) return Promise.resolve({ rows: over.partenaires ?? [] });
    if (/FROM insertion_milestones im\s+WHERE COALESCE\(im\.completed_date/.test(s)) {
      return Promise.resolve({ rows: over.entretiens ?? [] });
    }
    if (/aide_nature AS nature/.test(s)) return Promise.resolve({ rows: over.aides ?? [] });
    if (/FROM insertion_pmsmp/.test(s)) return Promise.resolve({ rows: over.pmsmp ?? [] });
    if (/insertion_end_date BETWEEN/.test(s)) return Promise.resolve({ rows: over.fins ?? [] });
    if (/milestone_type = 'bilan_sortie'/.test(s)) return Promise.resolve({ rows: over.bilans ?? [] });
    if (/FROM etp_asp_salaries/.test(s)) return Promise.resolve({ rows: over.aspSalaries ?? [{ n: 0 }] });
    if (/FROM insertion_fse_sorties/.test(s)) return Promise.resolve({ rows: over.fse ?? [] });
    if (/FROM insertion_satisfaction_sortie/.test(s)) return Promise.resolve({ rows: over.satisfaction ?? [{ nb: 0, moyenne: null }] });
    if (/FROM insertion_projets/.test(s)) return Promise.resolve({ rows: over.projets ?? [{ id: 1, code: 'ASI-2026-2027', nom: 'ASI' }] });
    if (/FROM insertion_alimentations_referent/.test(s)) return Promise.resolve({ rows: [{ n: 4 }] });
    if (/FROM insertion_actualisations_ft/.test(s)) return Promise.resolve({ rows: [{ n: 11 }] });
    if (/FROM employees e\s+WHERE COALESCE\(e\.insertion_status/.test(s)) {
      return Promise.resolve({ rows: over.cohorteActivite ?? [{ id: 1 }, { id: 2 }] });
    }
    if (/FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: over.compteurs ?? [{ n: 0 }] });
    if (/FROM insertion_diagnostics/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); branche(); });

// ───────────────────────────────────────────────────────────────────────────
describe('bornes de période', () => {
  it('année entière par défaut', () => {
    expect(bornes(2026, null)).toEqual({ debut: '2026-01-01', fin: '2026-12-31', annee: 2026, trimestre: null });
  });

  it('trimestres : le T1 finit le 31 mars, le T4 le 31 décembre', () => {
    expect(bornes(2026, 1)).toEqual(expect.objectContaining({ debut: '2026-01-01', fin: '2026-03-31' }));
    expect(bornes(2026, 4)).toEqual(expect.objectContaining({ debut: '2026-10-01', fin: '2026-12-31' }));
    // Février d'une année bissextile : la borne est calculée, pas devinée.
    expect(bornes(2024, 1).fin).toBe('2024-03-31');
  });

  it('trimestre hors bornes → année entière (jamais une période vide silencieuse)', () => {
    expect(bornes(2026, 9).trimestre).toBeNull();
    expect(bornes(2026, 0).trimestre).toBeNull();
  });

  it('année illisible → null (l’appelant refuse, il n’invente pas de période)', () => {
    expect(bornes('bidon', null)).toBeNull();
  });
});

describe('k-anonymat', () => {
  it('1 à 4 personnes → null + chemin listé ; 5 et au-delà → la valeur', () => {
    const sousSeuil = [];
    const k = faireKAnon(5, sousSeuil);
    expect(k(4, 'a.b')).toBeNull();
    expect(k(1, 'a.c')).toBeNull();
    expect(k(5, 'a.d')).toBe(5);
    expect(k(12, 'a.e')).toBe(12);
    expect(sousSeuil).toEqual(['a.b', 'a.c']);
  });

  it('ZÉRO reste zéro — « personne dans cette catégorie » ne désigne personne', () => {
    const sousSeuil = [];
    const k = faireKAnon(5, sousSeuil);
    expect(k(0, 'a.f')).toBe(0);
    expect(sousSeuil).toEqual([]);
  });

  it('un chemin n’est listé qu’une fois, et une valeur absente reste absente', () => {
    const sousSeuil = [];
    const k = faireKAnon(5, sousSeuil);
    k(2, 'x'); k(3, 'x');
    expect(sousSeuil).toEqual(['x']);
    expect(k(null, 'y')).toBeNull();
    expect(sousSeuil).toEqual(['x']);
  });

  it('un seuil illisible retombe sur 5, jamais sur « aucune protection »', () => {
    const sousSeuil = [];
    expect(faireKAnon(0, sousSeuil)(3, 'z')).toBeNull();
    expect(faireKAnon(NaN, sousSeuil)(3, 'z2')).toBeNull();
  });
});

describe('composition — le document est strictement non nominatif', () => {
  it('aucune des neuf clés interdites n’apparaît dans la sérialisation complète', async () => {
    const s = await composerDialogueGestion({
      annee: 2026,
      user: { id: 7, role: 'RH', first_name: 'Claire', last_name: 'MARTIN' },
    });
    const brut = JSON.stringify(s);
    for (const cle of CLES_INTERDITES) {
      expect(brut).not.toMatch(new RegExp(`"${cle}"`));
    }
    // Et les patronymes des sources simulées n'y sont pas non plus.
    expect(brut).not.toMatch(/PREVOST|Sandrine|DURAND|Amel/);
  });

  it('l’en-tête porte le RÔLE du générateur, jamais son nom', async () => {
    const s = await composerDialogueGestion({
      annee: 2026, user: { id: 7, role: 'RH', first_name: 'Claire', last_name: 'MARTIN' },
    });
    expect(s.en_tete.genere_par_role).toBe('RH');
    expect(JSON.stringify(s.en_tete)).not.toMatch(/Claire|MARTIN/);
    expect(s.en_tete.mention).toMatch(/non nominatif/i);
    expect(s.en_tete.perimetre).toMatch(/hors permanents/);
  });

  it('les heures d’accompagnement sont PROJETÉES : ni par_salarie ni par_intervenant', async () => {
    const s = await composerDialogueGestion({ annee: 2026 });
    const h = s.blocs['4_accompagnement'].heures_accompagnement;
    expect(h).toEqual({ total_h: 100, nb_personnes: 12, moyenne_par_personne_h: 8.3 });
    expect(h).not.toHaveProperty('par_salarie');
  });

  it('la complétude FSE+ ne rend que trois agrégats, jamais la liste des participants', async () => {
    const s = await composerDialogueGestion({ annee: 2026 });
    const c = s.blocs['8_conformite'].completude_fse_par_projet;
    expect(c).toEqual([{ projet: 'ASI', code: 'ASI-2026-2027', participants: 9, complets: 7, pct: 78 }]);
    expect(JSON.stringify(c)).not.toMatch(/participants":\s*\[/);
  });
});

describe('bloc 2 — publics à l’entrée', () => {
  it('l’effectif brut du bloc échappe au seuil ; les ventilations non', async () => {
    branche({ cohorte: [personne({ id: 1 }), personne({ id: 2, gender: 'M', ft_categorie: 'A' })] });
    const s = await composerDialogueGestion({ annee: 2026 });
    const b = s.blocs['2_publics_entree'];
    expect(b.effectif).toBe(2);                 // tête de chapitre : jamais masquée
    expect(b.par_categorie_ft.G).toBeNull();    // 1 personne → sous seuil
    expect(b.par_categorie_ft.B).toBe(0);       // zéro reste zéro
    expect(b.sexe.F).toBeNull();
    // CORRECTIF B-01 — `sous_seuil` COMPTE par bloc et ne nomme plus le chemin :
    // sur une ventilation qui somme à un effectif publié, ce chemin désignait la
    // case à reconstituer par soustraction.
    const bloc2 = s.sous_seuil.find((x) => x.bloc === '2_publics_entree');
    expect(bloc2.nb).toBeGreaterThan(0);
    expect(JSON.stringify(s.sous_seuil)).not.toMatch(/par_categorie_ft|sexe\./);
    expect(s.sous_seuil_total).toBeGreaterThanOrEqual(bloc2.nb);
  });

  it("SUPPRESSION COMPLÉMENTAIRE — une ventilation ne garde jamais UNE seule case retirée", async () => {
    // 6 personnes dont UNE en catégorie A : l'effectif (6) est publié, la
    // ventilation y somme, et « 6 − 5 = 1 » rendrait la case retirée. Une
    // seconde case (la plus petite publiée) tombe donc avec elle.
    branche({
      cohorte: [
        personne({ id: 1, ft_categorie: 'A' }),
        ...Array.from({ length: 5 }, (_, i) => personne({ id: i + 2, ft_categorie: 'G' })),
      ],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const ft = s.blocs['2_publics_entree'].par_categorie_ft;
    expect(s.blocs['2_publics_entree'].effectif).toBe(6);
    expect(ft.A).toBeNull();                                   // 1 → retiré
    expect(ft.G).toBeNull();                                   // complément
    expect(Object.values(ft).filter((v) => v === null).length).toBeGreaterThanOrEqual(2);
  });

  it('les critères marqués art. 10 ne sont pas lus — le prédicat est DANS le SQL', async () => {
    await composerDialogueGestion({ annee: 2026 });
    const q = mockQuery.mock.calls.map(([sql]) => String(sql)).find((s) => /FROM employee_eligibilite/.test(s));
    expect(q).toMatch(/sensible_art10, false\) = false/);
  });

  it('BRSA : le compte de l’outil et le chiffre ASP côte à côte', async () => {
    branche({
      cohorte: Array.from({ length: 8 }, (_, i) => personne({ id: i + 1 })),
      brsaAsp: [{ nb_brsa: 6 }],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    expect(s.blocs['2_publics_entree'].brsa).toEqual({ n: 8, part_pct: 100, n_asp: 6 });
  });

  it('cohorte illisible → bloc NOMMÉ indisponible, jamais un bloc vide qui se lirait « aucun public »', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(String(sql))) {
        return Promise.reject(Object.assign(new Error('column does not exist'), { code: '42703' }));
      }
      return Promise.resolve({ rows: [] });
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    expect(s.blocs['2_publics_entree'].indisponible).toBe(true);
    expect(s.blocs['2_publics_entree'].note).toMatch(/base non à jour/);
  });
});

describe('bloc 3 — freins : le judiciaire est ABSENT, sans mention', () => {
  it('aucun axe judiciaire dans le bloc, et sa colonne n’est pas lue en SQL', async () => {
    const s = await composerDialogueGestion({ annee: 2026 });
    const axes = s.blocs['3_freins'].par_axe.map((a) => a.axe);
    expect(axes).not.toContain('judiciaire');
    expect(axes).toHaveLength(8); // les 9 du registre moins le judiciaire
    // Le bloc ne MENTIONNE pas l'exclusion : mentionner, c'est encore désigner.
    expect(JSON.stringify(s.blocs['3_freins'])).not.toMatch(/judiciaire/i);
    const q = mockQuery.mock.calls.map(([sql]) => String(sql)).find((x) => /AS entree_frein_mobilite/.test(x));
    expect(q).toBeTruthy();
    expect(q).not.toMatch(/frein_judiciaire/);
  });

  it('évolution : levé = baisse d’un niveau, aggravé = hausse, non évalué si une valeur manque', async () => {
    // Cinq dossiers pour passer le seuil, avec des évolutions différentes.
    branche({
      freins: [
        { id: 1, entree_frein_mobilite: 4, actuel_frein_mobilite: 2 }, // levé
        { id: 2, entree_frein_mobilite: 4, actuel_frein_mobilite: 3 }, // levé
        { id: 3, entree_frein_mobilite: 3, actuel_frein_mobilite: 3 }, // stable
        { id: 4, entree_frein_mobilite: 2, actuel_frein_mobilite: 4 }, // aggravé
        { id: 5, entree_frein_mobilite: null, actuel_frein_mobilite: 3 }, // non évalué
      ],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const mob = s.blocs['3_freins'].par_axe.find((a) => a.axe === 'mobilite');
    // Chacun des compteurs est sous le seuil de 5 → masqué, et listé.
    expect(mob.leves).toBeNull();
    expect(s.sous_seuil.find((x) => x.bloc === '3_freins').nb).toBeGreaterThan(0);
    // « Concerné à l'entrée » = niveau 2 ou plus au diagnostic : 4 dossiers.
    expect(mob.concernes_entree).toBeNull();
    expect(s.blocs['3_freins'].nb_dossiers).toBe(5);
    expect(s.blocs['3_freins'].echelle).toMatch(/BAISSE de niveau est une amélioration/);
  });
});

describe('bloc 4 — accompagnement', () => {
  it('une aide non chiffrée ne vaut pas zéro euro', async () => {
    branche({ aides: [{ nature: 'mobilite', n: 7, montant_total: null, n_chiffrees: 0 }] });
    const s = await composerDialogueGestion({ annee: 2026 });
    const aide = s.blocs['4_accompagnement'].aides_mobilisees[0];
    expect(aide).toEqual({ nature: 'mobilite', label: 'Mobilité', n: 7, montant_total: null, nb_montants_saisis: 0 });
  });

  it("CORRECTIF D-07 — une aide portée par moins de k personnes ne sort PAS, montant compris", async () => {
    // Le montant exact d'une aide financière d'urgence unique se retrouve dans
    // les propres dossiers du Département : publier « 1 aide, 340 € » désigne
    // un dossier. Le montant tombe AVEC l'effectif — un montant sans effectif
    // serait pire.
    branche({ aides: [{ nature: 'financiere_urgence', n: 1, montant_total: 340, n_chiffrees: 1 }] });
    const s = await composerDialogueGestion({ annee: 2026 });
    const aide = s.blocs['4_accompagnement'].aides_mobilisees[0];
    expect(aide.n).toBeNull();
    expect(aide.montant_total).toBeNull();
    expect(aide.nb_montants_saisis).toBeNull();
  });

  it("CORRECTIF M-04 — une source ILLISIBLE ne s'imprime pas « 0 aide »", async () => {
    mockQuery.mockImplementation((sql) => {
      if (/aide_nature AS nature/.test(String(sql))) {
        return Promise.reject(Object.assign(new Error('column does not exist'), { code: '42703' }));
      }
      return Promise.resolve({ rows: [] });
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    expect(s.blocs['4_accompagnement'].aides_mobilisees).toBeNull();
    const methode = s.blocs['9_methode'].map((m) => `${m.indicateur} ${m.regle}`).join(' | ');
    expect(methode).toMatch(/Indicateur non rendu.*aides mobilisées/i);
  });

  it('les huit types d’entretien sont rendus, même à zéro, avec un taux null sans échéance passée', async () => {
    const s = await composerDialogueGestion({ annee: 2026 });
    const e = s.blocs['4_accompagnement'].entretiens;
    expect(e).toHaveLength(8);
    expect(e.map((x) => x.type)).toEqual(expect.arrayContaining(['point_etape_referent', 'conciliation']));
    for (const x of e) expect(x.taux_pct).toBeNull();
  });
});

describe('bloc 5 — immersions', () => {
  // 12 conventions : 1 embauche chez l'accueillant, 5 sans débouché, 6 entrées
  // en formation — de quoi exercer À LA FOIS le seuil, la suppression
  // complémentaire et une case publiée.
  const douzeImmersions = () => [
    { entreprise: 'Atelier Nord', debouche: 'embauche_accueillant', embauche_accueillant: true, jours: 10 },
    ...Array.from({ length: 5 }, () => ({ entreprise: 'Garage Sud', debouche: 'aucun', embauche_accueillant: false, jours: 5 })),
    ...Array.from({ length: 6 }, () => ({ entreprise: 'Garage Sud', debouche: 'formation', embauche_accueillant: false, jours: 5 })),
  ];

  it('débouchés comptés, raison sociale listée, jamais un compte par entreprise', async () => {
    branche({ pmsmp: douzeImmersions() });
    const s = await composerDialogueGestion({ annee: 2026 });
    const b = s.blocs['5_immersions'];
    expect(b.conventions).toBe(12);  // tête de chapitre : jamais masquée
    expect(b.jours).toBe(65);
    expect(b.entreprises_distinctes).toBe(2);
    expect(b.liste_entreprises).toEqual(['Atelier Nord', 'Garage Sud']);
    // Un compte PAR entreprise rapproché des débouchés désignerait une personne.
    expect(JSON.stringify(b.liste_entreprises)).not.toMatch(/\d/);
    expect(b.par_debouche.formation).toBe(6);                // 6 → rendu
    expect(b.par_debouche.poursuite_parcours).toBe(0);       // zéro reste zéro
    expect(b.par_debouche.embauche_accueillant).toBeNull();  // 1 → sous seuil
    // SUPPRESSION COMPLÉMENTAIRE : la ventilation somme aux 12 conventions
    // publiées ; « 12 − 6 − 5 = 1 » rendrait la case retirée, la plus petite
    // case publiée tombe donc avec elle.
    expect(b.par_debouche.aucun).toBeNull();
  });

  it("CORRECTIF B-01 — sous le seuil, la RAISON SOCIALE et les jours ne sortent pas", async () => {
    // Une période à UNE immersion : le nom de l'unique entreprise d'accueil et
    // la durée exacte du stage désignent la personne pour un destinataire qui
    // reçoit par ailleurs les déclarations d'Immersion Facilitée. Le nombre de
    // conventions, lui, reste publié : il ne ventile personne.
    branche({
      pmsmp: [{ entreprise: 'GARAGE MARTIN SARL (Darnétal)', debouche: 'embauche_accueillant', embauche_accueillant: true, jours: 12 }],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const b = s.blocs['5_immersions'];
    expect(b.conventions).toBe(1);
    expect(b.liste_entreprises).toBeNull();
    expect(b.jours).toBeNull();
    expect(b.entreprises_distinctes).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/GARAGE MARTIN/);
  });
});

describe('bloc 6 — sorties : une seule règle, celle du moteur PUR', () => {
  it('méthode B en premier, non documentées en clair, méthode A imprimée en 2026', async () => {
    branche({
      settings: [],
      fins: [{ employee_id: 1, parcours_num: 1 }, { employee_id: 2, parcours_num: 1 }],
      bilans: [{ employee_id: 1, parcours_num: 1, sortie_classification: 'emploi_durable', sortie_type: 'CDI' }],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const b = s.blocs['6_sorties'];
    expect(b.methode_b.denominateur).toBe(2);
    expect(b.methode_b.non_documentees).toBe(1);
    expect(b.methode_a).not.toBeNull(); // 2026 = année de la double méthode
    expect(b.regles.join(' ')).toMatch(/Méthode B \(retenue depuis 2026\)/);
  });

  it('hors de l’année de double méthode, la méthode A n’est pas imprimée', async () => {
    branche({ fins: [{ employee_id: 1, parcours_num: 1 }], bilans: [] });
    const s = await composerDialogueGestion({ annee: 2028 });
    expect(s.blocs['6_sorties'].methode_a).toBeNull();
  });
});

describe('bloc 7 — résultats à +6 mois', () => {
  it('« injoignable » et « non renseigné » sont DEUX lignes distinctes', async () => {
    branche({
      fse: [
        ...Array.from({ length: 6 }, () => ({ situation_6mois: 'injoignable' })),
        ...Array.from({ length: 5 }, () => ({ situation_6mois: null })),
        { situation_6mois: 'chomage' },
      ],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const sit = s.blocs['7_resultats'].situation_6_mois;
    expect(sit.injoignable).toBe(6);
    // 5 « non renseigné » et 1 « recherche d'emploi » : le second est sous le
    // seuil, et comme la ventilation somme à `nb_sorties_suivies` (12), la
    // suppression complémentaire emporte la plus petite case publiée.
    expect(sit.recherche_emploi).toBeNull();
    expect(sit.non_renseigne).toBeNull();
    expect(sit.emploi_durable).toBe(0);
  });

  it('sous le seuil, la MOYENNE de satisfaction n’est pas rendue non plus', async () => {
    branche({ satisfaction: [{ nb: 3, moyenne: 3.5 }] });
    const s = await composerDialogueGestion({ annee: 2026 });
    expect(s.blocs['7_resultats'].satisfaction.moyenne_globale).toBeNull();
  });
});

describe('bloc 8 — conformité et ruptures de droits évitées', () => {
  it('le compteur additionne les trois gestes de protection', async () => {
    const s = await composerDialogueGestion({ annee: 2026 });
    const r = s.blocs['8_conformite'].ruptures_droits_evitees;
    expect(r.actualisations_rappelees).toBe(11);
    expect(r.total).toBe(r.actualisations_rappelees + r.motifs_legitimes_documentes + r.conciliations_tracees);
  });

  it('semaines sous le plancher : un NOMBRE DE SEMAINES, jamais une moyenne', async () => {
    const s = await composerDialogueGestion({ annee: 2026 });
    const sem = s.blocs['8_conformite'].semaines_sous_15h;
    // 1 personne concernée → sous le seuil ; le NOMBRE DE SEMAINES suit
    // (dépendance déclarée : un nombre de semaines rattaché à une seule
    // personne est une donnée de cette personne).
    expect(sem.nb_personnes_concernees).toBeNull();
    expect(sem.nb_semaines).toBeNull();
    expect(sem).not.toHaveProperty('moyenne');
  });
});

describe('bloc 9 — méthode', () => {
  it('une ligne par indicateur, « objectif non paramétré » compris', async () => {
    const s = await composerDialogueGestion({ annee: 2026 });
    const m = s.blocs['9_methode'];
    expect(Array.isArray(m)).toBe(true);
    const texte = m.map((x) => `${x.indicateur} ${x.regle}`).join(' | ');
    expect(texte).toMatch(/objectif non paramétré/);
    expect(texte).toMatch(/1 820 heures annuelles par ETP/); // typographie française
    expect(texte).toMatch(/Méthode B/);
    expect(texte).toMatch(/entre 1 et 4 personnes est rendu vide/);
    expect(texte).toMatch(/saisies officielles.*font foi/);
    for (const l of m) {
      expect(typeof l.indicateur).toBe('string');
      expect(l.regle.length).toBeGreaterThan(20); // une vraie phrase, pas un code
    }
  });
});

describe('version trimestrielle allégée', () => {
  it('seuls les blocs 2 et 8 sont composés (plus l’en-tête et la méthode)', async () => {
    const s = await composerDialogueGestion({ annee: 2026, trimestre: 2 });
    expect(Object.keys(s.blocs).sort()).toEqual(['2_publics_entree', '8_conformite', '9_methode']);
    expect(s.en_tete.type).toBe('trimestrielle_allegee');
    expect(s.en_tete.periode_debut).toBe('2026-04-01');
    expect(s.en_tete.periode_fin).toBe('2026-06-30');
  });
});

describe('ETP — une seule base, l’ASP en premier', () => {
  it('base 1 820 h par défaut, ETP ASP premier, effectif pondéré nommé comme un contrôle', async () => {
    branche({ etpAsp: [{ mois: 1, etp: 25.99, nb_brsa: 6 }, { mois: 2, etp: 26.1, nb_brsa: 6 }] });
    const s = await composerDialogueGestion({ annee: 2026 });
    const b = s.blocs['1_effectifs_etp'];
    expect(b.base_heures).toBe(1820);
    expect(b.mois).toHaveLength(12);
    expect(b.mois[0]).toEqual({ mois: '2026-01', etp_asp: 25.99, effectif_pondere: null });
    expect(b.etp_asp_moyen).toBe(26.05);
    expect(b.nb_mois_asp_valides).toBe(2);
    expect(b.source_etp_asp).toBe('etp_asp_mensuel');
    expect(b.note).toMatch(/L'ETP ASP validé fait foi/);
  });

  it('convention non saisie → taux de réalisation null et « objectif non paramétré » écrit', async () => {
    branche({ etpAsp: [{ mois: 1, etp: 25.99 }] });
    const s = await composerDialogueGestion({ annee: 2026 });
    expect(s.blocs['1_effectifs_etp'].etp_conventionnes).toBeNull();
    expect(s.blocs['1_effectifs_etp'].taux_realisation_pct).toBeNull();
    expect(s.blocs['1_effectifs_etp'].note).toMatch(/Objectif non paramétré/);
  });

  it('annexe financière saisie → base et cible relues depuis la convention', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/FROM settings/.test(s) && params && params[0] === 'effectifs.convention_2026') {
        return Promise.resolve({ rows: [{ value: JSON.stringify({ etp_conventionnes: 25.17, heures_annuelles_etp: 1820 }) }] });
      }
      if (/FROM etp_asp_mensuel/.test(s) && !/nb_brsa FROM/.test(s)) {
        return Promise.resolve({ rows: [{ mois: 1, etp: 25.17 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    expect(s.blocs['1_effectifs_etp'].etp_conventionnes).toBe(25.17);
    expect(s.blocs['1_effectifs_etp'].taux_realisation_pct).toBe(100);
    expect(s.blocs['1_effectifs_etp'].source_convention).toBe('annexe_financiere');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ASSERTION STRUCTURELLE — la seule qui couvrira le bloc 10 écrit l'an prochain
// ───────────────────────────────────────────────────────────────────────────
// Les tests ponctuels du lot n'exerçaient le k-anonymat que sur les deux blocs
// où il était appliqué : ils mesuraient sa couverture là où il existait, pas son
// absence ailleurs. Celui-ci sérialise le document ENTIER composé sur une
// cohorte d'UNE personne et échoue si un entier compris entre 1 et k−1 apparaît
// hors de la liste blanche déclarée. Un champ ajouté demain sans protection le
// fera tomber, sans que personne n'ait eu à y penser.
// ═══════════════════════════════════════════════════════════════════════════
describe('k-anonymat structurel — aucun compte de 1 à k−1 hors liste blanche', () => {
  const { K_EFFECTIFS_PUBLIES } = require('../../../src/services/dialogue-gestion');

  /** Tous les nombres du document, avec leur chemin. */
  function nombres(noeud, chemin, out = []) {
    if (Array.isArray(noeud)) {
      noeud.forEach((v, i) => nombres(v, `${chemin}[${i}]`, out));
      return out;
    }
    if (!noeud || typeof noeud !== 'object') return out;
    for (const [cle, v] of Object.entries(noeud)) {
      const c = `${chemin}.${cle}`;
      if (v && typeof v === 'object') nombres(v, c, out);
      else if (typeof v === 'number') out.push([c, v, cle]);
    }
    return out;
  }

  /** Le chemin, débarrassé des index de tableau — la liste blanche est stable. */
  const sansIndex = (c) => c.replace(/\[\d+\]/g, '');

  it("une cohorte d'UNE personne ne laisse sortir aucun compte identifiant", async () => {
    branche({
      cohorte: [personne({ id: 1 })],
      criteres: [{ code: 'TH', libelle: 'Travailleur handicapé (RQTH)', ordre: 1, n: 1 }],
      freins: [{ id: 1, entree_frein_mobilite: 4, actuel_frein_mobilite: 2 }],
      actionsAxe: [{ axe: 'mobilite', n_actions: 1, n_dora: 1, dora_oriente: 0, dora_pris_en_charge: 1, dora_refuse: 0, dora_sans_suite: 0 }],
      partenaires: [{ axe: 'mobilite', nom: 'CMS de Darnétal — Mme R.' }],
      aides: [{ nature: 'financiere_urgence', n: 1, montant_total: 340, n_chiffrees: 1 }],
      pmsmp: [{ entreprise: 'GARAGE MARTIN SARL (Darnétal)', debouche: 'embauche_accueillant', embauche_accueillant: true, jours: 12 }],
      fins: [{ employee_id: 1, parcours_num: 1 }],
      bilans: [{ employee_id: 1, parcours_num: 1, sortie_classification: 'emploi_durable', sortie_type: 'CDI' }],
      fse: [{ situation_6mois: 'emploi_durable' }],
      satisfaction: [{ nb: 1, moyenne: 3.5 }],
      entretiens: [{ type: 'diagnostic_accueil', realises: 1, echus: 1, realises_echus: 1 }],
      compteurs: [{ n: 1 }],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const k = s.en_tete.k_anonymat;

    const fautifs = nombres(s.blocs, 'blocs')
      .filter(([, v]) => Number.isInteger(v) && Math.abs(v) >= 1 && Math.abs(v) < k)
      .filter(([c, , cle]) => !K_EFFECTIFS_PUBLIES.has(sansIndex(c))
        // Les MESURES déclarées ne comptent pas des personnes (taux, heures,
        // euros, ETP, base de calcul, nombre d'organisations) : elles sont
        // retirées par dépendance, pas pour leur propre valeur.
        && !['base_heures', 'nb_mois_asp_valides', 'etp_asp', 'effectif_pondere', 'etp_asp_moyen',
          'etp_conventionnes', 'taux_realisation_pct', 'part_pct', 'taux_pct', 'pct', 'total_h',
          'moyenne_par_personne_h', 'moyenne_globale', 'delai_moyen_diagnostic_jours',
          'montant_total', 'jours', 'annee', 'trimestre', 'k_anonymat', 'seuil',
          'entreprises_distinctes'].includes(cle));

    expect({ comptes_identifiants: fautifs }).toEqual({ comptes_identifiants: [] });
  });

  it('et les textes qui désignent (raison sociale, partenaire) ne sortent pas non plus', async () => {
    branche({
      cohorte: [personne({ id: 1 })],
      partenaires: [{ axe: 'mobilite', nom: 'CMS de Darnétal — Mme R.' }],
      actionsAxe: [{ axe: 'mobilite', n_actions: 1, n_dora: 1, dora_oriente: 1, dora_pris_en_charge: 0, dora_refuse: 0, dora_sans_suite: 0 }],
      pmsmp: [{ entreprise: 'GARAGE MARTIN SARL (Darnétal)', debouche: 'aucun', embauche_accueillant: false, jours: 12 }],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const brut = JSON.stringify(s);
    expect(brut).not.toMatch(/GARAGE MARTIN/);
    expect(brut).not.toMatch(/Mme R\./);
  });

  it('au-dessus du seuil, le document dit tout ce qu’il doit dire (on ne vide pas la pièce)', async () => {
    branche({
      cohorte: Array.from({ length: 40 }, (_, i) => personne({ id: i + 1, ft_categorie: 'A' })),
      criteres: [{ code: 'brsa', libelle: 'Bénéficiaire du RSA', ordre: 1, n: 30 }],
    });
    const s = await composerDialogueGestion({ annee: 2026 });
    const b = s.blocs['2_publics_entree'];
    expect(b.effectif).toBe(40);
    expect(b.par_categorie_ft.A).toBe(40);
    expect(b.par_critere_eligibilite[0].n).toBe(30);
    expect(b.par_critere_eligibilite[0].part_pct).toBe(75);
    // Le seul retrait vient du bloc 8, dont le jeu d'essai simulé porte une
    // seule personne sous le plancher d'activité : le bloc 2, lui, sort entier.
    expect(s.sous_seuil.find((x) => x.bloc === '2_publics_entree')).toBeUndefined();
  });
});

describe('robustesse', () => {
  it('année illisible → erreur nommée, jamais une période inventée', async () => {
    await expect(composerDialogueGestion({ annee: 'bidon' })).rejects.toThrow(/Année invalide/);
  });

  it('base entièrement muette : le document se compose quand même, sans rien inventer', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const s = await composerDialogueGestion({ annee: 2026 });
    expect(s.blocs['2_publics_entree'].effectif).toBe(0);
    expect(s.blocs['6_sorties'].methode_b.denominateur).toBe(0);
    expect(s.blocs['6_sorties'].methode_b.taux_pct.dynamiques).toBeNull();
    expect(s.blocs['9_methode'].length).toBeGreaterThan(5);
  });
});
