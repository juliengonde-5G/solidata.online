// Tests de la logique PURE d'observabilité (Vague 3 — item 3.D-1 a/d) :
// détection « en retard » (jobs) et « stale » (chaînes temps réel).
// On mocke la DB pour que le require du routeur (→ middleware/auth) ne tente
// aucune connexion réelle ; seules les fonctions pures sont testées ici.
const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));

const monitoring = require('../../../src/routes/monitoring');
const { isBusinessHours, isJobLate, computeFreshness, JOB_SCHEDULE } = monitoring;

const H = 3600 * 1000;

describe('monitoring — fonctions pures', () => {
  describe('isBusinessHours (Lun–Sam 7h–19h)', () => {
    it('mardi 10h → true', () => expect(isBusinessHours(new Date(2026, 6, 14, 10))).toBe(true));
    it('samedi 12h → true (structure ouverte le samedi)', () => expect(isBusinessHours(new Date(2026, 6, 18, 12))).toBe(true));
    it('dimanche 10h → false', () => expect(isBusinessHours(new Date(2026, 6, 19, 10))).toBe(false));
    it('mardi 5h (avant 7h) → false', () => expect(isBusinessHours(new Date(2026, 6, 14, 5))).toBe(false));
    it('mardi 19h (borne haute exclue) → false', () => expect(isBusinessHours(new Date(2026, 6, 14, 19))).toBe(false));
    it('mardi 7h (borne basse incluse) → true', () => expect(isBusinessHours(new Date(2026, 6, 14, 7))).toBe(true));
  });

  describe('isJobLate', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    it('cadence inconnue (maxAgeMs falsy) → null', () => {
      expect(isJobLate(new Date('2026-07-13T00:00:00Z'), null, now)).toBeNull();
      expect(isJobLate(new Date('2026-07-13T00:00:00Z'), 0, now)).toBeNull();
    });
    it('jamais réussi (lastSuccess null) → null — pas de fausse alerte au déploiement', () => {
      expect(isJobLate(null, 26 * H, now)).toBeNull();
    });
    it('dernier succès dans la fenêtre → false', () => {
      expect(isJobLate(new Date('2026-07-13T00:00:00Z'), 26 * H, now)).toBe(false); // 12 h < 26 h
    });
    it('dernier succès trop vieux → true', () => {
      expect(isJobLate(new Date('2026-07-11T00:00:00Z'), 26 * H, now)).toBe(true); // 60 h > 26 h
    });
    it('accepte une chaîne ISO', () => {
      expect(isJobLate('2026-07-11T00:00:00Z', 26 * H, now)).toBe(true);
    });
    it('job hebdo : 3 jours < 8 jours → false', () => {
      expect(isJobLate(new Date('2026-07-10T12:00:00Z'), 24 * 8 * H, now)).toBe(false);
    });
  });

  describe('computeFreshness', () => {
    const now = new Date(2026, 6, 14, 10); // mardi 10h — heures ouvrées

    it('lastAt null → unknown (source absente), jamais stale', () => {
      const r = computeFreshness(null, { thresholdMs: H, now });
      expect(r.status).toBe('unknown');
      expect(r.stale).toBe(false);
      expect(r.age_ms).toBeNull();
    });
    it('active=false (hors VAK) → idle, jamais stale', () => {
      const r = computeFreshness(new Date(now.getTime() - 10 * H), { thresholdMs: H, now, active: false });
      expect(r.status).toBe('idle');
      expect(r.stale).toBe(false);
    });
    it('récent → fresh', () => {
      const r = computeFreshness(new Date(now.getTime() - 30 * 60 * 1000), { thresholdMs: 6 * H, now });
      expect(r.status).toBe('fresh');
      expect(r.stale).toBe(false);
    });
    it('trop vieux en heures ouvrées (businessOnly) → stale', () => {
      const r = computeFreshness(new Date(now.getTime() - 8 * H), { thresholdMs: 6 * H, now, businessOnly: true });
      expect(r.status).toBe('stale');
      expect(r.stale).toBe(true);
    });
    it('trop vieux mais businessOnly hors heures ouvrées → off_hours, jamais stale', () => {
      const night = new Date(2026, 6, 14, 3); // mardi 3h
      const r = computeFreshness(new Date(night.getTime() - 8 * H), { thresholdMs: 6 * H, now: night, businessOnly: true });
      expect(r.status).toBe('off_hours');
      expect(r.stale).toBe(false);
    });
    it('trop vieux sans businessOnly (capteurs 24/7) → stale même la nuit', () => {
      const night = new Date(2026, 6, 14, 3);
      const r = computeFreshness(new Date(night.getTime() - 8 * H), { thresholdMs: 6 * H, now: night, businessOnly: false });
      expect(r.status).toBe('stale');
      expect(r.stale).toBe(true);
    });
    it('age_minutes calculé correctement', () => {
      const r = computeFreshness(new Date(now.getTime() - 90 * 60 * 1000), { thresholdMs: 6 * H, now });
      expect(r.age_minutes).toBe(90);
    });
    it('accepte une chaîne ISO comme lastAt', () => {
      const r = computeFreshness(new Date(now.getTime() - 30 * 60 * 1000).toISOString(), { thresholdMs: 6 * H, now });
      expect(r.status).toBe('fresh');
    });
  });

  describe('JOB_SCHEDULE (registre de cadence)', () => {
    it('couvre les jobs clés du scheduler avec un maxAgeHours positif', () => {
      for (const j of [
        'checkAppointmentReminders', 'purgeOldGpsPositions', 'refreshMaterializedViews',
        'syncVakSumUp', 'syncPennylaneDaily', 'generateDailyPredictions',
        'checkQhseHabilitationExpiries', 'purgeOldJobRuns',
      ]) {
        expect(JOB_SCHEDULE[j]).toBeDefined();
        expect(JOB_SCHEDULE[j].maxAgeHours).toBeGreaterThan(0);
        expect(typeof JOB_SCHEDULE[j].label).toBe('string');
      }
    });
    it('la cadence hebdo/mensuelle/annuelle est plus tolérante que la quotidienne', () => {
      expect(JOB_SCHEDULE.checkQhseHabilitationExpiries.maxAgeHours)
        .toBeGreaterThan(JOB_SCHEDULE.checkAppointmentReminders.maxAgeHours);
      expect(JOB_SCHEDULE.discoverEvents.maxAgeHours)
        .toBeGreaterThan(JOB_SCHEDULE.checkQhseHabilitationExpiries.maxAgeHours);
      expect(JOB_SCHEDULE.syncAllHolidays.maxAgeHours)
        .toBeGreaterThan(JOB_SCHEDULE.discoverEvents.maxAgeHours);
    });
  });
});
