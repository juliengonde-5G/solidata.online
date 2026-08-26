import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Map, ListChecks, X, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import CavPicker from './CavPicker';
import EstimationPanel from './EstimationPanel';

// ─── Création d'une tournée depuis le planning ─────────────────────────────
// Répond à la demande client : « il manque dans la planification le choix de
// la tournée par journée de travail (moteur IA, manuel ou choix d'un
// prédéfini) ». La modal crée une tournée pour LA DATE AFFICHÉE du planning,
// avec le mode choisi par tournée. Chauffeur facultatif ici ; chauffeur et
// suiveurs s'affinent ensuite par glisser-déposer sur le planning.
const MODES = [
  {
    key: 'intelligent', icon: Sparkles, title: 'Moteur IA',
    desc: 'Le moteur choisit les bornes prioritaires (saturation, remplissage prédit) sous 6 h de travail.',
  },
  {
    key: 'standard', icon: Map, title: 'Modèle prédéfini',
    desc: 'Affecter une tournée préétablie (liste ordonnée de bornes gérée dans « Modèles de tournées »).',
  },
  {
    key: 'manual', icon: ListChecks, title: 'Manuelle',
    desc: 'Composer la liste des bornes une à une, dans l\'ordre de collecte.',
  },
];

// Codes de refus 409 forçables à la création (mêmes règles que le dépassement
// de durée historique — chantier tournées associations, 26/08/2026).
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
function fmtElapsedAsClock(heureDepart, elapsedMin) {
  if (!heureDepart || elapsedMin == null || Number.isNaN(elapsedMin)) return '—';
  const parts = String(heureDepart).split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return '—';
  return fmtClockMin(parts[0] * 60 + parts[1] + Math.round(elapsedMin));
}

