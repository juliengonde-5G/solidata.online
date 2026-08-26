import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, MapSizeFix } from '../components';
import api from '../services/api';
import Modal from '../components/Modal';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import {
  MapPin, Truck, Gauge, Clock, AlertTriangle,
  CheckCircle2, CircleDashed, XCircle, Activity,
  Route as RouteIcon, Users, ChevronDown, ChevronUp,
  MessageSquare, Send,
} from 'lucide-react';
import TourProgrammePanel from '../components/tours/TourProgrammePanel';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Palette de couleurs distinctes par tournée (max 12)
const TOUR_COLORS = ['#0D9488', '#6366F1', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#EF4444', '#F97316', '#06B6D4', '#84CC16', '#A855F7', '#14B8A6'];

function truckIcon(color) {
  return new L.DivIcon({
    html: `<div style="background:${color};color:white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">🚛</div>`,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// ── Événements de circulation (item « reprendre la main » — GET /tours/trafic) ──
// Icône ET couleur distinctes par type d'incident (accident/bouchon/fermeture/
// travaux/autre) via un DivIcon (même technique que truckIcon ci-dessus).
// Statuts de tournée en clair. L'écran affichait la valeur brute de la base
// (« returning »), donc le « camion plein, retour au centre » déclaré par le
// chauffeur passait inaperçu — c'est pourtant l'information la plus utile de
// la fin de journée.
// Motifs de déclenchement du recalcul d'ordre, en clair.
const MOTIFS_REOPT = {
  arret: 'après un arrêt',
  recurrent: 'recalcul périodique',
  incident: 'suite à un incident',
  manual: 'demande manuelle',
};

// Provenance des chiffres annoncés : mesure réelle ou estimation. Un gain
// « estimé » et un gain mesuré ne se décident pas de la même façon.
const SOURCES_REOPT = {
  tomtom_trafic: 'mesuré avec le trafic',
  osrm_facteur_jour: 'mesuré (trafic moyen du jour)',
  estimation: 'estimation — routeur indisponible',
};

const TOUR_STATUS_META = {
  planned: { label: 'Planifiée', classe: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'En cours', classe: 'bg-emerald-100 text-emerald-700' },
  paused: { label: 'En pause', classe: 'bg-amber-100 text-amber-700' },
  returning: { label: '🔄 Retour au centre', classe: 'bg-blue-100 text-blue-700 font-semibold' },
  completed: { label: 'Terminée', classe: 'bg-slate-100 text-slate-500' },
  cancelled: { label: 'Annulée', classe: 'bg-red-100 text-red-700' },
};

function statutTournee(status) {
  return TOUR_STATUS_META[status] || { label: status || '—', classe: 'bg-slate-100 text-slate-600' };
}

/** Coordonnées GPS lisibles et copiables (5 décimales ≈ 1 m). */
function fmtGps(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `${a.toFixed(5)}, ${b.toFixed(5)}`;
}

const TRAFFIC_TYPE_META = {
  accident: { emoji: '🚨', color: '#DC2626', label: 'Accident' },
  bouchon: { emoji: '🚗', color: '#F97316', label: 'Bouchon' },
  fermeture: { emoji: '⛔', color: '#7C3AED', label: 'Fermeture' },
  travaux: { emoji: '🚧', color: '#F59E0B', label: 'Travaux' },
  autre: { emoji: 'ℹ️', color: '#64748B', label: 'Autre' },
};

function trafficIcon(type) {
  const meta = TRAFFIC_TYPE_META[type] || TRAFFIC_TYPE_META.autre;
  return new L.DivIcon({
    html: `<div style="background:${meta.color};color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4)">${meta.emoji}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Rafraîchi au déplacement de la carte, throttlé à 1 requête/minute maximum
// (au mieux : une fois au montage, puis au plus une fois par minute même si
// la carte est déplacée plusieurs fois). Quand `disponible:false`, le message
// du backend est remonté TEL QUEL au parent — jamais de "aucune perturbation"
// inventé en l'absence d'information réelle.
const TRAFFIC_MIN_INTERVAL_MS = 60000;

function TrafficLayer({ onStatusChange }) {
  const map = useMap();
  const [incidents, setIncidents] = useState([]);
  const lastFetchRef = useRef(0);
  const pendingRef = useRef(null);

  const fetchTraffic = useCallback(async () => {
    // Onglet en arrière-plan : personne ne regarde la carte, et chaque appel
    // consomme le forfait TomTom. On ne relève rien tant qu'il est masqué.
    if (typeof document !== 'undefined' && document.hidden) return;
    lastFetchRef.current = Date.now();
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(',');
    try {
      const res = await api.get('/tours/trafic', { params: { bbox } });
      const data = res.data || {};
      if (data.disponible) {
        setIncidents(data.incidents || []);
      } else {
        setIncidents([]);
      }
      onStatusChange?.(data);
    } catch (err) {
      console.error('[CollectionsLive] trafic:', err);
      setIncidents([]);
      onStatusChange?.({ disponible: false, message: 'Informations de circulation indisponibles pour le moment.' });
    }
  }, [map, onStatusChange]);

  const scheduleFetch = useCallback(() => {
    const elapsed = Date.now() - lastFetchRef.current;
    if (elapsed >= TRAFFIC_MIN_INTERVAL_MS) {
      fetchTraffic();
    } else if (!pendingRef.current) {
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        fetchTraffic();
      }, TRAFFIC_MIN_INTERVAL_MS - elapsed);
    }
  }, [fetchTraffic]);

  useEffect(() => {
    fetchTraffic();
    const interval = setInterval(scheduleFetch, TRAFFIC_MIN_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [fetchTraffic, scheduleFetch]);

  useMapEvents({
    moveend: scheduleFetch,
    zoomend: scheduleFetch,
  });

  return (
    <>
      {incidents.map((inc) => (
        <Marker key={inc.id} position={[inc.latitude, inc.longitude]} icon={trafficIcon(inc.type)}>
          <Popup>
            <div className="text-xs space-y-1 max-w-[220px]">
              <p className="font-bold">
                {TRAFFIC_TYPE_META[inc.type]?.label || inc.type}{inc.label ? ` — ${inc.label}` : ''}
              </p>
              {inc.description && <p className="text-slate-600">{inc.description}</p>}
              {inc.gravite != null && <p>Gravité : <strong>{inc.gravite}/4</strong></p>}
              {inc.retard_sec != null && inc.retard_sec > 0 && (
                <p>Retard estimé : <strong>{Math.round(inc.retard_sec / 60)} min</strong></p>
              )}
              {inc.debut && <p className="text-slate-400">Depuis {fmtDateTime(inc.debut)}</p>}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

function fmtDuration(min) {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Rendez-vous associations (RG-B6) ────────────────────────────────────────
// Heure d'une colonne TIME PostgreSQL ('HH:MM' ou 'HH:MM:SS') → 'HH:MM'.
function fmtHeureTime(t) {
  if (!t) return null;
  return String(t).slice(0, 5);
}

// Écart (minutes) entre l'heure de passage prévue (timestamp complet) et
// l'heure de rendez-vous demandée (heure seule) — signé : positif = en retard
// sur le rendez-vous, négatif = en avance. `null` si l'une des deux manque.
function ecartMinutes(plannedIso, heureDebut) {
  if (!plannedIso || !heureDebut) return null;
  const d = new Date(plannedIso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = String(heureDebut).split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return (d.getHours() * 60 + d.getMinutes()) - (parts[0] * 60 + parts[1]);
}

export default function CollectionsLive() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedTour, setExpandedTour] = useState(null);
  const [livePositions, setLivePositions] = useState({}); // vehicle_id → {lat, lng, speed, ts}
  const [trafficInfo, setTrafficInfo] = useState(null); // { disponible, message?, incidents? }
  // Tracés ROUTIERS des tournées : tour_id → { geometry, distance_restante_km, … }
  // La carte suivait jusqu'ici des segments à vol d'oiseau, et la « distance
  // restante » n'était qu'un prorata du kilométrage total estimé.
  const [itineraires, setItineraires] = useState({});
  // Propositions de ré-optimisation en attente. Elles étaient jusqu'ici
  // produites et notifiées, mais jamais listées ici : le gestionnaire qui
  // décide ne les voyait pas.
  const [reoptims, setReoptims] = useState([]);
  const [reoptEnCours, setReoptEnCours] = useState(null);
  // Clôture d'une tournée depuis le bureau : { tour, nbRestants } tant que la
  // confirmation n'est pas donnée.
  const [clotureDemandee, setClotureDemandee] = useState(null);
  const [clotureEnCours, setClotureEnCours] = useState(false);
  // Demandes de collecte du jour (rendez-vous associations) — pour le badge
  // « RDV » sur les points association d'une tournée en cours (RG-B6).
  const [demandes, setDemandes] = useState([]);
  const socketRef = useRef(null);

  const loadActive = useCallback(async () => {
    try {
      const res = await api.get('/tours/active-summary');
      setData(res.data);
      // Pré-remplir livePositions avec last_position
      const initialPositions = {};
      (res.data.tours || []).forEach((t) => {
        if (t.last_position && t.vehicle_id) {
          initialPositions[t.vehicle_id] = {
            lat: t.last_position.latitude,
            lng: t.last_position.longitude,
            speed: t.last_position.speed,
            ts: t.last_position.recorded_at,
          };
        }
      });
      setLivePositions(initialPositions);
      // Best-effort : une erreur ici (endpoint absent ou en échec) ne doit
      // jamais bloquer l'écran principal de collecte en direct.
      if (res.data.date) {
        try {
          const demRes = await api.get('/association-demandes', { params: { du: res.data.date, au: res.data.date } });
          setDemandes(Array.isArray(demRes.data) ? demRes.data : []);
        } catch (err) {
          setDemandes([]);
        }
      }
    } catch (err) {
      console.error('[CollectionsLive] active-summary:', err);
    }
    setLoading(false);
  }, []);

  const loadReoptims = useCallback(async () => {
    try {
      const res = await api.get('/tours/reoptimizations/pending');
      setReoptims(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('[CollectionsLive] reoptimizations:', err);
    }
  }, []);

  const deciderReopt = useCallback(async (reopt, action) => {
    setReoptEnCours(reopt.id);
    try {
      await api.post(`/tours/${reopt.tour_id}/reoptimize/${reopt.id}/${action}`);
      await Promise.all([loadReoptims(), loadActive()]);
    } catch (err) {
      console.error('[CollectionsLive] décision ré-optim:', err);
    }
    setReoptEnCours(null);
  }, [loadReoptims]);

  // Tracés routiers : appel séparé pour ne pas ralentir le rafraîchissement
  // principal. Un échec laisse la carte en trait droit (signalé), jamais une
  // distance approchée présentée comme routière.
  const loadItineraires = useCallback(async () => {
    try {
      const res = await api.get('/tours/active-summary/itineraires');
      const parTournee = {};
      (res.data?.itineraires || []).forEach((it) => { parTournee[it.tour_id] = it; });
      setItineraires(parTournee);
    } catch (err) {
      console.error('[CollectionsLive] itineraires:', err);
    }
  }, []);

  // Clôture d'une tournée par le gestionnaire. Passe par la MÊME route que la
  // clôture chauffeur (`PUT /tours/:id/status`) : mêmes effets de fin de
  // tournée (tonnage, stock, apprentissage), même idempotence.
  const cloturerTournee = useCallback(async (tour) => {
    setClotureEnCours(true);
    try {
      await api.put(`/tours/${tour.id}/status`, { status: 'completed' });
      setClotureDemandee(null);
      await Promise.all([loadActive(), loadItineraires(), loadReoptims()]);
    } catch (err) {
      console.error('[CollectionsLive] clôture:', err);
    }
    setClotureEnCours(false);
  }, [loadActive, loadItineraires, loadReoptims]);

  // Initial load + polling 30s + Socket.IO pour positions GPS temps réel
  useEffect(() => {
    loadActive();
    loadItineraires();
    loadReoptims();
    const interval = setInterval(() => { loadActive(); loadReoptims(); }, 30000);
    // Le tracé ne bouge qu'à chaque point collecté : 2 min suffisent, et cela
    // évite de solliciter le routeur toutes les 30 secondes.
    const intervalTrace = setInterval(loadItineraires, 120000);

    const token = localStorage.getItem('accessToken');
    const socket = io(window.location.origin, { auth: { token } });
    socketRef.current = socket;

    socket.on('vehicle-position', (d) => {
      const lat = parseFloat(d.latitude);
      const lng = parseFloat(d.longitude);
      const vId = d.vehicle_id || d.vehicleId;
      if (!vId || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setLivePositions((prev) => ({
        ...prev,
        [vId]: { lat, lng, speed: d.speed, ts: d.timestamp || new Date().toISOString() },
      }));
    });
    // Un point collecté change l'itinéraire restant : on le recalcule aussitôt
    // plutôt que d'attendre le prochain cycle (le CAV vidé sortait du tracé
    // avec jusqu'à deux minutes de retard).
    socket.on('cav-status-update', () => { loadActive(); loadItineraires(); });
    socket.on('tour-status-update', () => { loadActive(); loadItineraires(); });

    return () => {
      clearInterval(interval);
      clearInterval(intervalTrace);
      socket.disconnect();
    };
  }, [loadActive, loadItineraires, loadReoptims]);

  const tours = data?.tours || [];
  const kpis = data?.kpis || { vehicules_actifs: 0, cav_a_vider: 0, avancement_pct: 0, distance_restante_km: 0 };

  // Rendez-vous associations RATTACHÉS à un passage de tournée en cours —
  // clé `${tour_id}:${association_point_id}` (un point association = un
  // rendez-vous au plus par jour, la demande porte l'unicité). Seuls
  // `planifiee`/`honoree` désignent un rendez-vous réellement rattaché.
  const demandeParPoint = useMemo(() => {
    const map = {};
    demandes.forEach((d) => {
      if (d.tour_id != null && (d.statut === 'planifiee' || d.statut === 'honoree')) {
        map[`${d.tour_id}:${d.association_point_id}`] = d;
      }
    });
    return map;
  }, [demandes]);

  // Centre de la carte : moyenne des positions actuelles (ou Rouen)
  const mapCenter = useMemo(() => {
    const positions = Object.values(livePositions);
    if (positions.length === 0) {
      // Fallback : moyenne des points CAV à vider
      const allPoints = tours.flatMap((t) => t.points.filter((p) => p.latitude && p.longitude));
      if (allPoints.length === 0) return [49.4231, 1.0993];
      const avgLat = allPoints.reduce((s, p) => s + p.latitude, 0) / allPoints.length;
      const avgLng = allPoints.reduce((s, p) => s + p.longitude, 0) / allPoints.length;
      return [avgLat, avgLng];
    }
    return [
      positions.reduce((s, p) => s + p.lat, 0) / positions.length,
      positions.reduce((s, p) => s + p.lng, 0) / positions.length,
    ];
  }, [livePositions, tours]);

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement…" /></Layout>;

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader
          title="Collecte en direct"
          subtitle={`Suivi temps réel des tournées — ${data?.date ? new Date(data.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}`}
          icon={Activity}
          actions={
            <button onClick={loadActive} className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
              Actualiser
            </button>
          }
        />

        {/* KPIs en haut */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile
            label="Véhicules en collecte"
            value={kpis.vehicules_actifs}
            icon={Truck}
            color="teal"
          />
          <KpiTile
            label="CAV à vider"
            value={kpis.cav_a_vider}
            icon={MapPin}
            color={kpis.cav_a_vider > 0 ? 'amber' : 'emerald'}
          />
          <KpiTile
            label="Avancement de la journée"
            value={`${kpis.avancement_pct}%`}
            icon={Gauge}
            color={kpis.avancement_pct >= 80 ? 'emerald' : kpis.avancement_pct >= 50 ? 'amber' : 'slate'}
            footer={<ProgressBar pct={kpis.avancement_pct} />}
          />
          <KpiTile
            label="Distance restante"
            value={`${kpis.distance_restante_km} km`}
            icon={RouteIcon}
            color="slate"
          />
        </div>

        {/* Confirmation de clôture — la clôture n'est pas un simple changement
            d'étiquette : elle enregistre le tonnage, alimente le stock et
            nourrit le moteur prédictif. Elle se confirme donc explicitement,
            et l'écran rappelle ce qui reste non collecté. */}
        {clotureDemandee && (
          <Modal
            isOpen
            onClose={() => !clotureEnCours && setClotureDemandee(null)}
            title={`Terminer la tournée #${clotureDemandee.tour.id} ?`}
            size="sm"
          >
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                Véhicule <strong>{clotureDemandee.tour.vehicle_registration || clotureDemandee.tour.vehicle_name || '—'}</strong>
                {clotureDemandee.tour.driver_name ? <> — {clotureDemandee.tour.driver_name}</> : null}
              </p>
              {clotureDemandee.nbRestants > 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs">
                  <strong>{clotureDemandee.nbRestants} point{clotureDemandee.nbRestants > 1 ? 's' : ''}</strong>
                  {clotureDemandee.nbRestants > 1 ? ' ne sont pas collectés' : " n'est pas collecté"} :
                  {clotureDemandee.nbRestants > 1 ? ' ils resteront' : ' il restera'} en attente dans l'historique.
                </div>
              )}
              <p className="text-xs text-slate-500">
                La clôture enregistre le tonnage pesé, crée l'entrée de stock et alimente
                le moteur prédictif. Elle ne peut pas être annulée d'un clic.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={clotureEnCours}
                  onClick={() => setClotureDemandee(null)}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white border border-slate-300 text-slate-600 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={clotureEnCours}
                  onClick={() => cloturerTournee(clotureDemandee.tour)}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
                >
                  {clotureEnCours ? 'Clôture…' : 'Terminer la tournée'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* ── Propositions de ré-optimisation en attente ─────────────────
            Le recalcul tourne après chaque arrêt et à intervalle régulier ;
            c'est ici que le gestionnaire tranche. Le CO2 n'est affiché que
            s'il est CALCULABLE (consommation du véhicule saisie) — sinon la
            ligne dit pourquoi, plutôt que d'annoncer « 0 kg évité ». */}
        {reoptims.length > 0 && (
          <div className="card-modern p-4 mb-5 border-l-4 border-emerald-500">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
              <RouteIcon className="w-4 h-4 text-emerald-600" />
              Ordre de passage : {reoptims.length} proposition{reoptims.length > 1 ? 's' : ''} à valider
            </h2>
            <div className="space-y-2">
              {reoptims.map((r) => {
                const gainKm = Math.round(((r.old_distance_km || 0) - (r.new_distance_km || 0)) * 10) / 10;
                const gainMin = Math.round((r.old_duration_min || 0) - (r.new_duration_min || 0));
                return (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 bg-slate-50 rounded-lg px-3 py-2 text-xs">
                    <span className="font-bold text-slate-700">
                      🚛 {r.registration || r.vehicle_name || `Tournée #${r.tour_id}`}
                    </span>
                    <span className="text-slate-500">{MOTIFS_REOPT[r.trigger_reason] || r.trigger_reason}</span>
                    <span className="text-emerald-700 font-semibold">−{gainKm} km</span>
                    <span className="text-emerald-700 font-semibold">−{gainMin} min</span>
                    {r.co2_evite_kg != null ? (
                      <span className="text-emerald-700 font-semibold">
                        −{Math.round(r.co2_evite_kg * 100) / 100} kg CO2
                      </span>
                    ) : (
                      <span className="text-slate-400" title="Saisir des pleins de carburant dans Énergie &amp; GES pour chiffrer le CO2">
                        CO2 non calculable
                      </span>
                    )}
                    <span className="text-slate-400">{SOURCES_REOPT[r.source_calcul] || r.source_calcul || ''}</span>
                    <div className="ml-auto flex gap-2">
                      <button
                        type="button"
                        disabled={reoptEnCours === r.id}
                        onClick={() => deciderReopt(r, 'accept')}
                        className="px-3 py-1 rounded-md bg-emerald-600 text-white font-semibold disabled:opacity-50"
                      >
                        Appliquer
                      </button>
                      <button
                        type="button"
                        disabled={reoptEnCours === r.id}
                        onClick={() => deciderReopt(r, 'reject')}
                        className="px-3 py-1 rounded-md bg-white border border-slate-300 text-slate-600 disabled:opacity-50"
                      >
                        Ignorer
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tours.length === 0 ? (
          <div className="card-modern p-12 text-center">
            <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">Aucune tournée active aujourd'hui</p>
            <p className="text-xs text-slate-400 mt-1">Les tournées planifiées apparaîtront ici dès leur démarrage</p>
          </div>
        ) : (
          <>
            {/* Carte multi-tournées */}
            <div className="card-modern overflow-hidden relative" style={{ height: '60vh' }}>
              <MapContainer center={mapCenter} zoom={11} style={{ height: '100%', width: '100%' }}>
                <MapSizeFix />
                <TileLayer
                  attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />

                {/* Événements de circulation — rafraîchi à la bbox visible, throttlé 1 min */}
                <TrafficLayer onStatusChange={setTrafficInfo} />

                {tours.map((tour, idx) => {
                  const color = TOUR_COLORS[idx % TOUR_COLORS.length];
                  const validPoints = tour.points.filter((p) => p.latitude && p.longitude);
                  const linePoints = validPoints
                    .filter((p) => p.status === 'pending' || p.status === 'in_progress')
                    .map((p) => [p.latitude, p.longitude]);
                  // Tracé suivant les rues quand le routeur a répondu ; sinon
                  // repli en trait droit, VISIBLEMENT pointillé (l'utilisateur
                  // doit voir que ce n'est pas un itinéraire réel).
                  const trace = itineraires[tour.id];
                  const routier = trace?.source === 'routier' && trace.geometry?.length >= 2;

                  return (
                    <FragmentBlock key={tour.id}>
                      {/* Itinéraire restant */}
                      {routier ? (
                        <Polyline
                          positions={trace.geometry}
                          pathOptions={{ color, weight: 4, opacity: 0.75 }}
                        />
                      ) : linePoints.length >= 2 && (
                        <Polyline
                          positions={linePoints}
                          pathOptions={{ color, weight: 3, opacity: 0.6, dashArray: '6 4' }}
                        />
                      )}

                      {/* Points CAV */}
                      {validPoints.map((p) => {
                        const isCollected = p.status === 'collected';
                        const isIncident = p.status === 'incident' || p.status === 'skipped';
                        const demande = tour.collection_type === 'association' ? demandeParPoint[`${tour.id}:${p.cav_id}`] : null;
                        const ecart = demande ? ecartMinutes(p.planned_passage_time, demande.heure_debut) : null;
                        return (
                          <CircleMarker
                            key={`${tour.id}-${p.id}`}
                            center={[p.latitude, p.longitude]}
                            radius={isCollected ? 6 : 9}
                            pathOptions={{
                              color: 'white',
                              weight: 2,
                              fillColor: isIncident ? '#dc2626' : isCollected ? '#94A3B8' : color,
                              fillOpacity: isCollected ? 0.5 : 0.95,
                            }}
                          >
                            <Popup>
                              <div className="text-xs space-y-0.5">
                                <p className="font-bold">{p.position}. {p.name}</p>
                                {p.address && <p className="text-slate-500">{p.address}</p>}
                                <p>Statut : <strong>{p.status}</strong></p>
                                {p.collected_at && <p>Collecté à : {fmtTime(p.collected_at)}</p>}
                                {p.fill_level != null && <p>Remplissage : <strong>{p.fill_level}/5</strong></p>}
                                {p.planned_passage_time && !isCollected && (
                                  <p className="text-slate-400">Passage prévu : {fmtTime(p.planned_passage_time)}</p>
                                )}
                                {demande && (
                                  <p className="text-purple-700 font-semibold">
                                    🕐 RDV {fmtHeureTime(demande.heure_debut)}
                                    {ecart != null && Math.abs(ecart) >= 1 && (
                                      <span className="font-normal"> ({ecart > 0 ? '+' : ''}{ecart} min vs RDV)</span>
                                    )}
                                  </p>
                                )}
                                {/* Coordonnées exactes du point, copiables d'un
                                    clic pour les dicter à un chauffeur. */}
                                <p className="text-slate-400 select-all">📍 {fmtGps(p.latitude, p.longitude) || '—'}</p>
                                <p className="mt-1 text-[10px] uppercase tracking-wider" style={{ color }}>
                                  Tournée #{tour.id} — {tour.driver_name || '—'}
                                </p>
                              </div>
                            </Popup>
                          </CircleMarker>
                        );
                      })}

                      {/* Position véhicule en temps réel */}
                      {livePositions[tour.vehicle_id] && (
                        <Marker
                          position={[livePositions[tour.vehicle_id].lat, livePositions[tour.vehicle_id].lng]}
                          icon={truckIcon(color)}
                        >
                          <Popup>
                            <div className="text-xs space-y-1">
                              <p className="font-bold" style={{ color }}>🚛 {tour.vehicle_registration || tour.vehicle_name || '—'}</p>
                              <p>Chauffeur : {tour.driver_name || '—'}</p>
                              <p>Vitesse : {livePositions[tour.vehicle_id].speed != null ? `${Math.round(livePositions[tour.vehicle_id].speed)} km/h` : '—'}</p>
                              <p>Maj : {fmtTime(livePositions[tour.vehicle_id].ts)}</p>
                              <p className="text-slate-500">{tour.nb_collected}/{tour.nb_points} collectés</p>
                              <p className={`px-1.5 py-0.5 rounded inline-block ${statutTournee(tour.status).classe}`}>
                                {statutTournee(tour.status).label}
                              </p>
                              {/* Coordonnées exactes : à recopier dans un GPS ou
                                  à transmettre par téléphone en cas d'incident. */}
                              <p className="text-slate-400 select-all">
                                📍 {fmtGps(livePositions[tour.vehicle_id].lat, livePositions[tour.vehicle_id].lng) || '—'}
                              </p>
                            </div>
                          </Popup>
                        </Marker>
                      )}
                    </FragmentBlock>
                  );
                })}
              </MapContainer>

              {/* Bandeau discret : le backend n'a pas d'information de circulation
                  disponible (source non configurée ou en échec) — message affiché
                  TEL QUEL, jamais remplacé par un "aucune perturbation" inventé. */}
              {trafficInfo?.disponible === false && (
                <div className="absolute top-3 left-3 right-3 z-[1000] bg-amber-50/95 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2 shadow-md flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {trafficInfo.message || "Informations de circulation indisponibles."}
                </div>
              )}

              {/* Légende des types d'incident présents sur la vue actuelle */}
              {trafficInfo?.disponible && trafficInfo.incidents?.length > 0 && (
                <div className="absolute bottom-3 right-3 z-[1000] bg-white/95 rounded-lg shadow-md p-2 text-[11px] space-y-1">
                  <p className="font-semibold text-slate-600 mb-0.5">Circulation</p>
                  {[...new Set(trafficInfo.incidents.map((i) => i.type))].map((type) => {
                    const meta = TRAFFIC_TYPE_META[type] || TRAFFIC_TYPE_META.autre;
                    return (
                      <div key={type} className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />
                        {meta.label}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Légende des tournées */}
            <div className="flex flex-wrap gap-3 px-2 text-xs">
              {tours.map((tour, idx) => {
                const color = TOUR_COLORS[idx % TOUR_COLORS.length];
                return (
                  <div key={tour.id} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="font-medium text-slate-700">#{tour.id}</span>
                    <span className="text-slate-500">— {tour.driver_name || 'sans chauffeur'}</span>
                    <span className="text-[10px] text-slate-400">({tour.collection_type === 'association' ? 'asso' : 'CAV'})</span>
                  </div>
                );
              })}
            </div>

            {/* Tableau synthèse par tournée */}
            <div className="card-modern overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">Synthèse par tournée</h2>
                <span className="text-xs text-slate-400">{tours.length} tournée{tours.length > 1 ? 's' : ''}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2 px-3 w-12"></th>
                      <th className="text-left py-2 px-3">Tournée</th>
                      <th className="text-left py-2 px-3">Chauffeur / Véhicule</th>
                      <th className="text-center py-2 px-3">Avancement</th>
                      <th className="text-right py-2 px-3">CAV</th>
                      <th className="text-right py-2 px-3">Distance</th>
                      <th className="text-right py-2 px-3">Temps</th>
                      <th className="text-center py-2 px-3">Alerte</th>
                      <th className="text-right py-2 px-3">Poids</th>
                      <th className="text-right py-2 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tours.map((tour, idx) => {
                      const color = TOUR_COLORS[idx % TOUR_COLORS.length];
                      const isExpanded = expandedTour === tour.id;
                      return (
                        <FragmentBlock key={tour.id}>
                          <tr
                            onClick={() => setExpandedTour(isExpanded ? null : tour.id)}
                            className={`border-b border-slate-100 cursor-pointer transition ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                          >
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <p className="font-semibold text-slate-800">#{tour.id}</p>
                              <p className="text-[10px] text-slate-500 flex items-center gap-1">
                                {tour.collection_type === 'association' ? 'Associations' : 'CAV'}
                                <span className={`px-1.5 py-0.5 rounded ${statutTournee(tour.status).classe}`}>
                                  {statutTournee(tour.status).label}
                                </span>
                              </p>
                            </td>
                            <td className="py-2 px-3">
                              <p className="font-medium text-slate-700">{tour.driver_name || '—'}</p>
                              <p className="text-[10px] text-slate-500">{tour.vehicle_registration || tour.vehicle_name || '—'}</p>
                            </td>
                            <td className="py-2 px-3 min-w-[140px]">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <ProgressBar pct={tour.progress_pct} color={color} />
                                </div>
                                <span className="text-xs font-semibold tabular-nums">{tour.progress_pct}%</span>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              <span className="font-medium">{tour.nb_collected}</span>
                              <span className="text-slate-400">/{tour.nb_points}</span>
                            </td>
                            <td className="py-2 px-3 text-right text-xs tabular-nums">
                              {itineraires[tour.id]?.source === 'routier'
                                ? `${itineraires[tour.id].distance_restante_km}/${tour.distance_km || '—'} km`
                                : tour.distance_remaining_km != null
                                  ? `${tour.distance_remaining_km}/${tour.distance_km || '—'} km`
                                  : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-xs tabular-nums">
                              {fmtDuration(tour.elapsed_min)} / {fmtDuration(tour.estimated_duration_min)}
                            </td>
                            {/* Une icône seule n'informe personne : il faut
                                survoler et attendre pour savoir de quoi il
                                s'agit. Le motif est donc écrit à côté du
                                pictogramme, et l'absence d'alerte se dit
                                explicitement au lieu de laisser une case vide
                                qu'on prend pour un oubli d'affichage. */}
                            <td className="py-2 px-3">
                              {!tour.alert_overrun && !(tour.nb_incidents > 0) ? (
                                <span className="text-[11px] text-slate-400">Aucune</span>
                              ) : (
                                <div className="flex flex-col gap-1 items-start">
                                  {tour.alert_overrun && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-medium text-red-700 whitespace-nowrap"
                                      title="La durée réelle dépasse la durée estimée de la tournée"
                                    >
                                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                      Dépassement de durée
                                    </span>
                                  )}
                                  {tour.nb_incidents > 0 && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700 whitespace-nowrap"
                                      title="Incidents déclarés par l'équipage sur cette tournée"
                                    >
                                      <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                      {tour.nb_incidents} incident{tour.nb_incidents > 1 ? 's' : ''}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-xs font-semibold tabular-nums">
                              {tour.weight_collected_kg > 0 ? `${tour.weight_collected_kg} kg` : '—'}
                            </td>
                            {/* Clôture depuis le bureau : un chauffeur peut avoir
                                terminé sans clôturer (batterie, oubli, perte de
                                réseau). Confirmation obligatoire — la clôture
                                déclenche le tonnage et les entrées de stock. */}
                            <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                              {['planned', 'in_progress', 'paused', 'returning'].includes(tour.status) ? (
                                <button
                                  type="button"
                                  onClick={() => setClotureDemandee({ tour, nbRestants: tour.nb_remaining ?? 0 })}
                                  className="px-2.5 py-1 rounded-md text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                                >
                                  Terminer
                                </button>
                              ) : <span className="text-xs text-slate-300">—</span>}
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr>
                              <td colSpan={10} className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                                <ExpandedDetail tour={tour} color={color} onRefresh={loadActive} demandeParPoint={demandeParPoint} />
                              </td>
                            </tr>
                          )}
                        </FragmentBlock>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

// React.Fragment helper avec clé propagée pour éviter les warnings JSX
function FragmentBlock({ children }) {
  return <>{children}</>;
}

function KpiTile({ label, value, icon: Icon, color, footer }) {
  const styles = {
    teal: { bg: 'bg-teal-50', text: 'text-teal-700', icon: 'text-teal-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-600' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-600' },
    slate: { bg: 'bg-slate-50', text: 'text-slate-700', icon: 'text-slate-500' },
  }[color] || { bg: 'bg-slate-50', text: 'text-slate-700', icon: 'text-slate-500' };

  return (
    <div className={`card-modern p-4 ${styles.bg}`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <Icon className={`w-5 h-5 ${styles.icon}`} />
      </div>
      <p className={`text-3xl font-extrabold tracking-tight ${styles.text}`}>{value}</p>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

function ProgressBar({ pct, color = '#0D9488' }) {
  const safe = Math.min(100, Math.max(0, pct || 0));
  return (
    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
      <div className="h-full transition-all" style={{ width: `${safe}%`, backgroundColor: color }} />
    </div>
  );
}

function ExpandedDetail({ tour, color, onRefresh, demandeParPoint }) {
  const isAssociation = tour.collection_type === 'association';
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-2">
        <Users className="w-3.5 h-3.5" />
        Liste des CAV — {tour.driver_name || '—'}
      </h3>
      <div className="overflow-x-auto rounded-lg bg-white border border-slate-200">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left py-1.5 px-2 w-8">#</th>
              <th className="text-left py-1.5 px-2">Point</th>
              <th className="text-left py-1.5 px-2">Statut</th>
              <th className="text-right py-1.5 px-2">Heure prévue</th>
              <th className="text-right py-1.5 px-2">Heure réelle</th>
              <th className="text-right py-1.5 px-2">Remplissage</th>
              {isAssociation && <th className="text-left py-1.5 px-2">Rendez-vous</th>}
            </tr>
          </thead>
          <tbody>
            {tour.points.map((p) => {
              const isCollected = p.status === 'collected';
              const isIncident = p.status === 'incident' || p.status === 'skipped';
              const StatusIco = isCollected ? CheckCircle2 : isIncident ? XCircle : CircleDashed;
              const statusColor = isCollected ? 'text-emerald-600' : isIncident ? 'text-red-500' : 'text-slate-400';
              const demande = isAssociation ? demandeParPoint?.[`${tour.id}:${p.cav_id}`] : null;
              const ecart = demande ? ecartMinutes(p.planned_passage_time, demande.heure_debut) : null;
              return (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-1.5 px-2 font-mono text-slate-400">{p.position}</td>
                  <td className="py-1.5 px-2">
                    <p className="font-medium text-slate-700">{p.name}</p>
                    {p.commune && <p className="text-[10px] text-slate-400">{p.commune}</p>}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className={`inline-flex items-center gap-1 ${statusColor}`}>
                      <StatusIco className="w-3.5 h-3.5" />
                      {p.status}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-slate-500">{fmtTime(p.planned_passage_time)}</td>
                  <td className="py-1.5 px-2 text-right text-slate-700">{fmtTime(p.collected_at)}</td>
                  <td className="py-1.5 px-2 text-right">
                    {p.fill_level != null ? <span className="font-semibold">{p.fill_level}/5</span> : <span className="text-slate-400">—</span>}
                  </td>
                  {isAssociation && (
                    <td className="py-1.5 px-2">
                      {demande ? (
                        <span className="inline-flex items-center gap-1 text-purple-700 font-semibold whitespace-nowrap">
                          RDV {fmtHeureTime(demande.heure_debut)}
                          {ecart != null && Math.abs(ecart) >= 1 && (
                            <span className="text-[10px] font-normal text-slate-500">({ecart > 0 ? '+' : ''}{ecart} min)</span>
                          )}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Le poids ne se mesure pas borne par borne : le camion est pesé au
            centre de tri. Afficher une colonne de tirets laissait croire à une
            donnée manquante, alors qu'elle n'existe pas. On dit où elle est. */}
        <p className="text-[11px] text-slate-400 px-2 py-2 border-t border-slate-100">
          Le poids est pesé au centre de tri, pas borne par borne — il figure au total de la tournée.
        </p>
      </div>

      {/* Reprendre la main sur la tournée : programme (ordre, ajout/retrait de
          points), équipe (chauffeur/suiveurs) — panneau dédié, source de
          vérité propre (GET /tours/:id/programme), sans toucher au tableau
          ci-dessus ni au reste de la page. */}
      <TourProgrammePanel tourId={tour.id} onChanged={onRefresh} />

      {/* Canal manager → chauffeur (item 62) */}
      <TourMessagePanel tour={tour} />
    </div>
  );
}

// ── Consignes manager → chauffeur (item 62) ────────────────────────────────
// Envoi d'une consigne à un chauffeur en tournée (consigne, CAV ajouté, danger
// signalé) + suivi de l'accusé de lecture (lu / non lu). ADMIN/MANAGER (la page
// et l'API l'imposent). Le chauffeur la reçoit en bannière sur son mobile.
function TourMessagePanel({ tour }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const vehicleId = tour.vehicle_id;

  const loadMessages = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const res = await api.get('/tours/messages', { params: { vehicle_id: vehicleId, tour_id: tour.id } });
      setMessages(res.data.messages || []);
      setError(null);
    } catch (err) {
      console.error('[CollectionsLive] messages:', err);
      setError('Impossible de charger les consignes');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, tour.id]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const send = async () => {
    const msg = text.trim();
    if (!msg || !vehicleId) return;
    setSending(true);
    setError(null);
    try {
      await api.post('/tours/messages', { vehicle_id: vehicleId, tour_id: tour.id, message: msg });
      setText('');
      await loadMessages();
    } catch (err) {
      setError(err.response?.data?.error || "Échec de l'envoi de la consigne");
    } finally {
      setSending(false);
    }
  };

  if (!vehicleId) {
    return (
      <div className="mt-4 text-xs text-slate-400">
        Aucun véhicule associé à cette tournée — impossible d'envoyer une consigne.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-2">
        <MessageSquare className="w-3.5 h-3.5" />
        Consignes au chauffeur — {tour.driver_name || '—'}
      </h3>
      <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-3">
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Consigne, CAV ajouté, danger signalé…"
            className="flex-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="self-stretch px-3 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Send className="w-3.5 h-3.5" />
            {sending ? '…' : 'Envoyer une consigne'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {loading ? (
          <p className="text-xs text-slate-400">Chargement…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-slate-400">Aucune consigne envoyée à ce chauffeur.</p>
        ) : (
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2 text-xs border-b border-slate-100 pb-1.5 last:border-0">
                <div className="min-w-0">
                  <p className="text-slate-700 break-words">{m.message}</p>
                  <p className="text-[10px] text-slate-400">
                    {fmtDateTime(m.created_at)}
                    {(m.sender_first_name || m.sender_last_name)
                      ? ` · ${[m.sender_first_name, m.sender_last_name].filter(Boolean).join(' ')}`
                      : ''}
                  </p>
                </div>
                {m.read_at ? (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-emerald-600 font-medium" title={`Lu à ${fmtTime(m.read_at)}`}>
                    <CheckCircle2 className="w-3 h-3" /> Lu
                  </span>
                ) : (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-amber-600 font-medium">
                    <CircleDashed className="w-3 h-3" /> Non lu
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
