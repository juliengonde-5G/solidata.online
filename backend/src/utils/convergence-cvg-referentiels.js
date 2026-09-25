/**
 * Référentiels du reporting Convergence France (programme CVG) — module PUR
 * (lot 2.58.0, contrat `rapports/cip-refonte-2026-09-12/30-convergence-cvg-cartographie.md`).
 *
 * ═══ POURQUOI UN FICHIER À PART ═══════════════════════════════════════════
 *
 * Le formulaire de Convergence (« Outil de dialogue de gestion — programme
 * CVG ») parle sa propre langue : cinq types d'habitat, huit difficultés, douze
 * orienteurs, huit situations de sortie. SOLIDATA en parle une autre, plus fine
 * sur certains axes (neuf freins, niveaux de formation détaillés) et plus
 * grossière sur d'autres (`heberge` ne dit ni collectif ni précaire). Les
 * TRANSCODAGES entre les deux vivent ici, et nulle part ailleurs : la migration
 * (listes des CHECK), le PUT du diagnostic, le composeur, le comparateur et la
 * route de situation de sortie les lisent tous dans ce fichier.
 *
 * ═══ CE QU'IL NE FAIT JAMAIS ══════════════════════════════════════════════
 * Deviner. Une correspondance AMBIGUË rend `null` (« à saisir ») — jamais la
 * case la plus probable. `heberge` peut être un hébergement collectif, un
 * hébergement précaire ou un logement semi-durable : le ranger dans l'un des
 * trois, c'est écrire dans une pièce transmise une information que personne
 * n'a donnée.
 *
 * Aucune E/S : ces fonctions sont testées sans base.
 */

'use strict';

// ── Type d'habitat (entrée ET sortie) — ordre du formulaire ──────────────────
const HABITAT_TYPES = ['autonome', 'semi_durable', 'hebergement_collectif', 'hebergement_precaire', 'rue'];
const HABITAT_LABELS = {
  autonome: 'Logement autonome',
  semi_durable: 'Logement semi-durable',
  hebergement_collectif: 'Hébergement collectif',
  hebergement_precaire: 'Hébergement précaire',
  rue: 'Rue',
};

// ── Situation à la sortie — liste fermée Convergence ─────────────────────────
const SORTIE_CATEGORIES_EMPLOI = ['emploi', 'suite_parcours_insertion', 'formation'];
const SORTIE_CATEGORIES_HORS_EMPLOI = ['retraite', 'sans_solution', 'sans_nouvelles', 'sortie_neutre', 'autre_positive'];
const SORTIE_CATEGORIES = [...SORTIE_CATEGORIES_EMPLOI, ...SORTIE_CATEGORIES_HORS_EMPLOI];
const SORTIE_LABELS = {
  emploi: "Emploi (CDI, CDD, création d'entreprise…)",
  suite_parcours_insertion: 'Suite de parcours en insertion (CDDI…)',
  formation: 'Formation',
  retraite: 'Retraite',
  sans_solution: 'Sans solution emploi',
  sans_nouvelles: 'Sans nouvelles',
  sortie_neutre: 'Sortie neutre',
  autre_positive: 'Sortie autre reconnue comme positive',
};

// ── Orienteurs — les 12 valeurs Convergence (ordre du formulaire) ────────────
const ORIENTEURS_CVG = [
  'france_travail', 'mission_locale', 'cap_emploi', 'plie_pmie', 'autre_spe',
  'structure_hebergement', 'maraude_veille_sociale', 'premieres_heures_chantier',
  'autre_siae', 'services_sociaux_departement', 'autre_accompagnement', 'candidature_spontanee',
];
const ORIENTEUR_LABELS = {
  france_travail: 'France Travail',
  mission_locale: 'Mission locale',
  cap_emploi: 'Cap emploi',
  plie_pmie: 'PLIE / PMIE',
  autre_spe: "Autre acteur local du Service public de l'emploi",
  structure_hebergement: "Structure d'hébergement",
  maraude_veille_sociale: 'Maraude / accueil de jour / veille sociale',
  premieres_heures_chantier: 'Premières Heures en Chantier',
  autre_siae: 'Autre SIAE',
  services_sociaux_departement: 'Services sociaux du Département',
  autre_accompagnement: "Autre acteur local d'accompagnement",
  candidature_spontanee: 'Candidature spontanée',
};
/** Valeurs antérieures au lot — conservées LISIBLES (CHECK), plus proposées. */
const ORIENTEURS_ANCIENS = ['departement_cms', 'ccas', 'autre'];
const ORIENTEURS_ANCIENS_LABELS = {
  departement_cms: 'Département — CMS (ancienne saisie)',
  ccas: 'CCAS (ancienne saisie)',
  autre: 'Autre (ancienne saisie)',
};
/** Toutes les valeurs acceptées par le CHECK `employees_orienteur_type_check`. */
const ORIENTEURS_ACCEPTES = [...ORIENTEURS_ANCIENS, ...ORIENTEURS_CVG.filter((o) => !ORIENTEURS_ANCIENS.includes(o))];

