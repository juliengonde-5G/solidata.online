import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import {
  MapPin, Truck, Gauge, Clock, Target, TrendingUp, AlertTriangle,
  CheckCircle2, CircleDashed, XCircle, Wrench, Info,
} from 'lucide-react';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const truckIcon = new L.DivIcon({
  html: '<div style="background:#2D8C4E;color:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">🚛</div>',
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const POINT_COLORS = {
  collected: '#16a34a',
  pending: '#cbd5e1',
  skipped: '#f59e0b',
  incident: '#dc2626',
};

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, '0')}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function DelayBadge({ minutes }) {
  if (minutes === null || minutes === undefined) return null;
  const late = minutes > 2;
  const early = minutes < -2;
  const cls = late ? 'bg-red-100 text-red-700' : early ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700';
  const sign = minutes > 0 ? '+' : '';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {sign}{minutes} min
    </span>
  );
}

function FillBar({ level }) {
  if (level === null || level === undefined) return <span className="text-xs text-slate-400">—</span>;
  const percent = Math.min(100, Math.max(0, level * 20));
  const color = percent >= 80 ? 'bg-red-500' : percent >= 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-1.5 min-w-[60px]">
      <div className="h-1.5 bg-slate-200 rounded-full flex-1 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[10px] text-slate-500 tabular-nums">{percent}%</span>
    </div>
  );
}

function StatusIcon({ status }) {
  switch (status) {
    case 'collected': return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    case 'skipped': return <XCircle className="w-4 h-4 text-amber-600" />;
    case 'incident': return <AlertTriangle className="w-4 h-4 text-red-600" />;
    default: return <CircleDashed className="w-4 h-4 text-slate-400" />;
  }
}

