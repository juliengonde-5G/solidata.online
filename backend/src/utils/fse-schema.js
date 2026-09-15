/**
 * Schéma TYPÉ des questionnaires participant FSE+ (PR A « Conformité
 * immédiate », lot 2 — plan 07 § 3 item 2.2).
 *
 * POURQUOI CE FICHIER EXISTE. Jusqu'ici `insertion_diagnostics.fse_entree` et
 * `insertion_milestones.fse_sortie` étaient deux JSONB libres : n'importe quelle
 * clé, n'importe quelle valeur, aucune complétude calculable — et l'export
 * recrachait le JSON brut dans UNE cellule, ce que l'autorité refuse (« une
 * colonne par item, en français, jamais de JSON », 09 § 2). Un schéma typé rend
 * trois choses possibles : refuser une valeur hors liste au moment de la saisie,
 * dire à la CIP ce qui manque (n/5), et écrire une colonne par item à l'export.
 *
 * MODULE PUR : aucune E/S, aucune dépendance. Tout ce qui touche la base vit
 * dans services/fse-participants.js ; tout ce qui touche HTTP vit dans les
 * routeurs. Les tests l'exercent sans PostgreSQL.
 *
 * EXTENSIBILITÉ ASSUMÉE. Les questions EXACTES de Ma Démarche FSE+ ne sont pas
 * publiées : elles restent « à confirmer sur la plateforme » (09 § 1.4 F6).
 * Ajouter un item = ajouter une entrée à la liste ci-dessous ; la validation,
 * la complétude, l'écran et l'export suivent sans autre modification.
 */

/** Item « texte libre » : plafond de longueur (une note de contexte, pas un récit). */
const MAX_TEXTE = 2000;

/**
 * Questionnaire d'ENTRÉE dans l'opération.
 * `obligatoire: true` = compté dans la complétude (5 items → « n/5 » à l'écran).
 * `alias` = valeurs héritées acceptées en écriture et NORMALISÉES vers la
 * valeur canonique : les diagnostics saisis avant la PR A portent les libellés
 * de l'ancien formulaire libre (`moins_6_mois`…). Les refuser rendrait
 * inenregistrable un dossier déjà rempli — on les convertit, on ne les perd pas.
 */
const FSE_ENTREE_ITEMS = [
  {
    cle: 'statut_avant_entree',
    libelle: "Situation avant l'entrée",
    type: 'enum',
    obligatoire: true,
    valeurs: ['demandeur_emploi', 'inactif', 'emploi', 'formation'],
    labels: {
      demandeur_emploi: "Demandeur d'emploi",
      inactif: 'Inactif (ni emploi ni recherche)',
      emploi: 'En emploi',
      formation: 'En formation',
    },
  },
  {
    cle: 'duree_sans_emploi',
    libelle: "Durée sans emploi avant l'entrée",
    type: 'enum',
    obligatoire: true,
    valeurs: ['lt_6m', '6_12m', '12_24m', 'gt_24m'],
    alias: {
      moins_6_mois: 'lt_6m', '6_12_mois': '6_12m', '12_24_mois': '12_24m', plus_24_mois: 'gt_24m',
    },
    labels: {
      lt_6m: 'Moins de 6 mois', '6_12m': '6 à 12 mois', '12_24m': '12 à 24 mois', gt_24m: 'Plus de 24 mois',
    },
  },
  { cle: 'foyer_monoparental', libelle: 'Foyer monoparental', type: 'bool', obligatoire: true },
  { cle: 'sans_domicile_stable', libelle: 'Sans domicile stable', type: 'bool', obligatoire: true },
  {
    cle: 'ressources_principales',
    libelle: 'Ressources principales',
    type: 'enum',
    obligatoire: true,
    valeurs: ['rsa', 'are', 'aah', 'ass', 'aucune', 'autre'],
    labels: {
      rsa: 'RSA', are: 'ARE (allocation chômage)', aah: 'AAH', ass: 'ASS',
      aucune: 'Aucune ressource', autre: 'Autre',
    },
  },
  { cle: 'commentaire', libelle: 'Commentaire', type: 'texte', obligatoire: false },
];

