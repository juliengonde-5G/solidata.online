/**
 * Participants FSE+ — sorties, relevé à six mois, dossier de conformité, alertes.
 * PR A « Conformité immédiate », lot 2 (plan 07 § 3 items 2.3 à 2.5).
 *
 * CE QUE CE SERVICE TIENT, ET POURQUOI IL EXISTE.
 *
 * 1. LA SORTIE VIT DANS SA PROPRE TABLE. Elle était jusqu'ici un champ du jalon
 *    `bilan_sortie` — c'est-à-dire introuvable pour la personne qui part SANS
 *    entretien de sortie, qui est précisément celle dont la donnée manque à
 *    l'autorité. `insertion_fse_sorties` se remplit par DEUX chemins (la clôture
 *    d'un bilan, ou la saisie directe depuis le dossier de conformité) et une
 *    seule ligne existe par parcours : les deux chemins écrivent la même ligne.
 *
 * 2. `saisie_at` NE RECULE JAMAIS ET N'AVANCE JAMAIS. L'autorité mesure le
 *    « délai de saisie » (09 § 2 (a), colonne 26) : c'est la colonne qu'elle
 *    regarde en premier. Si une sortie recueillie à J+10 sans bilan voyait son
 *    horodatage repoussé à J+60 par la clôture tardive du bilan, la structure
 *    s'accuserait d'un retard qu'elle n'a pas eu. L'upsert conserve donc le PLUS
 *    ANCIEN horodatage — la trace dit quand l'information a été recueillie pour
 *    la première fois, pas quand on l'a ressaisie.
 *
 * 3. LE DOSSIER DE CONFORMITÉ DIT « SANS OBJET », PAS « MANQUANT ». Une pièce de
 *    sortie n'est pas en retard pour quelqu'un dont le parcours est en cours :
 *    l'écrire en rouge ferait perdre la CIP dans du faux positif et lui ferait
 *    ignorer les vraies alertes. Les quatre états sont distincts et le restent :
 *    `complet`, `partiel`, `a_faire`, `sans_objet`.
 */
const pool = require('../config/database');
const { readInsertionSetting } = require('../utils/insertion-settings');
const {
  FSE_ENTREE_ITEMS, FSE_SORTIE_ITEMS, SITUATIONS_SORTIE, SITUATIONS_6MOIS,
  valider, completude, estVide,
} = require('../utils/fse-schema');

/** Délai de saisie de la sortie attendu par l'autorité : « dans le mois ». */
const DELAI_SAISIE_SORTIE_JOURS = 30;

/** Clés des 9 pièces du dossier, dans l'ORDRE de la maquette (contrat § 6.2). */
const PIECES_ORDRE = [
  'eligibilite', 'pass_iae', 'referent_unique', 'fse_entree', 'diagnostic_socle',
  'fse_sortie', 'sortie_delai', 'six_mois', 'remise_documents',
];

/** Nombre de rubriques du socle du diagnostic (08 § 3.4) — sert au détail affiché. */
const SOCLE_RUBRIQUES = 7;

// ───────────────────────────────────────────────────────────────────────────
// Utilitaires
// ───────────────────────────────────────────────────────────────────────────

const jour = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const joursEntre = (a, b) => Math.floor((new Date(jour(b)) - new Date(jour(a))) / 86400000);

/**
 * Journal RGPD. Volontairement NON silencieux pour les écritures de sortie :
 * l'appelant décide quoi faire de l'échec. Pour une consultation, un journal
 * perdu ne doit pas empêcher la CIP de travailler ; pour un export, il fait
 * échouer l'export (doctrine EXG-43, appliquée dans routes/exports-fse.js).
 */
async function journaliser(db, { userId, action, employeeId, details }) {
  await db.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [userId || null, action, 'insertion_fse', employeeId || null, JSON.stringify(details || {})]
  );
}

/**
 * Situation FSE+ déduite de la classification de sortie IAE, quand la CIP n'a
 * pas répondu explicitement au questionnaire. Les correspondances sûres sont
 * appliquées ; la catégorie IAE « autre » n'en a AUCUNE (elle recouvre aussi
 * bien un déménagement qu'un abandon) et donne `inconnue`, que l'export imprime
 * « Non renseignée ». On ne fabrique pas une situation que personne n'a constatée.
 */
