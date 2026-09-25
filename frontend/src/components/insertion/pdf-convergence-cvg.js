/**
 * « Outil de dialogue de gestion — programme CVG » (Convergence France) —
 * PDF A4 portrait par fenêtre d'impression (lot 2.58.0, contrat 30 § 2.4).
 *
 * ═══ RENDU EXCLUSIVEMENT DEPUIS `contenu` ═════════════════════════════════
 * Comme la synthèse de dialogue de gestion : rien d'autre que l'objet composé
 * par le serveur (et, pour un instantané, l'objet ENREGISTRÉ). Un instantané
 * rejoué imprime ce qui est parti, pas ce que le dossier dit aujourd'hui.
 *
 * ═══ QUATRE PAGES, DANS L'ORDRE DU FORMULAIRE ════════════════════════════
 *   1. Partie 1 — le public accompagné sur la période ;
 *   2. Partie 2 — moyens humains dédiés à l'accompagnement ;
 *   3. Salariés sortis accédant à un emploi ou une formation ;
 *   4. Salariés sortis n'accédant pas à l'emploi ;
 * puis une page « Méthode » reprise telle quelle de `contenu.methode`.
 *
 * Une valeur absente s'imprime « — », jamais 0 ; chaque tableau dit combien de
 * personnes n'ont pas l'information renseignée.
 */

import { openPrintWindow, esc } from './pdf-insertion';
import {
  partiesCvg, blocJumeau, lignesSimples, lignesDoubles, valeurSimple, nonRenseigne,
  LIGNES_EFFECTIFS, LIGNES_PUBLICS, LIGNES_HABITAT, LIGNES_FREINS, LIGNES_ORIENTEURS,
  LIGNES_SORTIE_EMPLOI, LIGNES_SORTIE_HORS_EMPLOI, LIGNES_SANTE,
  fmtNb, fmtPct, pctDe, cellule, sommeEtp, phrasesMethode, periodeTexte,
} from './convergence-cvg-structure';

const frDateHeure = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-FR');
};

const nul = '<span class="nul">—</span>';
const v = (x) => (x === null || x === undefined ? nul : esc(x));

const trSimple = (l) => `<tr class="${l.bold ? 'tot' : ''}"><td class="${l.indent ? 'dont' : ''}">${esc(l.libelle)}</td>`
  + `<td class="num">${v(fmtNb(l.nb))}</td><td class="num">${v(fmtPct(l.pct))}</td></tr>`;

const trDouble = (l) => `<tr><td class="${l.indent ? 'dont' : ''}">${esc(l.libelle)}</td>`
  + `<td class="num">${v(fmtNb(l.entree.nb))}</td><td class="num">${v(fmtPct(l.entree.pct))}</td>`
  + `<td class="num">${v(fmtNb(l.sortie.nb))}</td><td class="num">${v(fmtPct(l.sortie.pct))}</td></tr>`;

const intertitre = (t) => `<tr class="inter"><td colspan="3">${esc(t)}</td></tr>`;

const noteNr = (bloc) => {
  const nr = nonRenseigne(bloc);
  return nr && nr.length ? `<div class="note">Non renseigné : ${esc(nr.join(' · '))}.</div>` : '';
};

function tableauDouble(titre, col1, col2, lignes, piedDePage) {
  return `<table class="cvg"><thead>`
    + `<tr><th class="bandeau" colspan="5">${esc(titre)}</th></tr>`
    + `<tr><th></th><th class="c" colspan="2">${esc(col1)}</th><th class="c" colspan="2">${esc(col2)}</th></tr>`
    + '<tr class="sous"><th></th><th class="num">nb</th><th class="num">%</th><th class="num">nb</th><th class="num">%</th></tr>'
    + `</thead><tbody>${lignes.map(trDouble).join('')}</tbody></table>`
    + (piedDePage ? `<div class="note">${esc(piedDePage)}</div>` : '');
}

