/**
 * Masquage par rôle des données d'insertion (extension 2026-07 PR1, RGPD —
 * plan 05 §4, EXG-35→44).
 *
 * Règle MANAGER (rôle de base, résolu via resolveBaseRole en amont) :
 *  - frein_judiciaire* TOUJOURS retirés (score, détail, causes — art. 10 RGPD),
 *    dans les diagnostics COMME dans les entretiens (insertion_milestones) ;
 *  - détails santé (SENSITIVE_DIAG_FIELDS de utils/field-crypto : commentaire
 *    santé, détail/causes du frein santé — art. 9) retirés ;
 *  - commentaire_budget retiré ;
 *  - QUESTIONNAIRES FSE+ retirés (correctif de sécurité du 13/09, constat
 *    M-01). `routes/insertion/fse.js` est ADMIN/RH strict et son en-tête dit
 *    pourquoi : le questionnaire d'entrée porte la composition du foyer, la
 *    stabilité du logement et la nature des ressources — des statuts sociaux —
 *    plus un commentaire libre de 2 000 caractères. Cette décision était
 *    intégralement contournable tant que `GET /insertion/diagnostic/:id`
 *    rendait la colonne `fse_entree` telle quelle et que `GET /milestones/:id`
 *    rendait `fse_sortie` avec `im.*`. Le masquage la rend effective partout où
 *    ces colonnes passent.
 *
 * ADMIN/RH voient tout (déchiffrement en couche route). AUTORITE/DPO n'entrent
 * jamais ici (le module insertion est réservé ADMIN/RH/MANAGER).
 *
 * Le masquage RETIRE les clés (delete) plutôt que de les nuller : l'absence de
 * la clé signale au frontend « non habilité » (≠ « non renseigné »).
 */
const { SENSITIVE_DIAG_FIELDS } = require('../../utils/field-crypto');

// Clés supprimées pour un MANAGER, où qu'elles apparaissent (diagnostic,
// entretien, ligne agrégée). Toute clé commençant par 'frein_judiciaire' est
// aussi retirée par le préfixe (couvre score/detail/causes et extensions futures).
const MANAGER_HIDDEN_FIELDS = Array.from(new Set([
  ...SENSITIVE_DIAG_FIELDS,          // commentaire_sante, frein_sante_detail, frein_sante_causes, frein_judiciaire_detail
  'frein_judiciaire',
  'frein_judiciaire_detail',
  'frein_judiciaire_causes',
  'commentaire_budget',
  // Questionnaires FSE+ (art. 30 « Cofinancement FSE+ » : ADMIN/RH strict).
  // `fse_entree_complet` et `fse_entree_saisie_at` partent avec : une date de
  // recueil sans le questionnaire ne sert à rien à l'encadrement, et un
  // pourcentage de complétude dirait combien de réponses ont été données.
  'fse_entree',
  'fse_entree_complet',
  'fse_entree_saisie_at',
  'fse_sortie',
]));

const MANAGER_HIDDEN_PREFIX = 'frein_judiciaire';

/**
 * Champs retirés POUR TOUS LES RÔLES (correctif PR C — constats B-01 de la
 * revue de sécurité et D-02 du debug).
 *
 * `eti_token` n'est pas une donnée du dossier : c'est un IDENTIFIANT DE
 * CONNEXION qui ouvre, sans compte et pendant 60 jours, le formulaire qui
 * fonde un renouvellement de CDDI. Il est arrivé dans les réponses par
 * accident — trois routes font `SELECT im.*` / `SELECT *` / `RETURNING *`,
 * dont une qui sert la cohorte entière — exactement comme le `SELECT e.*` de
 * la 2.43.0 et le `resume_rse` de la 2.44.0. Aucun rôle n'en a besoin dans une
 * liste : son seul point de sortie légitime est le lien DÉRIVÉ que produit
 * `POST /renouvellements/:id/lien-eti`.
 *
 * Le retrait est donc posé AVANT le test de rôle : un masquage réservé au
 * MANAGER laisserait le jeton traverser le réseau pour une CIP, s'inscrire dans
 * l'historique de son navigateur et pouvoir être réexpédié par qui le voit.
 * `eti_token_expires_at` reste : c'est une échéance, pas une clé.
 */
const ALWAYS_HIDDEN_FIELDS = ['eti_token'];

/**
 * Retire les secrets d'une ligne, quel que soit le rôle. Retourne la ligne
 * (mutée). Appelée par `maskInsertionRow`/`maskInsertionRows`, et directement
 * partout où une ligne d'entretien sort sans passer par le masquage (réponses
 * de création, snapshot d'historisation).
 */
function stripSecrets(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of ALWAYS_HIDDEN_FIELDS) {
    if (k in row) delete row[k];
  }
  return row;
}

/**
 * Masque UNE ligne (objet) selon le rôle de base. Retourne l'objet (muté).
 * Ne fait rien pour ADMIN/RH. Tolère null/undefined.
 * @param {object|null} row
 * @param {string} baseRole rôle de BASE (déjà résolu via resolveBaseRole)
 */
function maskInsertionRow(row, baseRole) {
  if (!row || typeof row !== 'object') return row;
  stripSecrets(row);                 // avant le test de rôle — cf. ALWAYS_HIDDEN_FIELDS
  if (baseRole !== 'MANAGER') return row;
  for (const key of Object.keys(row)) {
    if (MANAGER_HIDDEN_FIELDS.includes(key) || key.startsWith(MANAGER_HIDDEN_PREFIX)) {
      delete row[key];
    }
  }
  return row;
}

/** Masque un tableau de lignes (mutation en place, retourne le tableau). */
function maskInsertionRows(rows, baseRole) {
  if (!Array.isArray(rows)) return rows;
  for (const r of rows) maskInsertionRow(r, baseRole);
  return rows;
}

module.exports = { maskInsertionRow, maskInsertionRows, stripSecrets, MANAGER_HIDDEN_FIELDS, ALWAYS_HIDDEN_FIELDS };
