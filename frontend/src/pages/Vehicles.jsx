import { useState, useEffect, useCallback } from 'react';
import { Truck, Plus, Pencil, FileText, Download, Trash2, Lightbulb, AlertTriangle, Archive, ArchiveRestore } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, StatusBadge, Modal, PageHeader } from '../components';
import VehicleAccessPanel from '../components/VehicleAccessPanel';
import DemoFormationPanel from '../components/DemoFormationPanel';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const EVENT_TYPES = [
  { value: 'entretien', label: 'Entretien / Révision' },
  { value: 'vidange', label: 'Vidange' },
  { value: 'pneus', label: 'Pneumatiques' },
  { value: 'freins', label: 'Freins' },
  { value: 'controle_technique', label: 'Contrôle technique' },
  { value: 'reparation', label: 'Réparation' },
  { value: 'accident', label: 'Accident / Sinistre' },
  { value: 'autre', label: 'Autre' },
];
const EVENT_COLORS = {
  entretien: 'bg-blue-100 text-blue-700', vidange: 'bg-yellow-100 text-yellow-700',
  pneus: 'bg-purple-100 text-purple-700', freins: 'bg-orange-100 text-orange-700',
  controle_technique: 'bg-indigo-100 text-indigo-700', reparation: 'bg-red-100 text-red-700',
  accident: 'bg-red-200 text-red-800', autre: 'bg-slate-100 text-gray-700',
};

const DOC_TYPE_LABELS = {
  carte_grise: 'Carte grise', assurance: 'Assurance', controle_technique: 'CT',
  facture_entretien: 'Facture entretien', facture_reparation: 'Facture réparation',
  permis_conduire: 'Permis', constat: 'Constat', autre: 'Autre',
};
const DOC_TYPE_OPTIONS = [
  { value: 'carte_grise', label: 'Carte grise' },
  { value: 'assurance', label: 'Attestation assurance' },
  { value: 'controle_technique', label: 'Contrôle technique' },
  { value: 'facture_entretien', label: 'Facture entretien' },
  { value: 'facture_reparation', label: 'Facture réparation' },
  { value: 'constat', label: 'Constat amiable' },
  { value: 'autre', label: 'Autre document' },
];

// ── Carte d'état du véhicule ───────────────────────────────────────────────
// Le chauffeur POINTE les dégâts sur un schéma du camion : la donnée stockée
// est un couple (x, y) relatif à une vue, entre 0 et 1. Les restituer en texte
// — « choc, vue arrière » — perd exactement ce que le geste apportait :
// l'ENDROIT. Deux chocs à l'arrière ne se réparent pas de la même façon selon
// qu'ils sont sur la porte ou sur le pare-chocs.
const DEGAT_VUES = [
  ['avant', 'Avant'], ['arriere', 'Arrière'], ['gauche', 'Côté gauche'], ['droit', 'Côté droit'],
];
const DEGAT_COULEURS = {
  rayure: 'bg-amber-500', choc: 'bg-red-600', bris: 'bg-red-900', autre: 'bg-slate-500',
};
const DEGAT_LIBELLES = { rayure: 'Rayure', choc: 'Choc', bris: 'Bris', autre: 'Autre' };

/**
 * Les quatre vues du camion avec les dégâts reportés à leur place.
 * Rend `null` quand aucun dégât n'est exploitable : quatre cadres vides
 * occuperaient la place d'une information sans en être une.
 */