function situationDepuisClassification(classification, sortieType) {
  if (classification === 'emploi_durable') return 'emploi_durable';
  if (classification === 'emploi_transition') return 'emploi_transition';
  if (classification === 'sortie_positive') {
    return sortieType === 'formation' ? 'formation' : 'autre_sortie_positive';
  }
  return 'inconnue';
}

// ───────────────────────────────────────────────────────────────────────────
// Écriture : sortie et relevé à six mois
// ───────────────────────────────────────────────────────────────────────────

/**
 * Enregistre (ou met à jour) la sortie FSE+ d'un participant.
 *
 * @param {object} p
 * @param {number} p.employeeId
 * @param {object|null} p.milestone jalon `bilan_sortie` clôturé (chemin « bilan »)
 * @param {object} [p.payload] saisie directe `{date_sortie, situation_sortie, fse_sortie, projet_id}`
 * @param {number} p.userId auteur
 * @param {object} [p.client] connexion (transaction de l'appelant) — défaut : pool
 * @returns {Promise<{ligne:object, source:string}>}
 * @throws {Error} err.code='FSE_SORTIE_INVALIDE' avec err.erreurs si le
 *         questionnaire est hors schéma ou la situation absente.
 */
async function enregistrerSortie({ employeeId, milestone = null, payload = {}, userId, client } = {}) {
  const db = client || pool;
  const source = milestone ? 'bilan' : 'sans_bilan';

  // Parcours : celui du jalon s'il vient d'un bilan (un bilan appartient à un
  // parcours précis), sinon le parcours courant du salarié.
  let parcoursNum = milestone ? (milestone.parcours_num || 1) : null;
  if (parcoursNum == null) {
    const e = await db.query('SELECT COALESCE(parcours_num, 1) AS pn FROM employees WHERE id = $1', [employeeId]);
    parcoursNum = e.rows[0]?.pn || 1;
  }

  // Contenu du questionnaire : la saisie directe prime, sinon celui du jalon.
  const brut = payload.fse_sortie != null ? payload.fse_sortie : (milestone ? milestone.fse_sortie : null);
  const v = valider(brut, FSE_SORTIE_ITEMS);
  if (!v.ok) {
    const err = new Error('Questionnaire de sortie FSE+ invalide');
    err.code = 'FSE_SORTIE_INVALIDE';
    err.erreurs = v.erreurs;
    throw err;
  }

  // Situation : réponse explicite > questionnaire > déduction depuis la
  // classification IAE du bilan. Jamais de valeur par défaut silencieuse.
  let situation = payload.situation_sortie || v.valeurs.situation_sortie || null;
  if (!situation && milestone) {
    situation = situationDepuisClassification(milestone.sortie_classification, milestone.sortie_type);
  }
  if (!situation || !SITUATIONS_SORTIE.includes(situation)) {
    const err = new Error('Situation à la sortie manquante ou hors liste');
    err.code = 'FSE_SORTIE_INVALIDE';
    err.erreurs = [{ cle: 'situation_sortie', motif: `Situation attendue parmi : ${SITUATIONS_SORTIE.join(', ')}.` }];
    throw err;
  }
  v.valeurs.situation_sortie = situation;

  // Date de sortie : celle qui est saisie, sinon la date de réalisation du
  // bilan. Une sortie sans date n'est pas enregistrable (colonne NOT NULL).
  const dateSortie = jour(payload.date_sortie) || jour(milestone && (milestone.completed_date || milestone.due_date));
  if (!dateSortie) {
    const err = new Error('Date de sortie obligatoire');
    err.code = 'FSE_SORTIE_INVALIDE';
    err.erreurs = [{ cle: 'date_sortie', motif: 'Date de sortie obligatoire.' }];
    throw err;
  }

  // Projet : celui qui est transmis, sinon le rattachement ASI ouvert (c'est le
  // projet à participants ; l'OCS porte des postes, pas des personnes). Rien de
  // trouvé → NULL assumé : on ne rattache pas une sortie à un projet au hasard.
  let projetId = payload.projet_id || null;
  if (!projetId) {
    const p = await db.query(
      `SELECT pp.projet_id FROM insertion_projet_participants pp
       JOIN insertion_projets pr ON pr.id = pp.projet_id
       WHERE pp.employee_id = $1 AND pr.type = 'asi'
       ORDER BY pp.date_entree DESC LIMIT 1`,
      [employeeId]
    );
    projetId = p.rows[0]?.projet_id || null;
  }

  const res = await db.query(
    `INSERT INTO insertion_fse_sorties
       (employee_id, parcours_num, projet_id, milestone_id, source, date_sortie, situation_sortie, fse_sortie, saisie_at, saisie_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
     ON CONFLICT (employee_id, parcours_num) DO UPDATE SET
       projet_id = COALESCE(EXCLUDED.projet_id, insertion_fse_sorties.projet_id),
       milestone_id = COALESCE(EXCLUDED.milestone_id, insertion_fse_sorties.milestone_id),
       source = EXCLUDED.source,
       date_sortie = EXCLUDED.date_sortie,
       situation_sortie = EXCLUDED.situation_sortie,
       fse_sortie = EXCLUDED.fse_sortie,
       -- Le délai de saisie se compte depuis le PREMIER recueil (cf. en-tête) :
       -- une correction ultérieure ne doit pas fabriquer un retard rétroactif.
       saisie_at = LEAST(insertion_fse_sorties.saisie_at, EXCLUDED.saisie_at),
       saisie_par = EXCLUDED.saisie_par
     RETURNING *`,
    [employeeId, parcoursNum, projetId, milestone ? milestone.id : null, source,
      dateSortie, situation, JSON.stringify(v.valeurs), userId || null]
  );

  await journaliser(db, {
    userId,
    action: 'INSERTION_FSE_SORTIE_SAISIE',
    employeeId,
    // Le journal dit QUI a saisi QUOI comme catégorie — jamais le commentaire
    // libre, qui peut porter du contexte personnel.
    details: { parcours_num: parcoursNum, source, date_sortie: dateSortie, situation_sortie: situation, projet_id: projetId },
  });

  return { ligne: res.rows[0], source };
}

