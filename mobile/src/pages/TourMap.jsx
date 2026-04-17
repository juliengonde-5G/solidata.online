import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import { useUsageMode } from '../contexts/UsageModeContext';
import { USAGE_MODES } from '../services/usageMode';
import UsageModeBanner from '../components/UsageModeBanner';
import PrimaryActionBar from '../components/PrimaryActionBar';

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

const NAV_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);
const IDENTIFY_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M20 14v7M14 17v4" />
  </svg>
);
const INCIDENT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l10 18H2L12 3z" />
    <line x1="12" y1="10" x2="12" y2="14" />
    <circle cx="12" cy="17" r="0.9" fill="currentColor" />
  </svg>
);

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
  const { reportGpsSample, mode } = useUsageMode();

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
          reportGpsSample({ speed: pos.coords.speed, timestamp: pos.timestamp });
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

  const goToIdentify = () => {
    if (cavs[currentCavIndex]) {
      const cav = cavs[currentCavIndex];
      localStorage.setItem('selected_cav_id', String(cav.cav_id || cav.id));
      localStorage.setItem('selected_cav_name', cav.nom || cav.cav_name || '');
      if (isAssociationTour) {
        // Pas de scan QR pour la collecte association → directement au remplissage
        navigate('/fill-level');
      } else {
        navigate('/identify-cav');
      }
    }
  };

  const intermediateReturn = () => {
    localStorage.setItem('intermediate_return', 'true');
    navigate('/weigh-in');
  };

  const openNavigation = () => {
    const cav = cavs[currentCavIndex];
    if (cav?.latitude && cav?.longitude) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${cav.latitude},${cav.longitude}`, '_blank');
    }
  };

  const currentCAV = cavs[currentCavIndex];
  const center = myPosition || (currentCAV ? [currentCAV.latitude, currentCAV.longitude] : [49.4231, 1.0993]);
  const hasCoords = currentCAV?.latitude && currentCAV?.longitude;

  // Configuration de la barre d'action selon le mode d'usage.
  // Une seule CTA visible à la fois. Le secondaire reste simple.
  const actionConfig = (() => {
    if (!currentCAV) return null;
    if (mode === USAGE_MODES.DRIVING) {
      return {
        primaryLabel: 'Naviguer',
        primaryIcon: NAV_ICON,
        onPrimary: openNavigation,
        disabled: !hasCoords,
        secondaryLabel: null,
      };
    }
    if (mode === USAGE_MODES.SHORT_STOP) {
      return {
        primaryLabel: isAssociationTour ? 'Collecter' : 'Identifier le CAV',
        primaryIcon: IDENTIFY_ICON,
        onPrimary: goToIdentify,
        secondaryLabel: 'Incident',
        secondaryIcon: INCIDENT_ICON,
        onSecondary: () => navigate('/incident'),
      };
    }
    // operational_stop (défaut)
    return {
      primaryLabel: isAssociationTour ? 'Collecter' : 'Identifier le CAV',
      primaryIcon: IDENTIFY_ICON,
      onPrimary: goToIdentify,
      secondaryLabel: hasCoords ? 'Naviguer' : null,
      secondaryIcon: hasCoords ? NAV_ICON : null,
      onSecondary: hasCoords ? openNavigation : null,
    };
  })();

  return (
    <div className="h-screen flex flex-col bg-[var(--color-surface-2)]">
      <header className="screen-header flex-shrink-0 flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-lg">Tournée #{tourId}</h1>
          <p className="text-white/80 text-sm">
            {currentCavIndex}/{cavs.length} {isAssociationTour ? 'associations' : 'CAV'} collectés
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <UsageModeBanner onDark />
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
        <div
          className="h-full bg-white rounded-r-full transition-all duration-300"
          style={{ width: `${cavs.length > 0 ? (currentCavIndex / cavs.length) * 100 : 0}%` }}
        />
      </div>

      <div className="flex-1 relative">
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {myPosition && (
            <Marker position={[myPosition.lat, myPosition.lng]} icon={myIcon}>
              <Popup>Ma position</Popup>
            </Marker>
          )}

          {cavs.map((cav, i) => {
            const color = cav.status === 'collected' ? '#22C55E' : i === currentCavIndex ? '#EF4444' : '#9CA3AF';
            if (!cav.latitude || !cav.longitude) return null;
            return (
              <Marker key={cav.cav_id || i} position={[cav.latitude, cav.longitude]} icon={cavIcon(color)}>
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

          {cavs.filter(c => c.latitude && c.longitude).length > 1 && (
            <Polyline
              positions={cavs.filter(c => c.latitude && c.longitude).map(c => [c.latitude, c.longitude])}
              pathOptions={{ color: '#8BC540', weight: 3, dashArray: '10,6' }}
            />
          )}
        </MapContainer>
      </div>

      {currentCAV && actionConfig && (
        <div className="relative z-20 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] flex-shrink-0">
          {/* Carte "Prochain point" — version allégée en conduite */}
          <div className="px-4 pt-3 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Prochain point #{currentCavIndex + 1}
            </p>
            <h3 className="font-bold text-gray-900 truncate text-lg">
              {currentCAV.nom || currentCAV.cav_name}
            </h3>
            {mode !== USAGE_MODES.DRIVING && (
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-gray-500 truncate">{currentCAV.commune}</p>
                {isAssociationTour && currentCAV.contact_phone ? (
                  <a href={`tel:${currentCAV.contact_phone.replace(/\s/g, '')}`} className="text-sm font-bold text-blue-600 underline">
                    {currentCAV.contact_phone}
                  </a>
                ) : (
                  <span className="text-sm font-bold text-amber-600">
                    {Math.round(currentCAV.predicted_fill_rate || currentCAV.estimated_fill_rate || 0)}% remplissage
                  </span>
                )}
              </div>
            )}
          </div>
          <PrimaryActionBar
            primaryLabel={actionConfig.primaryLabel}
            primaryIcon={actionConfig.primaryIcon}
            onPrimary={actionConfig.onPrimary}
            disabled={actionConfig.disabled}
            secondaryLabel={actionConfig.secondaryLabel}
            secondaryIcon={actionConfig.secondaryIcon}
            onSecondary={actionConfig.onSecondary}
          />
        </div>
      )}

      {!currentCAV && cavs.length > 0 && (
        <div className="relative z-20 bg-green-50 border-t border-green-200 flex-shrink-0">
          <div className="px-4 py-3 text-center">
            <p className="text-green-800 font-bold">
              Tous les {isAssociationTour ? 'points association' : 'CAV'} ont été collectés
            </p>
          </div>
          <PrimaryActionBar
            primaryLabel="Retour au centre de tri"
            onPrimary={() => navigate('/return-centre')}
            secondaryLabel="Incident"
            secondaryIcon={INCIDENT_ICON}
            onSecondary={() => navigate('/incident')}
          />
        </div>
      )}
    </div>
  );
}
