import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
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
  accident: 'bg-red-200 text-red-800', autre: 'bg-gray-100 text-gray-700',
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
  assigned_driver_id: '',
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

  const [employees, setEmployees] = useState([]);

  useEffect(() => { loadVehicles(); loadEmployees(); }, []);
  useEffect(() => { if (activeTab === 'maintenance') loadMaintenance(); }, [activeTab]);

  const loadVehicles = async () => {
    try {
      const res = await api.get('/vehicles');
      setVehicles(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadEmployees = async () => {
    try {
      const res = await api.get('/employees');
      setEmployees(res.data);
    } catch (err) { console.error(err); }
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
      assigned_driver_id: v.assigned_driver_id || '',
    });
    setShowForm(true);
  };

  const saveVehicle = async (e) => {
    e.preventDefault();
    try {
      const { assigned_driver_id, ...rest } = form;
      const payload = { ...rest, tare_weight_kg: rest.tare_weight_kg ? parseFloat(rest.tare_weight_kg) : null };
      let vehicleId = editingId;
      if (editingId) {
        await api.put(`/vehicles/${editingId}`, payload);
      } else {
        const res = await api.post('/vehicles', payload);
        vehicleId = res.data.id;
      }
      // Affecter le chauffeur (lien véhicule-chauffeur)
      if (vehicleId) {
        await api.put(`/vehicles/${vehicleId}/assign-driver`, {
          employee_id: assigned_driver_id ? parseInt(assigned_driver_id) : null,
        });
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

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

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
            <h1 className="text-2xl font-bold text-solidata-dark">Véhicules</h1>
            <p className="text-gray-500">Gestion de la flotte — {vehicles.length} véhicule{vehicles.length > 1 ? 's' : ''}</p>
          </div>
          <div className="flex gap-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {tabs.map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-3 py-1.5 rounded-md text-sm ${activeTab === t.key ? 'bg-white shadow font-medium' : 'text-gray-500'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {activeTab === 'fleet' && (
              <button onClick={openCreate} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
                + Nouveau véhicule
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
                    <div className="w-10 h-10 rounded-lg bg-solidata-green/10 flex items-center justify-center text-solidata-green text-lg">
                      {v.type === 'camion' ? '🚛' : v.type === 'utilitaire' ? '🚐' : '🚗'}
                    </div>
                    <div>
                      <h3 className="font-bold">{v.registration}</h3>
                      <p className="text-xs text-gray-400">{v.brand} {v.model}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[v.status] || ''}`}>
                      {STATUS_LABELS[v.status] || v.status}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(v); }} className="text-gray-400 hover:text-solidata-green p-1" title="Modifier">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-gray-600">
                  <p><span className="text-gray-400">Capacité :</span> {v.max_capacity_kg} kg</p>
                  {v.tare_weight_kg && <p><span className="text-gray-400">Poids à vide :</span> {v.tare_weight_kg} kg</p>}
                  {v.tare_weight_kg && v.max_capacity_kg && <p><span className="text-gray-400">Charge utile :</span> {Math.round(v.max_capacity_kg - v.tare_weight_kg)} kg</p>}
                  <p><span className="text-gray-400">Kilométrage :</span> {(v.current_km || 0).toLocaleString('fr-FR')} km</p>
                  {v.next_maintenance && <p><span className="text-gray-400">Proch. maintenance :</span> {new Date(v.next_maintenance).toLocaleDateString('fr-FR')}</p>}
                  {v.insurance_expiry && <p><span className="text-gray-400">Assurance :</span> {new Date(v.insurance_expiry).toLocaleDateString('fr-FR')}</p>}
                  {v.assigned_driver_name && v.assigned_driver_name.trim() && <p><span className="text-gray-400">Chauffeur :</span> <span className="font-medium text-solidata-green">{v.assigned_driver_name}</span></p>}
                </div>
              </div>
            ))}
            {vehicles.length === 0 && (
              <div className="col-span-full bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">Aucun véhicule enregistré</div>
            )}
          </div>
        )}

        {/* Onglet Maintenance */}
        {activeTab === 'maintenance' && (
          <div className="space-y-4">
            {maintenanceOverview.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">Aucune donnée de maintenance. Configurez la maintenance sur chaque véhicule.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {maintenanceOverview.map(v => (
                  <div key={v.id} className={`bg-white rounded-xl shadow-sm border p-5 cursor-pointer hover:shadow-md transition ${v.computed_alerts.some(a => a.urgency === 'critique') ? 'border-red-300' : v.computed_alerts.length > 0 ? 'border-orange-200' : ''}`}
                    onClick={() => { const full = vehicles.find(vv => vv.id === v.id); if (full) selectVehicle(full); }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-sm">{v.name || v.registration}</h3>
                        <p className="text-xs text-gray-400">{v.vehicle_type || 'Type non configuré'} — {(v.current_km || 0).toLocaleString('fr-FR')} km</p>
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
                    {v.last_maintenance_date && <p className="text-xs text-gray-400 mt-2">Dernière révision : {new Date(v.last_maintenance_date).toLocaleDateString('fr-FR')} à {(v.last_maintenance_km || 0).toLocaleString('fr-FR')} km</p>}
                    {v.controle_technique_date && <p className="text-xs text-gray-400">CT : {new Date(v.controle_technique_date).toLocaleDateString('fr-FR')}</p>}
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
                  <div className="w-12 h-12 rounded-lg bg-solidata-green/10 flex items-center justify-center text-2xl">
                    {selectedVehicle.type === 'camion' ? '🚛' : selectedVehicle.type === 'utilitaire' ? '🚐' : '🚗'}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{selectedVehicle.registration} — {selectedVehicle.brand} {selectedVehicle.model}</h2>
                    <p className="text-sm text-gray-500">{selectedVehicle.name} • {(selectedVehicle.current_km || 0).toLocaleString('fr-FR')} km</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${STATUS_COLORS[selectedVehicle.status] || ''}`}>
                    {STATUS_LABELS[selectedVehicle.status]}
                  </span>
                  <button onClick={() => openEdit(selectedVehicle)} className="text-gray-500 hover:text-solidata-green p-2 rounded-lg hover:bg-gray-50" title="Modifier">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-gray-400 text-xs">Capacité max</span><p className="font-medium">{selectedVehicle.max_capacity_kg} kg</p></div>
                <div><span className="text-gray-400 text-xs">Poids à vide (tare)</span><p className="font-medium">{selectedVehicle.tare_weight_kg ? `${selectedVehicle.tare_weight_kg} kg` : '—'}</p></div>
                <div><span className="text-gray-400 text-xs">Charge utile</span><p className="font-medium">{selectedVehicle.tare_weight_kg ? `${Math.round(selectedVehicle.max_capacity_kg - selectedVehicle.tare_weight_kg)} kg` : '—'}</p></div>
                <div><span className="text-gray-400 text-xs">Assurance</span><p className="font-medium">{selectedVehicle.insurance_expiry ? new Date(selectedVehicle.insurance_expiry).toLocaleDateString('fr-FR') : '—'}</p></div>
              </div>
            </div>

            {/* Grille d'entretien constructeur */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h3 className="font-bold mb-4">Grille d'entretien constructeur</h3>
              {schedule && schedule.schedule && schedule.schedule.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
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
                          <td className="px-3 py-2.5 text-gray-500">{op.intervalle_km ? `${op.intervalle_km.toLocaleString('fr-FR')} km` : '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500">
                            {op.last_date ? new Date(op.last_date).toLocaleDateString('fr-FR') : '—'}
                            {op.last_km ? ` (${op.last_km.toLocaleString('fr-FR')} km)` : ''}
                          </td>
                          <td className="px-3 py-2.5">{op.km_since.toLocaleString('fr-FR')} km</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-gray-200 rounded-full h-2">
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
                <p className="text-gray-400 text-sm">
                  {schedule?.profile_name
                    ? `Profil "${schedule.profile_name}" — aucune opération définie.`
                    : 'Aucun profil de maintenance configuré. Configurez le type de véhicule dans l\'onglet Maintenance.'}
                </p>
              )}
            </div>

            {/* Historique des événements */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Historique des événements</h3>
                <button onClick={() => setShowEventForm(true)} className="bg-solidata-green text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-solidata-green-dark">
                  + Ajouter un événement
                </button>
              </div>
              {events.length === 0 ? (
                <p className="text-gray-400 text-sm">Aucun événement enregistré pour ce véhicule.</p>
              ) : (
                <div className="space-y-2">
                  {events.map(ev => (
                    <div key={ev.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 mt-0.5 ${EVENT_COLORS[ev.event_type] || 'bg-gray-100'}`}>
                        {EVENT_TYPES.find(t => t.value === ev.event_type)?.label || ev.event_type}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{ev.description || 'Pas de description'}</p>
                        <div className="flex gap-4 mt-1 text-xs text-gray-400">
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
                <p className="text-gray-400 text-sm">Aucun document pour ce véhicule. Ajoutez carte grise, assurance, factures...</p>
              ) : (
                <div className="space-y-2">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border">
                      <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.title}</p>
                        <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                          <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px]">
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
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </a>
                        <button onClick={() => deleteDocument(doc.id)} className="text-red-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50" title="Supprimer">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
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
                    <label className="text-xs text-gray-500">Type</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="camion">Camion</option>
                      <option value="utilitaire">Utilitaire</option>
                      <option value="voiture">Voiture</option>
                    </select>
                  </div>
                  {editingId && (
                    <div>
                      <label className="text-xs text-gray-500">Statut</label>
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
                    <label className="text-xs text-gray-500">PTAC / Capacité max (kg)</label>
                    <input type="number" value={form.max_capacity_kg} onChange={e => setForm({ ...form, max_capacity_kg: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Poids à vide (kg)</label>
                    <input type="number" placeholder="ex: 2100" value={form.tare_weight_kg} onChange={e => setForm({ ...form, tare_weight_kg: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Kilométrage</label>
                    <input type="number" value={form.current_km} onChange={e => setForm({ ...form, current_km: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Prochaine maintenance</label>
                    <input type="date" value={form.next_maintenance} onChange={e => setForm({ ...form, next_maintenance: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Expiration assurance</label>
                    <input type="date" value={form.insurance_expiry} onChange={e => setForm({ ...form, insurance_expiry: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Chauffeur attitré</label>
                  <select value={form.assigned_driver_id} onChange={e => setForm({ ...form, assigned_driver_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">— Aucun —</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">{editingId ? 'Enregistrer' : 'Créer'}</button>
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
                  <label className="text-xs text-gray-500">Type de document</label>
                  <select value={docForm.doc_type} onChange={e => setDocForm({ ...docForm, doc_type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                    {DOC_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Titre</label>
                  <input value={docForm.title} onChange={e => setDocForm({ ...docForm, title: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Carte grise Ducato" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Fichier *</label>
                  <input type="file" onChange={e => setDocFile(e.target.files[0])} className="w-full border rounded-lg px-3 py-2 text-sm" required accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
                  <p className="text-[10px] text-gray-400 mt-1">PDF, images, Word, Excel — max 10 Mo</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Date d'expiration (optionnel)</label>
                  <input type="date" value={docForm.expiry_date} onChange={e => setDocForm({ ...docForm, expiry_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Notes</label>
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
                  <label className="text-xs text-gray-500">Type d'événement</label>
                  <select value={eventForm.event_type} onChange={e => setEventForm({ ...eventForm, event_type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                    {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Date</label>
                    <input type="date" value={eventForm.event_date} onChange={e => setEventForm({ ...eventForm, event_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Kilométrage</label>
                    <input type="number" placeholder="km" value={eventForm.km_at_event} onChange={e => setEventForm({ ...eventForm, km_at_event: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Description</label>
                  <textarea value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Détails de l'intervention..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Coût (€)</label>
                    <input type="number" step="0.01" placeholder="0.00" value={eventForm.cost} onChange={e => setEventForm({ ...eventForm, cost: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Réalisé par</label>
                    <input value={eventForm.performed_by} onChange={e => setEventForm({ ...eventForm, performed_by: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Garage, mécanicien..." />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowEventForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Enregistrer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
