/**
 * Structure du formulaire « Outil de dialogue de gestion — programme CVG »
 * (Convergence France), partagée par l'écran (ConvergenceCvgPanel) et le PDF
 * (pdf-convergence-cvg). Lot 2.58.0, contrat 30 § 0 et § 2.
 *
 * ═══ L'ORDRE EST CELUI DU FORMULAIRE, PAS LE NÔTRE ════════════════════════
 * Chaque tableau liste ses lignes dans l'ordre du document scanné reçu le
 * 25/09/2026 : la personne de Convergence qui recopie les chiffres doit
 * retrouver ses cases au même endroit.
 *
 * ═══ LECTURE TOLÉRANTE DU CONTENU COMPOSÉ PAR LE SERVEUR ══════════════════
 * Un bloc peut arriver sous deux formes :
 *   · une liste ordonnée `lignes: [{ cle, libelle, nb, pct }]` (ou un tableau
 *     nu) — rendue TELLE QUELLE, dans l'ordre et avec les libellés du serveur ;
 *   · un objet indexé par clé `{ hommes: { nb, pct }, … }` (ou `{ hommes: 18 }`)
 *     — rendu dans l'ordre du formulaire ci-dessous.
 * Une valeur absente ou `null` s'affiche « — », jamais 0.
 */

import { CVG_HABITAT_LABELS, CVG_FREINS_LABELS, ORIENTEUR_LABELS, CVG_SORTIE_LABELS } from './freins';

// ── Lignes des tableaux, dans l'ordre du formulaire ─────────────────────────
// [clé canonique, libellé, options] — `alias` : autres clés acceptées.

export const LIGNES_EFFECTIFS = [
  ['etp_conventionnes', "Nombre d'ETP conventionnés à la date de fin", { alias: ['etp_conventionnes_fin'] }],
  ['accueillis', 'Nombre de salariés en insertion accueillis sur la période', { alias: ['salaries_accueillis', 'nb_accueillis'] }],
  ['en_contrat_fin', 'Nombre de salariés en insertion en contrat à la date de fin', { alias: ['en_contrat', 'nb_en_contrat_fin'] }],
];

export const LIGNES_PUBLICS = [
  ['hommes', 'Hommes'],
  ['femmes', 'Femmes'],
  ['moins_26', 'Moins de 26 ans', { alias: ['age_moins_26', 'moins_26_ans'] }],
  ['de_26_a_49', '26 et moins de 50 ans', { alias: ['age_26_49', 'de_26_a_50', 'age_26_50', 'entre_26_50'] }],
  ['plus_50', 'Plus de 50 ans', { alias: ['age_50_plus', 'plus_50_ans', '50_et_plus'] }],
  ['niv1_2', 'Formation niveau 1-2 : pas de diplôme', { alias: ['formation_niv1_2', 'infra3', 'niveau_1_2'] }],
  ['niv3', 'Formation niveau 3', { alias: ['formation_niv3', 'niveau_3'] }],
  ['niv4', 'Formation niveau 4', { alias: ['formation_niv4', 'niveau_4'] }],
  ['niv5', 'Formation niveau 5', { alias: ['formation_niv5', 'niveau_5'] }],
  ['niv6', 'Formation niveau 6', { alias: ['formation_niv6', 'niveau_6'] }],
  ['niv7', 'Formation niveau 7', { alias: ['formation_niv7', 'niveau_7'] }],
  ['niv8', 'Formation niveau 8', { alias: ['formation_niv8', 'niveau_8'] }],
  ['niv6plus', '6 et plus (niveau non détaillé)', { alias: ['formation_niv6plus'], siPresent: true, indent: true }],
  ['total_formation', 'Total formation', { bold: true, alias: ['formation_total'] }],
  ['sans_emploi_2ans', "Personnes n'ayant pas travaillé depuis 2 ans et plus", { alias: ['sans_emploi_2_ans', 'detld'] }],
  ['rsa_socle', 'Bénéficiaires du RSA socle', { alias: ['rsa', 'brsa'] }],
  ['ass', "Bénéficiaires de l'ASS"],
  ['rth', "Demandeurs d'emploi (RTH)", { alias: ['rqth'] }],
  ['aah', "Dont bénéficiaires de l'AAH", { indent: true }],
  ['refugies', 'Réfugiés', { alias: ['refugie_bpi', 'refugie'] }],
];

