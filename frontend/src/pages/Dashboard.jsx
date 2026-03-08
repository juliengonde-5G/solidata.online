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
  const co2 = Math.round(collecteKg * 3.6);
  const nbProduits = historique ? getProduitsForYear(selectedYear) : 0;

  // Inventaire actuel
  const inventaire = historique?.inventaire || [];
  const totalEnStock = inventaire.reduce((s, r) => s + parseInt(r.nb_en_stock || 0), 0);
  const totalPoids = inventaire.reduce((s, r) => s + parseFloat(r.poids_total_kg || 0), 0);

  return (
    <Layout>
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-solidata-dark tracking-tight">
              Bonjour, {user?.first_name || user?.username} !
            </h1>
            <p className="text-gray-500 mt-1">Tableau de bord SOLIDATA ERP</p>
          </div>
          {historique?.annees_disponibles?.length > 0 && (
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm font-medium"
            >
              {historique.annees_disponibles.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <KpiCard
            title={`Tonnage collecté ${selectedYear}`}
            value={loading ? '...' : `${(collecteKg / 1000).toFixed(1)}`}
            unit="tonnes"
            color="green"
            icon="🚛"
          />
          <KpiCard
            title={`Tonnage trié ${selectedYear}`}
            value={loading ? '...' : `${(trieKg / 1000).toFixed(1)}`}
            unit="tonnes"
            color="blue"
            icon="⚙️"
          />
          <KpiCard
            title={`CO₂ évité ${selectedYear}`}
            value={loading ? '...' : `${(co2 / 1000).toFixed(1)}`}
            unit="tonnes"
            color="teal"
            icon="🌱"
          />
          <KpiCard
            title={`Produits fabriqués ${selectedYear}`}
            value={loading ? '...' : nbProduits.toLocaleString('fr-FR')}
            unit="articles"
            color="yellow"
            icon="📦"
          />
        </div>

        {/* Inventaire Produits Finis */}
        {inventaire.length > 0 && (
          <div className="card-modern p-6 border border-solidata-green/10 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-solidata-dark">Inventaire Produits Finis</h2>
              <div className="flex gap-4 text-sm">
                <span className="text-gray-500">En stock : <span className="font-bold text-solidata-dark">{totalEnStock.toLocaleString('fr-FR')}</span></span>
                <span className="text-gray-500">Poids total : <span className="font-bold text-solidata-dark">{(totalPoids / 1000).toFixed(1)} t</span></span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {inventaire.map(inv => (
                <div key={inv.gamme || 'NC'} className="rounded-xl p-4 bg-gray-50/80 border border-gray-100">
                  <div className="text-sm font-semibold text-solidata-dark mb-2">{inv.gamme || 'Non classé'}</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Total</span>
                      <span className="font-medium">{parseInt(inv.nb_produits).toLocaleString('fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">En stock</span>
                      <span className="font-medium text-solidata-green">{parseInt(inv.nb_en_stock).toLocaleString('fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Sortis</span>
                      <span className="font-medium text-blue-600">{parseInt(inv.nb_sortis).toLocaleString('fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Poids</span>
                      <span className="font-medium">{parseFloat(inv.poids_total_kg).toFixed(0)} kg</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comparaison annuelle */}
        {historique?.annees_disponibles?.length > 1 && (
          <div className="card-modern p-6 border border-solidata-green/10 mb-8">
            <h2 className="text-lg font-semibold text-solidata-dark mb-4">Comparaison annuelle</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Indicateur</th>
                    {historique.annees_disponibles.map(y => (
                      <th key={y} className="text-right px-4 py-3 font-medium text-gray-600">{y}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-3 font-medium">Collecte CAV (kg)</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold">{getCollecteForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3 font-medium">Tonnage trié (kg)</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold">{getTrieForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3 font-medium">Produits fabriqués</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold">{getProduitsForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3 font-medium">Produits sortis</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold">{getSortiesForYear(y).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3 font-medium">CO₂ évité (kg)</td>
                    {historique.annees_disponibles.map(y => (
                      <td key={y} className="px-4 py-3 text-right font-semibold text-teal-600">{Math.round(getCollecteForYear(y) * 3.6).toLocaleString('fr-FR')}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modules actifs */}
        <div className="card-modern p-6 border border-solidata-green/10">
          <h2 className="text-lg font-semibold text-solidata-dark mb-4">Modules actifs</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {['Recrutement & PCM', 'Équipes & Planning', 'Collecte & Tournées IA', 'Production & Tri',
              'Stock & Expéditions', 'Facturation', 'Reporting', 'Refashion'].map(mod => (
              <div key={mod} className="rounded-xl p-4 text-sm font-medium text-gray-600 bg-gray-50/80 hover:bg-solidata-green/5 border border-transparent hover:border-solidata-green/20 transition-colors">
                {mod}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function KpiCard({ title, value, unit, color, icon }) {
  const colors = {
    green: 'bg-solidata-green/10 text-solidata-green',
    blue: 'bg-blue-50 text-blue-600',
    teal: 'bg-teal-50 text-teal-600',
    yellow: 'bg-solidata-yellow/10 text-solidata-yellow',
  };
  return (
    <div className="card-modern p-5 border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500">{title}</span>
        <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${colors[color]}`}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-solidata-dark">{value}</span>
        <span className="text-sm text-gray-400">{unit}</span>
      </div>
    </div>
  );
}