// ── Les 8 difficultés Convergence, dans l'ordre du formulaire ────────────────
// `frein` : l'axe SOLIDATA correspondant (freins-registry.js). Le frein
// `numerique` n'a AUCUN équivalent : il n'est pas transmis.
const DIFFICULTES = [
  { cle: 'illettrisme_fle', frein: 'linguistique', libelle: 'Illettrisme, analphabétisme, FLE' },
  { cle: 'sante', frein: 'sante', libelle: 'Santé' },
  { cle: 'logement', frein: 'logement', libelle: 'Logement' },
  { cle: 'demarches_droits', frein: 'administratif', libelle: 'Démarches administratives et accès aux droits' },
  { cle: 'surendettement', frein: 'finances', libelle: 'Surendettement — difficultés financières' },
  { cle: 'justice', frein: 'judiciaire', libelle: 'Justice' },
  { cle: 'garde_enfant', frein: 'famille', libelle: "Manque de disponibilité (garde d'enfant)" },
  { cle: 'mobilite', frein: 'mobilite', libelle: 'Mobilité' },
];
const DIFFICULTES_CLES = DIFFICULTES.map((d) => d.cle);

// ── Niveaux de formation ────────────────────────────────────────────────────
/** Valeurs acceptées par le PUT du diagnostic (`niv6plus` conservé en lecture). */
const NIVEAUX_FORMATION_SOLIDATA = ['infra3', 'niv3', 'niv4', 'niv5', 'niv6', 'niv7', 'niv8', 'niv6plus'];
/**
 * Lignes « formation » du document composé (clés figées avec l'écran et le PDF,
 * ordre du formulaire). `niv6plus` n'est rendue que si elle compte quelqu'un :
 * c'est une ligne de RATTRAPAGE des saisies antérieures, pas une ligne du
 * formulaire.
 */
const NIVEAUX_FORMATION_CVG = ['niv1_2', 'niv3', 'niv4', 'niv5', 'niv6', 'niv7', 'niv8', 'niv6plus'];
const NIVEAUX_FORMATION_CVG_LABELS = {
  niv1_2: 'Formation niveau 1-2 : pas de diplôme',
  niv3: 'Formation niveau 3',
  niv4: 'Formation niveau 4',
  niv5: 'Formation niveau 5',
  niv6: 'Formation niveau 6',
  niv7: 'Formation niveau 7',
  niv8: 'Formation niveau 8',
  niv6plus: '6 et plus (niveau non détaillé — ancienne saisie)',
};
const MAP_NIVEAU = {
  infra3: 'niv1_2', niv3: 'niv3', niv4: 'niv4', niv5: 'niv5', niv6: 'niv6', niv7: 'niv7', niv8: 'niv8', niv6plus: 'niv6plus',
};

// ═══════════════════════════════════════════════════════════════════════════
// Transcodages
// ═══════════════════════════════════════════════════════════════════════════

const texte = (v) => (v == null ? '' : String(v).trim());

/**
 * Type de sortie d'un bilan (`insertion_milestones.sortie_type`) → catégorie
 * Convergence. `null` = pas de correspondance univoque (la CIP saisit).
 * `sans_suite → sans_nouvelles` est une APPROXIMATION annoncée (arbitrage 2
 * du contrat, § 4) — la catégorie reste saisissable.
 */
