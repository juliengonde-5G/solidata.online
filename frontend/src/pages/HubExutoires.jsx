import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../services/api';

export default function HubExutoires() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [commandesRes, clientsRes] = await Promise.all([
        api.get('/commandes-exutoires').catch(() => ({ data: [] })),
        api.get('/clients-exutoires').catch(() => ({ data: [] })),
      ]);
      const commandes = Array.isArray(commandesRes.data) ? commandesRes.data : (commandesRes.data?.commandes || []);
      const clients = Array.isArray(clientsRes.data) ? clientsRes.data : (clientsRes.data?.clients || []);
      const enCours = commandes.filter(c => c.statut !== 'livree' && c.statut !== 'annulee' && c.statut !== 'facturee');
      const preparations = commandes.filter(c => c.statut === 'en_preparation' || c.statut === 'preparation');
      const facturesAttente = commandes.filter(c => c.statut === 'livree' || c.statut === 'a_facturer');
      const clientsActifs = clients.filter(c => c.is_active !== false && c.actif !== false);
      setStats({
        commandesEnCours: enCours.length,
        preparationsActives: preparations.length,
        facturesAttente: facturesAttente.length,
        clientsActifs: clientsActifs.length,
      });
    } catch (err) {
      console.error('Erreur chargement stats exutoires:', err);
      setStats({ commandesEnCours: 0, preparationsActives: 0, facturesAttente: 0, clientsActifs: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Commandes en cours', value: loading ? '—' : (stats?.commandesEnCours ?? 0).toLocaleString('fr-FR'), icon: IconList, accent: 'primary' },
    { title: 'Préparations actives', value: loading ? '—' : (stats?.preparationsActives ?? 0).toLocaleString('fr-FR'), icon: IconTruck, accent: 'slate' },
    { title: 'Factures en attente', value: loading ? '—' : (stats?.facturesAttente ?? 0).toLocaleString('fr-FR'), icon: IconMoney, accent: 'amber' },
    { title: 'Clients actifs', value: loading ? '—' : (stats?.clientsActifs ?? 0).toLocaleString('fr-FR'), icon: IconTeam, accent: 'primary' },
  ];

  const cards = [
    { path: '/exutoires-commandes', title: 'Commandes', desc: 'Suivi des commandes exutoires (8 statuts)', icon: IconList },
    { path: '/exutoires-preparation', title: 'Préparation', desc: 'Préparation des expéditions et colisage', icon: IconTruck },
    { path: '/exutoires-gantt', title: 'Gantt Chargement', desc: 'Planning Gantt des chargements', icon: IconChart },
    { path: '/exutoires-facturation', title: 'Facturation', desc: 'Gestion des factures exutoires', icon: IconMoney },
    { path: '/exutoires-calendrier', title: 'Calendrier', desc: 'Calendrier logistique des expéditions', icon: IconCalendar },
    { path: '/exutoires-clients', title: 'Clients', desc: 'Gestion des clients exutoires', icon: IconTeam },
    { path: '/exutoires-tarifs', title: 'Grille Tarifaire', desc: 'Tarifs et conditions par exutoire', icon: IconMoney },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <IconList className="w-5 h-5 text-primary" />
            </span>
            Logistique — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Commandes, préparation, facturation et logistique</p>
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
function IconList({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
}
function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconMoney({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function IconTeam({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconCalendar({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
