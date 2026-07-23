/**
 * Gabarits PDF du module Insertion (impression navigateur A4 — même mécanisme
 * que les fiches PCM : fenêtre dédiée + window.print()).
 *
 * REC-UX-09 : DEUX variantes par document —
 *  - 'salarie' : exemplaire REMIS AU SALARIÉ, langage simple (FALC), gros
 *    caractères, bloc « Ce que nous avons décidé », évolution des freins en
 *    pictos ↗ ↘ =, SANS champs internes (points de vigilance, observations CIP)
 *    ni données sensibles (jamais le frein judiciaire, jamais les détails santé).
 *  - 'dossier' : exemplaire complet pour le dossier (selon habilitation — les
 *    champs masqués par le backend pour un MANAGER sont simplement absents).
 * Mention RGPD en pied de page dans les deux cas.
 */

import {
  FREINS, ENTRETIEN_STATUS_LABELS, ENTRETIEN_TYPE_LABELS, SORTIE_CLASS_LABELS,
  ACTION_STATUS_LABELS, ACTION_CATEGORY_LABELS, entretienLabel,
} from './freins';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

const RGPD_FOOTER = (variante) =>
  '<div class="footer">SOLIDATA ERP — Document confidentiel. Données personnelles traitées dans le cadre de '
  + 'l\'accompagnement socio-professionnel (RGPD) : droits d\'accès, de rectification et d\'effacement auprès de la structure.'
  + (variante === 'salarie' ? ' Ce document vous appartient.' : '')
  + ' — édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>';

export function openPrintWindow(title, bodyHtml, { large = false } = {}) {
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (!w) { alert('Popup bloquée — autorisez les popups pour exporter le PDF.'); return; }
  w.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>' + esc(title) + '</title><style>'
    + '@page { size: A4; margin: 15mm 12mm; }'
    + '* { box-sizing: border-box; margin: 0; padding: 0; }'
    + "body { font-family: 'Segoe UI', Arial, sans-serif; font-size: " + (large ? '14px' : '11px') + "; color: #1a1a1a; line-height: " + (large ? '1.6' : '1.45') + '; }'
    + '.header { background: #0D9488; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }'
    + '.header h1 { font-size: ' + (large ? '22px' : '18px') + '; font-weight: 700; }'
    + '.header .sub { font-size: ' + (large ? '13px' : '11px') + '; opacity: .9; }'
    + '.section { margin: 12px 0; padding: 0 4px; }'
    + '.section-title { font-size: ' + (large ? '16px' : '13px') + '; font-weight: 700; color: #0D9488; border-bottom: 2px solid #0D9488; padding-bottom: 3px; margin-bottom: 8px; }'
    + '.card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; white-space: pre-wrap; }'
    + '.hl { background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px; padding: 12px; }'
    + '.hl ul { margin-left: 18px; }'
    + '.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: white; font-size: 10px; font-weight: 600; }'
    + 'table { width: 100%; border-collapse: collapse; font-size: ' + (large ? '13px' : '10px') + '; }'
    + 'th { background: #f9fafb; text-align: left; padding: 5px 6px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }'
    + 'td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }'
    + '.picto { font-size: ' + (large ? '16px' : '12px') + '; font-weight: 700; }'
    + '.up { color: #dc2626; } .down { color: #16a34a; } .eq { color: #6b7280; }'
    + '.footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; }'
    + '.sign { display: flex; gap: 24px; margin-top: 18px; } .sign > div { flex: 1; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 10px; min-height: 64px; font-size: 11px; color: #64748b; }'
    + '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
    + '</style></head><body>' + bodyHtml + '</body></html>');
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// Axes de freins pour un document : jamais le judiciaire en variante salarié ;
// en variante dossier, seuls les axes présents dans les données (le masquage
// MANAGER retire les clés — on ne montre que ce qui existe).
function freinsForDoc(row, variante) {
  return FREINS.filter((f) => {
    if (f.key !== 'judiciaire') return true;
    if (variante === 'salarie') return false; // JAMAIS sur l'exemplaire salarié
    // Dossier : seulement si la clé est présente (le masquage MANAGER la retire).
    return !!row && (f.column in row);
  });
}

const pictoDelta = (prev, cur) => {
  if (cur == null || prev == null) return '<span class="picto eq">·</span>';
  if (cur < prev) return '<span class="picto down">↘</span>';
  if (cur > prev) return '<span class="picto up">↗</span>';
  return '<span class="picto eq">=</span>';
};

// ═══════════════════════════════════════════
// DIAGNOSTIC D'ACCUEIL
// ═══════════════════════════════════════════

