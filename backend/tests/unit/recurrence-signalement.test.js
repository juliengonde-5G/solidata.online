// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — signalement des commandes créées SANS créneau de chargement
// ───────────────────────────────────────────────────────────────────────────
// DÉFAUT CORRIGÉ (27/08) : le moteur de récurrence refuse — à raison — de poser
// une préparation quand aucun gabarit n'existe ou que le créneau est occupé, et
// il renvoie le motif dans `ignorees`. Mais `ignorees` n'était affiché QUE dans
// la modale de génération manuelle : dans le chemin réellement automatique (le
// job, 3×/jour), le motif ne vivait que dans `job_runs`.
//
// Cas nominal du client : une commande hebdomadaire toute neuve n'a, par
// construction, AUCUN gabarit. Semaine après semaine, la fille était créée en
// attente sans créneau, et personne n'était averti.
//
// Ce qui est verrouillé ici : QUELS motifs déclenchent un signalement (ceux de
// la préparation, pas ceux de la commande), et le fait que ce canal de confort
// ne puisse jamais faire échouer une génération.
// ═══════════════════════════════════════════════════════════════════════════

const mockEnvoyerRoles = jest.fn().mockResolvedValue({ ok: true, envoyes: 2 });
jest.mock('../../src/services/messagerie', () => ({
  envoyerMessageSystemeRoles: (...a) => mockEnvoyerRoles(...a),
  envoyerMessageSysteme: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));

const {
  signalerPreparationsNonPosees,
  MOTIFS_PREPARATION,
} = require('../../src/services/commandes-recurrence');

beforeEach(() => { mockEnvoyerRoles.mockClear(); });

/** Dernier message envoyé, ou null. */
const dernierTexte = () => (mockEnvoyerRoles.mock.calls.length
  ? mockEnvoyerRoles.mock.calls[mockEnvoyerRoles.mock.calls.length - 1][1].texte
  : null);

describe('signalerPreparationsNonPosees — ce qui mérite un message', () => {
  it('aucune ignorée : personne n’est dérangé', () => {
    signalerPreparationsNonPosees([]);
    signalerPreparationsNonPosees(undefined);
    expect(mockEnvoyerRoles).not.toHaveBeenCalled();
  });

  it('« aucun gabarit de préparation » → message aux responsables, avec la référence ET la date', () => {
    signalerPreparationsNonPosees([
      { parent_id: 3, reference_parent: 'CMD-2026-0007', date: '2026-09-03', motif: 'aucun gabarit de préparation' },
    ]);
    expect(mockEnvoyerRoles).toHaveBeenCalledTimes(1);
    const [roles, options] = mockEnvoyerRoles.mock.calls[0];
    expect(roles).toEqual(['ADMIN', 'MANAGER']);
    expect(options.source).toBe('recurrence');
    // Le lien doit mener là où l'on agit : sans lui, le message dit qu'il y a
    // un problème sans dire où le régler.
    expect(options.lien).toBe('/exutoires-commandes');
    expect(options.texte).toContain('CMD-2026-0007');
    expect(options.texte).toContain('2026-09-03');
    expect(options.texte).toContain('aucun gabarit de préparation');
  });

  it('« créneau occupé » relève aussi de la préparation', () => {
    signalerPreparationsNonPosees([
      { parent_id: 3, reference_parent: 'CMD-2026-0007', date: '2026-09-10', motif: 'créneau occupé (CMD-2026-0031)' },
    ]);
    expect(mockEnvoyerRoles).toHaveBeenCalledTimes(1);
    expect(dernierTexte()).toContain('créneau occupé');
  });

  it('un motif de COMMANDE ne déclenche rien : ce n’est pas un créneau à poser', () => {
    // « occurrence déjà générée » est le fonctionnement NORMAL d'un re-run
    // idempotent ; « modèle en échec » est un incident technique, déjà journalisé.
    signalerPreparationsNonPosees([
      { parent_id: 3, reference_parent: 'CMD-2026-0007', date: '2026-09-03', motif: 'occurrence déjà générée (générée en parallèle)' },
      { parent_id: 4, reference_parent: 'CMD-2026-0008', date: null, motif: 'modèle en échec : connexion perdue' },
      { parent_id: 5, reference_parent: 'CMD-2026-0009', date: '2026-09-04', motif: 'échec de création : contrainte violée' },
    ]);
    expect(mockEnvoyerRoles).not.toHaveBeenCalled();
  });

  it('un motif de préparation SANS date n’est pas signalé (rien à ouvrir)', () => {
    signalerPreparationsNonPosees([
      { parent_id: 3, reference_parent: 'CMD-2026-0007', date: null, motif: 'aucun gabarit de préparation' },
    ]);
    expect(mockEnvoyerRoles).not.toHaveBeenCalled();
  });

  it('un seul message pour plusieurs occurrences, et le surplus est ANNONCÉ', () => {
    const lot = Array.from({ length: 14 }, (_, i) => ({
      parent_id: 3, reference_parent: 'CMD-2026-0007',
      date: `2026-09-${String(i + 1).padStart(2, '0')}`, motif: 'aucun gabarit de préparation',
    }));
    signalerPreparationsNonPosees(lot);
    expect(mockEnvoyerRoles).toHaveBeenCalledTimes(1);
    const texte = dernierTexte();
    expect(texte).toContain('14 commande(s)');
    // Plafonné à 10 lignes détaillées, mais le reste est DIT — jamais tronqué
    // en silence (« 4 autres » et non une liste qui s'arrête sans prévenir).
    expect(texte).toContain('et 4 autre(s)');
    expect(texte.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(11);
  });

  it('les motifs surveillés couvrent les quatre refus possibles du moteur', () => {
    expect(MOTIFS_PREPARATION).toEqual(expect.arrayContaining([
      'aucun gabarit', 'gabarit incomplet', 'créneau occupé', 'créneau non calculable',
    ]));
  });
});

describe('canal de CONFORT : ne fait jamais échouer une génération', () => {
  it('un envoi qui rejette est avalé, la fonction ne lève pas', async () => {
    mockEnvoyerRoles.mockRejectedValueOnce(new Error('messagerie HS'));
    expect(() => signalerPreparationsNonPosees([
      { parent_id: 3, reference_parent: 'CMD-1', date: '2026-09-03', motif: 'aucun gabarit de préparation' },
    ])).not.toThrow();
    // Laisse la micro-tâche du .catch() se résoudre : sans ça, un rejet non
    // capturé ferait échouer la suite APRÈS ce test.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('un service de messagerie qui n’expose pas la fonction ne casse rien', () => {
    mockEnvoyerRoles.mockClear();
    const messagerie = require('../../src/services/messagerie');
    const original = messagerie.envoyerMessageSystemeRoles;
    messagerie.envoyerMessageSystemeRoles = undefined;
    try {
      expect(() => signalerPreparationsNonPosees([
        { parent_id: 3, reference_parent: 'CMD-1', date: '2026-09-03', motif: 'aucun gabarit de préparation' },
      ])).not.toThrow();
      expect(mockEnvoyerRoles).not.toHaveBeenCalled();
    } finally {
      messagerie.envoyerMessageSystemeRoles = original;
    }
  });
});
