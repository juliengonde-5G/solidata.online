import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Info, Crown, RefreshCw, Bell, ChevronRight, ShieldCheck } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, ErrorState } from '../components';
import api from '../services/api';

// Item 60b — icônes/teintes par catégorie d'alerte consolidée
const ALERT_CATEGORY = {
  incidents: { label: 'Incidents', tone: 'rose' },
  maintenance: { label: 'Maintenance', tone: 'amber' },
  insertion: { label: 'Insertion', tone: 'amber' },
  cav_pleins: { label: 'CAV pleins', tone: 'amber' },
  contrats: { label: 'Contrats CDDI', tone: 'sky' },
  stock: { label: 'Stock', tone: 'amber' },
};
const ALERT_TONE = {
  rose: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
};

function AlertesConsolidees({ data, loading, onNavigate }) {
  const alertes = data?.alertes || [];
  return (
    <section aria-label="Alertes consolidées" className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <header className="flex items-center gap-2 mb-3">
        <Bell className="w-5 h-5 text-slate-500" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-700">Alertes consolidées</h2>
        {alertes.length > 0 && (
          <span className="ml-1 text-xs font-bold text-white bg-rose-500 rounded-full px-2 py-0.5">{alertes.length}</span>
        )}
      </header>
      {loading ? (
        <p className="text-sm text-slate-400 py-2">Chargement des alertes…</p>
      ) : alertes.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          Aucune alerte — tout est sous contrôle.
        </div>
      ) : (
        <ul className="space-y-2">
          {alertes.map((a, i) => {
            const cat = ALERT_CATEGORY[a.categorie] || { label: a.categorie, tone: 'amber' };
            const toneClass = ALERT_TONE[cat.tone] || ALERT_TONE.amber;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => a.link && onNavigate(a.link)}
                  className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${toneClass}`}
                  title={a.details ? a.details.join(' · ') : `Voir ${cat.label}`}
                >
                  <span className="text-xs font-bold uppercase tracking-wide opacity-70 w-24 flex-shrink-0">{cat.label}</span>
                  <span className="text-sm font-medium flex-1 min-w-0">{a.message}</span>
                  <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-60" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const SEVERITE_COLORS = {
  ok: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  info: 'bg-sky-50 border-sky-200 text-sky-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  error: 'bg-rose-50 border-rose-200 text-rose-700',
  critical: 'bg-red-100 border-red-300 text-red-800',
  unavailable: 'bg-slate-50 border-slate-200 text-slate-500',
};

function formatValue(value, unite) {
  if (value == null) return '—';
  if (unite === '€') return new Intl.NumberFormat('fr-FR').format(value) + ' €';
  if (unite === 'kg' || unite === 't éq.CO2') return new Intl.NumberFormat('fr-FR').format(value) + ' ' + unite;
  if (unite === '%') return value + ' %';
  return new Intl.NumberFormat('fr-FR').format(value) + (unite ? ' ' + unite : '');
}

function VariationBadge({ pct }) {
  if (pct == null) return <span className="text-xs text-slate-400">—</span>;
  if (Math.abs(pct) < 0.1) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
      <Minus className="w-3 h-3" /> stable
    </span>
  );
  const positive = pct > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const color = positive ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50';
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-2 py-0.5 ${color}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {positive ? '+' : ''}{pct} %
      <span className="sr-only"> par rapport à l'année précédente</span>
    </span>
  );
}

function KpiCard({ kpi }) {
  const severite = kpi.alerte || 'ok';
  const colorClass = SEVERITE_COLORS[severite] || SEVERITE_COLORS.ok;

  return (
    <article className={`rounded-xl border p-5 transition-shadow hover:shadow-md ${colorClass}`}>
      <header className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-slate-700 leading-tight">{kpi.label}</h3>
        {severite === 'critical' || severite === 'error' ? (
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" aria-label="Seuil critique dépassé" />
        ) : severite === 'warning' ? (
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" aria-label="Seuil d'alerte dépassé" />
        ) : severite === 'unavailable' ? (
          <Info className="w-4 h-4 text-slate-400 flex-shrink-0" aria-label="Indicateur non disponible" />
        ) : null}
      </header>
      <div className="text-3xl font-bold text-slate-800 mb-2 tracking-tight">
        {formatValue(kpi.value, kpi.unite)}
      </div>
      <footer className="flex items-center justify-between text-xs">
        <VariationBadge pct={kpi.variation_pct} />
        {kpi.previous != null && (
          <span className="text-slate-500">N-1 : {formatValue(kpi.previous, kpi.unite)}</span>
        )}
      </footer>
      {kpi.context?.reason && (
        <p className="mt-2 text-xs text-slate-500 italic">{kpi.context.reason}</p>
      )}
      {kpi.context?.positives != null && (
        <p className="mt-2 text-xs text-slate-500">
          {kpi.context.positives} sortie{kpi.context.positives > 1 ? 's' : ''} positive{kpi.context.positives > 1 ? 's' : ''} sur {kpi.context.total}
        </p>
      )}
    </article>
  );
}

export default function DashboardExecutif() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [alertes, setAlertes] = useState(null);
  const [alertesLoading, setAlertesLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/dashboard/executive');
      setData(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadAlertes = useCallback(async () => {
    setAlertesLoading(true);
    try {
      const res = await api.get('/dashboard/alertes');
      setAlertes(res.data);
    } catch {
      setAlertes(null);
    } finally {
      setAlertesLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadAlertes(); }, [load, loadAlertes]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
    loadAlertes();
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement du tableau de bord exécutif..." /></Layout>;

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Tableau de bord exécutif"
          subtitle="Pilotage stratégique 1 page — 8 KPI essentiels avec comparaison N-1"
          icon={Crown}
          actions={
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-secondary text-sm inline-flex items-center gap-2"
              aria-label="Rafraîchir les données"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {refreshing ? 'Mise à jour…' : 'Rafraîchir'}
            </button>
          }
        />

        {data?.asOf && (
          <p className="text-xs text-slate-500 mb-4">
            Données arrêtées au {new Date(data.asOf).toLocaleString('fr-FR')}
            {' · '}cache 5 min
          </p>
        )}

        {/* Alertes consolidées — véhicules, jalons, stock, incidents (item 60b) */}
        <AlertesConsolidees data={alertes} loading={alertesLoading} onNavigate={navigate} />

        {error ? (
          <ErrorState
            title="Impossible de charger le tableau de bord"
            message="Vérifiez votre connexion et réessayez."
            onRetry={load}
            variant="card"
          />
        ) : (
          <section
            aria-label="Indicateurs clés de pilotage"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {data?.kpis?.map((kpi) => <KpiCard key={kpi.id} kpi={kpi} />)}
          </section>
        )}

        {data && (
          <footer className="mt-8 text-xs text-slate-500 border-t border-slate-200 pt-4">
            <p className="mb-1">
              <strong>Comparaison N-1</strong> calculée sur la même période (du 1er du mois au jour J de l'année précédente).
            </p>
            <p>
              <strong>Seuils d'alerte</strong> configurables dans <a href="/admin-alert-thresholds" className="text-primary underline">Administration → Seuils d'alerte</a>.
              Trésorerie nécessite la sync Pennylane (cf. runbook infra §8).
            </p>
          </footer>
        )}
      </div>
    </Layout>
  );
}
