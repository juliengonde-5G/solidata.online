// ══════════════════════════════════════════════════════════════════════════
// SÉLECTION DES BORNES À COLLECTER — 4 facteurs hiérarchisés
// ══════════════════════════════════════════════════════════════════════════
//
// Module PUR : aucune base, aucun réseau. Les données lui sont fournies.
//
// HIÉRARCHIE ACTÉE AVEC LE CLIENT (août 2026), du plus au moins déterminant :
//   1. REMPLISSAGE — une borne pleine déborde sur le trottoir ; c'est le motif
//      premier d'une collecte, et il inclut l'accumulation (jours écoulés
//      depuis le dernier passage, nombre de conteneurs du site).
//   2. TEMPS — le budget de 6 h de travail est la contrainte réelle de la
//      journée. Une borne longue à servir coûte des minutes qu'une autre
//      borne n'aura pas.
//   3. DISTANCE — les kilomètres pour aller la chercher.
//   4. ÉMISSIONS — dernier facteur, jamais le premier.
//
// POURQUOI ÉMISSIONS ET DISTANCE NE FONT PAS DOUBLON
// Le CO2 d'un trajet est proportionnel à sa distance POUR UN VÉHICULE DONNÉ.
// Le facteur d'émissions n'est donc pas un second critère de distance : il
// module le poids de la distance selon la consommation RÉELLE du véhicule
// affecté. Sur un parc hétérogène, le même détour pèse plus lourd avec le
// véhicule le plus gourmand — et c'est exactement ce qu'on veut arbitrer.
//
// DOCTRINE : si la consommation du véhicule n'est pas mesurée, le terme
// d'émissions est simplement ABSENT du score (et non estimé). Il l'est alors
// pour toutes les bornes de la même tournée : le classement reste cohérent,
// et aucun chiffre n'est inventé.

/**
 * Pondérations par défaut.
 *
 * Le poids du remplissage DOIT dépasser la somme des trois autres : sans quoi
 * temps, distance et émissions coalisés renverseraient le critère premier, et
 * la hiérarchie ne serait qu'une intention documentée. C'est une propriété
 * vérifiée par les tests, pas une simple convention d'écriture.
 */
const POIDS_DEFAUT = {
  remplissage: 1.0,
  temps: 0.35,
  distance: 0.15,
  emissions: 0.05,
};

/** Échelles de normalisation par défaut. */
const ECHELLE_DEFAUT = {
  detourKm: 15,      // au-delà, le critère distance est saturé
  serviceMin: 20,    // au-delà, le critère temps est saturé
};

/** Borne une valeur dans [0, 1]. */
function borne01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Note de remplissage sur [0, 1], accumulation comprise.
 *
 * Reprend les paliers historiques (100 / 80 / 60 / 40 %) qui traduisent le
 * risque de débordement, et y ajoute l'ancienneté du dernier passage et la
 * taille du site — deux signaux d'accumulation, pas des critères distincts.
 */
function noteRemplissage({ fillPct, daysSince = 0, nbContainers = 1 }, opts = {}) {
  const fill = parseFloat(fillPct);
  let base;
  if (!Number.isFinite(fill)) base = 0.04;          // remplissage inconnu : quasi nul
  else if (fill >= 100) base = 1;
  else if (fill >= 80) base = 0.7;
  else if (fill >= 60) base = 0.4;
  else if (fill >= 40) base = 0.2;
  else base = 0.04;

  const jours = Math.max(0, parseFloat(daysSince) || 0);
  const conteneurs = Math.max(1, parseInt(nbContainers, 10) || 1);
  const echelleJours = parseFloat(opts.echelleJours) || 21;   // 3 semaines
  const echelleConteneurs = parseFloat(opts.echelleConteneurs) || 4;

  // L'accumulation ne peut que renforcer le signal, jamais l'inverser : elle
  // s'ajoute au palier sans le remplacer, et le total reste borné à 1.
  const accumulation = 0.3 * borne01(jours / echelleJours)
    + 0.15 * borne01((conteneurs - 1) / (echelleConteneurs - 1));
  return borne01(base + accumulation * (1 - base));
}

