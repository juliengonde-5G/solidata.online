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
import { libellePoint } from '../services/pointLabel';
import InfosPointAssociation from '../components/InfosPointAssociation';
import { infoHorairesJour, texteRdv } from '../services/pointHoraires';
// `lireArrivee` sert au libellé du bouton chez une association (arrivée déjà
// déclarée ou non). L'import manquait : sur une tournée ASSOCIATION, le rendu
// levait « lireArrivee is not defined » et l'écran chauffeur restait BLANC.
import { lireArrivee } from '../services/arriveeAssociation';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// `rdv: true` ajoute une petite pastille horloge : le point ancré à un
// rendez-vous (RG-B6) doit se repérer parmi les autres marqueurs sans avoir
// à ouvrir chaque infobulle. Le débordement de la pastille hors du cercle de
// 28px est volontaire (badge classique en Leaflet — DivIcon n'écrête pas).
const cavIcon = (color, { rdv = false } = {}) => new L.DivIcon({
  html: `<div style="position:relative;width:28px;height:28px;">
    <div style="background:${color};color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)">📍</div>
    ${rdv ? '<div style="position:absolute;top:-5px;right:-5px;background:#4338CA;color:#fff;border-radius:50%;width:15px;height:15px;display:flex;align-items:center;justify-content:center;font-size:9px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)">⏰</div>' : ''}
  </div>`,
  className: '', iconSize: [28, 28], iconAnchor: [14, 14],
});

