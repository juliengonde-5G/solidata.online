import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
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
    { title: 'Candidats en cours', value: loading ? '—' : (stats?.en_cours ?? stats?.total_en_cours ?? 0).toLocaleString('fr-FR'), icon: IconCandidates, accent: 'primary' },
    { title: 'Entretiens planifiés', value: loading ? '—' : (stats?.entretiens_planifies ?? stats?.entretiens ?? 0).toLocaleString('fr-FR'), icon: IconCalendar, accent: 'slate' },
    { title: 'Recrutés ce mois', value: loading ? '—' : (stats?.recrutes_mois ?? stats?.recrutes ?? 0).toLocaleString('fr-FR'), icon: IconCheck, accent: 'primary' },
    { title: 'Postes ouverts', value: loading ? '—' : (stats?.postes_ouverts ?? 0).toLocaleString('fr-FR'), icon: IconBriefcase, accent: 'amber' },
  ];

  const cards = [
    { path: '/candidates', title: 'Candidats', desc: 'Kanban de suivi des candidatures et entretiens', icon: IconCandidates },
    { path: '/pcm', title: 'Matrice PCM', desc: 'Tests de personnalité Process Communication', icon: IconBrain },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <IconCandidates className="w-5 h-5 text-primary" />
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

/* ── KPI Card ── */
function KpiCard({ title, value, icon: Icon, accent }) {
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
function IconCandidates({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function IconCalendar({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
function IconCheck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function IconBriefcase({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m8 0H8m8 0h2a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h2" /></svg>;
}
function IconBrain({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
}
