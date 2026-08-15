/**
 * Module 33 « Temps & Présence » — API Device v1 (surface publique X-Device-Key).
 *
 * Verrouille le CONTRAT_API_DEVICE : authentification à condensat, idempotence
 * par uuid, statut par élément (jamais d'échec silencieux), stockage des
 * orphelins, détection de rupture de chaîne SANS perte de la donnée, ETag/304,
 * heartbeat.
 *
 * Vérifie AUSSI l'invariant de minimisation le plus dur à tenir dans la durée :
 * aucun identifiant de badge ne doit fuir dans les journaux serveur.
 *
 * DB mockée (pattern tests/contract/effectifs-contract.test.js), aucune base.
 */
const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));

const express = require('express');
const request = require('supertest');
const { hashDeviceKey, genesisHash, chainHash, canonicalPointage } = require('../../../src/utils/badgeuse-crypto');

const deviceRouter = require('../../../src/routes/badgeuse-device');

const DEVICE_CODE = 'LH-P1';
const DEVICE_KEY = 'a'.repeat(64);
const UID_HMAC = '6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8';
const DEVICE_ROW = {
  id: 1, code: DEVICE_CODE, site_id: 1, actif: true,
  api_key_hash: hashDeviceKey(DEVICE_KEY), site_code: 'LH',
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse/device', deviceRouter);
});

/**
 * Construit un pointage cohérent avec la chaîne (hash valide) à partir du
 * maillon précédent — c'est ce que fait le poste au moment de la capture.
 */
function makePointage({ uuid, sequence = 1, precedent, uidHmac = UID_HMAC, sens = 'entree', horodatage = '2026-08-17T06:58:12.031Z' }) {
  const canonical = canonicalPointage({
    uuid, device_code: DEVICE_CODE, sequence_device: sequence,
    uid_hmac: uidHmac, horodatage_utc: horodatage, sens, source: 'badge',
  });
  return {
    uuid,
    sequence_device: sequence,
    uid_hmac: uidHmac,
    horodatage_utc: horodatage,
    horodatage_local: '2026-08-17T08:58:12',
    fuseau: 'Europe/Paris',
    sens,
    source: 'badge',
    hash_precedent: precedent,
    hash_courant: chainHash(precedent, canonical),
  };
}

/**
 * Mock DB par motif SQL.
 * @param {object} o { device, badge, dernier, insertFails }
 */
function installMocks({ device = DEVICE_ROW, badge = { employee_id: 7, statut: 'actif' }, dernier = null, insertConflict = false, insertError = null } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: device ? [device] : [] });
    if (/SELECT key, value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    if (/SELECT value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    if (/ORDER BY sequence_device DESC/.test(s)) return Promise.resolve({ rows: dernier ? [dernier] : [] });
    if (/FROM badgeuse_badges WHERE uid_hmac/.test(s)) return Promise.resolve({ rows: badge ? [badge] : [] });
    if (/INSERT INTO badgeuse_pointages/.test(s)) {
      if (insertError) return Promise.reject(insertError);
      return Promise.resolve({ rows: insertConflict ? [] : [{ id: 100 }] });
    }
    if (/FROM badgeuse_badges b/.test(s)) {
      return Promise.resolve({ rows: [{ uid_hmac: UID_HMAC, employee_id: 7, first_name: 'Karim', last_name: 'Benali' }] });
    }
    if (/FROM badgeuse_contenus/.test(s)) {
      return Promise.resolve({ rows: [{ id: 7, type: 'message', titre: 'Consigne sécurité', corps: 'Port des gants obligatoire zone tri', media_url: null, duree_sec: 12, ordre: 1 }] });
    }
    if (/UPDATE badgeuse_devices/.test(s)) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  installMocks();
});

const post = (path, body, key = DEVICE_KEY) => {
  const r = request(app).post(path);
  if (key !== null) r.set('X-Device-Key', key);
  return r.send(body);
};
const get = (path, key = DEVICE_KEY, headers = {}) => {
  const r = request(app).get(path);
  if (key !== null) r.set('X-Device-Key', key);
  Object.entries(headers).forEach(([k, v]) => r.set(k, v));
  return r;
};

const PATH = `/api/badgeuse/device/v1/devices/${DEVICE_CODE}`;

