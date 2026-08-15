// ═══════════════════════════════════════════════════════════════════════════
// MODULE 33 « TEMPS & PRÉSENCE » — REVUE CODEX C1 & C2
// ───────────────────────────────────────────────────────────────────────────
// C1 — POPULATION : un salarié qui n'a QUE des corrections sur le mois (mission
//      extérieure : aucun pointage brut, aucune feuille ouverte) doit figurer
//      dans GET /feuilles-temps, sinon ses heures existent en base mais ne
//      peuvent être ni validées ni exportées en paie/IAE.
//
// C2 — FRONTIÈRE DE PÉRIODE : une correction qui déplace un pointage À TRAVERS
//      une frontière de jour/mois doit être comptée UNE fois, du côté de son
//      horodatage CORRIGÉ — la période de destination doit la voir, la période
//      d'origine doit cesser de compter l'événement brut. Et le verrou « période
//      validée RH » doit regarder les DEUX périodes touchées.
//
// La base est mockée mais les PRÉDICATS des requêtes sont réellement rejoués en
// JavaScript sur des fixtures : ces tests vérifient donc le COMPORTEMENT (les
// heures qui tombent dans le bon mois), pas seulement le texte du SQL — le SQL
// généré est vérifié en plus là où la revue l'exige.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const badgeuse = require('../../src/routes/badgeuse');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH') };

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse', badgeuse);
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// ── Mini-base : les prédicats réels, rejoués en JS ─────────────────────────
const R = (rows) => Promise.resolve({ rows });
const ms = (v) => new Date(v).getTime();
const dansFenetre = (v, debut, fin) => v != null && ms(v) >= ms(debut) && ms(v) < ms(fin);

/** SQL de la dernière requête de population (assertions « SQL généré »). */
let sqlPopulation = null;

