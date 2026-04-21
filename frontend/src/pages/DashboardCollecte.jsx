import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Truck, TrendingUp, AlertTriangle, Clock,
  CheckCircle2, CircleDashed, Car, Wrench, FileText,
  ChevronLeft, ChevronRight, Activity,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

function shiftDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function formatHuman(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}
function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_META = {
  planned: { label: 'Planifiée', color: '#94a3b8', bg: 'bg-slate-100', text: 'text-slate-700' },
  in_progress: { label: 'En cours', color: '#f59e0b', bg: 'bg-amber-100', text: 'text-amber-700' },
  paused: { label: 'En pause', color: '#fb923c', bg: 'bg-orange-100', text: 'text-orange-700' },
  returning: { label: 'Retour', color: '#3b82f6', bg: 'bg-blue-100', text: 'text-blue-700' },
  completed: { label: 'Terminée', color: '#10b981', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  cancelled: { label: 'Annulée', color: '#ef4444', bg: 'bg-red-100', text: 'text-red-700' },
};

function KPI({ label, value, unit, icon: Icon, accent = 'slate' }) {
  const styles = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-100 text-slate-700',
  };
  return (
    <div className="card-modern p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-slate-800 tabular-nums">{value}</span>
            {unit && <span className="text-sm text-slate-400">{unit}</span>}
          </div>
        </div>
        {Icon && (
          <div className={`p-2 rounded-lg ${styles[accent] || styles.slate}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDonut({ breakdown }) {
  const total = Object.values(breakdown || {}).reduce((s, v) => s + (v || 0), 0);
  if (total === 0) {
    return (
      <div className="card-modern p-4 h-full flex items-center justify-center text-sm text-slate-400">
        Aucune tournée
      </div>
    );
  }
  // SVG donut simple
  const radius = 55;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const entries = Object.entries(breakdown).filter(([, v]) => v > 0);
  return (
    <div className="card-modern p-4">
      <p className="text-sm font-semibold text-slate-700 mb-3">Répartition statuts</p>
      <div className="flex items-center gap-4">
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="18" />
          {entries.map(([status, count]) => {
            const fraction = count / total;
            const length = fraction * circumference;
            const meta = STATUS_META[status] || STATUS_META.planned;
            const circle = (
              <circle
                key={status}
                cx="70" cy="70" r={radius} fill="none"
                stroke={meta.color} strokeWidth="18"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += length;
            return circle;
          })}
          <text x="70" y="74" textAnchor="middle" className="text-xl font-bold fill-slate-800">
            {total}
          </text>
        </svg>
        <div className="flex-1 space-y-1.5 min-w-0">
          {entries.map(([status, count]) => {
            const meta = STATUS_META[status] || STATUS_META.planned;
            return (
              <div key={status} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: meta.color }} />
                <span className="text-xs text-slate-600 flex-1">{meta.label}</span>
                <span className="text-xs font-semibold text-slate-800 tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.planned;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.bg} ${meta.text}`}>
      {meta.label}
    </span>
  );
}

function FleetHealthBar({ v }) {
  const pending = v.pending_alerts || 0;
  const color =
    v.health === 'maintenance' ? 'bg-orange-500'
    : v.health === 'alerts' ? 'bg-red-500'
    : v.health === 'contract_expiring' ? 'bg-amber-500'
    : 'bg-emerald-500';
  const label =
    v.health === 'maintenance' ? 'En maintenance'
    : v.health === 'alerts' ? `${pending} alerte${pending > 1 ? 's' : ''}`
    : v.health === 'contract_expiring' ? `Contrat J-${v.contract_days_left}`
    : 'OK';
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0 w-44">
        <Car className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-700 truncate">{v.registration}</span>
      </div>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: v.health === 'healthy' ? '100%' : v.health === 'contract_expiring' ? '60%' : '35%' }} />
      </div>
      <span className={`text-[11px] font-medium w-28 text-right ${
        v.health === 'healthy' ? 'text-emerald-700'
        : v.health === 'alerts' ? 'text-red-700'
        : v.health === 'maintenance' ? 'text-orange-700'
        : 'text-amber-700'
      }`}>{label}</span>
    </div>
  );
}

