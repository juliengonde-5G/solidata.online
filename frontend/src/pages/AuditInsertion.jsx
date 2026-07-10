import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import { ClipboardList, Sparkles, Printer, Users, Target, LogOut, ListChecks } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const IA_TIMEOUT = 120000;

const FREIN_LABELS = {
  frein_mobilite: 'Mobilité', frein_sante: 'Santé', frein_finances: 'Finances',
  frein_famille: 'Famille', frein_linguistique: 'Langue',
  frein_administratif: 'Administratif', frein_numerique: 'Numérique',
};
const CATEGORY_LABELS = { competence: 'Compétence', insertion: 'Insertion pro', socialisation: 'Socialisation', frein: 'Levée de frein' };
const PRIORITY_LABELS = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };
const STATUS_LABELS = { a_faire: 'À faire', en_cours: 'En cours' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Radar SVG des 7 freins consolidés (moyennes 0-5) ──
function FreinsRadar({ moyennes }) {
  const keys = Object.keys(FREIN_LABELS);
  const size = 340, cx = size / 2, cy = size / 2, r = 105;
  const n = keys.length;
  const step = (2 * Math.PI) / n;
  const pt = (i, val) => {
    const a = step * i - Math.PI / 2;
    const d = (Math.max(0, Math.min(5, val)) / 5) * r;
    return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) };
  };
  const vals = keys.map((k) => Number(moyennes?.[k]) || 0);
  const hasData = vals.some((v) => v > 0);
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} className="max-w-md mx-auto" role="img" aria-label="Cartographie des freins">
      {[1, 2, 3, 4, 5].map((lvl) => (
        <polygon key={lvl} points={keys.map((_, i) => { const p = pt(i, lvl); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="#e5e7eb" strokeWidth={lvl === 5 ? 1.5 : 0.5} />
      ))}
      {keys.map((k, i) => { const p = pt(i, 5); return <line key={k} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth="0.5" />; })}
      {keys.map((k, i) => { const p = pt(i, 5.7); return <text key={k} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#6b7280">{FREIN_LABELS[k]}</text>; })}
      {hasData && (
        <polygon points={vals.map((v, i) => { const p = pt(i, v); return `${p.x},${p.y}`; }).join(' ')}
          fill="#0D9488" fillOpacity="0.18" stroke="#0D9488" strokeWidth="2" />
      )}
      {hasData && vals.map((v, i) => { const p = pt(i, v); return <circle key={i} cx={p.x} cy={p.y} r="3" fill="#0D9488" />; })}
    </svg>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone = 'teal' }) {
  const tones = {
    teal: 'bg-teal-50 text-teal-700 border-teal-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    green: 'bg-green-50 text-green-700 border-green-100',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-medium opacity-80">{Icon && <Icon className="w-4 h-4" />}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value ?? '—'}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function Bar({ pct, tone = 'teal' }) {
  const color = { teal: 'bg-teal-500', amber: 'bg-amber-500', red: 'bg-red-500', green: 'bg-green-500' }[tone];
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%` }} />
    </div>
  );
}

export default function AuditInsertion() {
  const { user } = useAuth();
  const canIa = ['ADMIN', 'RH'].includes(user?.base_role || user?.role);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [ia, setIa] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/insertion/audit?year=${year}`)
      .then((r) => { setData(r.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const generateIa = async () => {
    setIaLoading(true); setIaError(null);
    try {
      const r = await api.get(`/insertion/audit/ia?year=${year}`, { timeout: IA_TIMEOUT });
      setIa(r.data);
    } catch (err) {
      const d = err.response?.data;
      if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
        setIaError("Le rapport IA a dépassé le délai d'attente (le modèle met parfois 1 à 2 min). Réessayez.");
      } else if (err.response?.status === 503) {
        setIaError(d?.error || 'Service IA non configuré (clé Anthropic absente).');
      } else {
        setIaError((d?.error || 'Erreur lors de la génération du rapport IA') + (d?.hint ? ' — ' + d.hint : ''));
      }
    } finally {
      setIaLoading(false);
    }
  };

  const printReport = () => {
    if (!data) return;
    const ms = data.milestones?.par_type || [];
    const freins = data.freins_moyennes || {};
    const s = data.sorties || {};
    const act = data.actions || {};
    const li = (arr) => (arr && arr.length ? '<ul>' + arr.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p style="color:#9ca3af">—</p>');

    let body = `<div class="header"><div><h1>Audit Insertion — Situation de la structure</h1>`
      + `<div class="sub">Solidarité Textiles • Année ${data.annee} • Édité le ${new Date().toLocaleDateString('fr-FR')}</div></div></div>`;

    body += `<div class="section"><div class="section-title">Indicateurs clés</div><table>`
      + `<tr><th>Personnes en parcours</th><td>${data.nb_en_parcours}</td></tr>`
      + `<tr><th>Taux de réalisation des jalons (échus)</th><td>${data.milestones?.global?.taux ?? '—'} %</td></tr>`
      + `<tr><th>Plans d'action en cours</th><td>${act.total_en_cours || 0}</td></tr>`
      + `<tr><th>Sorties (${data.annee})</th><td>${s.total || 0} — dont ${s.positives || 0} dynamiques (${s.taux_dynamiques ?? '—'} %)</td></tr>`
      + `</table></div>`;

    body += `<div class="section"><div class="section-title">Réalisation des entretiens / bilans par échéance</div><table>`
      + `<tr><th>Jalon</th><th>Échus</th><th>Réalisés (échus)</th><th>Taux</th></tr>`
      + ms.map((m) => `<tr><td>${esc(m.type)}</td><td>${m.echus}</td><td>${m.realises_echus}</td><td>${m.taux_echeance ?? '—'} %</td></tr>`).join('')
      + `</table></div>`;

    body += `<div class="section"><div class="section-title">Cartographie consolidée des 7 freins (moyenne /5)</div><table>`
      + Object.keys(FREIN_LABELS).map((k) => `<tr><th>${FREIN_LABELS[k]}</th><td>${freins[k] ?? '—'}</td></tr>`).join('')
      + `</table></div>`;

    body += `<div class="section"><div class="section-title">Sorties par type</div><table>`
      + (Object.keys(s.par_type || {}).length ? Object.entries(s.par_type).map(([t, n]) => `<tr><th>${esc(t)}</th><td>${n}</td></tr>`).join('') : '<tr><td colspan="2" style="color:#9ca3af">Aucune sortie sur la période</td></tr>')
      + `</table></div>`;

    if (ia) {
      body += `<div class="section"><div class="section-title">Rapport IA — Situation globale</div>`;
      if (ia.synthese_direction) body += `<div class="card"><strong>Synthèse direction</strong>\n${esc(ia.synthese_direction)}</div>`;
      if (ia.situation_globale) body += `<div class="card" style="margin-top:8px"><strong>Situation globale</strong>\n${esc(ia.situation_globale)}</div>`;
      if (ia.profil_public) body += `<div class="card" style="margin-top:8px"><strong>Profil du public</strong>\n${esc(ia.profil_public)}</div>`;
      if (ia.points_forts) body += `<div class="section" style="margin-top:8px"><strong>Points forts</strong>${li(ia.points_forts)}</div>`;
      if (ia.points_vigilance) body += `<div class="section"><strong>Points de vigilance</strong>${li(ia.points_vigilance)}</div>`;
      if (ia.recommandations_structure && ia.recommandations_structure.length) {
        body += `<div class="section"><strong>Recommandations pour la structure</strong><table><tr><th>Action</th><th>Objectif</th><th>Échéance</th></tr>`
          + ia.recommandations_structure.map((r) => `<tr><td>${esc(r.action)}</td><td>${esc(r.objectif)}</td><td>${esc(r.echeance_suggeree)}</td></tr>`).join('')
          + `</table></div>`;
      }
      if (ia.conclusion) body += `<div class="card" style="margin-top:8px"><strong>Conclusion</strong>\n${esc(ia.conclusion)}</div>`;
      body += `</div>`;
    }

    body += `<div class="footer">Document confidentiel — données personnelles sensibles (RGPD). Diffusion restreinte direction / CIP.</div>`;

    const w = window.open('', '_blank', 'width=820,height=1100');
    if (!w) { alert('Popup bloquée — autorisez les popups pour exporter le PDF.'); return; }
    w.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>Audit_Insertion_' + data.annee + '</title><style>'
      + '@page { size: A4; margin: 15mm 12mm; } * { box-sizing: border-box; margin: 0; padding: 0; }'
      + "body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.45; }"
      + '.header { background: #0D9488; color: white; padding: 14px 20px; }'
      + '.header h1 { font-size: 18px; font-weight: 700; } .header .sub { font-size: 11px; opacity: .9; }'
      + '.section { margin: 12px 0; padding: 0 4px; }'
      + '.section-title { font-size: 13px; font-weight: 700; color: #0D9488; border-bottom: 2px solid #0D9488; padding-bottom: 3px; margin-bottom: 8px; }'
      + '.card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; white-space: pre-wrap; }'
      + 'ul { margin: 4px 0 4px 18px; } li { margin: 2px 0; }'
      + 'table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }'
      + 'th { background: #f9fafb; text-align: left; padding: 5px 6px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }'
      + 'td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }'
      + '.footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; }'
      + '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
      + '</style></head><body>' + body + '</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de l'audit insertion..." /></Layout>;

  const ms = data?.milestones?.par_type || [];
  const freins = data?.freins_moyennes || {};
  const s = data?.sorties || {};
  const act = data?.actions || {};
  const yearOptions = [];
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 5; y--) yearOptions.push(y);

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          title="Audit Insertion"
          subtitle="Synthèse de la situation d'insertion de la structure — direction & CIP"
          icon={ClipboardList}
          actions={
            <div className="flex items-center gap-2">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button onClick={printReport} disabled={!data}
                className="btn-ghost text-sm inline-flex items-center gap-1.5">
                <Printer className="w-4 h-4" /> Exporter PDF
              </button>
            </div>
          }
        />

        {error && <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">Impossible de charger l'audit : {error}</div>}

        {data && (
          <div className="space-y-6">
            {/* 1. Indicateurs clés */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Users} label="Personnes en parcours" value={data.nb_en_parcours} tone="blue" />
              <StatCard icon={ListChecks} label="Réalisation jalons (échus)" value={data.milestones?.global?.taux != null ? `${data.milestones.global.taux} %` : '—'} sub={`${data.milestones?.global?.realises_echus || 0}/${data.milestones?.global?.echus || 0} échus réalisés`} tone="teal" />
              <StatCard icon={Target} label="Plans d'action en cours" value={act.total_en_cours || 0} tone="amber" />
              <StatCard icon={LogOut} label={`Sorties dynamiques ${data.annee}`} value={s.taux_dynamiques != null ? `${s.taux_dynamiques} %` : '—'} sub={`${s.positives || 0}/${s.total || 0} sorties`} tone="green" />
            </div>

            {/* 2. Réalisation par échéance */}
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Réalisation des entretiens / bilans par échéance</h3>
              <div className="space-y-3">
                {ms.map((m) => (
                  <div key={m.type} className="flex items-center gap-3">
                    <div className="w-40 text-sm text-gray-600 shrink-0">{m.type}</div>
                    <div className="flex-1"><Bar pct={m.taux_echeance ?? 0} tone={m.taux_echeance == null ? 'teal' : m.taux_echeance >= 80 ? 'green' : m.taux_echeance >= 50 ? 'amber' : 'red'} /></div>
                    <div className="w-28 text-right text-xs text-gray-500 shrink-0">
                      {m.taux_echeance != null ? <span className="font-semibold text-gray-700">{m.taux_echeance}%</span> : <span className="text-gray-400">n/a</span>}
                      {' '}({m.realises_echus}/{m.echus})
                    </div>
                  </div>
                ))}
                {ms.every((m) => m.echus === 0) && <p className="text-sm text-gray-400">Aucun jalon échu sur le périmètre.</p>}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Taux = jalons réalisés parmi ceux dont l'échéance est passée.</p>
            </div>

            {/* 3. Radar freins + 5. Sorties */}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold text-gray-800 mb-2">Cartographie consolidée des 7 freins</h3>
                <p className="text-[11px] text-gray-400 mb-2">Moyenne cohorte (/5) sur {data.freins_nb_evalues || 0} salarié(s) évalué(s){data.frein_dominant ? ` — frein dominant : ${FREIN_LABELS[data.frein_dominant]}` : ''}.</p>
                <FreinsRadar moyennes={freins} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
                  {Object.keys(FREIN_LABELS).map((k) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-gray-500">{FREIN_LABELS[k]}</span>
                      <span className="font-semibold text-gray-700">{freins[k] != null ? freins[k] : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold text-gray-800 mb-3">Sorties &amp; statistiques ({data.annee})</h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center"><div className="text-2xl font-bold text-gray-800">{s.total || 0}</div><div className="text-xs text-gray-500">Total</div></div>
                  <div className="text-center"><div className="text-2xl font-bold text-green-600">{s.positives || 0}</div><div className="text-xs text-gray-500">Dynamiques</div></div>
                  <div className="text-center"><div className="text-2xl font-bold text-gray-400">{s.negatives || 0}</div><div className="text-xs text-gray-500">Autres</div></div>
                </div>
                {s.total > 0 && (
                  <>
                    <Bar pct={s.taux_dynamiques ?? 0} tone="green" />
                    <p className="text-xs text-gray-500 mt-1 mb-3">Taux de sorties dynamiques : <span className="font-semibold text-gray-700">{s.taux_dynamiques ?? '—'} %</span></p>
                  </>
                )}
                <div className="space-y-1">
                  {Object.keys(s.par_type || {}).length ? Object.entries(s.par_type).map(([t, n]) => (
                    <div key={t} className="flex justify-between text-sm border-b border-gray-50 py-1"><span className="text-gray-600">{t}</span><span className="font-medium text-gray-700">{n}</span></div>
                  )) : <p className="text-sm text-gray-400">Aucune sortie enregistrée sur la période.</p>}
                </div>
              </div>
            </div>

            {/* 4. Plans d'action en cours */}
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-gray-800 mb-1">Plans d'action en cours</h3>
              <p className="text-3xl font-bold text-gray-800 mb-4">{act.total_en_cours || 0}<span className="text-sm font-normal text-gray-400 ml-2">action(s) active(s)</span></p>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Par statut</p>
                  {Object.entries(act.par_statut || {}).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{STATUS_LABELS[k] || k}</span><span className="font-medium">{n}</span></div>)}
                  {!Object.keys(act.par_statut || {}).length && <span className="text-sm text-gray-400">—</span>}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Par catégorie</p>
                  {Object.entries(act.par_categorie || {}).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{CATEGORY_LABELS[k] || k}</span><span className="font-medium">{n}</span></div>)}
                  {!Object.keys(act.par_categorie || {}).length && <span className="text-sm text-gray-400">—</span>}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Par priorité</p>
                  {Object.entries(act.par_priorite || {}).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{PRIORITY_LABELS[k] || k}</span><span className="font-medium">{n}</span></div>)}
                  {!Object.keys(act.par_priorite || {}).length && <span className="text-sm text-gray-400">—</span>}
                </div>
              </div>
            </div>

            {/* 6. Rapport IA */}
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /> Rapport IA — situation globale &amp; public</h3>
                {canIa && (
                  <button onClick={generateIa} disabled={iaLoading}
                    className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
                    {iaLoading ? 'Génération… (jusqu\'à 1 min)' : ia ? 'Régénérer' : 'Générer le rapport IA'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Rédige une synthèse de la situation globale de la structure à partir des indicateurs chiffrés ci-dessus <strong>et</strong> des verbatims anonymisés des CIP/agents (observations, bilans, notes d'actions). Destinée à la direction et aux CIP.
              </p>
              {!canIa && <p className="text-xs text-gray-400">Génération réservée aux profils ADMIN / RH.</p>}
              {iaError && <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{iaError}</div>}

              {ia && (
                <div className="space-y-3">
                  {ia._tronque && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2">Rapport tronqué (limite de longueur du modèle atteinte) — le contenu peut être incomplet.</div>}
                  {ia.synthese_direction && (
                    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-violet-700 mb-1">Synthèse direction</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{ia.synthese_direction}</p>
                    </div>
                  )}
                  {ia.situation_globale && (
                    <div><p className="text-xs font-semibold text-gray-500 uppercase mb-1">Situation globale</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{ia.situation_globale}</p></div>
                  )}
                  {ia.profil_public && (
                    <div><p className="text-xs font-semibold text-gray-500 uppercase mb-1">Profil du public accompagné</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{ia.profil_public}</p></div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {Array.isArray(ia.points_forts) && ia.points_forts.length > 0 && (
                      <div><p className="text-xs font-semibold text-green-600 uppercase mb-1">Points forts</p><ul className="list-disc list-inside text-sm text-slate-700 space-y-1">{ia.points_forts.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    )}
                    {Array.isArray(ia.points_vigilance) && ia.points_vigilance.length > 0 && (
                      <div><p className="text-xs font-semibold text-amber-600 uppercase mb-1">Points de vigilance</p><ul className="list-disc list-inside text-sm text-slate-700 space-y-1">{ia.points_vigilance.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    )}
                  </div>
                  {Array.isArray(ia.recommandations_structure) && ia.recommandations_structure.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Recommandations pour la structure</p>
                      <div className="space-y-2">
                        {ia.recommandations_structure.map((r, i) => (
                          <div key={i} className="border border-gray-200 rounded-lg p-3">
                            <p className="text-sm font-medium text-gray-800">{r.action}</p>
                            {r.objectif && <p className="text-xs text-gray-500 mt-0.5">Objectif : {r.objectif}</p>}
                            {r.echeance_suggeree && <p className="text-xs text-gray-400 mt-0.5">Échéance suggérée : {r.echeance_suggeree}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {ia.conclusion && (
                    <div className="border-t pt-2"><p className="text-sm italic text-slate-600 whitespace-pre-wrap">{ia.conclusion}</p></div>
                  )}
                  {/* Filet de sécurité : jamais silencieux si le format est inattendu */}
                  {!ia.synthese_direction && !ia.situation_globale && !ia.profil_public
                    && !(ia.points_forts?.length) && !(ia.points_vigilance?.length)
                    && !(ia.recommandations_structure?.length) && !ia.conclusion && (
                    <pre className="text-xs whitespace-pre-wrap text-slate-600 bg-gray-50 border rounded p-3">{typeof ia === 'string' ? ia : JSON.stringify(ia, null, 2)}</pre>
                  )}
                </div>
              )}
              {!ia && !iaError && canIa && <p className="text-sm text-gray-400">Cliquez sur « Générer le rapport IA » pour produire la synthèse. Le rapport peut ensuite être exporté en PDF pour la direction.</p>}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