function installDb({
  employees = [], pointages = [], corrections = [], feuilles = [], contrats = [],
} = {}) {
  sqlPopulation = null;
  const feuillesEnBase = feuilles.map((f) => ({ ...f }));

  mockQuery.mockImplementation((sql, params = []) => {
    const s = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return R([]);
    if (/INSERT INTO rgpd_audit_log/.test(s)) return R([]);
    if (/FROM settings|INSERT INTO settings/.test(s)) return R([]);        // défauts ADR-0002
    if (/FROM employee_contracts/.test(s)) return R(contrats);

    // ── Population de la période (3 membres UNION) ──
    if (/FROM employees e\s+WHERE e\.id IN/.test(s)) {
      sqlPopulation = s;
      const [debut, fin, periode] = params;
      const ids = new Set();
      for (const p of pointages) {
        if (p.employee_id != null && dansFenetre(p.horodatage_utc, debut, fin)) ids.add(p.employee_id);
      }
      for (const f of feuillesEnBase) if (f.periode === periode) ids.add(f.employee_id);
      if (/SELECT c\.employee_id FROM badgeuse_corrections c/.test(s)) {     // membre C1
        for (const c of corrections) {
          const lie = pointages.find((p) => p.id === c.pointage_id);
          if (dansFenetre(c.horodatage_corrige, debut, fin)
            || (lie && dansFenetre(lie.horodatage_utc, debut, fin))) ids.add(c.employee_id);
        }
      }
      return R(employees.filter((e) => ids.has(e.id))
        .sort((a, b) => String(a.last_name).localeCompare(String(b.last_name))));
    }

    // ── computeEmployeePeriod (1) pointages : fenêtre OU déplacés dedans ──
    if (/FROM badgeuse_pointages p\s+WHERE p\.employee_id = \$1/.test(s)) {
      const [employeeId, debut, fin] = params;
      const rows = pointages.filter((p) => p.employee_id === employeeId && (
        dansFenetre(p.horodatage_utc, debut, fin)
        || (/EXISTS/.test(s) && corrections.some((c) => c.pointage_id === p.id
          && dansFenetre(c.horodatage_corrige, debut, fin)))
      )).sort((a, b) => ms(a.horodatage_utc) - ms(b.horodatage_utc));
      return R(rows);
    }

    // ── computeEmployeePeriod (2) corrections : fenêtre OU pointage chargé ──
    if (/FROM badgeuse_corrections c\s+WHERE c\.employee_id = \$1/.test(s)) {
      const [employeeId, debut, fin, ids] = params;
      const charges = Array.isArray(ids) ? ids.map(Number) : [];
      const rows = corrections.filter((c) => c.employee_id === employeeId && (
        dansFenetre(c.horodatage_corrige, debut, fin)
        || (c.pointage_id != null && charges.includes(Number(c.pointage_id)))
      )).sort((a, b) => a.id - b.id);
      return R(rows);
    }

    // ── Feuilles ──
    if (/SELECT employee_id FROM badgeuse_feuilles_temps WHERE periode = \$1/.test(s)) {
      return R(feuillesEnBase.filter((f) => f.periode === params[0]).map((f) => ({ employee_id: f.employee_id })));
    }
    if (/SELECT periode, statut FROM badgeuse_feuilles_temps/.test(s)) {
      const [employeeId, periodes] = params;
      return R(feuillesEnBase.filter((f) => f.employee_id === employeeId && periodes.includes(f.periode))
        .map((f) => ({ periode: f.periode, statut: f.statut })));
    }
    if (/SELECT \* FROM badgeuse_feuilles_temps WHERE employee_id = \$1/.test(s)) {
      const [employeeId, periode] = params;
      return R(feuillesEnBase.filter((f) => f.employee_id === employeeId && f.periode === periode));
    }
    if (/INSERT INTO badgeuse_feuilles_temps/.test(s)) {
      const [employee_id, periode, heures_theoriques, heures_pointees, detail] = params;
      const ligne = {
        id: feuillesEnBase.length + 1, employee_id, periode, statut: 'brouillon',
        heures_theoriques, heures_pointees, heures_validees: null, detail: JSON.parse(detail),
      };
      const i = feuillesEnBase.findIndex((f) => f.employee_id === employee_id && f.periode === periode);
      if (i >= 0) feuillesEnBase[i] = ligne; else feuillesEnBase.push(ligne);
      return R([ligne]);
    }
    if (/FROM badgeuse_feuilles_temps f/.test(s)) {                          // exports
      const periode = params[0];
      return R(feuillesEnBase.filter((f) => f.periode === periode).map((f) => {
        const e = employees.find((x) => x.id === f.employee_id) || {};
        return { ...f, first_name: e.first_name, last_name: e.last_name, malibou_id: e.malibou_id };
      }));
    }

    // ── POST /corrections ──
    if (/SELECT horodatage_utc FROM badgeuse_pointages WHERE id = \$1/.test(s)) {
      const p = pointages.find((x) => x.id === params[0]);
      return R(p ? [{ horodatage_utc: p.horodatage_utc }] : []);
    }
    if (/FROM employees WHERE id = \$1/.test(s)) {
      const e = employees.find((x) => x.id === params[0]);
      return R(e ? [{ id: e.id, user_id: e.user_id ?? 999 }] : []);
    }
    if (/INSERT INTO badgeuse_corrections/.test(s)) {
      return R([{ id: 99, employee_id: params[1], type: params[2], motif_code: params[5] }]);
    }
    return R([]);
  });
  return feuillesEnBase;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
});

const SALARIES = [
  { id: 5, first_name: 'Karim', last_name: 'Benali', malibou_id: 'M42', team_id: 1, user_id: 501 },
  { id: 7, first_name: 'Sonia', last_name: 'Dupont', malibou_id: 'M43', team_id: 1, user_id: 701 },
];

