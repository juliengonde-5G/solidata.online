import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Calendar, CheckCircle, Briefcase, Brain, ClipboardList } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard } from '../components';
import api from '../services/api';

export default function HubRecrutement() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const res = await api.get('/candidates/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Erreur chargement stats recrutement:', err);
      setStats({});
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Candidats en cours', value: loading ? '—' : (stats?.en_cours ?? stats?.total_en_cours ?? 0).toLocaleString('fr-FR'), icon: UserPlus, accent: 'primary' },
    { title: 'Entretiens planifiés', value: loading ? '—' : (stats?.entretiens_planifies ?? stats?.entretiens ?? 0).toLocaleString('fr-FR'), icon: Calendar, accent: 'slate' },
    { title: 'Recrutés ce mois', value: loading ? '—' : (stats?.recrutes_mois ?? stats?.recrutes ?? 0).toLocaleString('fr-FR'), icon: CheckCircle, accent: 'primary' },
    { title: 'Postes ouverts', value: loading ? '—' : (stats?.postes_ouverts ?? 0).toLocaleString('fr-FR'), icon: Briefcase, accent: 'amber' },
  ];

  const cards = [
    { path: '/candidates', title: 'Candidats', desc: 'Kanban de suivi des candidatures et entretiens', icon: UserPlus },
    { path: '/recruitment-plan', title: 'Plan de recrutement', desc: 'Planification mensuelle des besoins par poste', icon: ClipboardList },
    { path: '/pcm', title: 'Matrice PCM', desc: 'Tests de personnalité Process Communication', icon: Brain },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-primary" />
            </span>
            Recrutement — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Suivi des candidatures, entretiens et intégrations</p>
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
