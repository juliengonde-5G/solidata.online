import { useState, useEffect, useCallback } from 'react';
import { Truck, Plus, Pencil, FileText, Download, Trash2, Lightbulb, AlertTriangle } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const STATUS_COLORS = { available: 'bg-green-100 text-green-700', in_use: 'bg-blue-100 text-blue-700', maintenance: 'bg-orange-100 text-orange-700', out_of_service: 'bg-red-100 text-red-700' };
const STATUS_LABELS = { available: 'Disponible', in_use: 'En tournée', maintenance: 'Maintenance', out_of_service: 'Hors service' };
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

const emptyForm = {
  registration: '', name: '', brand: '', model: '', type: 'utilitaire',
  max_capacity_kg: 3500, tare_weight_kg: '', current_km: 0,
  next_maintenance: '', insurance_expiry: '', team_id: '', status: 'available',
  vehicle_type: 'generic', engine: '', year: '',
};

export default function Vehicles() {
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

  useEffect(() => { loadVehicles(); loadMaintenanceProfiles(); }, []);
  useEffect(() => { if (activeTab === 'maintenance') loadMaintenance(); }, [activeTab]);

  const loadVehicles = async () => {
    try {
      const res = await api.get('/vehicles');
      setVehicles(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
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

  const tabs = [
    { key: 'fleet', label: 'Flotte' },
    { key: 'maintenance', label: 'Maintenance' },
    ...(selectedVehicle ? [{ key: 'detail', label: selectedVehicle.name || selectedVehicle.registration }] : []),
  ];

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Véhicules</h1>
            <p className="text-slate-500">Gestion de la flotte — {vehicles.length} véhicule{vehicles.length > 1 ? 's' : ''}</p>
          </div>
          <div className="flex gap-2">
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {tabs.map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-3 py-1.5 rounded-md text-sm ${activeTab === t.key ? 'bg-white shadow font-medium' : 'text-slate-500'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {activeTab === 'fleet' && (
              <button onClick={openCreate} className="btn-primary text-sm">
                <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
                Nouveau véhicule
              </button>
            )}
          </div>
        </div>

        {/* Onglet Flotte */}
        {activeTab === 'fleet' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicles.map(v => (
              <div key={v.id} className="bg-white rounded-xl shadow-sm border p-5 cursor-pointer hover:shadow-md transition" onClick={() => selectVehicle(v)}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-lg">
                      {v.type === 'camion' ? '🚛' : v.type === 'utilitaire' ? '🚐' : '🚗'}
                    </div>
                    <div>
                      <h3 className="font-bold">{v.registration}</h3>
                      <p className="text-xs text-slate-400">{v.brand} {v.model}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[v.status] || ''}`}>
                      {STATUS_LABELS[v.status] || v.status}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(v); }} className="text-slate-400 hover:text-primary p-1" title="Modifier">
                      <Pencil className="w-4 h-4" strokeWidth={1.8} />
                    </button>
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
              <div className="col-span-full bg-white rounded-xl shadow-sm border p-8 text-center text-slate-400">Aucun véhicule enregistré</div>
            )}
          </div>
        )}

        {/* Onglet Maintenance */}
        {activeTab === 'maintenance' && (
          <div className="space-y-4">
            {maintenanceOverview.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-slate-400">Aucune donnée de maintenance. Configurez la maintenance sur chaque véhicule.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {maintenanceOverview.map(v => (
                  <div key={v.id} className={`bg-white rounded-xl shadow-sm border p-5 cursor-pointer hover:shadow-md transition ${v.computed_alerts.some(a => a.urgency === 'critique') ? 'border-red-300' : v.computed_alerts.length > 0 ? 'border-orange-200' : ''}`}
                    onClick={() => { const full = vehicles.find(vv => vv.id === v.id); if (full) selectVehicle(full); }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-sm">{v.name || v.registration}</h3>
                        <p className="text-xs text-slate-400">{v.vehicle_type || 'Type non configuré'} — {(v.current_km || 0).toLocaleString('fr-FR')} km</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[v.status] || ''}`}>{STATUS_LABELS[v.status] || v.status}</span>
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
            <div className="bg-white rounded-xl shadow-sm border p-5">
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
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${STATUS_COLORS[selectedVehicle.status] || ''}`}>
                    {STATUS_LABELS[selectedVehicle.status]}
                  </span>
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

            {/* Grille d'entretien constructeur */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
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
            <div className="bg-white rounded-xl shadow-sm border p-5">
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
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Documents</h3>
                <button onClick={() => setShowDocForm(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">
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
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={saveVehicle} className="bg-white rounded-xl p-6 w-[480px] shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">{editingId ? 'Modifier le véhicule' : 'Nouveau véhicule'}</h2>
              <div className="space-y-3">
                <input placeholder="Immatriculation *" value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value.toUpperCase() })} className="w-full border rounded-lg px-3 py-2 text-sm" required disabled={!!editingId} />
                <input placeholder="Nom / Libellé" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Marque" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                  <input placeholder="Modèle" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Type</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="camion">Camion</option>
                      <option value="utilitaire">Utilitaire</option>
                      <option value="voiture">Voiture</option>
                    </select>
                  </div>
                  {editingId && (
                    <div>
                      <label className="text-xs text-slate-500">Statut</label>
                      <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
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
                    <input type="number" value={form.max_capacity_kg} onChange={e => setForm({ ...form, max_capacity_kg: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Poids à vide (kg)</label>
                    <input type="number" placeholder="ex: 2100" value={form.tare_weight_kg} onChange={e => setForm({ ...form, tare_weight_kg: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Kilométrage</label>
                    <input type="number" value={form.current_km} onChange={e => setForm({ ...form, current_km: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Prochaine maintenance</label>
                    <input type="date" value={form.next_maintenance} onChange={e => setForm({ ...form, next_maintenance: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Expiration assurance</label>
                    <input type="date" value={form.insurance_expiry} onChange={e => setForm({ ...form, insurance_expiry: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
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
                      <input placeholder="ex: 2.3 dCi 150ch" value={form.engine} onChange={e => setForm({ ...form, engine: e.target.value })} className="w-full border rounded-lg px-3 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">Année (optionnel)</label>
                      <input placeholder="ex: 2022" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} className="w-full border rounded-lg px-3 py-1.5 text-sm" />
                    </div>
                  </div>
                  {maintenanceProfiles.length > 0 && (
                    <div>
                      <label className="text-[10px] text-slate-400">Profil existant</label>
                      <select value={form.vehicle_type} onChange={e => setForm({ ...form, vehicle_type: e.target.value })} className="w-full border rounded-lg px-3 py-1.5 text-sm">
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
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
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
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">{editingId ? 'Enregistrer' : 'Créer'}</button>
              </div>
            </form>
          </div>
        )}

        {/* Modale Ajouter document */}
        {showDocForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={addDocument} className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Ajouter un document</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500">Type de document</label>
                  <select value={docForm.doc_type} onChange={e => setDocForm({ ...docForm, doc_type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                    {DOC_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Titre</label>
                  <input value={docForm.title} onChange={e => setDocForm({ ...docForm, title: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Carte grise Ducato" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Fichier *</label>
                  <input type="file" onChange={e => setDocFile(e.target.files[0])} className="w-full border rounded-lg px-3 py-2 text-sm" required accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
                  <p className="text-[10px] text-slate-400 mt-1">PDF, images, Word, Excel — max 10 Mo</p>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Date d'expiration (optionnel)</label>
                  <input type="date" value={docForm.expiry_date} onChange={e => setDocForm({ ...docForm, expiry_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Notes</label>
                  <textarea value={docForm.notes} onChange={e => setDocForm({ ...docForm, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Remarques..." />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => { setShowDocForm(false); setDocFile(null); }} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium">Enregistrer</button>
              </div>
            </form>
          </div>
        )}

        {/* Modale Ajouter événement */}
        {showEventForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={addEvent} className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouvel événement</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500">Type d'événement</label>
                  <select value={eventForm.event_type} onChange={e => setEventForm({ ...eventForm, event_type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                    {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Date</label>
                    <input type="date" value={eventForm.event_date} onChange={e => setEventForm({ ...eventForm, event_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Kilométrage</label>
                    <input type="number" placeholder="km" value={eventForm.km_at_event} onChange={e => setEventForm({ ...eventForm, km_at_event: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Description</label>
                  <textarea value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Détails de l'intervention..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Coût (€)</label>
                    <input type="number" step="0.01" placeholder="0.00" value={eventForm.cost} onChange={e => setEventForm({ ...eventForm, cost: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Réalisé par</label>
                    <input value={eventForm.performed_by} onChange={e => setEventForm({ ...eventForm, performed_by: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Garage, mécanicien..." />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowEventForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Enregistrer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
