/**
 * Synthèse de dialogue de gestion — PDF A4 (PR D lot 6, contrat 25 § 6).
 *
 * ═══ RENDU EXCLUSIVEMENT DEPUIS `contenu` ═════════════════════════════════
 *
 * Cette fonction ne lit RIEN d'autre que l'objet que le serveur a composé (et,
 * pour une génération enregistrée, celui qui a été ENREGISTRÉ). C'est la raison
 * d'être du snapshot : un document rejoué imprime ce qui est PARTI, pas ce que
 * le dossier dit aujourd'hui. Aller chercher une valeur ailleurs — dans un état
 * React, dans un second appel — suffirait à faire mentir la pièce.
 *
 * ═══ LES NEUF BLOCS, DANS L'ORDRE IMPOSÉ ══════════════════════════════════
 * L'ordre vient de la gestionnaire de l'autorité (09 § 2 (e)), pas de nous. La
 * page « Méthode » est OBLIGATOIRE : un taux sans sa règle n'est pas
 * contrôlable. La liste des agrégats non rendus la suit — le document dit ce
 * qu'il ne dit pas.
 *
 * Pied de page : « Signataire : la direction ». Le document engage la structure,
 * pas la personne qui a cliqué — c'est aussi pourquoi l'en-tête ne porte que le
 * RÔLE du générateur.
 */

import { openPrintWindow, esc } from './pdf-insertion';

const frDateHeure = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-FR');
};

/** Valeur d'affichage : `null` devient un tiret, jamais un zéro. */
const val = (v, suffixe = '') => {
  if (v === null || v === undefined || v === '') return '<span class="nul">—</span>';
  return esc(String(v)) + (suffixe ? `&nbsp;${suffixe}` : '');
};

/** Une ligne de tableau à deux colonnes. */
const lig = (label, v, suffixe = '') => `<tr><td>${esc(label)}</td><td class="num">${val(v, suffixe)}</td></tr>`;

/** Tableau clé/valeur à partir d'un objet de comptages. */
function tableauComptes(obj, libelles = {}) {
  const entrees = Object.entries(obj || {});
  if (!entrees.length) return '<p class="nul">Aucune donnée sur la période.</p>';
  return '<table><tbody>'
    + entrees.map(([k, v]) => lig(libelles[k] || k, v)).join('')
    + '</tbody></table>';
}

const section = (titre, corps) => `<div class="section"><div class="section-title">${esc(titre)}</div>${corps}</div>`;

/** Libellés des situations à +6 mois — mêmes mots que dans la spécification. */
const SITUATION_LABELS = {
  emploi_durable: 'Emploi durable', emploi_transition: 'Emploi de transition',
  formation: 'Formation', recherche_emploi: "Recherche d'emploi",
  autre: 'Autre situation', injoignable: 'Injoignable', non_renseigne: 'Non renseignée',
};

const CLASSIFICATION_LABELS = {
  emploi_durable: 'Emploi durable', emploi_transition: 'Emploi de transition',
  sortie_positive: 'Autre sortie positive', autre: 'Autre sortie',
  non_documentee: 'Sortie NON DOCUMENTÉE',
};

const REFERENT_LABELS = {
  structure: 'Structure', cms: 'CMS (Département)', france_travail: 'France Travail',
  autre: 'Autre', non_determine: 'NON DÉTERMINÉ',
};

const TAUX_LABELS = {
  emploi_durable: 'Emploi durable', emploi_transition: 'Emploi de transition',
  sortie_positive: 'Autre sortie positive', dynamiques: 'SORTIES DYNAMIQUES',
};

/**
 * Compose et ouvre la fenêtre d'impression.
 * @param {object} contenu l'objet rendu par `/insertion/reporting/dialogue-gestion`
 * @returns {boolean} `false` si la fenêtre a été bloquée (l'appelant l'affiche
 *   dans son propre bandeau — aucune boîte native dans ce module)
 */
