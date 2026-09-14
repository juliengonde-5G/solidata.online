/**
 * Synthèse de dialogue de gestion — export (e) de la matrice de l'autorité
 * (PR D, lot 6 ; contrat 25 § 5.1, spécification 09 § 2 (e)).
 *
 * ═══ CE QUE CE DOCUMENT EST ═══════════════════════════════════════════════
 *
 * La pièce que la gestionnaire IAE reçoit **quinze jours avant la séance** de
 * dialogue de gestion, et sur laquelle elle instruira le conventionnement ACI
 * et les bilans FSE+. Neuf blocs, dans un ordre imposé par elle, dont le
 * neuvième — « Méthode » — écrit la règle de calcul de **chaque** taux en
 * toutes lettres. Ce neuvième bloc n'est pas de la politesse : un taux sans sa
 * règle n'est pas contrôlable, et un taux qu'on ne peut pas contrôler,
 * l'autorité l'écarte.
 *
 * ═══ STRICTEMENT NON NOMINATIF, ET PAS SEULEMENT PAR INTENTION ════════════
 *
 * Aucune clé de ce document ne porte un nom, un prénom, un identifiant de
 * salarié, une date de naissance, un contact. Ce n'est pas une promesse de
 * rédaction : c'est une **liste blanche structurelle** — les requêtes ne
 * PROJETTENT que des agrégats, et un test de contrat cherche les neuf clés
 * interdites dans la sérialisation JSON complète. Une projection explicite
 * oublie à la colonne suivante ; un test qui lit la RÉPONSE, non.
 *
 * ═══ LE k-ANONYMAT, ET LA RAISON DE SON EXCEPTION ═════════════════════════
 *
 * Un document agrégé peut trahir une personne par recoupement : « une personne
 * relevant du critère “sortant de détention”, catégorie France Travail G, sortie
 * en emploi durable » désigne quelqu'un aussi sûrement qu'un nom. Tout agrégat
 * comptant **entre 1 et k−1 personnes** (k = `insertion.k_anonymat_min`, défaut
 * 5, le même seuil que les enquêtes) est donc rendu `null`, et son chemin est
 * listé dans `sous_seuil` — le document DIT ce qu'il ne dit pas.
 *
 * **Zéro reste zéro**, délibérément. « Personne dans cette catégorie » ne
 * désigne personne, et supprimer les zéros rendrait le document illisible : sur
 * une structure de quarante-six accompagnements, la moitié des lignes sont à
 * zéro et l'autorité les lit — une catégorie France Travail F à zéro est une
 * information de gestion. Supprimer 0 protégerait une personne qui n'existe
 * pas, au prix de la seule chose que le document doit faire.
 *
 * Les **effectifs bruts globaux d'un bloc** échappent au seuil (l'effectif de la
 * cohorte, le nombre de conventions d'immersion, le dénominateur des sorties) :
 * ce sont les têtes de chapitre, elles ne ventilent personne, et sans elles
 * aucun des blocs ne se lit.
 *
 * ═══ CE QU'IL NE FAIT JAMAIS ══════════════════════════════════════════════
 *  · Inventer une cible : « objectif non paramétré » s'écrit en toutes lettres.
 *  · Rendre 0 pour une source absente : `null` nommé, et la raison au bloc 9.
 *  · Faire tomber le document parce qu'une source manque : chaque requête est
 *    `soft` — une base non migrée dégrade le bloc concerné et le NOMME, elle
 *    n'empêche pas la séance d'avoir lieu.
 *  · Porter le frein judiciaire (art. 10), ni les critères d'éligibilité marqués
 *    `sensible_art10` — **sans mentionner leur exclusion** : mentionner une
 *    exclusion, c'est encore désigner.
 */

'use strict';

const pool = require('../config/database');
const { readInsertionSetting } = require('../utils/insertion-settings');
const { FREINS } = require('../routes/insertion/freins-registry');
const { calculerSorties } = require('./sorties-engine');
const { ageBracket } = require('../utils/pii-pseudonymize');

const APP_VERSION = process.env.APP_VERSION || require('../../package.json').version;

const STRUCTURE = 'Solidarité Textiles';
const PERIMETRE = "parcours d'insertion (CDDI / CDI inclusion), hors permanents";
const MENTION = 'Document agrégé non nominatif — dialogue de gestion';

/**
 * Axes de freins du bloc 3 : le judiciaire est retiré ICI, à la source, et non
 * filtré à l'affichage. Sa colonne n'est même pas lue en SQL.
 */
const AXES_BLOC3 = FREINS.filter((f) => f.key !== 'judiciaire');

/** Libellés des types d'entretien (source unique du module). */
const {
  MILESTONE_TYPE_LABELS_ALL, MILESTONE_TYPES,
} = require('../routes/insertion/engine');

/** Les huit types d'entretien du bloc 4, dans l'ordre du parcours. */
const TYPES_ENTRETIEN = [...MILESTONE_TYPES, 'point_etape_referent', 'conciliation'];

/** Débouchés d'immersion (miroir du CHECK de la migration). */
const DEBOUCHES = ['embauche_accueillant', 'embauche_autre', 'formation', 'poursuite_parcours', 'aucun', 'inconnu'];
const DEBOUCHE_LABELS = {
  embauche_accueillant: "Embauche chez l'entreprise d'accueil",
  embauche_autre: 'Embauche chez un autre employeur',
  formation: 'Entrée en formation',
  poursuite_parcours: 'Poursuite du parcours',
  aucun: 'Aucun débouché',
  inconnu: 'Non connu à ce jour',
  non_renseigne: 'Non renseigné',
};

/** Natures d'aide mobilisée (miroir du CHECK). */
const AIDE_NATURES = [
  'mobilite', 'logement', 'sante', 'numerique', 'garde_enfants',
  'formation', 'administrative', 'financiere_urgence', 'autre',
];
const AIDE_LABELS = {
  mobilite: 'Mobilité', logement: 'Logement', sante: 'Santé', numerique: 'Numérique',
  garde_enfants: "Garde d'enfants", formation: 'Formation', administrative: 'Démarche administrative',
  financiere_urgence: "Aide financière d'urgence", autre: 'Autre',
};

/** Résultats d'une orientation DORA. */
const DORA_RESULTATS = ['oriente', 'pris_en_charge', 'refuse', 'sans_suite'];

/** Types de référent unique (nomenclature de la loi pour le plein emploi). */
const REFERENT_TYPES = ['structure', 'cms', 'france_travail', 'autre', 'non_determine'];

/** Catégories France Travail (A-G) plus la case « non renseignée ». */
const FT_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

/**
 * Situations à +6 mois rendues par le document, et la correspondance avec les
 * valeurs stockées. « Non renseigné » et « injoignable » sont DEUX lignes
 * distinctes, exigence explicite de l'autorité (§ 2 (b) 5) : une personne qu'on
 * n'a pas réussi à joindre n'est pas une personne qu'on n'a pas appelée.
 */
const SITUATIONS_6_MOIS = [
  'emploi_durable', 'emploi_transition', 'formation', 'recherche_emploi',
  'autre', 'injoignable', 'non_renseigne',
];
const MAP_SITUATION_6_MOIS = {
  emploi_durable: 'emploi_durable',
  emploi_transition: 'emploi_transition',
  formation: 'formation',
  chomage: 'recherche_emploi',
  autre_sortie_positive: 'autre',
  inactivite: 'autre',
  inconnue: 'autre',
  injoignable: 'injoignable',
};

// ───────────────────────────────────────────────────────────────────────────
// Outils
// ───────────────────────────────────────────────────────────────────────────

/**
 * Requête RÉSILIENTE. Une source absente (base non migrée, table d'un lot non
 * déployé) dégrade le bloc concerné et le NOMME au journal serveur ; elle ne
 * fait pas tomber la séance de dialogue de gestion.
 */
