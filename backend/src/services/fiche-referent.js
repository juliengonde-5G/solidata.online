/**
 * Fiche pour le référent et relevé d'assiduité — PR B, lot 3.
 *
 * ═══ POURQUOI CE MODULE EXISTE ════════════════════════════════════════════
 * Solidarité Textiles est **structure d'accueil**, pas référent unique
 * (décision de direction du 12/09/2026). Le contrat d'engagements réciproques
 * est tenu par un professionnel EXTÉRIEUR — travailleur social du centre
 * médico-social, conseiller France Travail. La structure ne l'écrit pas : elle
 * l'ALIMENTE. Jusqu'ici cette alimentation se faisait par téléphone et par
 * courriel, sans aucune trace de ce qui avait été dit, ni à qui, ni quand.
 *
 * ═══ LA RÈGLE QUI GOUVERNE TOUT LE FICHIER : LISTE BLANCHE ════════════════
 * `composerFicheReferent` énumère NEUF rubriques et n'en produit aucune autre.
 * Ce choix n'est pas un détail d'implémentation : une liste NOIRE (« tout le
 * dossier sauf la santé ») laisserait passer le prochain champ ajouté au
 * diagnostic, et c'est un document qui SORT de la structure vers un tiers qui
 * peut décider d'une suspension de droits.
 *
 * Deux conséquences tenues jusqu'au bout :
 *  - les freins `sante` (art. 9) et `judiciaire` (art. 10) n'ont **aucune clé**
 *    dans l'objet. Pas de valeur nulle, pas de mention « rubrique retirée » :
 *    signaler l'exclusion désignerait la personne comme ayant quelque chose à
 *    cacher, ce qui est précisément le contraire de la protection recherchée ;
 *  - les actions rattachées à l'un de ces deux freins sont retirées **ligne
 *    entière**, comme le fait déjà `masking.js` pour l'encadrement technique :
 *    masquer le seul libellé laisserait la date, le partenaire et le résultat,
 *    c'est-à-dire de quoi reconstituer.
 *
 * Le MOTIF d'absence transmis est une CATÉGORIE grossière (`sante`,
 * `administratif`, `garde`, `transport`, `autre`) : « santé » ne dit rien d'un
 * état de santé, et c'est exactement le but. Le libellé de paie
 * (`employee_leaves.leave_type`, qui peut porter « arrêt maladie — affection
 * longue durée ») ne sort JAMAIS : seule `type_category` est lue.
 *
 * Enfin : une absence **sans motif** s'imprime « motif non renseigné » et
 * jamais « injustifiée ». La structure constate qu'elle ne sait pas ; elle
 * n'accuse pas.
 */

'use strict';

const pool = require('../config/database');
const { FREINS } = require('../routes/insertion/freins-registry');
const { MILESTONE_TYPE_LABELS } = require('../routes/insertion/engine');
const { activiteHebdo } = require('./activite-hebdo');

/**
 * Libellés d'entretien pour un document destiné à un tiers.
 *
 * Les deux types de la PR B ne sont pas dans `MILESTONE_TYPE_LABELS`
 * (`routes/insertion/engine.js` appartient à un autre périmètre — voir le
 * rapport 16 § « ce qui reste ») : ils sont complétés ici, la table d'origine
 * restant la source pour les six types historiques.
 */
const TYPE_LABELS = {
  ...MILESTONE_TYPE_LABELS,
  point_etape_referent: 'Point avec le référent',
  conciliation: 'Entretien de conciliation (protection des droits)',
};

/** Axes de freins transmissibles : les 9 du registre MOINS art. 9 et art. 10. */
const FREINS_TRANSMISSIBLES = FREINS.filter((f) => f.sensible == null);

/** Freins dont une action rattachée est retirée LIGNE ENTIÈRE. */
const FREINS_EXCLUS = FREINS.filter((f) => f.sensible != null).map((f) => f.key);