function pageSortis({ titre, structure, bloc, totalSorties, sousPop, postLibelle }) {
  const j = blocJumeau(bloc);
  const cats = lignesSimples(j.categories, structure, totalSorties);
  const cTot = cellule(j.total);
  const lignesCat = cats.filter((l) => !['total', 'sous_total'].includes(l.cle));
  const base = cTot.nb ?? null;
  const post = cellule(j.postSortie);
  const note = `(les % sont calculés sur le total des sorties ${sousPop})`;
  return `<div class="page brk">`
    + `<table class="cvg"><thead><tr><th class="bandeau" colspan="3">${esc(titre)}</th></tr>`
    + '<tr class="sous"><th></th><th class="num">nombre</th><th class="num">% du total sorties</th></tr></thead><tbody>'
    + lignesCat.map(trSimple).join('')
    + `<tr class="tot"><td>Total</td><td class="num">${v(fmtNb(cTot.nb))}</td><td class="num">${v(fmtPct(pctDe(cTot, totalSorties)))}</td></tr>`
    + '</tbody></table>'
    + (j.nonRenseigne && j.nonRenseigne.length ? `<div class="note">Non renseigné : ${esc(j.nonRenseigne.join(' · '))}.</div>` : '')
    + tableauDouble('Évolution des freins', "Difficultés à l'entrée", 'Résolution totale ou partielle à la sortie',
      lignesDoubles(j.freins, LIGNES_FREINS, base), note) + noteNr(j.freins)
    + tableauDouble('Évolution de la situation logement entrée / sortie', "Logement à l'entrée", 'Logement à la sortie',
      lignesDoubles(j.logement, LIGNES_HABITAT, base), note) + noteNr(j.logement)
    + tableauDouble('Évolution de la situation santé entrée / sortie', "À l'entrée", 'À la sortie',
      lignesDoubles(j.sante, LIGNES_SANTE, base), note) + noteNr(j.sante)
    + '<table class="cvg" style="width:70%"><thead><tr><th class="bandeau" colspan="3">Accompagnement post-sortie</th></tr>'
    + '<tr class="sous"><th></th><th class="num">nb</th><th class="num">%</th></tr></thead><tbody>'
    + `<tr><td>${esc(postLibelle)}</td><td class="num">${v(fmtNb(post.nb))}</td><td class="num">${v(fmtPct(pctDe(post, base)))}</td></tr>`
    + '</tbody></table>'
    + '</div>';
}

/**
 * Compose et ouvre la fenêtre d'impression.
 * @param {object} contenu objet rendu par `/insertion/convergence/apercu`,
 *   `/generer` (champ `contenu`) ou `/snapshot/:id`
 * @param {object} [trace] { id, genere_le, genere_par_nom } d'un instantané
 * @returns {boolean} `false` si la fenêtre a été bloquée
 */
