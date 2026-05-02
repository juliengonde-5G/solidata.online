/**
 * Moteur générique de validation des transitions d'état.
 * Source unique pour valider tout passage commande/préparation/facture/...
 *
 * Usage type :
 *
 *   const sm = require('../services/state-machine');
 *   const result = await sm.transition({
 *     machine: 'commande_exutoire',
 *     entityType: 'commandes_exutoires',
 *     entityId: 42,
 *     fromState: 'en_preparation',
 *     toState: 'chargee',
 *     userId: req.user.id,
 *     userRole: req.user.role,
 *     reason: 'Camion XYZ chargé',
 *     dbClient: client,  // (optionnel) pg client si déjà dans une transaction
 *   });
 *   if (!result.ok) return res.status(409).json(result);
 *
 * Le moteur :
 *   1. valide l'existence de la machine et des états
 *   2. vérifie que la transition est autorisée
 *   3. vérifie le rôle utilisateur
 *   4. journalise dans la table state_transitions_audit
 */

const pool = require('../config/database');
const { MACHINES } = require('./state-machines');

class StateMachineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function getMachine(name) {
  const m = MACHINES[name];
  if (!m) throw new StateMachineError('UNKNOWN_MACHINE', `Machine inconnue : ${name}`);
  return m;
}

/**
 * Normalise un état (gère les alias accentués pour rétrocompat lecture).
 */
function normalizeState(machineName, state) {
  if (state == null) return state;
  const m = getMachine(machineName);
  if (m.aliases && m.aliases[state]) return m.aliases[state];
  return state;
}

/**
 * Vérifie si une transition est autorisée. Renvoie { ok, reason }.
 */
function canTransition({ machine, fromState, toState, userRole }) {
  const m = getMachine(machine);
  const from = normalizeState(machine, fromState);
  const to = normalizeState(machine, toState);

  if (!m.states.includes(to)) {
    return { ok: false, code: 'INVALID_TARGET', reason: `État cible '${to}' inconnu pour ${machine}` };
  }
  if (from === to) {
    return { ok: false, code: 'NO_OP', reason: `État identique (${from})` };
  }
  // Si pas d'état from (création), seul l'état initial est autorisé
  if (!from) {
    return to === m.initial
      ? { ok: true }
      : { ok: false, code: 'INVALID_INITIAL', reason: `État initial doit être '${m.initial}'` };
  }
  if (!m.states.includes(from)) {
    return { ok: false, code: 'INVALID_SOURCE', reason: `État source '${from}' inconnu pour ${machine}` };
  }
  const allowed = m.transitions[from] || {};
  const rule = allowed[to];
  if (!rule) {
    const available = Object.keys(allowed);
    return {
      ok: false,
      code: 'TRANSITION_FORBIDDEN',
      reason: `Transition ${from} → ${to} non autorisée pour ${machine}. Transitions valides : ${available.length ? available.join(', ') : '(état terminal)'}`,
    };
  }
  if (rule.roles && rule.roles.length > 0 && !rule.roles.includes(userRole)) {
    return {
      ok: false,
      code: 'ROLE_FORBIDDEN',
      reason: `Rôle ${userRole} non autorisé pour la transition ${from} → ${to}. Rôles requis : ${rule.roles.join(', ')}`,
    };
  }
  return { ok: true };
}

/**
 * Effectue la transition + log audit. Ne modifie PAS la table métier — c'est
 * à l'appelant de faire l'UPDATE du statut. Le moteur valide et trace.
 */
async function transition({
  machine, entityType, entityId, fromState, toState,
  userId, userRole, reason = null, dbClient = null,
}) {
  const check = canTransition({ machine, fromState, toState, userRole });
  if (!check.ok) return { ok: false, error: check.reason, code: check.code };

  const executor = dbClient || pool;
  const fromN = normalizeState(machine, fromState);
  const toN = normalizeState(machine, toState);

  try {
    await executor.query(
      `INSERT INTO state_transitions_audit
       (machine, entity_type, entity_id, from_state, to_state, user_id, user_role, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [machine, entityType, entityId, fromN, toN, userId, userRole, reason]
    );
  } catch (err) {
    // Ne pas faire échouer la transition métier si l'audit log échoue
    // (table peut être en migration). On loggue à la console.
    console.warn('[STATE-MACHINE] audit log skipped:', err.message);
  }

  return { ok: true, from: fromN, to: toN };
}

/**
 * Liste les transitions disponibles pour un état (utile pour UI dropdown).
 */
function getAvailableTransitions(machine, fromState, userRole) {
  const m = getMachine(machine);
  const from = normalizeState(machine, fromState) || m.initial;
  const allowed = m.transitions[from] || {};
  return Object.entries(allowed)
    .filter(([, rule]) => !rule.roles || rule.roles.length === 0 || !userRole || rule.roles.includes(userRole))
    .map(([to]) => to);
}

module.exports = {
  canTransition,
  transition,
  getAvailableTransitions,
  normalizeState,
  StateMachineError,
};
