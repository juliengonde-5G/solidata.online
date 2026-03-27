import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, LoadingSpinner } from '../components';

// ══════════════════════════════════════════
// FINANCE BILAN — Bilan & SIG
// Bilan simplifie, compte de resultat, ratios, seuil de rentabilite
// ══════════════════════════════════════════

const fmt = (v) => v != null ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '—';
const fmtK = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return fmt(v);
};
const fmtPct = (v) => v != null ? `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%` : '—';

export default function FinanceBilan() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/gl/${year}`, { params: { view: 'bilan' } });
      setData(res.data);
    } catch (err) {
      console.error('Erreur chargement bilan:', err);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const kpis = data?.kpis || {};
  const sig = data?.sig || [];
  const actif = data?.actif || [];
  const passif = data?.passif || [];
  const ratios = data?.ratios || [];
  const breakeven = data?.breakeven || {};

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Bilan & Ratios"
          subtitle="Bilan simplifie, SIG et seuil de rentabilite"
          icon={IconBalance}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Bilan' },
          ]}
          actions={
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          }
        />

        {/* KPI Cards avec comparatif N-1 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title="Total Actif" value={fmtK(kpis.total_actif)} unit="EUR" icon={IconBalance} accent="primary" loading={loading}
            trend={kpis.actif_variation ? { direction: kpis.actif_variation > 0 ? 'up' : 'down', value: Math.abs(kpis.actif_variation) } : undefined}
          />
          <KPICard title="Capitaux propres" value={fmtK(kpis.capitaux_propres)} unit="EUR" icon={IconShield} accent="emerald" loading={loading}
            trend={kpis.cp_variation ? { direction: kpis.cp_variation > 0 ? 'up' : 'down', value: Math.abs(kpis.cp_variation) } : undefined}
          />
          <KPICard title="Resultat net" value={fmtK(kpis.resultat_net)} unit="EUR" icon={IconPL} accent="amber" loading={loading}
            trend={kpis.resultat_variation ? { direction: kpis.resultat_variation > 0 ? 'up' : 'down', value: Math.abs(kpis.resultat_variation) } : undefined}
          />
        </div>

        {/* Compte de resultat (SIG) */}
        <div className="card-modern p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <IconPL className="w-5 h-5 text-slate-400" />
            Soldes Intermediaires de Gestion
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-12"><LoadingSpinner /></div>
          ) : sig.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucune donnee disponible</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Libelle</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Annee N</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Annee N-1</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Variation</th>
                  </tr>
                </thead>
                <tbody>
                  {sig.map((row, i) => (
                    <tr key={i} className={`border-b border-slate-100 ${row.highlight ? 'bg-teal-50/30 font-semibold' : ''} ${i % 2 === 1 && !row.highlight ? 'bg-slate-50/50' : ''}`}>
                      <td className={`px-4 py-3 ${row.highlight ? 'text-slate-900' : 'text-slate-700'}`}>{row.label}</td>
                      <td className={`text-right px-4 py-3 ${row.n < 0 ? 'text-red-600' : ''}`}>{fmt(row.n)}</td>
                      <td className="text-right px-4 py-3 text-slate-500">{fmt(row.n1)}</td>
                      <td className={`text-right px-4 py-3 ${(row.variation || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {row.variation != null ? `${row.variation > 0 ? '+' : ''}${fmtPct(row.variation)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bilan simplifie */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Actif */}
          <div className="card-modern p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <IconArrowRight className="w-5 h-5 text-teal-500" />
              Actif
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8"><LoadingSpinner /></div>
            ) : actif.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Aucune donnee</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-teal-50 border-b border-slate-200">
                      <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Poste</th>
                      <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">N</th>
                      <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">N-1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actif.map((row, i) => (
                      <tr key={i} className={`border-b border-slate-100 ${row.bold ? 'font-bold bg-slate-50' : ''}`}>
                        <td className={`px-4 py-2 ${row.indent ? 'pl-8 text-slate-500' : 'text-slate-700'}`}>{row.label}</td>
                        <td className="text-right px-4 py-2">{fmt(row.n)}</td>
                        <td className="text-right px-4 py-2 text-slate-500">{fmt(row.n1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Passif */}
          <div className="card-modern p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <IconArrowLeft className="w-5 h-5 text-amber-500" />
              Passif
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8"><LoadingSpinner /></div>
            ) : passif.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Aucune donnee</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-amber-50 border-b border-slate-200">
                      <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Poste</th>
                      <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">N</th>
                      <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">N-1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passif.map((row, i) => (
                      <tr key={i} className={`border-b border-slate-100 ${row.bold ? 'font-bold bg-slate-50' : ''}`}>
                        <td className={`px-4 py-2 ${row.indent ? 'pl-8 text-slate-500' : 'text-slate-700'}`}>{row.label}</td>
                        <td className="text-right px-4 py-2">{fmt(row.n)}</td>
                        <td className="text-right px-4 py-2 text-slate-500">{fmt(row.n1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Ratios financiers */}
        <div className="card-modern p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <IconChart className="w-5 h-5 text-slate-400" />
            Ratios financiers
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-8"><LoadingSpinner /></div>
          ) : ratios.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucun ratio disponible</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {ratios.map((ratio, i) => (
                <div key={i} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                  <p className="text-xs font-medium text-slate-500 mb-1">{ratio.label}</p>
                  <p className={`text-xl font-bold ${
                    ratio.status === 'good' ? 'text-emerald-600' :
                    ratio.status === 'warning' ? 'text-amber-600' :
                    ratio.status === 'bad' ? 'text-red-600' : 'text-slate-800'
                  }`}>
                    {ratio.unit === '%' ? fmtPct(ratio.value) : ratio.unit === 'jours' ? `${fmt(ratio.value)} j` : fmt(ratio.value)}
                  </p>
                  {ratio.benchmark && (
                    <p className="text-xs text-slate-400 mt-1">Norme : {ratio.benchmark}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Seuil de rentabilite */}
        <div className="card-modern p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <IconTarget className="w-5 h-5 text-slate-400" />
            Seuil de rentabilite
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-8"><LoadingSpinner /></div>
          ) : !breakeven.ca_seuil ? (
            <p className="text-sm text-slate-400 text-center py-8">Calcul non disponible</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-slate-200">
                <p className="text-xs font-medium text-slate-500 mb-1">CA seuil de rentabilite</p>
                <p className="text-xl font-bold text-slate-800">{fmtK(breakeven.ca_seuil)}</p>
                <p className="text-xs text-slate-400 mt-1">EUR</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200">
                <p className="text-xs font-medium text-slate-500 mb-1">Charges fixes</p>
                <p className="text-xl font-bold text-red-600">{fmtK(breakeven.charges_fixes)}</p>
                <p className="text-xs text-slate-400 mt-1">EUR</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200">
                <p className="text-xs font-medium text-slate-500 mb-1">Charges variables</p>
                <p className="text-xl font-bold text-amber-600">{fmtK(breakeven.charges_variables)}</p>
                <p className="text-xs text-slate-400 mt-1">EUR</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200">
                <p className="text-xs font-medium text-slate-500 mb-1">Marge sur cout variable</p>
                <p className="text-xl font-bold text-emerald-600">{fmtPct(breakeven.marge_cv)}</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 sm:col-span-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Date previsionnelle d'atteinte</p>
                <p className="text-xl font-bold text-teal-600">
                  {breakeven.date_atteinte
                    ? new Date(breakeven.date_atteinte).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
                    : 'Non atteint'}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 sm:col-span-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Marge de securite</p>
                <p className={`text-xl font-bold ${(breakeven.marge_securite || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmtPct(breakeven.marge_securite)}
                </p>
                <p className="text-xs text-slate-400 mt-1">CA actuel vs seuil</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// SVG Icons
// ══════════════════════════════════════════

function IconBalance({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>;
}
function IconShield({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
}
function IconPL({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconArrowRight({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>;
}
function IconArrowLeft({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>;
}
function IconTarget({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={1.8} /><circle cx="12" cy="12" r="6" strokeWidth={1.8} /><circle cx="12" cy="12" r="2" strokeWidth={1.8} /></svg>;
}