function CarteDegats({ degats }) {
  const pts = (degats || []).filter(
    (d) => d && Number.isFinite(Number(d.x)) && Number.isFinite(Number(d.y))
  );
  if (pts.length === 0) return null;

  return (
    <div>
      <p className="font-semibold text-slate-700 mb-2 text-sm">Carte d'état — emplacement des dégâts</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {DEGAT_VUES.map(([cle, libelle]) => {
          const sur = pts.filter((d) => d.vue === cle);
          return (
            <div key={cle}>
              <p className="text-[10px] uppercase text-slate-500 mb-1">{libelle}</p>
              <div className="relative w-full aspect-[3/2] rounded-md border border-slate-300 bg-slate-50 overflow-hidden">
                {sur.map((d, i) => (
                  <span
                    key={i}
                    className={`absolute w-3 h-3 rounded-full ring-2 ring-white ${DEGAT_COULEURS[d.type] || DEGAT_COULEURS.autre}`}
                    style={{
                      left: `${Math.max(0, Math.min(1, Number(d.x))) * 100}%`,
                      top: `${Math.max(0, Math.min(1, Number(d.y))) * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    title={`${DEGAT_LIBELLES[d.type] || d.type}${d.commentaire ? ` : ${d.commentaire}` : ''}`}
                  />
                ))}
                {sur.length === 0 && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-300">
                    rien à signaler
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {Object.entries(DEGAT_LIBELLES).map(([cle, libelle]) => (
          <span key={cle} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <span className={`w-2.5 h-2.5 rounded-full ${DEGAT_COULEURS[cle]}`} />{libelle}
          </span>
        ))}
      </div>
    </div>
  );
}

const emptyForm = {
  registration: '', name: '', brand: '', model: '', type: 'utilitaire',
  max_capacity_kg: 3500, tare_weight_kg: '', current_km: 0,
  next_maintenance: '', insurance_expiry: '', team_id: '', status: 'available',
  vehicle_type: 'generic', engine: '', year: '',
};

export default function Vehicles() {
  const { user } = useAuth();
  // Onglet Démo formation (véhicule dédié aux formations) : ADMIN/MANAGER
  // uniquement — un rôle personnalisé est résolu via base_role (même
  // convention que EnergieGES.jsx / HomeRedirect d'App.jsx).
  const baseRole = user?.base_role || user?.role;
  const canViewDemo = ['ADMIN', 'MANAGER'].includes(baseRole);

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('fleet');
  const [maintenanceOverview, setMaintenanceOverview] = useState([]);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });

  // Detail / schedule / events
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [events, setEvents] = useState([]);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState({
    event_type: 'entretien', event_date: new Date().toISOString().split('T')[0],
    km_at_event: '', description: '', cost: '', performed_by: '',
  });

  // Documents
  const [documents, setDocuments] = useState([]);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState({ doc_type: 'autre', title: '', expiry_date: '', notes: '' });
  const [docFile, setDocFile] = useState(null);

  const [maintenanceProfiles, setMaintenanceProfiles] = useState([]);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);

  // Checklists de départ (item 45) — consultation web des rondes chauffeur.
  const [checklists, setChecklists] = useState([]);
  // Dernier état déclaré par un chauffeur au départ : c'est la seule
  // information « terrain » de la fiche d'entretien, qui n'affichait jusqu'ici
  // que des échéances théoriques.
  const [etatDeclare, setEtatDeclare] = useState(null);
  const [checklistOuverte, setChecklistOuverte] = useState(null);

  // useEffect loadVehicles déplacé après includeArchived (voir plus bas)
  useEffect(() => { if (activeTab === 'maintenance') loadMaintenance(); }, [activeTab]);

  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => { loadVehicles(); loadMaintenanceProfiles(); }, [includeArchived]);

  const loadVehicles = async () => {
    try {
      const res = await api.get(`/vehicles${includeArchived ? '?include_archived=true' : ''}`);
      setVehicles(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const archiveVehicle = async (v) => {
    if (!window.confirm(`Archiver le véhicule ${v.registration} ? Il ne sera plus proposé dans les nouvelles tournées (mais l'historique reste préservé).`)) return;
    try {
      await api.patch(`/vehicles/${v.id}/archive`);
      loadVehicles();
    } catch (err) { console.error(err); alert('Erreur archivage'); }
  };

  const restoreVehicle = async (v) => {
    try {
      await api.patch(`/vehicles/${v.id}/restore`);
      loadVehicles();
    } catch (err) { console.error(err); alert('Erreur restauration'); }
  };

  const loadMaintenanceProfiles = async () => {
    try {
      const res = await api.get('/vehicles/maintenance/profiles-db');
      setMaintenanceProfiles(res.data);
    } catch (err) { console.error(err); }
  };

  const generateMaintenancePlan = async () => {
    if (!form.brand || !form.model) {
      alert('Renseignez la marque et le modèle du véhicule avant de générer le plan.');
      return;
    }
    setGeneratingPlan(true);
    setGeneratedPlan(null);
    try {
      const res = await api.post('/vehicles/maintenance/generate-plan', {
        brand: form.brand,
        model: form.model,
        year: form.year || undefined,
        engine: form.engine || undefined,
        vehicle_id: editingId || undefined,
      });
      setGeneratedPlan(res.data.plan);
      setForm(f => ({ ...f, vehicle_type: res.data.vehicle_type }));
      loadMaintenanceProfiles();
      if (editingId && selectedVehicle) {
        loadSchedule(editingId);
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la génération';
      alert(msg);
    }
    setGeneratingPlan(false);
  };

  const loadMaintenance = async () => {
    try {
      const res = await api.get('/vehicles/maintenance/overview');
      setMaintenanceOverview(res.data);
    } catch (err) { console.error(err); }
  };

  const loadSchedule = useCallback(async (vehicleId) => {
    try {
      const res = await api.get(`/vehicles/maintenance/schedule/${vehicleId}`);
      setSchedule(res.data);
    } catch (err) { console.error(err); setSchedule(null); }
  }, []);

  const loadEvents = useCallback(async (vehicleId) => {
    try {
      const res = await api.get(`/vehicles/${vehicleId}/events`);
      setEvents(res.data);
    } catch (err) { console.error(err); setEvents([]); }
  }, []);

  const loadDocuments = useCallback(async (vehicleId) => {
    try {
      const res = await api.get(`/vehicles/${vehicleId}/documents`);
      setDocuments(res.data);
    } catch (err) { console.error(err); setDocuments([]); }
  }, []);

  const loadChecklists = useCallback(async (vehicleId) => {
    try {
      const [liste, etat] = await Promise.all([
        api.get(`/vehicles/${vehicleId}/checklists`),
        api.get(`/vehicles/${vehicleId}/etat-declare`).catch(() => ({ data: null })),
      ]);
      setChecklists(liste.data || []);
      setEtatDeclare(etat.data || null);
      setChecklistOuverte(null);
    } catch (err) { console.error(err); setChecklists([]); setEtatDeclare(null); }
  }, []);

  const addDocument = async (e) => {
    e.preventDefault();
    if (!selectedVehicle || !docFile) return;
    const formData = new FormData();
    formData.append('file', docFile);
    formData.append('doc_type', docForm.doc_type);
    formData.append('title', docForm.title || docFile.name);
    if (docForm.expiry_date) formData.append('expiry_date', docForm.expiry_date);
    if (docForm.notes) formData.append('notes', docForm.notes);
    try {
      await api.post(`/vehicles/${selectedVehicle.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setShowDocForm(false);
      setDocForm({ doc_type: 'autre', title: '', expiry_date: '', notes: '' });
      setDocFile(null);
      loadDocuments(selectedVehicle.id);
    } catch (err) { console.error(err); alert('Erreur lors de l\'upload'); }
  };

  const deleteDocument = async (docId) => {
    if (!confirm('Supprimer ce document ?')) return;
    try {
      await api.delete(`/vehicles/${selectedVehicle.id}/documents/${docId}`);
      loadDocuments(selectedVehicle.id);
    } catch (err) { console.error(err); }
  };

  const selectVehicle = (v) => {
    setSelectedVehicle(v);
    loadSchedule(v.id);
    loadEvents(v.id);
    loadDocuments(v.id);
    loadChecklists(v.id);
    setActiveTab('detail');
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setGeneratedPlan(null);
    setShowForm(true);
  };

  const openEdit = (v) => {
    setEditingId(v.id);
    setForm({
      registration: v.registration || '', name: v.name || '',
      brand: v.brand || '', model: v.model || '', type: v.type || 'utilitaire',
      max_capacity_kg: v.max_capacity_kg || 3500, tare_weight_kg: v.tare_weight_kg || '',
      current_km: v.current_km || 0, next_maintenance: v.next_maintenance ? v.next_maintenance.split('T')[0] : '',
      insurance_expiry: v.insurance_expiry ? v.insurance_expiry.split('T')[0] : '',
      team_id: v.team_id || '', status: v.status || 'available',
      vehicle_type: v.vehicle_type || 'generic',
      engine: '', year: '',
    });
    setGeneratedPlan(null);
    setShowForm(true);
  };

  const saveVehicle = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, tare_weight_kg: form.tare_weight_kg ? parseFloat(form.tare_weight_kg) : null };
      if (editingId) {
        await api.put(`/vehicles/${editingId}`, payload);
      } else {
        await api.post('/vehicles', payload);
      }
      setShowForm(false);
      loadVehicles();
    } catch (err) {
      const msg = err.response?.data?.error;
      if (msg) alert(msg);
      else console.error(err);
    }
  };

  const addEvent = async (e) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    try {
      await api.post(`/vehicles/${selectedVehicle.id}/events`, {
        ...eventForm,
        km_at_event: eventForm.km_at_event ? parseInt(eventForm.km_at_event) : null,
        cost: eventForm.cost ? parseFloat(eventForm.cost) : null,
      });
      setShowEventForm(false);
      setEventForm({ event_type: 'entretien', event_date: new Date().toISOString().split('T')[0], km_at_event: '', description: '', cost: '', performed_by: '' });
      loadEvents(selectedVehicle.id);
      loadSchedule(selectedVehicle.id);
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des véhicules..." /></Layout>;

  // Onglet Maintenance retiré : voir page dédiée /vehicle-maintenance
  const tabs = [
    { key: 'fleet', label: 'Flotte' },
    ...(canViewDemo ? [{ key: 'demo', label: 'Démo formation' }] : []),
    ...(selectedVehicle ? [{ key: 'detail', label: selectedVehicle.name || selectedVehicle.registration }] : []),
  ];

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Véhicules"
          subtitle={`Gestion de la flotte — ${vehicles.length} véhicule${vehicles.length > 1 ? 's' : ''}`}
          icon={Truck}
          actions={
            <>
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-3 py-1.5 rounded-md text-sm ${activeTab === t.key ? 'bg-white shadow font-medium' : 'text-slate-500'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              {activeTab === 'fleet' && (
                <>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                    <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="rounded" />
                    Inclure archivés
                  </label>
                  <button onClick={openCreate} className="btn-primary text-sm">
                    <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
                    Nouveau véhicule
                  </button>
                </>
              )}
            </>
          }
        />

        {/* Onglet Flotte */}
        {activeTab === 'fleet' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicles.map(v => (
              <div key={v.id} className={`card-modern p-5 cursor-pointer hover:shadow-md transition ${v.is_archived ? 'opacity-60 ring-1 ring-amber-200 bg-amber-50/30' : ''}`} onClick={() => selectVehicle(v)}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-lg">
                      {v.type === 'camion' ? '🚛' : v.type === 'utilitaire' ? '🚐' : '🚗'}
                    </div>
                    <div>
                      <h3 className="font-bold flex items-center gap-2">
                        {v.registration}
                        {v.is_archived && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wide">Archivé</span>}
                      </h3>
                      <p className="text-xs text-slate-400">{v.brand} {v.model}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={v.status} size="sm" />
                    {!v.is_archived ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); openEdit(v); }} className="text-slate-400 hover:text-primary p-1" title="Modifier">
                          <Pencil className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); archiveVehicle(v); }} className="text-slate-400 hover:text-amber-600 p-1" title="Archiver">
                          <Archive className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                      </>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); restoreVehicle(v); }} className="text-amber-600 hover:text-emerald-600 p-1" title="Restaurer">
                        <ArchiveRestore className="w-4 h-4" strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1 text-xs text-slate-600">
                  <p><span className="text-slate-400">Capacité :</span> {v.max_capacity_kg} kg</p>
                  {v.tare_weight_kg && <p><span className="text-slate-400">Poids à vide :</span> {v.tare_weight_kg} kg</p>}
                  {v.tare_weight_kg && v.max_capacity_kg && <p><span className="text-slate-400">Charge utile :</span> {Math.round(v.max_capacity_kg - v.tare_weight_kg)} kg</p>}
                  <p><span className="text-slate-400">Kilométrage :</span> {(v.current_km || 0).toLocaleString('fr-FR')} km</p>
                  {v.next_maintenance && <p><span className="text-slate-400">Proch. maintenance :</span> {new Date(v.next_maintenance).toLocaleDateString('fr-FR')}</p>}
                  {v.insurance_expiry && <p><span className="text-slate-400">Assurance :</span> {new Date(v.insurance_expiry).toLocaleDateString('fr-FR')}</p>}
                  {v.vehicle_type && v.vehicle_type !== 'generic' && <p><span className="text-slate-400">Profil :</span> <span className="font-medium text-primary">{v.vehicle_type}</span></p>}
                </div>
              </div>
            ))}
            {vehicles.length === 0 && (
              <div className="col-span-full card-modern p-8 text-center text-slate-400">Aucun véhicule enregistré</div>
            )}
          </div>
        )}

        {/* Onglet Démo formation — véhicule dédié aux formations chauffeur (lien /v/<token>) */}
        {activeTab === 'demo' && canViewDemo && (
          <div className="max-w-2xl">
            <DemoFormationPanel />
          </div>
        )}

        {/* Onglet Maintenance */}
        {activeTab === 'maintenance' && (
          <div className="space-y-4">
            {maintenanceOverview.length === 0 ? (
              <div className="card-modern p-8 text-center text-slate-400">Aucune donnée de maintenance. Configurez la maintenance sur chaque véhicule.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {maintenanceOverview.map(v => (
                  <div key={v.id} className={`card-modern p-5 cursor-pointer hover:shadow-md transition ${v.computed_alerts.some(a => a.urgency === 'critique') ? 'border-red-300' : v.computed_alerts.length > 0 ? 'border-orange-200' : ''}`}
                    onClick={() => { const full = vehicles.find(vv => vv.id === v.id); if (full) selectVehicle(full); }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-sm">{v.name || v.registration}</h3>
                        <p className="text-xs text-slate-400">{v.vehicle_type || 'Type non configuré'} — {(v.current_km || 0).toLocaleString('fr-FR')} km</p>
                      </div>
                      <StatusBadge status={v.status} size="sm" />
                    </div>
                    {v.computed_alerts.length > 0 ? (
                      <div className="space-y-1">
                        {v.computed_alerts.map((a, i) => (
                          <div key={i} className={`text-xs px-2 py-1 rounded ${a.urgency === 'critique' ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-700'}`}>
                            {a.urgency === 'critique' ? '!' : '~'} {a.message}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-green-600">Aucune alerte</p>
                    )}
                    {v.last_maintenance_date && <p className="text-xs text-slate-400 mt-2">Dernière révision : {new Date(v.last_maintenance_date).toLocaleDateString('fr-FR')} à {(v.last_maintenance_km || 0).toLocaleString('fr-FR')} km</p>}
                    {v.controle_technique_date && <p className="text-xs text-slate-400">CT : {new Date(v.controle_technique_date).toLocaleDateString('fr-FR')}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Onglet Détail véhicule (grille entretien + historique) */}
        {activeTab === 'detail' && selectedVehicle && (
          <div className="space-y-6">
            {/* Fiche résumé */}
            <div className="card-modern p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-2xl">
                    {selectedVehicle.type === 'camion' ? '🚛' : selectedVehicle.type === 'utilitaire' ? '🚐' : '🚗'}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{selectedVehicle.registration} — {selectedVehicle.brand} {selectedVehicle.model}</h2>
                    <p className="text-sm text-slate-500">{selectedVehicle.name} • {(selectedVehicle.current_km || 0).toLocaleString('fr-FR')} km</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedVehicle.status} />
                  <button onClick={() => openEdit(selectedVehicle)} className="text-slate-500 hover:text-primary p-2 rounded-lg hover:bg-slate-50" title="Modifier">
                    <Pencil className="w-5 h-5" strokeWidth={1.8} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div><span className="text-slate-400 text-xs">Capacité max</span><p className="font-medium">{selectedVehicle.max_capacity_kg} kg</p></div>
                <div><span className="text-slate-400 text-xs">Poids à vide (tare)</span><p className="font-medium">{selectedVehicle.tare_weight_kg ? `${selectedVehicle.tare_weight_kg} kg` : '—'}</p></div>
                <div><span className="text-slate-400 text-xs">Charge utile</span><p className="font-medium">{selectedVehicle.tare_weight_kg ? `${Math.round(selectedVehicle.max_capacity_kg - selectedVehicle.tare_weight_kg)} kg` : '—'}</p></div>
                <div><span className="text-slate-400 text-xs">Assurance</span><p className="font-medium">{selectedVehicle.insurance_expiry ? new Date(selectedVehicle.insurance_expiry).toLocaleDateString('fr-FR') : '—'}</p></div>
                <div><span className="text-slate-400 text-xs">Plan constructeur</span><p className="font-medium">{selectedVehicle.vehicle_type && selectedVehicle.vehicle_type !== 'generic' ? selectedVehicle.vehicle_type : <span className="text-orange-500">Non configuré</span>}</p></div>
              </div>
            </div>

            {/* Accès chauffeur — URL unique « 1 URL = 1 véhicule » (lecture ADMIN + MANAGER, régénération ADMIN) */}
            <VehicleAccessPanel
              vehicleId={selectedVehicle.id}
              registration={selectedVehicle.registration}
              name={selectedVehicle.name}
            />

            {/* Dernier état déclaré au départ — l'information terrain de la
                fiche d'entretien, qui n'affichait que des échéances. */}
            <div className="card-modern p-5">
              <h3 className="font-bold mb-4">Dernier état déclaré par le chauffeur</h3>
              {!etatDeclare?.disponible ? (
                <p className="text-slate-400 text-sm">
                  {etatDeclare?.message || 'Aucune vérification de début de journée enregistrée.'}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-slate-500">
                      {new Date(etatDeclare.date).toLocaleDateString('fr-FR', {
                        weekday: 'long', day: 'numeric', month: 'long',
                      })}
                    </span>
                    {etatDeclare.chauffeur && <span className="font-medium text-slate-700">{etatDeclare.chauffeur}</span>}
                    {/* Un état vieux de trois semaines ne dit rien de l'état
                        d'aujourd'hui : on le signale plutôt que de l'afficher
                        comme s'il était frais. */}
                    {etatDeclare.anciennete_jours > 7 && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                        Il y a {etatDeclare.anciennete_jours} jours
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[10px] uppercase text-slate-500">Carburant</p>
                      <p className="font-bold text-slate-800">{etatDeclare.carburant || '—'}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[10px] uppercase text-slate-500">Km au départ</p>
                      <p className="font-bold text-slate-800">
                        {etatDeclare.km_depart != null ? Number(etatDeclare.km_depart).toLocaleString('fr-FR') : '—'}
                      </p>
                    </div>
                    <div className={`rounded-lg p-2 ${etatDeclare.nb_degats > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                      <p className="text-[10px] uppercase text-slate-500">Dégâts signalés</p>
                      <p className={`font-bold ${etatDeclare.nb_degats > 0 ? 'text-red-700' : 'text-slate-800'}`}>
                        {etatDeclare.nb_degats}
                      </p>
                    </div>
                    <div className={`rounded-lg p-2 ${etatDeclare.points_non_valides?.length > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                      <p className="text-[10px] uppercase text-slate-500">Points non validés</p>
                      <p className={`font-bold ${etatDeclare.points_non_valides?.length > 0 ? 'text-amber-800' : 'text-slate-800'}`}>
                        {etatDeclare.detail_disponible ? etatDeclare.points_non_valides.length : '—'}
                      </p>
                    </div>
                  </div>
                  {!etatDeclare.detail_disponible && (
                    <p className="text-xs text-slate-400">
                      Le détail du questionnaire n'a pas été transmis par cette version de
                      l'application mobile — seuls la date, le carburant et le kilométrage
                      sont disponibles.
                    </p>
                  )}
                  {etatDeclare.notes && (
                    <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                      <span><span className="font-semibold">Remarque du chauffeur :</span> {etatDeclare.notes}</span>
                    </div>
                  )}
                  {/* Ce qui appelle une action, NOMMÉ. Le compteur seul oblige
                      à rouvrir le questionnaire pour savoir quel point a été
                      refusé — ce que personne ne fait avant de laisser partir
                      le camion. */}
                  {etatDeclare.detail_disponible && etatDeclare.points_non_valides?.length > 0 && (
                    <div className="text-sm">
                      <p className="font-semibold text-amber-800 mb-1">Points non validés au départ</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {etatDeclare.points_non_valides.map((p, i) => (
                          <li key={p.id || i} className="text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-900 font-medium">
                            {p.libelle || p.id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {etatDeclare.detail_disponible && etatDeclare.points_non_valides?.length === 0 && (
                    <p className="text-xs text-emerald-700">
                      {etatDeclare.points_verifies} point{etatDeclare.points_verifies > 1 ? 's' : ''} vérifié
                      {etatDeclare.points_verifies > 1 ? 's' : ''}, aucun défaut signalé.
                    </p>
                  )}
                  {etatDeclare.degats?.length > 0 && (
                    <div className="text-sm space-y-3">
                      {/* L'emplacement d'abord, la liste ensuite : le schéma
                          répond à « où », la liste à « quoi ». */}
                      <CarteDegats degats={etatDeclare.degats} />
                      <div>
                        <p className="font-semibold text-slate-700 mb-1">Dégâts relevés</p>
                        <ul className="space-y-1">
                          {etatDeclare.degats.map((d, i) => (
                            <li key={i} className="text-slate-600 text-xs bg-red-50 border border-red-100 rounded px-2 py-1">
                              <span className="font-medium">{DEGAT_LIBELLES[d.type] || d.type}</span>
                              {' — '}
                              {(DEGAT_VUES.find(([c]) => c === d.vue) || [null, d.vue])[1]}
                              {d.commentaire ? ` : ${d.commentaire}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Checklists de départ (item 45) — rondes de sécurité chauffeur */}
            <div className="card-modern p-5">
              <h3 className="font-bold mb-4">Questionnaires de début de journée</h3>
              {checklists.length === 0 ? (
                <p className="text-slate-400 text-sm">Aucune checklist enregistrée pour ce véhicule.</p>
              ) : (
                <div className="space-y-2">
                  {checklists.map(cl => (
                    <div key={cl.id} className={`p-3 rounded-lg border ${cl.notes ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${cl.exterior_ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {cl.exterior_ok ? 'Extérieur OK' : 'Extérieur KO'}
                          </span>
                          <span className="text-slate-500">Carburant : <b>{cl.fuel_level || '—'}</b></span>
                          {cl.km_start != null && <span className="text-slate-500">{Number(cl.km_start).toLocaleString('fr-FR')} km</span>}
                        </div>
                        <div className="text-xs text-slate-400 text-right flex-shrink-0">
                          <div>{cl.created_at ? new Date(cl.created_at).toLocaleDateString('fr-FR') : (cl.tour_date ? new Date(cl.tour_date).toLocaleDateString('fr-FR') : '—')}</div>
                          {cl.employee_name && cl.employee_name.trim() && <div>{cl.employee_name}</div>}
                          {cl.tour_id && <div>Tournée #{cl.tour_id}</div>}
                        </div>
                      </div>
                      {cl.notes && (
                        <div className="mt-2 flex items-start gap-2 text-sm text-amber-800">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                          <span><span className="font-semibold">Anomalie signalée :</span> {cl.notes}</span>
                        </div>
                      )}
                      {/* Détail du questionnaire : ce que le chauffeur a
                          réellement vérifié, point par point. */}
                      {(cl.reponses?.length > 0 || cl.degats?.length > 0) && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setChecklistOuverte(checklistOuverte === cl.id ? null : cl.id)}
                            className="text-xs text-teal-700 hover:text-teal-800 font-medium"
                          >
                            {checklistOuverte === cl.id ? 'Masquer le détail' : `Voir le détail (${cl.reponses?.length || 0} points${cl.degats?.length ? `, ${cl.degats.length} dégât${cl.degats.length > 1 ? 's' : ''}` : ''})`}
                          </button>
                          {checklistOuverte === cl.id && (
                            <div className="mt-2 space-y-2">
                              {cl.reponses?.length > 0 && (
                                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                  {cl.reponses.map((r, i) => (
                                    <li key={`${cl.id}-${r.id || i}`} className="text-xs flex items-center gap-1.5">
                                      <span className={r.ok ? 'text-emerald-600' : 'text-red-600'}>
                                        {r.ok ? '✓' : '✗'}
                                      </span>
                                      <span className={r.ok ? 'text-slate-600' : 'text-red-700 font-medium'}>
                                        {r.libelle || r.id}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {cl.degats?.length > 0 && (
                                <ul className="space-y-1">
                                  {cl.degats.map((d, i) => (
                                    <li key={`${cl.id}-d-${i}`} className="text-xs bg-red-50 border border-red-100 rounded px-2 py-1 text-slate-700">
                                      <span className="font-medium">{d.type}</span> — vue {d.vue}
                                      {d.commentaire ? ` : ${d.commentaire}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Grille d'entretien constructeur */}
            <div className="card-modern p-5">
              <h3 className="font-bold mb-4">Grille d'entretien constructeur</h3>
              {schedule && schedule.schedule && schedule.schedule.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                        <th className="px-3 py-2">Opération</th>
                        <th className="px-3 py-2">Intervalle</th>
                        <th className="px-3 py-2">Dernier</th>
                        <th className="px-3 py-2">km depuis</th>
                        <th className="px-3 py-2">État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.schedule.map((op, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2.5 font-medium">{op.label}</td>
                          <td className="px-3 py-2.5 text-slate-500">{op.intervalle_km ? `${op.intervalle_km.toLocaleString('fr-FR')} km` : '—'}</td>
                          <td className="px-3 py-2.5 text-slate-500">
                            {op.last_date ? new Date(op.last_date).toLocaleDateString('fr-FR') : '—'}
                            {op.last_km ? ` (${op.last_km.toLocaleString('fr-FR')} km)` : ''}
                          </td>
                          <td className="px-3 py-2.5">{op.km_since.toLocaleString('fr-FR')} km</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-slate-200 rounded-full h-2">
                                <div className={`h-2 rounded-full ${op.status === 'depasse' ? 'bg-red-500' : op.status === 'bientot' ? 'bg-orange-400' : 'bg-green-500'}`}
                                  style={{ width: `${Math.min(op.ratio, 100)}%` }} />
                              </div>
                              <span className={`text-xs font-medium ${op.status === 'depasse' ? 'text-red-600' : op.status === 'bientot' ? 'text-orange-600' : 'text-green-600'}`}>
                                {op.ratio}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-slate-400">
                  {schedule?.profile_name
                    ? <p>Profil "{schedule.profile_name}" — aucune opération définie.</p>
                    : (
                      <div className="flex items-center gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg text-orange-700">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" strokeWidth={1.8} />
                        <div>
                          <p className="font-medium">Aucun plan d'entretien constructeur associé</p>
                          <p className="text-xs mt-0.5">Modifiez ce véhicule et sélectionnez un plan constructeur pour afficher la grille d'entretien.</p>
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* Historique des événements */}
            <div className="card-modern p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Historique des événements</h3>
                <button onClick={() => setShowEventForm(true)} className="btn-primary text-sm">
                  <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
                  Ajouter un événement
                </button>
              </div>
              {events.length === 0 ? (
                <p className="text-slate-400 text-sm">Aucun événement enregistré pour ce véhicule.</p>
              ) : (
                <div className="space-y-2">
                  {events.map(ev => (
                    <div key={ev.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 mt-0.5 ${EVENT_COLORS[ev.event_type] || 'bg-slate-100'}`}>
                        {EVENT_TYPES.find(t => t.value === ev.event_type)?.label || ev.event_type}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{ev.description || 'Pas de description'}</p>
                        <div className="flex gap-4 mt-1 text-xs text-slate-400">
                          <span>{new Date(ev.event_date).toLocaleDateString('fr-FR')}</span>
                          {ev.km_at_event && <span>{ev.km_at_event.toLocaleString('fr-FR')} km</span>}
                          {ev.cost && <span>{ev.cost.toFixed(2)} €</span>}
                          {ev.performed_by && <span>par {ev.performed_by}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Documents véhicule */}
            <div className="card-modern p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Documents</h3>
                <button onClick={() => setShowDocForm(true)} className="btn-primary text-sm">
                  + Ajouter un document
                </button>
              </div>
              {documents.length === 0 ? (
                <p className="text-slate-400 text-sm">Aucun document pour ce véhicule. Ajoutez carte grise, assurance, factures...</p>
              ) : (
                <div className="space-y-2">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border">
                      <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-indigo-600" strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.title}</p>
                        <div className="flex gap-3 mt-0.5 text-xs text-slate-400">
                          <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px]">
                            {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                          </span>
                          <span>{new Date(doc.created_at).toLocaleDateString('fr-FR')}</span>
                          {doc.file_size && <span>{(doc.file_size / 1024).toFixed(0)} Ko</span>}
                          {doc.expiry_date && (
                            <span className={new Date(doc.expiry_date) < new Date() ? 'text-red-500 font-medium' : ''}>
                              Expire : {new Date(doc.expiry_date).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <a
                          href={`/api/vehicles/${selectedVehicle.id}/documents/${doc.id}/download`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-indigo-500 hover:text-indigo-700 p-1.5 rounded hover:bg-indigo-50"
                          title="Télécharger"
                        >
                          <Download className="w-4 h-4" strokeWidth={1.8} />
                        </a>
                        <button onClick={() => deleteDocument(doc.id)} className="text-red-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50" title="Supprimer">
                          <Trash2 className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modale Créer / Modifier véhicule */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editingId ? 'Modifier le véhicule' : 'Nouveau véhicule'} size="lg">
            <form onSubmit={saveVehicle}>
              <div className="space-y-3">
                <input placeholder="Immatriculation *" value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value.toUpperCase() })} className="input-modern" required disabled={!!editingId} />
                <input placeholder="Nom / Libellé" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-modern" />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Marque" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="input-modern" />
                  <input placeholder="Modèle" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="input-modern" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Type</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="input-modern">
                      <option value="camion">Camion</option>
                      <option value="utilitaire">Utilitaire</option>
                      <option value="voiture">Voiture</option>
                    </select>
                  </div>
                  {editingId && (
                    <div>
                      <label className="text-xs text-slate-500">Statut</label>
                      <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input-modern">
                        <option value="available">Disponible</option>
                        <option value="in_use">En tournée</option>
                        <option value="maintenance">Maintenance</option>
                        <option value="out_of_service">Hors service</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">PTAC / Capacité max (kg)</label>
                    <input type="number" value={form.max_capacity_kg} onChange={e => setForm({ ...form, max_capacity_kg: parseInt(e.target.value) || 0 })} className="input-modern" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Poids à vide (kg)</label>
                    <input type="number" placeholder="ex: 2100" value={form.tare_weight_kg} onChange={e => setForm({ ...form, tare_weight_kg: e.target.value })} className="input-modern" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Kilométrage</label>
                    <input type="number" value={form.current_km} onChange={e => setForm({ ...form, current_km: parseInt(e.target.value) || 0 })} className="input-modern" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Prochaine maintenance</label>
                    <input type="date" value={form.next_maintenance} onChange={e => setForm({ ...form, next_maintenance: e.target.value })} className="input-modern" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Expiration assurance</label>
                    <input type="date" value={form.insurance_expiry} onChange={e => setForm({ ...form, insurance_expiry: e.target.value })} className="input-modern" />
                  </div>
                </div>
                {/* Plan d'entretien constructeur */}
                <div className="border rounded-lg p-3 bg-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Plan d'entretien constructeur</label>
                    {form.vehicle_type && form.vehicle_type !== 'generic' && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{form.vehicle_type}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400">Motorisation (optionnel)</label>
                      <input placeholder="ex: 2.3 dCi 150ch" value={form.engine} onChange={e => setForm({ ...form, engine: e.target.value })} className="input-modern" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">Année (optionnel)</label>
                      <input placeholder="ex: 2022" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} className="input-modern" />
                    </div>
                  </div>
                  {maintenanceProfiles.length > 0 && (
                    <div>
                      <label className="text-[10px] text-slate-400">Profil existant</label>
                      <select value={form.vehicle_type} onChange={e => setForm({ ...form, vehicle_type: e.target.value })} className="input-modern">
                        <option value="generic">— Sélectionner un profil existant —</option>
                        {maintenanceProfiles.map(p => (
                          <option key={p.id} value={p.vehicle_type}>{p.brand} {p.model}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={generateMaintenancePlan}
                    disabled={generatingPlan || !form.brand || !form.model}
                    className="btn-primary text-sm w-full gap-2"
                  >
                    {generatingPlan ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                        Recherche du plan constructeur...
                      </>
                    ) : (
                      <>
                        <Lightbulb className="w-4 h-4" strokeWidth={1.8} />
                        Rechercher le plan via IA
                      </>
                    )}
                  </button>
                  <p className="text-[10px] text-slate-400">L'IA recherche les préconisations constructeur pour ce véhicule et crée le plan d'entretien automatiquement.</p>
                  {generatedPlan && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
                      <p className="font-medium mb-1">Plan "{generatedPlan.vehicle_type}" généré avec {generatedPlan.items?.length || 0} opérations</p>
                      <ul className="space-y-0.5 text-green-700">
                        {(generatedPlan.items || []).slice(0, 5).map((item, i) => (
                          <li key={i}>• {item.label_fr} — {item.interval_km ? `${item.interval_km.toLocaleString('fr-FR')} km` : ''} {item.interval_months ? `/ ${item.interval_months} mois` : ''}</li>
                        ))}
                        {(generatedPlan.items || []).length > 5 && <li className="text-green-600">... et {generatedPlan.items.length - 5} autres opérations</li>}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">{editingId ? 'Enregistrer' : 'Créer'}</button>
              </div>
            </form>
        </Modal>

        {/* Modale Ajouter document */}
        <Modal isOpen={showDocForm} onClose={() => { setShowDocForm(false); setDocFile(null); }} title="Ajouter un document" size="md">
          <form onSubmit={addDocument}>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">Type de document</label>
                <select value={docForm.doc_type} onChange={e => setDocForm({ ...docForm, doc_type: e.target.value })} className="input-modern">
                  {DOC_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Titre</label>
                <input value={docForm.title} onChange={e => setDocForm({ ...docForm, title: e.target.value })} className="input-modern" placeholder="Ex: Carte grise Ducato" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Fichier *</label>
                <input type="file" onChange={e => setDocFile(e.target.files[0])} className="input-modern" required accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
                <p className="text-[10px] text-slate-400 mt-1">PDF, images, Word, Excel — max 10 Mo</p>
              </div>
              <div>
                <label className="text-xs text-slate-500">Date d'expiration (optionnel)</label>
                <input type="date" value={docForm.expiry_date} onChange={e => setDocForm({ ...docForm, expiry_date: e.target.value })} className="input-modern" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Notes</label>
                <textarea value={docForm.notes} onChange={e => setDocForm({ ...docForm, notes: e.target.value })} className="input-modern" rows={2} placeholder="Remarques..." />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => { setShowDocForm(false); setDocFile(null); }} className="flex-1 btn-ghost">Annuler</button>
              <button type="submit" className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium">Enregistrer</button>
            </div>
          </form>
        </Modal>

        {/* Modale Ajouter événement */}
        <Modal isOpen={showEventForm} onClose={() => setShowEventForm(false)} title="Nouvel événement" size="md">
          <form onSubmit={addEvent}>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">Type d'événement</label>
                <select value={eventForm.event_type} onChange={e => setEventForm({ ...eventForm, event_type: e.target.value })} className="input-modern">
                  {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Date</label>
                  <input type="date" value={eventForm.event_date} onChange={e => setEventForm({ ...eventForm, event_date: e.target.value })} className="input-modern" required />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Kilométrage</label>
                  <input type="number" placeholder="km" value={eventForm.km_at_event} onChange={e => setEventForm({ ...eventForm, km_at_event: e.target.value })} className="input-modern" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500">Description</label>
                <textarea value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} className="input-modern" rows={2} placeholder="Détails de l'intervention..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Coût (€)</label>
                  <input type="number" step="0.01" placeholder="0.00" value={eventForm.cost} onChange={e => setEventForm({ ...eventForm, cost: e.target.value })} className="input-modern" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Réalisé par</label>
                  <input value={eventForm.performed_by} onChange={e => setEventForm({ ...eventForm, performed_by: e.target.value })} className="input-modern" placeholder="Garage, mécanicien..." />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowEventForm(false)} className="flex-1 btn-ghost">Annuler</button>
              <button type="submit" className="flex-1 btn-primary text-sm">Enregistrer</button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
