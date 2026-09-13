/**
 * Migration PR B — lot 3 « Cadre RSA (structure d'accueil) ». SQUELETTE : le lot 3
 * le remplit selon le contrat 15 § 3 (DDL de référence). Idempotent, client.query
 * uniquement, aucune transaction interne (appelé DANS la transaction d'init-db).
 */
async function run(client) {
  console.log('[INIT-DB] Migration insertion-rsa (PR B lot 3) : squelette, rien à faire ✓');
}

module.exports = { run };
