import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import api from '../services/api';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const cavIcon = (color) => new L.DivIcon({
  html: `<div style="background:${color};color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)">📍</div>`,
  className: '', iconSize: [28, 28], iconAnchor: [14, 14],
});

const myIcon = new L.DivIcon({
  html: '<div style="background:#3B82F6;border-radius:50%;width:16px;height:16px;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
  className: '', iconSize: [16, 16], iconAnchor: [8, 8],
});

export default function TourMap() {
  const [tour, setTour] = useState(null);
  const [cavs, setCavs] = useState([]);
  const [currentCavIndex, setCurrentCavIndex] = useState(0);
  const [myPosition, setMyPosition] = useState(null);
  const socketRef = useRef(null);
  const watchRef = useRef(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    loadTour();
    startGPS();
    connectSocket();
    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const loadTour = async () => {
    try {
      const res = await api.get(`/tours/${tourId}`);
      setTour(res.data);
      setCavs(res.data.cavs || []);
      const visitedCount = (res.data.cavs || []).filter(c => c.status === 'collected').length;
      setCurrentCavIndex(visitedCount);
    } catch (err) { console.error(err); }
  };

  const startGPS = () => {
    if ('geolocation' in navigator) {
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => setMyPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }
  };

  const connectSocket = () => {
    const token = localStorage.getItem('mobile_token');
    const socket = io(window.location.origin, { auth: { token } });
    socketRef.current = socket;

    // Send GPS position every 10 seconds
    setInterval(() => {
      if (myPosition && socketRef.current) {
        socketRef.current.emit('gps:position', {
          tour_id: parseInt(tourId),
          latitude: myPosition.lat,
          longitude: myPosition.lng,
          speed: 0,
        });
      }
    }, 10000);
  };

  const goToCAV = () => {
    if (cavs[currentCavIndex]) {
      navigate('/qr-scanner');
    }
  };

  const currentCAV = cavs[currentCavIndex];
  const center = myPosition || (currentCAV ? [currentCAV.latitude, currentCAV.longitude] : [49.4231, 1.0993]);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-solidata-green text-white p-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-bold">Tournée #{tourId}</h1>
          <p className="text-white/70 text-xs">{currentCavIndex}/{cavs.length} CAV collectés</p>
        </div>
        <button onClick={() => navigate('/return-centre')} className="bg-white/20 rounded-lg px-3 py-1.5 text-sm">
          Retour centre
        </button>
      </header>

      {/* Progress */}
      <div className="h-1 bg-gray-200 flex-shrink-0">
        <div className="h-1 bg-solidata-green transition-all" style={{ width: `${cavs.length > 0 ? (currentCavIndex / cavs.length) * 100 : 0}%` }} />
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* My position */}
          {myPosition && (
            <Marker position={[myPosition.lat, myPosition.lng]} icon={myIcon}>
              <Popup>Ma position</Popup>
            </Marker>
          )}

          {/* CAV markers */}
          {cavs.map((cav, i) => {
            const color = cav.status === 'collected' ? '#22C55E' : i === currentCavIndex ? '#EF4444' : '#9CA3AF';
            if (!cav.latitude || !cav.longitude) return null;
            return (
              <Marker key={i} position={[cav.latitude, cav.longitude]} icon={cavIcon(color)}>
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold">#{i + 1} {cav.nom || cav.cav_name}</p>
                    <p>{cav.commune}</p>
                    <p>{cav.status === 'collected' ? '✅ Collecté' : 'En attente'}</p>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Route line */}
          {cavs.filter(c => c.latitude && c.longitude).length > 1 && (
            <Polyline
              positions={cavs.filter(c => c.latitude && c.longitude).map(c => [c.latitude, c.longitude])}
              pathOptions={{ color: '#8BC540', weight: 3, dashArray: '10,6' }}
            />
          )}
        </MapContainer>
      </div>

      {/* Bottom CAV card */}
      {currentCAV && (
        <div className="bg-white border-t shadow-lg p-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs text-gray-400">Prochain point #{currentCavIndex + 1}</p>
              <h3 className="font-bold">{currentCAV.nom || currentCAV.cav_name}</h3>
              <p className="text-xs text-gray-500">{currentCAV.commune} — {currentCAV.adresse || ''}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-orange-600 font-bold">{Math.round(currentCAV.estimated_fill_rate || 0)}%</span>
              <p className="text-[10px] text-gray-400">remplissage</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={goToCAV} className="flex-1 bg-solidata-green text-white font-bold py-3 rounded-xl">
              Scanner QR Code
            </button>
            <button onClick={() => navigate('/incident')} className="bg-red-500 text-white font-bold py-3 px-4 rounded-xl">
              ⚠️
            </button>
          </div>
        </div>
      )}

      {!currentCAV && cavs.length > 0 && (
        <div className="bg-green-50 border-t p-4 flex-shrink-0 text-center">
          <p className="text-green-700 font-bold">Tous les CAV ont été collectés !</p>
          <button onClick={() => navigate('/return-centre')} className="mt-2 bg-solidata-green text-white font-bold py-3 px-6 rounded-xl">
            Retour au centre de tri
          </button>
        </div>
      )}
    </div>
  );
}
