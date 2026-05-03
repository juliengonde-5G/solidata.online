import { useState, useEffect, useCallback, useMemo } from 'react';
import { Building2, Map as MapIcon, BarChart3, Bot, Radio, Filter } from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { PageHeader, Section, MapSizeFix } from '../components';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import 'leaflet/dist/leaflet.css';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function ReportingMetropole() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [communeFilter, setCommuneFilter] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [cavList, setCavList] = useState([]);
  const [selectedCav, setSelectedCav] = useState(null);
  const [cavDetail, setCavDetail] = useState(null);
  const [cavActivity, setCavActivity] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, cavRes] = await Promise.all([
        api.get(`/metropole/dashboard?year=${year}&month=${month}`),
        api.get('/metropole/cav'),
      ]);
      setDashboard(dashRes.data);
      setCavList(cavRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [year, month]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const openCavDetail = async (cav) => {
    setSelectedCav(cav);
    setCavDetail(null);
    setCavActivity(null);
    try {
      const [detailRes, actRes] = await Promise.all([
        api.get(`/metropole/cav/${cav.id}/details`),
        api.get(`/cav/${cav.id}/activity?days_before=15&days_after=15`).catch(() => ({ data: null })),
      ]);
      setCavDetail(detailRes.data);
      setCavActivity(actRes.data);
    } catch (err) { console.error(err); setCavDetail(null); }
  };

  const d = dashboard;

  // Filtre commune client-side
  const communes = useMemo(() => {
    const set = new Set(cavList.map((c) => c.commune).filter(Boolean));
    return Array.from(set).sort();
  }, [cavList]);

  const filteredCavList = useMemo(() => {
    if (!communeFilter) return cavList;
    return cavList.filter((c) => c.commune === communeFilter);
  }, [cavList, communeFilter]);

  // Plage d'années étendue (10 ans en arrière, 1 an en avant)
  const years = useMemo(
    () => Array.from({ length: 12 }, (_, i) => currentYear - 10 + i),
    [currentYear]
  );

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Reporting Métropole de Rouen"
          subtitle="Suivi des indicateurs environnementaux et sociaux"
          icon={Building2}
          actions={
            <div className="flex flex-wrap gap-2 items-center">
              <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="input-modern w-auto" title="Mois">
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="input-modern w-auto" title="Année">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 ml-2">
                <Filter className="w-3.5 h-3.5" /> Commune :
              </span>
              <select value={communeFilter} onChange={(e) => setCommuneFilter(e.target.value)} className="input-modern w-auto" title="Filtrer par commune">
                <option value="">Toutes ({communes.length})</option>
                {communes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          }
        />

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : d && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <KPI label="Volume collecté" value={`${(d.collecte.total_tonnes).toFixed(1)} t`} sub={`${d.collecte.tours_completees} tournées`} color="green" />
              <KPI label="CO2 évité" value={`${d.emissions_evitees.co2_total_tonnes} t`} sub={`Réemploi: ${d.emissions_evitees.detail.reemploi_tonnes}t / Recyclage: ${d.emissions_evitees.detail.recyclage_tonnes}t`} color="blue" />
              <KPI label="Effectifs" value={d.effectifs.total} sub={`CDI/CDD: ${d.effectifs.cdi_cdd} | Intérim: ${d.effectifs.interimaires}`} color="purple" />
              <KPI label="CAV actifs" value={d.cav.actifs} sub={`dont ${d.cav.indisponibles} indisponible(s)`} color="amber" />
              <KPI label="CAV total" value={d.cav.total} sub={`${d.effectifs.formation} en formation`} color="gray" />
              {d.taux_captation && (
                <KPI
                  label="Taux captation"
                  value={`${d.taux_captation.kg_par_hab_an} kg/hab/an`}
                  sub={`Objectif Refashion: ${d.taux_captation.objectif_refashion_kg} kg | Pop: ${(d.taux_captation.population_totale / 1000).toFixed(0)}k hab`}
                  color={d.taux_captation.kg_par_hab_an >= d.taux_captation.objectif_refashion_kg ? 'green' : 'amber'}
                />
              )}
            </div>

            {/* Historique mensuel */}
            {d.historique_mensuel?.length > 0 && (
              <Section title="Évolution mensuelle du tonnage collecté" icon={BarChart3}>
                <div className="flex items-end gap-1 h-48">
                  {d.historique_mensuel.map((h, i) => {
                    const maxKg = Math.max(...d.historique_mensuel.map(x => parseFloat(x.total_kg)));
                    const pct = maxKg > 0 ? (parseFloat(h.total_kg) / maxKg) * 100 : 0;
                    const moisLabel = new Date(h.mois).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[10px] text-gray-500 font-medium">{(parseFloat(h.total_kg) / 1000).toFixed(1)}t</span>
                        <div className="w-full bg-primary/80 rounded-t" style={{ height: `${Math.max(pct, 2)}%` }} />
                        <span className="text-[10px] text-gray-400">{moisLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Carte des CAV */}
            <Section title="Carte des Conteneurs d'Apport Volontaire" icon={MapIcon}>
              {/* Carte Leaflet */}
              <div className="rounded-lg overflow-hidden border mb-4" style={{ height: '400px' }}>
                <MapContainer center={[49.4231, 1.0993]} zoom={11} style={{ height: '100%', width: '100%' }}>
                  <MapSizeFix />
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  />
                  {filteredCavList.filter(c => c.latitude && c.longitude).map(c => (
                    <CircleMarker
                      key={c.id}
                      center={[c.latitude, c.longitude]}
                      radius={8}
                      pathOptions={{
                        color: c.status === 'active' ? '#22C55E' : '#EF4444',
                        fillColor: c.status === 'active' ? '#22C55E' : '#EF4444',
                        fillOpacity: 0.6,
                      }}
                      eventHandlers={{ click: () => openCavDetail(c) }}
                    >
                      <Popup>
                        <div className="text-xs">
                          <p className="font-bold">{c.name}</p>
                          <p>{c.commune}</p>
                          <p>Collectes (12m) : {c.nb_collectes_12m || 0}</p>
                          <p>Total : {((parseFloat(c.total_kg_12m) || 0) / 1000).toFixed(2)} t</p>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Liste des CAV */}
                <div className="lg:col-span-1 max-h-96 overflow-y-auto space-y-1">
                  {filteredCavList.map(c => (
                    <button key={c.id} onClick={() => openCavDetail(c)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                        selectedCav?.id === c.id ? 'bg-primary/10 border border-primary' : 'hover:bg-gray-50 border border-transparent'
                      }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-gray-500">{c.commune}</p>
                        </div>
                        <span className={`w-2.5 h-2.5 rounded-full ${c.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Détail CAV sélectionné */}
                <div className="lg:col-span-2">
                  {!selectedCav ? (
                    <div className="flex items-center justify-center h-64 text-gray-400">Cliquez sur un CAV pour voir ses détails</div>
                  ) : !cavDetail ? (
                    <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-lg font-bold">{cavDetail.cav.name}</h4>
                          <p className="text-sm text-gray-500">{cavDetail.cav.address} — {cavDetail.cav.commune}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${cavDetail.cav.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {cavDetail.cav.status === 'active' ? 'Actif' : `Indisponible${cavDetail.cav.unavailable_reason ? ` — ${cavDetail.cav.unavailable_reason}` : ''}`}
                        </span>
                      </div>

                      {/* Stats résumées */}
                      <div className="grid grid-cols-3 gap-3">
                        <MiniCard label="Collectes (12m)" value={cavDetail.stats.nb_collectes} />
                        <MiniCard label="Total (12m)" value={`${(parseFloat(cavDetail.stats.total_kg) / 1000).toFixed(2)} t`} />
                        <MiniCard label="Moyenne" value={`${Math.round(cavDetail.stats.avg_kg)} kg`} />
                      </div>

                      {/* Évolution remplissage : 15j historique + 15j prévision */}
                      {cavActivity?.jours?.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase">Évolution du remplissage (J-15 → J+15)</p>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500">
                              <span className="inline-flex items-center gap-1"><Radio className="w-3 h-3 text-teal-600" /> Sonde</span>
                              <span className="inline-flex items-center gap-1"><Bot className="w-3 h-3 text-blue-500" /> Prédiction</span>
                              <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500" /> Seuil 80%</span>
                            </div>
                          </div>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart
                              data={cavActivity.jours.map((j) => ({
                                ...j,
                                label: new Date(j.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
                                shortLabel: new Date(j.date).getDate().toString(),
                              }))}
                              margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="shortLabel" tick={{ fontSize: 10 }} interval={1} />
                              <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 120]} />
                              <Tooltip
                                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                formatter={(val) => [`${val}%`, 'Remplissage']}
                                labelFormatter={(_, payload) => {
                                  const p = payload?.[0]?.payload;
                                  if (!p) return '';
                                  const tag = p.type === 'prevision' ? ' 🤖 (prévision)'
                                    : p.source === 'sensor' ? ' 📡 (sonde)'
                                    : ' (estimé)';
                                  return (p.label || '') + tag;
                                }}
                              />
                              <ReferenceLine y={80} stroke="#EF4444" strokeDasharray="3 3" />
                              <Bar dataKey="fill_pct" radius={[3, 3, 0, 0]} maxBarSize={14}>
                                {cavActivity.jours.map((j, i) => (
                                  <Cell
                                    key={i}
                                    fill={
                                      j.type === 'prevision' ? '#93C5FD'
                                        : j.source === 'sensor' ? '#0D9488'
                                        : '#94A3B8'
                                    }
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Tableau des 3 derniers passages */}
                      {cavDetail.fill_history?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">3 derniers passages chauffeur</p>
                          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="text-left py-2 px-3">Date</th>
                                <th className="text-left py-2 px-3">Heure</th>
                                <th className="text-right py-2 px-3">Remplissage déclaré</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cavDetail.fill_history.slice(0, 3).map((f, i) => {
                                const date = new Date(f.date);
                                const fillPct = f.fill_level ? Math.round((f.fill_level / 5) * 100) : null;
                                const colorClass = fillPct == null ? 'text-slate-400'
                                  : fillPct >= 80 ? 'text-red-600 font-semibold'
                                  : fillPct >= 60 ? 'text-orange-600 font-semibold'
                                  : fillPct >= 40 ? 'text-amber-600'
                                  : 'text-green-600';
                                return (
                                  <tr key={i} className="border-b border-slate-100 last:border-0">
                                    <td className="py-2 px-3">{date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                    <td className="py-2 px-3 text-slate-500">{date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td className={`py-2 px-3 text-right ${colorClass}`}>
                                      {fillPct != null ? `${fillPct}% (niv. ${f.fill_level}/5)` : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* QR Code info */}
                      {cavDetail.cav.qr_code_data && (
                        <div className="text-xs text-gray-500">
                          QR Code : <span className="font-mono">{cavDetail.cav.qr_code_data}</span>
                          {cavDetail.qr_scans?.length > 0 && ` — ${cavDetail.qr_scans.length} scan(s) enregistré(s)`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Section>
          </>
        )}
      </div>
    </Layout>
  );
}

function KPI({ label, value, sub, color }) {
  const colors = {
    green: 'border-green-200 bg-green-50', blue: 'border-blue-200 bg-blue-50',
    purple: 'border-purple-200 bg-purple-50', amber: 'border-amber-200 bg-amber-50',
    gray: 'border-gray-200 bg-gray-50',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function MiniCard({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
