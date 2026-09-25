// ═══════════════════════════════════════════════════════════════════════════
// Lot 2.60.0 — MIGRATION « Suivi Convergence (CVG) », SUR POSTGRESQL RÉEL
//
// Ce que les 9 tests de migration du lot ne pouvaient pas prouver (ils
// comptent des chaînes SQL émises vers un `pg` simulé) :
//   · les CHECK posés REFUSENT réellement ce qu'ils doivent refuser, sur la
//     base migrée ;
//   · la colonne `orienteur_type` accepte une valeur de 28 caractères (elle
//     était en VARCHAR(20) : un CHECK qui l'accepte sur une colonne qui la
//     tronque ne servirait à rien) ;
//   · une ligne ANTÉRIEURE à la migration reçoit bien `type = 'dialogue'` —
//     rejoué ici dans une transaction ANNULÉE, sur la table ramenée à sa forme
//     d'avant la migration ;
//   · l'entrée au registre art. 30 n'est posée qu'UNE fois, quel que soit le
//     nombre de passes.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { RUN, pool } = require('./_helpers');
const migration = require('../../src/scripts/migrations/insertion-convergence');
const R = require('../../src/utils/convergence-cvg-referentiels');

jest.setTimeout(120000);

/** Exécute `fn(client)` dans une transaction TOUJOURS annulée. */
async function dansTransactionAnnulee(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** Code SQLSTATE d'une requête censée échouer (null si elle passe). */
async function codeErreur(client, sql, params = []) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT sp');
    return null;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    return e.code;
  }
}

