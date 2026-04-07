import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Scale, ShieldCheck, Target, TrendingUp } from 'lucide-react';
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
      const res = await api.get(`/finance/gl/${year}/bilan`);
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
          icon={Scale}
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
          <KPICard title="Total Actif" value={fmtK(kpis.total_actif)} unit="EUR" icon={Scale} accent="primary" loading={loading}
            trend={kpis.actif_variation ? { direction: kpis.actif_variation > 0 ? 'up' : 'down', value: Math.abs(kpis.actif_variation) } : undefined}
          />
          <KPICard title="Capitaux propres" value={fmtK(kpis.capitaux_propres)} unit="EUR" icon={ShieldCheck} accent="emerald" loading={loading}
            trend={kpis.cp_variation ? { direction: kpis.cp_variation > 0 ? 'up' : 'down', value: Math.abs(kpis.cp_variation) } : undefined}
          />
          <KPICard title="Resultat net" value={fmtK(kpis.resultat_net)} unit="EUR" icon={BarChart3} accent="amber" loading={loading}
            trend={kpis.resultat_variation ? { direction: kpis.resultat_variation > 0 ? 'up' : 'down', value: Math.abs(kpis.resultat_variation) } : undefined}
          />
        </div>

        {/* Compte de resultat (SIG) */}
        <div className="card-modern p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-slate-400" />
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
              <ArrowRight className="w-5 h-5 text-teal-500" />
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
              <ArrowLeft className="w-5 h-5 text-amber-500" />
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
            <TrendingUp className="w-5 h-5 text-slate-400" />
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
            <Target className="w-5 h-5 text-slate-400" />
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

