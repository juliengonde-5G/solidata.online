/**
 * DB-BACKUP — Service partagé de sauvegarde de la base PostgreSQL (Lot 11).
 *
 * Factorise la logique jusqu'ici propre à routes/admin-db.js (pg_dump vers
 * /app/backups, env PG*, listing, garde-fou de nom de fichier) pour qu'elle
 * soit consommée par DEUX appelants sans duplication :
 *  - la route ADMIN POST /api/admin-db/backup (sauvegarde manuelle, comportement
 *    inchangé : même nom de fichier, mêmes options pg_dump, même timeout) ;
 *  - le job scheduler `autoDatabaseBackup` (mardi & vendredi 04h, fichiers
 *    préfixés `auto_`, rétention glissante — voir shouldRunAutoBackup).
 *
 * FUSEAU HORAIRE : contrairement aux autres jobs du scheduler (qui testent
 * l'heure LOCALE du conteneur, = UTC en prod), la décision jour/heure de CE job
 * est évaluée dans le fuseau EUROPE/PARIS via Intl.DateTimeFormat — exigence
 * client : « mardi et vendredi 04h du matin » en heure française, sans changer
 * le TZ du conteneur (ce qui décalerait tous les autres jobs). 04h Paris
 * = 03h UTC en hiver (CET, UTC+1) / 02h UTC en été (CEST, UTC+2) — toujours
 * aligné sur un top d'heure UTC, donc le tick horaire du scheduler le capte
 * exactement une fois par jour planifié, quel que soit le TZ du conteneur.
 *
 * RÉTENTION : seules les sauvegardes AUTOMATIQUES (`auto_*.sql`) sont soumises
 * à la rétention (8 fichiers par défaut, surchargeable via
 * AUTO_BACKUP_RETENTION). Les sauvegardes manuelles ne sont JAMAIS supprimées
 * par le job — uniquement à la main depuis /admin-db.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Répertoire des sauvegardes — identique à celui de routes/admin-db.js
// (backend/backups → monté en volume `/app/backups` dans le conteneur).
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

// Whitelist stricte pour les noms de fichiers de sauvegarde (évite path
// traversal et caractères shell inattendus même si `path.basename` est
// déjà utilisé en amont).
const SAFE_BACKUP_NAME = /^[A-Za-z0-9._-]+$/;

// Préfixe des sauvegardes automatiques (seules soumises à la rétention).
const AUTO_PREFIX = 'auto_';

// Nombre de sauvegardes automatiques conservées (les plus récentes).
const AUTO_RETENTION = Math.max(1, Number(process.env.AUTO_BACKUP_RETENTION) || 8);

// Planification du job auto : mardi (2) et vendredi (5) à 04h — jour de
// semaine et heure du calendrier EUROPE/PARIS (cf. bloc FUSEAU HORAIRE).
const PARIS_TZ = 'Europe/Paris';
const AUTO_BACKUP_DAYS = [2, 5];
const AUTO_BACKUP_HOUR = 4;

// Construit l'environnement pg_dump / psql à partir des variables dédiées
// pour éviter l'interpolation de credentials dans une ligne de commande shell.
function buildPgEnv() {
  return {
    ...process.env,
    PGHOST: process.env.DB_HOST || 'localhost',
    PGPORT: process.env.DB_PORT || '5432',
    PGUSER: process.env.DB_USER || 'postgres',
    PGPASSWORD: process.env.DB_PASSWORD || '',
    PGDATABASE: process.env.DB_NAME || 'solidata',
  };
}

// Indice lisible pour une erreur pg_dump / psql (surface ADMIN-only → on peut
// exposer un message technique tronqué, ça rend le 500 diagnosticable).
function execHint(err) {
  if (err.code === 'ENOENT') {
    return "Client PostgreSQL absent du conteneur API — reconstruire l'image (postgresql-client).";
  }
  const stderr = (err.stderr && err.stderr.toString ? err.stderr.toString() : '').trim();
  return stderr ? stderr.split('\n').filter(Boolean).slice(-2).join(' ') : (err.message || undefined);
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Nom des sauvegardes MANUELLES — format historique de la route, inchangé. */
function manualBackupFilename(now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `solidata_backup_${timestamp}.sql`;
}

/**
 * Décompose un instant dans le calendrier EUROPE/PARIS, indépendamment du TZ
 * du processus : année/mois/jour/heure civils parisiens + jour de semaine
 * (0 = dimanche … 6 = samedi, convention getDay). Le jour de semaine est
 * calculé en reconstruisant la date civile Paris en UTC (getUTCDay) plutôt
 * qu'en comparant des libellés localisés (« mar. », « ven. ») — plus robuste.
 */
function getParisParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, weekday };
}

/**
 * Nom des sauvegardes AUTOMATIQUES, ex. auto_solidata_2026-08-04_0400.sql.
 * Date et heure encodées en HEURE DE PARIS (cohérent avec la planification
 * affichée au client : un run d'été à 02:00 UTC est bien libellé _0400).
 */
