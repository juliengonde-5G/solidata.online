import { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Truck, User, AlertTriangle, X, Users, Car,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Section } from '../components';
import api from '../services/api';

// ─── Helpers date ────────────────────────────────────────────
function shiftDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function formatHuman(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// ─── Cartes drag ─────────────────────────────────────────────
function DriverCard({ d, onDragStart, isAssignedElsewhere }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, { type: 'driver', id: d.id, label: `${d.first_name} ${d.last_name}` })}
      className={`p-2.5 rounded-lg border bg-white cursor-grab active:cursor-grabbing transition
        ${d.is_day_off ? 'opacity-50 border-dashed border-slate-300' : 'border-slate-200 hover:border-emerald-400 hover:shadow-sm'}
        ${isAssignedElsewhere ? 'ring-1 ring-amber-300' : ''}`}
      title={d.is_day_off ? 'Jour off' : ''}
    >
      <div className="flex items-start gap-2">
        <div className="p-1.5 rounded bg-slate-100 flex-shrink-0">
          <User className="w-3.5 h-3.5 text-slate-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">
            {d.first_name} {d.last_name}
          </p>
          <p className="text-[11px] text-slate-400 truncate">
            {d.team_name || d.position || '—'}
          </p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {d.is_day_off && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Jour off</span>
            )}
            {isAssignedElsewhere && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Déjà affecté</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VehicleCard({ v, onDragStart, isAssignedElsewhere }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, { type: 'vehicle', id: v.id, label: v.registration })}
      className={`p-2.5 rounded-lg border bg-white cursor-grab active:cursor-grabbing transition border-slate-200 hover:border-emerald-400 hover:shadow-sm
        ${isAssignedElsewhere ? 'ring-1 ring-amber-300' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="p-1.5 rounded bg-slate-100 flex-shrink-0">
          <Truck className="w-3.5 h-3.5 text-slate-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">{v.registration}</p>
          <p className="text-[11px] text-slate-400 truncate">
            {v.name || '—'}
            {v.max_capacity_kg ? ` · ${Math.round(v.max_capacity_kg)} kg` : ''}
          </p>
          {isAssignedElsewhere && (
            <span className="inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
              Déjà affecté
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Slot de drop sur une tournée ────────────────────────────
function DropSlot({ label, icon: Icon, value, onDrop, onClear, accepts, dragTarget, highlight }) {
  const [isOver, setIsOver] = useState(false);
  const canAccept = dragTarget && accepts.includes(dragTarget.type);
  return (
    <div
      onDragOver={(e) => { if (canAccept) { e.preventDefault(); setIsOver(true); } }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsOver(false); if (canAccept) onDrop(dragTarget); }}
      className={`flex items-center gap-2 p-2 rounded-lg border-2 min-h-[42px] transition
        ${isOver ? 'border-emerald-500 bg-emerald-50' : 'border-dashed border-slate-200 bg-slate-50'}
        ${highlight ? 'border-red-300 bg-red-50' : ''}`}
    >
      <Icon className={`w-4 h-4 ${value ? 'text-slate-600' : 'text-slate-300'} flex-shrink-0`} />
      <span className="text-xs text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 truncate flex-1">
        {value || <span className="text-slate-300">Déposer ici</span>}
      </span>
      {value && onClear && (
        <button onClick={onClear} className="text-slate-400 hover:text-red-500" title="Retirer">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────
export default function PlanningTournees() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dragTarget, setDragTarget] = useState(null);
  const [conflictModal, setConflictModal] = useState(null); // { tourId, payload, conflicts }
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tours/planning/resources', { params: { date } });
      setData(res.data);
    } catch (err) {
      console.error('[PlanningTournees] load :', err);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const handleDragStart = (e, target) => {
    e.dataTransfer.effectAllowed = 'copyMove';
    setDragTarget(target);
    try { e.dataTransfer.setData('text/plain', JSON.stringify(target)); } catch (_) { /* Safari */ }
  };

  const showToast = (msg, level = 'info') => {
    setToast({ msg, level });
    setTimeout(() => setToast(null), 3500);
  };

  const doAssign = useCallback(async (tourId, payload, force = false) => {
    try {
      const body = { ...payload };
      if (force) body.force = true;
      const res = await api.patch(`/tours/${tourId}/assign`, body);
      const conflicts = res.data?.conflicts || [];
      if (conflicts.length > 0 && !force) {
        setConflictModal({ tourId, payload, conflicts });
        return;
      }
      showToast('Affectation enregistrée', 'success');
      await load();
    } catch (err) {
      const conflicts = err.response?.data?.conflicts;
      if (conflicts?.length) {
        setConflictModal({ tourId, payload, conflicts });
      } else {
        showToast(err.response?.data?.error || 'Erreur d\'affectation', 'error');
      }
    }
  }, [load]);

  const assignFromDrop = useCallback((tour, target) => {
    const payload = target.type === 'driver'
      ? { driver_employee_id: target.id }
      : { vehicle_id: target.id };
    doAssign(tour.id, payload);
  }, [doAssign]);

  const clearSlot = useCallback((tour, field) => {
    doAssign(tour.id, { [field]: null });
  }, [doAssign]);

  if (loading && !data) return <Layout><LoadingSpinner size="lg" message="Chargement du planning…" /></Layout>;

  const tours = data?.tours || [];
  const drivers = data?.drivers || [];
  const vehicles = data?.vehicles || [];

  return (
    <Layout>
      <div
        className="p-4 md:p-6 space-y-4"
        onDragEnd={() => setDragTarget(null)}
      >
        {/* Header + date picker */}
        <PageHeader
          title="Planning tournées"
          subtitle={formatHuman(date)}
          icon={Calendar}
          actions={
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDate(shiftDays(date, -1))}
                className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                aria-label="Jour précédent"
              >
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700"
              />
              <button
                onClick={() => setDate(shiftDays(date, 1))}
                className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                aria-label="Jour suivant"
              >
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
              <button
                onClick={() => setDate(new Date().toISOString().slice(0, 10))}
                className="ml-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50"
              >
                Aujourd'hui
              </button>
            </div>
          }
        />

        {/* Grid : resources pool + tours */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Ressources */}
          <div className="space-y-4">
            {/* Chauffeurs */}
            <div className="card-modern p-3">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">Chauffeurs</h3>
                <span className="text-[11px] text-slate-400 ml-auto">
                  {drivers.filter(d => !d.is_day_off).length} dispo
                </span>
              </div>
              <div className="space-y-1.5 max-h-[35vh] overflow-y-auto pr-1">
                {drivers.map(d => (
                  <DriverCard
                    key={d.id}
                    d={d}
                    onDragStart={handleDragStart}
                    isAssignedElsewhere={d.assigned_tour_id !== null}
                  />
                ))}
                {drivers.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">Aucun chauffeur</p>
                )}
              </div>
            </div>

            {/* Véhicules */}
            <div className="card-modern p-3">
              <div className="flex items-center gap-2 mb-2">
                <Car className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">Véhicules</h3>
                <span className="text-[11px] text-slate-400 ml-auto">
                  {vehicles.filter(v => !v.assigned_tour_id).length} libre{vehicles.filter(v => !v.assigned_tour_id).length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1.5 max-h-[35vh] overflow-y-auto pr-1">
                {vehicles.map(v => (
                  <VehicleCard
                    key={v.id}
                    v={v}
                    onDragStart={handleDragStart}
                    isAssignedElsewhere={v.assigned_tour_id !== null}
                  />
                ))}
                {vehicles.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">Aucun véhicule</p>
                )}
              </div>
            </div>
          </div>

          {/* Tournées */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {tours.length} tournée{tours.length > 1 ? 's' : ''} programmée{tours.length > 1 ? 's' : ''}
              </p>
            </div>

            {tours.length === 0 && (
              <div className="card-modern p-10 text-center">
                <Truck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Aucune tournée planifiée pour cette date</p>
                <p className="text-slate-400 text-xs mt-1">Créez des tournées via la page <strong>Tournées</strong></p>
              </div>
            )}

            {tours.map(tour => (
              <div key={tour.id} className="card-modern p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">#{tour.id}</span>
                    <span className="text-sm font-semibold text-slate-800">
                      {tour.route_name || (tour.collection_type === 'association' ? 'Tournée association' : 'Tournée CAV')}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      tour.status === 'in_progress' ? 'bg-orange-100 text-orange-700'
                      : tour.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                      : tour.status === 'cancelled' ? 'bg-slate-200 text-slate-600'
                      : 'bg-slate-100 text-slate-600'}`}>
                      {tour.status}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {tour.nb_cav} point{tour.nb_cav > 1 ? 's' : ''}
                    {tour.estimated_duration_min ? ` · ${tour.estimated_duration_min} min prévu` : ''}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <DropSlot
                    label="Chauffeur"
                    icon={User}
                    value={tour.driver_name}
                    accepts={['driver']}
                    dragTarget={dragTarget}
                    onDrop={(t) => assignFromDrop(tour, t)}
                    onClear={tour.driver_name ? () => clearSlot(tour, 'driver_employee_id') : null}
                  />
                  <DropSlot
                    label="Véhicule"
                    icon={Truck}
                    value={tour.registration}
                    accepts={['vehicle']}
                    dragTarget={dragTarget}
                    onDrop={(t) => assignFromDrop(tour, t)}
                    onClear={tour.registration ? () => clearSlot(tour, 'vehicle_id') : null}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal conflit */}
      {conflictModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h3 className="font-semibold text-slate-800">Conflit d'affectation</h3>
            </div>
            <div className="p-5 space-y-2">
              {conflictModal.conflicts.map((c, i) => (
                <p key={i} className="text-sm text-slate-700">
                  {c.reason === 'driver_already_assigned' && `Chauffeur déjà affecté à la tournée #${c.tour_id}`}
                  {c.reason === 'vehicle_already_assigned' && `Véhicule déjà affecté à la tournée #${c.tour_id}`}
                  {c.reason === 'driver_day_off' && `Jour off du chauffeur (${c.day_off})`}
                  {c.reason === 'vehicle_unavailable' && `Véhicule indisponible (${c.status})`}
                </p>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => setConflictModal(null)}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                onClick={async () => {
                  const { tourId, payload } = conflictModal;
                  setConflictModal(null);
                  await doAssign(tourId, payload, true);
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
              >
                Forcer l'affectation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white
          ${toast.level === 'error' ? 'bg-red-600' : toast.level === 'success' ? 'bg-emerald-600' : 'bg-slate-700'}`}>
          {toast.msg}
        </div>
      )}
    </Layout>
  );
}
