import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import api from '../services/api';

// ══════════════════════════════════════════
// DASHBOARD — Accueil combinée
// KPI globaux + Grille modules + Activité récente
// ══════════════════════════════════════════

const MODULE_CARDS = [
  {
    key: 'recrutement',
    title: 'Recrutement',
    description: 'Candidats, entretiens, PCM',
    path: '/hub-recrutement',
    icon: IconCandidates,
    color: 'blue',
    roles: ['ADMIN', 'RH'],
    kpiKey: 'candidats_en_cours',
    kpiLabel: 'candidats',
  },
  {
    key: 'equipe',
    title: 'Gestion Équipe',
    description: 'Collaborateurs, heures, insertion',
    path: '/hub-equipe',
    icon: IconTeam,
    color: 'emerald',
    roles: ['ADMIN', 'RH', 'MANAGER'],
    kpiKey: 'employes_actifs',
    kpiLabel: 'collaborateurs',
  },
  {
    key: 'collecte',
    title: 'Collecte',
    description: 'Tournées, CAV, GPS temps réel',
    path: '/hub-collecte',
    icon: IconTruck,
    color: 'teal',
    roles: ['ADMIN', 'MANAGER'],
    kpiKey: 'tours_aujourdhui',
    kpiLabel: 'tournées',
  },
  {
    key: 'tri',
    title: 'Tri & Production',
    description: 'Chaînes de tri, stock, expéditions',
    path: '/hub-tri-production',
    icon: IconFactory,
    color: 'amber',
    roles: ['ADMIN', 'MANAGER'],
    kpiKey: 'kg_trie_aujourdhui',
    kpiLabel: 'kg triés',
  },
  {
    key: 'exutoires',
    title: 'Logistique',
    description: 'Commandes, préparation, facturation',
    path: '/hub-exutoires',
    icon: IconShip,
    color: 'purple',
    roles: ['ADMIN', 'MANAGER'],
    kpiKey: 'commandes_en_cours',
    kpiLabel: 'commandes',
  },
  {
    key: 'reporting',
    title: 'Reporting',
    description: 'KPI collecte, production, RH',
    path: '/hub-reporting',
    icon: IconChart,
    color: 'rose',
    roles: ['ADMIN', 'MANAGER', 'RH'],
    kpiKey: null,
    kpiLabel: '',
  },
];

const ADMIN_CARD = {
  key: 'admin',
  title: 'Administration',
  description: 'Utilisateurs, config, BDD, RGPD',
  path: '/hub-admin',
  icon: IconGear,
  color: 'slate',
  roles: ['ADMIN'],
  kpiKey: null,
  kpiLabel: '',
};

