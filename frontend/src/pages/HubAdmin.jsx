import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Database, Save, Shield, Settings, Car, ClipboardList, Brain, Map } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard } from '../components';
import api from '../services/api';

export default function HubAdmin() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [usersRes, dbStatsRes] = await Promise.all([
        api.get('/users').catch(() => ({ data: [] })),
        api.get('/admin-db/stats').catch(() => ({ data: null })),
      ]);
      const users = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.users || []);
      const activeUsers = users.filter(u => u.is_active !== false);
      const dbStats = dbStatsRes.data;
      setStats({
        utilisateursActifs: activeUsers.length,
        tablesBDD: dbStats?.tables_count ?? dbStats?.nb_tables ?? '—',
        dernierBackup: dbStats?.last_backup ?? dbStats?.dernier_backup ?? '—',
        traitementsRGPD: dbStats?.rgpd_count ?? '—',
      });
    } catch (err) {
      console.error('Erreur chargement stats admin:', err);
      setStats({ utilisateursActifs: 0, tablesBDD: '—', dernierBackup: '—', traitementsRGPD: '—' });
    }
    setLoading(false);
  };

  const formatBackup = (val) => {
    if (!val || val === '—') return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return val;
    }
  };

  const kpis = [
    { title: 'Utilisateurs actifs', value: loading ? '—' : (stats?.utilisateursActifs ?? 0).toLocaleString('fr-FR'), icon: Lock, accent: 'primary' },
    { title: 'Tables BDD', value: loading ? '—' : stats?.tablesBDD, icon: Database, accent: 'slate' },
    { title: 'Dernière sauvegarde', value: loading ? '—' : formatBackup(stats?.dernierBackup), icon: Save, accent: 'primary' },
    { title: 'Traitements RGPD', value: loading ? '—' : stats?.traitementsRGPD, icon: Shield, accent: 'amber' },
  ];

  const cards = [
    { path: '/users', title: 'Utilisateurs', desc: 'Gestion des comptes et rôles utilisateurs', icon: Lock },
    { path: '/vehicles', title: 'Véhicules', desc: 'Parc véhicules, maintenance et contrôles', icon: Car },
    { path: '/settings', title: 'Configuration', desc: 'Paramètres généraux de l\'application', icon: Settings },
    { path: '/referentiels', title: 'Référentiels', desc: 'Associations, débouchés, catalogues', icon: ClipboardList },
    { path: '/admin-predictive', title: 'Moteur prédictif', desc: 'Configuration du moteur IA prédictif', icon: Brain },
    { path: '/rgpd', title: 'RGPD', desc: 'Registre des traitements et conformité', icon: Shield },
    { path: '/admin-cav', title: 'Gestion CAV', desc: 'Administration des conteneurs d\'apport', icon: Map },
    { path: '/admin-db', title: 'Base de données', desc: 'Backup, restauration et maintenance BDD', icon: Database },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <Settings className="w-5 h-5 text-primary" />
            </span>
            Administration — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Utilisateurs, configuration, sécurité et maintenance</p>
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
