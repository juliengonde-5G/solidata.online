// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Migration 2.60.0 « Suivi Convergence (CVG) »
//   backend/src/scripts/migrations/insertion-convergence.js
//
// Client SIMULÉ : on tient le contrat d'exécution (aucune transaction interne,
// rejouable à l'identique, chaque instruction gardée), le DDL attendu par le
// contrat 30 § 2.2, et le CHECK des orienteurs RECONSTRUIT sans perdre les
// valeurs déjà saisies. Garde : init-db appelle la migration juste après
// `insertion-reporting`.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const migration = require('../../../src/scripts/migrations/insertion-convergence');
const R = require('../../../src/utils/convergence-cvg-referentiels');

function faireClient() {
  const sqls = [];
  return {
    sqls,
    query: jest.fn(async (sql, params) => { sqls.push({ sql: String(sql), params }); return { rows: [] }; }),
    tout: () => sqls.map((q) => q.sql).join('\n;;\n'),
  };
}

let tout;
beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const c = faireClient();
  await migration.run(c);
  tout = c.tout();
});

describe("contrat d'exécution", () => {
  it("n'ouvre aucune transaction et se rejoue à l'identique", async () => {
    const a = faireClient();
    const b = faireClient();
    await migration.run(a);
    await migration.run(b);
    expect(b.tout()).toBe(a.tout());
    for (const { sql } of a.sqls) expect(sql.trim().toUpperCase()).not.toMatch(/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/);
  });

  it('chaque instruction porte sa garde', async () => {
    const c = faireClient();
    await migration.run(c);
    for (const { sql } of c.sqls) {
      // 2.60.0 : la mise à jour de l'entrée art. 30 est gardée par le MARQUEUR
      // du texte d'origine — elle ne s'applique qu'une fois et n'écrase jamais
      // une rédaction du DPO.
      expect(/IF NOT EXISTS|IF EXISTS|pg_get_constraintdef|WHERE NOT EXISTS|LIKE '%n''applique PAS le seuil de k-anonymat%'/i.test(sql)).toBe(true);
    }
  });

  it('init-db l’appelle juste après insertion-reporting', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'scripts', 'init-db.js'), 'utf8');
    const iRep = src.indexOf("require('./migrations/insertion-reporting').run(client)");
    const iCvg = src.indexOf("require('./migrations/insertion-convergence').run(client)");
    expect(iRep).toBeGreaterThan(-1);
    expect(iCvg).toBeGreaterThan(iRep);
  });
});

