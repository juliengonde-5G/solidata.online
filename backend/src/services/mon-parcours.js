/**
 * « Mon parcours en une page » et « Mon Récap » — PR C, lot 7.
 *
 * ═══ POURQUOI CE MODULE EXISTE ════════════════════════════════════════════
 * Tout ce que l'outil produit jusqu'ici est écrit POUR quelqu'un d'autre : la
 * CIP, l'encadrant, le référent unique, le financeur. La personne accompagnée,
 * elle, repart d'un entretien avec ce qu'elle a retenu. Ces deux documents sont
 * les premiers qui lui soient destinés :
 *
 *  - « MON PARCOURS EN UNE PAGE » : ce qui l'engage, ce qui engage la structure,
 *    ses heures de la semaine, son prochain rendez-vous, son référent, les
 *    documents qu'on lui a remis. Une page, des phrases courtes, du vouvoiement.
 *
 *  - « MON RÉCAP » : les étapes datées de son parcours, qu'elle peut montrer à
 *    qui elle veut — un employeur, un travailleur social, sa famille. C'est ce
 *    qui en fait le document le plus contraint des deux : il PART de la
 *    structure sans qu'on sache où il va.
 *
 * ═══ LA RÈGLE QUI GOUVERNE TOUT LE FICHIER : LISTE BLANCHE ════════════════
 * Les deux documents sont composés champ par champ. Une liste NOIRE (« tout le
 * dossier sauf la santé ») laisserait passer le prochain champ ajouté au
 * diagnostic — et sur un document que la personne peut remettre à un tiers, la
 * première fuite est la dernière. Sont donc structurellement ABSENTS, sans
 * aucune clé et SANS MENTION de leur absence (dire « rubrique retirée »
 * désignerait la personne comme ayant quelque chose à cacher) :
 *   santé et judiciaire (art. 9 et 10), niveaux de freins, statut BRSA,
 *   catégorie France Travail, notes de suivi, note de profil initial, et
 *   TOUT texte libre écrit par la CIP (observations, bilans, commentaires,
 *   motifs d'absence, avis).
 *
 * Trois conséquences tenues jusqu'au bout :
 *  - une étape du récapitulatif porte le LIBELLÉ DE SON TYPE (liste fermée) et
 *    jamais le `titre` saisi par la conseillère. La revue de sécurité de la
 *    PR B a trouvé exactement ce défaut sur le relevé transmis au CMS : un
 *    entretien intitulé « Bilan après l'hospitalisation » y sortait tel quel ;
 *  - une action d'accompagnement est décrite par sa CATÉGORIE et son
 *    partenaire, jamais par son libellé libre ; et une action rattachée au
 *    frein santé ou judiciaire est retirée LIGNE ENTIÈRE (masquer le seul
 *    libellé laisserait la date et le partenaire, de quoi reconstituer) ;
 *  - le type de sortie est traduit par un dictionnaire fermé : la colonne est
 *    un VARCHAR libre, une valeur inconnue devient `null` plutôt que d'être
 *    recopiée sur un document destiné à circuler.
 *
 * ═══ LES HEURES, SANS SEUIL ═══════════════════════════════════════════════
 * « Mon parcours » affiche les heures de la dernière semaine RELEVÉE. Pas de
 * cible, pas de plancher, pas d'alerte, et le mot « seuil » n'apparaît nulle
 * part (décision 4, amendement de la CIP) : les 15 h hebdomadaires du cadre RSA
 * sont un indicateur que la structure transmet au référent, pas une obligation
 * qu'elle oppose à la personne — d'autant qu'une quotité contractuelle de 26 h
 * n'a rien à voir avec la présence d'une semaine donnée. Aucun relevé → `null`,
 * jamais zéro heure.
 */

'use strict';

const pool = require('../config/database');
const { MILESTONE_TYPE_LABELS_ALL } = require('../routes/insertion/engine');
const { FREINS } = require('../routes/insertion/freins-registry');
const { activiteHebdo } = require('./activite-hebdo');
const { isoDate, heureMurale, aujourdhuiParis } = require('../utils/date-iso');
const { readInsertionSetting } = require('../utils/insertion-settings');

