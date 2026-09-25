// ═══════════════════════════════════════════════════════════════════════════
// Lot 2.60.0 « Suivi Convergence (programme CVG) » — socle des preuves sur
// PostgreSQL RÉEL.
// ───────────────────────────────────────────────────────────────────────────
// Le lot a été livré avec 28 unitaires du composeur, 27 tests de contrat et
// 9 tests de migration — tous sur un `pg` SIMULÉ. Or le composeur Convergence
// lit huit sources différentes, dont un `LEFT JOIN LATERAL` de dernière
// évaluation, un `EXISTS` sur les contrats à la date de fin et un `ON CONFLICT`
// d'upsert ; la migration reconstruit un CHECK par relecture de
// `pg_get_constraintdef` et élargit une colonne. Un mock rend des lignes quelle
// que soit la validité du SQL : il ne connaît ni les CHECK, ni les UNIQUE, ni la
// façon dont le pilote rend une colonne DATE, ni le fuseau du processus.
//
// EXÉCUTION — ignorées tant que `PR_E_E2E_DB=1` (ou `PR_A/B/C/D_E2E_DB=1`)
// n'est pas fourni, pour que `npx jest` reste vert sans base :
//   source <scratchpad>/db-test.env
//   cd backend && PR_E_E2E_DB=1 npx jest tests/e2e-pr-e --runInBand
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

// Le socle de la PR D (lui-même bâti sur ceux des PR C et B) est RÉUTILISÉ :
// jetons MFA, comptes par rôle, salarié minimal, purges, journal par action.
const base = require('../e2e-pr-d/_helpers');

const RUN = process.env.PR_E_E2E_DB === '1'
  || process.env.PR_D_E2E_DB === '1'
  || process.env.PR_C_E2E_DB === '1'
  || process.env.PR_B_E2E_DB === '1'
  || process.env.PR_A_E2E_DB === '1';

const { pool } = base;

/**
 * Purge du périmètre du lot Convergence. `insertion_sortie_cvg` est en CASCADE
 * sur `employees`, mais les instantanés CVG (`insertion_dialogues_gestion`
 * type 'cvg') et le registre des moyens humains ne le sont sur rien : une suite
 * qui compare des totaux doit partir d'un état connu.
 */
async function purgerPrE(pool_, { matricules = [], usernamePrefix, ressourcesPrefix } = {}) {
  await pool_.query("DELETE FROM insertion_dialogues_gestion WHERE type = 'cvg'").catch(() => {});
  if (ressourcesPrefix) {
    await pool_.query('DELETE FROM insertion_cvg_ressources WHERE nom LIKE $1', [`${ressourcesPrefix}%`]).catch(() => {});
  }
  if (matricules.length) {
    const r = await pool_.query('SELECT id FROM employees WHERE malibou_id = ANY($1::text[])', [matricules]);
    const ids = r.rows.map((x) => x.id);
    if (ids.length) {
      for (const t of ['insertion_sortie_cvg', 'insertion_echeance_reports']) {
        await pool_.query(`DELETE FROM ${t} WHERE employee_id = ANY($1::int[])`, [ids]).catch(() => {});
      }
    }
  }
  await base.purgerPrD(pool_, { matricules, usernamePrefix });
}

/** Insertion générique (colonnes du littéral), rend l'id. */
async function ins(table, obj) {
  const cols = Object.keys(obj);
  const r = await pool.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((c) => obj[c])
  );
  return r.rows[0] && r.rows[0].id;
}

module.exports = {
  ...base,
  RUN,
  purgerPrE,
  ins,
};
