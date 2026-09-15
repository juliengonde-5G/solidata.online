/**
 * PR B — lot 4. Accès base du temps d'accompagnement : composition de la
 * feuille de temps mensuelle d'un intervenant et agrégats annuels.
 *
 * Le CALCUL vit dans `temps-engine.js` (module pur, testé sans base) ; ce
 * fichier ne fait que CHARGER les faits et appeler le moteur. La séparation
 * n'est pas cosmétique : la même composition sert l'écran (à la volée), le
 * gel de la feuille à la validation et l'export destiné à l'autorité. Trois
 * chemins, une seule règle — recopiée, elle divergerait, et les trois
 * documents ne diraient plus la même chose du même mois.
 *
 * `heuresAccompagnement` est branché par l'orchestrateur dans
 * `gatherAuditKpis` (contrat 15 § 5.4, indicateur n° 14 de l'autorité :
 * « heures d'accompagnement, agrégat + moyenne par personne »).
 */

'use strict';

const pool = require('../config/database');
const { composerLignes, calculerTotaux, verifierCoherence, HORS_PROJET } = require('./temps-engine');

/** Bornes d'une période : mois précis, ou l'année entière si `mois` est nul. */
function bornes(annee, mois) {
  const an = Number(annee);
  if (mois == null) return { debut: `${an}-01-01`, fin: `${an + 1}-01-01` };
  const mo = Number(mois);
  const finAn = mo === 12 ? an + 1 : an;
  const finMo = mo === 12 ? 1 : mo + 1;
  return {
    debut: `${an}-${String(mo).padStart(2, '0')}-01`,
    fin: `${finAn}-${String(finMo).padStart(2, '0')}-01`,
  };
}

/**
 * Charge tous les faits d'une période pour UN intervenant (ou pour tous quand
 * `userId` est nul — cas de l'agrégat annuel).
 *
 * Les entretiens sont ceux que l'intervenant a MENÉS (`interviewer_id`), pas
 * ceux qu'il a saisis : c'est le temps passé en face de la personne qui est
 * financé. Les actions sont celles qu'il a créées (`created_by`) et
 * RÉALISÉES — une action au statut « à faire » n'a consommé aucun temps.
 */
async function chargerFaits({ userId = null, annee, mois = null, db = pool }) {
  const { debut, fin } = bornes(annee, mois);
  const filtreUser = userId == null ? '' : ' AND m.interviewer_id = $3';
  const params = userId == null ? [debut, fin] : [debut, fin, userId];

  const milestones = await db.query(
    `SELECT m.id, m.employee_id, m.completed_date, m.duree_minutes, m.milestone_type, m.interviewer_id
       FROM insertion_milestones m
      WHERE m.completed_date >= $1::date AND m.completed_date < $2::date
        AND m.duree_minutes IS NOT NULL AND m.interviewer_id IS NOT NULL${filtreUser}
      ORDER BY m.completed_date, m.id`,
    params
  );

  // `date_realisation` est posée par la PR B lot 3 ; sur une base non encore
  // migrée la requête échoue en 42703. On la laisse remonter : la feuille
  // serait FAUSSE sans les actions, et une feuille fausse signée est pire
  // qu'un écran en erreur qui dit de redéployer.
  const actions = await db.query(
    `SELECT a.id, a.employee_id, a.date_realisation, a.duree_minutes, a.action_label, a.status, a.created_by
       FROM cip_action_plans a
      WHERE a.date_realisation >= $1::date AND a.date_realisation < $2::date
        AND a.status = 'realise' AND a.duree_minutes IS NOT NULL
        AND a.created_by IS NOT NULL${userId == null ? '' : ' AND a.created_by = $3'}
      ORDER BY a.date_realisation, a.id`,
    params
  );

  const saisies = await db.query(
    `SELECT s.id, s.user_id, s.date, s.projet_id, s.activite, s.duree_minutes, s.libelle, s.created_at
       FROM insertion_temps_saisies s
      WHERE s.date >= $1::date AND s.date < $2::date${userId == null ? '' : ' AND s.user_id = $3'}
      ORDER BY s.date, s.id`,
    params
  );

  const projets = await db.query(
    'SELECT id, code, nom, type, taux_forfaitaire_pct FROM insertion_projets ORDER BY code'
  );

  const postes = await db.query(
    `SELECT pp.projet_id, pp.user_id, pp.quotite_pct, pp.date_debut, pp.date_fin,
            p.code AS projet_code, p.type AS projet_type
       FROM insertion_projet_postes pp
       JOIN insertion_projets p ON p.id = pp.projet_id
      ${userId == null ? '' : 'WHERE pp.user_id = $1'}`,
    userId == null ? [] : [userId]
  );

  // Rattachements ASI : c'est la personne accompagnée qui rattache l'heure à
  // l'opération. Chargés pour la période (un rattachement clos avant le début
  // ou ouvert après la fin ne concerne aucune ligne).
  const participations = await db.query(
    `SELECT pa.employee_id, pa.projet_id, pa.date_entree, pa.date_sortie,
            p.code AS projet_code, p.type AS projet_type
       FROM insertion_projet_participants pa
       JOIN insertion_projets p ON p.id = pa.projet_id
      WHERE pa.date_entree < $2::date AND (pa.date_sortie IS NULL OR pa.date_sortie >= $1::date)`,
    [debut, fin]
  );

  const parId = new Map();
  for (const p of projets.rows) parId.set(Number(p.id), p);

  return {
    milestones: milestones.rows,
    actions: actions.rows,
    saisies: saisies.rows,
    postes: postes.rows,
    participations: participations.rows,
    projets: projets.rows,
    projetsParId: parId,
  };
}

