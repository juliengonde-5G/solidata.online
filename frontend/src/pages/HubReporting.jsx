import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Leaf, BarChart3, Users, BarChart2, Recycle } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard } from '../components';
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
    { title: 'Tonnage collecté (mois)', value: loading ? '—' : stats?.tonnageCollecte, unit: 't', icon: Truck, accent: 'primary' },
    { title: 'CO2 évité', value: loading ? '—' : stats?.co2Evite, unit: 't', icon: Leaf, accent: 'primary' },
    { title: 'Taux valorisation', value: loading ? '—' : (typeof stats?.tauxValorisation === 'number' ? stats.tauxValorisation : stats?.tauxValorisation), unit: typeof stats?.tauxValorisation === 'number' ? '%' : '', icon: BarChart3, accent: 'slate' },
    { title: 'Employés actifs', value: loading ? '—' : (stats?.employesActifs ?? 0).toLocaleString('fr-FR'), icon: Users, accent: 'amber' },
  ];

  const cards = [
    { path: '/reporting-collecte', title: 'Collecte', desc: 'Reporting tonnages et tournées de collecte', icon: Truck },
    { path: '/reporting-rh', title: 'RH', desc: 'Indicateurs ressources humaines et insertion', icon: Users },
    { path: '/reporting-production', title: 'Production', desc: 'KPI production, tri et productivité', icon: BarChart2 },
    { path: '/refashion', title: 'Refashion', desc: 'Déclarations DPAV et subventions éco-organisme', icon: Recycle },
    { path: '/reporting-metropole', title: 'Métropole Rouen', desc: 'Reporting territorial pour la Métropole', icon: BarChart3 },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-primary" />
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