export default function DashboardCollecte() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tours/dashboard/summary', { params: { date } });
      setData(res.data);
    } catch (err) { console.error('[DashboardCollecte]', err); }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh toutes les 30 s
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading && !data) {
    return <Layout><LoadingSpinner size="lg" message="Chargement du tableau de bord…" /></Layout>;
  }

  const kpis = data?.kpis || {};
  const orders = data?.orders || [];
  const fleet = data?.fleet || [];
  const breakdown = data?.status_breakdown || {};

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header + date */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-50">
              <LayoutDashboard className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-slate-800">Tableau de bord collecte</h1>
              <p className="text-xs text-slate-500 capitalize">{formatHuman(date)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setDate(shiftDays(date, -1))}
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
              aria-label="Jour précédent">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700" />
            <button onClick={() => setDate(shiftDays(date, 1))}
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
              aria-label="Jour suivant">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
            <button onClick={() => setDate(new Date().toISOString().slice(0, 10))}
              className="ml-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50">
              Aujourd'hui
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <KPI label="Tournées actives" value={kpis.active_tours ?? 0} icon={Truck} accent="amber" />
          <KPI label="Total tournées" value={kpis.total_tours ?? 0} icon={Activity} accent="slate" />
          <KPI label="Tonnage collecté" value={kpis.total_weight_kg ?? 0} unit="kg" icon={TrendingUp} accent="emerald" />
          <KPI label="On-time rate" value={kpis.on_time_rate === null ? '—' : `${kpis.on_time_rate}%`} icon={Clock}
            accent={kpis.on_time_rate === null ? 'slate' : kpis.on_time_rate >= 85 ? 'emerald' : kpis.on_time_rate >= 70 ? 'amber' : 'red'} />
          <KPI label="Incidents ouverts" value={kpis.open_incidents ?? 0} icon={AlertTriangle}
            accent={(kpis.open_incidents || 0) > 0 ? 'red' : 'emerald'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Donut + Fleet health */}
          <div className="space-y-4">
            <StatusDonut breakdown={breakdown} />

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wrench className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">Santé flotte</h3>
                <span className="text-[11px] text-slate-400 ml-auto">{fleet.length} véhicules</span>
              </div>
              <div className="divide-y divide-slate-100 -my-1.5 max-h-[40vh] overflow-y-auto pr-1">
                {fleet.map(v => <FleetHealthBar key={v.id} v={v} />)}
                {fleet.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">Aucun véhicule</p>
                )}
              </div>
            </div>
          </div>

          {/* Liste ordres */}
          <div className="lg:col-span-2 card-modern overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Tournées du jour</h3>
              <Link to="/collections-live" className="text-[11px] text-emerald-700 hover:underline">
                Voir suivi live →
              </Link>
            </div>
            {orders.length === 0 ? (
              <div className="p-10 text-center">
                <CircleDashed className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Aucune tournée pour cette date</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-slate-500 uppercase bg-slate-50">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Véhicule</th>
                      <th className="px-3 py-2">Chauffeur</th>
                      <th className="px-3 py-2">Secteur</th>
                      <th className="px-3 py-2 text-right">Points</th>
                      <th className="px-3 py-2 text-right">Poids</th>
                      <th className="px-3 py-2">ETA / Fin</th>
                      <th className="px-3 py-2">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{o.id}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{o.registration || '—'}</p>
                          <p className="text-[11px] text-slate-400">{o.vehicle_name || ''}</p>
                        </td>
                        <td className="px-3 py-2">{o.driver_name || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2 text-slate-600">{o.route_name || (o.collection_type === 'association' ? 'Association' : 'CAV')}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {o.collected_count || 0}/{o.nb_cav || 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {o.total_weight_kg ? `${Math.round(o.total_weight_kg)} kg` : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {o.status === 'completed' ? formatTime(o.completed_at)
                            : o.eta ? (
                              <span className={o.delay_minutes ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                                {formatTime(o.eta)}
                                {o.delay_minutes ? ` (+${o.delay_minutes} min)` : ''}
                              </span>
                            ) : '—'}
                        </td>
                        <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
