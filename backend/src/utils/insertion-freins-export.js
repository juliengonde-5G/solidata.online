/**
 * Export « tableau des freins » (EXG-25/38/43, PR 2 ; enrichi PR D lot 6)
 * — helpers PURS.
 *
 * ═══ EXTENSION PR D (export (d) de la matrice de l'autorité, 09 § 2 (d)) ═══
 * Les 23 colonnes historiques sont **conservées dans leur ordre exact** — c'est
 * une exigence écrite de l'autorité (« Conserver intégralement les 23 colonnes
 * actuelles, la feuille Informations et la règle de valorisation imprimée, qui
 * sont bonnes »). Les colonnes du cadre 2026 viennent APRÈS, jamais intercalées :
 * un fichier dont les colonnes se déplacent d'une année sur l'autre casse les
 * tableaux croisés de l'instructrice.
 *
 * Deux ajouts portent une correction de FOND et non un simple élargissement :
 *  · la colonne 5 s'intitule désormais « Heures par semaine (quotité
 *    contractuelle) » — ce n'est PAS l'activité constatée, et l'autorité a
 *    relevé la confusion ; la colonne « Semaines sous 15 h » vient en regard
 *    donner l'activité réelle ;
 *  · chaque axe de frein reçoit sa valeur d'ENTRÉE et son ÉVOLUTION (levé /
 *    stable / aggravé / non évalué) à côté de sa valeur courante : un niveau
 *    seul ne dit pas si l'accompagnement a produit quelque chose.
 *
 * Le frein judiciaire reste EXCLU par défaut, sa variante réservée et
 * journalisée distinctement — y compris ses colonnes d'entrée et d'évolution.
 *
 * Colonnes EXACTEMENT dans l'ordre du rapport 01 §5 (verbatim CDC), avec
 * l'arbitrage g du rapport 11 : « NOM Prénom » restitué en DEUX colonnes
 * (comme l'export insertion Excel existant), soit :
 *   - sensibles=0 (défaut) : 23 colonnes — la colonne « Frein judiciaire »
 *     (art. 10 RGPD, EXG-38) est EXCLUE ;
 *   - sensibles=1 : 24 colonnes — « Frein judiciaire » réintégré à sa position
 *     du CDC (entre « Frein financier » et « Frein mobilité »), génération
 *     journalisée distinctement dans rgpd_audit_log.
 *
 * Règle de valorisation des freins (rapport 01 §5) : DERNIÈRE évaluation en
 * date — dernier entretien réalisé portant au moins un frein non nul du
 * parcours courant, sinon diagnostic d'accueil (résolu en SQL par l'appelant,
 * exports.js ; ici on ne fait que formater).
 *
 * Module sans dépendance DB — testé unitairement (ordre des colonnes,
 * complétude REC-UX-14).
 */
const { FREINS } = require('../routes/insertion/freins-registry');

const freinByKey = (k) => FREINS.find((f) => f.key === k);

/**
 * Descripteurs de colonnes dans l'ordre STRICT du CDC (§5 du rapport 01).
 * `key` = clé de la ligne préparée par exports.js ; `header` = intitulé exact.
 * @param {boolean} sensibles inclut la colonne « Frein judiciaire »
 */