/** Situations de sortie — même liste que le CHECK de `insertion_fse_sorties`. */
const SITUATIONS_SORTIE = [
  'emploi_durable', 'emploi_transition', 'formation',
  'autre_sortie_positive', 'inactivite', 'chomage', 'inconnue',
];

/**
 * Relevé à +6 mois : mêmes situations, plus « injoignable » — la personne partie
 * sans laisser de numéro n'a pas une situation « non renseignée » (ce serait un
 * oubli de la CIP), elle est INJOIGNABLE, et l'autorité veut distinguer les deux
 * (colonne 27 de l'export). Jamais proposée à la sortie elle-même.
 */
const SITUATIONS_6MOIS = [...SITUATIONS_SORTIE, 'injoignable'];

const SITUATION_SORTIE_LABELS = {
  emploi_durable: 'Emploi durable',
  emploi_transition: 'Emploi de transition',
  formation: 'Formation',
  autre_sortie_positive: 'Autre sortie positive',
  inactivite: 'Inactivité',
  chomage: "Chômage (demandeur d'emploi)",
  inconnue: 'Non renseignée',
  injoignable: 'Injoignable',
};

/** Questionnaire de SORTIE de l'opération. */
const FSE_SORTIE_ITEMS = [
  {
    cle: 'situation_sortie',
    libelle: 'Situation à la sortie',
    type: 'enum',
    obligatoire: true,
    valeurs: SITUATIONS_SORTIE,
    labels: SITUATION_SORTIE_LABELS,
  },
  {
    cle: 'type_contrat',
    libelle: 'Type de contrat à la sortie',
    type: 'enum',
    obligatoire: true,
    valeurs: ['cdi', 'cdd_6m_plus', 'cdd_moins_6m', 'interim', 'creation', 'formation_qualifiante', 'autre', 'sans_objet'],
    labels: {
      cdi: 'CDI',
      cdd_6m_plus: 'CDD de 6 mois ou plus',
      cdd_moins_6m: 'CDD de moins de 6 mois',
      interim: 'Intérim',
      creation: "Création d'activité",
      formation_qualifiante: 'Formation qualifiante',
      autre: 'Autre',
      sans_objet: 'Sans objet (pas de contrat)',
    },
  },
  { cle: 'commentaire', libelle: 'Commentaire', type: 'texte', obligatoire: false },
];

/** Une valeur « vide » n'est pas une réponse : null, '', et rien d'autre. */
function estVide(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Normalise un booléen tolérant (cases à cocher, chaînes « oui »/« non »). */
function normaliserBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'oui', 'yes'].includes(s)) return true;
  if (['false', '0', 'non', 'no'].includes(s)) return false;
  return undefined; // valeur illisible → erreur de validation, jamais un `false` inventé
}

/**
 * Valide et NORMALISE un objet de questionnaire.
 *
 * Doctrine : une clé inconnue est une ERREUR et non un champ ignoré — un item
 * ajouté côté écran sans l'être ici doit se voir tout de suite, sinon la
 * réponse part dans le JSONB et disparaît de l'export sans que personne ne le
 * sache. Une valeur vide EFFACE la réponse (la CIP doit pouvoir revenir en
 * arrière) ; elle n'est jamais remplacée par une valeur par défaut.
 *
 * @param {object} obj objet reçu du client
 * @param {Array} items FSE_ENTREE_ITEMS ou FSE_SORTIE_ITEMS
 * @returns {{ok:boolean, erreurs:Array<{cle:string,motif:string}>, valeurs:object}}
 */
