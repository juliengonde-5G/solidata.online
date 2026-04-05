import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const truckIcon = new L.DivIcon({
  html: '<div style="background:#8BC540;color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">🚛</div>',
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

export default function LiveVehicles() {
  const [activeTours, setActiveTours] = useState([]);
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(true);
  const socketRef = useRef(null);

  useEffect(() => {
    loadActiveTours();
    connectSocket();
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const loadActiveTours = async () => {
    try {
      const res = await api.get('/tours?status=in_progress');
      setActiveTours(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const connectSocket = () => {
    const token = localStorage.getItem('token');
    const socket = io(window.location.origin, { auth: { token } });
    socketRef.current = socket;

    socket.on('gps:update', (data) => {
      setPositions(prev => ({
        ...prev,
        [data.tour_id]: {
          lat: data.latitude,
          lng: data.longitude,
          speed: data.speed,
          timestamp: data.timestamp,
          trail: [...(prev[data.tour_id]?.trail || []), [data.latitude, data.longitude]].slice(-100),
        },
      }));
    });

    socket.on('connect_error', () => {
      console.log('Socket connection error');
    });
  };

  const center = [49.4231, 1.0993];

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des véhicules..." /></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Suivi en direct</h1>
            <p className="text-gray-500">{activeTours.length} tournée{activeTours.length > 1 ? 's' : ''} en cours</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-xs text-gray-500">Temps réel via GPS</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Map */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border overflow-hidden" style={{ height: '75vh' }}>
            <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {/* Centre de tri */}
              <Marker position={center}>
                <Popup><strong>Centre de tri</strong></Popup>
              </Marker>

              {/* Active vehicles */}
              {activeTours.map(tour => {
                const pos = positions[tour.id];
                if (!pos) return null;
                return (
                  <div key={tour.id}>
                    <Marker position={[pos.lat, pos.lng]} icon={truckIcon}>
                      <Popup>
                        <div className="text-xs">
                          <p className="font-bold">{tour.registration}</p>
                          <p>{tour.driver_name}</p>
                          <p>Vitesse : {pos.speed ? `${Math.round(pos.speed)} km/h` : '—'}</p>
                          <p className="text-gray-400">{pos.timestamp ? new Date(pos.timestamp).toLocaleTimeString('fr-FR') : ''}</p>
                        </div>
                      </Popup>
                    </Marker>
                    {pos.trail && pos.trail.length > 1 && (
                      <Polyline positions={pos.trail} pathOptions={{ color: '#8BC540', weight: 3, opacity: 0.7 }} />
                    )}
                  </div>
                );
              })}
            </MapContainer>
          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-gray-500">Tournées actives</h3>
            {activeTours.map(tour => {
              const pos = positions[tour.id];
              return (
                <div key={tour.id} className="bg-white rounded-xl shadow-sm border p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg">🚛</span>
                    <div>
                      <p className="font-bold text-sm">{tour.registration}</p>
                      <p className="text-xs text-gray-400">{tour.driver_name}</p>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Statut</span>
                      <span className="text-orange-600 font-medium">En cours</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">CAV visités</span>
                      <span>{tour.nb_cav_visited || 0} / {tour.nb_cav || 0}</span>
                    </div>
                    {pos && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Vitesse</span>
                          <span>{pos.speed ? `${Math.round(pos.speed)} km/h` : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Dernière MAJ</span>
                          <span>{pos.timestamp ? new Date(pos.timestamp).toLocaleTimeString('fr-FR') : '—'}</span>
                        </div>
                      </>
                    )}
                    {!pos && (
                      <p className="text-gray-400 text-center py-2">En attente du signal GPS...</p>
                    )}
                  </div>
                </div>
              );
            })}
            {activeTours.length === 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 text-sm">
                Aucune tournée en cours
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
