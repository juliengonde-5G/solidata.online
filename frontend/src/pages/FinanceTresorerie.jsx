import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Landmark, List, Pencil } from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, KPICard, DataTable, LoadingSpinner, Section, ErrorState } from '../components';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell, ReferenceLine,
} from 'recharts';

// ══════════════════════════════════════════
// FINANCE TRESORERIE — Suivi tresorerie
// Position, waterfall, flux par categorie
// ══════════════════════════════════════════

const MONTHS = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (v) => v != null ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '—';
const fmtK = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return fmt(v);
};

export default function FinanceTresorerie() {
  const { user } = useAuth();
  const isAdmin = (user?.base_role || user?.role) === 'ADMIN';
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [error, setError] = useState(null);
  // Saisie ADMIN du solde initial au 01/01 (priorité 1 de la cascade backend)
  const [editingSolde, setEditingSolde] = useState(false);
  const [soldeInput, setSoldeInput] = useState('');
  const [savingSolde, setSavingSolde] = useState(false);
  const [soldeError, setSoldeError] = useState(null);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/gl/${year}/tresorerie`);
      setData(res.data);
      setError(null);
    } catch (err) {
      console.error('Erreur chargement tresorerie:', err);
      setError('Impossible de charger la trésorerie. Vérifiez votre connexion puis réessayez.');
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const saveSoldeInitial = async (montant) => {
    setSavingSolde(true);
    setSoldeError(null);
    try {
      await api.put(`/finance/gl/${year}/solde-initial`, { montant });
      setEditingSolde(false);
      setSoldeInput('');
      await loadData();
    } catch (err) {
      console.error('Erreur solde initial:', err);
      setSoldeError(err.response?.data?.error || "Erreur lors de l'enregistrement du solde initial");
    }
    setSavingSolde(false);
  };

  const kpis = data?.kpis || {};
  const soldeInitial = data?.solde_initial || null;
  const waterfallData = data?.waterfall || [];
  const monthlyData = data?.monthly || [];
  const cashFlowGroups = data?.cash_flow || [];

  const monthlyChartData = MONTHS.map((m, i) => ({
    mois: m,
    encaissements: monthlyData[i]?.encaissements || 0,
    decaissements: monthlyData[i]?.decaissements || 0,
    solde: monthlyData[i]?.solde || 0,
  }));

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Tresorerie"
          subtitle="Position et flux de tresorerie"
          icon={Landmark}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Tresorerie' },
          ]}
          actions={
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          }
        />

        {error && (
          <ErrorState variant="card" title="Trésorerie indisponible" message={error} onRetry={loadData} />
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard title="Position actuelle" value={fmtK(kpis.position)} unit="EUR" icon={Landmark} accent="primary" loading={loading}
            trend={kpis.position_trend ? { direction: kpis.position_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.position_trend) } : undefined}
          />
          <KPICard title="Encaissements YTD" value={fmtK(kpis.encaissements)} unit="EUR" icon={ArrowDown} accent="emerald" loading={loading} />
          <KPICard title="Decaissements YTD" value={fmtK(kpis.decaissements)} unit="EUR" icon={ArrowUp} accent="red" loading={loading} />
          <KPICard title="Variation" value={fmtK(kpis.variation)} unit="EUR" icon={ArrowUpDown} accent="amber" loading={loading} />
        </div>

        {/* Solde initial au 01/01 — cascade honnête : saisie ADMIN > à-nouveaux 512 du GL courant > GL N-1 > 0 */}
        {!loading && soldeInitial && (
          <div className={`p-4 rounded-xl border ${
            soldeInitial.source === 'aucune'
              ? 'border-amber-200 bg-amber-50'
              : 'border-slate-200 bg-slate-50/50'
          }`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {soldeInitial.source === 'aucune' && (
                  <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className={`text-sm font-semibold ${soldeInitial.source === 'aucune' ? 'text-amber-800' : 'text-slate-800'}`}>
                    Solde initial au 01/01/{year} : {fmt(soldeInitial.montant)} EUR
                    {soldeInitial.source === 'aucune' && ' — non renseigné'}
                  </p>
                  <p className={`text-xs mt-1 ${soldeInitial.source === 'aucune' ? 'text-amber-700' : 'text-slate-500'}`}>
                    {soldeInitial.source === 'setting' && `Source : ${soldeInitial.detail || 'saisie manuelle (paramètre ADMIN)'}`}
                    {soldeInitial.source === 'gl_an' && `Source : ${soldeInitial.detail || `écritures d'à-nouveaux des comptes 512 (solde d'ouverture comptable) du Grand Livre Pennylane ${year} importé — exclues des flux mensuels pour éviter tout double comptage`}`}
                    {soldeInitial.source === 'gl_n1' && `Source : ${soldeInitial.detail || `solde des comptes 512 (banque) au 31/12/${year - 1} d'après le Grand Livre Pennylane importé`}`}
                    {soldeInitial.source === 'aucune' && `${soldeInitial.detail || `Aucun solde d'origine : la courbe part de 0, ce qui fausse le solde bancaire disponible.`} ${isAdmin ? 'Saisissez le solde réel au 1er janvier, ou importez le Grand Livre ' + (year - 1) + ' depuis la page Pennylane.' : 'Demandez à un administrateur de le saisir.'}`}
                    {' '}Le solde affiché = solde initial + flux cumulés.
                  </p>
                  {soldeError && <p className="text-xs text-red-600 mt-1">{soldeError}</p>}
                </div>
              </div>
              {isAdmin && !editingSolde && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSoldeInput(soldeInitial.source === 'setting' ? String(soldeInitial.montant) : ''); setEditingSolde(true); setSoldeError(null); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {soldeInitial.source === 'setting' ? 'Modifier' : 'Saisir le solde initial'}
                  </button>
                  {soldeInitial.source === 'setting' && (
                    <button
                      onClick={() => saveSoldeInitial(null)}
                      disabled={savingSolde}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                      title="Effacer la saisie manuelle et revenir au calcul automatique (à-nouveaux 512 du Grand Livre courant, sinon Grand Livre N-1, sinon 0)"
                    >
                      Effacer la saisie
                    </button>
                  )}
                </div>
              )}
              {isAdmin && editingSolde && (
                <form
                  onSubmit={(e) => { e.preventDefault(); saveSoldeInitial(soldeInput); }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    value={soldeInput}
                    onChange={(e) => setSoldeInput(e.target.value)}
                    placeholder={`Solde au 01/01/${year} en EUR`}
                    className="w-44 px-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={savingSolde || String(soldeInput).trim() === ''}
                    className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50"
                  >
                    {savingSolde ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingSolde(false); setSoldeError(null); }}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-100"
                  >
                    Annuler
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Graphiques */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Waterfall */}
          <Section title="Cascade de tresorerie">
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : waterfallData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-sm text-slate-400">Pas de donnees</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={waterfallData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value) => [fmt(value) + ' EUR']}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="invisible" stackId="a" fill="transparent" />
                  <Bar dataKey="value" stackId="a" radius={[4, 4, 0, 0]}>
                    {waterfallData.map((entry, index) => (
                      <Cell key={index} fill={entry.type === 'positive' ? '#10b981' : entry.type === 'negative' ? '#ef4444' : '#0d9488'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Section>

          {/* Mensuel double axe */}
          <Section title="Flux mensuels et solde">
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value, name) => [
                      fmt(value) + ' EUR',
                      name === 'encaissements' ? 'Encaissements' : name === 'decaissements' ? 'Decaissements' : 'Solde',
                    ]}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Legend formatter={(v) => v === 'encaissements' ? 'Encaissements' : v === 'decaissements' ? 'Decaissements' : 'Solde'} />
                  <ReferenceLine yAxisId="left" y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                  <Bar yAxisId="left" dataKey="encaissements" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="decaissements" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="solde" stroke="#0d9488" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Section>
        </div>

        {/* Tableau flux par categorie — séparé Revenus / Dépenses */}
        <Section title="Flux de tresorerie par categorie" icon={List} subtitle="Détail par type de revenu et type de dépense">
          {loading ? (
            <LoadingSpinner />
          ) : cashFlowGroups.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucune donnee disponible</p>
          ) : (
            <CashFlowSplitTable
              groups={cashFlowGroups}
              expandedGroups={expandedGroups}
              toggleGroup={toggleGroup}
            />
          )}
        </Section>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// Cash Flow Split — séparation Revenus / Dépenses
// ══════════════════════════════════════════

function CashFlowSplitTable({ groups, expandedGroups, toggleGroup }) {
  const revenus = groups.filter((g) => g.type === 'revenue' || g.class === '7');
  const depenses = groups.filter((g) => g.type === 'expense' || (g.class && g.class !== '7'));

  const totalsByMonth = (list) => {
    const t = Array.from({ length: 12 }, () => 0);
    list.forEach((g) => (g.months || []).forEach((v, i) => { t[i] += v || 0; }));
    return t;
  };
  const revenusTotals = totalsByMonth(revenus);
  const depensesTotals = totalsByMonth(depenses);
  const soldeTotals = revenusTotals.map((v, i) => v - (depensesTotals[i] || 0));

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[220px]">Categorie</th>
            {MONTHS.map((m) => (
              <th key={m} className="text-right px-3 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">{m}</th>
            ))}
            <th className="text-right px-4 py-3 font-semibold text-slate-800 text-xs uppercase tracking-wider bg-slate-100">Total</th>
          </tr>
        </thead>
        <tbody>
          {/* === REVENUS === */}
          <tr className="bg-emerald-50 border-y-2 border-emerald-200">
            <td colSpan={14} className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-2">
              <ArrowUp className="w-3.5 h-3.5" /> Types de revenus ({revenus.length})
            </td>
          </tr>
          {revenus.length === 0 ? (
            <tr><td colSpan={14} className="px-4 py-3 text-center text-xs text-slate-400 italic">Aucun revenu sur la période</td></tr>
          ) : revenus.map((group) => (
            <CashFlowGroup
              key={group.key}
              group={group}
              expanded={!!expandedGroups[group.key]}
              onToggle={() => toggleGroup(group.key)}
            />
          ))}
          <tr className="bg-emerald-100/60 font-bold border-y border-emerald-300">
            <td className="px-4 py-2 text-emerald-800 text-xs uppercase">Sous-total Revenus</td>
            {revenusTotals.map((v, i) => (
              <td key={i} className="text-right px-3 py-2 text-emerald-700 text-xs">{fmt(v)}</td>
            ))}
            <td className="text-right px-4 py-2 bg-emerald-200/60 text-emerald-900 text-xs">
              {fmt(revenusTotals.reduce((s, v) => s + v, 0))}
            </td>
          </tr>

          {/* === DÉPENSES === */}
          <tr className="bg-red-50 border-y-2 border-red-200">
            <td colSpan={14} className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-red-700 flex items-center gap-2">
              <ArrowDown className="w-3.5 h-3.5" /> Types de dépenses ({depenses.length})
            </td>
          </tr>
          {depenses.length === 0 ? (
            <tr><td colSpan={14} className="px-4 py-3 text-center text-xs text-slate-400 italic">Aucune dépense sur la période</td></tr>
          ) : depenses.map((group) => (
            <CashFlowGroup
              key={group.key}
              group={group}
              expanded={!!expandedGroups[group.key]}
              onToggle={() => toggleGroup(group.key)}
            />
          ))}
          <tr className="bg-red-100/60 font-bold border-y border-red-300">
            <td className="px-4 py-2 text-red-800 text-xs uppercase">Sous-total Dépenses</td>
            {depensesTotals.map((v, i) => (
              <td key={i} className="text-right px-3 py-2 text-red-700 text-xs">{fmt(v)}</td>
            ))}
            <td className="text-right px-4 py-2 bg-red-200/60 text-red-900 text-xs">
              {fmt(depensesTotals.reduce((s, v) => s + v, 0))}
            </td>
          </tr>

          {/* === SOLDE === */}
          <tr className="bg-slate-100 border-t-2 border-slate-400 font-extrabold">
            <td className="px-4 py-3 text-slate-900 text-xs uppercase tracking-wider">Solde net (Revenus − Dépenses)</td>
            {soldeTotals.map((v, i) => (
              <td key={i} className={`text-right px-3 py-3 text-xs ${v < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(v)}</td>
            ))}
            <td className={`text-right px-4 py-3 bg-slate-200 text-sm ${soldeTotals.reduce((s, v) => s + v, 0) < 0 ? 'text-red-900' : 'text-emerald-900'}`}>
              {fmt(soldeTotals.reduce((s, v) => s + v, 0))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════
// Cash Flow Group (collapsible)
// ══════════════════════════════════════════

function CashFlowGroup({ group, expanded, onToggle }) {
  const total = (group.months || []).reduce((s, v) => s + (v || 0), 0);

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 font-medium"
      >
        <td className="px-4 py-3 flex items-center gap-2">
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-800">{group.label}</span>
        </td>
        {(group.months || MONTHS.map(() => 0)).map((v, i) => (
          <td key={i} className={`text-right px-3 py-3 ${v < 0 ? 'text-red-600' : 'text-slate-700'}`}>
            {fmt(v)}
          </td>
        ))}
        <td className={`text-right px-4 py-3 font-bold bg-slate-50 ${total < 0 ? 'text-red-700' : 'text-slate-800'}`}>
          {fmt(total)}
        </td>
      </tr>
      {expanded && group.lines?.map((line, li) => {
        const lineTotal = (line.months || []).reduce((s, v) => s + (v || 0), 0);
        return (
          <tr key={li} className="border-b border-slate-50 bg-slate-50/30">
            <td className="pl-10 pr-4 py-2 text-slate-500 text-xs">{line.label}</td>
            {(line.months || MONTHS.map(() => 0)).map((v, i) => (
              <td key={i} className={`text-right px-3 py-2 text-xs ${v < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                {fmt(v)}
              </td>
            ))}
            <td className={`text-right px-4 py-2 text-xs font-medium bg-slate-50 ${lineTotal < 0 ? 'text-red-600' : 'text-slate-600'}`}>
              {fmt(lineTotal)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

