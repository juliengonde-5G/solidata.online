import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar, Truck, User, AlertTriangle, X, Users, Car,
  ChevronLeft, ChevronRight, ChevronDown, Plus, UserPlus, Clock,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Modal } from '../components';
import CreateTourModal from '../components/tours/CreateTourModal';
import api from '../services/api';

// Statuts d'une demande de collecte — DÉRIVÉS côté serveur, jamais saisis
// (contrat §4.2) : traduits en français et distingués visuellement.
const DEMANDE_STATUT_META = {
  a_planifier: { label: 'À planifier', cls: 'bg-amber-100 text-amber-700' },
  planifiee: { label: 'Planifiée', cls: 'bg-blue-100 text-blue-700' },
  honoree: { label: 'Honorée', cls: 'bg-emerald-100 text-emerald-700' },
  non_honoree: { label: 'Non honorée', cls: 'bg-red-100 text-red-700' },
  annulee: { label: 'Annulée', cls: 'bg-slate-200 text-slate-500' },
};

const EMPTY_DEMANDE_FORM = {
  association_point_id: '', date_souhaitee: '', heure_debut: '', heure_fin: '',
  tolerance_min: '', commentaire: '',
};

// Une DATE PostgreSQL arrive parfois en ISO 'YYYY-MM-DD' (string courte),
// parfois en datetime sérialisé complet ('2026-08-26T00:00:00.000Z') selon la
// requête serveur — normalisée ICI UNE fois pour que toutes les comparaisons
// de date en aval (bascule du planning, égalité de jour) restent fiables.
// La conversion en UTC est sans risque de dérive : une DATE Postgres est
// toujours sérialisée à minuit UTC exact du jour concerné.
function toIsoDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && v.length <= 10) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Lundi → dimanche de la semaine ISO contenant la date donnée ('YYYY-MM-DD').
function weekRange(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0 = dimanche
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return { du: fmt(monday), au: fmt(sunday) };
}