/** Nom de la structure — un seul endroit, les deux documents le portent. */
const STRUCTURE_NOM = 'Solidarité Textiles';
const STRUCTURE_ACTIVITE = 'collecte, tri et valorisation de textiles';

/**
 * Freins dont une action rattachée est retirée LIGNE ENTIÈRE (art. 9 / art. 10).
 * Lus du registre plutôt que recopiés : un dixième frein sensible ajouté demain
 * est exclu sans que personne n'ait à y penser.
 */
const FREINS_EXCLUS = FREINS.filter((f) => f.sensible != null).map((f) => f.key);

/** Libellés d'entretien — liste FERMÉE de `engine.js`, jamais le titre saisi. */
const TYPE_ENTRETIEN_LABELS = { ...MILESTONE_TYPE_LABELS_ALL };

/**
 * Libellés d'entretien du RÉCAP — le document que la personne peut remettre à
 * un employeur (correctif M-10).
 *
 * Deux types de la PR B disent, à eux seuls, quelque chose de la SITUATION
 * SOCIALE de la personne : « Entretien de conciliation (protection des droits) »
 * est la procédure contradictoire qui précède une décision défavorable dans le
 * cadre RSA, et « Point avec le référent » suppose un référent unique. Sur un
 * document qui circule, une ligne datée suffit à faire comprendre qu'il y a eu
 * litige — et à contredire la mention de pied de page qui promet l'absence de
 * situation sociale. Les deux sont donc regroupés sous le libellé générique.
 *
 * Ils restent NOMMÉS dans « Mon parcours en une page », qui ne circule pas.
 * Neutralisation réversible : réglage `insertion.recap_neutralise`.
 */
const TYPE_ENTRETIEN_LABELS_RECAP = {
  ...TYPE_ENTRETIEN_LABELS,
  point_etape_referent: 'Entretien d\'accompagnement',
  conciliation: 'Entretien d\'accompagnement',
};

/**
 * Catégories d'action — liste fermée, MIROIR COMPLET du CHECK de
 * `cip_action_plans.category` (six valeurs depuis la PR A).
 *
 * CORRECTIF D-07 : `job_dating` et `formation` manquaient. « Mon parcours en
 * une page » filtre les lignes dont le libellé est nul : une action de
 * formation ou une rencontre avec des employeurs DISPARAISSAIT du document —
 * c'est-à-dire l'engagement le plus concret que la structure puisse montrer à
 * la personne. Un test compare ce dictionnaire au CHECK : une septième
 * catégorie ajoutée demain fera tomber la suite plutôt que de s'effacer en
 * silence.
 */
const CATEGORIE_ACTION_LABELS = {
  competence: 'Développement des compétences',
  insertion: 'Recherche d\'emploi et insertion',
  socialisation: 'Vie sociale et quotidien',
  frein: 'Levée d\'une difficulté',
  job_dating: 'Rencontre avec des employeurs',
  formation: 'Formation',
};

/** Objet d'une PMSMP — liste fermée (CHECK de `insertion_pmsmp.objet`). */
const OBJET_PMSMP_LABELS = {
  decouvrir_metier: 'Découverte d\'un métier',
  confirmer_projet: 'Confirmation du projet',
  initier_recrutement: 'En vue d\'un recrutement',
};

/** Filières des évaluations de compétences — liste fermée. */
const FILIERE_LABELS = {
  tri: 'Tri', collecte: 'Collecte', logistique: 'Logistique',
  boutique: 'Boutique', transverse: 'Transverse',
};

/** Classification de sortie — liste fermée (miroir du front `SORTIE_CLASS_LABELS`). */
const SORTIE_CLASS_LABELS = {
  emploi_durable: 'Emploi durable',
  emploi_transition: 'Emploi de transition',
  sortie_positive: 'Sortie positive',
  autre: 'Autre sortie',
  // Valeurs historiques d'avant la refonte en quatre catégories (PR 1).
  positive: 'Sortie positive',
  negative: 'Autre sortie',
};

/**
 * Types de sortie — liste FERMÉE. La colonne `sortie_type` est un VARCHAR(50)
 * sans contrainte : une valeur hors liste devient `null` (jamais recopiée) sur
 * un document que la personne peut remettre à un employeur.
 */
