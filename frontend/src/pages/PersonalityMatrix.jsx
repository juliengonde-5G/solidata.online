import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { DataTable, PageHeader } from '../components';
import { Brain } from 'lucide-react';
import api from '../services/api';

const TYPE_COLORS = {
  analyseur: '#3B82F6',
  perseverant: '#8B5CF6',
  empathique: '#EC4899',
  imagineur: '#6366F1',
  energiseur: '#F59E0B',
  promoteur: '#EF4444',
};

const TYPE_LABELS = {
  analyseur: 'Analyseur',
  perseverant: 'Perseverant',
  empathique: 'Empathique',
  imagineur: 'Imagineur',
  energiseur: 'Energiseur',
  promoteur: 'Promoteur',
};

const CATEGORY_LABELS = {
  perception: 'Perception (Base)',
  points_forts: 'Points forts',
  relation: 'Relation',
  motivation: 'Motivation (Phase)',
  stress: 'Stress (Phase)',
  communication: 'Communication',
  besoin: 'Besoins psychologiques',
  situation: 'Situation',
};

// ───────────────────────────────────────────
// Export helpers : ouvre une fenêtre A4 pour impression/PDF
// ───────────────────────────────────────────
function openPrintWindow(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=800,height=1100');
  if (!w) { alert('Popup bloquée — autorisez les popups pour exporter.'); return; }
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>
<title>${title}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.45; padding: 0; }
  .header { background: #0D9488; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 18px; font-weight: 700; }
  .header .sub { font-size: 11px; opacity: .85; }
  .section { margin: 12px 0; padding: 0 4px; }
  .section-title { font-size: 13px; font-weight: 700; color: #0D9488; border-bottom: 2px solid #0D9488; padding-bottom: 3px; margin-bottom: 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: white; font-size: 10px; font-weight: 600; }
  .bar-bg { background: #f3f4f6; border-radius: 4px; height: 22px; position: relative; margin-bottom: 3px; }
  .bar-fill { height: 22px; border-radius: 4px; display: flex; align-items: center; padding-left: 6px; color: white; font-size: 10px; font-weight: 600; min-width: 50px; }
  .bar-label { font-size: 9px; color: #6b7280; position: absolute; left: 4px; top: 50%; transform: translateY(-50%); }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #f9fafb; text-align: left; padding: 5px 6px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
  td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .tip-do { color: #15803d; } .tip-dont { color: #dc2626; }
  .stress-badge { display: inline-block; width: 20px; height: 20px; border-radius: 50%; text-align: center; line-height: 20px; color: white; font-size: 9px; font-weight: 700; margin-right: 4px; }
  .rps-alert { background: #fef2f2; border: 2px solid #fca5a5; border-radius: 6px; padding: 8px 12px; margin-top: 8px; }
  .rps-alert h4 { color: #b91c1c; font-weight: 700; margin-bottom: 4px; }
  .footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

function exportResultsPDF(profile) {
  const r = profile.report;
  const cand = profile.candidate;
  const date = new Date(profile.createdAt).toLocaleDateString('fr-FR');

  const immeubleHtml = (r.immeuble || []).map(e =>
    `<div class="bar-bg"><div class="bar-fill" style="width:${Math.max(e.score, 15)}%;background:${TYPE_COLORS[e.type]}">${e.nom} (${e.score}%)</div></div>`
  ).join('');

  const stressHtml = (r.phase?.stressNiveaux || []).map(s => {
    const bg = s.niveau === 1 ? '#facc15' : s.niveau === 2 ? '#f97316' : '#dc2626';
    return `<div style="margin-bottom:4px"><span class="stress-badge" style="background:${bg}">${s.niveau}</span> ${s.comportement}</div>`;
  }).join('');

  const doHtml = (r.comportementsPrincipaux?.avecManager?.do || []).map(t => `<li class="tip-do">&#10003; ${t}</li>`).join('');
  const dontHtml = (r.comportementsPrincipaux?.avecManager?.dont || []).map(t => `<li class="tip-dont">&#10007; ${t}</li>`).join('');

  const rpsHtml = profile.riskAlert ? `<div class="rps-alert"><h4>Alerte Risques Psychosociaux</h4><ul>${(r.rpsIndicators || []).map(i => `<li>${i}</li>`).join('')}</ul></div>` : '';

  const body = `
    <div class="header"><div><h1>SOLIDATA — Profil PCM</h1><div class="sub">${cand.first_name} ${cand.last_name} | ${date}</div></div><div style="text-align:right"><div class="sub">Process Communication Model</div></div></div>

    <div class="section"><div class="grid2">
      <div>
        <div class="section-title">Immeuble de personnalite</div>
        ${immeubleHtml}
      </div>
      <div>
        <div class="section-title">Base et Phase</div>
        <div class="card" style="margin-bottom:8px">
          <div style="font-weight:700;margin-bottom:4px">Base : <span class="badge" style="background:${TYPE_COLORS[r.base?.type]}">${r.base?.nom}</span></div>
          <div style="font-size:10px;color:#4b5563">Perception : ${r.base?.perception || ''}</div>
          <div style="font-size:10px;color:#4b5563">Canal : ${r.base?.canal || ''}</div>
          <div style="font-size:10px;color:#4b5563">Points forts : ${(r.base?.pointsForts || []).join(', ')}</div>
          <div style="font-size:10px;color:#4b5563">Besoin : ${r.base?.besoinPsychologique || ''}</div>
        </div>
        <div class="card">
          <div style="font-weight:700;margin-bottom:4px">Phase : <span class="badge" style="background:${TYPE_COLORS[r.phase?.type]}">${r.phase?.nom}</span></div>
          <div style="font-size:10px;color:#4b5563">Besoin : ${r.phase?.besoinPsychologique || ''}</div>
          <div style="font-size:10px;color:#4b5563">Driver : ${r.phase?.driverPrincipal || ''}</div>
        </div>
      </div>
    </div></div>

    <div class="section"><div class="section-title">Comportements principaux</div>
      <div class="card" style="margin-bottom:6px"><strong>Avec les autres :</strong> ${r.comportementsPrincipaux?.avecAutres || ''}</div>
      <div class="card" style="margin-bottom:6px"><strong>Sous stress :</strong> ${r.comportementsPrincipaux?.sousStress || ''}</div>
    </div>

    <div class="section"><div class="grid2">
      <div><div class="section-title">Guide Manager</div>
        <ul style="list-style:none;padding:0">${doHtml}${dontHtml}</ul>
      </div>
      <div><div class="section-title">Niveaux de stress (Phase)</div>${stressHtml}</div>
    </div></div>

    ${rpsHtml}
    <div class="footer">SOLIDATA ERP — Document confidentiel — ${date}</div>
  `;

  openPrintWindow(`PCM_${cand.last_name}_${cand.first_name}`, body);
}

function exportTechnicalPDF(profile, rawAnswers) {
  const cand = profile.candidate;
  const date = new Date(profile.createdAt).toLocaleDateString('fr-FR');
  const scores = profile.report.scores || {};

  const scoresHtml = Object.entries(scores).map(([type, pct]) =>
    `<tr><td><span class="badge" style="background:${TYPE_COLORS[type]}">${TYPE_LABELS[type] || type}</span></td><td style="text-align:right;font-weight:600">${pct}%</td>
    <td><div style="background:#f3f4f6;border-radius:3px;height:14px;width:100%"><div style="height:14px;border-radius:3px;width:${pct}%;background:${TYPE_COLORS[type]}"></div></div></td></tr>`
  ).join('');

  const groupedByCategory = {};
  for (const a of (rawAnswers || [])) {
    if (!groupedByCategory[a.category]) groupedByCategory[a.category] = [];
    groupedByCategory[a.category].push(a);
  }

  let answersHtml = '';
  for (const [cat, answers] of Object.entries(groupedByCategory)) {
    answersHtml += `<tr><td colspan="4" style="background:#F0FDFA;font-weight:700;color:#0D9488;padding:6px">${CATEGORY_LABELS[cat] || cat}</td></tr>`;
    for (const a of answers) {
      answersHtml += `<tr>
        <td style="width:30px;text-align:center;color:#9ca3af">Q${a.question_number}</td>
        <td style="width:45%">${a.question_text}</td>
        <td><span class="badge" style="background:${TYPE_COLORS[a.answer_value] || '#6b7280'}">${TYPE_LABELS[a.answer_value] || a.answer_value}</span></td>
        <td style="font-size:9px;color:#4b5563">${a.answer_label}</td>
      </tr>`;
    }
  }

  const body = `
    <div class="header"><div><h1>SOLIDATA — Fiche Technique PCM</h1><div class="sub">${cand.first_name} ${cand.last_name} | ${date} | Document interne</div></div><div style="text-align:right"><div class="sub">Resultats bruts du questionnaire</div></div></div>

    <div class="section"><div class="grid2">
      <div><div class="section-title">Synthese</div>
        <div class="card">
          <div>Base : <span class="badge" style="background:${TYPE_COLORS[profile.baseType]}">${TYPE_LABELS[profile.baseType] || profile.baseType}</span></div>
          <div style="margin-top:4px">Phase : <span class="badge" style="background:${TYPE_COLORS[profile.phaseType]}">${TYPE_LABELS[profile.phaseType] || profile.phaseType}</span></div>
          <div style="margin-top:4px">Alerte RPS : ${profile.riskAlert ? '<span style="color:#dc2626;font-weight:700">OUI</span>' : '<span style="color:#16a34a">Non</span>'}</div>
        </div>
      </div>
      <div><div class="section-title">Scores normalises (0-100%)</div>
        <table>${scoresHtml}</table>
      </div>
    </div></div>

    <div class="section"><div class="section-title">Reponses detaillees (${(rawAnswers || []).length} questions)</div>
      <table>
        <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Reponse choisie</th></tr></thead>
        <tbody>${answersHtml}</tbody>
      </table>
    </div>

    <div class="footer">SOLIDATA ERP — Fiche technique confidentielle — ${date}</div>
  `;

  openPrintWindow(`PCM_TECHNIQUE_${cand.last_name}_${cand.first_name}`, body);
}

export default function PersonalityMatrix() {
  const [profiles, setProfiles] = useState([]);
  const [types, setTypes] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [rawAnswers, setRawAnswers] = useState(null);
  const [view, setView] = useState('list'); // list, types, profile

  useEffect(() => {
    api.get('/pcm/profiles').then(r => setProfiles(r.data)).catch(() => {});
    api.get('/pcm/types').then(r => setTypes(r.data)).catch(() => {});
  }, []);

  const loadProfile = async (candidateId) => {
    try {
      const [profRes, ansRes] = await Promise.all([
        api.get(`/pcm/profiles/${candidateId}`),
        api.get(`/pcm/profiles/${candidateId}/answers`).catch(() => ({ data: null })),
      ]);
      setSelectedProfile(profRes.data);
      setRawAnswers(ansRes.data?.answers || null);
      setView('profile');
    } catch (err) { console.error(err); }
  };

  const handleExportResults = useCallback(() => {
    if (selectedProfile) exportResultsPDF(selectedProfile);
  }, [selectedProfile]);

  const handleExportTechnical = useCallback(() => {
    if (selectedProfile) exportTechnicalPDF(selectedProfile, rawAnswers);
  }, [selectedProfile, rawAnswers]);

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Matrice PCM"
          subtitle="Process Communication Model — 6 types de personnalite"
          icon={Brain}
          actions={
            <div className="flex gap-2">
              <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'list' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Profils</button>
              <button onClick={() => setView('types')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'types' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Types PCM</button>
            </div>
          }
        />

        {view === 'list' && (
          <DataTable
            columns={[
              { key: 'name', label: 'Candidat', sortable: true, render: (p) => <span className="font-medium">{p.first_name} {p.last_name}</span> },
              { key: 'base_type', label: 'Base', render: (p) => (
                <span className="px-2 py-1 rounded text-xs font-medium text-white" style={{ backgroundColor: TYPE_COLORS[p.base_type] }}>
                  {p.base_type}
                </span>
              )},
              { key: 'phase_type', label: 'Phase', render: (p) => (
                <span className="px-2 py-1 rounded text-xs font-medium text-white" style={{ backgroundColor: TYPE_COLORS[p.phase_type] }}>
                  {p.phase_type}
                </span>
              )},
              { key: 'risk_alert', label: 'Alerte RPS', render: (p) => p.risk_alert && <span className="text-red-500 text-xs font-bold">Alerte</span> },
              { key: 'created_at', label: 'Date', sortable: true, render: (p) => <span className="text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString('fr-FR')}</span> },
              { key: 'actions', label: '', render: (p) => (
                <button onClick={() => loadProfile(p.candidate_id)} className="text-primary text-xs font-medium hover:underline">
                  Voir profil
                </button>
              )},
            ]}
            data={profiles}
            loading={false}
            emptyIcon={Brain}
            emptyMessage="Aucun profil PCM genere"
          />
        )}

        {view === 'types' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {types.map(t => (
              <div key={t.key} className="card-modern p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: TYPE_COLORS[t.key] }}>
                    {t.nom[0]}
                  </div>
                  <div>
                    <h3 className="font-bold">{t.nom}</h3>
                    <p className="text-xs text-gray-400">{t.ancienNom !== t.nom ? `ex-${t.ancienNom}` : ''}</p>
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  <p><span className="text-gray-500">Perception :</span> {t.perception}</p>
                  <p><span className="text-gray-500">Canal :</span> {t.canal}</p>
                  <p><span className="text-gray-500">Points forts :</span> {t.pointsForts?.join(', ')}</p>
                  <p><span className="text-gray-500">Besoin :</span> {t.besoinPsychologique}</p>
                  <p><span className="text-gray-500">Driver :</span> {t.driverPrincipal}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === 'profile' && selectedProfile && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button onClick={() => setView('list')} className="text-primary text-sm hover:underline">← Retour a la liste</button>
              <div className="flex gap-2">
                <button
                  onClick={handleExportResults}
                  className="px-3 py-1.5 rounded-lg text-sm bg-primary text-white hover:opacity-90 flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  Export resultats
                </button>
                <button
                  onClick={handleExportTechnical}
                  className="px-3 py-1.5 rounded-lg text-sm bg-gray-600 text-white hover:opacity-90 flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Fiche technique
                </button>
              </div>
            </div>

            <div className="card-modern p-6">
              <h2 className="text-xl font-bold mb-4">
                {selectedProfile.candidate.first_name} {selectedProfile.candidate.last_name}
              </h2>

              {/* Immeuble PCM */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3">Immeuble PCM</h3>
                  <p className="text-xs text-gray-500 mb-2">Classement des types par score (Base en fondation, etage 1).</p>
                  <div className="space-y-1">
                    {selectedProfile.report.immeuble?.map(etage => (
                      <div key={etage.type} className="flex items-center gap-2">
                        <span className="text-xs w-6 text-gray-400">{etage.etage}</span>
                        <div className="flex-1 rounded" style={{ backgroundColor: TYPE_COLORS[etage.type] + '20' }}>
                          <div
                            className="h-8 rounded flex items-center px-2 text-xs font-medium text-white"
                            style={{ width: `${etage.score}%`, backgroundColor: TYPE_COLORS[etage.type], minWidth: '60px' }}
                          >
                            {etage.nom} ({etage.score}%)
                            {etage.etage === 1 && <span className="ml-1 opacity-80">[Base]</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold mb-2">Base : {selectedProfile.report.base?.nom}</h3>
                    <p className="text-sm text-gray-600">{selectedProfile.report.base?.perception}</p>
                    <p className="text-sm text-gray-600">Canal : {selectedProfile.report.base?.canal}</p>
                    {selectedProfile.report.confidence && (
                      <p className={`text-xs mt-1 font-medium ${selectedProfile.report.confidence.baseIndetermine ? 'text-amber-600' : 'text-gray-400'}`}>
                        Fiabilité : {selectedProfile.report.confidence.base}%
                        {selectedProfile.report.confidence.baseIndetermine && ' — profil peu marqué'}
                      </p>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Phase : {selectedProfile.report.phase?.nom}</h3>
                    <p className="text-sm text-gray-600">Besoin : {selectedProfile.report.phase?.besoinPsychologique}</p>
                    {selectedProfile.report.confidence && (
                      <p className={`text-xs mt-1 font-medium ${selectedProfile.report.confidence.phaseIndetermine ? 'text-amber-600' : 'text-gray-400'}`}>
                        Fiabilité : {selectedProfile.report.confidence.phase}%
                        {selectedProfile.report.confidence.phaseIndetermine && ' — phase indéterminée'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Comportements principaux selon le profil */}
            {selectedProfile.report.comportementsPrincipaux && (
              <div className="card-modern p-6">
                <h3 className="font-semibold text-slate-800 mb-4">Comportements principaux</h3>
                <div className="grid grid-cols-1 md:grid-cols-1 gap-4 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Avec les autres</h4>
                    <p className="text-sm text-gray-700">{selectedProfile.report.comportementsPrincipaux.avecAutres}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Sous stress</h4>
                    <p className="text-sm text-gray-700">{selectedProfile.report.comportementsPrincipaux.sousStress}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Avec le manager</h4>
                    <div className="flex flex-wrap gap-4">
                      {selectedProfile.report.comportementsPrincipaux.avecManager?.do?.length > 0 && (
                        <div className="flex-1 min-w-[200px]">
                          <p className="text-xs text-green-600 font-medium mb-1">A privilegier</p>
                          <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                            {selectedProfile.report.comportementsPrincipaux.avecManager.do.map((tip, i) => (
                              <li key={i}>{tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedProfile.report.comportementsPrincipaux.avecManager?.dont?.length > 0 && (
                        <div className="flex-1 min-w-[200px]">
                          <p className="text-xs text-red-600 font-medium mb-1">A eviter</p>
                          <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                            {selectedProfile.report.comportementsPrincipaux.avecManager.dont.map((tip, i) => (
                              <li key={i}>{tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Guide Manager */}
            {selectedProfile.report.base?.guideManager && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                  <h3 className="font-semibold text-green-700 mb-3">Guide Manager — DO</h3>
                  <ul className="space-y-1">
                    {selectedProfile.report.base.guideManager.do?.map((tip, i) => (
                      <li key={i} className="text-sm text-green-800 flex gap-2">
                        <span className="text-green-500">✓</span> {tip}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                  <h3 className="font-semibold text-red-700 mb-3">Guide Manager — DON'T</h3>
                  <ul className="space-y-1">
                    {selectedProfile.report.base.guideManager.dont?.map((tip, i) => (
                      <li key={i} className="text-sm text-red-800 flex gap-2">
                        <span className="text-red-500">✗</span> {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Stress */}
            {selectedProfile.report.phase?.stressNiveaux && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
                <h3 className="font-semibold text-orange-700 mb-3">Niveaux de stress</h3>
                <div className="space-y-2">
                  {selectedProfile.report.phase.stressNiveaux.map(s => (
                    <div key={s.niveau} className="flex gap-3 text-sm">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                        s.niveau === 1 ? 'bg-yellow-400' : s.niveau === 2 ? 'bg-orange-500' : 'bg-red-600'
                      }`}>{s.niveau}</span>
                      <p className="text-orange-900 flex-1">{s.comportement}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Alerte RPS */}
            {selectedProfile.riskAlert && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5">
                <h3 className="font-bold text-red-700 mb-2">Alerte Risques Psychosociaux</h3>
                <ul className="space-y-1">
                  {selectedProfile.report.rpsIndicators?.map((ind, i) => (
                    <li key={i} className="text-sm text-red-800">{ind}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