/**
 * Relevé de situation à six mois (indicateur de RÉSULTAT du FSE+ — F5).
 * @throws {Error} err.code='SIX_MOIS_INVALIDE' | 'SORTIE_ABSENTE'
 */
async function enregistrerSixMois({ employeeId, parcoursNum = null, situation6mois, dateReleve, userId, client } = {}) {
  const db = client || pool;
  if (!SITUATIONS_6MOIS.includes(situation6mois)) {
    const err = new Error('Situation à six mois hors liste');
    err.code = 'SIX_MOIS_INVALIDE';
    err.erreurs = [{ cle: 'situation_6mois', motif: `Situation attendue parmi : ${SITUATIONS_6MOIS.join(', ')}.` }];
    throw err;
  }
  const d = jour(dateReleve) || jour(new Date());
  const params = [situation6mois, d, userId || null, employeeId];
  let where = 'employee_id = $4';
  if (parcoursNum != null) { params.push(parcoursNum); where += ` AND parcours_num = $${params.length}`; }

  const res = await db.query(
    `UPDATE insertion_fse_sorties
       SET situation_6mois = $1, date_releve_6mois = $2, releve_6mois_par = $3
     WHERE ${where} RETURNING *`,
    params
  );
  if (res.rows.length === 0) {
    // Le relevé se pose SUR une sortie : sans sortie enregistrée il n'a pas de
    // support. On refuse plutôt que de créer une ligne de sortie fantôme dont
    // ni la date ni la situation ne seraient constatées.
    const err = new Error("Aucune sortie FSE+ enregistrée pour ce parcours — saisissez d'abord la sortie.");
    err.code = 'SORTIE_ABSENTE';
    throw err;
  }

  await journaliser(db, {
    userId,
    action: 'INSERTION_FSE_SIX_MOIS_SAISIE',
    employeeId,
    details: { parcours_num: res.rows[0].parcours_num, situation_6mois: situation6mois, date_releve_6mois: d },
  });
  return res.rows[0];
}

// ───────────────────────────────────────────────────────────────────────────
// Dossier de conformité (9 pièces)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Charge en 6 requêtes ENSEMBLISTES le contexte de N salariés.
 * Pourquoi ensembliste : la vue transversale par projet compose le dossier de
 * plusieurs dizaines de participants ; une boucle de requêtes par personne
 * ferait 6×N allers-retours pour un écran qu'on ouvre tous les matins.
 * @returns {Promise<Map<number, object>>}
 */