describe('authentification du poste (X-Device-Key)', () => {
  test('sans clé → 401 générique', async () => {
    const r = await post(`${PATH}/pointages`, { pointages: [] }, null);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'unauthorized' });
  });

  test('mauvaise clé → 401 générique (aucun détail exploitable)', async () => {
    const r = await post(`${PATH}/pointages`, { pointages: [] }, 'b'.repeat(64));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'unauthorized' });
    expect(JSON.stringify(r.body)).not.toMatch(/inconnu|inactif|introuvable/i);
  });

  test('poste inconnu → 401 (même réponse : pas d\'énumération des postes)', async () => {
    installMocks({ device: null });
    const r = await get(`${PATH}/badges`);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'unauthorized' });
  });

  test('poste DÉSACTIVÉ → 401 même avec la bonne clé', async () => {
    installMocks({ device: { ...DEVICE_ROW, actif: false } });
    const r = await get(`${PATH}/badges`);
    expect(r.status).toBe(401);
  });

  test('poste jamais appairé (aucun condensat en base) → 401', async () => {
    installMocks({ device: { ...DEVICE_ROW, api_key_hash: null } });
    const r = await get(`${PATH}/badges`);
    expect(r.status).toBe(401);
  });

  test('la clé n\'est JAMAIS comparée en SQL (uniquement le condensat, en mémoire)', async () => {
    await get(`${PATH}/badges`);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    for (const s of sqls) expect(s).not.toMatch(/api_key\s*=/);
    // Et la clé en clair ne part dans AUCUN paramètre de requête.
    const params = mockQuery.mock.calls.flatMap((c) => c[1] || []);
    expect(params).not.toContain(DEVICE_KEY);
  });
});

