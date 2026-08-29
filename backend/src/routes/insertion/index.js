/**
 * Module Insertion — Point d'entrée
 * Découpage du fichier monolithique insertion.js en sous-modules :
 *   - engine.js : base de connaissances, questionnaires, moteur d'analyse IA
 *   - routes.js : toutes les routes API (diagnostics, jalons, plans d'action)
 *
 * SCHÉMA — SOURCE UNIQUE : les tables insertion_diagnostics /
 * insertion_milestones / cip_action_plans / insertion_interview_alerts
 * (+ colonnes employees.insertion_*) sont créées et migrées UNIQUEMENT dans
 * backend/src/scripts/init-db.js. L'ancienne IIFE d'auto-migration qui vivait
 * ici a été retirée en Vague 3 (audit 2026-07) : elle dupliquait le schéma et
 * divergeait d'init-db.js (colonnes pcm_q_* omises, un type de jalon vestige
 * jamais utilisé, freins recréés sans CHECK…) — cause racine du bug de prod 2.3.2
 * (« column ... does not exist »). Toutes ses colonnes/migrations sont
 * désormais couvertes de façon idempotente par init-db.js (section « Module
 * Parcours Insertion » + migrations de colonnes rapatriées).
 */
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth');
const { requireMfa } = require('../../middleware/mfa');

// Auth middleware for all insertion routes
// Double authentification (2.43.0) : pour les rôles soumis (settings
// « securite.mfa_roles », défaut ADMIN/RH/DPO/PCM), la session doit avoir
// franchi le défi TOTP. No-op intégral pour les autres rôles.
router.use(authenticate, requireMfa, authorize('ADMIN', 'RH', 'MANAGER'));

// Mount routes
const routes = require('./routes');
router.use('/', routes);

module.exports = router;
