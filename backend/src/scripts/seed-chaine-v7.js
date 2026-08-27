/**
 * seed-chaine-v7.js — Plan de chaîne de tri V7 (15 personnes)
 * ═══════════════════════════════════════════════════════════════════════════
 * Crée le layout de référence du configurateur 2D à partir du plan client
 * versionné dans `src/data/chaine-tri-v7.json` (relevé fidèle de la page 1 du
 * PDF : postes de travail, zones de dépose, entrées, positions relatives).
 *
 * DOCTRINE (pattern 2.26.4 « modèles de tournées ») : le layout est une DONNÉE
 * D'EXPLOITATION, pas une constante de code. Le seed s'exécute UNE fois, puis
 * un VERROU en settings (`tri.chaine_layout_v7_seed`) est posé — un plan
 * supprimé volontairement dans le configurateur ne réapparaît JAMAIS au
 * redémarrage suivant. Le verrou n'est posé qu'APRÈS un résultat acquis
 * (layout créé, ou déjà présent) : jamais d'avance, sinon un plan pourrait
 * n'être seedé nulle part sans que rien ne le signale.
 *
 * Usage CLI (dry-run par défaut, comme seed-route-templates) :
 *   node src/scripts/seed-chaine-v7.js            # simulation, aucune écriture
 *   node src/scripts/seed-chaine-v7.js --apply    # crée le plan V7
 *
 * Usage programmatique (appelé par init-db.js au démarrage) :
 *   const { seedChaineV7 } = require('./seed-chaine-v7');
 *   await seedChaineV7(client);   // client d'une transaction en cours
 */

const path = require('path');

// Clé du verrou anti-réapparition (contrat §1.5).
const SEED_LOCK_KEY = 'tri.chaine_layout_v7_seed';

// Nombre de personnes du plan de référence : lu dans le fichier de données,
// jamais recopié en dur ici (une seule source de vérité).
const PLAN_PATH = path.join(__dirname, '..', 'data', 'chaine-tri-v7.json');

/**
 * Charge et valide le plan versionné. Une donnée de seed incohérente doit
 * échouer BRUYAMMENT ici plutôt que produire un plan à moitié faux à l'écran.
 * @returns {{ layout: object, postes: object[] }}
 */
function chargerPlanV7() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const doc = require(PLAN_PATH);
  if (!doc || !doc.layout || !Array.isArray(doc.postes) || doc.postes.length === 0) {
    throw new Error('chaine-tri-v7.json : structure inattendue (layout + postes attendus)');
  }
  const codes = new Set();
  for (const p of doc.postes) {
    if (!p.code || !p.libelle) throw new Error('chaine-tri-v7.json : bloc sans code ni libellé');
    if (codes.has(p.code)) throw new Error(`chaine-tri-v7.json : code dupliqué « ${p.code} »`);
    codes.add(p.code);
    if (!['poste', 'zone_depose', 'entree'].includes(p.categorie)) {
      throw new Error(`chaine-tri-v7.json : catégorie inconnue « ${p.categorie} » (${p.code})`);
    }
    if (Number(p.effectif_min) > Number(p.effectif_max)) {
      throw new Error(`chaine-tri-v7.json : effectif minimum > maximum (${p.code})`);
    }
  }
  return doc;
}

/**
 * Somme des effectifs maximum des POSTES actifs — l'effectif que mobilise le
 * plan. Les zones de dépose et les entrées ne portent pas d'opérateur.
 */
function effectifTotalPlan(postes) {
  return (postes || [])
    .filter((p) => p.categorie === 'poste' && p.actif !== false)
    .reduce((s, p) => s + (Number(p.effectif_max) || 0), 0);
}

/**
 * Seed idempotent du plan V7.
 *
 * @param {object} client  client PostgreSQL (transaction ouverte par l'appelant)
 * @param {object} [opts]
 * @param {boolean} [opts.apply=true]  false = simulation (aucune écriture)
 * @param {function} [opts.log]        journalisation (défaut : silencieux)
 * @returns {Promise<{ cree: boolean, layout_id: number|null, nb_postes: number,
 *                     effectif_total: number, verrou_pose: boolean, motif: string|null }>}
 */
