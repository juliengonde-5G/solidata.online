// Squelette posé par l'orchestrateur (PR C 2.54.0) — contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md
// Routeur monté par insertion/index.js SOUS authenticate + requireMfa + authorize(ADMIN, RH, MANAGER).
'use strict';
const express = require('express');
const router = express.Router();
router.all('*', (_req, res) => res.status(501).json({ error: 'Non implémenté (PR C en cours)' }));
module.exports = router;
