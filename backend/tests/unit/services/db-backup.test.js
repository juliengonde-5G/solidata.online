// Tests du service partagé de sauvegarde BDD (Lot 11) :
//  - décision jour/heure du job auto (fonction pure shouldRunAutoBackup —
//    mardi & vendredi 04h HEURE DE PARIS, évaluée en Europe/Paris via Intl,
//    indépendamment du TZ du processus : les dates de test sont construites en
//    UTC EXPLICITE (Date.UTC) pour prouver les deux saisons — hiver CET UTC+1,
//    été CEST UTC+2) ;
//  - format des noms de fichiers (auto_ libellé en heure Paris / manuel, whitelist) ;
//  - rétention glissante : ne supprime QUE les auto_*.sql au-delà de 8,
//    jamais les sauvegardes manuelles.
// Aucun accès DB ni pg_dump : uniquement la logique pure + fs sur un tmpdir.
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  shouldRunAutoBackup,
  getParisParts,
  autoBackupFilename,
  manualBackupFilename,
  pruneAutoBackups,
  listBackups,
  AUTO_PREFIX,
  AUTO_BACKUP_DAYS,
  AUTO_BACKUP_HOUR,
  SAFE_BACKUP_NAME,
} = require('../../../src/services/db-backup');

// Instant UTC explicite (indépendant du TZ du runner de test).
// Rappel calendrier : 2026-01-06 = mardi, 2026-01-09 = vendredi (hiver, UTC+1) ;
// 2026-08-04 = mardi, 2026-08-05 = mercredi, 2026-08-07 = vendredi,
// 2026-08-09 = dimanche (été, UTC+2).
const utc = (y, m, day, h) => new Date(Date.UTC(y, m - 1, day, h, 0, 0));

describe('shouldRunAutoBackup — mardi & vendredi 04h HEURE DE PARIS', () => {
  it('HIVER (UTC+1) : mardi 03:00 UTC = 04h Paris → true', () => {
    expect(shouldRunAutoBackup(utc(2026, 1, 6, 3))).toBe(true);
  });

  it('HIVER (UTC+1) : vendredi 03:00 UTC = 04h Paris → true', () => {
    expect(shouldRunAutoBackup(utc(2026, 1, 9, 3))).toBe(true);
  });

  it('HIVER (UTC+1) : mardi 04:00 UTC = 05h Paris → false (le piège UTC)', () => {
    expect(shouldRunAutoBackup(utc(2026, 1, 6, 4))).toBe(false);
  });

  it('HIVER (UTC+1) : mardi 02:00 UTC = 03h Paris → false', () => {
    expect(shouldRunAutoBackup(utc(2026, 1, 6, 2))).toBe(false);
  });

  it('ÉTÉ (UTC+2) : vendredi 02:00 UTC = 04h Paris → true', () => {
    expect(shouldRunAutoBackup(utc(2026, 8, 7, 2))).toBe(true);
  });

  it('ÉTÉ (UTC+2) : mardi 02:00 UTC = 04h Paris → true', () => {
    expect(shouldRunAutoBackup(utc(2026, 8, 4, 2))).toBe(true);
  });

  it('ÉTÉ (UTC+2) : mardi 03:00 UTC = 05h Paris → false', () => {
    expect(shouldRunAutoBackup(utc(2026, 8, 4, 3))).toBe(false);
  });

  it('mauvais jour Paris : mercredi et dimanche 04h Paris → false', () => {
    expect(shouldRunAutoBackup(utc(2026, 8, 5, 2))).toBe(false); // mercredi 04h Paris (été)
    expect(shouldRunAutoBackup(utc(2026, 8, 9, 2))).toBe(false); // dimanche 04h Paris (été)
  });

  it('bascule de jour : lundi 23:00 UTC (hiver) = mardi 00h Paris → false (jour Paris OK, heure ≠ 4)', () => {
    const t = utc(2026, 1, 5, 23); // lundi 23h UTC = mardi 00h Paris
    expect(getParisParts(t)).toMatchObject({ day: 6, hour: 0, weekday: 2 });
    expect(shouldRunAutoBackup(t)).toBe(false);
  });

  it('getParisParts : décomposition Paris correcte dans les deux saisons', () => {
    expect(getParisParts(utc(2026, 1, 6, 3))).toMatchObject({ year: 2026, month: 1, day: 6, hour: 4, weekday: 2 });
    expect(getParisParts(utc(2026, 8, 7, 2))).toMatchObject({ year: 2026, month: 8, day: 7, hour: 4, weekday: 5 });
  });

  it('constantes de planification : jours {mardi, vendredi}, heure 4', () => {
    expect(AUTO_BACKUP_DAYS).toEqual([2, 5]);
    expect(AUTO_BACKUP_HOUR).toBe(4);
  });
});

describe('noms de fichiers', () => {
  it('autoBackupFilename libellé en HEURE PARIS — été : run à 02:00 UTC → _0400', () => {
    const name = autoBackupFilename(utc(2026, 8, 4, 2));
    expect(name).toBe('auto_solidata_2026-08-04_0400.sql');
    expect(name.startsWith(AUTO_PREFIX)).toBe(true);
    expect(SAFE_BACKUP_NAME.test(name)).toBe(true);
  });

  it('autoBackupFilename libellé en HEURE PARIS — hiver : run à 03:00 UTC → _0400', () => {
    expect(autoBackupFilename(utc(2026, 1, 6, 3))).toBe('auto_solidata_2026-01-06_0400.sql');
  });

  it('manualBackupFilename garde le format historique de la route (ISO UTC, whitelist OK)', () => {
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