async function seedChaineV7(client, opts = {}) {
  const apply = opts.apply !== false;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const doc = chargerPlanV7();
  const bilan = {
    cree: false, layout_id: null, nb_postes: doc.postes.length,
    effectif_total: effectifTotalPlan(doc.postes), verrou_pose: false, motif: null,
  };

  // 1) Verrou : le plan a déjà été seedé une fois — on ne repose jamais rien
  //    par-dessus une décision d'exploitation (suppression volontaire comprise).
  const verrou = await client.query('SELECT value FROM settings WHERE key = $1', [SEED_LOCK_KEY]);
  if (verrou.rows.length > 0) {
    bilan.motif = 'verrou déjà posé (plan V7 seedé une fois)';
    log(`Plan V7 : ${bilan.motif} — rien à faire.`);
    return bilan;
  }

  // 2) Le plan est-il déjà en base sans verrou (seed antérieur au verrou, ou
  //    duplication d'une base) ? On ne crée pas de doublon : on pose le verrou.
  const existant = await client.query(
    "SELECT id, nom FROM chaine_layouts WHERE source = 'seed_v7' ORDER BY id LIMIT 1"
  );
  if (existant.rows.length > 0) {
    bilan.layout_id = existant.rows[0].id;
    bilan.motif = `plan V7 déjà présent (layout #${existant.rows[0].id})`;
    if (apply) {
      await client.query(
        `INSERT INTO settings (key, value, category) VALUES ($1::varchar, $2::text, 'tri')
         ON CONFLICT (key) DO NOTHING`,
        [SEED_LOCK_KEY, new Date().toISOString()]
      );
      bilan.verrou_pose = true;
    }
    log(`Plan V7 : ${bilan.motif} — verrou posé, aucune création.`);
    return bilan;
  }

  if (!apply) {
    bilan.motif = 'simulation : le plan V7 serait créé';
    log(`Plan V7 : ${bilan.nb_postes} bloc(s) à créer, effectif total ${bilan.effectif_total} `
      + `(SIMULATION — relancer avec --apply).`);
    return bilan;
  }

  // 3) Création. Le plan devient ACTIF seulement si aucun autre ne l'est déjà :
  //    l'index unique partiel de la base interdit deux layouts actifs, et un
  //    plan choisi par l'atelier ne doit pas être détrôné par un redémarrage.
  const actif = await client.query('SELECT id FROM chaine_layouts WHERE is_actif = true LIMIT 1');
  const doitEtreActif = actif.rows.length === 0;

  const ins = await client.query(
    `INSERT INTO chaine_layouts (nom, description, effectif_max, source, is_actif)
     VALUES ($1, $2, $3, 'seed_v7', $4) RETURNING id`,
    [doc.layout.nom, doc.layout.description || null,
      doc.layout.effectif_max == null ? null : Number(doc.layout.effectif_max), doitEtreActif]
  );
  const layoutId = ins.rows[0].id;

  for (const p of doc.postes) {
    await client.query(
      `INSERT INTO chaine_layout_postes
         (layout_id, code, libelle, categorie, x, y, largeur, hauteur,
          obligatoire, actif, effectif_min, effectif_max, poste_operation_id, proprietes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13)`,
      [
        layoutId, p.code, p.libelle, p.categorie,
        Number(p.x) || 0, Number(p.y) || 0,
        p.largeur == null ? null : Number(p.largeur),
        p.hauteur == null ? null : Number(p.hauteur),
        p.obligatoire === true, p.actif !== false,
        Number(p.effectif_min) || 0, Number(p.effectif_max) || 0,
        p.proprietes ? JSON.stringify(p.proprietes) : null,
      ]
    );
  }

  await client.query(
    `INSERT INTO settings (key, value, category) VALUES ($1::varchar, $2::text, 'tri')
     ON CONFLICT (key) DO NOTHING`,
    [SEED_LOCK_KEY, new Date().toISOString()]
  );

  bilan.cree = true;
  bilan.layout_id = layoutId;
  bilan.verrou_pose = true;
  bilan.motif = doitEtreActif ? 'créé et activé' : 'créé (un autre plan reste actif)';
  log(`Plan V7 : layout #${layoutId} ${bilan.motif}, ${bilan.nb_postes} bloc(s), `
    + `effectif total ${bilan.effectif_total} — verrou posé.`);
  return bilan;
}

async function main() {
  const apply = process.argv.includes('--apply');
  // eslint-disable-next-line global-require
  const pool = require('../config/database');
  const client = await pool.connect();
  try {
    if (!apply) console.log('MODE SIMULATION (aucune écriture) — relancer avec --apply pour créer.\n');
    await client.query('BEGIN');
    const bilan = await seedChaineV7(client, { apply, log: (m) => console.log(`  ${m}`) });
    if (apply) await client.query('COMMIT'); else await client.query('ROLLBACK');
    console.log(`\nBilan : ${bilan.cree ? 'plan créé' : 'aucune création'}`
      + `${bilan.layout_id ? ` (layout #${bilan.layout_id})` : ''}`
      + ` — ${bilan.nb_postes} bloc(s), effectif total ${bilan.effectif_total}`
      + `${bilan.motif ? ` — ${bilan.motif}` : ''}.`);
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR seed plan de chaîne V7 :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

module.exports = { seedChaineV7, chargerPlanV7, effectifTotalPlan, SEED_LOCK_KEY };

if (require.main === module) {
  main();
}
