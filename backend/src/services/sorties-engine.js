/**
 * Dénominateur des taux de sortie — moteur PUR (PR D, lot 6, item 6.1).
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══════════════════════════════════════════
 *
 * Jusqu'ici, le taux de sorties dynamiques se calculait sur les **bilans de
 * sortie classés** : le dénominateur était le nombre de bilans rédigés, pas le
 * nombre de personnes parties. Une personne qui quitte le chantier sans
 * entretien de sortie — celle qui ne répond plus au téléphone, celle qui est
 * partie du jour au lendemain — ne figurait dans AUCUN des deux termes du
 * rapport. Elle disparaissait du calcul, et le taux montait d'autant.
 *
 * La direction a tranché (décision 9 du plan 07) : le dénominateur devient
 * **toutes les fins de parcours de la période**, et les départs sans bilan
 * apparaissent en clair sur une ligne « sortie non documentée ». C'est une
 * rupture de série assumée, annoncée au dialogue de gestion, et c'est pourquoi
 * les **deux méthodes sont imprimées côte à côte pour l'exercice 2026** : sans
 * cela, l'écart entre le chiffre présenté en juillet et celui de la synthèse
 * annuelle passerait pour une erreur de calcul.
 *
 * ═══ POURQUOI IL EST PUR ══════════════════════════════════════════════════
 *
 * Quatre surfaces publient ce taux — `gatherAuditKpis`, l'export de synthèse
 * comité, la synthèse de dialogue de gestion transmise à l'autorité, et le
 * reporting RH. Recopier la règle dans quatre fichiers, c'est accepter qu'un
 * jour deux d'entre eux la corrigent et deux non : la structure présenterait
 * alors deux taux différents pour la même année, dans deux documents qui
 * portent la même signature. La règle vit donc ici, sans aucune E/S, et les
 * quatre appelants lui INJECTENT leurs lignes.
 *
 * ═══ CE QU'IL NE FAIT JAMAIS ══════════════════════════════════════════════
 *  · Diviser par zéro : aucun dénominateur nul ne produit « 0 % », il produit
 *    `null` (il n'y a rien à mesurer, ce qui n'est pas un résultat de 0 %).
 *  · Inventer une cible : une cible non paramétrée rend un écart `null`, et la
 *    synthèse écrit « objectif non paramétré » en toutes lettres.
 *  · Requalifier un départ : une sortie non documentée est un indicateur de
 *    QUALITÉ de la saisie, jamais une faute imputée à la personne — la phrase
 *    est écrite dans `regles` et part telle quelle dans le document.
 */

'use strict';

/** Les quatre catégories officielles de sortie (nomenclature DREETS). */
const SORTIE_CLASSES = ['emploi_durable', 'emploi_transition', 'sortie_positive', 'autre'];

/** Les trois qui composent une « sortie dynamique ». */
const CLASSES_DYNAMIQUES = ['emploi_durable', 'emploi_transition', 'sortie_positive'];

/** Cinquième ligne, propre à la méthode B : le départ sans bilan classé. */
const CLASSE_NON_DOCUMENTEE = 'non_documentee';

/**
 * Pourcentage entier, ou `null` quand le dénominateur est nul.
 * Jamais 0 : « aucune sortie » et « aucune sortie dynamique sur douze » sont
 * deux situations différentes, et l'autorité lit la différence.
 */
function pct(numerateur, denominateur) {
  if (!Number.isFinite(denominateur) || denominateur <= 0) return null;
  return Math.round((numerateur / denominateur) * 100);
}

/** Écart en points entre un réalisé et une cible — `null` si l'un manque. */
function ecart(realise, cible) {
  if (realise == null || cible == null) return null;
  const c = Number(cible);
  if (!Number.isFinite(c)) return null;
  return Math.round((realise - c) * 10) / 10;
}

/** Clé d'appariement d'un parcours : la personne ET le numéro de parcours. */
function cle(ligne) {
  const id = ligne && ligne.employee_id != null ? Number(ligne.employee_id) : null;
  if (!Number.isFinite(id)) return null;
  const num = ligne.parcours_num == null ? 1 : Number(ligne.parcours_num);
  return `${id}#${Number.isFinite(num) ? num : 1}`;
}

