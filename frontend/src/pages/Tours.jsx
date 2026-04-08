import { useState, useEffect } from 'react';
import { Route, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal } from '../components';
import api from '../services/api';

const MODE_LABELS = { intelligent: 'IA', standard: 'Standard', manual: 'Manuel' };
const STATUS_LABELS = { planned: 'Planifiée', in_progress: 'En cours', completed: 'Terminée' };

export default function Tours() {
  const [tours, setTours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [vehicles, setVehicles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedTour, setSelectedTour] = useState(null);

  // Wizard form
  const [wizForm, setWizForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    vehicle_id: '', driver_employee_id: '', mode: 'intelligent',
    collection_type: 'pav',
  });
  const [generatedTour, setGeneratedTour] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [assoRoutes, setAssoRoutes] = useState([]);
  const [assoPoints, setAssoPoints] = useState([]);
  const [selectedAssoRoute, setSelectedAssoRoute] = useState('');
  const [selectedAssoPoints, setSelectedAssoPoints] = useState([]);

  useEffect(() => { loadTours(); }, []);

  const loadTours = async () => {
    try {
      const res = await api.get('/tours');
      setTours(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const openWizard = async () => {
    try {
      const [vRes, eRes, arRes, apRes] = await Promise.all([
        api.get('/vehicles?available=true'),
        api.get('/employees'),
        api.get('/tours/association-routes/list').catch(() => ({ data: [] })),
        api.get('/association-points?status=active').catch(() => ({ data: [] })),
      ]);
      setVehicles(vRes.data);
      setEmployees(eRes.data);
      setAssoRoutes(arRes.data);
      setAssoPoints(apRes.data);
    } catch (err) { console.error(err); }
    setWizardStep(1);
    setGeneratedTour(null);
    setSelectedAssoRoute('');
    setSelectedAssoPoints([]);
    setWizForm(f => ({ ...f, collection_type: 'pav', mode: 'intelligent' }));
    setShowWizard(true);
  };

  const generateTour = async () => {
    setGenerating(true);
    try {
      if (wizForm.collection_type === 'association') {
        // Tournée association
        const pointIds = selectedAssoPoints.length > 0 ? selectedAssoPoints : assoPoints.map(p => p.id);
        const res = await api.post('/tours/association', {
          ...wizForm,
          association_point_ids: pointIds,
          standard_route_id: selectedAssoRoute || null,
        });
        setGeneratedTour(res.data);
      } else {
        const mode = wizForm.mode || 'intelligent';
        const res = await api.post(`/tours/${mode}`, { ...wizForm });
        setGeneratedTour(res.data);
      }
      setWizardStep(4);
      loadTours();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Erreur lors de la génération de la tournée');
    }
    setGenerating(false);
  };

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/tours/${id}/status`, { status });
      loadTours();
    } catch (err) { console.error(err); }
  };

  const loadTourDetail = async (id) => {
    try {
      const res = await api.get(`/tours/${id}`);
      setSelectedTour(res.data);
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des tournées..." /></Layout>;

  const columns = [
    { key: 'date', label: 'Date', sortable: true, render: (t) => <span className="font-medium">{new Date(t.date).toLocaleDateString('fr-FR')}</span> },
    { key: 'vehicle', label: 'Véhicule', sortable: true, render: (t) => t.registration || t.vehicle_registration || '—' },
    { key: 'driver', label: 'Chauffeur', sortable: true, render: (t) => t.driver_name || [t.driver_first_name, t.driver_last_name].filter(Boolean).join(' ') || '—' },
    {
      key: 'mode',
      label: 'Mode',
      sortable: true,
      render: (t) => <StatusBadge status={t.mode} size="sm" />,
    },
    { key: 'collection_type', label: 'Type', sortable: true, render: (t) => t.collection_type === 'association' ? <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700">Asso</span> : <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-100 text-teal-700">PAV</span> },
    { key: 'nb_cav', label: 'Points', sortable: true, render: (t) => t.nb_cav || 0 },
    { key: 'total_weight_kg', label: 'Poids (kg)', sortable: true, render: (t) => <span className="font-medium">{t.total_weight_kg || 0}</span> },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      render: (t) => <StatusBadge status={t.status} type="tournee" size="sm" />,
    },
    {
      key: 'actions',
      label: '',
      render: (t) => (
        <div className="flex gap-2">
          <button onClick={() => loadTourDetail(t.id)} className="text-primary text-xs font-medium hover:underline">Détails</button>
          {t.status === 'planned' && (
            <button onClick={() => updateStatus(t.id, 'in_progress')} className="text-orange-500 text-xs font-medium hover:underline">Démarrer</button>
          )}
          {t.status === 'in_progress' && (
            <button onClick={() => updateStatus(t.id, 'completed')} className="text-green-500 text-xs font-medium hover:underline">Terminer</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Tournées de collecte</h1>
            <p className="text-slate-500 text-sm">Planification et suivi des tournées</p>
          </div>
          <button onClick={openWizard} className="btn-primary text-sm font-medium w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
            Nouvelle tournée
          </button>
        </div>

        {/* Mobile cards */}
        <div className="lg:hidden space-y-3">
          {tours.length === 0 ? (
            <div className="card-modern p-8 text-center text-slate-400">Aucune tournée</div>
          ) : tours.map(t => (
            <div key={t.id} className="card-modern p-4" onClick={() => loadTourDetail(t.id)}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold">{new Date(t.date).toLocaleDateString('fr-FR')}</span>
                <StatusBadge status={t.status} type="tournee" size="sm" />
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-700 mb-1">
                <span className="font-medium">{t.registration || t.vehicle_registration || '—'}</span>
                <StatusBadge status={t.mode} size="sm" />
              </div>
              <p className="text-xs text-slate-500 mb-2">{t.driver_name || [t.driver_first_name, t.driver_last_name].filter(Boolean).join(' ') || 'Pas de chauffeur'}</p>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{t.nb_cav || 0} CAV</span>
                <span className="font-medium text-slate-700">{t.total_weight_kg || 0} kg</span>
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t">
                {t.status === 'planned' && (
                  <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'in_progress'); }} className="flex-1 text-center py-2 rounded-lg bg-orange-50 text-orange-600 text-xs font-medium">Démarrer</button>
                )}
                {t.status === 'in_progress' && (
                  <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'completed'); }} className="flex-1 text-center py-2 rounded-lg bg-green-50 text-green-600 text-xs font-medium">Terminer</button>
                )}
                <button onClick={(e) => { e.stopPropagation(); loadTourDetail(t.id); }} className="flex-1 text-center py-2 rounded-lg bg-slate-50 text-primary text-xs font-medium">Détails</button>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block">
          <DataTable
            columns={columns}
            data={tours}
            loading={false}
            emptyIcon={Route}
            emptyMessage="Aucune tournée"
          />
        </div>

        {/* Wizard Modal */}
        <Modal isOpen={showWizard} onClose={() => setShowWizard(false)} title={`Nouvelle tournée — Étape ${wizardStep}/4`} size="md">
              {/* Progress */}
              <div className="flex gap-1 mb-6">
                {[1, 2, 3, 4].map(s => (
                  <div key={s} className={`h-1.5 flex-1 rounded ${s <= wizardStep ? 'bg-primary' : 'bg-slate-200'}`} />
                ))}
              </div>

              {/* Step 1: Date & Mode */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <h3 className="font-semibold">Date et type de collecte</h3>
                  <div>
                    <label className="text-xs text-slate-500">Date de tournée</label>
                    <input type="date" value={wizForm.date} onChange={e => setWizForm({ ...wizForm, date: e.target.value })} className="input-modern" />
                  </div>

                  {/* Type de collecte */}
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Type de collecte</label>
                    <div className="flex gap-2">
                      {[
                        { key: 'pav', label: 'PAV (espace public)', color: 'border-teal-500 bg-teal-50' },
                        { key: 'association', label: 'Association', color: 'border-orange-500 bg-orange-50' },
                      ].map(ct => (
                        <label key={ct.key} className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition ${wizForm.collection_type === ct.key ? ct.color : 'border-gray-200'}`}>
                          <input type="radio" name="collection_type" value={ct.key} checked={wizForm.collection_type === ct.key}
                            onChange={() => setWizForm({ ...wizForm, collection_type: ct.key, mode: ct.key === 'association' ? 'standard' : 'intelligent' })} />
                          <span className="text-sm font-medium">{ct.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Mode de génération (PAV uniquement) */}
                  {wizForm.collection_type === 'pav' && (
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500">Mode de génération</label>
                      {[
                        { key: 'intelligent', label: 'IA Intelligente', desc: 'Optimisation par prédiction de remplissage, TSP + 2-opt' },
                        { key: 'standard', label: 'Standard', desc: 'Tous les CAV triés par distance' },
                        { key: 'manual', label: 'Manuel', desc: 'Sélection manuelle des CAV' },
                      ].map(m => (
                        <label key={m.key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${wizForm.mode === m.key ? 'border-primary bg-primary/5' : ''}`}>
                          <input type="radio" name="mode" value={m.key} checked={wizForm.mode === m.key} onChange={() => setWizForm({ ...wizForm, mode: m.key })} className="mt-1" />
                          <div>
                            <p className="font-medium text-sm">{m.label}</p>
                            <p className="text-xs text-slate-500">{m.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Sélection points association */}
                  {wizForm.collection_type === 'association' && (
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500">Points de collecte associatifs</label>
                      {assoRoutes.length > 0 && (
                        <select value={selectedAssoRoute} onChange={e => {
                          setSelectedAssoRoute(e.target.value);
                          if (e.target.value) {
                            api.get(`/tours/association-routes/${e.target.value}/points`).then(res => {
                              setSelectedAssoPoints(res.data.map(p => p.id));
                            });
                          } else {
                            setSelectedAssoPoints([]);
                          }
                        }} className="select-modern">
                          <option value="">Sélection manuelle</option>
                          {assoRoutes.map(r => <option key={r.id} value={r.id}>{r.name} ({r.point_count} points)</option>)}
                        </select>
                      )}
                      <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1">
                        {assoPoints.map(ap => (
                          <label key={ap.id} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm ${selectedAssoPoints.includes(ap.id) ? 'bg-orange-50' : 'hover:bg-slate-50'}`}>
                            <input type="checkbox" checked={selectedAssoPoints.includes(ap.id)}
                              onChange={e => {
                                if (e.target.checked) setSelectedAssoPoints([...selectedAssoPoints, ap.id]);
                                else setSelectedAssoPoints(selectedAssoPoints.filter(id => id !== ap.id));
                              }} />
                            <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                            <span className="truncate">{ap.name}</span>
                            <span className="text-xs text-slate-400 ml-auto">{ap.ville || ''}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400">{selectedAssoPoints.length > 0 ? `${selectedAssoPoints.length} points sélectionnés` : `Tous les ${assoPoints.length} points actifs seront inclus`}</p>
                    </div>
                  )}

                  <button onClick={() => setWizardStep(2)} className="w-full btn-primary text-sm">Suivant</button>
                </div>
              )}

              {/* Step 2: Vehicle */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <h3 className="font-semibold">Véhicule</h3>
                  <div className="space-y-2">
                    {vehicles.map(v => (
                      <label key={v.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${wizForm.vehicle_id === String(v.id) ? 'border-primary bg-primary/5' : ''}`}>
                        <input type="radio" name="vehicle" value={v.id} checked={wizForm.vehicle_id === String(v.id)} onChange={() => setWizForm({ ...wizForm, vehicle_id: String(v.id) })} />
                        <div>
                          <p className="font-medium text-sm">{v.registration} — {v.brand} {v.model}</p>
                          <p className="text-xs text-slate-500">Capacité : {v.capacity_kg} kg | Type : {v.type}</p>
                        </div>
                      </label>
                    ))}
                    {vehicles.length === 0 && <p className="text-slate-400 text-sm">Aucun véhicule disponible</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setWizardStep(1)} className="flex-1 btn-ghost">Retour</button>
                    <button onClick={generateTour} disabled={!wizForm.vehicle_id || generating} className="flex-1 btn-primary text-sm disabled:opacity-50">
                      {generating ? 'Génération...' : 'Générer la tournée'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Driver */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <h3 className="font-semibold">Chauffeur</h3>
                  <select value={wizForm.driver_employee_id} onChange={e => setWizForm({ ...wizForm, driver_employee_id: e.target.value })} className="select-modern">
                    <option value="">Sélectionner un chauffeur</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => setWizardStep(2)} className="flex-1 btn-ghost">Retour</button>
                    <button onClick={generateTour} disabled={generating} className="flex-1 btn-primary text-sm disabled:opacity-50">
                      {generating ? 'Génération...' : 'Générer la tournée'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Result */}
              {wizardStep === 4 && generatedTour && (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="font-semibold text-green-700 mb-2">Tournée générée avec succès</h3>
                    <div className="text-sm space-y-1">
                      <p><span className="text-slate-500">ID :</span> #{generatedTour.tour?.id || generatedTour.id}</p>
                      <p><span className="text-slate-500">CAV planifiés :</span> {generatedTour.stats?.totalCavs || generatedTour.tour?.nb_cav || '—'}</p>
                      <p><span className="text-slate-500">Distance estimée :</span> {generatedTour.stats?.totalDistance || generatedTour.tour?.estimated_distance_km || '—'} km</p>
                      <p><span className="text-slate-500">Durée estimée :</span> {generatedTour.stats?.estimatedDuration || generatedTour.tour?.estimated_duration_min || '—'} min</p>
                    </div>
                  </div>
                  {generatedTour.explanation && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <h4 className="font-semibold text-purple-700 text-sm mb-1">Explication IA</h4>
                      <p className="text-xs text-purple-900">{generatedTour.explanation}</p>
                    </div>
                  )}
                  {(generatedTour.cavs || generatedTour.cavList) && (
                    <div>
                      <h4 className="font-semibold text-sm mb-2">Points de collecte</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {(generatedTour.cavs || generatedTour.cavList).map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs bg-slate-50 rounded p-2">
                            <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold">{c.position || i + 1}</span>
                            <span className="flex-1">{c.name || c.nom || c.cav_name}</span>
                            <span className="text-slate-400">{c.predicted_fill ? `${Math.round(c.predicted_fill)}%` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => setShowWizard(false)} className="w-full btn-primary text-sm">Fermer</button>
                </div>
              )}
        </Modal>

        {/* Tour Detail Modal */}
        {selectedTour && (
          <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelectedTour(null)}>
            <div className="bg-white w-full sm:w-[480px] h-full overflow-y-auto shadow-xl p-4 sm:p-6" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold">Détail tournée #{selectedTour.id}</h2>
                <button onClick={() => setSelectedTour(null)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
              </div>
              <div className="space-y-3 text-sm">
                <Field label="Date" value={selectedTour.date ? new Date(selectedTour.date).toLocaleDateString('fr-FR') : '—'} />
                <Field label="Véhicule" value={selectedTour.registration} />
                <Field label="Chauffeur" value={selectedTour.driver_name} />
                <Field label="Mode" value={MODE_LABELS[selectedTour.mode] || selectedTour.mode} />
                <Field label="Statut" value={STATUS_LABELS[selectedTour.status] || selectedTour.status} />
                <Field label="Poids total" value={selectedTour.total_weight_kg ? `${selectedTour.total_weight_kg} kg` : '—'} />
                <Field label="Distance" value={selectedTour.estimated_distance_km ? `${selectedTour.estimated_distance_km} km` : '—'} />
                <Field label="Durée" value={selectedTour.estimated_duration_min ? `${selectedTour.estimated_duration_min} min` : '—'} />
              </div>
              {selectedTour.cavs && selectedTour.cavs.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-semibold mb-2">Points de collecte ({selectedTour.cavs.length})</h3>
                  <div className="space-y-2">
                    {selectedTour.cavs.map((c, i) => (
                      <div key={i} className="bg-slate-50 rounded-lg p-3 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold">{c.ordre || i + 1}</span>
                          <span className="font-medium">{c.nom || c.cav_name}</span>
                        </div>
                        {c.collected_weight_kg && <p className="mt-1 text-slate-500">Collecté : {c.collected_weight_kg} kg</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <span className="text-slate-500 text-xs">{label}</span>
      <p className="font-medium">{value || '—'}</p>
    </div>
  );
}
