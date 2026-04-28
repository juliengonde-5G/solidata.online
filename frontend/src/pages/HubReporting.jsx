import { useState, useEffect } from 'react';
import { Truck, Leaf, BarChart3, Users, BarChart2, Recycle } from 'lucide-react';
import Layout from '../components/Layout';
import { KPICard, ModuleCard, PageHeader } from '../components';
import api from '../services/api';

export default function HubReporting() {
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
    { title: 'CO2 évité', value: loading ? '—' : stats?.co2Evite, unit: 't', icon: Leaf, accent: 'emerald' },
    { title: 'Taux valorisation', value: loading ? '—' : (typeof stats?.tauxValorisation === 'number' ? stats.tauxValorisation : stats?.tauxValorisation), unit: typeof stats?.tauxValorisation === 'number' ? '%' : '', icon: BarChart3, accent: 'slate' },
    { title: 'Employés actifs', value: loading ? '—' : (stats?.employesActifs ?? 0).toLocaleString('fr-FR'), icon: Users, accent: 'amber' },
  ];

  const cards = [
    { path: '/reporting-collecte', title: 'Collecte', description: 'Reporting tonnages et tournées de collecte', icon: Truck, color: 'teal' },
    { path: '/reporting-rh', title: 'RH', description: 'Indicateurs ressources humaines et insertion', icon: Users, color: 'blue' },
    { path: '/reporting-production', title: 'Production', description: 'KPI production, tri et productivité', icon: BarChart2, color: 'amber' },
    { path: '/refashion', title: 'Refashion', description: 'Déclarations DPAV et subventions éco-organisme', icon: Recycle, color: 'emerald' },
    { path: '/reporting-metropole', title: 'Métropole Rouen', description: 'Reporting territorial pour la Métropole', icon: BarChart3, color: 'purple' },
  ];

  return (
    <Layout>
      <div>
        <PageHeader
          title="Reporting"
          subtitle="Indicateurs de performance, rapports et déclarations"
          icon={BarChart3}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpis.map((kpi) => (
            <KPICard key={kpi.title} {...kpi} />
          ))}
        </div>

        <h2 className="text-lg font-bold text-slate-800 mb-4 tracking-tight">Accès rapide</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <ModuleCard key={card.path} {...card} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
