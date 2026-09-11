/**
 * Catégorisation d'une absence — RÈGLE UNIQUE, partagée par les deux voies qui
 * écrivent dans `employee_leaves`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE RÈGLE VIT ICI ET NON DANS CHAQUE IMPORTEUR
 *
 * Deux chemins alimentent la même table : l'import du classeur de paie
 * (`collaborator-import.js`) et la synchronisation de l'API Malibou
 * (`malibou-mapping.js`). Ils écrivent la MÊME ligne — la clé naturelle est
 * (salarié, libellé, date de début). Si chacun décidait de la catégorie de son
 * côté, la même absence changerait de nature selon l'import qui a tourné en
 * dernier, et le RÉALISÉ du calcul ETP bougerait tout seul entre deux
 * synchronisations. Une règle recopiée diverge ; une règle extraite ne le peut
 * pas.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CE QUE LA CATÉGORIE DÉCIDE, EXACTEMENT
 *
 * Un seul consommateur : le moteur des effectifs conventionnés (module 32),
 * qui déduit du réalisé les jours ouvrés des absences `sick` et `absence`, et
 * JAMAIS ceux des `holiday`. C'est donc une décision BINAIRE — « ces heures
 * comptent-elles comme travaillées ? » —, la nuance entre `sick` et `absence`
 * ne servant qu'à la restitution.
 *
 * En cas de doute, on déduit. Tenir une absence pour un congé reviendrait à
 * revendiquer devant l'ASP des heures qu'on n'a peut-être pas faites ; la
 * tenir pour une absence nous sous-estime, ce qui ne coûte qu'à nous.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * À ARBITRER (signalé, non tranché ici)
 *
 * « Jour de récupération » et « Jour de repos » sont aujourd'hui comptés comme
 * déduisant, alors qu'ils rémunèrent des heures DÉJÀ travaillées — au même
 * titre que le repos compensateur, qui, lui, ne déduit pas. La règle est
 * conservée telle quelle pour ne modifier aucun chiffre déjà déclaré ; le
 * jour où la direction tranche, c'est la seule ligne à changer.
 */

/** Retire les accents pour comparer sans dépendre de la saisie. */
function sansAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Libellé d'absence → catégorie de `employee_leaves`
 * (`holiday` | `sick` | `absence`).
 *
 * La comparaison porte sur le LIBELLÉ et non sur un code, parce que c'est le
 * libellé que les deux voies partagent : le classeur l'écrit tel quel, et la
 * synchronisation convertit le code de l'API vers le libellé que Malibou
 * publie lui-même. Un type propre à l'organisation, qui n'a pas de libellé
 * connu, tombe donc sur le repli prudent.
 */
function categoriserAbsence(libelle) {
  const s = sansAccents(libelle).toLowerCase();
  if (/conges? paye|rtt|repos compensateur/.test(s)) return 'holiday';
  if (/maladie|enfant malade/.test(s)) return 'sick';
  return 'absence';
}

/** Les seules valeurs que la colonne accepte (CHECK en base). */
const CATEGORIES = Object.freeze(['holiday', 'sick', 'absence']);

/** Cette catégorie déduit-elle du réalisé ETP ? */
function deduitDuRealise(categorie) {
  return categorie === 'sick' || categorie === 'absence';
}

module.exports = { categoriserAbsence, CATEGORIES, deduitDuRealise };
