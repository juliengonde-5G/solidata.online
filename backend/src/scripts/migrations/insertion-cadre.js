/**
 * Migration idempotente — squelette posé par l'orchestrateur (PR A « Conformité immédiate »).
 * Le lot propriétaire remplit `run(client)` : `client.query` uniquement, aucune transaction interne
 * (init-db.js appelle ce module DANS sa transaction), chaque instruction rejouable (IF NOT EXISTS / DO-scan).
 */
async function run(client) { // eslint-disable-line no-unused-vars
  // à remplir par le lot propriétaire
}
module.exports = { run };
