// Tests du service partagé de sauvegarde BDD (Lot 11) :
//  - décision jour/heure du job auto (fonction pure shouldRunAutoBackup —
//    mardi & vendredi 04h, heure locale du conteneur = UTC en prod) ;
//  - format des noms de fichiers (auto_ / manuel, whitelist) ;
//  - rétention glissante : ne supprime QUE les auto_*.sql au-delà de 8,
//    jamais les sauvegardes manuelles.
// Aucun accès DB ni pg_dump : uniquement la logique pure + fs sur un tmpdir.
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  shouldRunAutoBackup,
  autoBackupFilename,
  manualBackupFilename,
  pruneAutoBackups,
  listBackups,
  AUTO_PREFIX,
  AUTO_BACKUP_DAYS,
  AUTO_BACKUP_HOUR,
  SAFE_BACKUP_NAME,
} = require('../../../src/services/db-backup');

// Rappel calendrier : 2026-08-04 = mardi, 2026-08-05 = mercredi,
// 2026-08-07 = vendredi, 2026-08-09 = dimanche (constructeur Date local,
// même convention que now.getDay()/getHours() dans le scheduler).
const d = (y, m, day, h) => new Date(y, m - 1, day, h, 0, 0);

describe('shouldRunAutoBackup — décision jour/heure (mardi & vendredi 04h)', () => {
  it('vrai le mardi à 04h', () => {
    const t = d(2026, 8, 4, 4);
    expect(t.getDay()).toBe(2); // sanity : bien un mardi
    expect(shouldRunAutoBackup(t)).toBe(true);
  });

  it('vrai le vendredi à 04h', () => {
    const t = d(2026, 8, 7, 4);
    expect(t.getDay()).toBe(5); // sanity : bien un vendredi
    expect(shouldRunAutoBackup(t)).toBe(true);
  });

  it('faux un mercredi à 04h (mauvais jour)', () => {
    expect(shouldRunAutoBackup(d(2026, 8, 5, 4))).toBe(false);
  });

  it('faux un dimanche à 04h (mauvais jour)', () => {
    expect(shouldRunAutoBackup(d(2026, 8, 9, 4))).toBe(false);
  });

  it('faux le mardi à 03h et 05h (mauvaise heure)', () => {
    expect(shouldRunAutoBackup(d(2026, 8, 4, 3))).toBe(false);
    expect(shouldRunAutoBackup(d(2026, 8, 4, 5))).toBe(false);
  });

  it('constantes de planification : jours {mardi, vendredi}, heure 4', () => {
    expect(AUTO_BACKUP_DAYS).toEqual([2, 5]);
    expect(AUTO_BACKUP_HOUR).toBe(4);
  });
});

describe('noms de fichiers', () => {
  it('autoBackupFilename → auto_solidata_YYYY-MM-DD_HH00.sql (whitelist OK)', () => {
    const name = autoBackupFilename(d(2026, 8, 4, 4));
    expect(name).toBe('auto_solidata_2026-08-04_0400.sql');
    expect(name.startsWith(AUTO_PREFIX)).toBe(true);
    expect(SAFE_BACKUP_NAME.test(name)).toBe(true);
  });

  it('manualBackupFilename garde le format historique de la route (whitelist OK)', () => {
    const name = manualBackupFilename(new Date('2026-08-04T04:00:00.000Z'));
    expect(name).toMatch(/^solidata_backup_2026-08-04T04-00-00-000Z\.sql$/);
    expect(name.startsWith(AUTO_PREFIX)).toBe(false);
    expect(SAFE_BACKUP_NAME.test(name)).toBe(true);
  });
});

describe('pruneAutoBackups — rétention 8, manuelles intouchées', () => {
  let dir;

  const touch = (filename, ageMinutes) => {
    const p = path.join(dir, filename);
    fs.writeFileSync(p, '-- dump de test');
    const t = new Date(Date.now() - ageMinutes * 60000);
    fs.utimesSync(p, t, t); // mtime distinct → ordre déterministe
    return p;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solidata-db-backup-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('supprime les auto les plus anciennes au-delà de keep, jamais les manuelles', () => {
    // 10 sauvegardes auto (auto_00 la plus récente … auto_09 la plus ancienne)
    for (let i = 0; i < 10; i++) touch(`auto_solidata_2026-07-${String(10 + i).padStart(2, '0')}_0400.sql`, i * 10);
    // 2 manuelles, dont une PLUS ANCIENNE que toutes les autos (le cas piège)
    touch('solidata_backup_recente.sql', 5);
    touch('solidata_backup_tres_ancienne.sql', 10000);

    const { deleted } = pruneAutoBackups(8, dir);

    expect(deleted.sort()).toEqual([
      'auto_solidata_2026-07-18_0400.sql',
      'auto_solidata_2026-07-19_0400.sql',
    ]);
    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toHaveLength(10); // 8 autos + 2 manuelles
    expect(remaining).toContain('solidata_backup_recente.sql');
    expect(remaining).toContain('solidata_backup_tres_ancienne.sql');
    expect(remaining).not.toContain('auto_solidata_2026-07-19_0400.sql');
  });

  it('ne supprime rien quand il y a moins de keep sauvegardes auto', () => {
    for (let i = 0; i < 3; i++) touch(`auto_solidata_2026-07-0${i + 1}_0400.sql`, i * 10);
    touch('solidata_backup_manuelle.sql', 500);
    const { deleted } = pruneAutoBackups(8, dir);
    expect(deleted).toEqual([]);
    expect(fs.readdirSync(dir)).toHaveLength(4);
  });

  it('répertoire absent → no-op sans erreur', () => {
    expect(pruneAutoBackups(8, path.join(dir, 'inexistant'))).toEqual({ deleted: [] });
  });
});

describe('listBackups — drapeau auto + tri décroissant', () => {
  it('marque auto=true sur les auto_*.sql et trie de la plus récente à la plus ancienne', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solidata-db-backup-list-'));
    try {
      const mk = (f, ageMin) => {
        const p = path.join(dir, f);
        fs.writeFileSync(p, 'x');
        const t = new Date(Date.now() - ageMin * 60000);
        fs.utimesSync(p, t, t);
      };
      mk('auto_solidata_2026-08-04_0400.sql', 60);
      mk('solidata_backup_manuelle.sql', 10);
      mk('pas_une_sauvegarde.txt', 1); // ignoré (pas .sql)

      const list = listBackups(dir);
      expect(list.map((b) => b.filename)).toEqual([
        'solidata_backup_manuelle.sql',
        'auto_solidata_2026-08-04_0400.sql',
      ]);
      expect(list[0].auto).toBe(false);
      expect(list[1].auto).toBe(true);
      expect(list[0]).toHaveProperty('size');
      expect(list[0]).toHaveProperty('created_at');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