// Avertissements d'horaires/rendez-vous de l'estimation LIVE, affichés AVANT
// toute soumission (le refus 409 doit être l'exception, pas la découverte).
function ViolationsPanel({ estimation, onApplyOrder }) {
  const violations = estimation?.violations;
  const ordreSuggere = estimation?.ordre_suggere;
  const hasOrdre = Array.isArray(ordreSuggere) && ordreSuggere.length > 0;
  if ((!violations || violations.length === 0) && !hasOrdre) return null;
  const heureDepart = estimation?.heure_depart;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      {violations?.length > 0 && (
        <>
          <p className="text-xs font-bold text-amber-800 mb-1.5 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {violations.length} avertissement{violations.length > 1 ? 's' : ''} d'horaires
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

// Liste des points d'un MODÈLE association chargé, avec durée d'arrêt
// ajustable par point (RG-C2/C3) — la fiche de chaque point n'étant pas
// exposée par cet endpoint, seule la distinction « ajustée / automatique »
// est affichable ici (jamais de valeur de repli devinée).
function AssoTemplatePoints({ points, durations, onDurationChange }) {
  return (
    <div className="bg-slate-50 rounded-lg divide-y divide-slate-200 max-h-40 overflow-y-auto">
      {points.map((p, i) => (
        <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[10px] grid place-items-center flex-shrink-0">{i + 1}</span>
          <span className="flex-1 min-w-0 truncate text-slate-700">{p.name}</span>
          <input
            type="number" min="1" max="480"
            value={durations?.[p.id] ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const min = raw === '' ? null : Math.min(480, Math.max(1, Math.round(Number(raw)) || 1));
              onDurationChange(p.id, min);
            }}
            placeholder="auto"
            aria-label={`Durée d'arrêt pour ${p.name}`}
            className="w-14 text-[11px] border border-slate-200 rounded px-1.5 py-0.5 text-center"
          />
          <span className="text-[10px] text-slate-400">min</span>
        </div>
      ))}
    </div>
  );
}

export default function CreateTourModal({ date, vehicles, drivers, onClose, onCreated, prefill }) {
  const [mode, setMode] = useState(prefill ? 'manual' : 'intelligent');
  // Sous-mode du mode « manuel » : bornes (CAV) ou associations (RG-C2, et
  // demande client de préremplissage depuis une demande de collecte).
  const [manualCollectionType, setManualCollectionType] = useState(prefill ? 'association' : 'cav');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [routes, setRoutes] = useState([]);
  // Les modèles association vivent dans un endpoint SÉPARÉ : le sélecteur n'en
  // chargeait qu'une famille, et les tournées association étaient donc
  // introuvables depuis « Modèle prédéfini ».
  const [routesAsso, setRoutesAsso] = useState([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);
  const [routesError, setRoutesError] = useState(null);
  const [standardRouteId, setStandardRouteId] = useState('');
  const [routePreview, setRoutePreview] = useState(null);
  // Points du modèle association choisi : la création et l'estimation les
  // exigent explicitement (un modèle association ne se résume pas à son id).
  const [assoPoints, setAssoPoints] = useState([]);
  // Durée d'arrêt ajustable par point (RG-C2/C3) : { [pointId]: minutes|null }.
  // `modelDurations` pour un modèle association chargé, `assoDurations` pour
  // la sélection manuelle d'associations (préremplie par CavPicker).
  const [modelDurations, setModelDurations] = useState({});
  const [assoDurations, setAssoDurations] = useState({});
  const [cavIds, setCavIds] = useState(prefill?.associationPointId ? [prefill.associationPointId] : []);
  const [estimation, setEstimation] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [overrun, setOverrun] = useState(null); // estimation du refus 409
  const [overrunCode, setOverrunCode] = useState(null);
  const [overrunViolations, setOverrunViolations] = useState([]);
  const [overrunOrdreSuggere, setOverrunOrdreSuggere] = useState(null);
  const [forceChecked, setForceChecked] = useState(false);
  const [iaResult, setIaResult] = useState(null); // résultat après création IA
  const debounceRef = useRef(null);

  // Demande(s) de collecte rattachées à cette création (RG-B2/B3) — l'unique
  // demande d'origine quand la modale est ouverte depuis le panneau « Demandes
  // de collecte » du planning.
  const attachedDemandeIds = prefill?.demandeId ? [prefill.demandeId] : [];

  const freeVehicles = (vehicles || []).filter(v => !v.assigned_tour_id && v.status !== 'maintenance');
  const freeDrivers = (drivers || []).filter(d => !d.assigned_tour_id && !d.is_day_off);

  // Modèles de tournées (mode standard) — les DEUX familles : collecte de
  // bornes et collecte d'associations.
  useEffect(() => {
    if (mode !== 'standard' || routesLoaded) return;
    setRoutesLoaded(true);
    Promise.all([
      api.get('/tours/routes/list').catch(() => ({ data: [] })),
      api.get('/tours/association-routes/list').catch(() => ({ data: [] })),
    ]).then(([cav, asso]) => {
      const listeCav = Array.isArray(cav.data) ? cav.data : [];
      const listeAsso = Array.isArray(asso.data) ? asso.data : [];
      setRoutes(listeCav);
      setRoutesAsso(listeAsso);
      if (listeCav.length === 0 && listeAsso.length === 0) {
        setRoutesError(null); // liste vide ≠ erreur : le message dédié s'affiche
      }
    }).catch(() => setRoutesError('Impossible de charger les modèles de tournées'));
  }, [mode, routesLoaded]);

  // Type du modèle sélectionné — déduit des listes, jamais supposé.
  const modeleAssocie = routesAsso.some(r => String(r.id) === String(standardRouteId));

  // Aperçu de la composition du modèle choisi
  useEffect(() => {
    if (mode !== 'standard' || !standardRouteId) {
      setRoutePreview(null); setAssoPoints([]); setModelDurations({}); return undefined;
    }
    let cancelled = false;
    setModelDurations({});
    if (modeleAssocie) {
      api.get(`/tours/association-routes/${standardRouteId}/points`)
        .then(res => {
          if (cancelled) return;
          const pts = Array.isArray(res.data) ? res.data : [];
          setAssoPoints(pts);
          setRoutePreview({ cavs: pts.map(p => ({ cav_id: p.id, name: p.name })) });
        })
        .catch(() => { if (!cancelled) { setAssoPoints([]); setRoutePreview(null); } });
    } else {
      setAssoPoints([]);
      api.get(`/tours/routes/${standardRouteId}`)
        .then(res => { if (!cancelled) setRoutePreview(res.data); })
        .catch(() => { if (!cancelled) setRoutePreview(null); });
    }
    return () => { cancelled = true; };
  }, [mode, standardRouteId, modeleAssocie]);

  // Estimation (modèle : immédiate ; manuel : debounce 600 ms)
  const runEstimate = useCallback(async (payload) => {
    setEstimating(true);
    setEstimateError(null);
    try {
      const res = await api.post('/tours/estimate', payload, { timeout: 120000 });
      setEstimation(res.data.estimation);
      return res.data.estimation;
    } catch (err) {
      setEstimation(null);
      setEstimateError(err.response?.data?.error || 'Estimation impossible');
      return null;
    } finally {
      setEstimating(false);
    }
  }, []);

  useEffect(() => {
    setEstimation(null); setEstimateError(null); setOverrun(null); setForceChecked(false);
    setOverrunCode(null); setOverrunViolations([]); setOverrunOrdreSuggere(null);
    if (!vehicleId) return;
    if (mode === 'standard' && standardRouteId) {
      // `standard_route_id` charge des points CAV côté serveur : pour un modèle
      // association, il faut envoyer les points eux-mêmes (avec leur durée
      // éventuellement ajustée), sinon l'estimation porterait sur une liste vide.
      if (modeleAssocie) {
        if (assoPoints.length > 0) {
          runEstimate({
            date,
            vehicle_id: parseInt(vehicleId, 10),
            association_points: assoPoints.map(p => ({ id: p.id, duree_min: modelDurations[p.id] ?? null })),
          });
        }
        return undefined;
      }
      runEstimate({ date, vehicle_id: parseInt(vehicleId, 10), standard_route_id: parseInt(standardRouteId, 10) });
    } else if (mode === 'manual' && cavIds.length > 0) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const payload = { date, vehicle_id: parseInt(vehicleId, 10) };
        if (manualCollectionType === 'association') {
          payload.association_points = cavIds.map(id => ({ id, duree_min: assoDurations[id] ?? null }));
          if (attachedDemandeIds.length) payload.demande_ids = attachedDemandeIds;
        } else {
          payload.cav_ids = cavIds;
        }
        runEstimate(payload);
      }, 600);
      return () => clearTimeout(debounceRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vehicleId, standardRouteId, cavIds, date, runEstimate, modeleAssocie, assoPoints, modelDurations, manualCollectionType, assoDurations]);

  const optimizeOrder = async () => {
    if (!vehicleId || cavIds.length < 2) return;
    setOptimizing(true);
    try {
      const res = await api.post('/tours/estimate', {
        date, vehicle_id: parseInt(vehicleId, 10), cav_ids: cavIds, optimize: true,
      }, { timeout: 120000 });
      if (Array.isArray(res.data.estimation?.ordre_optimise) && res.data.estimation.ordre_optimise.length > 0) {
        setCavIds(res.data.estimation.ordre_optimise);
        setEstimation(res.data.estimation);
      }
    } catch (err) {
      setEstimateError(err.response?.data?.error || 'Optimisation impossible');
    } finally {
      setOptimizing(false);
    }
  };

  const canCreate = !!vehicleId && !creating && (
    mode === 'intelligent'
    || (mode === 'standard' && !!standardRouteId && (!modeleAssocie || assoPoints.length > 0))
    || (mode === 'manual' && cavIds.length > 0)
  );

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    setOverrunCode(null); setOverrunViolations([]); setOverrunOrdreSuggere(null);
    try {
      const body = { date, vehicle_id: parseInt(vehicleId, 10) };
      if (driverId) body.driver_employee_id = parseInt(driverId, 10);
      if (mode === 'standard') body.standard_route_id = parseInt(standardRouteId, 10);
      if (mode === 'manual' && manualCollectionType !== 'association') body.cav_ids = cavIds;
      if (forceChecked) body.force = true;

      // Un modèle association OU une sélection manuelle d'associations créent
      // une tournée ASSOCIATION : autre endpoint, liste ordonnée de points
      // (avec durée ajustée) exigée par le contrat.
      let chemin = mode;
      if (mode === 'standard' && modeleAssocie) {
        chemin = 'association';
        body.points = assoPoints.map(p => ({ id: p.id, duree_min: modelDurations[p.id] ?? null }));
      } else if (mode === 'manual' && manualCollectionType === 'association') {
        chemin = 'association';
        body.points = cavIds.map(id => ({ id, duree_min: assoDurations[id] ?? null }));
        if (attachedDemandeIds.length) body.demande_ids = attachedDemandeIds;
      }

      const res = await api.post(`/tours/${chemin}`, body, { timeout: 120000 });
      if (mode === 'intelligent') {
        // On garde la modal ouverte pour montrer ce que le moteur a décidé.
        setIaResult(res.data);
        onCreated?.();
      } else {
        onCreated?.();
        onClose?.();
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.code && FORCABLE_CODES.includes(data.code)) {
        setOverrun(data.estimation || null);
        setOverrunCode(data.code);
        setOverrunViolations(Array.isArray(data.violations) ? data.violations : []);
        setOverrunOrdreSuggere(Array.isArray(data.ordre_suggere) ? data.ordre_suggere : null);
        setEstimation(data.estimation || null);
        setError(data.error || `Création refusée — ${FORCE_LABELS[data.code] || 'confirmation nécessaire'}.`);
      } else {
        setError(data?.error || 'Erreur lors de la création de la tournée');
      }
    } finally {
      setCreating(false);
    }
  };

  const fmtDate = new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-6">
        {/* En-tête */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Créer une tournée</h3>
            <p className="text-xs text-slate-400 capitalize">{fmtDate}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Résultat IA : la tournée est créée, on montre ce que le moteur a décidé */}
        {iaResult ? (
          <div className="p-5 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
              Tournée #{iaResult.tour?.id} créée par le moteur IA
              {iaResult.tour?.nb_cav != null ? ` — ${iaResult.tour.nb_cav} bornes` : ''}.
              Chauffeur et suiveurs s'affectent maintenant par glisser-déposer sur le planning.
            </div>
            {iaResult.saturation_non_couverte?.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <p className="font-semibold mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {iaResult.saturation_non_couverte.length} borne(s) saturée(s) non couverte(s) par cette tournée
                </p>
                <p>{iaResult.saturation_non_couverte.map(c => c.name).join(' · ')} — planifiez une rotation complémentaire.</p>
              </div>
            )}
            {iaResult.estimation && <EstimationPanel estimation={iaResult.estimation} />}
            <div className="flex justify-end">
              <button onClick={onClose} className="btn-primary text-sm px-4 py-2">Fermer</button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* 1. Le mode — le choix demandé par le client, tournée par tournée */}
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase mb-2">Mode de planification</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {MODES.map(m => {
                  const Icon = m.icon;
                  const active = mode === m.key;
                  return (
                    <button
                      key={m.key}
                      onClick={() => { setMode(m.key); setError(null); setOverrun(null); setOverrunCode(null); setOverrunViolations([]); setOverrunOrdreSuggere(null); setForceChecked(false); }}
                      className={`text-left p-3 rounded-xl border-2 transition ${
                        active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={`w-4 h-4 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                        <span className="text-sm font-semibold text-slate-800">{m.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">{m.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Véhicule + chauffeur */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Véhicule *</label>
                {freeVehicles.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-2">
                    Tous les véhicules sont déjà affectés ce jour.
                  </p>
                ) : (
                  <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} className="input-modern text-sm">
                    <option value="">— Choisir un véhicule —</option>
                    {freeVehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.registration}{v.name ? ` · ${v.name}` : ''}{v.max_capacity_kg ? ` · ${Math.round(v.max_capacity_kg)} kg` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Chauffeur (facultatif)</label>
                {/* Équipes Collecte/Logistique d'abord ; les autres restent
                    sélectionnables (renfort exceptionnel) dans un groupe à part. */}
                <select value={driverId} onChange={e => setDriverId(e.target.value)} className="input-modern text-sm">
                  <option value="">— À affecter plus tard —</option>
                  {freeDrivers.filter(d => d.is_equipe_collecte).map(d => (
                    <option key={d.id} value={d.id}>{d.first_name} {d.last_name}</option>
                  ))}
                  {freeDrivers.some(d => !d.is_equipe_collecte) && (
                    <optgroup label="Autres équipes — renfort exceptionnel">
                      {freeDrivers.filter(d => !d.is_equipe_collecte).map(d => (
                        <option key={d.id} value={d.id}>
                          {d.first_name} {d.last_name}{d.team_name ? ` (${d.team_name})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">Les suiveurs s'affectent par glisser-déposer après création.</p>
              </div>
            </div>

            {/* 3. Contenu selon le mode */}
            {mode === 'standard' && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-500">Modèle de tournée *</label>
                {routesError && <p className="text-xs text-red-600">{routesError}</p>}
                {/* Deux familles de modèles, regroupées explicitement : sans
                    cela, on ne pouvait pas distinguer une tournée de bornes
                    d'une tournée d'associations — et les secondes étaient tout
                    simplement absentes du sélecteur. */}
                <select value={standardRouteId} onChange={e => setStandardRouteId(e.target.value)} className="input-modern text-sm">
                  <option value="">— Choisir un modèle —</option>
                  {routes.length > 0 && (
                    <optgroup label="Collecte de bornes">
                      {routes.map(r => (
                        <option key={`cav-${r.id}`} value={r.id}>
                          {r.name} · {r.cav_count} bornes{r.estimated_duration_minutes ? ` · ~${r.estimated_duration_minutes} min` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {routesAsso.length > 0 && (
                    <optgroup label="Collecte d'associations">
                      {routesAsso.map(r => (
                        <option key={`asso-${r.id}`} value={r.id}>
                          {r.name} · {r.point_count} points{r.estimated_duration_minutes ? ` · ~${r.estimated_duration_minutes} min` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {modeleAssocie && (
                  <p className="text-[11px] text-indigo-600">
                    Ce modèle crée une tournée <strong>association</strong>.
                  </p>
                )}
                {routes.length === 0 && routesAsso.length === 0 && routesLoaded && !routesError && (
                  <p className="text-xs text-slate-400">Aucun modèle actif — créez-en dans « Modèles de tournées ».</p>
                )}
                {routePreview?.cavs?.length > 0 && (
                  modeleAssocie ? (
                    <AssoTemplatePoints
                      points={assoPoints}
                      durations={modelDurations}
                      onDurationChange={(id, min) => setModelDurations(prev => ({ ...prev, [id]: min }))}
                    />
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-2 text-[11px] text-slate-600 max-h-28 overflow-y-auto">
                      {routePreview.cavs.map((c, i) => (
                        <span key={c.cav_id}>{i + 1}. {c.name}{i < routePreview.cavs.length - 1 ? ' → ' : ''}</span>
                      ))}
                    </div>
                  )
                )}
                {modeleAssocie && <ViolationsPanel estimation={estimation} />}
              </div>
            )}

            {mode === 'manual' && (
              <div>
                {/* Type de collecte du mode manuel — masqué quand la modale est
                    préremplie depuis une demande de collecte : le point et son
                    rendez-vous restent attachés à cette création. */}
                {!prefill && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-medium text-slate-500 uppercase">Type</span>
                    <div className="flex gap-1.5">
                      {[
                        { key: 'cav', label: 'Bornes (CAV)' },
                        { key: 'association', label: 'Associations' },
                      ].map(ct => (
                        <button
                          key={ct.key}
                          type="button"
                          onClick={() => { setManualCollectionType(ct.key); setCavIds([]); setEstimation(null); }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                            manualCollectionType === ct.key ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                          }`}
                        >
                          {ct.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {prefill && (
                  <div className="mb-2 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-800">
                    Tournée pré-remplie depuis la demande de collecte de <strong>{prefill.associationPointName}</strong>
                    {prefill.heureLabel ? ` — rendez-vous ${prefill.heureLabel}` : ''}. Ajoutez d'autres points si besoin.
                  </div>
                )}
                <p className="text-xs font-medium text-slate-500 uppercase mb-2">
                  {manualCollectionType === 'association' ? "Associations à collecter (dans l'ordre) *" : "Bornes à collecter (dans l'ordre) *"}
                </p>
                <CavPicker
                  value={cavIds}
                  onChange={setCavIds}
                  mode={manualCollectionType}
                  onOptimize={manualCollectionType === 'cav' ? optimizeOrder : undefined}
                  optimizing={optimizing}
                  estimation={estimation}
                  estimating={estimating}
                  estimationHint={!vehicleId ? 'Choisissez un véhicule pour calculer la durée prévisionnelle.' : null}
                  durations={manualCollectionType === 'association' ? assoDurations : undefined}
                  onDurationChange={manualCollectionType === 'association' ? (id, min) => setAssoDurations(prev => ({ ...prev, [id]: min })) : undefined}
                />
                {manualCollectionType === 'association' && (
                  <ViolationsPanel estimation={estimation} onApplyOrder={(ids) => setCavIds(ids)} />
                )}
              </div>
            )}

            {mode === 'intelligent' && (
              <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600">
                Le moteur sélectionne les bornes selon le remplissage prédit, priorise celles proches de la
                saturation, et respecte le budget de 6 h de travail (pause déjeuner au centre non comptée,
                retours de vidage comptés). L'estimation détaillée s'affiche après génération.
              </div>
            )}

            {/* 4. Estimation (modèle / manuel) */}
            {(mode === 'standard' || mode === 'manual') && (estimation || estimating || estimateError) && (
              <EstimationPanel estimation={estimation} loading={estimating} error={estimateError} />
            )}

            {/* Erreurs + confirmation de dépassement / horaires / rendez-vous */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 space-y-1.5">
                <p>{error}</p>
                {overrunCode === 'ASSOCIATION_HORS_HORAIRES' && overrunViolations.length > 0 && (
                  <ul className="space-y-1 list-disc list-inside">
                    {overrunViolations.map((v, i) => (
                      <li key={i}>
                        <strong>{v.name}</strong> — prévu à {v.heure_prevue}, horaires du jour : {(v.plages || []).join(', ') || 'fermé'}
                        {v.prochain_creneau ? ` · premier créneau compatible : ${v.prochain_creneau}` : ' · aucun créneau compatible ce jour'}
                      </li>
                    ))}
                  </ul>
                )}
                {overrunCode === 'RDV_NON_TENABLE' && overrunViolations.length > 0 && (
                  <ul className="space-y-1 list-disc list-inside">
                    {overrunViolations.map((v, i) => (
                      <li key={i}><strong>{v.name}</strong> — arrivée prévue {v.heure_prevue}, rendez-vous {v.fenetre}</li>
                    ))}
                  </ul>
                )}
                {overrunCode === 'RDV_NON_TENABLE' && overrunOrdreSuggere && (
                  <button
                    type="button"
                    onClick={() => {
                      setCavIds(overrunOrdreSuggere);
                      setError(null); setOverrun(null); setOverrunCode(null); setOverrunViolations([]); setOverrunOrdreSuggere(null);
                      setForceChecked(false);
                    }}
                    className="font-semibold underline hover:no-underline"
                  >
                    Appliquer l'ordre suggéré plutôt que forcer
                  </button>
                )}
              </div>
            )}
            {overrun && (
              <label className="flex items-start gap-2 text-xs text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3 cursor-pointer">
                <input type="checkbox" checked={forceChecked} onChange={e => setForceChecked(e.target.checked)} className="mt-0.5" />
                <span>
                  Je confirme la création malgré {FORCE_LABELS[overrunCode] || 'le dépassement'}
                  {overrun.depassement_min ? ` (+${overrun.depassement_min} min au-delà du budget de travail)` : ''}.
                  Le forçage sera tracé sur la tournée.
                </span>
              </label>
            )}

            {/* Pied */}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">
                Annuler
              </button>
              <button
                onClick={create}
                disabled={!canCreate || (overrun && !forceChecked)}
                className="btn-primary text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Création…'
                  : mode === 'intelligent' ? 'Générer la tournée (IA)'
                    : mode === 'standard' ? 'Créer depuis le modèle'
                      : 'Créer la tournée manuelle'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
