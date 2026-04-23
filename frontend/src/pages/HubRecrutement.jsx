import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Calendar, CheckCircle, Briefcase, Brain, ClipboardList } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard, PageHeader, Section } from '../components';
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
        <PageHeader
          title="Recrutement — Vue d'ensemble"
          subtitle="Suivi des candidatures, entretiens et intégrations"
          icon={UserPlus}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>

        <Section title="Accès rapide">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card) => (
              <NavCard key={card.path} {...card} onClick={() => navigate(card.path)} />
            ))}
          </div>
        </Section>
      </div>
    </Layout>
  );
}