function faireSoft(db) {
  return async function soft(label, text, params = []) {
    try {
      const r = await db.query(text, params);
      return r.rows;
    } catch (err) {
      console.error(`[INSERTION][DIALOGUE] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
      return null; // `null` et non `[]` : l'appelant distingue « rien » de « échec ».
    }
  };
}

/** Nombre sûr (jamais `Number(null) === 0`). */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Arrondi à deux décimales, ou `null`. */
const r2 = (v) => (num(v) == null ? null : Math.round(num(v) * 100) / 100);

/**
 * Séparateur de milliers à la française — le document est imprimé et lu par un
 * agent de l'État : « 1 820 heures » et non « 1820 heures ».
 */
const milliers = (v) => String(v == null ? '' : v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Pourcentage entier, `null` si le dénominateur est nul (jamais « 0 % »). */
function part(n, total) {
  if (n == null || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((n / total) * 1000) / 10;
}

/**
 * Fabrique le garde-fou de k-anonymat de CE document.
 *
 * `k(n, chemin)` rend `n` si l'agrégat est publiable, `null` sinon — et
 * enregistre alors le chemin dans `sous_seuil`. Voir l'en-tête pour la raison
 * de l'exception « zéro reste zéro ».
 */
function faireKAnon(seuil, sousSeuil) {
  const s = Number.isFinite(seuil) && seuil > 0 ? seuil : 5;
  return function k(n, chemin) {
    const v = num(n);
    if (v == null) return null;
    if (v === 0) return 0;
    if (v < s) {
      if (chemin && !sousSeuil.includes(chemin)) sousSeuil.push(chemin);
      return null;
    }
    return v;
  };
}


// ───────────────────────────────────────────────────────────────────────────
// k-ANONYMAT — une seule passe, sur TOUT le document
// ───────────────────────────────────────────────────────────────────────────
/**
 * ═══ POURQUOI UNE PASSE ET NON UN APPEL PAR CHAMP (correctif B-01 / D-07) ══
 *
 * Le garde-fou était posé À LA MAIN, agrégat par agrégat, au moment de composer
 * chaque bloc. Il couvrait donc exactement les endroits où son auteur avait
 * pensé à lui — les blocs 2 et 3, deux champs du 5 — et rien d'autre. Le
 * document transmis publiait pendant ce temps, sur la ligne voisine de celle
 * qu'il venait de masquer : la raison sociale de l'unique entreprise d'accueil
 * d'une période à une immersion, le montant exact d'une aide financière
 * d'urgence unique, le nom du partenaire d'un axe portant une seule action,
 * « 1 entretien de conciliation », « 1 sortie en emploi durable ». Une
 * suppression que la ligne d'à côté défait est pire qu'une absence de
 * suppression : elle affirme une protection qu'elle ne fournit pas, sous un
 * pied de page signé « aucune donnée permettant d'identifier une personne ».
 *
 * La protection est donc **structurelle et par défaut** : les blocs composent
 * des valeurs BRUTES, et une seule fonction parcourt ensuite le document
 * ENTIER. Tout nombre entier compris entre 1 et k−1 est retiré, SAUF s'il
 * figure dans l'une des deux listes blanches explicites ci-dessous. Un bloc 10
 * écrit l'an prochain sera protégé sans que personne n'ait à y penser — c'est
 * l'inverse exact du dispositif précédent, et c'est le seul sens qui tienne :
 * on n'oublie pas d'ajouter un champ à une liste d'exceptions, on oublie de
 * l'ajouter à une liste de protections.
 *
 * ═══ CE QUE LA PASSE NE FAIT PAS ══════════════════════════════════════════
 *  · **Zéro reste zéro** : « personne dans cette catégorie » ne désigne
 *    personne, et supprimer les zéros rendrait le document illisible.
 *  · Les MESURES (taux, heures, euros, ETP, base de calcul, années) ne sont pas
 *    des comptes de personnes : elles ne sont pas retirées pour leur propre
 *    valeur — mais elles le sont dès que le compte dont elles dérivent l'est
 *    (`K_DEPENDANCES_FRATRIE`, `K_TAUX`), sans quoi la suppression serait
 *    cosmétique : un taux multiplié par un dénominateur publié rend le
 *    numérateur.
 */

/** Libellés des blocs — le document DIT combien il retire, et où. */
const K_BLOC_LIBELLES = {
  '1_effectifs_etp': '1. Effectifs et ETP',
  '2_publics_entree': "2. Publics à l'entrée",
  '3_freins': '3. Freins',
  '4_accompagnement': '4. Accompagnement',
  '5_immersions': '5. Immersions',
  '6_sorties': '6. Sorties',
  '7_resultats': '7. Résultats',
  '8_conformite': '8. Conformité',
  '9_methode': '9. Méthode',
};

/**
 * LISTE BLANCHE 1 — les effectifs bruts globaux publiés EN CLAIR, avec la
 * raison de chacun. Elle est courte À DESSEIN : chaque ligne est une exception
 * argumentée au principe, pas une commodité d'affichage.
 */
const K_EFFECTIFS_PUBLIES = new Map([
  ['blocs.2_publics_entree.effectif',
    "tête de chapitre : sans l'effectif de référence, aucune ventilation du document ne se lit."],
  ['blocs.5_immersions.conventions',
    "nombre d'actes (conventions signées) et non de personnes ; ce qui le détaille — jours, entreprises, liste des raisons sociales — est retiré tant qu'il reste sous le seuil."],
  ['blocs.6_sorties.methode_b.denominateur',
    'indicateur n° 15 de la matrice de l’autorité : le dénominateur des sorties est explicitement réclamé.'],
  ['blocs.6_sorties.methode_b.non_documentees',
    "indicateur n° 15 : les sorties non documentées sont l'objet même de la demande — les masquer viderait le document de sa raison d'être."],
  ['blocs.6_sorties.methode_b.documentees',
    'se déduit des deux précédents (dénominateur moins non documentées) : le masquer serait une protection que la ligne voisine défait.'],
  ['blocs.6_sorties.methode_b.par_classification.non_documentee',
    'même valeur que « sorties non documentées » ci-dessus.'],
  ['blocs.6_sorties.rapprochement_asp.sorties_asp',
    "chiffre que le destinataire détient déjà — c'est lui qui a enregistré ces déclarations ; le publier ne lui apprend rien sur nos dossiers et c'est la condition pour que l'écart soit discutable en séance."],
  ['blocs.6_sorties.rapprochement_asp.ecart',
    'se déduit du dénominateur (publié par mandat) et du chiffre ASP ci-dessus : le masquer serait une protection que les deux lignes voisines défont.'],
]);

/**
 * LISTE BLANCHE 2 — les clés qui ne comptent JAMAIS des personnes : un taux, un
 * nombre d'heures, un montant en euros, un ETP, une base de calcul, un nombre
 * de mois. Elles traversent la passe pour leur propre valeur ; elles sont
 * retirées, elles, par dépendance (voir plus bas) dès que le compte qui les
 * produit l'est.
 */
const K_MESURES = new Set([
  'base_heures', 'nb_mois_asp_valides', 'etp_asp', 'effectif_pondere', 'etp_asp_moyen',
  'etp_conventionnes', 'taux_realisation_pct', 'part_pct', 'taux_pct', 'pct',
  'total_h', 'moyenne_par_personne_h', 'moyenne_globale', 'delai_moyen_diagnostic_jours',
  'montant_total', 'jours', 'annee', 'trimestre', 'k_anonymat', 'seuil',
]);

/**
 * DÉPENDANCES DE FRATRIE — « cette clé n'est rendue que si la clé de comptage
 * du MÊME objet l'est ». Le déclencheur est la VALEUR sous le seuil, et non la
 * suppression : `conventions` est publié par liste blanche, et c'est bien lui
 * qui doit faire disparaître la liste des entreprises d'accueil quand il vaut 1.
 */
const K_DEPENDANCES_FRATRIE = {
  n: ['part_pct', 'montant_total', 'nb_montants_saisis'],
  nb_personnes: ['moyenne_par_personne_h'],
  nb_reponses: ['moyenne_globale'],
  participants: ['pct'],
  actions_engagees: ['partenaire_principal'],
  echus: ['taux_pct'],
  conventions: ['jours', 'entreprises_distinctes', 'liste_entreprises'],
  nb_personnes_concernees: ['nb_semaines'],
};

/**
 * TAUX MIROIRS — un taux dont le dénominateur est PUBLIÉ redonne son
 * numérateur par multiplication. Il suit donc le sort de la case de comptage
 * qu'il reflète. Quand le dénominateur est lui-même retiré, le taux ne
 * reconstitue rien et reste rendu : l'autorité a besoin de ses taux.
 */
const K_TAUX = [
  {
    denominateur: 'blocs.6_sorties.methode_b.denominateur',
    comptes: 'blocs.6_sorties.methode_b.par_classification',
    miroirs: ['blocs.6_sorties.methode_b.taux_pct', 'blocs.6_sorties.methode_b.ecart_cible'],
    // `dynamiques` = documentées moins « autre » : les deux termes sont publiés
    // par mandat (indicateur n° 15), le taux est donc déjà déductible. Le
    // masquer serait une suppression que le document défait trois lignes plus
    // haut — exactement le défaut que ce correctif ferme.
    exempts: ['dynamiques'],
  },
  {
    denominateur: 'blocs.6_sorties.methode_a.denominateur',
    comptes: 'blocs.6_sorties.methode_a.par_classification',
    miroirs: ['blocs.6_sorties.methode_a.taux_pct'],
    exempts: [],
  },
];

/**
 * DISTRIBUTIONS dont les cases SOMMENT à un total publié : une seule case
 * retirée s'y retrouve par soustraction — et le document désignait
 * obligeamment laquelle. La *suppression complémentaire* (une seconde case
 * retirée, la plus petite publiée) est la parade classique ; son prix est un
 * chiffre de moins par distribution, et il est assumé.
 */
const K_DISTRIBUTIONS = [
  { chemin: 'blocs.2_publics_entree.par_categorie_ft', total: 'blocs.2_publics_entree.effectif' },
  { chemin: 'blocs.2_publics_entree.par_referent_unique', total: 'blocs.2_publics_entree.effectif' },
  { chemin: 'blocs.2_publics_entree.sexe', total: 'blocs.2_publics_entree.effectif' },
  { chemin: 'blocs.2_publics_entree.tranches_age', total: 'blocs.2_publics_entree.effectif' },
  { chemin: 'blocs.2_publics_entree.niveaux_formation', total: 'blocs.2_publics_entree.effectif' },
  { chemin: 'blocs.5_immersions.par_debouche', total: 'blocs.5_immersions.conventions' },
  { chemin: 'blocs.6_sorties.methode_b.par_classification', total: 'blocs.6_sorties.methode_b.denominateur' },
  { chemin: 'blocs.7_resultats.situation_6_mois', total: 'blocs.7_resultats.nb_sorties_suivies' },
];

/** Lit / écrit une valeur par son chemin pointé, sans jamais créer de clé. */
function lireChemin(racine, chemin) {
  let cur = racine;
  for (const seg of chemin.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}
function ecrireChemin(racine, chemin, valeur) {
  const segs = chemin.split('.');
  let cur = racine;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return false;
    cur = cur[segs[i]];
  }
  if (cur == null || typeof cur !== 'object') return false;
  if (!(segs[segs.length - 1] in cur)) return false;
  cur[segs[segs.length - 1]] = valeur;
  return true;
}

/**
 * Applique le k-anonymat au document ENTIER et rend le compte des agrégats
 * retirés, PAR BLOC.
 *
 * ═══ POURQUOI LE CHEMIN EXACT N'EST PLUS PUBLIÉ ═══════════════════════════
 * Le document listait, en fin de page, le chemin de chaque agrégat retiré. Sur
 * une distribution qui somme à un effectif publié, cette liste désigne la case
 * à reconstituer par soustraction : elle transformait une bonne intention
 * — « le document dit ce qu'il ne dit pas » — en mode d'emploi. Un COMPTE par
 * bloc conserve l'honnêteté sans l'indication ; les valeurs retirées restent
 * visiblement vides à leur place, et la CIP qui a besoin du détail le lit sur
 * l'écran interne, qui n'applique aucune suppression.
 */
function appliquerKAnonymat(document, seuil) {
  const s = Number.isFinite(seuil) && seuil >= 1 ? Math.round(seuil) : 5;
  const retires = new Map(); // bloc → nombre d'agrégats retirés
  const marquer = (chemin) => {
    const bloc = chemin.split('.')[1] || 'document';
    retires.set(bloc, (retires.get(bloc) || 0) + 1);
  };
  /** Un entier de 1 à k−1 : le seul motif de suppression. Zéro n'en est pas un. */
  const sousSeuil = (v) => typeof v === 'number' && Number.isInteger(v)
    && Math.abs(v) >= 1 && Math.abs(v) < s;

  // ── 1. Passe récursive : tout compte sous le seuil est retiré ────────────
  const parcourir = (noeud, chemin) => {
    if (Array.isArray(noeud)) {
      noeud.forEach((v, i) => {
        if (v && typeof v === 'object') parcourir(v, `${chemin}[${i}]`);
      });
      return;
    }
    if (!noeud || typeof noeud !== 'object') return;
    for (const [cle, val] of Object.entries(noeud)) {
      const sousChemin = `${chemin}.${cle}`;
      if (val && typeof val === 'object') { parcourir(val, sousChemin); continue; }
      if (typeof val !== 'number') continue;
      if (K_MESURES.has(cle)) continue;
      if (K_EFFECTIFS_PUBLIES.has(sousChemin)) continue;
      if (sousSeuil(val)) { noeud[cle] = null; marquer(sousChemin); }
    }
    // ── 2. Dépendances de fratrie, dans le MÊME objet ─────────────────────
    for (const [compteur, dependants] of Object.entries(K_DEPENDANCES_FRATRIE)) {
      if (!(compteur in noeud)) continue;
      const v = noeud[compteur];
      const doitTomber = v === null || sousSeuil(v);
      if (!doitTomber) continue;
      for (const d of dependants) {
        if (!(d in noeud) || noeud[d] === null) continue;
        noeud[d] = null;
        marquer(`${chemin}.${d}`);
      }
    }
  };
  parcourir(document.blocs || {}, 'blocs');

  // ── 3. Taux miroirs : un taux ne survit pas à la case qu'il reflète ──────
  for (const t of K_TAUX) {
    const den = lireChemin(document, t.denominateur);
    if (den == null) continue;                // dénominateur retiré : rien à reconstituer
    const comptes = lireChemin(document, t.comptes);
    if (!comptes || typeof comptes !== 'object') continue;
    for (const miroir of t.miroirs) {
      const cible = lireChemin(document, miroir);
      if (!cible || typeof cible !== 'object') continue;
      for (const cle of Object.keys(cible)) {
        if (t.exempts.includes(cle)) continue;
        if (cible[cle] == null) continue;
        if (Object.prototype.hasOwnProperty.call(comptes, cle) && comptes[cle] === null) {
          cible[cle] = null;
          marquer(`${miroir}.${cle}`);
        }
      }
    }
  }

  // ── 4. Suppression complémentaire ────────────────────────────────────────
  for (const d of K_DISTRIBUTIONS) {
    const total = lireChemin(document, d.total);
    if (total == null) continue;              // total retiré : aucune soustraction possible
    const dist = lireChemin(document, d.chemin);
    if (!dist || typeof dist !== 'object') continue;
    const supprimees = Object.keys(dist).filter((c) => dist[c] === null);
    if (supprimees.length !== 1) continue;    // zéro (rien à faire) ou deux (déjà sûr)
    // La plus PETITE case publiée strictement positive : c'est celle dont la
    // perte coûte le moins d'information au lecteur.
    const candidates = Object.keys(dist)
      .filter((c) => typeof dist[c] === 'number' && dist[c] > 0)
      .sort((a, b) => dist[a] - dist[b]);
    if (candidates.length === 0) continue;    // que des zéros : le complément est le total lui-même
    dist[candidates[0]] = null;
    marquer(`${d.chemin}.${candidates[0]}`);
  }

  return [...retires.entries()]
    .map(([bloc, nb]) => ({ bloc, libelle: K_BLOC_LIBELLES[bloc] || bloc, nb }))
    .sort((a, b) => a.bloc.localeCompare(b.bloc));
}

/** Bornes civiles d'une période — année entière, ou trimestre 1-4. */
function bornes(annee, trimestre) {
  const an = Number(annee);
  if (!Number.isFinite(an)) return null;
  const t = num(trimestre);
  if (t == null) return { debut: `${an}-01-01`, fin: `${an}-12-31`, annee: an, trimestre: null };
  const ti = Math.round(t);
  if (ti < 1 || ti > 4) return { debut: `${an}-01-01`, fin: `${an}-12-31`, annee: an, trimestre: null };
  const moisDebut = String((ti - 1) * 3 + 1).padStart(2, '0');
  const moisFin = (ti - 1) * 3 + 3;
  const dernierJour = new Date(Date.UTC(an, moisFin, 0)).getUTCDate();
  return {
    debut: `${an}-${moisDebut}-01`,
    fin: `${an}-${String(moisFin).padStart(2, '0')}-${String(dernierJour).padStart(2, '0')}`,
    annee: an,
    trimestre: ti,
  };
}

/**
 * Convention de l'annexe financière (`effectifs.convention_<annee>`), avec le
 * repli de lecture historique `insertion.cible_etp_conventionnes`. Même cascade
 * que `routes/effectifs.js` — recopiée ici et non importée parce que la
 * fonction y est locale à la route ; la valeur, elle, vient de la MÊME clé de
 * réglage, il n'y a donc pas deux sources de vérité.
 */
async function lireConvention(db, annee) {
  const out = {
    annee, etp_conventionnes: null, heures_annuelles_etp: null, source: 'non_parametre',
  };
  try {
    const r = await db.query('SELECT value FROM settings WHERE key = $1', [`effectifs.convention_${annee}`]);
    if (r.rows[0] && r.rows[0].value) {
      const j = typeof r.rows[0].value === 'object' ? r.rows[0].value : JSON.parse(r.rows[0].value);
      out.etp_conventionnes = num(j.etp_conventionnes);
      out.heures_annuelles_etp = num(j.heures_annuelles_etp);
      out.source = 'annexe_financiere';
      return out;
    }
  } catch (_) { /* JSON illisible → repli comme si absent */ }
  try {
    const c = await db.query('SELECT value FROM settings WHERE key = $1', ['insertion.cible_etp_conventionnes']);
    const cible = c.rows[0] ? num(c.rows[0].value) : null;
    if (cible != null) { out.etp_conventionnes = cible; out.source = 'cible_insertion'; }
  } catch (_) { /* rien : la convention reste non paramétrée */ }
  return out;
}

/** Cibles de sorties conventionnelles (clés `insertion.cible_taux_*`). */
async function lireCibles(db) {
  const cles = ['cible_taux_dynamiques', 'cible_taux_durable', 'cible_taux_transition', 'cible_taux_positive'];
  const out = {};
  for (const c of cles) out[c] = null;
  try {
    const r = await db.query('SELECT key, value FROM settings WHERE key = ANY($1::text[])',
      [cles.map((c) => `insertion.${c}`)]);
    for (const row of r.rows) out[String(row.key).replace('insertion.', '')] = num(row.value);
  } catch (_) { /* aucune cible → « objectif non paramétré » */ }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Blocs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bloc 1 — Effectifs et ETP. **L'ETP ASP validé est premier** : c'est le chiffre
 * que l'ASP a accepté, celui sur lequel l'aide au poste est versée, et il FAIT
 * FOI. L'ETP calculé par l'outil vient en second sous le nom d'« effectif
 * pondéré », qui dit ce qu'il est — un contrôle interne — et non ce qu'il n'est
 * pas. **Une seule base dans ce document : 1 820 h.**
 */
async function bloc1Effectifs(soft, db, p) {
  const convention = await lireConvention(db, p.annee);
  const baseReglage = await readInsertionSetting('insertion.heures_annuelles_etp');
  const baseHeures = convention.heures_annuelles_etp != null
    ? convention.heures_annuelles_etp
    : (num(baseReglage) != null ? num(baseReglage) : 1820);

  const asp = await soft('etp_asp', `
    SELECT mois, etp_asp::float AS etp, nb_brsa
    FROM etp_asp_mensuel WHERE annee = $1 ORDER BY mois`, [p.annee]);

  // « Effectif pondéré » — contrôle ERP, mois par mois : somme des quotités
  // contractuelles (heures hebdomadaires / 35) des CDDI couvrant le 15 du mois.
  // 35 h × 52 semaines = 1 820 h : la division par 35 EST la base 1 820 h, il
  // n'y a donc bien qu'une seule base dans ce document.
  //
  // PÉRIMÈTRE RESTREINT AUX CDDI, et c'est dit au lecteur (note du bloc et
  // ligne de méthode). Le CDI Inclusion ne se reconnaît PAS à son type de
  // contrat — l'import de paie le range en « CDI » et c'est l'intitulé du poste
  // qui le distingue (règle `keepContractForInsertion` de la grille Effectifs
  // ETP, qui n'est pas exportable depuis un routeur). Inventer ici une valeur
  // `'CDI INCLUSION'` qui n'existe dans aucune ligne aurait donné l'illusion
  // d'un périmètre complet en comptant exactement les mêmes contrats.
  //
  // CORRECTIF D-04 — deux pièges du `LEFT JOIN`, tous deux reproduits sur base
  // réelle :
  //   1. un mois SANS le moindre contrat produisait une ligne à NULL, que le
  //      `COALESCE(..., 35)` intérieur transformait en 35 h, soit 1,00 ETP
  //      « sorti de rien » — et le `COALESCE(SUM(...), 0)` extérieur ne pouvait
  //      pas l'attraper puisque SUM rendait 1 et non NULL. Toute synthèse
  //      générée en cours d'exercice imprimait donc 1,00 ETP par mois à venir,
  //      sur la colonne de CONTRÔLE d'un document de conventionnement. Le
  //      `FILTER (WHERE ec.id IS NOT NULL)` rend la seule valeur vraie : 0.
  //   2. deux avenants d'un même salarié laissés tous deux ouverts (`end_date`
  //      nulle après une reprise manuelle) le comptaient DEUX fois — une
  //      personne pouvait peser deux ETP. Le `DISTINCT ON (employee_id)` ne
  //      retient que le contrat le plus récent qui couvre le 15 du mois, ce qui
  //      est la règle appliquée partout ailleurs (`is_current` d'abord, puis la
  //      date de début la plus récente).
  const pondere = await soft('effectif_pondere', `
    WITH mois AS (
      SELECT generate_series(1, 12) AS m
    ),
    couvrants AS (
      SELECT DISTINCT ON (mois.m, ec.employee_id)
             mois.m AS mois,
             COALESCE(ec.weekly_hours, e.weekly_hours, 35)::numeric AS heures
      FROM mois
      JOIN employee_contracts ec
        ON UPPER(COALESCE(ec.contract_type, '')) = 'CDDI'
       AND ec.start_date <= make_date($1::int, mois.m, 15)
       AND (ec.end_date IS NULL OR ec.end_date >= make_date($1::int, mois.m, 15))
      LEFT JOIN employees e ON e.id = ec.employee_id
      ORDER BY mois.m, ec.employee_id, ec.is_current DESC NULLS LAST, ec.start_date DESC, ec.id DESC
    )
    SELECT mois.m AS mois,
           COALESCE(SUM(c.heures / 35), 0)::float AS etp
    FROM mois
    LEFT JOIN couvrants c ON c.mois = mois.m
    GROUP BY mois.m ORDER BY mois.m`, [p.annee]);

  const aspParMois = new Map((asp || []).map((r) => [Number(r.mois), r]));
  const pondereParMois = new Map((pondere || []).map((r) => [Number(r.mois), num(r.etp)]));

  const mois = [];
  const premierMois = p.trimestre ? (p.trimestre - 1) * 3 + 1 : 1;
  const dernierMois = p.trimestre ? p.trimestre * 3 : 12;
  for (let m = premierMois; m <= dernierMois; m++) {
    const a = aspParMois.get(m);
    mois.push({
      mois: `${p.annee}-${String(m).padStart(2, '0')}`,
      etp_asp: a ? r2(a.etp) : null,
      effectif_pondere: pondere == null ? null : r2(pondereParMois.get(m)),
    });
  }

  // Taux de réalisation : sur l'ETP ASP MOYEN des mois validés, jamais sur
  // l'effectif pondéré — le chiffre qui fait foi est celui de l'ASP. Aucun mois
  // validé → `null`, pas 0 %.
  const aspValides = mois.map((x) => x.etp_asp).filter((v) => v != null);
  const moyenneAsp = aspValides.length ? aspValides.reduce((a, b) => a + b, 0) / aspValides.length : null;
  const tauxRealisation = moyenneAsp != null && convention.etp_conventionnes != null
    && convention.etp_conventionnes > 0
    ? Math.round((moyenneAsp / convention.etp_conventionnes) * 1000) / 10
    : null;

  return {
    base_heures: baseHeures,
    mois,
    etp_asp_moyen: moyenneAsp == null ? null : r2(moyenneAsp),
    nb_mois_asp_valides: aspValides.length,
    etp_conventionnes: convention.etp_conventionnes,
    source_convention: convention.source,
    taux_realisation_pct: tauxRealisation,
    source_etp_asp: 'etp_asp_mensuel',
    note: convention.etp_conventionnes == null
      ? "L'ETP ASP validé fait foi ; l'effectif pondéré est un contrôle interne. Objectif non paramétré : l'annexe financière n'est pas saisie, le taux de réalisation n'est donc pas rendu."
      : "L'ETP ASP validé fait foi ; l'effectif pondéré est un contrôle interne calculé sur la même base de 1 820 h (quotité contractuelle / 35 h), sur les seuls contrats de type CDDI.",
  };
}

/**
 * Bloc 2 — Publics à l'entrée. La cohorte est **toute personne dont le parcours
 * chevauche la période**, et non les seuls présents au jour de la génération :
 * un document annuel qui ne compterait que les personnes encore là en décembre
 * effacerait la moitié de l'activité.
 */
async function bloc2Publics(soft, db, p) {
  const cohorte = await soft('cohorte_publics', `
    SELECT e.id, e.gender, e.birth_date, e.brsa, e.ft_categorie,
           COALESCE(e.referent_unique_type, 'non_determine') AS referent_unique_type,
           d.niveau_formation
    FROM employees e
    LEFT JOIN insertion_diagnostics d
      ON d.employee_id = e.id AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
    WHERE COALESCE(e.insertion_status, 'none') <> 'none'
      AND (e.insertion_start_date IS NULL OR e.insertion_start_date <= $2::date)
      AND (e.insertion_end_date IS NULL OR e.insertion_end_date >= $1::date)`,
  [p.debut, p.fin]);

  if (cohorte == null) {
    return { indisponible: true, note: 'Cohorte non lisible (base non à jour) — bloc non composé.' };
  }

  const effectif = cohorte.length;
  const ids = cohorte.map((r) => Number(r.id)).filter(Number.isFinite);

  // Critères d'éligibilité — les critères marqués art. 10 ne sont PAS LUS.
  const criteres = ids.length
    ? await soft('criteres_eligibilite', `
      SELECT c.code, c.libelle, c.ordre, COUNT(DISTINCT ee.employee_id)::int AS n
      FROM employee_eligibilite ee
      JOIN insertion_eligibilite_criteres c ON c.code = ee.critere_code
      WHERE ee.employee_id = ANY($1::int[]) AND COALESCE(c.sensible_art10, false) = false
      GROUP BY c.code, c.libelle, c.ordre ORDER BY c.ordre, c.code`, [ids])
    : [];

  const parCritere = (criteres || []).map((c) => {
    const n = num(c.n);
    return { code: c.code, libelle: c.libelle, n, part_pct: part(n, effectif) };
  });

  // BRSA : le compte de l'outil ET le compte déclaré à l'ASP, côte à côte.
  const nBrsa = cohorte.filter((r) => r.brsa === true).length;
  const brsaAsp = await soft('brsa_asp', `
    SELECT nb_brsa FROM etp_asp_mensuel
    WHERE annee = $1 AND nb_brsa IS NOT NULL ORDER BY mois DESC LIMIT 1`, [p.annee]);
  const compte = (valeurs, cles, libelleNul) => {
    const brut = {};
    for (const c of cles) brut[c] = 0;
    if (libelleNul) brut[libelleNul] = 0;
    for (const v of valeurs) {
      const cle = v == null || v === '' ? libelleNul : String(v);
      if (cle == null) continue;
      if (!(cle in brut)) brut[cle] = 0;
      brut[cle] += 1;
    }
    return brut;
  };

  const tranches = {};
  for (const r of cohorte) {
    const t = ageBracket(r.birth_date);
    const cle = t || 'non_renseignee';
    tranches[cle] = (tranches[cle] || 0) + 1;
  }

  return {
    effectif, // effectif brut global du bloc — jamais masqué (liste blanche K_EFFECTIFS_PUBLIES)
    par_critere_eligibilite: parCritere,
    brsa: {
      n: nBrsa,
      part_pct: part(nBrsa, effectif),
      n_asp: brsaAsp && brsaAsp[0] ? num(brsaAsp[0].nb_brsa) : null,
    },
    par_categorie_ft: compte(cohorte.map((r) => r.ft_categorie), FT_CATEGORIES, 'non_renseignee'),
    par_referent_unique: compte(cohorte.map((r) => r.referent_unique_type), REFERENT_TYPES, null),
    sexe: compte(cohorte.map((r) => r.gender), ['F', 'M'], 'non_renseigne'),
    tranches_age: tranches,
    niveaux_formation: compte(cohorte.map((r) => r.niveau_formation), [], 'non_renseigne'),
  };
}

/**
 * Bloc 3 — Freins : entrée → dernière évaluation, axe par axe. C'est
 * l'indicateur CENTRAL de la convention 2026-2027 (exigence S2).
 *
 * Règle d'évolution : **levé** = baisse d'au moins un niveau entre le diagnostic
 * d'accueil et la dernière évaluation ; **aggravé** = hausse d'au moins un
 * niveau ; **stable** sinon ; **non évalué** dès que l'une des deux valeurs
 * manque. L'échelle va de 1 (pas de difficulté) à 5 (bloquant) : une baisse est
 * bien une amélioration.
 *
 * Le frein judiciaire n'est pas lu — sa colonne n'apparaît pas dans le SQL.
 */
async function bloc3Freins(soft, db, p) {
  const cols = AXES_BLOC3.map((f) => f.column);
  const dCols = cols.map((c) => `d.${c} AS entree_${c}`).join(', ');
  const lmCols = cols.map((c) => `lm.${c} AS actuel_${c}`).join(', ');
  const imCols = cols.map((c) => `im.${c}`).join(', ');

  const lignes = await soft('freins_evolution', `
    SELECT e.id, ${dCols}, ${lmCols}
    FROM employees e
    LEFT JOIN insertion_diagnostics d
      ON d.employee_id = e.id AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
    LEFT JOIN LATERAL (
      SELECT ${imCols}
      FROM insertion_milestones im
      WHERE im.employee_id = e.id
        AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
        AND im.status = 'realise'
        AND COALESCE(${imCols}) IS NOT NULL
      ORDER BY COALESCE(im.completed_date, im.due_date) DESC, im.id DESC
      LIMIT 1
    ) lm ON true
    WHERE COALESCE(e.insertion_status, 'none') <> 'none'
      AND (e.insertion_start_date IS NULL OR e.insertion_start_date <= $2::date)
      AND (e.insertion_end_date IS NULL OR e.insertion_end_date >= $1::date)`,
  [p.debut, p.fin]);

  // Actions engagées et orientations DORA, par axe de frein.
  const actions = await soft('actions_par_axe', `
    SELECT a.frein_type AS axe,
           COUNT(*)::int AS n_actions,
           COUNT(*) FILTER (WHERE a.dora_service IS NOT NULL OR a.dora_url IS NOT NULL)::int AS n_dora,
           COUNT(*) FILTER (WHERE a.dora_resultat = 'oriente')::int AS dora_oriente,
           COUNT(*) FILTER (WHERE a.dora_resultat = 'pris_en_charge')::int AS dora_pris_en_charge,
           COUNT(*) FILTER (WHERE a.dora_resultat = 'refuse')::int AS dora_refuse,
           COUNT(*) FILTER (WHERE a.dora_resultat = 'sans_suite')::int AS dora_sans_suite
    FROM cip_action_plans a
    WHERE a.frein_type IS NOT NULL
      AND COALESCE(a.date_realisation, a.echeance, a.created_at::date) BETWEEN $1::date AND $2::date
    GROUP BY a.frein_type`, [p.debut, p.fin]);
  const actionsParAxe = new Map((actions || []).map((r) => [String(r.axe), r]));

  // Partenaire principal par axe : celui qui revient le plus souvent sur les
  // actions de cet axe. Raison sociale d'un organisme — jamais une personne.
  const partenaires = await soft('partenaire_principal_par_axe', `
    SELECT axe, nom FROM (
      SELECT a.frein_type AS axe, pa.nom, COUNT(*)::int AS n,
             ROW_NUMBER() OVER (PARTITION BY a.frein_type ORDER BY COUNT(*) DESC, pa.nom) AS rang
      FROM cip_action_plans a
      JOIN insertion_partenaires pa ON pa.id = a.partenaire_id
      WHERE a.frein_type IS NOT NULL
        AND COALESCE(a.date_realisation, a.echeance, a.created_at::date) BETWEEN $1::date AND $2::date
      GROUP BY a.frein_type, pa.nom
    ) t WHERE rang = 1`, [p.debut, p.fin]);
  const partenaireParAxe = new Map((partenaires || []).map((r) => [String(r.axe), r.nom]));

  const parAxe = AXES_BLOC3.map((f) => {
    let concernes = 0; let leves = 0; let stables = 0; let aggraves = 0; let nonEvalues = 0;
    for (const l of (lignes || [])) {
      const entree = num(l[`entree_${f.column}`]);
      const actuel = num(l[`actuel_${f.column}`]);
      // « Concerné à l'entrée » = niveau 2 ou plus au diagnostic (1 = pas de
      // difficulté sur cet axe ; l'échelle est documentée au bloc 9).
      if (entree != null && entree >= 2) concernes += 1;
      if (entree == null || actuel == null) { nonEvalues += 1; continue; }
      if (actuel <= entree - 1) leves += 1;
      else if (actuel >= entree + 1) aggraves += 1;
      else stables += 1;
    }
    const a = actionsParAxe.get(f.key);
    // CORRECTIF M-04 — une source ILLISIBLE ne s'imprime pas « 0 ». `actions`
    // vaut `null` quand la requête a échoué (base non migrée) et `[]` quand
    // elle n'a rien trouvé : « aucune action engagée sur cet axe » et « nous
    // n'avons pas pu lire les actions » ne se lisent pas pareil sur la pièce
    // qui instruit un conventionnement, et le second dessert la structure.
    const illisible = actions == null;
    const cpt = (v) => (illisible ? null : (num(v) || 0));
    return {
      axe: f.key,
      label: f.label,
      concernes_entree: concernes,
      leves,
      stables,
      aggraves,
      non_evalues: nonEvalues,
      actions_engagees: cpt(a && a.n_actions),
      partenaire_principal: partenaireParAxe.get(f.key) || null,
      orientations_dora: cpt(a && a.n_dora),
      dora_resultats: {
        oriente: cpt(a && a.dora_oriente),
        pris_en_charge: cpt(a && a.dora_pris_en_charge),
        refuse: cpt(a && a.dora_refuse),
        sans_suite: cpt(a && a.dora_sans_suite),
      },
    };
  });

  return {
    par_axe: parAxe,
    nb_dossiers: lignes == null ? null : lignes.length,
    actions_illisibles: actions == null,
    echelle: '1 = pas de difficulté … 5 = bloquant. Une BAISSE de niveau est une amélioration.',
  };
}

/** Bloc 4 — Accompagnement : entretiens, heures, délai de diagnostic, aides. */
async function bloc4Accompagnement(soft, db, p) {
  const entretiensRows = await soft('entretiens_periode', `
    SELECT im.milestone_type AS type,
           COUNT(*) FILTER (WHERE im.status = 'realise')::int AS realises,
           COUNT(*) FILTER (WHERE im.due_date <= LEAST(CURRENT_DATE, $2::date))::int AS echus,
           COUNT(*) FILTER (WHERE im.status = 'realise' AND im.due_date <= LEAST(CURRENT_DATE, $2::date))::int AS realises_echus
    FROM insertion_milestones im
    WHERE COALESCE(im.completed_date, im.due_date) BETWEEN $1::date AND $2::date
    GROUP BY im.milestone_type`, [p.debut, p.fin]);
  const parType = new Map((entretiensRows || []).map((r) => [String(r.type), r]));
  // CORRECTIF M-04 — source illisible ≠ zéro entretien (voir bloc 3).
  const entretiensIllisibles = entretiensRows == null;
  const entretiens = TYPES_ENTRETIEN.map((t) => {
    const r = parType.get(t) || { realises: 0, echus: 0, realises_echus: 0 };
    return {
      type: t,
      label: MILESTONE_TYPE_LABELS_ALL[t] || t,
      realises: entretiensIllisibles ? null : (num(r.realises) || 0),
      echus: entretiensIllisibles ? null : (num(r.echus) || 0),
      taux_pct: !entretiensIllisibles && num(r.echus) > 0
        ? Math.round((num(r.realises_echus) / num(r.echus)) * 100) : null,
    };
  });

  // Heures d'accompagnement — PROJECTION EXPLICITE : `heuresAccompagnement`
  // compose aussi `par_salarie` (la liste nominative des personnes accompagnées
  // et le volume consacré à chacune). Ce document s'annonce non nominatif : la
  // ventilation par personne n'y entre pas, et la projection est posée ICI, pas
  // à la frontière de la route.
  let heures = null;
  try {
    const brut = await require('./temps-accompagnement').heuresAccompagnement({ annee: p.annee });
    if (brut && brut.global_minutes != null) {
      heures = {
        total_h: Math.round((num(brut.global_minutes) / 60) * 10) / 10,
        nb_personnes: num(brut.nb_salaries_concernes) || 0,
        moyenne_par_personne_h: num(brut.moyenne_minutes_par_salarie) != null
          ? Math.round((num(brut.moyenne_minutes_par_salarie) / 60) * 10) / 10 : null,
      };
    }
  } catch (err) {
    console.error(`[INSERTION][DIALOGUE] « heures_accompagnement » ignorée : ${err.message}`);
  }

  const delai = await soft('delai_diagnostic', `
    SELECT AVG(im.completed_date - e.insertion_start_date)::numeric AS jours
    FROM insertion_milestones im
    JOIN employees e ON e.id = im.employee_id
    WHERE im.milestone_type = 'diagnostic_accueil' AND im.status = 'realise'
      AND im.completed_date IS NOT NULL AND e.insertion_start_date IS NOT NULL
      AND im.completed_date >= e.insertion_start_date
      AND im.completed_date BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  const aides = await soft('aides_mobilisees', `
    SELECT a.aide_nature AS nature, COUNT(*)::int AS n,
           SUM(a.aide_montant) AS montant_total,
           COUNT(*) FILTER (WHERE a.aide_montant IS NOT NULL)::int AS n_chiffrees
    FROM cip_action_plans a
    WHERE a.aide_nature IS NOT NULL
      AND COALESCE(a.date_realisation, a.echeance, a.created_at::date) BETWEEN $1::date AND $2::date
    GROUP BY a.aide_nature`, [p.debut, p.fin]);
  const aidesParNature = new Map((aides || []).map((r) => [String(r.nature), r]));
  // Source illisible → `null` NOMMÉ, jamais une liste vide qui se lirait
  // « aucune aide mobilisée » sur le document transmis (M-04).
  const aidesMobilisees = aides == null ? null : AIDE_NATURES
    .map((n) => {
      const r = aidesParNature.get(n);
      if (!r) return null;
      return {
        nature: n,
        label: AIDE_LABELS[n] || n,
        n: num(r.n) || 0,
        // Montant `null` (et non 0) quand aucune aide de cette nature n'est
        // chiffrée : un total de 0 € se lirait « aucune dépense », alors que
        // c'est « aucun montant saisi ».
        montant_total: num(r.n_chiffrees) > 0 ? r2(r.montant_total) : null,
        nb_montants_saisis: num(r.n_chiffrees) || 0,
      };
    })
    .filter(Boolean);

  return {
    entretiens,
    entretiens_illisibles: entretiensIllisibles,
    heures_accompagnement: heures,
    delai_moyen_diagnostic_jours: delai && delai[0] && delai[0].jours != null
      ? Math.round(Number(delai[0].jours)) : null,
    aides_mobilisees: aidesMobilisees,
  };
}

/** Bloc 5 — Immersions (PMSMP) et trajectoire immersion → emploi (S1 / S7). */
async function bloc5Immersions(soft, db, p) {
  const rows = await soft('pmsmp_periode', `
    SELECT entreprise, debouche, embauche_accueillant,
           (date_fin - date_debut + 1) AS jours
    FROM insertion_pmsmp
    WHERE date_debut BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  if (rows == null) {
    return { indisponible: true, note: 'Immersions non lisibles (base non à jour) — bloc non composé.' };
  }

  const jours = rows.reduce((a, r) => a + (num(r.jours) || 0), 0);
  const entreprises = [...new Set(rows.map((r) => String(r.entreprise || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));

  const parDebouche = {};
  for (const d of DEBOUCHES) parDebouche[d] = 0;
  parDebouche.non_renseigne = 0;
  for (const r of rows) {
    const d = r.debouche && DEBOUCHES.includes(r.debouche) ? r.debouche : 'non_renseigne';
    parDebouche[d] += 1;
  }
  const embauches = rows.filter((r) => r.embauche_accueillant === true).length;

  return {
    conventions: rows.length,          // effectif brut global du bloc
    jours,
    entreprises_distinctes: entreprises.length,
    par_debouche: parDebouche,
    par_debouche_labels: DEBOUCHE_LABELS,
    embauches_chez_accueillant: embauches,
    // Raison sociale d'entreprises d'accueil : ce n'est pas une donnée
    // personnelle EN ELLE-MÊME. Mais sur une période à une ou deux conventions,
    // elle en devient un identifiant indirect (art. 4-1) pour un destinataire
    // qui reçoit par ailleurs les déclarations d'Immersion Facilitée : la liste,
    // les jours et le nombre d'entreprises ne sortent donc que si le nombre de
    // conventions atteint le seuil (correctif B-01, dépendance déclarée dans
    // K_DEPENDANCES_FRATRIE). Aucun compte PAR entreprise n'est publié.
    liste_entreprises: entreprises,
  };
}

/**
 * Charge les lignes de sortie d'une période et les passe au moteur PUR.
 *
 * ═══ POURQUOI CETTE FONCTION EST EXPORTÉE (correctif M-07) ════════════════
 * Le moteur `sorties-engine` documente une PRÉCONDITION : « deux bilans pour un
 * même parcours : le PREMIER rencontré fait foi — la requête appelante les
 * ordonne ». La règle vivait bien à un seul endroit, mais sa précondition
 * avait été recopiée de façon incomplète dans `routes/performance.js`, qui
 * n'ordonnait pas : sur un parcours réouvert puis repris, PostgreSQL ne
 * garantit aucun ordre, et le reporting RH pouvait classer « emploi de
 * transition » ce que la synthèse transmise appelait « emploi durable ».
 * Le chargement vit donc ici, et les appelants l'APPELLENT au lieu de le
 * recopier — une précondition ne se transmet pas par commentaire.
 */
async function chargerSorties(soft, db, p, anneeDoubleMethode) {
  const fins = await soft('fins_parcours', `
    SELECT e.id AS employee_id, COALESCE(e.parcours_num, 1) AS parcours_num
    FROM employees e
    WHERE e.insertion_end_date BETWEEN $1::date AND $2::date
      AND COALESCE(e.insertion_status, 'none') <> 'none'`, [p.debut, p.fin]);

  const bilans = await soft('bilans_sortie', `
    SELECT im.employee_id, COALESCE(im.parcours_num, 1) AS parcours_num,
           im.sortie_classification, im.sortie_type
    FROM insertion_milestones im
    WHERE im.milestone_type = 'bilan_sortie' AND im.status = 'realise'
      AND im.sortie_classification IS NOT NULL
      AND COALESCE(im.completed_date, im.updated_at::date) BETWEEN $1::date AND $2::date
    ORDER BY COALESCE(im.completed_date, im.updated_at::date), im.id`, [p.debut, p.fin]);

  // Sorties déclarées à l'ASP sur la période — le rapprochement que l'autorité
  // demande. Aucune ligne importée → `null`, jamais 0.
  const asp = await soft('sorties_asp', `
    SELECT COUNT(*)::int AS n FROM etp_asp_salaries
    WHERE annee = $1 AND date_sortie IS NOT NULL
      AND date_sortie BETWEEN $2::date AND $3::date`, [p.annee, p.debut, p.fin]);
  const aspImporte = await soft('asp_importe', `
    SELECT COUNT(*)::int AS n FROM etp_asp_salaries WHERE annee = $1`, [p.annee]);
  const sortiesAsp = aspImporte && aspImporte[0] && num(aspImporte[0].n) > 0 && asp && asp[0]
    ? num(asp[0].n) : null;

  const cibles = await lireCibles(db);
  return calculerSorties({
    finsParcours: fins || [],
    bilansClasses: (bilans || []).map(projeterSortieType),
    sortiesAsp,
    annee: p.annee,
    cibles,
    annee_double_methode: anneeDoubleMethode,
  });
}

/** Bloc 6 — Sorties, par le moteur PUR partagé (une seule règle pour tous). */
const bloc6Sorties = chargerSorties;

/**
 * CORRECTIF M-03 — `sortie_type` est un `VARCHAR(50)` SANS CHECK, listé parmi
 * les champs éditables d'un entretien sans validateur de liste fermée : la CIP
 * peut y écrire « CDI chez Leroy Merlin (oncle de M.) ». Le moteur en fait une
 * CLÉ d'objet (`par_type`), rendue par l'API et surtout FIGÉE dans le snapshot
 * `insertion_dialogues_gestion.contenu` — table sans rétention ni accroche
 * d'anonymisation : un texte libre y survivrait à l'anonymisation du salarié
 * qu'il décrit. `services/mon-parcours.js` documente la règle inverse pour la
 * MÊME colonne (« une valeur hors liste devient null, jamais recopiée ») ; on
 * l'applique ici, avec la MÊME liste — la recopier en ferait une seconde.
 * Une valeur hors liste est rangée sous `autre`, jamais perdue en silence.
 */
function projeterSortieType(b) {
  if (!b || !b.sortie_type) return b;
  const { SORTIE_TYPE_LABELS } = require('./mon-parcours');
  const connu = Object.prototype.hasOwnProperty.call(SORTIE_TYPE_LABELS, String(b.sortie_type));
  return { ...b, sortie_type: connu ? String(b.sortie_type) : 'autre' };
}

/** Bloc 7 — Résultats : situation à +6 mois et satisfaction de sortie. */
async function bloc7Resultats(soft, db, p) {
  const rows = await soft('situation_6_mois', `
    SELECT s.situation_6mois, s.date_releve_6mois
    FROM insertion_fse_sorties s
    WHERE s.date_sortie BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  const compte = {};
  for (const s of SITUATIONS_6_MOIS) compte[s] = 0;
  for (const r of (rows || [])) {
    const cle = r.situation_6mois ? (MAP_SITUATION_6_MOIS[r.situation_6mois] || 'autre') : 'non_renseigne';
    compte[cle] += 1;
  }
  const sat = await soft('satisfaction', `
    SELECT COUNT(*)::int AS nb, ROUND(AVG(satisfaction_globale)::numeric, 2) AS moyenne
    FROM insertion_satisfaction_sortie
    WHERE COALESCE(date_reponse, created_at::date) BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  const nbReponses = sat && sat[0] ? num(sat[0].nb) || 0 : 0;
  return {
    situation_6_mois: compte,
    nb_sorties_suivies: rows == null ? null : rows.length,
    satisfaction: {
      nb_reponses: nbReponses,
      // Sous le seuil, la MOYENNE elle-même n'est pas rendue : sur trois
      // réponses, une moyenne se décompose. Même règle que les enquêtes — la
      // suppression est posée par la dépendance `nb_reponses → moyenne_globale`.
      moyenne_globale: sat && sat[0] && sat[0].moyenne != null ? Number(sat[0].moyenne) : null,
      echelle: '1 à 4',
    },
  };
}

/** Bloc 8 — Conformité et ruptures de droits évitées (indicateur 12). */
async function bloc8Conformite(soft, db, p) {
  // Complétude FSE+ par projet — PROJECTION EXPLICITE : `conformiteProjet`
  // rend la liste NOMINATIVE des participants (nom, prénom, identifiant). Seuls
  // les trois agrégats en sortent ; la liste des dossiers incomplets reste sur
  // l'écran interne, où l'autorité la consultera sur place.
  let completude = null;
  const projets = await soft('projets_actifs',
    'SELECT id, code, nom FROM insertion_projets WHERE actif = true ORDER BY code');
  if (projets) {
    completude = [];
    const { conformiteProjet } = require('./fse-participants');
    const periode = p.trimestre ? `${p.annee}-T${p.trimestre}` : null;
    for (const pr of projets) {
      try {
        const c = await conformiteProjet(pr.id, periode, { db });
        if (!c) continue;
        completude.push({
          projet: pr.nom,
          code: pr.code,
          participants: c.nb_total,
          complets: c.nb_complets,
          pct: c.taux_completude,
        });
      } catch (err) {
        console.error(`[INSERTION][DIALOGUE] conformité projet ${pr.code} ignorée : ${err.message}`);
      }
    }
  }

  const un = async (label, sql, params) => {
    const r = await soft(label, sql, params);
    return r && r[0] ? num(r[0].n) : null;
  };

  const pointsEtape = await un('points_etape_referent', `
    SELECT COUNT(*)::int AS n FROM insertion_milestones
    WHERE milestone_type = 'point_etape_referent' AND status = 'realise'
      AND COALESCE(completed_date, due_date) BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  const fiches = await un('fiches_referent', `
    SELECT COUNT(*)::int AS n FROM insertion_alimentations_referent
    WHERE remis_referent_le BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  const actualisations = await un('actualisations_ft', `
    SELECT COUNT(*)::int AS n FROM insertion_actualisations_ft
    WHERE rappel_le BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  const conciliations = await un('conciliations', `
    SELECT COUNT(*)::int AS n FROM insertion_milestones
    WHERE milestone_type = 'conciliation' AND status = 'realise'
      AND COALESCE(completed_date, due_date) BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  const motifsLegitimes = await un('motifs_legitimes', `
    SELECT COUNT(*)::int AS n FROM insertion_milestones
    WHERE presence IN ('absent', 'excuse') AND absence_motif IS NOT NULL
      AND COALESCE(completed_date, due_date) BETWEEN $1::date AND $2::date`, [p.debut, p.fin]);

  // Semaines sous le plancher d'activité — l'indicateur que l'autorité a EXIGÉ
  // à la place de la moyenne (A4 : « à 26 h contractuelles, la moyenne sera
  // toujours confortable et ne dira rien »).
  let semaines = null;
  const cohorte = await soft('cohorte_activite', `
    SELECT e.id FROM employees e
    WHERE COALESCE(e.insertion_status, 'none') <> 'none'
      AND (e.insertion_start_date IS NULL OR e.insertion_start_date <= $2::date)
      AND (e.insertion_end_date IS NULL OR e.insertion_end_date >= $1::date)`, [p.debut, p.fin]);
  if (cohorte && cohorte.length) {
    try {
      const { activiteHebdoCohorte } = require('./activite-hebdo');
      const m = await activiteHebdoCohorte({
        employeeIds: cohorte.map((r) => Number(r.id)), annee: p.annee,
      });
      let personnes = 0; let total = 0; let relevees = 0;
      for (const v of m.values()) {
        const n = num(v && v.nb_semaines_sous_seuil) || 0;
        if (n > 0) personnes += 1;
        total += n;
        relevees += num(v && v.nb_semaines_relevees) || 0;
      }
      // CORRECTIF D-03 — « 0 semaine sous 15 h » et « aucune semaine relevée »
      // sont deux affirmations différentes, et la seconde est la seule vraie
      // quand la paie n'a rien remonté. Le moteur d'activité le SAIT
      // (`nb_semaines_relevees`) ; jusqu'ici seul `nb_semaines_sous_seuil`
      // était lu, et le document affirmait à l'autorité que personne n'était
      // jamais passé sous le plancher. Même doctrine que la PR B pour le relevé
      // d'assiduité : une semaine sans relevé est `null`, jamais 0 h.
      semaines = relevees === 0
        ? {
          nb_personnes_concernees: null,
          nb_semaines: null,
          nb_semaines_relevees: 0,
          note: "Aucune semaine relevée sur la période — l'indicateur n'est pas calculable (ce n'est pas « zéro semaine sous le plancher »).",
        }
        : { nb_personnes_concernees: personnes, nb_semaines: total, nb_semaines_relevees: relevees };
    } catch (err) {
      console.error(`[INSERTION][DIALOGUE] « semaines_sous_seuil » ignorée : ${err.message}`);
    }
  }

  const total = [actualisations, motifsLegitimes, conciliations]
    .filter((v) => v != null).reduce((a, b) => a + b, 0);

  return {
    completude_fse_par_projet: completude,
    points_etape_referent: pointsEtape,
    fiches_referent_transmises: fiches,
    actualisations_ft_rappelees: actualisations,
    semaines_sous_15h: semaines,
    conciliations,
    ruptures_droits_evitees: {
      actualisations_rappelees: actualisations,
      motifs_legitimes_documentes: motifsLegitimes,
      conciliations_tracees: conciliations,
      total: (actualisations == null && motifsLegitimes == null && conciliations == null) ? null : total,
    },
  };
}

/**
 * Bloc 9 — Méthode. Une ligne par taux, en français, « objectif non paramétré »
 * compris. C'est le bloc que l'autorité lit en premier quand un chiffre la
 * surprend ; il est composé À PARTIR des blocs réellement produits, pour qu'une
 * règle n'y figure jamais pour un indicateur absent.
 */
function bloc9Methode(blocs, contexte) {
  const lignes = [];
  const ajouter = (indicateur, regle) => lignes.push({ indicateur, regle });

  ajouter('Périmètre',
    `Parcours d'insertion (CDDI / CDI inclusion) dont la période d'accompagnement chevauche ${contexte.libellePeriode}. Les salariés permanents de la structure en sont exclus.`);

  if (blocs['1_effectifs_etp']) {
    const b = blocs['1_effectifs_etp'];
    ajouter('ETP — base de calcul',
      `Base unique de ${milliers(b.base_heures)} heures annuelles par ETP. L'ETP validé sur les états mensuels de présence ASP FAIT FOI ; l'« effectif pondéré » est un contrôle interne (somme des quotités contractuelles divisées par 35 h hebdomadaires, ce qui est la même base), calculé sur les seuls contrats de type CDDI : le CDI Inclusion se reconnaît à l'intitulé du poste et non au type de contrat, il n'y est donc pas compté. L'écran « Effectifs conventionnés (ETP) » applique, lui, la règle complète.`);
    ajouter('Taux de réalisation des ETP',
      b.etp_conventionnes == null
        ? "Objectif non paramétré : l'annexe financière (ETP conventionnés) n'est pas saisie dans l'outil — aucun taux n'est calculé."
        : `Moyenne des ETP ASP validés des ${b.nb_mois_asp_valides} mois disponibles, divisée par ${b.etp_conventionnes} ETP conventionnés.`);
  }

  if (blocs['2_publics_entree'] && !blocs['2_publics_entree'].indisponible) {
    ajouter('Publics — effectif de référence',
      `Effectif de ${blocs['2_publics_entree'].effectif} personne(s) : toute personne dont le parcours chevauche la période, qu'elle soit encore présente ou déjà sortie.`);
    ajouter("Critères d'éligibilité",
      "Un critère est compté une fois par personne, depuis le référentiel d'éligibilité IAE saisi au dossier administratif. Une personne peut relever de plusieurs critères : la somme des lignes dépasse donc l'effectif.");
    ajouter('BRSA',
      "Compte de l'outil (statut constaté au dossier) présenté à côté du nombre déclaré sur le dernier état mensuel ASP disponible. Un écart n'est pas une anomalie : les deux comptes ne se font pas à la même date.");
  }

  if (blocs['3_freins'] && blocs['3_freins'].actions_illisibles) {
    ajouter('Freins — actions engagées',
      "Indicateur non rendu : la source (actions d'accompagnement rattachées à un axe de frein) n'a pas pu être lue sur la période. Aucune valeur n'est estimée — « 0 action » aurait été faux dans le sens qui dessert la structure.");
  }

  if (blocs['3_freins']) {
    ajouter('Freins — évolution',
      "Comparaison du niveau relevé au diagnostic d'accueil et du niveau de la DERNIÈRE évaluation en date (dernier entretien réalisé du parcours courant portant au moins un frein). Levé = baisse d'au moins un niveau ; aggravé = hausse d'au moins un niveau ; stable sinon ; non évalué dès que l'une des deux valeurs manque. L'échelle va de 1 (pas de difficulté) à 5 (bloquant).");
    ajouter('Freins — concernés à l\'entrée',
      'Personnes dont le niveau au diagnostic est de 2 ou plus sur cet axe.');
  }

  if (blocs['4_accompagnement'] && blocs['4_accompagnement'].entretiens_illisibles) {
    ajouter('Entretiens',
      "Indicateur non rendu : la source (entretiens de la période) n'a pas pu être lue. Le tableau des entretiens est vide parce qu'il n'est pas calculable, non parce qu'aucun entretien n'a eu lieu.");
  }

  if (blocs['4_accompagnement'] && blocs['4_accompagnement'].aides_mobilisees == null) {
    ajouter('Aides mobilisées',
      "Indicateur non rendu : la source (aides mobilisées sur les actions d'accompagnement) n'a pas pu être lue sur la période.");
  }

  if (blocs['4_accompagnement']) {
    ajouter('Entretiens — taux de réalisation',
      "Entretiens réalisés parmi ceux dont l'échéance est passée à la date de génération (ou à la fin de la période si elle est antérieure). Un type sans échéance passée n'a pas de taux.");
    if (blocs['4_accompagnement'].heures_accompagnement == null) {
      ajouter("Heures d'accompagnement",
        "Non rendues : la source (feuilles de temps et durées d'entretien) n'a pas pu être lue sur la période — aucune valeur n'est estimée.");
    } else {
      ajouter("Heures d'accompagnement",
        "Somme des durées saisies aux entretiens et aux actions d'accompagnement, plus les saisies hors salarié des intervenants. La ventilation par personne n'entre pas dans ce document (elle existe, elle est nominative, elle se consulte sur place).");
    }
    ajouter('Aides mobilisées',
      "Actions d'accompagnement portant une nature d'aide, comptées sur la période. Un montant total n'est rendu que si au moins une aide de cette nature est chiffrée : une aide non chiffrée ne vaut pas zéro euro.");
  }

  if (blocs['5_immersions'] && !blocs['5_immersions'].indisponible) {
    ajouter('Immersions (PMSMP)',
      "Conventions dont la date de début tombe dans la période. Les jours sont des jours calendaires (date de fin moins date de début, plus un). La saisie officielle reste celle d'Immersion Facilitée.");
    ajouter('Débouché des immersions',
      "Saisi par la conseillère à la clôture de l'immersion. « Non renseigné » distingue l'immersion dont on n'a pas encore la suite de celle dont on sait qu'elle n'a pas eu de débouché.");
  }

  if (blocs['6_sorties']) {
    for (const r of (blocs['6_sorties'].regles || [])) ajouter('Sorties', r);
    if (blocs['6_sorties'].rapprochement_asp) {
      ajouter('Sorties — rapprochement ASP', blocs['6_sorties'].rapprochement_asp.note);
    }
  }

  if (blocs['7_resultats']) {
    ajouter('Situation à +6 mois',
      "Relevé effectué six mois après la sortie de l'opération, saisi au dossier. « Injoignable » et « non renseigné » sont deux lignes distinctes : la première est un constat, la seconde un relevé qui reste à faire.");
  }

  if (blocs['8_conformite']) {
    ajouter('Alimentation du référent unique',
      "Points d'étape = entretiens de type « Point avec le référent » réalisés sur la période. Fiches transmises = fiches d'alimentation dont la REMISE au référent est tracée sur la période (une fiche générée et non remise n'est pas comptée).");
    if (blocs['8_conformite'].semaines_sous_15h
        && blocs['8_conformite'].semaines_sous_15h.nb_semaines_relevees === 0) {
      ajouter("Semaines sous le plancher d'activité — non calculable",
        "Aucune semaine n'a été relevée sur la période (aucun relevé de paie hebdomadaire pour la cohorte) : l'indicateur n'est pas rendu. Ce n'est PAS « zéro semaine sous le plancher » — l'activité n'a simplement pas pu être mesurée.");
    }
    ajouter('Semaines sous le plancher d\'activité',
      `Nombre de semaines RELEVÉES dont l'activité cumulée (travail en CDDI, accompagnement, immersion) est inférieure au plancher paramétré (${contexte.seuilHeures} h). Une semaine sans relevé de paie n'est jamais comptée comme une semaine à zéro heure. L'indicateur est un nombre de semaines, jamais une moyenne.`);
    ajouter('Ruptures de droits évitées',
      "Somme des actualisations France Travail rappelées, des absences dont le motif légitime est documenté, et des entretiens de conciliation tracés. Ce n'est pas un indicateur de performance : c'est le compte des gestes de protection que la structure est seule à pouvoir poser.");
  }

  ajouter('Agrégats non rendus (k-anonymat)',
    `Tout agrégat comptant entre 1 et ${contexte.k - 1} personnes est rendu vide pour empêcher une ré-identification par recoupement — y compris les comptes d'actions, d'orientations, d'aides et de gestes de conformité, qui portent chacun sur au moins une personne. Les valeurs nulles (« personne dans cette catégorie ») sont conservées telles quelles : elles ne désignent personne. Le nombre d'indicateurs retirés est indiqué bloc par bloc en fin de document ; leur emplacement exact ne l'est pas, parce qu'il indiquerait la case à reconstituer.`);

  ajouter('Suppression complémentaire',
    "Quand une ventilation somme à un effectif publié et qu'une seule de ses cases a été retirée, cette case se retrouverait par soustraction : une seconde case (la plus petite publiée) est alors retirée elle aussi. C'est la raison pour laquelle deux lignes peuvent manquer là où une seule était sous le seuil.");

  ajouter('Taux et effectifs retirés',
    "Un taux dont le dénominateur est publié redonne son numérateur par multiplication : il est donc retiré en même temps que l'effectif qu'il reflète. À l'inverse, un taux dont le dénominateur est lui-même retiré ne reconstitue rien et reste rendu.");

  if (contexte.sousSeuilTotal === 0) {
    ajouter('Agrégats non rendus — résultat',
      "Aucun agrégat n'a été retiré au titre du seuil de confidentialité sur cette période.");
  }

  ajouter('Source des chiffres',
    "Tous les chiffres proviennent de l'ERP SOLIDATA. Les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE+) font foi en cas d'écart.");

  return lignes;
}

// ───────────────────────────────────────────────────────────────────────────
// Composition
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compose la synthèse de dialogue de gestion.
 *
 * @param {object} p
 * @param {number} p.annee année civile.
 * @param {number|null} [p.trimestre] 1-4 → version allégée (blocs 2 et 8 seuls,
 *   ceux que l'autorité relit quatre fois par an) ; `null` → version annuelle.
 * @param {{query: Function}} [p.db] pool ou client de transaction.
 * @param {object} [p.user] utilisateur générateur — seul son RÔLE est imprimé.
 * @returns {Promise<{en_tete: object, blocs: object, sous_seuil: string[]}>}
 */
async function composerDialogueGestion({ annee, trimestre = null, db = pool, user = null } = {}) {
  const p = bornes(annee, trimestre);
  if (!p) throw Object.assign(new Error('Année invalide'), { code: 'ANNEE_INVALIDE' });

  const soft = faireSoft(db);
  // CORRECTIF m-02 — PLANCHER à 5. Le réglage n'avait aucune borne basse : une
  // valeur à 1 désactivait toute suppression EN SILENCE, pendant que le bloc 9
  // continuait d'écrire « tout agrégat comptant entre 1 et 0 personnes est
  // rendu vide ». Un seuil de confidentialité ne se baisse pas par un champ de
  // réglage ; il se relève.
  const seuilBrut = num(await readInsertionSetting('insertion.k_anonymat_min'));
  const seuil = seuilBrut != null && seuilBrut > 5 ? Math.round(seuilBrut) : 5;

  const anneeDouble = num(await readInsertionSetting('insertion.sorties_methode_double_annee'));
  const seuilHeures = num(await readInsertionSetting('insertion.cer_heures_min')) ?? 15;

  const blocs = {};
  const allege = p.trimestre != null;

  if (!allege) blocs['1_effectifs_etp'] = await bloc1Effectifs(soft, db, p);
  blocs['2_publics_entree'] = await bloc2Publics(soft, db, p);
  if (!allege) {
    blocs['3_freins'] = await bloc3Freins(soft, db, p);
    blocs['4_accompagnement'] = await bloc4Accompagnement(soft, db, p);
    blocs['5_immersions'] = await bloc5Immersions(soft, db, p);
    blocs['6_sorties'] = await bloc6Sorties(soft, db, p, anneeDouble);
    blocs['7_resultats'] = await bloc7Resultats(soft, db, p);
  }
  blocs['8_conformite'] = await bloc8Conformite(soft, db, p);

  // ═══ LA PASSE DE k-ANONYMAT ═══════════════════════════════════════════
  // Elle vient APRÈS la composition et AVANT le bloc « Méthode », pour que
  // celui-ci décrive le document tel qu'il part et non tel qu'il a été
  // calculé. Elle porte sur TOUS les blocs, y compris ceux qui n'existent pas
  // encore.
  const sousSeuil = appliquerKAnonymat({ blocs }, seuil);
  const sousSeuilTotal = sousSeuil.reduce((a, b) => a + b.nb, 0);

  const libellePeriode = p.trimestre
    ? `le ${p.trimestre}ᵉ trimestre ${p.annee} (du ${p.debut} au ${p.fin})`
    : `l'année ${p.annee}`;
  blocs['9_methode'] = bloc9Methode(blocs, {
    libellePeriode, k: seuil, seuilHeures, sousSeuilTotal,
  });

  return {
    en_tete: {
      structure: STRUCTURE,
      annee: p.annee,
      trimestre: p.trimestre,
      periode_debut: p.debut,
      periode_fin: p.fin,
      genere_le: new Date().toISOString(),
      // Le RÔLE, jamais le nom : l'autorité demande de savoir à quel titre le
      // document a été produit, pas qui l'a cliqué. Le nom du signataire
      // (« la direction ») figure en pied du PDF.
      genere_par_role: user && user.role ? String(user.role) : null,
      version: APP_VERSION,
      perimetre: PERIMETRE,
      mention: MENTION,
      type: p.trimestre ? 'trimestrielle_allegee' : 'annuelle',
      k_anonymat: seuil,
    },
    blocs,
    // Un COMPTE par bloc, jamais le chemin de la case retirée (voir
    // `appliquerKAnonymat`). La forme reste un tableau : les appelants qui
    // comptent (`.length`) comptent désormais des blocs, et `sous_seuil_total`
    // dit combien d'indicateurs sont concernés.
    sous_seuil: sousSeuil,
    sous_seuil_total: sousSeuilTotal,
  };
}

/**
 * Aplatit la synthèse en lignes `[Bloc, Indicateur, Valeur]` pour le CSV.
 * Une valeur non rendue s'écrit **cellule vide**, jamais zéro — et la ligne
 * existe quand même : l'absence est une information, la faire disparaître n'en
 * est pas une.
 */
function aplatirEnLignes(synthese) {
  const out = [];
  const B = synthese.blocs || {};
  const push = (bloc, indicateur, valeur) => out.push([bloc, indicateur, valeur == null ? '' : valeur]);

  if (B['1_effectifs_etp']) {
    const b = B['1_effectifs_etp'];
    const nom = '1. Effectifs et ETP';
    push(nom, 'Base de calcul (heures annuelles par ETP)', b.base_heures);
    push(nom, 'ETP conventionnés (annexe financière)',
      b.etp_conventionnes == null ? 'objectif non paramétré' : b.etp_conventionnes);
    push(nom, 'ETP ASP moyen (mois validés)', b.etp_asp_moyen);
    push(nom, 'Nombre de mois ASP validés', b.nb_mois_asp_valides);
    push(nom, 'Taux de réalisation (%)',
      b.taux_realisation_pct == null ? 'objectif non paramétré' : b.taux_realisation_pct);
    for (const m of b.mois || []) {
      push(nom, `ETP ASP — ${m.mois}`, m.etp_asp);
      push(nom, `Effectif pondéré (contrôle ERP) — ${m.mois}`, m.effectif_pondere);
    }
  }

  const b2 = B['2_publics_entree'];
  if (b2 && !b2.indisponible) {
    const nom = "2. Publics à l'entrée";
    push(nom, 'Effectif de la cohorte', b2.effectif);
    for (const c of b2.par_critere_eligibilite || []) {
      push(nom, `Critère d'éligibilité — ${c.libelle}`, c.n);
      push(nom, `Critère d'éligibilité — ${c.libelle} (part %)`, c.part_pct);
    }
    push(nom, 'BRSA — effectif', b2.brsa?.n);
    push(nom, 'BRSA — part (%)', b2.brsa?.part_pct);
    push(nom, 'BRSA — déclaré à l\'ASP', b2.brsa?.n_asp);
    for (const [c, n] of Object.entries(b2.par_categorie_ft || {})) push(nom, `Catégorie France Travail ${c}`, n);
    for (const [t, n] of Object.entries(b2.par_referent_unique || {})) push(nom, `Référent unique — ${t}`, n);
    for (const [s, n] of Object.entries(b2.sexe || {})) push(nom, `Sexe — ${s}`, n);
    for (const [t, n] of Object.entries(b2.tranches_age || {})) push(nom, `Tranche d'âge — ${t}`, n);
    for (const [f, n] of Object.entries(b2.niveaux_formation || {})) push(nom, `Niveau de formation — ${f}`, n);
  }

  if (B['3_freins']) {
    const nom = '3. Freins';
    for (const a of B['3_freins'].par_axe || []) {
      push(nom, `${a.label} — concernés à l'entrée`, a.concernes_entree);
      push(nom, `${a.label} — levés`, a.leves);
      push(nom, `${a.label} — stables`, a.stables);
      push(nom, `${a.label} — aggravés`, a.aggraves);
      push(nom, `${a.label} — non évalués`, a.non_evalues);
      push(nom, `${a.label} — actions engagées`, a.actions_engagees);
      push(nom, `${a.label} — partenaire principal`, a.partenaire_principal);
      push(nom, `${a.label} — orientations DORA`, a.orientations_dora);
      for (const [r, n] of Object.entries(a.dora_resultats || {})) {
        push(nom, `${a.label} — DORA ${r}`, n);
      }
    }
  }

  if (B['4_accompagnement']) {
    const nom = '4. Accompagnement';
    if (B['4_accompagnement'].aides_mobilisees == null) {
      push(nom, 'Aides mobilisées', 'source non lisible — indicateur non rendu');
    }
    for (const e of B['4_accompagnement'].entretiens || []) {
      push(nom, `${e.label} — réalisés`, e.realises);
      push(nom, `${e.label} — échus`, e.echus);
      push(nom, `${e.label} — taux (%)`, e.taux_pct);
    }
    const h = B['4_accompagnement'].heures_accompagnement;
    push(nom, "Heures d'accompagnement — total", h ? h.total_h : null);
    push(nom, "Heures d'accompagnement — personnes concernées", h ? h.nb_personnes : null);
    push(nom, "Heures d'accompagnement — moyenne par personne", h ? h.moyenne_par_personne_h : null);
    push(nom, 'Délai moyen du diagnostic (jours)', B['4_accompagnement'].delai_moyen_diagnostic_jours);
    for (const a of B['4_accompagnement'].aides_mobilisees || []) {
      push(nom, `Aide — ${a.label} (nombre)`, a.n);
      push(nom, `Aide — ${a.label} (montant total €)`, a.montant_total);
    }
  }

  const b5 = B['5_immersions'];
  if (b5 && !b5.indisponible) {
    const nom = '5. Immersions';
    push(nom, 'Conventions', b5.conventions);
    push(nom, 'Jours calendaires', b5.jours);
    push(nom, 'Entreprises distinctes', b5.entreprises_distinctes);
    for (const [d, n] of Object.entries(b5.par_debouche || {})) {
      push(nom, `Débouché — ${DEBOUCHE_LABELS[d] || d}`, n);
    }
    push(nom, "Dont embauche chez l'entreprise d'accueil", b5.embauches_chez_accueillant);
    push(nom, "Entreprises d'accueil", (b5.liste_entreprises || []).join(' | '));
  }

  if (B['6_sorties']) {
    const nom = '6. Sorties';
    const mb = B['6_sorties'].methode_b || {};
    push(nom, 'Méthode B — dénominateur (fins de parcours)', mb.denominateur);
    push(nom, 'Méthode B — sorties documentées', mb.documentees);
    push(nom, 'Méthode B — sorties NON documentées', mb.non_documentees);
    for (const [c, n] of Object.entries(mb.par_classification || {})) push(nom, `Méthode B — ${c}`, n);
    for (const [c, v] of Object.entries(mb.taux_pct || {})) push(nom, `Méthode B — taux ${c} (%)`, v);
    for (const [c, v] of Object.entries(mb.ecart_cible || {})) {
      push(nom, `Méthode B — écart à la cible ${c} (pts)`, v);
    }
    if (!mb.ecart_cible) push(nom, 'Méthode B — écart aux cibles', 'objectif non paramétré');
    const ma = B['6_sorties'].methode_a;
    if (ma) {
      push(nom, 'Méthode A (historique) — dénominateur (bilans classés)', ma.denominateur);
      for (const [c, n] of Object.entries(ma.par_classification || {})) push(nom, `Méthode A — ${c}`, n);
      for (const [c, v] of Object.entries(ma.taux_pct || {})) push(nom, `Méthode A — taux ${c} (%)`, v);
    }
    const asp = B['6_sorties'].rapprochement_asp || {};
    push(nom, 'Sorties déclarées à l\'ASP', asp.sorties_asp);
    push(nom, 'Écart outil / ASP', asp.ecart);
  }

  if (B['7_resultats']) {
    const nom = '7. Résultats';
    for (const [s, n] of Object.entries(B['7_resultats'].situation_6_mois || {})) {
      push(nom, `Situation à +6 mois — ${s}`, n);
    }
    push(nom, 'Satisfaction — réponses', B['7_resultats'].satisfaction?.nb_reponses);
    push(nom, 'Satisfaction — moyenne (1-4)', B['7_resultats'].satisfaction?.moyenne_globale);
  }

  if (B['8_conformite']) {
    const nom = '8. Conformité';
    const b8 = B['8_conformite'];
    for (const c of b8.completude_fse_par_projet || []) {
      push(nom, `FSE+ ${c.projet} — participants`, c.participants);
      push(nom, `FSE+ ${c.projet} — dossiers complets`, c.complets);
      push(nom, `FSE+ ${c.projet} — complétude (%)`, c.pct);
    }
    push(nom, 'Points d\'étape avec le référent', b8.points_etape_referent);
    push(nom, 'Fiches d\'alimentation remises au référent', b8.fiches_referent_transmises);
    push(nom, 'Actualisations France Travail rappelées', b8.actualisations_ft_rappelees);
    push(nom, 'Semaines sous le plancher — personnes concernées', b8.semaines_sous_15h?.nb_personnes_concernees);
    push(nom, 'Semaines sous le plancher — nombre de semaines', b8.semaines_sous_15h?.nb_semaines);
    if (b8.semaines_sous_15h && b8.semaines_sous_15h.nb_semaines_relevees === 0) {
      push(nom, 'Semaines sous le plancher — note', b8.semaines_sous_15h.note);
    }
    push(nom, 'Entretiens de conciliation', b8.conciliations);
    push(nom, 'Ruptures de droits évitées — total', b8.ruptures_droits_evitees?.total);
  }

  for (const m of B['9_methode'] || []) push('9. Méthode', m.indicateur, m.regle);
  // CORRECTIF D-06 — le libellé nommait « moins de 5 personnes » EN DUR alors
  // que le seuil est paramétrable et que le bloc 9, lui, le composait
  // correctement : le même fichier énonçait donc deux règles contradictoires
  // sur sa propre méthode de suppression. Le seuil vient désormais de
  // l'en-tête, source unique du document.
  const seuil = Number(synthese?.en_tete?.k_anonymat) || 5;
  for (const b of synthese.sous_seuil || []) {
    push('9. Méthode',
      `Agrégats non rendus (moins de ${seuil} personnes) — ${b.libelle || b.bloc}`, b.nb);
  }

  return out;
}

/**
 * Les MÊMES agrégats, composés pour un ÉCRAN INTERNE (`/insertion/audit`).
 *
 * Deux différences avec la synthèse transmise, et deux seulement :
 *   · **aucune suppression k-anonymat** — l'écran est consulté par les personnes
 *     qui tiennent les dossiers, pour qui « 2 freins levés sur l'axe mobilité »
 *     est une information de travail, pas une ré-identification ;
 *   · **pas d'en-tête de traçabilité** — rien ne sort de la structure.
 *
 * Tout le reste passe par les MÊMES fonctions : c'est la garantie que l'écran
 * de pilotage et le document transmis à l'autorité ne peuvent pas se
 * contredire. Recopier ces requêtes dans `gatherAuditKpis` aurait produit deux
 * chiffres pour le même indicateur, dans deux documents qui portent la même
 * signature.
 */
async function composerBlocsInternes({ annee, db = pool, avecPublics = true } = {}) {
  const p = bornes(annee, null);
  if (!p) return null;
  const soft = faireSoft(db);
  const anneeDouble = num(await readInsertionSetting('insertion.sorties_methode_double_annee'));

  // CORRECTIF B-02 — les blocs de STATUT SOCIAL ne sont pas composés hors
  // ADMIN/RH : leur requête ne part pas. Un filtrage après lecture serait un
  // refus d'affichage, pas un refus d'accès (doctrine `echeances-cip.js` en
  // PR C). L'appelant décide, parce que la frontière est le RÔLE et que le
  // service, lui, n'en connaît aucun.
  const [publics, freins, immersions, sorties, conformite, accompagnement, etp] = await Promise.all([
    avecPublics ? bloc2Publics(soft, db, p) : Promise.resolve(null),
    bloc3Freins(soft, db, p),
    bloc5Immersions(soft, db, p),
    bloc6Sorties(soft, db, p, anneeDouble),
    bloc8Conformite(soft, db, p),
    bloc4Accompagnement(soft, db, p),
    bloc1Effectifs(soft, db, p),
  ]);
  return { publics, freins, immersions, sorties, conformite, accompagnement, etp };
}

module.exports = {
  composerDialogueGestion,
  composerBlocsInternes,
  chargerSorties,
  faireSoft,
  aplatirEnLignes,
  appliquerKAnonymat,
  bornes,
  faireKAnon,
  K_EFFECTIFS_PUBLIES,
  AXES_BLOC3,
  DEBOUCHES,
  DEBOUCHE_LABELS,
  AIDE_NATURES,
  AIDE_LABELS,
  DORA_RESULTATS,
  SITUATIONS_6_MOIS,
  MENTION,
  PERIMETRE,
  APP_VERSION,
};
