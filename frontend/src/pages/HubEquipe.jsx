import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Clock, Heart, Star, Calendar } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard } from '../components';
import api from '../services/api';

export default function HubEquipe() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [employeesRes, insertionRes] = await Promise.all([
        api.get('/employees?is_active=true').catch(() => ({ data: [] })),
        api.get('/insertion').catch(() => ({ data: [] })),
      ]);
      const employees = Array.isArray(employeesRes.data) ? employeesRes.data : (employeesRes.data?.employees || []);
      const insertions = Array.isArray(insertionRes.data) ? insertionRes.data : (insertionRes.data?.diagnostics || []);
      const activeInsertions = insertions.filter(i => i.statut === 'actif' || i.status === 'active' || !i.date_sortie);
      // Calculer la progression moyenne des parcours insertion
      let progressionMoyenne = '—';
      if (insertions.length > 0) {
        const total = insertions.reduce((sum, ins) => {
          const p = ins.progression ?? ins.progress ?? 0;
          return sum + (typeof p === 'number' ? p : 0);
        }, 0);
        progressionMoyenne = `${Math.round(total / insertions.length)}%`;
      }
      setStats({
        collaborateurs: employees.length,
        heuresMois: '—',
        parcoursActifs: activeInsertions.length || insertions.length,
        progressionInsertion: progressionMoyenne,
      });
    } catch (err) {
      console.error('Erreur chargement stats équipe:', err);
      setStats({ collaborateurs: 0, heuresMois: '—', parcoursActifs: 0, progressionInsertion: '—' });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Collaborateurs actifs', value: loading ? '—' : (stats?.collaborateurs ?? 0).toLocaleString('fr-FR'), icon: Users, accent: 'primary' },
    { title: 'Heures ce mois', value: loading ? '—' : stats?.heuresMois, icon: Clock, accent: 'slate' },
    { title: 'Parcours insertion actifs', value: loading ? '—' : (stats?.parcoursActifs ?? 0).toLocaleString('fr-FR'), icon: Heart, accent: 'primary' },
    { title: 'Progression insertion', value: loading ? '—' : stats?.progressionInsertion, icon: Star, accent: 'amber' },
  ];

  const cards = [
    { path: '/employees', title: 'Collaborateurs', desc: 'Gestion des fiches employés et contrats', icon: Users },
    { path: '/work-hours', title: 'Heures de travail', desc: 'Saisie et suivi des heures travaillées', icon: Clock },
    { path: '/skills', title: 'Compétences', desc: 'Référentiel et validation des compétences', icon: Star },
    { path: '/insertion', title: 'Parcours insertion', desc: 'Suivi des parcours d\'insertion (M1/M6/M12)', icon: Heart },
    { path: '/planning-hebdo', title: 'Planning hebdo', desc: 'Planning hebdomadaire par filière', icon: Calendar },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </span>
            Gestion Équipe — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Collaborateurs, compétences, insertion et planning</p>
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