async function chargerContextes(db, employeeIds) {
  const ids = (employeeIds || []).map((i) => parseInt(i, 10)).filter((i) => Number.isInteger(i));
  const ctx = new Map();
  if (ids.length === 0) return ctx;

  // (1) Salariés. Les colonnes du lot 1 (pass_iae_statut, referent_unique_type,
  // eligibilite_verifiee_le…) sont posées par la migration `insertion-cadre`,
  // jouée AVANT celle-ci dans la même transaction d'init-db : la dépendance est
  // assumée, et un défaut de migration doit se voir (42703) plutôt que de
  // produire un dossier faussement complet.
  const emp = await db.query(
    `SELECT e.id, e.first_name, e.last_name, e.insertion_status, e.insertion_start_date, e.insertion_end_date,
            COALESCE(e.parcours_num, 1) AS parcours_num, e.contract_end,
            e.pass_iae_number, e.pass_iae_end, e.pass_iae_statut,
            e.referent_unique_type, e.referent_unique_nom,
            e.eligibilite_verifiee_le, e.eligibilite_criteres, e.eligibilite_justificatifs_ref
     FROM employees e WHERE e.id = ANY($1::int[])`,
    [ids]
  );
  for (const r of emp.rows) ctx.set(r.id, { employee: r, criteres: [], diagnostic: null, sortie: null, remises: 0, derniere_remise: null });

  // (2) Critères d'éligibilité typés (lot 1).
  const crit = await db.query(
    `SELECT ee.employee_id, ee.critere_code, c.libelle
     FROM employee_eligibilite ee
     LEFT JOIN insertion_eligibilite_criteres c ON c.code = ee.critere_code
     WHERE ee.employee_id = ANY($1::int[]) ORDER BY c.ordre NULLS LAST, ee.critere_code`,
    [ids]
  );
  for (const r of crit.rows) ctx.get(r.employee_id)?.criteres.push({ code: r.critere_code, libelle: r.libelle || r.critere_code });

  // (3) Diagnostic du parcours COURANT (un parcours = un jeu de données).
  const diag = await db.query(
    `SELECT d.employee_id, d.statut_saisie, d.fse_entree, d.fse_entree_complet, d.fse_entree_saisie_at, d.updated_at
     FROM insertion_diagnostics d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.employee_id = ANY($1::int[]) AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)`,
    [ids]
  );
  for (const r of diag.rows) { const c = ctx.get(r.employee_id); if (c) c.diagnostic = r; }

  // (4) Sortie FSE+ du parcours courant.
  const sor = await db.query(
    `SELECT s.* FROM insertion_fse_sorties s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.employee_id = ANY($1::int[]) AND s.parcours_num = COALESCE(e.parcours_num, 1)`,
    [ids]
  );
  for (const r of sor.rows) { const c = ctx.get(r.employee_id); if (c) c.sortie = r; }

  // (5) Remises d'exemplaire tracées (`remise_salarie` posé par le PDF salarié).
  const rem = await db.query(
    `SELECT employee_id, COUNT(*)::int AS nb, MAX(COALESCE(completed_date, due_date)) AS derniere
     FROM insertion_milestones
     WHERE employee_id = ANY($1::int[]) AND remise_salarie IS NOT NULL
     GROUP BY employee_id`,
    [ids]
  );
  for (const r of rem.rows) { const c = ctx.get(r.employee_id); if (c) { c.remises = r.nb; c.derniere_remise = r.derniere; } }

  // (6) Rattachements aux projets cofinancés.
  const pro = await db.query(
    `SELECT pp.employee_id, pp.projet_id, pp.date_entree, pp.date_sortie, pr.code, pr.nom, pr.type
     FROM insertion_projet_participants pp
     JOIN insertion_projets pr ON pr.id = pp.projet_id
     WHERE pp.employee_id = ANY($1::int[]) ORDER BY pp.date_entree`,
    [ids]
  );
  for (const [, c] of ctx) c.projets = [];
  for (const r of pro.rows) ctx.get(r.employee_id)?.projets.push(r);

  return ctx;
}

/**
 * Compose les 9 pièces — FONCTION PURE (aucune E/S), testable seule.
 * @param {object} ctx sortie de chargerContextes
 * @param {object} reglages { today, delaiDiagnosticJours, postSortieMois }
 */