const SORTIE_TYPE_LABELS = {
  CDI: 'CDI',
  CDD: 'CDD de plus de 6 mois',
  CDD_court: 'CDD de moins de 6 mois',
  interim: 'Intérim',
  formation: 'Formation qualifiante',
  creation_activite: 'Création d\'activité',
  autre_IAE: 'Autre structure d\'insertion',
  sans_suite: 'Sans suite',
  fin_contrat: 'Fin de contrat',
};

/** Référent unique — libellés destinés à la personne (liste fermée). */
const REFERENT_TYPE_LABELS = {
  cms: 'Centre médico-social du Département',
  france_travail: 'France Travail',
  structure: STRUCTURE_NOM,
  autre: 'Organisme partenaire',
};

/** Pièces remises — libellés des types de `insertion_pieces` (liste fermée). */
const PIECE_TYPE_LABELS = {
  entretien_signe: 'Compte rendu d\'entretien signé',
  convention_pmsmp: 'Convention de stage en entreprise (PMSMP)',
  accuse_remise: 'Accusé de remise',
  autre: 'Document remis',
};

/** Documents composés pour la personne — libellés de leur type. */
const DOC_SALARIE_LABELS = {
  mon_parcours: 'Mon parcours en une page',
  mon_recap: 'Mon Récap',
};

/** Longueur maximale d'un titre d'engagement repris tel quel sur le document. */
const TITRE_MAX = 120;

/**
 * Clés interdites — la preuve, sous forme vérifiable, que les deux documents
 * n'en portent aucune. Le test de contrat sérialise chaque document et cherche
 * ces motifs dans le JSON complet (clés ET valeurs de clé imbriquées).
 */
const CLES_INTERDITES = [
  'frein_', 'sante', 'judiciaire', 'brsa', 'ft_categorie', 'note', 'observations',
  'commentaire', 'motif', 'presence', 'absence', 'bilan_', 'avis_', 'description',
];

/** Clés de premier niveau de chaque document — la liste blanche, vérifiable. */
const MON_PARCOURS_CLES = [
  'personne', 'structure', 'mes_engagements', 'engagements_structure',
  'mes_heures_semaine', 'prochain_rdv', 'mon_referent', 'mes_documents_remis', 'genere_le',
];
const MON_RECAP_CLES = [
  'personne', 'structure', 'contrats', 'etapes', 'objectifs', 'sortie', 'genere_le',
];

/**
 * Lecture tolérante : une table absente rend [] et le dit au journal serveur.
 * Contrairement à la fiche pour le référent, la dégradation n'est PAS reportée
 * dans le document : sur une page destinée à la personne, une mention
 * « rubrique indisponible » n'a aucun destinataire capable d'agir dessus. Elle
 * reste dans le journal serveur, où la CIP et l'exploitant la trouvent.
 */
