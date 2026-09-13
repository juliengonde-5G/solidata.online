/**
 * Export FSE+ participants — squelette posé par l'orchestrateur (PR A).
 * Monté sur /api/exports AVANT ./exports ; ne définit que /fse-plus et /fse-plus/bilan.
 * Le lot 2 remplit ce fichier (contrat § 6.2 de 10-contrats-techniques-PR-A.md).
 */
const express = require('express');
const router = express.Router();
module.exports = router;
