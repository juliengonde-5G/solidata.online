/**
 * Cadre RSA — structure d'accueil (`/api/insertion/rsa`), PR B, lot 3.
 *
 * ═══ CE QUE CETTE SURFACE TIENT, ET POURQUOI ══════════════════════════════
 *
 * La réforme du RSA (loi pour le plein emploi) confie le contrat d'engagements
 * réciproques à un RÉFÉRENT UNIQUE extérieur : travailleur social du centre
 * médico-social, conseiller France Travail. Solidarité Textiles est **structure
 * d'accueil** (décision de direction du 12/09/2026) : elle n'écrit pas ce
 * contrat, elle l'ALIMENTE. Quatre objets en découlent :
 *
 *   1. LE COMPTEUR D'ACTIVITÉ HEBDOMADAIRE (15-20 h). Il répond à la question
 *      que pose le référent — « combien d'heures cette personne fait-elle ? » —
 *      sans que la CIP recompte à la main. Il ne juge pas : le travail en CDDI
 *      compte (décision 4), une semaine sans relevé de paie n'est jamais une
 *      semaine à zéro heure, et l'alerte ne sonne qu'à deux semaines
 *      consécutives relevées sous le plancher, hors arrêt déclaré.
 *
 *   2. LE RELEVÉ D'ASSIDUITÉ. Rendez-vous proposés, honorés, absences par motif
 *      CATÉGORISÉ. Une absence sans motif s'imprime « motif non renseigné »,
 *      jamais « injustifiée » : le référent peut suspendre des droits sur ce
 *      document, la structure constate, elle n'accuse pas.
 *
 *   3. LA FICHE POUR LE RÉFÉRENT. Composée en LISTE BLANCHE côté serveur
 *      (`services/fiche-referent.js` : neuf rubriques, santé et judiciaire sans
 *      aucune clé), ENREGISTRÉE en snapshot — la preuve de ce qui est sorti ne
 *      peut pas dépendre de l'état actuel du dossier — et refusée quand aucun
 *      référent n'est déterminé : un document sans destinataire n'existe pas.
 *
 *   4. LE REGISTRE D'ACTUALISATION FRANCE TRAVAIL. Un mois par ligne, trois
 *      états (`honoree` NULL = rien de constaté), jamais une déduction.
 *
 * ═══ HABILITATIONS ════════════════════════════════════════════════════════
 * Le routeur parent impose ADMIN/RH/MANAGER ; ce routeur resserre à ADMIN/RH
 * dès sa première ligne, AVANT tout validateur et donc avant toute lecture en
 * base. Un refus posé après la requête serait un refus d'affichage, pas un
 * refus d'accès (doctrine 2.51.0). Statuts sociaux, référent unique et
 * actualisation France Travail sont ADMIN/RH strict : c'est la même famille de
 * données que le dossier administratif de la PR A.
 */

'use strict';

const express = require('express');
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { param, query } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { activiteHebdo } = require('../../services/activite-hebdo');
const { composerFicheReferent, composerReleveAssiduite } = require('../../services/fiche-referent');
const { readInsertionSetting } = require('../../utils/insertion-settings');

const router = express.Router();
router.use(authorize('ADMIN', 'RH'));

const ID = [param('employeeId').isInt().withMessage('Identifiant de salarié invalide')];
const MOMENTS = ['entree', 'renouvellement', 'sortie', 'demande'];
const MODES_REMISE = ['mail', 'courrier', 'main_propre', 'plateforme'];
const JOUR_RE = /^\d{4}-\d{2}-\d{2}$/;
const MOIS_RE = /^\d{4}-\d{2}$/;

/**
 * Journal RGPD de la surface RSA. Ne reçoit JAMAIS de valeur transmise : la
 * trace dit qui a produit ou consulté quel document et sur quelle période —
 * jamais ce que le document raconte. Un journal d'audit qui recopierait le
 * contenu deviendrait une seconde copie de ce qu'il protège.
 */
async function journaliser(req, action, employeeId, details) {
  try {
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user && req.user.id != null ? req.user.id : null, action, 'insertion_rsa', employeeId,
        JSON.stringify({ employee_id: employeeId, ...(details || {}) })]
    );
  } catch (e) {
    console.error(`[INSERTION][RSA] Journalisation ${action} impossible :`, e.message);
  }
}