export function exportDialogueGestionPDF(contenu) {
  if (!contenu || !contenu.blocs) return false;
  const e = contenu.en_tete || {};
  const B = contenu.blocs;
  const periode = e.trimestre ? `${e.annee} — ${e.trimestre}ᵉ trimestre` : `Année ${e.annee}`;

  let body = `<div class="header"><div><h1>Synthèse de dialogue de gestion</h1>`
    + `<div class="sub">${esc(e.structure || 'Solidarité Textiles')} — ${esc(periode)}</div></div>`
    + `<div style="text-align:right"><div class="sub">${esc(e.mention || '')}</div>`
    + `<div class="sub">Édité le ${frDateHeure(e.genere_le)}</div></div></div>`;

  // ── En-tête de traçabilité (règle commune des exports de l'autorité) ─────
  body += section('Traçabilité du document', '<table><tbody>'
    + lig('Période couverte', `${e.periode_debut || '—'} → ${e.periode_fin || '—'}`)
    + lig('Généré le', frDateHeure(e.genere_le))
    + lig('Généré par (rôle)', e.genere_par_role)
    + lig("Version de l'outil", e.version)
    + lig('Périmètre', e.perimetre)
    + lig('Type', e.trimestre ? 'Version trimestrielle allégée (blocs 2 et 8)' : 'Version annuelle complète')
    + '</tbody></table>'
    + `<div class="note">Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, `
    + `Immersion Facilitée, Ma Démarche FSE+) font foi en cas d'écart.</div>`);

  // ── 1. Effectifs et ETP ──────────────────────────────────────────────────
  if (B['1_effectifs_etp']) {
    const b = B['1_effectifs_etp'];
    const lignesMois = (b.mois || []).map((m) =>
      `<tr><td>${esc(m.mois)}</td><td class="num">${val(m.etp_asp)}</td><td class="num">${val(m.effectif_pondere)}</td></tr>`).join('');
    body += section('1. Effectifs et ETP',
      '<table><tbody>'
      + lig('Base de calcul', b.base_heures, 'heures annuelles par ETP')
      + lig('ETP conventionnés (annexe financière)',
        b.etp_conventionnes == null ? 'objectif non paramétré' : b.etp_conventionnes)
      + lig('ETP ASP moyen (mois validés)', b.etp_asp_moyen)
      + lig('Mois ASP validés', b.nb_mois_asp_valides)
      + lig('Taux de réalisation',
        b.taux_realisation_pct == null ? 'objectif non paramétré' : `${b.taux_realisation_pct} %`)
      + '</tbody></table>'
      + '<table style="margin-top:6px"><thead><tr><th>Mois</th><th class="num">ETP ASP validé</th>'
      + '<th class="num">Effectif pondéré (contrôle ERP)</th></tr></thead>'
      + `<tbody>${lignesMois || '<tr><td colspan="3" class="nul">Aucun mois disponible.</td></tr>'}</tbody></table>`
      + `<div class="note">${esc(b.note || '')}</div>`);
  }

  // ── 2. Publics à l'entrée ────────────────────────────────────────────────
  const b2 = B['2_publics_entree'];
  if (b2) {
    if (b2.indisponible) {
      body += section("2. Publics à l'entrée", `<p class="nul">${esc(b2.note || 'Bloc non composé.')}</p>`);
    } else {
      const criteres = (b2.par_critere_eligibilite || []).length
        ? '<table><thead><tr><th>Critère d\'éligibilité IAE</th><th class="num">Effectif</th><th class="num">Part</th></tr></thead><tbody>'
          + b2.par_critere_eligibilite.map((c) =>
            `<tr><td>${esc(c.libelle)}</td><td class="num">${val(c.n)}</td><td class="num">${val(c.part_pct, '%')}</td></tr>`).join('')
          + '</tbody></table>'
        : '<p class="nul">Aucun critère d\'éligibilité saisi sur la période.</p>';
      body += section("2. Publics à l'entrée",
        '<table><tbody>'
        + lig('Effectif de la cohorte', b2.effectif, 'personne(s)')
        + lig("BRSA — compte de l'outil", b2.brsa?.n)
        + lig('BRSA — part', b2.brsa?.part_pct, '%')
        + lig("BRSA — déclaré à l'ASP", b2.brsa?.n_asp)
        + '</tbody></table>'
        + criteres
        + '<div class="two" style="margin-top:6px">'
        + `<div style="flex:1"><div class="mini-h">Catégorie France Travail</div>${tableauComptes(b2.par_categorie_ft)}</div>`
        + `<div style="flex:1"><div class="mini-h">Référent unique</div>${tableauComptes(b2.par_referent_unique, REFERENT_LABELS)}</div>`
        + '</div>'
        + '<div class="two" style="margin-top:6px">'
        + `<div style="flex:1"><div class="mini-h">Sexe</div>${tableauComptes(b2.sexe)}</div>`
        + `<div style="flex:1"><div class="mini-h">Tranches d'âge</div>${tableauComptes(b2.tranches_age)}</div>`
        + `<div style="flex:1"><div class="mini-h">Niveaux de formation</div>${tableauComptes(b2.niveaux_formation)}</div>`
        + '</div>');
    }
  }

  // ── 3. Freins ────────────────────────────────────────────────────────────
  if (B['3_freins']) {
    const b = B['3_freins'];
    const lignes = (b.par_axe || []).map((a) =>
      `<tr><td>${esc(a.label)}</td><td class="num">${val(a.concernes_entree)}</td>`
      + `<td class="num vert">${val(a.leves)}</td><td class="num">${val(a.stables)}</td>`
      + `<td class="num rouge">${val(a.aggraves)}</td><td class="num">${val(a.non_evalues)}</td>`
      + `<td class="num">${val(a.actions_engagees)}</td><td>${val(a.partenaire_principal)}</td>`
      + `<td class="num">${val(a.orientations_dora)}</td></tr>`).join('');
    body += section('3. Freins — entrée → dernière évaluation',
      '<table><thead><tr><th>Axe</th><th class="num">Concernés à l\'entrée</th><th class="num">Levés</th>'
      + '<th class="num">Stables</th><th class="num">Aggravés</th><th class="num">Non évalués</th>'
      + '<th class="num">Actions</th><th>Partenaire principal</th><th class="num">DORA</th></tr></thead>'
      + `<tbody>${lignes}</tbody></table>`
      + `<div class="note">${esc(b.echelle || '')}</div>`);
  }

  // ── 4. Accompagnement ────────────────────────────────────────────────────
  if (B['4_accompagnement']) {
    const b = B['4_accompagnement'];
    const entretiens = (b.entretiens || []).map((x) =>
      `<tr><td>${esc(x.label)}</td><td class="num">${val(x.realises)}</td>`
      + `<td class="num">${val(x.echus)}</td><td class="num">${val(x.taux_pct, '%')}</td></tr>`).join('');
    const aides = (b.aides_mobilisees || []).length
      ? '<table style="margin-top:6px"><thead><tr><th>Aide mobilisée</th><th class="num">Nombre</th><th class="num">Montant total</th></tr></thead><tbody>'
        + b.aides_mobilisees.map((a) =>
          `<tr><td>${esc(a.label)}</td><td class="num">${val(a.n)}</td><td class="num">${val(a.montant_total, '€')}</td></tr>`).join('')
        + '</tbody></table>'
        + '<div class="note">Un montant n\'est rendu que si au moins une aide de cette nature est chiffrée : une aide non chiffrée ne vaut pas zéro euro.</div>'
      : '<p class="nul">Aucune aide mobilisée saisie sur la période.</p>';
    const h = b.heures_accompagnement;
    body += section('4. Accompagnement',
      '<table><thead><tr><th>Type d\'entretien</th><th class="num">Réalisés</th><th class="num">Échus</th><th class="num">Taux</th></tr></thead>'
      + `<tbody>${entretiens}</tbody></table>`
      + '<table style="margin-top:6px"><tbody>'
      + lig("Heures d'accompagnement — total", h ? h.total_h : null, 'h')
      + lig("Heures d'accompagnement — personnes concernées", h ? h.nb_personnes : null)
      + lig("Heures d'accompagnement — moyenne par personne", h ? h.moyenne_par_personne_h : null, 'h')
      + lig("Délai moyen du diagnostic d'accueil", b.delai_moyen_diagnostic_jours, 'jours')
      + '</tbody></table>'
      + aides);
  }

  // ── 5. Immersions ────────────────────────────────────────────────────────
  const b5 = B['5_immersions'];
  if (b5) {
    if (b5.indisponible) {
      body += section('5. Immersions (PMSMP)', `<p class="nul">${esc(b5.note || 'Bloc non composé.')}</p>`);
    } else {
      const lbl = b5.par_debouche_labels || {};
      body += section('5. Immersions (PMSMP)',
        '<table><tbody>'
        + lig('Conventions', b5.conventions)
        + lig('Jours calendaires', b5.jours)
        + lig("Entreprises d'accueil distinctes", b5.entreprises_distinctes)
        + lig("Dont embauche chez l'entreprise d'accueil", b5.embauches_chez_accueillant)
        + '</tbody></table>'
        + `<div class="mini-h" style="margin-top:6px">Débouché</div>${tableauComptes(b5.par_debouche, lbl)}`
        + (b5.liste_entreprises === null
          ? '<div class="note">Entreprises d\'accueil : non rendues — moins de conventions que le seuil de confidentialité.</div>'
          : ((b5.liste_entreprises || []).length
            ? `<div class="note"><strong>Entreprises d'accueil :</strong> ${esc(b5.liste_entreprises.join(' · '))}</div>`
            : '')));
    }
  }

  // ── 6. Sorties ───────────────────────────────────────────────────────────
  if (B['6_sorties']) {
    const s = B['6_sorties'];
    const mb = s.methode_b || {};
    const ma = s.methode_a;
    const ligneTaux = (cle) =>
      `<tr><td>${esc(TAUX_LABELS[cle] || cle)}</td>`
      + `<td class="num">${val(mb.taux_pct?.[cle], '%')}</td>`
      + `<td class="num">${mb.ecart_cible ? val(mb.ecart_cible[cle], 'pt') : '<span class="nul">objectif non paramétré</span>'}</td>`
      + (ma ? `<td class="num gris">${val(ma.taux_pct?.[cle], '%')}</td>` : '')
      + '</tr>';
    body += section('6. Sorties',
      '<table><tbody>'
      + lig('Méthode B — dénominateur (fins de parcours)', mb.denominateur)
      + lig('Dont sorties documentées', mb.documentees)
      + lig('Dont SORTIES NON DOCUMENTÉES', mb.non_documentees)
      + '</tbody></table>'
      + `<div class="mini-h" style="margin-top:6px">Par catégorie officielle</div>${tableauComptes(mb.par_classification, CLASSIFICATION_LABELS)}`
      + '<table style="margin-top:6px"><thead><tr><th>Taux</th><th class="num">Méthode B</th><th class="num">Écart à la cible</th>'
      + (ma ? '<th class="num">Méthode A (historique)</th>' : '') + '</tr></thead><tbody>'
      + ['emploi_durable', 'emploi_transition', 'sortie_positive', 'dynamiques'].map(ligneTaux).join('')
      + '</tbody></table>'
      + (ma
        ? `<div class="note">Méthode A : méthode historique (dénominateur = bilans de sortie classés seuls, ${ma.denominateur}). `
          + `Imprimée pour l'exercice ${esc(String(s.annee))} seulement, le temps de la rupture de série.</div>`
        : '')
      + '<table style="margin-top:6px"><tbody>'
      + lig("Sorties déclarées à l'ASP", s.rapprochement_asp?.sorties_asp)
      + lig('Écart outil / ASP', s.rapprochement_asp?.ecart)
      + '</tbody></table>'
      + `<div class="note">${esc(s.rapprochement_asp?.note || '')}</div>`);
  }

  // ── 7. Résultats ─────────────────────────────────────────────────────────
  if (B['7_resultats']) {
    const b = B['7_resultats'];
    body += section('7. Résultats',
      `<div class="mini-h">Situation à +6 mois</div>${tableauComptes(b.situation_6_mois, SITUATION_LABELS)}`
      + '<table style="margin-top:6px"><tbody>'
      + lig('Sorties suivies', b.nb_sorties_suivies)
      + lig('Satisfaction de sortie — réponses', b.satisfaction?.nb_reponses)
      + lig(`Satisfaction de sortie — moyenne (${b.satisfaction?.echelle || '1 à 4'})`, b.satisfaction?.moyenne_globale)
      + '</tbody></table>');
  }

  // ── 8. Conformité ────────────────────────────────────────────────────────
  if (B['8_conformite']) {
    const b = B['8_conformite'];
    const fse = (b.completude_fse_par_projet || []).length
      ? '<table><thead><tr><th>Projet cofinancé</th><th class="num">Participants</th>'
        + '<th class="num">Dossiers complets</th><th class="num">Complétude</th></tr></thead><tbody>'
        + b.completude_fse_par_projet.map((c) =>
          `<tr><td>${esc(c.projet)}</td><td class="num">${val(c.participants)}</td>`
          + `<td class="num">${val(c.complets)}</td><td class="num">${val(c.pct, '%')}</td></tr>`).join('')
        + '</tbody></table>'
      : '<p class="nul">Aucun projet cofinancé actif sur la période.</p>';
    const r = b.ruptures_droits_evitees || {};
    body += section('8. Conformité',
      fse
      + '<table style="margin-top:6px"><tbody>'
      + lig("Points d'étape tenus avec le référent unique", b.points_etape_referent)
      + lig("Fiches d'alimentation remises au référent", b.fiches_referent_transmises)
      + lig('Actualisations France Travail rappelées', b.actualisations_ft_rappelees)
      + lig('Entretiens de conciliation', b.conciliations)
      + lig('Personnes ayant connu au moins une semaine sous le plancher',
        b.semaines_sous_15h?.nb_personnes_concernees)
      + lig('Nombre total de semaines sous le plancher', b.semaines_sous_15h?.nb_semaines)
      + '</tbody></table>'
      + '<div class="mini-h" style="margin-top:6px">Ruptures de droits évitées</div>'
      + '<table><tbody>'
      + lig('Actualisations rappelées', r.actualisations_rappelees)
      + lig('Motifs légitimes documentés', r.motifs_legitimes_documentes)
      + lig('Conciliations tracées', r.conciliations_tracees)
      + lig('TOTAL', r.total)
      + '</tbody></table>');
  }

  // ── 9. Méthode (page dédiée, OBLIGATOIRE) ────────────────────────────────
  const methode = B['9_methode'] || [];
  body += `<div class="section brk"><div class="section-title">9. Méthode de calcul</div>`
    + '<table><thead><tr><th style="width:26%">Indicateur</th><th>Règle appliquée</th></tr></thead><tbody>'
    + methode.map((m) => `<tr><td><strong>${esc(m.indicateur)}</strong></td><td>${esc(m.regle)}</td></tr>`).join('')
    + '</tbody></table>';

  // CORRECTIF B-01 — un COMPTE par bloc, jamais le chemin de la case retirée :
  // sur une ventilation qui somme à un effectif publié, ce chemin désignait la
  // case à reconstituer par soustraction, et transformait une bonne intention
  // — « le document dit ce qu'il ne dit pas » — en mode d'emploi.
  const sousSeuil = contenu.sous_seuil || [];
  const totalSeuil = contenu.sous_seuil_total
    ?? sousSeuil.reduce((a, b) => a + (Number(b && b.nb) || 0), 0);
  body += totalSeuil
    ? `<div class="note" style="margin-top:8px"><strong>${esc(String(totalSeuil))} agrégat(s) non rendu(s)</strong> `
      + `(moins de ${esc(String(e.k_anonymat || 5))} personnes concernées), répartis ainsi : `
      + esc(sousSeuil.map((b) => `${b.libelle || b.bloc} : ${b.nb}`).join(' · '))
      + '. Leur emplacement exact n\'est pas indiqué : il permettrait de les reconstituer par soustraction.</div>'
    : '<div class="note" style="margin-top:8px">Aucun agrégat n\'a été retiré au titre du seuil de confidentialité.</div>';
  body += '</div>';

  body += '<div class="footer"><strong>Signataire : la direction</strong> — Document agrégé non nominatif. '
    + 'Aucune donnée permettant d\'identifier une personne accompagnée ne figure dans ce document.<br/>'
    + `Solidarité Textiles — ${esc(periode)} — édité le ${frDateHeure(e.genere_le)}</div>`;

  // Styles PROPRES à ce document, ajoutés à ceux d'`openPrintWindow` (colonnes
  // numériques alignées à droite, valeurs absentes grisées, levés/aggravés
  // colorés — la couleur DOUBLE le libellé, elle ne le remplace jamais : un
  // document imprimé en noir et blanc doit rester lisible).
  const styles = '<style>'
    + 'td.num, th.num { text-align: right; white-space: nowrap; }'
    + '.nul { color: #94a3b8; font-style: italic; }'
    + '.vert { color: #15803d; font-weight: 600; } .rouge { color: #b91c1c; font-weight: 600; } .gris { color: #64748b; }'
    + '.mini-h { font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 700; margin: 6px 0 2px; }'
    + '.two { display: flex; gap: 12px; align-items: flex-start; }'
    + '.note { font-size: 8.5px; color: #6b7280; margin-top: 4px; }'
    + '.brk { page-break-before: always; }'
    + 'table { margin-top: 2px; } .section { page-break-inside: avoid; }'
    + '</style>';

  return openPrintWindow(
    `Dialogue_gestion_${e.annee || ''}${e.trimestre ? `_T${e.trimestre}` : ''}`,
    styles + body
  );
}

export default exportDialogueGestionPDF;
