import { useState, useEffect, useMemo } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Scale, Weight, Receipt, Target,
  ShoppingBag, Tag, CreditCard, Banknote, Cloud, CloudRain, Sun, CloudSnow, Zap, Wind,
  Percent, Info,
} from 'lucide-react';
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line,
  CartesianGrid, Legend, PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import Layout from '../components/Layout';
import { LoadingSpinner, KpiCard, PageHeader } from '../components';
import api from '../services/api';

function formatEuro(v, decimals = 0) {
  return `${Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} €`;
}
function formatNumber(v, decimals = 0) {
  return Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function formatDelta(pct) {
  if (pct == null || !isFinite(pct)) return null;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function DeltaBadge({ value, label }) {
  if (value == null || !isFinite(value)) return <span className="text-xs text-slate-400">—</span>;
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? 'text-green-600' : 'text-red-600'}`}>
      <Icon className="w-3 h-3" />{formatDelta(value)}
      {label && <span className="text-slate-400 ml-1">{label}</span>}
    </span>
  );
}

function weatherIcon(code) {
  if (code == null) return Cloud;
  if (code <= 1) return Sun;
  if (code <= 3) return Cloud;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80 && code <= 82) return CloudRain;
  if (code >= 95) return Zap;
  return Cloud;
}

const SEGMENT_COLORS = {
  textile_vrac: '#F97316',
  chaussures: '#A855F7',
  consommables: '#94A3B8',
  autre: '#CBD5E1',
};
const SEGMENT_LABELS = {
  textile_vrac: 'Textile (kg)',
  chaussures: 'Chaussures',
  consommables: 'Consommables',
  autre: 'Autre',
};

const PAYMENT_COLORS = {
  cb: '#0EA5E9',
  especes: '#22C55E',
  autre: '#94A3B8',
};

// Aligné sur la classification backend (services/sumup.normalizePaymentMethod +
// routes/vak.payIsEspeces/payIsCb) : le backend renvoie déjà les libellés normalisés
// 'CB' / 'Espèces' via payLabel. On reconnaît ces libellés ET les variantes brutes
// historiques (POS, VISA, Mastercard, contactless…) pour rester tolérant aux données anciennes.
function getPaymentCategory(moyen) {
  const k = (moyen || '').toLowerCase();
  if (k.includes('esp') || k.includes('cash') || k.includes('numer') || k.includes('numér') || k.includes('liquide')) return 'especes';
  if (
    k.includes('cb') || k.includes('carte') || k.includes('card') || k.includes('visa') ||
    k.includes('master') || k.includes('maestro') || k.includes('amex') || k.includes('pos') ||
    k.includes('ecom') || k.includes('contact') || k.includes('bancaire')
  ) return 'cb';
  return 'autre';
}

export default function VakPerformance() {
  const [vaks, setVaks] = useState([]);
  const [vakId, setVakId] = useState('');
  const [loading, setLoading] = useState(true);

  const [kpis, setKpis] = useState(null);
  const [hourly, setHourly] = useState({ by_hour: [], heatmap: [] });
  const [segments, setSegments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [meteo, setMeteo] = useState([]);

  useEffect(() => {
    api.get('/vak').then((r) => {
      const list = r.data || [];
      setVaks(list);
      if (list.length > 0) setVakId(String(list[0].id));
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!vakId) return;
    setLoading(true);
    Promise.all([
      api.get(`/vak/${vakId}/analytics/kpis`),
      api.get(`/vak/${vakId}/analytics/hourly`),
      api.get(`/vak/${vakId}/analytics/segments`),
      api.get(`/vak/${vakId}/analytics/payments`),
      api.get(`/vak/${vakId}/analytics/comparison`).catch(() => ({ data: null })),
      api.get(`/vak/${vakId}/meteo`).catch(() => ({ data: [] })),
    ]).then(([k, h, s, p, c, m]) => {
      setKpis(k.data);
      setHourly(h.data || { by_hour: [], heatmap: [] });
      setSegments(s.data || []);
      setPayments(p.data || []);
      setComparison(c.data);
      setMeteo(m.data || []);
    }).catch((err) => {
      console.error(err);
    }).finally(() => setLoading(false));
  }, [vakId]);

  const selectedVak = vaks.find((v) => String(v.id) === vakId);
  const objCa = Number(selectedVak?.ca_objectif_ttc || 0);
  const pctObjCa = objCa > 0 ? ((kpis?.ca_ttc || 0) / objCa) * 100 : null;

  const paymentMix = useMemo(() => {
    const acc = { cb: 0, especes: 0, autre: 0 };
    for (const p of payments) {
      const cat = getPaymentCategory(p.moyen_paiement);
      acc[cat] += Number(p.ca_ttc || 0);
    }
    return [
      { name: 'Carte bancaire', value: Math.round(acc.cb), key: 'cb' },
      { name: 'Espèces', value: Math.round(acc.especes), key: 'especes' },
      acc.autre > 0 && { name: 'Autre', value: Math.round(acc.autre), key: 'autre' },
    ].filter(Boolean);
  }, [payments]);

  if (loading && vaks.length === 0) return <Layout><LoadingSpinner size="lg" /></Layout>;

  if (vaks.length === 0) {
    return (
      <Layout>
        <div className="p-6 max-w-3xl">
          <PageHeader title="Performance VAK" icon={BarChart3} />
          <div className="bg-white rounded-card shadow-card p-8 text-center">
            <Scale className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 mb-3">Aucune session VAK enregistrée pour l'instant.</p>
            <a href="/vak/sessions"
               className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
              Créer la première VAK
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Performance d'une VAK"
          subtitle="Suivi détaillé d'un événement Vente au Kilo : KPIs, activité horaire, segments, comparaisons"
          icon={BarChart3}
          actions={
            <select value={vakId} onChange={(e) => setVakId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              {vaks.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.libelle} ({new Date(v.date_debut).toLocaleDateString('fr-FR')} → {new Date(v.date_fin).toLocaleDateString('fr-FR')})
                </option>
              ))}
            </select>
          }
        />

        {loading ? <LoadingSpinner size="lg" /> : (
          <>
            {/* Header VAK info */}
            {selectedVak && (
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-card p-5 mb-6 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedVak.libelle}</h2>
                    <p className="text-orange-100 text-sm mt-1">
                      {new Date(selectedVak.date_debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      {selectedVak.date_debut !== selectedVak.date_fin && (
                        <> → {new Date(selectedVak.date_fin).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</>
                      )}
                      <span className="ml-2 opacity-80">• {selectedVak.lieu}</span>
                    </p>
                  </div>
                  {objCa > 0 && (
                    <div className="text-right bg-white/15 px-4 py-2 rounded-lg">
                      <div className="text-xs uppercase text-orange-100">% Objectif CA</div>
                      <div className="text-3xl font-bold">{pctObjCa !== null ? `${pctObjCa.toFixed(0)}%` : '—'}</div>
                      <div className="text-xs text-orange-100">{formatEuro(kpis?.ca_ttc || 0)} / {formatEuro(objCa)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bloc 1 : KPI principaux */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <KpiCard title="CA TTC" value={formatEuro(kpis?.ca_ttc)} icon={TrendingUp} accent="primary"
                footer={comparison?.vs_previous && <DeltaBadge value={comparison.vs_previous.ca_ttc} label="vs N-1" />} />
              <KpiCard title="Poids vendu" value={`${formatNumber(kpis?.poids_kg, 1)} kg`} icon={Weight} accent="amber"
                footer={comparison?.vs_previous && <DeltaBadge value={comparison.vs_previous.poids_kg} label="vs N-1" />} />
              <KpiCard title="Prix moyen / kg" value={formatEuro(kpis?.prix_moyen_kg, 2)} icon={Tag} accent="slate" />
              <KpiCard title="Tickets" value={formatNumber(kpis?.nb_tickets)} icon={Receipt} accent="slate"
                footer={comparison?.vs_previous && <DeltaBadge value={comparison.vs_previous.nb_tickets} label="vs N-1" />} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <KpiCard title="Panier moyen" value={formatEuro(kpis?.panier_moyen, 2)} icon={Target} accent="amber"
                footer={comparison?.vs_previous && <DeltaBadge value={comparison.vs_previous.panier_moyen} label="vs N-1" />} />
              <KpiCard title="IPT (articles/ticket)" value={(kpis?.ipt || 0).toFixed(2)} icon={ShoppingBag} accent="slate" />
              <KpiCard title="Part CB" value={`${(kpis?.taux_cb_ca || 0).toFixed(0)}%`} icon={CreditCard} accent="slate"
                footer={<span className="text-xs text-slate-500">{kpis?.nb_cb || 0} tickets</span>} />
              <KpiCard title="Sacs vendus" value={formatNumber(kpis?.nb_sacs)} icon={ShoppingBag} accent="slate" />
              <KpiCard
                title="Taux d'écoulement"
                value={kpis?.taux_ecoulement != null ? `${Number(kpis.taux_ecoulement).toFixed(0)}%` : '—'}
                icon={Percent}
                accent="amber"
                footer={kpis?.kg_approvisionnes ? (
                  <span
                    className="text-xs text-slate-500 inline-flex items-center gap-1"
                    title="Taux d'écoulement = kg vendus (net des remboursements) ÷ kg approvisionnés. L'approvisionnement est saisi manuellement sur la session (onglet Sessions VAK) : aucune source stock n'est rattachée à une VAK de détail."
                  >
                    <Info className="w-3 h-3" />
                    {formatNumber(kpis.poids_kg, 0)} / {formatNumber(kpis.kg_approvisionnes, 0)} kg
                  </span>
                ) : (
                  <span
                    className="text-xs text-slate-400 inline-flex items-center gap-1"
                    title="Renseignez l'approvisionnement (kg mis en vente) sur la session VAK pour activer ce calcul."
                  >
                    <Info className="w-3 h-3" />
                    Approvisionnement non renseigné
                  </span>
                )}
              />
            </div>

            {/* Bloc 2 : activité horaire */}
            {hourly.by_hour?.length > 0 && (
              <div className="bg-white rounded-card shadow-card p-4 mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Activité par tranche horaire <span className="text-xs font-normal text-slate-400">(heure de Paris)</span></h3>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={hourly.by_hour.map((h) => ({ ...h, heure: `${h.heure}h` }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="heure" fontSize={11} />
                    <YAxis yAxisId="left" fontSize={11} tickFormatter={(v) => `${v}€`} />
                    <YAxis yAxisId="right" orientation="right" fontSize={11} tickFormatter={(v) => `${v}kg`} />
                    <Tooltip formatter={(val, name) =>
                      name === 'Poids (kg)' ? `${Number(val).toFixed(1)} kg` :
                      name === 'Tickets' ? Math.round(val) :
                      formatEuro(val, 2)
                    } />
                    <Legend />
                    <Bar yAxisId="left" dataKey="ca_ttc" fill="#F97316" name="CA (€)" />
                    <Line yAxisId="left" type="monotone" dataKey="nb_tickets" stroke="#0EA5E9" name="Tickets" dot={{ r: 3 }} />
                    <Line yAxisId="right" type="monotone" dataKey="poids_kg" stroke="#A855F7" name="Poids (kg)" strokeDasharray="4 2" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Bloc 3 : heatmap jour × heure (utile pour VAK 2-3 jours) */}
            {hourly.heatmap?.length > 0 && (
              <div className="bg-white rounded-card shadow-card p-4 mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Activité jour × heure (heatmap CA) <span className="text-xs font-normal text-slate-400">(heure de Paris)</span></h3>
                <DayHourHeatmap data={hourly.heatmap} />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Bloc 4 : segments */}
              <div className="bg-white rounded-card shadow-card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Répartition par segment</h3>
                {segments.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-8">Aucune donnée</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={segments.map((s) => ({ name: SEGMENT_LABELS[s.segment] || s.segment, value: Math.round(s.ca_ttc), key: s.segment }))}
                           dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                           label={(e) => `${e.name}: ${formatEuro(e.value)}`}>
                        {segments.map((s, i) => <Cell key={i} fill={SEGMENT_COLORS[s.segment] || '#CBD5E1'} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatEuro(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Bloc 5 : mix paiements */}
              <div className="bg-white rounded-card shadow-card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Mix moyens de paiement (CA)</h3>
                {paymentMix.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-8">Aucune donnée</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={paymentMix} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                           label={(e) => `${e.name}: ${formatEuro(e.value)}`}>
                        {paymentMix.map((p, i) => <Cell key={i} fill={PAYMENT_COLORS[p.key] || '#CBD5E1'} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatEuro(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Bloc 6 : détail moyens de paiement */}
            {payments.length > 0 && (
              <div className="bg-white rounded-card shadow-card p-4 mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Détail moyens de paiement</h3>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2">Moyen</th>
                      <th className="text-right py-2">Tickets</th>
                      <th className="text-right py-2">CA TTC</th>
                      <th className="text-right py-2">Poids</th>
                      <th className="text-right py-2">Panier moyen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2">{p.moyen_paiement || 'Inconnu'}</td>
                        <td className="py-2 text-right">{p.nb_tickets}</td>
                        <td className="py-2 text-right font-medium">{formatEuro(p.ca_ttc, 2)}</td>
                        <td className="py-2 text-right">{Number(p.poids_kg || 0).toFixed(1)} kg</td>
                        <td className="py-2 text-right">{formatEuro(p.panier_moyen, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bloc 7 : météo */}
            {meteo.length > 0 && (
              <div className="bg-white rounded-card shadow-card p-4 mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Météo des jours de VAK</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {meteo.map((m, i) => {
                    const Icon = weatherIcon(m.weather_code);
                    return (
                      <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                        <Icon className="w-10 h-10 text-sky-500" strokeWidth={1.5} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-500">{new Date(m.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
                          <div className="font-semibold text-slate-800">{m.weather_label}</div>
                          <div className="text-xs text-slate-500">
                            {m.temp_min != null && <>{Number(m.temp_min).toFixed(0)}° / </>}
                            {m.temp_max != null && <>{Number(m.temp_max).toFixed(0)}°C</>}
                            {Number(m.precipitation_mm) > 0 && <span className="text-blue-600 ml-2">{Number(m.precipitation_mm).toFixed(1)} mm</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bloc 8 : comparaison N-1 / YTD */}
            {comparison && (comparison.previous || comparison.ytd_average) && (
              <div className="bg-white rounded-card shadow-card p-4 mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Comparaison avec l'historique</h3>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2">Indicateur</th>
                      <th className="text-right py-2">Cette VAK</th>
                      {comparison.previous && (
                        <th className="text-right py-2 text-slate-400" title={comparison.previous.libelle}>
                          N-1 ({new Date(comparison.previous.date_debut).toLocaleDateString('fr-FR')})
                        </th>
                      )}
                      <th className="text-right py-2 text-slate-400">Moyenne YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['CA TTC', 'ca_ttc', (v) => formatEuro(v)],
                      ['Poids', 'poids_kg', (v) => `${Number(v).toFixed(1)} kg`],
                      ['Tickets', 'nb_tickets', (v) => Math.round(v)],
                      ['Panier moyen', 'panier_moyen', (v) => formatEuro(v, 2)],
                    ].map(([label, key, fmt]) => (
                      <tr key={key} className="border-b border-slate-100">
                        <td className="py-2 font-medium">{label}</td>
                        <td className="py-2 text-right font-semibold">{fmt(comparison.current?.[key])}</td>
                        {comparison.previous && (
                          <td className="py-2 text-right text-slate-500">
                            {fmt(comparison.previous[key])}
                            <span className="ml-2"><DeltaBadge value={comparison.vs_previous?.[key]} /></span>
                          </td>
                        )}
                        <td className="py-2 text-right text-slate-500">
                          {fmt(comparison.ytd_average?.[
                            key === 'ca_ttc' ? 'avg_ca' :
                            key === 'poids_kg' ? 'avg_poids' :
                            key === 'nb_tickets' ? 'avg_tickets' : 'avg_panier'
                          ])}
                          <span className="ml-2"><DeltaBadge value={comparison.vs_ytd?.[key]} /></span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function DayHourHeatmap({ data }) {
  // Regroupe par jour distinct + heure
  const days = Array.from(new Set(data.map((d) => d.jour))).sort();
  const hours = Array.from({ length: 13 }, (_, i) => i + 9); // 9h → 21h
  const grid = {};
  let max = 0;
  for (const cell of data) {
    const k = `${cell.jour}_${cell.heure}`;
    grid[k] = Number(cell.ca_ttc) || 0;
    if (grid[k] > max) max = grid[k];
  }
  function colorFor(n) {
    if (!n || max === 0) return '#F1F5F9';
    const intensity = Math.max(0.15, n / max);
    const r = Math.round(241 + (249 - 241) * intensity);
    const g = Math.round(245 + (115 - 245) * intensity);
    const b = Math.round(249 + (22 - 249) * intensity);
    return `rgb(${r},${g},${b})`;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left py-1 pr-2 text-slate-500 font-normal">Jour</th>
            {hours.map((h) => <th key={h} className="text-center py-1 font-normal text-slate-500 w-12">{h}h</th>)}
            <th className="text-center py-1 font-medium text-slate-600 pl-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const rowTotal = hours.reduce((s, h) => s + (grid[`${d}_${h}`] || 0), 0);
            const label = new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
            return (
              <tr key={d}>
                <td className="py-0.5 pr-2 font-medium text-slate-700 whitespace-nowrap">{label}</td>
                {hours.map((h) => {
                  const v = grid[`${d}_${h}`] || 0;
                  return (
                    <td key={h} className="p-0.5">
                      <div className="h-7 rounded flex items-center justify-center text-[10px] font-medium"
                        style={{ backgroundColor: colorFor(v), color: v > max * 0.5 ? 'white' : '#475569' }}
                        title={`${label} ${h}h : ${formatEuro(v)}`}>
                        {v ? Math.round(v) : ''}
                      </div>
                    </td>
                  );
                })}
                <td className="py-0.5 pl-2 text-right font-semibold text-slate-700 whitespace-nowrap">{formatEuro(rowTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