export const LIGNES_HABITAT = [
  ...Object.entries(CVG_HABITAT_LABELS).map(([k, l]) => [k, l]),
];

export const LIGNES_FREINS = Object.entries(CVG_FREINS_LABELS).map(([k, l]) => [k, l, { alias: [`frein_${k}`] }]);

export const LIGNES_ORIENTEURS = Object.entries(ORIENTEUR_LABELS).map(([k, l]) => [k, l]);

export const LIGNES_SORTIE_EMPLOI = [
  ['emploi', CVG_SORTIE_LABELS.emploi],
  ['suite_parcours_insertion', CVG_SORTIE_LABELS.suite_parcours_insertion],
  ['formation', CVG_SORTIE_LABELS.formation],
];

export const LIGNES_SORTIE_HORS_EMPLOI = [
  ['retraite', CVG_SORTIE_LABELS.retraite],
  ['sans_solution', CVG_SORTIE_LABELS.sans_solution],
  ['sans_nouvelles', CVG_SORTIE_LABELS.sans_nouvelles],
  ['sortie_neutre', CVG_SORTIE_LABELS.sortie_neutre],
  ['autre_positive', CVG_SORTIE_LABELS.autre_positive],
  ['parcours_de_soin', 'Dont sortie en parcours de soin', { indent: true }],
];

export const LIGNES_SANTE = [
  ['rqth', 'RQTH'],
  ['aah', 'AAH'],
  ['pension_invalidite', "Pension d'invalidité"],
  ['medecin_traitant', 'Médecin traitant'],
  ['couverture_sante_amelioree', 'Amélioration de la couverture santé', { alias: ['amelioration_couverture_sante', 'couverture_sante'] }],
];

// ── Accès tolérant ──────────────────────────────────────────────────────────

const estVide = (v) => v === null || v === undefined || v === '';

/** Liste ordonnée fournie par le serveur, s'il y en a une. */
export function lignesServeur(bloc) {
  if (Array.isArray(bloc)) return bloc;
  if (bloc && Array.isArray(bloc.lignes)) return bloc.lignes;
  return null;
}

const cleDe = (it) => it?.cle ?? it?.key ?? it?.code ?? it?.id;

/** Valeur brute d'une ligne (clé canonique ou alias). `undefined` = ligne absente. */
export function brut(bloc, cle, alias = []) {
  if (!bloc || typeof bloc !== 'object') return undefined;
  const cles = [cle, ...alias];
  const liste = lignesServeur(bloc);
  if (liste) return liste.find((it) => cles.includes(cleDe(it)));
  for (const k of cles) if (Object.prototype.hasOwnProperty.call(bloc, k)) return bloc[k];
  return undefined;
}

/** { nb, pct } à partir d'un nombre, d'un objet ou d'une ligne de liste. */
export function cellule(v) {
  if (estVide(v)) return { nb: null, pct: null };
  if (typeof v === 'number' || typeof v === 'string') return { nb: v, pct: null };
  return {
    nb: v.nb ?? v.nombre ?? v.n ?? v.valeur ?? null,
    pct: v.pct ?? v.pourcentage ?? v.part_pct ?? null,
  };
}

/** Cellule à deux temps (entrée / sortie ou résolution). */
export function celluleDouble(v) {
  if (estVide(v) || typeof v !== 'object') return { entree: cellule(null), sortie: cellule(null) };
  const entree = v.entree !== undefined ? cellule(v.entree) : { nb: v.entree_nb ?? null, pct: v.entree_pct ?? null };
  const s = v.sortie ?? v.resolution;
  const sortie = s !== undefined ? cellule(s)
    : { nb: v.sortie_nb ?? v.resolution_nb ?? null, pct: v.sortie_pct ?? v.resolution_pct ?? null };
  return { entree, sortie };
}

