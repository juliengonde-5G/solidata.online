/**
 * Échéances de la CIP — `/api/insertion/echeances` (PR C, lot 5).
 * Contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md § 5.1.
 *
 * ═══ CE QUE CETTE SURFACE SERT ════════════════════════════════════════════
 *
 * UN SEUL APPEL pour tout l'écran « Mes échéances ». L'ancien tableau de bord
 * en faisait trois (cohorte, renouvellements, cadre RSA), chacun avec son
 * chargement et son bandeau d'erreur : le lundi matin, la conseillère voyait
 * l'écran se composer en trois temps et devait deviner lequel des trois blocs
 * manquait quand l'un d'eux échouait. Ici, chaque source est `soft` : celle
 * qui tombe vide SON bloc et se NOMME dans `sources_indisponibles` — jamais un
 * 500, jamais un bloc vide qui se lirait « rien à faire ».
 *
 * ═══ HABILITATIONS ════════════════════════════════════════════════════════
 * Le routeur parent impose ADMIN/RH (MANAGER retiré de l'application sur main
 * le 10/09/2026 — fusion du 25/09/2026 : ce qui suit sur le MANAGER est une
 * garde morte, conservée). Les familles d'obligations
 * adossées à un statut social (sortie FSE+, questionnaire d'entrée, catégorie
 * France Travail, heures relevées) ne sont pas CALCULÉES pour un MANAGER : les
 * requêtes ne partent pas. Le REPORT, lui, est resserré ADMIN/RH dès la
 * première ligne de la route — reporter une obligation contrôlée par l'autorité
 * est un acte de la CIP, pas un geste d'encadrement d'atelier.
 */

'use strict';

const express = require('express');
const pool = require('../../config/database');
const { authorize, resolveBaseRole } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { journalPour } = require('../../utils/insertion-journal');
const {
  composerEcheances, compteurRouges, viderCacheCompteur, sqlPerimetreFileActive,
  TYPES_OBLIGATIONS, TYPES_OBLIGATIONS_CLES, MOTIFS_REPORT,
} = require('../../services/echeances-cip');
const { readInsertionSetting } = require('../../utils/insertion-settings');

const router = express.Router();
const { journaliser, journaliserDocument } = journalPour('insertion_echeances', '[INSERTION][ECHEANCES]');

const baseRoleOf = (req) => resolveBaseRole(req.user && req.user.role);
const estMine = (req) => req.query.mine === '1' || req.query.mine === 'true';

