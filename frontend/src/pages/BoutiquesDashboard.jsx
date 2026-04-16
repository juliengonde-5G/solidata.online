import { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Cloud, CloudRain, Sun, CloudSnow, Zap, TrendingUp, ShoppingBag, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell, ReferenceLine } from 'recharts';
import Layout from '../components/Layout';
import { LoadingSpinner, KpiCard } from '../components';
import api from '../services/api';

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

  // Mois
  const [mois, setMois] = useState(new Date().getMonth() + 1);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [monthData, setMonthData] = useState(null);
  const [monthMeteo, setMonthMeteo] = useState([]);

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
      const [v, m, r, t] = await Promise.all([
        api.get(`/boutique-ventes/analytics/daily?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-meteo?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-ventes/analytics/rayons?boutique_id=${boutiqueId}&date_from=${dayDate}&date_to=${dayDate}`),
        api.get(`/boutique-ventes/tickets?boutique_id=${boutiqueId}&date=${dayDate}`),
      ]);
      setDayVentes(v.data?.[0] || { ca_ttc: 0, nb_tickets: 0, nb_articles: 0 });
      setDayMeteo(m.data?.[0] || null);
      setDayRayons(r.data || []);
      setDayTickets(t.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function loadMonth() {
    setLoading(true);
    try {
      const dateFrom = `${annee}-${String(mois).padStart(2, '0')}-01`;
      const lastDay = new Date(annee, mois, 0).getDate();
      const dateTo = `${annee}-${String(mois).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const [daily, segments, top, compare, meteo] = await Promise.all([
        api.get(`/boutique-ventes/analytics/daily?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
        api.get(`/boutique-ventes/analytics/segments?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
        api.get(`/boutique-ventes/analytics/articles?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}&limit=10`),
        api.get(`/boutique-objectifs/compare?boutique_id=${boutiqueId}&annee=${annee}`),
        api.get(`/boutique-meteo?boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`),
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
            {tab === 'jour' && <DayView date={dayDate} setDate={setDayDate} ventes={dayVentes} meteo={dayMeteo} rayons={dayRayons} tickets={dayTickets} />}
            {tab === 'mois' && <MonthView mois={mois} annee={annee} setMois={setMois} setAnnee={setAnnee} data={monthData} meteo={monthMeteo} />}
            {tab === 'annee' && <YearView annee={annee} setAnnee={setAnnee} data={yearData} budget={yearBudget} boutique={selectedBoutique} />}
          </>
        )}
      </div>
    </Layout>
  );
}

function DayView({ date, setDate, ventes, meteo, rayons, tickets }) {
  const WeatherIcon = weatherIcon(meteo?.weather_code);
  const panier = ventes?.nb_tickets > 0 ? ventes.ca_ttc / ventes.nb_tickets : 0;

  // Répartition horaire
  const hourly = useMemo(() => {
    const buckets = {};
    for (const t of tickets) {
      const h = new Date(t.date_ticket).getHours();
      if (!buckets[h]) buckets[h] = { heure: `${h}h`, ca: 0, tickets: 0 };
      buckets[h].ca += Number(t.total_ttc);
      buckets[h].tickets += 1;
    }
    return Array.from({ length: 14 }, (_, i) => buckets[i + 8] || { heure: `${i + 8}h`, ca: 0, tickets: 0 });
  }, [tickets]);

  return (
    <>
      <div className="mb-4">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KpiCard title="CA TTC du jour" value={`${(ventes?.ca_ttc || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} icon={TrendingUp} accent="primary" />
        <KpiCard title="Nb tickets" value={(ventes?.nb_tickets || 0).toLocaleString('fr-FR')} icon={ShoppingBag} accent="slate" />
        <KpiCard title="Nb articles" value={(ventes?.nb_articles || 0).toLocaleString('fr-FR')} icon={ShoppingBag} accent="slate" />
        <KpiCard title="Panier moyen" value={`${panier.toFixed(2)} €`} icon={Target} accent="amber" />
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
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Répartition horaire du CA</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="heure" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v, n) => n === 'ca' ? `${v.toLocaleString('fr-FR')} €` : v} />
              <Bar dataKey="ca" fill="#EC4899" />
            </BarChart>
          </ResponsiveContainer>
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

function MonthView({ mois, annee, setMois, setAnnee, data, meteo }) {
  if (!data) return null;
  const objectifCA = Number(data.objectif?.ca_objectif_ttc || 0);
  const realiseCA = data.realise?.ca_ttc || 0;
  const pctAtteinte = objectifCA > 0 ? (realiseCA / objectifCA) * 100 : null;

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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KpiCard title="CA TTC réalisé" value={`${realiseCA.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} icon={TrendingUp} accent="primary" />
        <KpiCard title="Objectif CA" value={`${objectifCA.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} icon={Target} accent="slate" />
        <KpiCard title="% atteinte" value={pctAtteinte !== null ? `${pctAtteinte.toFixed(0)}%` : '—'} icon={TrendingUp} accent={pctAtteinte >= 100 ? 'primary' : pctAtteinte >= 80 ? 'amber' : 'slate'} />
        <KpiCard title="Nb tickets" value={(data.realise?.nb_tickets || 0).toLocaleString('fr-FR')} icon={ShoppingBag} accent="slate" />
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
