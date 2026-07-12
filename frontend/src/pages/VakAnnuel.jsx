import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Calendar, Receipt, Target, Weight, Tag } from 'lucide-react';
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line,
  CartesianGrid, Legend, ReferenceLine, AreaChart, Area, BarChart,
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

const SEGMENT_LABELS = {
  textile_vrac: 'Textile vrac',
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

export default function VakAnnuel() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [overview, setOverview] = useState(null);
  const [hourly, setHourly] = useState([]);
  const [segmentsTrend, setSegmentsTrend] = useState([]);
  const [paymentMix, setPaymentMix] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/vak/annual/overview?annee=${annee}`),
      api.get(`/vak/annual/hourly-heatmap?annee=${annee}`),
      api.get(`/vak/annual/segments-trend?annee=${annee}`),
      api.get(`/vak/annual/payment-mix?annee=${annee}`),
    ]).then(([o, h, s, p]) => {
      setOverview(o.data);
      setHourly(h.data || []);
      setSegmentsTrend(s.data || []);
      setPaymentMix(p.data || []);
    }).catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [annee]);

  // Données chart : 1 ligne par VAK avec stack segments
  const segmentsChart = useMemo(() => {
    if (!segmentsTrend.length) return [];
    const byVak = new Map();
    for (const row of segmentsTrend) {
      const k = row.vak_id;
      if (!byVak.has(k)) {
        byVak.set(k, {
          libelle: row.libelle,
          date_debut: row.date_debut,
          textile_vrac: 0,
          chaussures: 0,
          consommables: 0,
          autre: 0,
        });
      }
      const entry = byVak.get(k);
      if (row.segment && entry[row.segment] !== undefined) {
        entry[row.segment] = Number(row.ca_ttc || 0);
      }
    }
    return Array.from(byVak.values()).sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut));
  }, [segmentsTrend]);

  // Données chart paiement par VAK
  const paymentChart = useMemo(() => {
    if (!paymentMix.length) return [];
    const byVak = new Map();
    for (const row of paymentMix) {
      const k = row.vak_id;
      if (!byVak.has(k)) {
        byVak.set(k, {
          libelle: row.libelle,
          date_debut: row.date_debut,
          cb: 0,
          especes: 0,
          autre: 0,
        });
      }
      byVak.get(k)[row.categorie] = Number(row.ca_ttc || 0);
    }
    return Array.from(byVak.values()).map((v) => {
      const total = v.cb + v.especes + v.autre;
      return {
        ...v,
        cb_pct: total > 0 ? (v.cb / total) * 100 : 0,
        especes_pct: total > 0 ? (v.especes / total) * 100 : 0,
      };
    }).sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut));
  }, [paymentMix]);

  // CA par VAK avec objectif
  const caChart = useMemo(() => {
    if (!overview?.vaks) return [];
    return overview.vaks.map((v) => ({
      libelle: v.libelle,
      ca_ttc: Math.round(v.ca_ttc),
      objectif: Math.round(Number(v.ca_objectif_ttc || 0)),
      poids: Math.round(v.poids_kg),
    }));
  }, [overview]);

  const summary = overview?.summary || {};
  const moyenneCAParVak = summary.nb_vaks > 0 ? summary.ca_total / summary.nb_vaks : 0;

  if (loading) return <Layout><LoadingSpinner size="lg" /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Performance annuelle des VAK"
          subtitle="Synthèse, tendances et historique de toutes les ventes au kilo de l'année"
          icon={TrendingUp}
          actions={
            <input type="number" value={annee} onChange={(e) => setAnnee(parseInt(e.target.value) || annee)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-28" />
          }
        />

        {summary.nb_vaks === 0 ? (
          <div className="bg-white rounded-card shadow-card p-12 text-center">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">Aucune VAK enregistrée pour l'année {annee}.</p>
          </div>
        ) : (
          <>
            {/* Synthèse */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <KpiCard title="VAK réalisées" value={summary.nb_vaks} icon={Calendar} accent="primary" />
              <KpiCard title="CA cumulé" value={formatEuro(summary.ca_total)} icon={TrendingUp} accent="primary" />
              <KpiCard title="Poids total" value={`${formatNumber((summary.poids_total || 0) / 1000, 2)} t`} icon={Weight} accent="amber"
                footer={<span className="text-xs text-slate-500">{formatNumber(summary.poids_total, 0)} kg</span>} />
              <KpiCard title="Prix moyen €/kg" value={formatEuro(summary.prix_moyen_kg, 2)} icon={Tag} accent="slate" />
              <KpiCard title="Tickets" value={formatNumber(summary.tickets_total)} icon={Receipt} accent="slate" />
              <KpiCard title="Panier moyen" value={formatEuro(summary.panier_moyen, 2)} icon={Target} accent="slate" />
            </div>

            {/* CA par VAK avec objectifs */}
            <div className="bg-white rounded-card shadow-card p-4 mb-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">CA réalisé vs objectif par VAK</h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={caChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="libelle" fontSize={10} interval={0} angle={-15} textAnchor="end" height={70} />
                  <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k€`} />
                  <Tooltip formatter={(v, n) => n === 'Poids (kg)' ? `${formatNumber(v)} kg` : formatEuro(v)} />
                  <Legend />
                  <Bar dataKey="objectif" fill="#FED7AA" name="Objectif" />
                  <Bar dataKey="ca_ttc" fill="#F97316" name="Réalisé" />
                  <Line type="monotone" dataKey="ca_ttc" stroke="#9A3412" name="CA (€)" dot={{ r: 4 }} />
                  {moyenneCAParVak > 0 && (
                    <ReferenceLine y={moyenneCAParVak} stroke="#64748B" strokeDasharray="3 3"
                      label={{ value: `Moyenne ${formatEuro(moyenneCAParVak)}`, position: 'right', fontSize: 10 }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Évolution segments */}
              {segmentsChart.length > 0 && (
                <div className="bg-white rounded-card shadow-card p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Évolution segments (CA par VAK)</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={segmentsChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="libelle" fontSize={10} interval={0} angle={-15} textAnchor="end" height={60} />
                      <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
                      <Tooltip formatter={(v) => formatEuro(v)} />
                      <Legend />
                      <Area type="monotone" dataKey="textile_vrac" stackId="1" stroke={SEGMENT_COLORS.textile_vrac} fill={SEGMENT_COLORS.textile_vrac} name={SEGMENT_LABELS.textile_vrac} />
                      <Area type="monotone" dataKey="chaussures" stackId="1" stroke={SEGMENT_COLORS.chaussures} fill={SEGMENT_COLORS.chaussures} name={SEGMENT_LABELS.chaussures} />
                      <Area type="monotone" dataKey="consommables" stackId="1" stroke={SEGMENT_COLORS.consommables} fill={SEGMENT_COLORS.consommables} name={SEGMENT_LABELS.consommables} />
                      <Area type="monotone" dataKey="autre" stackId="1" stroke={SEGMENT_COLORS.autre} fill={SEGMENT_COLORS.autre} name={SEGMENT_LABELS.autre} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Mix paiement % par VAK */}
              {paymentChart.length > 0 && (
                <div className="bg-white rounded-card shadow-card p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Mix paiement (%) — tendance dématérialisation</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={paymentChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="libelle" fontSize={10} interval={0} angle={-15} textAnchor="end" height={60} />
                      <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                      <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                      <Legend />
                      <Line type="monotone" dataKey="cb_pct" stroke="#0EA5E9" name="CB" dot={{ r: 4 }} strokeWidth={2} />
                      <Line type="monotone" dataKey="especes_pct" stroke="#22C55E" name="Espèces" dot={{ r: 4 }} strokeWidth={2} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Heatmap horaire annuelle */}
            {hourly.length > 0 && (
              <div className="bg-white rounded-card shadow-card p-4 mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">
                  Activité par tranche horaire — toutes les VAK {annee} <span className="text-xs font-normal text-slate-400">(heures GMT)</span>
                </h3>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={hourly.map((h) => ({ ...h, heure: `${h.heure}h` }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="heure" fontSize={11} />
                    <YAxis yAxisId="left" fontSize={11} tickFormatter={(v) => `${v}€`} />
                    <YAxis yAxisId="right" orientation="right" fontSize={11} />
                    <Tooltip formatter={(v, n) => n === 'Tickets' ? Math.round(v) : n === 'Poids (kg)' ? `${formatNumber(v, 1)} kg` : formatEuro(v)} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="ca_ttc" fill="#F97316" name="CA (€)" />
                    <Line yAxisId="right" type="monotone" dataKey="nb_tickets" stroke="#0EA5E9" name="Tickets" dot={{ r: 3 }} />
                    <Line yAxisId="right" type="monotone" dataKey="poids_kg" stroke="#A855F7" strokeDasharray="4 2" name="Poids (kg)" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-xs text-slate-500 mt-2">
                  Sert à optimiser les horaires d'ouverture des prochaines VAK : la tranche la plus chargée
                  guide les renforts caisse / mobilisation équipe.
                </p>
              </div>
            )}

            {/* Tableau récap */}
            <div className="bg-white rounded-card shadow-card p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Détail de chaque VAK</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2 px-3">VAK</th>
                      <th className="text-left py-2 px-3">Dates</th>
                      <th className="text-right py-2 px-3">CA TTC</th>
                      <th className="text-right py-2 px-3">Objectif</th>
                      <th className="text-right py-2 px-3">%</th>
                      <th className="text-right py-2 px-3">Poids</th>
                      <th className="text-right py-2 px-3" title="Taux d'écoulement = kg vendus ÷ kg approvisionnés (approvisionnement saisi manuellement sur la session)">Écoulement</th>
                      <th className="text-right py-2 px-3">Tickets</th>
                      <th className="text-right py-2 px-3">Panier moy.</th>
                      <th className="text-right py-2 px-3">€/kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.vaks.map((v) => {
                      const obj = Number(v.ca_objectif_ttc || 0);
                      const pct = obj > 0 ? (v.ca_ttc / obj) * 100 : null;
                      const prixKg = v.poids_kg > 0 ? v.ca_ttc / v.poids_kg : 0;
                      const kgApprov = Number(v.kg_approvisionnes || 0);
                      const ecoulement = kgApprov > 0 ? (v.poids_kg / kgApprov) * 100 : null;
                      return (
                        <tr key={v.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-2 px-3 font-medium">{v.libelle}</td>
                          <td className="py-2 px-3 text-slate-500 text-xs">
                            {new Date(v.date_debut).toLocaleDateString('fr-FR')} → {new Date(v.date_fin).toLocaleDateString('fr-FR')}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold">{formatEuro(v.ca_ttc)}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{obj > 0 ? formatEuro(obj) : '—'}</td>
                          <td className={`py-2 px-3 text-right font-medium ${pct === null ? 'text-slate-400' : pct >= 100 ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                            {pct !== null ? `${pct.toFixed(0)}%` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right">{formatNumber(v.poids_kg, 1)} kg</td>
                          <td className="py-2 px-3 text-right">
                            {ecoulement != null ? (
                              <span className={ecoulement >= 90 ? 'text-green-600 font-medium' : ecoulement >= 60 ? 'text-amber-600' : 'text-slate-600'}
                                title={`${formatNumber(v.poids_kg, 0)} kg vendus / ${formatNumber(kgApprov, 0)} kg approvisionnés`}>
                                {ecoulement.toFixed(0)}%
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2 px-3 text-right">{formatNumber(v.nb_tickets)}</td>
                          <td className="py-2 px-3 text-right">{formatEuro(v.panier_moyen, 2)}</td>
                          <td className="py-2 px-3 text-right text-orange-600 font-medium">{formatEuro(prixKg, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
