// ═══════════════════════════════════════════════════════════════════════════
// « MON PARCOURS EN UNE PAGE » ET « MON RÉCAP » — composition en LISTE BLANCHE
// ───────────────────────────────────────────────────────────────────────────
// `pg` est simulé : on exerce le vrai composeur et on inspecte ce qui SORT.
//
// Ce que ces tests tiennent :
//   1. LISTE BLANCHE — les deux documents portent exactement les clés annoncées,
//      et AUCUNE clé interdite nulle part dans l'arbre (art. 9/10, statut social,
//      notes, textes libres). Preuve par parcours récursif, pas par lecture.
//   2. AUCUN TEXTE LIBRE — une étape porte le LIBELLÉ DE SON TYPE, jamais le
//      `titre` saisi par la conseillère (le défaut trouvé en PR B sur le relevé
//      transmis au CMS : « Bilan après l'hospitalisation » y sortait tel quel).
//   3. LES FREINS SENSIBLES sortent du SQL, pas du JS : une action rattachée au
//      frein santé ou judiciaire n'est jamais chargée.
//   4. JAMAIS DE VALEUR INVENTÉE — aucun relevé d'heures rend `null`, jamais 0 h ;
//      un type de sortie hors dictionnaire rend `null`, jamais la valeur brute.
//   5. AUCUNE CIBLE, AUCUN SEUIL sur les heures de la semaine (décision 4).
// ═══════════════════════════════════════════════════════════════════════════

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const mockActivite = jest.fn();
jest.mock('../../../src/services/activite-hebdo', () => ({
  activiteHebdo: (...a) => mockActivite(...a),
  activiteHebdoCohorte: jest.fn(),
  lireReglages: jest.fn(),
}));

const svc = require('../../../src/services/mon-parcours');

const EMP = {
  id: 5, first_name: 'Amine', last_name: 'BENALI', parcours_num: 1,
  insertion_status: 'en_parcours', insertion_start_date: '2026-03-01', insertion_end_date: null,
  referent_unique_type: 'cms', referent_unique_nom: 'Mme L. (CMS Elbeuf)', referent_unique_contact: '02 35 00 00 00',
  cip_nom_complet: 'Claire MARTIN', cip_prenom: 'Claire', cip_nom: 'MARTIN',
};

/** Aiguillage du faux `pg`. `over` remplace la réponse d'une source. */
function branche(over = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM employees e\s+LEFT JOIN users u/.test(s)) return Promise.resolve({ rows: over.employee === null ? [] : [over.employee || EMP] });
    if (/FROM insertion_objectifs/.test(s) && /GROUP BY statut/.test(s)) return Promise.resolve({ rows: over.objectifsCompte || [] });
    if (/FROM insertion_objectifs/.test(s)) return Promise.resolve({ rows: over.engagements || [] });
    if (/FROM cip_action_plans/.test(s)) return Promise.resolve({ rows: over.actions || [] });
    if (/FROM insertion_milestones/.test(s) && /bilan_sortie/.test(s)) return Promise.resolve({ rows: over.sortie || [] });
    if (/FROM insertion_milestones/.test(s) && /status = 'realise'/.test(s)) return Promise.resolve({ rows: over.entretiens || [] });
    if (/FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: over.prochain || [] });
    if (/FROM insertion_pieces/.test(s)) return Promise.resolve({ rows: over.pieces || [] });
    if (/FROM insertion_alimentations_referent/.test(s)) return Promise.resolve({ rows: over.alimentations || [] });
    if (/FROM insertion_documents_salarie/.test(s)) return Promise.resolve({ rows: over.documents || [] });
    if (/FROM employee_contracts/.test(s)) return Promise.resolve({ rows: over.contrats || [] });
    if (/FROM insertion_competence_evaluations/.test(s)) return Promise.resolve({ rows: over.evaluations || [] });
    if (/FROM insertion_pmsmp/.test(s)) return Promise.resolve({ rows: over.pmsmp || [] });
    return Promise.resolve({ rows: [] });
  });
  mockActivite.mockResolvedValue(over.activite || { semaines: [] });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockActivite.mockReset();
  branche();
});

/** Toutes les clés de l'arbre, à tous les niveaux. */
function clesProfondes(objet, acc = new Set()) {
  if (Array.isArray(objet)) { objet.forEach((v) => clesProfondes(v, acc)); return acc; }
  if (objet && typeof objet === 'object') {
    for (const [k, v] of Object.entries(objet)) { acc.add(k); clesProfondes(v, acc); }
  }
  return acc;
}