/** Dénominateur des pourcentages d'un bloc, s'il est donné. */
export const baseDe = (bloc, repli = null) => {
  const b = bloc && typeof bloc === 'object' && !Array.isArray(bloc) ? (bloc.base ?? bloc.denominateur) : null;
  return estVide(b) ? repli : b;
};

/**
 * Pourcentage : celui du serveur s'il le donne ; sinon calculé sur la base
 * connue du bloc ; sinon rien. Un effectif inconnu ne donne jamais « 0 % ».
 */
export function pctDe(c, base) {
  if (!estVide(c.pct)) return Number(c.pct);
  if (estVide(c.nb) || estVide(base) || Number(base) === 0) return null;
  return (Number(c.nb) / Number(base)) * 100;
}

export const fmtNb = (v) => (estVide(v) ? null : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
export const fmtPct = (v) => (estVide(v) || Number.isNaN(Number(v)) ? null
  : `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);

/**
 * Lignes à afficher pour un tableau simple nb / % : la liste du serveur si elle
 * existe, sinon la structure du formulaire. Chaque ligne : { cle, libelle, nb,
 * pct, bold, indent }.
 */
export function lignesSimples(bloc, structure, baseRepli = null) {
  const base = baseDe(bloc, baseRepli);
  const liste = lignesServeur(bloc);
  if (liste) {
    return liste.map((it) => {
      const c = cellule(it);
      const s = structure.find(([k]) => k === cleDe(it));
      return {
        cle: cleDe(it), libelle: it.libelle || it.label || s?.[1] || String(cleDe(it)),
        nb: c.nb, pct: pctDe(c, base), bold: !!(it.total || s?.[2]?.bold), indent: !!(it.dont || s?.[2]?.indent),
      };
    });
  }
  return structure
    .map(([cle, libelle, opt = {}]) => {
      const v = brut(bloc, cle, opt.alias);
      if (opt.siPresent && estVide(v)) return null;
      if (opt.siPresent && typeof v === 'object' && estVide(cellule(v).nb)) return null;
      const c = cellule(v);
      return { cle, libelle, nb: c.nb, pct: pctDe(c, base), bold: !!opt.bold, indent: !!opt.indent };
    })
    .filter(Boolean);
}

/** Lignes d'un tableau à deux temps (freins, logement, santé). */
export function lignesDoubles(bloc, structure, baseRepli = null) {
  const base = baseDe(bloc, baseRepli);
  const fabrique = (cle, libelle, v, opt = {}) => {
    const { entree, sortie } = celluleDouble(v);
    return {
      cle, libelle, indent: !!opt.indent,
      entree: { nb: entree.nb, pct: pctDe(entree, base) },
      sortie: { nb: sortie.nb, pct: pctDe(sortie, base) },
    };
  };
  const liste = lignesServeur(bloc);
  if (liste) {
    return liste.map((it) => {
      const s = structure.find(([k]) => k === cleDe(it));
      return fabrique(cleDe(it), it.libelle || it.label || s?.[1] || String(cleDe(it)), it);
    });
  }
  return structure.map(([cle, libelle, opt = {}]) => fabrique(cle, libelle, brut(bloc, cle, opt.alias), opt));
}

/** « non renseigné » d'un bloc : nombre, ou liste de phrases si objet. */
export function nonRenseigne(bloc) {
  if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc)) return null;
  const v = bloc.non_renseigne ?? bloc.non_renseignes;
  if (estVide(v)) return null;
  if (typeof v === 'number') return [`${v} personne(s) non renseignée(s)`];
  if (typeof v === 'object') {
    return Object.entries(v).filter(([, n]) => !estVide(n) && Number(n) > 0)
      .map(([k, n]) => `${k.replace(/_/g, ' ')} : ${n} non renseigné(s)`);
  }
  return [String(v)];
}

/** Valeur simple d'un indicateur d'en-tête (ETP, effectifs…). */
export const valeurSimple = (bloc, cle, alias = []) => cellule(brut(bloc, cle, alias)).nb;

// ── Accès aux grandes parties du contenu ────────────────────────────────────

export function partiesCvg(contenu) {
  const c = contenu || {};
  const p1 = c.partie1 || {};
  const p2 = c.partie2 || {};
  const so = c.sorties || {};
  return {
    en_tete: c.en_tete || {},
    effectifs: p1.effectifs || p1,
    publics: p1.publics || {},
    habitat: p1.habitat_entree || p1.habitat || {},
    parcoursRue: p1.parcours_rue ?? p1.habitat_entree?.parcours_rue ?? p1.habitat?.parcours_rue,
    difficultes: p1.difficultes_entree || p1.difficultes || p1.freins_entree || {},
    orienteurs: p1.orienteurs || p1.orienteur || {},
    baseP1: p1.base ?? p1.total_publics ?? p1.publics?.base ?? p1.publics?.total ?? valeurSimple(p1.effectifs || p1, 'accueillis', ['salaries_accueillis', 'nb_accueillis']) ?? null,
    internes: Array.isArray(p2.internes) ? p2.internes : (Array.isArray(p2.ressources_internes) ? p2.ressources_internes : []),
    mutualisees: Array.isArray(p2.mutualisees) ? p2.mutualisees : (Array.isArray(p2.ressources_mutualisees) ? p2.ressources_mutualisees : []),
    totauxP2: p2.totaux || null,
    sorties: so,
    totalSorties: so.total ?? so.nb_sortis ?? null,
    dureeMoyenne: so.duree_moyenne_mois ?? null,
    emploi: so.emploi || {},
    horsEmploi: so.hors_emploi || {},
    methode: c.methode || [],
    completude: c.completude || null,
  };
}

/** Sous-blocs d'un tableau jumeau (emploi / hors emploi). */
export function blocJumeau(b) {
  const x = b || {};
  return {
    categories: x.categories || x.situations || x,
    total: x.total ?? x.sous_total ?? null,
    freins: x.freins || x.evolution_freins || {},
    logement: x.logement || x.evolution_logement || {},
    sante: x.sante || x.evolution_sante || {},
    postSortie: x.post_sortie ?? x.accompagnement_post_sortie ?? null,
    nonRenseigne: nonRenseigne(x),
  };
}

/** Somme d'une colonne ETP (2 décimales) — `null` si aucune valeur connue. */
export function sommeEtp(liste, champ) {
  const vals = (liste || []).map((r) => r?.[champ]).filter((v) => !estVide(v) && !Number.isNaN(Number(v)));
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, v) => a + Number(v), 0) * 100) / 100;
}

/** Méthode : phrases en toutes lettres (chaînes ou { indicateur, regle }). */
export function phrasesMethode(methode) {
  if (!methode) return [];
  if (typeof methode === 'string') return [methode];
  if (Array.isArray(methode)) {
    return methode.map((m) => (typeof m === 'string' ? m
      : [m?.indicateur, m?.regle ?? m?.texte].filter(Boolean).join(' — '))).filter(Boolean);
  }
  if (typeof methode === 'object') return Object.entries(methode).map(([k, v]) => `${k} — ${v}`);
  return [];
}

/** Période lisible « du JJ/MM/AAAA au JJ/MM/AAAA ». */
export function periodeTexte(p) {
  if (!p) return '—';
  const d = p.debut ?? p.periode_debut ?? (typeof p === 'string' ? p : null);
  const f = p.fin ?? p.periode_fin ?? null;
  const fr = (v) => {
    if (!v) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
  };
  if (typeof p === 'string') return p;
  return `du ${fr(d)} au ${fr(f)}`;
}
