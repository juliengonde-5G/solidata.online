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
 * Masque UNE ligne (objet) selon le rôle de base. Retourne l'objet (muté).
 * Ne fait rien pour ADMIN/RH. Tolère null/undefined.
 * @param {object|null} row
 * @param {string} baseRole rôle de BASE (déjà résolu via resolveBaseRole)
 */
function maskInsertionRow(row, baseRole) {
  if (!row || typeof row !== 'object') return row;
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
  if (!Array.isArray(rows) || baseRole !== 'MANAGER') return rows;
  for (const r of rows) maskInsertionRow(r, baseRole);
  return rows;
}

module.exports = { maskInsertionRow, maskInsertionRows, MANAGER_HIDDEN_FIELDS };
