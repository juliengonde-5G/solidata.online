/**
 * Gabarits PDF du module Pilotage RSE — impression navigateur A4 (même
 * mécanisme que les fiches PCM / Audit Insertion : window.open + print,
 * aucune librairie ajoutée).
 *
 *  - printBilanRse(data)            ← GET /rse/bilan?annee=      (RSEI-18 enrichi :
 *      page de garde, sommaire, indicateurs des 3 volets, analyse d'écarts)
 *  - printDossierAfnor(data)        ← GET /rse/dossier-afnor     (compat)
 *  - printDossierCandidature(data)  ← GET /rse/dossier-candidature (RSEI-18 :
 *      page de garde identité structure + synthèse, puis par chapitre/critère)
 */

const STRUCTURE = 'Solidarité Textiles';
const ACCENT = '#047857'; // emerald-700 — identité RSE

const NIVEAU_LABELS = { 1: 'Initial', 2: 'Engagé', 3: 'Confirmé', 4: 'Exemplaire' };
const CHAPITRE_LABELS = {
  1: "Projet d'entreprise, gouvernance & stratégie",
  2: 'Management des ressources humaines',
  3: "Mission d'inclusion",
  4: 'Management des enjeux environnementaux',
  5: 'Mesure, analyse & amélioration',
};
const ACTION_STATUT_LABELS = { a_faire: 'À faire', en_cours: 'En cours', realise: 'Réalisé', abandonne: 'Abandonné' };
const EVAL_TYPE_LABELS = { auto_evaluation: 'Auto-évaluation', audit_interne: 'Audit interne' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const frDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-FR');
};
const niveauTxt = (n) => (n != null ? `${n} · ${NIVEAU_LABELS[n]}` : 'non coté');