/** Note de temps sur [0, 1] : plus la borne est rapide à servir, mieux c'est. */
function noteTemps({ serviceMinutes }, echelle = ECHELLE_DEFAUT.serviceMin) {
  const min = parseFloat(serviceMinutes);
  if (!Number.isFinite(min) || min < 0) return 0.5; // temps inconnu : neutre
  return 1 - borne01(min / (parseFloat(echelle) || ECHELLE_DEFAUT.serviceMin));
}

/** Note de distance sur [0, 1] : plus la borne est proche, mieux c'est. */
function noteDistance({ detourKm }, echelle = ECHELLE_DEFAUT.detourKm) {
  const km = parseFloat(detourKm);
  if (!Number.isFinite(km) || km < 0) return 0.5; // distance inconnue : neutre
  return 1 - borne01(km / (parseFloat(echelle) || ECHELLE_DEFAUT.detourKm));
}

/**
 * Note d'émissions sur [0, 1], ou `null` si non calculable.
 * @param {number} detourKm
 * @param {{litresPer100km, kgCo2eParLitre}} carburant valeurs MESURÉES
 * @param {number} echelleKm échelle de distance (le CO2 est proportionnel)
 */
function noteEmissions({ detourKm }, carburant = {}, echelleKm = ECHELLE_DEFAUT.detourKm) {
  const conso = parseFloat(carburant.litresPer100km);
  const facteur = parseFloat(carburant.kgCo2eParLitre);
  if (!(conso > 0) || !(facteur > 0)) return null; // jamais estimé
  const km = parseFloat(detourKm);
  if (!Number.isFinite(km) || km < 0) return null;
  const co2 = (km / 100) * conso * facteur;
  const co2Echelle = ((parseFloat(echelleKm) || ECHELLE_DEFAUT.detourKm) / 100) * conso * facteur;
  if (!(co2Echelle > 0)) return null;
  return 1 - borne01(co2 / co2Echelle);
}

/**
 * Score de sélection d'une borne, dans [0, 1] après normalisation par la
 * somme des poids RÉELLEMENT appliqués (le terme d'émissions absent ne
 * pénalise donc personne).
 *
 * @param {object} cav { fillPct, daysSince, nbContainers, confidence,
 *                       serviceMinutes, detourKm }
 * @param {object} opts { poids, echelles, carburant }
 * @returns {{score:number, detail:object, emissionsPrisesEnCompte:boolean}}
 */
function scoreSelection(cav, opts = {}) {
  const poids = { ...POIDS_DEFAUT, ...(opts.poids || {}) };
  const echelles = { ...ECHELLE_DEFAUT, ...(opts.echelles || {}) };

  const detail = {
    remplissage: noteRemplissage(cav, opts),
    temps: noteTemps(cav, echelles.serviceMin),
    distance: noteDistance(cav, echelles.detourKm),
    emissions: noteEmissions(cav, opts.carburant, echelles.detourKm),
  };

  let somme = 0;
  let sommePoids = 0;
  ['remplissage', 'temps', 'distance', 'emissions'].forEach((cle) => {
    const note = detail[cle];
    if (note === null) return; // critère non calculable : ignoré, pas estimé
    const p = parseFloat(poids[cle]);
    if (!Number.isFinite(p) || p <= 0) return;
    somme += p * note;
    sommePoids += p;
  });

  // La confiance de la prédiction module le score : une borne dont le
  // remplissage est mal connu ne doit pas passer devant une certitude.
  const confiance = Number.isFinite(parseFloat(cav.confidence))
    ? borne01(parseFloat(cav.confidence)) : 1;

  return {
    score: sommePoids > 0 ? Math.round((somme / sommePoids) * confiance * 10000) / 10000 : 0,
    detail,
    emissionsPrisesEnCompte: detail.emissions !== null,
  };
}

module.exports = {
  scoreSelection, noteRemplissage, noteTemps, noteDistance, noteEmissions,
  borne01, POIDS_DEFAUT, ECHELLE_DEFAUT,
};
