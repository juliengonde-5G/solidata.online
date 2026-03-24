import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
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
      setStats({
        collaborateurs: employees.length,
        heuresMois: '—',
        parcoursActifs: activeInsertions.length || insertions.length,
        competences: '—',
      });
    } catch (err) {
      console.error('Erreur chargement stats équipe:', err);
      setStats({ collaborateurs: 0, heuresMois: '—', parcoursActifs: 0, competences: '—' });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Collaborateurs actifs', value: loading ? '—' : (stats?.collaborateurs ?? 0).toLocaleString('fr-FR'), icon: IconTeam, accent: 'primary' },
    { title: 'Heures ce mois', value: loading ? '—' : stats?.heuresMois, icon: IconClock, accent: 'slate' },
    { title: 'Parcours insertion actifs', value: loading ? '—' : (stats?.parcoursActifs ?? 0).toLocaleString('fr-FR'), icon: IconHeart, accent: 'primary' },
    { title: 'Compétences validées', value: loading ? '—' : stats?.competences, icon: IconStar, accent: 'amber' },
  ];

  const cards = [
    { path: '/employees', title: 'Collaborateurs', desc: 'Gestion des fiches employés et contrats', icon: IconTeam },
    { path: '/work-hours', title: 'Heures de travail', desc: 'Saisie et suivi des heures travaillées', icon: IconClock },
    { path: '/skills', title: 'Compétences', desc: 'Référentiel et validation des compétences', icon: IconStar },
    { path: '/insertion', title: 'Parcours insertion', desc: 'Suivi des parcours d\'insertion (M1/M6/M12)', icon: IconHeart },
    { path: '/planning-hebdo', title: 'Planning hebdo', desc: 'Planning hebdomadaire par filière', icon: IconCalendar },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <IconTeam className="w-5 h-5 text-primary" />
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
function IconTeam({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function IconClock({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function IconHeart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>;
}
function IconStar({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>;
}
function IconCalendar({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
