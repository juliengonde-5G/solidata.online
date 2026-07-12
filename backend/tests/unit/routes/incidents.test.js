// Tests de la logique de transition du cycle de vie des incidents (item 44, Vague 1)
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
}));

const { planIncidentTransition, INCIDENT_TRANSITIONS } = require('../../../src/routes/incidents');

describe('planIncidentTransition (cycle de vie incidents)', () => {
  it('accepte open → in_progress (prise en charge, efface la résolution)', () => {
    const p = planIncidentTransition('open', 'in_progress', '');
    expect(p.ok).toBe(true);
    expect(p.resolve).toBe(false);
    expect(p.reopen).toBe(true);
  });

  it('refuse open → resolved sans commentaire de résolution', () => {
    const p = planIncidentTransition('open', 'resolved', '   ');
    expect(p.error).toBe('note_required');
  });

  it('accepte open → resolved avec commentaire (trace résolution)', () => {
    const p = planIncidentTransition('open', 'resolved', '  Remorquage effectué  ');
    expect(p.ok).toBe(true);
    expect(p.resolve).toBe(true);
    expect(p.reopen).toBe(false);
    expect(p.note).toBe('Remorquage effectué'); // trim appliqué
  });

  it('accepte in_progress → closed avec commentaire', () => {
    const p = planIncidentTransition('in_progress', 'closed', 'Classé sans suite');
    expect(p.ok).toBe(true);
    expect(p.resolve).toBe(true);
  });

  it('refuse une transition non autorisée (closed → resolved)', () => {
    const p = planIncidentTransition('closed', 'resolved', 'x');
    expect(p.error).toBe('transition_forbidden');
    expect(p.allowed).toEqual(INCIDENT_TRANSITIONS.closed);
  });

  it('signale un no-op idempotent quand le statut ne change pas', () => {
    const p = planIncidentTransition('open', 'open', '');
    expect(p.noop).toBe(true);
  });

  it('rejette un statut inconnu', () => {
    const p = planIncidentTransition('open', 'bidon', '');
    expect(p.error).toBe('invalid_status');
    expect(p.allowed).toContain('in_progress');
  });

  it('accepte la réouverture resolved → in_progress sans commentaire requis', () => {
    const p = planIncidentTransition('resolved', 'in_progress', '');
    expect(p.ok).toBe(true);
    expect(p.reopen).toBe(true);
    expect(p.resolve).toBe(false);
  });

  it('autorise la clôture directe depuis open (open → closed avec note)', () => {
    const p = planIncidentTransition('open', 'closed', 'Doublon');
    expect(p.ok).toBe(true);
    expect(p.resolve).toBe(true);
  });

  it('expose un routeur Express montable', () => {
    const router = require('../../../src/routes/incidents');
    expect(typeof router).toBe('function'); // express.Router() est une fonction middleware
  });
});