/** Congés de l'intervenant sur la période (via sa fiche salarié, si elle existe). */
async function chargerCongesIntervenant({ userId, annee, mois, db = pool }) {
  const { debut, fin } = bornes(annee, mois);
  const r = await db.query(
    `SELECT l.type_category, l.start_date, l.end_date
       FROM employee_leaves l
       JOIN employees e ON e.id = l.employee_id
      WHERE e.user_id = $1
        AND l.start_date < $3::date
        AND COALESCE(l.end_date, l.start_date) >= $2::date`,
    [userId, debut, fin]
  );
  return r.rows;
}

/** Quotité contractuelle de l'intervenant (null si aucune fiche salarié). */
async function quotiteIntervenant({ userId, db = pool }) {
  const r = await db.query(
    'SELECT weekly_hours, first_name, last_name FROM employees WHERE user_id = $1 ORDER BY is_active DESC NULLS LAST, id LIMIT 1',
    [userId]
  );
  return r.rows[0] || null;
}

/**
 * Compose la feuille d'un mois SANS rien écrire. C'est ce que voit l'écran
 * tant que la feuille est au brouillon, et c'est exactement ce qui sera FIGÉ
 * au moment de la validation.
 */
async function composerFeuille({ userId, annee, mois, db = pool }) {
  const faits = await chargerFaits({ userId, annee, mois, db });
  const lignes = composerLignes({
    annee, mois,
    milestones: faits.milestones,
    actions: faits.actions,
    saisies: faits.saisies,
    postes: faits.postes,
    participations: faits.participations,
    projets: faits.projetsParId,
  });

  // Les postes retenus pour la quotité sont ceux des projets RÉELLEMENT
  // touchés par la feuille — afficher la quotité d'une opération sur laquelle
  // l'intervenant n'a rien imputé ce mois-ci brouillerait la lecture.
  const codesTouches = new Set(lignes.map((l) => l.projet_code));
  const postesUtiles = faits.postes.filter((p) => codesTouches.has(p.projet_code));
  const projetsUtiles = faits.projets.filter((p) => codesTouches.has(p.code));

  const totaux = calculerTotaux(lignes, postesUtiles, projetsUtiles);

  const [conges, fiche] = await Promise.all([
    chargerCongesIntervenant({ userId, annee, mois, db }).catch(() => []),
    quotiteIntervenant({ userId, db }).catch(() => null),
  ]);
  const coherence = verifierCoherence({
    lignes, leaves: conges,
    weeklyHours: fiche ? fiche.weekly_hours : null,
    annee, mois,
  });

  return { lignes, totaux, coherence, projets: faits.projets, postes: faits.postes };
}

/**
 * Feuille lue : le SNAPSHOT dès qu'elle est validée, la composition à la volée
 * tant qu'elle est au brouillon.
 *
 * POURQUOI LE SNAPSHOT PRIME. Une feuille signée est une pièce de financement.
 * Recomposer à la lecture ferait bouger un total déjà signé dès qu'un entretien
 * est corrigé deux mois plus tard — c'est-à-dire produire, pour le même mois,
 * un document différent de celui qui a été transmis.
 */
