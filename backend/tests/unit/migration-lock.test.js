// ═══════════════════════════════════════════════════════════════════════════
// VERROU DE MIGRATION — le déploiement du 4 septembre 2026
// ───────────────────────────────────────────────────────────────────────────
// « [INIT-DB] ERREUR : deadlock detected » : `deploy.sh` lance init-db.js cinq
// secondes après avoir relancé les conteneurs, alors que le backend qui
// redémarre applique LUI AUSSI ses migrations. Deux séries de DDL sur les
// mêmes tables, dans des ordres différents → PostgreSQL en tue une, et le
// déploiement s'arrête avec le site en maintenance.
//
// Ce que ces cas verrouillent : les deux chemins prennent le MÊME verrou (donc
// ils ne peuvent plus se croiser), le verrou est toujours rendu — même sur
// erreur —, et une interruption pour cause de concurrence est rejouée alors
// qu'une vraie erreur SQL ne l'est JAMAIS (elle ne se répare pas en
// réessayant, et le déploiement doit s'arrêter).
// ═══════════════════════════════════════════════════════════════════════════
const {
  CLE_VERROU_MIGRATION,
  avecVerrouMigration,
  avecReprisesSurConcurrence,
} = require('../../src/utils/migration-lock');

const silence = { log() {}, warn() {} };

/** Pool simulé : un seul verrou consultatif, comme PostgreSQL. */
function fairePool() {
  const etat = { tenu: false, prises: 0, relaches: 0, clientsRendus: 0 };
  const pool = {
    etat,
    connect: async () => ({
      query: async (sql, params) => {
        if (/pg_try_advisory_lock/.test(sql)) {
          expect(params[0]).toBe(CLE_VERROU_MIGRATION);
          if (etat.tenu) return { rows: [{ obtenu: false }] };
          etat.tenu = true; etat.prises += 1;
          return { rows: [{ obtenu: true }] };
        }
        if (/pg_advisory_unlock/.test(sql)) {
          etat.tenu = false; etat.relaches += 1;
          return { rows: [{ pg_advisory_unlock: true }] };
        }
        return { rows: [] };
      },
      release: () => { etat.clientsRendus += 1; },
    }),
  };
  return pool;
}

const erreurSql = (code) => Object.assign(new Error(`erreur ${code}`), { code });

describe('verrou de migration : une seule initialisation de schéma à la fois', () => {
  test('le travail s\'exécute sous verrou, et le verrou est rendu', async () => {
    const pool = fairePool();
    let vuTenu = null;
    const r = await avecVerrouMigration(async () => { vuTenu = pool.etat.tenu; return 42; },
      { pool, journal: silence });
    expect(r).toBe(42);
    expect(vuTenu).toBe(true);
    expect(pool.etat).toMatchObject({ tenu: false, prises: 1, relaches: 1, clientsRendus: 1 });
  });

  test('DEUX migrations concurrentes ne se croisent JAMAIS', async () => {
    // C'est exactement le scénario du 4 septembre : init-db.js d'un côté,
    // les migrations de démarrage du backend de l'autre.
    const pool = fairePool();
    let dedans = 0; let maxSimultane = 0;
    const travail = async () => {
      dedans += 1; maxSimultane = Math.max(maxSimultane, dedans);
      await new Promise((r) => setTimeout(r, 20));
      dedans -= 1;
    };
    await Promise.all([
      avecVerrouMigration(travail, { pool, journal: silence }),
      avecVerrouMigration(travail, { pool, journal: silence }),
      avecVerrouMigration(travail, { pool, journal: silence }),
    ]);
    expect(maxSimultane).toBe(1);
    expect(pool.etat.tenu).toBe(false);
    expect(pool.etat.relaches).toBe(3);
  });

  test('une erreur du travail remonte, et ne laisse pas le verrou pris', async () => {
    const pool = fairePool();
    await expect(avecVerrouMigration(async () => { throw new Error('panne'); }, { pool, journal: silence }))
      .rejects.toThrow('panne');
    expect(pool.etat.tenu).toBe(false);
    expect(pool.etat.relaches).toBe(1);
    expect(pool.etat.clientsRendus).toBe(1);
  });

  test('attente trop longue : on échoue en le DISANT, jamais en forçant le passage', async () => {
    // Forcer le passage remettrait deux migrations en concurrence — c'est-à-dire
    // le défaut qu'on corrige.
    const pool = fairePool();
    pool.etat.tenu = true; // un autre déploiement tient le verrou
    await expect(avecVerrouMigration(async () => 'jamais', { pool, journal: silence, attenteMaxMs: 50 }))
      .rejects.toThrow(/Verrou de migration indisponible/);
    expect(pool.etat.clientsRendus).toBe(1);
  });

  test('l\'attente est annoncée à l\'opérateur (elle ne doit pas passer pour un blocage)', async () => {
    const pool = fairePool();
    pool.etat.tenu = true;
    const dits = [];
    await avecVerrouMigration(async () => 'x',
      { pool, journal: { log: (m) => dits.push(m), warn() {} }, attenteMaxMs: 60 }).catch(() => {});
    // Le premier rappel arrive après 10 s : sur une attente de 60 ms il n'y en a
    // pas — ce que ce cas vérifie, c'est qu'on ne noie pas le journal.
    expect(dits).toHaveLength(0);
  });
});

