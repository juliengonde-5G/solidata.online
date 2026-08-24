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
import { authedFetch } from '../services/authedFetch';
import { addGpsPosition } from '../services/db';

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

// Événements de circulation : gros pictogrammes, lisibles d'un coup d'œil
// depuis la cabine (mêmes catégories que la carte du bureau).
const TRAFIC_LABELS = {
  accident: 'Accident',
  bouchon: 'Bouchon',
  fermeture: 'Route fermée',
  travaux: 'Travaux',
  autre: 'Perturbation',
};
const TRAFIC_COULEURS = {
  accident: '#DC2626',
  bouchon: '#F97316',
  fermeture: '#7C3AED',
  travaux: '#F59E0B',
  autre: '#64748B',
};
const TRAFIC_EMOJIS = {
  accident: '🚨', bouchon: '🚗', fermeture: '⛔', travaux: '🚧', autre: 'ℹ️',
};

function traficIcon(type) {
  const couleur = TRAFIC_COULEURS[type] || TRAFIC_COULEURS.autre;
  const emoji = TRAFIC_EMOJIS[type] || TRAFIC_EMOJIS.autre;
  return new L.DivIcon({
    html: `<div style="background:${couleur};color:#fff;border-radius:50%;width:32px;height:32px;`
      + `display:flex;align-items:center;justify-content:center;font-size:16px;`
      + `border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.45)">${emoji}</div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export default function TourMap() {
  const [tour, setTour] = useState(null);
  const [cavs, setCavs] = useState([]);
  const [currentCavIndex, setCurrentCavIndex] = useState(0);
  const [myPosition, setMyPosition] = useState(null);
  // Tracé ROUTIER du reste de la tournée (suit les rues au lieu de relier les
  // bornes en ligne droite). Hors ligne, il reste simplement absent : la carte
  // retombe sur le trait pointillé, et rien n'est bloqué.
  const [trace, setTrace] = useState(null);
  // Événements de circulation (mêmes données que la carte du bureau).
  // `null` = pas encore d'information ; un tableau VIDE = « aucun bouchon
  // signalé ». Les deux ne se ressemblent pas et ne s'affichent pas pareil.
  const [trafic, setTrafic] = useState(null);
  const [reoptProposal, setReoptProposal] = useState(null);
  const [reoptProcessing, setReoptProcessing] = useState(false);
  const socketRef = useRef(null);
  const watchRef = useRef(null);
  const intervalRef = useRef(null);
  const reoptPollRef = useRef(null);
  const traficPollRef = useRef(null);
  // Copie des points, lisible depuis les minuteurs (qui capturent l'état initial).
  const cavsRef = useRef([]);
  const positionRef = useRef(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const { reportGpsSample, mode } = useUsageMode();

  useEffect(() => {
    loadTour();
    startGPS();
    connectSocket();
    // Polling filet (15s) pour détecter les propositions de ré-optimisation
    // même quand le socket n'est pas connecté (mobile sans token).
    const pollReopt = async () => {
      if (!tourId) return;
      try {
        const res = await authedFetch(`/api/tours/${tourId}/reoptimize/pending-public`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.id) setReoptProposal(data);
          else setReoptProposal(null);
        }
      } catch (_) { /* offline ok */ }
    };
    pollReopt();
    reoptPollRef.current = setInterval(pollReopt, 15000);
    // Circulation : rafraîchie toutes les 5 minutes. Les bouchons ne changent
    // pas à la minute, et le forfait TomTom est partagé avec le bureau.
    traficPollRef.current = setInterval(() => {
      loadTrafic(cavsRef.current);
    }, 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (reoptPollRef.current) clearInterval(reoptPollRef.current);
      if (traficPollRef.current) clearInterval(traficPollRef.current);
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const loadTour = async () => {
    try {
      const res = await authedFetch(`/api/tours/${tourId}/public`);
      const data = await res.json();
      setTour(data);
      setCavs(data.cavs || []);
      cavsRef.current = data.cavs || [];
      const visitedCount = (data.cavs || []).filter(c => c.status === 'collected').length;
      setCurrentCavIndex(visitedCount);
      loadTrace();
      loadTrafic(data.cavs || []);
    } catch (err) { console.error(err); }
  };

  // Circulation autour de la tournée. Emprise calculée sur les points restants
  // (le serveur l'arrondit et met en cache : quatre camions sur le même
  // territoire coûtent à peine plus qu'un seul appel).
  // Hors ligne, l'appel échoue et l'on reste sur `null` : aucun bouchon
  // affiché, mais rien qui laisse croire que la route est dégagée.
  const loadTrafic = async (points) => {
    try {
      const pts = (points || []).filter((c) => c.latitude && c.longitude);
      const pos = positionRef.current;
      const lats = pts.map((c) => Number(c.latitude));
      const lngs = pts.map((c) => Number(c.longitude));
      if (pos) { lats.push(pos.lat); lngs.push(pos.lng); }
      if (lats.length === 0) return;
      const marge = 0.02;
      const bbox = [
        Math.min(...lats) - marge, Math.min(...lngs) - marge,
        Math.max(...lats) + marge, Math.max(...lngs) + marge,
      ].join(',');
      const res = await authedFetch(`/api/tours/trafic-public?bbox=${encodeURIComponent(bbox)}`);
      const data = await res.json();
      setTrafic(data && data.disponible ? (data.incidents || []) : null);
    } catch (_) { setTrafic(null); }
  };

  // Itinéraire routier restant. Best effort : un échec (hors ligne, routeur
  // injoignable) laisse `trace` à null — la carte reste utilisable.
  const loadTrace = async () => {
    try {
      const pos = positionRef.current;
      const q = pos ? `?lat=${pos.lat}&lng=${pos.lng}` : '';
      const res = await authedFetch(`/api/tours/${tourId}/itineraire-public${q}`);
      const data = await res.json();
      setTrace(data && data.source === 'routier' ? data : null);
    } catch (_) { setTrace(null); }
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

    // Proposition de ré-optimisation (Niveau 2.6)
    socket.on('reoptimization-proposal', (data) => {
      if (!data) return;
      if (parseInt(data.tour_id) === parseInt(tourId)) {
        setReoptProposal(data);
        // Notification native (feedback visuel hors-modal) si permission accordée
        notifyDriver(
          'Nouvel ordre proposé',
          `Gain ${data.gain_percent}% — ${data.old_distance_km} → ${data.new_distance_km} km`
        );
      }
    });
    socket.on('reoptimization-accepted', () => setReoptProposal(null));
    socket.on('reoptimization-rejected', () => setReoptProposal(null));

    // Envoi de la position GPS toutes les 10 secondes
    // Event name aligné sur backend/src/index.js (gps-update)
    intervalRef.current = setInterval(() => {
      if (!positionRef.current) return;
      const sample = {
        tourId: parseInt(tourId),
        vehicleId: parseInt(vehicleId) || null,
        latitude: positionRef.current.lat,
        longitude: positionRef.current.lng,
        speed: 0,
      };
      if (socketRef.current && socketRef.current.connected) {
        // En ligne : le socket persiste la position (backend gps-update).
        socketRef.current.emit('gps-update', sample);
      } else {
        // Hors couverture : on bufferise localement pour rejeu à la
        // reconnexion (POST /tours/gps-batch-public via sync.js). Pas de
        // double-insertion : en ligne c'est le socket, hors-ligne le buffer.
        addGpsPosition({
          tourId: sample.tourId,
          vehicleId: sample.vehicleId,
          latitude: sample.latitude,
          longitude: sample.longitude,
          speed: sample.speed,
        }).catch(() => { /* IndexedDB indisponible — position perdue, best-effort */ });
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

  // Notification native pour le chauffeur (fonctionne app ouverte).
  // Demande la permission la 1re fois, silencieux sinon.
  const notifyDriver = (title, body) => {
    if (typeof Notification === 'undefined') return;
    const show = () => {
      try { new Notification(title, { body, icon: '/icon-192.png', tag: 'driver' }); }
      catch (_) { /* ignore */ }
    };
    if (Notification.permission === 'granted') show();
    else if (Notification.permission === 'default') {
      Notification.requestPermission().then((p) => { if (p === 'granted') show(); }).catch(() => {});
    }
  };

  const decideReopt = async (action) => {
    if (!reoptProposal || reoptProcessing) return;
    setReoptProcessing(true);
    try {
      await authedFetch(`/api/tours/${tourId}/reoptimize/${reoptProposal.id}/${action}-public`, {
        method: 'POST',
      });
      setReoptProposal(null);
      if (action === 'accept') {
        // Reload la tournée pour prendre le nouvel ordre en compte
        await loadTour();
      }
    } catch (err) {
      console.error('[TourMap] reopt decision', err);
    }
    setReoptProcessing(false);
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
      {/* Modal plein écran : proposition de ré-optimisation (Niveau 2.6) */}
      {reoptProposal && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reopt-title"
        >
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl overflow-hidden">
            <div className="bg-amber-500 text-white px-5 py-4">
              <p className="text-[11px] uppercase tracking-wider opacity-90">Suggestion tournée</p>
              <h2 id="reopt-title" className="font-bold text-xl mt-0.5">
                Nouvel ordre proposé
              </h2>
              <p className="text-white/90 text-sm mt-1">
                Déclencheur : {reoptProposal.trigger_reason || '—'}
              </p>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-gray-500 uppercase">Distance</p>
                  <p className="text-base font-bold text-gray-900 mt-0.5">
                    {(reoptProposal.old_distance_km ?? 0).toFixed(1)} →{' '}
                    <span className="text-emerald-700">{(reoptProposal.new_distance_km ?? 0).toFixed(1)} km</span>
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-gray-500 uppercase">Durée</p>
                  <p className="text-base font-bold text-gray-900 mt-0.5">
                    {Math.round(reoptProposal.old_duration_min ?? 0)} →{' '}
                    <span className="text-emerald-700">{Math.round(reoptProposal.new_duration_min ?? 0)} min</span>
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-500 text-center">
                {reoptProposal.points?.length
                  ? `${reoptProposal.points.length} points à réordonner parmi ceux restants`
                  : `${(reoptProposal.new_sequence || []).length} points à réordonner`}
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => decideReopt('reject')}
                  disabled={reoptProcessing}
                  className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold disabled:opacity-50"
                >
                  Garder l'ordre actuel
                </button>
                <button
                  type="button"
                  onClick={() => decideReopt('accept')}
                  disabled={reoptProcessing}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-50"
                >
                  {reoptProcessing ? '…' : 'Accepter'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />

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
                    {/* Exigence 08/2026 : point sans photo, ou photo périmée
                        (décision serveur `photo_requise`). */}
                    {cav.photo_requise && <p className="font-bold">📷 Photo à prendre</p>}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Événements de circulation — mêmes données que la carte du bureau */}
          {(trafic || []).map((inc) => (
            inc.latitude && inc.longitude ? (
              <Marker
                key={`trafic-${inc.id}`}
                position={[inc.latitude, inc.longitude]}
                icon={traficIcon(inc.type)}
              >
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold">{TRAFIC_LABELS[inc.type] || 'Perturbation'}</p>
                    {inc.description && <p>{inc.description}</p>}
                    {inc.retard_sec > 0 && (
                      <p className="font-bold">Retard : {Math.round(inc.retard_sec / 60)} min</p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ) : null
          ))}

          {trace?.geometry?.length >= 2 ? (
            <Polyline
              positions={trace.geometry}
              pathOptions={{ color: '#0D9488', weight: 5, opacity: 0.85 }}
            />
          ) : cavs.filter(c => c.latitude && c.longitude).length > 1 && (
            <Polyline
              positions={cavs.filter(c => c.latitude && c.longitude).map(c => [c.latitude, c.longitude])}
              pathOptions={{ color: '#0D9488', weight: 3, dashArray: '10,6' }}
            />
          )}
        </MapContainer>
      </div>

      {currentCAV && actionConfig && (
        <div
          className="relative z-20 bg-white flex-shrink-0"
          style={{
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            boxShadow: '0 -10px 30px rgba(0,0,0,0.1)',
          }}
        >
          {/* Grab handle */}
          <div className="flex justify-center pt-2.5">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>
          {/* Carte "Prochain point" — version allégée en conduite */}
          <div className="px-4 pt-2 pb-2">
            <p className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">
              Prochain point #{currentCavIndex + 1}
            </p>
            <h3 className="font-extrabold text-gray-900 truncate text-lg">
              {currentCAV.nom || currentCAV.cav_name}
            </h3>
            {/* Photo attendue sur ce point (aucune photo en base ou photo
                périmée) — annoncé AVANT l'arrivée pour éviter la surprise à la
                validation. */}
            {currentCAV.photo_requise && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                <span aria-hidden="true">📷</span> Photo à prendre
              </p>
            )}
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
