import { useState, useEffect, useMemo } from 'react';
import { ShoppingBag, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from 'recharts';
import Layout from '../components/Layout';
import { LoadingSpinner, KpiCard } from '../components';
import api from '../services/api';

const SEGMENT_LABELS = {
  ventes_courantes: 'Ventes courantes',
  promotions: 'Promotions',
  consommables: 'Consommables',
};
const SEGMENT_COLORS = {
  ventes_courantes: '#0D9488',
  promotions: '#F59E0B',
  consommables: '#94A3B8',
};
const RAYON_COLORS = ['#EC4899', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#6366F1', '#14B8A6'];

export default function BoutiquesVentes() {
  const [boutiques, setBoutiques] = useState([]);
  const [boutiqueId, setBoutiqueId] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [daily, setDaily] = useState([]);
  const [rayons, setRayons] = useState([]);
  const [segments, setSegments] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/boutiques?active=true').then(res => {
      setBoutiques(res.data || []);
      if (res.data?.length > 0) setBoutiqueId(String(res.data[0].id));
    });
  }, []);

  useEffect(() => { if (boutiqueId) loadAnalytics(); }, [boutiqueId, dateFrom, dateTo]);

  async function loadAnalytics() {
    setLoading(true);
    try {
      const qs = `boutique_id=${boutiqueId}&date_from=${dateFrom}&date_to=${dateTo}`;
      const [d, r, s, a] = await Promise.all([
        api.get(`/boutique-ventes/analytics/daily?${qs}`),
        api.get(`/boutique-ventes/analytics/rayons?${qs}`),
        api.get(`/boutique-ventes/analytics/segments?${qs}`),
        api.get(`/boutique-ventes/analytics/articles?${qs}&limit=15`),
      ]);
      setDaily(d.data || []);
      setRayons(r.data || []);
      setSegments(s.data || []);
      setArticles(a.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const kpis = useMemo(() => {
    const total = daily.reduce((s, r) => s + (r.ca_ttc || 0), 0);
    const nbTickets = daily.reduce((s, r) => s + (r.nb_tickets || 0), 0);
    const nbArticles = daily.reduce((s, r) => s + (r.nb_articles || 0), 0);
    const panier = nbTickets > 0 ? total / nbTickets : 0;
    return { total, nbTickets, nbArticles, panier };
  }, [daily]);

  const dailyChart = useMemo(() => daily.map(d => ({
    jour: d.jour ? new Date(d.jour).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '',
    ca: Math.round((d.ca_ttc || 0) * 100) / 100,
  })), [daily]);

  const rayonChart = useMemo(() => rayons.map(r => ({
    name: r.rayon,
    value: Math.round((r.ca_ttc || 0) * 100) / 100,
  })), [rayons]);

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <ShoppingBag className="w-6 h-6 text-pink-600" />
            Analyse des ventes
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Performance commerciale par rayon, segment et article</p>
        </div>

        <div className="bg-white rounded-card shadow-card p-4 mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Boutique</label>
            <select value={boutiqueId} onChange={(e) => setBoutiqueId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              {boutiques.map(b => <option key={b.id} value={b.id}>{b.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Du</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Au</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        {loading ? <LoadingSpinner size="lg" /> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KpiCard title="CA TTC" value={`${kpis.total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} icon={TrendingUp} accent="primary" />
              <KpiCard title="Nb tickets" value={kpis.nbTickets.toLocaleString('fr-FR')} icon={ShoppingBag} accent="slate" />
              <KpiCard title="Nb articles" value={kpis.nbArticles.toLocaleString('fr-FR')} icon={ShoppingBag} accent="slate" />
              <KpiCard title="Panier moyen" value={`${kpis.panier.toFixed(2)} €`} icon={TrendingUp} accent="amber" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-card shadow-card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">CA quotidien (TTC)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="jour" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(v) => `${v.toLocaleString('fr-FR')} €`} />
                    <Bar dataKey="ca" fill="#EC4899" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-card shadow-card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Répartition par rayon</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={rayonChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => e.name}>
                      {rayonChart.map((_, i) => <Cell key={i} fill={RAYON_COLORS[i % RAYON_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v.toLocaleString('fr-FR')} €`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-card shadow-card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Par segment</h3>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr><th className="text-left py-2">Segment</th><th className="text-right py-2">Articles</th><th className="text-right py-2">CA TTC</th></tr>
                  </thead>
                  <tbody>
                    {segments.map(s => (
                      <tr key={s.segment} className="border-b border-slate-100">
                        <td className="py-2 flex items-center gap-2">
                          <span className="w-3 h-3 rounded" style={{ backgroundColor: SEGMENT_COLORS[s.segment] }}></span>
                          {SEGMENT_LABELS[s.segment] || s.segment}
                        </td>
                        <td className="py-2 text-right">{s.nb_articles}</td>
                        <td className="py-2 text-right font-medium">{Number(s.ca_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-white rounded-card shadow-card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Top 15 articles</h3>
                <div className="max-h-[360px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-slate-500 border-b border-slate-200 sticky top-0 bg-white">
                      <tr><th className="text-left py-2">Article</th><th className="text-right py-2">Qté</th><th className="text-right py-2">Prix moy.</th><th className="text-right py-2">CA</th></tr>
                    </thead>
                    <tbody>
                      {articles.map((a, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-2"><span className="block truncate max-w-[180px]" title={a.article}>{a.article}</span><span className="text-xs text-slate-400">{a.rayon}</span></td>
                          <td className="py-2 text-right">{a.nb_articles}</td>
                          <td className="py-2 text-right">{Number(a.prix_moyen).toFixed(2)} €</td>
                          <td className="py-2 text-right font-medium">{Number(a.ca_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