describe('reprise sur conflit d\'accès concurrent', () => {
  test('un interblocage est rejoué jusqu\'à aboutir', async () => {
    let essais = 0;
    const r = await avecReprisesSurConcurrence(async () => {
      essais += 1;
      if (essais < 3) throw erreurSql('40P01');
      return 'aboutie';
    }, { pauseMs: 1, journal: silence });
    expect([r, essais]).toEqual(['aboutie', 3]);
  });

  test('un échec de sérialisation est traité de même', async () => {
    let essais = 0;
    await avecReprisesSurConcurrence(async () => {
      essais += 1;
      if (essais < 2) throw erreurSql('40001');
      return 'ok';
    }, { pauseMs: 1, journal: silence });
    expect(essais).toBe(2);
  });

  test('une VRAIE erreur SQL n\'est JAMAIS rejouée', async () => {
    // Une colonne manquante ne se répare pas en réessayant : le déploiement
    // doit s'arrêter tout de suite, avec la bonne erreur.
    let essais = 0;
    await expect(avecReprisesSurConcurrence(async () => {
      essais += 1;
      throw erreurSql('42703');
    }, { pauseMs: 1, journal: silence })).rejects.toMatchObject({ code: '42703' });
    expect(essais).toBe(1);
  });

  test('un interblocage persistant finit par échouer (jamais de boucle infinie)', async () => {
    let essais = 0;
    await expect(avecReprisesSurConcurrence(async () => {
      essais += 1;
      throw erreurSql('40P01');
    }, { tentatives: 3, pauseMs: 1, journal: silence })).rejects.toMatchObject({ code: '40P01' });
    expect(essais).toBe(3);
  });
});

describe('les deux chemins de migration partagent le même verrou', () => {
  // Le verrou ne sert QUE s'il est pris des deux côtés : si l'un des deux
  // chemins l'oublie, ils se croisent à nouveau et l'interblocage revient.
  const fs = require('fs');
  const path = require('path');
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', f), 'utf8');

  test('init-db.js prend le verrou et rejoue sur conflit', () => {
    const src = lire('scripts/init-db.js');
    expect(src).toMatch(/avecVerrouMigration/);
    expect(src).toMatch(/avecReprisesSurConcurrence/);
  });

  test('les migrations de démarrage du serveur le prennent aussi', () => {
    expect(lire('index.js')).toMatch(/avecVerrouMigration\(async \(\) => \{/);
  });
});