async function lireFeuille({ userId, annee, mois, db = pool }) {
  const r = await db.query(
    'SELECT * FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
    [userId, annee, mois]
  );
  const ligne = r.rows[0] || null;
  const statut = ligne ? ligne.statut : 'brouillon';

  if (ligne && statut !== 'brouillon' && Array.isArray(ligne.lignes)) {
    return {
      user_id: Number(userId), annee: Number(annee), mois: Number(mois), statut,
      lignes: ligne.lignes, totaux: ligne.totaux, coherence: ligne.coherence,
      validation_intervenant: ligne.validation_intervenant || null,
      validation_rh: ligne.validation_rh || null,
      fige: true, feuille_id: ligne.id,
    };
  }

  const composee = await composerFeuille({ userId, annee, mois, db });
  return {
    user_id: Number(userId), annee: Number(annee), mois: Number(mois), statut,
    lignes: composee.lignes, totaux: composee.totaux, coherence: composee.coherence,
    validation_intervenant: ligne ? ligne.validation_intervenant || null : null,
    validation_rh: ligne ? ligne.validation_rh || null : null,
    fige: false, feuille_id: ligne ? ligne.id : null,
    projets: composee.projets, postes: composee.postes,
  };
}

/**
 * Agrégat des heures d'accompagnement (indicateur n° 14 de l'autorité).
 *
 * Il se compose des MÊMES lignes que les feuilles de temps : l'agrégat annoncé
 * au dialogue de gestion et les feuilles signées ne peuvent donc pas se
 * contredire. Les feuilles FIGÉES sont relues telles quelles — c'est ce qui a
 * été signé qui fait foi, et recomposer donnerait un agrégat que plus aucune
 * pièce ne justifie.
 *
 * Aucune valeur inventée : sans aucune ligne, les totaux valent 0 sur une
 * année réellement vide, mais la moyenne par personne rend `null` (aucune
 * personne accompagnée ne se divise pas).
 *
 * @param {object} [p]
 * @param {number} [p.annee] année (défaut : l'année courante)
 * @param {number} [p.employeeId] restreint à un salarié
 * @param {number} [p.projetId] restreint à une opération
 * @returns {Promise<object|null>} null si la composition échoue (mode « soft »)
 */