/**
 * Index des bilans par parcours. Deux bilans pour un même parcours (une
 * réouverture suivie d'une reprise) : le PREMIER rencontré fait foi — la
 * requête appelante les ordonne, et compter deux fois la même personne
 * gonflerait à la fois le numérateur et le dénominateur de la méthode A.
 */
function indexerBilans(bilansClasses) {
  const bilans = Array.isArray(bilansClasses)
    ? bilansClasses.filter((b) => b && b.sortie_classification)
    : [];
  const bilanParParcours = new Map();
  for (const b of bilans) {
    const k = cle(b);
    if (k && !bilanParParcours.has(k)) bilanParParcours.set(k, b);
  }
  return bilanParParcours;
}

/**
 * La liste des SORTANTS de la méthode B — une ligne par fin de parcours, avec
 * le bilan classé qui lui est apparié (ou `null` : sortie non documentée).
 *
 * Exposée pour les documents qui ventilent les sortants PERSONNE PAR PERSONNE
 * (reporting Convergence, 2.58.0) : ils doivent compter exactement les mêmes
 * personnes que le dénominateur de `calculerSorties`, avec le même appariement.
 * Recopier cette boucle ailleurs, c'est accepter qu'un jour les deux documents
 * annoncent deux nombres de sorties différents pour la même période.
 *
 * @returns {Array<{employee_id:number, parcours_num:number, bilan:object|null}>}
 */
function listerSortants({ finsParcours = [], bilansClasses = [] } = {}) {
  const fins = Array.isArray(finsParcours) ? finsParcours.filter((f) => cle(f)) : [];
  const bilanParParcours = indexerBilans(bilansClasses);
  const vues = new Set();
  const out = [];
  for (const f of fins) {
    const k = cle(f);
    if (vues.has(k)) continue; // une personne, une fin de parcours
    vues.add(k);
    out.push({
      employee_id: Number(f.employee_id),
      parcours_num: f.parcours_num == null ? 1 : Number(f.parcours_num),
      bilan: bilanParParcours.get(k) || null,
    });
  }
  return out;
}

/** Compteur initialisé à zéro sur les cinq lignes — aucune ne doit manquer. */
function compteurVide(avecNonDocumentee) {
  const o = {};
  for (const c of SORTIE_CLASSES) o[c] = 0;
  if (avecNonDocumentee) o[CLASSE_NON_DOCUMENTEE] = 0;
  return o;
}

/**
 * Calcule les deux méthodes de dénominateur et leur rapprochement ASP.
 *
 * @param {object} p
 * @param {Array<{employee_id:number, parcours_num?:number, insertion_end_date?:*}>} p.finsParcours
 *   TOUTES les personnes dont le parcours s'est terminé dans la période.
 * @param {Array<{employee_id:number, parcours_num?:number, sortie_classification:string, sortie_type?:string}>} p.bilansClasses
 *   Bilans de sortie RÉALISÉS et CLASSÉS de la période (méthode historique).
 * @param {number|null} [p.sortiesAsp] nombre de sorties déclarées à l'ASP sur
 *   la même période — `null` si aucun état mensuel n'a été importé.
 * @param {number} p.annee année civile de la période.
 * @param {object} [p.cibles] cibles conventionnelles (`cible_taux_*`).
 * @param {number|null} [p.annee_double_methode] année pour laquelle la méthode
 *   historique est imprimée à côté de la nouvelle.
 */