function composerPieces(ctx, reglages = {}) {
  const today = jour(reglages.today || new Date());
  const delaiDiag = reglages.delaiDiagnosticJours || 30;
  const postSortieMois = reglages.postSortieMois || 6;
  const e = ctx.employee || {};
  const d = ctx.diagnostic;
  const s = ctx.sortie;

  // « Parcours ouvert » : la personne est encore accompagnée. Les pièces de
  // sortie lui sont SANS OBJET tant que ni le parcours ni le contrat ne sont
  // terminés — et non « à faire », qui se lirait comme un retard.
  const contratFini = e.contract_end && joursEntre(e.contract_end, today) > 0;
  const parcoursFini = ['termine', 'abandon'].includes(e.insertion_status);
  const sortieAttendue = parcoursFini || contratFini || !!s;

  const pieces = [];

  // 1. Éligibilité IAE — référencée, jamais recopiée (amendement lot 1.4).
  {
    const n = (ctx.criteres || []).length;
    const texteLegacy = !estVide(e.eligibilite_criteres);
    const verifiee = !!e.eligibilite_verifiee_le;
    let etat = 'a_faire'; let detail = 'aucun critère coché';
    if (n > 0 || texteLegacy) {
      const libelle = n > 0 ? `${n} critère${n > 1 ? 's' : ''}` : 'critères saisis en texte libre';
      etat = verifiee ? 'complet' : 'partiel';
      detail = verifiee ? `${libelle} · vérifiée le ${frDate(e.eligibilite_verifiee_le)}` : `${libelle} · date de vérification manquante`;
    }
    pieces.push({ cle: 'eligibilite', libelle: 'Éligibilité IAE référencée', etat, detail, lien: 'dossier#eligibilite' });
  }

  // 2. Pass IAE — sans numéro, AUCUNE alerte d'échéance n'est calculable.
  {
    let etat = 'a_faire'; let detail = 'numéro absent';
    if (e.pass_iae_number) {
      const statut = e.pass_iae_statut || 'inconnu';
      const fin = e.pass_iae_end ? ` · fin ${frDate(e.pass_iae_end)}` : ' · date de fin manquante';
      if (statut === 'expire') { etat = 'a_faire'; detail = `expiré${fin}`; }
      else if (statut === 'inconnu' || !e.pass_iae_end) { etat = 'partiel'; detail = `statut ${statut}${fin}`; }
      else { etat = 'complet'; detail = `${statut}${fin}`; }
    }
    pieces.push({ cle: 'pass_iae', libelle: 'Pass IAE', etat, detail, echeance: e.pass_iae_end || null, lien: 'dossier#pass-iae' });
  }

  // 3. Référent unique — « non déterminé » est un SIGNALEMENT (la structure
  // n'est pas référente : elle doit savoir à qui elle parle).
  {
    const t = e.referent_unique_type;
    const connu = t && t !== 'non_determine';
    pieces.push({
      cle: 'referent_unique',
      libelle: 'Référent unique',
      etat: connu ? 'complet' : 'a_faire',
      detail: connu ? (e.referent_unique_nom || t) : 'non déterminé',
      lien: 'dossier#referent',
    });
  }

  // 4. Questionnaire FSE+ d'entrée.
  {
    const c = completude(d ? d.fse_entree : null, FSE_ENTREE_ITEMS);
    let etat = 'a_faire';
    if (c.complet || (d && d.fse_entree_complet)) etat = 'complet';
    else if (c.renseignes > 0) etat = 'partiel';
    const saisi = d && d.fse_entree_saisie_at ? ` · saisi le ${frDate(d.fse_entree_saisie_at)}` : '';
    let echeance = null;
    if (e.insertion_start_date) {
      const ech = new Date(e.insertion_start_date); ech.setDate(ech.getDate() + delaiDiag); echeance = jour(ech);
    }
    const attendu = etat !== 'complet' && echeance ? ` · attendu avant le ${frDate(echeance)}` : '';
    pieces.push({
      cle: 'fse_entree',
      libelle: "Questionnaire FSE+ d'entrée",
      etat,
      detail: `${c.renseignes}/${c.total} items${saisi}${attendu}`,
      echeance,
      lien: 'diagnostic#fse',
    });
  }

  // 5. Socle du diagnostic d'accueil.
  {
    let etat = 'a_faire'; let detail = 'non commencé';
    if (d) {
      etat = d.statut_saisie === 'complet' ? 'complet' : 'partiel';
      detail = d.statut_saisie === 'complet'
        ? `${SOCLE_RUBRIQUES}/${SOCLE_RUBRIQUES} rubriques${d.updated_at ? ` · ${frDate(d.updated_at)}` : ''}`
        : 'saisie en cours';
    }
    pieces.push({ cle: 'diagnostic_socle', libelle: "Diagnostic d'accueil (socle)", etat, detail, lien: 'diagnostic' });
  }

  // 6. Questionnaire FSE+ de sortie.
  {
    let etat; let detail;
    if (!sortieAttendue) { etat = 'sans_objet'; detail = 'parcours en cours'; }
    else if (s) { etat = 'complet'; detail = `sortie du ${frDate(s.date_sortie)}${s.source === 'sans_bilan' ? ' (saisie sans bilan)' : ''}`; }
    else { etat = 'a_faire'; detail = 'sortie non renseignée'; }
    pieces.push({ cle: 'fse_sortie', libelle: 'Questionnaire FSE+ de sortie', etat, detail, lien: 'dossier#fse-sortie' });
  }

  // 7. Délai de saisie de la sortie (« dans le mois » — F7).
  {
    let etat; let detail;
    if (!s) {
      if (!sortieAttendue) { etat = 'sans_objet'; detail = 'parcours en cours'; }
      else {
        const retard = e.contract_end ? joursEntre(e.contract_end, today) : null;
        etat = 'a_faire';
        detail = retard != null ? `fin de contrat il y a ${retard} jour(s), sortie non saisie` : 'sortie non saisie';
      }
    } else {
      // Même base que la colonne 26 de l'export (règle dictée) : la sortie de
      // l'opération. Compter depuis la fin de contrat donnerait ici un délai
      // conforme et, dans le fichier remis à l'autorité, un délai hors délai.
      const delai = joursEntre(s.date_sortie, s.saisie_at);
      etat = delai <= DELAI_SAISIE_SORTIE_JOURS ? 'complet' : 'partiel';
      detail = `saisie le ${frDate(s.saisie_at)} · ${delai} jour(s) après la sortie`;
    }
    pieces.push({ cle: 'sortie_delai', libelle: `Statut de sortie saisi dans le mois`, etat, detail, lien: 'dossier#fse-sortie' });
  }

  // 8. Relevé à +6 mois — non exigible avant l'échéance.
  {
    let etat; let detail; let echeance = null;
    if (!s) { etat = 'sans_objet'; detail = sortieAttendue ? 'sortie à saisir d’abord' : 'parcours en cours'; }
    else {
      const ech = new Date(s.date_sortie); ech.setMonth(ech.getMonth() + postSortieMois); echeance = jour(ech);
      if (s.situation_6mois) {
        etat = 'complet';
        detail = `relevé le ${frDate(s.date_releve_6mois)}`;
      } else if (joursEntre(echeance, today) >= 0) {
        etat = 'a_faire';
        detail = `échu depuis le ${frDate(echeance)}`;
      } else {
        etat = 'sans_objet';
        detail = `attendu le ${frDate(echeance)}`;
      }
    }
    pieces.push({ cle: 'six_mois', libelle: 'Suivi à +6 mois', etat, detail, echeance, lien: 'dossier#six-mois' });
  }

  // 9. Remise des documents tracée (co-construction : l'exemplaire remis à la
  // personne fait partie du dossier — RES-03).
  {
    const n = ctx.remises || 0;
    pieces.push({
      cle: 'remise_documents',
      libelle: 'Remise des documents tracée',
      etat: n > 0 ? 'complet' : 'a_faire',
      detail: n > 0 ? `${n} remise${n > 1 ? 's' : ''}${ctx.derniere_remise ? ` · dernière le ${frDate(ctx.derniere_remise)}` : ''}` : 'aucune remise',
      lien: 'suivi',
    });
  }

  // Ordre imposé par le contrat (la maquette se lit de haut en bas).
  pieces.sort((a, b) => PIECES_ORDRE.indexOf(a.cle) - PIECES_ORDRE.indexOf(b.cle));
  return pieces;
}

