/**
 * Journal RGPD du module Insertion — une seule implémentation pour tout le
 * module (PR C, contrat 20 § 7).
 *
 * ═══ POURQUOI CE FICHIER ══════════════════════════════════════════════════
 *
 * La PR B avait écrit ces six lignes dans `routes/insertion/rsa.js` ; la PR C
 * en a besoin dans trois surfaces de plus (échéances, lien ETI, documents du
 * salarié). Recopier une fonction de journalisation, c'est accepter qu'un jour
 * l'une des copies cesse d'écrire l'`employee_id` dans ses détails, ou pire,
 * qu'elle avale une erreur là où l'autre la fait remonter. Or c'est exactement
 * la distinction que ce fichier tient, et elle n'est pas cosmétique :
 *
 *   - `journaliser` est TOLÉRANT. Il couvre les consultations d'ÉCRAN INTERNE.
 *     Perdre la trace d'une lecture d'écran est regrettable ; empêcher la CIP
 *     d'ouvrir son tableau de bord parce que le journal est indisponible serait
 *     pire.
 *
 *   - `journaliserDocument` est BLOQUANT. Il couvre tout geste qui FAIT SORTIR
 *     un document (vers le référent unique, vers la personne) ou qui MODIFIE
 *     une obligation contrôlée par l'autorité. Aucun try/catch : l'erreur
 *     remonte au `catch` de la route, qui rend 500 — l'acte n'a pas lieu sans
 *     sa trace (correctifs M-02 et D-06 de la PR B).
 *
 * ═══ CE QUE LA TRACE NE DIT JAMAIS ════════════════════════════════════════
 * Le contenu. La trace dit QUI a produit ou consulté QUEL document, sur QUELLE
 * période. Un journal d'audit qui recopierait le contenu deviendrait une
 * seconde copie de ce qu'il protège — et cette copie-là, personne ne la purge.
 */

'use strict';

/**
 * Écrit une ligne du registre. `db` est un client de transaction OU le pool :
 * c'est l'appelant qui décide si la trace doit vivre dans sa transaction (cas
 * d'un document enregistré : le snapshot et sa trace tombent ou passent
 * ensemble) ou à côté (cas d'une simple consultation).
 *
 * @param {{query: Function}} db pool ou client de transaction
 * @param {object} req requête Express (pour `req.user`)
 * @param {string} action code d'action (doit avoir son libellé français dans
 *   `frontend/src/utils/rgpd-libelles.js` — une garde anti-dérive Jest le vérifie)
 * @param {number|null} employeeId salarié concerné
 * @param {object} details détails NON NOMINATIFS du geste (jamais le contenu)
 * @param {string} entityType type d'entité du registre
 */
async function ecrireJournal(db, req, action, employeeId, details, entityType = 'insertion') {
  const u = (req && req.user) || {};
  // CORRECTIF m-04 — une clé d'API de SERVICE n'a pas d'identifiant utilisateur
  // (`middleware/auth.js` lui donne `id: null`, `username: 'api:<nom>'`) : la
  // trace d'un export tiré par une clé s'écrivait avec `user_id = NULL` et
  // AUCUNE autre identité, donc indiscernable d'une trace orpheline. Ces clés
  // sont exemptées de second facteur et autorisées en lecture : leur usage est
  // précisément ce qu'un journal doit pouvoir nommer. `username` et
  // `is_service` ne sont pas des données personnelles d'un accompagné — ce sont
  // l'identité de l'APPELANT, qui est l'objet même de la trace.
  const identite = u.id == null && u.username
    ? { appelant: String(u.username), is_service: u.is_service === true }
    : {};
  await db.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [
      u.id != null ? u.id : null,
      action,
      entityType,
      employeeId,
      JSON.stringify({ employee_id: employeeId, ...identite, ...(details || {}) }),
    ]
  );
}

/**
 * Fabrique le couple { journaliser, journaliserDocument } d'une surface, avec
 * son `entity_type` et son préfixe de journal serveur.
 *
 * Une fabrique plutôt qu'un paramètre de plus à chaque appel : le type d'entité
 * est une propriété de la SURFACE, pas de l'appel. Le passer à chaque fois,
 * c'est ouvrir la porte à la ligne qui l'oubliera.
 *
 * @param {string} entityType ex. 'insertion_rsa', 'insertion_echeances'
 * @param {string} prefixe préfixe des messages du journal serveur
 */
function journalPour(entityType, prefixe = '[INSERTION]') {
  /** Journal TOLÉRANT — consultations d'écran interne. */
  async function journaliser(pool, req, action, employeeId, details) {
    try {
      await ecrireJournal(pool, req, action, employeeId, details, entityType);
    } catch (e) {
      console.error(`${prefixe} Journalisation ${action} impossible :`, e.message);
    }
  }

  /** Journal BLOQUANT — sortie de document, écriture contrôlée par l'autorité. */
  async function journaliserDocument(db, req, action, employeeId, details) {
    await ecrireJournal(db, req, action, employeeId, details, entityType);
  }

  return { journaliser, journaliserDocument };
}

module.exports = { ecrireJournal, journalPour };
