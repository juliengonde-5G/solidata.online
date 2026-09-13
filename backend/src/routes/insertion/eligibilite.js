/**
 * Référentiel ADMINISTRABLE des critères d'éligibilité IAE
 * (`/api/insertion/eligibilite-criteres`).
 *
 * Monté par ./index.js — hérite de `authenticate + requireMfa +
 * authorize('ADMIN','RH','MANAGER')`. La LECTURE reste ouverte aux trois rôles :
 * les libellés sont un référentiel public de l'outil, ils ne disent rien d'une
 * personne. L'ÉCRITURE est réservée à l'ADMIN — ajouter ou renommer un critère
 * change la signification de toutes les lignes déjà saisies et de la colonne
 * correspondante dans les exports à destination de l'autorité.
 *
 * Un critère ne se SUPPRIME pas : il se DÉSACTIVE (`actif = false`). Une
 * suppression casserait la clé étrangère de `employee_eligibilite` — donc
 * l'historique de ce qui a été constaté, qui est précisément la pièce que
 * l'autorité demande.
 */

'use strict';

const express = require('express');

const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/validate');

const CODE_RE = /^[a-z0-9_]{2,30}$/;

// GET / — le référentiel complet (actifs ET inactifs : l'écran de réglages doit
// pouvoir réactiver un critère, et une fiche ancienne peut porter un critère
// depuis désactivé — le masquer la rendrait incompréhensible).
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT code, libelle, ordre, actif FROM insertion_eligibilite_criteres ORDER BY ordre, code'
    );
    res.json(r.rows);
  } catch (err) {
    // Base non migrée : liste vide plutôt qu'une erreur — l'écran s'ouvre et
    // dit « aucun critère », il ne se casse pas.
    if (err.code === '42P01') return res.json([]);
    console.error('[INSERTION] Erreur eligibilite-criteres GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST / — nouveau critère (ADMIN).
router.post('/', authorize('ADMIN'), [
  body('code').isString().trim().matches(CODE_RE)
    .withMessage('Code invalide (2 à 30 caractères : minuscules, chiffres, tiret bas)'),
  body('libelle').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Libellé requis (120 caractères maximum)'),
  body('ordre').optional({ nullable: true }).isInt({ min: 0, max: 999 }).withMessage('Ordre invalide'),
  body('actif').optional({ nullable: true }).isBoolean().withMessage('Actif invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      `INSERT INTO insertion_eligibilite_criteres (code, libelle, ordre, actif)
       VALUES ($1, $2, $3, $4) RETURNING code, libelle, ordre, actif`,
      [String(req.body.code).trim(), String(req.body.libelle).trim(),
        req.body.ordre == null ? 0 : parseInt(req.body.ordre, 10),
        req.body.actif === undefined ? true : !!req.body.actif]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce code de critère existe déjà.' });
    console.error('[INSERTION] Erreur eligibilite-criteres POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /:code — libellé, ordre, activation (ADMIN). Le CODE n'est jamais
// modifiable : c'est la clé étrangère des constats déjà enregistrés.
router.put('/:code', authorize('ADMIN'), [
  param('code').isString().trim().matches(CODE_RE).withMessage('Code invalide'),
  body('libelle').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('Libellé invalide'),
  body('ordre').optional({ nullable: true }).isInt({ min: 0, max: 999 }).withMessage('Ordre invalide'),
  body('actif').optional({ nullable: true }).isBoolean().withMessage('Actif invalide'),
], validate, async (req, res) => {
  const sets = [];
  const vals = [];
  if ('libelle' in req.body) { vals.push(String(req.body.libelle).trim()); sets.push(`libelle = $${vals.length}`); }
  if ('ordre' in req.body) { vals.push(parseInt(req.body.ordre, 10) || 0); sets.push(`ordre = $${vals.length}`); }
  if ('actif' in req.body) { vals.push(!!req.body.actif); sets.push(`actif = $${vals.length}`); }
  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
  try {
    vals.push(req.params.code);
    const r = await pool.query(
      `UPDATE insertion_eligibilite_criteres SET ${sets.join(', ')} WHERE code = $${vals.length}
       RETURNING code, libelle, ordre, actif`,
      vals
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Critère non trouvé' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur eligibilite-criteres PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
