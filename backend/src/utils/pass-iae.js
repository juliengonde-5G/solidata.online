/**
 * Statut du Pass IAE — module PUR (aucune E/S, aucune dépendance).
 *
 * POURQUOI un module à part plutôt qu'un `CASE` en SQL ou trois `if` dans la
 * route : le statut est LU partout (badge d'en-tête de fiche, dossier de
 * conformité, alertes d'échéance, exports) et ÉCRIT à trois endroits
 * différents (mise à jour du dossier administratif, ajout d'un événement,
 * suppression d'un événement). Recopié, il finirait par diverger — c'est
 * exactement la classe de défaut corrigée ailleurs dans le dépôt (table des
 * paliers de remplissage, libellés d'incidents, registre des freins).
 *
 * Le statut n'est JAMAIS saisi à la main : il se déduit des dates du Pass et
 * de ses événements (suspension, prolongation). La colonne
 * `employees.pass_iae_statut` n'est qu'un cache de cette fonction, recalculé à
 * chaque écriture, pour que les listes et les filtres n'aient pas à rejouer le
 * raisonnement ligne par ligne.
 *
 * Règles (contrat PR A § 6.1), appliquées DANS CET ORDRE :
 *   1. pas de numéro de Pass                      → `inconnu`
 *   2. date de fin dépassée                       → `expire`
 *   3. une suspension couvre le jour courant      → `suspendu`
 *   4. une prolongation existe et le Pass court   → `prolonge`
 *   5. sinon                                      → `actif`
 *
 * L'ordre est load-bearing : un Pass expiré dont une suspension traîne reste
 * EXPIRÉ (l'échéance prime sur la suspension — c'est l'échéance qui commande
 * la demande de prolongation) ; et une suspension en cours prime sur une
 * prolongation passée (la personne n'est pas en parcours aujourd'hui).
 *
 * Aucune valeur inventée : une date absente n'est jamais interprétée comme
 * « aujourd'hui » ou « jamais » — elle laisse simplement sa règle sans effet.
 */

'use strict';

/** Les 5 valeurs possibles de `employees.pass_iae_statut`. */
const PASS_IAE_STATUTS = ['actif', 'suspendu', 'prolonge', 'expire', 'inconnu'];

/** Libellés d'écran (le serveur ne renvoie que le code ; le front les reprend). */
const PASS_IAE_STATUT_LABELS = {
  actif: 'Actif',
  suspendu: 'Suspendu',
  prolonge: 'Prolongé',
  expire: 'Expiré',
  inconnu: 'Inconnu',
};

/** Types d'événements portés par `insertion_pass_iae_evenements.type`. */
const PASS_IAE_EVENEMENT_TYPES = ['suspension', 'prolongation', 'autre'];

/**
 * Normalise une date (Date | 'AAAA-MM-JJ' | ISO) en jour civil « AAAA-MM-JJ ».
 * Les comparaisons se font sur la CHAÎNE : elles sont exactes, indépendantes du
 * fuseau du conteneur (qui tourne en UTC alors que la structure vit à Paris) et
 * insensibles à l'heure — un Pass qui finit « le 14/03 » court tout le 14/03.
 * @param {*} v
 * @returns {string|null} jour civil, ou null si la valeur est absente/illisible
 */
function jour(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Les colonnes DATE de pg reviennent en Date à minuit LOCAL : on relit les
    // composantes locales, pas l'ISO (qui décalerait d'un jour à l'est de UTC).
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${v.getFullYear()}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Un événement couvre-t-il le jour `today` ?
 * Une date de fin ABSENTE vaut « toujours en cours » : c'est le cas réel d'une
 * suspension ouverte dont la reprise n'est pas encore connue. La traiter comme
 * « terminée » afficherait « actif » une personne dont le Pass est suspendu —
 * l'erreur coûteuse est dans ce sens-là.
 */
function couvre(ev, today) {
  const debut = jour(ev && ev.date_debut);
  if (!debut || debut > today) return false;
  const fin = jour(ev && ev.date_fin);
  return fin == null || fin >= today;
}

/**
 * Calcule le statut du Pass IAE.
 *
 * @param {object} p
 * @param {string|null} p.numero      numéro de Pass (`employees.pass_iae_number`)
 * @param {*} [p.debut]               date de début (non utilisée par les règles,
 *                                    acceptée pour que l'appelant passe le Pass entier)
 * @param {*} [p.fin]                 date de fin (`pass_iae_end`)
 * @param {Array<object>} [p.evenements] lignes `insertion_pass_iae_evenements`
 * @param {*} [p.today]               jour de référence (défaut : aujourd'hui)
 * @returns {'actif'|'suspendu'|'prolonge'|'expire'|'inconnu'}
 */
function calculerStatutPassIae({ numero, debut, fin, evenements, today } = {}) {
  // 1. Sans numéro, il n'y a pas de Pass à qualifier — et surtout aucune alerte
  //    d'échéance calculable. On le DIT (« inconnu ») plutôt que de supposer.
  const num = numero == null ? '' : String(numero).trim();
  if (!num) return 'inconnu';

  const jToday = jour(today) || jour(new Date());
  const evs = Array.isArray(evenements) ? evenements : [];

  // 2. Échéance dépassée : prime sur tout le reste (c'est elle qui commande la
  //    demande de prolongation). Une fin absente ne fait jamais « expirer ».
  const jFin = jour(fin);
  if (jFin && jFin < jToday) return 'expire';

  // 3. Suspension couvrant aujourd'hui : la personne n'est pas en parcours.
  if (evs.some((e) => e && e.type === 'suspension' && couvre(e, jToday))) return 'suspendu';

  // 4. Prolongation enregistrée et Pass encore valide (ou sans fin connue).
  if (evs.some((e) => e && e.type === 'prolongation')) return 'prolonge';

  // 5. Rien de particulier : le Pass court.
  //    NB : `debut` n'entre dans aucune règle — un Pass dont le début est
  //    postérieur à aujourd'hui reste « actif » (il a été délivré, il n'est ni
  //    suspendu ni expiré) ; inventer un statut « à venir » ajouterait une
  //    valeur que ni l'écran ni les Emplois de l'inclusion ne connaissent.
  void debut;
  return 'actif';
}

module.exports = {
  calculerStatutPassIae,
  PASS_IAE_STATUTS,
  PASS_IAE_STATUT_LABELS,
  PASS_IAE_EVENEMENT_TYPES,
  // exportés pour les tests et les appelants qui comparent des jours civils
  jourCivil: jour,
};