// Le centre de tri se distingue d'une borne au premier coup d'œil : c'est une
// destination, pas un point à collecter.
const centreIcon = new L.DivIcon({
  html: '<div style="background:#0D9488;color:white;border-radius:12px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)">\u{1F3ED}</div>',
  className: '', iconSize: [34, 34], iconAnchor: [17, 17],
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
  // Arrêts de programme : retour au centre pour vidage, pause déjeuner, fin de
  // tournée. Ce sont des ÉTAPES au même titre qu'une borne — avec itinéraire,
  // et une arrivée à déclarer. Avant, le retour au centre n'existait pas ici :
  // l'application sautait droit à la pesée, sans montrer le trajet.
  const [arrets, setArrets] = useState([]);
  const [arretEnCours, setArretEnCours] = useState(false);
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
      setArrets(data.arrets || []);
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

  /**
   * Chez une association, le bouton dit où en est l'équipage : tant qu'il n'a
   * pas déclaré son arrivée, il l'annonce ; ensuite il déclare son départ.
   * Le serveur fait foi (`arrived_at`), l'appareil prend le relais hors ligne.
   */
  const libelleActionAssociation = () => {
    const p = cavs[currentCavIndex];
    if (!p) return 'Déclarer mon arrivée';
    const arrive = p.arrived_at || lireArrivee(tourId, p.cav_id || p.id);
    return arrive ? 'Déclarer mon départ' : 'Déclarer mon arrivée';
  };

  const goToIdentify = () => {
    if (cavs[currentCavIndex]) {
      const cav = cavs[currentCavIndex];
      localStorage.setItem('selected_cav_id', String(cav.cav_id || cav.id));
      localStorage.setItem('selected_cav_name', cav.nom || cav.cav_name || '');
      if (isAssociationTour) {
        // Une association n'a pas de QR code, et il n'y a rien à regarder
        // « dedans » : le passage se déclare (arrivée, puis départ) sur un écran
        // dédié, qui mesure au passage la durée réelle de l'arrêt.
        navigate('/association-stop');
      } else {
        navigate('/identify-cav');
      }
    }
  };

  /**
   * Déclare un retour au centre. Le serveur pose une ÉTAPE dans le programme ;
   * on recharge la tournée pour que l'équipage la voie apparaître, avec son
   * itinéraire. La pesée n'arrive qu'à l'arrivée déclarée.
   *
   * Hors ligne, l'appel échoue : on le dit franchement plutôt que d'ouvrir une
   * pesée pour un camion qui n'est pas encore rentré.
   */
  const declarerRetourCentre = async (motif) => {
    if (arretEnCours) return;
    setArretEnCours(true);
    try {
      const res = await authedFetch(`/api/tours/${tourId}/retour-centre-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motif }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTour();
    } catch (err) {
      console.error(err);
      alert("Impossible d'enregistrer le retour au centre. Vérifiez la connexion et réessayez.");
    }
    setArretEnCours(false);
  };

  /**
   * L'équipage est arrivé au centre. C'est CE geste qui ouvre la pesée : tant
   * qu'il n'a pas eu lieu, le camion est en route.
   */
  const confirmerArrivee = async (arret) => {
    if (arretEnCours) return;
    setArretEnCours(true);
    try {
      const res = await authedFetch(`/api/tours/${tourId}/arret/${arret.id}/arrive-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Le serveur dit s'il y a quelque chose à peser : rien n'a été collecté
      // depuis la dernière pesée = camion vide, la pesée n'a plus d'objet.
      // Absent de la réponse (ancien backend) → on garde l'ancien comportement.
      localStorage.setItem('pesee_attendue', data.pesee_attendue === false ? '0' : '1');
      if (data.suite === 'pesee_intermediaire') {
        localStorage.setItem('intermediate_return', 'true');
        navigate('/weigh-in');
      } else if (data.suite === 'pesee_finale') {
        navigate('/return-centre');
      } else {
        await loadTour();
      }
    } catch (err) {
      console.error(err);
      alert("Impossible d'enregistrer l'arrivée. Vérifiez la connexion et réessayez.");
    }
    setArretEnCours(false);
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

  // Rendez-vous (RG-B6) et horaires du jour (RG-A8) du point courant.
  // `null` = rien à afficher — voir services/pointHoraires.js pour la
  // distinction stricte des trois états des horaires (renseigné / fermé /
  // inconnu). Ces champs sont ajoutés par le backend en parallèle de ce
  // chantier : tant qu'ils n'arrivent pas dans le payload, `undefined`
  // dégrade silencieusement vers « rien à afficher ».
  const currentRdvTexte = texteRdv(currentCAV?.rdv);
  const currentHoraires = infoHorairesJour(currentCAV?.horaires_jour);

  // Un arrêt en attente placé AVANT le prochain point de collecte devient
  // l'étape courante : c'est là que le camion doit aller maintenant.
  const positionProchainCav = (() => {
    const restant = cavs.find((c) => c.status !== 'collected' && c.status !== 'skipped');
    return restant ? Number(restant.position) : Infinity;
  })();
  const arretCourant = arrets
    .filter((a) => a.status === 'pending' && Number(a.position) <= positionProchainCav)
    .sort((a, b) => Number(a.position) - Number(b.position))[0] || null;

  const etapeCoords = arretCourant
    ? [arretCourant.latitude, arretCourant.longitude]
    : currentCAV ? [currentCAV.latitude, currentCAV.longitude] : null;
  const center = myPosition || (etapeCoords && etapeCoords[0] != null ? etapeCoords : [49.4231, 1.0993]);
  const hasCoords = arretCourant
    ? arretCourant.latitude != null && arretCourant.longitude != null
    : Boolean(currentCAV?.latitude && currentCAV?.longitude);

  const naviguerVersEtape = () => {
    if (!etapeCoords || etapeCoords[0] == null) return;
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${etapeCoords[0]},${etapeCoords[1]}`,
      '_blank'
    );
  };

  // Configuration de la barre d'action selon le mode d'usage.
  // Une seule CTA visible à la fois. Le secondaire reste simple.
  const actionConfig = (() => {
    // Étape « retour au centre » : on ne collecte rien, on roule puis on
    // annonce son arrivée. En conduite, seule la navigation est proposée.
    if (arretCourant) {
      if (mode === USAGE_MODES.DRIVING) {
        return {
          primaryLabel: 'Naviguer',
          primaryIcon: NAV_ICON,
          onPrimary: naviguerVersEtape,
          disabled: !hasCoords,
          secondaryLabel: null,
        };
      }
      return {
        primaryLabel: arretEnCours ? 'Enregistrement…' : 'Je suis arrivé au centre',
        primaryIcon: null,
        onPrimary: () => confirmerArrivee(arretCourant),
        disabled: arretEnCours,
        secondaryLabel: hasCoords ? 'Naviguer' : null,
        secondaryIcon: hasCoords ? NAV_ICON : null,
        onSecondary: hasCoords ? naviguerVersEtape : null,
      };
    }
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
        primaryLabel: isAssociationTour ? libelleActionAssociation() : 'Identifier le CAV',
        primaryIcon: IDENTIFY_ICON,
        onPrimary: goToIdentify,
        secondaryLabel: 'Incident',
        secondaryIcon: INCIDENT_ICON,
        onSecondary: () => navigate('/incident'),
      };
    }
    // operational_stop (défaut)
    return {
      primaryLabel: isAssociationTour ? libelleActionAssociation() : 'Identifier le CAV',
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
            aria-label="Camion plein, retour au centre pour pesée"
            onClick={() => declarerRetourCentre('vidage')}
            className="touch-target flex items-center justify-center rounded-xl bg-amber-500/80 hover:bg-amber-500 text-xs font-medium px-3"
          >
            Pesée
          </button>
          <button
            type="button"
            aria-label="Fin de tournée, retour au centre"
            onClick={() => declarerRetourCentre('fin_tournee')}
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
            // Points association (chantier tournées associations, 26/08/2026) :
            // rendez-vous (RG-B6) et horaires du jour (RG-A8). `null` = rien à
            // dire — les trois états des horaires ne se confondent jamais
            // (services/pointHoraires.js).
            const rdvTxt = texteRdv(cav.rdv);
            const horaires = infoHorairesJour(cav.horaires_jour);
            return (
              <Marker
                key={cav.cav_id || i}
                position={[cav.latitude, cav.longitude]}
                icon={cavIcon(color, { rdv: !!rdvTxt })}
              >
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold">#{i + 1} {cav.nom || cav.cav_name}</p>
                    <p>{cav.commune}</p>
                    <p>{cav.status === 'collected' ? '✅ Collecté' : 'En attente'}</p>
                    {/* Exigence 08/2026 : point sans photo, ou photo périmée
                        (décision serveur `photo_requise`). */}
                    {cav.photo_requise && <p className="font-bold">📷 Photo à prendre</p>}
                    {rdvTxt && (
                      <p className="font-bold" style={{ color: '#4338CA' }}>📅 {rdvTxt}</p>
                    )}
                    {horaires && (
                      <p style={{ color: horaires.etat === 'ferme' ? '#64748B' : '#0D9488', fontWeight: 700 }}>
                        {horaires.texte}
                      </p>
                    )}
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

          {arretCourant && arretCourant.latitude != null && arretCourant.longitude != null && (
            <Marker
              position={[arretCourant.latitude, arretCourant.longitude]}
              icon={centreIcon}
            >
              <Popup>
                <div style={{ minWidth: 150 }}>
                  <strong>{arretCourant.name}</strong>
                  {arretCourant.address && (
                    <div style={{ fontSize: 12, color: '#64748B' }}>{arretCourant.address}</div>
                  )}
                </div>
              </Popup>
            </Marker>
          )}

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

      {(arretCourant || currentCAV) && actionConfig && (
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
          {/* Étape « retour au centre » : elle occupe toute la carte, pour
              qu'on ne la confonde pas avec une borne à collecter. */}
          {arretCourant ? (
            <div className="px-4 pt-2 pb-2">
              <p className="text-[11px] uppercase tracking-widest text-teal-600 font-bold">
                Étape en cours
              </p>
              <h3 className="font-extrabold text-gray-900 text-lg">
                <span aria-hidden="true">🏭</span> {arretCourant.name}
              </h3>
              {mode !== USAGE_MODES.DRIVING && (
                <p className="text-xs text-gray-500 mt-1">
                  {arretCourant.address
                    || 'Rejoignez le centre de tri, puis appuyez sur « Je suis arrivé ».'}
                </p>
              )}
              {mode !== USAGE_MODES.DRIVING && arretCourant.motif === 'vidage' && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                  La pesée s'ouvrira à votre arrivée
                </p>
              )}
            </div>
          ) : (
          <div className="px-4 pt-2 pb-2">
            <p className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">
              Prochain point #{currentCavIndex + 1}
            </p>
            {/* Le nom du point porte la commune en préfixe
                (« CAUDEBEC-LÈS-ELBEUF - 67 Rue de Strasbourg ») et la commune
                est réaffichée juste en dessous. Sur un téléphone, la troncature
                sur une seule ligne faisait disparaître la RUE — la seule
                information dont le chauffeur ait besoin, puisqu'il est déjà
                dans la commune. On isole donc l'adresse, sur deux lignes. */}
            <h3 className="font-extrabold text-gray-900 text-lg leading-tight line-clamp-2">
              {libellePoint(currentCAV).titre}
            </h3>
            {/* Rendez-vous (RG-B6, chantier tournées associations 26/08/2026) :
                c'est l'information la plus engageante pour le chauffeur sur ce
                point, affichée avant tout le reste. */}
            {currentRdvTexte && (
              <p
                className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1"
                role="status"
              >
                <span aria-hidden="true">📅</span> {currentRdvTexte}
              </p>
            )}
            {/* Horaires du jour (RG-A8) : uniquement quand ils sont
                renseignés (ouvert OU fermé). Jamais de mention « horaires
                inconnus » écrite en gros — le silence est le bon choix quand
                l'information est absente (services/pointHoraires.js). */}
            {currentHoraires && (
              <p
                className={`mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold rounded-lg px-2 py-1 border ${
                  currentHoraires.etat === 'ferme'
                    ? 'text-slate-600 bg-slate-50 border-slate-200'
                    : 'text-teal-700 bg-teal-50 border-teal-200'
                }`}
                role="status"
              >
                <span aria-hidden="true">{currentHoraires.etat === 'ferme' ? '🚪' : '🕒'}</span>
                {currentHoraires.texte}
              </p>
            )}
            {/* Photo attendue sur ce point (aucune photo en base ou photo
                périmée) — annoncé AVANT l'arrivée pour éviter la surprise à la
                validation. */}
            {currentCAV.photo_requise && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                <span aria-hidden="true">📷</span> Photo à prendre
              </p>
            )}
            {/* `pr-16` dégage le bouton flottant d'assistance, qui recouvrait
                la fin de la ligne (« 50 % remp… » sur la capture terrain). */}
            {mode !== USAGE_MODES.DRIVING && (
              <div className="flex items-center justify-between gap-2 mt-1 pr-16">
                <p className="text-xs text-gray-500 truncate">
                  {libellePoint(currentCAV).sousTitre || currentCAV.commune}
                </p>
                {/* Le taux de remplissage n'a de sens que pour une borne : le
                    contenu d'une association n'est pas prédit (aucun historique
                    exploitable), et afficher « 0 % rempli » serait un chiffre
                    inventé. */}
                {!isAssociationTour && (
                  <span className="text-sm font-bold text-amber-600 whitespace-nowrap flex-shrink-0">
                    {Math.round(currentCAV.predicted_fill_rate || currentCAV.estimated_fill_rate || 0)}% rempli
                  </span>
                )}
              </div>
            )}
            {/* Chez une association, le chauffeur a besoin de plus qu'une
                adresse : consignes d'accès, référent à demander, téléphone.
                Le numéro était déjà là, mais seul et en petit — il est repris
                dans cet encart, avec une cible tactile utilisable en tournée. */}
            {mode !== USAGE_MODES.DRIVING && isAssociationTour && (
              <InfosPointAssociation point={currentCAV} className="mt-2" />
            )}
          </div>
          )}
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

      {!arretCourant && !currentCAV && cavs.length > 0 && (
        <div className="relative z-20 bg-green-50 border-t border-green-200 flex-shrink-0">
          <div className="px-4 py-3 text-center">
            <p className="text-green-800 font-bold">
              Tous les {isAssociationTour ? 'points association' : 'CAV'} ont été collectés
            </p>
          </div>
          <PrimaryActionBar
            primaryLabel={arretEnCours ? 'Enregistrement…' : 'Retour au centre de tri'}
            onPrimary={() => declarerRetourCentre('fin_tournee')}
            secondaryLabel="Incident"
            secondaryIcon={INCIDENT_ICON}
            onSecondary={() => navigate('/incident')}
          />
        </div>
      )}
    </div>
  );
}
