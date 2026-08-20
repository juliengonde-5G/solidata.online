// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — fraîcheur de la photo d'un CAV (utils/cav-photo.js)
// ───────────────────────────────────────────────────────────────────────────
// Règle métier (exigence 08/2026) : au passage du chauffeur, une photo est
// DEMANDÉE si le point n'en a aucune, ou si la sienne dépasse le seuil
// paramétrable `collecte.photo_fraicheur_mois` (défaut 6). Fonctions PURES :
// aucune base, horloge injectée.
// ═══════════════════════════════════════════════════════════════════════════
const {
  isPhotoFresh,
  photoRequise,
  addMonths,
  getPhotoFraicheurMois,
  resetPhotoFraicheurCache,
  DEFAULT_PHOTO_FRAICHEUR_MOIS,
  SETTINGS_KEY,
} = require('../../src/utils/cav-photo');

const NOW = new Date('2026-08-20T10:00:00Z');
const monthsBefore = (n, day = 20) => new Date(Date.UTC(2026, 7 - n, day, 10, 0, 0));

describe('isPhotoFresh — états de la photo', () => {
  it('aucune photo → jamais fraîche (photo demandée)', () => {
    expect(isPhotoFresh(null, NOW, 6, NOW)).toBe(false);
    expect(isPhotoFresh('', NOW, 6, NOW)).toBe(false);
    expect(isPhotoFresh('   ', NOW, 6, NOW)).toBe(false);
  });

  it('photo SANS date de prise de vue → à renouveler (jamais supposée récente)', () => {
    expect(isPhotoFresh('/uploads/cav-photos/a.jpg', null, 6, NOW)).toBe(false);
    expect(isPhotoFresh('/uploads/cav-photos/a.jpg', '', 6, NOW)).toBe(false);
    expect(isPhotoFresh('/uploads/cav-photos/a.jpg', 'pas-une-date', 6, NOW)).toBe(false);
  });

  it('photo de 5 mois avec seuil 6 → fraîche, rien n\'est demandé', () => {
    expect(isPhotoFresh('/uploads/cav-photos/a.jpg', monthsBefore(5), 6, NOW)).toBe(true);
    expect(photoRequise('/uploads/cav-photos/a.jpg', monthsBefore(5), 6, NOW)).toBe(false);
  });

  it('photo de 6 mois + 1 jour avec seuil 6 → caduque, photo redemandée', () => {
    const taken = new Date(Date.UTC(2026, 1, 19, 10, 0, 0)); // 19/02/2026 → +6 mois = 19/08
    expect(isPhotoFresh('/uploads/cav-photos/a.jpg', taken, 6, NOW)).toBe(false);
    expect(photoRequise('/uploads/cav-photos/a.jpg', taken, 6, NOW)).toBe(true);
  });

  it('la bascule se fait exactement à l\'échéance (fraîche jusqu\'à, plus après)', () => {
    const taken = new Date(Date.UTC(2026, 1, 20, 10, 0, 0)); // 20/02 → échéance 20/08 10:00
    expect(isPhotoFresh('/p.jpg', taken, 6, new Date(Date.UTC(2026, 7, 20, 9, 59, 59)))).toBe(true);
    expect(isPhotoFresh('/p.jpg', taken, 6, new Date(Date.UTC(2026, 7, 20, 10, 0, 0)))).toBe(false);
  });

  it('accepte une date au format chaîne (ce que renvoie pg en JSON)', () => {
    expect(isPhotoFresh('/p.jpg', '2026-07-20T10:00:00.000Z', 6, NOW)).toBe(true);
    expect(isPhotoFresh('/p.jpg', '2025-07-20T10:00:00.000Z', 6, NOW)).toBe(false);
  });
});

describe('isPhotoFresh — seuil paramétré', () => {
  it('seuil 3 mois : une photo de 5 mois devient caduque', () => {
    expect(isPhotoFresh('/p.jpg', monthsBefore(5), 3, NOW)).toBe(false);
    expect(isPhotoFresh('/p.jpg', monthsBefore(2), 3, NOW)).toBe(true);
  });

  it('seuil 12 mois : une photo de 6 mois reste fraîche', () => {
    expect(isPhotoFresh('/p.jpg', monthsBefore(6), 12, NOW)).toBe(true);
  });

  it('seuil illisible ou < 1 → repli sur le défaut 6 (jamais de seuil aberrant)', () => {
    expect(isPhotoFresh('/p.jpg', monthsBefore(5), 0, NOW)).toBe(true);   // 6 par défaut
    expect(isPhotoFresh('/p.jpg', monthsBefore(5), null, NOW)).toBe(true);
    expect(isPhotoFresh('/p.jpg', monthsBefore(7), 'abc', NOW)).toBe(false);
    expect(DEFAULT_PHOTO_FRAICHEUR_MOIS).toBe(6);
  });
});

describe('addMonths — mois calendaires, pas 30 jours fixes', () => {
  it('31 janvier + 1 mois → 28 février (borné au dernier jour, pas de débordement sur mars)', () => {
    const d = addMonths(new Date(Date.UTC(2026, 0, 31, 8, 0, 0)), 1);
    expect(d.getUTCMonth()).toBe(1);
    expect(d.getUTCDate()).toBe(28);
  });

  it('31 décembre + 2 mois → 28 février de l\'année suivante', () => {
    const d = addMonths(new Date(Date.UTC(2025, 11, 31, 8, 0, 0)), 2);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(1);
    expect(d.getUTCDate()).toBe(28);
  });

  it('une photo du 31 janvier est caduque au 1er mars avec un seuil de 1 mois', () => {
    const taken = new Date(Date.UTC(2026, 0, 31, 8, 0, 0));
    expect(isPhotoFresh('/p.jpg', taken, 1, new Date(Date.UTC(2026, 1, 27, 8, 0, 0)))).toBe(true);
    expect(isPhotoFresh('/p.jpg', taken, 1, new Date(Date.UTC(2026, 2, 1, 8, 0, 0)))).toBe(false);
  });
});

describe('getPhotoFraicheurMois — lecture du réglage', () => {
  beforeEach(() => resetPhotoFraicheurCache());

  it('lit la clé settings collecte.photo_fraicheur_mois', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ value: '3' }] }) };
    await expect(getPhotoFraicheurMois(pool)).resolves.toBe(3);
    expect(pool.query.mock.calls[0][1]).toEqual([SETTINGS_KEY]);
    expect(SETTINGS_KEY).toBe('collecte.photo_fraicheur_mois');
  });

  it('défaut 6 si la clé est absente ou vide', async () => {
    await expect(getPhotoFraicheurMois({ query: async () => ({ rows: [] }) })).resolves.toBe(6);
    resetPhotoFraicheurCache();
    await expect(getPhotoFraicheurMois({ query: async () => ({ rows: [{ value: '' }] }) })).resolves.toBe(6);
  });

  it('résiste à une erreur base (le parcours chauffeur ne casse jamais sur un réglage)', async () => {
    const pool = { query: async () => { throw new Error('relation "settings" does not exist'); } };
    await expect(getPhotoFraicheurMois(pool)).resolves.toBe(6);
  });

  it('met le réglage en cache (une seule lecture pour plusieurs appels)', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ value: '9' }] }) };
    await getPhotoFraicheurMois(pool);
    await getPhotoFraicheurMois(pool);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
