/**
 * Reporting Convergence (programme CVG) — `/api/insertion/convergence`
 * (lot 2.60.0 ; contrat `rapports/cip-refonte-2026-09-12/30-convergence-cvg-cartographie.md` § 2.3).
 *
 * ═══ CE QUE CETTE SURFACE PRODUIT ═════════════════════════════════════════
 *
 *   · `GET  /apercu`      — le document d'une période, composé à la volée.
 *     Journal BLOQUANT : l'aperçu rend le document complet, il se copie depuis
 *     le navigateur — il ne sort pas sans sa trace (doctrine m-05 de la PR D).
 *   · `POST /generer`     — INSTANTANÉ enregistré (`insertion_dialogues_gestion`,
 *     `type = 'cvg'`) et sa trace, dans la MÊME transaction.
 *   · `GET  /historique`, `GET /snapshot/:id` — ce qui a été produit, rejoué tel
 *     qu'il était.
 *   · `GET  /comparaison` — deux instantanés, ou deux périodes composées à la
 *     volée : écarts indicateur par indicateur et lecture rédigée.
 *   · `GET  /completude`  — liste NOMINATIVE des dossiers à compléter (écran
 *     interne, jamais dans le document transmis).
 *   · `GET  /csv`         — le document en CSV, journal bloquant.
 *   · `GET|PUT /situation-sortie/:employeeId` — la situation de sortie
 *     Convergence d'un parcours, avec une PROPOSITION déduite du dossier (la CIP
 *     confirme, rien n'est écrit sans elle).
 *   · CRUD `/ressources`  — registre des moyens humains (Partie 2).
 *
 * ═══ QUI ═════════════════════════════════════════════════════════════════
 * ADMIN/RH strict : le document porte des catégories de santé (RQTH, AAH,
 * pension, médecin traitant) sur de petits effectifs — même protégé par le
 * seuil de confidentialité `insertion.cvg_k_min` (2.60.0, B-01), et le frein
 * judiciaire quand le DPO l'a décidé (B-02). Le refus tombe AVANT toute
 * requête — posé par le routeur parent, et redoublé ici pour qu'un montage
 * ailleurs ne l'ouvre pas.
 *
 * ═══ JOURNAL (2.60.0) ════════════════════════════════════════════════════
 * BLOQUANT là où un document sort (aperçu, génération, consultation,
 * comparaison, CSV) et pour l'écriture d'une situation de sortie ; TOLÉRANT
 * pour les écrans internes qui lisent du nominatif (proposition de situation
 * de sortie, liste de complétude, registre des moyens humains — m-01, m-02,
 * m-06) : perdre la trace d'une lecture est regrettable, empêcher la CIP de
 * travailler parce que le journal est indisponible serait pire.
 */

'use strict';