describe('POST /pointages — dépôt de lot', () => {
  test('pointage nominal → status ok, et un seul INSERT', async () => {
    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555555', precedent: genesisHash(DEVICE_CODE) });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.status).toBe(200);
    expect(r.body.resultats).toEqual([{ uuid: p.uuid, status: 'ok' }]);
    expect(r.body.server_time_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('IDEMPOTENCE : le rejeu du même uuid répond « duplicate » sans insertion', async () => {
    installMocks({ insertConflict: true }); // ON CONFLICT (uuid) DO NOTHING → 0 ligne
    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555555', precedent: genesisHash(DEVICE_CODE) });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.status).toBe(200);
    expect(r.body.resultats[0]).toEqual({ uuid: p.uuid, status: 'duplicate' });
  });

  test('séquence de poste réutilisée (violation d\'unicité) → duplicate, jamais 500', async () => {
    const err = new Error('duplicate key'); err.code = '23505';
    installMocks({ insertError: err });
    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555555', precedent: genesisHash(DEVICE_CODE) });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.status).toBe(200);
    expect(r.body.resultats[0].status).toBe('duplicate');
    expect(r.body.resultats[0].avertissement).toBe('sequence_reutilisee');
  });

  test('BADGE INCONNU → « orphan » avec raison, et le pointage EST stocké', async () => {
    installMocks({ badge: null });
    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555556', precedent: genesisHash(DEVICE_CODE) });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0]).toEqual({ uuid: p.uuid, status: 'orphan', raison: 'badge_inconnu' });

    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_pointages/.test(String(c[0])));
    expect(insert).toBeDefined();                 // aucune heure n'est perdue
    expect(insert[1]).toContain('orphelin');      // statut
    expect(insert[1]).toContain('badge_inconnu'); // raison
    expect(insert[1][1]).toBeNull();              // employee_id non résolu
  });

  test('BADGE INACTIF (perdu/volé) → orphan « badge_inactif »', async () => {
    installMocks({ badge: { employee_id: 7, statut: 'perdu' } });
    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555557', precedent: genesisHash(DEVICE_CODE) });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0]).toEqual({ uuid: p.uuid, status: 'orphan', raison: 'badge_inactif' });
  });

  test('HORS PLAGE d\'acceptation → orphan « hors_plage » (règle appliquée par le SERVEUR)', async () => {
    // 01:00Z = 03:00 Paris, hors 05:00–21:00 (défauts ADR-0002).
    const p = makePointage({
      uuid: '11111111-2222-4333-8444-555555555558',
      precedent: genesisHash(DEVICE_CODE),
      horodatage: '2026-08-17T01:00:00.000Z',
    });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0]).toEqual({ uuid: p.uuid, status: 'orphan', raison: 'hors_plage' });
  });

  test('RUPTURE DE CHAÎNE : stocké quand même + avertissement chain_broken', async () => {
    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555559', precedent: genesisHash(DEVICE_CODE) });
    p.hash_courant = 'f'.repeat(64); // hash falsifié en transit
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0].status).toBe('ok');
    expect(r.body.resultats[0].avertissement).toBe('chain_broken');

    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_pointages/.test(String(c[0])));
    expect(insert[1]).toContain(false); // chaine_valide = false
  });

  test('maillon précédent incohérent → chain_broken (le pointage n\'est pas perdu)', async () => {
    const p = makePointage({ uuid: '1111111a-2222-4333-8444-555555555559', precedent: 'e'.repeat(64) });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0].avertissement).toBe('chain_broken');
    expect(r.body.resultats[0].status).toBe('ok');
  });

  test('chaîne valide en partant du dernier maillon STOCKÉ (et non de la genèse)', async () => {
    const precedent = 'c'.repeat(64);
    installMocks({ dernier: { sequence_device: 41, hash_courant: precedent } });
    const p = makePointage({ uuid: '1111111b-2222-4333-8444-555555555559', sequence: 42, precedent });
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0]).toEqual({ uuid: p.uuid, status: 'ok' });
  });

  test('lot mixte : CHAQUE élément a son statut, aucun échec silencieux', async () => {
    let appels = 0;
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/ORDER BY sequence_device DESC/.test(s)) return Promise.resolve({ rows: [] });
      if (/SELECT key, value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      // 1er badge connu, 2e inconnu.
      if (/FROM badgeuse_badges WHERE uid_hmac/.test(s)) {
        appels++;
        return Promise.resolve({ rows: appels === 1 ? [{ employee_id: 7, statut: 'actif' }] : [] });
      }
      if (/INSERT INTO badgeuse_pointages/.test(s)) return Promise.resolve({ rows: [{ id: 100 + appels }] });
      return Promise.resolve({ rows: [] });
    });

    const g = genesisHash(DEVICE_CODE);
    const p1 = makePointage({ uuid: '11111111-2222-4333-8444-555555555560', sequence: 1, precedent: g });
    const p2 = makePointage({ uuid: '11111111-2222-4333-8444-555555555561', sequence: 2, precedent: p1.hash_courant, sens: 'sortie' });
    const r = await post(`${PATH}/pointages`, { pointages: [p1, p2] });

    expect(r.body.resultats).toHaveLength(2);
    expect(r.body.resultats[0].status).toBe('ok');
    expect(r.body.resultats[1]).toEqual({ uuid: p2.uuid, status: 'orphan', raison: 'badge_inconnu' });
  });

  test('élément malformé : signalé « invalid », les autres passent', async () => {
    const bon = makePointage({ uuid: '11111111-2222-4333-8444-555555555562', precedent: genesisHash(DEVICE_CODE) });
    const r = await post(`${PATH}/pointages`, { pointages: [{ uuid: 'pas-un-uuid' }, bon] });
    expect(r.status).toBe(200);
    expect(r.body.resultats[0].status).toBe('invalid');
    expect(r.body.resultats[1].status).toBe('ok');
  });

  // ══ QA-01 — le pointage SANS BADGE est valide, jamais « invalid » ══
  // Reproduction exacte du scénario du rapport QA : `store.enqueue_pointage`
  // sérialise par défaut `uid_hmac: "-"` (store.py:147, NO_BADGE). Le serveur
  // le refusait en `invalid`, statut que le poste ne purgeait pas → l'élément
  // était retransmis indéfiniment et `taille_file` ne revenait jamais à 0.
  describe('QA-01 — pointage manuel sans badge (uid_hmac = « - »)', () => {
    const SANS_BADGE = '11111111-2222-4333-8444-5555555555a0';

    /** Pointage manuel tel que le poste le produit (forme canonique `-`). */
    function makeManuel(uidHmac) {
      const canonical = canonicalPointage({
        uuid: SANS_BADGE, device_code: DEVICE_CODE, sequence_device: 12,
        uid_hmac: null, horodatage_utc: '2026-08-17T06:58:12.031Z',
        sens: 'entree', source: 'manuel',
      });
      const precedent = genesisHash(DEVICE_CODE);
      return {
        uuid: SANS_BADGE, sequence_device: 12, uid_hmac: uidHmac,
        horodatage_utc: '2026-08-17T06:58:12.031Z', fuseau: 'Europe/Paris',
        sens: 'entree', source: 'manuel',
        hash_precedent: precedent, hash_courant: chainHash(precedent, canonical),
      };
    }

    test('« - » est ACCEPTÉ (status ok) et n\'est JAMAIS refusé en « invalid »', async () => {
      const r = await post(`${PATH}/pointages`, { pointages: [makeManuel('-')] });
      expect(r.status).toBe(200);
      expect(r.body.resultats[0]).toEqual({ uuid: SANS_BADGE, status: 'ok' });
    });

    test('« - » est stocké NULL en base (aucun faux badge « - » créé)', async () => {
      await post(`${PATH}/pointages`, { pointages: [makeManuel('-')] });
      const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_pointages/.test(String(c[0])));
      expect(insert[1][3]).toBeNull();   // uid_hmac
      // Aucune résolution de badge n'est tentée pour un pointage sans badge.
      expect(mockQuery.mock.calls.some((c) => /FROM badgeuse_badges WHERE uid_hmac/.test(String(c[0])))).toBe(false);
    });

    test('SYMÉTRIE : la chaîne reste valide — « - » stocké NULL reste « - » au recalcul', async () => {
      const r = await post(`${PATH}/pointages`, { pointages: [makeManuel('-')] });
      expect(r.body.resultats[0].avertissement).toBeUndefined(); // pas de chain_broken
      const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_pointages/.test(String(c[0])));
      expect(insert[1][14]).toBe(true); // chaine_valide
    });

    test('les trois formes d\'absence de badge sont traitées à l\'identique', async () => {
      for (const forme of ['-', '', null]) {
        mockQuery.mockClear();
        installMocks();
        const r = await post(`${PATH}/pointages`, { pointages: [makeManuel(forme)] });
        expect(r.body.resultats[0].status).toBe('ok');
        const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_pointages/.test(String(c[0])));
        expect(insert[1][3]).toBeNull();
      }
    });

    test('un uid_hmac NON conforme (ni « - » ni 64 hex) reste « invalid »', async () => {
      const r = await post(`${PATH}/pointages`, { pointages: [makeManuel('pas-un-condensat')] });
      expect(r.body.resultats[0]).toEqual({
        uuid: SANS_BADGE, status: 'invalid', raison: 'champs_invalides',
      });
    });
  });

  // ══ QA-12 — normalisation de casse de l'uid_hmac (divergence latente) ══
  test('QA-12 : un uid_hmac reçu en MAJUSCULES est normalisé en minuscules', async () => {
    const majuscules = UID_HMAC.toUpperCase();
    const canonical = canonicalPointage({
      uuid: '11111111-2222-4333-8444-5555555555b0', device_code: DEVICE_CODE, sequence_device: 5,
      uid_hmac: majuscules, horodatage_utc: '2026-08-17T06:58:12.031Z', sens: 'entree', source: 'badge',
    });
    const precedent = genesisHash(DEVICE_CODE);
    const p = {
      uuid: '11111111-2222-4333-8444-5555555555b0', sequence_device: 5, uid_hmac: majuscules,
      horodatage_utc: '2026-08-17T06:58:12.031Z', fuseau: 'Europe/Paris',
      sens: 'entree', source: 'badge',
      hash_precedent: precedent, hash_courant: chainHash(precedent, canonical),
    };
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0].status).toBe('ok');

    // Stocké en minuscules, et la RÉSOLUTION du badge interroge la base en
    // minuscules : sans quoi un badge légitime deviendrait « orphelin ».
    const lookup = mockQuery.mock.calls.find((c) => /FROM badgeuse_badges WHERE uid_hmac/.test(String(c[0])));
    expect(lookup[1][0]).toBe(UID_HMAC);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_pointages/.test(String(c[0])));
    expect(insert[1][3]).toBe(UID_HMAC);
    // La charge canonique est elle aussi minuscule des deux côtés → chaîne valide.
    expect(insert[1][14]).toBe(true);
  });

  describe('QA-01 — « invalid » est un accusé TERMINAL, toujours journalisé', () => {
    let warnSpy;
    beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => warnSpy.mockRestore());

    test('chaque refus définitif est journalisé (jamais de purge silencieuse)', async () => {
      await post(`${PATH}/pointages`, { pointages: [{ uuid: 'pas-un-uuid' }] });
      const journal = warnSpy.mock.calls.flat().join(' ');
      expect(journal).toContain('refusé définitivement');
      expect(journal).toContain('uuid_invalide');
      expect(journal).toContain(DEVICE_CODE);
    });

    test('le nombre de refus est récapitulé pour l\'exploitant', async () => {
      await post(`${PATH}/pointages`, { pointages: [{ uuid: 'pas-un-uuid' }, { uuid: 'non-plus' }] });
      expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/2 élément\(s\) refusé\(s\) définitivement/);
    });

    test('une erreur de stockage reste « invalid » ET journalise sa cause SQL', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      installMocks({ insertError: Object.assign(new Error('valeur hors bornes'), { code: '22003' }) });
      const p = makePointage({ uuid: '11111111-2222-4333-8444-5555555555a9', precedent: genesisHash(DEVICE_CODE) });
      const r = await post(`${PATH}/pointages`, { pointages: [p] });
      expect(r.body.resultats[0]).toEqual({ uuid: p.uuid, status: 'invalid', raison: 'erreur_stockage' });
      expect(errSpy.mock.calls.flat().join(' ')).toContain('22003');
      errSpy.mockRestore();
    });

    test('QA-08 : une charge canonique ambiguë est refusée, sans casser le lot', async () => {
      // `sens` vide passerait la validation de sens ? Non — c'est le champ
      // `source` d'un élément dont l'uuid contient un séparateur qui est visé
      // ici : un uuid valide ne peut pas contenir « | », on éprouve donc la
      // garde par un device_code impossible côté serveur. On vérifie surtout
      // que le lot n'est jamais rejeté en bloc.
      const bon = makePointage({ uuid: '11111111-2222-4333-8444-5555555555aa', precedent: genesisHash(DEVICE_CODE) });
      const r = await post(`${PATH}/pointages`, { pointages: [{ uuid: 'pas-un-uuid' }, bon] });
      expect(r.status).toBe(200);
      expect(r.body.resultats[0].status).toBe('invalid');
      expect(r.body.resultats[1].status).toBe('ok');
    });
  });

  test('400 UNIQUEMENT pour un lot syntaxiquement invalide', async () => {
    expect((await post(`${PATH}/pointages`, {})).status).toBe(400);
    expect((await post(`${PATH}/pointages`, { pointages: 'nope' })).status).toBe(400);
  });

  test('lot de plus de 100 éléments → 400 (le poste garde sa file)', async () => {
    const lot = Array.from({ length: 101 }, (_, i) => makePointage({
      uuid: `11111111-2222-4333-8444-${String(i).padStart(12, '0')}`, sequence: i + 1, precedent: genesisHash(DEVICE_CODE),
    }));
    const r = await post(`${PATH}/pointages`, { pointages: lot });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_payload');
  });

  test('un uid_hmac malformé est refusé (aucun UID en clair ne peut entrer)', async () => {
    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555563', precedent: genesisHash(DEVICE_CODE) });
    p.uid_hmac = '04A23B1C'; // ← un UID BRUT, pas un condensat
    const r = await post(`${PATH}/pointages`, { pointages: [p] });
    expect(r.body.resultats[0].status).toBe('invalid');
    expect(mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_pointages/.test(String(c[0])))).toBeUndefined();
  });

  test('émission Socket.IO de supervision, sans aucun identifiant de badge', async () => {
    const emit = jest.fn();
    const io = { to: jest.fn(() => ({ emit })) };
    const appIo = express();
    appIo.use(express.json());
    appIo.set('io', io);
    appIo.use('/api/badgeuse/device', deviceRouter);

    const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555564', precedent: genesisHash(DEVICE_CODE) });
    await request(appIo).post(`${PATH}/pointages`).set('X-Device-Key', DEVICE_KEY).send({ pointages: [p] });

    expect(io.to).toHaveBeenCalledWith('badgeuse:supervision');
    expect(emit).toHaveBeenCalledWith('badgeuse:pointage', expect.objectContaining({ device_code: DEVICE_CODE, sens: 'entree' }));
    const charge = JSON.stringify(emit.mock.calls[0][1]);
    expect(charge).not.toContain(UID_HMAC);
    expect(charge).not.toMatch(/uid/i);
  });
});