const DIAG_RUBRIQUES_DOSSIER = [
  ['Parcours antérieur', 'parcours_anterieur'],
  ['Logement — commentaire', 'commentaire_logement'],
  ['Droits & administratif — commentaire', 'commentaire_droits'],
  ['Santé — commentaire', 'commentaire_sante'],
  ['Budget — commentaire', 'commentaire_budget'],
  ['Mobilité — commentaire', 'commentaire_mobilite'],
  ['Français & langues — commentaire', 'commentaire_linguistique'],
  ['Projet professionnel — commentaire', 'commentaire_projet'],
  ['Attentes exprimées par le salarié', 'attentes_parcours'],
  ['Difficultés exprimées', 'difficultes_exprimees'],
  ['Objectifs exprimés', 'objectifs_exprimes'],
  ['Aide souhaitée', 'aide_souhaitee'],
  ['Points forts observés', 'obs_points_forts'],
  ['Difficultés observées', 'obs_difficultes'],
];

/**
 * Fiche diagnostic d'accueil.
 * @param {object} p { employee, diagnostic, variante: 'salarie'|'dossier' }
 */
export function exportDiagnosticPDF({ employee = {}, diagnostic = {}, variante = 'dossier' }) {
  const nom = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  const d = diagnostic || {};
  const axes = freinsForDoc(d, variante);

  if (variante === 'salarie') {
    // FALC : phrases courtes, gros corps, pas de champs internes ni sensibles.
    const points = [
      d.objectifs_exprimes && 'Mes objectifs : ' + d.objectifs_exprimes,
      d.attentes_parcours && "Ce que j'attends du parcours : " + d.attentes_parcours,
      d.aide_souhaitee && "L'aide dont j'ai besoin : " + d.aide_souhaitee,
    ].filter(Boolean).slice(0, 3);
    const freinsRows = axes.filter((f) => f.key !== 'sante').map((f) => {
      const v = d[f.column];
      return '<tr><td>' + esc(f.label) + '</td><td>' + (v == null ? '<em>on n\'en a pas parlé</em>'
        : (v <= 2 ? 'Ça va' : v === 3 ? 'Difficulté moyenne' : 'Grosse difficulté — on va travailler dessus')) + '</td></tr>';
    }).join('');
    const body =
      '<div class="header"><div><h1>Mon diagnostic d\'accueil</h1>'
      + '<div class="sub">' + esc(nom) + ' — fait ensemble avec ma conseillère (CIP)</div></div></div>'
      + '<div class="section"><div class="hl"><div class="section-title" style="border:none;margin-bottom:6px;">Ce que nous avons dit ensemble</div>'
      + (points.length ? '<ul>' + points.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>'
        : '<p>Nous avons fait le point sur ma situation pour bien démarrer mon parcours.</p>')
      + '</div></div>'
      + '<div class="section"><div class="section-title">Mes difficultés et où j\'en suis</div>'
      + '<table><tbody>' + freinsRows + '</tbody></table>'
      + '<p style="margin-top:6px;color:#64748b;">Ma santé reste entre ma conseillère et moi : elle n\'est pas détaillée sur ce papier.</p></div>'
      + '<div class="sign"><div>Le salarié / la salariée :<br/><br/></div><div>La conseillère (CIP) :<br/><br/></div></div>'
      + RGPD_FOOTER('salarie');
    openPrintWindow('Diagnostic_' + (employee.last_name || ''), body, { large: true });
    return;
  }

  // Variante dossier — complète (les clés masquées par rôle sont absentes).
  const freinsRows = axes.map((f) => {
    const v = d[f.column];
    const det = d[f.column + '_detail'];
    return '<tr><td>' + esc(f.label) + '</td><td>' + (v ? v + '/5' : '<em>non évalué</em>') + '</td><td>' + esc(det || '') + '</td></tr>';
  }).join('');
  const rubriques = DIAG_RUBRIQUES_DOSSIER
    .filter(([, k]) => d[k] !== undefined && d[k] !== null && d[k] !== '')
    .map(([label, k]) => '<div class="section"><div class="section-title">' + esc(label) + '</div><div class="card">' + esc(d[k]) + '</div></div>')
    .join('');
  const statutLigne =
    '<strong>Statut de saisie :</strong> ' + (d.statut_saisie === 'complet' ? 'complet' : 'en cours')
    + (d.updated_at ? '   <strong>Dernière mise à jour :</strong> ' + frDate(d.updated_at) : '');
  const body =
    '<div class="header"><div><h1>SOLIDATA — Diagnostic d\'accueil (dossier)</h1>'
    + '<div class="sub">' + esc(nom) + '</div></div><div class="sub" style="text-align:right">Suivi CIP</div></div>'
    + '<div class="section"><div class="card">' + statutLigne + '</div></div>'
    + '<div class="section"><div class="section-title">Freins périphériques</div>'
    + '<table><thead><tr><th>Frein</th><th>Niveau</th><th>Observations</th></tr></thead><tbody>' + freinsRows + '</tbody></table></div>'
    + rubriques
    + RGPD_FOOTER('dossier');
  openPrintWindow('Diagnostic_dossier_' + (employee.last_name || ''), body);
}

