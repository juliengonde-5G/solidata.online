import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../services/api';

export default function HubCollecte() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const [toursRes, cavRes, vehiclesRes] = await Promise.all([
        api.get(`/tours?date=${today}`).catch(() => ({ data: [] })),
        api.get('/cav').catch(() => ({ data: [] })),
        api.get('/vehicles').catch(() => ({ data: [] })),
      ]);
      const tours = Array.isArray(toursRes.data) ? toursRes.data : (toursRes.data?.tours || []);
      const cavs = Array.isArray(cavRes.data) ? cavRes.data : (cavRes.data?.cavs || []);
      const vehicles = Array.isArray(vehiclesRes.data) ? vehiclesRes.data : (vehiclesRes.data?.vehicles || []);
      const vehiclesEnService = vehicles.filter(v => v.status === 'en_service' || v.status === 'active' || v.is_active);
      setStats({
        tourneesJour: tours.length,
        cavActifs: cavs.filter(c => c.is_active !== false && c.statut !== 'inactif').length || cavs.length,
        tonnageMois: '—',
        vehiculesService: vehiclesEnService.length || vehicles.length,
      });
    } catch (err) {
      console.error('Erreur chargement stats collecte:', err);
      setStats({ tourneesJour: 0, cavActifs: 0, tonnageMois: '—', vehiculesService: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Tournées aujourd\'hui', value: loading ? '—' : (stats?.tourneesJour ?? 0).toLocaleString('fr-FR'), icon: IconTruck, accent: 'primary' },
    { title: 'CAV actifs', value: loading ? '—' : (stats?.cavActifs ?? 0).toLocaleString('fr-FR'), icon: IconMap, accent: 'slate' },
    { title: 'Tonnage du mois', value: loading ? '—' : stats?.tonnageMois, icon: IconScale, accent: 'primary' },
    { title: 'Véhicules en service', value: loading ? '—' : (stats?.vehiculesService ?? 0).toLocaleString('fr-FR'), icon: IconVehicle, accent: 'amber' },
  ];

  const cards = [
    { path: '/tours', title: 'Tournées', desc: 'Planification et suivi des tournées de collecte', icon: IconTruck },
    { path: '/collection-proposals', title: 'Propositions IA', desc: 'Suggestions intelligentes de tournées optimisées', icon: IconSparkles },
    { path: '/cav-map', title: 'Carte CAV', desc: 'Localisation géographique des conteneurs', icon: IconMap },
    { path: '/fill-rate', title: 'Remplissage CAV', desc: 'Taux de remplissage et prédictions IA', icon: IconChart },
    { path: '/live-vehicles', title: 'Suivi GPS', desc: 'Position des véhicules en temps réel', icon: IconGPS },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <IconTruck className="w-5 h-5 text-primary" />
            </span>
            Collecte — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Tournées, conteneurs, véhicules et suivi GPS</p>
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
function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconMap({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>;
}
function IconScale({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>;
}
function IconVehicle({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 104 0 2 2 0 00-4 0zM3 9h2l2-4h10l2 4h2v5a1 1 0 01-1 1h-1m-14 0H4a1 1 0 01-1-1V9z" /></svg>;
}
function IconSparkles({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconGPS({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