/** Journée de mission extérieure du 12/08 (heures MURALES Paris = UTC+2). */
const AJOUTS_MISSION = [
  { id: 1, pointage_id: null, employee_id: 7, type: 'ajout', horodatage_corrige: '2026-08-12T06:00:00Z', sens_corrige: 'entree', motif_code: 'mission_exterieure' },
  { id: 2, pointage_id: null, employee_id: 7, type: 'ajout', horodatage_corrige: '2026-08-12T14:00:00Z', sens_corrige: 'sortie', motif_code: 'mission_exterieure' },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('C1 — un salarié qui n\'a QUE des corrections entre dans la population', () => {
  test('la requête de population comporte le membre UNION « corrections » (SQL généré)', async () => {
    installDb({ employees: SALARIES, corrections: AJOUTS_MISSION });
    await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    expect(sqlPopulation).toMatch(/UNION[\s\S]*badgeuse_corrections/);
    // Les deux voies exigées par la revue : horodatage corrigé DANS le mois,
    // ou correction rattachée à un pointage du mois.
    expect(sqlPopulation).toMatch(/c\.horodatage_corrige >= \$1 AND c\.horodatage_corrige < \$2/);
    expect(sqlPopulation).toMatch(/p\.horodatage_utc >= \$1 AND p\.horodatage_utc < \$2/);
    expect(sqlPopulation).toMatch(/LEFT JOIN badgeuse_pointages p ON p\.id = c\.pointage_id/);
  });

  test('COMPORTEMENT : sans pointage ni feuille, il figure dans la liste mensuelle avec ses heures', async () => {
    installDb({ employees: SALARIES, corrections: AJOUTS_MISSION });
    const r = await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    expect(r.status).toBe(200);
    const sonia = r.body.feuilles.find((f) => f.employee_id === 7);
    expect(sonia).toBeDefined();                       // ← invisible avant le correctif
    expect(sonia.nom).toBe('DUPONT Sonia');
    // 08:00 → 16:00 Paris = 8 h, moins la pause monotone de 45 min (aucun
    // pointage intermédiaire au-delà du seuil) = 7,25 h.
    expect(sonia.heures_pointees).toBe(7.25);
    expect(sonia.jours_travailles).toBe(1);
    expect(sonia.statut).toBe('brouillon');
  });

  test('CONTRE-ÉPREUVE : sans le membre « corrections », il disparaît (le test est portant)', async () => {
    // Même fixture, mais la mini-base ignore le membre UNION corrections :
    // la population retombe sur pointages + feuilles, et Sonia s'évapore.
    installDb({ employees: SALARIES, corrections: AJOUTS_MISSION });
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => (
      /FROM employees e\s+WHERE e\.id IN/.test(String(sql))
        ? base(String(sql).replace('SELECT c.employee_id FROM badgeuse_corrections c', 'SELECT c.employee_id FROM neant c'), params)
        : base(sql, params)
    ));
    const r = await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    expect(r.body.feuilles.find((f) => f.employee_id === 7)).toBeUndefined();
  });

  test('EXPORT PAIE : il n\'est plus invisible — sa feuille est créée, donc il bloque l\'export tant qu\'il n\'est pas validé', async () => {
    installDb({
      employees: SALARIES, corrections: AJOUTS_MISSION,
      feuilles: [{ employee_id: 5, periode: '2026-08', statut: 'validee_rh', heures_validees: '151.50', heures_pointees: '151.50', detail: [{ date: '2026-08-17', minutes: 480 }] }],
    });
    const r = await get('/api/badgeuse/exports/paie?periode=2026-08', 'RH');
    expect(r.status).toBe(409);
    expect(r.body.non_validees).toEqual([
      { employee_id: 7, nom: 'DUPONT Sonia', statut: 'brouillon' },
    ]);
  });

  test('EXPORT PAIE : l\'export ne dépend plus d\'un passage préalable par l\'écran mensuel', async () => {
    installDb({ employees: SALARIES, corrections: AJOUTS_MISSION });
    await get('/api/badgeuse/exports/paie?periode=2026-08&force=1', 'RH');
    const inserts = mockQuery.mock.calls.filter((c) => /INSERT INTO badgeuse_feuilles_temps/.test(String(c[0])));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][0]).toBe(7);                  // la feuille manquante est matérialisée
    expect(inserts[0][1][1]).toBe('2026-08');
  });

  test('EXPORT IAE : même population — la feuille manquante est créée (donc validable)', async () => {
    installDb({ employees: SALARIES, corrections: AJOUTS_MISSION });
    const r = await get('/api/badgeuse/exports/iae?periode=2026-08', 'RH');
    expect(r.status).toBe(200);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_feuilles_temps/.test(String(c[0])))).toBe(true);
  });

  test('ANOMALIES : même population sur une fenêtre libre — l\'oubli de sortie d\'une mission est visible', async () => {
    // Une seule correction « ajout » d'ENTRÉE, aucune sortie : l'anomalie
    // existait en base mais aucun écran ne la montrait, faute de population.
    installDb({ employees: SALARIES, corrections: [AJOUTS_MISSION[0]] });
    const r = await get('/api/badgeuse/anomalies?du=2026-08-01&au=2026-08-31');
    expect(r.status).toBe(200);
    expect(r.body.anomalies.some((a) => a.nom === 'DUPONT Sonia' && a.type === 'oubli_sortie')).toBe(true);
    // Fenêtre libre : pas de membre « feuille de la période » (il n'y a pas de
    // période), mais bien le membre « corrections ».
    expect(sqlPopulation).not.toMatch(/badgeuse_feuilles_temps/);
    expect(sqlPopulation).toMatch(/SELECT c\.employee_id FROM badgeuse_corrections c/);
  });

  test('une feuille DÉJÀ validée n\'est jamais réécrite par la matérialisation', async () => {
    installDb({
      employees: SALARIES, corrections: AJOUTS_MISSION,
      feuilles: [{ employee_id: 7, periode: '2026-08', statut: 'validee_rh', heures_validees: '7.25', heures_pointees: '7.25', detail: [] }],
    });
    await get('/api/badgeuse/exports/paie?periode=2026-08', 'RH');
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_feuilles_temps/.test(String(c[0])))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C2 — le pointage du 31/07 23:50 Paris (21:50 UTC) est recalé au 01/08 00:10
// Paris (22:10 UTC) ; la sortie du 01/08 06:00 Paris (04:00 UTC) est intacte.
// ═══════════════════════════════════════════════════════════════════════════
describe('C2 — une correction qui franchit la frontière de mois', () => {
  const POINTAGES = [
    { id: 1, employee_id: 5, horodatage_utc: '2026-07-31T21:50:00Z', sens: 'entree', source: 'badge', statut: 'traite' },
    { id: 2, employee_id: 5, horodatage_utc: '2026-08-01T04:00:00Z', sens: 'sortie', source: 'badge', statut: 'traite' },
  ];
  const DEPLACEMENT = [{
    id: 10, pointage_id: 1, employee_id: 5, type: 'modification',
    horodatage_corrige: '2026-07-31T22:10:00Z', sens_corrige: 'entree', motif_code: 'oubli_badge',
  }];

  const feuille = async (periode) => (await get(`/api/badgeuse/feuilles-temps/5?periode=${periode}`)).body;

  test('AOÛT compte l\'entrée déplacée : la journée du 01/08 est complète', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES, corrections: DEPLACEMENT });
    const f = await feuille('2026-08');
    const jour = f.detail.find((j) => j.date === '2026-08-01');
    expect(jour).toBeDefined();
    expect(jour.minutes).toBeGreaterThan(0);
    // 00:10 → 06:00 Paris = 5 h 50 (aucune pause : sous le seuil de 6 h).
    expect(f.heures_pointees).toBeCloseTo(5.83, 2);
  });

  test('JUILLET ne compte plus l\'événement brut sorti du mois', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES, corrections: DEPLACEMENT });
    const f = await feuille('2026-07');
    expect(f.heures_pointees).toBe(0);
    expect((f.detail || []).some((j) => (Number(j.minutes) || 0) > 0)).toBe(false);
  });

  test('CONTRE-ÉPREUVE sans correction : c\'est bien JUILLET qui porte le pointage', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES, corrections: [] });
    const juillet = await feuille('2026-07');
    expect(juillet.detail.some((j) => j.date === '2026-07-31')).toBe(true);
    const aout = await feuille('2026-08');
    expect(aout.detail.some((j) => j.date === '2026-07-31')).toBe(false);
  });

  test('la requête de pointages charge AUSSI ceux qu\'une correction fait entrer (EXISTS)', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES, corrections: DEPLACEMENT });
    await feuille('2026-08');
    const sql = mockQuery.mock.calls.map((c) => String(c[0]))
      .find((s) => /FROM badgeuse_pointages p\s+WHERE p\.employee_id = \$1/.test(s));
    expect(sql).toMatch(/EXISTS \(\s*SELECT 1 FROM badgeuse_corrections c/);
    expect(sql).toMatch(/c\.horodatage_corrige >= \$2 AND c\.horodatage_corrige < \$3/);
  });

  test('la requête de corrections charge AUSSI celles des pointages chargés (sortie de fenêtre)', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES, corrections: DEPLACEMENT });
    await feuille('2026-07');
    const appel = mockQuery.mock.calls
      .find((c) => /FROM badgeuse_corrections c\s+WHERE c\.employee_id = \$1/.test(String(c[0])));
    expect(String(appel[0])).toMatch(/c\.pointage_id = ANY\(\$4::bigint\[\]\)/);
    // Le pointage de juillet (déplacé en août) est chargé, donc sa correction
    // aussi ; le pointage du 01/08 04:00 entre par la marge de chargement.
    expect(appel[1][3]).toContain(1);
  });

  test('la fenêtre de CHARGEMENT est élargie de 24 h de part et d\'autre', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES, corrections: DEPLACEMENT });
    await feuille('2026-08');
    const appel = mockQuery.mock.calls
      .find((c) => /FROM badgeuse_pointages p\s+WHERE p\.employee_id = \$1/.test(String(c[0])));
    // Bornes strictes d'août : 2026-07-31T22:00Z → 2026-08-31T22:00Z.
    expect(new Date(appel[1][1]).toISOString()).toBe('2026-07-30T22:00:00.000Z');
    expect(new Date(appel[1][2]).toISOString()).toBe('2026-09-01T22:00:00.000Z');
  });

  test('l\'heure déplacée est comptée UNE seule fois (juillet + août = la seule journée réelle)', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES, corrections: DEPLACEMENT });
    const total = (await feuille('2026-07')).heures_pointees + (await feuille('2026-08')).heures_pointees;
    expect(total).toBeCloseTo(5.83, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// Revue Codex (correctif C2) — LA PAIRE NOCTURNE À LA FRONTIÈRE DE MOIS.
// Entrée 31/08 23:50 Paris (21:50 UTC) ; sortie badgée 23:58 (21:58 UTC) puis
// CORRIGÉE au 01/09 00:10 Paris (22:10 UTC). Filtrer les ÉVÉNEMENTS avant
// l'appariement perdait les 20 minutes des deux côtés ; le filtrage par
// JOURNÉE (jour civil de l'entrée) les conserve, du côté d'août.
// ═══════════════════════════════════════════════════════════════════════════
describe('C2 — nuit à cheval sur la frontière de mois (scénario Codex)', () => {
  const POINTAGES_NUIT = [
    { id: 1, employee_id: 5, horodatage_utc: '2026-08-31T21:50:00Z', sens: 'entree', source: 'badge', statut: 'traite' },
    { id: 2, employee_id: 5, horodatage_utc: '2026-08-31T21:58:00Z', sens: 'sortie', source: 'badge', statut: 'traite' },
  ];
  const SORTIE_REPORTEE = [{
    id: 20, pointage_id: 2, employee_id: 5, type: 'modification',
    horodatage_corrige: '2026-08-31T22:10:00Z', sens_corrige: 'sortie', motif_code: 'oubli_badge',
  }];
  const feuille = async (periode) => (await get(`/api/badgeuse/feuilles-temps/5?periode=${periode}`)).body;

  test('AOÛT compte les 20 minutes sur la journée du 31/08 (entrée + sortie corrigée)', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES_NUIT, corrections: SORTIE_REPORTEE });
    const f = await feuille('2026-08');
    const nuit = f.detail.find((j) => j.date === '2026-08-31');
    expect(nuit).toBeDefined();
    expect(nuit.minutes).toBe(20);                      // 23:50 → 00:10
    expect(f.heures_pointees).toBeCloseTo(0.33, 2);
    expect(nuit.anomalies).toEqual([]);                 // paire complète
  });

  test('SEPTEMBRE ne compte rien ET ne fabrique pas d\'anomalie « sortie sans entrée »', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES_NUIT, corrections: SORTIE_REPORTEE });
    const f = await feuille('2026-09');
    expect(f.heures_pointees).toBe(0);
    expect(f.detail).toEqual([]);
    expect(f.nb_anomalies).toBe(0);
  });

  test('les minutes ne sont comptées qu\'UNE fois (août + septembre)', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES_NUIT, corrections: SORTIE_REPORTEE });
    const total = (await feuille('2026-08')).heures_pointees + (await feuille('2026-09')).heures_pointees;
    expect(total).toBeCloseTo(0.33, 2);
  });

  /** Ramène les bornes de CHARGEMENT à la fenêtre stricte (avant correctif). */
  function sansMarge() {
    const base = mockQuery.getMockImplementation();
    const MARGE = 24 * 3600 * 1000;
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/FROM badgeuse_pointages p\s+WHERE p\.employee_id = \$1/.test(s)
        || /FROM badgeuse_corrections c\s+WHERE c\.employee_id = \$1/.test(s)) {
        const stricts = [...params];
        stricts[1] = new Date(new Date(params[1]).getTime() + MARGE);
        stricts[2] = new Date(new Date(params[2]).getTime() - MARGE);
        return base(sql, stricts);
      }
      return base(sql, params);
    });
  }

  test('CONTRE-ÉPREUVE (1) : sans la marge, septembre fabrique l\'anomalie fantôme « sortie sans entrée »', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGES_NUIT, corrections: SORTIE_REPORTEE });
    sansMarge();
    const septembre = await feuille('2026-09');
    expect(septembre.nb_anomalies).toBeGreaterThan(0);  // la sortie tombe seule
    expect(septembre.detail.length).toBeGreaterThan(0);
    // (Août est ici rattrapé par la clause « corrections des pointages
    // chargés » : c'est septembre que la marge assainit.)
  });

  test('CONTRE-ÉPREUVE (2) : une nuit ORDINAIRE à cheval — sans marge, les minutes sont perdues des DEUX côtés', async () => {
    // Aucune correction : simple nuit du 31/08 23:50 au 01/09 06:00. C'est le
    // cas que la seule marge de chargement sauve.
    const nuitOrdinaire = [
      { id: 1, employee_id: 5, horodatage_utc: '2026-08-31T21:50:00Z', sens: 'entree', source: 'badge', statut: 'traite' },
      { id: 2, employee_id: 5, horodatage_utc: '2026-09-01T04:00:00Z', sens: 'sortie', source: 'badge', statut: 'traite' },
    ];
    installDb({ employees: SALARIES, pointages: nuitOrdinaire });
    sansMarge();
    expect((await feuille('2026-08')).heures_pointees).toBe(0);      // entrée orpheline
    expect((await feuille('2026-09')).heures_pointees).toBe(0);      // sortie orpheline

    installDb({ employees: SALARIES, pointages: nuitOrdinaire });    // avec la marge
    const aout = await feuille('2026-08');
    expect(aout.detail.map((j) => j.date)).toEqual(['2026-08-31']);
    // 23:50 → 06:00 = 6 h 10 brutes, ramenées à 6 h 00 par la pause MONOTONE
    // (déduction plafonnée au dépassement du seuil de 6 h — ADR-0002/QA-06).
    expect(aout.heures_pointees).toBe(6);
    expect((await feuille('2026-09')).heures_pointees).toBe(0);      // comptée UNE fois
  });

  test('ANOMALIES : une journée hors période ne remonte pas dans la fenêtre demandée', async () => {
    // Entrée orpheline du 31/07 (oubli de sortie) : chargée par la marge d'août,
    // sa journée est datée du 31/07 → elle ne pollue pas les anomalies d'août.
    installDb({
      employees: SALARIES,
      pointages: [{ id: 1, employee_id: 5, horodatage_utc: '2026-07-31T06:00:00Z', sens: 'entree', source: 'badge', statut: 'traite' }],
    });
    const r = await get('/api/badgeuse/anomalies?du=2026-08-01&au=2026-08-31');
    expect(r.status).toBe(200);
    expect(r.body.anomalies).toEqual([]);
  });

  test('COMPORTEMENT DOCUMENTÉ : la frontière de mois n\'est plus un reset — une sortie badgée après un oubli reste rattachée au jour de l\'entrée', async () => {
    // Oubli de sortie le 31/08, sortie badgée le 01/09 : le moteur apparie (il
    // le fait déjà entre deux jours d'un même mois) et date la journée du 31/08,
    // avec ses anomalies. Août la porte, septembre non — la frontière de mois
    // se comporte comme n'importe quelle frontière de jour.
    installDb({
      employees: SALARIES,
      pointages: [
        { id: 1, employee_id: 5, horodatage_utc: '2026-08-31T06:00:00Z', sens: 'entree', source: 'badge', statut: 'traite' },
        { id: 2, employee_id: 5, horodatage_utc: '2026-09-01T05:00:00Z', sens: 'sortie', source: 'badge', statut: 'traite' },
      ],
    });
    const aout = await feuille('2026-08');
    expect(aout.detail.map((j) => j.date)).toEqual(['2026-08-31']);
    expect(aout.nb_anomalies).toBeGreaterThan(0);       // journée longue signalée
    const septembre = await feuille('2026-09');
    expect(septembre.detail).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C2 — double verrou « période validée RH » sur POST /corrections', () => {
  const POINTAGE_JUILLET = [
    { id: 1, employee_id: 5, horodatage_utc: '2026-07-31T21:50:00Z', sens: 'entree', source: 'badge', statut: 'traite' },
  ];
  /** Déplacement du 31/07 23:50 Paris vers le 01/08 00:10 Paris. */
  const deplacer = () => post('/api/badgeuse/corrections', 'RH', {
    employee_id: 5, type: 'modification', pointage_id: 1,
    horodatage_corrige: '2026-08-01T00:10', motif_code: 'oubli_badge',
  });

  test('refus si la période d\'ORIGINE est validée RH (on ne vide pas un mois clos)', async () => {
    installDb({
      employees: SALARIES, pointages: POINTAGE_JUILLET,
      feuilles: [{ employee_id: 5, periode: '2026-07', statut: 'validee_rh' }],
    });
    const r = await deplacer();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/2026-07/);
    expect(r.body.periodes_concernees).toEqual(expect.arrayContaining(['2026-07', '2026-08']));
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_corrections/.test(String(c[0])))).toBe(false);
  });

  test('refus si la période de DESTINATION est validée RH (on ne remplit pas un mois clos)', async () => {
    installDb({
      employees: SALARIES, pointages: POINTAGE_JUILLET,
      feuilles: [{ employee_id: 5, periode: '2026-08', statut: 'validee_rh' }],
    });
    const r = await deplacer();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/2026-08/);
  });

  test('les DEUX périodes sont réellement interrogées (une seule requête, paramétrée)', async () => {
    installDb({ employees: SALARIES, pointages: POINTAGE_JUILLET });
    await deplacer();
    const appel = mockQuery.mock.calls
      .find((c) => /SELECT periode, statut FROM badgeuse_feuilles_temps/.test(String(c[0])));
    expect(String(appel[0])).toMatch(/periode = ANY\(\$2::varchar\[\]\)/);
    expect(appel[1][1].sort()).toEqual(['2026-07', '2026-08']);
  });

  test('les deux périodes ouvertes (brouillon / validée encadrant) : la correction passe', async () => {
    installDb({
      employees: SALARIES, pointages: POINTAGE_JUILLET,
      feuilles: [
        { employee_id: 5, periode: '2026-07', statut: 'validee_encadrant' },
        { employee_id: 5, periode: '2026-08', statut: 'brouillon' },
      ],
    });
    expect((await deplacer()).status).toBe(201);
  });

  test('un AJOUT ne verrouille que sa propre période (aucune période d\'origine inventée)', async () => {
    installDb({
      employees: SALARIES,
      feuilles: [{ employee_id: 5, periode: '2026-07', statut: 'validee_rh' }],
    });
    const r = await post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-12T08:00',
      sens_corrige: 'entree', motif_code: 'mission_exterieure',
    });
    expect(r.status).toBe(201);
    const appel = mockQuery.mock.calls
      .find((c) => /SELECT periode, statut FROM badgeuse_feuilles_temps/.test(String(c[0])));
    expect(appel[1][1]).toEqual(['2026-08']);
  });
});
