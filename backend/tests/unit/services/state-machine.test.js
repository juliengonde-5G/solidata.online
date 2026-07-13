/**
 * Tests du moteur de state machine (Enterprise Architect Ch2).
 * Couvre : validation transition, rôles, alias, états initial/terminal.
 */

const { canTransition, normalizeState, getAvailableTransitions } = require('../../../src/services/state-machine');

describe('state-machine — canTransition', () => {
  test('refuse une transition vers un état inconnu', () => {
    const r = canTransition({
      machine: 'commande_exutoire',
      fromState: 'en_attente',
      toState: 'etat_imaginaire',
      userRole: 'ADMIN',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_TARGET');
  });

  test('refuse une transition non autorisée par les règles', () => {
    const r = canTransition({
      machine: 'commande_exutoire',
      fromState: 'en_attente',
      toState: 'expediee',  // saute des étapes
      userRole: 'ADMIN',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TRANSITION_FORBIDDEN');
  });

  test('accepte une transition valide pour un rôle autorisé', () => {
    const r = canTransition({
      machine: 'commande_exutoire',
      fromState: 'en_attente',
      toState: 'confirmee',
      userRole: 'ADMIN',
    });
    expect(r.ok).toBe(true);
  });

  test('refuse une transition pour un rôle non autorisé', () => {
    const r = canTransition({
      machine: 'commande_exutoire',
      fromState: 'en_attente',
      toState: 'confirmee',
      userRole: 'COLLABORATEUR',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ROLE_FORBIDDEN');
  });

  test('refuse une transition vers le même état (no-op)', () => {
    const r = canTransition({
      machine: 'commande_exutoire',
      fromState: 'confirmee',
      toState: 'confirmee',
      userRole: 'ADMIN',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_OP');
  });

  test('accepte fromState absent → état initial', () => {
    const r = canTransition({
      machine: 'commande_exutoire',
      fromState: null,
      toState: 'en_attente',
      userRole: 'ADMIN',
    });
    expect(r.ok).toBe(true);
  });

  test('refuse fromState absent → état autre que initial', () => {
    const r = canTransition({
      machine: 'commande_exutoire',
      fromState: undefined,
      toState: 'expediee',
      userRole: 'ADMIN',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_INITIAL');
  });

  test('valide la machine boutique_commande pour rôle RESP_BTQ', () => {
    const r = canTransition({
      machine: 'boutique_commande',
      fromState: 'brouillon',
      toState: 'envoyee',
      userRole: 'RESP_BTQ',
    });
    expect(r.ok).toBe(true);
  });

  test('RESP_BTQ peut annuler SA commande en brouillon (vague 3)', () => {
    const r = canTransition({
      machine: 'boutique_commande',
      fromState: 'brouillon',
      toState: 'annulee',
      userRole: 'RESP_BTQ',
    });
    expect(r.ok).toBe(true);
  });

  test('RESP_BTQ ne peut PAS annuler une commande déjà envoyée (statut avancé)', () => {
    const r = canTransition({
      machine: 'boutique_commande',
      fromState: 'envoyee',
      toState: 'annulee',
      userRole: 'RESP_BTQ',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ROLE_FORBIDDEN');
  });

  test('jette une erreur si machine inconnue', () => {
    expect(() => canTransition({
      machine: 'machine_inconnue',
      fromState: 'a',
      toState: 'b',
      userRole: 'ADMIN',
    })).toThrow(/Machine inconnue/);
  });
});

describe('state-machine — normalizeState (alias rétrocompat)', () => {
  test('normalise les libellés accentués en lecture', () => {
    expect(normalizeState('commande_exutoire', 'chargée')).toBe('chargee');
    expect(normalizeState('commande_exutoire', 'expédiée')).toBe('expediee');
    expect(normalizeState('commande_exutoire', 'annulée')).toBe('annulee');
  });

  test('laisse les états ASCII inchangés', () => {
    expect(normalizeState('commande_exutoire', 'chargee')).toBe('chargee');
    expect(normalizeState('commande_exutoire', 'brouillon')).toBe('brouillon');
  });

  test('gère null/undefined', () => {
    expect(normalizeState('commande_exutoire', null)).toBeNull();
    expect(normalizeState('commande_exutoire', undefined)).toBeUndefined();
  });
});

describe('state-machine — getAvailableTransitions', () => {
  test('retourne les transitions sortantes pour un état donné', () => {
    const list = getAvailableTransitions('commande_exutoire', 'en_attente', 'ADMIN');
    expect(list).toContain('confirmee');
    expect(list).toContain('annulee');
    expect(list).not.toContain('expediee');
  });

  test('retourne une liste vide pour un état terminal', () => {
    const list = getAvailableTransitions('commande_exutoire', 'cloturee', 'ADMIN');
    expect(list).toEqual([]);
  });

  test('filtre par rôle utilisateur', () => {
    // Vague 3 — RESP_BTQ peut envoyer ET annuler SA commande en brouillon…
    const respBrouillon = getAvailableTransitions('boutique_commande', 'brouillon', 'RESP_BTQ');
    expect(respBrouillon).toContain('envoyee');
    expect(respBrouillon).toContain('annulee');
    // …mais pas annuler une commande déjà avancée (réservé ADMIN/MANAGER).
    const respEnvoyee = getAvailableTransitions('boutique_commande', 'envoyee', 'RESP_BTQ');
    expect(respEnvoyee).not.toContain('annulee');
    // ADMIN conserve l'annulation à tous les stades.
    const adminEnvoyee = getAvailableTransitions('boutique_commande', 'envoyee', 'ADMIN');
    expect(adminEnvoyee).toContain('annulee');
  });

  test('retourne toutes les transitions si pas de userRole fourni', () => {
    const list = getAvailableTransitions('commande_exutoire', 'en_attente');
    expect(list).toContain('confirmee');
    expect(list).toContain('annulee');
  });
});