function valider(obj, items) {
  const erreurs = [];
  const valeurs = {};
  if (obj === null || obj === undefined) return { ok: true, erreurs, valeurs };
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, erreurs: [{ cle: null, motif: 'Le questionnaire doit être un objet.' }], valeurs };
  }
  const parCle = new Map(items.map((i) => [i.cle, i]));
  for (const [cle, brut] of Object.entries(obj)) {
    const item = parCle.get(cle);
    if (!item) {
      erreurs.push({ cle, motif: `Champ inconnu du questionnaire (attendus : ${items.map((i) => i.cle).join(', ')}).` });
      continue;
    }
    if (estVide(brut)) continue; // réponse effacée — la clé disparaît de l'objet
    if (item.type === 'bool') {
      const b = normaliserBool(brut);
      if (b === undefined) erreurs.push({ cle, motif: `${item.libelle} : réponse attendue Oui ou Non.` });
      else valeurs[cle] = b;
    } else if (item.type === 'enum') {
      const s = String(brut).trim();
      const canon = item.valeurs.includes(s) ? s : (item.alias && item.alias[s]) || null;
      if (!canon) erreurs.push({ cle, motif: `${item.libelle} : valeur hors liste (${item.valeurs.join(', ')}).` });
      else valeurs[cle] = canon;
    } else { // texte
      const s = String(brut);
      if (s.length > MAX_TEXTE) erreurs.push({ cle, motif: `${item.libelle} : ${MAX_TEXTE} caractères maximum.` });
      else valeurs[cle] = s;
    }
  }
  return { ok: erreurs.length === 0, erreurs, valeurs };
}

/**
 * Complétude d'un questionnaire : seuls les items OBLIGATOIRES comptent — le
 * commentaire est une aide, pas une pièce du dossier. Renvoie aussi la liste
 * des clés manquantes, que l'écran transforme en liens vers le champ.
 */
function completude(obj, items) {
  const requis = items.filter((i) => i.obligatoire);
  const src = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const manquants = requis.filter((i) => estVide(src[i.cle])).map((i) => i.cle);
  const renseignes = requis.length - manquants.length;
  return {
    total: requis.length,
    renseignes,
    manquants,
    complet: manquants.length === 0,
    // Pourcentage arrondi — jamais NaN même si la liste d'items devenait vide.
    pct: requis.length === 0 ? 0 : Math.round((renseignes / requis.length) * 100),
  };
}

/**
 * Suggestions de réponse au questionnaire d'ENTRÉE, déduites des rubriques déjà
 * remplies (amendement CIP du 08 § 10 : « pré-rempli par déduction … la CIP
 * confirme ou corrige en un clic »).
 *
 * RÈGLE ABSOLUE : jamais une suggestion sans source LISIBLE. Chaque proposition
 * porte la phrase que l'écran affiche (« proposé depuis « … » ») ; si le champ
 * source n'est pas renseigné, il n'y a PAS de suggestion — on ne devine pas, on
 * se tait. Rien n'est enregistré : la suggestion est une proposition à l'écran,
 * la valeur n'entre en base que si la CIP la confirme.
 *
 * @param {object} diagnosticRow ligne de `insertion_diagnostics` (valeurs en clair)
 * @param {object} employeeRow ligne de `employees`
 * @returns {object} { cle: { valeur, source } } — uniquement les items déductibles
 */