// Types AGRÉGÉS : ils ne nomment personne, donc ils ne se reportent pas pour
// « un » salarié — il n'y en a pas.
const TYPES_AGREGES = new Set(TYPES_OBLIGATIONS.filter((t) => t.agregee).map((t) => t.type));

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/insertion/echeances — l'écran entier
// ═══════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const donnees = await composerEcheances({
      db: pool, baseRole: baseRoleOf(req), userId: req.user && req.user.id, mine: estMine(req),
    });
    // Journal TOLÉRANT : c'est une consultation d'écran interne. Le geste est
    // tracé (qui a ouvert la liste, combien de lignes rouges), jamais son
    // contenu — aucun nom, aucun type d'obligation nominatif.
    await journaliser(pool, req, 'INSERTION_ECHEANCES_CONSULTATION', null, {
      perimetre: estMine(req) ? 'mes_salaries' : 'structure',
      nb_obligations: donnees.obligations.length,
      nb_rouges: donnees.compteur_rouges,
    });
    res.json(donnees);
  } catch (err) {
    console.error('[INSERTION][ECHEANCES] Erreur composition :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/insertion/echeances/compteur — la pastille de la barre latérale
// ═══════════════════════════════════════════════════════════════════════════
//
// Pas de journalisation : la barre latérale l'appelle à chaque montage de
// page. Inscrire chaque montage au registre RGPD le noierait sous des lignes
// qui ne disent rien d'un accès à une donnée personnelle (la réponse est un
// entier). Les consultations RÉELLES de l'écran sont, elles, tracées.
router.get('/compteur', async (req, res) => {
  try {
    const r = await compteurRouges({
      db: pool, baseRole: baseRoleOf(req), userId: req.user && req.user.id, mine: estMine(req),
    });
    res.json({ rouges: r.rouges });
  } catch (err) {
    console.error('[INSERTION][ECHEANCES] Erreur compteur :', err.message);
    // Une pastille indisponible n'est pas une panne d'application : la barre
    // latérale s'affiche sans badge plutôt qu'avec un bandeau d'erreur.
    res.status(200).json({ rouges: 0, indisponible: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/insertion/echeances/report — reporter une obligation de 48 h
// ═══════════════════════════════════════════════════════════════════════════
//
// ADMIN/RH STRICT, posé AVANT tout validateur : un refus placé après la
// lecture serait un refus d'affichage, pas un refus d'accès.
router.post('/report', authorize('ADMIN', 'RH'), [
  body('employee_id').isInt({ min: 1 }).withMessage('Identifiant de salarié invalide'),
  body('type').isString().trim().notEmpty().isLength({ max: 40 }).withMessage("Type d'obligation requis"),
  body('motif').optional({ nullable: true }).isIn(MOTIFS_REPORT)
    .withMessage(`Motif invalide (${MOTIFS_REPORT.join(', ')})`),
], validate, async (req, res) => {
  let client;
  try {
    const employeeId = parseInt(req.body.employee_id, 10);
    const type = String(req.body.type).trim();
    const motif = req.body.motif == null || req.body.motif === '' ? null : String(req.body.motif);

    if (!TYPES_OBLIGATIONS_CLES.includes(type)) {
      return res.status(400).json({
        error: "Ce type d'obligation n'existe pas.",
        code: 'TYPE_INCONNU', types_acceptes: TYPES_OBLIGATIONS_CLES,
      });
    }
    if (TYPES_AGREGES.has(type)) {
      return res.status(400).json({
        error: "Cette ligne est agrégée : elle ne désigne aucun salarié en particulier et ne peut pas être reportée.",
        code: 'LIGNE_AGREGEE',
      });
    }

    // CORRECTIF m-04 — le report acceptait N'IMPORTE QUEL salarié existant, y
    // compris un permanent (qui n'a pas de parcours) ou quelqu'un qui ne porte
    // pas cette obligation : la ligne était créée, journalisée, et le compteur
    // de reports s'incrémentait pour rien — le motif devenant obligatoire au
    // geste suivant sur un dossier où rien n'avait jamais été reporté.
    const moisTermines = await readInsertionSetting('insertion.file_active_terminees_mois');
    const emp = await pool.query(
      `SELECT id FROM employees e
        WHERE e.id = $1 AND ${sqlPerimetreFileActive({ alias: 'e', moisTermines })}`,
      [employeeId]
    );
    if (emp.rows.length === 0) {
      return res.status(404).json({
        error: "Salarié non trouvé dans la file active : un report ne porte que sur un parcours d'insertion.",
        code: 'HORS_FILE_ACTIVE',
      });
    }

    // Nombre de reports DÉJÀ posés sur ce couple (salarié, type). C'est lui qui
    // rend le motif obligatoire à partir du deuxième : un premier report est un
    // aléa, le deuxième est une situation qu'il faut nommer.
    const deja = await pool.query(
      'SELECT COUNT(*)::int AS n FROM insertion_echeance_reports WHERE employee_id = $1 AND echeance_type = $2',
      [employeeId, type]
    );
    const nbAvant = Number(deja.rows[0] && deja.rows[0].n) || 0;
    if (nbAvant >= 1 && !motif) {
      return res.status(409).json({
        error: 'Cette obligation a déjà été reportée : indiquez pourquoi elle l’est à nouveau.',
        code: 'MOTIF_REQUIS',
        motifs_acceptes: MOTIFS_REPORT,
        nb_reports: nbAvant,
      });
    }

    const heures = Math.round(Number(await readInsertionSetting('insertion.report_echeance_heures')) || 48);

    // `pool.connect()` DANS le `try` (doctrine § 2.3 — corrigée deux fois,
    // PR A et PR B : un `connect()` hors du try laisse une connexion du pool
    // définitivement prise quand il rejette).
    client = await pool.connect();
    let ligne;
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO insertion_echeance_reports
           (employee_id, echeance_type, reporte_jusqu_au, motif, created_by)
         VALUES ($1, $2, NOW() + make_interval(hours => $3), $4, $5)
         RETURNING id, reporte_jusqu_au`,
        [employeeId, type, heures, motif, req.user && req.user.id]
      );
      ligne = ins.rows[0];
      // Journal BLOQUANT : reporter, c'est faire sortir une ligne du champ de
      // vision de la CIP pendant 48 h sur une obligation que l'autorité
      // contrôle. Sans trace, personne ne saurait qu'elle l'a été.
      await journaliserDocument(client, req, 'INSERTION_ECHEANCE_REPORT', employeeId, {
        echeance_type: type, motif, heures, nb_reports: nbAvant + 1,
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }

    // Le compteur de la barre latérale doit retomber TOUT DE SUITE : sinon la
    // pastille contredit l'écran pendant une minute, et c'est la pastille qu'on
    // croit (elle est toujours visible).
    viderCacheCompteur();

    res.status(201).json({ reporte_jusqu_au: ligne.reporte_jusqu_au, nb_reports: nbAvant + 1 });
  } catch (err) {
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Motif rejeté par une contrainte de la base', code: err.code });
    }
    console.error('[INSERTION][ECHEANCES] Erreur report :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
