import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../services/api';

export default function HubReporting() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [historiqueRes, employeesRes] = await Promise.all([
        api.get('/historique/kpi').catch(() => ({ data: null })),
        api.get('/employees?is_active=true').catch(() => ({ data: [] })),
      ]);
      const hist = historiqueRes.data;
      const employees = Array.isArray(employeesRes.data) ? employeesRes.data : (employeesRes.data?.employees || []);
      const currentYear = new Date().getFullYear();
      const collecteRow = hist?.collecte?.find(r => r.annee === currentYear);
      const collecteKg = collecteRow ? parseFloat(collecteRow.total_kg || 0) : 0;
      const collecteT = (collecteKg / 1000).toFixed(1);
      const co2 = ((collecteKg * 1.493) / 1000).toFixed(1);
      const trieRow = hist?.trie?.find(r => r.annee === currentYear);
      const trieKg = trieRow ? parseFloat(trieRow.total_kg || 0) : 0;
      const tauxValo = collecteKg > 0 ? Math.round((trieKg / collecteKg) * 100) : '—';
      setStats({
        tonnageCollecte: collecteT,
        co2Evite: co2,
        tauxValorisation: tauxValo,
        employesActifs: employees.length,
      });
    } catch (err) {
      console.error('Erreur chargement stats reporting:', err);
      setStats({ tonnageCollecte: '—', co2Evite: '—', tauxValorisation: '—', employesActifs: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Tonnage collecté (mois)', value: loading ? '—' : stats?.tonnageCollecte, unit: 't', icon: IconTruck, accent: 'primary' },
    { title: 'CO2 évité', value: loading ? '—' : stats?.co2Evite, unit: 't', icon: IconLeaf, accent: 'primary' },
    { title: 'Taux valorisation', value: loading ? '—' : (typeof stats?.tauxValorisation === 'number' ? stats.tauxValorisation : stats?.tauxValorisation), unit: typeof stats?.tauxValorisation === 'number' ? '%' : '', icon: IconChart, accent: 'slate' },
    { title: 'Employés actifs', value: loading ? '—' : (stats?.employesActifs ?? 0).toLocaleString('fr-FR'), icon: IconTeam, accent: 'amber' },
  ];

  const cards = [
    { path: '/reporting-collecte', title: 'Collecte', desc: 'Reporting tonnages et tournées de collecte', icon: IconTruck },
    { path: '/reporting-rh', title: 'RH', desc: 'Indicateurs ressources humaines et insertion', icon: IconTeam },
    { path: '/reporting-production', title: 'Production', desc: 'KPI production, tri et productivité', icon: IconChartBar },
    { path: '/refashion', title: 'Refashion', desc: 'Déclarations DPAV et subventions éco-organisme', icon: IconRecycle },
    { path: '/reporting-metropole', title: 'Métropole Rouen', desc: 'Reporting territorial pour la Métropole', icon: IconChart },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <IconChart className="w-5 h-5 text-primary" />
            </span>
            Reporting — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Indicateurs de performance, rapports et déclarations</p>
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
function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconLeaf({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3c4.667 4.667 7 8.333 7 11a5 5 0 01-10 0c0-2 .667-4 2-6m10-8c-2 4-3 7.333-3 10a5 5 0 0010 0c0-2.667-2.333-6.333-7-11z" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconTeam({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function IconChartBar({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 8v8m-4-5v5m-4-2v2m-2 4h16a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
function IconRecycle({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
}