// Badge du mode de planification d'une tournée (IA / modèle / manuelle / association)
function modeBadge(t) {
  if (t.collection_type === 'association') return { label: 'Association', cls: 'bg-teal-100 text-teal-700' };
  if (t.mode === 'intelligent') return { label: 'IA', cls: 'bg-violet-100 text-violet-700' };
  if (t.mode === 'standard') return { label: 'Modèle', cls: 'bg-blue-100 text-blue-700' };
  return { label: 'Manuelle', cls: 'bg-slate-100 text-slate-600' };
}

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
  const [showCreate, setShowCreate] = useState(false);
  // Les équipes hors Collecte/Logistique sont un renfort exceptionnel : repliées
  // par défaut, dépliables d'un clic (l'affectation elle-même reste autorisée).
  const [showAutresEquipes, setShowAutresEquipes] = useState(false);

  // ── Demandes de collecte associations (RG-B) ──────────────────────────────
  const [demandes, setDemandes] = useState([]);
  const [demandesLoading, setDemandesLoading] = useState(false);
  const [demandesError, setDemandesError] = useState(null);
  const [assoPointsOptions, setAssoPointsOptions] = useState([]);
  const [showDemandeForm, setShowDemandeForm] = useState(false);
  const [demandeForm, setDemandeForm] = useState(EMPTY_DEMANDE_FORM);
  const [demandeFormSaving, setDemandeFormSaving] = useState(false);
  const [demandeFormError, setDemandeFormError] = useState(null);
  const [cancelingId, setCancelingId] = useState(null);
  // Demande sur laquelle « Planifier » a été cliqué : ouvre CreateTourModal
  // préremplie (date + point). Si la demande porte sur un autre jour que celui
  // affiché, on bascule d'abord le planning sur ce jour (les ressources
  // affichées — véhicules/chauffeurs libres — doivent être celles du bon jour).
  const [prefillDemande, setPrefillDemande] = useState(null);

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

  const loadDemandes = useCallback(async () => {
    setDemandesLoading(true);
    setDemandesError(null);
    try {
      const { du, au } = weekRange(date);
      const res = await api.get('/association-demandes', { params: { du, au } });
      const list = (Array.isArray(res.data) ? res.data : []).map((d) => ({
        ...d,
        date_souhaitee: toIsoDate(d.date_souhaitee) || d.date_souhaitee,
      }));
      setDemandes(list);
    } catch (err) {
      console.error('[PlanningTournees] demandes :', err);
      setDemandesError('Impossible de charger les demandes de collecte');
      setDemandes([]);
    }
    setDemandesLoading(false);
  }, [date]);

  useEffect(() => { loadDemandes(); }, [loadDemandes]);

  // Associations actives, pour le sélecteur de la nouvelle demande — un seul
  // point à choisir, une simple liste suffit (pas besoin du CavPicker complet).
  useEffect(() => {
    api.get('/association-points', { params: { status: 'active' } })
      .then((res) => setAssoPointsOptions(Array.isArray(res.data) ? res.data : []))
      .catch(() => setAssoPointsOptions([]));
  }, []);

  const tourIdsWithDemande = useMemo(() => {
    const set = new Set();
    demandes.forEach((d) => {
      if (d.tour_id != null && (d.statut === 'planifiee' || d.statut === 'honoree')) set.add(d.tour_id);
    });
    return set;
  }, [demandes]);

  const submitDemande = async (e) => {
    e.preventDefault();
    if (!demandeForm.association_point_id || !demandeForm.date_souhaitee || !demandeForm.heure_debut) return;
    setDemandeFormSaving(true);
    setDemandeFormError(null);
    try {
      await api.post('/association-demandes', {
        association_point_id: parseInt(demandeForm.association_point_id, 10),
        date_souhaitee: demandeForm.date_souhaitee,
        heure_debut: demandeForm.heure_debut,
        heure_fin: demandeForm.heure_fin || undefined,
        tolerance_min: demandeForm.tolerance_min ? parseInt(demandeForm.tolerance_min, 10) : undefined,
        commentaire: demandeForm.commentaire || undefined,
      });
      setShowDemandeForm(false);
      setDemandeForm(EMPTY_DEMANDE_FORM);
      showToast('Demande de collecte créée', 'success');
      loadDemandes();
    } catch (err) {
      const code = err.response?.data?.code;
      setDemandeFormError(
        code === 'DEMANDE_DOUBLON'
          ? 'Une demande existe déjà pour cette association à cette date.'
          : (err.response?.data?.error || 'Erreur lors de la création de la demande')
      );
    }
    setDemandeFormSaving(false);
  };

  const cancelDemande = async (d) => {
    if (cancelingId) return;
    setCancelingId(d.id);
    try {
      await api.post(`/association-demandes/${d.id}/annuler`, {});
      showToast('Demande annulée', 'success');
      await loadDemandes();
    } catch (err) {
      showToast(err.response?.data?.error || "Impossible d'annuler la demande", 'error');
    }
    setCancelingId(null);
  };

  // Ouvre la création de tournée préremplie (date + point) depuis une demande
  // « à planifier » (RG-B2). Si la demande porte sur un jour différent de
  // celui affiché, on bascule le planning dessus d'abord — la modale n'ouvre
  // qu'une fois les ressources (véhicules/chauffeurs) du bon jour chargées.
  const planifierDemande = (d) => {
    setPrefillDemande(d);
    if (d.date_souhaitee !== date) setDate(d.date_souhaitee);
  };

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
  // La collecte se fait normalement avec les équipes Collecte et Logistique :
  // elles sont affichées en premier. Les autres équipes restent affectables
  // (renfort ponctuel) mais dans un bloc distinct, replié par défaut.
  const equipesPrioritaires = data?.equipes_prioritaires || ['Collecte', 'Logistique'];
  const driversCollecte = drivers.filter(d => d.is_equipe_collecte);
  const driversAutres = drivers.filter(d => !d.is_equipe_collecte);

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
                onClick={() => setShowCreate(true)}
                className="mr-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              >
                <Plus className="w-4 h-4" /> Créer une tournée
              </button>
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

        {/* Demandes de collecte (associations) — semaine affichée (RG-B) */}
        <div className="card-modern p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">Demandes de collecte (associations)</h3>
              <span className="text-[11px] text-slate-400">semaine du {(() => { const { du } = weekRange(date); return formatHuman(du); })()}</span>
            </div>
            <button
              onClick={() => { setDemandeForm(EMPTY_DEMANDE_FORM); setDemandeFormError(null); setShowDemandeForm(true); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Nouvelle demande
            </button>
          </div>
          {demandesError && <p className="text-xs text-red-600 mb-2">{demandesError}</p>}
          {demandesLoading && demandes.length === 0 ? (
            <p className="text-xs text-slate-400">Chargement…</p>
          ) : demandes.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune demande de collecte cette semaine.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {demandes.map((d) => {
                const meta = DEMANDE_STATUT_META[d.statut] || { label: d.statut, cls: 'bg-slate-100 text-slate-600' };
                return (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                    <span className="font-semibold text-slate-700 whitespace-nowrap capitalize">{formatHuman(d.date_souhaitee)}</span>
                    <span className="font-mono text-slate-500 whitespace-nowrap">
                      {String(d.heure_debut).slice(0, 5)}{d.heure_fin ? `–${String(d.heure_fin).slice(0, 5)}` : ''}
                    </span>
                    <span className="text-slate-700 truncate flex-1 min-w-[120px]">{d.association_nom}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                    {d.tour_id != null && <span className="text-[10px] text-slate-400 whitespace-nowrap">tournée #{d.tour_id}</span>}
                    {d.commentaire && (
                      <span className="text-slate-400 italic truncate max-w-[160px]" title={d.commentaire}>{d.commentaire}</span>
                    )}
                    <div className="ml-auto flex gap-1.5">
                      {d.statut === 'a_planifier' && (
                        <button
                          onClick={() => planifierDemande(d)}
                          className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700"
                        >
                          Planifier
                        </button>
                      )}
                      {(d.statut === 'a_planifier' || d.statut === 'planifiee') && (
                        <button
                          onClick={() => cancelDemande(d)}
                          disabled={cancelingId === d.id}
                          className="px-2 py-1 rounded-md border border-slate-300 text-slate-600 text-[11px] hover:bg-slate-100 disabled:opacity-50"
                        >
                          {cancelingId === d.id ? '…' : 'Annuler'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Grid : resources pool + tours */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Ressources */}
          <div className="space-y-4">
            {/* Chauffeurs */}
            <div className="card-modern p-3">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">Équipe collecte</h3>
                <span className="text-[11px] text-slate-400 ml-auto">
                  {driversCollecte.filter(d => !d.is_day_off).length} dispo
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-1.5">
                {equipesPrioritaires.join(' · ')}
              </p>
              <div className="space-y-1.5 max-h-[35vh] overflow-y-auto pr-1">
                {driversCollecte.map(d => (
                  <DriverCard
                    key={d.id}
                    d={d}
                    onDragStart={handleDragStart}
                    isAssignedElsewhere={d.assigned_tour_id !== null}
                  />
                ))}
                {driversCollecte.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">
                    Aucun collaborateur des équipes {equipesPrioritaires.join(' / ')}
                  </p>
                )}
              </div>

              {/* Renfort : autres équipes — affectation exceptionnelle, donc
                  repliée par défaut mais pleinement fonctionnelle (glisser-déposer). */}
              {driversAutres.length > 0 && (
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setShowAutresEquipes(v => !v)}
                    className="w-full flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-700"
                  >
                    {showAutresEquipes ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span>Autres équipes ({driversAutres.length}) — renfort exceptionnel</span>
                  </button>
                  {showAutresEquipes && (
                    <div className="space-y-1.5 max-h-[25vh] overflow-y-auto pr-1 mt-1.5">
                      {driversAutres.map(d => (
                        <DriverCard
                          key={d.id}
                          d={d}
                          onDragStart={handleDragStart}
                          isAssignedElsewhere={d.assigned_tour_id !== null}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                <p className="text-slate-400 text-xs mt-1">Utilisez le bouton <strong>« Créer une tournée »</strong> (IA, modèle ou manuelle)</p>
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
                    {(() => { const b = modeBadge(tour); return (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${b.cls}`}>{b.label}</span>
                    ); })()}
                    {tourIdsWithDemande.has(tour.id) && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700" title="Un rendez-vous de collecte est rattaché à cette tournée">
                        <Clock className="w-3 h-3" /> RDV
                      </span>
                    )}
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
                    /* Pas de « retirer » sur le véhicule : une tournée ne peut
                       pas exister sans lui (c'est le véhicule qui porte le lien
                       d'accès du chauffeur). Proposer une action impossible
                       menait à une erreur serveur opaque. On remplace un
                       véhicule en en déposant un autre. */
                    onClear={null}
                  />
                  <DropSlot
                    label="Suiveur 1"
                    icon={UserPlus}
                    value={tour.suiveur1_name}
                    accepts={['driver']}
                    dragTarget={dragTarget}
                    onDrop={(t) => doAssign(tour.id, { suiveur1_employee_id: t.id })}
                    onClear={tour.suiveur1_name ? () => clearSlot(tour, 'suiveur1_employee_id') : null}
                  />
                  <DropSlot
                    label="Suiveur 2"
                    icon={UserPlus}
                    value={tour.suiveur2_name}
                    accepts={['driver']}
                    dragTarget={dragTarget}
                    onDrop={(t) => doAssign(tour.id, { suiveur2_employee_id: t.id })}
                    onClear={tour.suiveur2_name ? () => clearSlot(tour, 'suiveur2_employee_id') : null}
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
                  {c.reason === 'employee_already_assigned' && `Déjà affecté(e) (chauffeur ou suiveur) à la tournée #${c.tour_id}`}
                  {c.reason === 'vehicle_already_assigned' && `Véhicule déjà affecté à la tournée #${c.tour_id}`}
                  {c.reason === 'driver_day_off' && `Jour off de la personne (${c.day_off})`}
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

      {/* Création d'une tournée pour la date affichée (IA / modèle / manuelle) */}
      {showCreate && (
        <CreateTourModal
          date={date}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setShowCreate(false)}
          onCreated={() => { showToast('Tournée créée', 'success'); load(); }}
        />
      )}

      {/* Création préremplie depuis une demande de collecte (RG-B2) — le
          planning bascule d'abord sur le jour de la demande (ressources du
          bon jour), puis la modale s'ouvre. */}
      {prefillDemande && (
        data?.date === prefillDemande.date_souhaitee ? (
          <CreateTourModal
            date={prefillDemande.date_souhaitee}
            vehicles={vehicles}
            drivers={drivers}
            prefill={{
              demandeId: prefillDemande.id,
              associationPointId: prefillDemande.association_point_id,
              associationPointName: prefillDemande.association_nom,
              heureLabel: `${String(prefillDemande.heure_debut).slice(0, 5)}${prefillDemande.heure_fin ? `–${String(prefillDemande.heure_fin).slice(0, 5)}` : ''}`,
            }}
            onClose={() => setPrefillDemande(null)}
            onCreated={() => {
              showToast('Tournée créée depuis la demande', 'success');
              setPrefillDemande(null);
              load();
              loadDemandes();
            }}
          />
        ) : (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl px-6 py-4 text-sm text-slate-600 shadow-2xl">
              Chargement du planning du {formatHuman(prefillDemande.date_souhaitee)}…
            </div>
          </div>
        )
      )}

      {/* Nouvelle demande de collecte (RG-B1) */}
      <Modal isOpen={showDemandeForm} onClose={() => setShowDemandeForm(false)} title="Nouvelle demande de collecte" size="sm">
        <form onSubmit={submitDemande} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Association *</label>
            <select
              value={demandeForm.association_point_id}
              onChange={(e) => setDemandeForm((f) => ({ ...f, association_point_id: e.target.value }))}
              className="input-modern text-sm"
              required
            >
              <option value="">— Choisir —</option>
              {assoPointsOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.ville ? ` — ${p.ville}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Date souhaitée *</label>
              <input
                type="date"
                value={demandeForm.date_souhaitee}
                onChange={(e) => setDemandeForm((f) => ({ ...f, date_souhaitee: e.target.value }))}
                className="input-modern text-sm"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Heure *</label>
              <input
                type="time"
                value={demandeForm.heure_debut}
                onChange={(e) => setDemandeForm((f) => ({ ...f, heure_debut: e.target.value }))}
                className="input-modern text-sm"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Heure de fin (créneau, facultatif)</label>
              <input
                type="time"
                value={demandeForm.heure_fin}
                onChange={(e) => setDemandeForm((f) => ({ ...f, heure_fin: e.target.value }))}
                className="input-modern text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Tolérance (min)</label>
              <input
                type="number" min="0" max="120"
                placeholder="15 (défaut)"
                value={demandeForm.tolerance_min}
                onChange={(e) => setDemandeForm((f) => ({ ...f, tolerance_min: e.target.value }))}
                className="input-modern text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Commentaire</label>
            <textarea
              value={demandeForm.commentaire}
              onChange={(e) => setDemandeForm((f) => ({ ...f, commentaire: e.target.value }))}
              rows={2}
              className="input-modern text-sm"
            />
          </div>
          {demandeFormError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{demandeFormError}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setShowDemandeForm(false)} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">
              Annuler
            </button>
            <button type="submit" disabled={demandeFormSaving} className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
              {demandeFormSaving ? 'Création…' : 'Créer la demande'}
            </button>
          </div>
        </form>
      </Modal>

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
