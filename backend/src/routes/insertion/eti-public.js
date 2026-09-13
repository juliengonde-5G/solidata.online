// Squelette posé par l'orchestrateur (PR C 2.54.0) — contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md
// Routeur PUBLIC (monté /api/eti par index.js SANS authenticate, rate-limité) — § 5.3 du contrat.
'use strict';
const express = require('express');
const router = express.Router();
router.all('*', (_req, res) => res.status(404).json({ error: 'Lien inconnu' }));
module.exports = router;
