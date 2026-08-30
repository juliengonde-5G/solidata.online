#!/usr/bin/env node
/**
 * CLÉ D'API DE SERVICE — création, inventaire, révocation
 * ─────────────────────────────────────────────────────────────────────────────
 * Remplace le COMPTE ADMIN de service (identifiant + mot de passe + secret TOTP
 * rangés côte à côte dans le `.env` du serveur) qu'utilisait jusqu'ici le test
 * post-déploiement `scripts/tests/api-smoke.js`.
 *
 * Ce qu'une clé de service peut : les mêmes LECTURES que le rôle qu'elle porte.
 * Ce qu'elle ne peut pas : écrire quoi que ce soit — la garde est posée dans
 * `authenticate` (middleware/auth.js), donc sur toute route de l'application.
 *
 * La clé en clair n'existe qu'ICI, une seule fois : la base n'en garde que le
 * hash SHA-256. Perdue, elle se remplace (on en crée une autre et on révoque
 * l'ancienne) — elle ne se retrouve pas.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/creer-cle-api.js                       # inventaire (aucune écriture)
 *   node src/scripts/creer-cle-api.js --apply               # crée la clé du smoke test
 *   node src/scripts/creer-cle-api.js --nom="Supervision" --role=MANAGER --apply
 *   node src/scripts/creer-cle-api.js --expire=2027-12-31 --apply
 *   node src/scripts/creer-cle-api.js --revoquer=ab12cd34ef56   # désactive (préfixe ou id)
 *
 * Idempotent : si une clé de service ACTIVE porte déjà le même nom, le script
 * ne fabrique pas de doublon — il le dit et indique quoi faire.
 */

const pool = require('../config/database');
const { generateKey, SERVICE_SCOPE } = require('../middleware/api-key');
const { isValidRole } = require('../utils/roles');

const args = process.argv.slice(2);
const flag = (nom, defaut = null) => {
  const p = args.find((a) => a.startsWith(`--${nom}=`));
  return p ? p.slice(nom.length + 3) : defaut;
};
const APPLY = args.includes('--apply');
const NOM = flag('nom', 'Smoke test de déploiement');
const ROLE = flag('role', 'ADMIN');
const EXPIRE = flag('expire', null);
const REVOQUER = flag('revoquer', null);
// Autorise une SECONDE clé active du même nom (rotation avec recouvrement).
const FORCE = args.includes('--force');

async function inventaire() {
  const r = await pool.query(
    `SELECT id, name, key_prefix, service_role, scopes, active, expires_at, last_used_at
       FROM api_keys ORDER BY created_at DESC`
  );
  if (r.rows.length === 0) {
    console.log('Aucune clé d\'API enregistrée.');
    return;
  }
  console.log(`\nClés d'API enregistrées (${r.rows.length}) :`);
  for (const k of r.rows) {
    const type = k.service_role ? `service → rôle ${k.service_role}` : 'partenaire (API publique)';
    const etat = !k.active ? 'DÉSACTIVÉE'
      : (k.expires_at && new Date(k.expires_at) < new Date()) ? 'EXPIRÉE' : 'active';
    console.log(`  • [${k.id}] ${k.name} — préfixe ${k.key_prefix} — ${type} — ${etat}`
      + `${k.expires_at ? ` — expire le ${new Date(k.expires_at).toISOString().slice(0, 10)}` : ''}`
      + `${k.last_used_at ? ` — dernier usage ${new Date(k.last_used_at).toISOString().slice(0, 16).replace('T', ' ')}` : ' — jamais utilisée'}`);
  }
}

async function revoquer(cible) {
  const parId = /^\d+$/.test(cible);
  const r = await pool.query(
    `UPDATE api_keys SET active = false
      WHERE ${parId ? 'id = $1' : 'key_prefix = $1'}
      RETURNING id, name, key_prefix`,
    [parId ? parseInt(cible, 10) : cible]
  );
  if (r.rows.length === 0) {
    console.error(`Aucune clé ne correspond à « ${cible} ».`);
    process.exitCode = 1;
    return;
  }
  // La révocation est IMMÉDIATE : contrairement à un jeton JWT, aucune clé ne
  // survit à sa désactivation (elle est relue en base à chaque requête).
  console.log(`Clé « ${r.rows[0].name} » (préfixe ${r.rows[0].key_prefix}) désactivée. Effet immédiat.`);
}

