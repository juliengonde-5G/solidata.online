// ═══════════════════════════════════════════════════════════════════════════
// Reprise d'une pesée sur une tournée close — lecture et contrôle des arguments
//
// Le script écrit dans une tournée déjà clôturée : ses garde-fous sont sa
// première sécurité. On les teste sans base — ce sont des fonctions pures.
// ═══════════════════════════════════════════════════════════════════════════
jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));

const { parseArgs, validerArgs, DEFAUTS } = require('../../src/scripts/ajouter-pesee-tournee');

describe('parseArgs', () => {
  it('sans argument : simulation, et les valeurs de la reprise demandée', () => {
    const a = parseArgs([]);
    expect(a.apply).toBe(false);
    expect(a).toMatchObject(DEFAUTS);
  });

  it('lit tournée, poids, horodatage, tare et pesée intermédiaire', () => {
    const a = parseArgs(['--tour=42', '--poids=1140', '--le=2026-08-28 16:00',
      '--tare=3200', '--intermediaire', '--apply']);
    expect(a).toMatchObject({
      tour: 42, poids: '1140', le: '2026-08-28 16:00', tare: '3200',
      intermediaire: true, apply: true,
    });
  });
});

describe('validerArgs', () => {
  const ok = { tour: 676, poids: '1140', le: '2026-08-28 16:00', tare: null };

  it('accepte la saisie demandée et normalise le poids', () => {
    expect(validerArgs(ok).valeurs).toEqual({ poids: 1140, tare: null });
  });

  it('accepte la virgule décimale et les secondes', () => {
    expect(validerArgs({ ...ok, poids: '1140,5', le: '2026-08-28 16:00:00' }).valeurs.poids).toBe(1140.5);
  });

  it.each([
    ['identifiant de tournée absurde', { ...ok, tour: 0 }],
    ['poids illisible', { ...ok, poids: 'abc' }],
    ['poids négatif', { ...ok, poids: '-10' }],
    ['poids aberrant (au-delà de 60 t)', { ...ok, poids: '99999' }],
    ['tare illisible', { ...ok, tare: 'x' }],
    ['horodatage au format français', { ...ok, le: '28/08/2026 16h' }],
    ['horodatage sans heure', { ...ok, le: '2026-08-28' }],
  ])('refuse : %s', (_libelle, args) => {
    expect(validerArgs(args).error).toEqual(expect.any(String));
    expect(validerArgs(args).valeurs).toBeUndefined();
  });

  it('refuse une pesée à 0 kg — il n’y a rien à rattraper', () => {
    expect(validerArgs({ ...ok, poids: '0' }).error).toMatch(/0 kg/);
  });
});