export function exportConvergenceCvgPDF(contenu, trace = {}) {
  if (!contenu || typeof contenu !== 'object') return false;
  const P = partiesCvg(contenu);
  const e = P.en_tete;
  const periode = periodeTexte({ debut: e.periode_debut ?? e.debut, fin: e.periode_fin ?? e.fin });
  const structure = e.structure || 'Solidarité Textiles';
  const genereLe = trace.genere_le || e.genere_le;
  const generePar = trace.genere_par_nom || e.genere_par_nom || e.genere_par || e.genere_par_role;
  const numero = trace.id ?? e.snapshot_id ?? null;

  const enTetePage = (titre) => `<div class="doc-head"><div class="outil">Outil de dialogue de gestion — programme CVG</div>`
    + `<h2>${esc(titre)}</h2>`
    + `<div class="ident"><u>Structure(s)</u> : ${esc(structure)}<br/><u>Période</u> : ${esc(periode)}</div></div>`;

  let body = `<div class="header"><div><h1>Outil de dialogue de gestion — programme CVG</h1>`
    + `<div class="sub">${esc(structure)} — ${esc(periode)}</div></div>`
    + `<div style="text-align:right"><div class="sub">Convergence France</div>`
    + `<div class="sub">Édité le ${frDateHeure(genereLe)}</div></div></div>`;

  // ── Traçabilité ─────────────────────────────────────────────────────────
  body += '<table class="trace"><tbody>'
    + `<tr><td>Période couverte</td><td>${esc(periode)}</td></tr>`
    + `<tr><td>Généré le</td><td>${esc(frDateHeure(genereLe))}</td></tr>`
    + `<tr><td>Généré par</td><td>${v(generePar)}</td></tr>`
    + `<tr><td>Version de l'outil</td><td>${v(e.version)}</td></tr>`
    + `<tr><td>Exemplaire</td><td>${numero != null ? `Instantané enregistré n° ${esc(numero)}` : 'Aperçu non enregistré'}</td></tr>`
    + '</tbody></table>'
    + '<div class="note">Document agrégé — aucun nom de personne accompagnée. Les données sont celles saisies dans '
    + 'SOLIDATA à la date de génération ; une valeur non renseignée est imprimée « — », jamais 0.</div>';

  // ── Page 1 : Partie 1 — le public ────────────────────────────────────────
  const base = P.baseP1;
  body += `<div class="page">${enTetePage('Public accompagné sur la période et ressources d\'accompagnement')}`
    + '<div class="partie">Partie 1 : le public</div>'
    + '<table class="cvg" style="width:75%"><thead><tr><th class="bandeau" colspan="2">Nombre de salariés en insertion en parcours CVG</th></tr>'
    + '<tr class="sous"><th></th><th class="num">Total CVG</th></tr></thead><tbody>'
    + LIGNES_EFFECTIFS.map(([cle, lib, opt = {}]) =>
      `<tr><td>${esc(lib)}</td><td class="num">${v(fmtNb(valeurSimple(P.effectifs, cle, opt.alias)))}</td></tr>`).join('')
    + '</tbody></table>'
    + '<table class="cvg"><thead><tr><th class="bandeau" colspan="3">Les publics accompagnés dans CVG</th></tr>'
    + '<tr class="sous"><th>Personnes salariées dans l\'année</th><th class="num">Nombre</th><th class="num">% / total CVG</th></tr></thead><tbody>'
    + lignesSimples(P.publics, LIGNES_PUBLICS, base).map(trSimple).join('')
    + intertitre("Type d'habitat à l'entrée du chantier");
  const hab = lignesSimples(P.habitat, LIGNES_HABITAT, base);
  body += hab.filter((l) => !['total', 'parcours_rue'].includes(l.cle)).map(trSimple).join('');
  const totHab = cellule(P.habitat?.total);
  body += `<tr class="tot"><td>Total habitat</td><td class="num">${v(fmtNb(totHab.nb))}</td><td class="num">${v(fmtPct(pctDe(totHab, base)))}</td></tr>`;
  const rue = cellule(P.parcoursRue);
  body += `<tr class="tot"><td>Personnes ayant connu un parcours de rue</td><td class="num">${v(fmtNb(rue.nb))}</td><td class="num">${v(fmtPct(pctDe(rue, base)))}</td></tr>`
    + intertitre("Difficultés à l'entrée")
    + lignesSimples(P.difficultes, LIGNES_FREINS, base).map(trSimple).join('')
    + intertitre("Type d'orienteur (CVG)")
    + lignesSimples(P.orienteurs, LIGNES_ORIENTEURS, base).filter((l) => l.cle !== 'total').map(trSimple).join('');
  const totOr = cellule(P.orienteurs?.total);
  body += `<tr class="tot"><td>Total orienteurs</td><td class="num">${v(fmtNb(totOr.nb))}</td><td class="num">${v(fmtPct(pctDe(totOr, base)))}</td></tr>`
    + '</tbody></table>';
  const nrP1 = [
    ['Publics', nonRenseigne(P.publics)], ['Habitat', nonRenseigne(P.habitat)],
    ['Difficultés', nonRenseigne(P.difficultes)], ['Orienteurs', nonRenseigne(P.orienteurs)],
  ].filter(([, n]) => n && n.length);
  if (nrP1.length) body += `<div class="note">Non renseigné — ${esc(nrP1.map(([b, n]) => `${b} : ${n.join(', ')}`).join(' · '))}.</div>`;
  body += '</div>';

  // ── Page 2 : Partie 2 — moyens humains ───────────────────────────────────
  const ligneRes = (r, cols) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${v(c.num ? fmtNb(r[c.k]) : r[c.k])}</td>`).join('')}</tr>`;
  const internes = P.internes;
  const mutualisees = P.mutualisees;
  const tInt = {
    etp_total: P.totauxP2?.internes_etp_total ?? sommeEtp(internes, 'etp_total'),
    etp_accompagnement: P.totauxP2?.internes_etp_accompagnement ?? sommeEtp(internes, 'etp_accompagnement'),
    etp_encadrement: P.totauxP2?.internes_etp_encadrement ?? sommeEtp(internes, 'etp_encadrement'),
  };
  const tMut = P.totauxP2?.mutualisees_etp_total ?? sommeEtp(mutualisees, 'etp_total');
  const tCvg = P.totauxP2?.total ?? (tInt.etp_total == null && tMut == null ? null
    : Math.round(((tInt.etp_total || 0) + (tMut || 0)) * 100) / 100);
  body += `<div class="page brk">${enTetePage('Public accompagné sur la période et ressources d\'accompagnement')}`
    + "<div class=\"partie\">Partie 2 : moyens humains dédiés à l'accompagnement socioprofessionnel et technique dans la structure</div>"
    + '<table class="cvg"><thead><tr><th class="bandeau" colspan="2">Ressources internes</th><th class="bandeau c" colspan="3">Période en ETP</th></tr>'
    + '<tr class="sous"><th>NOM Prénom</th><th>Fonction</th><th class="num">Quotité de travail total en ETP</th>'
    + "<th class=\"num\">dont quotité de l'accompagnement</th><th class=\"num\">dont quotité de l'encadrement</th></tr></thead><tbody>"
    + (internes.length ? internes.map((r) => ligneRes(r, [{ k: 'nom' }, { k: 'fonction' }, { k: 'etp_total', num: 1 }, { k: 'etp_accompagnement', num: 1 }, { k: 'etp_encadrement', num: 1 }])).join('')
      : '<tr><td colspan="5" class="nul">Aucune ressource interne au registre pour la période.</td></tr>')
    + `<tr class="tot"><td colspan="2">Total ressources internes</td><td class="num">${v(fmtNb(tInt.etp_total))}</td>`
    + `<td class="num">${v(fmtNb(tInt.etp_accompagnement))}</td><td class="num">${v(fmtNb(tInt.etp_encadrement))}</td></tr>`
    + '</tbody></table>'
    + '<table class="cvg" style="width:75%"><thead><tr><th class="bandeau" colspan="2">Ressources mutualisées</th><th class="bandeau c">Période en ETP</th></tr>'
    + '<tr class="sous"><th>NOM Prénom</th><th>Fonction et employeur</th><th class="num">Quotité de travail total affectée au chantier</th></tr></thead><tbody>'
    + (mutualisees.length ? mutualisees.map((r) => `<tr><td>${v(r.nom)}</td><td>${v([r.fonction, r.employeur].filter(Boolean).join(' — ') || null)}</td>`
      + `<td class="num">${v(fmtNb(r.etp_total))}</td></tr>`).join('')
      : '<tr><td colspan="3" class="nul">Aucune ressource mutualisée au registre pour la période.</td></tr>')
    + `<tr class="tot"><td colspan="2">Total ressources mutualisées</td><td class="num">${v(fmtNb(tMut))}</td></tr>`
    + '</tbody></table>'
    + `<table class="cvg" style="width:75%"><tbody><tr class="grand-tot"><td>Total ressources CVG</td><td class="num">${v(fmtNb(tCvg))}</td></tr></tbody></table>`
    + '</div>';

  // ── Pages 3 et 4 : sortis ────────────────────────────────────────────────
  body += `<div class="page brk">${enTetePage('Situations des salariés CVG sortis sur la période')}`
    + '<table class="cvg" style="width:75%"><tbody>'
    + `<tr><td>Nombre de salariés CVG sortis sur la période</td><td class="num">${v(fmtNb(P.totalSorties))}</td></tr>`
    + `<tr class="tot"><td>Durée du parcours moyen en chantier des salariés sortis (nb mois)</td><td class="num">${v(fmtNb(P.dureeMoyenne))}</td></tr>`
    + '</tbody></table></div>';
  // La page d'en-tête des sortis et le premier tableau jumeau forment la même
  // page du formulaire : on retire le saut qui les sépare.
  body += pageSortis({
    titre: 'Salariés accédant à un emploi ou une formation à la sortie', structure: LIGNES_SORTIE_EMPLOI,
    bloc: P.emploi, totalSorties: P.totalSorties, sousPop: 'en emploi ou formation',
    postLibelle: 'Nombre de salariés sortis en emploi ou formation ayant bénéficié d\'un accompagnement post-sortie',
  }).replace('<div class="page brk">', '<div class="page">');
  body += pageSortis({
    titre: "Salariés n'accédant pas à l'emploi à la sortie", structure: LIGNES_SORTIE_HORS_EMPLOI,
    bloc: P.horsEmploi, totalSorties: P.totalSorties, sousPop: 'hors emploi',
    postLibelle: "Nombre de salariés n'accédant pas à l'emploi ou à une formation ayant bénéficié d'un accompagnement post-sortie",
  });

  // ── Méthode ──────────────────────────────────────────────────────────────
  const phrases = phrasesMethode(P.methode);
  body += '<div class="page brk"><div class="section-title">Méthode</div>'
    + (phrases.length ? `<ol class="methode">${phrases.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`
      : '<p class="nul">Aucune règle de méthode transmise par le serveur.</p>')
    + '</div>';

  body += '<div class="footer">Document agrégé — programme CVG, Convergence France. '
    + `${esc(structure)} — ${esc(periode)} — édité le ${frDateHeure(genereLe)}</div>`;

  // Rouge brique du formulaire Convergence pour les bandeaux ; la couleur
  // double le libellé, elle ne le remplace jamais (impression noir et blanc).
  const styles = '<style>'
    + '@page { size: A4 portrait; }'
    + '.doc-head { text-align: center; margin: 6px 0 8px; }'
    + '.doc-head .outil { font-size: 9px; color: #6b7280; }'
    + '.doc-head h2 { font-size: 14px; color: #b4432a; margin: 4px 0 6px; }'
    + '.doc-head .ident { font-size: 10.5px; text-align: left; display: inline-block; }'
    + '.partie { font-weight: 700; text-decoration: underline; margin: 8px 0 4px; font-size: 11px; }'
    + 'table.cvg { margin: 6px 0 2px; border: 1px solid #1f2937; }'
    + 'table.cvg td, table.cvg th { border: 1px solid #9ca3af; padding: 2px 5px; font-size: 9.5px; }'
    + 'table.cvg th.bandeau { background: #c0442b; color: #fff; text-align: center; font-size: 10.5px; }'
    + 'table.cvg tr.sous th { background: #f6d5c8; color: #1f2937; }'
    + 'table.cvg tr.inter td { background: #f6d5c8; font-weight: 700; text-align: center; font-size: 9px; text-transform: uppercase; }'
    + 'table.cvg tr.tot td { font-weight: 700; }'
    + 'table.cvg tr.grand-tot td { background: #c0442b; color: #fff; font-weight: 700; font-size: 11px; }'
    + 'td.dont { padding-left: 18px; font-style: italic; }'
    + 'th.c { text-align: center; }'
    + 'td.num, th.num { text-align: right; white-space: nowrap; }'
    + 'table.trace { width: 70%; margin: 8px 0 2px; } table.trace td:first-child { color: #6b7280; width: 35%; }'
    + '.nul { color: #94a3b8; font-style: italic; }'
    + '.note { font-size: 8.5px; color: #6b7280; margin: 1px 0 6px; font-style: italic; }'
    + '.brk { page-break-before: always; }'
    + 'table.cvg { page-break-inside: avoid; }'
    + 'ol.methode { margin-left: 18px; } ol.methode li { margin: 3px 0; }'
    + '</style>';

  const deb = e.periode_debut ?? e.debut ?? '';
  const fin = e.periode_fin ?? e.fin ?? '';
  return openPrintWindow(`Convergence_CVG_${deb}_${fin}`, styles + body);
}

export default exportConvergenceCvgPDF;