async function soft(label, text, params = []) {
  try {
    const r = await pool.query(text, params);
    return r.rows;
  } catch (err) {
    console.error(`[INSERTION][SALARIE] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
    return [];
  }
}

/** Prénom + initiale du nom — jamais le nom complet d'un professionnel. */
function prenomInitiale(prenom, nom) {
  const p = String(prenom || '').trim();
  const n = String(nom || '').trim();
  if (!p && !n) return null;
  if (!n) return p;
  return `${p} ${n.charAt(0).toUpperCase()}.`.trim();
}

/** Tronque un texte co-construit avec la personne, sans couper un mot en deux. */
function tronquer(v, max = TITRE_MAX) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const coupe = s.slice(0, max);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}

/** Arrondi à 2 décimales — `null` reste `null` (jamais 0 par accident). */
const round2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

/**
 * Heure 'HH:MM' d'un rendez-vous. `null` si l'heure n'est pas connue.
 *
 * CORRECTIF D-01 : `interview_date` est un `TIMESTAMP WITHOUT TIME ZONE` qui
 * porte DÉJÀ l'heure murale de Paris (le formulaire saisit un
 * `<input type="datetime-local">`, la route l'écrit telle quelle). La convertir
 * « vers Paris » lui ajoutait l'offset une seconde fois : le document que la
 * personne garde dans sa poche annonçait **16:00 pour un rendez-vous de 14:00**.
 * On lit donc la valeur telle qu'elle est — ici en repli, la requête la
 * demandant désormais à PostgreSQL (`to_char`).
 */
const heureRdv = heureMurale;

/** En-tête commun : identité de la personne. `null` si elle n'existe pas. */
async function lireSalarie(employeeId) {
  const r = await soft('salarie',
    `SELECT e.id, e.first_name, e.last_name, COALESCE(e.parcours_num, 1) AS parcours_num,
            e.insertion_status, e.insertion_start_date, e.insertion_end_date,
            e.referent_unique_type, e.referent_unique_nom, e.referent_unique_contact,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS cip_nom_complet,
            u.first_name AS cip_prenom, u.last_name AS cip_nom
       FROM employees e
       LEFT JOIN users u ON u.id = e.cip_referent_user_id
      WHERE e.id = $1`,
    [employeeId]);
  return r[0] || null;
}

/**
 * Heures de la DERNIÈRE SEMAINE RELEVÉE.
 *
 * Le moteur d'activité raisonne par année ISO. On interroge l'année courante ;
 * si elle ne porte aucun relevé (cas d'un mois de janvier, ou d'un import de
 * paie en retard), on regarde l'année précédente — sans quoi le document
 * afficherait « pas encore renseigné » alors que la dernière semaine connue est
 * à quelques jours. Rien de trouvé → `null`, jamais zéro heure.
 */
async function lireHeuresSemaine(employeeId) {
  const jour = aujourdhuiParis();
  const anneeCourante = Number(String(jour).slice(0, 4));
  for (const annee of [anneeCourante, anneeCourante - 1]) {
    let activite;
    try {
      activite = await activiteHebdo({ employeeId, annee });
    } catch (err) {
      console.error(`[INSERTION][SALARIE] Activité ${annee} illisible : ${err.message}`);
      return null;
    }
    const relevees = (activite.semaines || [])
      .filter((s) => s.sans_releve !== true && s.week_start && s.week_start <= jour);
    if (relevees.length === 0) continue;
    const s = relevees[relevees.length - 1];
    return {
      // Forme ISO « 2026-W37 » : une semaine se nomme par son année ISO, pas
      // par l'année civile — la S1 commence parfois en décembre.
      semaine: `${s.iso_year}-W${String(s.iso_week).padStart(2, '0')}`,
      travail_h: round2(s.heures_travail),
      accompagnement_h: round2((Number(s.minutes_accompagnement) || 0) / 60),
      total_h: round2(s.total_heures),
    };
  }
  return null;
}

/**
 * Compose « Mon parcours en une page ».
 * @param {object} p { employeeId }
 * @returns {Promise<object|null>} `null` si le salarié n'existe pas
 */
async function composerMonParcours({ employeeId }) {
  const id = Number(employeeId);
  const emp = await lireSalarie(id);
  if (!emp) return null;

  const [engagements, actions, heures, prochain, pieces, alimentations, documents] = await Promise.all([
    // Les engagements de la personne : ses objectifs À ELLE (origine 'salarie'),
    // pas ceux que la conseillère a posés — c'est la distinction que porte la
    // colonne `origine` depuis la PR 1, et elle prend tout son sens ici.
    soft('engagements',
      `SELECT titre, echeance
         FROM insertion_objectifs
        WHERE employee_id = $1 AND origine = 'salarie' AND statut IN ('a_venir', 'en_cours')
        ORDER BY COALESCE(echeance, '9999-12-31'::date), ordre, id
        LIMIT 8`, [id]),
    // Ce que la structure s'engage à faire. CATÉGORIE et partenaire, jamais le
    // libellé libre ; les actions rattachées à un frein sensible sont écartées
    // en SQL (la ligne ne remonte même pas jusqu'ici).
    soft('actions',
      `SELECT a.category, a.echeance, p.nom AS partenaire_nom
         FROM cip_action_plans a
         LEFT JOIN insertion_partenaires p ON p.id = a.partenaire_id
        WHERE a.employee_id = $1 AND a.status IN ('a_faire', 'en_cours')
          AND (a.frein_type IS NULL OR NOT (a.frein_type = ANY($2::text[])))
        ORDER BY COALESCE(a.echeance, '9999-12-31'::date), a.id
        LIMIT 8`, [id, FREINS_EXCLUS]),
    lireHeuresSemaine(id),
    // Prochain rendez-vous : la date, l'heure, et AVEC QUI. Jamais le type —
    // « Bilan de sortie » sur une page qu'on garde dans sa poche annonce une
    // fin de contrat à quiconque la lit par-dessus l'épaule.
    soft('prochain_rdv',
      `SELECT m.interview_date, m.due_date,
              to_char(m.interview_date, 'YYYY-MM-DD') AS rdv_jour,
              to_char(m.interview_date, 'HH24:MI') AS rdv_heure,
              u.first_name AS int_prenom, u.last_name AS int_nom
         FROM insertion_milestones m
         LEFT JOIN users u ON u.id = m.interviewer_id
        WHERE m.employee_id = $1 AND m.status = 'planifie'
          AND COALESCE(m.interview_date::date, m.due_date) >= CURRENT_DATE
        ORDER BY COALESCE(m.interview_date::date, m.due_date), m.id
        LIMIT 1`, [id]),
    soft('pieces',
      `SELECT type, created_at
         FROM insertion_pieces
        WHERE employee_id = $1 AND type IN ('entretien_signe', 'convention_pmsmp', 'accuse_remise')
        ORDER BY created_at DESC
        LIMIT 10`, [id]),
    soft('alimentations',
      `SELECT remis_salarie_le
         FROM insertion_alimentations_referent
        WHERE employee_id = $1 AND remis_salarie_le IS NOT NULL
        ORDER BY remis_salarie_le DESC
        LIMIT 5`, [id]),
    soft('documents_salarie',
      `SELECT type, remis_le
         FROM insertion_documents_salarie
        WHERE employee_id = $1 AND remis_le IS NOT NULL
        ORDER BY remis_le DESC
        LIMIT 5`, [id]),
  ]);

  const rdv = prochain[0] || null;
  const referentType = emp.referent_unique_type;
  const referentConnu = referentType && referentType !== 'non_determine';

  const remis = [
    ...pieces.map((p) => ({ libelle: PIECE_TYPE_LABELS[p.type] || PIECE_TYPE_LABELS.autre, date: isoDate(p.created_at) })),
    ...alimentations.map((a) => ({
      libelle: 'Point de situation transmis à votre référent',
      date: isoDate(a.remis_salarie_le),
    })),
    ...documents.map((d) => ({ libelle: DOC_SALARIE_LABELS[d.type] || 'Document', date: isoDate(d.remis_le) })),
  ].filter((x) => x.libelle)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 10);

  return {
    personne: { prenom: emp.first_name || null, nom: emp.last_name || null },
    structure: {
      nom: STRUCTURE_NOM,
      cip_nom: prenomInitiale(emp.cip_prenom, emp.cip_nom),
    },
    mes_engagements: engagements
      .map((o) => ({ titre: tronquer(o.titre), echeance: isoDate(o.echeance) }))
      .filter((o) => o.titre),
    engagements_structure: actions.map((a) => ({
      categorie_libelle: CATEGORIE_ACTION_LABELS[a.category] || null,
      partenaire_nom: a.partenaire_nom || null,
      echeance: isoDate(a.echeance),
    })).filter((a) => a.categorie_libelle),
    mes_heures_semaine: heures,
    prochain_rdv: rdv
      ? {
        date: rdv.rdv_jour || isoDate(rdv.interview_date) || isoDate(rdv.due_date),
        // `null` quand seule une date d'échéance existe : le PDF écrit alors
        // « heure à confirmer », il n'invente pas un horaire.
        heure: rdv.rdv_heure || heureRdv(rdv.interview_date),
        avec: prenomInitiale(rdv.int_prenom, rdv.int_nom) || prenomInitiale(emp.cip_prenom, emp.cip_nom),
      }
      : null,
    mon_referent: referentConnu
      ? {
        type_libelle: REFERENT_TYPE_LABELS[referentType] || 'Organisme partenaire',
        nom: emp.referent_unique_nom || null,
        contact: emp.referent_unique_contact || null,
      }
      : null,
    mes_documents_remis: remis,
    genere_le: new Date().toISOString(),
  };
}

/**
 * Compose « Mon Récap » — les étapes datées du parcours.
 *
 * C'est le document que la personne peut remettre à qui elle veut. Chaque
 * libellé vient d'un dictionnaire FERMÉ ; aucun texte saisi par la conseillère
 * n'y entre, et aucun compteur n'y porte de jugement (les objectifs sont
 * comptés, jamais commentés).
 *
 * @param {object} p { employeeId }
 * @returns {Promise<object|null>} `null` si le salarié n'existe pas
 */
async function composerMonRecap({ employeeId }) {
  const id = Number(employeeId);
  const emp = await lireSalarie(id);
  if (!emp) return null;

  // Neutralisation des libellés qui « parlent » (M-10). En cas de réglage
  // illisible, on retient la valeur la plus SÛRE : neutralisé.
  const reglage = await readInsertionSetting('insertion.recap_neutralise').catch(() => true);
  const neutralise = !(reglage === false || reglage === 'false' || reglage === 0 || reglage === '0');
  const libelleEntretien = (t) => (neutralise ? TYPE_ENTRETIEN_LABELS_RECAP : TYPE_ENTRETIEN_LABELS)[t]
    || 'Entretien d\'accompagnement';

  const [contrats, entretiens, pmsmp, actions, evaluations, objectifs, sortie] = await Promise.all([
    soft('contrats',
      `SELECT ec.contract_type, ec.start_date, ec.end_date, ec.weekly_hours,
              COALESCE(ec.position_title, p.title) AS poste
         FROM employee_contracts ec
         LEFT JOIN positions p ON p.id = ec.position_id
        WHERE ec.employee_id = $1
        ORDER BY ec.start_date, ec.id`, [id]),
    // `titre` n'est PAS sélectionné : ce qu'on ne lit pas ne peut pas fuir par
    // une clé oubliée à la composition (doctrine `fiche-referent.js`).
    soft('entretiens',
      `SELECT milestone_type, completed_date
         FROM insertion_milestones
        WHERE employee_id = $1 AND status = 'realise' AND completed_date IS NOT NULL
        ORDER BY completed_date, id`, [id]),
    soft('pmsmp',
      `SELECT entreprise, objet, date_debut, date_fin
         FROM insertion_pmsmp
        WHERE employee_id = $1
        ORDER BY date_debut, id`, [id]),
    soft('actions',
      `SELECT a.category, a.date_realisation, p.nom AS partenaire_nom
         FROM cip_action_plans a
         LEFT JOIN insertion_partenaires p ON p.id = a.partenaire_id
        WHERE a.employee_id = $1 AND a.status = 'realise' AND a.date_realisation IS NOT NULL
          AND (a.frein_type IS NULL OR NOT (a.frein_type = ANY($2::text[])))
        ORDER BY a.date_realisation, a.id`, [id, FREINS_EXCLUS]),
    // Moyenne des notes, jamais les items : « 7,2/10 en tri » se lit et se
    // montre ; « communication 4/10 » est un jugement item par item qui n'a
    // aucune raison de circuler hors de l'entretien qui l'a produit.
    // Les « N/E » (non évalués) sont exclus de la moyenne, comme à l'écran.
    soft('evaluations',
      `SELECT e.id, e.filiere, e.date_evaluation,
              ROUND(AVG(s.note)::numeric, 1) AS moyenne
         FROM insertion_competence_evaluations e
         LEFT JOIN insertion_competence_scores s
                ON s.evaluation_id = e.id AND s.non_evalue = false AND s.note IS NOT NULL
        WHERE e.employee_id = $1 AND e.statut = 'valide' AND e.date_evaluation IS NOT NULL
        GROUP BY e.id, e.filiere, e.date_evaluation
        ORDER BY e.date_evaluation, e.id`, [id]),
    soft('objectifs',
      `SELECT statut, COUNT(*)::int AS n
         FROM insertion_objectifs
        WHERE employee_id = $1
        GROUP BY statut`, [id]),
    soft('sortie',
      `SELECT completed_date, sortie_classification, sortie_type
         FROM insertion_milestones
        WHERE employee_id = $1 AND milestone_type = 'bilan_sortie' AND status = 'realise'
        ORDER BY completed_date DESC NULLS LAST, id DESC
        LIMIT 1`, [id]),
  ]);

  const etapes = [
    ...entretiens.map((m) => ({
      date: isoDate(m.completed_date),
      type: 'entretien',
      libelle: libelleEntretien(m.milestone_type),
    })),
    ...pmsmp.map((p) => ({
      date: isoDate(p.date_debut),
      type: 'pmsmp',
      libelle: [
        // La raison sociale est un champ LIBRE, et le nom d'un ESAT, d'une
        // entreprise adaptée ou d'un établissement de soins révèle par
        // ricochet ce que ce document exclut par ailleurs (M-10). Elle n'est
        // donc pas imprimée tant que `insertion.recap_neutralise` est vrai ;
        // quand la direction la rétablit, elle est TRONQUÉE comme les autres
        // textes co-construits.
        neutralise || !p.entreprise
          ? 'Stage en entreprise'
          : `Stage en entreprise chez ${tronquer(p.entreprise, 60)}`,
        OBJET_PMSMP_LABELS[p.objet] || null,
        isoDate(p.date_fin) ? `jusqu'au ${isoDate(p.date_fin)}` : null,
      ].filter(Boolean).join(' — '),
    })),
    ...actions.map((a) => ({
      date: isoDate(a.date_realisation),
      type: 'action',
      libelle: [CATEGORIE_ACTION_LABELS[a.category] || 'Action d\'accompagnement',
        a.partenaire_nom ? `avec ${a.partenaire_nom}` : null].filter(Boolean).join(' — '),
    })),
    ...evaluations.map((e) => ({
      date: isoDate(e.date_evaluation),
      type: 'evaluation',
      libelle: [
        `Évaluation des compétences${e.filiere ? ` — ${FILIERE_LABELS[e.filiere] || e.filiere}` : ''}`,
        e.moyenne != null ? `moyenne ${Number(e.moyenne).toFixed(1)}/10` : null,
      ].filter(Boolean).join(' — '),
    })),
  ].filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date));

  const compte = (cles) => objectifs
    .filter((o) => cles.includes(o.statut))
    .reduce((a, o) => a + (Number(o.n) || 0), 0);

  const s = sortie[0] || null;

  return {
    personne: { prenom: emp.first_name || null, nom: emp.last_name || null },
    structure: { nom: STRUCTURE_NOM, activite: STRUCTURE_ACTIVITE },
    contrats: contrats.map((c) => ({
      type: c.contract_type || null,
      poste: c.poste || null,
      du: isoDate(c.start_date),
      au: isoDate(c.end_date),
      heures_hebdo: c.weekly_hours != null ? Number(c.weekly_hours) : null,
    })),
    etapes,
    objectifs: {
      atteints: compte(['atteint', 'partiellement_atteint']),
      en_cours: compte(['a_venir', 'en_cours']),
    },
    sortie: s && (s.sortie_classification || s.sortie_type)
      ? {
        date: isoDate(s.completed_date),
        classification_libelle: SORTIE_CLASS_LABELS[s.sortie_classification] || null,
        // Valeur hors dictionnaire → `null`. La colonne est libre ; ce document
        // ne l'est pas.
        type_libelle: SORTIE_TYPE_LABELS[s.sortie_type] || null,
      }
      : null,
    genere_le: new Date().toISOString(),
  };
}

module.exports = {
  composerMonParcours,
  composerMonRecap,
  MON_PARCOURS_CLES,
  MON_RECAP_CLES,
  CLES_INTERDITES,
  FREINS_EXCLUS,
  TYPE_ENTRETIEN_LABELS,
  TYPE_ENTRETIEN_LABELS_RECAP,
  CATEGORIE_ACTION_LABELS,
  SORTIE_CLASS_LABELS,
  SORTIE_TYPE_LABELS,
  REFERENT_TYPE_LABELS,
  PIECE_TYPE_LABELS,
  DOC_SALARIE_LABELS,
  OBJET_PMSMP_LABELS,
  FILIERE_LABELS,
  STRUCTURE_NOM,
  prenomInitiale,
  tronquer,
};
