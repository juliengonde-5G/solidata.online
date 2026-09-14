// Squelette posé par l'orchestrateur (PR D 2.55.0) — contrat : rapports/cip-refonte-2026-09-12/25-contrats-techniques-PR-D.md
// Monté par insertion/index.js SOUS authenticate + requireMfa + authorize(ADMIN, RH, MANAGER).
'use strict';
const express = require('express');
const router = express.Router();
router.all('*', (_req, res) => res.status(501).json({ error: 'Non implémenté (PR D en cours)' }));
module.exports = router;
