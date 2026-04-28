import { useState, useEffect } from 'react';
import { Lock, Database, Save, Shield, Settings, Car, ClipboardList, Brain, Map, Radio } from 'lucide-react';
import Layout from '../components/Layout';
import { KPICard, ModuleCard, PageHeader } from '../components';
import api from '../services/api';

export default function HubAdmin() {
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
    { title: 'Dernière sauvegarde', value: loading ? '—' : formatBackup(stats?.dernierBackup), icon: Save, accent: 'emerald' },
    { title: 'Traitements RGPD', value: loading ? '—' : stats?.traitementsRGPD, icon: Shield, accent: 'amber' },
  ];

  const cards = [
    { path: '/users', title: 'Utilisateurs', description: 'Gestion des comptes et rôles utilisateurs', icon: Lock, color: 'teal' },
    { path: '/vehicles', title: 'Véhicules', description: 'Parc véhicules, maintenance et contrôles', icon: Car, color: 'blue' },
    { path: '/settings', title: 'Configuration', description: 'Paramètres généraux de l\'application', icon: Settings, color: 'purple' },
    { path: '/referentiels', title: 'Référentiels', description: 'Associations, débouchés, catalogues', icon: ClipboardList, color: 'amber' },
    { path: '/admin-predictive', title: 'Moteur prédictif', description: 'Configuration du moteur IA prédictif', icon: Brain, color: 'emerald' },
    { path: '/rgpd', title: 'RGPD', description: 'Registre des traitements et conformité', icon: Shield, color: 'red' },
    { path: '/admin-cav', title: 'Gestion CAV', description: 'Administration des conteneurs d\'apport', icon: Map, color: 'teal' },
    { path: '/admin-sensors', title: 'Capteurs CAV', description: 'Sondes LoRaWAN — flotte, batterie, alertes', icon: Radio, color: 'emerald' },
    { path: '/admin-db', title: 'Base de données', description: 'Backup, restauration et maintenance BDD', icon: Database, color: 'blue' },
  ];

  return (
    <Layout>
      <div>
        <PageHeader
          title="Administration"
          subtitle="Utilisateurs, configuration, sécurité et maintenance"
          icon={Settings}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpis.map((kpi) => (
            <KPICard key={kpi.title} {...kpi} />
          ))}
        </div>

        <h2 className="text-lg font-bold text-slate-800 mb-4 tracking-tight">Modules d'administration</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <ModuleCard key={card.path} {...card} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
