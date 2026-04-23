import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';
import useCavSensorSocket from '../hooks/useCavSensorSocket';
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const FILL_COLORS = {
  high: '#EF4444',   // >80%
  medium: '#F59E0B', // 40-80%
  low: '#22C55E',    // <40%
};

function getFillColor(rate) {
  if (rate >= 80) return FILL_COLORS.high;
  if (rate >= 40) return FILL_COLORS.medium;
  return FILL_COLORS.low;
}

export default function CAVMap() {
  const [cavs, setCavs] = useState([]);
  const [selectedCav, setSelectedCav] = useState(null);
  const [loading, setLoading] = useState(true);
  const [communes, setCommunes] = useState([]);
  const [filterCommune, setFilterCommune] = useState('');
  const [assoPoints, setAssoPoints] = useState([]);
  const [showAsso, setShowAsso] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  // Mise à jour optimiste des CAV sur event capteur temps réel
  const handleSensorReading = useCallback((reading) => {
    setCavs((prev) => prev.map((c) => (
      c.id === reading.cav_id
        ? {
            ...c,
            fill_rate: Math.round(reading.fill_level),
            fill_source: 'sensor',
            sensor_last_reading: reading.fill_level,
            sensor_last_reading_at: reading.timestamp,
            sensor_battery_level: reading.battery,
            sensor_last_rssi: reading.rssi,
          }
        : c
    )));
  }, []);
  useCavSensorSocket(handleSensorReading);

  const loadData = async () => {
    try {
      const [mapRes, communeRes, assoRes] = await Promise.all([
        api.get('/cav/map'),
        api.get('/cav/communes'),
        api.get('/association-points/map'),
      ]);
      setCavs(mapRes.data);
      setCommunes(communeRes.data);
      setAssoPoints(assoRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadCavDetail = async (id) => {
    try {
      const res = await api.get(`/cav/${id}`);
      setSelectedCav(res.data);
    } catch (err) { console.error(err); }
  };

  const filtered = filterCommune
    ? cavs.filter(c => c.commune === filterCommune)
    : cavs;

  // Centre Rouen
  const center = [49.4231, 1.0993];

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de la carte..." /></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Carte des CAV</h1>
            <p className="text-gray-500">{filtered.length} Conteneurs d'Apport Volontaire</p>
            <p className="text-xs text-amber-600 italic mt-1">
              Remplissage : <span className="text-green-700">capteur LoRaWAN 📡</span> quand disponible, sinon <span>estimation algorithmique</span>.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <select value={filterCommune} onChange={e => setFilterCommune(e.target.value)} className="select-modern w-auto">
              <option value="">Toutes les communes</option>
              {communes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {/* Legend */}
            <div className="flex gap-2 text-xs flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500"></span>&gt;80%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500"></span>40-80%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500"></span>&lt;40%</span>
              <label className="flex items-center gap-1 ml-2 cursor-pointer">
                <input type="checkbox" checked={showAsso} onChange={e => setShowAsso(e.target.checked)} />
                <span className="w-3 h-3 rounded-sm bg-orange-500"></span>Associations ({assoPoints.filter(a => a.latitude).length})
              </label>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Map */}
          <div className="lg:col-span-2 card-modern overflow-hidden" style={{ height: '70vh' }}>
            <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              {/* Centre de tri */}
              <Marker position={center}>
                <Popup><strong>Centre de tri — Solidarité Textiles</strong></Popup>
              </Marker>

              {filtered.map(cav => {
                if (!cav.latitude || !cav.longitude) return null;
                const fillRate = cav.fill_rate ?? cav.estimated_fill_rate ?? 0;
                const isSensor = cav.fill_source === 'sensor';
                return (
                  <Circle
                    key={`cav-${cav.id}`}
                    center={[cav.latitude, cav.longitude]}
                    radius={200}
                    pathOptions={{
                      color: getFillColor(fillRate),
                      fillColor: getFillColor(fillRate),
                      fillOpacity: 0.5,
                      weight: isSensor ? 3 : 1,
                      dashArray: isSensor ? null : '4 4',
                    }}
                    eventHandlers={{ click: () => loadCavDetail(cav.id) }}
                  >
                    <Popup>
                      <div className="text-xs">
                        <p className="font-bold flex items-center gap-1">
                          {cav.name}
                          {isSensor && <span title="Capteur LoRaWAN actif">📡</span>}
                        </p>
                        <p>{cav.commune}</p>
                        <p>
                          Remplissage : <strong>{Math.round(fillRate)}%</strong>{' '}
                          <span className={isSensor ? 'text-green-700' : 'text-amber-600'}>
                            ({isSensor ? 'capteur' : 'estimé'})
                          </span>
                        </p>
                        {isSensor && (
                          <>
                            <p>Batterie : {cav.sensor_battery_level != null ? `${cav.sensor_battery_level}%` : '—'}</p>
                            <p>RSSI : {cav.sensor_last_rssi != null ? `${cav.sensor_last_rssi} dBm` : '—'}</p>
                            <p>Dernière lecture : {cav.sensor_last_reading_at ? new Date(cav.sensor_last_reading_at).toLocaleString('fr-FR') : '—'}</p>
                          </>
                        )}
                        <p>Conteneurs : {cav.nb_containers || '—'}</p>
                      </div>
                    </Popup>
                  </Circle>
                );
              })}

              {/* Points de collecte associatifs */}
              {showAsso && assoPoints.map(ap => {
                if (!ap.latitude || !ap.longitude) return null;
                return (
                  <CircleMarker
                    key={`asso-${ap.id}`}
                    center={[ap.latitude, ap.longitude]}
                    radius={8}
                    pathOptions={{
                      color: '#EA580C',
                      fillColor: '#FB923C',
                      fillOpacity: 0.8,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="text-xs">
                        <p className="font-bold text-orange-700">{ap.name}</p>
                        <p>{ap.address}{ap.ville ? `, ${ap.ville}` : ''}</p>
                        {ap.contact_phone && <p>Tél : {ap.contact_phone}</p>}
                        <p className="text-orange-600 font-medium mt-1">Point associatif</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>

          {/* Sidebar */}
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {selectedCav ? (
              <div className="card-modern p-4">
                <button onClick={() => setSelectedCav(null)} className="text-primary text-xs hover:underline mb-2">← Retour</button>
                <h3 className="font-bold text-lg mb-2">{selectedCav.name}</h3>
                <div className="space-y-2 text-sm">
                  <p><span className="text-gray-500">Commune :</span> {selectedCav.commune}</p>
                  <p><span className="text-gray-500">Adresse :</span> {selectedCav.address || '—'}</p>
                  <p><span className="text-gray-500">Conteneurs :</span> {selectedCav.nb_containers || '—'}</p>
                  <p><span className="text-gray-500">Tournée :</span> {selectedCav.tournee || '—'}</p>
                  <p><span className="text-gray-500">QR Code :</span> {selectedCav.qr_code_data ? 'Oui' : 'Non'}</p>
                  <p><span className="text-gray-500">Statut :</span> {selectedCav.status === 'active' ? 'Actif' : 'Indisponible'}</p>
                </div>
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-sm text-gray-500">Liste des CAV</h3>
                {filtered.map(cav => {
                  const fr = cav.fill_rate ?? cav.estimated_fill_rate ?? 0;
                  return (
                    <div
                      key={cav.id}
                      onClick={() => loadCavDetail(cav.id)}
                      className="card-modern p-3 cursor-pointer hover:shadow-md transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm flex items-center gap-1">
                            {cav.name}
                            {cav.fill_source === 'sensor' && <span title="Capteur LoRaWAN">📡</span>}
                          </p>
                          <p className="text-xs text-gray-400">{cav.commune}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-bold" style={{ color: getFillColor(fr) }}>
                            {Math.round(fr)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
