import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [mapRes, communeRes] = await Promise.all([
        api.get('/cav/map'),
        api.get('/cav/communes'),
      ]);
      setCavs(mapRes.data);
      setCommunes(communeRes.data);
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

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Carte des CAV</h1>
            <p className="text-gray-500">{filtered.length} Conteneurs d'Apport Volontaire</p>
          </div>
          <div className="flex gap-2 items-center">
            <select value={filterCommune} onChange={e => setFilterCommune(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              <option value="">Toutes les communes</option>
              {communes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {/* Legend */}
            <div className="flex gap-2 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500"></span>&gt;80%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500"></span>40-80%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500"></span>&lt;40%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Map */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border overflow-hidden" style={{ height: '70vh' }}>
            <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {/* Centre de tri */}
              <Marker position={center}>
                <Popup><strong>Centre de tri — Solidarité Textiles</strong></Popup>
              </Marker>

              {filtered.map(cav => {
                if (!cav.latitude || !cav.longitude) return null;
                const fillRate = cav.estimated_fill_rate || 0;
                return (
                  <Circle
                    key={cav.id}
                    center={[cav.latitude, cav.longitude]}
                    radius={200}
                    pathOptions={{
                      color: getFillColor(fillRate),
                      fillColor: getFillColor(fillRate),
                      fillOpacity: 0.5,
                    }}
                    eventHandlers={{ click: () => loadCavDetail(cav.id) }}
                  >
                    <Popup>
                      <div className="text-xs">
                        <p className="font-bold">{cav.nom}</p>
                        <p>{cav.commune}</p>
                        <p>Remplissage estimé : {Math.round(fillRate)}%</p>
                        <p>Conteneurs : {cav.nb_conteneurs || '—'}</p>
                      </div>
                    </Popup>
                  </Circle>
                );
              })}
            </MapContainer>
          </div>

          {/* Sidebar */}
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {selectedCav ? (
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <button onClick={() => setSelectedCav(null)} className="text-solidata-green text-xs hover:underline mb-2">← Retour</button>
                <h3 className="font-bold text-lg mb-2">{selectedCav.nom}</h3>
                <div className="space-y-2 text-sm">
                  <p><span className="text-gray-500">Commune :</span> {selectedCav.commune}</p>
                  <p><span className="text-gray-500">Adresse :</span> {selectedCav.adresse || '—'}</p>
                  <p><span className="text-gray-500">Conteneurs :</span> {selectedCav.nb_conteneurs || '—'}</p>
                  <p><span className="text-gray-500">Type :</span> {selectedCav.type_conteneur || '—'}</p>
                  <p><span className="text-gray-500">QR Code :</span> {selectedCav.qr_code || '—'}</p>
                  <p><span className="text-gray-500">Actif :</span> {selectedCav.is_active ? 'Oui' : 'Non'}</p>
                </div>
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-sm text-gray-500">Liste des CAV</h3>
                {filtered.map(cav => (
                  <div
                    key={cav.id}
                    onClick={() => loadCavDetail(cav.id)}
                    className="bg-white rounded-lg shadow-sm border p-3 cursor-pointer hover:shadow-md transition"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{cav.nom}</p>
                        <p className="text-xs text-gray-400">{cav.commune}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold" style={{ color: getFillColor(cav.estimated_fill_rate || 0) }}>
                          {Math.round(cav.estimated_fill_rate || 0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
