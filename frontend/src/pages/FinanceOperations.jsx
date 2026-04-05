import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, LoadingSpinner, EmptyState } from '../components';

// ══════════════════════════════════════════
// FINANCE OPERATIONS — Donnees operationnelles
// Volumes, exutoires, prix, flotte, effectifs
// + P&L par centre avec frais generaux
// ══════════════════════════════════════════

const fmt = (v) => v != null ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '—';
const fmtDec = (v) => v != null ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '—';
const fmtPct = (v) => v != null ? `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%` : '—';

const CATEGORIES = [
  { key: 'volumes', label: 'Volumes (tonnes)', icon: IconScale, fields: [
    { key: 'tonnes_collectees', label: 'Tonnes collectees' },
    { key: 'tonnes_triees', label: 'Tonnes triees' },
    { key: 'tonnes_expedites', label: 'Tonnes expediees' },
    { key: 'taux_valorisation', label: 'Taux de valorisation (%)' },
  ]},
  { key: 'exutoires', label: 'Exutoires', icon: IconShip, fields: [
    { key: 'nb_exutoires', label: 'Nombre d\'exutoires' },
    { key: 'ca_exutoires', label: 'CA exutoires (EUR)' },
    { key: 'prix_moyen_tonne', label: 'Prix moyen / tonne' },
  ]},
  { key: 'prix', label: 'Prix & Tarifs', icon: IconTag, fields: [
    { key: 'prix_collecte_tonne', label: 'Prix collecte / tonne' },
    { key: 'prix_tri_tonne', label: 'Prix tri / tonne' },
    { key: 'prix_vente_moyen', label: 'Prix de vente moyen' },
  ]},
  { key: 'flotte', label: 'Flotte', icon: IconTruck, fields: [
    { key: 'nb_vehicules', label: 'Nombre de vehicules' },
    { key: 'km_total', label: 'Km total' },
    { key: 'cout_km', label: 'Cout / km' },
    { key: 'carburant_total', label: 'Carburant total (EUR)' },
  ]},
  { key: 'effectifs', label: 'Effectifs', icon: IconTeam, fields: [
    { key: 'etp_total', label: 'ETP total' },
    { key: 'masse_salariale', label: 'Masse salariale (EUR)' },
    { key: 'cout_etp_moyen', label: 'Cout ETP moyen' },
  ]},
];

export default function FinanceOperations() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [autoData, setAutoData] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/operations/${year}/auto`);
      setAutoData(res.data.auto || {});
      setOverrides(res.data.overrides || {});
      setResults(res.data.results || null);
    } catch (err) {
      console.error('Erreur chargement operations:', err);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOverride = (fieldKey, value) => {
    setOverrides((prev) => ({ ...prev, [fieldKey]: value }));
    setSaved(false);
  };

  const getEffectiveValue = (fieldKey) => {
    if (overrides[fieldKey] != null && overrides[fieldKey] !== '') return overrides[fieldKey];
    return autoData?.[fieldKey] ?? '';
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/finance/operations/${year}`, { overrides });
      setSaved(true);
      loadData();
    } catch (err) {
      console.error('Erreur sauvegarde operations:', err);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-32"><LoadingSpinner /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Donnees Operationnelles"
          subtitle="Donnees auto-calculees et saisies manuelles"
          icon={IconCalc}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Operations' },
          ]}
          actions={
            <div className="flex items-center gap-3">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary text-sm"
              >
                {saving ? 'Sauvegarde...' : saved ? 'Sauvegarde !' : 'Sauvegarder'}
              </button>
            </div>
          }
        />

        {/* KPI calculees */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard title="Cout / tonne collecte" value={fmtDec(results?.cout_tonne_collecte)} unit="EUR/t" icon={IconTruck} accent="primary" />
          <KPICard title="Cout / tonne trie" value={fmtDec(results?.cout_tonne_trie)} unit="EUR/t" icon={IconFactory} accent="amber" />
          <KPICard title="Marge operationnelle" value={fmtPct(results?.marge_operationnelle)} icon={IconChart} accent="emerald" />
          <KPICard title="CA / ETP" value={fmt(results?.ca_par_etp)} unit="EUR" icon={IconTeam} accent="primary" />
        </div>

        {/* Categories editables */}
        {CATEGORIES.map((cat) => {
          const CatIcon = cat.icon;
          return (
            <div key={cat.key} className="card-modern p-6">
              <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <CatIcon className="w-5 h-5 text-slate-400" />
                {cat.label}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">Indicateur</th>
                      <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">Valeur auto</th>
                      <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">Correction manuelle</th>
                      <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">Valeur effective</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.fields.map((field) => (
                      <tr key={field.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-slate-700 font-medium">{field.label}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{fmtDec(autoData?.[field.key])}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            step="any"
                            value={overrides[field.key] ?? ''}
                            onChange={(e) => handleOverride(field.key, e.target.value)}
                            placeholder="—"
                            className="w-32 ml-auto text-right px-2 py-1 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">
                          {fmtDec(getEffectiveValue(field.key))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* Resultat par centre */}
        {results?.centres && results.centres.length > 0 && (
          <div className="card-modern p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <IconPL className="w-5 h-5 text-slate-400" />
              Resultat par centre (avec allocation FG et transferts internes)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Centre</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Produits</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Charges directes</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">FG alloues</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Transferts</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Resultat</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-600 text-xs uppercase">Marge %</th>
                  </tr>
                </thead>
                <tbody>
                  {results.centres.map((c, i) => (
                    <tr key={c.centre || i} className={`border-b border-slate-100 ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-700">{c.centre}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{fmt(c.produits)}</td>
                      <td className="px-4 py-3 text-right text-red-600">{fmt(c.charges_directes)}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{fmt(c.fg_alloues)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{fmt(c.transferts)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${c.resultat >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {fmt(c.resultat)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{fmtPct(c.marge)}</td>
                    </tr>
                  ))}
                </tbody>
                {results.total && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                      <td className="px-4 py-3 text-slate-800">Total</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{fmt(results.total.produits)}</td>
                      <td className="px-4 py-3 text-right text-red-700">{fmt(results.total.charges_directes)}</td>
                      <td className="px-4 py-3 text-right text-amber-700">{fmt(results.total.fg_alloues)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmt(results.total.transferts)}</td>
                      <td className={`px-4 py-3 text-right ${results.total.resultat >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                        {fmt(results.total.resultat)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmtPct(results.total.marge)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// SVG Icons
// ══════════════════════════════════════════

function IconCalc({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>;
}
function IconScale({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>;
}
function IconShip({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12l-2 8h18l-2-8" /></svg>;
}
function IconTag({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>;
}
function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconTeam({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>;
}
function IconFactory({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-16 0H3m2-5h4m2 0h4m-8-4h4m2 0h4" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>;
}
function IconPL({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
