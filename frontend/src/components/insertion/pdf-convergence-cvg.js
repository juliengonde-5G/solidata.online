/**
 * « Outil de dialogue de gestion — programme CVG » (Convergence France) —
 * PDF A4 portrait par fenêtre d'impression (lot 2.60.0, contrat 30 § 2.4).
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
 *
 * 2.60.0 (revue de sécurité PR E) — une case RETENUE au titre de la
 * confidentialité s'imprime « s » avec sa légende (B-01) ; le frein « Justice »
 * non transmis s'imprime « non transmis (art. 10 RGPD) » (B-02) ; la mention
 * de DIFFUSION RESTREINTE figure en tête de CHAQUE page dès que le document
 * porte des effectifs inférieurs à 5.
 */

import { openPrintWindow, esc } from './pdf-insertion';
import {
  partiesCvg, blocJumeau, lignesSimples, lignesDoubles, valeurSimple, nonRenseigne,
  LIGNES_EFFECTIFS, LIGNES_PUBLICS, LIGNES_HABITAT, LIGNES_FREINS, LIGNES_ORIENTEURS,
  LIGNES_SORTIE_EMPLOI, LIGNES_SORTIE_HORS_EMPLOI, LIGNES_SANTE,
  fmtNb, fmtPct, pctDe, cellule, sommeEtp, phrasesMethode, periodeTexte,
  MENTION_NON_TRANSMIS, legendeSecret, ligneSecrete,
} from './convergence-cvg-structure';

const frDateHeure = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-FR');
};

const nul = '<span class="nul">—</span>';
const v = (x) => (x === null || x === undefined ? nul : esc(x));
/** Case retenue (B-01) : « s », expliqué par la légende — jamais « — » ni 0. */
const SECRET = '<span class="secret">s</span>';
const nbC = (c) => (c && c.secret ? SECRET : v(fmtNb(c && c.nb)));
const pctC = (c) => (c && c.secret ? SECRET : v(fmtPct(c && c.pct)));
const nonTransmisTd = (span) => `<td class="num nt" colspan="${span}">${esc(MENTION_NON_TRANSMIS)}</td>`;

const trSimple = (l) => `<tr class="${l.bold ? 'tot' : ''}"><td class="${l.indent ? 'dont' : ''}">${esc(l.libelle)}</td>`
  + (l.nonTransmis ? nonTransmisTd(2) : `<td class="num">${nbC(l)}</td><td class="num">${pctC(l)}</td>`) + '</tr>';

const trDouble = (l) => `<tr><td class="${l.indent ? 'dont' : ''}">${esc(l.libelle)}</td>`
  + (l.nonTransmis ? nonTransmisTd(4)
    : `<td class="num">${nbC(l.entree)}</td><td class="num">${pctC(l.entree)}</td>`
      + `<td class="num">${nbC(l.sortie)}</td><td class="num">${pctC(l.sortie)}</td>`) + '</tr>';

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