(RUN ? describe : describe.skip)('Lot 2.60.0 — migration Convergence (PostgreSQL réel)', () => {
  let logSpy;
  beforeAll(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterAll(async () => { logSpy.mockRestore(); await pool.end().catch(() => {}); });

  test('V-01 — schéma : colonnes du diagnostic, tables, UNIQUE, index', async () => {
    const cols = await pool.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'insertion_diagnostics'
          AND column_name IN ('habitat_type','parcours_rue','pension_invalidite','medecin_traitant')
        ORDER BY column_name`
    );
    expect(cols.rows).toEqual([
      { column_name: 'habitat_type', data_type: 'character varying', is_nullable: 'YES' },
      { column_name: 'medecin_traitant', data_type: 'boolean', is_nullable: 'YES' },
      { column_name: 'parcours_rue', data_type: 'boolean', is_nullable: 'YES' },
      { column_name: 'pension_invalidite', data_type: 'boolean', is_nullable: 'YES' },
    ]);
    const t = await pool.query(
      "SELECT to_regclass('insertion_sortie_cvg') AS a, to_regclass('insertion_cvg_ressources') AS b"
    );
    expect(t.rows[0].a).toBe('insertion_sortie_cvg');
    expect(t.rows[0].b).toBe('insertion_cvg_ressources');
    const u = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = 'insertion_sortie_cvg'::regclass AND contype = 'u'`
    );
    expect(u.rows.map((r) => r.d)).toEqual(['UNIQUE (employee_id, parcours_num)']);
    const idx = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_insertion_dialogues_gestion_type'"
    );
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0].indexdef).toMatch(/\(type, genere_le DESC\)/);
    const cks = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname`,
      [[
        'insertion_diagnostics_habitat_type_check', 'employees_orienteur_type_check',
        'insertion_sortie_cvg_categorie_check', 'insertion_sortie_cvg_habitat_check',
        'insertion_cvg_ressources_type_check', 'insertion_cvg_ressources_etp_total_check',
        'insertion_cvg_ressources_etp_accompagnement_check', 'insertion_cvg_ressources_etp_encadrement_check',
        'insertion_cvg_ressources_dates_check', 'insertion_dialogues_gestion_type_check',
      ]]
    );
    expect(cks.rows).toHaveLength(10);
  });

  test('V-02 — orienteur_type : VARCHAR(40), CHECK à 15 valeurs, `services_sociaux_departement` accepté, `foo` refusé', async () => {
    const c = await pool.query(
      `SELECT character_maximum_length AS l FROM information_schema.columns
        WHERE table_name = 'employees' AND column_name = 'orienteur_type'`
    );
    expect(c.rows[0].l).toBe(40);
    const def = await pool.query(
      "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'employees_orienteur_type_check'"
    );
    const valeurs = [...def.rows[0].d.matchAll(/'([a-z_]+)'::character varying/g)].map((m) => m[1]);
    expect(valeurs).toHaveLength(15);
    expect(new Set(valeurs)).toEqual(new Set(R.ORIENTEURS_ACCEPTES));
    await dansTransactionAnnulee(async (client) => {
      const ok = await codeErreur(client,
        "INSERT INTO employees (first_name, last_name, orienteur_type) VALUES ('M', 'Migration', 'services_sociaux_departement') RETURNING id");
      expect(ok).toBeNull();
      const relu = await client.query("SELECT orienteur_type FROM employees WHERE last_name = 'Migration' AND first_name = 'M'");
      expect(relu.rows[0].orienteur_type).toBe('services_sociaux_departement'); // 28 caractères, non tronqué
      expect(await codeErreur(client,
        "INSERT INTO employees (first_name, last_name, orienteur_type) VALUES ('M', 'Migration', 'foo')")).toBe('23514');
      // Une ANCIENNE valeur reste acceptée : la perdre invaliderait les fiches déjà saisies.
      expect(await codeErreur(client,
        "INSERT INTO employees (first_name, last_name, orienteur_type) VALUES ('M', 'Migration', 'ccas')")).toBeNull();
    });
  });

  test('V-03 — les CHECK du lot refusent en 23514 (habitat, catégorie, habitat de sortie, type/ETP/dates des ressources, type d\'instantané)', async () => {
    await dansTransactionAnnulee(async (client) => {
      const e = await client.query("INSERT INTO employees (first_name, last_name) VALUES ('C', 'Check') RETURNING id");
      const id = e.rows[0].id;
      expect(await codeErreur(client, 'INSERT INTO insertion_diagnostics (employee_id, habitat_type) VALUES ($1, $2)', [id, 'chateau'])).toBe('23514');
      expect(await codeErreur(client, 'INSERT INTO insertion_diagnostics (employee_id, habitat_type) VALUES ($1, $2)', [id, 'rue'])).toBeNull();
      expect(await codeErreur(client, 'INSERT INTO insertion_sortie_cvg (employee_id, categorie) VALUES ($1, $2)', [id, 'demenagement'])).toBe('23514');
      expect(await codeErreur(client, 'INSERT INTO insertion_sortie_cvg (employee_id, habitat_type_sortie) VALUES ($1, $2)', [id, 'chateau'])).toBe('23514');
      expect(await codeErreur(client, 'INSERT INTO insertion_sortie_cvg (employee_id, categorie) VALUES ($1, $2)', [id, 'retraite'])).toBeNull();
      // UNIQUE (employee_id, parcours_num) : une seconde ligne du même parcours → 23505.
      expect(await codeErreur(client, 'INSERT INTO insertion_sortie_cvg (employee_id, categorie) VALUES ($1, $2)', [id, 'emploi'])).toBe('23505');
      expect(await codeErreur(client, 'INSERT INTO insertion_sortie_cvg (employee_id, parcours_num, categorie) VALUES ($1, 2, $2)', [id, 'emploi'])).toBeNull();
      expect(await codeErreur(client, "INSERT INTO insertion_cvg_ressources (type, nom) VALUES ('benevole', 'X')")).toBe('23514');
      expect(await codeErreur(client, "INSERT INTO insertion_cvg_ressources (type, nom, etp_total) VALUES ('interne', 'X', 2.5)")).toBe('23514');
      expect(await codeErreur(client, "INSERT INTO insertion_cvg_ressources (type, nom, etp_accompagnement) VALUES ('interne', 'X', -0.1)")).toBe('23514');
      expect(await codeErreur(client, "INSERT INTO insertion_cvg_ressources (type, nom, date_debut, date_fin) VALUES ('interne', 'X', '2026-05-01', '2026-04-01')")).toBe('23514');
      expect(await codeErreur(client, "INSERT INTO insertion_dialogues_gestion (annee, contenu, type) VALUES (2026, '{}'::jsonb, 'autre')")).toBe('23514');
      // Sans `type` : le défaut 'dialogue'.
      const d = await client.query("INSERT INTO insertion_dialogues_gestion (annee, contenu) VALUES (2026, '{}'::jsonb) RETURNING type");
      expect(d.rows[0].type).toBe('dialogue');
    });
  });

  test('V-04 — une ligne ANTÉRIEURE à la migration reçoit `type = \'dialogue\'` ; orienteur rétréci puis ré-élargi sans perte (transaction annulée)', async () => {
    await dansTransactionAnnulee(async (client) => {
      // On ramène la base à sa forme d'AVANT le lot : colonnes et CHECK retirés,
      // orienteur en VARCHAR(20) avec l'ancien CHECK à 6 valeurs.
      await client.query(`
        ALTER TABLE insertion_dialogues_gestion DROP CONSTRAINT IF EXISTS insertion_dialogues_gestion_type_check;
        DROP INDEX IF EXISTS idx_insertion_dialogues_gestion_type;
        ALTER TABLE insertion_dialogues_gestion DROP COLUMN type, DROP COLUMN periode_debut, DROP COLUMN periode_fin;
        ALTER TABLE employees DROP CONSTRAINT employees_orienteur_type_check;
      `);
      await client.query("UPDATE employees SET orienteur_type = NULL WHERE length(orienteur_type) > 20 OR orienteur_type NOT IN ('departement_cms','france_travail','mission_locale','cap_emploi','ccas','autre')");
      await client.query(`
        ALTER TABLE employees ALTER COLUMN orienteur_type TYPE VARCHAR(20);
        ALTER TABLE employees ADD CONSTRAINT employees_orienteur_type_check CHECK (orienteur_type IS NULL OR orienteur_type IN ('departement_cms','france_travail','mission_locale','cap_emploi','ccas','autre'));
      `);
      const avant = await client.query("INSERT INTO insertion_dialogues_gestion (annee, contenu) VALUES (2025, '{\"avant\":true}'::jsonb) RETURNING id");
      const empAncien = await client.query("INSERT INTO employees (first_name, last_name, orienteur_type) VALUES ('A', 'Ancien', 'ccas') RETURNING id");
      expect(await codeErreur(client, "UPDATE employees SET orienteur_type = 'plie_pmie' WHERE id = $1", [empAncien.rows[0].id])).toBe('23514');

      // Deux passes : la seconde ne doit rien casser ni rien dupliquer.
      await migration.run(client);
      await migration.run(client);

      const r = await client.query('SELECT type, periode_debut FROM insertion_dialogues_gestion WHERE id = $1', [avant.rows[0].id]);
      expect(r.rows[0]).toEqual({ type: 'dialogue', periode_debut: null });
      const l = await client.query(
        "SELECT character_maximum_length AS l FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'orienteur_type'"
      );
      expect(l.rows[0].l).toBe(40);
      const anc = await client.query('SELECT orienteur_type FROM employees WHERE id = $1', [empAncien.rows[0].id]);
      expect(anc.rows[0].orienteur_type).toBe('ccas'); // l'ancienne saisie survit au changement de CHECK
      expect(await codeErreur(client, "UPDATE employees SET orienteur_type = 'services_sociaux_departement' WHERE id = $1", [empAncien.rows[0].id])).toBeNull();
      const n = await client.query("SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = 'employees_orienteur_type_check'");
      expect(n.rows[0].n).toBe(1);
    });
  });

  test('V-05 — registre art. 30 : UNE entrée, même après deux passes supplémentaires de la migration', async () => {
    await dansTransactionAnnulee(async (client) => {
      await migration.run(client);
      await migration.run(client);
      const r = await client.query("SELECT COUNT(*)::int AS n FROM rgpd_registre WHERE nom_traitement ILIKE 'Reporting Convergence%'");
      expect(r.rows[0].n).toBe(1);
    });
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM rgpd_registre WHERE nom_traitement ILIKE 'Reporting Convergence%'");
    expect(r.rows[0].n).toBe(1);
  });
});
