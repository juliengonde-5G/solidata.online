import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, BarChart3, Calculator, CircleDollarSign, Euro, Factory,
  Landmark, Scale, ShieldCheck, Target, TrendingDown, TrendingUp, Truck, Upload,
} from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, LoadingSpinner, Section, ModuleCard, ErrorState } from '../components';
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ══════════════════════════════════════════
// FINANCE — Synthese Dirigeant
// KPIs globaux + Alertes + Graphiques CA/Tresorerie
// ══════════════════════════════════════════

const MONTHS = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (v) => {
  if (v == null) return '—';
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
};

const fmtK = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return fmt(v);
};

const fmtPct = (v) => {
  if (v == null) return '—';
  return `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`;
};

// Écart signé (item 36) : + / - devant la magnitude formatée
const fmtSigned = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '-'}${fmtK(Math.abs(n))}`;
};

// Couleur d'un écart selon son ampleur (% du CA comptable)
const ecartColor = (pct) => {
  if (pct == null) return 'text-slate-500';
  const a = Math.abs(Number(pct));
  if (a < 2) return 'text-emerald-600';
  if (a < 10) return 'text-amber-600';
  return 'text-red-600';
};

const SUB_PAGES = [
  { path: '/pennylane', title: 'Pennylane', description: 'Synchroniser GL, transactions, balances', icon: Upload, color: 'blue' },
  { path: '/finance/operations', title: 'Donnees Operationnelles', description: 'Volumes, couts, marges par centre', icon: Calculator, color: 'emerald' },
  { path: '/finance/rentabilite', title: 'Rentabilite Matiere', description: 'Cout complet collecte / tri, PV moyen, marge par qualite', icon: TrendingUp, color: 'teal' },
  { path: '/finance/tresorerie', title: 'Tresorerie', description: 'Position, encaissements, decaissements', icon: Landmark, color: 'teal' },
  { path: '/finance/pl', title: 'Compte de Resultat', description: 'P&L par centre analytique', icon: BarChart3, color: 'amber' },
  { path: '/finance/bilan', title: 'Bilan & Ratios', description: 'Actif, passif, SIG, seuil de rentabilite', icon: Scale, color: 'purple' },
  { path: '/finance/controles', title: 'Controles', description: 'Verifications automatiques', icon: ShieldCheck, color: 'red' },
];

export default function Finance() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [kpis, setKpis] = useState(null);
  const [rappro, setRappro] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/kpis/${year}`);
      setKpis(res.data);
      setError(null);
    } catch (err) {
      console.error('Erreur chargement KPI finance:', err);
      setError('Impossible de charger les indicateurs financiers. Vérifiez votre connexion puis réessayez.');
    }
    // Rapprochement CA opérationnel vs comptable (item 36) — résilient : un
    // échec ici ne doit pas vider les KPIs dirigeant ci-dessus.
    try {
      const r = await api.get(`/finance/rapprochement-ca/${year}`);
      setRappro(r.data);
    } catch (err) {
      console.error('Erreur chargement rapprochement CA:', err);
      setRappro(null);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const alerts = kpis?.alertes || [];
  const monthlyData = kpis?.monthly || [];
  const treasuryData = kpis?.tresorerie_evolution || [];

  const budgetMonthly = kpis?.budget_monthly || [];
  const chartData = MONTHS.map((m, i) => ({
    mois: m,
    ca: monthlyData[i]?.ca || 0,
    resultat: monthlyData[i]?.resultat || 0,
    budget_ca: budgetMonthly[i]?.produits || 0,
    budget_resultat: (budgetMonthly[i]?.produits || 0) - (budgetMonthly[i]?.charges || 0),
  }));

  const treasuryChartData = MONTHS.map((m, i) => ({
    mois: m,
    solde: treasuryData[i]?.solde || 0,
  }));

  // Sources manquantes pour le rapprochement CA (item 36)
  const rapproMissing = [];
  if (rappro && !rappro.sources.gl) rapproMissing.push('Grand Livre');
  if (rappro && !rappro.sources.exutoires) rapproMissing.push('exutoires');
  if (rappro && !rappro.sources.boutiques) rapproMissing.push('boutiques');
  if (rappro && !rappro.sources.vak) rapproMissing.push('VAK');
  if (rappro && !rappro.sources.subventions) rapproMissing.push('subventions');

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Finance"
          subtitle="Synthèse dirigeant"
          icon={CircleDollarSign}
          breadcrumb={[{ label: 'Accueil', path: '/' }, { label: 'Finance' }]}
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
          <ErrorState variant="card" title="Indicateurs financiers indisponibles" message={error} onRetry={loadData} />
        )}

        {/* Alertes */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alerte, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${
                  alerte.type === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-800'
                    : alerte.type === 'warning'
                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : 'bg-blue-50 border border-blue-200 text-blue-800'
                }`}
              >
                <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${
                  alerte.type === 'error' ? 'text-red-500' : alerte.type === 'warning' ? 'text-amber-500' : 'text-blue-500'
                }`} />
                <span>{alerte.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard title="CA YTD" value={fmtK(kpis?.ca_ytd)} unit="EUR" icon={Euro} accent="emerald" loading={loading} />
          <KPICard title="Charges YTD" value={fmtK(kpis?.charges_ytd)} unit="EUR" icon={TrendingDown} accent="red" loading={loading} />
          <KPICard title="Résultat" value={fmtK(kpis?.resultat)} unit="EUR" icon={BarChart3} accent="emerald" loading={loading}
            trend={kpis?.resultat_trend ? { direction: kpis.resultat_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.resultat_trend) } : undefined}
          />
          <KPICard title="Trésorerie" value={fmtK(kpis?.tresorerie)} unit="EUR" icon={Landmark} accent="primary" loading={loading} />
          <KPICard title="BFR" value={fmtK(kpis?.bfr)} unit="EUR" icon={Calculator} accent="amber" loading={loading} />
          <KPICard title="Coût / tonne collecte" value={fmt(kpis?.cout_tonne_collecte)} unit="EUR/t" icon={Truck} accent="slate" loading={loading} />
          <KPICard title="Coût / tonne trié" value={fmt(kpis?.cout_tonne_trie)} unit="EUR/t" icon={Factory} accent="slate" loading={loading} />
          <KPICard title="Marge globale" value={fmtPct(kpis?.marge_globale)} icon={TrendingUp} accent="emerald" loading={loading}
            trend={kpis?.marge_trend ? { direction: kpis.marge_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.marge_trend) } : undefined}
          />
        </div>

        {/* Budget */}
        <Section title={`Budget ${year}`} icon={Target}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <KPICard title="Budget Produits" value={fmtK(kpis?.budget_produits_annuel)} unit="EUR" icon={Target} accent="emerald" loading={loading} />
            <KPICard title="Budget Charges" value={fmtK(kpis?.budget_charges_annuel)} unit="EUR" icon={Target} accent="red" loading={loading} />
            <KPICard title="Résultat budgété" value={fmtK(kpis?.budget_resultat_annuel)} unit="EUR" icon={Target} accent="primary" loading={loading} />
            <KPICard
              title="Écart CA vs budget YTD"
              value={fmtK(kpis?.ecart_produits_ytd)}
              unit="EUR"
              icon={kpis?.ecart_produits_ytd >= 0 ? TrendingUp : TrendingDown}
              accent={kpis?.ecart_produits_ytd >= 0 ? 'emerald' : 'red'}
              loading={loading}
            />
            <KPICard
              title="Conso. charges YTD"
              value={fmtPct(kpis?.taux_consommation_charges)}
              icon={Calculator}
              accent={kpis?.taux_consommation_charges > 105 ? 'red' : 'amber'}
              loading={loading}
            />
          </div>
        </Section>

        {/* Graphiques */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="CA réalisé vs CA budgété" icon={BarChart3} subtitle="Comparaison mensuelle (histogrammes)">
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value, name) => {
                      const labels = { ca: 'CA réalisé', budget_ca: 'CA budgété' };
                      return [fmt(value) + ' EUR', labels[name] || name];
                    }}
                    labelStyle={{ color: '#334155', fontWeight: 600 }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Legend formatter={(v) => ({ ca: 'CA réalisé', budget_ca: 'CA budgété' }[v] || v)} />
                  <Bar dataKey="ca" fill="#0d9488" radius={[4, 4, 0, 0]} name="ca" />
                  <Bar dataKey="budget_ca" fill="#94A3B8" radius={[4, 4, 0, 0]} name="budget_ca" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Section>

          <Section title="Résultat réalisé vs Résultat budgété" icon={BarChart3} subtitle="Évolution mensuelle (courbes)">
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value, name) => {
                      const labels = { resultat: 'Résultat réalisé', budget_resultat: 'Résultat budgété' };
                      return [fmt(value) + ' EUR', labels[name] || name];
                    }}
                    labelStyle={{ color: '#334155', fontWeight: 600 }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Legend formatter={(v) => ({ resultat: 'Résultat réalisé', budget_resultat: 'Résultat budgété' }[v] || v)} />
                  <Line type="monotone" dataKey="resultat" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} name="resultat" />
                  <Line type="monotone" dataKey="budget_resultat" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={false} name="budget_resultat" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Section>

          <Section title="Évolution de la trésorerie" icon={Landmark}>
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={treasuryChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value) => [fmt(value) + ' EUR', 'Solde']}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Line type="monotone" dataKey="solde" stroke="#0d9488" strokeWidth={2} fill="#ccfbf1" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Section>
        </div>

        {/* Rapprochement CA opérationnel vs comptable (item 36, Vague 1) */}
        {rappro && (
          <Section
            title="Rapprochement CA opérationnel vs comptable"
            icon={ShieldCheck}
            subtitle="Contrôle : le CA généré sur le terrain est-il bien comptabilisé ? (le P&L reste dérivé du seul Grand Livre)"
          >
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="text-left px-4 py-2 font-semibold">Activité</th>
                    <th className="text-right px-4 py-2 font-semibold">CA opérationnel (terrain)</th>
                    <th className="text-right px-4 py-2 font-semibold">CA comptable (GL)</th>
                    <th className="text-right px-4 py-2 font-semibold">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {(rappro.ventes?.activites || []).map((a) => (
                    <tr key={a.cle} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-700">{a.libelle}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtK(a.annuel)} €</td>
                      <td className="px-4 py-2 text-right text-slate-300">—</td>
                      <td className="px-4 py-2 text-right text-slate-300">—</td>
                    </tr>
                  ))}
                  <tr className="border-b border-slate-200 font-semibold bg-slate-50/60">
                    <td className="px-4 py-2">Total CA ventes</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtK(rappro.ventes?.operationnel_annuel)} €</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtK(rappro.ventes?.comptable_annuel)} € <span className="text-xs font-normal text-slate-400">(compte 70)</span></td>
                    <td className={`px-4 py-2 text-right tabular-nums font-bold ${ecartColor(rappro.ventes?.ecart_pct)}`}>
                      {fmtSigned(rappro.ventes?.ecart_annuel)} €{rappro.ventes?.ecart_pct != null ? ` (${fmtPct(rappro.ventes.ecart_pct)})` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 text-slate-700">Subventions Refashion</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtK(rappro.subventions?.operationnel_annuel)} €</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtK(rappro.subventions?.comptable_annuel)} € <span className="text-xs text-slate-400">(compte 74)</span></td>
                    <td className={`px-4 py-2 text-right tabular-nums font-bold ${ecartColor(rappro.subventions?.ecart_pct)}`}>
                      {fmtSigned(rappro.subventions?.ecart_annuel)} €{rappro.subventions?.ecart_pct != null ? ` (${fmtPct(rappro.subventions.ecart_pct)})` : ''}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-3 px-1 leading-relaxed">
              CA opérationnel = commandes exutoires clôturées (montant facturé rapproché, sinon pesée × prix) + ventes boutiques HT + ventes VAK HT.
              CA comptable = comptes 70 (ventes) et 74 (subventions) du Grand Livre Pennylane. Un écart positif signale un CA terrain non (encore) comptabilisé.
              {rapproMissing.length > 0 && (
                <span className="text-amber-600"> Sources indisponibles : {rapproMissing.join(', ')}.</span>
              )}
            </p>
          </Section>
        )}

        {/* Liens sous-pages */}
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-4 tracking-tight">Modules Finance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SUB_PAGES.map((page) => (
              <ModuleCard key={page.path} {...page} />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
