// ═══════════════════════════════════════════════════════════════════════════
// PR C « Section CIP et documents du salarié » — socle des preuves sur
// PostgreSQL RÉEL.
// ───────────────────────────────────────────────────────────────────────────
// Les suites de `tests/contract/` montent les VRAIS routeurs sur un `pg`
// SIMULÉ : le mock rend des lignes quelle que soit la validité du SQL et ne
// connaît ni les CHECK, ni les UNIQUE, ni les types, ni la façon dont le
// pilote convertit `DATE` / `TIMESTAMP` en objet JavaScript, ni le fuseau du
// processus. Les défauts de cette famille (une heure rendue en UTC là où
// l'écran annonce Paris, un JSONB stocké qui porte une clé que la fonction
// n'a pas rendue, une fuite de connexion sur un refus) sont structurellement
// invisibles sous ce filet.
//
// EXÉCUTION — ignorées tant que `PR_C_E2E_DB=1` (ou `PR_A_E2E_DB=1` /
// `PR_B_E2E_DB=1`) n'est pas fourni, pour que `npx jest` reste vert sans base :
//   source <scratchpad>/db-test.env
//   cd backend && PR_C_E2E_DB=1 npx jest tests/e2e-pr-c --runInBand
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

// Le socle de la PR B est RÉUTILISÉ tel quel (jetons MFA, comptes par rôle,
// purge de périmètre, salarié minimal, photographie du pool, `iso()`) : le
// recopier produirait deux socles qui divergeraient au premier correctif.
const base = require('../e2e-pr-b/_helpers');

const RUN = process.env.PR_C_E2E_DB === '1'
  || process.env.PR_B_E2E_DB === '1'
  || process.env.PR_A_E2E_DB === '1';

const { isoDate, aujourdhuiParis, decalerJours } = require('../../src/utils/date-iso');

/** Jour civil de Paris décalé de N jours — le repère du moteur d'échéances. */
function jourParisDecale(n) {
  return decalerJours(aujourdhuiParis(), n);
}

/**
 * Purge du périmètre PR C : les tables du lot 5 et du lot 7 ne sont pas toutes
 * en CASCADE sur `employees` (les documents et rappels le sont, les lignes de
 * journal ne le sont pas). Une suite qui COMPTE des lignes doit partir d'un
 * état connu, pas d'un état « probablement vide ».
 */
async function purgerPrC(pool, { matricules = [], employeeIds = [], usernamePrefix } = {}) {
  if (matricules.length || employeeIds.length) {
    const r = await pool.query('SELECT id FROM employees WHERE malibou_id = ANY($1::text[])', [matricules]);
    // L'anonymisation EFFACE le matricule : une fiche anonymisée ne se retrouve
    // plus par son `malibou_id` et survivrait à la purge — en restant dans la
    // cohorte que la suite voisine croit seule.
    const ids = [...new Set([...r.rows.map((x) => x.id), ...employeeIds.filter((i) => i)])];
    if (ids.length) {
      for (const t of ['insertion_documents_salarie', 'insertion_rappels_rdv', 'insertion_echeance_reports']) {
        await pool.query(`DELETE FROM ${t} WHERE employee_id = ANY($1::int[])`, [ids]).catch(() => {});
      }
      await pool.query('DELETE FROM rgpd_audit_log WHERE entity_id = ANY($1::int[])', [ids]).catch(() => {});
      // `eti_token_generated_by` référence `users(id)` SANS `ON DELETE SET NULL`
      // (comme les 24 autres clés de ce module) : la suppression des comptes de
      // la suite échouerait tant qu'un entretien pointe encore vers eux.
      await pool.query('UPDATE insertion_milestones SET eti_token_generated_by = NULL WHERE employee_id = ANY($1::int[])', [ids]).catch(() => {});
      await pool.query("DELETE FROM rgpd_consents WHERE entity_type = 'employee' AND entity_id = ANY($1::int[])", [ids]).catch(() => {});
    }
  }
  if (usernamePrefix) {
    // `eti_token_generated_by` référence `users(id)` sans `ON DELETE SET NULL`
    // (comme les 24 autres clés du module) : la suppression des comptes de la
    // suite échouerait tant qu'un entretien pointe encore vers eux.
    await pool.query(
      `UPDATE insertion_milestones SET eti_token_generated_by = NULL
        WHERE eti_token_generated_by IN (SELECT id FROM users WHERE username LIKE $1)`,
      [`${usernamePrefix}%`]
    ).catch(() => {});
  }
  await base.purger(pool, { matricules, employeeIds, usernamePrefix });
}

/**
 * Nombre de salariés de la base HORS périmètre de la suite : les agrégats de
 * `GET /echeances` (compteur, file active) portent sur TOUTE la cohorte. Une
 * assertion sur un total n'a de sens que si ce nombre est nul — sinon la suite
 * mesure les restes d'une autre suite.
 */
async function cohorteHorsPerimetre(pool, matricules) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employees
      WHERE COALESCE(insertion_status, 'none') <> 'none'
        AND (malibou_id IS NULL OR NOT (malibou_id = ANY($1::text[])))`,
    [matricules]
  );
  return Number(r.rows[0].n);
}

/** Lignes du journal RGPD portant une action donnée pour un salarié. */
async function journalRgpd(pool, action, employeeId) {
  const r = await pool.query(
    'SELECT action, user_id, entity_type, entity_id, details FROM rgpd_audit_log WHERE action = $1 AND entity_id = $2 ORDER BY id DESC',
    [action, employeeId]
  );
  return r.rows;
}

module.exports = {
  ...base,
  RUN,
  purgerPrC,
  cohorteHorsPerimetre,
  journalRgpd,
  jourParisDecale,
  isoDate,
  aujourdhuiParis,
  decalerJours,
};