function pageSortis({ titre, structure, bloc, totalSorties, sousPop, postLibelle, nonTransmis = [] }) {
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
    + (j.confidentialite ? `<div class="note conf">Tableau de moins de ${esc(j.confidentialite.k)} personnes : les lignes santé et justice, le logement et « dont parcours de soin » ne sont pas diffusés (« s ») — la catégorie de sortie désigne les personnes.</div>` : '')
    + tableauDouble('Évolution des freins', "Difficultés à l'entrée", 'Résolution totale ou partielle à la sortie',
      lignesDoubles(j.freins, LIGNES_FREINS, base, { nonTransmis }), note) + noteNr(j.freins)
    + tableauDouble('Évolution de la situation logement entrée / sortie', "Logement à l'entrée", 'Logement à la sortie',
      lignesDoubles(j.logement, LIGNES_HABITAT, base), note) + noteNr(j.logement)
    + tableauDouble('Évolution de la situation santé entrée / sortie', "À l'entrée", 'À la sortie',
      lignesDoubles(j.sante, LIGNES_SANTE, base), note) + noteNr(j.sante)
    + '<table class="cvg" style="width:70%"><thead><tr><th class="bandeau" colspan="3">Accompagnement post-sortie</th></tr>'
    + '<tr class="sous"><th></th><th class="num">nb</th><th class="num">%</th></tr></thead><tbody>'
    + `<tr><td>${esc(postLibelle)}</td><td class="num">${nbC(post)}</td><td class="num">${post.secret ? SECRET : v(fmtPct(pctDe(post, base)))}</td></tr>`
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

  // B-01 — mention de diffusion restreinte : encadrée en tête du document, et
  // répétée en tête de CHAQUE page imprimée par une boîte de marge `@page`
  // (une page de tableau qui déborde sur la suivante la porte aussi).
  const mentionDiffusion = P.mentionDiffusion
    ? `<div class="diffusion">DIFFUSION RESTREINTE — ${esc(P.mentionDiffusion)}</div>` : '';
  const enTetePage = (titre) => `<div class="doc-head"><div class="outil">Outil de dialogue de gestion — programme CVG</div>`
    + `<h2>${esc(titre)}</h2>`
    + `<div class="ident"><u>Structure(s)</u> : ${esc(structure)}<br/><u>Période</u> : ${esc(periode)}</div></div>`;

  let body = `<div class="header"><div><h1>Outil de dialogue de gestion — programme CVG</h1>`
    + `<div class="sub">${esc(structure)} — ${esc(periode)}</div></div>`
    + `<div style="text-align:right"><div class="sub">Convergence France</div>`
    + `<div class="sub">Édité le ${frDateHeure(genereLe)}</div></div></div>`;

  // ── Traçabilité ─────────────────────────────────────────────────────────
  body += mentionDiffusion + '<table class="trace"><tbody>'
    + `<tr><td>Période couverte</td><td>${esc(periode)}</td></tr>`
    + `<tr><td>Généré le</td><td>${esc(frDateHeure(genereLe))}</td></tr>`
    + `<tr><td>Généré par</td><td>${v(generePar)}</td></tr>`
    + `<tr><td>Version de l'outil</td><td>${v(e.version)}</td></tr>`
    + `<tr><td>Exemplaire</td><td>${numero != null ? `Instantané enregistré n° ${esc(numero)}` : 'Aperçu non enregistré'}</td></tr>`
    + '</tbody></table>'
    + '<div class="note">Document agrégé — aucun nom de personne accompagnée, mais des effectifs très faibles peuvent '
    + 'désigner une personne. Les données sont celles saisies dans SOLIDATA à la date de génération ; une valeur non '
    + 'renseignée est imprimée « — », jamais 0.</div>'
    + (P.confidentialite
      ? `<div class="note">Seuil de confidentialité appliqué : k = ${esc(P.confidentialite.k_min)}${P.confidentialite.k_min > 1 ? ` — ${esc(legendeSecret(P.confidentialite.k_min))}` : ' (aucune case retenue — format brut du réseau, décision de la structure).'}</div>`
      : '');

  // ── Page 1 : Partie 1 — le public ────────────────────────────────────────
  const base = P.baseP1;
  body += `<div class="page">${enTetePage('Public accompagné sur la période et ressources d\'accompagnement')}`
    + '<div class="partie">Partie 1 : le public</div>'
    + '<table class="cvg" style="width:75%"><thead><tr><th class="bandeau" colspan="2">Nombre de salariés en insertion en parcours CVG</th></tr>'
    + '<tr class="sous"><th></th><th class="num">Total CVG</th></tr></thead><tbody>'
    + LIGNES_EFFECTIFS.map(([cle, lib, opt = {}]) =>
      `<tr><td>${esc(lib)}</td><td class="num">${v(fmtNb(valeurSimple(P.effectifs, cle, opt.alias)))}</td></tr>`).join('')
    + '</tbody></table>'
    + '<table class="cvg longue"><thead><tr><th class="bandeau" colspan="3">Les publics accompagnés dans CVG</th></tr>'
    + '<tr class="sous"><th>Personnes salariées dans l\'année</th><th class="num">Nombre</th><th class="num">% / total CVG</th></tr></thead><tbody>'
    + lignesSimples(P.publics, LIGNES_PUBLICS, base).map(trSimple).join('')
    + intertitre("Type d'habitat à l'entrée du chantier");
  const hab = lignesSimples(P.habitat, LIGNES_HABITAT, base);
  body += hab.filter((l) => !['total', 'parcours_rue'].includes(l.cle)).map(trSimple).join('');
  const totHab = cellule(P.habitat?.total);
  body += trSimple({ libelle: 'Total habitat', nb: totHab.nb, pct: pctDe(totHab, base), secret: totHab.secret, bold: true });
  const rue = cellule(P.parcoursRue);
  body += trSimple({ libelle: 'Personnes ayant connu un parcours de rue', nb: rue.nb, pct: pctDe(rue, base), secret: rue.secret, bold: true })
    + intertitre("Difficultés à l'entrée")
    + lignesSimples(P.difficultes, LIGNES_FREINS, base, { nonTransmis: P.nonTransmis }).map(trSimple).join('')
    + intertitre("Type d'orienteur (CVG)")
    + lignesSimples(P.orienteurs, LIGNES_ORIENTEURS, base).filter((l) => l.cle !== 'total').map(trSimple).join('');
  const totOr = cellule(P.orienteurs?.total);
  body += trSimple({ libelle: 'Total orienteurs', nb: totOr.nb, pct: pctDe(totOr, base), secret: totOr.secret, bold: true })
    + '</tbody></table>';
  const secretsP1 = [
    ...lignesSimples(P.publics, LIGNES_PUBLICS, base), ...lignesSimples(P.habitat, LIGNES_HABITAT, base),
    ...lignesSimples(P.difficultes, LIGNES_FREINS, base), ...lignesSimples(P.orienteurs, LIGNES_ORIENTEURS, base),
  ].some(ligneSecrete) || totHab.secret || rue.secret || totOr.secret;
  if (secretsP1) body += `<div class="note conf">${esc(legendeSecret(P.confidentialite?.k_min))}</div>`;
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
    bloc: P.emploi, totalSorties: P.totalSorties, sousPop: 'en emploi ou formation', nonTransmis: P.nonTransmis,
    postLibelle: 'Nombre de salariés sortis en emploi ou formation ayant bénéficié d\'un accompagnement post-sortie',
  }).replace('<div class="page brk">', '<div class="page">');
  body += pageSortis({
    titre: "Salariés n'accédant pas à l'emploi à la sortie", structure: LIGNES_SORTIE_HORS_EMPLOI,
    bloc: P.horsEmploi, totalSorties: P.totalSorties, sousPop: 'hors emploi', nonTransmis: P.nonTransmis,
    postLibelle: "Nombre de salariés n'accédant pas à l'emploi ou à une formation ayant bénéficié d'un accompagnement post-sortie",
  });

  // ── Méthode ──────────────────────────────────────────────────────────────
  const phrases = phrasesMethode(P.methode);
  // La méthode suit le dernier tableau : une page pour quatre lignes se lisait
  // comme une page blanche. Elle ne se coupe pas pour autant (page-break-inside).
  body += '<div class="page" style="page-break-inside: avoid; margin-top: 14px"><div class="section-title">Méthode</div>'
    + (phrases.length ? `<ol class="methode">${phrases.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`
      : '<p class="nul">Aucune règle de méthode transmise par le serveur.</p>')
    + '</div>';

  body += `<div class="footer">${P.mentionDiffusion ? 'Diffusion restreinte — ' : ''}Document agrégé, sans nom — programme CVG. `
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
    // Pied de page resserré : la mention de diffusion restreinte (2.60.0) ne
    // doit pas coûter une page au document.
    + '.footer { margin-top: 6px; padding-top: 4px; }'
    + '.nul { color: #94a3b8; font-style: italic; }'
    + '.secret { color: #475569; font-style: italic; font-weight: 700; }'
    + 'td.nt { font-style: italic; color: #475569; text-align: right; font-size: 8.5px; }'
    + '.note.conf { color: #334155; }'
    + '.diffusion { border: 1px solid #b45309; background: #fffbeb; color: #78350f; font-size: 8.5px; font-weight: 700; padding: 3px 6px; margin: 0 0 4px; text-align: center; }'
    + '.note { font-size: 8.5px; color: #6b7280; margin: 1px 0 6px; font-style: italic; }'
    + '.brk { page-break-before: always; }'
    // Un tableau court ne se coupe jamais ; le tableau des publics (35 lignes)
    // DOIT pouvoir se couper, sinon il est repoussé entier sur la page suivante
    // et la première page reste aux trois quarts vide (constaté au rendu Chromium
    // du 25/09/2026) — ses lignes, elles, restent insécables et l'en-tête se
    // répète en haut de la page suivante (thead = table-header-group).
    + 'table.cvg { page-break-inside: avoid; }'
    + 'table.cvg.longue { page-break-inside: auto; } table.cvg.longue tr { page-break-inside: avoid; }'
    + 'table.cvg thead { display: table-header-group; }'
    + 'ol.methode { margin-left: 18px; } ol.methode li { margin: 3px 0; }'
    // Chaîne CSS : `\`, `"` et `<` sont neutralisés (le texte vient du serveur,
    // constante fermée — l'échappement reste posé par principe).
    + (P.mentionDiffusion
      ? `@page { @top-center { content: "DIFFUSION RESTREINTE — ${String(P.mentionDiffusion).replace(/[\\"]/g, '\\$&').replace(/[\n\r]/g, ' ').replace(/</g, '\\3c ')}"; `
        + 'font-family: Arial, sans-serif; font-size: 7pt; font-weight: 700; color: #78350f; } }'
      : '')
    + '</style>';

  const deb = e.periode_debut ?? e.debut ?? '';
  const fin = e.periode_fin ?? e.fin ?? '';
  return openPrintWindow(`Convergence_CVG_${deb}_${fin}`, styles + body);
}

export default exportConvergenceCvgPDF;