// ═══════════════════════════════════════════
// ENTRETIEN / BILAN
// ═══════════════════════════════════════════

/**
 * Bilan d'entretien (tout type).
 * @param {object} p { employee, milestone, previousFreins?, actions?, variante }
 *   previousFreins : ligne (diagnostic ou bilan précédent) pour les pictos d'évolution.
 */
export function exportEntretienPDF({ employee = {}, milestone = {}, previousFreins = null, actions = [], variante = 'dossier' }) {
  const nom = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  const ms = milestone || {};
  const titre = entretienLabel(ms);
  const axes = freinsForDoc(ms, variante);

  if (variante === 'salarie') {
    const decisions = [
      ms.objectifs_prochaine_periode && 'Ce que je vais faire : ' + ms.objectifs_prochaine_periode,
      ms.objectifs_realises && "Ce que j'ai déjà fait : " + ms.objectifs_realises,
    ].filter(Boolean);
    const actionsOuvertes = (actions || []).filter((a) => ['a_faire', 'en_cours'].includes(a.status)).slice(0, 5);
    if (actionsOuvertes.length) {
      decisions.push('Ma conseillère m\'aide sur : ' + actionsOuvertes.map((a) => a.action_label).join(' · '));
    }
    const freinsRows = axes.filter((f) => f.key !== 'sante').map((f) => {
      const cur = ms[f.column];
      const prev = previousFreins ? previousFreins[f.column] : null;
      return '<tr><td>' + esc(f.label) + '</td>'
        + '<td>' + (cur == null ? '<em>on n\'en a pas parlé</em>' : cur + '/5') + '</td>'
        + '<td>' + pictoDelta(prev, cur) + '</td></tr>';
    }).join('');
    const body =
      '<div class="header"><div><h1>' + esc(titre) + '</h1>'
      + '<div class="sub">' + esc(nom) + ' — ' + frDate(ms.completed_date || ms.due_date) + '</div></div></div>'
      + '<div class="section"><div class="hl"><div class="section-title" style="border:none;margin-bottom:6px;">Ce que nous avons décidé</div>'
      + (decisions.length ? '<ul>' + decisions.slice(0, 3).map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>'
        : '<p>Nous avons fait le point ensemble sur mon parcours.</p>')
      + '</div></div>'
      + '<div class="section"><div class="section-title">Mes difficultés : où j\'en suis</div>'
      + '<table><thead><tr><th>Difficulté</th><th>Aujourd\'hui</th><th>Évolution</th></tr></thead><tbody>' + freinsRows + '</tbody></table>'
      + '<p style="margin-top:6px;color:#64748b;">↘ = ça va mieux · ↗ = c\'est plus difficile · = pareil. Ma santé n\'est pas détaillée sur ce papier.</p></div>'
      + (ms.milestone_type === 'bilan_sortie' && ms.sortie_classification
        ? '<div class="section"><div class="section-title">Ma sortie</div><div class="card">'
          + esc(SORTIE_CLASS_LABELS[ms.sortie_classification] || ms.sortie_classification)
          + (ms.sortie_employeur ? ' — ' + esc(ms.sortie_employeur) : '') + '</div></div>'
        : '')
      + '<div class="sign"><div>Le salarié / la salariée :<br/><br/></div><div>La conseillère (CIP) :<br/><br/></div></div>'
      + RGPD_FOOTER('salarie');
    openPrintWindow(titre.replace(/\s+/g, '_') + '_' + (employee.last_name || ''), body, { large: true });
    return;
  }

  // Variante dossier — complète.
  const sections = [
    ['bilan_professionnel', 'Situation professionnelle'],
    ['bilan_social', 'Situation sociale / administrative'],
    ['cip_integration', 'Intégration / accueil'],
    ['cip_competences', 'Compétences'],
    ['cip_projet_pro', 'Projet professionnel'],
    ['cip_socialisation', 'Vie sociale / quotidien'],
    ['objectifs_realises', 'Objectifs réalisés'],
    ['objectifs_prochaine_periode', 'Objectifs — prochaine période'],
    ['observations', 'Observations (interne)'],
    ['sortie_commentaires', 'Commentaires de sortie'],
    ['post_sortie_commentaire', 'Situation post-sortie — commentaire'],
  ].filter(([k]) => ms[k]).map(([k, label]) =>
    '<div class="section"><div class="section-title">' + label + '</div><div class="card">' + esc(ms[k]) + '</div></div>'
  ).join('');

  const freinsRows = axes.map((f) => {
    const cur = ms[f.column];
    const prev = previousFreins ? previousFreins[f.column] : null;
    return '<tr><td>' + esc(f.label) + '</td><td>' + (cur == null ? '<em>non évalué</em>' : cur + '/5') + '</td><td>' + pictoDelta(prev, cur) + '</td></tr>';
  }).join('');

  // Évaluation du bilan précédent (previous_review)
  const pr = Array.isArray(ms.previous_review) ? ms.previous_review : [];
  const VERDICTS = { ok: 'Fait', partiel: 'En partie', non_ok: 'Non fait' };
  const prRows = pr.map((it) =>
    '<tr><td>' + esc(it.kind === 'action' ? 'Action' : 'Objectif') + '</td><td>' + esc(it.label || '') + '</td>'
    + '<td>' + esc(VERDICTS[it.verdict] || it.verdict || '—') + '</td>'
    + '<td>' + (it.echeance_respectee == null ? '—' : (it.echeance_respectee ? 'oui' : 'non')) + '</td>'
    + '<td>' + esc(it.commentaire || '') + '</td></tr>'
  ).join('');

  const renou = ms.milestone_type === 'renouvellement' && (ms.renouvellement_avis || ms.renouvellement_duree_mois)
    ? '<div class="section"><div class="section-title">Renouvellement</div><div class="card">'
      + '<strong>Avis :</strong> ' + esc({ favorable: 'Favorable', favorable_reserves: 'Favorable avec réserves', defavorable: 'Défavorable' }[ms.renouvellement_avis] || '—')
      + (ms.renouvellement_duree_mois ? '   <strong>Durée proposée :</strong> ' + ms.renouvellement_duree_mois + ' mois' : '') + '</div></div>'
    : '';

  const docs = ms.milestone_type === 'bilan_sortie' && ms.sortie_documents
    ? '<div class="section"><div class="section-title">Documents remis à la sortie</div><div class="card">'
      + ['stc', 'certificat_travail', 'attestation_france_travail'].map((k) => {
        const labels = { stc: 'Solde de tout compte', certificat_travail: 'Certificat de travail', attestation_france_travail: 'Attestation France Travail' };
        return (ms.sortie_documents[k] ? '☑ ' : '☐ ') + labels[k];
      }).join('   ') + '</div></div>'
    : '';

  const sortie = ms.milestone_type === 'bilan_sortie' && ms.sortie_classification
    ? '<div class="section"><div class="section-title">Sortie</div><div class="card">'
      + '<strong>Catégorie :</strong> ' + esc(SORTIE_CLASS_LABELS[ms.sortie_classification] || ms.sortie_classification)
      + (ms.sortie_type ? '   <strong>Type :</strong> ' + esc(ms.sortie_type) : '')
      + (ms.sortie_employeur ? '\n<strong>Employeur / organisme :</strong> ' + esc(ms.sortie_employeur) : '')
      + (ms.sortie_employeur_siret ? '   <strong>SIRET :</strong> ' + esc(ms.sortie_employeur_siret) : '')
      + (ms.sortie_duree_contrat_mois ? '   <strong>Durée :</strong> ' + ms.sortie_duree_contrat_mois + ' mois' : '')
      + '</div></div>'
    : '';

  const validations = Array.isArray(ms.validations) && ms.validations.length
    ? '<div class="section"><div class="section-title">Validations</div><div class="card">'
      + ms.validations.map((v) => ({ salarie: 'Salarié', cip: 'CIP', eti: 'Encadrant', directeur: 'Direction' }[v.role] || v.role)
        + (v.mode === 'presence' ? ' (en présence)' : '') + ' — ' + frDate(v.at)).join('\n') + '</div></div>'
    : '';

  const actionsRows = (actions || []).map((a) =>
    '<tr><td>' + esc(a.action_label) + '</td><td>' + esc(ACTION_CATEGORY_LABELS[a.category] || a.category || '') + '</td>'
    + '<td>' + esc(ACTION_STATUS_LABELS[a.status] || a.status || '') + '</td><td>' + frDate(a.echeance) + '</td>'
    + '<td>' + esc(a.resultat || '') + '</td></tr>'
  ).join('');

  const body =
    '<div class="header"><div><h1>SOLIDATA — ' + esc(titre) + ' (dossier)</h1>'
    + '<div class="sub">' + esc(nom) + '</div></div><div class="sub" style="text-align:right">Suivi CIP</div></div>'
    + '<div class="section"><div class="card"><strong>Statut :</strong> ' + esc(ENTRETIEN_STATUS_LABELS[ms.status] || ms.status || '—')
    + '   <strong>Échéance :</strong> ' + frDate(ms.due_date) + '   <strong>Réalisé le :</strong> ' + frDate(ms.completed_date)
    + (ms.avis_global ? '   <strong>Avis global :</strong> ' + esc(String(ms.avis_global).replace('_', ' ')) : '')
    + (ms.locked_at ? '\nEntretien clôturé et verrouillé le ' + frDate(ms.locked_at) + ' (état probant).' : '') + '</div></div>'
    + (prRows ? '<div class="section"><div class="section-title">Depuis le dernier bilan</div>'
      + '<table><thead><tr><th></th><th>Élément</th><th>Verdict</th><th>Échéance respectée</th><th>Commentaire</th></tr></thead><tbody>' + prRows + '</tbody></table></div>' : '')
    + '<div class="section"><div class="section-title">Freins périphériques</div>'
    + '<table><thead><tr><th>Frein</th><th>Niveau</th><th>Évolution</th></tr></thead><tbody>' + freinsRows + '</tbody></table></div>'
    + sections + renou + sortie + docs
    + (actionsRows ? '<div class="section"><div class="section-title">Actions liées</div>'
      + '<table><thead><tr><th>Action</th><th>Catégorie</th><th>Statut</th><th>Échéance</th><th>Résultat</th></tr></thead><tbody>' + actionsRows + '</tbody></table></div>' : '')
    + validations
    + RGPD_FOOTER('dossier');
  openPrintWindow('Bilan_dossier_' + (employee.last_name || ''), body);
}