/** Dossier de conformité d'UN salarié. */
async function dossierConformite(employeeId, { db = pool, reglages = null } = {}) {
  const ctxs = await chargerContextes(db, [employeeId]);
  const ctx = ctxs.get(parseInt(employeeId, 10));
  if (!ctx) return null;
  const r = reglages || await lireReglages();
  const pieces = composerPieces(ctx, r);
  const aFaire = pieces.filter((p) => p.etat === 'a_faire');
  return {
    employee_id: ctx.employee.id,
    nom: ctx.employee.last_name,
    prenom: ctx.employee.first_name,
    statut_parcours: ctx.employee.insertion_status,
    contract_end: ctx.employee.contract_end,
    projets: ctx.projets || [],
    pieces,
    nb_a_faire: aFaire.length,
    // « Complet » = aucune pièce à faire. Une pièce « partielle » (date de
    // vérification manquante, sortie saisie hors délai) n'est pas bloquante
    // mais elle empêche le dossier d'être déclaré complet : c'est ce que
    // l'autorité contrôle.
    complet: pieces.every((p) => ['complet', 'sans_objet'].includes(p.etat)),
  };
}

/** Réglages lus une seule fois par écran (les deux servent au calcul d'échéance). */
async function lireReglages() {
  const [delaiDiagnosticJours, postSortieMois] = await Promise.all([
    readInsertionSetting('insertion.delai_diagnostic_jours'),
    readInsertionSetting('insertion.post_sortie_mois'),
  ]);
  return { today: new Date(), delaiDiagnosticJours, postSortieMois };
}

