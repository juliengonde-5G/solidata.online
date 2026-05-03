import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, MapSizeFix } from '../components';
import api from '../services/api';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import {
  MapPin, Truck, Gauge, Clock, AlertTriangle,
  CheckCircle2, CircleDashed, XCircle, Activity,
  Route as RouteIcon, Users, ChevronDown, ChevronUp,
} from 'lucide-react';

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

export default function CollectionsLive() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedTour, setExpandedTour] = useState(null);
  const [livePositions, setLivePositions] = useState({}); // vehicle_id → {lat, lng, speed, ts}
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
    } catch (err) {
      console.error('[CollectionsLive] active-summary:', err);
    }
    setLoading(false);
  }, []);

  // Initial load + polling 30s + Socket.IO pour positions GPS temps réel
  useEffect(() => {
    loadActive();
    const interval = setInterval(loadActive, 30000);

    const token = localStorage.getItem('token');
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
    socket.on('cav-status-update', loadActive);
    socket.on('tour-status-update', loadActive);

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, [loadActive]);

  const tours = data?.tours || [];
  const kpis = data?.kpis || { vehicules_actifs: 0, cav_a_vider: 0, avancement_pct: 0, distance_restante_km: 0 };

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

        {tours.length === 0 ? (
          <div className="card-modern p-12 text-center">
            <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">Aucune tournée active aujourd'hui</p>
            <p className="text-xs text-slate-400 mt-1">Les tournées planifiées apparaîtront ici dès leur démarrage</p>
          </div>
        ) : (
          <>
            {/* Carte multi-tournées */}
            <div className="card-modern overflow-hidden" style={{ height: '60vh' }}>
              <MapContainer center={mapCenter} zoom={11} style={{ height: '100%', width: '100%' }}>
                <MapSizeFix />
                <TileLayer
                  attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />

                {tours.map((tour, idx) => {
                  const color = TOUR_COLORS[idx % TOUR_COLORS.length];
                  const validPoints = tour.points.filter((p) => p.latitude && p.longitude);
                  const linePoints = validPoints
                    .filter((p) => p.status === 'pending' || p.status === 'in_progress')
                    .map((p) => [p.latitude, p.longitude]);

                  return (
                    <FragmentBlock key={tour.id}>
                      {/* Itinéraire restant */}
                      {linePoints.length >= 2 && (
                        <Polyline
                          positions={linePoints}
                          pathOptions={{ color, weight: 3, opacity: 0.6, dashArray: '6 4' }}
                        />
                      )}

                      {/* Points CAV */}
                      {validPoints.map((p) => {
                        const isCollected = p.status === 'collected';
                        const isIncident = p.status === 'incident' || p.status === 'skipped';
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
                                {p.weight_kg != null && <p>Poids déclaré : <strong>{p.weight_kg} kg</strong></p>}
                                {p.fill_level != null && <p>Remplissage : <strong>{p.fill_level}/5</strong></p>}
                                {p.planned_passage_time && !isCollected && (
                                  <p className="text-slate-400">Passage prévu : {fmtTime(p.planned_passage_time)}</p>
                                )}
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
                            </div>
                          </Popup>
                        </Marker>
                      )}
                    </FragmentBlock>
                  );
                })}
              </MapContainer>
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
                              <p className="text-[10px] text-slate-500">{tour.collection_type === 'association' ? 'Associations' : 'CAV'} · {tour.status}</p>
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
                              {tour.distance_remaining_km != null ? `${tour.distance_remaining_km}/${tour.distance_km || '—'} km` : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-xs tabular-nums">
                              {fmtDuration(tour.elapsed_min)} / {fmtDuration(tour.estimated_duration_min)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {tour.alert_overrun && (
                                <span title="Risque de dépassement de durée" className="inline-flex"><AlertTriangle className="w-4 h-4 text-red-500" /></span>
                              )}
                              {tour.nb_incidents > 0 && (
                                <span title={`${tour.nb_incidents} incident(s)`} className="ml-1 inline-flex"><XCircle className="w-4 h-4 text-amber-500" /></span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-xs font-semibold tabular-nums">
                              {tour.weight_collected_kg > 0 ? `${tour.weight_collected_kg} kg` : '—'}
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr>
                              <td colSpan={9} className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                                <ExpandedDetail tour={tour} color={color} />
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

function ExpandedDetail({ tour, color }) {
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
              <th className="text-right py-1.5 px-2">Poids</th>
            </tr>
          </thead>
          <tbody>
            {tour.points.map((p) => {
              const isCollected = p.status === 'collected';
              const isIncident = p.status === 'incident' || p.status === 'skipped';
              const StatusIco = isCollected ? CheckCircle2 : isIncident ? XCircle : CircleDashed;
              const statusColor = isCollected ? 'text-emerald-600' : isIncident ? 'text-red-500' : 'text-slate-400';
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
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {p.weight_kg != null ? <span className="font-semibold">{p.weight_kg} kg</span> : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
