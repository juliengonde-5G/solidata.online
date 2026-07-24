/**
 * Export « tableau des freins » 23 colonnes (EXG-25/38/43, PR 2) — helpers PURS.
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
    { key: 'heures_semaine', header: 'Heures par semaine' },         // 5
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
  return cols;
}

const fmtDate = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
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
  return cells;
}

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
      if (v !== null && v !== undefined && v !== '') renseigne += 1;
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

module.exports = { freinsExportColumns, rowToCells, computeCompletude };
