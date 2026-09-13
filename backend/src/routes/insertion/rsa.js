/**
 * PR B — Cadre RSA (structure d'accueil) : compteur d'activité hebdomadaire,
 * relevé d'assiduité, fiche pour le référent, actualisation France Travail,
 * échéances périodiques. SQUELETTE posé par l'orchestrateur — le lot 3 le remplit
 * (contrats : rapports/cip-refonte-2026-09-12/15-contrats-techniques-PR-B.md § 5.1).
 * Monté sur /api/insertion/rsa (authenticate + requireMfa hérités de index.js).
 */
const express = require('express');
const { authorize } = require('../../middleware/auth');

const router = express.Router();
router.use(authorize('ADMIN', 'RH'));

module.exports = router;
