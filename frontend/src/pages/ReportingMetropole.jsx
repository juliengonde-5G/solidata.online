import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function ReportingMetropole() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [dashboard, setDashboard] = useState(null);
  const [cavList, setCavList] = useState([]);
  const [selectedCav, setSelectedCav] = useState(null);
  const [cavDetail, setCavDetail] = useState(null);
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
    try {
      const r = await api.get(`/metropole/cav/${cav.id}/details`);
      setCavDetail(r.data);
    } catch (err) { console.error(err); setCavDetail(null); }
  };

  const d = dashboard;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reporting Métropole de Rouen</h1>
            <p className="text-sm text-gray-500">Suivi des indicateurs environnementaux et sociaux</p>
          </div>
          <div className="flex gap-2 items-center">
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
              {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-solidata-green" /></div>
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
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-4">Évolution mensuelle du tonnage collecté</h3>
                <div className="flex items-end gap-1 h-48">
                  {d.historique_mensuel.map((h, i) => {
                    const maxKg = Math.max(...d.historique_mensuel.map(x => parseFloat(x.total_kg)));
                    const pct = maxKg > 0 ? (parseFloat(h.total_kg) / maxKg) * 100 : 0;
                    const moisLabel = new Date(h.mois).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[10px] text-gray-500 font-medium">{(parseFloat(h.total_kg) / 1000).toFixed(1)}t</span>
                        <div className="w-full bg-solidata-green/80 rounded-t" style={{ height: `${Math.max(pct, 2)}%` }} />
                        <span className="text-[10px] text-gray-400">{moisLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Carte des CAV */}
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold mb-4">Carte des Conteneurs d'Apport Volontaire</h3>

              {/* Carte Leaflet */}
              <div className="rounded-lg overflow-hidden border mb-4" style={{ height: '400px' }}>
                <MapContainer center={[49.4231, 1.0993]} zoom={11} style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {cavList.filter(c => c.latitude && c.longitude).map(c => (
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
                  {cavList.map(c => (
                    <button key={c.id} onClick={() => openCavDetail(c)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                        selectedCav?.id === c.id ? 'bg-solidata-green/10 border border-solidata-green' : 'hover:bg-gray-50 border border-transparent'
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
                    <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-solidata-green" /></div>
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

                      {/* Graphique historique */}
                      {cavDetail.collection_history?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Historique des collectes</p>
                          <div className="flex items-end gap-0.5 h-32 bg-gray-50 rounded-lg p-2">
                            {cavDetail.collection_history.slice(0, 30).reverse().map((h, i) => {
                              const maxW = Math.max(...cavDetail.collection_history.slice(0, 30).map(x => parseFloat(x.weight_kg)));
                              const pct = maxW > 0 ? (parseFloat(h.weight_kg) / maxW) * 100 : 0;
                              return (
                                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${new Date(h.date).toLocaleDateString('fr-FR')}: ${h.weight_kg}kg`}>
                                  <div className="w-full bg-blue-400 rounded-t min-h-[2px]" style={{ height: `${Math.max(pct, 2)}%` }} />
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-2">
                            <span>Plus ancien</span>
                            <span>Récent</span>
                          </div>
                        </div>
                      )}

                      {/* Niveaux de remplissage constatés lors des collectes */}
                      {cavDetail.fill_history?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Niveau de remplissage constaté par le chauffeur à chaque collecte</p>
                          <div className="flex items-end gap-0.5 h-24 bg-gray-50 rounded-lg p-2">
                            {cavDetail.fill_history.slice(0, 20).reverse().map((f, i) => {
                              const pct = f.fill_level ? (f.fill_level / 5) * 100 : 0;
                              const color = pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-yellow-400' : 'bg-green-400';
                              return (
                                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${new Date(f.date).toLocaleDateString('fr-FR')}: niveau ${f.fill_level}/5`}>
                                  <div className={`w-full ${color} rounded-t min-h-[2px]`} style={{ height: `${Math.max(pct, 4)}%` }} />
                                </div>
                              );
                            })}
                          </div>
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
            </div>
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