function calculerSorties({
  finsParcours = [],
  bilansClasses = [],
  sortiesAsp = null,
  annee = null,
  cibles = null,
  annee_double_methode = null,
} = {}) {
  const fins = Array.isArray(finsParcours) ? finsParcours.filter((f) => cle(f)) : [];
  // Index des bilans par parcours — règle unique (`indexerBilans`).
  const bilanParParcours = indexerBilans(bilansClasses);

  // ── Méthode B — dénominateur = toutes les fins de parcours ───────────────
  const parClassificationB = compteurVide(true);
  const parTypeB = {};
  let documentees = 0;
  const vues = new Set();
  for (const f of fins) {
    const k = cle(f);
    if (vues.has(k)) continue; // une personne, une fin de parcours
    vues.add(k);
    const b = bilanParParcours.get(k);
    if (b && SORTIE_CLASSES.includes(b.sortie_classification)) {
      documentees += 1;
      parClassificationB[b.sortie_classification] += 1;
      if (b.sortie_type) parTypeB[b.sortie_type] = (parTypeB[b.sortie_type] || 0) + 1;
    } else if (b) {
      // Classification hors nomenclature (donnée héritée) : elle ne se range
      // dans aucune des quatre lignes officielles. On la compte comme
      // documentée mais on la NOMME plutôt que de la ranger dans « autre »,
      // qui est une catégorie de sortie et non une catégorie d'erreur.
      documentees += 1;
      parClassificationB.autre += 1;
      if (b.sortie_type) parTypeB[b.sortie_type] = (parTypeB[b.sortie_type] || 0) + 1;
    } else {
      parClassificationB[CLASSE_NON_DOCUMENTEE] += 1;
    }
  }
  const denominateurB = vues.size;
  const nonDocumentees = parClassificationB[CLASSE_NON_DOCUMENTEE];
  const dynamiquesB = CLASSES_DYNAMIQUES.reduce((a, c) => a + parClassificationB[c], 0);

  const tauxB = {
    emploi_durable: pct(parClassificationB.emploi_durable, denominateurB),
    emploi_transition: pct(parClassificationB.emploi_transition, denominateurB),
    sortie_positive: pct(parClassificationB.sortie_positive, denominateurB),
    dynamiques: pct(dynamiquesB, denominateurB),
  };

  const c = cibles || {};
  const ecartCible = (c.cible_taux_dynamiques != null || c.cible_taux_durable != null
    || c.cible_taux_transition != null || c.cible_taux_positive != null)
    ? {
      dynamiques: ecart(tauxB.dynamiques, c.cible_taux_dynamiques),
      emploi_durable: ecart(tauxB.emploi_durable, c.cible_taux_durable),
      emploi_transition: ecart(tauxB.emploi_transition, c.cible_taux_transition),
      sortie_positive: ecart(tauxB.sortie_positive, c.cible_taux_positive),
    }
    : null;

  // Bilans classés SANS fin de parcours datée dans la période : ils comptent
  // dans la méthode A (leur bilan existe) et pas dans la B (la date de fin de
  // parcours n'est pas renseignée, ou tombe hors période). Ce nombre est RENDU
  // parce qu'il explique à lui seul l'écart entre les deux dénominateurs.
  let bilansSansFinParcours = 0;
  for (const k of bilanParParcours.keys()) if (!vues.has(k)) bilansSansFinParcours += 1;

  // ── Méthode A — historique : dénominateur = bilans classés seuls ─────────
  const parClassificationA = compteurVide(false);
  let horsNomenclatureA = 0;
  for (const b of bilanParParcours.values()) {
    if (SORTIE_CLASSES.includes(b.sortie_classification)) parClassificationA[b.sortie_classification] += 1;
    else { parClassificationA.autre += 1; horsNomenclatureA += 1; }
  }
  const denominateurA = bilanParParcours.size;
  const dynamiquesA = CLASSES_DYNAMIQUES.reduce((a, k) => a + parClassificationA[k], 0);
  const methodeAComplete = {
    denominateur: denominateurA,
    par_classification: parClassificationA,
    taux_pct: {
      emploi_durable: pct(parClassificationA.emploi_durable, denominateurA),
      emploi_transition: pct(parClassificationA.emploi_transition, denominateurA),
      sortie_positive: pct(parClassificationA.sortie_positive, denominateurA),
      dynamiques: pct(dynamiquesA, denominateurA),
    },
  };

  const imprimerA = annee != null && annee_double_methode != null
    && Number(annee) === Number(annee_double_methode);

  // ── Rapprochement ASP ────────────────────────────────────────────────────
  // L'ASP ne connaît que les sorties DÉCLARÉES sur l'état mensuel de présence.
  // Un écart n'est pas une anomalie en soi (les dates de fin de contrat et de
  // fin de parcours ne coïncident pas toujours) : c'est un point à expliquer en
  // séance, et le document le présente comme tel.
  const asp = sortiesAsp == null || !Number.isFinite(Number(sortiesAsp))
    ? null : Number(sortiesAsp);
  const rapprochementAsp = {
    sorties_asp: asp,
    ecart: asp == null ? null : denominateurB - asp,
    note: asp == null
      ? "Aucun état mensuel de présence ASP importé sur la période — le rapprochement ne peut pas être fait (jamais de valeur estimée)."
      : "Écart = fins de parcours constatées dans l'outil moins sorties déclarées à l'ASP. Un écart n'est pas une anomalie : la fin de contrat et la fin de parcours ne coïncident pas toujours.",
  };

  const regles = [
    "Méthode B (retenue depuis 2026) : le dénominateur est le nombre de PERSONNES dont le parcours d'insertion s'est terminé dans l'année, qu'un bilan de sortie ait été rédigé ou non.",
    "Méthode A (historique, jusqu'en 2025) : le dénominateur était le nombre de BILANS de sortie réalisés et classés — une personne partie sans entretien n'y figurait ni au numérateur ni au dénominateur.",
    "Sortie non documentée : parcours terminé sans bilan de sortie classé — indicateur de qualité de la saisie, pas une faute.",
    "Sortie dynamique = emploi durable + emploi de transition + autre sortie positive.",
    "Un taux dont le dénominateur est nul n'est pas rendu (aucune sortie à mesurer n'est pas un résultat de 0 %).",
  ];
  if (imprimerA) {
    regles.push(`Exercice ${annee} : les deux méthodes sont imprimées côte à côte — le changement de dénominateur crée une rupture de série avec les chiffres présentés précédemment.`);
  }
  if (bilansSansFinParcours > 0) {
    // Le NOMBRE n'est pas recopié dans la phrase : elle est imprimée telle
    // quelle dans un document soumis au k-anonymat, qui ne protège que les
    // champs — un compte glissé dans une chaîne passerait à travers la passe
    // (correctif B-01). Il vit dans `methode_b.bilans_sans_fin_parcours`, où
    // il est protégé comme les autres.
    regles.push("Des bilans de sortie classés peuvent ne se rattacher à aucune fin de parcours datée dans la période : ils comptent dans la méthode A et pas dans la méthode B, et leur nombre figure au bloc 6 — c'est ce qui explique l'écart entre les deux dénominateurs.");
  }
  if (ecartCible === null) {
    regles.push('Écart aux cibles : objectif non paramétré (les cibles conventionnelles de l’annexe financière ne sont pas saisies).');
  }

  return {
    annee: annee == null ? null : Number(annee),
    methode_b: {
      denominateur: denominateurB,
      documentees,
      non_documentees: nonDocumentees,
      par_classification: parClassificationB,
      par_type: parTypeB,
      taux_pct: tauxB,
      ecart_cible: ecartCible,
      bilans_sans_fin_parcours: bilansSansFinParcours,
      hors_nomenclature: horsNomenclatureA,
    },
    methode_a: imprimerA ? methodeAComplete : null,
    // Toujours calculée (les surfaces internes continuent de l'afficher), mais
    // n'est IMPRIMÉE dans un document de conventionnement que l'année de la
    // double méthode — d'où les deux clés distinctes.
    methode_a_interne: methodeAComplete,
    rapprochement_asp: rapprochementAsp,
    regles,
  };
}

module.exports = {
  calculerSorties,
  listerSortants,
  SORTIE_CLASSES,
  CLASSES_DYNAMIQUES,
  CLASSE_NON_DOCUMENTEE,
  pct,
  ecart,
};