const COLOR_MAP = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', icon: 'bg-blue-100' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', icon: 'bg-emerald-100' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200', icon: 'bg-teal-100' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', icon: 'bg-amber-100' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200', icon: 'bg-purple-100' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200', icon: 'bg-rose-100' },
  slate: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: 'bg-slate-100' },
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const res = await api.get('/dashboard/kpis');
      setKpis(res.data);
    } catch (err) {
      console.error('Erreur chargement dashboard:', err);
    }
    setLoading(false);
  };

  const getKpiValue = (card) => {
    if (!kpis || !card.kpiKey) return null;
    const section = {
      candidats_en_cours: kpis.rh?.candidats_en_cours,
      employes_actifs: kpis.rh?.employes_actifs,
      tours_aujourdhui: kpis.collecte?.tours_aujourdhui,
      kg_trie_aujourdhui: kpis.production?.kg_trie_aujourdhui,
      commandes_en_cours: kpis.exutoires?.commandes_en_cours,
    };
    return section[card.kpiKey] ?? null;
  };

  const allCards = [...MODULE_CARDS, ADMIN_CARD].filter(
    card => !card.roles || card.roles.includes(user?.role)
  );

  const alertes = kpis?.alertes || [];
  const activites = kpis?.activite_recente || [];

  const heureFormat = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const dateFormat = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return `Aujourd'hui ${heureFormat(dateStr)}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Hier ${heureFormat(dateStr)}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + heureFormat(dateStr);
  };

  const activityIcon = (type) => {
    const icons = {
      collecte: { icon: IconTruck, color: 'text-teal-500 bg-teal-50' },
      rh: { icon: IconTeam, color: 'text-blue-500 bg-blue-50' },
      stock: { icon: IconBox, color: 'text-amber-500 bg-amber-50' },
      production: { icon: IconFactory, color: 'text-emerald-500 bg-emerald-50' },
      exutoires: { icon: IconShip, color: 'text-purple-500 bg-purple-50' },
    };
    return icons[type] || { icon: IconInfo, color: 'text-slate-500 bg-slate-50' };
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header avec salutation */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 tracking-tight">
            Bonjour, {user?.first_name || user?.username}
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* Alertes */}
        {alertes.length > 0 && (
          <div className="space-y-2">
            {alertes.map((alerte, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-card text-sm ${
                  alerte.type === 'warning'
                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : alerte.type === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-800'
                    : 'bg-blue-50 border border-blue-200 text-blue-800'
                }`}
              >
                <span className={`flex-shrink-0 w-5 h-5 ${
                  alerte.type === 'warning' ? 'text-amber-500' : alerte.type === 'error' ? 'text-red-500' : 'text-blue-500'
                }`}>
                  {alerte.type === 'warning' || alerte.type === 'error' ? (
                    <IconAlert className="w-5 h-5" />
                  ) : (
                    <IconInfo className="w-5 h-5" />
                  )}
                </span>
                <span>{alerte.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* KPIs globaux */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiTile
            label="Collecté ce mois"
            value={loading ? '—' : formatTonnage(kpis?.collecte?.tonnage_mois)}
            unit="kg"
            icon={IconTruck}
            color="teal"
            trend={kpis?.collecte?.trend_7j}
          />
          <KpiTile
            label="Trié ce mois"
            value={loading ? '—' : formatTonnage(kpis?.production?.kg_trie_mois)}
            unit="kg"
            icon={IconSort}
            color="emerald"
            trend={kpis?.production?.trend_7j}
          />
          <KpiTile
            label="Collaborateurs"
            value={loading ? '—' : (kpis?.rh?.employes_actifs || 0)}
            unit="actifs"
            icon={IconTeam}
            color="blue"
            trend={null}
          />
          <KpiTile
            label="Alertes"
            value={loading ? '—' : alertes.length}
            unit=""
            icon={IconAlert}
            color={alertes.length > 0 ? 'amber' : 'slate'}
            trend={null}
          />
        </div>

        {/* Grille des modules */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Modules</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {allCards.map(card => {
              const colors = COLOR_MAP[card.color];
              const Icon = card.icon;
              const kpiVal = getKpiValue(card);

              return (
                <button
                  key={card.key}
                  onClick={() => navigate(card.path)}
                  className={`card-modern p-5 text-left group hover:shadow-card-hover hover:border-slate-200 transition-all border-l-4 ${colors.border}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className={`w-10 h-10 rounded-card flex items-center justify-center ${colors.icon}`}>
                      <Icon className={`w-5 h-5 ${colors.text}`} />
                    </span>
                    <svg className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-800 mb-1">{card.title}</h3>
                  <p className="text-xs text-slate-500 mb-3">{card.description}</p>
                  {kpiVal !== null && (
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-xl font-bold ${colors.text}`}>
                        {typeof kpiVal === 'number' ? kpiVal.toLocaleString('fr-FR') : kpiVal}
                      </span>
                      <span className="text-xs text-slate-400">{card.kpiLabel}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fil d'actualité + Activité récente */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activité récente */}
          <div className="card-modern p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <IconClock className="w-5 h-5 text-slate-400" />
              Activité récente
            </h2>
            {activites.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">Aucune activité récente</p>
            ) : (
              <div className="space-y-1">
                {activites.slice(0, 8).map((act, i) => {
                  const ai = activityIcon(act.type);
                  const AIcon = ai.icon;
                  return (
                    <div key={i} className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-slate-50 transition-colors">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${ai.color}`}>
                        <AIcon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 truncate">{act.message}</p>
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">{dateFormat(act.date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Raccourcis rapides */}
          <div className="card-modern p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <IconSparkles className="w-5 h-5 text-slate-400" />
              Actions rapides
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {getQuickActions(user?.role).map((action, i) => (
                <button
                  key={i}
                  onClick={() => navigate(action.path)}
                  className="flex items-center gap-3 px-4 py-3 rounded-card bg-slate-50 hover:bg-primary-surface hover:text-primary border border-slate-100 hover:border-primary/20 transition-all text-left group"
                >
                  <action.icon className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                  <span className="text-sm font-medium text-slate-700 group-hover:text-primary transition-colors">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════

function formatTonnage(val) {
  if (val === undefined || val === null) return '0';
  const num = parseFloat(val);
  if (num >= 1000) return `${(num / 1000).toFixed(1)}t`;
  return num.toLocaleString('fr-FR');
}

function getQuickActions(role) {
  const actions = [];
  if (['ADMIN', 'MANAGER'].includes(role)) {
    actions.push({ label: 'Nouvelle tournée', path: '/tours', icon: IconTruck });
    actions.push({ label: 'Saisir production', path: '/production', icon: IconFactory });
  }
  if (['ADMIN', 'RH'].includes(role)) {
    actions.push({ label: 'Candidats', path: '/candidates', icon: IconCandidates });
    actions.push({ label: 'Parcours insertion', path: '/insertion', icon: IconHeart });
  }
  if (['ADMIN', 'MANAGER'].includes(role)) {
    actions.push({ label: 'Stock', path: '/stock', icon: IconBox });
    actions.push({ label: 'Commandes', path: '/exutoires-commandes', icon: IconShip });
  }
  if (role === 'ADMIN') {
    actions.push({ label: 'Utilisateurs', path: '/users', icon: IconLock });
    actions.push({ label: 'Configuration', path: '/settings', icon: IconGear });
  }
  return actions.slice(0, 6);
}

// ══════════════════════════════════════════
// Sparkline component
// ══════════════════════════════════════════

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120, h = 28, pad = 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(' ');

  const strokeColor = {
    teal: '#0D9488', emerald: '#059669', blue: '#2563EB',
    amber: '#D97706', slate: '#64748B', red: '#DC2626',
  }[color] || '#0D9488';

  const lastVal = data[data.length - 1];
  const prevVal = data[data.length - 2];
  const isUp = lastVal >= prevVal;

  return (
    <div className="flex items-center gap-2 mt-2">
      <svg width={w} height={h} className="flex-shrink-0">
        <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      </svg>
      <span className={`text-xs font-medium ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
        {isUp ? '\u2191' : '\u2193'}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════
// KPI Tile component
// ══════════════════════════════════════════

function KpiTile({ label, value, unit, icon: Icon, color, trend }) {
  const colorStyles = {
    teal: 'bg-teal-50 text-teal-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-50 text-slate-500',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className="card-modern p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs sm:text-sm font-medium text-slate-500 leading-tight">{label}</span>
        <span className={`w-8 h-8 sm:w-9 sm:h-9 rounded-card flex items-center justify-center ${colorStyles[color]}`}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">{value}</span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
      {trend && trend.length > 1 && <Sparkline data={trend} color={color} />}
    </div>
  );
}

// ══════════════════════════════════════════
// SVG Icons
// ══════════════════════════════════════════

function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconSort({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4h16M4 8h12M4 12h8M4 16h4m4-4l4 4m0 0l4-4m-4 4V4" /></svg>;
}
function IconTeam({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>;
}
function IconFactory({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-16 0H3m2-5h4m2 0h4m-8-4h4m2 0h4" /></svg>;
}
function IconShip({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12l-2 8h18l-2-8" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconGear({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" strokeWidth={1.8} /></svg>;
}
function IconCandidates({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8m13 0a4 4 0 100-8m0 12v-2a4 4 0 00-3-3.87" /></svg>;
}
function IconBox({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
}
function IconHeart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>;
}
function IconLock({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>;
}
function IconClock({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={1.8} /><path strokeLinecap="round" strokeWidth={1.8} d="M12 6v6l4 2" /></svg>;
}
function IconSparkles({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;
}
function IconAlert({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
}
function IconInfo({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={1.8} /><path strokeLinecap="round" strokeWidth={1.8} d="M12 16v-4m0-4h.01" /></svg>;
}
