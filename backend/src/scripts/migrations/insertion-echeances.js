// Squelette posé par l'orchestrateur (PR C 2.54.0) — contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md
// Contrat d'exécution : run(client) appelé par init-db.js DANS sa transaction — client.query seulement,
// aucun BEGIN/COMMIT, chaque instruction rejouable (IF NOT EXISTS, DO-scan pg_constraint, NOT EXISTS).
'use strict';
async function run(_client) { /* DDL § 3 du contrat — à implémenter par le lot */ }
module.exports = { run };