function freinsExportColumns(sensibles = false) {
  const cols = [
    { key: 'nom', header: 'NOM' },                                   // 1 (a)
    { key: 'prenom', header: 'Prénom' },                             // 1 (b) — arbitrage g : 2 colonnes
    { key: 'nationalite', header: 'Nationalité' },                   // 2
    { key: 'date_entree_aci', header: "Date d'entrée ACI" },         // 3 — 1er CDDI
    { key: 'fin_pass_iae', header: 'Fin PASS IAE' },                 // 4
    { key: 'heures_semaine', header: 'Heures par semaine (quotité contractuelle)' }, // 5 (intitulé corrigé PR D)
    { key: 'genre', header: 'Genre' },                               // 6
    { key: 'date_naissance', header: 'Date de naissance' },          // 7
    { key: 'rqth', header: 'RQTH' },                                 // 8
    { key: 'niveau_formation', header: 'Niveau de formation' },      // 9
    { key: 'ressources', header: 'Ressources' },                     // 10
    { key: 'logement', header: 'Logement' },                         // 11
    { key: 'commune', header: 'Commune de résidence' },              // 12
    { key: 'situation_familiale', header: 'Situation familiale' },   // 13
    { key: 'frein_linguistique', header: freinByKey('linguistique').labelExport },  // 14
    { key: 'frein_sante', header: freinByKey('sante').labelExport },                // 15
    { key: 'frein_logement', header: freinByKey('logement').labelExport },          // 16
    { key: 'frein_administratif', header: freinByKey('administratif').labelExport },// 17
    { key: 'frein_finances', header: freinByKey('finances').labelExport },          // 18
  ];
  if (sensibles) {
    cols.push({ key: 'frein_judiciaire', header: freinByKey('judiciaire').labelExport }); // 19 — art. 10
  }
  cols.push(
    { key: 'frein_mobilite', header: freinByKey('mobilite').labelExport }, // 20
    { key: 'pmsmp', header: 'PMSMP' },                                     // 21
    { key: 'projet_formation', header: 'Projet de formation' },            // 22
    { key: 'emploi_vise', header: 'Emploi visé' },                         // 23
  );

  // ── Colonnes du cadre 2026 (PR D) — APRÈS la 23, jamais intercalées ──────
  cols.push(
    { key: 'brsa', header: 'BRSA' },
    { key: 'brsa_date_constat', header: 'Date de constat BRSA' },
    { key: 'ft_categorie', header: 'Catégorie France Travail' },
    { key: 'criteres_eligibilite', header: "Critères d'éligibilité IAE" },
    { key: 'pass_iae_statut', header: 'Statut du Pass IAE' },
    { key: 'referent_unique_type', header: 'Référent unique (type)' },
    { key: 'referent_unique_nom', header: 'Référent unique (nom)' },
    { key: 'projet_cofinance', header: 'Projet cofinancé' },
    { key: 'prescripteur_habilite', header: 'Prescripteur habilité' },
    { key: 'semaines_sous_seuil', header: 'Semaines sous 15 h (année)' },
  );

  // ── Par axe : valeur d'ENTRÉE et ÉVOLUTION, à côté de la valeur courante ──
  // Les axes suivent l'ordre du CDC (celui des colonnes 14-20), et le judiciaire
  // n'apparaît que dans la variante sensible — comme sa valeur courante.
  for (const f of axesExport(sensibles)) {
    cols.push(
      { key: `${f.column}_entree`, header: `${f.labelExport || f.label} — entrée` },
      { key: `${f.column}_evolution`, header: `${f.labelExport || f.label} — évolution` },
    );
  }
  return cols;
}

/**
 * Axes de freins portant une colonne d'entrée et d'évolution, dans l'ordre du
 * CDC. Le judiciaire (art. 10) suit exactement le sort de sa valeur courante :
 * absent par défaut, présent dans la variante réservée et journalisée à part.
 */
function axesExport(sensibles = false) {
  const ordre = ['linguistique', 'sante', 'logement', 'administratif', 'finances', 'judiciaire', 'mobilite'];
  return ordre
    .filter((k) => sensibles || k !== 'judiciaire')
    .map((k) => freinByKey(k))
    .filter(Boolean);
}

/**
 * Évolution d'un axe entre le diagnostic d'accueil et la dernière évaluation.
 * MÊME règle que le bloc 3 de la synthèse de dialogue de gestion : levé = baisse
 * d'au moins un niveau (l'échelle va de 1 « pas de difficulté » à 5
 * « bloquant »), aggravé = hausse d'au moins un niveau, stable sinon, et « non
 * évalué » dès qu'une des deux valeurs manque — jamais « stable » par défaut,
 * qui ferait passer une absence de mesure pour un constat.
 */
function evolutionFrein(entree, actuel) {
  const e = entree == null || entree === '' ? null : Number(entree);
  const a = actuel == null || actuel === '' ? null : Number(actuel);
  if (e == null || a == null || Number.isNaN(e) || Number.isNaN(a)) return 'non évalué';
  if (a <= e - 1) return 'levé';
  if (a >= e + 1) return 'aggravé';
  return 'stable';
}

/**
 * CORRECTIF D-01 / M-01 — une date civile ne repasse JAMAIS par UTC.
 *
 * `node-pg` rend une colonne `DATE` sous forme d'objet `Date` à minuit LOCAL ;
 * `toISOString()` le relit en UTC, et sous un fuseau à offset positif il
 * retombe la veille à 22 h ou 23 h — le `slice(0, 10)` rendait donc le jour
 * précédent. Cinq colonnes de l'export (d) étaient concernées, dont la date de
 * naissance qui sert à APPARIER des personnes chez l'instructrice, et la fin de
 * Pass IAE dont un jour de recul change un statut. C'est exactement la famille
 * D-05 de la PR B, dont le correctif de fond — `utils/date-iso.js`, helper PUR
 * qui lit les composantes locales — existait déjà dans le dépôt sans avoir été
 * porté ici. En production les conteneurs tournent en UTC : le défaut était
 * latent, à une variable `TZ` près.
 */
