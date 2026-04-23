import { useState, useEffect } from 'react';
import { MapPin, Filter, ArrowLeft, Layers, Building2 } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Section } from '../components';
import api from '../services/api';
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker } from 'react-leaflet';
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
  const [assoPoints, setAssoPoints] = useState([]);
  const [showAsso, setShowAsso] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [mapRes, communeRes, assoRes] = await Promise.all([
        api.get('/cav/map'),
        api.get('/cav/communes'),
        api.get('/association-points/map'),
      ]);
      setCavs(mapRes.data);
      setCommunes(communeRes.data);
      setAssoPoints(assoRes.data);
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

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de la carte..." /></Layout>;

  // Stats remplissage
  const highCount = filtered.filter(c => (c.estimated_fill_rate || 0) >= 80).length;
  const medCount = filtered.filter(c => { const r = c.estimated_fill_rate || 0; return r >= 40 && r < 80; }).length;
  const lowCount = filtered.filter(c => (c.estimated_fill_rate || 0) < 40).length;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Carte des CAV"
          subtitle={`${filtered.length} Conteneurs d'Apport Volontaire · remplissage estimé par algorithme`}
          icon={MapPin}
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Filter className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={filterCommune}
                  onChange={e => setFilterCommune(e.target.value)}
                  className="pl-9 pr-8 py-2 rounded-button border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-colors"
                >
                  <option value="">Toutes les communes</option>
                  {communes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-button border border-slate-200 bg-white text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={showAsso}
                  onChange={e => setShowAsso(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <Building2 className="w-3.5 h-3.5 text-orange-500" />
                Associations ({assoPoints.filter(a => a.latitude).length})
              </label>
            </div>
          }
        />

        {/* Stats remplissage — mini KPIs */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-card bg-white border border-slate-200 p-3 shadow-card flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">&gt; 80 %</p>
              <p className="text-lg font-extrabold text-red-600">{highCount}</p>
            </div>
          </div>
          <div className="rounded-card bg-white border border-slate-200 p-3 shadow-card flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-amber-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">40 – 80 %</p>
              <p className="text-lg font-extrabold text-amber-600">{medCount}</p>
            </div>
          </div>
          <div className="rounded-card bg-white border border-slate-200 p-3 shadow-card flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">&lt; 40 %</p>
              <p className="text-lg font-extrabold text-emerald-600">{lowCount}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Map */}
          <div className="lg:col-span-2 rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-card relative" style={{ height: '70vh' }}>
            {/* Overlay header */}
            <div className="absolute top-3 left-3 z-[400] flex items-center gap-2 px-3 py-2 rounded-button bg-white/95 backdrop-blur border border-slate-200 shadow-card">
              <Layers className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-semibold text-slate-700">Vue territoire</span>
            </div>
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
                    key={`cav-${cav.id}`}
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
                        <p className="font-bold">{cav.name}</p>
                        <p>{cav.commune}</p>
                        <p>Remplissage estimé (algorithme) : {Math.round(fillRate)}%</p>
                        <p>Conteneurs : {cav.nb_containers || '—'}</p>
                      </div>
                    </Popup>
                  </Circle>
                );
              })}

              {/* Points de collecte associatifs */}
              {showAsso && assoPoints.map(ap => {
                if (!ap.latitude || !ap.longitude) return null;
                return (
                  <CircleMarker
                    key={`asso-${ap.id}`}
                    center={[ap.latitude, ap.longitude]}
                    radius={8}
                    pathOptions={{
                      color: '#EA580C',
                      fillColor: '#FB923C',
                      fillOpacity: 0.8,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="text-xs">
                        <p className="font-bold text-orange-700">{ap.name}</p>
                        <p>{ap.address}{ap.ville ? `, ${ap.ville}` : ''}</p>
                        {ap.contact_phone && <p>Tél : {ap.contact_phone}</p>}
                        <p className="text-orange-600 font-medium mt-1">Point associatif</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-3 max-h-[70vh]">
            {selectedCav ? (
              <Section padded={false} className="flex-1 overflow-hidden">
                <div className="p-5 overflow-y-auto h-full">
                  <button
                    onClick={() => setSelectedCav(null)}
                    className="inline-flex items-center gap-1.5 text-teal-600 hover:text-teal-700 text-xs font-semibold mb-3"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Retour à la liste
                  </button>
                  <div className="flex items-start gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm text-white"
                      style={{ backgroundColor: getFillColor(selectedCav.estimated_fill_rate || 0) }}
                    >
                      {Math.round(selectedCav.estimated_fill_rate || 0)}%
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-extrabold text-lg text-slate-800 leading-tight">{selectedCav.name}</h3>
                      <p className="text-xs text-slate-500">{selectedCav.commune}</p>
                    </div>
                  </div>
                  <dl className="space-y-2.5 text-sm">
                    <DetailRow label="Adresse" value={selectedCav.address} />
                    <DetailRow label="Conteneurs" value={selectedCav.nb_containers} />
                    <DetailRow label="Tournée" value={selectedCav.tournee} />
                    <DetailRow label="QR Code" value={selectedCav.qr_code_data ? 'Oui' : 'Non'} />
                    <DetailRow label="Statut" value={selectedCav.status === 'active' ? 'Actif' : 'Indisponible'} />
                  </dl>
                </div>
              </Section>
            ) : (
              <Section
                title="Liste des CAV"
                subtitle={`${filtered.length} point${filtered.length > 1 ? 's' : ''}`}
                icon={MapPin}
                padded={false}
                className="flex-1 overflow-hidden"
              >
                <div className="overflow-y-auto max-h-[calc(70vh-72px)] p-3 space-y-2">
                  {filtered.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">Aucun CAV ne correspond à ce filtre.</p>
                  ) : filtered.map(cav => {
                    const rate = cav.estimated_fill_rate || 0;
                    const color = getFillColor(rate);
                    return (
                      <button
                        key={cav.id}
                        onClick={() => loadCavDetail(cav.id)}
                        className="w-full text-left rounded-xl bg-white border border-slate-200 p-3 hover:border-teal-300 hover:shadow-card-hover transition-all flex items-center gap-3 group"
                      >
                        <div
                          className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold text-xs"
                          style={{ backgroundColor: color }}
                        >
                          {Math.round(rate)}%
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-800 truncate group-hover:text-teal-700">{cav.name}</p>
                          <p className="text-xs text-slate-500 truncate">{cav.commune}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800 text-right">{value || '—'}</dd>
    </div>
  );
}