function autoBackupFilename(now = new Date()) {
  const p = getParisParts(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${AUTO_PREFIX}solidata_${p.year}-${pad(p.month)}-${pad(p.day)}_${pad(p.hour)}00.sql`;
}

/**
 * FONCTION PURE (testée) — le job auto doit-il tourner à ce tick horaire ?
 * Vrai uniquement mardi & vendredi à 04h HEURE DE PARIS (Europe/Paris via
 * Intl, indifférent au TZ du conteneur) : 03h UTC en hiver, 02h UTC en été.
 * Le scheduler tickant une fois par top d'heure (l'offset Paris est toujours
 * un nombre entier d'heures), l'égalité stricte sur l'heure garantit une
 * exécution et une seule par jour planifié.
 */
function shouldRunAutoBackup(now = new Date()) {
  const p = getParisParts(now);
  return AUTO_BACKUP_DAYS.includes(p.weekday) && p.hour === AUTO_BACKUP_HOUR;
}

/**
 * Exécute pg_dump vers `filename` dans BACKUP_DIR.
 * execFileSync évite l'interprétation shell ; pg_dump écrit directement dans le
 * fichier via -f, aucune redirection shell nécessaire. Mêmes options et timeout
 * que la route historique. Lève en cas d'échec (l'appelant journalise).
 */
function createBackup(filename) {
  ensureBackupDir();
  const safeName = path.basename(String(filename));
  if (!SAFE_BACKUP_NAME.test(safeName)) {
    throw new Error(`Nom de fichier de sauvegarde invalide : ${filename}`);
  }
  const filepath = path.join(BACKUP_DIR, safeName);
  execFileSync('pg_dump', ['--no-owner', '--no-acl', '-f', filepath], {
    env: buildPgEnv(),
    timeout: 120000,
  });
  const stats = fs.statSync(filepath);
  return { filename: safeName, filepath, size_bytes: stats.size };
}

/**
 * Liste les sauvegardes présentes (manuelles + automatiques), plus récentes en
 * tête. Champ additif `auto` (préfixe auto_) pour le badge côté /admin-db —
 * la forme historique {filename, size, created_at} est conservée.
 */
function listBackups(dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const stats = fs.statSync(path.join(dir, f));
      return {
        filename: f,
        size: `${(stats.size / 1024 / 1024).toFixed(2)} Mo`,
        created_at: stats.mtime,
        auto: f.startsWith(AUTO_PREFIX),
      };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Rétention glissante : conserve les `keep` sauvegardes automatiques les plus
 * récentes et supprime les autres. NE TOUCHE JAMAIS aux sauvegardes manuelles
 * (tout fichier sans le préfixe auto_ est ignoré). Best-effort : un unlink en
 * échec est logué et n'interrompt pas la purge des suivants.
 */
function pruneAutoBackups(keep = AUTO_RETENTION, dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) return { deleted: [] };
  const autos = fs.readdirSync(dir)
    .filter((f) => f.startsWith(AUTO_PREFIX) && f.endsWith('.sql'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime); // plus récentes d'abord
  const deleted = [];
  for (const { f } of autos.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, f));
      deleted.push(f);
    } catch (err) {
      console.error(`[DB-BACKUP] Suppression impossible de ${f} :`, err.message);
    }
  }
  return { deleted };
}

/**
 * Corps du job scheduler `autoDatabaseBackup` : pg_dump préfixé auto_ puis
 * application de la rétention. Journalise aussi l'action dans rgpd_audit_log
 * (user_id NULL = automate) en best-effort — la trace de supervision de
 * référence reste job_runs via runInstrumented. Le retour { items: 1, ... }
 * alimente items_processed du journal des jobs.
 */
async function runAutoBackup(now = new Date()) {
  const { filename, size_bytes } = createBackup(autoBackupFilename(now));
  const pruned = pruneAutoBackups();
  console.log(
    `[DB-BACKUP] Sauvegarde automatique ${filename} (${(size_bytes / 1024 / 1024).toFixed(2)} Mo)` +
    (pruned.deleted.length ? ` — rétention : ${pruned.deleted.length} ancienne(s) auto supprimée(s)` : '')
  );
  try {
    // require paresseux : garde ce module importable sans pool (tests unitaires).
    const pool = require('../config/database');
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [null, 'DB_BACKUP', 'database', 0,
       JSON.stringify({ filename, size_bytes, source: 'auto_scheduler', pruned: pruned.deleted })]
    );
  } catch (err) {
    console.error('[DB-BACKUP] Journalisation rgpd_audit_log impossible :', err.message);
  }
  return { items: 1, filename, size_bytes, pruned: pruned.deleted.length };
}

module.exports = {
  BACKUP_DIR,
  SAFE_BACKUP_NAME,
  AUTO_PREFIX,
  AUTO_RETENTION,
  AUTO_BACKUP_DAYS,
  AUTO_BACKUP_HOUR,
  PARIS_TZ,
  getParisParts,
  buildPgEnv,
  execHint,
  manualBackupFilename,
  autoBackupFilename,
  shouldRunAutoBackup,
  createBackup,
  listBackups,
  pruneAutoBackups,
  runAutoBackup,
};