const { isoDate } = require('./date-iso');
const fmtDate = (v) => {
  if (!v) return '';
  // Repli sur la valeur brute plutôt qu'une chaîne tronquée : une cellule
  // illisible se voit, une date fausse non.
  return isoDate(v) || String(v);
};

/**
 * Transforme une ligne SQL (exports.js — voir la requête LATERAL) en cellules
 * keyées selon freinsExportColumns. Vide EXPLICITE ('') quand la donnée manque
 * (EXG-25 : « chaque cellule provient de la source documentée ou reste vide »).
 */
function rowToCells(r, sensibles = false) {
  // RQTH : booléen structuré du diagnostic (rubrique IV) prioritaire, repli sur
  // le texte disability_status de l'import Malibou (présence = Oui).
  let rqth = '';
  if (r.rqth === true) rqth = 'Oui';
  else if (r.rqth === false) rqth = 'Non';
  else if (r.disability_status && String(r.disability_status).trim() !== '') rqth = 'Oui';

  // PMSMP : nombre réalisé + date de la dernière (colonne 21 du CDC).
  let pmsmp = '';
  if (Number(r.nb_pmsmp) > 0) {
    pmsmp = `${r.nb_pmsmp}${r.derniere_pmsmp ? ` (dern. ${fmtDate(r.derniere_pmsmp)})` : ''}`;
  }

  const freinVal = (v) => (v == null ? '' : Number(v));

  const cells = {
    nom: r.last_name || '',
    prenom: r.first_name || '',
    nationalite: r.nationality || '',
    date_entree_aci: fmtDate(r.date_entree_aci),
    fin_pass_iae: fmtDate(r.pass_iae_end),
    heures_semaine: r.heures_semaine != null ? Number(r.heures_semaine) : '',
    genre: r.gender || '',
    date_naissance: fmtDate(r.birth_date),
    rqth,
    niveau_formation: r.niveau_formation || r.qualification || '',
    ressources: Array.isArray(r.ressources) ? r.ressources.join(', ') : (r.ressources || ''),
    logement: r.logement_statut || '',
    commune: r.city || '',
    situation_familiale: r.situation_familiale || '',
    frein_linguistique: freinVal(r.frein_linguistique),
    frein_sante: freinVal(r.frein_sante),
    frein_logement: freinVal(r.frein_logement),
    frein_administratif: freinVal(r.frein_administratif),
    frein_finances: freinVal(r.frein_finances),
    frein_mobilite: freinVal(r.frein_mobilite),
    pmsmp,
    projet_formation: r.projet_formation || '',
    emploi_vise: [r.emploi_vise, r.emploi_vise_rome].filter(Boolean).join(' — ') || '',
  };
  if (sensibles) cells.frein_judiciaire = freinVal(r.frein_judiciaire);

  // ── Cadre 2026 (PR D) — cellule VIDE quand la donnée manque, jamais 0 ─────
  // `brsa` est un booléen NULLABLE à dessein : « non renseigné » n'est pas
  // « non », et un « Non » inventé ferait disparaître des personnes du compte
  // déclaré au Département.
  cells.brsa = r.brsa === true ? 'Oui' : (r.brsa === false ? 'Non' : '');
  cells.brsa_date_constat = fmtDate(r.brsa_date_constat);
  cells.ft_categorie = r.ft_categorie || '';
  cells.criteres_eligibilite = Array.isArray(r.criteres_eligibilite)
    ? r.criteres_eligibilite.filter(Boolean).join(' ; ') : '';
  cells.pass_iae_statut = PASS_IAE_LABELS[r.pass_iae_statut] || '';
  cells.referent_unique_type = REFERENT_LABELS[r.referent_unique_type] || '';
  cells.referent_unique_nom = r.referent_unique_nom || '';
  cells.projet_cofinance = Array.isArray(r.projets_cofinances)
    ? r.projets_cofinances.filter(Boolean).join(' ; ') : (r.projets_cofinances || '');
  cells.prescripteur_habilite = PRESCRIPTEUR_LABELS[r.eligibilite_source] || '';
  // `null` ≠ 0 : « aucune semaine sous le plancher » et « activité non relevée »
  // ne se lisent pas pareil sur un document de contrôle.
  // CORRECTIF D-03 — « 0 semaine sous 15 h » et « aucune semaine relevée » sont
  // deux affirmations différentes, et sur un document de contrôle un 0 dans une
  // colonne intitulée « Semaines sous 15 h » se lit « cette personne n'est
  // jamais passée sous le plancher », c'est-à-dire l'exact contraire de ce qui
  // est su. Le moteur d'activité le DIT (`nb_semaines_relevees`) ; il n'y avait
  // qu'à le lire. Même doctrine que le relevé d'assiduité de la PR B : une
  // semaine sans relevé est vide, jamais 0 h.
  cells.semaines_sous_seuil = (r.semaines_sous_seuil == null || r.semaines_relevees === 0)
    ? '' : Number(r.semaines_sous_seuil);

  // ── CORRECTIF D-02 — l'évolution se mesure sur la DERNIÈRE ÉVALUATION ────
  // `r[f.column]` est la valeur COURANTE, déjà repliée sur le diagnostic par le
  // `COALESCE(lm, d)` de la requête : c'est la bonne règle de valorisation pour
  // la colonne de valeur, et la mauvaise pour l'évolution. Comparer le
  // diagnostic avec lui-même rendait toujours « stable » — donc « l'accompagne-
  // ment n'a rien changé » là où la lecture juste est « nous ne l'avons pas
  // remesuré ». Deux documents transmis à la même instructrice, sur la même
  // année, se contredisaient sur la même personne : le bloc 3 de la synthèse
  // disait « non évalué », l'export (d) disait « stable ». Le second terme est
  // désormais la dernière évaluation BRUTE (`<col>_actuel`, projetée par
  // `fetchFreinsRows`), et les deux surfaces disent la même chose.
  for (const f of axesExport(sensibles)) {
    const entree = r[`${f.column}_entree`];
    cells[`${f.column}_entree`] = entree == null ? '' : Number(entree);
    cells[`${f.column}_evolution`] = evolutionFrein(entree, r[`${f.column}_actuel`]);
  }
  return cells;
}