// ═══════════════════════════════════════════
// BILAN DE PROLONGATION PASS IAE (EXG-02, PR 2)
// Gabarit A4 SOBRE destiné au PRESCRIPTEUR habilité, alimenté par
// GET /insertion/pass-iae/bilan/:employeeId. Le backend EXCLUT déjà l'axe
// judiciaire (art. 10) et masque les détails santé (art. 9) — ce gabarit
// restitue les données telles quelles, sans jamais les réintroduire.
// ═══════════════════════════════════════════

const AVIS_RENOU_LABELS = { favorable: 'Favorable', favorable_reserves: 'Favorable avec réserves', defavorable: 'Défavorable' };
const OBJ_STATUT_LABELS = { a_venir: 'À venir', en_cours: 'En cours', atteint: 'Atteint', partiellement_atteint: 'En partie', abandonne: 'Abandonné', reporte: 'Reporté' };
const PMSMP_OBJET_LABELS = { decouvrir_metier: 'Découvrir un métier', confirmer_projet: 'Confirmer un projet', initier_recrutement: 'Initier un recrutement' };

/**
 * Bilan du parcours en appui de la demande de prolongation du Pass IAE.
 * @param {object} data réponse de GET /insertion/pass-iae/bilan/:employeeId
 */
export function exportBilanProlongationPassIae(data) {
  const d = data || {};
  const sal = d.salarie || {};
  const nom = `${sal.first_name || ''} ${sal.last_name || ''}`.trim();
  const pass = d.pass_iae || {};
  const presc = d.prescripteur || {};
  const parcours = d.parcours || {};
  const cddi = d.cddi || {};

  // Synthèse du parcours (identité, Pass, contrat, prescripteur).
  const synthese =
    '<div class="section"><div class="section-title">Synthèse du parcours</div><div class="card">'
    + '<strong>Salarié :</strong> ' + esc(nom) + '   <strong>Poste :</strong> ' + esc(sal.poste || '—')
    + '   <strong>Parcours n° :</strong> ' + (sal.parcours_num || 1) + '\n'
    + '<strong>Pass IAE :</strong> ' + esc(pass.number || '—')
    + (pass.start ? '   <strong>Début :</strong> ' + frDate(pass.start) : '')
    + (pass.end ? '   <strong>Fin :</strong> ' + frDate(pass.end) : '') + '\n'
    + '<strong>Entrée en parcours :</strong> ' + frDate(parcours.insertion_start_date)
    + (parcours.insertion_end_date ? '   <strong>Fin de parcours :</strong> ' + frDate(parcours.insertion_end_date) : '')
    + (cddi.months_total != null ? '\n<strong>CDDI cumulé :</strong> ' + cddi.months_total + ' mois' + (cddi.count ? ' (' + cddi.count + ' contrat' + (cddi.count > 1 ? 's' : '') + ')' : '') + ' — plafond légal 24 mois' : '')
    + '\n<strong>Prescripteur :</strong> ' + esc(presc.nom || '—') + (presc.type ? ' (' + esc(presc.type) + ')' : '')
    + '</div></div>';

  // Entretiens du parcours.
  const entretiensRows = (d.entretiens || []).map((m) =>
    '<tr><td>' + esc(m.titre || ENTRETIEN_TYPE_LABELS[m.milestone_type] || m.milestone_type) + '</td>'
    + '<td>' + esc(ENTRETIEN_STATUS_LABELS[m.status] || m.status || '—') + '</td>'
    + '<td>' + frDate(m.completed_date || m.due_date) + '</td>'
    + '<td>' + esc(m.avis_global ? String(m.avis_global).replace('_', ' ') : (m.renouvellement_avis ? AVIS_RENOU_LABELS[m.renouvellement_avis] || m.renouvellement_avis : '—'))
    + (m.renouvellement_duree_mois ? ' · ' + m.renouvellement_duree_mois + ' mois' : '') + '</td></tr>'
  ).join('');

  // Évolution des freins premier / dernier / delta — le backend fournit les
  // axes SANS judiciaire ; on restitue la liste telle quelle.
  const freinsRows = (d.freins || []).map((f) => {
    const delta = f.delta == null ? '<span class="picto eq">·</span>'
      : f.delta < 0 ? '<span class="picto down">↘ ' + f.delta + '</span>'
        : f.delta > 0 ? '<span class="picto up">↗ +' + f.delta + '</span>'
          : '<span class="picto eq">=</span>';
    return '<tr><td>' + esc(f.label) + '</td>'
      + '<td>' + (f.premier == null ? '<em>non évalué</em>' : f.premier + '/5') + '</td>'
      + '<td>' + (f.dernier == null ? '<em>non évalué</em>' : f.dernier + '/5') + '</td>'
      + '<td>' + delta + '</td></tr>';
  }).join('');

  // Objectifs agrégés + liste.
  const obj = d.objectifs || {};
  const objAgg = Object.entries(obj.par_statut || {})
    .map(([k, n]) => (OBJ_STATUT_LABELS[k] || k) + ' : ' + n).join('   ');
  const objRows = (obj.liste || []).map((o) =>
    '<tr><td>' + (o.parent_id ? '&nbsp;&nbsp;↳ ' : '') + esc(o.titre) + '</td>'
    + '<td>' + esc(o.origine === 'salarie' ? 'Salarié' : 'CIP') + '</td>'
    + '<td>' + esc(OBJ_STATUT_LABELS[o.statut] || o.statut || '—') + '</td>'
    + '<td>' + frDate(o.echeance) + '</td></tr>'
  ).join('');

  // Actions agrégées + liste (les actions liées à la santé arrivent masquées).
  const act = d.actions || {};
  const actAgg = Object.entries(act.par_categorie || {})
    .map(([k, n]) => (ACTION_CATEGORY_LABELS[k] || k) + ' : ' + n).join('   ');
  const actRows = (act.liste || []).map((a) =>
    '<tr><td>' + (a.detail_masque ? '<em>Action d\'accompagnement (détail confidentiel — art. 9 RGPD)</em>' : esc(a.action_label || '—')) + '</td>'
    + '<td>' + esc(ACTION_CATEGORY_LABELS[a.category] || a.category || '—') + '</td>'
    + '<td>' + esc(ACTION_STATUS_LABELS[a.status] || a.status || '—') + '</td>'
    + '<td>' + frDate(a.echeance) + '</td>'
    + '<td>' + esc(a.partenaire_nom || '—') + '</td>'
    + '<td>' + (a.detail_masque ? '—' : esc(a.resultat || '')) + '</td></tr>'
  ).join('');

  // PMSMP.
  const pmsmpRows = (d.pmsmp || []).map((p) =>
    '<tr><td>' + esc(p.entreprise || '—') + '</td>'
    + '<td>' + esc(PMSMP_OBJET_LABELS[p.objet] || p.objet || '—') + '</td>'
    + '<td>' + frDate(p.date_debut) + ' → ' + frDate(p.date_fin) + '</td>'
    + '<td>' + (p.jours != null ? p.jours + ' j' : '—') + '</td></tr>'
  ).join('');

  // Formations / projet.
  const fo = d.formations || {};
  const formationsCard = (fo.projet_formation || fo.emploi_vise || fo.niveau_formation)
    ? '<div class="section"><div class="section-title">Projet professionnel et formation</div><div class="card">'
      + (fo.niveau_formation ? '<strong>Niveau de formation :</strong> ' + esc(fo.niveau_formation) + '\n' : '')
      + (fo.emploi_vise ? '<strong>Emploi visé :</strong> ' + esc(fo.emploi_vise) + '\n' : '')
      + (fo.projet_formation ? '<strong>Projet de formation :</strong> ' + esc(fo.projet_formation) : '')
      + '</div></div>'
    : '';

  const body =
    '<div class="header"><div><h1>Bilan de parcours — prolongation du Pass IAE</h1>'
    + '<div class="sub">' + esc(nom) + ' — généré le ' + frDate(d.genere_le || new Date()) + '</div></div>'
    + '<div class="sub" style="text-align:right">Solidarité Textiles<br/>Structure d\'insertion (ACI)</div></div>'
    + (d.mention ? '<div class="section"><div class="card" style="background:#FFFBEB;border-color:#FDE68A;">' + esc(d.mention) + '</div></div>' : '')
    + (d.usage ? '<div class="section"><div class="card">' + esc(d.usage) + '</div></div>' : '')
    + synthese
    + (entretiensRows ? '<div class="section"><div class="section-title">Entretiens et bilans du parcours</div>'
      + '<table><thead><tr><th>Entretien</th><th>Statut</th><th>Date</th><th>Avis</th></tr></thead><tbody>' + entretiensRows + '</tbody></table></div>' : '')
    + (freinsRows ? '<div class="section"><div class="section-title">Évolution des freins périphériques</div>'
      + '<table><thead><tr><th>Frein</th><th>Première évaluation</th><th>Dernière évaluation</th><th>Évolution</th></tr></thead><tbody>' + freinsRows + '</tbody></table>'
      + '<p style="margin-top:4px;color:#64748b;font-size:9px;">↘ = amélioration · ↗ = dégradation · 1 = pas de difficulté, 5 = frein bloquant. Les niveaux seuls sont transmis (aucun détail médical ou judiciaire — art. 9/10 RGPD).</p></div>' : '')
    + '<div class="section"><div class="section-title">Objectifs du parcours (' + (obj.total || 0) + ')</div>'
    + (objAgg ? '<div class="card">' + objAgg + '</div>' : '')
    + (objRows ? '<table><thead><tr><th>Objectif</th><th>Origine</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>' + objRows + '</tbody></table>' : '<div class="card">Aucun objectif structuré enregistré.</div>')
    + '</div>'
    + '<div class="section"><div class="section-title">Actions d\'accompagnement (' + (act.total || 0) + ')</div>'
    + (actAgg ? '<div class="card">' + actAgg + '</div>' : '')
    + (actRows ? '<table><thead><tr><th>Action</th><th>Catégorie</th><th>Statut</th><th>Échéance</th><th>Partenaire</th><th>Résultat</th></tr></thead><tbody>' + actRows + '</tbody></table>' : '<div class="card">Aucune action enregistrée.</div>')
    + '</div>'
    + (pmsmpRows ? '<div class="section"><div class="section-title">Immersions professionnelles (PMSMP)</div>'
      + '<table><thead><tr><th>Entreprise</th><th>Objet</th><th>Période</th><th>Durée</th></tr></thead><tbody>' + pmsmpRows + '</tbody></table></div>' : '')
    + formationsCard
    + '<div class="sign"><div>La conseillère en insertion professionnelle (CIP) :<br/>Date et signature<br/><br/></div>'
    + '<div>La direction de la structure :<br/>Date et signature<br/><br/></div></div>'
    + RGPD_FOOTER('dossier');

  openPrintWindow('Bilan_Pass_IAE_' + (sal.last_name || sal.id || ''), body);
}