/** Motifs d'absence transmissibles (miroir du CHECK de la migration FSE+). */
const MOTIFS_ABSENCE = ['sante', 'administratif', 'garde', 'transport', 'autre'];

/** Texte fixe des mentions de droits — même formulation que les PDF du module. */
const MENTION_DROITS = "Ce document est transmis au référent unique désigné par l'orienteur, dans le cadre de "
  + "l'accompagnement socio-professionnel. Il ne contient aucune donnée de santé ni aucune donnée relative à des "
  + "condamnations ou infractions. La personne concernée en reçoit un exemplaire et dispose d'un droit d'accès, de "
  + "rectification, d'effacement, de limitation et d'opposition auprès de la structure (délégué à la protection des "
  + "données : dpo@solidarite-textiles.fr).";

/**
 * Lecture tolérante : une table absente rend [] et le dit au journal serveur.
 *
 * CORRECTIF m-05 — elle le dit désormais AUSSI dans le document. Une fiche
 * pouvait partir au référent amputée de ses actions, de ses objectifs ou de ses
 * freins sans que rien ne le signale : sur ce document-là, une rubrique vide se
 * lit « rien n'a été fait », ce qui est une affirmation que personne n'a faite.
 * Le collecteur `panne` reçoit le nom de chaque source tombée ; les
 * `mentions.sources_indisponibles` le reportent en tête du PDF.
 */
