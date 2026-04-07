import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import api from '../services/api';
import {
  Truck, ArrowDownWideNarrow, Users, Factory, Ship, BarChart3,
  Settings, UserPlus, Package, Heart, Lock, Clock, Sparkles,
  AlertTriangle, Info, Target, ChevronRight
} from 'lucide-react';

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
    icon: UserPlus,
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
    icon: Users,
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
    icon: Truck,
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
    icon: Factory,
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
    icon: Ship,
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
    icon: BarChart3,
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
  icon: Settings,
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
  const [objectifs, setObjectifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
    if (user?.role === 'ADMIN') loadObjectifs();
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

  const loadObjectifs = async () => {
    try {
      const res = await api.get('/dashboard/objectifs');
      setObjectifs(res.data || []);
    } catch (err) {
      console.error('Erreur chargement objectifs:', err);
    }
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
      collecte: { icon: Truck, color: 'text-teal-500 bg-teal-50' },
      rh: { icon: Users, color: 'text-blue-500 bg-blue-50' },
      stock: { icon: Package, color: 'text-amber-500 bg-amber-50' },
      production: { icon: Factory, color: 'text-emerald-500 bg-emerald-50' },
      exutoires: { icon: Ship, color: 'text-purple-500 bg-purple-50' },
    };
    return icons[type] || { icon: Info, color: 'text-slate-500 bg-slate-50' };
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
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <Info className="w-5 h-5" />
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
            icon={Truck}
            color="teal"
            trend={kpis?.collecte?.trend_7j}
          />
          <KpiTile
            label="Trié ce mois"
            value={loading ? '—' : formatTonnage(kpis?.production?.kg_trie_mois)}
            unit="kg"
            icon={ArrowDownWideNarrow}
            color="emerald"
            trend={kpis?.production?.trend_7j}
          />
          <KpiTile
            label="Collaborateurs"
            value={loading ? '—' : (kpis?.rh?.employes_actifs || 0)}
            unit="actifs"
            icon={Users}
            color="blue"
            trend={null}
          />
          <KpiTile
            label="Alertes"
            value={loading ? '—' : alertes.length}
            unit=""
            icon={AlertTriangle}
            color={alertes.length > 0 ? 'amber' : 'slate'}
            trend={null}
          />
        </div>

        {/* Objectifs vs Réalisé (jauges) — ADMIN uniquement */}
        {user?.role === 'ADMIN' && objectifs.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-slate-400" />
              Objectifs vs Réalisé
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {objectifs.map((obj) => (
                <GaugeCard key={obj.id} objectif={obj} />
              ))}
            </div>
          </div>
        )}

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
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
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
              <Clock className="w-5 h-5 text-slate-400" />
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
              <Sparkles className="w-5 h-5 text-slate-400" />
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
    actions.push({ label: 'Nouvelle tournée', path: '/tours', icon: Truck });
    actions.push({ label: 'Saisir production', path: '/production', icon: Factory });
  }
  if (['ADMIN', 'RH'].includes(role)) {
    actions.push({ label: 'Candidats', path: '/candidates', icon: UserPlus });
    actions.push({ label: 'Parcours insertion', path: '/insertion', icon: Heart });
  }
  if (['ADMIN', 'MANAGER'].includes(role)) {
    actions.push({ label: 'Stock', path: '/stock', icon: Package });
    actions.push({ label: 'Commandes', path: '/exutoires-commandes', icon: Ship });
  }
  if (role === 'ADMIN') {
    actions.push({ label: 'Utilisateurs', path: '/users', icon: Lock });
    actions.push({ label: 'Configuration', path: '/settings', icon: Settings });
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
// Gauge Card — Jauge circulaire objectif vs réalisé
// ══════════════════════════════════════════

function GaugeCard({ objectif }) {
  const { indicateur, unite, periode, valeur_cible, realise, pourcentage } = objectif;
  const radius = 36;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pourcentage / 100) * circumference;

  const gaugeColor = pourcentage >= 80 ? '#10b981' : pourcentage >= 50 ? '#f59e0b' : '#ef4444';
  const periodLabel = { mensuel: 'Mois', trimestriel: 'Trim.', annuel: 'Année' }[periode] || periode;

  const fmtVal = (v) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
    return v.toLocaleString('fr-FR');
  };

  return (
    <div className="card-modern p-4 flex flex-col items-center">
      <div className="relative w-20 h-20 mb-2">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          <circle
            cx="40" cy="40" r={radius} fill="none"
            stroke={gaugeColor} strokeWidth={stroke}
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-slate-800">{pourcentage}%</span>
        </div>
      </div>
      <p className="text-xs font-medium text-slate-700 text-center leading-tight mb-1">{indicateur}</p>
      <p className="text-xs text-slate-500">
        {fmtVal(realise)} / {fmtVal(valeur_cible)} {unite}
      </p>
      <span className="mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">{periodLabel}</span>
    </div>
  );
}