describe('DDL du contrat § 2.2', () => {
  it('diagnostic : habitat CVG (CHECK 5 valeurs), parcours de rue, pension, médecin traitant', () => {
    for (const col of ['habitat_type VARCHAR(30)', 'parcours_rue BOOLEAN', 'pension_invalidite BOOLEAN', 'medecin_traitant BOOLEAN']) {
      expect(tout).toContain(`ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS ${col}`);
    }
    expect(tout).toMatch(/insertion_diagnostics_habitat_type_check[\s\S]*'autonome','semi_durable','hebergement_collectif','hebergement_precaire','rue'/);
  });

  it('orienteurs : colonne élargie à 40 et CHECK RECONSTRUIT gardant les anciennes valeurs', () => {
    expect(tout).toContain('ALTER COLUMN orienteur_type TYPE VARCHAR(40)');
    expect(tout).toMatch(/DROP CONSTRAINT employees_orienteur_type_check/);
    expect(tout).toMatch(/NOT LIKE '%candidature_spontanee%'/);
    const check = tout.slice(tout.indexOf('ADD CONSTRAINT employees_orienteur_type_check'));
    for (const v of [...R.ORIENTEURS_CVG, 'departement_cms', 'ccas', 'autre']) expect(check).toContain(`'${v}'`);
  });

  it('situation de sortie : unicité par parcours, FK CASCADE, saisi_par SET NULL, CHECK catégories', () => {
    expect(tout).toContain('CREATE TABLE IF NOT EXISTS insertion_sortie_cvg');
    expect(tout).toMatch(/employee_id INTEGER NOT NULL REFERENCES employees\(id\) ON DELETE CASCADE/);
    expect(tout).toMatch(/saisi_par INTEGER REFERENCES users\(id\) ON DELETE SET NULL/);
    expect(tout).toContain('UNIQUE (employee_id, parcours_num)');
    for (const c of ['couverture_sante_amelioree BOOLEAN', 'accompagnement_post_sortie BOOLEAN', 'habitat_type_sortie VARCHAR(30)']) expect(tout).toContain(c);
    const check = tout.slice(tout.indexOf('insertion_sortie_cvg_categorie_check'));
    for (const v of R.SORTIE_CATEGORIES) expect(check).toContain(`'${v}'`);
  });

  it('ressources : type, nom obligatoire, ETP bornés 0-2, dates cohérentes', () => {
    expect(tout).toContain('CREATE TABLE IF NOT EXISTS insertion_cvg_ressources');
    expect(tout).toContain('nom VARCHAR(150) NOT NULL');
    expect(tout).toContain("type IN ('interne','mutualisee')");
    for (const c of ['etp_total', 'etp_accompagnement', 'etp_encadrement']) {
      expect(tout).toContain(`${c} NUMERIC(4,2)`);
      expect(tout).toContain(`${c} IS NULL OR (${c} >= 0 AND ${c} <= 2)`);
    }
    expect(tout).toContain('date_fin >= date_debut');
  });

  it('instantanés : type (défaut dialogue, CHECK), période, index', () => {
    expect(tout).toContain("ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'dialogue'");
    expect(tout).toContain('ADD COLUMN IF NOT EXISTS periode_debut DATE');
    expect(tout).toContain('ADD COLUMN IF NOT EXISTS periode_fin DATE');
    expect(tout).toContain("type IN ('dialogue','cvg')");
    expect(tout).toMatch(/idx_insertion_dialogues_gestion_type[\s\S]*\(type, genere_le DESC\)/);
  });

  it('registre art. 30 posé une seule fois', () => {
    expect(tout).toMatch(/INSERT INTO rgpd_registre[\s\S]*'Reporting Convergence \(programme CVG\)'[\s\S]*WHERE NOT EXISTS/);
  });

  it('2.60.0 — historique de la situation de sortie et auteur de la modification (m-03)', () => {
    expect(tout).toContain('ADD COLUMN IF NOT EXISTS modifie_par INTEGER REFERENCES users(id) ON DELETE SET NULL');
    expect(tout).toContain('CREATE TABLE IF NOT EXISTS insertion_sortie_cvg_history');
    expect(tout).toMatch(/insertion_sortie_cvg_history[\s\S]*employee_id INTEGER NOT NULL REFERENCES employees\(id\) ON DELETE CASCADE/);
    // Pas de clé étrangère vers la situation : l'historique lui survit.
    expect(tout).toMatch(/situation_id INTEGER NOT NULL,/);
  });

  it('2.60.0 — entrée art. 30 : seuil de confidentialité, justice non transmise, durée du registre (B-01, B-02, M-03)', async () => {
    const c = faireClient();
    await migration.run(c);
    const ins = c.sqls.find((q) => /INSERT INTO rgpd_registre/.test(q.sql));
    const upd = c.sqls.find((q) => /UPDATE rgpd_registre/.test(q.sql));
    for (const q of [ins, upd]) {
      const [cat, duree, mesures] = q.params;
      expect(cat).toMatch(/cvg_k_min/);
      expect(cat).toMatch(/FREIN JUDICIAIRE \(art\. 10 RGPD\) n'est PAS transmis par défaut/);
      expect(cat).not.toMatch(/n'applique PAS le seuil/);
      expect(duree).toMatch(/rgpd\.cvg_ressources_retention_jours/);
      expect(mesures).toMatch(/« s »/);
    }
    // La mise à jour ne vise QUE le texte d'origine.
    expect(upd.sql).toMatch(/LIKE '%n''applique PAS le seuil de k-anonymat%'/);
  });
});
