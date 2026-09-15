// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Migration PR D lot 6 « Reporting autorité »
//   backend/src/scripts/migrations/insertion-reporting.js
//
// `run(client)` est appelé par init-db.js DANS sa transaction. Ce fichier tient
// le contrat d'exécution, sur un client SIMULÉ (aucune base) :
//   1. AUCUN BEGIN / COMMIT / ROLLBACK — la migration n'ouvre pas de
//      transaction à l'intérieur de celle d'init-db ;
//   2. TOUT EST REJOUABLE — la rejouer deux fois émet exactement le même SQL,
//      et chaque instruction porte sa garde (IF NOT EXISTS, DO-scan de
//      `pg_constraint`, ON CONFLICT) ;
//   3. les CHECK sont posés par DO-scan et non par `ADD CONSTRAINT` nu, qui
//      échouerait en 42710 à la seconde exécution ;
//   4. le CHECK des catégories d'action REPREND les six valeurs historiques —
//      les perdre invaliderait toutes les lignes déjà saisies ;
//   5. le seed du CMS ne crée PAS de doublon avec celui de la PR A.
// ═══════════════════════════════════════════════════════════════════════════

const migration = require('../../../src/scripts/migrations/insertion-reporting');

/** Client simulé : il enregistre le SQL et rend une réponse vide. */
function faireClient() {
  const sqls = [];
  return {
    sqls,
    query: jest.fn(async (sql, params) => { sqls.push({ sql: String(sql), params }); return { rows: [] }; }),
    tout: () => sqls.map((q) => q.sql).join('\n;;\n'),
  };
}

describe("contrat d'exécution", () => {
  it("n'ouvre AUCUNE transaction (elle vit dans celle d'init-db)", async () => {
    const c = faireClient();
    await migration.run(c);
    // Une instruction de contrôle de transaction est sa PROPRE requête ; les
    // `BEGIN` qui apparaissent dans le SQL sont ceux des blocs PL/pgSQL
    // (`DO $$ BEGIN … END $$`), qui n'ouvrent rien.
    for (const { sql } of c.sqls) {
      expect(sql.trim().toUpperCase()).not.toMatch(/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/);
    }
  });

  it('rejouée deux fois, elle émet exactement le même SQL', async () => {
    const a = faireClient();
    const b = faireClient();
    await migration.run(a);
    await migration.run(b);
    expect(b.tout()).toBe(a.tout());
    expect(a.sqls.length).toBeGreaterThan(5);
  });

  it('chaque instruction porte sa garde de rejouabilité', async () => {
    const c = faireClient();
    await migration.run(c);
    for (const { sql } of c.sqls) {
      const garde = /IF NOT EXISTS/i.test(sql)
        || /ON CONFLICT/i.test(sql)
        || /pg_get_constraintdef/i.test(sql)
        // Le seul UPDATE est borné par son propre WHERE (il ne touche que la
        // valeur posée par le seed), donc rejouable par construction.
        || /^\s*UPDATE insertion_partenaires SET categorie/i.test(sql);
      expect(garde).toBe(true);
    }
  });

  it('aucun ADD CONSTRAINT nu : tous passent par un DO-scan de pg_constraint', async () => {
    const c = faireClient();
    await migration.run(c);
    for (const { sql } of c.sqls) {
      if (!/ADD CONSTRAINT/i.test(sql)) continue;
      expect(sql).toMatch(/pg_constraint|pg_get_constraintdef/);
    }
  });
});

describe('débouché des PMSMP (S1 / S7)', () => {
  it('trois colonnes, dont `embauche_accueillant` NULLABLE (« pas encore » ≠ « non »)', async () => {
    const c = faireClient();
    await migration.run(c);
    const tout = c.tout();
    expect(tout).toMatch(/ALTER TABLE insertion_pmsmp ADD COLUMN IF NOT EXISTS debouche VARCHAR\(25\)/);
    expect(tout).toMatch(/ADD COLUMN IF NOT EXISTS debouche_date DATE/);
    expect(tout).toMatch(/ADD COLUMN IF NOT EXISTS embauche_accueillant BOOLEAN;/);
    // Surtout PAS de NOT NULL DEFAULT false : il ferait passer « on ne sait pas
    // encore » pour « pas d'embauche ».
    expect(tout).not.toMatch(/embauche_accueillant BOOLEAN NOT NULL/);
  });

  it('la liste fermée des débouchés est celle du contrat, dans le CHECK', async () => {
    expect(migration.PMSMP_DEBOUCHES).toEqual([
      'embauche_accueillant', 'embauche_autre', 'formation', 'poursuite_parcours', 'aucun', 'inconnu',
    ]);
    const c = faireClient();
    await migration.run(c);
    const check = c.sqls.find((q) => /insertion_pmsmp_debouche_check/.test(q.sql));
    expect(check).toBeTruthy();
    expect(check.sql).toMatch(/debouche IS NULL OR debouche IN \('embauche_accueillant','embauche_autre','formation','poursuite_parcours','aucun','inconnu'\)/);
  });
});

