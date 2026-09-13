// ═══════════════════════════════════════════════════════════════════════════
// PR A « Conformité immédiate » — socle commun des preuves sur PostgreSQL réel
// ───────────────────────────────────────────────────────────────────────────
// Les suites de `tests/contract/` montent les VRAIS routeurs mais sur un `pg`
// SIMULÉ : le mock rend des lignes quelle que soit la validité du SQL, et ne
// connaît ni les CHECK, ni les UNIQUE, ni les types. Trois défauts de cette PR
// (délai de saisie non conforme à la règle dictée, seuil d'alerte décalé d'un
// jour, colonne d'anonymisation absente) étaient invisibles sous ce filet.
// Ces suites-ci exercent les mêmes handlers contre un vrai moteur.
//
// EXÉCUTION — ignorées tant que `PR_A_E2E_DB=1` n'est pas fourni, pour que
// `npx jest` reste vert sans base :
//   source <scratchpad>/db-test.env
//   cd backend && PR_A_E2E_DB=1 npx jest tests/e2e-pr-a --runInBand
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const jwt = require('jsonwebtoken');

const RUN = process.env.PR_A_E2E_DB === '1';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

/** Jeton porteur du second facteur frais (requireMfa) — cf. middleware/mfa.js. */
function signer(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

/** Crée (ou réutilise) un compte par rôle et rend { ROLE: {id, token} }. */
async function creerComptes(pool, prefixe, roles = ['ADMIN', 'RH', 'MANAGER']) {
  const out = {};
  for (const role of roles) {
    const username = `${prefixe}_${role.toLowerCase()}`;
    const r = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
       VALUES ($1, $2, 'x', $3, 'Jest', $4, true)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role
       RETURNING id`,
      [username, `${username}@test.local`, role, role]
    );
    out[role] = { id: r.rows[0].id, username, token: signer({ id: r.rows[0].id, username, role }) };
  }
  return out;
}

/** Purge le périmètre d'une suite (préfixes de matricule et de compte). */
async function purger(pool, { matricules = [], employeeIds = [], usernamePrefix, projetCodes = [] } = {}) {
  if (matricules.length) {
    await pool.query(
      `DELETE FROM employees WHERE malibou_id = ANY($1::text[])`, [matricules]
    );
  }
  // L'anonymisation efface le matricule : sans purge par identifiant, la fiche
  // anonymisée survivrait à la suite et bloquerait la suppression des comptes.
  if (employeeIds.length) {
    await pool.query('DELETE FROM employees WHERE id = ANY($1::int[])', [employeeIds.filter((i) => i)]);
  }
  if (projetCodes.length) {
    await pool.query('DELETE FROM insertion_projets WHERE code = ANY($1::text[])', [projetCodes]);
  }
  if (usernamePrefix) {
    await pool.query(
      `DELETE FROM rgpd_audit_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      [`${usernamePrefix}%`]
    );
    await pool.query(
      `DELETE FROM user_activity_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
      [`${usernamePrefix}%`]
    ).catch(() => {});
    await pool.query('DELETE FROM users WHERE username LIKE $1', [`${usernamePrefix}%`]);
  }
}

/** Salarié minimal, tous champs optionnels. */
async function creerSalarie(pool, matricule, champs = {}) {
  const base = { first_name: 'Jest', last_name: 'Salarie', is_active: true, weekly_hours: 26 };
  const c = { ...base, ...champs, malibou_id: matricule };
  const cols = Object.keys(c);
  const r = await pool.query(
    `INSERT INTO employees (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((k) => c[k])
  );
  return r.rows[0].id;
}

/** Décalage de jours en date ISO (AAAA-MM-JJ), horloge locale du test. */
function jourDecale(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { RUN, JWT_SECRET, signer, creerComptes, purger, creerSalarie, jourDecale };
