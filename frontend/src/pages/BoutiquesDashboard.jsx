import { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Cloud, CloudRain, Sun, CloudSnow, Zap, TrendingUp, TrendingDown, ShoppingBag, Target, Receipt, Tag, Timer, Percent } from 'lucide-react';
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell, ReferenceLine } from 'recharts';
import Layout from '../components/Layout';
import { LoadingSpinner, KpiCard } from '../components';
import api from '../services/api';

function formatEuro(v, decimals = 0) {
  return `${Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} €`;
}

function formatDelta(pct) {
  if (pct == null || !isFinite(pct)) return null;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function DeltaBadge({ value }) {
  if (value == null || !isFinite(value)) return <span className="text-xs text-slate-400">—</span>;
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? 'text-green-600' : 'text-red-600'}`}>
      <Icon className="w-3 h-3" />{formatDelta(value)}
    </span>
  );
}

const SEGMENT_COLORS = { ventes_courantes: '#2D8C4E', promotions: '#F59E0B', consommables: '#94A3B8' };
const SEGMENT_LABELS = { ventes_courantes: 'Ventes courantes', promotions: 'Promotions', consommables: 'Consommables' };
const MOIS_COURT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

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

export default function BoutiquesDashboard() {
  const [boutiques, setBoutiques] = useState([]);
  const [boutiqueId, setBoutiqueId] = useState('');
  const [tab, setTab] = useState('jour');
  const [loading, setLoading] = useState(true);

  // Jour
  const [dayDate, setDayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dayVentes, setDayVentes] = useState(null);
  const [dayMeteo, setDayMeteo] = useState(null);
  const [dayRayons, setDayRayons] = useState([]);
  const [dayTickets, setDayTickets] = useState([]);
  const [dayKpis, setDayKpis] = useState(null);
  const [dayEvolution, setDayEvolution] = useState(null);
  const [dayMeteoHourly, setDayMeteoHourly] = useState([]);

  // Mois
  const [mois, setMois] = useState(new Date().getMonth() + 1);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [monthData, setMonthData] = useState(null);
  const [monthMeteo, setMonthMeteo] = useState([]);
  const [monthKpis, setMonthKpis] = useState(null);
  const [monthHourly, setMonthHourly] = useState(null);
  const [monthEvolution, setMonthEvolution] = useState(null);

  // Annee
  const [yearData, setYearData] = useState(null);
  const [yearBudget, setYearBudget] = useState(null);

  useEffect(() => {
    api.get('/boutiques?active=true').then(res => {
      setBoutiques(res.data || []);
      if (res.data?.length > 0) setBoutiqueId(String(res.data[0].id));
    });
  }, []);

  useEffect(() => {
    if (!boutiqueId) return;
    if (tab === 'jour') loadDay();
    if (tab === 'mois') loadMonth();
    if (tab === 'annee') loadYear();
  }, [boutiqueId, tab, dayDate, mois, annee]);

  async function loadDay() {
    setLoading(true);
    try {
      const [v, m, r, t, k, e, mh] = await Promise.all([
        api.get(`/boutique-ventes/analytics/daily?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-meteo?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-ventes/analytics/rayons?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-ventes/tickets?boutique_id=${boutiqueId}&date=${dayDate}`),
        api.get(`/boutique-ventes/analytics/kpis?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-ventes/analytics/evolution?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-meteo/hourly?boutique_id=${boutiqueId}&date=${dayDate}`).catch(() => ({ data: { points: [] } })),
      ]);
      setDayVentes(v.data?.[0] || { ca_ttc: 0, nb_tickets: 0, nb_articles: 0 });
      setDayMeteo(m.data?.[0] || null);
      setDayRayons(r.data || []);
      setDayTickets(t.data || []);
      setDayKpis(k.data || null);
      setDayEvolution(e.data || null);
      setDayMeteoHourly(mh.data?.points || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadMonth() {
    setLoading(true);
    try {
      const dateFrom = `${annee}-${String(mois).padStart(2, '0')}-01`;
      const lastDay = new Date(annee, mois, 0).getDate();
      const dateTo = `${annee}-${String(mois).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const [daily, segments, top, compare, meteo, kpis, hourly, evolution] = await Promise.all([
        api.get(`/boutique-ventes/analytics/daily?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
        api.get(`/boutique-ventes/analytics/segments?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
        api.get(`/boutique-ventes/analytics/articles?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}&limit=10`),
        api.get(`/boutique-objectifs/compare?boutique_id=${boutiqueId}&annee=${annee}`),
        api.get(`/boutique-meteo?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
        api.get(`/boutique-ventes/analytics/kpis?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
        api.get(`/boutique-ventes/analytics/hourly?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
        api.get(`/boutique-ventes/analytics/evolution?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
      ]);

      const objectif = compare.data.objectifs.find(o => o.mois === mois && o.segment === 'global');
      const realise = compare.data.ventes_global.find(v => v.mois === mois);

      setMonthData({
        daily: daily.data || [],
        segments: segments.data || [],
        top: top.data || [],
        objectif,
        realise,
      });
      setMonthMeteo(meteo.data || []);
      setMonthKpis(kpis.data || null);
      setMonthHourly(hourly.data || null);
      setMonthEvolution(evolution.data || null);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function loadYear() {
    setLoading(true);
    try {
      const [budget, monthly] = await Promise.all([
        api.get(`/boutiques/${boutiqueId}/budget?annee=${annee}`),
        api.get(`/boutique-ventes/analytics/monthly?boutique_id=${boutiqueId}&annee=${annee}`),
      ]);
      setYearBudget(budget.data);
      setYearData(monthly.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const selectedBoutique = boutiques.find(b => String(b.id) === boutiqueId);

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <LayoutDashboard className="w-6 h-6 text-pink-600" />
              Tableau de bord boutique
            </h1>
            <p className="text-slate-500 mt-1 text-sm">Pilotage quotidien, mensuel et annuel</p>
          </div>
          <select value={boutiqueId} onChange={(e) => setBoutiqueId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {boutiques.map(b => <option key={b.id} value={b.id}>{b.nom}</option>)}
          </select>
        </div>

        <div className="flex gap-2 mb-6 border-b border-slate-200">
          {[['jour', 'Jour'], ['mois', 'Mois'], ['annee', 'Année']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                tab === k ? 'border-pink-500 text-pink-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? <LoadingSpinner size="lg" /> : (
          <>
            {tab === 'jour' && <DayView date={dayDate} setDate={setDayDate} ventes={dayVentes} meteo={dayMeteo} rayons={dayRayons} tickets={dayTickets} kpis={dayKpis} evolution={dayEvolution} meteoHourly={dayMeteoHourly} />}
            {tab === 'mois' && <MonthView mois={mois} annee={annee} setMois={setMois} setAnnee={setAnnee} data={monthData} meteo={monthMeteo} kpis={monthKpis} hourly={monthHourly} evolution={monthEvolution} />}
            {tab === 'annee' && <YearView annee={annee} setAnnee={setAnnee} data={yearData} budget={yearBudget} boutique={selectedBoutique} />}
          </>
        )}
      </div>
    </Layout>
  );
}

function DayView({ date, setDate, ventes, meteo, rayons, tickets, kpis, evolution, meteoHourly }) {
  const WeatherIcon = weatherIcon(meteo?.weather_code);
  const v = evolution?.variations || {};

  // Activité par tranche horaire : CA de la tranche + cumul CA + météo
  // 14 tranches : 8h → 21h (ouverture boutique)
  const hourly = useMemo(() => {
    const caByHour = {};
    for (const t of tickets) {
      const h = new Date(t.date_ticket).getHours();
      caByHour[h] = (caByHour[h] || 0) + Number(t.total_ttc);
    }
    const meteoByHour = {};
    for (const p of (meteoHourly || [])) {
      meteoByHour[p.hour] = p;
    }
    let cumul = 0;
    return Array.from({ length: 14 }, (_, i) => {
      const h = i + 8;
      const ca = caByHour[h] || 0;
      cumul += ca;
      const m = meteoByHour[h] || {};
      return {
        heure: `${h}h`,
        hour: h,
        ca,
        cumulCa: cumul,
        temp: m.temp != null ? Number(m.temp) : null,
        precip: m.precipMm != null ? Number(m.precipMm) : 0,
        code: m.code != null ? m.code : null,
      };
    });
  }, [tickets, meteoHourly]);

  const hasMeteoHourly = (meteoHourly?.length || 0) > 0;

  return (
    <>
      <div className="mb-4">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      {/* Bloc 1 : KPIs principaux avec deltas vs J-1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <KpiCard title="CA TTC du jour" value={formatEuro(kpis?.ca_ttc)} icon={TrendingUp} accent="primary" footer={<DeltaBadge value={v.ca_ttc} />} />
        <KpiCard title="Nb tickets" value={(kpis?.nb_tickets || 0).toLocaleString('fr-FR')} icon={Receipt} accent="slate" footer={<DeltaBadge value={v.nb_tickets} />} />
        <KpiCard title="Panier moyen" value={formatEuro(kpis?.panier_moyen, 2)} icon={Target} accent="amber" footer={<DeltaBadge value={v.panier_moyen} />} />
        <KpiCard title="IPT (articles/ticket)" value={(kpis?.ipt || 0).toFixed(2)} icon={ShoppingBag} accent="slate" footer={<DeltaBadge value={v.ipt} />} />
      </div>

      {/* Bloc 2 : KPIs retail avancés */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard title="Prix moyen article" value={formatEuro(kpis?.prix_moyen_article, 2)} icon={Tag} accent="slate" footer={<DeltaBadge value={v.prix_moyen_article} />} />
        <KpiCard title="Part promo (CA)" value={`${(kpis?.taux_promo_ca || 0).toFixed(1)}%`} icon={Percent} accent="amber" />
        <KpiCard title="TVA collectée" value={formatEuro(kpis?.tva_collectee, 2)} icon={Percent} accent="slate" />
        <KpiCard title="Durée moy. ticket" value={kpis?.duree_moy_ticket_sec ? `${Math.round(kpis.duree_moy_ticket_sec / 60)} min` : '—'} icon={Timer} accent="slate" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-card shadow-card p-4 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Météo du jour</h3>
          {meteo ? (
            <div className="flex items-center gap-4">
              <WeatherIcon className="w-16 h-16 text-sky-500" strokeWidth={1.5} />
              <div>
                <div className="text-2xl font-bold text-slate-800">{meteo.weather_label}</div>
                <div className="text-sm text-slate-500 mt-1">
                  {meteo.temp_min != null && <span>{Number(meteo.temp_min).toFixed(0)}° / </span>}
                  {meteo.temp_max != null && <span>{Number(meteo.temp_max).toFixed(0)}°C</span>}
                </div>
                {meteo.precipitation_mm > 0 && (
                  <div className="text-xs text-blue-600 mt-1">Pluie : {Number(meteo.precipitation_mm).toFixed(1)} mm</div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-slate-400 text-sm">Pas de donnée météo pour cette date</p>
          )}
        </div>

        <div className="bg-white rounded-card shadow-card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Avancement du CA de la journée</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="heure" fontSize={11} />
              <YAxis yAxisId="left" fontSize={11} tickFormatter={(v) => `${v}€`} />
              {hasMeteoHourly && (
                <YAxis yAxisId="right" orientation="right" fontSize={11}
                  tickFormatter={(v) => `${v}°`}
                  domain={['auto', 'auto']} />
              )}
              <Tooltip formatter={(val, name) => {
                if (name === 'Température') return `${Number(val).toFixed(1)} °C`;
                return `${Number(val).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
              }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="ca" fill="#EC4899" fillOpacity={0.35} name="CA horaire" />
              <Line yAxisId="left" type="monotone" dataKey="cumulCa" stroke="#EC4899" strokeWidth={2.5} dot={false} name="CA cumulé" />
              {hasMeteoHourly && (
                <Line yAxisId="right" type="monotone" dataKey="temp" stroke="#F97316" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Température" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          {hasMeteoHourly && (
            <div className="mt-3 flex gap-1 border-t border-slate-100 pt-3 overflow-x-auto">
              {hourly.filter(h => h.hour >= 8 && h.hour <= 20).map((h) => {
                const HIcon = weatherIcon(h.code);
                return (
                  <div key={h.hour} className="flex-1 min-w-[42px] text-center">
                    <div className="text-[10px] text-slate-400 font-medium">{h.hour}h</div>
                    <HIcon className="w-5 h-5 mx-auto text-sky-500" strokeWidth={1.5} />
                    <div className="text-[10px] text-slate-600 font-medium">
                      {h.temp != null ? `${Math.round(h.temp)}°` : '—'}
                    </div>
                    {h.precip > 0 && (
                      <div className="text-[9px] text-blue-600 font-medium">
                        {h.precip.toFixed(1)} mm
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-card shadow-card p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Rayons vendus ce jour</h3>
        {rayons.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-4">Aucune vente</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr><th className="text-left py-2">Rayon</th><th className="text-left py-2">Segment</th><th className="text-right py-2">Articles</th><th className="text-right py-2">CA TTC</th></tr>
            </thead>
            <tbody>
              {rayons.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{r.rayon}</td>
                  <td className="py-2 text-xs"><span className="px-2 py-0.5 rounded" style={{ backgroundColor: SEGMENT_COLORS[r.segment] + '33', color: SEGMENT_COLORS[r.segment] }}>{SEGMENT_LABELS[r.segment]}</span></td>
                  <td className="py-2 text-right">{r.nb_articles}</td>
                  <td className="py-2 text-right font-medium">{Number(r.ca_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function MonthView({ mois, annee, setMois, setAnnee, data, meteo, kpis, hourly, evolution }) {
  if (!data) return null;
  const objectifCA = Number(data.objectif?.ca_objectif_ttc || 0);
  const realiseCA = data.realise?.ca_ttc || 0;
  const pctAtteinte = objectifCA > 0 ? (realiseCA / objectifCA) * 100 : null;
  const ev = evolution?.variations || {};

  const dailyChart = useMemo(() => {
    const weatherByDate = new Map();
    for (const m of meteo) weatherByDate.set(m.date?.slice(0, 10), m);
    return (data.daily || []).map(d => {
      const key = d.jour?.slice(0, 10);
      const w = weatherByDate.get(key);
      return {
        jour: key ? new Date(key).getDate() : '',
        ca: Math.round(d.ca_ttc || 0),
        pluie: w?.precipitation_mm ? Number(w.precipitation_mm) : 0,
      };
    });
  }, [data.daily, meteo]);

  return (
    <>
      <div className="flex gap-3 mb-4">
        <select value={mois} onChange={(e) => setMois(parseInt(e.target.value))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          {MOIS_COURT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={annee} onChange={(e) => setAnnee(parseInt(e.target.value))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-24" />
      </div>

      {/* KPIs budgétaires */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <KpiCard title="CA TTC réalisé" value={formatEuro(realiseCA)} icon={TrendingUp} accent="primary" footer={<DeltaBadge value={ev.ca_ttc} />} />
        <KpiCard title="Objectif CA" value={formatEuro(objectifCA)} icon={Target} accent="slate" />
        <KpiCard title="% atteinte" value={pctAtteinte !== null ? `${pctAtteinte.toFixed(0)}%` : '—'} icon={TrendingUp} accent={pctAtteinte >= 100 ? 'primary' : pctAtteinte >= 80 ? 'amber' : 'slate'} />
        <KpiCard title="Nb tickets" value={(kpis?.nb_tickets ?? data.realise?.nb_tickets ?? 0).toLocaleString('fr-FR')} icon={Receipt} accent="slate" footer={<DeltaBadge value={ev.nb_tickets} />} />
      </div>

      {/* KPIs retail */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard title="Panier moyen" value={formatEuro(kpis?.panier_moyen, 2)} icon={Target} accent="amber" footer={<DeltaBadge value={ev.panier_moyen} />} />
        <KpiCard title="IPT (articles/ticket)" value={(kpis?.ipt || 0).toFixed(2)} icon={ShoppingBag} accent="slate" footer={<DeltaBadge value={ev.ipt} />} />
        <KpiCard title="Prix moyen article" value={formatEuro(kpis?.prix_moyen_article, 2)} icon={Tag} accent="slate" footer={<DeltaBadge value={ev.prix_moyen_article} />} />
        <KpiCard title="Part promo (CA)" value={`${(kpis?.taux_promo_ca || 0).toFixed(1)}%`} icon={Percent} accent="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-card shadow-card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">CA quotidien + précipitations (mm)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dailyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="jour" fontSize={11} />
              <YAxis yAxisId="left" fontSize={11} />
              <YAxis yAxisId="right" orientation="right" fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="ca" fill="#EC4899" name="CA (€)" />
              <Line yAxisId="right" type="monotone" dataKey="pluie" stroke="#3B82F6" name="Pluie (mm)" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-card shadow-card p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Segments (CA)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={data.segments.map(s => ({ name: SEGMENT_LABELS[s.segment], value: Math.round(s.ca_ttc) }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${e.name}`}>
                {data.segments.map((s, i) => <Cell key={i} fill={SEGMENT_COLORS[s.segment]} />)}
              </Pie>
              <Tooltip formatter={(v) => `${v.toLocaleString('fr-FR')} €`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heatmap jour-semaine x heure */}
      {hourly?.heatmap?.length > 0 && (
        <div className="bg-white rounded-card shadow-card p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Fréquentation : heatmap jour × heure (tickets)</h3>
          <HourlyHeatmap data={hourly.heatmap} />
        </div>
      )}

      {/* Fréquentation horaire cumulée */}
      {hourly?.by_hour?.length > 0 && (
        <div className="bg-white rounded-card shadow-card p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">CA et tickets par heure de la journée</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={hourly.by_hour.map(h => ({ ...h, heure: `${h.heure}h` }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="heure" fontSize={11} />
              <YAxis yAxisId="left" fontSize={11} />
              <YAxis yAxisId="right" orientation="right" fontSize={11} />
              <Tooltip formatter={(v, n) => n === 'CA (€)' ? formatEuro(v, 2) : v} />
              <Legend />
              <Bar yAxisId="left" dataKey="ca_ttc" fill="#EC4899" name="CA (€)" />
              <Line yAxisId="right" type="monotone" dataKey="nb_tickets" stroke="#0EA5E9" name="Tickets" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-white rounded-card shadow-card p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Top 10 articles du mois</h3>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
            <tr><th className="text-left py-2">Article</th><th className="text-left py-2">Rayon</th><th className="text-right py-2">Qté</th><th className="text-right py-2">CA</th></tr>
          </thead>
          <tbody>
            {data.top.map((a, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2">{a.article}</td>
                <td className="py-2 text-slate-500 text-xs">{a.rayon}</td>
                <td className="py-2 text-right">{a.nb_articles}</td>
                <td className="py-2 text-right font-medium">{Number(a.ca_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function YearView({ annee, setAnnee, data, budget, boutique }) {
  if (!data || !budget) return null;
  const budgetAnnuel = Number(boutique?.budget_annuel || 0);
  const caRealise = budget.ca_total_realise || 0;
  const caObjectif = budget.ca_total_objectif || 0;
  const pctBudget = budgetAnnuel > 0 ? (caRealise / budgetAnnuel) * 100 : null;

  const chartData = MOIS_COURT.map((m, i) => {
    const v = data.find(d => d.mois === i + 1);
    const o = budget.objectifs_par_mois.find(o => o.mois === i + 1);
    return {
      mois: m,
      realise: v?.ca_ttc || 0,
      objectif: Number(o?.ca_objectif_ttc || 0),
    };
  });

  // Projection fin d'année : régression linéaire simple sur les mois réalisés
  const nowMois = new Date().getMonth() + 1;
  const caPeriode = chartData.slice(0, nowMois).reduce((s, r) => s + r.realise, 0);
  const projFinAnnee = nowMois > 0 ? (caPeriode / nowMois) * 12 : 0;

  return (
    <>
      <div className="flex gap-3 mb-4">
        <input type="number" value={annee} onChange={(e) => setAnnee(parseInt(e.target.value))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-28" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KpiCard title="Budget annuel" value={`${budgetAnnuel.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} icon={Target} accent="slate" />
        <KpiCard title="CA réalisé YTD" value={`${caRealise.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} icon={TrendingUp} accent="primary" />
        <KpiCard title="% du budget" value={pctBudget !== null ? `${pctBudget.toFixed(0)}%` : '—'} icon={TrendingUp} accent={pctBudget >= 75 ? 'primary' : 'amber'} />
        <KpiCard title="Projection fin d'année" value={`${projFinAnnee.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} icon={TrendingUp} accent="amber" />
      </div>

      <div className="bg-white rounded-card shadow-card p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Réalisé vs Objectif par mois</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="mois" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip formatter={(v) => `${v.toLocaleString('fr-FR')} €`} />
            <Legend />
            <Bar dataKey="objectif" fill="#FBCFE8" name="Objectif" />
            <Bar dataKey="realise" fill="#EC4899" name="Réalisé" />
            {budgetAnnuel > 0 && <ReferenceLine y={budgetAnnuel / 12} stroke="#64748B" strokeDasharray="3 3" label={{ value: 'Budget/mois', position: 'right', fontSize: 10 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-card shadow-card p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Détail par mois</h3>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left py-2">Mois</th>
              <th className="text-right py-2">CA réalisé</th>
              <th className="text-right py-2">Objectif</th>
              <th className="text-right py-2">% atteinte</th>
              <th className="text-right py-2">Nb tickets</th>
              <th className="text-right py-2">Panier moy.</th>
            </tr>
          </thead>
          <tbody>
            {MOIS_COURT.map((m, i) => {
              const v = data.find(d => d.mois === i + 1);
              const o = budget.objectifs_par_mois.find(o => o.mois === i + 1);
              const objNum = Number(o?.ca_objectif_ttc || 0);
              const realise = v?.ca_ttc || 0;
              const pct = objNum > 0 ? (realise / objNum) * 100 : null;
              return (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{m}</td>
                  <td className="py-2 text-right">{realise.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</td>
                  <td className="py-2 text-right text-slate-500">{objNum.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</td>
                  <td className={`py-2 text-right font-medium ${pct === null ? 'text-slate-400' : pct >= 100 ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                    {pct !== null ? `${pct.toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-2 text-right">{v?.nb_tickets || 0}</td>
                  <td className="py-2 text-right">{v?.panier_moyen ? `${v.panier_moyen.toFixed(2)} €` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Heatmap jour-semaine × heure : nb tickets agrégés sur la période.
// Couleur graduée rose (solidata). Affiche les heures d'ouverture boutique (8h→20h).
function HourlyHeatmap({ data }) {
  const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8h → 20h
  // DOW Postgres : 0=dim, 1=lun, ..., 6=sam → on réordonne lundi → dimanche
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const LABELS = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam', 0: 'Dim' };

  const grid = {};
  let max = 0;
  for (const cell of data) {
    const k = `${cell.jour_semaine}_${cell.heure}`;
    grid[k] = cell.nb_tickets;
    if (cell.nb_tickets > max) max = cell.nb_tickets;
  }

  function colorFor(n) {
    if (!n || max === 0) return '#F1F5F9';
    const intensity = Math.max(0.15, n / max);
    // Interpolation vers #EC4899 (pink-500)
    const r = Math.round(241 + (236 - 241) * intensity);
    const g = Math.round(245 + (72 - 245) * intensity);
    const b = Math.round(249 + (153 - 249) * intensity);
    return `rgb(${r},${g},${b})`;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left py-1 pr-2 text-slate-500 font-normal">Jour</th>
            {HOURS.map(h => (
              <th key={h} className="text-center py-1 font-normal text-slate-500 w-10">{h}h</th>
            ))}
            <th className="text-center py-1 font-medium text-slate-600 pl-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {DOW_ORDER.map(d => {
            const rowTotal = HOURS.reduce((s, h) => s + (grid[`${d}_${h}`] || 0), 0);
            return (
              <tr key={d}>
                <td className="py-0.5 pr-2 font-medium text-slate-700">{LABELS[d]}</td>
                {HOURS.map(h => {
                  const v = grid[`${d}_${h}`] || 0;
                  return (
                    <td key={h} className="p-0.5">
                      <div
                        className="h-6 rounded flex items-center justify-center text-[10px] font-medium"
                        style={{ backgroundColor: colorFor(v), color: v > max * 0.5 ? 'white' : '#475569' }}
                        title={`${LABELS[d]} ${h}h : ${v} tickets`}
                      >
                        {v || ''}
                      </div>
                    </td>
                  );
                })}
                <td className="py-0.5 pl-2 text-right font-semibold text-slate-700">{rowTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