// ═══════════════════════════════════════════
// FICHE PARCOURS (synthèse dossier — conservée de l'existant, registre 9 axes)
// ═══════════════════════════════════════════

export function exportFicheParcoursPDF(analysis, diagnostic) {
  const e = analysis.employee || {};
  const nom = (e.first_name || '') + ' ' + (e.last_name || '');
  const today = new Date().toLocaleDateString('fr-FR');
  const d = diagnostic || {};
  const axes = freinsForDoc(d, 'dossier');

  const freinsRows = axes.map((f) => {
    const v = d[f.column];
    const det = d[f.column + '_detail'];
    return '<tr><td>' + esc(f.label) + '</td><td>' + (v ? v + '/5' : '<em>non évalué</em>') + '</td><td>' + esc(det || '') + '</td></tr>';
  }).join('');

  const STATUS_HEX = { a_planifier: '#6b7280', planifie: '#2563eb', realise: '#16a34a', reporte: '#ea580c' };
  const jalonsRows = (analysis.milestones || []).map((m) =>
    '<tr><td>' + esc(entretienLabel(m)) + '</td><td><span class="badge" style="background:' + (STATUS_HEX[m.status] || '#6b7280') + '">'
    + esc(ENTRETIEN_STATUS_LABELS[m.status] || m.status) + '</span></td><td>' + frDate(m.due_date) + '</td><td>' + frDate(m.completed_date) + '</td></tr>'
  ).join('');

  const presc = e.prescripteur_nom ? esc(e.prescripteur_nom) + (e.prescripteur_type ? ' (' + esc(e.prescripteur_type) + ')' : '') : (e.prescripteur ? esc(e.prescripteur) : '—');
  const PRIO_HEX = { haute: '#dc2626', moyenne: '#d97706', basse: '#6b7280' };
  const actionsEnCours = (analysis.action_plans || []).filter((a) => a.status === 'a_faire' || a.status === 'en_cours');
  const actionsRows = actionsEnCours.map((a) =>
    '<tr><td>' + esc(a.action_label) + '</td>'
    + '<td>' + esc(ACTION_CATEGORY_LABELS[a.category] || a.category || '—') + '</td>'
    + '<td><span class="badge" style="background:' + (PRIO_HEX[a.priority] || '#6b7280') + '">' + esc(a.priority || '—') + '</span></td>'
    + '<td>' + esc(ACTION_STATUS_LABELS[a.status] || a.status || '—') + '</td>'
    + '<td>' + frDate(a.echeance) + '</td></tr>'
  ).join('');
  const actionsSection = '<div class="section"><div class="section-title">Plan d\'action en cours</div>'
    + (actionsEnCours.length
      ? '<table><thead><tr><th>Action</th><th>Catégorie</th><th>Criticité</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>' + actionsRows + '</tbody></table>'
      : '<div class="card">Aucune action en cours.</div>')
    + '</div>';

  const passIae = e.pass_iae_number
    ? '\n<strong>Pass IAE :</strong> ' + esc(e.pass_iae_number) + (e.pass_iae_end ? ' (fin ' + frDate(e.pass_iae_end) + ')' : '')
    : '';

  const body =
    '<div class="header"><div><h1>SOLIDATA — Fiche parcours d\'insertion</h1>'
    + '<div class="sub">' + esc(nom) + ' — édité le ' + today + '</div></div>'
    + '<div class="sub" style="text-align:right">Suivi CIP · Parcours n° ' + (e.parcours_num || 1) + '</div></div>'
    + '<div class="section"><div class="section-title">Situation</div><div class="card">'
    + '<strong>Poste :</strong> ' + esc(e.position || '—') + '   <strong>Équipe :</strong> ' + esc(e.team_name || '—') + '\n'
    + '<strong>Début de parcours :</strong> ' + frDate(e.insertion_start_date) + '   <strong>Fin de contrat :</strong> ' + frDate(e.contract_end) + '\n'
    + '<strong>Prescripteur / orienteur :</strong> ' + presc + '   <strong>CIP référent :</strong> ' + (e.cip_referent_nom ? esc(e.cip_referent_nom) : '—')
    + passIae + '</div></div>'
    + '<div class="section"><div class="section-title">Diagnostic — parcours antérieur</div><div class="card">' + esc(d.parcours_anterieur || '—') + '</div></div>'
    + '<div class="section"><div class="section-title">Freins périphériques</div><table><thead><tr><th>Frein</th><th>Niveau</th><th>Observations</th></tr></thead><tbody>' + freinsRows + '</tbody></table></div>'
    + '<div class="section"><div class="section-title">Entretiens du parcours</div><table><thead><tr><th>Entretien</th><th>Statut</th><th>Échéance</th><th>Réalisé le</th></tr></thead><tbody>' + jalonsRows + '</tbody></table></div>'
    + actionsSection
    + RGPD_FOOTER('dossier');

  openPrintWindow('Parcours_' + (e.last_name || e.id), body);
}
