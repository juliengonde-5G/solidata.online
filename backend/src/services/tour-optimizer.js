// ══════════════════════════════════════════════════════════════════════════
// MOTEUR D'OPTIMISATION DE TOURNÉE — CO2 & EFFICACITÉ
// ══════════════════════════════════════════════════════════════════════════
//
// Module PUR : aucune base, aucun réseau, aucune horloge. Les distances et
// durées lui sont FOURNIES sous forme de matrice, ce qui le rend testable et
// indépendant du fournisseur de routage (OSRM, TomTom, cache).
//
// OBJECTIF — le client demande « optimisation CO2 ET efficacité de collecte ».
// Ce sont deux grandeurs différentes :
//   • le CO2 d'un trajet est proportionnel à la DISTANCE (litres brûlés par
//     kilomètre × facteur d'émission du carburant) ;
//   • l'efficacité de collecte, elle, se mesure en TEMPS — c'est le budget de
//     6 h de travail qui contraint la journée, pas les kilomètres.
// Optimiser l'un ne donne pas toujours l'autre : contourner un bouchon
// rallonge la distance (donc le CO2) mais raccourcit la journée. Le moteur
// expose donc trois objectifs — `distance` (CO2 pur), `duree` (efficacité
// pure) et `mixte` (défaut, pondération paramétrable) — et rapporte TOUJOURS
// les deux gains plus le CO2, pour que l'arbitrage reste lisible.
//
// MÉTHODE : amélioration locale déterministe (2-opt puis Or-opt) à partir de
// la séquence existante. Déterministe = deux exécutions sur les mêmes données
// donnent le même ordre, condition d'un test reproductible et d'une décision
// explicable au chauffeur.

/** Objectifs supportés. */
const OBJECTIFS = ['distance', 'duree', 'mixte'];

/** Pondérations par défaut de l'objectif « mixte » (somme = 1). */
const POIDS_DEFAUT = { distance: 0.5, duree: 0.5 };

/** Bornes de sécurité de l'amélioration locale (tournées ≤ 80 points). */
const MAX_PASSES = 12;
/** Longueur maximale d'un segment déplacé par Or-opt. */
const OR_OPT_MAX = 3;

// ── CO2 ───────────────────────────────────────────────────────────────────

/**
 * CO2 d'un trajet, en kilogrammes.
 *
 * DOCTRINE « jamais de valeur inventée » : sans consommation réelle du
 * véhicule OU sans facteur d'émission du carburant, on renvoie `null`. Un
 * « 0 kg » serait lu comme « trajet propre », ce qui est faux ; « non
 * calculable » est la seule réponse honnête.
 *
 * @param {number} km             distance parcourue
 * @param {number} litresPer100km consommation MESURÉE du véhicule (pleins)
 * @param {number} kgCo2eParLitre facteur d'émission du carburant (ADEME)
 * @returns {number|null} kg de CO2e, arrondi au gramme
 */
function co2Kg(km, litresPer100km, kgCo2eParLitre) {
  const d = Number(km);
  const conso = Number(litresPer100km);
  const facteur = Number(kgCo2eParLitre);
  if (!Number.isFinite(d) || d < 0) return null;
  if (!Number.isFinite(conso) || conso <= 0) return null;
  if (!Number.isFinite(facteur) || facteur <= 0) return null;
  return Math.round((d / 100) * conso * facteur * 1000) / 1000;
}

// ── Matrice ───────────────────────────────────────────────────────────────

/**
 * Matrice de tronçons indexée par identifiant de point.
 * `legs` est une fonction (a, b) → { km, min } fournie par l'appelant : elle
 * peut venir du cache, d'OSRM ou de TomTom, le moteur n'en sait rien.
 *
 * Les extrémités sont nommées : DEPART (position du véhicule ou centre) et
 * ARRIVEE (retour au centre de tri).
 */
const DEPART = '__depart__';
const ARRIVEE = '__arrivee__';

/**
 * Coût d'une séquence : DEPART → p1 → … → pn → ARRIVEE.
 * @param {Array<string|number>} ordre identifiants de points, dans l'ordre
 * @param {(a, b) => {km:number, min:number}} leg
 * @returns {{km:number, min:number}}
 */
function coutSequence(ordre, leg) {
  const chemin = [DEPART, ...ordre, ARRIVEE];
  let km = 0;
  let min = 0;
  for (let i = 1; i < chemin.length; i++) {
    const t = leg(chemin[i - 1], chemin[i]) || { km: 0, min: 0 };
    km += Number(t.km) || 0;
    min += Number(t.min) || 0;
  }
  return { km: Math.round(km * 1000) / 1000, min: Math.round(min * 1000) / 1000 };
}

// ── Score ─────────────────────────────────────────────────────────────────

/**
 * Score à MINIMISER. Normalisé par la séquence de référence (celle en place),
 * pour que les pondérations de l'objectif « mixte » aient un sens : sans
 * normalisation on additionnerait des kilomètres et des minutes.
 *
 * @param {{km, min}} cout
 * @param {{km, min}} reference  coût de la séquence de départ
 * @param {{objectif, poids}} opts
 */
function score(cout, reference, opts = {}) {
  const objectif = OBJECTIFS.includes(opts.objectif) ? opts.objectif : 'mixte';
  if (objectif === 'distance') return cout.km;
  if (objectif === 'duree') return cout.min;
  const poids = { ...POIDS_DEFAUT, ...(opts.poids || {}) };
  const refKm = reference && reference.km > 0 ? reference.km : 1;
  const refMin = reference && reference.min > 0 ? reference.min : 1;
  return (poids.distance * cout.km) / refKm + (poids.duree * cout.min) / refMin;
}

