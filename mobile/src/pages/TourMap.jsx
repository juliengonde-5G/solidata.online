import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const intervalRef = useRef(null);
  const positionRef = useRef(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    loadTour();
    startGPS();
    connectSocket();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const loadTour = async () => {
    try {
      const res = await fetch(`/api/tours/${tourId}/public`);
      const data = await res.json();
      setTour(data);
      setCavs(data.cavs || []);
      const visitedCount = (data.cavs || []).filter(c => c.status === 'collected').length;
      setCurrentCavIndex(visitedCount);
    } catch (err) { console.error(err); }
  };

  const startGPS = () => {
    if ('geolocation' in navigator) {
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMyPosition(newPos);
          positionRef.current = newPos;
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }
  };

  const connectSocket = () => {
    const vehicleId = localStorage.getItem('selected_vehicle_id');
    const token = localStorage.getItem('mobile_token');
    if (!token) {
      console.warn('[TourMap] Pas de token — GPS temps réel désactivé');
      return;
    }
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      if (tourId) socket.emit('join-tour', parseInt(tourId));
    });
    socket.on('connect_error', (err) => {
      console.warn('[TourMap] Socket.IO connect_error:', err.message);
    });

    // Envoi de la position GPS toutes les 10 secondes
    // Event name aligné sur backend/src/index.js (gps-update)
    intervalRef.current = setInterval(() => {
      if (positionRef.current && socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('gps-update', {
          tourId: parseInt(tourId),
          vehicleId: parseInt(vehicleId) || null,
          latitude: positionRef.current.lat,
          longitude: positionRef.current.lng,
          speed: 0,
        });
      }
    }, 10000);
  };

  const isAssociationTour = tour?.collection_type === 'association';

  const goToCAV = () => {
    if (cavs[currentCavIndex]) {
      const cav = cavs[currentCavIndex];
      localStorage.setItem('selected_cav_id', String(cav.cav_id || cav.id));
      if (isAssociationTour) {
        // Pas de scan QR pour la collecte association → directement au remplissage
        navigate('/fill-level');
      } else {
        navigate('/qr-scanner');
      }
    }
  };

  const intermediateReturn = async () => {
    // Retour intermédiaire : pesée partielle puis reprise de la collecte
    localStorage.setItem('intermediate_return', 'true');
    navigate('/weigh-in');
  };

  const openNavigation = (lat, lng) => {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
  };

  const currentCAV = cavs[currentCavIndex];
  const center = myPosition || (currentCAV ? [currentCAV.latitude, currentCAV.longitude] : [49.4231, 1.0993]);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-surface-2)]">
      <header className="screen-header flex-shrink-0 flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-lg">Tournée #{tourId}</h1>
          <p className="text-white/80 text-sm">{currentCavIndex}/{cavs.length} {isAssociationTour ? 'associations' : 'CAV'} collectés</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            aria-label="Pesée intermédiaire"
            onClick={intermediateReturn}
            className="touch-target flex items-center justify-center rounded-xl bg-amber-500/80 hover:bg-amber-500 text-xs font-medium px-3"
          >
            Pesée
          </button>
          <button
            type="button"
            aria-label="Fin de tournée, retour au centre"
            onClick={() => navigate('/return-centre')}
            className="touch-target flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-sm font-medium px-3"
          >
            Fin
          </button>
        </div>
      </header>
      <div className="h-2 bg-white/20 flex-shrink-0">
        <div className="h-full bg-white rounded-r-full transition-all duration-300" style={{ width: `${cavs.length > 0 ? (currentCavIndex / cavs.length) * 100 : 0}%` }} />
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

      {currentCAV && (
        <div className="relative z-20 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] p-4 flex-shrink-0 safe-bottom">
          <div className="flex items-center justify-between mb-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400">Prochain point #{currentCavIndex + 1}</p>
              <h3 className="font-bold text-gray-900 truncate">{currentCAV.nom || currentCAV.cav_name}</h3>
              <p className="text-xs text-gray-500 truncate">{currentCAV.commune}</p>
            </div>
            <div className="text-right flex-shrink-0 ml-2">
              {isAssociationTour && currentCAV.contact_phone ? (
                <a href={`tel:${currentCAV.contact_phone.replace(/\s/g, '')}`} className="text-sm font-bold text-blue-600 underline">
                  {currentCAV.contact_phone}
                </a>
              ) : (
                <>
                  <span className="text-sm font-bold text-amber-600">{Math.round(currentCAV.predicted_fill_rate || currentCAV.estimated_fill_rate || 0)}%</span>
                  <p className="text-[10px] text-gray-400">remplissage</p>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            {currentCAV.latitude && currentCAV.longitude && (
              <button
                type="button"
                aria-label="Naviguer vers le CAV"
                onClick={() => openNavigation(currentCAV.latitude, currentCAV.longitude)}
                className="touch-target flex items-center justify-center bg-blue-500 text-white rounded-2xl px-4 font-semibold"
              >
                Naviguer
              </button>
            )}
            <button type="button" onClick={goToCAV} className="flex-1 btn-primary-mobile py-3 text-base">
              {isAssociationTour ? 'Collecter' : 'Scanner QR Code'}
            </button>
            <button type="button" aria-label="Signaler un incident" onClick={() => navigate('/incident')} className="touch-target flex items-center justify-center bg-red-500 text-white rounded-2xl px-4 font-semibold">
              Incident
            </button>
          </div>
        </div>
      )}

      {!currentCAV && cavs.length > 0 && (
        <div className="relative z-20 bg-green-50 border-t border-green-200 p-4 flex-shrink-0 text-center safe-bottom">
          <p className="text-green-800 font-bold">Tous les {isAssociationTour ? 'points association' : 'CAV'} ont été collectés !</p>
          <div className="flex gap-3 mt-3">
            <button type="button" onClick={() => navigate('/return-centre')} className="flex-1 btn-primary-mobile py-3">
              Retour au centre de tri
            </button>
            <button type="button" onClick={() => navigate('/incident')} className="touch-target flex items-center justify-center bg-red-500 text-white rounded-2xl px-4 font-semibold">
              Incident
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