function transcoderSortieType(sortieType) {
  switch (texte(sortieType)) {
    case 'CDI': case 'CDD': case 'CDD_court': case 'interim': case 'creation_activite':
      return 'emploi';
    case 'autre_IAE': return 'suite_parcours_insertion';
    case 'formation': return 'formation';
    case 'fin_contrat': return 'sans_solution';
    case 'sans_suite': return 'sans_nouvelles';
    default: return null;
  }
}

/** Statut de logement du diagnostic → type d'habitat CVG (`heberge` : ambigu → null). */
function transcoderHabitat(logementStatut) {
  switch (texte(logementStatut)) {
    case 'locataire_social': case 'locataire_prive': case 'proprietaire': return 'autonome';
    case 'sans_abri': return 'rue';
    default: return null;
  }
}

/**
 * Orienteur SOLIDATA → orienteur CVG. Les douze clés Convergence passent
 * telles quelles ; `departement_cms` et `ccas` se transcodent sans ambiguïté ;
 * l'ancienne valeur `autre` ne dit PAS lequel des « autres » acteurs — `null`.
 */
function transcoderOrienteur(orienteurType) {
  const v = texte(orienteurType);
  if (ORIENTEURS_CVG.includes(v)) return v;
  if (v === 'departement_cms') return 'services_sociaux_departement';
  if (v === 'ccas') return 'autre_accompagnement';
  return null;
}

/** Axe de frein SOLIDATA → difficulté CVG (`numerique` → null : non transmis). */
function transcoderFrein(freinKey) {
  const d = DIFFICULTES.find((x) => x.frein === texte(freinKey));
  return d ? d.cle : null;
}

/** Niveau de formation SOLIDATA → ligne CVG (valeur hors liste → null). */
function niveauFormationCvg(niveau) {
  return MAP_NIVEAU[texte(niveau)] || null;
}

/** Date civile 'AAAA-MM-JJ' (chaîne) ou objet Date → composantes, sans fuseau. */
function composantes(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return [v.getFullYear(), v.getMonth() + 1, v.getDate()];
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Tranche d'âge Convergence à la date de référence (fin de période) :
 * `moins_26` (< 26 ans), `de_26_a_49` (26 et moins de 50 ans), `plus_50`
 * (50 ans et plus). Date de naissance absente ou illisible → `null`.
 */
function trancheAgeCvg(birthDate, dateRef) {
  const n = composantes(birthDate);
  const r = composantes(dateRef);
  if (!n || !r) return null;
  let age = r[0] - n[0];
  if (r[1] < n[1] || (r[1] === n[1] && r[2] < n[2])) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 120) return null;
  if (age < 26) return 'moins_26';
  if (age < 50) return 'de_26_a_49';
  return 'plus_50';
}

/**
 * Sexe : `employees.gender` fait foi, la civilité n'est qu'un REPLI (règle
 * 2.19.1, miroir de `routes/employees.js` /kpi/egalite-fh). Une civilité non
 * reconnue reste « non renseigné » — jamais classée H par défaut.
 * @returns {'F'|'H'|null}
 */
function sexeCvg({ gender, civility } = {}) {
  const g = texte(gender).toUpperCase();
  if (g === 'F') return 'F';
  if (g === 'M' || g === 'H') return 'H';
  const c = texte(civility).toLowerCase();
  if (/^(mme|mlle|madame|mademoiselle)/.test(c)) return 'F';
  if (c === 'm' || /^(m\.|mr|monsieur)/.test(c)) return 'H';
  return null;
}

module.exports = {
  HABITAT_TYPES,
  HABITAT_LABELS,
  SORTIE_CATEGORIES,
  SORTIE_CATEGORIES_EMPLOI,
  SORTIE_CATEGORIES_HORS_EMPLOI,
  SORTIE_LABELS,
  ORIENTEURS_CVG,
  ORIENTEUR_LABELS,
  ORIENTEURS_ANCIENS,
  ORIENTEURS_ANCIENS_LABELS,
  ORIENTEURS_ACCEPTES,
  DIFFICULTES,
  DIFFICULTES_CLES,
  NIVEAUX_FORMATION_SOLIDATA,
  NIVEAUX_FORMATION_CVG,
  NIVEAUX_FORMATION_CVG_LABELS,
  transcoderSortieType,
  transcoderHabitat,
  transcoderOrienteur,
  transcoderFrein,
  niveauFormationCvg,
  trancheAgeCvg,
  sexeCvg,
};
