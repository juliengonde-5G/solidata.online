// ═══════════════════════════════════════════════════════════════════════════
// MODULE 33 « TEMPS & PRÉSENCE » — CHAÎNE COMPLÈTE SUR POSTGRESQL RÉEL
// ───────────────────────────────────────────────────────────────────────────
// POURQUOI CETTE SUITE EXISTE
// Les autres suites du module montent les VRAIS routeurs Express mais sur une
// base MOCKÉE : le mock rend des lignes quelle que soit la validité du SQL.
// Deux défauts de production sont passés sous ce filet :
//   1. `PATCH /badges/:id` était refusé par PostgreSQL (SQLSTATE 42P08,
//      « inconsistent types deduced for parameter $2 ») — tout le cycle de vie
//      du badge tombait en 500, un badge perdu restait ACTIF ;
//   2. un pointage orphelin de raison `hors_plage` n'apparaissait dans AUCUN
//      écran (filtre `employee_id IS NULL`), alors qu'il comptait dans les heures.
// Aucune assertion sur mock ne pouvait les voir. Cette suite exerce donc les
// handlers réels contre un vrai moteur, du dépôt d'un lot par le poste jusqu'à
// la forme exacte que l'écran consomme.
//
// EXÉCUTION : elle est IGNORÉE tant que `BADGEUSE_E2E_DB=1` n'est pas fourni,
// pour que `npx jest` reste vert sans base. Pour la jouer :
//   pg_ctlcluster 16 main start
//   createdb solidata_badgeuse && node src/scripts/init-db.js
//   BADGEUSE_E2E_DB=1 DB_HOST=127.0.0.1 DB_NAME=solidata_badgeuse \
//     DB_USER=… DB_PASSWORD=… npx jest badgeuse-postgres-e2e
// ═══════════════════════════════════════════════════════════════════════════
const RUN = process.env.BADGEUSE_E2E_DB === '1';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// La journalisation d'activité écrit dans une table hors périmètre : neutralisée
// ici comme dans les autres suites de contrat du module.
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const pool = require('../../src/config/database');
const badgeuseRoutes = require('../../src/routes/badgeuse');
const deviceRoutes = require('../../src/routes/badgeuse-device');
const bcrypto = require('../../src/utils/badgeuse-crypto');
const engine = require('../../src/services/badgeuse-engine');

const app = express();
app.use(express.json());
// Ordre de index.js : l'API device est montée AVANT `authenticate`.
app.use('/api/badgeuse', deviceRoutes);
app.use('/api/badgeuse', badgeuseRoutes);

const TOK = {};
const auth = (r, role) => r.set('Authorization', `Bearer ${TOK[role]}`);
const dev = (r, key) => r.set('X-Device-Key', key);

const CODE_POSTE = 'JEST-E2E';
let siteId;
let deviceId;
let deviceKey;
let hmacKey;
let salarie;
let salarieBis;

/** Poste de pointage simulé : séquence, chaînage SHA-256, HMAC du badge. */
function fabriquerPoste(codePoste, cleHmac) {
  let sequence = 0;
  let dernier = bcrypto.genesisHash(codePoste);
  return {
    empreinte: (uid) => bcrypto.hmacUid(cleHmac, bcrypto.normalizeUid(uid)),
    forger({ uid, horodatage, sens, hashPrecedentForce = null }) {
      sequence += 1;
      const uidHmac = uid ? this.empreinte(uid) : null;
      const p = {
        uuid: crypto.randomUUID(),
        sequence_device: sequence,
        uid_hmac: uidHmac || bcrypto.NO_BADGE,
        horodatage_utc: new Date(horodatage).toISOString(),
        sens,
        source: 'badge',
      };
      const canonique = bcrypto.canonicalPointage({ ...p, device_code: codePoste, uid_hmac: uidHmac });
      p.hash_precedent = hashPrecedentForce || dernier;
      p.hash_courant = bcrypto.chainHash(p.hash_precedent, canonique);
      if (!hashPrecedentForce) dernier = p.hash_courant;
      return p;
    },
  };
}
let poste;

const heure = (jour, hhmm) => engine.parisDateTimeToUTC(jour, hhmm).toISOString();
const JOUR = engine.parisDateStr(new Date());