/** Bornes d'une période « AAAA-Tn » (trimestre). `null` si le libellé est illisible. */
function bornesPeriode(periode) {
  const m = /^(\d{4})-T([1-4])$/.exec(String(periode || '').trim().toUpperCase());
  if (!m) return null;
  const annee = parseInt(m[1], 10); const t = parseInt(m[2], 10);
  const debut = `${annee}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`;
  const fin = t === 4 ? `${annee + 1}-01-01` : `${annee}-${String(t * 3 + 1).padStart(2, '0')}-01`;
  return { debut, fin, annee, trimestre: t };
}

/**
 * Conformité de TOUS les participants d'un projet sur une période.
 * Période absente ou illisible → tous les participants (jamais un écran vide
 * parce qu'un libellé de trimestre a été mal formé).
 */
async function conformiteProjet(projetId, periode, { db = pool } = {}) {
  const pr = await db.query('SELECT * FROM insertion_projets WHERE id = $1', [projetId]);
  if (pr.rows.length === 0) return null;
  const bornes = bornesPeriode(periode);

  const params = [projetId];
  let filtre = '';
  if (bornes) {
    // Participant « de la période » : entré avant la fin, pas sorti avant le début.
    params.push(bornes.fin, bornes.debut);
    filtre = ` AND pp.date_entree < $2::date AND (pp.date_sortie IS NULL OR pp.date_sortie >= $3::date)`;
  }
  const parts = await db.query(
    `SELECT pp.employee_id, pp.date_entree, pp.date_sortie
     FROM insertion_projet_participants pp
     WHERE pp.projet_id = $1${filtre}
     ORDER BY pp.date_entree`,
    params
  );

  const ids = parts.rows.map((r) => r.employee_id);
  const ctxs = await chargerContextes(db, ids);
  const reglages = await lireReglages();

  const participants = [];
  for (const p of parts.rows) {
    const ctx = ctxs.get(p.employee_id);
    if (!ctx) continue;
    const pieces = composerPieces(ctx, reglages);
    const aFaire = pieces.filter((x) => x.etat === 'a_faire');
    participants.push({
      employee_id: ctx.employee.id,
      nom: ctx.employee.last_name,
      prenom: ctx.employee.first_name,
      statut_parcours: ctx.employee.insertion_status,
      contract_end: ctx.employee.contract_end,
      date_entree_projet: p.date_entree,
      date_sortie_projet: p.date_sortie,
      pieces: Object.fromEntries(pieces.map((x) => [x.cle, x.etat])),
      details: Object.fromEntries(pieces.map((x) => [x.cle, x.detail])),
      a_faire: aFaire.map((x) => x.libelle),
    });
  }

  const nbComplets = participants.filter((p) => p.a_faire.length === 0).length;
  return {
    projet: pr.rows[0],
    periode: bornes ? `${bornes.annee}-T${bornes.trimestre}` : null,
    participants,
    nb_total: participants.length,
    nb_complets: nbComplets,
    // Aucun participant → null et non 0 % : un taux de 0 % se lirait comme un
    // échec alors qu'il n'y a rien à mesurer (« jamais de valeur inventée »).
    taux_completude: participants.length === 0 ? null : Math.round((nbComplets / participants.length) * 100),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Job scheduler : sorties FSE+ non renseignées (J+15 puis J+25)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Deux rappels, et non un seul : la situation de sortie se recueille AUPRÈS DE
 * LA PERSONNE, et la fenêtre où elle répond encore au téléphone se referme vite.
 * Passé un mois, la donnée ne se rattrape plus — c'est la seule exigence de la
 * PR A dont le retard soit irrattrapable (07 § 0).
 *
 * Signature imposée par le contrat § 6.3 (le lot 0 l'enregistre dans le
 * scheduler) : `async () => ({ crees, verifies })`.
 */
async function checkFseSortiesNonRenseignees(db = pool) {
  let crees = 0; let verifies = 0;
  try {
    const [j1, j2] = await Promise.all([
      readInsertionSetting('insertion.alerte_sortie_fse_j1'),
      readInsertionSetting('insertion.alerte_sortie_fse_j2'),
    ]);
    const seuil1 = Number(j1) > 0 ? Number(j1) : 15;
    const seuil2 = Number(j2) > 0 ? Number(j2) : 25;

    const rows = await db.query(
      `SELECT DISTINCT e.id, e.first_name, e.last_name, e.contract_end,
              (CURRENT_DATE - e.contract_end) AS jours
       FROM employees e
       JOIN insertion_projet_participants pp ON pp.employee_id = e.id
       JOIN insertion_projets pr ON pr.id = pp.projet_id AND pr.type = 'asi'
       WHERE e.contract_end IS NOT NULL
         -- Soustraction de DATES (nombre de jours entiers), et non comparaison
         -- a un intervalle : contract_end < CURRENT_DATE - '15 days' compare
         -- deux instants de minuit et n'est donc vrai qu'au SEIZIEME jour.
         -- L'ecran d'alertes (routes.js, fse_sortie_a_saisir) lit deja
         -- jours >= seuil : les deux implementations de la meme regle
         -- divergeaient d'un jour, celle qui laisse une trace etant la plus
         -- tardive. Preuve : tests/e2e-pr-a/pr-a-fse-e2e.test.js.
         AND (CURRENT_DATE - e.contract_end) >= $1::int
         AND NOT EXISTS (
           SELECT 1 FROM insertion_fse_sorties s
           WHERE s.employee_id = e.id AND s.parcours_num = COALESCE(e.parcours_num, 1)
         )`,
      [seuil1]
    );

    for (const r of rows.rows) {
      verifies += 1;
      const alertType = r.jours >= seuil2 ? 'fse_sortie_j25' : 'fse_sortie_j15';
      const targetDate = jour(r.contract_end);
      // Anti-doublon : une alerte par (salarié, type, date cible). Le passage de
      // J+15 à J+25 crée donc UNE seconde alerte, pas une répétition quotidienne.
      const exist = await db.query(
        `SELECT id FROM insertion_interview_alerts
         WHERE employee_id = $1 AND milestone_type = 'fse_sortie' AND alert_type = $2 AND target_date = $3`,
        [r.id, alertType, targetDate]
      );
      if (exist.rows.length > 0) continue;
      await db.query(
        `INSERT INTO insertion_interview_alerts (employee_id, milestone_type, alert_type, target_date)
         VALUES ($1, 'fse_sortie', $2, $3)`,
        [r.id, alertType, targetDate]
      );
      crees += 1;
      console.log(`[SCHEDULER] Sortie FSE+ non renseignée (${alertType}) — ${r.first_name} ${r.last_name}`);
    }
  } catch (err) {
    // Un job qui échoue ne doit pas abattre le tour de scheduler ; l'erreur est
    // nommée dans le journal et le compteur reste honnête (ce qui a été créé
    // avant l'échec est renvoyé tel quel).
    console.error('[SCHEDULER] Erreur checkFseSortiesNonRenseignees :', err.message);
  }
  return { crees, verifies };
}

module.exports = {
  DELAI_SAISIE_SORTIE_JOURS,
  PIECES_ORDRE,
  enregistrerSortie,
  enregistrerSixMois,
  dossierConformite,
  conformiteProjet,
  chargerContextes,
  composerPieces,
  bornesPeriode,
  situationDepuisClassification,
  checkFseSortiesNonRenseignees,
  journaliser,
};