/** Parcours courant du salarié (repli 1), comme `cadre.js`. */
async function parcoursNum(employeeId) {
  try {
    const r = await pool.query('SELECT COALESCE(parcours_num, 1) AS n FROM employees WHERE id = $1', [employeeId]);
    return r.rows[0] ? Number(r.rows[0].n) || 1 : 1;
  } catch (_) { return 1; }
}

/** Aujourd'hui au format 'AAAA-MM-JJ' (jour civil local du serveur). */
function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Période demandée, bornée et cohérente.
 * Défaut : les 12 derniers mois — c'est la fenêtre que couvre un point de
 * situation ordinaire, et elle évite qu'un appel sans paramètre ne parcoure
 * tout l'historique d'un parcours de deux ans.
 */
function lirePeriode(req) {
  const au = JOUR_RE.test(String(req.query.au || '')) ? String(req.query.au) : aujourdhui();
  let du = JOUR_RE.test(String(req.query.du || '')) ? String(req.query.du) : null;
  if (!du) {
    const d = new Date(`${au}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    du = d.toISOString().slice(0, 10);
  }
  if (du > au) return { erreur: 'La date de début est postérieure à la date de fin.' };
  return { du, au };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /echeances-periodiques — bloc « Rendez-vous réguliers et rappels »
// ═══════════════════════════════════════════════════════════════════════════
//
// Déclaré AVANT les routes `/:employeeId/...` par convention du module (aucun
// conflit de forme ici — un seul segment contre deux —, mais la règle vaut
// d'être tenue : c'est celle qui évite qu'un jour une route littérale soit
// capturée par un paramètre).
router.get('/echeances-periodiques', async (req, res) => {
  const soft = async (label, text, params = []) => {
    try { return (await pool.query(text, params)).rows; }
    catch (err) {
      console.error(`[INSERTION][RSA] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
      return [];
    }
  };
  try {
    const moisMin = Math.max(1, Math.round(Number(await readInsertionSetting('insertion.point_etape_referent_mois')) || 3));
    const now = new Date();
    const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const [actualisations, points, referentsNd] = await Promise.all([
      // Actualisations du mois : toutes les personnes concernées, qu'une ligne
      // existe ou non pour le mois courant (LEFT JOIN) — le bloc doit afficher
      // ce qui RESTE à faire, pas seulement ce qui a été commencé.
      soft('actualisations_ft', `
        SELECT e.id AS employee_id, e.first_name, e.last_name,
               a.rappel_le, a.honoree
          FROM employees e
          LEFT JOIN insertion_actualisations_ft a ON a.employee_id = e.id AND a.mois = $1::date
         WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
           AND (e.actualisation_ft_requise = true OR e.referent_unique_type = 'france_travail')
         ORDER BY UPPER(e.last_name), UPPER(e.first_name)`, [mois]),
      // Dernier contact avec le référent : le plus récent d'un « Point avec le
      // référent » RÉALISÉ et d'une fiche effectivement REMISE. Les deux valent
      // alimentation — ne compter que les entretiens ferait apparaître « jamais
      // de point » sur un dossier où une fiche part chaque trimestre.
      soft('points_referent', `
        SELECT e.id AS employee_id, e.first_name, e.last_name,
               GREATEST(
                 COALESCE(MAX(m.completed_date), '1900-01-01'::date),
                 COALESCE(MAX(a.remis_referent_le), '1900-01-01'::date)
               ) AS dernier_brut
          FROM employees e
          LEFT JOIN insertion_milestones m
                 ON m.employee_id = e.id AND m.milestone_type = 'point_etape_referent' AND m.status = 'realise'
          LEFT JOIN insertion_alimentations_referent a
                 ON a.employee_id = e.id AND a.remis_referent_le IS NOT NULL
         WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
         GROUP BY e.id, e.first_name, e.last_name
         ORDER BY UPPER(e.last_name), UPPER(e.first_name)`),
      soft('referents_non_determines', `
        SELECT id AS employee_id, first_name, last_name
          FROM employees
         WHERE insertion_status = 'en_parcours' AND is_active = true
           AND COALESCE(referent_unique_type, 'non_determine') = 'non_determine'
         ORDER BY UPPER(last_name), UPPER(first_name)`),
    ]);

    // « Dû depuis » : jours écoulés depuis le dernier contact. Un dossier sans
    // aucun contact ne rend PAS un nombre de jours géant (qui trierait la liste
    // de façon absurde) mais `dernier_le: null` — c'est une autre situation,
    // elle se lit autrement.
    const jourMs = 86400000;
    const aujourd = new Date(aujourdhui() + 'T00:00:00Z').getTime();
    const pointsDus = [];
    for (const p of points) {
      const brut = p.dernier_brut ? String(p.dernier_brut).slice(0, 10) : null;
      const dernier = brut && brut > '1900-01-01' ? brut : null;
      const depuis = dernier ? Math.round((aujourd - new Date(`${dernier}T00:00:00Z`).getTime()) / jourMs) : null;
      if (dernier && depuis < moisMin * 30) continue; // dans les clous
      pointsDus.push({
        employee_id: p.employee_id,
        nom: `${(p.last_name || '').toUpperCase()} ${p.first_name || ''}`.trim(),
        dernier_le: dernier,
        du_depuis_jours: depuis,
      });
    }

    // Semaines sous le plancher : agrégat de cohorte. Il est calculé personne
    // par personne (le moteur n'a pas de forme agrégée) et BORNÉ à la cohorte
    // en parcours — c'est-à-dire à quelques dizaines de dossiers, pas à
    // l'historique complet.
    const cohorte = await soft('cohorte', `
      SELECT id, first_name, last_name FROM employees
       WHERE insertion_status = 'en_parcours' AND is_active = true
       ORDER BY UPPER(last_name), UPPER(first_name)`);
    const annee = new Date().getFullYear();
    const employesSousSeuil = [];
    for (const c of cohorte) {
      try {
        const a = await activiteHebdo({ employeeId: c.id, annee });
        if (a.alerte && a.alerte.active) {
          employesSousSeuil.push({
            employee_id: c.id,
            nom: `${(c.last_name || '').toUpperCase()} ${c.first_name || ''}`.trim(),
            nb_semaines: a.nb_semaines_sous_seuil,
          });
        }
      } catch (err) {
        console.error(`[INSERTION][RSA] Activité du salarié ${c.id} illisible : ${err.message}`);
      }
    }

    // Déclaration trimestrielle de ressources : l'échéance est une règle de
    // calendrier, pas une donnée du dossier — elle se dit telle quelle.
    const trimestre = Math.floor(now.getMonth() / 3) + 1;
    const finTrimestre = new Date(Date.UTC(now.getFullYear(), trimestre * 3, 0));

    res.json({
      actualisations_ft_du_mois: actualisations.map((a) => ({
        employee_id: a.employee_id,
        nom: `${(a.last_name || '').toUpperCase()} ${a.first_name || ''}`.trim(),
        rappel_le: a.rappel_le ? String(a.rappel_le).slice(0, 10) : null,
        honoree: a.honoree == null ? null : a.honoree === true,
      })),
      points_referent_dus: pointsDus,
      semaines_sous_seuil: { nb_salaries: employesSousSeuil.length, employes: employesSousSeuil },
      dtr: { trimestre: `T${trimestre} ${now.getFullYear()}`, echeance: finTrimestre.toISOString().slice(0, 10) },
      referents_non_determines: referentsNd.map((r) => ({
        employee_id: r.employee_id,
        nom: `${(r.last_name || '').toUpperCase()} ${r.first_name || ''}`.trim(),
      })),
      periodicite_point_referent_mois: moisMin,
    });
  } catch (err) {
    console.error('[INSERTION][RSA] Erreur échéances périodiques :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:employeeId/activite?annee= — compteur hebdomadaire
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:employeeId/activite', [
  ...ID,
  query('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('Année invalide'),
], validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const annee = req.query.annee ? parseInt(req.query.annee, 10) : new Date().getFullYear();
  try {
    const exist = await pool.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (exist.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });

    const data = await activiteHebdo({ employeeId, annee });
    await journaliser(req, 'INSERTION_ACTIVITE_CONSULTATION', employeeId, {
      annee, nb_semaines_sous_seuil: data.nb_semaines_sous_seuil,
    });
    res.json({ employee_id: employeeId, ...data });
  } catch (err) {
    console.error('[INSERTION][RSA] Erreur activité :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:employeeId/assiduite?du=&au=&variante= — relevé d'assiduité
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:employeeId/assiduite', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const p = lirePeriode(req);
  if (p.erreur) return res.status(400).json({ error: p.erreur });
  // La variante « dossier » ajoute les références de pièces justificatives :
  // elle est demandée EXPLICITEMENT, le défaut reste la version tiers. Un
  // défaut inverse ferait partir une référence de certificat médical au premier
  // appel qui oublie le paramètre.
  const variante = req.query.variante === 'dossier' ? 'dossier' : 'tiers';
  try {
    const releve = await composerReleveAssiduite({ employeeId, du: p.du, au: p.au, variante });
    if (!releve) return res.status(404).json({ error: 'Salarié non trouvé' });
    await journaliser(req, 'INSERTION_ASSIDUITE_CONSULTATION', employeeId, { du: p.du, au: p.au, variante });
    res.json(releve);
  } catch (err) {
    console.error('[INSERTION][RSA] Erreur assiduité :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Fiche pour le référent — aperçu (GET) et génération enregistrée (POST)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Référent déterminé ? Un document sans destinataire n'existe pas (09 § 3.1) :
 * le refus est posé AVANT la composition, pour qu'aucune donnée ne soit lue au
 * profit d'une fiche qui ne partira nulle part.
 */
async function verifierReferent(employeeId) {
  const r = await pool.query(
    `SELECT id, COALESCE(referent_unique_type, 'non_determine') AS type,
            referent_unique_nom
       FROM employees WHERE id = $1`,
    [employeeId]
  );
  if (r.rows.length === 0) return { absent: true };
  const row = r.rows[0];
  if (row.type === 'non_determine') return { nonDetermine: true };
  return { type: row.type, nom: row.referent_unique_nom };
}

router.get('/:employeeId/fiche-referent', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const p = lirePeriode(req);
  if (p.erreur) return res.status(400).json({ error: p.erreur });
  try {
    const ref = await verifierReferent(employeeId);
    if (ref.absent) return res.status(404).json({ error: 'Salarié non trouvé' });
    if (ref.nonDetermine) {
      return res.status(409).json({
        error: "Aucun référent unique n'est déterminé pour cette personne : la fiche ne peut pas être produite.",
        code: 'REFERENT_NON_DETERMINE',
        hint: 'Renseignez le référent unique dans l\'onglet « Dossier administratif », rubrique « Orientation et référent unique ».',
      });
    }
    const contenu = await composerFicheReferent({ employeeId, du: p.du, au: p.au, userId: req.user.id });
    if (!contenu) return res.status(404).json({ error: 'Salarié non trouvé' });
    await journaliser(req, 'INSERTION_FICHE_REFERENT_APERCU', employeeId, { du: p.du, au: p.au });
    res.json({ employee_id: employeeId, apercu: true, contenu });
  } catch (err) {
    console.error('[INSERTION][RSA] Erreur aperçu fiche référent :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:employeeId/fiche-referent', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  const moment = String(b.moment || '').trim();
  if (!MOMENTS.includes(moment)) {
    return res.status(400).json({ error: `Moment invalide (attendu : ${MOMENTS.join(', ')}).` });
  }
  const au = JOUR_RE.test(String(b.au || '')) ? String(b.au) : aujourdhui();
  let du = JOUR_RE.test(String(b.du || '')) ? String(b.du) : null;
  if (!du) {
    const d = new Date(`${au}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    du = d.toISOString().slice(0, 10);
  }
  if (du > au) return res.status(400).json({ error: 'La date de début est postérieure à la date de fin.' });

  try {
    const ref = await verifierReferent(employeeId);
    if (ref.absent) return res.status(404).json({ error: 'Salarié non trouvé' });
    if (ref.nonDetermine) {
      return res.status(409).json({
        error: "Aucun référent unique n'est déterminé pour cette personne : la fiche ne peut pas être produite.",
        code: 'REFERENT_NON_DETERMINE',
        hint: 'Renseignez le référent unique dans l\'onglet « Dossier administratif », rubrique « Orientation et référent unique ».',
      });
    }

    const contenu = await composerFicheReferent({ employeeId, du, au, userId: req.user.id });
    if (!contenu) return res.status(404).json({ error: 'Salarié non trouvé' });

    // Le destinataire est RECOPIÉ au moment de la génération : rattacher la
    // fiche au référent actuel ferait mentir l'historique le jour où il change.
    const ins = await pool.query(
      `INSERT INTO insertion_alimentations_referent
         (employee_id, parcours_num, moment, periode_debut, periode_fin,
          destinataire_type, destinataire_nom, contenu, genere_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, genere_le`,
      [employeeId, await parcoursNum(employeeId), moment, du, au,
        ref.type, ref.nom || null, JSON.stringify(contenu), req.user.id]
    );
    await journaliser(req, 'INSERTION_FICHE_REFERENT_GENERATION', employeeId, {
      alimentation_id: ins.rows[0].id, moment, du, au, destinataire_type: ref.type,
    });
    res.status(201).json({ id: ins.rows[0].id, genere_le: ins.rows[0].genere_le, contenu });
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ error: 'Fiches pour le référent indisponibles : base non migrée.' });
    console.error('[INSERTION][RSA] Erreur génération fiche référent :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Historique des fiches transmises
// ═══════════════════════════════════════════════════════════════════════════
//
// La LISTE ne renvoie JAMAIS `contenu` : afficher l'historique des envois ne
// suppose pas de relire ce qui a été envoyé, et une liste de dix fiches
// chargerait dix snapshots complets à chaque ouverture de l'onglet.
router.get('/:employeeId/alimentations', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const r = await pool.query(
      `SELECT a.id, a.moment, a.periode_debut, a.periode_fin, a.destinataire_type, a.destinataire_nom,
              a.genere_le, a.remis_referent_le, a.remis_referent_mode, a.remis_salarie_le,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS genere_par_nom
         FROM insertion_alimentations_referent a
         LEFT JOIN users u ON u.id = a.genere_par
        WHERE a.employee_id = $1
        ORDER BY a.genere_le DESC, a.id DESC`,
      [employeeId]
    );
    res.json(r.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    console.error('[INSERTION][RSA] Erreur liste alimentations :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/:employeeId/alimentations/:id', [
  ...ID, param('id').isInt().withMessage('Identifiant de fiche invalide'),
], validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const r = await pool.query(
      `SELECT id, moment, periode_debut, periode_fin, destinataire_type, destinataire_nom,
              contenu, genere_le, remis_referent_le, remis_referent_mode, remis_salarie_le
         FROM insertion_alimentations_referent
        WHERE id = $1 AND employee_id = $2`,
      [parseInt(req.params.id, 10), employeeId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Fiche non trouvée' });
    await journaliser(req, 'INSERTION_FICHE_REFERENT_CONSULTATION', employeeId, { alimentation_id: r.rows[0].id });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Fiche non trouvée' });
    console.error('[INSERTION][RSA] Erreur consultation fiche :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Trace de remise — au référent ET à la personne. Champs partiels acceptés :
// la remise au référent et celle à la personne n'ont aucune raison d'être
// saisies au même moment.
router.put('/:employeeId/alimentations/:id/remise', [
  ...ID, param('id').isInt().withMessage('Identifiant de fiche invalide'),
], validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  const sets = [];
  const vals = [];
  const erreurs = [];
  const demain = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

  const dateOuNull = (v, libelle) => {
    if (v === '' || v === null) return null;
    const s = String(v).trim();
    if (!JOUR_RE.test(s)) { erreurs.push(`${libelle} : date attendue au format AAAA-MM-JJ.`); return undefined; }
    // Une remise dans le futur n'est pas une remise : c'est une intention.
    if (s >= demain) { erreurs.push(`${libelle} : une date future ne peut pas attester d'une remise.`); return undefined; }
    return s;
  };
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if ('remis_referent_le' in b) { const d = dateOuNull(b.remis_referent_le, 'Date de remise au référent'); if (d !== undefined) set('remis_referent_le', d); }
  if ('remis_salarie_le' in b) { const d = dateOuNull(b.remis_salarie_le, 'Date de remise à la personne'); if (d !== undefined) set('remis_salarie_le', d); }
  if ('remis_referent_mode' in b) {
    const v = b.remis_referent_mode;
    if (v === '' || v === null) set('remis_referent_mode', null);
    else if (!MODES_REMISE.includes(String(v))) erreurs.push(`Mode de remise invalide (attendu : ${MODES_REMISE.join(', ')}).`);
    else set('remis_referent_mode', String(v));
  }

  if (erreurs.length > 0) return res.status(400).json({ error: erreurs[0], erreurs });
  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

  set('remise_par', req.user.id);
  vals.push(parseInt(req.params.id, 10), employeeId);
  try {
    const r = await pool.query(
      `UPDATE insertion_alimentations_referent SET ${sets.join(', ')}
        WHERE id = $${vals.length - 1} AND employee_id = $${vals.length}
        RETURNING id, remis_referent_le, remis_referent_mode, remis_salarie_le`,
      vals
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Fiche non trouvée' });
    await journaliser(req, 'INSERTION_FICHE_REFERENT_REMISE', employeeId, {
      alimentation_id: r.rows[0].id,
      referent: r.rows[0].remis_referent_le != null,
      salarie: r.rows[0].remis_salarie_le != null,
    });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[INSERTION][RSA] Erreur remise fiche :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Actualisation mensuelle France Travail
// ═══════════════════════════════════════════════════════════════════════════
//
// Douze lignes rendues, une par mois de l'année : les mois SANS ligne
// remontent à `null` partout et jamais à `false`. C'est la règle de fond de
// cette table — un « non honorée » déduit du silence accuserait la personne
// d'un manquement que personne n'a constaté, et c'est ce constat qui peut
// fonder une suspension de droits.
router.get('/:employeeId/actualisations-ft', [
  ...ID,
  query('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('Année invalide'),
], validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const annee = req.query.annee ? parseInt(req.query.annee, 10) : new Date().getFullYear();
  try {
    let lignes = [];
    try {
      const r = await pool.query(
        `SELECT mois, rappel_le, honoree, constat_le
           FROM insertion_actualisations_ft
          WHERE employee_id = $1 AND EXTRACT(YEAR FROM mois) = $2
          ORDER BY mois`,
        [employeeId, annee]
      );
      lignes = r.rows;
    } catch (err) { if (err.code !== '42P01') throw err; }

    const parMois = new Map(lignes.map((l) => [Number(String(l.mois).slice(5, 7)), l]));
    const mois = [];
    for (let m = 1; m <= 12; m += 1) {
      const l = parMois.get(m);
      mois.push({
        mois: `${annee}-${String(m).padStart(2, '0')}`,
        rappel_le: l && l.rappel_le ? String(l.rappel_le).slice(0, 10) : null,
        honoree: l && l.honoree != null ? l.honoree === true : null,
        constat_le: l && l.constat_le ? String(l.constat_le).slice(0, 10) : null,
      });
    }
    res.json({ employee_id: employeeId, annee, mois });
  } catch (err) {
    console.error('[INSERTION][RSA] Erreur actualisations FT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:employeeId/actualisations-ft/:mois', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const moisParam = String(req.params.mois || '');
  if (!MOIS_RE.test(moisParam)) return res.status(400).json({ error: 'Mois invalide (attendu AAAA-MM).' });
  const moisDate = `${moisParam}-01`;

  const b = req.body || {};
  const dateOuNull = (v, libelle, erreurs) => {
    if (v === undefined || v === '' || v === null) return null;
    const s = String(v).trim();
    if (!JOUR_RE.test(s)) { erreurs.push(`${libelle} : date attendue au format AAAA-MM-JJ.`); return undefined; }
    return s;
  };
  const erreurs = [];
  const rappelLe = 'rappel_le' in b ? dateOuNull(b.rappel_le, 'Date de rappel', erreurs) : undefined;
  const constatLe = 'constat_le' in b ? dateOuNull(b.constat_le, 'Date de constat', erreurs) : undefined;
  let honoree;
  if ('honoree' in b) {
    const v = b.honoree;
    if (v === null || v === '') honoree = null;
    else if (v === true || v === 'true' || v === 'oui') honoree = true;
    else if (v === false || v === 'false' || v === 'non') honoree = false;
    else erreurs.push('Actualisation honorée : valeur attendue « oui », « non » ou vide.');
  }
  if (erreurs.length > 0) return res.status(400).json({ error: erreurs[0], erreurs });
  if (rappelLe === undefined && constatLe === undefined && honoree === undefined) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }

  try {
    const emp = await pool.query(
      `SELECT COALESCE(referent_unique_type, 'non_determine') AS type,
              COALESCE(actualisation_ft_requise, false) AS requise
         FROM employees WHERE id = $1`,
      [employeeId]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    // Tenir un registre d'actualisation pour une personne qui n'a pas à
    // s'actualiser produirait un « manquement » sur une obligation qui n'existe
    // pas : le refus est explicite, et il dit comment l'ouvrir.
    if (emp.rows[0].type !== 'france_travail' && emp.rows[0].requise !== true) {
      return res.status(409).json({
        error: "Cette personne n'est pas soumise à l'actualisation mensuelle France Travail.",
        code: 'ACTUALISATION_FT_NON_REQUISE',
        hint: 'Cochez « Actualisation mensuelle France Travail requise » dans l\'onglet « Dossier administratif » si elle l\'est.',
      });
    }

    // Upsert : un champ ABSENT du corps est laissé intact (COALESCE sur
    // EXCLUDED) — l'écran enregistre le rappel et le constat séparément, à des
    // semaines d'intervalle. `honoree` fait exception : la reposer à NULL est
    // un geste légitime (« finalement je ne sais pas »), donc elle s'écrit
    // telle quelle quand la clé est présente.
    await pool.query(
      `INSERT INTO insertion_actualisations_ft (employee_id, mois, rappel_le, rappel_par, honoree, constat_le)
       VALUES ($1, $2::date, $3, $4, $5, $6)
       ON CONFLICT (employee_id, mois) DO UPDATE SET
         rappel_le = CASE WHEN $7 THEN EXCLUDED.rappel_le ELSE insertion_actualisations_ft.rappel_le END,
         rappel_par = CASE WHEN $7 THEN EXCLUDED.rappel_par ELSE insertion_actualisations_ft.rappel_par END,
         honoree = CASE WHEN $8 THEN EXCLUDED.honoree ELSE insertion_actualisations_ft.honoree END,
         constat_le = CASE WHEN $9 THEN EXCLUDED.constat_le ELSE insertion_actualisations_ft.constat_le END`,
      [employeeId, moisDate,
        rappelLe === undefined ? null : rappelLe,
        rappelLe === undefined ? null : req.user.id,
        honoree === undefined ? null : honoree,
        constatLe === undefined ? null : constatLe,
        rappelLe !== undefined, honoree !== undefined, constatLe !== undefined]
    );

    // Recalcul des deux colonnes de synthèse d'`employees` (elles alimentent
    // l'en-tête de fiche et le dossier administratif). Elles sont un CACHE de
    // cette table : les recalculer à chaque écriture évite qu'elles dérivent.
    await pool.query(
      `UPDATE employees e SET
         actualisation_ft_derniere_date = s.derniere,
         actualisation_ft_rappels_non_honores = s.non_honores
       FROM (
         SELECT MAX(mois) FILTER (WHERE honoree = true) AS derniere,
                COUNT(*) FILTER (WHERE honoree = false)::int AS non_honores
           FROM insertion_actualisations_ft WHERE employee_id = $1
       ) s
       WHERE e.id = $1`,
      [employeeId]
    );

    await journaliser(req, 'INSERTION_ACTUALISATION_FT_MAJ', employeeId, {
      mois: moisParam,
      champs: [rappelLe !== undefined && 'rappel_le', honoree !== undefined && 'honoree',
        constatLe !== undefined && 'constat_le'].filter(Boolean),
    });

    const r = await pool.query(
      `SELECT mois, rappel_le, honoree, constat_le FROM insertion_actualisations_ft
        WHERE employee_id = $1 AND mois = $2::date`,
      [employeeId, moisDate]
    );
    const l = r.rows[0] || {};
    res.json({
      employee_id: employeeId,
      mois: moisParam,
      rappel_le: l.rappel_le ? String(l.rappel_le).slice(0, 10) : null,
      honoree: l.honoree == null ? null : l.honoree === true,
      constat_le: l.constat_le ? String(l.constat_le).slice(0, 10) : null,
    });
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ error: 'Registre d\'actualisation indisponible : base non migrée.' });
    console.error('[INSERTION][RSA] Erreur actualisation FT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
