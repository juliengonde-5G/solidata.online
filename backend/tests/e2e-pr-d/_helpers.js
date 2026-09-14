// ═══════════════════════════════════════════════════════════════════════════
// PR D « Reporting autorité » — socle des preuves sur PostgreSQL RÉEL.
// ───────────────────────────────────────────────────────────────────────────
// Le lot 6 le dit lui-même (26-realisation-lot6.md § 6.2 point 7) : « aucune
// vérification sur PostgreSQL réel dans ce lot — `pg` est simulé partout ».
// Or le SQL neuf du lot compte deux `LEFT JOIN LATERAL` avec `ARRAY_AGG`, un
// `generate_series` croisé à `make_date`, et un `ROW_NUMBER() OVER (PARTITION
// BY)`. Un `pg` simulé rend des lignes quelle que soit la validité du SQL : il
// ne connaît ni les CHECK, ni les types, ni la façon dont le pilote convertit
// une colonne DATE en objet JavaScript, ni le fuseau du processus.
//
// EXÉCUTION — ignorées tant que `PR_D_E2E_DB=1` (ou `PR_A/B/C_E2E_DB=1`) n'est
// pas fourni, pour que `npx jest` reste vert sans base :
//   source <scratchpad>/db-test.env
//   cd backend && PR_D_E2E_DB=1 npx jest tests/e2e-pr-d --runInBand
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

// Le socle de la PR C (lui-même bâti sur celui de la PR B) est RÉUTILISÉ :
// jetons MFA, comptes par rôle, salarié minimal, purge, photographie du pool.
const base = require('../e2e-pr-c/_helpers');

const RUN = process.env.PR_D_E2E_DB === '1'
  || process.env.PR_C_E2E_DB === '1'
  || process.env.PR_B_E2E_DB === '1'
  || process.env.PR_A_E2E_DB === '1';

const pool = require('../../src/config/database');

/**
 * Purge du périmètre PR D. Les agrégats de ce lot portent sur TOUTE la cohorte
 * et sur des tables qui ne sont pas en CASCADE sur `employees`
 * (`etp_asp_mensuel`, `etp_asp_salaries`, `insertion_dialogues_gestion`, le
 * journal RGPD) : une suite qui compare des totaux doit partir d'un état connu,
 * pas d'un état « probablement vide ».
 */
async function purgerPrD(pool_, { matricules = [], usernamePrefix, annees = [] } = {}) {
  if (annees.length) {
    await pool_.query('DELETE FROM etp_asp_salaries WHERE annee = ANY($1::int[])', [annees]).catch(() => {});
    await pool_.query('DELETE FROM etp_asp_mensuel WHERE annee = ANY($1::int[])', [annees]).catch(() => {});
    await pool_.query('DELETE FROM insertion_dialogues_gestion WHERE annee = ANY($1::int[])', [annees]).catch(() => {});
  }
  if (matricules.length) {
    const r = await pool_.query('SELECT id FROM employees WHERE malibou_id = ANY($1::text[])', [matricules]);
    const ids = r.rows.map((x) => x.id);
    if (ids.length) {
      await pool_.query('UPDATE insertion_milestones SET eti_token_generated_by = NULL WHERE employee_id = ANY($1::int[])', [ids]).catch(() => {});
      await pool_.query('DELETE FROM rgpd_audit_log WHERE entity_id = ANY($1::int[])', [ids]).catch(() => {});
    }
  }
  await base.purgerPrC(pool_, { matricules, usernamePrefix });
}

/** Cohorte HORS périmètre de la suite : un total n'a de sens que si elle est nulle. */
async function cohorteHorsPerimetre(pool_, matricules) {
  const r = await pool_.query(
    `SELECT COUNT(*)::int AS n FROM employees
      WHERE COALESCE(insertion_status, 'none') <> 'none'
        AND (malibou_id IS NULL OR NOT (malibou_id = ANY($1::text[])))`,
    [matricules]
  );
  return Number(r.rows[0].n);
}

/** Lignes du journal RGPD portant une action donnée (les traces du lot sont non nominatives : entity_id NULL). */
async function journalParAction(pool_, action, depuisId = 0) {
  const r = await pool_.query(
    'SELECT id, action, user_id, entity_type, entity_id, details FROM rgpd_audit_log WHERE action = $1 AND id > $2 ORDER BY id',
    [action, depuisId]
  );
  return r.rows;
}

/** Dernier identifiant du journal — borne basse pour compter ce qu'une requête écrit. */
async function dernierIdJournal(pool_) {
  const r = await pool_.query('SELECT COALESCE(MAX(id), 0)::int AS n FROM rgpd_audit_log');
  return Number(r.rows[0].n);
}

/** Chemin pointé dans un objet ('blocs.2_publics_entree.brsa.n'). */
function parChemin(obj, chemin) {
  return String(chemin).split('.').reduce((o, c) => (o == null ? undefined : o[c]), obj);
}

/** Toutes les clés (récursivement) d'une structure — sert à prouver l'absence. */
function toutesLesCles(o, out = new Set()) {
  if (o == null || typeof o !== 'object') return out;
  if (Array.isArray(o)) { for (const v of o) toutesLesCles(v, out); return out; }
  for (const [k, v] of Object.entries(o)) { out.add(k); toutesLesCles(v, out); }
  return out;
}

module.exports = {
  ...base,
  RUN,
  pool,
  purgerPrD,
  cohorteHorsPerimetre,
  journalParAction,
  dernierIdJournal,
  parChemin,
  toutesLesCles,
};