/**
 * Clé de service ACTIVE portant déjà ce nom, s'il y en a une.
 * Idempotence : relancer le script au déploiement suivant ne doit pas semer une
 * deuxième clé pour le même usage — on ne saurait plus laquelle est en service,
 * et révoquer « la » clé du smoke test deviendrait ambigu.
 */
async function cleExistante(nom) {
  const r = await pool.query(
    `SELECT id, name, key_prefix, service_role, expires_at, last_used_at
       FROM api_keys
      WHERE name = $1 AND active = true AND service_role IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC LIMIT 1`,
    [nom]
  );
  return r.rows[0] || null;
}

async function creer() {
  if (!(await isValidRole(ROLE))) {
    console.error(`Rôle inconnu : ${ROLE}. Utilisez un rôle existant de l'application.`);
    process.exitCode = 1;
    return;
  }
  if (EXPIRE && Number.isNaN(Date.parse(EXPIRE))) {
    console.error(`Date d'expiration illisible : ${EXPIRE} (format attendu : AAAA-MM-JJ).`);
    process.exitCode = 1;
    return;
  }
  const deja = await cleExistante(NOM);
  if (deja && !FORCE) {
    console.log(`\nUne clé de service ACTIVE porte déjà ce nom : « ${NOM} » (préfixe ${deja.key_prefix}, rôle ${deja.service_role}).`);
    console.log('  Sa valeur en clair n\'existe plus (la base n\'en garde que le hash) : elle ne peut pas être réaffichée.');
    console.log('  • Si le .env du serveur la contient déjà, il n\'y a rien à faire.');
    console.log('  • Si elle est perdue, remplacez-la :');
    console.log(`      node src/scripts/creer-cle-api.js --revoquer=${deja.key_prefix}`);
    console.log(`      node src/scripts/creer-cle-api.js --apply\n`);
    console.log('  (ou --force pour en créer une seconde en connaissance de cause)');
    return;
  }

  if (!APPLY) {
    console.log('\n── SIMULATION (aucune écriture) ─────────────────────────────');
    console.log(`  Nom      : ${NOM}`);
    console.log(`  Rôle     : ${ROLE}   (lecture seule — aucune écriture possible)`);
    console.log(`  Scope    : ${SERVICE_SCOPE}`);
    console.log(`  Expire   : ${EXPIRE || 'jamais (recommandé : poser une échéance)'}`);
    console.log('\n  Relancez avec --apply pour créer réellement la clé.');
    return;
  }
  const gen = generateKey();
  const r = await pool.query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, scopes, service_role, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, key_prefix, service_role, expires_at`,
    [NOM, gen.prefix, gen.hash, [SERVICE_SCOPE], ROLE, EXPIRE || null]
  );
  const k = r.rows[0];
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log("║  CLÉ D'API DE SERVICE CRÉÉE                                  ║");
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Nom     : ${k.name}`);
  console.log(`  Rôle    : ${k.service_role} (LECTURE SEULE)`);
  console.log(`  Préfixe : ${k.key_prefix}`);
  console.log(`  Expire  : ${k.expires_at ? new Date(k.expires_at).toISOString().slice(0, 10) : 'jamais'}`);
  console.log('\n  Clé (affichée UNE SEULE FOIS, la base n\'en garde que le hash) :\n');
  console.log(`      ${gen.full}\n`);
  console.log('  À reporter dans le .env du serveur :\n');
  console.log(`      SMOKE_API_KEY=${gen.full}\n`);
  console.log('  Puis retirer API_USER, API_PASSWORD et API_TOTP_SECRET du .env,');
  console.log('  et supprimer (ou désactiver) le compte ADMIN de service.');
  console.log(`  Révocation : node src/scripts/creer-cle-api.js --revoquer=${k.key_prefix}\n`);
}

(async () => {
  try {
    if (REVOQUER) await revoquer(REVOQUER);
    else if (APPLY || flag('nom') || flag('role') || flag('expire')) await creer();
    else { await inventaire(); await creer(); }
  } catch (err) {
    console.error('Échec :', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