async function soft(label, text, params = [], panne = null) {
  try {
    const r = await pool.query(text, params);
    return r.rows;
  } catch (err) {
    console.error(`[INSERTION][REFERENT] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
    if (panne && typeof panne.add === 'function') panne.add(label);
    return [];
  }
}

/** Libellés français des sources, pour la mention de dégradation du document. */
const LIBELLE_SOURCE = {
  entretiens: 'Rendez-vous d’accompagnement',
  actions: 'Actions d’accompagnement',
  actions_assiduite: 'Actions d’accompagnement',
  objectifs: 'Objectifs en cours',
  prochain_rdv: 'Prochaines échéances',
  freins: 'Freins périphériques',
  conges: 'Absences enregistrées par la paie',
  utilisateur: 'Signataire',
};

/** 'AAAA-MM-JJ' depuis une Date ou une chaîne ; null sinon (jamais une date inventée). */
function jour(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Date de tenue d'un entretien : ce qui s'est passé prime sur ce qui était prévu. */
const dateTenue = (m) => jour(m.completed_date) || jour(m.interview_date) || jour(m.due_date);

/** Libellé d'un type d'entretien (repli sur le code brut, jamais une chaîne vide). */
const libelleType = (t) => TYPE_LABELS[t] || t || '—';

/**
 * Entête commun : salarié, contrat en cours, référent, conseillère référente.
 * Une seule requête — le document est généré à la demande et doit rester rapide
 * même quand la CIP en édite plusieurs à la suite avant un comité.
 */
async function lireSalarie(employeeId) {
  const r = await soft('salarie',
    `SELECT e.id, e.first_name, e.last_name, e.malibou_id, e.weekly_hours,
            COALESCE(e.parcours_num, 1) AS parcours_num,
            e.pass_iae_number, e.pass_iae_start, e.pass_iae_end, e.pass_iae_statut,
            e.referent_unique_type, e.referent_unique_nom, e.referent_unique_contact,
            e.insertion_start_date, e.insertion_end_date,
            ec.contract_type, ec.start_date AS contrat_debut, ec.end_date AS contrat_fin,
            ec.weekly_hours AS contrat_heures,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS cip_nom,
            u.email AS cip_email
       FROM employees e
       LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
       LEFT JOIN users u ON u.id = e.cip_referent_user_id
      WHERE e.id = $1`,
    [employeeId]);
  return r[0] || null;
}

/**
 * Entretiens de la période, avec leur assiduité.
 * `absence_piece_ref` n'est LU que pour la variante dossier : ce qu'on ne lit
 * pas ne peut pas fuir par une clé oubliée à la composition.
 */
async function lireEntretiens(employeeId, du, au, { avecPiece = false } = {}, panne = null) {
  const colonnePiece = avecPiece ? ', absence_piece_ref' : '';
  return soft('entretiens',
    `SELECT id, milestone_type, titre, status, due_date, interview_date, completed_date,
            duree_minutes, presence, absence_motif${colonnePiece}
       FROM insertion_milestones
      WHERE employee_id = $1
        AND COALESCE(completed_date, interview_date, due_date) BETWEEN $2::date AND $3::date
      ORDER BY COALESCE(completed_date, interview_date, due_date), id`,
    [employeeId, du, au], panne);
}

/**
 * Actions d'accompagnement de la période — les actions rattachées à un frein
 * sensible sont écartées EN SQL autant qu'en JS : le filtre applicatif suffit,
 * mais le prédicat SQL évite de promener la ligne jusqu'ici pour la jeter.
 */
async function lireActions(employeeId, du, au, panne = null) {
  return soft('actions',
    `SELECT a.id, a.action_label, a.category, a.frein_type, a.status, a.echeance,
            a.date_realisation, a.resultat, a.created_at,
            p.nom AS partenaire_nom, p.categorie AS partenaire_categorie
       FROM cip_action_plans a
       LEFT JOIN insertion_partenaires p ON p.id = a.partenaire_id
      WHERE a.employee_id = $1
        AND (a.frein_type IS NULL OR NOT (a.frein_type = ANY($4::text[])))
        AND COALESCE(a.date_realisation, a.echeance, a.created_at::date) BETWEEN $2::date AND $3::date
      ORDER BY COALESCE(a.date_realisation, a.echeance, a.created_at::date), a.id`,
    [employeeId, du, au, FREINS_EXCLUS], panne);
}

/**
 * Activité hebdomadaire couvrant une période qui peut chevaucher deux années
 * civiles (« du 01/11/2025 au 28/02/2026 » est un cas courant à l'entrée en
 * parcours). Le moteur raisonne par année ISO : on l'appelle une fois par
 * année traversée et on recolle. Sans cela, les semaines de l'année la plus
 * ancienne manqueraient SILENCIEUSEMENT du document.
 */
async function activiteSurPeriode(employeeId, du, au) {
  const a1 = Number(String(du).slice(0, 4));
  const a2 = Number(String(au).slice(0, 4));
  const annees = [];
  for (let a = a1; a <= a2 && annees.length < 6; a += 1) annees.push(a);
  if (annees.length === 0) annees.push(new Date().getFullYear());
  const parts = await Promise.all(annees.map((annee) => activiteHebdo({ employeeId, annee })));
  return {
    semaines: parts.flatMap((p) => p.semaines || []),
    // CORRECTIF m-01 — les raisons portent leur `iso_year`. Elles étaient
    // appariées sur le seul numéro de semaine, et cette fonction CONCATÈNE deux
    // années pour une période à cheval (« du 01/11/2025 au 28/02/2026 » est un
    // cas courant à l'entrée en parcours) : la raison de la S3 2025 était donc
    // recopiée sur la S3 2026. Sur un document opposable, c'est un motif
    // attribué à la mauvaise semaine.
    raisons: parts.flatMap((p) => (p.raisons || []).map((r) => ({ iso_year: r.iso_year != null ? r.iso_year : p.annee, ...r }))),
  };
}

/**
 * Compose la fiche pour le référent — NEUF rubriques, pas une de plus.
 *
 * @param {object} p { employeeId, du, au, userId }
 * @returns {Promise<object|null>} null si le salarié n'existe pas
 */
async function composerFicheReferent({ employeeId, du, au, userId }) {
  const id = Number(employeeId);
  const panne = new Set();              // m-05 : les sources tombées, nommées
  const emp = await lireSalarie(id);
  if (!emp) return null;

  const [entretiens, actions, objectifs, activite, prochain, utilisateur] = await Promise.all([
    lireEntretiens(id, du, au, {}, panne),
    lireActions(id, du, au, panne),
    soft('objectifs',
      `SELECT titre, origine, statut, echeance
         FROM insertion_objectifs
        WHERE employee_id = $1 AND statut IN ('a_venir', 'en_cours')
        ORDER BY COALESCE(echeance, '9999-12-31'::date), id`, [id], panne),
    activiteSurPeriode(id, du, au),
    soft('prochain_rdv',
      `SELECT milestone_type, COALESCE(interview_date::date, due_date) AS date
         FROM insertion_milestones
        WHERE employee_id = $1 AND status <> 'realise'
          AND COALESCE(interview_date::date, due_date) >= CURRENT_DATE
        ORDER BY COALESCE(interview_date::date, due_date)`, [id], panne),
    // Repli de signature quand le salarié n'a pas de CIP référent désigné : la
    // fiche est signée par l'agent qui la produit, jamais par « la structure ».
    userId ? soft('utilisateur',
      `SELECT NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), '') AS nom, email FROM users WHERE id = $1`,
      [userId], panne) : Promise.resolve([]),
  ]);

  // ── 1. Identité et destinataire ─────────────────────────────────────────
  const identite = {
    nom: emp.last_name || null,
    prenom: emp.first_name || null,
    identifiant_interne: emp.id,
    matricule: emp.malibou_id || null,
    destinataire: {
      type: emp.referent_unique_type || 'non_determine',
      nom: emp.referent_unique_nom || null,
      contact: emp.referent_unique_contact || null,
    },
    periode: { du, au },
    conseillere: {
      nom: emp.cip_nom || (utilisateur[0] && utilisateur[0].nom) || null,
      contact: emp.cip_email || (utilisateur[0] && utilisateur[0].email) || null,
    },
  };

  // ── 2. Situation d'emploi ───────────────────────────────────────────────
  const situationEmploi = {
    type_contrat: emp.contract_type || null,
    date_debut: jour(emp.contrat_debut) || jour(emp.insertion_start_date),
    date_fin_prevue: jour(emp.contrat_fin),
    quotite_hebdo: emp.contrat_heures != null ? Number(emp.contrat_heures)
      : (emp.weekly_hours != null ? Number(emp.weekly_hours) : null),
    parcours_num: Number(emp.parcours_num) || 1,
    pass_iae: { statut: emp.pass_iae_statut || null, fin: jour(emp.pass_iae_end) },
  };

  // ── 3. Activité hebdomadaire ────────────────────────────────────────────
  // Seules les semaines de la PÉRIODE demandée sont transmises, et seulement
  // trois colonnes par semaine : le document répond à « combien d'heures ? »,
  // il n'est pas un extrait du compteur interne (ni `sous_seuil`, ni
  // `arret_declare`, qui diraient au tiers ce que la structure PENSE de ces
  // heures — ce n'est pas à elle d'en juger).
  const semainesPeriode = (activite.semaines || []).filter((s) => s.week_start >= du && s.week_start <= au);
  const activiteBloc = {
    semaines: semainesPeriode.map((s) => ({
      iso_week: s.iso_week,
      heures_travail: s.heures_travail,
      minutes_accompagnement: s.minutes_accompagnement,
      jours_pmsmp: s.jours_pmsmp,
    })),
    nb_semaines_sous_seuil: semainesPeriode.filter((s) => s.sous_seuil === true).length,
    // Appariement sur le COUPLE (année ISO, semaine ISO) — cf. m-01.
    raisons_categorisees: (activite.raisons || [])
      .filter((r) => semainesPeriode.some((s) => s.iso_week === r.iso_week
        && (r.iso_year == null || Number(s.iso_year) === Number(r.iso_year)))),
  };

  // ── 4. Assiduité ────────────────────────────────────────────────────────
  // Trois clés, et pas une de plus (contrat § 6.1) : le détail « absents /
  // excusés » vit dans le relevé d'assiduité, document qui a sa propre
  // destination et sa propre page.
  const t = composerTotauxAssiduite(entretiens);
  const assiduite = {
    rdv_proposes: t.rdv_proposes,
    rdv_honores: t.rdv_honores,
    absences_par_motif: t.absences_par_motif,
  };

  // ── 5. Freins — 7 axes, JAMAIS santé ni judiciaire ──────────────────────
  const freins = composerFreinsPeriode(entretiens, await lireFreinsPeriode(id, du, au, panne));

  // ── 6. Actions et orientations ──────────────────────────────────────────
  const actionsBloc = actions.map((a) => ({
    date: jour(a.date_realisation) || jour(a.echeance) || jour(a.created_at),
    nature: a.category || null,
    partenaire: a.partenaire_nom || null,
    // `orientation_dora` : le référentiel partenaires n'a pas (encore) de
    // colonne `source` — l'indice retenu est le nom, et rien d'autre. Il vaut
    // `false` quand on ne sait pas : annoncer une orientation DORA qui n'a pas
    // eu lieu serait pire que de taire celle qui a eu lieu.
    orientation_dora: /\bdora\b/i.test(String(a.partenaire_nom || '')),
    resultat: a.resultat || null,
  }));

  // ── 7. Objectifs en cours ───────────────────────────────────────────────
  const objectifsBloc = objectifs.map((o) => ({
    libelle: o.titre || null,
    origine: o.origine || null,
    statut: o.statut || null,
    echeance: jour(o.echeance),
  }));

  // ── 8. Prochaines échéances ─────────────────────────────────────────────
  const prochainesEcheances = {
    prochain_rdv: prochain[0] ? jour(prochain[0].date) : null,
    fin_contrat: jour(emp.contrat_fin),
    prochain_point_referent: (prochain.find((p) => p.milestone_type === 'point_etape_referent')
      ? jour(prochain.find((p) => p.milestone_type === 'point_etape_referent').date) : null),
  };

  return {
    identite,
    situation_emploi: situationEmploi,
    activite: activiteBloc,
    assiduite,
    freins,
    actions: actionsBloc,
    objectifs: objectifsBloc,
    prochaines_echeances: prochainesEcheances,
    mentions: {
      droits: MENTION_DROITS,
      genere_le: new Date().toISOString(),
      // m-05 — une rubrique absente parce que sa source n'a pas répondu se lit
      // « rien n'a été fait » sur ce document. Elle est donc NOMMÉE, et le PDF
      // l'imprime : « Rubrique indisponible au moment de l'édition ». Tableau
      // vide quand tout va bien.
      sources_indisponibles: mentionsSources(panne),
    },
  };
}

/**
 * Totaux d'assiduité d'une liste d'entretiens.
 *
 * `rdv_proposes` exclut les entretiens encore « à planifier » : proposer un
 * rendez-vous suppose d'avoir donné une date. Et `rdv_honores` ne compte que
 * les présences EXPLICITEMENT constatées — un entretien réalisé dont la
 * présence n'a pas été saisie n'est pas compté comme honoré, parce qu'on ne le
 * sait pas. Le tiers lit donc parfois un total inférieur à la réalité : c'est
 * le prix d'un chiffre qu'on peut défendre.
 */
function composerTotauxAssiduite(entretiens) {
  const retenus = (entretiens || []).filter((m) => m.status !== 'a_planifier');
  const parMotif = Object.fromEntries(MOTIFS_ABSENCE.map((m) => [m, 0]));
  parMotif.sans_motif = 0;
  let honores = 0;
  let absents = 0;
  let excuses = 0;
  for (const m of retenus) {
    if (m.presence === 'present') { honores += 1; continue; }
    if (m.presence !== 'absent' && m.presence !== 'excuse') continue;
    if (m.presence === 'absent') absents += 1; else excuses += 1;
    const motif = MOTIFS_ABSENCE.includes(m.absence_motif) ? m.absence_motif : 'sans_motif';
    parMotif[motif] += 1;
  }
  return {
    rdv_proposes: retenus.length,
    rdv_honores: honores,
    absences_par_motif: parMotif,
    absents,
    excuses,
  };
}

/** Niveaux de freins des entretiens réalisés de la période (colonnes transmissibles). */
async function lireFreinsPeriode(employeeId, du, au, panne = null) {
  const cols = FREINS_TRANSMISSIBLES.map((f) => f.column).join(', ');
  return soft('freins',
    `SELECT completed_date, ${cols}
       FROM insertion_milestones
      WHERE employee_id = $1 AND status = 'realise'
        AND completed_date BETWEEN $2::date AND $3::date
      ORDER BY completed_date, id`,
    [employeeId, du, au], panne);
}

/**
 * Évolution des 7 axes transmissibles : premier et dernier niveau RENSEIGNÉS de
 * la période, axe par axe. Un axe jamais évalué rend deux `null` — et non un
 * niveau 1, qui se lirait « aucune difficulté » alors qu'on n'a rien constaté.
 */
function composerFreinsPeriode(_entretiens, lignes) {
  return FREINS_TRANSMISSIBLES.map((f) => {
    const valeurs = (lignes || [])
      .map((l) => l[f.column])
      .filter((v) => v != null && Number(v) >= 1);
    return {
      axe: f.key,
      libelle: f.label,
      niveau_debut: valeurs.length ? Number(valeurs[0]) : null,
      niveau_fin: valeurs.length ? Number(valeurs[valeurs.length - 1]) : null,
    };
  });
}

/**
 * Relevé d'assiduité sur une période.
 *
 * Deux variantes, et la différence n'est pas cosmétique :
 *  - `tiers` (défaut) : destiné au référent externe. Aucune référence de pièce
 *    justificative (`absence_piece_ref` peut porter « certificat médical du
 *    Dr X »), aucun libellé de paie — les absences de paie n'y figurent que par
 *    leur CATÉGORIE ;
 *  - `dossier` : pour la CIP, dans le dossier interne. La référence de pièce y
 *    figure, puisque c'est elle qui prouve que l'absence a été justifiée.
 *
 * @param {object} p { employeeId, du, au, variante }
 */
async function composerReleveAssiduite({ employeeId, du, au, variante = 'tiers' }) {
  const id = Number(employeeId);
  const dossier = variante === 'dossier';
  const panne = new Set();              // m-05 : les sources tombées, nommées
  const emp = await lireSalarie(id);
  if (!emp) return null;

  const [entretiens, actions, conges] = await Promise.all([
    lireEntretiens(id, du, au, { avecPiece: dossier }, panne),
    // `notes` n'est JAMAIS sélectionné. `action_label` l'est, mais il ne sort
    // qu'en variante dossier (M-01) ; la variante tiers travaille sur
    // `category` — liste FERMÉE de quatre valeurs — et sur le nom du partenaire.
    soft('actions_assiduite',
      `SELECT a.action_label, a.category, a.status, a.date_realisation, a.echeance, a.frein_type,
              p.nom AS partenaire_nom
         FROM cip_action_plans a
         LEFT JOIN insertion_partenaires p ON p.id = a.partenaire_id
        WHERE a.employee_id = $1
          AND (a.frein_type IS NULL OR NOT (a.frein_type = ANY($4::text[])))
          AND COALESCE(a.date_realisation, a.echeance, a.created_at::date) BETWEEN $2::date AND $3::date
        ORDER BY COALESCE(a.date_realisation, a.echeance, a.created_at::date), a.id`,
      [id, du, au, FREINS_EXCLUS], panne),
    // `type_category` SEULEMENT. `leave_type` est le libellé brut de la paie :
    // il peut nommer une pathologie, il ne quitte jamais ce module.
    soft('conges',
      `SELECT type_category, start_date, end_date
         FROM employee_leaves
        WHERE employee_id = $1
          AND start_date <= $3::date AND COALESCE(end_date, start_date) >= $2::date
        ORDER BY start_date`,
      [id, du, au], panne),
  ]);

  const totaux = composerTotauxAssiduite(entretiens);

  return {
    identite: {
      nom: emp.last_name || null,
      prenom: emp.first_name || null,
      identifiant_interne: emp.id,
      periode: { du, au },
    },
    variante: dossier ? 'dossier' : 'tiers',
    entretiens: entretiens.map((m) => {
      const ligne = {
        date: dateTenue(m),
        // CORRECTIF B-01 (bloquant) — `insertion_milestones.titre` est un
        // VARCHAR(120) LIBREMENT saisi par la CIP, sans contrainte de contenu,
        // sans chiffrement, sans masquage. Une CIP qui intitule un entretien
        // « Bilan après l'hospitalisation » ou « Point suite convocation au
        // tribunal » — pratique naturelle dans un dossier INTERNE — faisait
        // sortir ce verbatim vers le CMS ou France Travail, sur un document qui
        // peut fonder une suspension de droits. La variante tiers ne connaît
        // donc que le vocabulaire FERMÉ des huit types ; le dossier interne,
        // lui, garde le titre que la CIP a écrit, qui lui est utile.
        type_libelle: dossier ? (m.titre || libelleType(m.milestone_type)) : libelleType(m.milestone_type),
        presence: m.presence || null,
        absence_motif: m.absence_motif || null,
      };
      if (dossier) ligne.absence_piece_ref = m.absence_piece_ref || null;
      return ligne;
    }),
    // CORRECTIF M-01 — même raisonnement sur `cip_action_plans.action_label`,
    // colonne TEXT librement saisie. Les actions rattachées aux freins `sante`
    // et `judiciaire` sont bien écartées en SQL, mais `frein_type` est
    // FACULTATIF et sans CHECK : une action saisie sans frein, ou rattachée à
    // « administratif », peut parfaitement s'intituler « Accompagnement au
    // rendez-vous CMP » ou « Dossier MDPH ». La fiche pour le référent avait
    // déjà tranché correctement (elle n'imprime que `category`) ; les deux
    // documents partent au même destinataire, ils tiennent désormais la même
    // règle. Arbitrage retenu : catégorie fermée + nom du partenaire.
    actions: actions.map((a) => {
      const ligne = {
        date: jour(a.date_realisation) || jour(a.echeance),
        nature: a.category || null,
        partenaire: a.partenaire_nom || null,
        statut: a.status || null,
      };
      if (dossier) ligne.libelle = a.action_label || null;
      return ligne;
    }),
    absences_paie: conges.map((c) => ({
      du: jour(c.start_date),
      au: jour(c.end_date) || jour(c.start_date),
      categorie: c.type_category || null,
    })),
    totaux: {
      rdv_proposes: totaux.rdv_proposes,
      rdv_honores: totaux.rdv_honores,
      absents: totaux.absents,
      excuses: totaux.excuses,
      sans_motif: totaux.absences_par_motif.sans_motif,
    },
    // m-05 : une rubrique tombée est NOMMÉE. Vide quand tout va bien.
    sources_indisponibles: mentionsSources(panne),
  };
}

/** Liste ordonnée des sources tombées, en français (m-05). */
function mentionsSources(panne) {
  if (!panne || panne.size === 0) return [];
  return [...new Set([...panne].map((k) => LIBELLE_SOURCE[k] || k))].sort();
}

/** Clés de premier niveau de la fiche — la liste blanche, sous forme vérifiable. */
const FICHE_CLES = [
  'identite', 'situation_emploi', 'activite', 'assiduite',
  'freins', 'actions', 'objectifs', 'prochaines_echeances', 'mentions',
];

module.exports = {
  composerFicheReferent,
  composerReleveAssiduite,
  composerTotauxAssiduite,
  composerFreinsPeriode,
  FICHE_CLES,
  FREINS_TRANSMISSIBLES,
  FREINS_EXCLUS,
  MOTIFS_ABSENCE,
  TYPE_LABELS,
  MENTION_DROITS,
};