// ───────────────────────────────────────────────────────────────────────────
describe('liste blanche — les clés, et pas une de plus', () => {
  test('« Mon parcours » porte exactement les neuf rubriques annoncées', async () => {
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(Object.keys(c).sort()).toEqual([...svc.MON_PARCOURS_CLES].sort());
  });

  test('« Mon Récap » porte exactement les sept rubriques annoncées', async () => {
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(Object.keys(c).sort()).toEqual([...svc.MON_RECAP_CLES].sort());
  });

  test('aucune clé interdite, à AUCUN niveau, dans l’un ou l’autre document', async () => {
    // Le dossier est rempli de tout ce qui n'a pas le droit de sortir : freins,
    // commentaires, motifs d'absence, avis. Si une seule clé passait, elle
    // apparaîtrait ici.
    branche({
      engagements: [{ titre: 'Passer le code', echeance: '2026-10-01', description: 'texte libre interne' }],
      actions: [{ category: 'insertion', echeance: '2026-09-30', partenaire_nom: 'Mission locale', notes: 'note interne', action_label: 'libellé libre' }],
      entretiens: [{ milestone_type: 'bilan_intermediaire', completed_date: '2026-06-01', observations: 'texte CIP', frein_sante: 4, presence: 'absent', absence_motif: 'sante' }],
      contrats: [{ contract_type: 'CDD', start_date: '2026-03-01', end_date: '2026-09-30', weekly_hours: 26, poste: 'Agent de tri' }],
      pmsmp: [{ entreprise: 'Recyclerie X', objet: 'decouvrir_metier', date_debut: '2026-05-04', date_fin: '2026-05-15', bilan: 'texte libre' }],
      evaluations: [{ id: 1, filiere: 'tri', date_evaluation: '2026-06-15', moyenne: '7.2' }],
      sortie: [{ completed_date: '2026-09-30', sortie_classification: 'emploi_transition', sortie_type: 'CDD' }],
      prochain: [{ interview_date: '2026-09-20T13:00:00Z', due_date: '2026-09-20', int_prenom: 'Claire', int_nom: 'MARTIN' }],
      activite: { semaines: [{ iso_year: 2026, iso_week: 37, week_start: '2020-09-07', heures_travail: 26, minutes_accompagnement: 90, total_heures: 27.5, sans_releve: false }] },
    });
    for (const doc of [await svc.composerMonParcours({ employeeId: 5 }), await svc.composerMonRecap({ employeeId: 5 })]) {
      const cles = [...clesProfondes(doc)];
      for (const interdit of svc.CLES_INTERDITES) {
        const fautives = cles.filter((k) => k.toLowerCase().includes(interdit));
        expect({ interdit, fautives }).toEqual({ interdit, fautives: [] });
      }
    }
  });

  test('un salarié inconnu rend null (et non un document vide)', async () => {
    branche({ employee: null });
    expect(await svc.composerMonParcours({ employeeId: 999 })).toBeNull();
    expect(await svc.composerMonRecap({ employeeId: 999 })).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('aucun texte libre ne sort', () => {
  test('une étape porte le libellé de son TYPE, jamais le titre saisi', async () => {
    branche({ entretiens: [{ milestone_type: 'bilan_intermediaire', completed_date: '2026-06-01' }] });
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(c.etapes[0].libelle).toBe('Bilan intermédiaire');
    // La colonne `titre` n'est même pas SÉLECTIONNÉE : ce qu'on ne lit pas ne
    // peut pas fuir par une clé oubliée à la composition.
    const requeteEntretiens = mockQuery.mock.calls
      .map(([sql]) => String(sql))
      .find((s) => /FROM insertion_milestones/.test(s) && /status = 'realise'/.test(s) && !/bilan_sortie/.test(s));
    expect(requeteEntretiens).not.toMatch(/\btitre\b/);
  });

  test('une action est décrite par sa catégorie et son partenaire, jamais par son libellé', async () => {
    branche({ actions: [{ category: 'frein', date_realisation: '2026-05-02', partenaire_nom: 'CCAS' }] });
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(c.etapes[0].libelle).toBe('Levée d\'une difficulté — avec CCAS');
    const requeteActions = mockQuery.mock.calls.map(([sql]) => String(sql)).find((s) => /FROM cip_action_plans/.test(s));
    expect(requeteActions).not.toMatch(/action_label/);
    expect(requeteActions).not.toMatch(/\bnotes\b/);
  });

  test('une évaluation de compétences donne une moyenne, jamais les items', async () => {
    branche({ evaluations: [{ id: 1, filiere: 'tri', date_evaluation: '2026-06-15', moyenne: '7.2' }] });
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(c.etapes[0].libelle).toBe('Évaluation des compétences — Tri — moyenne 7.2/10');
    const requete = mockQuery.mock.calls.map(([sql]) => String(sql)).find((s) => /insertion_competence_evaluations/.test(s));
    expect(requete).not.toMatch(/\bobservation\b/);
    expect(requete).not.toMatch(/\bsynthese\b/);
    // Les « N/E » ne tirent pas la moyenne vers le bas : ils en sont exclus.
    expect(requete).toMatch(/non_evalue = false/);
  });

  test('un titre d’engagement trop long est tronqué proprement, jamais coupé net', async () => {
    branche({ engagements: [{ titre: 'A'.repeat(200), echeance: null }] });
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(c.mes_engagements[0].titre.length).toBeLessThanOrEqual(121);
    expect(c.mes_engagements[0].titre.endsWith('…')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('freins sensibles — exclus en SQL, ligne entière', () => {
  test('les deux documents écartent les actions rattachées à santé ou judiciaire', async () => {
    await svc.composerMonParcours({ employeeId: 5 });
    await svc.composerMonRecap({ employeeId: 5 });
    const requetes = mockQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }))
      .filter((r) => /FROM cip_action_plans/.test(r.sql));
    expect(requetes.length).toBe(2);
    for (const r of requetes) {
      // Le prédicat est dans le WHERE : la ligne ne remonte même pas en mémoire.
      expect(r.sql).toMatch(/frein_type IS NULL OR NOT \(a\.frein_type = ANY\(\$2::text\[\]\)\)/);
      expect(r.params[1]).toEqual(['sante', 'judiciaire']);
    }
  });

  test('la liste des freins exclus vient du registre, elle n’est pas recopiée', () => {
    const { FREINS } = require('../../../src/routes/insertion/freins-registry');
    expect(svc.FREINS_EXCLUS).toEqual(FREINS.filter((f) => f.sensible != null).map((f) => f.key));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('les heures de la semaine — sans cible, sans seuil, sans zéro inventé', () => {
  test('la dernière semaine RELEVÉE est rendue, avec sa forme ISO', async () => {
    branche({
      activite: {
        semaines: [
          { iso_year: 2026, iso_week: 36, week_start: '2026-08-31', heures_travail: 24, minutes_accompagnement: 0, total_heures: 24, sans_releve: false },
          { iso_year: 2026, iso_week: 37, week_start: '2026-09-07', heures_travail: 26, minutes_accompagnement: 90, total_heures: 27.5, sans_releve: false },
          { iso_year: 2026, iso_week: 38, week_start: '2026-09-14', heures_travail: null, minutes_accompagnement: 0, total_heures: null, sans_releve: true },
        ],
      },
    });
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(c.mes_heures_semaine).toEqual({
      semaine: '2026-W37', travail_h: 26, accompagnement_h: 1.5, total_h: 27.5,
    });
    // Ni cible, ni seuil, ni alerte : trois clés et pas une de plus.
    expect(Object.keys(c.mes_heures_semaine).sort()).toEqual(['accompagnement_h', 'semaine', 'total_h', 'travail_h']);
  });

  test('aucun relevé → null, JAMAIS zéro heure', async () => {
    branche({ activite: { semaines: [{ iso_year: 2026, iso_week: 38, week_start: '2026-09-14', heures_travail: null, total_heures: null, sans_releve: true }] } });
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(c.mes_heures_semaine).toBeNull();
  });

  test('l’année précédente est consultée quand l’année courante ne porte rien', async () => {
    // Cas d'un mois de janvier, ou d'un import de paie en retard : la dernière
    // semaine connue est à quelques jours, la taire serait un faux « pas encore
    // renseigné ».
    mockActivite.mockReset();
    mockActivite
      .mockResolvedValueOnce({ semaines: [] })
      .mockResolvedValueOnce({ semaines: [{ iso_year: 2025, iso_week: 52, week_start: '2025-12-22', heures_travail: 21, minutes_accompagnement: 0, total_heures: 21, sans_releve: false }] });
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(c.mes_heures_semaine.semaine).toBe('2025-W52');
    expect(mockActivite).toHaveBeenCalledTimes(2);
  });

  test('aucun vocabulaire de seuil dans le CODE du module', () => {
    // Le mot « seuil » n'apparaît que dans les commentaires, qui expliquent
    // précisément pourquoi il ne doit pas atteindre l'écran. On lit donc le
    // code DÉPOUILLÉ de ses commentaires : ce qui reste est ce qui peut
    // s'imprimer sur la page d'une personne.
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../../../src/services/mon-parcours.js'), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
      .toLowerCase();
    expect(code).not.toContain('seuil');
    expect(code).not.toContain('15 h');
    expect(code).not.toContain('plancher');
    expect(code).not.toContain('obligation');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('jamais de valeur inventée', () => {
  test('un type de sortie hors dictionnaire rend null, et non la valeur brute', async () => {
    branche({ sortie: [{ completed_date: '2026-09-30', sortie_classification: 'emploi_durable', sortie_type: 'valeur libre saisie un jour' }] });
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(c.sortie.classification_libelle).toBe('Emploi durable');
    expect(c.sortie.type_libelle).toBeNull();
  });

  test('un référent « non déterminé » rend null (le PDF dira qu’il sera indiqué)', async () => {
    branche({ employee: { ...EMP, referent_unique_type: 'non_determine', referent_unique_nom: null } });
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(c.mon_referent).toBeNull();
  });

  test('un rendez-vous sans heure rend heure: null, jamais 00:00', async () => {
    branche({ prochain: [{ interview_date: null, due_date: '2026-09-20', int_prenom: null, int_nom: null }] });
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(c.prochain_rdv.date).toBe('2026-09-20');
    expect(c.prochain_rdv.heure).toBeNull();
    // Repli sur la conseillère référente quand aucun intervieweur n'est désigné.
    expect(c.prochain_rdv.avec).toBe('Claire M.');
  });

  test('la conseillère est nommée par son prénom et une initiale', () => {
    expect(svc.prenomInitiale('Claire', 'MARTIN')).toBe('Claire M.');
    expect(svc.prenomInitiale('Claire', null)).toBe('Claire');
    expect(svc.prenomInitiale(null, null)).toBeNull();
  });

  test('une source en panne vide SA rubrique sans faire tomber le document', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e\s+LEFT JOIN users u/.test(s)) return Promise.resolve({ rows: [EMP] });
      if (/FROM cip_action_plans/.test(s)) return Promise.reject(Object.assign(new Error('relation absente'), { code: '42P01' }));
      return Promise.resolve({ rows: [] });
    });
    const c = await svc.composerMonParcours({ employeeId: 5 });
    expect(c.engagements_structure).toEqual([]);
    expect(c.personne.prenom).toBe('Amine');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('« Mon Récap » — étapes et compteurs', () => {
  test('les étapes sont triées par date, tous types confondus', async () => {
    branche({
      entretiens: [{ milestone_type: 'diagnostic_accueil', completed_date: '2026-03-20' }],
      pmsmp: [{ entreprise: 'Recyclerie X', objet: 'decouvrir_metier', date_debut: '2026-05-04', date_fin: '2026-05-15' }],
      actions: [{ category: 'insertion', date_realisation: '2026-04-10', partenaire_nom: 'Mission locale' }],
      evaluations: [{ id: 1, filiere: 'tri', date_evaluation: '2026-06-15', moyenne: '7.2' }],
    });
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(c.etapes.map((e) => e.date)).toEqual(['2026-03-20', '2026-04-10', '2026-05-04', '2026-06-15']);
    expect(c.etapes.map((e) => e.type)).toEqual(['entretien', 'action', 'pmsmp', 'evaluation']);
  });

  test('les objectifs sont COMPTÉS, jamais commentés', async () => {
    branche({ objectifsCompte: [{ statut: 'atteint', n: 2 }, { statut: 'en_cours', n: 3 }, { statut: 'abandonne', n: 1 }] });
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(c.objectifs).toEqual({ atteints: 2, en_cours: 3 });
  });

  test('un parcours en cours n’a pas de rubrique « sortie » renseignée', async () => {
    const c = await svc.composerMonRecap({ employeeId: 5 });
    expect(c.sortie).toBeNull();
  });
});