async function heuresAccompagnement({ annee = null, employeeId = null, projetId = null, db = pool } = {}) {
  const an = Number(annee) || new Date().getFullYear();
  try {
    const faits = await chargerFaits({ userId: null, annee: an, mois: null, db });

    // Les feuilles FIGÉES sont lues EN PREMIER (correctif D-04). Elles ne sont
    // pas un complément de la composition vivante : ce sont des pièces signées,
    // et une pièce signée ne peut pas sortir de l'agrégat parce que le fait qui
    // l'a produite a été corrigé depuis — ce que la réouverture ADMIN autorise
    // explicitement. L'ensemble des intervenants était construit à partir des
    // seuls faits VIVANTS : un intervenant dont le dernier entretien de l'année
    // était supprimé disparaissait entièrement du calcul, feuille signée
    // comprise, alors que l'en-tête de cette fonction promet que « l'agrégat
    // annoncé au dialogue de gestion et les feuilles signées ne peuvent pas se
    // contredire ».
    const figees = await db.query(
      `SELECT user_id, annee, mois, lignes FROM insertion_feuilles_temps
        WHERE annee = $1 AND statut <> 'brouillon' AND lignes IS NOT NULL`,
      [an]
    );
    const cleFigee = (u, m) => `${u}-${m}`;
    const parFeuilleFigee = new Map();
    for (const f of figees.rows) {
      if (Array.isArray(f.lignes)) parFeuilleFigee.set(cleFigee(Number(f.user_id), Number(f.mois)), f.lignes);
    }

    // Un intervenant = un jeu de lignes. On compose par intervenant parce que
    // le rattachement OCS dépend de SON poste : composer tout le monde d'un
    // bloc attribuerait à chacun les postes des autres.
    const intervenants = new Set();
    for (const m of faits.milestones) if (m.interviewer_id != null) intervenants.add(Number(m.interviewer_id));
    for (const a of faits.actions) if (a.created_by != null) intervenants.add(Number(a.created_by));
    for (const s of faits.saisies) if (s.user_id != null) intervenants.add(Number(s.user_id));
    // …et tout intervenant qui a une feuille SIGNÉE dans l'année, même s'il n'a
    // plus un seul fait vivant.
    for (const f of figees.rows) if (f.user_id != null) intervenants.add(Number(f.user_id));

    let toutes = [];
    for (const uid of intervenants) {
      const lignes = composerLignes({
        annee: an, mois: null,
        milestones: faits.milestones.filter((m) => Number(m.interviewer_id) === uid),
        actions: faits.actions.filter((a) => Number(a.created_by) === uid),
        saisies: faits.saisies.filter((s) => Number(s.user_id) === uid),
        postes: faits.postes.filter((p) => Number(p.user_id) === uid),
        participations: faits.participations,
        projets: faits.projetsParId,
      });
      // Les mois figés remplacent la composition vivante, mois par mois.
      const parMois = new Map();
      for (const l of lignes) {
        const m = Number(l.date.slice(5, 7));
        if (!parMois.has(m)) parMois.set(m, []);
        parMois.get(m).push(l);
      }
      for (const [cle, lignesFigees] of parFeuilleFigee) {
        const [u, mo] = cle.split('-').map(Number);
        if (u === uid) parMois.set(mo, lignesFigees);
      }
      for (const [, ls] of parMois) toutes = toutes.concat(ls.map((l) => ({ ...l, user_id: uid })));
    }

    if (employeeId != null) toutes = toutes.filter((l) => Number(l.employee_id) === Number(employeeId));
    if (projetId != null) {
      const p = faits.projetsParId.get(Number(projetId));
      const code = p ? p.code : null;
      toutes = toutes.filter((l) => l.projet_code === code);
    }

    const somme = (acc, l) => acc + (Number(l.duree_minutes) || 0);
    const grouper = (cle) => {
      const m = new Map();
      for (const l of toutes) {
        const k = l[cle];
        if (k == null) continue;
        m.set(k, (m.get(k) || 0) + (Number(l.duree_minutes) || 0));
      }
      return m;
    };

    const nomsSalaries = new Map();
    const idsSalaries = [...new Set(toutes.map((l) => l.employee_id).filter((x) => x != null))];
    if (idsSalaries.length) {
      const r = await db.query('SELECT id, first_name, last_name FROM employees WHERE id = ANY($1::int[])', [idsSalaries]);
      for (const e of r.rows) nomsSalaries.set(Number(e.id), `${(e.last_name || '').toUpperCase()} ${e.first_name || ''}`.trim());
    }
    const nomsUsers = new Map();
    const idsUsers = [...intervenants];
    if (idsUsers.length) {
      const r = await db.query('SELECT id, first_name, last_name FROM users WHERE id = ANY($1::int[])', [idsUsers]);
      for (const u of r.rows) nomsUsers.set(Number(u.id), `${(u.last_name || '').toUpperCase()} ${u.first_name || ''}`.trim());
    }

    const parProjetMin = grouper('projet_code');
    const parSalarie = grouper('employee_id');
    const parIntervenant = grouper('user_id');
    const global = toutes.reduce(somme, 0);

    return {
      annee: an,
      global_minutes: global,
      par_projet: faits.projets
        .map((p) => ({ code: p.code, nom: p.nom, minutes: parProjetMin.get(p.code) || 0, taux_forfaitaire_pct: p.taux_forfaitaire_pct == null ? null : Number(p.taux_forfaitaire_pct) }))
        .filter((p) => p.minutes > 0)
        .concat(parProjetMin.has(HORS_PROJET)
          ? [{ code: HORS_PROJET, nom: 'Hors projet', minutes: parProjetMin.get(HORS_PROJET), taux_forfaitaire_pct: null }]
          : []),
      par_salarie: [...parSalarie.entries()]
        .map(([id, minutes]) => ({ employee_id: id, nom: nomsSalaries.get(id) || null, minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      par_intervenant: [...parIntervenant.entries()]
        .map(([id, minutes]) => ({ user_id: id, nom: nomsUsers.get(id) || null, minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      nb_salaries_concernes: parSalarie.size,
      // « Moyenne par personne » (indicateur n° 14). Aucune personne
      // accompagnée → null, jamais 0 : une division sans dividende n'a pas de
      // résultat, et un 0 se lirait « aucun accompagnement ».
      moyenne_minutes_par_salarie: parSalarie.size === 0
        ? null
        : Math.round([...parSalarie.values()].reduce((a, b) => a + b, 0) / parSalarie.size),
    };
  } catch (err) {
    console.error('[TEMPS] heuresAccompagnement :', err.message, err.code || '');
    return null;
  }
}

module.exports = {
  heuresAccompagnement, composerFeuille, lireFeuille, chargerFaits,
  chargerCongesIntervenant, quotiteIntervenant, bornes,
};
