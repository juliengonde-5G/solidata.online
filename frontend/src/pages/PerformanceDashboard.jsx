import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, KPICard } from '../components';
import api from '../services/api';
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Truck, Factory, Users, TrendingUp, Target, Activity,
  BarChart3, Percent, Zap, Package,
} from 'lucide-react';

// ══════════════════════════════════════════
// PERFORMANCE DASHBOARD — Tableau de bord Performance
// Contrôleur de gestion + Contrôleur industriel
// ══════════════════════════════════════════

const COLORS = ['#0D9488', '#F59E0B', '#6366F1', '#EC4899', '#8B5CF6', '#EF4444', '#10B981', '#64748B'];
const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const HOURS = ['6h', '7h', '8h', '9h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h', '18h'];
const HOUR_RANGE = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export default function PerformanceDashboard() {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [tonnageData, setTonnageData] = useState([]);
  const [triDistrib, setTriDistrib] = useState([]);
  const [heatmap, setHeatmap] = useState(null);
  const [scorecard, setScorecard] = useState([]);
  const [industrialKpis, setIndustrialKpis] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [dashRes, tonnageRes, triRes, heatRes, scoreRes, indRes] = await Promise.all([
        api.get('/performance/dashboard').catch(() => ({ data: null })),
        api.get('/performance/tonnage-evolution').catch(() => ({ data: [] })),
        api.get('/performance/tri-distribution').catch(() => ({ data: [] })),
        api.get('/performance/activity-heatmap').catch(() => ({ data: null })),
        api.get('/performance/scorecard').catch(() => ({ data: [] })),
        api.get('/performance/industrial-kpis').catch(() => ({ data: null })),
      ]);
      setDashboard(dashRes.data);
      setTonnageData(tonnageRes.data || []);
      setTriDistrib(triRes.data || []);
      setHeatmap(heatRes.data);
      setScorecard(scoreRes.data || []);
      setIndustrialKpis(indRes.data);
    } catch (err) {
      console.error('Erreur chargement performance:', err);
    }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des indicateurs..." /></Layout>;

  const fmtKg = (v) => {
    if (!v) return '0';
    const num = parseFloat(v);
    if (num >= 1000) return `${(num / 1000).toFixed(1)}`;
    return num.toLocaleString('fr-FR');
  };

  const monthLabel = (mois) => {
    const [, m] = mois.split('-');
    const labels = ['', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    return labels[parseInt(m)] || mois;
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary-surface">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Performance</h1>
            <p className="text-slate-500 text-sm">Indicateurs de performance — contrôle de gestion</p>
          </div>
        </div>

        {/* ═══ ROW 1: KPI Cards ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard
            title="Collecté (mois)"
            value={fmtKg(dashboard?.collecte?.tonnage_mois_kg)}
            unit="t"
            icon={Truck}
            accent="primary"
            trend={dashboard?.collecte?.variation_pct != null ? {
              direction: dashboard.collecte.variation_pct >= 0 ? 'up' : 'down',
              value: Math.abs(dashboard.collecte.variation_pct),
            } : null}
          />
          <KPICard
            title="Trié (mois)"
            value={(dashboard?.production?.total_mois_t || 0).toFixed(1)}
            unit="t"
            icon={Factory}
            accent="emerald"
            trend={dashboard?.production?.variation_pct != null ? {
              direction: dashboard.production.variation_pct >= 0 ? 'up' : 'down',
              value: Math.abs(dashboard.production.variation_pct),
            } : null}
          />
          <KPICard
            title="Productivité"
            value={dashboard?.production?.productivite_avg || 0}
            unit="kg/pers/j"
            icon={Zap}
            accent="amber"
          />
          <KPICard
            title="Valorisation"
            value={`${dashboard?.valorisation_pct || 0}`}
            unit="%"
            icon={Percent}
            accent="primary"
          />
          <KPICard
            title="Collaborateurs"
            value={dashboard?.rh?.employes_actifs || 0}
            unit="actifs"
            icon={Users}
            accent="slate"
          />
          <KPICard
            title="Tours (mois)"
            value={dashboard?.collecte?.tours?.completed || 0}
            unit={`/ ${dashboard?.collecte?.tours?.total || 0}`}
            icon={Truck}
            accent="primary"
          />
        </div>

        {/* ═══ ROW 2: Evolution tonnage + Donut tri ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Evolution tonnage */}
          <div className="lg:col-span-2 card-modern p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-slate-400" />
              Évolution tonnage (6 mois)
            </h2>
            {tonnageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={tonnageData.map(d => ({
                  ...d,
                  mois: monthLabel(d.mois),
                  collecte_t: Math.round(d.collecte_kg / 100) / 10,
                  production_t: Math.round(d.production_kg / 100) / 10,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit="t" />
                  <Tooltip formatter={(v) => `${v} t`} />
                  <Legend />
                  <Area type="monotone" dataKey="collecte_t" name="Collecte" stroke="#0D9488" fill="#0D9488" fillOpacity={0.15} strokeWidth={2} />
                  <Area type="monotone" dataKey="production_t" name="Production" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune donnée disponible</p>
            )}
          </div>

          {/* Donut distribution tri */}
          <div className="card-modern p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-slate-400" />
              Répartition sorties
            </h2>
            {triDistrib.length > 0 ? (
              <div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={triDistrib}
                      dataKey="kg"
                      nameKey="categorie"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {triDistrib.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `${(v / 1000).toFixed(1)} t`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {triDistrib.slice(0, 6).map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-slate-600 truncate">{item.categorie}</span>
                      </div>
                      <span className="text-slate-800 font-medium">{item.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune donnée</p>
            )}
          </div>
        </div>

        {/* ═══ ROW 3: Heatmap + KPIs industriels ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Heatmap */}
          <div className="card-modern p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-slate-400" />
              Activité hebdomadaire
            </h2>
            {heatmap ? (
              <HeatmapGrid matrix={heatmap.matrix} />
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune donnée</p>
            )}
          </div>

          {/* KPIs industriels */}
          <div className="card-modern p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-slate-400" />
              Indicateurs industriels
            </h2>
            {industrialKpis ? (
              <div className="grid grid-cols-2 gap-4">
                <IndustrialTile label="Kg / tour" value={industrialKpis.collecte.kg_par_tour} unit="kg" />
                <IndustrialTile label="Taux complétion" value={industrialKpis.collecte.taux_completion} unit="%" />
                <IndustrialTile label="Rendement matière" value={industrialKpis.production.rendement_matiere_pct} unit="%" />
                <IndustrialTile label="Productivité" value={industrialKpis.production.productivite_kg_pers_jour} unit="kg/p/j" />
                <IndustrialTile label="Effectif moyen" value={industrialKpis.production.effectif_moyen} unit="pers" />
                <IndustrialTile label="Jours travaillés" value={industrialKpis.production.jours_travailles} unit="j" />
                <IndustrialTile label="Parcours insertion" value={industrialKpis.insertion.parcours_actifs} unit="actifs" />
                <IndustrialTile label="Parcours terminés" value={industrialKpis.insertion.parcours_termines} unit="" />
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune donnée</p>
            )}
          </div>
        </div>

        {/* ═══ ROW 4: Scorecard ═══ */}
        {scorecard.length > 0 && (
          <div className="card-modern p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-slate-400" />
              Scorecard — Objectifs vs Réalisé
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Indicateur</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Objectif</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Réalisé</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Écart</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-800">{row.indicateur}</td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {row.objectif.toLocaleString('fr-FR')} {row.unite}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800 font-medium">
                        {row.realise.toLocaleString('fr-FR')} {row.unite}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${
                        row.ecart_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {row.ecart_pct >= 0 ? '+' : ''}{row.ecart_pct}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          row.statut === 'ok' ? 'bg-emerald-50 text-emerald-700'
                            : row.statut === 'warning' ? 'bg-amber-50 text-amber-700'
                            : 'bg-red-50 text-red-700'
                        }`}>
                          {row.statut === 'ok' ? 'OK' : row.statut === 'warning' ? 'Attention' : 'Alerte'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// Heatmap Grid Component
// ══════════════════════════════════════════
function HeatmapGrid({ matrix }) {
  // Reorganize: 0=Sun → move to end, start with Mon
  const reordered = [1, 2, 3, 4, 5, 6, 0].map(d => matrix[d] || Array(24).fill(0));
  const maxVal = Math.max(1, ...reordered.flat());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[400px]">
        {/* Header */}
        <div className="flex items-center mb-1">
          <div className="w-10 flex-shrink-0" />
          {HOUR_RANGE.map(h => (
            <div key={h} className="flex-1 text-center text-[10px] text-slate-400">{h}h</div>
          ))}
        </div>
        {/* Rows */}
        {DAYS_FR.map((day, di) => (
          <div key={di} className="flex items-center gap-0.5 mb-0.5">
            <div className="w-10 text-xs text-slate-500 font-medium flex-shrink-0">{day}</div>
            {HOUR_RANGE.map(h => {
              const val = reordered[di][h] || 0;
              const intensity = maxVal > 0 ? val / maxVal : 0;
              return (
                <div
                  key={h}
                  className="flex-1 aspect-square rounded-sm flex items-center justify-center text-[9px] font-medium transition-colors"
                  style={{
                    backgroundColor: intensity > 0
                      ? `rgba(13, 148, 136, ${0.1 + intensity * 0.8})`
                      : '#f8fafc',
                    color: intensity > 0.5 ? 'white' : intensity > 0 ? '#0D9488' : '#cbd5e1',
                  }}
                  title={`${day} ${h}h : ${val} activités`}
                >
                  {val > 0 ? val : ''}
                </div>
              );
            })}
          </div>
        ))}
        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-3">
          <span className="text-[10px] text-slate-400">Moins</span>
          {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => (
            <div key={v} className="w-4 h-4 rounded-sm" style={{ backgroundColor: `rgba(13, 148, 136, ${v})` }} />
          ))}
          <span className="text-[10px] text-slate-400">Plus</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// Industrial KPI Tile
// ══════════════════════════════════════════
function IndustrialTile({ label, value, unit }) {
  return (
    <div className="bg-slate-50 rounded-card p-3.5">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold text-slate-800">{typeof value === 'number' ? value.toLocaleString('fr-FR') : value}</span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
