// ═══════════════════════════════════════════════════════════════════════════
// PR B « Cadre RSA et temps d'accompagnement » — socle des preuves sur
// PostgreSQL RÉEL.
// ───────────────────────────────────────────────────────────────────────────
// Les suites de `tests/contract/` montent les VRAIS routeurs sur un `pg`
// SIMULÉ : le mock rend des lignes quelle que soit la validité du SQL et ne
// connaît ni les CHECK, ni les UNIQUE, ni les types, ni la façon dont le
// pilote convertit une colonne DATE en objet JavaScript. Les défauts de cette
// famille (un CHECK qui refuse une valeur que le validateur accepte, un mois
// déduit d'une Date décalée d'un fuseau, une fuite de connexion sur un refus)
// sont structurellement invisibles sous ce filet.
//
// EXÉCUTION — ignorées tant que `PR_A_E2E_DB=1` (ou `PR_B_E2E_DB=1`) n'est pas
// fourni, pour que `npx jest` reste vert sans base :
//   source <scratchpad>/db-test.env
//   cd backend && PR_B_E2E_DB=1 npx jest tests/e2e-pr-b --runInBand
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const jwt = require('jsonwebtoken');

// La même variable que la PR A est acceptée : une seule commande couvre les
// deux familles de preuves, et une recette qui n'en jouerait qu'une moitié
// serait une recette qui ment par omission.
const RUN = process.env.PR_B_E2E_DB === '1' || process.env.PR_A_E2E_DB === '1';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

/** Jeton porteur du second facteur frais (cf. middleware/mfa.js). */
function signer(user) {
  return jwt.sign(
    {
      id: user.id, username: user.username, role: user.role,
      first_name: user.first_name || 'Jest', last_name: user.last_name || user.role,
      mfa: true, mfa_at: Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

/**
 * Jeton CHAUFFEUR tel que le compose `routes/auth.js › driver-start` :
 * `role` vaut 'COLLABORATEUR' EN DUR, l'identité réelle est le véhicule. Il
 * doit être refusé par le routeur d'insertion avant d'atteindre quoi que ce
 * soit — c'est le périmètre borné de la 2.44.0.
 */
function signerChauffeur(vehicleId = 999) {
  return jwt.sign(
    {
      id: null, username: `driver_${vehicleId}`, role: 'COLLABORATEUR',
      vehicle_id: vehicleId, employee_id: null, mfa: true, mfa_at: Math.floor(Date.now() / 1000),
    },
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
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, is_active = true
       RETURNING id`,
      [username, `${username}@test.local`, role, role]
    );
    out[role] = {
      id: r.rows[0].id, username, role,
      token: signer({ id: r.rows[0].id, username, role }),
    };
  }
  return out;
}

/** Purge le périmètre d'une suite (préfixes de matricule et de compte). */
async function purger(pool, { matricules = [], employeeIds = [], usernamePrefix, projetCodes = [] } = {}) {
  if (matricules.length) {
    await pool.query('DELETE FROM employees WHERE malibou_id = ANY($1::text[])', [matricules]);
  }
  // L'anonymisation efface le matricule : sans purge par identifiant, la fiche
  // anonymisée survivrait et bloquerait la suppression des comptes.
  if (employeeIds.length) {
    await pool.query('DELETE FROM employees WHERE id = ANY($1::int[])', [employeeIds.filter((i) => i)]);
  }
  if (usernamePrefix) {
    const ids = `(SELECT id FROM users WHERE username LIKE $1)`;
    // Les feuilles de temps et les saisies sont en CASCADE sur users, mais on
    // les retire explicitement : une suite qui compte des lignes doit partir
    // d'un état connu, pas d'un état « probablement vide ».
    await pool.query(`DELETE FROM insertion_temps_saisies WHERE user_id IN ${ids}`, [`${usernamePrefix}%`]).catch(() => {});
    await pool.query(`DELETE FROM insertion_feuilles_temps WHERE user_id IN ${ids}`, [`${usernamePrefix}%`]).catch(() => {});
    await pool.query(`DELETE FROM rgpd_audit_log WHERE user_id IN ${ids}`, [`${usernamePrefix}%`]);
    await pool.query(`DELETE FROM user_activity_log WHERE user_id IN ${ids}`, [`${usernamePrefix}%`]).catch(() => {});
    await pool.query('DELETE FROM users WHERE username LIKE $1', [`${usernamePrefix}%`]);
  }
  if (projetCodes.length) {
    await pool.query('DELETE FROM insertion_projets WHERE code = ANY($1::text[])', [projetCodes]);
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

/**
 * Lundi (ISO) de la semaine `num` de l'année `an` — même pivot jeudi que
 * `services/effectifs-engine.js`, recalculé ici pour que le jeu d'essai ne
 * dépende pas du module qu'il sert à éprouver.
 */
function lundiIso(an, num) {
  const q = new Date(Date.UTC(an, 0, 4));           // le 4 janvier est toujours en S1
  const jour = q.getUTCDay() || 7;                   // 1 = lundi … 7 = dimanche
  q.setUTCDate(q.getUTCDate() - (jour - 1) + (num - 1) * 7);
  return q.toISOString().slice(0, 10);
}

/** Date ISO décalée de `n` jours à partir d'une date ISO. */
function plusJours(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Date PostgreSQL lue par le pilote → 'AAAA-MM-JJ'.
 *
 * ATTENTION, ce helper existe pour une raison précise : `node-pg` convertit une
 * colonne DATE en objet `Date`, et `String(unDate).slice(0, 10)` rend
 * « Mon Jan 01 » et non « 1900-01-01 ». Une assertion écrite naïvement
 * comparerait donc deux chaînes fausses de la même façon — et ne verrait pas le
 * défaut. (C'est exactement ce raccourci qui a été trouvé dans le code de
 * production : voir le rapport 18, défauts D-01 et D-02.)
 */
function iso(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

/**
 * Photographie du pool : sert à prouver qu'un refus 4xx rend sa connexion.
 * `totalCount` = connexions ouvertes, `idleCount` = connexions rendues,
 * `waitingCount` = requêtes en attente d'une connexion libre. Une fuite se lit
 * comme un `totalCount` qui monte pendant que `idleCount` stagne.
 */
function etatPool(pool) {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

module.exports = {
  RUN, JWT_SECRET, signer, signerChauffeur, creerComptes, purger, creerSalarie,
  jourDecale, lundiIso, plusJours, etatPool, iso,
};