function suggestionsEntree(diagnosticRow, employeeRow) {
  const d = diagnosticRow && typeof diagnosticRow === 'object' ? diagnosticRow : {};
  const e = employeeRow && typeof employeeRow === 'object' ? employeeRow : {};
  const s = {};

  // Sans domicile stable ← rubrique Logement. « Hébergé » vaut sans domicile
  // stable au sens FSE+ (pas de titre d'occupation propre) ; un statut de
  // locataire ou de propriétaire vaut l'inverse. Tout autre cas : silence.
  if (d.logement_statut === 'sans_abri') {
    s.sans_domicile_stable = { valeur: true, source: 'Logement : sans domicile' };
  } else if (d.logement_statut === 'heberge') {
    s.sans_domicile_stable = { valeur: true, source: 'Logement : hébergé chez un tiers' };
  } else if (['locataire_social', 'locataire_prive', 'proprietaire'].includes(d.logement_statut)) {
    s.sans_domicile_stable = { valeur: false, source: 'Logement : logement personnel déclaré' };
  }

  // Foyer monoparental ← Parcours & famille. Il faut les DEUX informations
  // (vivre seul·e ET avoir des enfants à charge) : avec une seule, on ne
  // conclut pas. `enfants_a_charge` faux suffit en revanche à proposer « Non ».
  const seul = ['celibataire', 'divorce', 'veuf'].includes(d.situation_familiale);
  const enCouple = ['marie', 'en_couple'].includes(d.situation_familiale);
  if (seul && d.enfants_a_charge === true) {
    s.foyer_monoparental = { valeur: true, source: `Parcours & famille : situation « ${d.situation_familiale} » et enfant(s) à charge` };
  } else if (d.enfants_a_charge === false) {
    s.foyer_monoparental = { valeur: false, source: 'Parcours & famille : aucun enfant à charge' };
  } else if (enCouple) {
    s.foyer_monoparental = { valeur: false, source: 'Parcours & famille : vie en couple déclarée' };
  }

  // Ressources principales ← statut BRSA du dossier administratif (constat
  // daté, source la plus sûre), sinon les ressources déclarées au diagnostic.
  // Une seule ressource peut être « principale » : ordre de priorité explicite.
  if (e.brsa === true) {
    s.ressources_principales = { valeur: 'rsa', source: 'Dossier administratif : bénéficiaire du RSA' };
  } else if (Array.isArray(d.ressources) && d.ressources.length > 0) {
    const declarees = d.ressources.map((r) => String(r).toLowerCase());
    const ordre = [['rsa', 'rsa'], ['are', 'are'], ['aah', 'aah'], ['ass', 'ass'], ['aucune', 'aucune']];
    const trouve = ordre.find(([code]) => declarees.includes(code));
    if (trouve) {
      s.ressources_principales = { valeur: trouve[1], source: `Droits & administratif : ressources déclarées (${d.ressources.join(', ')})` };
    }
  }

  // Situation avant l'entrée ← inscription à France Travail (identifiant
  // renseigné au dossier), sinon la durée sans emploi déjà répondue plus haut
  // dans ce même questionnaire (répondre à cette question, c'est déjà dire
  // qu'on était sans emploi).
  const fse = d.fse_entree && typeof d.fse_entree === 'object' ? d.fse_entree : {};
  if (!estVide(e.france_travail_id)) {
    s.statut_avant_entree = { valeur: 'demandeur_emploi', source: 'Dossier administratif : identifiant France Travail renseigné' };
  } else if (!estVide(fse.duree_sans_emploi)) {
    s.statut_avant_entree = { valeur: 'demandeur_emploi', source: 'Questionnaire FSE+ : une durée sans emploi est renseignée' };
  }

  // `duree_sans_emploi` n'a AUCUNE suggestion : le diagnostic ne porte pas de
  // date de dernier emploi. Inventer une durée à partir de l'âge ou du niveau
  // de formation serait une valeur fabriquée dans une pièce d'audit.
  return s;
}

/**
 * Libellé FRANÇAIS d'une réponse, pour l'export et les écrans de lecture.
 * Renvoie '' (cellule vide) si la réponse est absente — jamais « 0 » ni « non
 * renseigné » dans une cellule de tableur : c'est le vide qui dit l'absence.
 */
function libelleValeur(cle, valeur, items) {
  const item = items.find((i) => i.cle === cle);
  if (!item || estVide(valeur)) return '';
  if (item.type === 'bool') {
    const b = typeof valeur === 'boolean' ? valeur : normaliserBool(valeur);
    return b === undefined ? '' : (b ? 'Oui' : 'Non');
  }
  if (item.type === 'enum') {
    const s = String(valeur).trim();
    const canon = item.valeurs.includes(s) ? s : (item.alias && item.alias[s]) || null;
    if (!canon) return ''; // valeur héritée illisible : vide plutôt qu'un code technique
    return (item.labels && item.labels[canon]) || canon;
  }
  return String(valeur);
}

module.exports = {
  FSE_ENTREE_ITEMS,
  FSE_SORTIE_ITEMS,
  SITUATIONS_SORTIE,
  SITUATIONS_6MOIS,
  SITUATION_SORTIE_LABELS,
  MAX_TEXTE,
  valider,
  completude,
  suggestionsEntree,
  libelleValeur,
  estVide,
};