// ── Amélioration locale ───────────────────────────────────────────────────

/** Inversion d'un segment [i, j] (2-opt). */
function inverser(ordre, i, j) {
  const copie = ordre.slice();
  const segment = copie.slice(i, j + 1).reverse();
  copie.splice(i, segment.length, ...segment);
  return copie;
}

/** Déplacement d'un segment de longueur `len` de `from` vers `to` (Or-opt). */
function deplacer(ordre, from, len, to) {
  const copie = ordre.slice();
  const segment = copie.splice(from, len);
  const cible = to > from ? to - len : to;
  copie.splice(cible, 0, ...segment);
  return copie;
}

/**
 * Optimise l'ordre de passage.
 *
 * Part de la séquence EXISTANTE (et non d'un ordre arbitraire) : c'est ce que
 * le chauffeur a sous les yeux, et cela garantit que le résultat n'est jamais
 * pire que l'existant.
 *
 * @param {Array<string|number>} ordreInitial
 * @param {(a, b) => {km, min}} leg
 * @param {object} opts { objectif, poids, maxPasses }
 * @returns {{ordre, cout, coutInitial, gain, passes, ameliore}}
 */
function optimiserOrdre(ordreInitial, leg, opts = {}) {
  const initial = Array.isArray(ordreInitial) ? ordreInitial.slice() : [];
  const coutInitial = coutSequence(initial, leg);
  const resultat = {
    ordre: initial, cout: coutInitial, coutInitial,
    gain: { km: 0, min: 0, pct_distance: 0, pct_duree: 0 },
    passes: 0, ameliore: false,
  };
  // Deux points suffisent à être permutés : le départ (position du camion) et
  // l'arrivée (centre de tri) sont fixes, donc A→B et B→A diffèrent.
  if (initial.length < 2) return resultat;

  const maxPasses = Number.isInteger(opts.maxPasses) ? opts.maxPasses : MAX_PASSES;
  let meilleur = initial;
  let meilleurCout = coutInitial;
  let meilleurScore = score(coutInitial, coutInitial, opts);
  let passes = 0;
  let progresse = true;

  while (progresse && passes < maxPasses) {
    progresse = false;
    passes += 1;

    // 2-opt : défait les croisements d'itinéraire.
    for (let i = 0; i < meilleur.length - 1; i++) {
      for (let j = i + 1; j < meilleur.length; j++) {
        const candidat = inverser(meilleur, i, j);
        const cout = coutSequence(candidat, leg);
        const s = score(cout, coutInitial, opts);
        if (s < meilleurScore - 1e-9) {
          meilleur = candidat; meilleurCout = cout; meilleurScore = s; progresse = true;
        }
      }
    }

    // Or-opt : déplace 1 à 3 points consécutifs ailleurs dans la tournée.
    // Complète le 2-opt, qui ne sait pas extraire un point isolé mal placé.
    for (let len = 1; len <= OR_OPT_MAX; len++) {
      for (let from = 0; from + len <= meilleur.length; from++) {
        for (let to = 0; to <= meilleur.length - len; to++) {
          if (to >= from && to <= from + len - 1) continue; // même place
          const candidat = deplacer(meilleur, from, len, to);
          if (candidat.length !== meilleur.length) continue;
          const cout = coutSequence(candidat, leg);
          const s = score(cout, coutInitial, opts);
          if (s < meilleurScore - 1e-9) {
            meilleur = candidat; meilleurCout = cout; meilleurScore = s; progresse = true;
          }
        }
      }
    }
  }

  const memeOrdre = meilleur.length === initial.length
    && meilleur.every((v, i) => v === initial[i]);

  return {
    ordre: meilleur,
    cout: meilleurCout,
    coutInitial,
    gain: {
      km: Math.round((coutInitial.km - meilleurCout.km) * 100) / 100,
      min: Math.round(coutInitial.min - meilleurCout.min),
      pct_distance: coutInitial.km > 0
        ? Math.round(((coutInitial.km - meilleurCout.km) / coutInitial.km) * 1000) / 10 : 0,
      pct_duree: coutInitial.min > 0
        ? Math.round(((coutInitial.min - meilleurCout.min) / coutInitial.min) * 1000) / 10 : 0,
    },
    passes,
    ameliore: !memeOrdre,
  };
}

/**
 * Bilan complet d'une optimisation, CO2 compris.
 * @param {object} resultat sortie d'optimiserOrdre
 * @param {{litresPer100km, kgCo2eParLitre}} carburant (valeurs MESURÉES)
 */
function bilan(resultat, carburant = {}) {
  const { litresPer100km, kgCo2eParLitre } = carburant;
  const co2Avant = co2Kg(resultat.coutInitial.km, litresPer100km, kgCo2eParLitre);
  const co2Apres = co2Kg(resultat.cout.km, litresPer100km, kgCo2eParLitre);
  return {
    ...resultat,
    co2: {
      avant_kg: co2Avant,
      apres_kg: co2Apres,
      // null (et non 0) quand la consommation ou le facteur manquent :
      // « non calculable » n'est pas « aucune émission évitée ».
      evite_kg: co2Avant !== null && co2Apres !== null
        ? Math.round((co2Avant - co2Apres) * 1000) / 1000 : null,
    },
  };
}

module.exports = {
  co2Kg, coutSequence, score, optimiserOrdre, bilan,
  inverser, deplacer,
  OBJECTIFS, POIDS_DEFAUT, DEPART, ARRIVEE, MAX_PASSES, OR_OPT_MAX,
};
