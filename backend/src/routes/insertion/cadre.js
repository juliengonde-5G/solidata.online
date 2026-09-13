/**
 * Sous-routeur du module Insertion — squelette posé par l'orchestrateur (PR A).
 * Monté par ./index.js AVANT routes.js ; hérite de authenticate + requireMfa + authorize('ADMIN','RH','MANAGER').
 * Le lot propriétaire remplit ce fichier (contrats : rapports/cip-refonte-2026-09-12/10-contrats-techniques-PR-A.md).
 */
const express = require('express');
const router = express.Router();
module.exports = router;
