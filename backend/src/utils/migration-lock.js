/**
 * VERROU DE MIGRATION — une seule initialisation de schéma à la fois.
 *
 * LE DÉFAUT QUE CE MODULE FERME (déploiement du 4 septembre 2026,
 * « [INIT-DB] ERREUR : deadlock detected », mise à jour annulée).
 *
 * `deploy.sh update` relance les conteneurs, puis lance `init-db.js` cinq
 * secondes plus tard. Or le backend qui vient de redémarrer applique LUI AUSSI
 * ses migrations au démarrage (`initOnStartup` : colonnes de `tours`, module
 * Exutoires, Finance, capteurs, tables association…). Deux séries de DDL
 * tournaient donc EN MÊME TEMPS sur les mêmes tables :
 *
 *   init-db  : une SEULE transaction qui pose un verrou exclusif sur chaque
 *              table qu'elle modifie, et les garde jusqu'au COMMIT ;
 *   démarrage: des instructions séparées, dans un autre ordre.
 *
 * Deux transactions, des verrous pris dans des ordres opposés : PostgreSQL
 * détecte le cycle et en tue une. C'est init-db qui a perdu — et comme tout
 * son travail tient dans une transaction, le déploiement s'est arrêté net.
 *
 * Cinq secondes d'attente ne pouvaient pas régler cela : ce n'est pas une
 * question de délai mais d'exclusion. Les deux chemins prennent désormais LE
 * MÊME verrou consultatif : celui qui arrive second attend son tour, au lieu
 * de se battre pour les mêmes tables.
 *
 * POURQUOI UN VERROU CONSULTATIF PostgreSQL, et pas un fichier ou une table :
 * il est tenu par la SESSION, donc PostgreSQL le libère tout seul si le
 * processus meurt ou si le conteneur est tué en plein vol. Aucun verrou
 * fantôme ne peut survivre à un incident — un verrou de migration qui reste
 * coincé bloquerait tous les déploiements suivants.
 */
const pool = require('../config/database');

/**
 * Clé du verrou. Arbitraire mais FIGÉE : elle doit être la même dans tous les
 * chemins qui modifient le schéma, sans quoi ils ne s'excluent plus.
 */
const CLE_VERROU_MIGRATION = 776432901;

/** Codes PostgreSQL des échecs de concurrence, rejouables tels quels. */
const CODES_CONCURRENCE = new Set([
  '40P01', // deadlock_detected
  '40001', // serialization_failure
]);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exécute `fn` en étant SEUL à toucher au schéma.
 *
 * @param {Function} fn travail à exécuter sous verrou
 * @param {object} [options]
 * @param {string} [options.libelle] ce qui attend (affiché dans les logs)
 * @param {number} [options.attenteMaxMs] au-delà, on échoue en le DISANT
 * @param {object} [options.pool] pool injectable (tests)
 * @param {object} [options.journal] console injectable (tests)
 */
async function avecVerrouMigration(fn, options = {}) {
  const {
    libelle = 'migrations',
    attenteMaxMs = 15 * 60 * 1000,
    pool: poolInjecte = pool,
    journal = console,
  } = options;

  const client = await poolInjecte.connect();
  let tenu = false;
  try {
    const debut = Date.now();
    let prochainRappel = debut + 10000;
    for (;;) {
      const r = await client.query('SELECT pg_try_advisory_lock($1) AS obtenu', [CLE_VERROU_MIGRATION]);
      if (r.rows[0] && r.rows[0].obtenu) { tenu = true; break; }

      const attendu = Date.now() - debut;
      if (attendu > attenteMaxMs) {
        // On ne force JAMAIS le passage : deux migrations simultanées sont
        // exactement ce qu'on cherche à empêcher. On échoue en nommant la cause.
        throw new Error(
          `Verrou de migration indisponible après ${Math.round(attendu / 1000)} s — `
          + 'une autre initialisation du schéma est en cours (autre déploiement, '
          + 'ou démarrage de conteneur). Réessayer une fois qu\'elle est terminée.'
        );
      }
      if (Date.now() >= prochainRappel) {
        // Un opérateur qui regarde le déploiement doit comprendre l'attente,
        // et ne pas la prendre pour un blocage.
        journal.log(`[MIGRATIONS] ${libelle} : en attente du verrou (${Math.round(attendu / 1000)} s) — une autre migration est en cours.`);
        prochainRappel = Date.now() + 10000;
      }
      await pause(500);
    }

    return await fn();
  } finally {
    if (tenu) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [CLE_VERROU_MIGRATION]);
      } catch (err) {
        // Sans conséquence : la fin de session libère le verrou de toute façon.
        journal.warn(`[MIGRATIONS] Libération du verrou impossible (sans conséquence) : ${err.message}`);
      }
    }
    client.release();
  }
}

/**
 * Rejoue `fn` quand PostgreSQL l'a interrompue pour cause de CONCURRENCE
 * (interblocage, échec de sérialisation) — et seulement dans ce cas.
 *
 * Le verrou ci-dessus exclut l'autre migration ; ce filet couvre le reste du
 * trafic (jobs planifiés, requêtes applicatives) qui touche les mêmes tables.
 * Rejouer est sûr : l'initialisation est idempotente par construction, et une
 * transaction tuée par un interblocage a été intégralement annulée.
 *
 * Toute autre erreur remonte IMMÉDIATEMENT : une colonne manquante ou un SQL
 * fautif ne se répare pas en réessayant, et le déploiement doit s'arrêter.
 */
async function avecReprisesSurConcurrence(fn, options = {}) {
  const { tentatives = 3, pauseMs = 2000, journal = console, libelle = 'migrations' } = options;
  let derniere;
  for (let essai = 1; essai <= tentatives; essai += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!CODES_CONCURRENCE.has(err && err.code)) throw err;
      derniere = err;
      if (essai < tentatives) {
        journal.warn(
          `[MIGRATIONS] ${libelle} : interrompue par un conflit d'accès concurrent `
          + `(${err.code}) — nouvelle tentative ${essai + 1}/${tentatives}.`
        );
        await pause(pauseMs);
      }
    }
  }
  throw derniere;
}

module.exports = {
  CLE_VERROU_MIGRATION,
  CODES_CONCURRENCE,
  avecVerrouMigration,
  avecReprisesSurConcurrence,
};