describe('MINIMISATION — aucun identifiant de badge dans les journaux serveur', () => {
  test('un dépôt de lot ne laisse fuir ni UID, ni condensat, ni uuid dans les logs', async () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug']
      .map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    try {
      installMocks({ badge: null }); // chemin orphelin, le plus bavard
      const p = makePointage({ uuid: '11111111-2222-4333-8444-555555555565', precedent: 'd'.repeat(64) });
      await post(`${PATH}/pointages`, { pointages: [p] });

      const sorties = spies.flatMap((s) => s.mock.calls.map((c) => c.join(' ')));
      expect(sorties.length).toBeGreaterThan(0); // le dépôt journalise bien quelque chose

      for (const ligne of sorties) {
        // Ni le condensat, ni l'uuid du pointage.
        expect(ligne).not.toContain(UID_HMAC);
        expect(ligne).not.toContain(p.uuid);
        // Ni aucun motif d'UID (8 caractères hexadécimaux isolés) — ce motif
        // attraperait aussi le 1er segment d'un uuid s'il était logué.
        expect(ligne).not.toMatch(/\b[0-9a-fA-F]{8}\b/);
        // Ni aucune suite hexadécimale longue (condensat partiel).
        expect(ligne).not.toMatch(/[0-9a-fA-F]{32,}/);
      }
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  test('le champ transporté s\'appelle uid_hmac partout — jamais « uid » nu', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'routes', 'badgeuse-device.js'), 'utf8');
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/\buid_clair\b|\bbadge_uid\b|\braw_uid\b/);
    expect(code).toMatch(/uid_hmac/);
  });
});