/** Libellés des statuts de Pass IAE (nomenclature des emplois de l'inclusion). */
const PASS_IAE_LABELS = {
  actif: 'Actif', suspendu: 'Suspendu', prolonge: 'Prolongé',
  expire: 'Expiré', inconnu: '',
};

/** Libellés des types de référent unique (loi pour le plein emploi). */
const REFERENT_LABELS = {
  structure: 'Structure', cms: 'CMS', france_travail: 'France Travail',
  autre: 'Autre', non_determine: 'Non déterminé',
};

/** Provenance de la vérification d'éligibilité (colonne « prescripteur habilité »). */
const PRESCRIPTEUR_LABELS = {
  prescripteur_habilite: 'Oui', auto_prescription: 'Non (auto-prescription)', inconnu: '',
};

/**
 * Complétude par colonne (REC-UX-14) : % de cellules renseignées (≠ '' / null)
 * sur les lignes préparées par rowToCells. Consommé par la phase B AVANT de
 * générer l'export (l'écran affiche les colonnes faibles).
 * @param {Array<object>} cellRows lignes déjà passées par rowToCells
 * @param {boolean} sensibles même variante que l'export
 * @returns {{ total:number, colonnes:Array<{colonne:string, cle:string, renseigne:number, pct:number|null}> }}
 */
function computeCompletude(cellRows, sensibles = false) {
  const cols = freinsExportColumns(sensibles);
  const total = cellRows.length;
  const colonnes = cols.map((c) => {
    let renseigne = 0;
    for (const row of cellRows) {
      const v = row[c.key];
      // « non évalué » compte comme NON renseigné : la colonne d'évolution est
      // DÉRIVÉE (elle a toujours une valeur), et la présenter à 100 % dirait
      // « rien à compléter » là où précisément aucune évolution n'est mesurable
      // faute de diagnostic ou de dernière évaluation. C'est exactement ce que
      // l'écran de complétude sert à repérer avant de générer l'export.
      if (v !== null && v !== undefined && v !== '' && v !== 'non évalué') renseigne += 1;
    }
    return {
      colonne: c.header,
      cle: c.key,
      renseigne,
      pct: total > 0 ? Math.round((renseigne / total) * 100) : null,
    };
  });
  return { total, colonnes };
}

module.exports = { freinsExportColumns, rowToCells, computeCompletude, evolutionFrein, axesExport };