describe('orientation DORA et aide mobilisée (P2 / C5)', () => {
  it('six colonnes, `aide_montant` NULLABLE et jamais négative', async () => {
    const c = faireClient();
    await migration.run(c);
    const tout = c.tout();
    for (const col of ['dora_service', 'dora_url', 'dora_resultat', 'aide_nature', 'aide_organisme', 'aide_montant']) {
      expect(tout).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`));
    }
    const check = c.sqls.find((q) => /cip_action_plans_aide_montant_check/.test(q.sql));
    expect(check.sql).toMatch(/aide_montant IS NULL OR aide_montant >= 0/);
    // Un DEFAULT 0 ferait entrer des aides « à 0 € » dans un total transmis au
    // Département : l'absence de chiffrage doit rester une absence.
    expect(tout).not.toMatch(/aide_montant NUMERIC\(9,2\) DEFAULT/);
  });

  it('les listes fermées DORA et aide sont celles du contrat § 5.6', async () => {
    expect(migration.DORA_RESULTATS).toEqual(['oriente', 'pris_en_charge', 'refuse', 'sans_suite']);
    expect(migration.AIDE_NATURES).toEqual([
      'mobilite', 'logement', 'sante', 'numerique', 'garde_enfants',
      'formation', 'administrative', 'financiere_urgence', 'autre',
    ]);
  });
});

describe("catégories d'action — le CHECK est reconstruit, jamais amputé", () => {
  it('les six valeurs historiques sont reprises, `formation_fle` ajoutée', async () => {
    expect(migration.ACTION_CATEGORIES).toEqual([
      'competence', 'insertion', 'socialisation', 'frein', 'job_dating', 'formation', 'formation_fle',
    ]);
    const c = faireClient();
    await migration.run(c);
    const q = c.sqls.find((x) => /cip_action_plans_category_check/.test(x.sql));
    expect(q.sql).toMatch(/CHECK \(category IN \('competence','insertion','socialisation','frein','job_dating','formation','formation_fle'\)\)/);
  });

  it('la reconstruction est conditionnée à la relecture de la définition existante', async () => {
    const c = faireClient();
    await migration.run(c);
    const q = c.sqls.find((x) => /cip_action_plans_category_check/.test(x.sql));
    // On ne reconstruit que si la contrainte ne couvre PAS déjà la valeur :
    // rejouer ne verrouille pas la table pour rien.
    expect(q.sql).toMatch(/def IS NULL OR def NOT LIKE '%formation_fle%'/);
    expect(q.sql).toMatch(/DROP CONSTRAINT cip_action_plans_category_check/);
  });

  it('le dictionnaire de « Mon parcours » couvre TOUTES les catégories du CHECK', async () => {
    // Sans cela, une action de cette catégorie DISPARAÎTRAIT du document remis à
    // la personne (le document filtre les lignes sans libellé) — c'est le
    // correctif D-07 de la PR C, et la garde doit valoir pour la 7e catégorie.
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key';
    const { CATEGORIE_ACTION_LABELS } = require('../../../src/services/mon-parcours');
    for (const c of migration.ACTION_CATEGORIES) {
      expect(CATEGORIE_ACTION_LABELS[c]).toBeTruthy();
    }
  });
});

describe('référentiel partenaires — le CMS (amendement A5)', () => {
  it('aucun doublon : le seed de la PR A est réutilisé, jamais recréé sous un autre nom', async () => {
    const c = faireClient();
    await migration.run(c);
    const tout = c.tout();
    expect(tout).toMatch(/ON CONFLICT \(nom\) DO NOTHING/);
    // Le nom EST celui de la PR A : un second « CMS (Département 76) » mettrait
    // deux CMS au référentiel et éclaterait les statistiques par partenaire.
    expect(tout).toMatch(/'Centre médico-social \(CMS\) — Département 76'/);
    expect(tout).not.toMatch(/'CMS \(Département 76\)'/);
  });

  it('la catégorie n’est normalisée QUE si elle porte encore la valeur du seed', async () => {
    const c = faireClient();
    await migration.run(c);
    const q = c.sqls.find((x) => /UPDATE insertion_partenaires SET categorie/.test(x.sql));
    expect(q.sql).toMatch(/categorie = 'social'/); // un partenaire recatégorisé à la main est intact
  });
});

describe('snapshot des synthèses générées', () => {
  it('table créée avec IF NOT EXISTS, trimestre NULL = version annuelle', async () => {
    const c = faireClient();
    await migration.run(c);
    const tout = c.tout();
    expect(tout).toMatch(/CREATE TABLE IF NOT EXISTS insertion_dialogues_gestion/);
    expect(tout).toMatch(/contenu JSONB NOT NULL/);
    expect(tout).toMatch(/genere_par INTEGER REFERENCES users\(id\)/);
    expect(tout).toMatch(/CREATE INDEX IF NOT EXISTS idx_insertion_dialogues_gestion_periode/);
  });

  it('le trimestre est borné 1-4 par un CHECK posé en DO-scan', async () => {
    const c = faireClient();
    await migration.run(c);
    const q = c.sqls.find((x) => /insertion_dialogues_gestion_trimestre_check/.test(x.sql));
    expect(q.sql).toMatch(/trimestre IS NULL OR trimestre BETWEEN 1 AND 4/);
    expect(q.sql).toMatch(/pg_constraint/);
  });

  it('aucune colonne nominative : le snapshot est agrégé (rien à purger à l’anonymisation)', async () => {
    const c = faireClient();
    await migration.run(c);
    const creation = c.sqls.find((x) => /CREATE TABLE IF NOT EXISTS insertion_dialogues_gestion/.test(x.sql)).sql;
    expect(creation).not.toMatch(/employee_id|first_name|last_name|birth_date/);
  });
});
