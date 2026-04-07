import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Calculator, Factory, Scale, Ship, Tag, TrendingUp, Truck, Users,
} from 'lucide-react';

const IconPL = BarChart3;
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
  { key: 'volumes', label: 'Volumes (tonnes)', icon: Scale, fields: [
    { key: 'tonnes_collectees', label: 'Tonnes collectees' },
    { key: 'tonnes_triees', label: 'Tonnes triees' },
    { key: 'tonnes_expedites', label: 'Tonnes expediees' },
    { key: 'taux_valorisation', label: 'Taux de valorisation (%)' },
  ]},
  { key: 'exutoires', label: 'Exutoires', icon: Ship, fields: [
    { key: 'nb_exutoires', label: 'Nombre d\'exutoires' },
    { key: 'ca_exutoires', label: 'CA exutoires (EUR)' },
    { key: 'prix_moyen_tonne', label: 'Prix moyen / tonne' },
  ]},
  { key: 'prix', label: 'Prix & Tarifs', icon: Tag, fields: [
    { key: 'prix_collecte_tonne', label: 'Prix collecte / tonne' },
    { key: 'prix_tri_tonne', label: 'Prix tri / tonne' },
    { key: 'prix_vente_moyen', label: 'Prix de vente moyen' },
  ]},
  { key: 'flotte', label: 'Flotte', icon: Truck, fields: [
    { key: 'nb_vehicules', label: 'Nombre de vehicules' },
    { key: 'km_total', label: 'Km total' },
    { key: 'cout_km', label: 'Cout / km' },
    { key: 'carburant_total', label: 'Carburant total (EUR)' },
  ]},
  { key: 'effectifs', label: 'Effectifs', icon: Users, fields: [
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
          icon={Calculator}
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
          <KPICard title="Cout / tonne collecte" value={fmtDec(results?.cout_tonne_collecte)} unit="EUR/t" icon={Truck} accent="primary" />
          <KPICard title="Cout / tonne trie" value={fmtDec(results?.cout_tonne_trie)} unit="EUR/t" icon={Factory} accent="amber" />
          <KPICard title="Marge operationnelle" value={fmtPct(results?.marge_operationnelle)} icon={TrendingUp} accent="emerald" />
          <KPICard title="CA / ETP" value={fmt(results?.ca_par_etp)} unit="EUR" icon={Users} accent="primary" />
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