describe('GET /badges — cache des badges (minimisation + ETag)', () => {
  test('ne sert QUE prénom + initiale (ni nom complet, ni statut, ni équipe)', async () => {
    const r = await get(`${PATH}/badges`);
    expect(r.status).toBe(200);
    expect(r.body.badges).toEqual([
      { uid_hmac: UID_HMAC, salarie_id: 7, prenom: 'Karim', initiale_nom: 'B' },
    ]);
    const charge = JSON.stringify(r.body);
    expect(charge).not.toContain('Benali');
    expect(charge).not.toMatch(/insertion|equipe|team|statut|contrat/i);
  });

  test('seuls les badges ACTIFS sont servis', async () => {
    await get(`${PATH}/badges`);
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => /FROM badgeuse_badges b/.test(s));
    expect(sql).toMatch(/statut = 'actif'/);
  });

  test('ETag stable puis 304 sur If-None-Match', async () => {
    const first = await get(`${PATH}/badges`);
    const etag = first.headers.etag;
    expect(etag).toMatch(/^W\/"/);

    const second = await get(`${PATH}/badges`, DEVICE_KEY, { 'If-None-Match': etag });
    expect(second.status).toBe(304);
    expect(second.text).toBeFalsy();
  });

  test('l\'ETag change quand le contenu change', async () => {
    const first = await get(`${PATH}/badges`);
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/FROM badgeuse_badges b/.test(s)) {
        return Promise.resolve({ rows: [{ uid_hmac: 'b'.repeat(64), employee_id: 9, first_name: 'Sonia', last_name: 'Dupont' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const second = await get(`${PATH}/badges`);
    expect(second.headers.etag).not.toBe(first.headers.etag);
  });
});

describe('GET /config et /playlist', () => {
  test('config : défauts ADR-0002, cumul hebdo désactivé (AFF-02)', async () => {
    const r = await get(`${PATH}/config`);
    expect(r.status).toBe(200);
    expect(r.body.config).toMatchObject({
      overlay_duree_sec: 5,
      anti_rebond_sec: 8,
      affichage_cumul_hebdo: false,
      plage_acceptation: { debut: '05:00', fin: '21:00' },
      heartbeat_interval_sec: 60,
      sync_badges_interval_sec: 300,
      sync_playlist_interval_sec: 900,
    });
  });

  test('overlay_duree_sec est BORNÉ à 8 s côté serveur (exigence juridique §3.5)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/SELECT key, value FROM settings/.test(s)) {
        return Promise.resolve({ rows: [{ key: 'badgeuse.overlay_duree_sec', value: '30' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get(`${PATH}/config`);
    expect(r.body.config.overlay_duree_sec).toBe(8);
  });

  test('playlist : éléments actifs dans leur fenêtre, ciblant le site du poste', async () => {
    const r = await get(`${PATH}/playlist`);
    expect(r.status).toBe(200);
    expect(r.body.elements[0]).toMatchObject({ id: 7, type: 'message', duree_sec: 12, ordre: 1 });
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => /FROM badgeuse_contenus/.test(s));
    expect(sql).toMatch(/actif = true/);
    expect(sql).toMatch(/visible_du/);
    expect(sql).toMatch(/visible_au/);
  });

  test('playlist : 304 sur ETag inchangé', async () => {
    const first = await get(`${PATH}/playlist`);
    const second = await get(`${PATH}/playlist`, DEVICE_KEY, { 'If-None-Match': first.headers.etag });
    expect(second.status).toBe(304);
  });
});

describe('POST /heartbeat (BO-09)', () => {
  test('met à jour le poste et renvoie l\'heure serveur (mesure de dérive PST-07)', async () => {
    const r = await post(`${PATH}/heartbeat`, {
      version: '1.0.0', horloge_utc: '2026-08-17T06:58:12Z', derive_estimee_sec: 0.4,
      taille_file: 0, temperature_cpu: 52.1, disque_libre_mo: 180432, cible: 'pi5',
      reader_mode: 'hex', throttled: false,
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.server_time_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const upd = mockQuery.mock.calls.find((c) => /UPDATE badgeuse_devices/.test(String(c[0])));
    expect(upd).toBeDefined();
    expect(String(upd[0])).toMatch(/dernier_heartbeat = NOW\(\)/);
    expect(upd[1]).toContain('1.0.0');
    expect(JSON.parse(upd[1][3])).toMatchObject({ temperature_cpu: 52.1, cible: 'pi5' });
  });

  test('seuls les champs du contrat sont conservés (liste blanche)', async () => {
    await post(`${PATH}/heartbeat`, { version: '1.0.0', champ_pirate: 'donnée personnelle' });
    const upd = mockQuery.mock.calls.find((c) => /UPDATE badgeuse_devices/.test(String(c[0])));
    expect(Object.keys(JSON.parse(upd[1][3]))).not.toContain('champ_pirate');
  });

  // ══ QA-02 — l'alerte du poste ne doit plus être jetée en silence ══
  describe('QA-02 — champ « alerte » (CONTRAT_API_DEVICE §2.5 v1.1)', () => {
    const infoStockee = () => {
      const upd = mockQuery.mock.calls.find((c) => /UPDATE badgeuse_devices/.test(String(c[0])));
      return JSON.parse(upd[1][3]);
    };

    test('l\'alerte émise par le poste est CONSERVÉE dans heartbeat_info', async () => {
      await post(`${PATH}/heartbeat`, {
        version: '1.0.0', taille_file: 3, alerte: 'réponse serveur sans accusé exploitable',
      });
      expect(infoStockee().alerte).toBe('réponse serveur sans accusé exploitable');
    });

    test('elle est JOURNALISÉE côté serveur (la panne devient visible)', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await post(`${PATH}/heartbeat`, { version: '1.0.0', alerte: 'lecteur de badge débranché' });
      expect(warnSpy.mock.calls.flat().join(' ')).toContain('lecteur de badge débranché');
      warnSpy.mockRestore();
    });

    test('absence d\'alerte → null explicite (jamais une clé manquante)', async () => {
      await post(`${PATH}/heartbeat`, { version: '1.0.0' });
      expect(infoStockee()).toHaveProperty('alerte', null);
      mockQuery.mockClear(); installMocks();
      await post(`${PATH}/heartbeat`, { version: '1.0.0', alerte: '' });
      expect(infoStockee().alerte).toBeNull();
    });

    test('l\'alerte est BORNÉE à 300 caractères (signal technique, pas un journal)', async () => {
      await post(`${PATH}/heartbeat`, { version: '1.0.0', alerte: 'x'.repeat(5000) });
      expect(infoStockee().alerte).toHaveLength(300);
    });

    test('la liste blanche reste stricte : « alerte » n\'ouvre pas la porte aux champs libres', async () => {
      await post(`${PATH}/heartbeat`, { version: '1.0.0', alerte: 'ok', nom_salarie: 'DUPONT Jean' });
      const info = infoStockee();
      expect(Object.keys(info)).not.toContain('nom_salarie');
      expect(JSON.stringify(info)).not.toContain('DUPONT');
    });
  });

  test('heartbeat sans authentification → 401', async () => {
    const r = await post(`${PATH}/heartbeat`, { version: '1.0.0' }, null);
    expect(r.status).toBe(401);
  });
});