const STYLES = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.45; }
.header { background: ${ACCENT}; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }
.header h1 { font-size: 18px; font-weight: 700; } .header .sub { font-size: 11px; opacity: .9; }
.section { margin: 12px 0; padding: 0 4px; page-break-inside: avoid; }
.section-title { font-size: 13px; font-weight: 700; color: ${ACCENT}; border-bottom: 2px solid ${ACCENT}; padding-bottom: 3px; margin-bottom: 8px; }
.kpis { display: flex; gap: 8px; flex-wrap: wrap; } .kpi { flex: 1; min-width: 90px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; background: #fafafa; }
.kpi .l { font-size: 8px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: .02em; } .kpi .v { font-size: 19px; font-weight: 800; color: #0f172a; line-height: 1.2; } .kpi .s { font-size: 8px; color: #94a3b8; }
.bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; } .bar-label { width: 120px; font-size: 10px; color: #475569; flex-shrink: 0; }
.bar-bg { flex: 1; background: #f1f5f9; border-radius: 4px; height: 14px; overflow: hidden; } .bar-fill { height: 14px; border-radius: 4px; background: ${ACCENT}; } .bar-val { width: 60px; text-align: right; font-size: 9px; color: #64748b; flex-shrink: 0; }
table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
th { background: #f9fafb; text-align: left; padding: 4px 6px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
td { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
.crit { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-top: 6px; page-break-inside: avoid; }
.crit-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.crit-code { font-weight: 700; color: #0f172a; } .crit-lvl { font-size: 9px; color: #475569; }
.chip { display: inline-block; font-size: 8.5px; padding: 1px 5px; border-radius: 4px; background: #ecfdf5; color: ${ACCENT}; border: 1px solid #a7f3d0; margin: 1px 2px 1px 0; }
.muted { color: #9ca3af; }
.note { font-size: 8.5px; color: #9ca3af; margin-top: 4px; }
.ch-title { font-size: 11px; font-weight: 700; color: #334155; margin: 10px 0 2px; }
.footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
.cover { text-align: center; padding: 34px 20px 24px; page-break-after: always; }
.cover-badge { display: inline-block; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: #64748b; border: 1px solid #e5e7eb; border-radius: 999px; padding: 2px 10px; }
.cover-title { font-size: 28px; font-weight: 800; color: ${ACCENT}; margin-top: 14px; }
.cover-year { font-size: 42px; font-weight: 800; color: #0f172a; line-height: 1; margin-top: 2px; }
.cover-meta { font-size: 11px; color: #64748b; margin-top: 10px; line-height: 1.6; }
.cover-kpis { display: flex; gap: 8px; justify-content: center; margin-top: 22px; flex-wrap: wrap; }
.cover-kpis .kpi { flex: 0 0 auto; min-width: 110px; }
.toc { margin-top: 24px; font-size: 10px; color: #94a3b8; }
.toc ol { display: inline-block; text-align: left; margin: 6px 0 0; padding-left: 18px; }
.kv td { padding: 3px 6px; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

function openPrint(docTitle, headTitle, headSub, bodyHtml) {
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (!w) { alert('Popup bloquée — autorisez les popups pour générer le PDF.'); return; }
  const date = new Date().toLocaleDateString('fr-FR');
  const header = `<div class="header"><div><h1>${esc(headTitle)}</h1><div class="sub">${esc(headSub)}</div></div>`
    + `<div style="text-align:right"><div class="sub">${esc(STRUCTURE)}</div><div class="sub">Édité le ${date}</div></div></div>`;
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title><style>${STYLES}</style></head><body>${header}${bodyHtml}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// Cellule de valeur : tiret discret si null/undefined/'' (jamais de « 0 » inventé
// pour une donnée absente — la doctrine « jamais de valeur inventée » du module).
const cell = (v) => (v == null || v === '' ? '<span class="muted">—</span>' : esc(v));
// Tableau clé/valeur (indicateurs d'un volet).
function kvTable(rows) {
  return `<table class="kv">${rows.map(([l, v]) => `<tr><td style="width:58%;color:#475569">${esc(l)}</td><td><strong>${cell(v)}</strong></td></tr>`).join('')}</table>`;
}

// ── Section « Indicateurs des 3 volets » (VSME + insertion + environnement) ─────
function renderVolets(v) {
  if (!v) return '';
  let h = `<div class="section"><div class="section-title">Indicateurs des 3 volets</div>`;
  h += `<p class="note">Consolidation non nominative — volets social/insertion, environnement et économique/gouvernance (VSME).</p>`;

  // Volet social / insertion
  const s = v.social || {};
  h += `<div class="ch-title">Volet social &amp; insertion</div>`;
  if (s.disponible) {
    const so = s.sorties || {}; const etp = s.etp_realises_approx || {}; const fh = s.effectifs_fh || {};
    const sat = s.satisfaction || {}; const pm = s.pmsmp || {}; const ty = s.typologies || {};
    h += kvTable([
      ['Personnes en parcours', s.nb_en_parcours],
      ['Sorties de l’exercice', so.total],
      ['Taux de sorties dynamiques', so.taux_dynamiques != null ? so.taux_dynamiques + ' %' : null],
      ['ETP réalisés (approx. contrôle ERP)', etp.valeur],
      ['Effectif actif — F / H / n.r.', fh && fh.total != null ? `${fh.femmes ?? '—'} / ${fh.hommes ?? '—'} / ${fh.non_renseigne ?? '—'} (total ${fh.total})` : null],
      ['Dont RQTH', ty.rqth],
      ['Satisfaction de sortie (moyenne)', sat.moyenne_globale != null ? sat.moyenne_globale + ' / 5' : null],
      ['PMSMP — conventions / jours', pm.nb != null ? `${pm.nb} / ${pm.jours}` : null],
    ]);
    // Périmètre temporel (revue Codex PR#81) : distingue les agrégats annuels des
    // photos à la date de génération — visible dans le PDF, pas seulement dans l'API.
    if (s.perimetre_temporel && s.perimetre_temporel.note) {
      h += `<p class="note"><strong>Périmètre :</strong> ${esc(s.perimetre_temporel.note)}</p>`;
    }
  } else {
    h += `<div class="note">${esc(s.note || 'Volet indisponible.')}</div>`;
  }

  // Volet environnement
  const e = v.environnement || {};
  h += `<div class="ch-title">Volet environnement</div>`;
  if (e.disponible) {
    const g = e.ges || {}; const val = e.valorisation || {};
    const rows = [];
    if (g.disponible) {
      rows.push(['Émissions propres (tCO2e)', g.tco2e_total]);
      rows.push(['Intensité (tCO2e / k€ de CA)', g.intensite_tco2e_par_keuro_ca]);
    }
    if (val && val.disponible) {
      rows.push(['Tonnage collecté (t)', val.tonnage_collecte_tonnes]);
      rows.push([`CO2 évité (t · mix ${esc(val.mix_source || '—')})`, val.co2_evite_tonnes]);
    }
    h += rows.length ? kvTable(rows) : `<div class="note">Aucune donnée environnementale saisie sur l'exercice.</div>`;
    if (g.disponible && g.avertissement) h += `<div class="note">${esc(g.avertissement)}</div>`;
  } else {
    h += `<div class="note">Données environnementales indisponibles (module Énergie &amp; GES / collecte).</div>`;
  }

  // Volet économique / gouvernance (VSME)
  const ec = v.economique || {};
  h += `<div class="ch-title">Volet économique &amp; gouvernance (VSME)</div>`;
  if (ec.disponible) {
    const vs = ec.vsme || {}; const ac = ec.achats || {};
    const rows = [];
    if (vs.disponible) {
      rows.push(['Énergie totale (kWh)', vs.b3_energie && vs.b3_energie.total_energie_kwh]);
      rows.push(['Eau (m³)', vs.b6_eau && vs.b6_eau.consommation_eau_m3]);
      rows.push(['GES scope 1 / scope 2 (tCO2e)', vs.b3_ges ? `${vs.b3_ges.scope1_tco2e} / ${vs.b3_ges.scope2_tco2e}` : null]);
    }
    if (ac && ac.disponible) {
      rows.push(['Fournisseurs responsables', ac.fournisseurs_total != null ? `${ac.fournisseurs_responsables} / ${ac.fournisseurs_total}` + (ac.part_responsables_pct != null ? ` (${ac.part_responsables_pct} %)` : '') : null]);
      rows.push(['Part achats responsables (montant)', ac.part_montant_pct != null ? ac.part_montant_pct + ' %' : null]);
    }
    h += rows.length ? kvTable(rows) : `<div class="note">Aucune métrique VSME saisie sur l'exercice.</div>`;
  } else {
    h += `<div class="note">Métriques VSME indisponibles.</div>`;
  }

  h += `</div>`;
  return h;
}

// ── Carte d'un critère (dossier AFNOR / candidature) ────────────────────────────
function renderCritereCard(c) {
  let h = `<div class="crit"><div class="crit-h"><span class="crit-code">${esc(c.code)} — ${esc(c.intitule)}</span>`
    + `<span class="crit-lvl">Visé : <strong>${c.niveau_vise != null ? c.niveau_vise : '—'}</strong> · Auto-évalué : <strong>${niveauTxt(c.niveau_auto_evalue)}</strong></span></div>`;
  h += `<div class="note">Pilote : ${esc(c.pilote_nom || '—')}</div>`;
  if (c.preuves && c.preuves.length) {
    h += `<div style="margin-top:4px">${c.preuves.map((p) => `<span class="chip" title="${esc(p.intitule)}">${esc(p.reference)}${p.type ? ' · ' + esc(p.type) : ''}${p.date_preuve ? ' · ' + frDate(p.date_preuve) : ''}</span>`).join('')}</div>`;
  } else {
    h += `<div class="note" style="color:#dc2626">Aucune preuve rattachée.</div>`;
  }
  if (c.dernier_constat) {
    const dc = c.dernier_constat;
    h += `<div class="note">Dernier constat (${esc(EVAL_TYPE_LABELS[dc.evaluation_type] || dc.evaluation_type || '')}, ${frDate(dc.date_evaluation)}) — niveau ${niveauTxt(dc.niveau_constate)}${dc.constat ? ' : ' + esc(dc.constat) : ''}${dc.ecart ? ' — écart : ' + esc(dc.ecart) : ''}</div>`;
  }
  if (c.commentaire) h += `<div style="margin-top:4px;font-size:10px;color:#334155">${esc(c.commentaire)}</div>`;
  h += `</div>`;
  return h;
}

// Bloc « répartition des niveaux » (visé / auto-évalué) pour page de garde.
function distNiveaux(dist) {
  if (!dist) return '<span class="muted">—</span>';
  return [1, 2, 3, 4].map((n) => `${NIVEAU_LABELS[n]} : <strong>${dist[n] || 0}</strong>`).join(' · ')
    + ` · <span class="muted">Non coté : ${dist.non_cote || 0}</span>`;
}

// ── Bilan RSE annuel ──────────────────────────────────────────────────────────
export function printBilanRse(data) {
  if (!data) return;
  const pa = data.plan_action || {};
  const parStatut = pa.par_statut || {};
  const niv = data.niveaux || {};
  const preuves = data.preuves || {};
  const evalC = data.derniere_evaluation;
  const visesN2 = niv.vise ? (niv.vise[2] || 0) + (niv.vise[3] || 0) + (niv.vise[4] || 0) : 0;

  let body = '';

  // Page de garde + sommaire
  body += `<div class="cover">`
    + `<div class="cover-badge">Document interne — préparation RSEi</div>`
    + `<div class="cover-title">Bilan RSE annuel</div>`
    + `<div class="cover-year">${esc(data.annee)}</div>`
    + `<div class="cover-meta">${esc(STRUCTURE)} · référentiel ${esc(data.referentiel || 'RSEi')}<br/>Édité le ${new Date().toLocaleDateString('fr-FR')}</div>`
    + `<div class="cover-kpis">`
    + `<div class="kpi"><div class="l">Actions du plan</div><div class="v">${pa.total || 0}</div><div class="s">${parStatut.realise || 0} réalisées</div></div>`
    + `<div class="kpi"><div class="l">Réalisation</div><div class="v">${pa.taux_realisation != null ? pa.taux_realisation + ' %' : '—'}</div></div>`
    + `<div class="kpi"><div class="l">Preuves</div><div class="v">${preuves.total || 0}</div><div class="s">${preuves.perimees || 0} périmée(s)</div></div>`
    + `<div class="kpi"><div class="l">Critères visés ≥ N2</div><div class="v">${visesN2}<span style="font-size:12px">/27</span></div></div>`
    + `</div>`
    + `<div class="toc">Sommaire<ol><li>L'essentiel de l'exercice</li><li>Bilan du plan d'action RSE</li><li>Indicateurs des 3 volets (VSME + insertion + environnement)</li><li>Analyse d'écarts (critères sous le niveau visé)</li><li>Niveaux de maturité</li><li>Revue interne &amp; décisions</li></ol></div>`
    + `</div>`;

  // KPI
  body += `<div class="section"><div class="section-title">L'essentiel — année ${esc(data.annee)}</div><div class="kpis">`
    + `<div class="kpi"><div class="l">Actions du plan</div><div class="v">${pa.total || 0}</div><div class="s">${parStatut.realise || 0} réalisées</div></div>`
    + `<div class="kpi"><div class="l">Taux de réalisation</div><div class="v">${pa.taux_realisation != null ? pa.taux_realisation + ' %' : '—'}</div></div>`
    + `<div class="kpi"><div class="l">Preuves au registre</div><div class="v">${preuves.total || 0}</div><div class="s">${preuves.perimees || 0} périmée(s)</div></div>`
    + `<div class="kpi"><div class="l">Critères visés ≥ N2</div><div class="v">${(niv.vise ? (niv.vise[2] || 0) + (niv.vise[3] || 0) + (niv.vise[4] || 0) : 0)}<span style="font-size:12px">/27</span></div></div>`
    + `</div></div>`;

  // Plan d'action — répartition par statut
  const totAct = pa.total || 0;
  body += `<div class="section"><div class="section-title">Bilan du plan d'action RSE</div>`;
  ['realise', 'en_cours', 'a_faire', 'abandonne'].forEach((k) => {
    const n = parStatut[k] || 0;
    const pct = totAct ? Math.round((n / totAct) * 100) : 0;
    body += `<div class="bar-row"><div class="bar-label">${ACTION_STATUT_LABELS[k]}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div><div class="bar-val">${n} (${pct}%)</div></div>`;
  });
  if ((pa.actions || []).length) {
    body += `<table><tr><th>Action</th><th>Critères</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr>`
      + pa.actions.map((a) => `<tr><td>${esc(a.titre)}</td><td>${esc((a.critere_codes || []).join(', '))}</td><td>${esc(a.responsable_nom || '—')}</td><td>${frDate(a.echeance)}</td><td>${esc(ACTION_STATUT_LABELS[a.statut] || a.statut)}</td></tr>`).join('')
      + `</table>`;
  } else {
    body += `<div class="note">Aucune action rattachée à l'exercice.</div>`;
  }
  body += `</div>`;

  // Indicateurs des 3 volets (VSME + insertion + environnement) — RSEI-18
  body += renderVolets(data.indicateurs_3_volets);

  // Analyse d'écarts — critères sous leur niveau visé
  const ecarts = data.ecarts_niveau || [];
  body += `<div class="section"><div class="section-title">Analyse d'écarts — critères sous le niveau visé</div>`;
  if (ecarts.length) {
    body += `<table><tr><th>Critère</th><th>Visé</th><th>Auto-évalué</th><th>Écart</th></tr>`
      + ecarts.map((c) => {
        const ecart = c.niveau_vise != null ? (c.niveau_vise - (c.niveau_auto_evalue || 0)) : null;
        return `<tr><td>${esc(c.code)} — ${esc(c.intitule)}</td><td>${c.niveau_vise != null ? c.niveau_vise : '—'}</td><td>${niveauTxt(c.niveau_auto_evalue)}</td><td><strong>${ecart != null ? '+' + ecart : '—'}</strong></td></tr>`;
      }).join('')
      + `</table><div class="note">Écart = niveau visé − niveau auto-évalué (critère non coté compté 0). Priorise le plan d'action.</div>`;
  } else {
    body += `<div class="note">Aucun écart : tous les critères cotés atteignent leur niveau visé (ou aucune cible n'est encore fixée).</div>`;
  }
  body += `</div>`;

  // Niveaux de maturité — visé vs auto-évalué
  const distRow = (label, dist) => {
    const cells = [1, 2, 3, 4].map((n) => `${NIVEAU_LABELS[n]} : <strong>${(dist && dist[n]) || 0}</strong>`).join(' · ');
    return `<tr><td>${label}</td><td>${cells} · <span class="muted">Non coté : ${(dist && dist.non_cote) || 0}</span></td></tr>`;
  };
  body += `<div class="section"><div class="section-title">Niveaux de maturité (27 critères)</div><table><tr><th>Répartition</th><th>Détail</th></tr>`
    + distRow('Niveau visé', niv.vise) + distRow('Niveau auto-évalué', niv.auto_evalue) + `</table></div>`;

  // Dernière évaluation interne = décisions de la dernière revue
  body += `<div class="section"><div class="section-title">Revue interne &amp; décisions</div>`;
  if (evalC) {
    body += `<p><strong>${esc(EVAL_TYPE_LABELS[evalC.type] || evalC.type)}</strong> — ${esc(evalC.libelle)} (${frDate(evalC.date_evaluation)}${evalC.evaluateur_nom ? ', ' + esc(evalC.evaluateur_nom) : ''}) — ${evalC.nb_items || 0} critère(s) coté(s)</p>`;
    if (evalC.synthese) body += `<div class="crit" style="background:#f0fdf4">${esc(evalC.synthese)}</div>`;
    const withEcart = (evalC.items || []).filter((i) => i.ecart);
    if (withEcart.length) {
      body += `<table><tr><th>Critère</th><th>Niveau</th><th>Écart constaté</th></tr>`
        + withEcart.map((i) => `<tr><td>${esc(i.critere_code)}</td><td>${niveauTxt(i.niveau_constate)}</td><td>${esc(i.ecart)}</td></tr>`).join('')
        + `</table>`;
    }
  } else {
    body += `<div class="note">Aucune campagne clôturée sur l'exercice.</div>`;
  }
  body += `</div>`;

  body += `<div class="footer">Bilan RSE ${esc(data.annee)} — ${esc(STRUCTURE)} · référentiel ${esc(data.referentiel || 'RSEi')}. Document interne — préparation à la labellisation RSEi.</div>`;

  openPrint(`Bilan_RSE_${data.annee}`, 'SOLIDATA — Bilan RSE annuel', `Bilan du plan d'action RSE • Année ${data.annee}`, body);
}

// ── Dossier de préparation AFNOR ──────────────────────────────────────────────
export function printDossierAfnor(data) {
  if (!data) return;
  const criteres = data.criteres || [];
  const byCh = {};
  for (const c of criteres) (byCh[c.chapitre] = byCh[c.chapitre] || []).push(c);

  let body = '';
  const cotes = criteres.filter((c) => c.niveau_auto_evalue != null).length;
  body += `<div class="section"><div class="section-title">Synthèse du dossier</div><div class="kpis">`
    + `<div class="kpi"><div class="l">Critères</div><div class="v">${criteres.length}</div></div>`
    + `<div class="kpi"><div class="l">Critères cotés</div><div class="v">${cotes}<span style="font-size:12px">/${criteres.length}</span></div></div>`
    + `<div class="kpi"><div class="l">Preuves rattachées</div><div class="v">${criteres.reduce((s, c) => s + (c.preuves ? c.preuves.length : 0), 0)}</div></div>`
    + `</div><div class="note">Par critère : niveau visé, niveau auto-évalué, pilote, preuves rattachées, dernier constat d'évaluation, commentaire.</div></div>`;

  Object.keys(byCh).sort().forEach((ch) => {
    body += `<div class="section"><div class="section-title">Chapitre ${ch} — ${esc(CHAPITRE_LABELS[ch] || '')}</div>`;
    byCh[ch].forEach((c) => { body += renderCritereCard(c); });
    body += `</div>`;
  });

  body += `<div class="footer">Dossier de préparation AFNOR — ${esc(STRUCTURE)} · référentiel ${esc(data.referentiel || 'RSEi')}. Phase 1 : analyse du dossier et des éléments de préparation.</div>`;

  openPrint('Dossier_preparation_AFNOR', 'SOLIDATA — Dossier de préparation AFNOR', 'Cotation, preuves et constats par critère (27)', body);
}

// ── Dossier de candidature AFNOR (RSEI-18) ─────────────────────────────────────
// Page de garde (identité structure depuis settings + synthèse des niveaux), puis
// le dossier par CHAPITRE et critère — prêt pour l'évaluateur (phase 1).
export function printDossierCandidature(data) {
  if (!data) return;
  const pg = data.page_garde || {};
  const st = pg.structure || {};
  const syn = data.synthese_niveaux || pg.synthese_niveaux || {};
  const chapitres = Array.isArray(data.chapitres) && data.chapitres.length
    ? data.chapitres
    : (() => { // repli si seul le tableau plat `criteres` est fourni
        const byCh = {};
        for (const c of (data.criteres || [])) (byCh[c.chapitre] = byCh[c.chapitre] || []).push(c);
        return Object.keys(byCh).sort((a, b) => Number(a) - Number(b)).map((ch) => ({ chapitre: Number(ch), criteres: byCh[ch] }));
      })();
  const nbPreuves = chapitres.reduce((s, ch) => s + (ch.criteres || []).reduce((t, c) => t + (c.preuves ? c.preuves.length : 0), 0), 0);

  let body = '';

  // Page de garde
  body += `<div class="cover">`
    + `<div class="cover-badge">Dossier de candidature — phase 1</div>`
    + `<div class="cover-title">Dossier de candidature AFNOR</div>`
    + `<div class="cover-meta" style="margin-top:16px">`
    + `<strong style="font-size:15px;color:#0f172a">${esc(st.nom || STRUCTURE)}</strong><br/>`
    + `${st.adresse ? esc(st.adresse) + '<br/>' : ''}`
    + `${st.siret ? 'SIRET ' + esc(st.siret) + '<br/>' : ''}`
    + `${st.telephone ? esc(st.telephone) + '<br/>' : ''}`
    + `Référentiel ${esc(data.referentiel || pg.referentiel || 'RSEi')} · établi le ${frDate(pg.date || new Date())}`
    + `</div>`
    + `<div class="cover-kpis">`
    + `<div class="kpi"><div class="l">Critères</div><div class="v">${syn.total || 0}</div></div>`
    + `<div class="kpi"><div class="l">Critères cotés</div><div class="v">${syn.cotes || 0}<span style="font-size:12px">/${syn.total || 0}</span></div></div>`
    + `<div class="kpi"><div class="l">Preuves rattachées</div><div class="v">${nbPreuves}</div></div>`
    + `</div>`
    + `<div class="toc" style="margin-top:22px">Synthèse des niveaux<br/>`
    + `<div style="margin-top:6px">Niveau visé — ${distNiveaux(syn.vise)}</div>`
    + `<div style="margin-top:3px">Niveau auto-évalué — ${distNiveaux(syn.auto_evalue)}</div>`
    + `</div>`
    + `</div>`;

  // Dossier par chapitre / critère
  chapitres.forEach((ch) => {
    body += `<div class="section"><div class="section-title">Chapitre ${esc(ch.chapitre)} — ${esc(CHAPITRE_LABELS[ch.chapitre] || '')}</div>`;
    (ch.criteres || []).forEach((c) => { body += renderCritereCard(c); });
    body += `</div>`;
  });

  body += `<div class="footer">Dossier de candidature AFNOR — ${esc(st.nom || STRUCTURE)} · référentiel ${esc(data.referentiel || 'RSEi')}. Phase 1 : analyse du dossier et des éléments de préparation. Document interne.</div>`;

  openPrint('Dossier_candidature_AFNOR', 'SOLIDATA — Dossier de candidature AFNOR', 'Page de garde, synthèse et dossier par critère', body);
}