function AlertBanner({ alerts }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        <span className="text-sm text-emerald-800">Tournée nominale — aucune alerte</span>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {alerts.map((a, i) => {
        const color = a.level === 'error'
          ? 'bg-red-50 border-red-100 text-red-800'
          : a.level === 'warn'
          ? 'bg-amber-50 border-amber-100 text-amber-800'
          : 'bg-blue-50 border-blue-100 text-blue-800';
        const Icon = a.category === 'maintenance' ? Wrench : a.category === 'delay' ? Clock : a.category === 'incident' ? AlertTriangle : Info;
        return (
          <div key={i} className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${color}`}>
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm">{a.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function KPICard({ label, value, unit, icon: Icon, accent = 'slate' }) {
  const styles = {
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-100 text-slate-700',
  };
  return (
    <div className="card-modern p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium truncate">{label}</p>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl font-bold text-slate-800 tabular-nums">{value}</span>
            {unit && <span className="text-xs text-slate-400">{unit}</span>}
          </div>
        </div>
        {Icon && (
          <div className={`p-1.5 rounded-lg ${styles[accent] || styles.slate}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function LiveVehicles() {
  const [activeTours, setActiveTours] = useState([]);
  const [selectedTourId, setSelectedTourId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [livePosition, setLivePosition] = useState(null);
  const [trail, setTrail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const socketRef = useRef(null);

  // Initialisation : liste des tournées actives + connexion socket
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/tours?status=in_progress');
        setActiveTours(res.data || []);
        if (res.data && res.data.length > 0) {
          setSelectedTourId(res.data[0].id);
        }
      } catch (err) {
        console.error('[CollectionsLive] Chargement tournées actives:', err);
      }
      setLoading(false);
    })();

    const token = localStorage.getItem('token');
    const socket = io(window.location.origin, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect_error', (err) => {
      console.warn('[CollectionsLive] Socket error:', err?.message);
    });

    return () => { socket.disconnect(); };
  }, []);

  // Charger la synthèse de la tournée sélectionnée
  const loadSummary = useCallback(async (tourId) => {
    if (!tourId) return;
    setSummaryLoading(true);
    try {
      const res = await api.get(`/tours/${tourId}/live-summary`);
      setSummary(res.data);
      // Initialiser le trail avec la dernière position si dispo
      if (res.data.last_position) {
        setLivePosition({
          lat: res.data.last_position.latitude,
          lng: res.data.last_position.longitude,
          speed: res.data.last_position.speed,
          timestamp: res.data.last_position.recorded_at,
        });
      } else {
        setLivePosition(null);
      }
      setTrail([]);
    } catch (err) {
      console.error('[CollectionsLive] Chargement synthèse:', err);
    }
    setSummaryLoading(false);
  }, []);

  // Rejoindre la room Socket.IO + charger la synthèse quand la tournée change
  useEffect(() => {
    if (!selectedTourId || !socketRef.current) return;
    const socket = socketRef.current;

    const join = () => socket.emit('join-tour', parseInt(selectedTourId, 10));
    if (socket.connected) join();
    else socket.once('connect', join);

    loadSummary(selectedTourId);

    const onPosition = (data) => {
      const tourKey = data.tourId || data.tour_id;
      if (parseInt(tourKey, 10) !== parseInt(selectedTourId, 10)) return;
      const lat = parseFloat(data.latitude);
      const lng = parseFloat(data.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setLivePosition({ lat, lng, speed: data.speed, timestamp: data.timestamp });
      setTrail(prev => [...prev, [lat, lng]].slice(-200));
    };

    const onCavUpdate = () => {
      // Rafraîchit la synthèse complète pour mettre à jour KPI + liste CAV.
      loadSummary(selectedTourId);
    };
    const onTourUpdate = () => loadSummary(selectedTourId);

    socket.on('vehicle-position', onPosition);
    socket.on('cav-status-update', onCavUpdate);
    socket.on('tour-status-update', onTourUpdate);

    return () => {
      socket.off('vehicle-position', onPosition);
      socket.off('cav-status-update', onCavUpdate);
      socket.off('tour-status-update', onTourUpdate);
    };
  }, [selectedTourId, loadSummary]);

  // Polling filet de sécurité (20 s) pour remonter incidents/pesées si socket muet
  useEffect(() => {
    if (!selectedTourId) return;
    const interval = setInterval(() => loadSummary(selectedTourId), 20000);
    return () => clearInterval(interval);
  }, [selectedTourId, loadSummary]);

  const mapCenter = useMemo(() => {
    if (livePosition) return [livePosition.lat, livePosition.lng];
    if (summary?.points?.length) {
      const p = summary.points.find(pt => pt.latitude && pt.longitude) || summary.points[0];
      if (p?.latitude) return [parseFloat(p.latitude), parseFloat(p.longitude)];
    }
    return [49.4231, 1.0993];
  }, [livePosition, summary]);

  if (loading) {
    return <Layout><LoadingSpinner size="lg" message="Chargement des tournées en cours…" /></Layout>;
  }

  if (activeTours.length === 0) {
    return (
      <Layout>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Truck className="w-6 h-6 text-slate-500" />
            <h1 className="text-2xl font-bold text-slate-800">Suivi des collectes en cours</h1>
          </div>
          <div className="card-modern p-12 text-center">
            <CircleDashed className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">Aucune tournée en cours pour le moment.</p>
            <p className="text-sm text-slate-400 mt-1">Les tournées démarrées par les chauffeurs apparaîtront ici automatiquement.</p>
          </div>
        </div>
      </Layout>
    );
  }

  const kpis = summary?.kpis || {};
  const points = summary?.points || [];
  const alerts = summary?.alerts || [];
  const tour = summary?.tour;

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Top bar : sélection véhicule/tournée */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-50">
              <MapPin className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-slate-800">Suivi des collectes en cours</h1>
              <p className="text-xs text-slate-500">
                {activeTours.length} tournée{activeTours.length > 1 ? 's' : ''} active{activeTours.length > 1 ? 's' : ''}
                {' '}· temps réel via GPS
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-2 align-middle" />
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">Tournée</label>
            <select
              value={selectedTourId || ''}
              onChange={(e) => setSelectedTourId(parseInt(e.target.value, 10))}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {activeTours.map(t => (
                <option key={t.id} value={t.id}>
                  {t.registration || `Tournée #${t.id}`} — {t.driver_name || 'sans chauffeur'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Bandeau alertes "Op Solidata" */}
        <AlertBanner alerts={alerts} />

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard
            label="Avancement"
            value={`${kpis.nb_cav_collected ?? 0}/${kpis.nb_cav_total ?? 0}`}
            unit={`${kpis.progress_percent ?? 0}%`}
            icon={Target}
            accent="green"
          />
          <KPICard
            label="Remplissage camion"
            value={`${kpis.fill_cumulated_percent ?? 0}`}
            unit="%"
            icon={TrendingUp}
            accent={kpis.fill_cumulated_percent >= 80 ? 'red' : kpis.fill_cumulated_percent >= 50 ? 'amber' : 'green'}
          />
          <KPICard
            label="Distance parcourue"
            value={kpis.distance_km ?? 0}
            unit="km"
            icon={Gauge}
            accent="slate"
          />
          <KPICard
            label="Durée écoulée"
            value={formatDuration(kpis.elapsed_min)}
            icon={Clock}
            accent="slate"
          />
          <KPICard
            label="Décalage moyen"
            value={kpis.avg_delay_min === null || kpis.avg_delay_min === undefined ? '—' : `${kpis.avg_delay_min > 0 ? '+' : ''}${kpis.avg_delay_min}`}
            unit={kpis.avg_delay_min !== null && kpis.avg_delay_min !== undefined ? 'min' : ''}
            icon={Clock}
            accent={kpis.avg_delay_min > 15 ? 'red' : kpis.avg_delay_min > 5 ? 'amber' : 'green'}
          />
          <KPICard
            label="ETA fin"
            value={formatTime(kpis.eta_end)}
            icon={Clock}
            accent="blue"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Carte */}
          <div className="lg:col-span-2 card-modern overflow-hidden" style={{ height: '70vh' }}>
            <MapContainer center={mapCenter} zoom={12} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* Markers CAV */}
              {points.map((p) => {
                if (!p.latitude || !p.longitude) return null;
                const color = POINT_COLORS[p.status] || POINT_COLORS.pending;
                return (
                  <CircleMarker
                    key={p.id}
                    center={[parseFloat(p.latitude), parseFloat(p.longitude)]}
                    radius={8}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9 }}
                  >
                    <Popup>
                      <div className="text-xs space-y-0.5">
                        <p className="font-bold">{p.position}. {p.cav_name}</p>
                        {p.address && <p className="text-slate-500">{p.address}</p>}
                        <p>Statut : <strong>{p.status}</strong></p>
                        {p.fill_level !== null && p.fill_level !== undefined && (
                          <p>Remplissage : <strong>{p.fill_level * 20}%</strong></p>
                        )}
                        {p.has_incident && (
                          <p className="text-red-600">⚠ Incident signalé</p>
                        )}
                        {p.collected_at && (
                          <p className="text-slate-500">Collecté à {formatTime(p.collected_at)}</p>
                        )}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {/* Trail GPS */}
              {trail.length > 1 && (
                <Polyline positions={trail} pathOptions={{ color: '#2D8C4E', weight: 3, opacity: 0.7 }} />
              )}

              {/* Position véhicule live */}
              {livePosition && (
                <Marker position={[livePosition.lat, livePosition.lng]} icon={truckIcon}>
                  <Popup>
                    <div className="text-xs">
                      <p className="font-bold">{tour?.vehicle?.registration || 'Véhicule'}</p>
                      <p>{tour?.driver?.name || '—'}</p>
                      <p>Vitesse : {livePosition.speed ? `${Math.round(livePosition.speed)} km/h` : '—'}</p>
                      <p className="text-slate-400">{livePosition.timestamp ? formatTime(livePosition.timestamp) : ''}</p>
                    </div>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>

          {/* Liste CAV */}
          <div className="card-modern overflow-hidden flex flex-col" style={{ height: '70vh' }}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">Points de la tournée</h3>
                <p className="text-[11px] text-slate-500">
                  {tour?.collection_type === 'association' ? 'Points associations' : 'Conteneurs CAV'}
                  {' · '}
                  {kpis.nb_cav_collected ?? 0}/{kpis.nb_cav_total ?? 0} collectés
                </p>
              </div>
              {summaryLoading && <LoadingSpinner size="sm" />}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {points.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-400">
                  Aucun point dans la tournée
                </div>
              )}
              {points.map((p) => (
                <div key={p.id} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5"><StatusIcon status={p.status} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-400 tabular-nums">#{p.position}</span>
                        <span className="text-sm font-medium text-slate-800 truncate">{p.cav_name}</span>
                      </div>
                      {p.commune && (
                        <p className="text-[11px] text-slate-500 truncate">{p.commune}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        {p.status === 'collected' && (
                          <>
                            <FillBar level={p.fill_level} />
                            <span className="text-[11px] text-slate-500">
                              {formatTime(p.collected_at)}
                            </span>
                            <DelayBadge minutes={p.delay_minutes} />
                          </>
                        )}
                        {p.status === 'pending' && p.planned_passage_at && (
                          <span className="text-[11px] text-slate-500">
                            Prévu : {formatTime(p.planned_passage_at)}
                          </span>
                        )}
                        {p.status === 'skipped' && (
                          <span className="text-[11px] text-amber-700 font-medium">Non collecté</span>
                        )}
                        {p.has_incident && (
                          <span title={p.incidents[0]?.description || 'Incident'}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                            <AlertTriangle className="w-3 h-3" /> Incident
                          </span>
                        )}
                      </div>

                      {p.notes && (
                        <p className="text-[11px] text-slate-500 italic mt-1 truncate">« {p.notes} »</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pied : pesée retour tri si présente */}
            {summary?.weights?.length > 0 && (
              <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-xs">
                <span className="text-slate-500">Pesée retour : </span>
                <span className="font-semibold text-slate-700">
                  {Math.round((kpis.total_weight_kg || 0) * 10) / 10} kg
                </span>
                <span className="text-slate-400 ml-2">
                  ({summary.weights.length} pesée{summary.weights.length > 1 ? 's' : ''})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