(RUN ? describe : describe.skip)('badgeuse — chaîne poste → serveur → écran (PostgreSQL réel)', () => {
  beforeAll(async () => {
    // Périmètre strictement borné au module : on ne touche qu'aux tables
    // badgeuse_* et aux quelques lignes de test que l'on crée soi-même.
    await pool.query("DELETE FROM badgeuse_pointages WHERE device_id IN (SELECT id FROM badgeuse_devices WHERE code = $1)", [CODE_POSTE]);
    await pool.query("DELETE FROM badgeuse_devices WHERE code = $1", [CODE_POSTE]);
    await pool.query("DELETE FROM badgeuse_badges WHERE commentaire = 'jest-e2e'");
    await pool.query("DELETE FROM employees WHERE malibou_id IN ('JESTE2E1','JESTE2E2')");
    await pool.query("DELETE FROM user_activity_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'jest_e2e_%')");
    await pool.query("DELETE FROM rgpd_audit_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'jest_e2e_%')");
    await pool.query("DELETE FROM users WHERE username LIKE 'jest_e2e_%'");

    for (const role of ['ADMIN', 'RH', 'MANAGER']) {
      const u = await pool.query(
        `INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
         VALUES ($1, $2, 'x', $3, 'Jest', $3, true) RETURNING id`,
        [`jest_e2e_${role.toLowerCase()}`, `jest_e2e_${role.toLowerCase()}@test.local`, role]
      );
      TOK[role] = jwt.sign({ id: u.rows[0].id, username: `jest_e2e_${role}`, role }, JWT_SECRET, { expiresIn: '1h' });
    }
    salarie = (await pool.query(
      "INSERT INTO employees (first_name, last_name, malibou_id, is_active, weekly_hours) VALUES ('Amel','Durand','JESTE2E1',true,35) RETURNING id"
    )).rows[0].id;
    salarieBis = (await pool.query(
      "INSERT INTO employees (first_name, last_name, malibou_id, is_active, weekly_hours) VALUES ('Karim','Benali','JESTE2E2',true,35) RETURNING id"
    )).rows[0].id;

    siteId = (await pool.query("SELECT id FROM badgeuse_sites WHERE code = 'LH'")).rows[0].id;
    const crea = await auth(request(app).post('/api/badgeuse/devices'), 'ADMIN')
      .send({ code: CODE_POSTE, libelle: 'Poste de recette', site_id: siteId, cible: 'pi3' });
    deviceId = crea.body.device.id;
    deviceKey = crea.body.api_key;
    // La clé HMAC n'est rendue que la PREMIÈRE fois qu'un site en reçoit une.
    // Si le site en a déjà une, on n'essaie PAS de la déchiffrer (elle ne nous
    // regarde pas) : cette clé ne sert ici qu'au poste SIMULÉ, pour dériver des
    // empreintes stables — le serveur, lui, ne recalcule aucun HMAC, il compare
    // des chaînes. Une clé locale suffit donc, et rien n'est touché en base.
    hmacKey = crea.body.hmac_key || bcrypto.generateSiteKey();
    poste = fabriquerPoste(CODE_POSTE, hmacKey);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM badgeuse_pointages WHERE device_id = $1", [deviceId]);
    await pool.query("DELETE FROM badgeuse_badges WHERE employee_id IN ($1, $2)", [salarie, salarieBis]);
    await pool.query("DELETE FROM badgeuse_devices WHERE id = $1", [deviceId]);
    await pool.query("DELETE FROM employees WHERE id IN ($1, $2)", [salarie, salarieBis]);
    await pool.query("DELETE FROM rgpd_audit_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'jest_e2e_%')");
    await pool.query("DELETE FROM user_activity_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'jest_e2e_%')");
    await pool.query("DELETE FROM users WHERE username LIKE 'jest_e2e_%'");
    await pool.end();
  });

  // ── LA PROMESSE : un badgeage inconnu remonte à l'écran ───────────────────
  test('badge INCONNU → orphan côté poste, stocké orphelin, VISIBLE dans /orphelins', async () => {
    const p = poste.forger({ uid: '0BADCAFE', horodatage: heure(JOUR, '08:05'), sens: 'entree' });
    const depot = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey)
      .send({ pointages: [p] });

    expect(depot.status).toBe(200);
    expect(depot.body.resultats[0]).toMatchObject({ uuid: p.uuid, status: 'orphan', raison: 'badge_inconnu' });

    const enBase = await pool.query('SELECT statut, employee_id FROM badgeuse_pointages WHERE uuid = $1', [p.uuid]);
    expect(enBase.rows[0]).toMatchObject({ statut: 'orphelin', employee_id: null });

    // La forme EXACTE que consomme l'encart « Pointages orphelins » du Journal
    // (frontend/src/components/badgeuse/JournalPointages.jsx).
    const ecran = await auth(request(app).get('/api/badgeuse/orphelins'), 'RH');
    expect(ecran.status).toBe(200);
    const ligne = ecran.body.find((o) => o.uuid === p.uuid);
    expect(ligne).toBeDefined();
    expect(typeof ligne.id).toBe('number');
    expect(ligne.orphelin_raison).toBe('badge_inconnu');
    expect(ligne.uid_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(ligne.device_code).toBe(CODE_POSTE);
    expect(ligne.employee_id).toBeNull();
    expect(ligne.nom).toBeNull(); // jamais un nom deviné
  });

  test('badge CONNU hors plage horaire → orphelin AUSSI visible dans /orphelins', async () => {
    await auth(request(app).post('/api/badgeuse/badges'), 'RH')
      .send({ employee_id: salarie, uid_hmac: poste.empreinte('04A1B2C3'), commentaire: 'jest-e2e' });

    const p = poste.forger({ uid: '04A1B2C3', horodatage: heure(JOUR, '23:30'), sens: 'sortie' });
    const depot = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey)
      .send({ pointages: [p] });
    expect(depot.body.resultats[0]).toMatchObject({ status: 'orphan', raison: 'hors_plage' });

    // Le salarié EST connu : le filtre historique `employee_id IS NULL` faisait
    // disparaître cette ligne des DEUX écrans où elle doit apparaître.
    const ecran = await auth(request(app).get('/api/badgeuse/orphelins'), 'RH');
    const ligne = ecran.body.find((o) => o.uuid === p.uuid);
    expect(ligne).toBeDefined();
    expect(ligne.employee_id).toBe(salarie);
    expect(ligne.nom).toBe('DURAND Amel');

    const anomalies = await auth(request(app).get(`/api/badgeuse/anomalies?du=${JOUR}&au=${JOUR}`), 'RH');
    expect(anomalies.body.anomalies.some((a) => a.type === 'orphelin' && a.detail === 'hors_plage')).toBe(true);
  });

  test('rattachement RH : requalifie, journalise, et ne se rejoue pas', async () => {
    const orphelins = await auth(request(app).get('/api/badgeuse/orphelins'), 'RH');
    const cible = orphelins.body.find((o) => o.orphelin_raison === 'badge_inconnu');

    const ok = await auth(request(app).post(`/api/badgeuse/orphelins/${cible.id}/rattacher`), 'RH')
      .send({ employee_id: salarieBis });
    expect(ok.status).toBe(200);

    const apres = await pool.query('SELECT statut, employee_id FROM badgeuse_pointages WHERE id = $1', [cible.id]);
    expect(apres.rows[0]).toMatchObject({ statut: 'traite', employee_id: salarieBis });

    const journal = await pool.query(
      "SELECT details FROM rgpd_audit_log WHERE action = 'BADGEUSE_ORPHELIN_RATTACHEMENT' AND entity_id = $1", [cible.id]
    );
    expect(journal.rows).toHaveLength(1);

    const rejeu = await auth(request(app).post(`/api/badgeuse/orphelins/${cible.id}/rattacher`), 'RH')
      .send({ employee_id: salarieBis });
    expect(rejeu.status).toBe(404);

    const reste = await auth(request(app).get('/api/badgeuse/orphelins'), 'RH');
    expect(reste.body.some((o) => o.id === cible.id)).toBe(false);
  });

  // ── CYCLE DE VIE DU BADGE (le 42P08 vivait ici) ──────────────────────────
  test('PATCH /badges/:id accepte les 5 statuts — aucune ambiguïté de type SQL', async () => {
    const badge = (await auth(request(app).get('/api/badgeuse/badges'), 'RH')).body
      .find((b) => b.employee_id === salarie);
    expect(badge).toBeDefined();

    for (const statut of ['perdu', 'actif', 'vole', 'actif', 'desactive', 'actif', 'restitue']) {
      const r = await auth(request(app).patch(`/api/badgeuse/badges/${badge.id}`), 'RH').send({ statut });
      expect([statut, r.status]).toEqual([statut, 200]);
      expect(r.body.statut).toBe(statut);
    }
    const fin = await pool.query('SELECT statut, restitue_le FROM badgeuse_badges WHERE id = $1', [badge.id]);
    expect(fin.rows[0].statut).toBe('restitue');
    expect(fin.rows[0].restitue_le).not.toBeNull(); // départ du délai de purge

    const historique = await auth(request(app).get(`/api/badgeuse/badges/${badge.id}/historique`), 'RH');
    expect(historique.body.map((h) => h.evenement)).toEqual(
      ['restitution', 'reactivation', 'desactivation', 'reactivation', 'vol', 'reactivation', 'perte', 'attribution']
    );
  });

  test('un badge restitué disparaît du cache du poste et libère le salarié', async () => {
    const cache = await dev(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/badges`), deviceKey);
    expect(cache.body.badges.some((b) => b.salarie_id === salarie)).toBe(false);

    const neuf = await auth(request(app).post('/api/badgeuse/badges'), 'RH')
      .send({ employee_id: salarie, uid_hmac: poste.empreinte('04A1B2C9'), commentaire: 'jest-e2e' });
    expect(neuf.status).toBe(201);

    const cache2 = await dev(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/badges`), deviceKey);
    const ligne = cache2.body.badges.find((b) => b.salarie_id === salarie);
    // MINIMISATION : prénom + initiale, rien d'autre.
    expect(ligne).toMatchObject({ prenom: 'Amel', initiale_nom: 'D' });
    expect(JSON.stringify(cache2.body)).not.toContain('Durand');
  });

  // ── IDEMPOTENCE, CHAÎNE, ACCUSÉS ─────────────────────────────────────────
  test('rejeu d\'un lot déjà accusé → duplicate, aucune double écriture', async () => {
    const p = poste.forger({ uid: '04A1B2C9', horodatage: heure(JOUR, '09:00'), sens: 'entree' });
    const lot = { pointages: [p] };
    const un = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey).send(lot);
    expect(un.body.resultats[0].status).toBe('ok');

    const avant = await pool.query('SELECT COUNT(*)::int n FROM badgeuse_pointages WHERE device_id = $1', [deviceId]);
    const deux = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey).send(lot);
    const apres = await pool.query('SELECT COUNT(*)::int n FROM badgeuse_pointages WHERE device_id = $1', [deviceId]);

    expect(deux.body.resultats[0].status).toBe('duplicate');
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
  });

  test('rupture de chaîne : stockée, signalée, et détectée par verify-chain', async () => {
    const p = poste.forger({
      uid: '04A1B2C9', horodatage: heure(JOUR, '09:30'), sens: 'sortie', hashPrecedentForce: 'f'.repeat(64),
    });
    const depot = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey)
      .send({ pointages: [p] });
    // AUCUNE HEURE NE SE PERD : la rupture n'empêche pas le stockage.
    expect(depot.body.resultats[0]).toMatchObject({ status: 'ok', avertissement: 'chain_broken' });
    const stocke = await pool.query('SELECT chaine_valide FROM badgeuse_pointages WHERE uuid = $1', [p.uuid]);
    expect(stocke.rows[0].chaine_valide).toBe(false);

    const verif = await auth(request(app).get(`/api/badgeuse/devices/${deviceId}/verify-chain`), 'RH');
    expect(verif.body.ok).toBe(false);
    expect(verif.body.ruptures.length).toBeGreaterThan(0);
  });

  test('modification DIRECTE en base d\'un horodatage : détectée par verify-chain', async () => {
    const premier = await pool.query(
      'SELECT id, sequence_device FROM badgeuse_pointages WHERE device_id = $1 ORDER BY sequence_device LIMIT 1', [deviceId]
    );
    await pool.query("UPDATE badgeuse_pointages SET horodatage_utc = horodatage_utc + interval '7 minutes' WHERE id = $1", [premier.rows[0].id]);
    const verif = await auth(request(app).get(`/api/badgeuse/devices/${deviceId}/verify-chain`), 'RH');
    expect(verif.body.ruptures.some((r) => r.sequence === Number(premier.rows[0].sequence_device))).toBe(true);
    await pool.query("UPDATE badgeuse_pointages SET horodatage_utc = horodatage_utc - interval '7 minutes' WHERE id = $1", [premier.rows[0].id]);
  });

  test('incident de stockage TRANSITOIRE → retry, lot interrompu, aucune écriture', async () => {
    // Injection d'un SQLSTATE 40001 (échec de sérialisation) : c'est de
    // l'infrastructure, jamais la donnée — le poste doit CONSERVER ses éléments.
    await pool.query(`CREATE OR REPLACE FUNCTION jest_badgeuse_panne() RETURNS trigger AS $f$
      BEGIN RAISE EXCEPTION 'panne simulée' USING ERRCODE = '40001'; END $f$ LANGUAGE plpgsql;`);
    await pool.query('DROP TRIGGER IF EXISTS jest_badgeuse_trg ON badgeuse_pointages');
    await pool.query('CREATE TRIGGER jest_badgeuse_trg BEFORE INSERT ON badgeuse_pointages FOR EACH ROW EXECUTE FUNCTION jest_badgeuse_panne()');
    try {
      const a = poste.forger({ uid: '04A1B2C9', horodatage: heure(JOUR, '10:00'), sens: 'entree' });
      const b = poste.forger({ uid: '04A1B2C9', horodatage: heure(JOUR, '10:05'), sens: 'sortie' });
      const depot = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey)
        .send({ pointages: [a, b] });
      expect(depot.body.resultats).toEqual([
        { uuid: a.uuid, status: 'retry', raison: 'erreur_transitoire' },
        { uuid: b.uuid, status: 'retry', raison: 'lot_interrompu' },
      ]);
      const n = await pool.query('SELECT COUNT(*)::int n FROM badgeuse_pointages WHERE uuid = ANY($1::uuid[])', [[a.uuid, b.uuid]]);
      expect(n.rows[0].n).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS jest_badgeuse_trg ON badgeuse_pointages');
      await pool.query('DROP FUNCTION IF EXISTS jest_badgeuse_panne()');
    }
  });

  test('erreur de DONNÉE (SQLSTATE 23xxx) → invalid, accusé TERMINAL', async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION jest_badgeuse_panne() RETURNS trigger AS $f$
      BEGIN RAISE EXCEPTION 'contrainte simulée' USING ERRCODE = '23514'; END $f$ LANGUAGE plpgsql;`);
    await pool.query('DROP TRIGGER IF EXISTS jest_badgeuse_trg ON badgeuse_pointages');
    await pool.query('CREATE TRIGGER jest_badgeuse_trg BEFORE INSERT ON badgeuse_pointages FOR EACH ROW EXECUTE FUNCTION jest_badgeuse_panne()');
    try {
      const p = poste.forger({ uid: '04A1B2C9', horodatage: heure(JOUR, '11:00'), sens: 'entree' });
      const depot = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey)
        .send({ pointages: [p] });
      expect(depot.body.resultats[0]).toMatchObject({ status: 'invalid', raison: 'erreur_stockage' });
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS jest_badgeuse_trg ON badgeuse_pointages');
      await pool.query('DROP FUNCTION IF EXISTS jest_badgeuse_panne()');
    }
  });

  // ── AUTHENTIFICATION DU POSTE ────────────────────────────────────────────
  // ── Le geste RH constaté en exploitation : « affecter le badge » ──────────
  test("attribuer le badge depuis un orphelin : creation + rattachement dans le meme geste", async () => {
    // Un salarie badge avec un badge jamais enrole : deux orphelins s'empilent.
    const uid = '0AFFEC7E';
    for (const [h, sens] of [['08:01', 'entree'], ['12:02', 'sortie']]) {
      const lot = poste.forger({ uid, horodatage: heure(JOUR, h), sens });
      const r = await dev(request(app).post(`/api/badgeuse/v1/devices/${CODE_POSTE}/pointages`), deviceKey)
        .send({ pointages: [lot] });
      expect(r.body.resultats[0].status).toBe('orphan');
    }
    const avant = await auth(request(app).get('/api/badgeuse/orphelins'), 'RH');
    const miens = avant.body.filter((o) => o.uid_hmac === poste.empreinte(uid));
    expect(miens.length).toBe(2);

    // La RH attribue le badge : les orphelins sont rattaches DANS LE MEME GESTE.
    const crea = await auth(request(app).post('/api/badgeuse/badges'), 'RH')
      .send({ employee_id: salarieBis, uid_hmac: poste.empreinte(uid), commentaire: 'jest-e2e' });
    expect(crea.status).toBe(201);
    expect(crea.body.orphelins_rattaches).toBe(2);

    const apres = await auth(request(app).get('/api/badgeuse/orphelins'), 'RH');
    expect(apres.body.filter((o) => o.uid_hmac === poste.empreinte(uid)).length).toBe(0);
    const traites = await pool.query(
      "SELECT employee_id, statut FROM badgeuse_pointages WHERE uid_hmac = $1", [poste.empreinte(uid)]);
    expect(traites.rows.every((r2) => r2.statut === 'traite' && r2.employee_id === salarieBis)).toBe(true);
    // Journalise comme un rattachement, avec le detail du geste.
    const jrn = await pool.query(
      "SELECT details FROM rgpd_audit_log WHERE action = 'BADGEUSE_ORPHELIN_RATTACHEMENT' AND details::text LIKE '%creation_badge%' ORDER BY id DESC LIMIT 1");
    expect(jrn.rows.length).toBe(1);
    const det = typeof jrn.rows[0].details === 'string' ? JSON.parse(jrn.rows[0].details) : jrn.rows[0].details;
    expect(det.nb).toBe(2);
  });

  // ── Le badge SURVIT aux personnes : reattribution apres un depart ─────────
  test('un badge restitue se reattribue a un AUTRE salarie ; un badge actif, jamais', async () => {
    // salarieBis porte le badge 0AFFEC7E (test precedent). Tant qu'il est actif,
    // toute reattribution est refusee avec un message qui NOMME le porteur.
    const refus = await auth(request(app).post('/api/badgeuse/badges'), 'RH')
      .send({ employee_id: salarie, uid_hmac: poste.empreinte('0AFFEC7E'), commentaire: 'jest-e2e' });
    expect(refus.status).toBe(409);
    expect(refus.body.error).toMatch(/encore actif au nom de/);
    expect(refus.body.error).toMatch(/BENALI/i);

    // Depart de l'entreprise : restitution, puis reattribution au premier salarie.
    const badgeId = (await pool.query(
      "SELECT id FROM badgeuse_badges WHERE uid_hmac = $1 AND statut = 'actif'", [poste.empreinte('0AFFEC7E')])).rows[0].id;
    expect((await auth(request(app).patch(`/api/badgeuse/badges/${badgeId}`), 'RH')
      .send({ statut: 'restitue' })).status).toBe(200);

    // Le repreneur doit etre LIBRE : l'autre unicite (un badge actif par
    // salarie) est aussi verifiee au passage — refus tant que son badge des
    // tests precedents est actif, acceptation apres restitution.
    const ancien = await pool.query(
      "SELECT id FROM badgeuse_badges WHERE employee_id = $1 AND statut = 'actif'", [salarie]);
    if (ancien.rows.length > 0) {
      const occupe = await auth(request(app).post('/api/badgeuse/badges'), 'RH')
        .send({ employee_id: salarie, uid_hmac: poste.empreinte('0AFFEC7E'), commentaire: 'jest-e2e' });
      expect(occupe.status).toBe(409);
      expect(occupe.body.error).toMatch(/déjà un badge actif/);
      expect((await auth(request(app).patch(`/api/badgeuse/badges/${ancien.rows[0].id}`), 'RH')
        .send({ statut: 'restitue' })).status).toBe(200);
    }

    const rea = await auth(request(app).post('/api/badgeuse/badges'), 'RH')
      .send({ employee_id: salarie, uid_hmac: poste.empreinte('0AFFEC7E'), commentaire: 'jest-e2e' });
    expect(rea.status).toBe(201);

    // L'historique garde les DEUX periodes de detention de la meme empreinte.
    const hist = await pool.query(
      "SELECT employee_id, statut FROM badgeuse_badges WHERE uid_hmac = $1 ORDER BY id", [poste.empreinte('0AFFEC7E')]);
    expect(hist.rows.length).toBe(2);
    expect(hist.rows[0].statut).toBe('restitue');
    expect(hist.rows[1].statut).toBe('actif');

    // Les pointages de l'ANCIEN porteur ne sont jamais reattribues au nouveau.
    const anciens = await pool.query(
      "SELECT employee_id FROM badgeuse_pointages WHERE uid_hmac = $1 AND statut = 'traite'", [poste.empreinte('0AFFEC7E')]);
    expect(anciens.rows.every((r2) => r2.employee_id === salarieBis)).toBe(true);

    // Et le cache du poste sert le NOUVEAU porteur.
    const cache = await dev(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/badges`), deviceKey);
    const entree = (cache.body.badges || []).find((b2) => b2.uid_hmac === poste.empreinte('0AFFEC7E'));
    expect(entree.salarie_id).toBe(salarie);
  });

  test('X-Device-Key obligatoire : ni absence, ni fausse clé, ni JWT ADMIN ne passent', async () => {
    expect((await request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/badges`)).status).toBe(401);
    expect((await dev(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/badges`), 'a'.repeat(64))).status).toBe(401);
    expect((await auth(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/badges`), 'ADMIN')).status).toBe(401);
  });

  test('la clé du poste n\'est stockée QUE sous forme de condensat SHA-256', async () => {
    const r = await pool.query('SELECT api_key_hash FROM badgeuse_devices WHERE id = $1', [deviceId]);
    expect(r.rows[0].api_key_hash).toBe(bcrypto.hashDeviceKey(deviceKey));
    expect(r.rows[0].api_key_hash).not.toBe(deviceKey);
    const liste = await auth(request(app).get('/api/badgeuse/devices'), 'ADMIN');
    expect(JSON.stringify(liste.body)).not.toContain('api_key');
  });

  // ── Anti-rebond : la règle doit VOYAGER jusqu'au poste ───────────────────
  //
  // L'exploitation signalait qu'un salarié qui badge plusieurs fois n'a aucun
  // message. La fenêtre passe donc à 5 minutes — mais une règle de gestion ne
  // sert à rien si elle reste en base : ce test suit la valeur depuis
  // `settings` jusqu'à la charge utile que le poste consomme (GET /config).
  test('la fenêtre d\'anti-rebond descend RÉELLEMENT au poste par /config', async () => {
    const lu = async () => {
      const r = await dev(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/config`), deviceKey);
      expect(r.status).toBe(200);
      return r.body.config.anti_rebond_sec;
    };

    // Par défaut (aucune ligne en base) : la recommandation documentée.
    await pool.query('DELETE FROM settings WHERE key = $1', ['badgeuse.anti_rebond_sec']);
    expect(await lu()).toBe(300);

    // Après arbitrage de la Direction : c'est SA valeur qui part au poste.
    const maj = await auth(request(app).put('/api/badgeuse/parametres'), 'ADMIN').send({ anti_rebond_sec: 120 });
    expect(maj.status).toBe(200);
    expect(await lu()).toBe(120);

    await pool.query('DELETE FROM settings WHERE key = $1', ['badgeuse.anti_rebond_sec']);
  });

  test('modifier l\'anti-rebond VAUT arbitrage de la grille RH (ADR-0002)', async () => {
    await pool.query('DELETE FROM settings WHERE key IN ($1,$2,$3)',
      ['badgeuse.anti_rebond_sec', 'badgeuse.regles_validees_le', 'badgeuse.regles_validees_par']);
    await auth(request(app).put('/api/badgeuse/parametres'), 'ADMIN').send({ anti_rebond_sec: 300 });

    const r = await pool.query('SELECT value FROM settings WHERE key = $1', ['badgeuse.regles_validees_le']);
    expect(r.rows.length).toBe(1); // l'anti-rebond EST une règle de gestion
  });

  test('la clé HMAC du site est chiffrée au repos et ne ressort par aucune lecture', async () => {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [`badgeuse.hmac_key_site_${siteId}`]);
    // Format AES-256-GCM du dépôt : 'v1:<iv>:<tag>:<chiffré>' — jamais 64 hex en clair.
    expect(r.rows[0].value).toMatch(/^v1:/);
    expect(r.rows[0].value).not.toMatch(/^[0-9a-f]{64}$/);
    const enClair = bcrypto.decryptSecret(r.rows[0].value);
    const params = await auth(request(app).get('/api/badgeuse/parametres'), 'ADMIN');
    const corpus = JSON.stringify(params.body) + JSON.stringify((await auth(request(app).get('/api/badgeuse/devices'), 'ADMIN')).body);
    // Ni la clé chiffrée, ni la clé en clair (quand la nôtre sait la lire),
    // ni même le NOM du réglage ne doivent apparaître dans une réponse.
    expect(corpus).not.toContain(r.rows[0].value);
    if (enClair) expect(corpus).not.toContain(enClair);
    expect(corpus).not.toContain('hmac_key');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ÉCRAN DE VEILLE — MÉTÉO ET PRESSE SUR LA VRAIE BASE
  //
  // Défauts constatés en production (août 2026) : l'écran météo n'affichait
  // rien, et l'écran d'actualité ne connaissait que le fil interne. Les suites
  // sur mock prouvent la FORME de la réponse ; celle-ci prouve la CHAÎNE :
  // écriture réelle par les collecteurs (SQL réellement accepté par
  // PostgreSQL, contraintes d'unicité comprises) puis lecture par le handler
  // de playlist que le poste interroge.
  //
  // Les deux sources externes (Open-Meteo, flux RSS) sont remplacées par un
  // `fetch` de test : le poste de développement n'a pas d'accès sortant, et un
  // test qui dépend d'Internet n'est pas un test.
  // ═════════════════════════════════════════════════════════════════════════
  describe('écran de veille — météo et presse (base réelle)', () => {
    const badgeuseMedia = require('../../src/services/badgeuse-social');
    // URL RÉELLE d'un fil public : la garde anti-SSRF (résolution DNS + refus
    // des adresses internes) s'exécute donc pour de vrai. Seul l'appel HTTP est
    // remplacé — le poste de développement n'a pas d'accès sortant, et un test
    // qui dépend de la disponibilité d'un site de presse n'est pas un test.
    const FLUX = 'https://www.francetvinfo.fr/titres.rss';
    const LIBELLE_FLUX = 'Jest — à la une';
    let fetchOrigine;
    let contenuMeteoId;
    let contenuPresseId;

    const jourParis = (d = 0) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Date.now() + d * 86400000));

    beforeAll(async () => {
      fetchOrigine = globalThis.fetch;
      await pool.query('DELETE FROM badgeuse_presse_articles WHERE flux = $1', [LIBELLE_FLUX]);
      await pool.query('DELETE FROM badgeuse_meteo WHERE latitude = 49.4231 AND longitude = 1.0993');
      contenuMeteoId = (await pool.query(
        `INSERT INTO badgeuse_contenus (site_id, type, titre, ordre, duree_sec)
         VALUES ($1, 'meteo', 'Météo jest', 900, 12) RETURNING id`, [siteId])).rows[0].id;
      contenuPresseId = (await pool.query(
        `INSERT INTO badgeuse_contenus (site_id, type, titre, ordre, duree_sec, config)
         VALUES ($1, 'presse', 'À la une jest', 901, 15, '{"nb_articles":2}'::jsonb) RETURNING id`, [siteId])).rows[0].id;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('badgeuse.presse_flux', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify([{ libelle: LIBELLE_FLUX, source: 'Jest Presse', url: FLUX, actif: true }])]
      );
    });

    afterAll(async () => {
      globalThis.fetch = fetchOrigine;
      await pool.query('DELETE FROM badgeuse_contenus WHERE id = ANY($1)', [[contenuMeteoId, contenuPresseId]]);
      await pool.query('DELETE FROM badgeuse_presse_articles WHERE flux = $1', [LIBELLE_FLUX]);
      await pool.query('DELETE FROM badgeuse_meteo WHERE latitude = 49.4231 AND longitude = 1.0993');
      await pool.query("DELETE FROM settings WHERE key = 'badgeuse.presse_flux'");
    });

    test('la prévision Open-Meteo est réellement écrite, et re-jouable (upsert)', async () => {
      const jours = [jourParis(0), jourParis(1), jourParis(2)];
      globalThis.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({ daily: {
          time: jours,
          weather_code: [3, 61, 0],
          temperature_2m_max: [24.6, 21.3, 26.0],
          temperature_2m_min: [14.2, 15.1, 13.0],
          precipitation_sum: [0.4, 5.2, 0],
          wind_speed_10m_max: [18, 30, 12],
        } }),
      });
      const lieu = await badgeuseMedia.resolveMeteoLieu(siteId);
      expect(lieu.source).toBe('parametre');            // le site LH n'a pas de coordonnées

      expect(await badgeuseMedia.refreshMeteoLieu(lieu, 2)).toBe(3);
      // Deux passages ne créent pas de doublon : UNIQUE(latitude, longitude, jour).
      expect(await badgeuseMedia.refreshMeteoLieu(lieu, 2)).toBe(3);
      const n = await pool.query(
        'SELECT COUNT(*)::int AS n FROM badgeuse_meteo WHERE latitude = $1 AND longitude = $2',
        [lieu.latitude, lieu.longitude]
      );
      expect(n.rows[0].n).toBe(3);
    });

    test('le poste reçoit la météo du jour dans sa playlist', async () => {
      const r = await dev(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/playlist`), deviceKey);
      expect(r.status).toBe(200);
      const el = (r.body.elements || []).find((x) => x.id === contenuMeteoId);
      expect(el).toBeDefined();
      expect(el.meteo.jour).toMatchObject({ date: jourParis(0), libelle: 'Nuageux', temp_max: 24.6 });
      expect(el.meteo.prevision.length).toBeGreaterThan(0);
      expect(el.meteo.lieu_source).toBe('parametre');
    });

    test('les articles de presse sont réellement importés depuis un flux RSS', async () => {
      globalThis.fetch = async (url) => {
        // Aucune vignette n'est téléchargée ici : le flux n'en propose pas.
        expect(String(url)).toBe(FLUX);
        return {
          ok: true, status: 200,
          headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/rss+xml' : null) },
          text: async () => `<rss version="2.0"><channel>
            <item><title><![CDATA[Article A]]></title><link>https://www.francetvinfo.fr/a</link>
              <description>Chapô A</description><guid>jest-a</guid>
              <pubDate>Wed, 19 Aug 2026 07:12:00 +0200</pubDate></item>
            <item><title>Article B</title><link>https://www.francetvinfo.fr/b</link>
              <description>Chapô B</description><guid>jest-b</guid>
              <pubDate>Wed, 19 Aug 2026 06:40:00 +0200</pubDate></item>
          </channel></rss>`,
        };
      };
      const bilan = await badgeuseMedia.syncPresseArticles();
      expect(bilan.articles).toBe(2);
      // Re-synchroniser ne duplique pas : UNIQUE(flux, guid).
      await badgeuseMedia.syncPresseArticles();
      const n = await pool.query('SELECT COUNT(*)::int AS n FROM badgeuse_presse_articles WHERE flux = $1', [LIBELLE_FLUX]);
      expect(n.rows[0].n).toBe(2);
    });

    test('UN ÉCRAN PAR ARTICLE dans la playlist servie au poste', async () => {
      const r = await dev(request(app).get(`/api/badgeuse/v1/devices/${CODE_POSTE}/playlist`), deviceKey);
      const ecrans = (r.body.elements || []).filter((x) => x.type === 'presse');
      expect(ecrans).toHaveLength(2);
      expect(ecrans.map((e) => e.article.titre)).toEqual(['Article A', 'Article B']);
      expect(ecrans[0].article.source).toBe('Jest Presse');
      // Aucune adresse externe ne descend vers le poste.
      expect(JSON.stringify(ecrans)).not.toMatch(/https?:\/\//);
    });
  });
});
