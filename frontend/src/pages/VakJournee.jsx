import { useState, useEffect, useMemo } from 'react';
import {
  Calendar, TrendingUp, Weight, Receipt, Tag, ShoppingBag, Target, CreditCard, Banknote,
  Cloud, CloudRain, Sun, CloudSnow, Zap,
} from 'lucide-react';
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import api from '../services/api';

function formatEuro(v, decimals = 0) {
  return `${Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} €`;
}
function formatNumber(v, decimals = 0) {
  return Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function isoDate(d) {
  if (!d) return null;
  return typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
}
function formatDayLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

const SEGMENT_LABELS = {
  textile_vrac: 'Textile (kg)',
  chaussures: 'Chaussures',
  consommables: 'Consommables',
  autre: 'Autre',
};
const SEGMENT_COLORS = {
  textile_vrac: '#F97316',
  chaussures: '#A855F7',
  consommables: '#94A3B8',
  autre: '#CBD5E1',
};

function getPaymentCategory(moyen) {
  const k = (moyen || '').toLowerCase();
  if (k.includes('espèce') || k.includes('cash')) return 'especes';
  if (k.includes('visa') || k.includes('mastercard') || k.includes('carte')) return 'cb';
  return 'autre';
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

export default function VakJournee() {
  const [vaks, setVaks] = useState([]);
  const [vakId, setVakId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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
    api.get(`/vak/${vakId}/analytics/by-day`)
      .then((r) => setData(r.data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [vakId]);

  const selectedVak = vaks.find((v) => String(v.id) === vakId);

  // Construit la liste des jours attendus de la VAK (même sans donnée)
  const expectedDays = useMemo(() => {
    if (!selectedVak) return [];
    const out = [];
    const start = new Date(selectedVak.date_debut);
    const end = new Date(selectedVak.date_fin);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(isoDate(d));
    }
    return out;
  }, [selectedVak]);

  // Indexe la donnée par jour pour le rendu
  const indexed = useMemo(() => {
    if (!data) return {};
    const byDay = {};
    for (const d of expectedDays) {
      byDay[d] = {
        date: d,
        kpis: null,
        hourly: [],
        segments: [],
        payments: { cb: 0, especes: 0, autre: 0, items: [] },
        meteo: null,
      };
    }
    for (const row of data.days || []) {
      const k = isoDate(row.jour);
      if (!byDay[k]) byDay[k] = { date: k, kpis: null, hourly: [], segments: [], payments: { cb: 0, especes: 0, autre: 0, items: [] }, meteo: null };
      byDay[k].kpis = row;
    }
    for (const row of data.hourly || []) {
      const k = isoDate(row.jour);
      if (!byDay[k]) continue;
      byDay[k].hourly.push(row);
    }
    for (const row of data.segments || []) {
      const k = isoDate(row.jour);
      if (!byDay[k]) continue;
      byDay[k].segments.push(row);
    }
    for (const row of data.payments || []) {
      const k = isoDate(row.jour);
      if (!byDay[k]) continue;
      const cat = getPaymentCategory(row.moyen_paiement);
      byDay[k].payments[cat] += Number(row.ca_ttc || 0);
      byDay[k].payments.items.push(row);
    }
    for (const row of data.meteo || []) {
      const k = isoDate(row.date);
      if (!byDay[k]) continue;
      byDay[k].meteo = row;
    }
    return byDay;
  }, [data, expectedDays]);

  if (loading && vaks.length === 0) return <Layout><LoadingSpinner size="lg" /></Layout>;
  if (vaks.length === 0) {
    return (
      <Layout>
        <div className="p-6 max-w-3xl">
          <PageHeader title="Vue par jour" icon={Calendar} />
          <div className="bg-white rounded-card shadow-card p-8 text-center">
            <p className="text-slate-600">Aucune VAK enregistrée.</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Performance jour par jour"
          subtitle="Ventilation de la VAK en cartes journalières — comparer l'activité de chaque journée d'ouverture"
          icon={Calendar}
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

        {selectedVak && (
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-card p-4 mb-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{selectedVak.libelle}</h2>
                <p className="text-orange-100 text-sm">
                  {expectedDays.length} jour{expectedDays.length > 1 ? 's' : ''} d'activité • {selectedVak.lieu}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs uppercase text-orange-100">CA VAK</div>
                  <div className="text-2xl font-bold">{formatEuro(selectedVak.ca_realise)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-orange-100">Poids</div>
                  <div className="text-2xl font-bold">{formatNumber(selectedVak.poids_realise, 1)} kg</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-orange-100">Tickets</div>
                  <div className="text-2xl font-bold">{selectedVak.nb_tickets || 0}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {loading ? <LoadingSpinner size="lg" /> : (
          <div className={`grid gap-4 ${
            expectedDays.length === 1 ? 'grid-cols-1 max-w-2xl' :
            expectedDays.length === 2 ? 'grid-cols-1 lg:grid-cols-2' :
            'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          }`}>
            {expectedDays.map((day, idx) => (
              <DayCard
                key={day}
                index={idx + 1}
                date={day}
                data={indexed[day]}
                allDays={expectedDays.map((d) => indexed[d]?.kpis).filter(Boolean)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function DayCard({ index, date, data, allDays }) {
  const k = data?.kpis;
  const hasData = k && Number(k.ca_ttc) > 0;
  const WeatherIcon = weatherIcon(data?.meteo?.weather_code);

  // Activité horaire reconstruite (tranches 9h → 21h pour cohérence visuelle)
  const hourly = useMemo(() => {
    const map = {};
    for (const h of data?.hourly || []) map[h.heure] = h;
    return Array.from({ length: 13 }, (_, i) => {
      const h = i + 9;
      const e = map[h];
      return {
        heure: `${h}h`,
        ca: Number(e?.ca_ttc || 0),
        tickets: Number(e?.nb_tickets || 0),
        poids: Number(e?.poids_kg || 0),
      };
    });
  }, [data]);

  const segmentsPie = useMemo(() => {
    return (data?.segments || []).map((s) => ({
      name: SEGMENT_LABELS[s.segment] || s.segment,
      key: s.segment,
      value: Math.round(s.ca_ttc),
    })).filter((x) => x.value > 0);
  }, [data]);

  // Part de ce jour dans le total VAK (utile pour situer)
  const totalCAVak = allDays.reduce((s, d) => s + Number(d?.ca_ttc || 0), 0);
  const totalPoidsVak = allDays.reduce((s, d) => s + Number(d?.poids_kg || 0), 0);
  const partCA = totalCAVak > 0 && k ? (Number(k.ca_ttc) / totalCAVak) * 100 : null;
  const partPoids = totalPoidsVak > 0 && k ? (Number(k.poids_kg) / totalPoidsVak) * 100 : null;

  const prixMoyenKg = (k?.poids_kg > 0) ? (k.ca_ttc / k.poids_kg) : 0;
  const ipt = (k?.nb_tickets > 0) ? (k.nb_articles / k.nb_tickets) : 0;
  const tauxCbCa = (k?.ca_ttc > 0) ? (k.ca_cb / k.ca_ttc) * 100 : 0;

  return (
    <div className="bg-white rounded-card shadow-card overflow-hidden border border-slate-100">
      {/* Header jour */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white p-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-300">Jour {index}</div>
          <div className="text-lg font-bold capitalize">{formatDayLabel(date)}</div>
        </div>
        {data?.meteo && (
          <div className="flex items-center gap-2 text-slate-200">
            <WeatherIcon className="w-7 h-7" />
            <div className="text-right">
              <div className="text-sm font-medium">{data.meteo.weather_label}</div>
              <div className="text-xs text-slate-300">
                {data.meteo.temp_min != null && <>{Number(data.meteo.temp_min).toFixed(0)}° / </>}
                {data.meteo.temp_max != null && <>{Number(data.meteo.temp_max).toFixed(0)}°</>}
                {Number(data.meteo.precipitation_mm) > 0 && <span className="ml-2 text-blue-300">{Number(data.meteo.precipitation_mm).toFixed(1)}mm</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="p-6 text-center text-slate-400 text-sm">Pas encore de ventes pour ce jour</div>
      ) : (
        <div className="p-4">
          {/* KPIs principaux */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Stat label="CA TTC" value={formatEuro(k.ca_ttc)} icon={TrendingUp} accent="text-orange-600"
              footer={partCA !== null && `${partCA.toFixed(0)}% de la VAK`} />
            <Stat label="Poids vendu" value={`${formatNumber(k.poids_kg, 1)} kg`} icon={Weight} accent="text-violet-600"
              footer={partPoids !== null && `${partPoids.toFixed(0)}% de la VAK`} />
            <Stat label="Tickets" value={formatNumber(k.nb_tickets)} icon={Receipt} accent="text-sky-600" />
            <Stat label="Panier moyen" value={formatEuro(k.panier_moyen, 2)} icon={Target} accent="text-amber-600" />
            <Stat label="Prix moyen / kg" value={formatEuro(prixMoyenKg, 2)} icon={Tag} accent="text-slate-700" />
            <Stat label="IPT" value={ipt.toFixed(2)} icon={ShoppingBag} accent="text-slate-600"
              footer="articles / ticket" />
          </div>

          {/* Bandeau premières / dernières ventes */}
          {(k.premiere_vente || k.derniere_vente) && (
            <div className="bg-slate-50 rounded-lg px-3 py-2 mb-4 text-xs text-slate-600 flex justify-between">
              <span>
                Première vente :{' '}
                <strong className="text-slate-800">
                  {k.premiere_vente ? new Date(k.premiere_vente).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </strong>
              </span>
              <span>
                Dernière vente :{' '}
                <strong className="text-slate-800">
                  {k.derniere_vente ? new Date(k.derniere_vente).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </strong>
              </span>
            </div>
          )}

          {/* Activité horaire compacte */}
          <div className="mb-4">
            <h4 className="text-xs uppercase tracking-wider text-slate-500 mb-1">Activité par heure</h4>
            <ResponsiveContainer width="100%" height={140}>
              <ComposedChart data={hourly} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="heure" fontSize={10} />
                <YAxis yAxisId="left" fontSize={10} tickFormatter={(v) => `${v}€`} width={45} />
                <YAxis yAxisId="right" orientation="right" fontSize={10} width={25} />
                <Tooltip formatter={(v, n) =>
                  n === 'Poids' ? `${Number(v).toFixed(1)} kg` :
                  n === 'Tickets' ? Math.round(v) :
                  formatEuro(v, 2)
                } />
                <Bar yAxisId="left" dataKey="ca" fill="#F97316" name="CA (€)" radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="tickets" stroke="#0EA5E9" name="Tickets" dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Segments + paiements côte à côte */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-500 mb-1">Segments</h4>
              {segmentsPie.length === 0 ? (
                <p className="text-xs text-slate-400">—</p>
              ) : (
                <ResponsiveContainer width="100%" height={120}>
                  <PieChart>
                    <Pie data={segmentsPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={45} innerRadius={20}>
                      {segmentsPie.map((s, i) => <Cell key={i} fill={SEGMENT_COLORS[s.key] || '#CBD5E1'} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatEuro(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <ul className="text-xs space-y-0.5 mt-1">
                {segmentsPie.map((s) => (
                  <li key={s.key} className="flex justify-between">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SEGMENT_COLORS[s.key] || '#CBD5E1' }} />
                      {s.name}
                    </span>
                    <strong>{formatEuro(s.value)}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-500 mb-1">Paiements</h4>
              <div className="space-y-2">
                <PaymentBar label="Carte bancaire" icon={CreditCard} amount={k.ca_cb} nb={k.nb_cb} total={k.ca_ttc} color="bg-sky-500" />
                <PaymentBar label="Espèces" icon={Banknote} amount={k.ca_especes} nb={k.nb_especes} total={k.ca_ttc} color="bg-emerald-500" />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {tauxCbCa.toFixed(0)}% de CB sur le CA
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent, footer }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
        <Icon className={`w-4 h-4 ${accent}`} />
      </div>
      <div className={`text-xl font-bold ${accent}`}>{value}</div>
      {footer && <div className="text-xs text-slate-400 mt-0.5">{footer}</div>}
    </div>
  );
}

function PaymentBar({ label, icon: Icon, amount, nb, total, color }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="flex items-center gap-1 text-slate-700">
          <Icon className="w-3 h-3" />
          {label} <span className="text-slate-400">({nb || 0})</span>
        </span>
        <strong>{formatEuro(amount, 2)}</strong>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
