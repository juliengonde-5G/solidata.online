import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Route, Plus, Truck, Sparkles, Navigation, MapPin, ArrowRight, AlertTriangle,
  Clock, ShoppingBag, Boxes, ClipboardCheck, Recycle,
} from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal, PageHeader, Section, EmptyState, ErrorState } from '../components';
import CavPicker from '../components/tours/CavPicker';
import EstimationPanel from '../components/tours/EstimationPanel';
import BordereauxDecheterie from '../components/tours/BordereauxDecheterie';
import useAsyncData from '../hooks/useAsyncData';
import api from '../services/api';
import { libelleTypeIncident, libelleStatutIncident } from '../utils/incidents';
import { lienCarteGps } from '../utils/tours';
import { printRapportTournee } from '../components/tours/pdf-tournee';
import TourRepriseAdmin from '../components/tours/TourRepriseAdmin';
import { useAuth } from '../contexts/AuthContext';

// Types d'arrêt GPS. Les valeurs stockées sont techniques (`cav`, `centre`) :
// elles ne doivent jamais atteindre l'écran telles quelles.
const ARRET_TYPE_LABELS = {
  cav: 'Conteneur', association: 'Association', centre: 'Centre de tri', inconnu: 'Non identifié',
};
// L'arrêt « non identifié » est mis en évidence : c'est précisément celui qu'on
// ne s'explique pas, donc celui qui mérite d'être regardé.
const ARRET_TYPE_STYLE = {
  cav: 'bg-teal-100 text-teal-800',
  association: 'bg-orange-100 text-orange-800',
  centre: 'bg-indigo-100 text-indigo-800',
  inconnu: 'bg-amber-100 text-amber-900',
};
// Motifs de non-collecte, traduits. Le vocabulaire stocké est technique
// (CHECK de `tour_cav.skip_reason`) et s'affichait tel quel — « cav fermee »,
// et « skipped » quand aucun motif n'avait été saisi. Même table que
// `backend/src/routes/tours/rapport.js`, qui imprime les mêmes motifs.
const MOTIFS_NON_COLLECTE = {
  cav_fermee: 'Conteneur fermé',
  bouchee: 'Conteneur bouché',
  acces_impossible: 'Accès impossible',
  proprietaire_absent: 'Propriétaire absent',
  vide: 'Conteneur vide',
  autre: 'Autre motif',
};
// Repli sur la valeur brute plutôt que sur un tiret : un motif inconnu qui
// s'affiche en clair signale un libellé manquant ici.
const libelleMotifNonCollecte = (v) => (v ? (MOTIFS_NON_COLLECTE[v] || String(v).replace(/_/g, ' ')) : null);

// Codes de refus 409 forçables à la création (gestionnaire ADMIN/MANAGER,
// forçage tracé côté serveur dans ai_explanation) — même mécanique que le
// dépassement de durée historique.
const FORCABLE_CODES = ['DUREE_MAX_DEPASSEE', 'ASSOCIATION_HORS_HORAIRES', 'RDV_NON_TENABLE'];

const FORCE_LABELS = {
  DUREE_MAX_DEPASSEE: 'le dépassement de la durée de travail maximale',
  ASSOCIATION_HORS_HORAIRES: "l'horaire hors des plages d'accessibilité d'au moins une association",
  RDV_NON_TENABLE: 'le rendez-vous non tenable avec cet ordre de passage',
};

