import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import api from '../services/api';

const MOIS_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const MOIS_KEYS = ['jan', 'fev', 'mar', 'avr', 'mai', 'jun', 'jul', 'aou', 'sep', 'oct', 'nov', 'dec'];

export default function Dashboard() {
  const { user } = useAuth();
  const [historique, setHistorique] = useState(null);
  const [selectedYear, setSelectedYear] = useState(2025);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const res = await api.get('/historique/kpi');
      setHistorique(res.data);
      if (res.data.annees_disponibles?.length > 0) {
        setSelectedYear(res.data.annees_disponibles[res.data.annees_disponibles.length - 1]);
      }
    } catch (err) {
      console.error('Erreur chargement historique:', err);
    }
    setLoading(false);
  };

  const getCollecteForYear = (year) => {
    const row = historique?.collecte?.find(r => r.annee === year);
    return row ? Math.round(parseFloat(row.total_kg) / 1000) / 1 : 0;
  };

  const getTrieForYear = (year) => {
    const row = historique?.trie?.find(r => r.annee === year);
    return row ? Math.round(parseFloat(row.total_kg) / 1000) / 1 : 0;
  };

  const getProduitsForYear = (year) => {
    const row = historique?.produits_fabriques?.find(r => r.annee === year);
    return row ? parseInt(row.total) : 0;
  };

  const getSortiesForYear = (year) => {
    const row = historique?.produits_sorties?.find(r => r.annee === year);
    return row ? parseInt(row.total) : 0;
  };

  const collecteKg = historique ? getCollecteForYear(selectedYear) : 0;
  const trieKg = historique ? getTrieForYear(selectedYear) : 0;
  const co2 = Math.round(collecteKg * 1.493);
  const nbProduits = historique ? getProduitsForYear(selectedYear) : 0;

  // Inventaire actuel
  const inventaire = historique?.inventaire || [];
  const totalEnStock = inventaire.reduce((s, r) => s + parseInt(r.nb_en_stock || 0), 0);
  const totalPoids = inventaire.reduce((s, r) => s + parseFloat(r.poids_total_kg || 0), 0);

  return (
    <Layout>
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 tracking-tight">
              Bonjour, {user?.first_name || user?.username} !
            </h1>
            <p className="text-slate-500 mt-1 text-sm">Tableau de bord — Collecte, tri & insertion</p>
          </div>
          {historique?.annees_disponibles?.length > 0 && (
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="input-modern w-full sm:w-auto min-w-[120px]"
            >
              {historique.annees_disponibles.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>

        {/* Tuiles KPI — design system */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-8">
          <KpiCard
            title={`Tonnage collecté ${selectedYear}`}
            value={loading ? '—' : `${(collecteKg / 1000).toFixed(1)}`}
            unit="tonnes"
            icon={IconTruck}
            accent="primary"
          />
          <KpiCard
            title={`Tonnage trié ${selectedYear}`}
            value={loading ? '—' : `${(trieKg / 1000).toFixed(1)}`}
            unit="tonnes"
            icon={IconSort}
            accent="slate"
          />
          <KpiCard
            title={`CO₂ évité ${selectedYear}`}
            value={loading ? '—' : `${(co2 / 1000).toFixed(1)}`}
            unit="tonnes"
            icon={IconSparkles}
            accent="primary"
          />
          <KpiCard
            title={`Produits fabriqués ${selectedYear}`}
            value={loading ? '—' : nbProduits.toLocaleString('fr-FR')}
            unit="articles"
            icon={IconBox}
            accent="amber"
          />
        </div>

        {/* Inventaire Produits Finis */}
        {inventaire.length > 0 && (
          <div className="card-modern p-6 mb-8">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Inventaire Produits Finis</h2>
              <div className="flex gap-6 text-sm">
                <span className="text-slate-500">En stock : <span className="font-semibold text-slate-800">{totalEnStock.toLocaleString('fr-FR')}</span></span>
                <span className="text-slate-500">Poids total : <span className="font-semibold text-slate-800">{(totalPoids / 1000).toFixed(1)} t</span></span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {inventaire.map(inv => (
                <div key={inv.gamme || 'NC'} className="rounded-card p-4 bg-slate-50/80 border border-slate-100 hover:border-slate-200 transition-colors">
                  <div className="text-sm font-semibold text-slate-800 mb-2">{inv.gamme || 'Non classé'}</div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Total</span>
                      <span className="font-medium text-slate-700">{parseInt(inv.nb_produits).toLocaleString('fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">En stock</span>
                      <span className="font-medium text-primary">{parseInt(inv.nb_en_stock).toLocaleString('fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Sortis</span>
                      <span className="font-medium text-slate-700">{parseInt(inv.nb_sortis).toLocaleString('fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Poids</span>
                      <span className="font-medium text-slate-700">{parseFloat(inv.poids_total_kg).toFixed(0)} kg</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comparaison annuelle */}
        {historique?.annees_disponibles?.length > 1 && (
          <div className="card-modern p-6 mb-8">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Comparaison annuelle</h2>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600 rounded-l-lg">Indicateur</th>
                    {historique.annees_disponibles.map(y => (
                      <th key={y} className="text-right px-4 py-3 font-medium text-slate-600">{y}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-700">Collecte CAV (kg)</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold text-slate-800">{getCollecteForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-700">Tonnage trié (kg)</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold text-slate-800">{getTrieForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-700">Produits fabriqués</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold text-slate-800">{getProduitsForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-700">Produits sortis</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold text-slate-800">{getSortiesForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-700">CO₂ évité (kg)</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold text-primary">{Math.round(getCollecteForYear(y) * 1.493).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}

function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconSort({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4h16M4 8h12M4 12h8M4 16h4m4-4l4 4m0 0l4-4m-4 4V4" /></svg>;
}
function IconSparkles({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;
}
function IconBox({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
}

function KpiCard({ title, value, unit, icon: Icon, accent }) {
  const accentStyles = {
    primary: 'bg-primary-surface text-primary',
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className="card-modern p-5 group hover:shadow-card-hover transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="tile-label">{title}</span>
        <span className={`w-10 h-10 rounded-card flex items-center justify-center ${accentStyles[accent] || accentStyles.slate}`}>
          <Icon className="w-5 h-5" />
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="tile-value">{value}</span>
        <span className="text-sm text-slate-400">{unit}</span>
      </div>
    </div>
  );
}
