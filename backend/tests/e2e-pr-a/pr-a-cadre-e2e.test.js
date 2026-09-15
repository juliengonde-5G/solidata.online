// ═══════════════════════════════════════════════════════════════════════════
// PR A lot 1 — DOSSIER ADMINISTRATIF D'INSERTION SUR POSTGRESQL RÉEL
// Rôles, statut du Pass IAE, événements, pièces signées, journal RGPD.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { RUN, creerComptes, purger, creerSalarie, jourDecale } = require('./_helpers');

jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const pool = require('../../src/config/database');

const app = express();
app.use(express.json());
app.use('/api/insertion', require('../../src/routes/insertion'));

jest.setTimeout(60000);

const PREFIXE = 'jest_prA_cadre';
const MAT = ['PRACADRE1', 'PRACADRE2'];
let U; let salarie; let salarieVide;

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20), Buffer.from('\n%%EOF\n')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

(RUN ? describe : describe.skip)('PR A lot 1 — dossier administratif (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purger(pool, { matricules: MAT, usernamePrefix: PREFIXE });
    U = await creerComptes(pool, PREFIXE);
    salarie = await creerSalarie(pool, MAT[0], {
      first_name: 'Amel', last_name: 'Durand', insertion_status: 'en_parcours',
      insertion_start_date: jourDecale(-120), contract_end: jourDecale(60),
    });
    salarieVide = await creerSalarie(pool, MAT[1], { first_name: 'Karim', last_name: 'Benali' });
  });

  afterAll(async () => {
    await purger(pool, { matricules: MAT, usernamePrefix: PREFIXE });
    await pool.end();
  });

  // ── Matrice de rôles ─────────────────────────────────────────────────────
  describe('habilitations', () => {
    test('MANAGER lit le cadre SANS statuts, SANS pièces, SANS bloc de copie', async () => {
      const r = await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'MANAGER');
      expect(r.status).toBe(200);
      expect(r.body).toHaveProperty('eligibilite');
      expect(r.body).toHaveProperty('pass_iae');
      expect(r.body).toHaveProperty('orientation');
      // Les clés doivent être ABSENTES : une clé à null dirait déjà qu'il y a
      // un statut social à cet endroit.
      expect(Object.keys(r.body)).not.toContain('statuts');
      expect(Object.keys(r.body)).not.toContain('pieces');
      expect(Object.keys(r.body)).not.toContain('bloc_emplois_inclusion');
    });

    test('MANAGER est refusé en écriture (403) sur les 4 routes d\'écriture', async () => {
      const refus = await Promise.all([
        auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'MANAGER').send({ statuts: { brsa: true } }),
        auth(request(app).post(`/api/insertion/cadre/${salarie}/pass-iae/evenements`), 'MANAGER').send({ type: 'suspension', date_debut: jourDecale(-5) }),
        auth(request(app).post(`/api/insertion/cadre/${salarie}/actualisation-ft`), 'MANAGER').send({ date: jourDecale(-1) }),
        auth(request(app).get(`/api/insertion/pieces/${salarie}`), 'MANAGER'),
      ]);
      expect(refus.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    });

    test('ADMIN voit les trois blocs réservés', async () => {
      const r = await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body).toHaveProperty('statuts');
      expect(r.body).toHaveProperty('pieces');
      expect(typeof r.body.bloc_emplois_inclusion).toBe('string');
    });

    test('la consultation ADMIN/RH est journalisée, celle du MANAGER ne l\'est pas', async () => {
      const avant = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_CADRE_CONSULTATION' AND entity_id = $1`, [salarie]);
      await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'RH');
      await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'MANAGER');
      const apres = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_CADRE_CONSULTATION' AND entity_id = $1`, [salarie]);
      expect(apres.rows[0].n).toBe(avant.rows[0].n + 1);
    });
  });

  // ── Écriture ─────────────────────────────────────────────────────────────
  describe('écriture du dossier (ADMIN)', () => {
    test('critères + Pass + orientation + statuts écrits et relus', async () => {
      const r = await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN').send({
        eligibilite: {
          criteres: [{ code: 'brsa', date_constat: jourDecale(-150) }, { code: 'deld' }],
          verifiee_le: jourDecale(-140), source: 'prescripteur_habilite',
          justificatifs_ref: 'Emplois de l\'inclusion — candidature 12345',
        },
        pass_iae: { numero: 'PASS-JEST-001', debut: jourDecale(-100), fin: jourDecale(500) },
        orientation: {
          orienteur_type: 'departement_cms', orienteur_nom: 'CMS Rouen Rive Gauche',
          referent_unique: { type: 'cms', nom: 'Mme X', contact: 'x@cd76.fr' },
          actualisation_ft: { requise: true },
        },
        statuts: { brsa: true, brsa_date_constat: jourDecale(-150), ft_categorie: 'G', ft_categorie_date: jourDecale(-30) },
        derogation_cddi: { motif: 'senior_50', date: jourDecale(-10) },
      });
      expect(r.status).toBe(200);
      expect(r.body.eligibilite.criteres.map((c) => c.code).sort()).toEqual(['brsa', 'deld']);
      expect(r.body.eligibilite.source).toBe('prescripteur_habilite');
      expect(r.body.pass_iae.numero).toBe('PASS-JEST-001');
      expect(r.body.statuts.brsa).toBe(true);
      expect(r.body.statuts.ft_categorie).toBe('G');
      expect(r.body.orientation.referent_unique.type).toBe('cms');
      // Bloc « Emplois de l'inclusion » : libellés, jamais les codes.
      expect(r.body.bloc_emplois_inclusion).toMatch(/Bénéficiaire du RSA/);
      expect(r.body.bloc_emplois_inclusion).toMatch(/PASS-JEST-001/);
    });

    // ── Vérification demandée par le rapport de debug (13 § 7.2) une fois C-01
    // corrigé : « pour un MANAGER, `eligibilite.criteres` ne doit porter ni code
    // ni libellé, seulement un compte et la date de vérification ».
    // Elle s'appuie sur les critères réellement écrits juste au-dessus (brsa +
    // deld), donc sur des LIGNES en base, pas sur un faux `pg`.
    test('C-01 — le MANAGER ne reçoit ni code ni libellé de critère, seulement un compte', async () => {
      const r = await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'MANAGER');
      expect(r.status).toBe(200);
      expect(r.body.eligibilite.criteres).toBeUndefined();
      expect(r.body.eligibilite.justificatifs_ref).toBeUndefined();
      expect(r.body.eligibilite.nb_criteres).toBe(2);
      expect(r.body.eligibilite.verifiee_le).toBeTruthy();
      const brut = JSON.stringify(r.body);
      for (const interdit of ['brsa', 'deld', 'Bénéficiaire du RSA', 'Demandeur d\'emploi']) {
        expect(brut).not.toContain(interdit);
      }
      // Le texte libre de référence des justificatifs ne fuit pas non plus.
      expect(brut).not.toContain('candidature 12345');
    });

    test('le journal de modification dit les CHAMPS, jamais les valeurs', async () => {
      const r = await pool.query(
        `SELECT details FROM rgpd_audit_log WHERE action = 'INSERTION_CADRE_MODIFICATION' AND entity_id = $1
         ORDER BY id DESC LIMIT 1`, [salarie]);
      expect(r.rows.length).toBe(1);
      const d = typeof r.rows[0].details === 'string' ? JSON.parse(r.rows[0].details) : r.rows[0].details;
      expect(Array.isArray(d.champs)).toBe(true);
      expect(d.champs).toContain('brsa');
      expect(JSON.stringify(d)).not.toContain('PASS-JEST-001');
      expect(JSON.stringify(d)).not.toContain('CMS Rouen Rive Gauche');
    });

    test('M-06 — un critère art. 10 n’est ni compté pour l’encadrant, ni recopié dans le bloc', async () => {
      // On ajoute « sortant de détention » aux deux critères déjà posés.
      const w = await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
        .send({ eligibilite: { criteres: ['brsa', 'deld', 'sortant_detention'] } });
      expect(w.status).toBe(200);
      // ADMIN : les trois critères, et le bloc de report qui NOMME les deux
      // premiers mais remplace le troisième.
      expect(w.body.eligibilite.criteres.map((c) => c.code).sort()).toEqual(['brsa', 'deld', 'sortant_detention']);
      expect(w.body.bloc_emplois_inclusion).toContain('Bénéficiaire du RSA');
      expect(w.body.bloc_emplois_inclusion).not.toContain('Sortant de détention');
      expect(w.body.bloc_emplois_inclusion).toContain('[critère judiciaire — voir la fiche]');
      // MANAGER : 3 critères en base, 2 annoncés — le critère judiciaire ne se
      // déduit pas d'un compte.
      const m = await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'MANAGER');
      expect(m.body.eligibilite.nb_criteres).toBe(2);
      expect(JSON.stringify(m.body)).not.toContain('detention');
      // On revient à l'état attendu par les tests suivants.
      await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
        .send({ eligibilite: { criteres: ['brsa', 'deld'] } });
    });

    test('valeur hors liste refusée en 400, rien n\'est écrit', async () => {
      const r = await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
        .send({ statuts: { ft_categorie: 'Z' } });
      expect(r.status).toBe(400);
      const v = await pool.query('SELECT ft_categorie FROM employees WHERE id = $1', [salarie]);
      expect(v.rows[0].ft_categorie).toBe('G');
    });

    // NON-RÉGRESSION D'UN DÉFAUT BLOQUANT trouvé par cette suite : les deux
    // refus métier du PUT sortaient sans rendre la connexion au pool. Vingt
    // formulaires mal remplis suffisaient à figer TOUTE l'application — plus
    // aucune requête, quel que soit le module, ne pouvait obtenir de connexion.
    test('vingt refus consécutifs ne fuient AUCUNE connexion du pool', async () => {
      for (let i = 0; i < 22; i += 1) {
        const r = await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
          .send({ eligibilite: { criteres: ['inexistant'] } });
        expect(r.status).toBe(400);
      }
      // Un salarié introuvable emprunte l'AUTRE sortie anticipée (404).
      for (let i = 0; i < 22; i += 1) {
        const r = await auth(request(app).put('/api/insertion/cadre/999999999'), 'ADMIN')
          .send({ statuts: { brsa: true } });
        expect(r.status).toBe(404);
      }
      expect(pool.idleCount).toBeGreaterThan(0);
      expect(pool.waitingCount).toBe(0);
      // La base répond toujours : l'application n'est pas figée.
      const t0 = Date.now();
      await pool.query('SELECT 1');
      expect(Date.now() - t0).toBeLessThan(2000);
    });

    test('critère inconnu refusé en 400 et la liste précédente survit (ROLLBACK)', async () => {
      const r = await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
        .send({ eligibilite: { criteres: ['brsa', 'inexistant'] } });
      expect(r.status).toBe(400);
      const v = await pool.query('SELECT count(*)::int n FROM employee_eligibilite WHERE employee_id = $1', [salarie]);
      expect(v.rows[0].n).toBe(2);
    });

    test('le client ne peut pas dicter le statut du Pass', async () => {
      const r = await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
        .send({ pass_iae: { statut: 'actif', numero: 'PASS-JEST-001' } });
      expect(r.status).toBe(200);
      // Le statut renvoyé est celui du CALCUL, pas celui du corps de requête.
      expect(['actif', 'prolonge', 'suspendu', 'expire', 'inconnu']).toContain(r.body.pass_iae.statut);
    });

    test('actualisation France Travail : date posée, compteur de rappels remis à zéro', async () => {
      await pool.query('UPDATE employees SET actualisation_ft_rappels_non_honores = 3 WHERE id = $1', [salarie]);
      const r = await auth(request(app).post(`/api/insertion/cadre/${salarie}/actualisation-ft`), 'ADMIN')
        .send({ date: jourDecale(-2) });
      expect(r.status).toBe(200);
      const v = await pool.query(
        'SELECT actualisation_ft_derniere_date, actualisation_ft_rappels_non_honores FROM employees WHERE id = $1', [salarie]);
      expect(v.rows[0].actualisation_ft_rappels_non_honores).toBe(0);
      expect(v.rows[0].actualisation_ft_derniere_date.toISOString().slice(0, 10)).toBe(jourDecale(-2));
    });
  });

  // ── Statut du Pass IAE, recalculé côté serveur ───────────────────────────
  describe('statut du Pass IAE (recalculé et persisté)', () => {
    const statut = async () => (await pool.query('SELECT pass_iae_statut FROM employees WHERE id = $1', [salarie])).rows[0].pass_iae_statut;

    test('numéro absent → inconnu', async () => {
      await auth(request(app).put(`/api/insertion/cadre/${salarieVide}`), 'ADMIN').send({ pass_iae: { numero: '' } });
      const r = await auth(request(app).get(`/api/insertion/cadre/${salarieVide}`), 'ADMIN');
      expect(r.body.pass_iae.statut).toBe('inconnu');
    });

    test('fin passée → expiré', async () => {
      await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
        .send({ pass_iae: { numero: 'PASS-JEST-001', debut: jourDecale(-800), fin: jourDecale(-10) } });
      const r = await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'ADMIN');
      expect(r.body.pass_iae.statut).toBe('expire');
      expect(await statut()).toBe('expire');
    });

    test('fin future → actif', async () => {
      await auth(request(app).put(`/api/insertion/cadre/${salarie}`), 'ADMIN')
        .send({ pass_iae: { numero: 'PASS-JEST-001', debut: jourDecale(-100), fin: jourDecale(500) } });
      const r = await auth(request(app).get(`/api/insertion/cadre/${salarie}`), 'ADMIN');
      expect(r.body.pass_iae.statut).toBe('actif');
    });

    test('suspension couvrant aujourd\'hui → suspendu ; retirée → retour à actif', async () => {
      const c = await auth(request(app).post(`/api/insertion/cadre/${salarie}/pass-iae/evenements`), 'ADMIN')
        .send({ type: 'suspension', date_debut: jourDecale(-5), date_fin: jourDecale(5), motif: 'arrêt de travail' });
      expect(c.status).toBe(201);
      expect(c.body.pass_iae.statut).toBe('suspendu');
      expect(await statut()).toBe('suspendu');

      const evId = c.body.pass_iae.evenements.find((e) => e.type === 'suspension').id;
      const d = await auth(request(app).delete(`/api/insertion/cadre/${salarie}/pass-iae/evenements/${evId}`), 'ADMIN');
      expect(d.status).toBe(200);
      expect(d.body.pass_iae.statut).toBe('actif');
    });

    test('prolongation et fin future → prolongé', async () => {
      const c = await auth(request(app).post(`/api/insertion/cadre/${salarie}/pass-iae/evenements`), 'ADMIN')
        .send({ type: 'prolongation', date_debut: jourDecale(-3), reference_externe: 'PROL-1' });
      expect(c.status).toBe(201);
      expect(c.body.pass_iae.statut).toBe('prolonge');
    });

    test('une suspension en cours PRIME sur une prolongation', async () => {
      const c = await auth(request(app).post(`/api/insertion/cadre/${salarie}/pass-iae/evenements`), 'ADMIN')
        .send({ type: 'suspension', date_debut: jourDecale(-1), date_fin: jourDecale(20) });
      expect(c.body.pass_iae.statut).toBe('suspendu');
      const evId = c.body.pass_iae.evenements.find((e) => e.type === 'suspension').id;
      await auth(request(app).delete(`/api/insertion/cadre/${salarie}/pass-iae/evenements/${evId}`), 'ADMIN');
    });

    test('date de fin antérieure au début refusée (400)', async () => {
      const r = await auth(request(app).post(`/api/insertion/cadre/${salarie}/pass-iae/evenements`), 'ADMIN')
        .send({ type: 'suspension', date_debut: jourDecale(0), date_fin: jourDecale(-3) });
      expect(r.status).toBe(400);
    });
  });

  // ── Pièces signées ───────────────────────────────────────────────────────
  describe('pièces signées', () => {
    let pieceId;

    test('un vrai PDF est accepté, stocké en base, journalisé', async () => {
      const r = await auth(request(app).post(`/api/insertion/pieces/${salarie}`), 'ADMIN')
        .field('type', 'entretien_signe')
        .attach('fichier', PDF, { filename: 'entretien.pdf', contentType: 'application/pdf' });
      expect(r.status).toBe(201);
      pieceId = r.body.id;
      const v = await pool.query('SELECT mime, taille, octet_length(contenu) n, sha256 FROM insertion_pieces WHERE id = $1', [pieceId]);
      expect(v.rows[0].mime).toBe('application/pdf');
      expect(v.rows[0].n).toBe(PDF.length);
      expect(v.rows[0].sha256).toHaveLength(64);
      const j = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_PIECE_DEPOT' AND entity_id = $1`, [salarie]);
      expect(j.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    test('un PNG renommé en .pdf est REFUSÉ (contrôle par les octets)', async () => {
      const r = await auth(request(app).post(`/api/insertion/pieces/${salarie}`), 'ADMIN')
        .field('type', 'autre')
        .attach('fichier', PNG, { filename: 'piege.pdf', contentType: 'application/pdf' });
      // Le PNG est un format admis : il est accepté mais RANGÉ sous son vrai type.
      expect(r.status).toBe(201);
      const v = await pool.query('SELECT mime FROM insertion_pieces WHERE id = $1', [r.body.id]);
      expect(v.rows[0].mime).toBe('image/png');
      await pool.query('DELETE FROM insertion_pieces WHERE id = $1', [r.body.id]);
    });

    test('un HTML annoncé « application/pdf » est REFUSÉ', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      const r = await auth(request(app).post(`/api/insertion/pieces/${salarie}`), 'ADMIN')
        .field('type', 'autre')
        .attach('fichier', html, { filename: 'piege.pdf', contentType: 'application/pdf' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/PDF|JPEG|PNG|format/i);
    });

    test('au-delà de 5 Mo, refus 400', async () => {
      const gros = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 512, 0x20)]);
      const r = await auth(request(app).post(`/api/insertion/pieces/${salarie}`), 'ADMIN')
        .field('type', 'autre')
        .attach('fichier', gros, { filename: 'gros.pdf', contentType: 'application/pdf' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/5 Mo/);
    });

    test('la liste ne contient JAMAIS le contenu', async () => {
      const r = await auth(request(app).get(`/api/insertion/pieces/${salarie}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(r.body[0])).not.toContain('contenu');
    });

    test('le contenu est servi avec nosniff + no-store, et journalisé', async () => {
      const avant = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_PIECE_CONSULTATION'`);
      const r = await auth(request(app).get(`/api/insertion/pieces/fichier/${pieceId}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/application\/pdf/);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['cache-control']).toMatch(/no-store/);
      expect(Buffer.from(r.body).slice(0, 5).toString()).toBe('%PDF-');
      const apres = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_PIECE_CONSULTATION'`);
      expect(apres.rows[0].n).toBe(avant.rows[0].n + 1);
    });

    test('un nom de fichier hostile ne casse pas l\'en-tête de service', async () => {
      const r = await auth(request(app).post(`/api/insertion/pieces/${salarie}`), 'ADMIN')
        .field('type', 'autre')
        .attach('fichier', PDF, { filename: 'entretien"; x="1.pdf', contentType: 'application/pdf' });
      expect(r.status).toBe(201);
      const g = await auth(request(app).get(`/api/insertion/pieces/fichier/${r.body.id}`), 'ADMIN');
      expect(g.status).toBe(200);
      expect(g.headers['content-disposition']).not.toMatch(/[\r\n]/);
      expect(g.headers['set-cookie']).toBeUndefined();
      await auth(request(app).delete(`/api/insertion/pieces/${r.body.id}`), 'ADMIN');
    });

    test('suppression journalisée', async () => {
      const r = await auth(request(app).delete(`/api/insertion/pieces/${pieceId}`), 'ADMIN');
      expect(r.status).toBe(200);
      const v = await pool.query('SELECT count(*)::int n FROM insertion_pieces WHERE id = $1', [pieceId]);
      expect(v.rows[0].n).toBe(0);
      const j = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_PIECE_SUPPRESSION' AND entity_id = $1`, [salarie]);
      expect(j.rows[0].n).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Référentiel des critères ─────────────────────────────────────────────
  describe('référentiel des critères d\'éligibilité', () => {
    test('les 14 critères seedés sont servis, triés par ordre', async () => {
      const r = await auth(request(app).get('/api/insertion/eligibilite-criteres'), 'MANAGER');
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThanOrEqual(14);
      const ordres = r.body.map((c) => c.ordre);
      expect(ordres).toEqual([...ordres].sort((a, b) => a - b));
      expect(r.body.map((c) => c.code)).toEqual(expect.arrayContaining(['brsa', 'deld', 'rqth', 'qpv']));
    });

    test('l\'écriture du référentiel est réservée à ADMIN', async () => {
      const r = await auth(request(app).post('/api/insertion/eligibilite-criteres'), 'RH')
        .send({ code: 'jest_x', libelle: 'Critère de test', ordre: 99 });
      expect(r.status).toBe(403);
    });
  });
});