// Minutes d'HORLOGE (depuis minuit) → 'HH:MM'.
function fmtClockMin(min) {
  if (min == null || Number.isNaN(min)) return '—';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Minutes ÉCOULÉES depuis le départ + heure de départ 'HH:MM' → heure d'horloge.
// Les deux référentiels ne se mélangent jamais (cf. contrat tour-time-engine).
function fmtElapsedAsClock(heureDepart, elapsedMin) {
  if (!heureDepart || elapsedMin == null || Number.isNaN(elapsedMin)) return '—';
  const parts = String(heureDepart).split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return '—';
  return fmtClockMin(parts[0] * 60 + parts[1] + Math.round(elapsedMin));
}

// Avertissements d'horaires/rendez-vous de l'estimation LIVE (POST /tours/estimate,
// forme numérique brute du moteur — cf. contrat §3), affichés AVANT toute
// soumission : le refus 409 doit être l'exception, pas la découverte.
function ViolationsPanel({ estimation, onApplyOrder }) {
  const violations = estimation?.violations;
  const ordreSuggere = estimation?.ordre_suggere;
  const hasOrdre = Array.isArray(ordreSuggere) && ordreSuggere.length > 0;
  if ((!violations || violations.length === 0) && !hasOrdre) return null;
  const heureDepart = estimation?.heure_depart;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
      {violations?.length > 0 && (
        <>
          <p className="text-xs font-bold text-amber-800 mb-1.5 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {violations.length} avertissement{violations.length > 1 ? 's' : ''} d'horaires — à régler, ou à forcer en connaissance de cause à la création
          </p>
          <ul className="text-xs text-amber-800 space-y-1.5">
            {violations.map((v, i) => (
              <li key={i} className="bg-white/60 rounded-lg px-2 py-1.5">
                <span className="font-semibold">{v.name || `Point #${v.point_id}`}</span>
                {v.type === 'hors_horaires' && (
                  <>
                    {' — arrivée prévue '}{fmtElapsedAsClock(heureDepart, v.arrivee_min)}
                    {', hors des horaires du jour'}
                    {v.plages?.length
                      ? ` (${v.plages.map(p => `${fmtClockMin(p[0])}-${fmtClockMin(p[1])}`).join(', ')})`
                      : ' (fermé ce jour)'}
                    {v.prochain_creneau_min != null
                      ? ` — premier créneau compatible : ${fmtClockMin(v.prochain_creneau_min)}`
                      : ' — aucun créneau compatible ce jour'}
                  </>
                )}
                {v.type === 'rdv_manque' && (
                  <>
                    {' — rendez-vous manqué : arrivée prévue '}{fmtElapsedAsClock(heureDepart, v.arrivee_min)}
                    {v.fenetre ? `, fenêtre ${fmtClockMin(v.fenetre.debutMin)}-${fmtClockMin(v.fenetre.finMin)}` : ''}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {hasOrdre && onApplyOrder && (
        <button
          type="button"
          onClick={() => onApplyOrder(ordreSuggere)}
          className="mt-2 text-[11px] font-semibold text-amber-800 underline hover:text-amber-900"
        >
          Appliquer l'ordre suggéré par le serveur (tient le rendez-vous)
        </button>
      )}
    </div>
  );
}

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

  // Lien profond `/tours?tour=<id>` (depuis la notification « bordereau
  // déchèterie à valider ») : ouvre directement la fiche de la tournée visée.
  // Un id inconnu ou supprimé ne casse rien — juste un mot discret, jamais
  // une page blanche.
  const [searchParams] = useSearchParams();
  const [deepLinkNotice, setDeepLinkNotice] = useState(null);

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
  const [createErrorViolations, setCreateErrorViolations] = useState([]);
  const [createErrorOrdreSuggere, setCreateErrorOrdreSuggere] = useState(null);
  const [confirmForce, setConfirmForce] = useState(false);

  // Flux association — sélection ORDONNÉE (CavPicker), plus de liste à
  // cocher ni d'inclusion par défaut de « toutes les associations actives »
  // (arbitrage 6 du chantier tournées associations, 26/08/2026 : une
  // sélection explicite est désormais exigée).
  const [assoRoutes, setAssoRoutes] = useState([]);
  const [selectedAssoRoute, setSelectedAssoRoute] = useState('');
  const [selectedAssoPoints, setSelectedAssoPoints] = useState([]);
  // Durée d'arrêt par point association, ajustable pour cette tournée
  // (RG-C2/C3) : { [pointId]: minutes|null }. Préremplie par CavPicker depuis
  // la fiche du point ; `null` laisse la cascade fiche > réglage global
  // s'appliquer côté serveur.
  const [assoDurations, setAssoDurations] = useState({});

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
      const [vRes, eRes, arRes, srRes] = await Promise.all([
        api.get('/vehicles?available=true'),
        api.get('/employees'),
        api.get('/tours/association-routes/list').catch(() => ({ data: [] })),
        api.get('/tours/routes/list').catch(() => ({ data: [] })),
      ]);
      setVehicles(vRes.data);
      setEmployees(eRes.data);
      setAssoRoutes(arRes.data);
      setStandardRoutes((srRes.data || []).filter(r => r.is_active !== false));
    } catch (err) { console.error(err); }
    setWizardStep(1);
    setGeneratedTour(null);
    setSelectedAssoRoute('');
    setSelectedAssoPoints([]);
    setAssoDurations({});
    setSelectedStandardRoute('');
    setStandardRoutePreview(null);
    setEstimation(null);
    setEstimateError(null);
    setCreateError(null);
    setCreateErrorCode(null);
    setCreateErrorViolations([]);
    setCreateErrorOrdreSuggere(null);
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
      // Arbitrage 6 (26/08/2026) : sélection EXPLICITE exigée — plus de repli
      // « toutes les associations actives » quand rien n'est coché.
      if (!selectedAssoPoints.length) return null;
      return {
        association_points: selectedAssoPoints.map(id => ({ id, duree_min: assoDurations[id] ?? null })),
      };
    }
    if (wizForm.mode === 'standard') {
      return { standard_route_id: selectedStandardRoute ? parseInt(selectedStandardRoute, 10) : null };
    }
    if (wizForm.mode === 'manual') {
      return { cav_ids: wizForm.cav_ids || [] };
    }
    return null;
  }, [wizForm.collection_type, wizForm.mode, wizForm.cav_ids, selectedAssoPoints, assoDurations, selectedStandardRoute]);

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
    if (wizForm.collection_type === 'association' && !selectedAssoPoints.length) { setEstimation(null); return; }
    const t = setTimeout(() => { runEstimate(); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepKey, wizForm.vehicle_id, wizForm.date, wizForm.collection_type, selectedAssoPoints, assoDurations, selectedStandardRoute, wizForm.cav_ids]);

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
    if (wizForm.collection_type === 'association' && !selectedAssoPoints.length) return;
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
        res = await api.post('/tours/association', {
          ...base,
          points: selectedAssoPoints.map(id => ({ id, duree_min: assoDurations[id] ?? null })),
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
      setCreateErrorViolations([]);
      setCreateErrorOrdreSuggere(null);
      setWizardStep(totalSteps); // étape « Résultat », toujours la dernière
      loadTours();
    } catch (err) {
      console.error(err);
      const data = err.response?.data;
      if (err.response?.status === 409 && FORCABLE_CODES.includes(data?.code)) {
        if (data.estimation) setEstimation(data.estimation);
        setCreateErrorCode(data.code);
        setCreateErrorViolations(Array.isArray(data.violations) ? data.violations : []);
        setCreateErrorOrdreSuggere(Array.isArray(data.ordre_suggere) ? data.ordre_suggere : null);
        setCreateError(data.error || 'Création refusée — confirmation nécessaire');
      } else {
        setCreateErrorCode(null);
        setCreateErrorViolations([]);
        setCreateErrorOrdreSuggere(null);
        setCreateError(data?.error || 'Erreur lors de la génération de la tournée');
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

  // Ouverture au chargement de la page uniquement — volontairement sans
  // dépendance sur `searchParams` pour ne pas rouvrir le panneau après que
  // l'utilisateur l'a fermé.
  useEffect(() => {
    const tourId = searchParams.get('tour');
    if (!tourId) return undefined;
    let vivant = true;
    (async () => {
      try {
        const [base, summary] = await Promise.all([
          api.get(`/tours/${tourId}`),
          api.get(`/tours/${tourId}/live-summary`).catch(() => ({ data: null })),
        ]);
        if (vivant) setSelectedTour({ ...base.data, summary: summary.data });
      } catch (err) {
        if (vivant) {
          setDeepLinkNotice("Le lien ne correspond à aucune tournée accessible (elle a peut-être été supprimée).");
        }
      }
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        {deepLinkNotice && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-500">
            {deepLinkNotice}
          </div>
        )}

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

        {/* Temps de vidage mesuré, par conteneur et par niveau de remplissage */}
        <TempsVidagePanel />

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

                  {/* Sélection points association — CavPicker : recherche, filtre
                      par commune, sélection ORDONNÉE (l'ordre est l'ordre de
                      passage). Plus de repli « tout inclus » (arbitrage 6) :
                      la sélection est explicite, la création reste bloquée
                      tant qu'aucun point n'est choisi. */}
                  {wizForm.collection_type === 'association' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-500">Points de collecte associatifs</label>
                        <Link to="/route-templates" className="text-[11px] text-teal-600 hover:text-teal-700 hover:underline">Gérer les modèles →</Link>
                      </div>
                      {assoRoutes.length > 0 && (
                        <select value={selectedAssoRoute} onChange={e => {
                          setSelectedAssoRoute(e.target.value);
                          if (e.target.value) {
                            api.get(`/tours/association-routes/${e.target.value}/points`).then(res => {
                              setSelectedAssoPoints((res.data || []).map(p => p.id));
                            });
                          } else {
                            setSelectedAssoPoints([]);
                          }
                        }} className="select-modern">
                          <option value="">Sélection manuelle</option>
                          {assoRoutes.map(r => <option key={r.id} value={r.id}>{r.name} ({r.point_count} points)</option>)}
                        </select>
                      )}
                      <CavPicker
                        mode="association"
                        value={selectedAssoPoints}
                        onChange={setSelectedAssoPoints}
                        durations={assoDurations}
                        onDurationChange={(id, min) => setAssoDurations(prev => ({ ...prev, [id]: min }))}
                      />
                      {selectedAssoPoints.length === 0 ? (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-2">
                          Sélectionnez au moins un point — aucune association n'est incluse par défaut.
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-slate-400">{selectedAssoPoints.length} point{selectedAssoPoints.length > 1 ? 's' : ''} sélectionné{selectedAssoPoints.length > 1 ? 's' : ''}</p>
                          {/* Durée prévisionnelle + avertissements d'horaires, au fil de l'eau */}
                          <EstimationPanel estimation={estimation} loading={estimating} error={estimateError} compact />
                          <ViolationsPanel estimation={estimation} onApplyOrder={setSelectedAssoPoints} />
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
                    disabled={(isStandardPav && !selectedStandardRoute) || (wizForm.collection_type === 'association' && selectedAssoPoints.length === 0)}
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
                  {wizForm.collection_type === 'association' && (
                    <ViolationsPanel estimation={estimation} onApplyOrder={setSelectedAssoPoints} />
                  )}

                  {createError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
                      <p className="text-sm text-red-700 font-medium">{createError}</p>
                      {createErrorCode === 'ASSOCIATION_HORS_HORAIRES' && createErrorViolations.length > 0 && (
                        <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
                          {createErrorViolations.map((v, i) => (
                            <li key={i}>
                              <strong>{v.name}</strong> — prévu à {v.heure_prevue}, horaires du jour : {(v.plages || []).join(', ') || 'fermé'}
                              {v.prochain_creneau ? ` · premier créneau compatible : ${v.prochain_creneau}` : ' · aucun créneau compatible ce jour'}
                            </li>
                          ))}
                        </ul>
                      )}
                      {createErrorCode === 'RDV_NON_TENABLE' && createErrorViolations.length > 0 && (
                        <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
                          {createErrorViolations.map((v, i) => (
                            <li key={i}><strong>{v.name}</strong> — arrivée prévue {v.heure_prevue}, rendez-vous {v.fenetre}</li>
                          ))}
                        </ul>
                      )}
                      {createErrorCode === 'RDV_NON_TENABLE' && createErrorOrdreSuggere && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAssoPoints(createErrorOrdreSuggere);
                            setCreateError(null); setCreateErrorCode(null); setCreateErrorViolations([]); setCreateErrorOrdreSuggere(null);
                            setConfirmForce(false);
                          }}
                          className="text-xs font-semibold text-red-800 underline hover:text-red-900"
                        >
                          Appliquer l'ordre suggéré plutôt que forcer
                        </button>
                      )}
                      {FORCABLE_CODES.includes(createErrorCode) && (
                        <label className="flex items-start gap-2 text-xs text-red-700">
                          <input type="checkbox" checked={confirmForce} onChange={e => setConfirmForce(e.target.checked)} className="mt-0.5" />
                          Je confirme la création malgré {FORCE_LABELS[createErrorCode] || 'le refus signalé'}.
                        </label>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={goBack} className="flex-1 py-2.5 rounded-button bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors">Retour</button>
                    <button
                      onClick={() => generateTour(FORCABLE_CODES.includes(createErrorCode) ? confirmForce : false)}
                      disabled={generating || estimating || (FORCABLE_CODES.includes(createErrorCode) && !confirmForce)}
                      className={`flex-1 py-2.5 rounded-button text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${FORCABLE_CODES.includes(createErrorCode) ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
                    >
                      {generating ? 'Création…' : FORCABLE_CODES.includes(createErrorCode) ? 'Créer quand même' : 'Confirmer et créer la tournée'}
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
              <TourDetailPanel tour={selectedTour} onClose={() => setSelectedTour(null)} onRefresh={() => loadTourDetail(selectedTour.id)} />
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

// ── Temps de vidage mesuré, croisé au taux de remplissage ──────────────────
//
// Le module fait AJUSTER la durée d'arrêt à la main depuis la 2.38.0 (fiche du
// point, réglage global) sans qu'aucun écran n'ait jamais pu confronter ce
// réglage au terrain. Ce tableau est cette confrontation : pour chaque borne,
// le temps réellement passé sur place — mesuré sur la trace GPS — en face du
// niveau de remplissage relevé ce jour-là par le chauffeur.
//
// Une combinaison jamais observée est ABSENTE du tableau. Elle ne vaut pas
// zéro : « on n'a jamais mesuré cette borne pleine » et « cette borne pleine se
// vide en zéro minute » sont deux affirmations très différentes.
function TempsVidagePanel() {
  const [ouvert, setOuvert] = useState(false);
  const [mois, setMois] = useState(6);
  const [data, setData] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    if (!ouvert) return;
    let annule = false;
    setChargement(true); setErreur(null);
    api.get('/tours/analyse-gps/cav-durees', { params: { mois } })
      .then(({ data: d }) => { if (!annule) setData(d); })
      .catch((e) => { if (!annule) { setData(null); setErreur(e.response?.data?.error || 'Les temps de vidage n’ont pas pu être chargés.'); } })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [ouvert, mois]);

  // Une ligne par borne, une colonne par niveau relevé : c'est la lecture qui
  // sert à décider (« au-dessus de 3/5, il faut cinq minutes de plus »).
  const { bornes, niveaux } = useMemo(() => {
    const lignes = data?.lignes || [];
    const parBorne = new Map();
    const vus = new Set();
    for (const l of lignes) {
      if (!parBorne.has(l.cav_id)) parBorne.set(l.cav_id, { cav_id: l.cav_id, cav_nom: l.cav_nom, cases: new Map(), passages: 0 });
      const b = parBorne.get(l.cav_id);
      b.cases.set(l.fill_level == null ? 'nc' : l.fill_level, l);
      b.passages += l.nb_passages || 0;
      vus.add(l.fill_level == null ? 'nc' : l.fill_level);
    }
    const ordre = [...vus].sort((a, b) => {
      if (a === 'nc') return 1; if (b === 'nc') return -1; return a - b;
    });
    return { bornes: [...parBorne.values()], niveaux: ordre };
  }, [data]);

  return (
    <div className="mt-6 rounded-card bg-white border border-slate-200 shadow-card">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-teal-600" />
          <span className="font-bold text-slate-800">Temps de vidage mesuré par conteneur</span>
          <span className="text-xs text-slate-400 hidden sm:inline">
            — durée réelle des arrêts GPS, croisée au taux de remplissage relevé
          </span>
        </span>
        <span className="text-xs font-semibold text-teal-700">{ouvert ? 'Masquer' : 'Afficher'}</span>
      </button>

      {ouvert && (
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs font-medium text-slate-500">Période</label>
            <select
              value={mois}
              onChange={(e) => setMois(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1"
            >
              {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} mois</option>)}
            </select>
          </div>

          {erreur && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{erreur}</div>
          )}

          {chargement ? (
            <p className="text-xs text-slate-400 italic">Chargement des mesures…</p>
          ) : bornes.length === 0 ? (
            <p className="text-xs text-slate-400 italic">
              {data?.motif || 'Aucune mesure disponible sur la période.'}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2 px-2">Conteneur</th>
                      {niveaux.map((n) => (
                        <th key={n} className="text-right py-2 px-2">
                          {n === 'nc' ? 'Niveau non relevé' : `${n}/5`}
                        </th>
                      ))}
                      <th className="text-right py-2 px-2">Passages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bornes.map((b) => (
                      <tr key={b.cav_id} className="border-b border-slate-100">
                        <td className="py-1.5 px-2 text-slate-700">{b.cav_nom || `Conteneur #${b.cav_id}`}</td>
                        {niveaux.map((n) => {
                          const c = b.cases.get(n);
                          return (
                            <td key={n} className="py-1.5 px-2 text-right tabular-nums">
                              {c ? (
                                <span title={`${c.nb_passages} passage(s) · médiane ${fmtDur(c.duree_mediane_min)}`}>
                                  <span className="font-semibold text-slate-700">{fmtDur(c.duree_moyenne_min)}</span>
                                  <span className="text-slate-400 text-[10px] ml-1">×{c.nb_passages}</span>
                                </span>
                              ) : (
                                /* Case jamais observée : vide, jamais « 0 min ». */
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{b.passages}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                Durée moyenne d'immobilisation (médiane et nombre de passages au survol), mesurée sur les arrêts
                GPS figés à la clôture des tournées. Une case vide signifie qu'aucun passage n'a été mesuré à ce
                niveau de remplissage — ce n'est pas une durée nulle.
              </p>
              {/* Dire ce que ce tableau NE fait PAS. Sans cette phrase, un
                  lecteur pressé conclut que le moteur d'estimation est déjà
                  calé sur ces durées — alors qu'il lit toujours les temps de
                  collecte appris par proximité GPS, qui ignorent le taux de
                  remplissage. La mesure existe ; le réglage reste manuel. */}
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5 mt-1.5">
                <strong>Ces durées ne pilotent encore aucune estimation.</strong> Elles servent à régler à la main
                la durée d'arrêt (fiche du conteneur, ou Administration → Moteur prédictif) : le calcul des
                horaires prévisionnels continue de s'appuyer sur les temps de collecte appris, qui ne tiennent pas
                compte du taux de remplissage.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TourDetailPanel({ tour, onClose, onRefresh }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  // La reprise d'une journée close est réservée à l'administrateur : elle
  // touche des chiffres dont dérivent le tonnage, le stock et l'apprentissage.
  // Le rôle de base est consulté pour qu'un rôle personnalisé dupliqué d'ADMIN
  // en hérite, comme partout ailleurs dans l'application.
  const estAdmin = (user?.base_role || user?.role) === 'ADMIN';
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

  // Le rapport est assemblé par le SERVEUR (GET /tours/:id/rapport) : il croise
  // des données que cet écran n'a pas — trace GPS, messages échangés, check-list
  // de départ. On ne recompose donc rien ici, on imprime ce qu'il renvoie.
  const [pdfEnCours, setPdfEnCours] = useState(false);
  const [pdfErreur, setPdfErreur] = useState(null);

  // ── Questionnaires de collecte (ouverture du matin / fermeture du soir).
  // La MÊME réponse sert au PDF et à l'écran : elle est donc chargée une fois
  // et mémorisée. À LA DEMANDE, et jamais à l'ouverture du panneau : ce point
  // d'accès journalise la consultation (il réunit conducteur nommé et arrêts
  // géolocalisés) et rassemble une dizaine de tables — payer une trace RGPD et
  // une seconde de chargement pour une section que personne n'a demandée
  // serait le prix de rien.
  const [rapport, setRapport] = useState(null);
  const [rapportErreur, setRapportErreur] = useState(null);
  const [rapportChargement, setRapportChargement] = useState(false);
  const [questionnairesOuverts, setQuestionnairesOuverts] = useState(false);
  const rapportCache = useRef(null);

  // Bordereaux de collecte en déchèterie — même patron paresseux (repliable,
  // le composant partagé charge à l'ouverture). Le lien profond `/tours?tour=<id>`
  // (notification « bordereau à valider ») déplie directement la section.
  const [bordereauxOuverts, setBordereauxOuverts] = useState(
    () => String(searchParams.get('tour')) === String(tour.id)
  );
  const peutValiderBordereau = ['ADMIN', 'MANAGER'].includes(user?.base_role || user?.role);

  // Le panneau n'est pas démonté d'une tournée à l'autre : sans cette remise à
  // zéro, la fiche de la tournée suivante afficherait le rapport de la
  // précédente.
  useEffect(() => {
    rapportCache.current = null;
    setRapport(null);
    setRapportErreur(null);
    setQuestionnairesOuverts(false);
    setBordereauxOuverts(String(searchParams.get('tour')) === String(tour.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id]);

  const chargerRapport = useCallback(async () => {
    if (rapportCache.current) return rapportCache.current;
    setRapportChargement(true);
    try {
      const { data } = await api.get(`/tours/${tour.id}/rapport`);
      rapportCache.current = data;
      setRapport(data);
      return data;
    } finally {
      setRapportChargement(false);
    }
  }, [tour.id]);

  const basculerQuestionnaires = async () => {
    const ouvrir = !questionnairesOuverts;
    setQuestionnairesOuverts(ouvrir);
    if (!ouvrir || rapportCache.current) return;
    setRapportErreur(null);
    try {
      await chargerRapport();
    } catch (e) {
      setRapportErreur(e.response?.data?.error
        || "Les questionnaires n'ont pas pu être chargés. Réessayez dans un instant.");
    }
  };

  // ── Arrêts détectés sur la trace GPS.
  // Le programme dit ce qui était prévu, `collected_at` dit à quelle minute le
  // chauffeur a validé. Ni l'un ni l'autre ne dit COMBIEN DE TEMPS le camion est
  // resté sur place — la seule mesure qui permette d'ajuster le temps de vidage
  // au lieu de le deviner.
  const [arretsGps, setArretsGps] = useState(null);
  const [arretsErreur, setArretsErreur] = useState(null);
  const [recalculEnCours, setRecalculEnCours] = useState(false);

  const chargerArrets = useCallback(async () => {
    setArretsErreur(null);
    try {
      const { data } = await api.get(`/tours/${tour.id}/arrets-gps`);
      setArretsGps(data);
    } catch (e) {
      setArretsGps(null);
      setArretsErreur(e.response?.data?.error || "Les arrêts GPS n'ont pas pu être chargés.");
    }
  }, [tour.id]);

  useEffect(() => { chargerArrets(); }, [chargerArrets]);

  const recalculerArrets = async () => {
    setRecalculEnCours(true); setArretsErreur(null);
    try {
      await api.post(`/tours/${tour.id}/arrets-gps/recalcul`);
      await chargerArrets();
    } catch (e) {
      setArretsErreur(e.response?.data?.error || "Le recalcul des arrêts n'a pas abouti.");
    } finally {
      setRecalculEnCours(false);
    }
  };

  // Durée mesurée PAR POINT, pour l'afficher à côté du niveau de remplissage :
  // c'est le croisement qui rend le « temps de vidage selon le remplissage »
  // lisible sans quitter la fiche. Un point sans arrêt rattaché reste absent de
  // la table — il n'a pas une durée de zéro, il n'a pas de durée du tout.
  const dureeParPoint = useMemo(() => {
    const m = new Map();
    for (const a of (arretsGps?.arrets || [])) {
      const cle = a.cav_id != null ? `c${a.cav_id}` : (a.association_point_id != null ? `a${a.association_point_id}` : null);
      if (!cle || a.duree_min == null) continue;
      m.set(cle, (m.get(cle) || 0) + Number(a.duree_min));
    }
    return m;
  }, [arretsGps]);

  const dureeDuPoint = (p) => {
    const id = p.cav_id ?? p.association_point_id ?? p.ref_id ?? null;
    if (id == null) return null;
    return dureeParPoint.get(`c${id}`) ?? dureeParPoint.get(`a${id}`) ?? null;
  };

  const exporterPdf = async () => {
    setPdfEnCours(true); setPdfErreur(null);
    try {
      printRapportTournee(await chargerRapport());
    } catch (e) {
      setPdfErreur(e.response?.data?.error || 'Le rapport n’a pas pu être préparé. Réessayez dans un instant.');
    } finally {
      setPdfEnCours(false);
    }
  };

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
        <div className="flex items-center gap-2">
          {/* Rapport PDF d'une page : le gestionnaire garde une trace complète
              de la journée (détail des passages, écarts à l'horaire, itinéraire
              prévu et réalisé, événements, échanges) sans avoir à recomposer
              l'information depuis quatre écrans. */}
          <button
            onClick={exporterPdf}
            disabled={pdfEnCours}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-solidata-green text-solidata-green hover:bg-green-50 disabled:opacity-50 disabled:cursor-wait"
          >
            {pdfEnCours ? 'Préparation…' : 'Exporter en PDF'}
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none p-1 rounded-lg hover:bg-slate-100">&times;</button>
        </div>
      </div>
      {pdfErreur && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {pdfErreur}
        </div>
      )}

      {/* Résumé en 3 colonnes.
          Le statut affichait la valeur BRUTE de la base — « completed »,
          « in_progress » —, en anglais et sans couleur : le gestionnaire ne
          savait pas d'un coup d'œil si la tournée était allée à son terme ou
          avait été annulée. Il passe par le badge partagé (libellés et code
          couleur de utils/tours.js), le même que dans la liste. */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <SummaryTile label="Statut">
          <StatusBadge status={tour.status} type="tournee" size="sm" />
        </SummaryTile>
        <SummaryTile label="Mode">
          <StatusBadge status={tour.mode} size="sm" />
        </SummaryTile>
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
                  {/* Nombre de conteneurs présents sur le point : deux bornes
                      au même endroit, c'est deux fois le temps de vidage et
                      deux fois le volume — l'écran le taisait. */}
                  <th className="text-center py-1.5 px-2" title="Nombre de conteneurs installés sur ce point">Conteneurs</th>
                  <th className="text-right py-1.5 px-2">Prévu</th>
                  <th className="text-right py-1.5 px-2">Réel</th>
                  <th className="text-right py-1.5 px-2">Remplissage</th>
                  <th className="text-right py-1.5 px-2" title="Temps d'immobilisation mesuré sur la trace GPS">Sur place</th>
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
                      <p className="font-medium text-slate-700 flex items-center gap-1.5">
                        <span>{p.cav_name || p.name || p.nom}</span>
                        {/* Remballe : signalée SEULEMENT quand elle est
                            déclarée. Une icône grisée sur les points sans
                            remballe se lirait comme une donnée manquante,
                            alors que la réponse « non » est une réponse. */}
                        {p.remballe === true && (
                          <span
                            title={`Sacs de remballe déposés${p.nb_sacs != null ? ` — ${p.nb_sacs} sac(s)` : ''}`}
                            aria-label={`Sacs de remballe déposés${p.nb_sacs != null ? ` — ${p.nb_sacs} sac(s)` : ''}`}
                            className="inline-flex items-center gap-0.5 flex-shrink-0 text-teal-700 bg-teal-50 border border-teal-200 rounded px-1 py-0.5"
                          >
                            <ShoppingBag className="w-3 h-3" aria-hidden="true" />
                            {/* Le nombre de sacs n'existe que sur les points
                                association, et seulement s'il a été saisi. */}
                            {p.nb_sacs != null && <span className="text-[9px] font-bold tabular-nums">{p.nb_sacs}</span>}
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
                        {p.commune && <span>{p.commune}</span>}
                        {/* Accès au point sur la carte, comme pour les arrêts
                            GPS : Google Maps, et rien du tout sans coordonnées. */}
                        {lienCarteGps(p.latitude, p.longitude) && (
                          <a
                            href={lienCarteGps(p.latitude, p.longitude)}
                            target="_blank" rel="noopener noreferrer"
                            className="text-teal-600 hover:text-teal-700 hover:underline"
                            title="Ouvrir ce point dans Google Maps"
                          >
                            Carte
                          </a>
                        )}
                      </p>
                    </td>
                    {/* « — » et jamais 1 : un point association n'a pas de
                        conteneur, et une valeur inventée fausserait la lecture
                        du volume collecté. */}
                    <td className="py-1.5 px-2 text-center tabular-nums">
                      {p.nb_containers != null ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                          <Boxes className="w-3 h-3 text-slate-400" aria-hidden="true" />
                          {p.nb_containers}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
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
                        /* Le motif s'affichait en valeur brute, et « skipped »
                           en anglais quand il n'y en avait pas. */
                        <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold"
                          title={p.skip_reason ? `Motif : ${libelleMotifNonCollecte(p.skip_reason)}` : 'Aucun motif renseigné'}>
                          {libelleMotifNonCollecte(p.skip_reason) || 'Non collecté'}
                        </span>
                      ) : p.fill_level != null ? (
                        <span className="font-semibold">{p.fill_level}/5</span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    {/* Durée d'immobilisation mesurée. « — » quand aucun arrêt
                        n'a été rattaché : le camion s'y est peut-être arrêté
                        moins longtemps que le seuil de détection, ou n'a pas
                        émis. Ce n'est pas zéro minute. */}
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {dureeDuPoint(p) != null
                        ? <span className="font-semibold text-slate-700">{fmtDur(dureeDuPoint(p))}</span>
                        : <span className="text-slate-400">—</span>}
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

      {/* Reprise d'une tournée TERMINÉE (ADMIN) : pesée oubliée, volume déclaré
          de travers. Absente des tournées en cours, qui se corrigent depuis
          « Collecte en direct » tant que la journée n'est pas close. */}
      {estAdmin && tour.status === 'completed' && (
        <TourRepriseAdmin tourId={tour.id} tourDate={tour.date} onChanged={onRefresh} />
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

      {/* Bordereaux déchèterie — collecte sur un point marqué déchèterie de la
          Métropole (bordereau papier remplacé par un PDF signé par l'agent de
          la déchèterie ET le chauffeur). Repliable, chargé à l'ouverture par
          le composant partagé (même patron que les Questionnaires ci-dessous). */}
      <div className="mb-4 rounded-lg border border-slate-200">
        <button
          type="button"
          onClick={() => setBordereauxOuverts((o) => !o)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Recycle className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Bordereaux déchèterie
            </span>
          </span>
          <span className="text-[11px] font-semibold text-teal-700 flex-shrink-0">
            {bordereauxOuverts ? 'Masquer' : 'Afficher'}
          </span>
        </button>

        {bordereauxOuverts && (
          <div className="px-3 pb-3">
            <BordereauxDecheterie
              endpoint={`/tours/${tour.id}/bordereaux`}
              peutValider={peutValiderBordereau}
              onValide={onRefresh}
              titre="cette tournée"
            />
          </div>
        )}
      </div>

      {/* Questionnaires de collecte — ce que l'équipage a déclaré en ouvrant
          et en fermant sa journée. Les deux existaient en base sans qu'aucun
          écran de gestion ne les montre : un camion parti avec un feu cassé
          produisait la même fiche qu'un camion irréprochable. */}
      <div className="mb-4 rounded-lg border border-slate-200">
        <button
          type="button"
          onClick={basculerQuestionnaires}
          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 min-w-0">
            <ClipboardCheck className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Questionnaires de collecte
            </span>
            <span className="text-[10px] text-slate-400 normal-case hidden sm:inline truncate">
              — ouverture et fermeture de la journée
            </span>
          </span>
          <span className="text-[11px] font-semibold text-teal-700 flex-shrink-0">
            {questionnairesOuverts ? 'Masquer' : 'Afficher'}
          </span>
        </button>

        {questionnairesOuverts && (
          <div className="px-3 pb-3 space-y-3">
            {rapportErreur && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {rapportErreur}
              </div>
            )}
            {rapportChargement && !rapport && (
              <p className="text-xs text-slate-400 italic">Chargement des questionnaires…</p>
            )}
            {rapport && (
              <>
                <QuestionnaireOuverture checklist={rapport.checklist} />
                <QuestionnaireFermeture fin={rapport.end_of_day} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Arrêts détectés sur la trace GPS */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Navigation className="w-3.5 h-3.5" />
            Arrêts détectés (GPS)
            {arretsGps?.seuil_min != null && (
              <span className="normal-case font-normal text-slate-400">
                — immobilisations de {arretsGps.seuil_min} min ou plus
              </span>
            )}
          </h3>
          {tour.status === 'completed' && (
            <button
              onClick={recalculerArrets}
              disabled={recalculEnCours}
              className="text-[11px] font-semibold px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-wait"
            >
              {recalculEnCours ? 'Recalcul…' : 'Recalculer'}
            </button>
          )}
        </div>

        {arretsErreur && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {arretsErreur}
          </div>
        )}

        {!arretsGps ? (
          !arretsErreur && <p className="text-xs text-slate-400 italic">Chargement des arrêts…</p>
        ) : arretsGps.arrets.length === 0 ? (
          /* Motif explicite plutôt qu'une liste vide : « aucun arrêt » et
             « aucun relevé GPS » ne veulent pas dire la même chose. */
          <p className="text-xs text-slate-400 italic">
            {arretsGps.motif || 'Aucun arrêt de cette durée détecté sur la trace GPS.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-1.5 px-2">Début</th>
                    <th className="text-right py-1.5 px-2">Durée</th>
                    <th className="text-left py-1.5 px-2">Lieu</th>
                    <th className="text-left py-1.5 px-2">Carte</th>
                  </tr>
                </thead>
                <tbody>
                  {arretsGps.arrets.map((a, i) => (
                    <tr key={`${a.debut}-${i}`} className="border-b border-slate-100">
                      <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap">{fmtTime(a.debut)}</td>
                      <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{fmtDur(a.duree_min)}</td>
                      <td className="py-1.5 px-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase mr-1.5 ${
                          ARRET_TYPE_STYLE[a.type] || ARRET_TYPE_STYLE.inconnu}`}>
                          {ARRET_TYPE_LABELS[a.type] || a.type}
                        </span>
                        <span className="text-slate-700">{a.cav_nom || a.association_nom || ''}</span>
                      </td>
                      {/* Google Maps (demande client 27/08/2026) : c'est
                          l'outil que les chauffeurs utilisent déjà pour
                          naviguer, et le gestionnaire y retrouve la vue
                          satellite. Le lien est `null` — donc « — » — quand
                          les coordonnées manquent : au point 0,0 il n'y a
                          rien à voir. Les FONDS de carte de l'application ne
                          changent pas. */}
                      <td className="py-1.5 px-2">
                        {lienCarteGps(a.latitude, a.longitude) ? (
                          <a
                            href={lienCarteGps(a.latitude, a.longitude)}
                            target="_blank" rel="noopener noreferrer"
                            className="text-teal-600 hover:text-teal-700 hover:underline"
                            title="Ouvrir ce point dans Google Maps"
                          >
                            Voir
                          </a>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              {/* La provenance change ce que le chiffre vaut : une tournée en
                  cours voit ses arrêts recalculés à chaque ouverture, et le
                  dernier n'a pas encore de fin. */}
              {arretsGps.source === 'live'
                ? 'Tournée non clôturée : arrêts recalculés à l’instant, non figés en base.'
                : 'Arrêts figés à la clôture de la tournée.'}
              {arretsGps.arrets.some((a) => a.type === 'inconnu')
                && ' Les arrêts « non identifiés » ne correspondent à aucun point du programme.'}
            </p>
          </>
        )}
      </div>

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
                  <span className="font-semibold text-red-800">{libelleTypeIncident(inc.type)}</span>
                  <span className="text-[10px] text-red-500">{fmtTime(inc.created_at)}</span>
                </div>
                {inc.description && <p className="text-slate-600 mt-1">{inc.description}</p>}
                <p className="text-[10px] text-slate-400 mt-1">Statut : {libelleStatutIncident(inc.status)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Questionnaires de collecte ─────────────────────────────────────────────
//
// Deux questionnaires encadrent la journée : la vérification du camion au
// départ, et la déclaration de fin de journée au retour. Chaque bloc DÉGRADE
// SEUL en nommant son absence : « aucune checklist enregistrée » n'est pas
// « rien à signaler », et présenter un bloc vide reviendrait à dire le second
// en montrant le premier.

/** Cadre commun aux deux questionnaires. */
function BlocQuestionnaire({ titre, heure, auteur, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <h4 className="text-[11px] font-bold text-slate-700">{titre}</h4>
        {heure && (
          <span className="text-[10px] text-slate-400 flex-shrink-0">
            {heure}{auteur ? ` · ${auteur}` : ''}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Vérification du camion, au matin (`vehicle_checklists`). */
function QuestionnaireOuverture({ checklist }) {
  if (!checklist) {
    return (
      <BlocQuestionnaire titre="Ouverture — vérification du camion">
        <p className="text-xs text-slate-500 italic">
          Aucune checklist du matin enregistrée pour cette tournée.
        </p>
      </BlocQuestionnaire>
    );
  }
  const nonValides = checklist.points_non_valides || [];
  const degats = checklist.degats || [];
  return (
    <BlocQuestionnaire
      titre="Ouverture — vérification du camion"
      heure={`Terminée à ${fmtTime(checklist.terminee_a || checklist.created_at)}`}
      auteur={checklist.employee_name}
    >
      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <div>
          <span className="text-slate-500 text-[10px] uppercase">Carburant</span>
          <p className="font-semibold text-slate-700">{checklist.fuel_level || '—'}</p>
        </div>
        <div>
          <span className="text-slate-500 text-[10px] uppercase">Km au départ</span>
          <p className="font-semibold text-slate-700">
            {checklist.km_start != null ? `${Number(checklist.km_start).toLocaleString('fr-FR')} km` : '—'}
          </p>
        </div>
      </div>

      {/* Une checklist d'avant août 2026 ne conserve que son booléen global :
          dire « aucun défaut » serait affirmer ce qu'on ignore. */}
      {checklist.detail_disponible !== true ? (
        <p className="text-xs text-slate-500 italic">
          Détail du questionnaire non conservé par la version de l'application utilisée ce jour-là —
          ce n'est pas « rien à signaler ».
        </p>
      ) : nonValides.length === 0 ? (
        <p className="text-xs text-emerald-700">
          {checklist.points_verifies} point{checklist.points_verifies > 1 ? 's' : ''} vérifié
          {checklist.points_verifies > 1 ? 's' : ''}, aucun défaut signalé.
        </p>
      ) : (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2">
          <p className="text-xs font-semibold text-amber-800 mb-1">
            {nonValides.length} point{nonValides.length > 1 ? 's' : ''} NON validé
            {nonValides.length > 1 ? 's' : ''} sur {checklist.points_verifies}
          </p>
          <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5">
            {nonValides.map((p, i) => <li key={p.id || i}>{p.libelle || p.id}</li>)}
          </ul>
        </div>
      )}

      {degats.length > 0 && (
        <p className="text-xs text-red-700 mt-2">
          <span className="font-semibold">{degats.length} dégât{degats.length > 1 ? 's' : ''} relevé
          {degats.length > 1 ? 's' : ''}</span>
          {' : '}
          {degats.map((d) => `${d.type || 'autre'} (${d.vue || 'vue non précisée'})`).join(', ')}
        </p>
      )}
      {checklist.notes && (
        <p className="text-xs text-slate-600 mt-2">
          <span className="text-slate-500">Remarque : </span>{checklist.notes}
        </p>
      )}
    </BlocQuestionnaire>
  );
}

// Les six déclarations de fin de journée, dans l'ordre et avec les mots de
// l'écran chauffeur (mobile/src/pages/EndOfDayChecklist.jsx) : le gestionnaire
// doit relire ce que l'équipage a réellement coché, pas une reformulation.
const DECLARATIONS_FIN = [
  ['chauffeur_non_fume', 'Chauffeur — n’a pas fumé dans le véhicule'],
  ['chauffeur_pas_objet_personnel', 'Chauffeur — n’a laissé aucun objet personnel'],
  ['suiveur_non_fume', 'Suiveur — n’a pas fumé dans le véhicule'],
  ['suiveur_pas_objet_personnel', 'Suiveur — n’a laissé aucun objet personnel'],
  ['binome_vehicule_vide', 'Binôme — le véhicule est vide'],
  ['binome_vehicule_ok', 'Binôme — véhicule en bon état, ou défauts déclarés'],
];

/** Déclaration de fin de journée (`tour_end_of_day_declarations`). */
function QuestionnaireFermeture({ fin }) {
  if (!fin) {
    return (
      <BlocQuestionnaire titre="Fermeture — déclaration de fin de journée">
        <p className="text-xs text-slate-500 italic">
          Aucune déclaration de fin de journée enregistrée pour cette tournée.
        </p>
      </BlocQuestionnaire>
    );
  }
  return (
    <BlocQuestionnaire
      titre="Fermeture — déclaration de fin de journée"
      heure={`Déclarée à ${fmtTime(fin.created_at)}`}
      auteur={fin.employee_name}
    >
      <ul className="text-xs space-y-0.5">
        {DECLARATIONS_FIN.map(([cle, libelle]) => {
          const coche = fin[cle] === true;
          return (
            <li key={cle} className="flex items-start gap-1.5">
              <span className={coche ? 'text-emerald-600' : 'text-amber-600'} aria-hidden="true">
                {coche ? '✓' : '✗'}
              </span>
              <span className={coche ? 'text-slate-600' : 'text-amber-700 font-medium'}>
                {libelle}{coche ? '' : ' — non coché'}
              </span>
            </li>
          );
        })}
      </ul>
      {fin.remarques && (
        <p className="text-xs text-slate-600 mt-2">
          <span className="text-slate-500">Remarque : </span>{fin.remarques}
        </p>
      )}
    </BlocQuestionnaire>
  );
}

/** `children` l'emporte sur `value` : les statuts y logent un badge coloré. */
function SummaryTile({ label, value, children }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 text-center">
      <p className="text-[10px] text-slate-500 uppercase">{label}</p>
      {children
        ? <div className="mt-1 flex justify-center">{children}</div>
        : <p className="text-sm font-semibold text-slate-700 mt-0.5">{value || '—'}</p>}
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
