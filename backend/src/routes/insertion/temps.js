/**
 * PR B — Temps d'accompagnement : feuille de temps mensuelle par intervenant et
 * par projet (export (c) de l'autorité). SQUELETTE posé par l'orchestrateur — le
 * lot 4 le remplit (contrats 15 § 5.2). Monté sur /api/insertion/temps.
 * Garde : ADMIN/RH tout ; MANAGER uniquement sa propre feuille (userId === req.user.id).
 */
const express = require('express');

const router = express.Router();

module.exports = router;
