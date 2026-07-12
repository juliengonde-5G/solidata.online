import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import { PageHeader, Section } from '../components';
import api from '../services/api';
import {
  Truck, ArrowDownWideNarrow, Users, Factory, Ship, BarChart3,
  Settings, UserPlus, Package, Heart, Lock, Clock, Sparkles,
  AlertTriangle, Info, Target, ChevronRight, LayoutGrid,
  Newspaper, Pin
} from 'lucide-react';

// ══════════════════════════════════════════
// DASHBOARD — Accueil combinee
// KPI globaux + Grille modules + Activite recente
// ══════════════════════════════════════════

const MODULE_CARDS = [
  {
    key: 'recrutement',
    title: 'Recrutement',
    description: 'Candidats, entretiens, PCM',
    path: '/candidates',
    icon: UserPlus,
    color: 'blue',
    roles: ['ADMIN', 'RH'],
    kpiKey: 'candidats_en_cours',
    kpiLabel: 'candidats',
  },
  {
    key: 'equipe',
    title: 'Gestion Equipe',
    description: 'Collaborateurs, heures, insertion',
    path: '/employees',
    icon: Users,
    color: 'emerald',
    roles: ['ADMIN', 'RH', 'MANAGER'],
    kpiKey: 'employes_actifs',
    kpiLabel: 'collaborateurs',
  },
  {
    key: 'collecte',
    title: 'Collecte',
    description: 'Tournees, CAV, GPS temps reel',
    path: '/dashboard-collecte',
    icon: Truck,
    color: 'teal',
    roles: ['ADMIN', 'MANAGER'],
    kpiKey: 'tours_aujourdhui',
    kpiLabel: 'tournees',
  },
  {
    key: 'tri',
    title: 'Tri & Production',
    description: 'Chaines de tri, stock, expeditions',
    path: '/production',
    icon: Factory,
    color: 'amber',
    roles: ['ADMIN', 'MANAGER'],
    kpiKey: 'kg_trie_aujourdhui',
    kpiLabel: 'kg tries',
  },
  {
    key: 'exutoires',
    title: 'Logistique',
    description: 'Commandes, preparation, facturation',
    path: '/exutoires-commandes',
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
    path: '/performance',
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
  path: '/users',
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
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  // Item 60a — activité collecte/production par période (défaut = veille)
  const [activitePeriode, setActivitePeriode] = useState('veille');
  const [activite, setActivite] = useState(null);
  const [activiteLoading, setActiviteLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
    loadNews();
    if (user?.role === 'ADMIN') loadObjectifs();
  }, []);

  useEffect(() => {
    let alive = true;
    setActiviteLoading(true);
    api.get(`/dashboard/activite-periode?periode=${activitePeriode}`)
      .then((res) => { if (alive) setActivite(res.data); })
      .catch(() => { if (alive) setActivite(null); })
      .finally(() => { if (alive) setActiviteLoading(false); });
    return () => { alive = false; };
  }, [activitePeriode]);

  const loadNews = async () => {
    try {
      const res = await api.get('/news?limit=5');
      setNews(res.data || []);
    } catch (err) {
      console.error('Erreur chargement actualités:', err);
    }
  };

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

  const firstName = user?.first_name || user?.username || '';
  const dateComplete = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header salutation */}
        <PageHeader
          title={`Bonjour, ${firstName}`}
          subtitle={dateComplete.charAt(0).toUpperCase() + dateComplete.slice(1)}
        />

        {/* Alertes */}
        {alertes.length > 0 && (
          <div className="space-y-2">
            {alertes.map((alerte, i) => (
              <AlertBanner key={i} alerte={alerte} />
            ))}
          </div>
        )}

        {/* KPIs globaux — pleine largeur */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiTile
              label="Collecte ce mois"
              value={loading ? '-' : formatTonnage(kpis?.collecte?.tonnage_mois)}
              unit="kg"
              icon={Truck}
              color="teal"
              trend={kpis?.collecte?.trend_7j}
            />
            <KpiTile
              label="Trie ce mois"
              value={loading ? '-' : formatTonnage(kpis?.production?.kg_trie_mois)}
              unit="kg"
              icon={ArrowDownWideNarrow}
              color="emerald"
              trend={kpis?.production?.trend_7j}
            />
            <KpiTile
              label="Collaborateurs"
              value={loading ? '-' : (kpis?.rh?.employes_actifs || 0)}
              unit="actifs"
              icon={Users}
              color="blue"
              trend={null}
            />
            <KpiTile
              label="Alertes"
              value={loading ? '-' : alertes.length}
              unit=""
              icon={AlertTriangle}
              color={alertes.length > 0 ? 'amber' : 'slate'}
              trend={null}
            />
        </div>

        {/* Activité collecte/production par période — défaut = veille (item 60a) */}
        <ActivitePanel
          data={activite}
          loading={activiteLoading}
          periode={activitePeriode}
          onPeriodeChange={setActivitePeriode}
        />

        {/* Fil d'actualité — sous les indicateurs */}
        <NewsWidget items={news} onSeeAll={() => navigate('/news')} onOpen={(id) => navigate(`/news?article=${id}`)} />

        {/* Objectifs vs Realise (jauges) - ADMIN uniquement */}
        {user?.role === 'ADMIN' && objectifs.length > 0 && (
          <Section
            title="Objectifs vs Realise"
            icon={Target}
            subtitle="Performance par indicateur vs cible"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {objectifs.map((obj) => (
                <GaugeCard key={obj.id} objectif={obj} />
              ))}
            </div>
          </Section>
        )}

        {/* Grille des modules */}
        <Section
          title="Modules"
          icon={LayoutGrid}
          subtitle={`${allCards.length} modules disponibles`}
        >
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
                      <span className={`text-xl font-extrabold ${colors.text}`}>
                        {typeof kpiVal === 'number' ? kpiVal.toLocaleString('fr-FR') : kpiVal}
                      </span>
                      <span className="text-xs text-slate-400">{card.kpiLabel}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Activite recente + Actions rapides */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="Activite recente" icon={Clock} padded={false}>
            {activites.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">Aucune activite recente</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {activites.slice(0, 8).map((act, i) => {
                  const ai = activityIcon(act.type);
                  const AIcon = ai.icon;
                  return (
                    <li key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${ai.color}`}>
                        <AIcon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 truncate">{act.message}</p>
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">{dateFormat(act.date)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Actions rapides" icon={Sparkles} subtitle="Raccourcis vers les ecrans cles">
            <div className="grid grid-cols-2 gap-3">
              {getQuickActions(user?.role).map((action, i) => (
                <button
                  key={i}
                  onClick={() => navigate(action.path)}
                  className="flex items-center gap-3 px-4 py-3 rounded-card bg-slate-50 hover:bg-primary-surface hover:text-primary border border-slate-100 hover:border-primary/20 transition-all text-left group"
                >
                  <action.icon className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                  <span className="text-sm font-semibold text-slate-700 group-hover:text-primary transition-colors">{action.label}</span>
                </button>
              ))}
            </div>
          </Section>
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
    actions.push({ label: 'Nouvelle tournee', path: '/tours', icon: Truck });
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
// Activité par période — Veille / Aujourd'hui / Semaine (item 60a)
// Défaut = veille (dernier jour ouvré) car « aujourd'hui » est souvent vide le matin.
// ══════════════════════════════════════════

function ActivitePanel({ data, loading, periode, onPeriodeChange }) {
  const options = [
    { key: 'veille', label: 'Veille' },
    { key: 'jour', label: "Aujourd'hui" },
    { key: 'semaine', label: 'Semaine' },
  ];
  const c = data?.collecte || {};
  const p = data?.production || {};
  const tiles = [
    { label: 'Collecté', value: c.tonnage_kg, unit: 'kg', color: 'teal', icon: Truck },
    { label: 'Tournées', value: c.tournees_terminees != null ? `${c.tournees_terminees}/${c.nb_tournees}` : null, unit: 'terminées', color: 'blue', icon: Truck, raw: true },
    { label: 'CAV visités', value: c.cav_visites, unit: '', color: 'amber', icon: Package },
    { label: 'Trié', value: p.kg_trie, unit: 'kg', color: 'emerald', icon: Factory },
  ];

  return (
    <Section
      title="Activité"
      icon={Clock}
      subtitle={data?.label || 'Collecte & production'}
      actions={
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Choisir la période">
          {options.map((o) => (
            <button
              key={o.key}
              onClick={() => onPeriodeChange(o.key)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                periode === o.key ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
              aria-pressed={periode === o.key}
            >
              {o.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {tiles.map((t, i) => {
          const styles = {
            teal: 'bg-teal-50 text-teal-600', blue: 'bg-blue-50 text-blue-600',
            amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600',
          }[t.color];
          const valStyle = {
            teal: 'text-teal-700', blue: 'text-blue-700', amber: 'text-amber-700', emerald: 'text-emerald-700',
          }[t.color];
          const Icon = t.icon;
          // Valeurs journalières affichées en clair (séparateur de milliers) :
          // l'unité est déjà portée par le libellé (kg), donc pas de conversion
          // en tonnes ici — évite un double affichage « 1.5t kg ».
          let display = '-';
          if (!loading) {
            if (t.raw) display = t.value ?? '-';
            else display = t.value != null ? Math.round(t.value).toLocaleString('fr-FR') : '0';
          }
          return (
            <div key={i} className="card-modern p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 truncate">{t.label}</span>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${styles}`}>
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-extrabold tracking-tight ${valStyle}`}>{display}</span>
                {t.unit && <span className="text-xs font-medium text-slate-400">{t.unit}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ══════════════════════════════════════════
// Alert banner — teintes cohérentes design system
// ══════════════════════════════════════════

function AlertBanner({ alerte }) {
  const styles = {
    warning: { wrap: 'bg-amber-50 border-amber-200 text-amber-800', ico: 'text-amber-500', Icon: AlertTriangle },
    error:   { wrap: 'bg-red-50 border-red-200 text-red-800',       ico: 'text-red-500',   Icon: AlertTriangle },
    info:    { wrap: 'bg-blue-50 border-blue-200 text-blue-800',    ico: 'text-blue-500',  Icon: Info },
  };
  const s = styles[alerte.type] || styles.info;
  const Icon = s.Icon;
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-card border text-sm ${s.wrap}`}>
      <Icon className={`w-5 h-5 flex-shrink-0 ${s.ico}`} />
      <span className="font-medium">{alerte.message}</span>
    </div>
  );
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
        <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
      </svg>
      <span className={`text-xs font-semibold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
        {isUp ? '↑' : '↓'}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════
// KPI Tile — variante Dashboard avec sparkline
// ══════════════════════════════════════════

function KpiTile({ label, value, unit, icon: Icon, color, trend }) {
  const colorStyles = {
    teal: { bubble: 'bg-teal-50 text-teal-600', value: 'text-teal-700' },
    emerald: { bubble: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-700' },
    blue: { bubble: 'bg-blue-50 text-blue-600', value: 'text-blue-700' },
    amber: { bubble: 'bg-amber-50 text-amber-600', value: 'text-amber-700' },
    slate: { bubble: 'bg-slate-100 text-slate-500', value: 'text-slate-800' },
    red: { bubble: 'bg-red-50 text-red-600', value: 'text-red-700' },
  };
  const s = colorStyles[color] || colorStyles.slate;

  return (
    <div className="card-modern p-4 sm:p-5 hover:shadow-card-hover transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs sm:text-sm font-semibold text-slate-500 leading-tight truncate">{label}</span>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bubble}`}>
          <Icon className="w-5 h-5" />
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${s.value}`}>{value}</span>
        {unit && <span className="text-xs font-medium text-slate-400">{unit}</span>}
      </div>
      {trend && trend.length > 1 && <Sparkline data={trend} color={color} />}
    </div>
  );
}

// ══════════════════════════════════════════
// News Widget — fil d'actualité compact
// ══════════════════════════════════════════

function NewsWidget({ items, onSeeAll, onOpen }) {
  const fmt = (d) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "Aujourd'hui";
    const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (days === 1) return 'Hier';
    if (days < 7) return `Il y a ${days}j`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="card-modern p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Newspaper className="w-4 h-4 text-slate-400" />
          Fil d'actualité
        </span>
        <button onClick={onSeeAll} className="text-xs text-primary hover:underline">
          Voir tout
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 py-6 text-center">Aucune actualité</p>
      ) : (
        <ul className="space-y-2 overflow-y-auto max-h-64">
          {items.map((item) => (
            <li key={item.id} className="border-b border-slate-100 last:border-0 pb-2 last:pb-0">
              <button
                type="button"
                onClick={() => onOpen?.(item.id)}
                className="w-full text-left flex items-start gap-2 rounded-lg -mx-1 px-1 py-1 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none transition"
                title="Ouvrir l'article"
              >
                {item.is_pinned && <Pin className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate hover:text-primary">{item.title}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {fmt(item.created_at)}
                    {item.category && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">{item.category}</span>}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// Gauge Card — Jauge circulaire objectif vs realise
// ══════════════════════════════════════════

function GaugeCard({ objectif }) {
  const { indicateur, unite, periode, valeur_cible, realise, pourcentage } = objectif;
  const radius = 36;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pourcentage / 100) * circumference;

  const gaugeColor = pourcentage >= 80 ? '#0D9488' : pourcentage >= 50 ? '#f59e0b' : '#ef4444';
  const periodLabel = { mensuel: 'Mois', trimestriel: 'Trim.', annuel: 'Annee' }[periode] || periode;

  const fmtVal = (v) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
    return v.toLocaleString('fr-FR');
  };

  return (
    <div className="card-modern p-4 flex flex-col items-center hover:shadow-card-hover transition-shadow">
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
          <span className="text-lg font-extrabold text-slate-800">{pourcentage}%</span>
        </div>
      </div>
      <p className="text-xs font-semibold text-slate-700 text-center leading-tight mb-1">{indicateur}</p>
      <p className="text-xs text-slate-500">
        {fmtVal(realise)} / {fmtVal(valeur_cible)} {unite}
      </p>
      <span className="mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold uppercase tracking-wide">{periodLabel}</span>
    </div>
  );
}
