import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Route, Plus, Truck, Sparkles, Navigation, MapPin, ArrowRight } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal, PageHeader, Section, EmptyState, ErrorState } from '../components';
import CavPicker from '../components/tours/CavPicker';
import EstimationPanel from '../components/tours/EstimationPanel';
import useAsyncData from '../hooks/useAsyncData';
import api from '../services/api';

const MODE_LABELS = { intelligent: 'IA', standard: 'Standard', manual: 'Manuel' };
const STATUS_LABELS = { planned: 'Planifiée', in_progress: 'En cours', completed: 'Terminée' };

function fmtRouteDuration(min) {
  if (min == null) return null;
  const v = Math.round(min);
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export default function Tours() {
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [vehicles, setVehicles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedTour, setSelectedTour] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState({}); // { [tourId]: true } pendant le PUT statut

  // Wizard form — cav_ids porte la sélection ORDONNÉE du mode manuel.
  const [wizForm, setWizForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    vehicle_id: '', driver_employee_id: '', mode: 'intelligent',
    collection_type: 'pav',
    cav_ids: [],
  });
  const [generatedTour, setGeneratedTour] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createErrorCode, setCreateErrorCode] = useState(null);
  const [confirmForce, setConfirmForce] = useState(false);

  // Flux association (inchangé, fonctionne déjà)
  const [assoRoutes, setAssoRoutes] = useState([]);
  const [assoPoints, setAssoPoints] = useState([]);
  const [selectedAssoRoute, setSelectedAssoRoute] = useState('');
  const [selectedAssoPoints, setSelectedAssoPoints] = useState([]);

  // Modèles de tournée CAV (mode standard)
  const [standardRoutes, setStandardRoutes] = useState([]);
  const [selectedStandardRoute, setSelectedStandardRoute] = useState('');
  const [standardRoutePreview, setStandardRoutePreview] = useState(null);
  const [standardRouteLoading, setStandardRouteLoading] = useState(false);

  // Optimisation de l'ordre (mode manuel)
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState(null);

  // Estimation (étape récapitulative avant création)
  const [estimation, setEstimation] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState(null);

  // Pattern useAsyncData (cf docs/UX_PATTERNS.md)
  const fetchTours = useCallback(() => api.get('/tours').then(r => r.data), []);
  const { data: tours = [], loading, error, reload: loadTours } = useAsyncData(fetchTours, {
    initialData: [],
  });

  const isIntelligentPav = wizForm.collection_type === 'pav' && wizForm.mode === 'intelligent';
  const isStandardPav = wizForm.collection_type === 'pav' && wizForm.mode === 'standard';
  const isManualPav = wizForm.collection_type === 'pav' && wizForm.mode === 'manual';

  // Étapes dynamiques : le mode manuel ajoute une étape de sélection des CAV,
  // le mode IA n'a pas d'étape de prévisualisation (il choisit ses points lui-même).
  const stepKeys = useMemo(() => {
    const keys = ['date', 'vehicle', 'driver'];
    if (isManualPav) keys.push('cav');
    if (!isIntelligentPav) keys.push('estimation');
    keys.push('result');
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizForm.collection_type, wizForm.mode]);
  const totalSteps = stepKeys.length;
  const currentStepKey = stepKeys[Math.min(wizardStep, totalSteps) - 1];

  const goBack = () => setWizardStep(s => Math.max(1, s - 1));
  const goNext = () => setWizardStep(s => Math.min(totalSteps, s + 1));

  const openWizard = async () => {
    try {
      const [vRes, eRes, arRes, apRes, srRes] = await Promise.all([
        api.get('/vehicles?available=true'),
        api.get('/employees'),
        api.get('/tours/association-routes/list').catch(() => ({ data: [] })),
        api.get('/association-points?status=active').catch(() => ({ data: [] })),
        api.get('/tours/routes/list').catch(() => ({ data: [] })),
      ]);
      setVehicles(vRes.data);
      setEmployees(eRes.data);
      setAssoRoutes(arRes.data);
      setAssoPoints(apRes.data);
      setStandardRoutes((srRes.data || []).filter(r => r.is_active !== false));
    } catch (err) { console.error(err); }
    setWizardStep(1);
    setGeneratedTour(null);
    setSelectedAssoRoute('');
    setSelectedAssoPoints([]);
    setSelectedStandardRoute('');
    setStandardRoutePreview(null);
    setEstimation(null);
    setEstimateError(null);
    setCreateError(null);
    setCreateErrorCode(null);
    setConfirmForce(false);
    setOptimizeError(null);
    setWizForm(f => ({ ...f, collection_type: 'pav', mode: 'intelligent', vehicle_id: '', driver_employee_id: '', cav_ids: [] }));
    setShowWizard(true);
  };

  const loadStandardRoutePreview = async (id) => {
    if (!id) { setStandardRoutePreview(null); return; }
    setStandardRouteLoading(true);
    try {
      const res = await api.get(`/tours/routes/${id}`);
      setStandardRoutePreview(res.data);
    } catch (err) {
      console.error(err);
      setStandardRoutePreview(null);
    }
    setStandardRouteLoading(false);
  };

  // Construit la source de points selon le mode — une seule clé à la fois,
  // conformément au contrat POST /tours/estimate. Renvoie null pour le mode
  // IA (aucune prévisualisation possible, l'algorithme choisit à la création).
  const buildPointsBody = useCallback(() => {
    if (wizForm.collection_type === 'association') {
      const pointIds = selectedAssoPoints.length > 0 ? selectedAssoPoints : assoPoints.map(p => p.id);
      return { association_point_ids: pointIds };
    }
    if (wizForm.mode === 'standard') {
      return { standard_route_id: selectedStandardRoute ? parseInt(selectedStandardRoute, 10) : null };
    }
    if (wizForm.mode === 'manual') {
      return { cav_ids: wizForm.cav_ids || [] };
    }
    return null;
  }, [wizForm.collection_type, wizForm.mode, wizForm.cav_ids, selectedAssoPoints, assoPoints, selectedStandardRoute]);

  const runEstimate = useCallback(async () => {
    // Avant le choix du véhicule (étape 1, où l'on sélectionne modèle/points),
    // l'aperçu est calculé sur le premier véhicule disponible — le contrat
    // /tours/estimate exige un véhicule (les retours de vidage en dépendent).
    // L'estimation est recalculée avec le véhicule réel dès qu'il est choisi.
    const vehicleId = wizForm.vehicle_id || (vehicles[0] ? String(vehicles[0].id) : null);
    if (!vehicleId) return;
    const points = buildPointsBody();
    if (!points) return;
    setEstimating(true);
    setEstimateError(null);
    setCreateError(null);
    setCreateErrorCode(null);
    setConfirmForce(false);
    try {
      const res = await api.post('/tours/estimate', {
        date: wizForm.date,
        vehicle_id: parseInt(vehicleId, 10),
        ...points,
      }, { timeout: 120000 });
      setEstimation(res.data?.estimation || null);
    } catch (err) {
      console.error(err);
      setEstimateError(err.response?.data?.error || "Impossible de calculer l'estimation");
      setEstimation(null);
    }
    setEstimating(false);
  }, [wizForm.vehicle_id, wizForm.date, buildPointsBody, vehicles]);

  // Durée prévisionnelle AU FIL DE L'EAU (demande client 08/2026) : l'estimation
  // est recalculée (debounce 600 ms) dès qu'on compose la tournée — chaque CAV
  // ajouté/retiré en mode manuel, choix d'un modèle prédéfini, cochage des
  // points association — et plus seulement à l'étape récapitulative.
  useEffect(() => {
    if (!['date', 'driver', 'cav', 'estimation'].includes(currentStepKey)) return;
    if (isIntelligentPav) return; // le mode IA choisit ses points à la création
    if (isManualPav && !(wizForm.cav_ids || []).length) { setEstimation(null); return; }
    if (isStandardPav && !selectedStandardRoute) { setEstimation(null); return; }
    const t = setTimeout(() => { runEstimate(); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepKey, wizForm.vehicle_id, wizForm.date, selectedAssoPoints, selectedStandardRoute, wizForm.cav_ids]);

  const optimizeManualOrder = async () => {
    if (!wizForm.vehicle_id || (wizForm.cav_ids || []).length < 2) return;
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const res = await api.post('/tours/estimate', {
        date: wizForm.date,
        vehicle_id: parseInt(wizForm.vehicle_id, 10),
        cav_ids: wizForm.cav_ids,
        optimize: true,
      }, { timeout: 120000 });
      const order = res.data?.estimation?.ordre_optimise;
      if (Array.isArray(order) && order.length) {
        setWizForm(f => ({ ...f, cav_ids: order }));
      }
    } catch (err) {
      console.error(err);
      setOptimizeError(err.response?.data?.error || "Impossible d'optimiser l'ordre");
    }
    setOptimizing(false);
  };

  const generateTour = async (force = false) => {
    setGenerating(true);
    setCreateError(null);
    try {
      let res;
      const base = {
        date: wizForm.date,
        vehicle_id: wizForm.vehicle_id ? parseInt(wizForm.vehicle_id, 10) : undefined,
        driver_employee_id: wizForm.driver_employee_id ? parseInt(wizForm.driver_employee_id, 10) : undefined,
      };
      if (wizForm.collection_type === 'association') {
        const pointIds = selectedAssoPoints.length > 0 ? selectedAssoPoints : assoPoints.map(p => p.id);
        res = await api.post('/tours/association', {
          ...base,
          association_point_ids: pointIds,
          standard_route_id: selectedAssoRoute || null,
          force,
        }, { timeout: 120000 });
      } else if (wizForm.mode === 'standard') {
        res = await api.post('/tours/standard', {
          ...base,
          standard_route_id: selectedStandardRoute ? parseInt(selectedStandardRoute, 10) : null,
          force,
        }, { timeout: 120000 });
      } else if (wizForm.mode === 'manual') {
        res = await api.post('/tours/manual', {
          ...base,
          cav_ids: wizForm.cav_ids || [],
          force,
        }, { timeout: 120000 });
      } else {
        res = await api.post('/tours/intelligent', base, { timeout: 120000 });
      }
      setGeneratedTour(res.data);
      setCreateErrorCode(null);
      setWizardStep(totalSteps); // étape « Résultat », toujours la dernière
      loadTours();
    } catch (err) {
      console.error(err);
      if (err.response?.status === 409 && err.response?.data?.code === 'DUREE_MAX_DEPASSEE') {
        if (err.response.data.estimation) setEstimation(err.response.data.estimation);
        setCreateErrorCode('DUREE_MAX_DEPASSEE');
        setCreateError(err.response.data.error || 'Durée de travail maximale dépassée');
      } else {
        setCreateErrorCode(null);
        setCreateError(err.response?.data?.error || 'Erreur lors de la génération de la tournée');
      }
    }
    setGenerating(false);
  };

  const handleDriverNext = () => {
    if (isIntelligentPav) generateTour(false);
    else goNext();
  };

  const updateStatus = async (id, status) => {
    if (statusUpdating[id]) return; // évite le double envoi (double clic sur « Terminer »)
    setStatusUpdating(prev => ({ ...prev, [id]: true }));
    try {
      await api.put(`/tours/${id}/status`, { status });
      await loadTours();
    } catch (err) {
      console.error(err);
    } finally {
      setStatusUpdating(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const loadTourDetail = async (id) => {
    try {
      // Détail de base + résumé enrichi (points, incidents, GPS, poids…)
      const [base, summary] = await Promise.all([
        api.get(`/tours/${id}`),
        api.get(`/tours/${id}/live-summary`).catch(() => ({ data: null })),
      ]);
      setSelectedTour({ ...base.data, summary: summary.data });
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des tournées..." /></Layout>;
  if (error) return <Layout><div className="p-6"><ErrorState title="Impossible de charger les tournées" onRetry={loadTours} variant="card" /></div></Layout>;

  // KPIs / stats
  const plannedCount = tours.filter(t => t.status === 'planned').length;
  const inProgressCount = tours.filter(t => t.status === 'in_progress').length;
  const totalWeight = tours.reduce((acc, t) => acc + (Number(t.total_weight_kg) || 0), 0);

  const columns = [
    { key: 'date', label: 'Date', sortable: true, render: (t) => <span className="font-medium text-slate-700">{new Date(t.date).toLocaleDateString('fr-FR')}</span> },
    { key: 'vehicle', label: 'Véhicule', sortable: true, render: (t) => t.registration || t.vehicle_registration || '—' },
    { key: 'driver', label: 'Chauffeur', sortable: true, render: (t) => t.driver_name || [t.driver_first_name, t.driver_last_name].filter(Boolean).join(' ') || '—' },
    {
      key: 'mode',
      label: 'Mode',
      sortable: true,
      render: (t) => <StatusBadge status={t.mode} size="sm" />,
    },
    {
      key: 'collection_type',
      label: 'Type',
      sortable: true,
      render: (t) => t.collection_type === 'association'
        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700">Asso</span>
        : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-100 text-teal-700">PAV</span>
    },
    { key: 'nb_cav', label: 'Points', sortable: true, render: (t) => t.nb_cav || 0 },
    { key: 'total_weight_kg', label: 'Poids (kg)', sortable: true, render: (t) => <span className="font-semibold text-slate-700">{t.total_weight_kg || 0}</span> },
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
          <button onClick={() => loadTourDetail(t.id)} className="text-teal-600 text-xs font-semibold hover:text-teal-700 hover:underline">Détails</button>
          {t.status === 'planned' && (
            <button onClick={() => updateStatus(t.id, 'in_progress')} disabled={!!statusUpdating[t.id]} className="text-orange-500 text-xs font-semibold hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline">{statusUpdating[t.id] ? '…' : 'Démarrer'}</button>
          )}
          {t.status === 'in_progress' && (
            <button onClick={() => updateStatus(t.id, 'completed')} disabled={!!statusUpdating[t.id]} className="text-emerald-600 text-xs font-semibold hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline">{statusUpdating[t.id] ? '…' : 'Terminer'}</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Historique des tournées"
          subtitle="Consultation, suivi et archives des tournées de collecte"
          icon={Truck}
          actions={
            <button
              onClick={openWizard}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-teal-glow transition-all active:scale-[0.98] w-full sm:w-auto justify-center"
            >
              <Plus className="w-4 h-4" strokeWidth={2.2} />
              Nouvelle tournée
            </button>
          }
        />

        {/* Banner IA — proposition tournées demain */}
        {plannedCount === 0 && tours.length > 0 && (
          <div className="mb-5 rounded-2xl bg-gradient-to-r from-teal-50 via-teal-50 to-emerald-50 border border-teal-100 p-5 flex flex-col sm:flex-row items-start gap-4 shadow-card">
            <div className="flex-shrink-0 grid place-items-center w-12 h-12 rounded-xl bg-teal-600 text-white shadow-teal-glow">
              <Sparkles className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-600 text-white text-[10px] font-bold uppercase tracking-wide">
                  <Sparkles className="w-3 h-3" /> IA
                </span>
                <h3 className="text-base font-bold text-slate-800">Suggestions pour demain</h3>
              </div>
              <p className="text-sm text-slate-600 mt-1">
                Basé sur la saturation CAV, la proximité dépôt et l'historique. Lance le wizard pour générer une tournée optimisée.
              </p>
            </div>
            <button
              onClick={openWizard}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-button bg-white border border-teal-200 text-teal-700 hover:bg-teal-50 text-sm font-semibold transition-colors flex-shrink-0"
            >
              Voir & valider <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* KPIs rapides */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="rounded-card bg-white border border-slate-200 p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-1">{tours.length}</p>
          </div>
          <div className="rounded-card bg-white border border-slate-200 p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">En cours</p>
            <p className="text-2xl font-extrabold text-teal-600 mt-1">{inProgressCount}</p>
          </div>
          <div className="rounded-card bg-white border border-slate-200 p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Planifiées</p>
            <p className="text-2xl font-extrabold text-amber-600 mt-1">{plannedCount}</p>
          </div>
          <div className="rounded-card bg-white border border-slate-200 p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Poids collecté</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-1">{totalWeight.toLocaleString('fr-FR')}<span className="text-sm font-medium text-slate-400 ml-1">kg</span></p>
          </div>
        </div>

        {/* Liste tournées */}
        <Section
          title="Tournées actives"
          subtitle={`${tours.length} tournée${tours.length > 1 ? 's' : ''} au total`}
          icon={Route}
          padded={false}
        >
          {/* Mobile cards */}
          <div className="lg:hidden space-y-3 p-4">
            {tours.length === 0 ? (
              <EmptyState icon={Route} title="Aucune tournée" description="Commencez par créer une nouvelle tournée de collecte." />
            ) : tours.map((t, idx) => (
              <div
                key={t.id}
                onClick={() => loadTourDetail(t.id)}
                className="rounded-card bg-white border border-slate-200 p-4 cursor-pointer hover:border-teal-300 hover:shadow-card-hover transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 grid place-items-center w-10 h-10 rounded-xl bg-teal-50 text-teal-700 font-bold text-sm">
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-bold text-slate-800">{new Date(t.date).toLocaleDateString('fr-FR')}</span>
                      <StatusBadge status={t.status} type="tournee" size="sm" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-700 mb-1">
                      <span className="font-semibold">{t.registration || t.vehicle_registration || '—'}</span>
                      <StatusBadge status={t.mode} size="sm" />
                    </div>
                    <p className="text-xs text-slate-500 mb-2">{t.driver_name || [t.driver_first_name, t.driver_last_name].filter(Boolean).join(' ') || 'Pas de chauffeur'}</p>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{t.nb_cav || 0} points</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-700"><Navigation className="w-3 h-3" />{t.total_weight_kg || 0} kg</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                  {t.status === 'planned' && (
                    <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'in_progress'); }} disabled={!!statusUpdating[t.id]} className="flex-1 text-center py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{statusUpdating[t.id] ? '…' : 'Démarrer'}</button>
                  )}
                  {t.status === 'in_progress' && (
                    <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'completed'); }} disabled={!!statusUpdating[t.id]} className="flex-1 text-center py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{statusUpdating[t.id] ? '…' : 'Terminer'}</button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); loadTourDetail(t.id); }} className="flex-1 text-center py-2 rounded-lg bg-teal-50 text-teal-700 text-xs font-semibold hover:bg-teal-100 transition-colors">Détails</button>
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
        </Section>

        {/* Wizard Modal */}
        <Modal isOpen={showWizard} onClose={() => setShowWizard(false)} title={`Nouvelle tournée — Étape ${Math.min(wizardStep, totalSteps)}/${totalSteps}`} size="xl">
              {/* Progress */}
              <div className="flex gap-1.5 mb-6">
                {stepKeys.map((key, idx) => (
                  <div key={key} className={`h-1.5 flex-1 rounded-full transition-colors ${idx + 1 <= wizardStep ? 'bg-teal-600' : 'bg-slate-200'}`} />
                ))}
              </div>

              {/* Étape : Date & Type de collecte */}
              {currentStepKey === 'date' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-800">Date et type de collecte</h3>
                  <div>
                    <label className="text-xs font-medium text-slate-500">Date de tournée</label>
                    <input type="date" value={wizForm.date} onChange={e => setWizForm({ ...wizForm, date: e.target.value })} className="input-modern" />
                  </div>

                  {/* Type de collecte */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">Type de collecte</label>
                    <div className="flex gap-2">
                      {[
                        { key: 'pav', label: 'PAV (espace public)', color: 'border-teal-500 bg-teal-50' },
                        { key: 'association', label: 'Association', color: 'border-orange-500 bg-orange-50' },
                      ].map(ct => (
                        <label key={ct.key} className={`flex-1 flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${wizForm.collection_type === ct.key ? ct.color : 'border-slate-200 hover:border-slate-300'}`}>
                          <input type="radio" name="collection_type" value={ct.key} checked={wizForm.collection_type === ct.key}
                            onChange={() => setWizForm({ ...wizForm, collection_type: ct.key, mode: ct.key === 'association' ? 'standard' : 'intelligent' })} />
                          <span className="text-sm font-semibold">{ct.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Mode de génération (PAV uniquement) */}
                  {wizForm.collection_type === 'pav' && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500">Mode de génération</label>
                      {[
                        { key: 'intelligent', label: 'IA Intelligente', desc: 'Optimisation par prédiction de remplissage, TSP + 2-opt' },
                        { key: 'standard', label: 'Modèle de tournée — affecter une tournée préétablie', desc: 'Choisir une liste de CAV déjà préparée (que vous gérez dans les modèles)' },
                        { key: 'manual', label: 'Manuel', desc: 'Composer la liste des CAV vous-même, dans l\'ordre de collecte' },
                      ].map(m => (
                        <label key={m.key} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${wizForm.mode === m.key ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}>
                          <input type="radio" name="mode" value={m.key} checked={wizForm.mode === m.key} onChange={() => setWizForm({ ...wizForm, mode: m.key })} className="mt-1" />
                          <div>
                            <p className="font-semibold text-sm text-slate-800">{m.label}</p>
                            <p className="text-xs text-slate-500">{m.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Sélection du modèle (mode standard) */}
                  {isStandardPav && (
                    <div className="space-y-2 rounded-xl border border-slate-200 p-3 bg-slate-50">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-500">Modèle de tournée</label>
                        <Link to="/route-templates" className="text-[11px] text-teal-600 hover:text-teal-700 hover:underline">Gérer les modèles →</Link>
                      </div>
                      <select
                        value={selectedStandardRoute}
                        onChange={e => { setSelectedStandardRoute(e.target.value); loadStandardRoutePreview(e.target.value); }}
                        className="select-modern"
                      >
                        <option value="">Sélectionner un modèle…</option>
                        {standardRoutes.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.name} — {r.cav_count ?? 0} CAV{r.estimated_duration_minutes ? ` · ${fmtRouteDuration(r.estimated_duration_minutes)}` : ''}
                          </option>
                        ))}
                      </select>
                      {standardRoutes.length === 0 && (
                        <p className="text-xs text-slate-400 italic">Aucun modèle disponible — créez-en un depuis « Gérer les modèles ».</p>
                      )}
                      {standardRouteLoading && <p className="text-xs text-slate-400">Chargement de la composition…</p>}
                      {standardRoutePreview && (
                        <div>
                          <p className="text-[11px] font-semibold text-slate-500 mb-1">
                            Composition ({standardRoutePreview.cavs?.length || 0} CAV)
                          </p>
                          <div className="max-h-32 overflow-y-auto space-y-1">
                            {(standardRoutePreview.cavs || []).map((c, i) => (
                              <div key={c.cav_id || i} className="flex items-center gap-2 text-xs bg-white rounded-lg px-2 py-1.5 border border-slate-100">
                                <span className="w-4 h-4 rounded-full bg-teal-600 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">{c.position || i + 1}</span>
                                <span className="truncate flex-1">{c.name}</span>
                                <span className="text-slate-400 text-[10px] flex-shrink-0">{c.commune || ''}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Durée prévisionnelle du modèle choisi, au fil de l'eau */}
                      {selectedStandardRoute && (
                        <>
                          <EstimationPanel estimation={estimation} loading={estimating} error={estimateError} compact />
                          {!wizForm.vehicle_id && estimation && vehicles[0] && (
                            <p className="text-[11px] text-slate-400">
                              Aperçu sur la base du véhicule {vehicles[0].registration} — recalculé avec le véhicule que vous choisirez.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Mode manuel : la sélection se fait à l'étape suivante */}
                  {isManualPav && (
                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                      Vous choisirez les CAV à collecter, dans l'ordre souhaité, à l'étape suivante.
                    </p>
                  )}

                  {/* Sélection points association */}
                  {wizForm.collection_type === 'association' && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500">Points de collecte associatifs</label>
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
                      <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1">
                        {assoPoints.map(ap => (
                          <label key={ap.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm ${selectedAssoPoints.includes(ap.id) ? 'bg-orange-50' : 'hover:bg-slate-50'}`}>
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
                      {/* Durée prévisionnelle au fil de l'eau (recalculée à chaque point coché) */}
                      {assoPoints.length > 0 && (
                        <>
                          <EstimationPanel estimation={estimation} loading={estimating} error={estimateError} compact />
                          {!wizForm.vehicle_id && estimation && vehicles[0] && (
                            <p className="text-[11px] text-slate-400">
                              Aperçu sur la base du véhicule {vehicles[0].registration} — recalculé avec le véhicule que vous choisirez.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <button
                    onClick={goNext}
                    disabled={isStandardPav && !selectedStandardRoute}
                    className="w-full py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Suivant
                  </button>
                </div>
              )}

              {/* Étape : Véhicule */}
              {currentStepKey === 'vehicle' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-800">Véhicule</h3>
                  <div className="space-y-2">
                    {vehicles.map(v => (
                      <label key={v.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${wizForm.vehicle_id === String(v.id) ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}>
                        <input type="radio" name="vehicle" value={v.id} checked={wizForm.vehicle_id === String(v.id)} onChange={() => setWizForm({ ...wizForm, vehicle_id: String(v.id) })} />
                        <div>
                          <p className="font-semibold text-sm text-slate-800">{v.registration} — {v.brand} {v.model}</p>
                          <p className="text-xs text-slate-500">Capacité : {v.capacity_kg} kg | Type : {v.type}</p>
                        </div>
                      </label>
                    ))}
                    {vehicles.length === 0 && <p className="text-slate-400 text-sm">Aucun véhicule disponible</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={goBack} className="flex-1 py-2.5 rounded-button bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors">Retour</button>
                    <button onClick={goNext} disabled={!wizForm.vehicle_id} className="flex-1 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      Suivant
                    </button>
                  </div>
                </div>
              )}

              {/* Étape : Chauffeur */}
              {currentStepKey === 'driver' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-800">Chauffeur</h3>
                  <select value={wizForm.driver_employee_id} onChange={e => setWizForm({ ...wizForm, driver_employee_id: e.target.value })} className="select-modern">
                    <option value="">Sélectionner un chauffeur</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
                  </select>

                  {/* Dépassement détecté à la génération IA directe (pas d'étape d'estimation en mode IA) */}
                  {isIntelligentPav && createErrorCode === 'DUREE_MAX_DEPASSEE' && (
                    <div className="space-y-2">
                      <EstimationPanel estimation={estimation} compact />
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
                        <p className="text-sm text-red-700 font-medium">{createError}</p>
                        <label className="flex items-start gap-2 text-xs text-red-700">
                          <input type="checkbox" checked={confirmForce} onChange={e => setConfirmForce(e.target.checked)} className="mt-0.5" />
                          Je confirme la création malgré le dépassement de la durée de travail maximale.
                        </label>
                      </div>
                    </div>
                  )}
                  {isIntelligentPav && createError && createErrorCode !== 'DUREE_MAX_DEPASSEE' && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{createError}</div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={goBack} className="flex-1 py-2.5 rounded-button bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors">Retour</button>
                    {isIntelligentPav && createErrorCode === 'DUREE_MAX_DEPASSEE' ? (
                      <button onClick={() => generateTour(true)} disabled={generating || !confirmForce} className="flex-1 py-2.5 rounded-button bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {generating ? 'Création…' : 'Créer quand même'}
                      </button>
                    ) : (
                      <button onClick={handleDriverNext} disabled={generating} className="flex-1 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {generating ? 'Génération...' : isIntelligentPav ? 'Générer la tournée' : 'Suivant'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Étape : Sélection des CAV (mode manuel) */}
              {currentStepKey === 'cav' && (
                <div className="space-y-3">
                  <h3 className="font-bold text-slate-800">Sélection des CAV</h3>
                  <p className="text-xs text-slate-500">Choisissez les CAV à collecter, dans l'ordre de passage souhaité.</p>
                  <CavPicker
                    mode="cav"
                    value={wizForm.cav_ids || []}
                    onChange={(ids) => setWizForm(f => ({ ...f, cav_ids: ids }))}
                    onOptimize={optimizeManualOrder}
                    optimizing={optimizing}
                    estimation={estimation}
                    estimating={estimating}
                  />
                  {optimizeError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{optimizeError}</div>
                  )}
                  {estimateError && (wizForm.cav_ids || []).length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">{estimateError}</div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={goBack} className="flex-1 py-2.5 rounded-button bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors">Retour</button>
                    <button onClick={goNext} disabled={!(wizForm.cav_ids || []).length} className="flex-1 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      Suivant ({(wizForm.cav_ids || []).length} sélectionné{(wizForm.cav_ids || []).length > 1 ? 's' : ''})
                    </button>
                  </div>
                </div>
              )}

              {/* Étape : Estimation (récapitulatif avant création) */}
              {currentStepKey === 'estimation' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-800">Estimation avant création</h3>
                  <EstimationPanel estimation={estimation} loading={estimating} error={estimateError} />

                  {createError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
                      <p className="text-sm text-red-700 font-medium">{createError}</p>
                      {createErrorCode === 'DUREE_MAX_DEPASSEE' && (
                        <label className="flex items-start gap-2 text-xs text-red-700">
                          <input type="checkbox" checked={confirmForce} onChange={e => setConfirmForce(e.target.checked)} className="mt-0.5" />
                          Je confirme la création malgré le dépassement de la durée de travail maximale.
                        </label>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={goBack} className="flex-1 py-2.5 rounded-button bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors">Retour</button>
                    <button
                      onClick={() => generateTour(createErrorCode === 'DUREE_MAX_DEPASSEE' ? confirmForce : false)}
                      disabled={generating || estimating || (createErrorCode === 'DUREE_MAX_DEPASSEE' && !confirmForce)}
                      className={`flex-1 py-2.5 rounded-button text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${createErrorCode === 'DUREE_MAX_DEPASSEE' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
                    >
                      {generating ? 'Création…' : createErrorCode === 'DUREE_MAX_DEPASSEE' ? 'Créer quand même' : 'Confirmer et créer la tournée'}
                    </button>
                  </div>
                </div>
              )}

              {/* Étape : Résultat */}
              {currentStepKey === 'result' && generatedTour && (
                <div className="space-y-4">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <h3 className="font-bold text-emerald-700 mb-2">Tournée générée avec succès</h3>
                    <div className="text-sm space-y-1">
                      <p><span className="text-slate-500">ID :</span> #{generatedTour.tour?.id || generatedTour.id}</p>
                      <p><span className="text-slate-500">CAV planifiés :</span> {generatedTour.stats?.totalCavs || generatedTour.tour?.nb_cav || generatedTour.estimation?.nb_points || '—'}</p>
                      <p><span className="text-slate-500">Distance estimée :</span> {generatedTour.stats?.totalDistance || generatedTour.tour?.estimated_distance_km || generatedTour.estimation?.distance_km || '—'} km</p>
                      <p><span className="text-slate-500">Durée estimée :</span> {generatedTour.stats?.estimatedDuration || generatedTour.tour?.estimated_duration_min || generatedTour.estimation?.duree_totale_min || '—'} min</p>
                    </div>
                  </div>

                  {generatedTour.estimation && (
                    <EstimationPanel estimation={generatedTour.estimation} compact />
                  )}

                  {generatedTour.saturation_non_couverte?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <h4 className="font-bold text-amber-800 text-sm mb-2">Bornes saturées non incluses</h4>
                      <p className="text-xs text-amber-700 mb-2">
                        Ces CAV approchent ou dépassent leur seuil de saturation mais n'ont pas pu être intégrés à cette tournée — planifiez une rotation dédiée.
                      </p>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {generatedTour.saturation_non_couverte.map((c, i) => (
                          <div key={c.cav_id || i} className="flex items-center justify-between text-xs bg-white/70 rounded-lg px-2.5 py-1.5">
                            <span className="font-medium text-amber-900">{c.name}</span>
                            <span className="font-bold text-amber-700">{Math.round(c.predicted_fill_rate)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {generatedTour.explanation && (
                    <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                      <h4 className="font-bold text-teal-700 text-sm mb-1 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Explication IA</h4>
                      <p className="text-xs text-teal-900">{generatedTour.explanation}</p>
                    </div>
                  )}
                  {(generatedTour.cavs || generatedTour.cavList) && (
                    <div>
                      <h4 className="font-bold text-sm mb-2 text-slate-800">Points de collecte</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {(generatedTour.cavs || generatedTour.cavList).map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs bg-slate-50 rounded-lg p-2">
                            <span className="w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[10px] font-bold">{c.position || i + 1}</span>
                            <span className="flex-1">{c.name || c.nom || c.cav_name}</span>
                            <span className="text-slate-400">{c.predicted_fill ? `${Math.round(c.predicted_fill)}%` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => setShowWizard(false)} className="w-full py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors">Fermer</button>
                </div>
              )}
        </Modal>

        {/* Tour Detail Panel (slide-in droite, large, enrichi) */}
        {selectedTour && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex justify-end z-50" onClick={() => setSelectedTour(null)}>
            <div className="bg-white w-full sm:w-[680px] h-full overflow-y-auto shadow-elevated p-4 sm:p-6 animate-slide-in-right" onClick={e => e.stopPropagation()}>
              <TourDetailPanel tour={selectedTour} onClose={() => setSelectedTour(null)} />
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
      <span className="text-slate-500 text-xs font-medium">{label}</span>
      <p className="font-semibold text-slate-800">{value || '—'}</p>
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDur(min) {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function TourDetailPanel({ tour, onClose }) {
  const summary = tour.summary || {};
  // Les indicateurs mesurés vivent dans `summary.kpis` (GET /tours/:id/live-summary).
  // Ils étaient lus à la racine de `summary` : introuvables, ils retombaient
  // SILENCIEUSEMENT sur les estimations de planification — un écran qui
  // affichait « 6h20 » et « 110 km » pour une tournée réellement partie à 7h49
  // et rentrée à 16h49, et « — » au lieu des kilos pesés.
  const kpis = summary.kpis || {};
  const points = summary.points || tour.cavs || [];
  const incidents = summary.incidents || [];
  const weights = summary.weights || [];

  // Réel d'abord, estimation en repli — et l'écran DIT lequel il montre.
  const distanceReelle = Number.isFinite(parseFloat(kpis.distance_km)) && parseFloat(kpis.distance_km) > 0
    ? parseFloat(kpis.distance_km) : null;
  const distanceEstimee = tour.estimated_distance_km != null ? parseFloat(tour.estimated_distance_km) : null;
  const dureeReelle = Number.isFinite(parseFloat(kpis.elapsed_min)) ? parseFloat(kpis.elapsed_min) : null;
  const dureeEstimee = tour.estimated_duration_min != null ? parseFloat(tour.estimated_duration_min) : null;
  const totalWeight = kpis.total_weight_kg ?? tour.total_weight_kg ?? null;
  const avgFill = kpis.fill_cumulated_percent ?? null;
  const nbCollected = kpis.nb_cav_collected ?? points.filter(p => p.status === 'collected').length;

  // Un point peut porter un poids individuel (collectes association) ; sur une
  // tournée CAV le poids est pesé au centre, pas borne par borne. On masque
  // alors la colonne plutôt que d'aligner des tirets sans explication.
  const colonnePoids = points.some(p => p.weight_kg != null || p.collected_weight_kg != null);

  return (
    <>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Tournée #{tour.id}</h2>
          <p className="text-xs text-slate-500 mt-1">
            {tour.date ? new Date(tour.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
            {tour.collection_type === 'association' && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">ASSOCIATIONS</span>}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none p-1 rounded-lg hover:bg-slate-100">&times;</button>
      </div>

      {/* Résumé en 3 colonnes */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <SummaryTile label="Statut" value={tour.status} />
        <SummaryTile label="Mode" value={tour.mode} />
        <SummaryTile label="Type" value={tour.collection_type === 'association' ? 'Asso' : 'CAV'} />
      </div>

      {/* Qui + véhicule */}
      <div className="card-modern p-3 mb-4 bg-slate-50">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Qui & véhicule</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Chauffeur" value={tour.driver_name || [tour.driver_first_name, tour.driver_last_name].filter(Boolean).join(' ')} />
          <Field label="Véhicule" value={tour.registration || tour.vehicle_registration || tour.vehicle_name} />
          <Field label="Démarrage" value={tour.started_at ? new Date(tour.started_at).toLocaleString('fr-FR') : '—'} />
          <Field label="Fin" value={tour.completed_at ? new Date(tour.completed_at).toLocaleString('fr-FR') : '—'} />
        </div>
      </div>

      {/* KPI globaux — réel mesuré, estimation en second */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <MiniStat
          label={dureeReelle != null ? 'Durée réelle' : 'Durée estimée'}
          value={fmtDur(dureeReelle != null ? dureeReelle : dureeEstimee)}
          note={dureeReelle != null && dureeEstimee != null ? `estimée ${fmtDur(dureeEstimee)}` : null}
        />
        <MiniStat
          label={distanceReelle != null ? 'Distance parcourue' : 'Distance estimée'}
          value={(distanceReelle ?? distanceEstimee) != null
            ? `${Math.round((distanceReelle ?? distanceEstimee) * 10) / 10} km` : '—'}
          note={distanceReelle != null && distanceEstimee != null
            ? `estimée ${Math.round(distanceEstimee * 10) / 10} km`
            : (distanceReelle == null ? 'aucun relevé GPS' : null)}
        />
        <MiniStat label="Points" value={`${nbCollected}/${points.length}`} />
        <MiniStat
          label="Poids total"
          value={totalWeight != null ? `${Math.round(totalWeight)} kg` : '—'}
          note={weights.length > 1 ? `${weights.length} pesées` : null}
        />
        {avgFill != null && <MiniStat label="Remplissage moy." value={`${avgFill}%`} />}
        {incidents.length > 0 && <MiniStat label="Incidents" value={incidents.length} highlight />}
      </div>

      {/* Liste détaillée des points */}
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5" />
          Points de collecte ({points.length})
        </h3>
        {points.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Aucun point</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left py-1.5 px-2 w-8">#</th>
                  <th className="text-left py-1.5 px-2">Point</th>
                  <th className="text-right py-1.5 px-2">Prévu</th>
                  <th className="text-right py-1.5 px-2">Réel</th>
                  <th className="text-right py-1.5 px-2">Remplissage</th>
                  {colonnePoids && <th className="text-right py-1.5 px-2">Poids</th>}
                  <th className="text-center py-1.5 px-2">⚠</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={p.id || i} className="border-b border-slate-100">
                    {/* Rang de passage, et non la valeur brute de `position` :
                        retirer un point d'une tournée y laisse un trou, et la
                        liste affichait « 1, 2, 3, 4, 6, 7 » pour six points. */}
                    <td className="py-1.5 px-2 font-mono text-slate-400">{i + 1}</td>
                    <td className="py-1.5 px-2">
                      <p className="font-medium text-slate-700">{p.cav_name || p.name || p.nom}</p>
                      {p.commune && <p className="text-[10px] text-slate-400">{p.commune}</p>}
                    </td>
                    {/* « ≈ » quand l'heure vient de la répartition linéaire et
                        non du calcul d'itinéraire : les deux méthodes cohabitent
                        dans la même colonne et ne se comparent pas au réel de la
                        même façon. */}
                    <td className="py-1.5 px-2 text-right text-slate-500 whitespace-nowrap">
                      {p.planned_source === 'estime' && <span className="text-slate-400" title="Heure estimée par répartition, non calculée sur l'itinéraire">≈ </span>}
                      {fmtTime(p.planned_passage_at || p.planned_passage_time)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-700">{fmtTime(p.collected_at)}</td>
                    <td className="py-1.5 px-2 text-right">
                      {p.status === 'skipped' ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase"
                          title={p.skip_reason ? `Motif : ${p.skip_reason.replace(/_/g, ' ')}` : 'Aucun motif renseigné'}>
                          {p.skip_reason ? p.skip_reason.replace(/_/g, ' ') : 'skipped'}
                        </span>
                      ) : p.fill_level != null ? (
                        <span className="font-semibold">{p.fill_level}/5</span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    {colonnePoids && (
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {p.weight_kg != null ? <span className="font-semibold">{Math.round(p.weight_kg)} kg</span> : (p.collected_weight_kg ? <span className="font-semibold">{Math.round(p.collected_weight_kg)} kg</span> : <span className="text-slate-400">—</span>)}
                      </td>
                    )}
                    <td className="py-1.5 px-2 text-center">
                      {p.has_incident && <span className="text-red-500" title="Incident">!</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!colonnePoids && weights.length > 0 && (
        <p className="text-[10px] text-slate-400 -mt-3 mb-4">
          Le poids n'est pas relevé borne par borne sur une tournée de conteneurs :
          il est pesé au centre de tri, ci-dessous.
        </p>
      )}

      {/* Pesées centre de tri */}
      {weights.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
            <Truck className="w-3.5 h-3.5" />
            Pesées au centre de tri ({weights.length})
          </h3>
          <div className="space-y-1">
            {weights.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-slate-500">{fmtTime(w.recorded_at)}</span>
                <span className="font-semibold">{Math.round(parseFloat(w.weight_kg) || 0)} kg</span>
                {w.is_intermediate && <span className="text-[10px] text-amber-600">(intermédiaire)</span>}
                {w.notes && <span className="text-[10px] text-slate-400 truncate">{w.notes}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incidents */}
      {incidents.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-red-600 mb-2 flex items-center gap-2">
            ⚠ Incidents déclarés ({incidents.length})
          </h3>
          <div className="space-y-2">
            {incidents.map((inc) => (
              <div key={inc.id} className="bg-red-50 border border-red-100 rounded-lg p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-red-800">{inc.type}</span>
                  <span className="text-[10px] text-red-500">{fmtTime(inc.created_at)}</span>
                </div>
                {inc.description && <p className="text-slate-600 mt-1">{inc.description}</p>}
                <p className="text-[10px] text-slate-400 mt-1">Statut : {inc.status}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SummaryTile({ label, value }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 text-center">
      <p className="text-[10px] text-slate-500 uppercase">{label}</p>
      <p className="text-sm font-semibold text-slate-700 mt-0.5">{value || '—'}</p>
    </div>
  );
}

function MiniStat({ label, value, highlight, note }) {
  return (
    <div className={`rounded-lg p-2 ${highlight ? 'bg-red-50 border border-red-100' : 'bg-slate-50'}`}>
      <p className="text-[10px] text-slate-500 uppercase">{label}</p>
      <p className={`text-sm font-bold ${highlight ? 'text-red-700' : 'text-slate-800'}`}>{value}</p>
      {note && <p className="text-[10px] text-slate-400 mt-0.5">{note}</p>}
    </div>
  );
}
