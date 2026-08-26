import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Filter, RefreshCw, X, CheckCircle2, Clock, Image as ImageIcon } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Modal, ErrorState } from '../components';
import api from '../services/api';
import { INCIDENT_TYPE_LABELS, INCIDENT_STATUS_LABELS } from '../utils/incidents';

// Libellés métier (FR). Alignés sur l'enum SQL incidents.type.
// Libellés partagés avec le compte rendu de tournée : une seule table, pour
// qu'un type ne puisse pas se nommer différemment d'un écran à l'autre.
const TYPE_LABELS = INCIDENT_TYPE_LABELS;
const STATUS_LABELS = INCIDENT_STATUS_LABELS;
const STATUS_COLORS = {
  open: 'bg-red-100 text-red-700 border-red-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  resolved: 'bg-green-100 text-green-700 border-green-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Transitions autorisées (miroir du backend routes/incidents.js).
const TRANSITIONS = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
};
const REQUIRE_NOTE = new Set(['resolved', 'closed']);

function StatusPill({ status }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [stats, setStats] = useState({ open: 0, in_progress: 0, resolved: 0, closed: 0, total: 0 });
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    status: '', type: '', vehicle_id: '', tour_id: searchParams.get('tourId') || '', from: '', to: '',
  });

  const [selected, setSelected] = useState(null); // incident ouvert dans le panneau
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState('');

  const loadIncidents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const [incRes, statsRes] = await Promise.all([
        api.get('/incidents', { params }),
        api.get('/incidents/stats').catch(() => ({ data: null })),
      ]);
      setIncidents(incRes.data || []);
      if (statsRes.data) setStats(statsRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger les incidents.');
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => { loadIncidents(); }, [loadIncidents]);

  useEffect(() => {
    api.get('/vehicles').then(r => setVehicles(r.data || [])).catch(() => setVehicles([]));
  }, []);

  const openPanel = (incident) => {
    setSelected(incident);
    setResolutionNotes(incident.resolution_notes || '');
    setPanelError('');
  };

  const applyTransition = async (nextStatus) => {
    if (!selected) return;
    if (REQUIRE_NOTE.has(nextStatus) && !resolutionNotes.trim()) {
      setPanelError('Un commentaire de résolution est obligatoire pour résoudre ou clôturer.');
      return;
    }
    setSaving(true);
    setPanelError('');
    try {
      const res = await api.patch(`/incidents/${selected.id}`, {
        status: nextStatus,
        resolution_notes: resolutionNotes.trim() || undefined,
      });
      // Mise à jour locale optimiste + rechargement des compteurs.
      setIncidents(prev => prev.map(i => (i.id === selected.id ? { ...i, ...res.data } : i)));
      setSelected(null);
      await loadIncidents();
    } catch (err) {
      setPanelError(err.response?.data?.error || 'Échec de la mise à jour.');
    }
    setSaving(false);
  };

  const resetFilters = () => setFilters({ status: '', type: '', vehicle_id: '', tour_id: '', from: '', to: '' });
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const fmtDate = (d) => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const STAT_CARDS = [
    { key: 'open', label: 'Ouverts', color: 'text-red-600' },
    { key: 'in_progress', label: 'En cours', color: 'text-amber-600' },
    { key: 'resolved', label: 'Résolus', color: 'text-green-600' },
    { key: 'closed', label: 'Clôturés', color: 'text-slate-500' },
  ];

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Incidents"
          subtitle="Suivi et clôture des incidents de collecte (véhicules, CAV, sécurité)"
          icon={AlertTriangle}
          actions={
            <button onClick={loadIncidents} className="btn-secondary text-sm inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4" strokeWidth={1.8} /> Actualiser
            </button>
          }
        />

        {/* Compteurs par statut */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {STAT_CARDS.map(c => (
            <button
              key={c.key}
              onClick={() => setFilters(f => ({ ...f, status: f.status === c.key ? '' : c.key }))}
              className={`card-modern p-4 text-left transition-all ${filters.status === c.key ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}
            >
              <p className="text-xs text-slate-400 uppercase tracking-wide">{c.label}</p>
              <p className={`text-2xl font-bold mt-1 ${c.color}`}>{stats[c.key] ?? 0}</p>
            </button>
          ))}
        </div>

        {/* Filtres */}
        <div className="card-modern p-4 mb-5">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-600">
            <Filter className="w-4 h-4" strokeWidth={1.8} /> Filtres
            {hasActiveFilters && (
              <button onClick={resetFilters} className="ml-auto text-xs text-primary underline inline-flex items-center gap-1">
                <X className="w-3 h-3" /> Réinitialiser
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="input-modern text-sm">
              <option value="">Tous statuts</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} className="input-modern text-sm">
              <option value="">Tous types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={filters.vehicle_id} onChange={e => setFilters(f => ({ ...f, vehicle_id: e.target.value }))} className="input-modern text-sm">
              <option value="">Tous véhicules</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name || v.registration}</option>)}
            </select>
            <input type="number" placeholder="N° tournée" value={filters.tour_id} onChange={e => setFilters(f => ({ ...f, tour_id: e.target.value }))} className="input-modern text-sm" />
            <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className="input-modern text-sm" title="Date de début" />
            <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className="input-modern text-sm" title="Date de fin" />
          </div>
        </div>

        {loading ? (
          <LoadingSpinner size="lg" message="Chargement des incidents..." />
        ) : error ? (
          <ErrorState variant="card" title="Incidents indisponibles" message={error} onRetry={loadIncidents} />
        ) : incidents.length === 0 ? (
          <div className="card-modern p-12 text-center text-slate-400">
            Aucun incident {hasActiveFilters ? 'ne correspond aux filtres' : 'enregistré'}.
          </div>
        ) : (
          <div className="card-modern overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                    <th className="px-4 py-2.5">Statut</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Description</th>
                    <th className="px-4 py-2.5">Véhicule / CAV</th>
                    <th className="px-4 py-2.5">Tournée</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map(inc => (
                    <tr key={inc.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => openPanel(inc)}>
                      <td className="px-4 py-3"><StatusPill status={inc.status} /></td>
                      <td className="px-4 py-3 font-medium">{TYPE_LABELS[inc.type] || inc.type}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="flex items-center gap-1.5">
                          {inc.photo_path && <ImageIcon className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />}
                          <span className="truncate text-slate-600">{inc.description || <span className="text-slate-300">—</span>}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {inc.vehicle_registration || inc.vehicle_name || '—'}
                        {inc.cav_name && <div className="text-xs text-slate-400">{inc.cav_name}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{inc.tour_id ? `#${inc.tour_id}` : '—'}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(inc.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); openPanel(inc); }} className="text-primary text-xs font-medium hover:underline">
                          Traiter
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Panneau de traitement / résolution */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `Incident #${selected.id}` : ''}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <StatusPill status={selected.status} />
              <span className="text-sm font-medium text-slate-700">{TYPE_LABELS[selected.type] || selected.type}</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-slate-400 text-xs">Signalé le</dt><dd>{fmtDate(selected.created_at)}</dd></div>
              <div><dt className="text-slate-400 text-xs">Tournée</dt><dd>{selected.tour_id ? `#${selected.tour_id}` : '—'}{selected.tour_date ? ` (${new Date(selected.tour_date).toLocaleDateString('fr-FR')})` : ''}</dd></div>
              <div><dt className="text-slate-400 text-xs">Véhicule</dt><dd>{selected.vehicle_registration || selected.vehicle_name || '—'}</dd></div>
              <div><dt className="text-slate-400 text-xs">CAV</dt><dd>{selected.cav_name || '—'}{selected.cav_commune ? ` — ${selected.cav_commune}` : ''}</dd></div>
              {selected.employee_name && selected.employee_name.trim() && (
                <div><dt className="text-slate-400 text-xs">Chauffeur</dt><dd>{selected.employee_name}</dd></div>
              )}
            </dl>

            {selected.description && (
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <p className="text-xs text-slate-400 mb-1">Description</p>
                <p className="text-slate-700">{selected.description}</p>
              </div>
            )}

            {selected.photo_path && (
              <div>
                <p className="text-xs text-slate-400 mb-1">Photo</p>
                <a href={selected.photo_path} target="_blank" rel="noopener noreferrer">
                  <img src={selected.photo_path} alt="Photo de l'incident" className="rounded-lg border max-h-56 object-contain" />
                </a>
              </div>
            )}

            {(selected.resolved_by_name && selected.resolved_by_name.trim()) && (
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" strokeWidth={1.8} />
                Traité par {selected.resolved_by_name} le {fmtDate(selected.resolved_at)}
              </div>
            )}

            {/* Zone de résolution */}
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Commentaire de résolution
                {REQUIRE_NOTE.has('resolved') && <span className="text-slate-400 text-xs"> (obligatoire pour résoudre / clôturer)</span>}
              </label>
              <textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                rows={3}
                placeholder="Action corrective, décision prise…"
                className="input-modern w-full text-sm"
              />

              {panelError && (
                <p className="mt-2 text-sm text-red-600 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" strokeWidth={1.8} /> {panelError}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                {(TRANSITIONS[selected.status] || []).map(next => {
                  const isResolve = next === 'resolved' || next === 'closed';
                  const isReopen = next === 'open' || next === 'in_progress';
                  return (
                    <button
                      key={next}
                      onClick={() => applyTransition(next)}
                      disabled={saving}
                      className={`text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50 inline-flex items-center gap-1.5 ${
                        isResolve ? 'bg-green-600 text-white hover:bg-green-700'
                        : isReopen && next === 'in_progress' ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {next === 'in_progress' && <Clock className="w-4 h-4" strokeWidth={1.8} />}
                      {isResolve && <CheckCircle2 className="w-4 h-4" strokeWidth={1.8} />}
                      {next === 'in_progress' ? 'Prendre en charge'
                        : next === 'resolved' ? 'Marquer résolu'
                        : next === 'closed' ? 'Clôturer'
                        : next === 'open' ? 'Rouvrir' : STATUS_LABELS[next]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