const express = require('express');
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { query, param, body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { journalPour } = require('../../utils/insertion-journal');
const { nomGenerateur } = require('../../utils/export-csv');
const {
  composerCvg, composerCompletude, comparerCvg, cvgVersCsv, cvgEstVide, erreurPeriode, profilPersonne,
  lireParametresCvg,
} = require('../../services/convergence-cvg');
const { APP_VERSION } = require('../../services/dialogue-gestion');
const R = require('../../utils/convergence-cvg-referentiels');

const router = express.Router();
router.use(authorize('ADMIN', 'RH'));

const { journaliser, journaliserDocument } = journalPour('insertion_convergence', '[INSERTION][CVG]');
const journalRessources = journalPour('insertion_cvg_ressources', '[INSERTION][CVG]');

const VALIDATEURS_PERIODE = (src = query, suffixe = '') => [
  src(`debut${suffixe}`).exists({ checkFalsy: true }).withMessage(`debut${suffixe} obligatoire (AAAA-MM-JJ)`)
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage(`debut${suffixe} invalide (AAAA-MM-JJ)`),
  src(`fin${suffixe}`).exists({ checkFalsy: true }).withMessage(`fin${suffixe} obligatoire (AAAA-MM-JJ)`)
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage(`fin${suffixe} invalide (AAAA-MM-JJ)`),
];

/** 400 motivé si la période est incohérente — AVANT toute requête. */
function periodeOuRefus(res, debut, fin) {
  const e = erreurPeriode(debut, fin);
  if (e) { res.status(400).json({ error: e, code: 'PERIODE_INVALIDE' }); return false; }
  return true;
}

const refusVide = (res, debut, fin) => res.status(409).json({
  error: `Aucun salarié accueilli ni sorti entre le ${fr(debut)} et le ${fr(fin)} — aucun document n'est produit.`,
  code: 'EXPORT_VIDE',
  hint: "Un document vide classé dans un dossier se lit « aucune activité », ce qui serait faux. Vérifiez la période demandée.",
});

/**
 * CORRECTIF m-07 — `cvgEstVide` rend `null` quand la cohorte ET les sorties
 * sont illisibles : « aucun salarié accueilli ni sorti » serait faux. 503.
 */
const refusIllisible = (res) => res.status(503).json({
  error: "Les sources du document (cohorte et sorties) sont illisibles : impossible de dire si la période est vide — aucun document n'est produit.",
  code: 'SOURCE_ILLISIBLE',
  hint: 'Réessayez plus tard ; si le défaut persiste, le journal serveur nomme la source en cause.',
});

function fr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

const trace = (debut, fin, extra = {}) => ({ periode_debut: debut, periode_fin: fin, ...extra });

const nomCourt = (prenom, nom) => (prenom
  ? `${prenom} ${nom ? `${String(nom).charAt(0)}.` : ''}`.trim()
  : null);

// ═══════════════════════════════════════════════════════════════════════════
// Document
// ═══════════════════════════════════════════════════════════════════════════

router.get('/apercu', VALIDATEURS_PERIODE(), validate, async (req, res) => {
  const { debut, fin } = req.query;
  if (!periodeOuRefus(res, debut, fin)) return undefined;
  try {
    const contenu = await composerCvg({ debut, fin, user: req.user });
    await journaliserDocument(pool, req, 'INSERTION_CVG_APERCU', null, trace(debut, fin));
    return res.json(contenu);
  } catch (err) {
    console.error('[INSERTION][CVG] aperçu :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.post('/generer', VALIDATEURS_PERIODE(body), validate, async (req, res) => {
  const { debut, fin } = req.body;
  if (!periodeOuRefus(res, debut, fin)) return undefined;
  let client;
  try {
    const contenu = await composerCvg({ debut, fin, user: req.user });
    const vide = cvgEstVide(contenu);
    if (vide === null) return refusIllisible(res);
    if (vide) return refusVide(res, debut, fin);

    client = await pool.connect();
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO insertion_dialogues_gestion
         (annee, trimestre, contenu, genere_par, version_application, type, periode_debut, periode_fin)
       VALUES ($1, NULL, $2, $3, $4, 'cvg', $5::date, $6::date) RETURNING id, genere_le`,
      [Number(String(fin).slice(0, 4)), JSON.stringify(contenu), req.user?.id ?? null, APP_VERSION, debut, fin]
    );
    await journaliserDocument(client, req, 'INSERTION_CVG_GENERATION', null,
      trace(debut, fin, { snapshot_id: ins.rows[0].id }));
    await client.query('COMMIT');
    return res.status(201).json({ id: ins.rows[0].id, genere_le: ins.rows[0].genere_le, contenu });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION][CVG] génération :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  } finally {
    if (client) client.release();
  }
});

/**
 * Réglages de confidentialité EN VIGUEUR (B-01, B-02) — l'encadré de l'écran
 * les dit AVANT la génération. Aucune donnée personnelle, aucune trace.
 */
router.get('/parametres', async (req, res) => {
  try {
    return res.json(await lireParametresCvg());
  } catch (err) {
    console.error('[INSERTION][CVG] paramètres :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.get('/historique', [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit invalide'),
], validate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 25;
    const r = await pool.query(
      `SELECT d.id, to_char(d.periode_debut, 'YYYY-MM-DD') AS periode_debut,
              to_char(d.periode_fin, 'YYYY-MM-DD') AS periode_fin,
              d.genere_le, d.version_application, u.first_name, u.last_name
         FROM insertion_dialogues_gestion d
         LEFT JOIN users u ON u.id = d.genere_par
        WHERE d.type = 'cvg'
        ORDER BY d.genere_le DESC
        LIMIT $1`, [limit]
    );
    return res.json(r.rows.map((row) => ({
      id: row.id,
      periode_debut: row.periode_debut,
      periode_fin: row.periode_fin,
      genere_le: row.genere_le,
      version: row.version_application,
      genere_par_nom: nomCourt(row.first_name, row.last_name),
    })));
  } catch (err) {
    console.error('[INSERTION][CVG] historique :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

async function lireSnapshot(id) {
  const r = await pool.query(
    `SELECT id, to_char(periode_debut, 'YYYY-MM-DD') AS periode_debut,
            to_char(periode_fin, 'YYYY-MM-DD') AS periode_fin,
            contenu, genere_le, version_application
       FROM insertion_dialogues_gestion WHERE id = $1 AND type = 'cvg'`, [id]
  );
  return r.rows[0] || null;
}

router.get('/snapshot/:id', [param('id').isInt({ min: 1 }).withMessage('Identifiant invalide')], validate, async (req, res) => {
  try {
    const row = await lireSnapshot(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Instantané Convergence introuvable' });
    await journaliserDocument(pool, req, 'INSERTION_CVG_CONSULTATION', null,
      trace(row.periode_debut, row.periode_fin, { snapshot_id: row.id }));
    return res.json({
      id: row.id, periode_debut: row.periode_debut, periode_fin: row.periode_fin,
      genere_le: row.genere_le, version: row.version_application,
      contenu: row.contenu || null,
    });
  } catch (err) {
    console.error('[INSERTION][CVG] instantané :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.get('/comparaison', [
  query('a').optional().isInt({ min: 1 }).withMessage('a invalide'),
  query('b').optional().isInt({ min: 1 }).withMessage('b invalide'),
  ...['debut_a', 'fin_a', 'debut_b', 'fin_b'].map((k) => query(k).optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage(`${k} invalide (AAAA-MM-JJ)`)),
], validate, async (req, res) => {
  const q = req.query;
  const parIds = q.a && q.b;
  const parPeriodes = q.debut_a && q.fin_a && q.debut_b && q.fin_b;
  if (!parIds && !parPeriodes) {
    return res.status(400).json({
      error: 'Deux instantanés (a et b) ou deux périodes (debut_a, fin_a, debut_b, fin_b) sont nécessaires.',
      code: 'COMPARAISON_INCOMPLETE',
    });
  }
  if (!parIds) {
    if (!periodeOuRefus(res, q.debut_a, q.fin_a) || !periodeOuRefus(res, q.debut_b, q.fin_b)) return undefined;
  }
  try {
    let a; let b; let details;
    if (parIds) {
      const [ra, rb] = [await lireSnapshot(Number(q.a)), await lireSnapshot(Number(q.b))];
      if (!ra || !rb) return res.status(404).json({ error: 'Instantané Convergence introuvable' });
      a = ra.contenu; b = rb.contenu;
      details = { snapshot_a: ra.id, snapshot_b: rb.id };
    } else {
      a = await composerCvg({ debut: q.debut_a, fin: q.fin_a, user: req.user });
      b = await composerCvg({ debut: q.debut_b, fin: q.fin_b, user: req.user });
      details = {
        periode_a: { debut: q.debut_a, fin: q.fin_a },
        periode_b: { debut: q.debut_b, fin: q.fin_b },
      };
    }
    const resultat = comparerCvg(a, b);
    await journaliserDocument(pool, req, 'INSERTION_CVG_COMPARAISON', null, details);
    return res.json(resultat);
  } catch (err) {
    console.error('[INSERTION][CVG] comparaison :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.get('/completude', VALIDATEURS_PERIODE(), validate, async (req, res) => {
  const { debut, fin } = req.query;
  if (!periodeOuRefus(res, debut, fin)) return undefined;
  try {
    const liste = await composerCompletude({ debut, fin });
    // CORRECTIF m-02 — la liste est NOMINATIVE (NOM Prénom + manques) : sa
    // lecture laisse une trace, tolérante (écran interne). La trace dit la
    // période et le NOMBRE de personnes, jamais qui.
    await journaliser(pool, req, 'INSERTION_CVG_COMPLETUDE', null, trace(debut, fin, { nb_personnes: liste.length }));
    return res.json(liste);
  } catch (err) {
    console.error('[INSERTION][CVG] complétude :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.get('/csv', VALIDATEURS_PERIODE(), validate, async (req, res) => {
  const { debut, fin } = req.query;
  if (!periodeOuRefus(res, debut, fin)) return undefined;
  try {
    const contenu = await composerCvg({ debut, fin, user: req.user });
    const vide = cvgEstVide(contenu);
    if (vide === null) return refusIllisible(res);
    if (vide) return refusVide(res, debut, fin);
    // Journal BLOQUANT, écrit AVANT l'envoi : le fichier ne sort pas sans sa trace.
    await journaliserDocument(pool, req, 'EXPORT_CVG', null, trace(debut, fin, { format: 'csv' }));
    const csv = cvgVersCsv(contenu, { generePar: nomGenerateur(req.user) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="convergence-cvg_${debut}_${fin}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('[INSERTION][CVG] CSV :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Situation de sortie d'un parcours
// ═══════════════════════════════════════════════════════════════════════════

const CHAMPS_SITUATION = [
  'categorie', 'parcours_de_soin', 'habitat_type_sortie', 'rqth_sortie', 'aah_sortie',
  'pension_invalidite_sortie', 'medecin_traitant_sortie', 'couverture_sante_amelioree',
  'accompagnement_post_sortie',
];
const CHAMPS_BOOLEENS = CHAMPS_SITUATION.filter((c) => !['categorie', 'habitat_type_sortie'].includes(c));

async function lireEmploye(employeeId) {
  const r = await pool.query(
    `SELECT id, COALESCE(parcours_num, 1) AS parcours_num, COALESCE(insertion_status, 'none') AS insertion_status
       FROM employees WHERE id = $1`, [employeeId]
  );
  return r.rows[0] || null;
}

async function lireSituation(db, employeeId, parcoursNum) {
  const r = await db.query(
    `SELECT s.id, s.employee_id, s.parcours_num, s.categorie, s.parcours_de_soin, s.habitat_type_sortie,
            s.rqth_sortie, s.aah_sortie, s.pension_invalidite_sortie, s.medecin_traitant_sortie,
            s.couverture_sante_amelioree, s.accompagnement_post_sortie,
            s.saisi_par, s.saisi_at, s.updated_at, s.modifie_par,
            u.first_name, u.last_name, m.first_name AS m_first_name, m.last_name AS m_last_name,
            (SELECT COUNT(*)::int FROM insertion_sortie_cvg_history h WHERE h.situation_id = s.id) AS versions_anterieures
       FROM insertion_sortie_cvg s
       LEFT JOIN users u ON u.id = s.saisi_par
       LEFT JOIN users m ON m.id = s.modifie_par
      WHERE s.employee_id = $1 AND s.parcours_num = $2`, [employeeId, parcoursNum]
  );
  const row = r.rows[0];
  if (!row) return null;
  const {
    first_name: prenom, last_name: nom, m_first_name: mPrenom, m_last_name: mNom, ...reste
  } = row;
  return { ...reste, saisi_par_nom: nomCourt(prenom, nom), modifie_par_nom: nomCourt(mPrenom, mNom) };
}

/**
 * Parcours visé. CORRECTIF m-05 — borné au parcours COURANT de la personne :
 * un `parcours_num` inventé (3 pour quelqu'un qui en est à son premier) créait
 * une ligne orpheline qu'aucun tableau ne relit mais qui porte des données de
 * santé. Renvoie `null` si le numéro demandé dépasse le parcours courant.
 */
const parcoursDe = (req, emp) => {
  const courant = Number(emp.parcours_num) || 1;
  const v = parseInt(req.query.parcours_num ?? req.body?.parcours_num, 10);
  if (!Number.isFinite(v) || v < 1) return courant;
  return v <= courant ? v : null;
};

const refusParcours = (res) => res.status(400).json({
  error: 'Ce parcours n’existe pas pour ce salarié (numéro supérieur à son parcours courant).',
  code: 'PARCOURS_INVALIDE',
});

router.get('/situation-sortie/:employeeId', [
  param('employeeId').isInt({ min: 1 }).withMessage('Identifiant invalide'),
  query('parcours_num').optional().isInt({ min: 1 }).withMessage('parcours_num invalide'),
], validate, async (req, res) => {
  try {
    const empId = Number(req.params.employeeId);
    const emp = await lireEmploye(empId);
    if (!emp) return res.status(404).json({ error: 'Salarié introuvable' });
    const pn = parcoursDe(req, emp);
    if (pn == null) return refusParcours(res);
    const situation = await lireSituation(pool, empId, pn);

    // Proposition : DÉDUITE du dossier, jamais écrite. Chaque valeur porte sa
    // provenance en toutes lettres, pour que la CIP sache ce qu'elle confirme.
    const [bilan, diag, crit, suivi, fiche] = await Promise.all([
      pool.query(
        `SELECT sortie_type FROM insertion_milestones
          WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2 AND milestone_type = 'bilan_sortie'
          ORDER BY (status = 'realise') DESC, COALESCE(completed_date, due_date) DESC NULLS LAST, id DESC
          LIMIT 1`, [empId, pn]),
      pool.query(
        `SELECT habitat_type, logement_statut, rqth, pension_invalidite, medecin_traitant,
                mutuelle_statut, ressources, fse_entree, id AS diag_id
           FROM insertion_diagnostics WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2`, [empId, pn]),
      pool.query(
        `SELECT critere_code FROM employee_eligibilite
          WHERE employee_id = $1 AND critere_code = ANY($2::text[])`, [empId, ['rqth', 'aah']]),
      pool.query(
        `SELECT 1 FROM insertion_milestones
          WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2
            AND milestone_type = 'suivi_post_sortie' AND status = 'realise' LIMIT 1`, [empId, pn]),
      pool.query('SELECT disability_status FROM employees WHERE id = $1', [empId]),
    ]);

    const d = diag.rows[0] || null;
    const criteres = new Set(crit.rows.map((c) => String(c.critere_code)));
    const profil = profilPersonne({ id: empId, ...(d || {}), disability_status: fiche.rows[0]?.disability_status }, criteres, null);
    const proposition = {};
    const source = {};
    const sortieType = bilan.rows[0]?.sortie_type || null;
    const cat = R.transcoderSortieType(sortieType);
    proposition.categorie = cat;
    if (cat) source.categorie = `Déduite du type de sortie « ${sortieType} » du bilan de sortie`;
    proposition.parcours_de_soin = null;
    proposition.habitat_type_sortie = profil.habitat;
    if (profil.habitat) {
      source.habitat_type_sortie = profil.habitat_transcode
        ? "Déduit du statut de logement du diagnostic d'accueil — à confirmer : la situation a pu changer"
        : "Reprend le type d'habitat du diagnostic d'accueil — à confirmer : la situation a pu changer";
    }
    if (profil.rth) {
      proposition.rqth_sortie = true;
      source.rqth_sortie = "RQTH connue à l'entrée (diagnostic, critère d'éligibilité ou fiche du salarié)";
    } else if (d && d.rqth === false && !criteres.has('rqth')) {
      proposition.rqth_sortie = false;
      source.rqth_sortie = "Pas de RQTH déclarée au diagnostic d'accueil";
    } else proposition.rqth_sortie = null;
    proposition.aah_sortie = profil.aah ? true : null;
    if (profil.aah) source.aah_sortie = "AAH connue à l'entrée (critère d'éligibilité ou ressources déclarées)";
    for (const [champ, col, lib] of [
      ['pension_invalidite_sortie', 'pension_invalidite', "Pension d'invalidité"],
      ['medecin_traitant_sortie', 'medecin_traitant', 'Médecin traitant'],
    ]) {
      const v = d && typeof d[col] === 'boolean' ? d[col] : null;
      proposition[champ] = v;
      if (v != null) source[champ] = `${lib} : réponse du diagnostic d'accueil (${v ? 'oui' : 'non'})`;
    }
    proposition.couverture_sante_amelioree = null;
    proposition.accompagnement_post_sortie = suivi.rows.length ? true : null;
    if (suivi.rows.length) source.accompagnement_post_sortie = 'Un entretien de suivi post-sortie a été réalisé';
    proposition.source = source;

    // CORRECTIF m-01 — cette lecture sert, pour une personne NOMMÉE, sa RQTH,
    // son AAH, sa pension et son médecin traitant (et les propose) : trace
    // tolérante, qui dit le parcours lu, jamais les valeurs.
    await journaliser(pool, req, 'INSERTION_SORTIE_CVG_LECTURE', empId, { parcours_num: pn });
    return res.json({ parcours_num: pn, situation, proposition });
  } catch (err) {
    console.error('[INSERTION][CVG] situation de sortie (lecture) :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.put('/situation-sortie/:employeeId', [
  param('employeeId').isInt({ min: 1 }).withMessage('Identifiant invalide'),
  body('parcours_num').optional({ nullable: true }).isInt({ min: 1 }).withMessage('parcours_num invalide'),
  body('categorie').optional({ nullable: true }).isIn(R.SORTIE_CATEGORIES).withMessage('Catégorie de sortie invalide'),
  body('habitat_type_sortie').optional({ nullable: true }).isIn(R.HABITAT_TYPES).withMessage("Type d'habitat invalide"),
  ...CHAMPS_BOOLEENS.map((c) => body(c).optional({ nullable: true }).isBoolean({ strict: true })
    .withMessage(`${c} : oui, non ou vide`)),
], validate, async (req, res) => {
  const empId = Number(req.params.employeeId);
  const presents = CHAMPS_SITUATION.filter((c) => Object.prototype.hasOwnProperty.call(req.body || {}, c));
  if (presents.length === 0) {
    return res.status(400).json({ error: 'Aucun champ de la situation de sortie transmis.', code: 'CORPS_VIDE' });
  }
  let client;
  try {
    const emp = await lireEmploye(empId);
    if (!emp) return res.status(404).json({ error: 'Salarié introuvable' });
    // CORRECTIF m-05 — une situation de sortie n'a de sens que pour une
    // personne qui a (eu) un parcours d'insertion : un permanent n'en a pas.
    if (emp.insertion_status === 'none') {
      return res.status(409).json({
        error: "Ce salarié n'a pas de parcours d'insertion : aucune situation de sortie Convergence ne se saisit pour lui.",
        code: 'SANS_PARCOURS',
      });
    }
    const pn = parcoursDe(req, emp);
    if (pn == null) return refusParcours(res);
    const valeurs = {};
    for (const c of presents) valeurs[c] = req.body[c] === '' ? null : req.body[c];

    client = await pool.connect();
    await client.query('BEGIN');
    // État ANTÉRIEUR, verrouillé : il sert la cohérence du parcours de soin
    // (m-04) et l'historique (m-03).
    const ex = await client.query(
      `SELECT id, ${CHAMPS_SITUATION.join(', ')}, saisi_par, saisi_at, modifie_par, updated_at
         FROM insertion_sortie_cvg WHERE employee_id = $1 AND parcours_num = $2 FOR UPDATE`, [empId, pn]
    );
    const avant = ex.rows[0] || null;

    // CORRECTIF m-04 — « dont parcours de soin » n'existe que sous « autre
    // reconnue positive » : quand la catégorie qui RÉSULTE de la saisie en
    // est une autre, la case est remise à vide — sans quoi un PUT partiel
    // `{ categorie: 'retraite' }` laissait un « oui » que le document comptait.
    const categorieFinale = Object.prototype.hasOwnProperty.call(valeurs, 'categorie')
      ? valeurs.categorie : (avant ? avant.categorie : null);
    if (categorieFinale !== 'autre_positive') {
      const actuel = Object.prototype.hasOwnProperty.call(valeurs, 'parcours_de_soin')
        ? valeurs.parcours_de_soin : (avant ? avant.parcours_de_soin : null);
      if (actuel != null) valeurs.parcours_de_soin = null;
    }
    const champs = Object.keys(valeurs);

    // CORRECTIF m-03 — l'état antérieur est déposé AVANT la modification : la
    // catégorie transmise au semestre précédent reste retrouvable même si
    // l'instantané n'a pas été enregistré. L'auteur initial n'est plus écrasé.
    if (avant) {
      const snapshot = {};
      for (const c of [...CHAMPS_SITUATION, 'saisi_par', 'saisi_at', 'modifie_par', 'updated_at']) snapshot[c] = avant[c] ?? null;
      await client.query(
        `INSERT INTO insertion_sortie_cvg_history (situation_id, employee_id, parcours_num, snapshot, action, changed_by)
         VALUES ($1, $2, $3, $4, 'update', $5)`,
        [avant.id, empId, pn, JSON.stringify(snapshot), req.user?.id ?? null]
      );
    }
    const cols = ['employee_id', 'parcours_num', 'saisi_par', ...champs];
    const params = [empId, pn, req.user?.id ?? null, ...champs.map((c) => valeurs[c])];
    const sets = ['modifie_par = EXCLUDED.saisi_par', 'updated_at = NOW()',
      ...champs.map((c) => `${c} = EXCLUDED.${c}`)];
    await client.query(
      `INSERT INTO insertion_sortie_cvg (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (employee_id, parcours_num) DO UPDATE SET ${sets.join(', ')}`, params
    );
    // La trace dit QUELS champs ont été saisis, jamais leurs VALEURS (santé).
    await journaliserDocument(client, req, 'INSERTION_SORTIE_CVG_ECRITURE', empId,
      { parcours_num: pn, champs, geste: avant ? 'modification' : 'creation' });
    await client.query('COMMIT');
    const situation = await lireSituation(pool, empId, pn);
    return res.json({ parcours_num: pn, situation });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION][CVG] situation de sortie (écriture) :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  } finally {
    if (client) client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Registre des moyens humains (Partie 2)
// ═══════════════════════════════════════════════════════════════════════════

const COLS_RESSOURCE = `id, type, user_id, employee_id, nom, fonction, employeur,
  etp_total::float AS etp_total, etp_accompagnement::float AS etp_accompagnement,
  etp_encadrement::float AS etp_encadrement,
  to_char(date_debut, 'YYYY-MM-DD') AS date_debut, to_char(date_fin, 'YYYY-MM-DD') AS date_fin,
  actif, created_at, updated_at`;

const VALIDATEURS_RESSOURCE = (partiel) => {
  const opt = (ch) => (partiel ? ch.optional() : ch);
  return [
    opt(body('type')).isIn(['interne', 'mutualisee']).withMessage('type : interne ou mutualisee'),
    opt(body('nom')).isString().trim().isLength({ min: 1, max: 150 }).withMessage('nom obligatoire (150 caractères au plus)'),
    body('fonction').optional({ nullable: true }).isString().isLength({ max: 150 }).withMessage('fonction : 150 caractères au plus'),
    body('employeur').optional({ nullable: true }).isString().isLength({ max: 150 }).withMessage('employeur : 150 caractères au plus'),
    ...['etp_total', 'etp_accompagnement', 'etp_encadrement'].map((c) => body(c).optional({ nullable: true })
      .isFloat({ min: 0, max: 2 }).withMessage(`${c} : entre 0 et 2 ETP`)),
    ...['date_debut', 'date_fin'].map((c) => body(c).optional({ nullable: true, checkFalsy: true })
      .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage(`${c} invalide (AAAA-MM-JJ)`)),
    ...['user_id', 'employee_id'].map((c) => body(c).optional({ nullable: true }).isInt({ min: 1 }).withMessage(`${c} invalide`)),
    // CORRECTIF m-06 — `strict` : « "1" » passait `isBoolean()` puis était
    // normalisé à `false` (seuls `true` et `'true'` valaient vrai).
    body('actif').optional({ nullable: true }).isBoolean({ strict: true }).withMessage('actif : vrai ou faux'),
  ];
};

const CHAMPS_RESSOURCE = ['type', 'user_id', 'employee_id', 'nom', 'fonction', 'employeur',
  'etp_total', 'etp_accompagnement', 'etp_encadrement', 'date_debut', 'date_fin', 'actif'];

/** Normalise un corps de ressource ; renvoie `{ valeurs }` ou `{ erreur }`. */
function normaliserRessource(corps, existant = null) {
  const v = {};
  for (const c of CHAMPS_RESSOURCE) {
    if (Object.prototype.hasOwnProperty.call(corps, c)) v[c] = corps[c] === '' ? null : corps[c];
  }
  if (typeof v.nom === 'string') v.nom = v.nom.trim();
  if (v.actif != null) v.actif = v.actif === true || v.actif === 'true';
  const type = v.type ?? (existant && existant.type);
  // Une ressource mutualisée n'a pas de ventilation accompagnement/encadrement
  // dans le formulaire : les deux quotités sont remises à vide.
  if (type === 'mutualisee') { v.etp_accompagnement = null; v.etp_encadrement = null; }
  const total = v.etp_total !== undefined ? v.etp_total : existant && existant.etp_total;
  const part = (x) => (x == null ? 0 : Number(x));
  const acc = v.etp_accompagnement !== undefined ? v.etp_accompagnement : existant && existant.etp_accompagnement;
  const enc = v.etp_encadrement !== undefined ? v.etp_encadrement : existant && existant.etp_encadrement;
  if (total != null && part(acc) + part(enc) > Number(total) + 1e-9) {
    return { erreur: "Les quotités d'accompagnement et d'encadrement dépassent la quotité totale." };
  }
  const debut = v.date_debut !== undefined ? v.date_debut : existant && existant.date_debut;
  const fin = v.date_fin !== undefined ? v.date_fin : existant && existant.date_fin;
  if (debut && fin && String(fin) < String(debut)) return { erreur: 'La date de fin précède la date de début.' };
  return { valeurs: v };
}

/**
 * CORRECTIF m-06 — un `user_id` ou un `employee_id` inexistant répondait 500
 * (violation de clé étrangère 23503) : il est vérifié et refusé en 400.
 * @returns {Promise<string|null>} message d'erreur, ou null
 */
async function referencesInvalides(valeurs) {
  if (valeurs.user_id != null) {
    const r = await pool.query('SELECT 1 FROM users WHERE id = $1', [Number(valeurs.user_id)]);
    if (!r.rows.length) return 'Utilisateur inconnu (user_id).';
  }
  if (valeurs.employee_id != null) {
    const r = await pool.query('SELECT 1 FROM employees WHERE id = $1', [Number(valeurs.employee_id)]);
    if (!r.rows.length) return 'Salarié inconnu (employee_id).';
  }
  return null;
}

// Trace TOLÉRANTE du registre (m-06) : l'acteur, la ressource, les champs —
// jamais les valeurs. Appels écrits en toutes lettres (code littéral) pour que
// la garde anti-dérive des libellés RGPD les recense.

router.get('/ressources', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${COLS_RESSOURCE} FROM insertion_cvg_ressources ORDER BY type, actif DESC, UPPER(nom), id`);
    return res.json(r.rows);
  } catch (err) {
    console.error('[INSERTION][CVG] ressources (liste) :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.post('/ressources', VALIDATEURS_RESSOURCE(false), validate, async (req, res) => {
  const n = normaliserRessource(req.body || {});
  if (n.erreur) return res.status(400).json({ error: n.erreur, code: 'RESSOURCE_INVALIDE' });
  try {
    const refs = await referencesInvalides(n.valeurs);
    if (refs) return res.status(400).json({ error: refs, code: 'RESSOURCE_INVALIDE' });
    const v = { actif: true, ...n.valeurs, created_by: req.user?.id ?? null };
    const cols = Object.keys(v);
    const r = await pool.query(
      `INSERT INTO insertion_cvg_ressources (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${COLS_RESSOURCE}`,
      cols.map((c) => v[c])
    );
    await journalRessources.journaliser(pool, req, 'INSERTION_CVG_RESSOURCE_CREATION', null, { ressource_id: r.rows[0].id, champs: Object.keys(n.valeurs) });
    return res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[INSERTION][CVG] ressources (création) :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.put('/ressources/:id', [
  param('id').isInt({ min: 1 }).withMessage('Identifiant invalide'), ...VALIDATEURS_RESSOURCE(true),
], validate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ex = await pool.query(`SELECT ${COLS_RESSOURCE} FROM insertion_cvg_ressources WHERE id = $1`, [id]);
    if (!ex.rows[0]) return res.status(404).json({ error: 'Ressource introuvable' });
    const n = normaliserRessource(req.body || {}, ex.rows[0]);
    if (n.erreur) return res.status(400).json({ error: n.erreur, code: 'RESSOURCE_INVALIDE' });
    const cols = Object.keys(n.valeurs);
    if (cols.length === 0) return res.json(ex.rows[0]);
    const refs = await referencesInvalides(n.valeurs);
    if (refs) return res.status(400).json({ error: refs, code: 'RESSOURCE_INVALIDE' });
    const r = await pool.query(
      `UPDATE insertion_cvg_ressources SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW()
        WHERE id = $${cols.length + 1} RETURNING ${COLS_RESSOURCE}`,
      [...cols.map((c) => n.valeurs[c]), id]
    );
    await journalRessources.journaliser(pool, req, 'INSERTION_CVG_RESSOURCE_MODIFICATION', null, { ressource_id: id, champs: cols });
    return res.json(r.rows[0]);
  } catch (err) {
    console.error('[INSERTION][CVG] ressources (modification) :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

router.delete('/ressources/:id', [param('id').isInt({ min: 1 }).withMessage('Identifiant invalide')], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM insertion_cvg_ressources WHERE id = $1 RETURNING id', [Number(req.params.id)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Ressource introuvable' });
    await journalRessources.journaliser(pool, req, 'INSERTION_CVG_RESSOURCE_SUPPRESSION', null, { ressource_id: r.rows[0].id, champs: [] });
    return res.json({ id: r.rows[0].id, supprime: true });
  } catch (err) {
    console.error('[INSERTION][CVG] ressources (suppression) :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

module.exports = router;
