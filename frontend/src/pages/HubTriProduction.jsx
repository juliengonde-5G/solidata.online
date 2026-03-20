import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../services/api';

export default function HubTriProduction() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [productionRes, stockRes, produitsRes] = await Promise.all([
        api.get('/production').catch(() => ({ data: [] })),
        api.get('/stock/summary').catch(() => ({ data: null })),
        api.get('/produits-finis').catch(() => ({ data: [] })),
      ]);
      const productions = Array.isArray(productionRes.data) ? productionRes.data : (productionRes.data?.productions || []);
      const today = new Date().toISOString().split('T')[0];
      const todayProd = productions.filter(p => p.date === today || (p.date && p.date.startsWith(today)));
      const totalKgToday = todayProd.reduce((sum, p) => sum + (parseFloat(p.poids_kg || p.weight_kg || 0)), 0);
      const stockData = stockRes.data;
      const totalStockT = stockData?.total_kg ? (parseFloat(stockData.total_kg) / 1000).toFixed(1) : (stockData?.total_tonnes ?? '—');
      const produitsFinis = Array.isArray(produitsRes.data) ? produitsRes.data : (produitsRes.data?.produits || []);
      const enStock = produitsFinis.filter(p => p.statut === 'en_stock' || p.status === 'in_stock' || !p.date_sortie);
      setStats({
        productionJour: Math.round(totalKgToday),
        chainesActives: '—',
        stockMP: totalStockT,
        produitsFinis: enStock.length,
      });
    } catch (err) {
      console.error('Erreur chargement stats tri/production:', err);
      setStats({ productionJour: 0, chainesActives: '—', stockMP: '—', produitsFinis: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Production du jour', value: loading ? '—' : (stats?.productionJour ?? 0).toLocaleString('fr-FR'), unit: 'kg', icon: IconFactory, accent: 'primary' },
    { title: 'Chaînes actives', value: loading ? '—' : stats?.chainesActives, icon: IconSort, accent: 'slate' },
    { title: 'Stock matières', value: loading ? '—' : stats?.stockMP, unit: 't', icon: IconBox, accent: 'primary' },
    { title: 'Produits finis en stock', value: loading ? '—' : (stats?.produitsFinis ?? 0).toLocaleString('fr-FR'), icon: IconTag, accent: 'amber' },
  ];

  const cards = [
    { path: '/production', title: 'Production', desc: 'Suivi quotidien de la production et KPI', icon: IconFactory },
    { path: '/chaine-tri', title: 'Chaînes de tri', desc: 'Gestion des chaînes et opérations de tri', icon: IconSort },
    { path: '/stock', title: 'Stock MP', desc: 'Mouvements de stock et inventaire matières premières', icon: IconBox },
    { path: '/produits-finis', title: 'Produits finis', desc: 'Catalogue et suivi des produits fabriqués', icon: IconTag },
    { path: '/expeditions', title: 'Expéditions', desc: 'Expéditions vers exutoires et bons de livraison', icon: IconShip },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <IconFactory className="w-5 h-5 text-primary" />
            </span>
            Tri & Production — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Production, chaînes de tri, stock et expéditions</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>

        <h2 className="text-lg font-semibold text-slate-800 mb-4">Accès rapide</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <NavCard key={card.path} {...card} onClick={() => navigate(card.path)} />
          ))}
        </div>
      </div>
    </Layout>
  );
}

/* ── KPI Card ── */
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
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

/* ── Navigation Card ── */
function NavCard({ title, desc, icon: Icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card-modern p-5 text-left group hover:shadow-card-hover hover:border-primary/30 transition-all w-full"
    >
      <div className="flex items-start gap-4">
        <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
          <Icon className="w-5 h-5 text-primary group-hover:text-white" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 group-hover:text-primary transition-colors">{title}</span>
            <svg className="w-4 h-4 text-slate-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
        </div>
      </div>
    </button>
  );
}

/* ── Icons ── */
function IconFactory({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>;
}
function IconSort({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4h16M4 8h12M4 12h8M4 16h4m4-4l4 4m0 0l4-4m-4 4V4" /></svg>;
}
function IconBox({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
}
function IconTag({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>;
}
function IconShip({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
