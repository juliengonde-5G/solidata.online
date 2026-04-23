import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import 'leaflet/dist/leaflet.css';

function getFillColor(rate) {
  if (rate >= 80) return '#EF4444'; // Rouge — critique
  if (rate >= 60) return '#F97316'; // Orange — élevé
  if (rate >= 40) return '#F59E0B'; // Jaune — moyen
  return '#22C55E';                  // Vert — OK
}

function getFillLabel(rate) {
  if (rate >= 80) return 'Critique';
  if (rate >= 60) return 'Élevé';
  if (rate >= 40) return 'Moyen';
  return 'Faible';
}

function getFillBg(rate) {
  if (rate >= 80) return 'bg-red-100 text-red-700';
  if (rate >= 60) return 'bg-orange-100 text-orange-700';
  if (rate >= 40) return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
}

export default function FillRateMap() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCav, setSelectedCav] = useState(null);
  const [activityData, setActivityData] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all, critical, warning, ok
  const [sortBy, setSortBy] = useState('fill_rate'); // fill_rate, days_to_full, name
  const [assoPoints, setAssoPoints] = useState([]);
  const [showAsso, setShowAsso] = useState(true);

  useEffect(() => { loadData(); }, []);

  // Charger l'histogramme d'activite quand un CAV est selectionne
  useEffect(() => {
    if (!selectedCav) { setActivityData(null); return; }
    let cancelled = false;
    setActivityLoading(true);
    api.get(`/cav/${selectedCav.id}/activity`)
      .then(res => { if (!cancelled) setActivityData(res.data); })
      .catch(() => { if (!cancelled) setActivityData(null); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCav?.id]);

  const loadData = async () => {
    try {
      const [res, assoRes] = await Promise.all([
        api.get('/cav/fill-rate'),
        api.get('/association-points/map'),
      ]);
      setData(res.data);
      setAssoPoints(assoRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de la carte..." /></Layout>;
  if (!data) return <Layout><div className="p-6 text-red-500">Erreur de chargement</div></Layout>;

  const filtered = data.cavs.filter(c => {
    if (filter === 'critical') return c.fill_rate >= 80;
    if (filter === 'warning') return c.fill_rate >= 40 && c.fill_rate < 80;
    if (filter === 'ok') return c.fill_rate < 40;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'fill_rate') return b.fill_rate - a.fill_rate;
    if (sortBy === 'days_to_full') return (a.days_to_full ?? 999) - (b.days_to_full ?? 999);
    return a.name.localeCompare(b.name);
  });

  const center = [49.4231, 1.0993];

  return (
    <Layout>
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Taux de remplissage CAV</h1>
            <p className="text-gray-500 text-sm">Estimation en temps réel et prévisions</p>
          </div>
          <button onClick={loadData} className="btn-primary text-sm">
            Actualiser
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button onClick={() => setFilter('all')}
            className={`rounded-xl border p-4 text-left transition ${filter === 'all' ? 'ring-2 ring-primary' : ''}`}>
            <p className="text-xs text-gray-500 uppercase font-medium">Total CAV</p>
            <p className="text-3xl font-bold mt-1">{data.stats.total}</p>
          </button>
          <button onClick={() => setFilter('critical')}
            className={`rounded-xl border p-4 text-left bg-red-50 border-red-200 transition ${filter === 'critical' ? 'ring-2 ring-red-500' : ''}`}>
            <p className="text-xs text-red-600 uppercase font-medium">Critique (&gt;80%)</p>
            <p className="text-3xl font-bold text-red-700 mt-1">{data.stats.critical}</p>
          </button>
          <button onClick={() => setFilter('warning')}
            className={`rounded-xl border p-4 text-left bg-amber-50 border-amber-200 transition ${filter === 'warning' ? 'ring-2 ring-amber-500' : ''}`}>
            <p className="text-xs text-amber-600 uppercase font-medium">Attention (40-80%)</p>
            <p className="text-3xl font-bold text-amber-700 mt-1">{data.stats.warning}</p>
          </button>
          <button onClick={() => setFilter('ok')}
            className={`rounded-xl border p-4 text-left bg-green-50 border-green-200 transition ${filter === 'ok' ? 'ring-2 ring-green-500' : ''}`}>
            <p className="text-xs text-green-600 uppercase font-medium">OK (&lt;40%)</p>
            <p className="text-3xl font-bold text-green-700 mt-1">{data.stats.ok}</p>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Carte */}
          <div className="lg:col-span-2 card-modern overflow-hidden relative" style={{ height: '65vh' }}>
            <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {/* Association points */}
              {showAsso && assoPoints.map(ap => {
                if (!ap.latitude || !ap.longitude) return null;
                return (
                  <CircleMarker
                    key={`asso-${ap.id}`}
                    center={[ap.latitude, ap.longitude]}
                    radius={7}
                    pathOptions={{ color: '#EA580C', fillColor: '#FB923C', fillOpacity: 0.85, weight: 2 }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1">
                        <p className="font-bold text-sm text-orange-700">{ap.name}</p>
                        <p className="text-gray-500">{ap.address}{ap.ville ? `, ${ap.ville}` : ''}</p>
                        {ap.contact_phone && <p>Tél : {ap.contact_phone}</p>}
                        <p className="text-orange-600 font-medium">Point associatif</p>
                        {ap.last_collection && <p>Dernière collecte : {new Date(ap.last_collection).toLocaleDateString('fr-FR')}</p>}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {filtered.map(cav => (
                <CircleMarker
                  key={cav.id}
                  center={[cav.latitude, cav.longitude]}
                  radius={Math.max(8, Math.min(16, cav.fill_rate / 8))}
                  pathOptions={{
                    color: getFillColor(cav.fill_rate),
                    fillColor: getFillColor(cav.fill_rate),
                    fillOpacity: 0.7,
                    weight: 2,
                  }}
                  eventHandlers={{ click: () => setSelectedCav(cav) }}
                >
                  <Popup>
                    <div className="text-xs space-y-1">
                      <p className="font-bold text-sm">{cav.name}</p>
                      <p className="text-gray-500">{cav.commune}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: getFillColor(cav.fill_rate) }} />
                        <span className="font-bold">{cav.fill_rate}% rempli</span>
                      </div>
                      <p>Conteneurs : {cav.nb_containers}</p>
                      <p>Dernière collecte : {cav.last_collection ? new Date(cav.last_collection).toLocaleDateString('fr-FR') : '—'}</p>
                      <p>Prochain passage : {cav.next_passage === 'en retard'
                        ? <span className="text-red-600 font-bold">En retard</span>
                        : cav.next_passage ? new Date(cav.next_passage).toLocaleDateString('fr-FR') : '—'}</p>
                      {cav.days_to_full != null && cav.days_to_full > 0 && (
                        <p>Plein dans : <span className="font-bold">{cav.days_to_full}j</span></p>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>

            {/* Légende */}
            <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 rounded-lg shadow-md p-3 text-xs space-y-1">
              <p className="font-semibold mb-1">Taux de remplissage</p>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500" /> &gt;80% Critique</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-500" /> 60-80% Élevé</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-500" /> 40-60% Moyen</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500" /> &lt;40% Faible</div>
              <hr className="border-gray-200 my-1" />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showAsso} onChange={e => setShowAsso(e.target.checked)} className="rounded" />
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FB923C' }} />
                Associations ({assoPoints.filter(a => a.latitude).length})
              </label>
            </div>
          </div>

          {/* Sidebar — Liste triée */}
          <div className="space-y-3">
            {/* Tri */}
            <div className="flex gap-1">
              <button onClick={() => setSortBy('fill_rate')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${sortBy === 'fill_rate' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
                Par remplissage
              </button>
              <button onClick={() => setSortBy('days_to_full')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${sortBy === 'days_to_full' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
                Par urgence
              </button>
              <button onClick={() => setSortBy('name')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${sortBy === 'name' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
                A-Z
              </button>
            </div>

            {/* Détail sélectionné */}
            {selectedCav && (
              <div className="card-modern p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold">{selectedCav.name}</h3>
                    <p className="text-xs text-gray-500">{selectedCav.address} — {selectedCav.commune}</p>
                  </div>
                  <button onClick={() => setSelectedCav(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                </div>

                {/* Jauge de remplissage */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span>Remplissage estimé</span>
                    <span className="font-bold" style={{ color: getFillColor(selectedCav.fill_rate) }}>{selectedCav.fill_rate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div className="h-3 rounded-full transition-all" style={{ width: `${Math.min(100, selectedCav.fill_rate)}%`, backgroundColor: getFillColor(selectedCav.fill_rate) }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoCell label="Conteneurs" value={selectedCav.nb_containers} />
                  <InfoCell label="Tournée" value={selectedCav.tournee || '—'} />
                  <InfoCell label="Jours collecte" value={selectedCav.jours_collecte || '—'} />
                  <InfoCell label="Dernière collecte" value={selectedCav.last_collection ? `Il y a ${selectedCav.days_since_collection}j` : '—'} />
                  <InfoCell label="Moy. 90j" value={`${selectedCav.avg_weight_90d} kg`} />
                  <InfoCell label="Collectes 90j" value={selectedCav.nb_collectes_90d} />
                  <InfoCell label="Accum./jour" value={`${selectedCav.daily_accumulation_kg} kg`} />
                  <InfoCell label="Plein dans" value={selectedCav.days_to_full != null ? `${selectedCav.days_to_full}j` : '—'} highlight={selectedCav.days_to_full != null && selectedCav.days_to_full <= 3} />
                </div>

                {/* Prochain passage */}
                <div className="mt-3 p-2 rounded-lg bg-gray-50 text-xs">
                  <span className="text-gray-500">Prochain passage : </span>
                  {selectedCav.next_passage === 'en retard' ? (
                    <span className="font-bold text-red-600">EN RETARD — collecte urgente</span>
                  ) : selectedCav.next_passage ? (
                    <span className="font-bold">{new Date(selectedCav.next_passage).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  ) : (
                    <span className="text-gray-400">Non planifié</span>
                  )}
                </div>

                {selectedCav.predicted_full_date && (
                  <div className="mt-2 p-2 rounded-lg text-xs" style={{ backgroundColor: getFillColor(selectedCav.fill_rate) + '15', color: getFillColor(selectedCav.fill_rate) }}>
                    Prévision plein (80%) : <span className="font-bold">{new Date(selectedCav.predicted_full_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  </div>
                )}

                {/* Histogramme activite -10j / +10j */}
                <div className="mt-3 pt-3 border-t">
                  <h4 className="text-xs font-semibold text-gray-700 mb-2">Activité : historique & prévision</h4>
                  {activityLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
                    </div>
                  ) : activityData?.jours ? (
                    <div>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={activityData.jours.map(j => ({
                          ...j,
                          label: new Date(j.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
                          shortLabel: new Date(j.date).getDate().toString(),
                        }))} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                          <XAxis dataKey="shortLabel" tick={{ fontSize: 9 }} interval={1} />
                          <YAxis tick={{ fontSize: 9 }} unit="%" domain={[0, 120]} />
                          <Tooltip
                            contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            formatter={(value, name) => {
                              if (name === 'fill_pct') return [`${value}%`, 'Remplissage'];
                              if (name === 'collecte_kg') return [`${value} kg`, 'Collecte'];
                              return [value, name];
                            }}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ''}
                          />
                          <ReferenceLine y={80} stroke="#EF4444" strokeDasharray="3 3" strokeWidth={1} />
                          <Bar dataKey="fill_pct" radius={[2, 2, 0, 0]} maxBarSize={12}>
                            {activityData.jours.map((j, i) => (
                              <Cell
                                key={i}
                                fill={j.type === 'prevision' ? '#93C5FD' : '#0D9488'}
                                fillOpacity={j.collecte_kg > 0 ? 1 : 0.7}
                                stroke={j.collecte_kg > 0 ? '#16A34A' : 'none'}
                                strokeWidth={j.collecte_kg > 0 ? 2 : 0}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex items-center justify-center gap-4 text-[10px] text-gray-500 mt-1">
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary" /> Historique</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#93C5FD]" /> Prévision</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-red-500" /> Seuil 80%</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 text-center py-2">Données non disponibles</p>
                  )}
                </div>
              </div>
            )}

            {/* Liste des CAV */}
            <div className="max-h-[50vh] overflow-y-auto space-y-1">
              {filtered.map(cav => (
                <button
                  key={cav.id}
                  onClick={() => setSelectedCav(cav)}
                  className={`w-full text-left bg-white rounded-lg border p-3 hover:shadow-md transition ${
                    selectedCav?.id === cav.id ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{cav.name}</p>
                      <p className="text-xs text-gray-400">{cav.commune}</p>
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${getFillBg(cav.fill_rate)}`}>
                        {cav.fill_rate}%
                      </span>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {cav.next_passage === 'en retard' ? (
                          <span className="text-red-500">En retard</span>
                        ) : cav.days_to_full != null ? (
                          `Plein: ${cav.days_to_full}j`
                        ) : ''}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function InfoCell({ label, value, highlight }) {
  return (
    <div className={`p-2 rounded-lg ${highlight ? 'bg-red-50' : 'bg-gray-50'}`}>
      <p className="text-gray-500 text-[10px] uppercase">{label}</p>
      <p className={`font-bold ${highlight ? 'text-red-600' : ''}`}>{value}</p>
    </div>
  );
}
