import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, PageHeader } from '../components';
import { Brain } from 'lucide-react';
import api from '../services/api';

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const EVENT_TYPES = [
  { value: 'brocante', label: 'Brocante' },
  { value: 'vide_grenier', label: 'Vide-grenier' },
  { value: 'vide_maison', label: 'Vide-maison' },
  { value: 'foire_a_tout', label: 'Foire à tout' },
  { value: 'marche', label: 'Marché' },
  { value: 'foire', label: 'Foire' },
  { value: 'festival', label: 'Festival' },
  { value: 'vente_au_kilo', label: 'Vente au kilo Solidarité Textiles' },
  { value: 'autre', label: 'Autre' },
];

export default function AdminPredictive() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newHoliday, setNewHoliday] = useState('');

  // Événements locaux
  const [events, setEvents] = useState([]);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState({
    nom: '', type: 'brocante', date_debut: '', date_fin: '',
    latitude: '', longitude: '', adresse: '', commune: '',
    rayon_km: '2', bonus_factor: '1.2', notes: '',
  });

  // Météo preview
  const [weatherPreview, setWeatherPreview] = useState(null);
  const [weatherDate, setWeatherDate] = useState(new Date().toISOString().split('T')[0]);

  // IA Claude — Analyse prédictive
  const [iaSynthese, setIaSynthese] = useState(null);
  const [iaAjustements, setIaAjustements] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState('');

  // IA Auto-discovery
  const [autoStats, setAutoStats] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [sources, setSources] = useState([]);

  useEffect(() => { loadConfig(); loadEvents(); loadAutoStats(); loadSources(); }, []);

  const loadIaSynthese = async () => {
    setIaLoading(true);
    setIaError('');
    try {
      const res = await api.get('/tours/predictive/ia/synthese');
      setIaSynthese(res.data);
    } catch (err) {
      setIaError(err.response?.data?.error || 'Erreur analyse IA');
    }
    setIaLoading(false);
  };

  const loadIaAjustements = async () => {
    setIaLoading(true);
    setIaError('');
    try {
      const res = await api.get('/tours/predictive/ia/ajustements');
      setIaAjustements(res.data);
    } catch (err) {
      setIaError(err.response?.data?.error || 'Erreur analyse IA');
    }
    setIaLoading(false);
  };

  const appliquerAjustements = () => {
    if (!iaAjustements) return;
    const newConfig = { ...config };
    // Bugfix : les inputs lisent seasonalFactors / dayOfWeekFactors (et non
    // seasonal / dayOfWeek), le bouton n'avait donc aucun effet visible.
    if (iaAjustements.facteurs_saisonniers_proposes?.length === 12) {
      newConfig.seasonalFactors = iaAjustements.facteurs_saisonniers_proposes.map(Number);
    }
    if (iaAjustements.facteurs_jours_proposes?.length === 7) {
      newConfig.dayOfWeekFactors = iaAjustements.facteurs_jours_proposes.map(Number);
    }
    setConfig(newConfig);
  };

  const loadConfig = async () => {
    try {
      const res = await api.get('/tours/predictive-config');
      setConfig(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadEvents = async () => {
    try {
      const res = await api.get('/tours/events');
      setEvents(res.data);
    } catch (err) { console.error(err); }
  };

  const loadAutoStats = async () => {
    try {
      const [statsRes, predRes] = await Promise.all([
        api.get('/tours/events-auto/stats').catch(() => ({ data: null })),
        api.get('/tours/events-auto/predictions?weeks=6').catch(() => ({ data: [] })),
      ]);
      setAutoStats(statsRes.data);
      setPredictions(predRes.data);
    } catch (err) { console.error(err); }
  };

  const loadSources = async () => {
    try {
      const res = await api.get('/tours/events-auto/sources');
      setSources(res.data);
    } catch (err) { console.error(err); }
  };

  const runAutoDiscovery = async () => {
    setDiscovering(true);
    setDiscoveryResult(null);
    try {
      const res = await api.post('/tours/events-auto/discover', { months_ahead: 3 });
      setDiscoveryResult(res.data);
      loadEvents();
      loadAutoStats();
    } catch (err) {
      setDiscoveryResult({ error: err.response?.data?.error || 'Erreur' });
    }
    setDiscovering(false);
  };

  // V1.8.4 — synchronisations dédiées (par CAV / association / holidays / facteurs)
  const [syncing, setSyncing] = useState(null);
  const [lastRuns, setLastRuns] = useState(null);

  const loadLastRuns = async () => {
    try {
      const r = await api.get('/tours/events-auto/last-runs');
      setLastRuns(r.data);
    } catch (err) { /* silencieux */ }
  };

  useEffect(() => { loadLastRuns(); }, []);

  const syncByCAV = async () => {
    setSyncing('cav');
    try {
      const r = await api.post('/tours/events-auto/discover-by-cav');
      setDiscoveryResult({ message: `Découverte par CAV : ${r.data.inserted} nouveaux events (sur ${r.data.found} trouvés)` });
      loadEvents(); loadAutoStats(); loadLastRuns();
    } catch (err) {
      setDiscoveryResult({ error: err.response?.data?.error || 'Erreur' });
    }
    setSyncing(null);
  };
  const syncByAssociation = async () => {
    setSyncing('asso');
    try {
      const r = await api.post('/tours/events-auto/discover-by-association');
      setDiscoveryResult({ message: `Découverte par association : ${r.data.inserted} nouveaux events (sur ${r.data.found} trouvés)` });
      loadEvents(); loadAutoStats(); loadLastRuns();
    } catch (err) {
      setDiscoveryResult({ error: err.response?.data?.error || 'Erreur' });
    }
    setSyncing(null);
  };
  const syncHolidays = async () => {
    setSyncing('holidays');
    try {
      const r = await api.post('/tours/events-auto/sync-holidays');
      setDiscoveryResult({ message: `Jours fériés + vacances scolaires synchronisés` });
      loadLastRuns();
    } catch (err) {
      setDiscoveryResult({ error: err.response?.data?.error || 'Erreur' });
    }
    setSyncing(null);
  };
  const recalcSeasonal = async () => {
    setSyncing('seasonal');
    try {
      const r = await api.post('/tours/events-auto/recalc-seasonal');
      setDiscoveryResult({ message: `Facteurs saisonniers recalculés (${r.data.monthly?.length || 0} mois, ${r.data.dow?.length || 0} jours)` });
      loadLastRuns();
    } catch (err) {
      setDiscoveryResult({ error: err.response?.data?.error || 'Erreur' });
    }
    setSyncing(null);
  };

  const fmtRunDate = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Jamais';
  const findRun = (scope) => (lastRuns?.discovery_runs || []).find(r => r.scope === scope);

  const loadWeatherPreview = async () => {
    try {
      const res = await api.get(`/tours/context/${weatherDate}`);
      setWeatherPreview(res.data);
    } catch (err) { console.error(err); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/tours/predictive-config', config);
      setConfig(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const updateSeasonal = (idx, val) => {
    const arr = [...config.seasonalFactors];
    arr[idx] = parseFloat(val) || 0;
    setConfig({ ...config, seasonalFactors: arr });
  };

  const updateDayOfWeek = (idx, val) => {
    const arr = [...config.dayOfWeekFactors];
    arr[idx] = parseFloat(val) || 0;
    setConfig({ ...config, dayOfWeekFactors: arr });
  };

  const updateScoring = (key, val) => {
    setConfig({
      ...config,
      scoring: { ...config.scoring, [key]: typeof config.scoring[key] === 'number' ? parseFloat(val) || 0 : val },
    });
  };

  const removeHoliday = (idx) => {
    const arr = [...config.holidays];
    arr.splice(idx, 1);
    setConfig({ ...config, holidays: arr });
  };

  const addHoliday = () => {
    if (newHoliday && /^\d{4}-\d{2}-\d{2}$/.test(newHoliday)) {
      setConfig({ ...config, holidays: [...config.holidays, newHoliday].sort() });
      setNewHoliday('');
    }
  };

  const createEvent = async (e) => {
    e.preventDefault();
    try {
      await api.post('/tours/events', {
        ...eventForm,
        latitude: eventForm.latitude ? parseFloat(eventForm.latitude) : null,
        longitude: eventForm.longitude ? parseFloat(eventForm.longitude) : null,
        rayon_km: parseFloat(eventForm.rayon_km) || 2,
        bonus_factor: parseFloat(eventForm.bonus_factor) || 1.2,
      });
      setShowEventForm(false);
      setEventForm({
        nom: '', type: 'brocante', date_debut: '', date_fin: '',
        latitude: '', longitude: '', adresse: '', commune: '',
        rayon_km: '2', bonus_factor: '1.2', notes: '',
      });
      loadEvents();
    } catch (err) { console.error(err); }
  };

  const deleteEvent = async (id) => {
    if (!confirm('Supprimer cet événement ?')) return;
    try {
      await api.delete(`/tours/events/${id}`);
      loadEvents();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;
  if (!config) return <Layout><div className="p-6 text-red-500">Erreur de chargement</div></Layout>;

  // Séparer événements à venir et passés
  const today = new Date().toISOString().split('T')[0];
  const upcomingEvents = events.filter(e => e.date_fin >= today);
  const pastEvents = events.filter(e => e.date_fin < today);

  return (
    <Layout>
      <div className="p-6 max-w-5xl">
        <PageHeader
          title="Moteur prédictif"
          subtitle="Variables et paramètres de l'algorithme d'optimisation des tournées"
          icon={Brain}
          actions={
            <button
              onClick={save}
              disabled={saving}
              className={`px-5 py-2.5 rounded-lg text-white font-medium transition ${saved ? 'bg-green-500' : 'bg-primary hover:bg-primary/90'}`}
            >
              {saving ? 'Sauvegarde...' : saved ? 'Sauvegardé !' : 'Sauvegarder'}
            </button>
          }
        />

        {/* Centre de tri */}
        <Section title="Centre de tri" desc="Coordonnées du point de départ/retour des tournées">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Latitude</label>
              <input type="number" step="0.0001" value={config.centreTri.lat} readOnly className="input-modern bg-slate-50" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Longitude</label>
              <input type="number" step="0.0001" value={config.centreTri.lng} readOnly className="input-modern bg-slate-50" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Modifiable via les variables d'environnement CENTRE_TRI_LAT / CENTRE_TRI_LNG</p>
        </Section>

        {/* ══════════ MÉTÉO ══════════ */}
        <Section title="Conditions météo" desc="La météo influence automatiquement les prédictions de remplissage (Open-Meteo)">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <ParamInput label="Bonus beau temps + weekend" value={config.scoring.weekendSunnyBonus} onChange={v => updateScoring('weekendSunnyBonus', v)} />
            <ParamInput label="Bonus événement local" value={config.scoring.localEventBonus} onChange={v => updateScoring('localEventBonus', v)} />
          </div>

          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
            <p className="font-medium mb-2">Facteurs météo automatiques :</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="bg-white rounded p-2 text-center">
                <span className="block text-lg">☀️</span>
                <span className="font-medium">Dégagé + chaud</span>
                <span className="block text-blue-600">x1.08</span>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <span className="block text-lg">🌧️</span>
                <span className="font-medium">Pluie</span>
                <span className="block text-blue-600">x0.95</span>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <span className="block text-lg">🌦️</span>
                <span className="font-medium">Averses</span>
                <span className="block text-blue-600">x0.92</span>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <span className="block text-lg">❄️</span>
                <span className="font-medium">Neige</span>
                <span className="block text-blue-600">x0.90</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-blue-600">
              Beau temps le weekend (sam/dim, {'>'}18°C) : <strong>x{config.scoring.weekendSunnyBonus || 1.15}</strong> — les gens trient et déposent davantage.
            </p>
          </div>

          {/* Preview météo */}
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-medium text-gray-500 mb-2">Aperçu météo pour une date</p>
            <div className="flex gap-2 items-end">
              <input type="date" value={weatherDate} onChange={e => setWeatherDate(e.target.value)} className="input-modern w-auto" />
              <button onClick={loadWeatherPreview} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">Voir</button>
            </div>
            {weatherPreview && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3 text-sm grid grid-cols-2 md:grid-cols-5 gap-3">
                <div><span className="text-xs text-gray-400 block">Météo</span><span className="font-medium">{weatherPreview.weatherLabel || '—'}</span></div>
                <div><span className="text-xs text-gray-400 block">Code WMO</span><span className="font-mono">{weatherPreview.weatherCode || '—'}</span></div>
                <div><span className="text-xs text-gray-400 block">Temp. max</span><span className="font-medium">{weatherPreview.tempMax != null ? `${weatherPreview.tempMax}°C` : '—'}</span></div>
                <div><span className="text-xs text-gray-400 block">Précipitations</span><span className="font-medium">{weatherPreview.precipMm != null ? `${weatherPreview.precipMm} mm` : '—'}</span></div>
                <div><span className="text-xs text-gray-400 block">Facteur</span><span className="font-mono font-bold">{weatherPreview.weatherFactor}</span></div>
              </div>
            )}
          </div>
        </Section>

        {/* ══════════ ÉVÉNEMENTS LOCAUX ══════════ */}
        <Section title="Événements locaux" desc="Brocantes, vide-greniers et événements générant un excédent de collecte à proximité des CAV">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500">
              Un événement à proximité d'un CAV augmente la prédiction de remplissage (x{config.scoring.localEventBonus || 1.2} par défaut).
            </p>
            <button onClick={() => setShowEventForm(true)} className="text-primary text-sm font-medium hover:underline">+ Nouvel événement</button>
          </div>

          {upcomingEvents.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">A venir / En cours</p>
              <div className="space-y-2">
                {upcomingEvents.map(evt => (
                  <EventRow key={evt.id} evt={evt} onDelete={deleteEvent} />
                ))}
              </div>
            </div>
          )}

          {pastEvents.length > 0 && (
            <details className="text-sm">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 mb-2">
                {pastEvents.length} événement(s) passé(s)
              </summary>
              <div className="space-y-2">
                {pastEvents.map(evt => (
                  <EventRow key={evt.id} evt={evt} onDelete={deleteEvent} past />
                ))}
              </div>
            </details>
          )}

          {events.length === 0 && (
            <p className="text-xs text-gray-300 italic">Aucun événement enregistré</p>
          )}
        </Section>

        {/* ══════════ DÉCOUVERTE AUTOMATIQUE IA ══════════ */}
        {/* ═══ V1.8.4 — Panneau synchronisation automatique ═══ */}
        <Section title="Synchronisation IA" desc="Lance manuellement les flux de découverte (cron mensuel/annuel actif en parallèle). Sources : OpenAgenda, vide-greniers.fr, brocabrac.fr">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* CAV — rayon 500m */}
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-sm text-slate-700">📍 Découverte par CAV</p>
                  <p className="text-xs text-slate-500">Brocantes, vide-greniers, foires à proximité de chaque CAV (rayon 500m).</p>
                </div>
                <button onClick={syncByCAV} disabled={syncing === 'cav'} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                  {syncing === 'cav' ? 'Sync…' : 'Lancer'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Dernière exécution : {fmtRunDate(findRun('cav')?.completed_at)} {findRun('cav')?.events_inserted != null && `· ${findRun('cav').events_inserted} ajoutés`}</p>
            </div>

            {/* Associations partenaires */}
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-sm text-slate-700">🤝 Découverte par association partenaire</p>
                  <p className="text-xs text-slate-500">Mêmes sources, autour de chaque association partenaire.</p>
                </div>
                <button onClick={syncByAssociation} disabled={syncing === 'asso'} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                  {syncing === 'asso' ? 'Sync…' : 'Lancer'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Dernière exécution : {fmtRunDate(findRun('association')?.completed_at)} {findRun('association')?.events_inserted != null && `· ${findRun('association').events_inserted} ajoutés`}</p>
            </div>

            {/* Jours fériés + vacances scolaires */}
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-sm text-slate-700">📆 Jours fériés + vacances scolaires zone B</p>
                  <p className="text-xs text-slate-500">Sources : api.gouv.fr + opendata.education.gouv.fr (cron 1er janvier auto).</p>
                </div>
                <button onClick={syncHolidays} disabled={syncing === 'holidays'} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                  {syncing === 'holidays' ? 'Sync…' : 'Lancer'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Jours fériés : {fmtRunDate(lastRuns?.jours_feries?.last_at)} · {lastRuns?.jours_feries?.total || 0} entrées
                <br />
                Vacances scolaires : {fmtRunDate(lastRuns?.vacances_scolaires?.last_at)} · {lastRuns?.vacances_scolaires?.total || 0} entrées
              </p>
            </div>

            {/* Recalcul facteurs saisonniers */}
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-sm text-slate-700">📊 Recalcul facteurs saisonniers</p>
                  <p className="text-xs text-slate-500">Analyse historique des 24 derniers mois → ajuste les coefs SEASONAL/DOW (cron mensuel auto).</p>
                </div>
                <button onClick={recalcSeasonal} disabled={syncing === 'seasonal'} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                  {syncing === 'seasonal' ? 'Calcul…' : 'Recalculer'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Dernière exécution : {fmtRunDate(lastRuns?.seasonal_factors?.last_at)} · {lastRuns?.seasonal_factors?.total || 0} facteurs</p>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 italic mt-3">
            Crons automatiques : <strong>1er du mois 04h00</strong> (découverte par CAV + association + recalcul saisonnier) · <strong>1er janvier 02h00</strong> (jours fériés + vacances scolaires).
          </p>
        </Section>

        <Section title="Decouverte automatique IA" desc="Recherche multi-sources dans les agendas publics et analyse predictive saisonniere">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
            <div className="bg-indigo-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-indigo-700">{autoStats?.total_events || 0}</p>
              <p className="text-xs text-indigo-500">Evenements actifs</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{autoStats?.upcoming_events || 0}</p>
              <p className="text-xs text-green-500">A venir</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-700">{autoStats?.predicted_by_ia || 0}</p>
              <p className="text-xs text-purple-500">Generes par IA</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">x{autoStats?.avg_bonus_factor || '1.00'}</p>
              <p className="text-xs text-amber-500">Impact moyen</p>
            </div>
          </div>

          {/* Sources de données */}
          {sources.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sources de donnees</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sources.map(src => {
                  const isActive = src.key_configured;
                  const needsKey = src.requires_key && !src.key_configured;
                  return (
                    <div key={src.id} className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm ${isActive ? 'bg-green-50 border-green-200' : needsKey ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-green-500' : needsKey ? 'bg-amber-400' : 'bg-gray-400'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-700 truncate">{src.name}</p>
                        <p className="text-[10px] text-gray-400">{isActive ? src.coverage : needsKey ? `Cle API requise (${src.env_var})` : 'Inactive'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Répartition par source */}
          {autoStats?.by_source && Object.keys(autoStats.by_source).length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Repartition par source</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(autoStats.by_source).map(([source, count]) => (
                  <span key={source} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs border border-indigo-200">
                    <span className="font-bold">{count}</span>
                    <span>{source}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={runAutoDiscovery}
              disabled={discovering}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              {discovering ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Recherche multi-sources en cours...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  Lancer la decouverte automatique (3 mois)
                </>
              )}
            </button>
            <p className="text-xs text-gray-400">Interroge OpenAgenda, Open Data Rouen, Seine-Maritime et genere des predictions saisonnieres IA</p>
          </div>

          {discoveryResult && (
            <div className={`p-4 rounded-lg mb-4 ${discoveryResult.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              <p className={`text-sm font-medium ${discoveryResult.error ? 'text-red-700' : 'text-green-700'}`}>
                {discoveryResult.error || discoveryResult.message}
              </p>
              {discoveryResult.by_source && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(discoveryResult.by_source).map(([source, count]) => (
                    <span key={source} className="text-xs px-2 py-0.5 bg-white/60 rounded">
                      {source}: <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Predictions impact par semaine */}
          {predictions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Previsions d'impact sur la collecte</h3>
              <div className="space-y-2">
                {predictions.map((pred, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border">
                    <div className="flex-shrink-0 w-20">
                      <p className="text-xs font-bold text-gray-600">{pred.week_label}</p>
                      <p className="text-[10px] text-gray-400">{new Date(pred.week_start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          pred.combined_impact_factor > 1.1 ? 'bg-green-100 text-green-700' :
                          pred.combined_impact_factor < 0.95 ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {pred.estimated_volume_change}
                        </span>
                        <span className="text-xs text-gray-400">{pred.events_count} evenement(s)</span>
                        <span className="text-[10px] text-gray-300">{pred.seasonal_context}</span>
                      </div>
                      {pred.events.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {pred.events.slice(0, 3).map(ev => (
                            <span key={ev.id} className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
                              {ev.nom.length > 30 ? ev.nom.substring(0, 30) + '...' : ev.nom}
                            </span>
                          ))}
                          {pred.events.length > 3 && <span className="text-[10px] text-gray-400">+{pred.events.length - 3} autres</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${pred.brocante_probability >= 0.7 ? 'bg-green-500' : pred.brocante_probability >= 0.4 ? 'bg-amber-400' : 'bg-gray-400'}`}
                          style={{ width: `${Math.round(pred.brocante_probability * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-gray-400 text-center mt-0.5">{Math.round(pred.brocante_probability * 100)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Analyse IA Claude */}
        <Section title="Analyse IA (Claude)" desc="Synthèse automatique et recommandations d'ajustement basées sur l'historique">
          <div className="space-y-4">
            <div className="flex gap-3">
              <button onClick={loadIaSynthese} disabled={iaLoading}
                className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {iaLoading ? 'Analyse en cours...' : 'Synthèse hebdomadaire'}
              </button>
              <button onClick={loadIaAjustements} disabled={iaLoading}
                className="btn-primary text-sm">
                {iaLoading ? 'Analyse en cours...' : 'Recommander ajustements'}
              </button>
            </div>

            {iaError && (
              <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 border border-red-200">{iaError}</div>
            )}

            {iaSynthese && (
              <div className="bg-violet-50 rounded-xl border border-violet-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-violet-800 text-sm">Synthèse IA</h4>
                  {iaSynthese.score_global != null && (
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                      iaSynthese.score_global >= 70 ? 'bg-emerald-100 text-emerald-700' :
                      iaSynthese.score_global >= 40 ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>Score : {iaSynthese.score_global}/100</span>
                  )}
                </div>
                {iaSynthese.resume && <p className="text-sm text-slate-700">{iaSynthese.resume}</p>}
                {iaSynthese.tendances?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-violet-700 mb-1">Tendances</p>
                    <ul className="text-xs text-slate-600 space-y-1">
                      {iaSynthese.tendances.map((t, i) => <li key={i} className="flex gap-1.5"><span className="text-violet-400">-</span>{t}</li>)}
                    </ul>
                  </div>
                )}
                {iaSynthese.anomalies?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-600 mb-1">Anomalies détectées</p>
                    <ul className="text-xs text-slate-600 space-y-1">
                      {iaSynthese.anomalies.map((a, i) => <li key={i} className="flex gap-1.5"><span className="text-red-400">!</span>{a}</li>)}
                    </ul>
                  </div>
                )}
                {iaSynthese.recommandations?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-teal-700 mb-1">Recommandations</p>
                    <ul className="text-xs text-slate-600 space-y-1">
                      {iaSynthese.recommandations.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-teal-500">→</span>{r}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {iaAjustements && (
              <div className="bg-teal-50 rounded-xl border border-teal-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-teal-800 text-sm">Ajustements recommandés</h4>
                  {iaAjustements.confiance != null && (
                    <span className="text-xs text-teal-600">Confiance : {Math.round(iaAjustements.confiance * 100)}%</span>
                  )}
                </div>
                {iaAjustements.message && <p className="text-sm text-slate-700">{iaAjustements.message}</p>}
                {iaAjustements.justifications?.length > 0 && (
                  <ul className="text-xs text-slate-600 space-y-1">
                    {iaAjustements.justifications.map((j, i) => <li key={i} className="flex gap-1.5"><span className="text-teal-500">→</span>{j}</li>)}
                  </ul>
                )}
                <button onClick={appliquerAjustements}
                  className="mt-2 btn-primary text-xs">
                  Appliquer les facteurs recommandés
                </button>
                <p className="text-[10px] text-slate-400">Les facteurs seront appliqués dans le formulaire ci-dessous. Enregistrez ensuite pour valider.</p>
              </div>
            )}
          </div>
        </Section>

        {/* Facteurs saisonniers */}
        <Section title="Facteurs saisonniers" desc="Multiplicateur de remplissage par mois (1.0 = normal). Valeurs EFFECTIVES appliquées par le moteur.">
          <SourceLegend learnedCount={config.learnedMonthlyCount} />
          <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
            {config.seasonalFactors.map((val, idx) => (
              <div key={idx} className="text-center">
                <label className="text-[10px] font-semibold text-gray-400 block">{MONTH_LABELS[idx]}</label>
                <input
                  type="number" step="0.05" min="0" max="3"
                  value={val}
                  onChange={e => updateSeasonal(idx, e.target.value)}
                  className="input-modern py-1.5 text-center"
                />
                <div className="mt-1 h-1 rounded-full" style={{ background: val >= 1 ? '#22c55e' : '#f59e0b', opacity: 0.5 + Math.abs(val - 1) }} />
                <SourceBadge source={config.seasonalSources?.[idx]} />
              </div>
            ))}
          </div>
        </Section>

        {/* Facteurs jour de semaine */}
        <Section title="Facteurs jour de semaine" desc="Multiplicateur par jour (lundi=1er). Valeurs EFFECTIVES appliquées par le moteur.">
          <SourceLegend learnedCount={config.learnedDowCount} />
          <div className="grid grid-cols-7 gap-3">
            {config.dayOfWeekFactors.map((val, idx) => (
              <div key={idx} className="text-center">
                <label className="text-xs font-semibold text-gray-500 block mb-1">{DAY_LABELS[idx]}</label>
                <input
                  type="number" step="0.05" min="0" max="3"
                  value={val}
                  onChange={e => updateDayOfWeek(idx, e.target.value)}
                  className="input-modern text-center"
                />
                <SourceBadge source={config.dayOfWeekSources?.[idx]} />
              </div>
            ))}
          </div>
        </Section>

        {/* Paramètres de scoring */}
        <Section title="Scoring & Algorithme" desc="Paramètres de sélection des CAV et optimisation TSP + 2-opt">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <ParamInput label="Seuil critique (%)" value={config.scoring.fillThresholds?.critical} onChange={v => updateScoring('fillThresholds', { ...config.scoring.fillThresholds, critical: parseFloat(v) })} />
            <ParamInput label="Seuil élevé (%)" value={config.scoring.fillThresholds?.high} onChange={v => updateScoring('fillThresholds', { ...config.scoring.fillThresholds, high: parseFloat(v) })} />
            <ParamInput label="Seuil moyen (%)" value={config.scoring.fillThresholds?.medium} onChange={v => updateScoring('fillThresholds', { ...config.scoring.fillThresholds, medium: parseFloat(v) })} />
            <ParamInput label="Score critique" value={config.scoring.fillScores?.critical} onChange={v => updateScoring('fillScores', { ...config.scoring.fillScores, critical: parseFloat(v) })} />
            <ParamInput label="Score élevé" value={config.scoring.fillScores?.high} onChange={v => updateScoring('fillScores', { ...config.scoring.fillScores, high: parseFloat(v) })} />
            <ParamInput label="Score moyen" value={config.scoring.fillScores?.medium} onChange={v => updateScoring('fillScores', { ...config.scoring.fillScores, medium: parseFloat(v) })} />
            <ParamInput label="Poids jours depuis collecte" value={config.scoring.daysSinceWeight} onChange={v => updateScoring('daysSinceWeight', v)} />
            <ParamInput label="Bonus conteneurs" value={config.scoring.containerBonus} onChange={v => updateScoring('containerBonus', v)} />
            <ParamInput label="Cible remplissage véhicule (%)" value={Math.round(config.scoring.vehicleFillTarget * 100)} onChange={v => updateScoring('vehicleFillTarget', parseFloat(v) / 100)} />
            <ParamInput label="Vitesse moyenne (km/h)" value={config.scoring.avgSpeed} onChange={v => updateScoring('avgSpeed', v)} />
            <ParamInput label="Temps par CAV (min)" value={config.scoring.timePerCav} onChange={v => updateScoring('timePerCav', v)} />
            <ParamInput label="Historique analysé (jours)" value={config.scoring.historyDays} onChange={v => updateScoring('historyDays', v)} />
            <ParamInput label="Cycle collecte (jours)" value={config.scoring.weeklyCollectionCycle} onChange={v => updateScoring('weeklyCollectionCycle', v)} />
            <ParamInput label="Seuil densité (nb conteneurs)" value={config.scoring.densityThreshold} onChange={v => updateScoring('densityThreshold', v)} />
            <ParamInput label="Bonus densité (multiplicateur)" value={config.scoring.densityBonus} onChange={v => updateScoring('densityBonus', v)} />
            <ParamInput label="Bonus jour férié (multiplicateur)" value={config.scoring.holidayBonus} onChange={v => updateScoring('holidayBonus', v)} />
            <ParamInput label="Facteur vacances scolaires (hors été)" value={config.scoring.schoolVacationFactor || config.scoring.schoolVacationBonus} onChange={v => updateScoring('schoolVacationFactor', v)} />
            <ParamInput label="Facteur vacances d'été" value={config.scoring.summerVacationFactor} onChange={v => updateScoring('summerVacationFactor', v)} />
            <ParamInput label="Facteur semaine pré-vacances" value={config.scoring.preVacationBonus} onChange={v => updateScoring('preVacationBonus', v)} />
            <ParamInput label="Facteur semaine post-vacances" value={config.scoring.postVacationBonus} onChange={v => updateScoring('postVacationBonus', v)} />
            <ParamInput label="Cap remplissage max (%)" value={config.scoring.maxFillCap} onChange={v => updateScoring('maxFillCap', v)} />
          </div>
        </Section>

        {/* ══════════ TEMPS DE TRAVAIL & CONTRAINTES DE TOURNÉE ══════════ */}
        <Section title="Temps de travail & contraintes de tournée" desc="Budget journalier du chauffeur, pause déjeuner, retours de vidage et seuil de saturation — utilisés par l'estimation de tournée et le wizard de création (Historique des tournées).">
          <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 mb-4">
            Règle : le chauffeur travaille au maximum <strong>{config.scoring.maxDailyHours ?? 6} h/jour</strong>. La pause déjeuner est prise <strong>au centre de tri</strong> et n'est <strong>pas comptée</strong> dans ce budget. Les retours de vidage au centre (véhicule plein, ou tous les X kg), eux, <strong>sont comptés</strong> dans le temps de travail.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <ParamInput label="Durée de travail max (h/jour) — pause déjeuner exclue" value={config.scoring.maxDailyHours} onChange={v => updateScoring('maxDailyHours', v)} />
            <ParamInput label="Heure de départ par défaut" value={config.scoring.workdayStartHour} onChange={v => updateScoring('workdayStartHour', v)} />
            <ParamInput label="Pause déjeuner à partir de (h)" value={config.scoring.lunchStartHour} onChange={v => updateScoring('lunchStartHour', v)} />
            <ParamInput label="…ou après (h) de travail" value={config.scoring.lunchAfterHours} onChange={v => updateScoring('lunchAfterHours', v)} />
            <ParamInput label="Durée de la pause (min, hors temps de travail)" value={config.scoring.lunchBreakMinutes} onChange={v => updateScoring('lunchBreakMinutes', v)} />
            <ParamInput label="Temps de déchargement au centre (min)" value={config.scoring.unloadMinutes} onChange={v => updateScoring('unloadMinutes', v)} />
            <ParamInput label="Retour de vidage à (% de la capacité du véhicule)" value={config.scoring.vehicleFillReturnPct} onChange={v => updateScoring('vehicleFillReturnPct', v)} />
            <ParamInput label="…ou tous les (kg) — 0 pour désactiver" value={config.scoring.returnEveryKg} onChange={v => updateScoring('returnEveryKg', v)} />
            <ParamInput label="Seuil de saturation d'une borne (%)" value={config.scoring.saturationThresholdPct} onChange={v => updateScoring('saturationThresholdPct', v)} />
            <ParamInput label="Tolérance de rendez-vous association (min, ± autour de l'heure demandée)" value={config.scoring.rdvToleranceMin} onChange={v => updateScoring('rdvToleranceMin', v)} />
            <div className="md:col-span-3">
              <label className="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={config.scoring.attenteCompteTravail !== false}
                  onChange={e => updateScoring('attenteCompteTravail', e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong>Compter l'attente avant un rendez-vous dans le temps de travail.</strong>
                  <span className="block text-slate-500">
                    Activé (par défaut) : si l'équipage arrive en avance devant une association avec
                    rendez-vous, l'attente est comptée dans le budget de 6 h — l'équipage est en service.
                    Désactivé : cette attente est traitée comme la pause déjeuner, hors budget de travail.
                  </span>
                </span>
              </label>
            </div>
          </div>
        </Section>

        {/* ══════════ FACTEURS DE SÉLECTION DES BORNES ══════════ */}
        <Section
          title="Facteurs de sélection des bornes"
          desc="Ce qui décide QUELLES bornes le moteur prédictif retient pour une tournée."
        >
          <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 mb-4 space-y-1">
            <p>
              Quatre critères, dans cet ordre : <strong>remplissage</strong> (une borne
              pleine déborde), <strong>temps</strong> (le budget de la journée),
              <strong> distance parcourue</strong>, puis les <strong>émissions</strong> en
              dernier facteur.
            </p>
            <p>
              Le poids du remplissage doit rester <strong>supérieur à la somme des trois
              autres</strong> : sinon les critères secondaires réunis renverseraient le
              critère premier. Les bornes qui atteignent le seuil de saturation restent,
              elles, servies en priorité absolue.
            </p>
            <p>
              Les émissions n'entrent dans le calcul que si la consommation du véhicule est
              <strong> mesurée</strong> (pleins saisis dans Énergie &amp; GES). Sinon le
              critère est simplement écarté — jamais estimé.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <ParamInput label="1. Poids du remplissage" value={config.scoring.poidsRemplissage} onChange={v => updateScoring('poidsRemplissage', v)} />
            <ParamInput label="2. Poids du temps de collecte" value={config.scoring.poidsTemps} onChange={v => updateScoring('poidsTemps', v)} />
            <ParamInput label="3. Poids de la distance" value={config.scoring.poidsDistance} onChange={v => updateScoring('poidsDistance', v)} />
            <ParamInput label="4. Poids des émissions" value={config.scoring.poidsEmissions} onChange={v => updateScoring('poidsEmissions', v)} />
            <ParamInput label="Distance de référence (km)" value={config.scoring.echelleDetourKm} onChange={v => updateScoring('echelleDetourKm', v)} />
            <ParamInput label="Temps de service de référence (min)" value={config.scoring.echelleServiceMin} onChange={v => updateScoring('echelleServiceMin', v)} />
          </div>
          {(() => {
            const p = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
            const premier = p(config.scoring.poidsRemplissage, 1);
            const autres = p(config.scoring.poidsTemps, 0.35)
              + p(config.scoring.poidsDistance, 0.15)
              + p(config.scoring.poidsEmissions, 0.05);
            return premier <= autres ? (
              <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                Le poids du remplissage ({premier}) ne dépasse plus la somme des trois autres
                ({Math.round(autres * 100) / 100}) : une borne pleine mais éloignée peut désormais
                passer derrière une borne quasi vide toute proche.
              </div>
            ) : null;
          })()}
        </Section>

        {/* ══════════ OPTIMISATION CO2 & EFFICACITÉ ══════════ */}
        <Section
          title="Ordre de passage en cours de tournée"
          desc="Recalcul de l'ordre des bornes restantes, déclenché après chaque borne collectée."
        >
          <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 mb-4 space-y-1">
            <p>
              Le recalcul se déclenche <strong>après chaque borne collectée</strong>, et
              jamais pendant un trajet : le chauffeur en route vers un point y est déjà
              engagé. Il tient compte de la circulation du moment dès qu'une clé TomTom
              est renseignée ; sans clé, il travaille à circulation moyenne et le dit.
            </p>
            <p>
              La priorité est le <strong>temps</strong> — c'est le budget de la journée qui
              contraint la collecte. Le choix des bornes à collecter, lui, se règle plus
              haut dans « Facteurs de sélection des bornes ».
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Objectif du recalcul d'ordre</label>
              <select
                value={config.scoring.reoptimObjectif ?? 'duree'}
                onChange={e => updateScoring('reoptimObjectif', e.target.value)}
                className="input-modern"
              >
                <option value="duree">Temps de parcours (recommandé)</option>
                <option value="distance">Kilomètres</option>
                <option value="mixte">Mixte — temps et kilomètres</option>
              </select>
            </div>
            <ParamInput label="Pondération kilomètres (objectif mixte)" value={config.scoring.reoptimPoidsDistance} onChange={v => updateScoring('reoptimPoidsDistance', v)} />
            <ParamInput label="Pondération temps (objectif mixte)" value={config.scoring.reoptimPoidsDuree} onChange={v => updateScoring('reoptimPoidsDuree', v)} />
            <ParamInput label="Gain minimal pour proposer un nouvel ordre (%)" value={config.scoring.reoptimGainMinPct} onChange={v => updateScoring('reoptimGainMinPct', v)} />
            <ParamInput label="Délai anti-doublon entre deux recalculs (min)" value={config.scoring.reoptimIntervalMin} onChange={v => updateScoring('reoptimIntervalMin', v)} />
            <ParamInput label="Gain minimal pour appliquer SANS validation (%)" value={config.scoring.reoptimAutoGainMinPct} onChange={v => updateScoring('reoptimAutoGainMinPct', v)} />
            <div className="md:col-span-3">
              <label className="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={config.scoring.reoptimAuto === true}
                  onChange={e => updateScoring('reoptimAuto', e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong>Appliquer automatiquement</strong> le nouvel ordre au-delà du gain
                  ci-dessus, sans validation du gestionnaire.
                  <span className="block text-slate-500">
                    Désactivé par défaut : réordonner la route d'un chauffeur en cours de
                    tournée est une décision d'exploitation. Activé, le chauffeur voit son
                    ordre changer sur son téléphone et le gestionnaire en est informé.
                  </span>
                </span>
              </label>
            </div>
          </div>
        </Section>

        {/* ══════════ PONDÉRATION MÉTÉO APPRISE ══════════ */}
        <Section title="Pondération météo apprise (dépôts)" desc="Effet du beau temps sur les dépôts, appris chaque mois depuis les collectes réelles croisées avec la météo quotidienne — distinction semaine / week-end.">
          {config.weatherLearned?.ok ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Semaine — temps ordinaire', config.weatherLearned.facteurs.sem_autre, config.weatherLearned.jours?.sem_autre],
                  ['Semaine — beau temps', config.weatherLearned.facteurs.sem_beau, config.weatherLearned.jours?.sem_beau],
                  ['Week-end — temps ordinaire', config.weatherLearned.facteurs.we_autre, config.weatherLearned.jours?.we_autre],
                  ['Week-end — beau temps', config.weatherLearned.facteurs.we_beau, config.weatherLearned.jours?.we_beau],
                ].map(([label, val, jours]) => (
                  <div key={label} className="bg-slate-50 rounded-lg p-3">
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <p className="text-lg font-semibold text-slate-800">×{Number(val).toFixed(2)}</p>
                    {jours != null && <p className="text-[10px] text-slate-400">{jours} jours observés</p>}
                  </div>
                ))}
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800">
                Appliqué par le moteur (à type de jour égal, beau temps vs ordinaire) :
                {' '}<strong>week-end ensoleillé ×{Number(config.weatherLearned.ratios.beau_weekend).toFixed(2)}</strong>
                {' '}· semaine ensoleillée ×{Number(config.weatherLearned.ratios.beau_semaine).toFixed(2)}.
                {' '}Appris sur {config.weatherLearned.intervalles} intervalles de collecte
                {config.weatherLearned.cavs ? ` (${config.weatherLearned.cavs} bornes)` : ''}
                {config.weatherLearned.computed_at ? `, le ${new Date(config.weatherLearned.computed_at).toLocaleDateString('fr-FR')}` : ''}.
                L'effet week-end « de base » reste porté par les facteurs jour de semaine ci-dessus.
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              Apprentissage en attente de données suffisantes (il faut assez d'intervalles de collecte
              couverts par la météo quotidienne). En attendant, le moteur applique la règle par défaut :
              week-end ensoleillé ×{config.scoring.weekendSunnyBonus ?? 1.15}. Recalcul automatique le 1er de
              chaque mois — « beau temps » = temp. max ≥ {config.scoring.beauTempsTempMin ?? 15} °C et pluie
              &lt; {config.scoring.beauTempsPrecipMm ?? 1} mm (réglable via la configuration du moteur).
            </div>
          )}
        </Section>

        {/* Jours fériés */}
        <Section title="Jours fériés" desc="Dates avec bonus de remplissage automatique">
          <div className="flex flex-wrap gap-2 mb-3">
            {config.holidays.map((h, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg text-sm border border-amber-200">
                {new Date(h + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                <button onClick={() => removeHoliday(idx)} className="ml-1 text-amber-400 hover:text-red-500">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={newHoliday}
              onChange={e => setNewHoliday(e.target.value)}
              className="input-modern w-auto"
            />
            <button onClick={addHoliday} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600">
              Ajouter
            </button>
          </div>
        </Section>

        {/* Vacances scolaires */}
        <Section title="Vacances scolaires" desc="Périodes de vacances avec bonus automatique : semaine avant, pendant, et semaine après">
          <div className="space-y-2 mb-4">
            {(config.schoolVacations || []).map((vac, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-lg px-4 py-2">
                <input
                  type="text"
                  value={vac.name}
                  onChange={e => {
                    const arr = [...config.schoolVacations];
                    arr[idx] = { ...arr[idx], name: e.target.value };
                    setConfig({ ...config, schoolVacations: arr });
                  }}
                  className="input-modern py-1 flex-1 min-w-0"
                  placeholder="Nom"
                />
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <span>Du</span>
                  <input
                    type="date"
                    value={vac.start}
                    onChange={e => {
                      const arr = [...config.schoolVacations];
                      arr[idx] = { ...arr[idx], start: e.target.value };
                      setConfig({ ...config, schoolVacations: arr });
                    }}
                    className="input-modern py-1 w-auto"
                  />
                  <span>au</span>
                  <input
                    type="date"
                    value={vac.end}
                    onChange={e => {
                      const arr = [...config.schoolVacations];
                      arr[idx] = { ...arr[idx], end: e.target.value };
                      setConfig({ ...config, schoolVacations: arr });
                    }}
                    className="input-modern py-1 w-auto"
                  />
                </div>
                <button
                  onClick={() => {
                    const arr = [...config.schoolVacations];
                    arr.splice(idx, 1);
                    setConfig({ ...config, schoolVacations: arr });
                  }}
                  className="text-purple-400 hover:text-red-500 text-lg"
                >&times;</button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setConfig({
              ...config,
              schoolVacations: [...(config.schoolVacations || []), { name: '', start: '', end: '' }],
            })}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600"
          >
            + Ajouter une période
          </button>
          <div className="mt-4 bg-purple-50 rounded-lg p-3 text-xs text-purple-700">
            <p><strong>Effet sur la prédiction (calibré sur données réelles 2025-2026) :</strong></p>
            <ul className="mt-1 space-y-1 list-disc list-inside">
              <li>Semaine avant le début : x{config.scoring.preVacationBonus || 1.05} (léger surcroît de tri)</li>
              <li>Pendant les vacances (hors été) : x{config.scoring.schoolVacationFactor || config.scoring.schoolVacationBonus || 0.90} (baisse ~10%, routes moins fréquentes)</li>
              <li>Pendant les vacances d'été : x{config.scoring.summerVacationFactor || 1.0} (neutre, déjà capté par facteurs saisonniers juil/août)</li>
              <li>Semaine après la fin : x{config.scoring.postVacationBonus || 1.05} (retour, vidage post-vacances)</li>
            </ul>
            <p className="mt-2 text-purple-500">Source : analyse de 14 mois de données de collecte (1 468 t, 196 CAV)</p>
          </div>
        </Section>

        {/* Explication algorithme */}
        <Section title="Fonctionnement de l'algorithme" desc="">
          <div className="text-sm text-gray-600 space-y-3">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <p><strong>Prédiction de remplissage</strong> — Pour chaque CAV, l'historique des 180 derniers jours est analysé. Le remplissage est estimé en fonction du poids moyen, du nombre de jours depuis la dernière collecte, et des facteurs saisonniers/jour de semaine/jours fériés/vacances scolaires (semaine avant, pendant, semaine après).</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <p><strong>Météo & contexte</strong> — La météo est récupérée automatiquement (Open-Meteo). Beau temps le weekend = plus de dépôts (+{Math.round((config.scoring.weekendSunnyBonus - 1) * 100)}%). Pluie/neige = moins de dépôts. Les événements locaux (brocantes, vide-greniers) à proximité d'un CAV augmentent aussi la prédiction.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
              <p><strong>Scoring de priorité</strong> — Chaque CAV reçoit un score basé sur son remplissage prédit, le nombre de jours depuis la dernière collecte, le nombre de conteneurs, et la confiance de la prédiction.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">4</span>
              <p><strong>Sélection des CAV</strong> — Les CAV sont triés par score décroissant, puis sélectionnés jusqu'à remplir le véhicule à {Math.round(config.scoring.vehicleFillTarget * 100)}% de sa capacité.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">5</span>
              <p><strong>Optimisation TSP + 2-opt</strong> — L'algorithme du plus proche voisin (Nearest Neighbor) construit un itinéraire initial, puis l'amélioration 2-opt inverse des segments de route pour réduire la distance totale.</p>
            </div>
          </div>
        </Section>

        {/* Modal événement */}
        <Modal isOpen={showEventForm} onClose={() => setShowEventForm(false)} title="Nouvel événement local" size="md">
          <form onSubmit={createEvent}>
            <div className="space-y-3">
              <input placeholder="Nom de l'événement *" value={eventForm.nom} onChange={e => setEventForm({ ...eventForm, nom: e.target.value })} className="input-modern" required />
              <select value={eventForm.type} onChange={e => setEventForm({ ...eventForm, type: e.target.value })} className="input-modern">
                {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Date début *</label>
                  <input type="date" value={eventForm.date_debut} onChange={e => setEventForm({ ...eventForm, date_debut: e.target.value })} className="input-modern" required />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Date fin *</label>
                  <input type="date" value={eventForm.date_fin} onChange={e => setEventForm({ ...eventForm, date_fin: e.target.value })} className="input-modern" required />
                </div>
              </div>
              <input placeholder="Adresse" value={eventForm.adresse} onChange={e => setEventForm({ ...eventForm, adresse: e.target.value })} className="input-modern" />
              <input placeholder="Commune" value={eventForm.commune} onChange={e => setEventForm({ ...eventForm, commune: e.target.value })} className="input-modern" />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.0001" placeholder="Latitude" value={eventForm.latitude} onChange={e => setEventForm({ ...eventForm, latitude: e.target.value })} className="input-modern" />
                <input type="number" step="0.0001" placeholder="Longitude" value={eventForm.longitude} onChange={e => setEventForm({ ...eventForm, longitude: e.target.value })} className="input-modern" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Rayon d'impact (km)</label>
                  <input type="number" step="0.5" min="0.5" value={eventForm.rayon_km} onChange={e => setEventForm({ ...eventForm, rayon_km: e.target.value })} className="input-modern" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Bonus remplissage (x)</label>
                  <input type="number" step="0.05" min="1" value={eventForm.bonus_factor} onChange={e => setEventForm({ ...eventForm, bonus_factor: e.target.value })} className="input-modern" />
                </div>
              </div>
              <textarea placeholder="Notes (optionnel)" value={eventForm.notes} onChange={e => setEventForm({ ...eventForm, notes: e.target.value })} className="input-modern" rows="2" />
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowEventForm(false)} className="flex-1 btn-ghost">Annuler</button>
              <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}

function EventRow({ evt, onDelete, past }) {
  const typeLabel = EVENT_TYPES.find(t => t.value === evt.type)?.label || evt.type;
  // Postgres renvoie la DATE soit en ISO 'YYYY-MM-DD' (string), soit en
  // objet Date sérialisé. Le concat '+T00:00:00' cassait dans le 2e cas
  // (donnait 'Invalid Date'). Solution robuste : parser quel que soit le format.
  const fmtFR = (v, withYear) => {
    if (!v) return '';
    let d;
    if (typeof v === 'string') {
      // Si déjà un timestamp ISO complet, on garde tel quel
      d = v.length <= 10 ? new Date(`${v}T00:00:00`) : new Date(v);
    } else {
      d = new Date(v);
    }
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', withYear
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' });
  };
  const dateDebut = fmtFR(evt.date_debut, false);
  const dateFin = fmtFR(evt.date_fin, true);

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${past ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
          evt.type === 'brocante' ? 'bg-purple-100 text-purple-700' :
          evt.type === 'vide_grenier' ? 'bg-orange-100 text-orange-700' :
          evt.type === 'marche' ? 'bg-green-100 text-green-700' :
          'bg-gray-100 text-gray-700'
        }`}>{typeLabel}</span>
        <div>
          <p className="text-sm font-medium">{evt.nom}</p>
          <p className="text-xs text-gray-400">
            {dateDebut} — {dateFin}
            {evt.commune && ` • ${evt.commune}`}
            {evt.rayon_km && ` • rayon ${evt.rayon_km} km`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">x{parseFloat(evt.bonus_factor).toFixed(2)}</span>
        <button onClick={() => onDelete(evt.id)} className="text-red-400 hover:text-red-600 text-xs">Suppr.</button>
      </div>
    </div>
  );
}

function Section({ title, desc, children }) {
  return (
    <div className="card-modern p-5 mb-4">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      {desc && <p className="text-xs text-gray-400 mb-4">{desc}</p>}
      {children}
    </div>
  );
}

// Origine effective d'un facteur : appris (historique) > manuel (saisie) > défaut.
const SOURCE_META = {
  appris: { label: 'appris', cls: 'bg-emerald-100 text-emerald-700', title: 'Calculé sur l\'historique de tonnage (prioritaire)' },
  manuel: { label: 'manuel', cls: 'bg-blue-100 text-blue-700', title: 'Votre saisie enregistrée' },
  'défaut': { label: 'défaut', cls: 'bg-gray-100 text-gray-500', title: 'Valeur codée par défaut' },
};

function SourceBadge({ source }) {
  const meta = SOURCE_META[source];
  if (!meta) return null;
  return (
    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${meta.cls}`} title={meta.title}>
      {meta.label}
    </span>
  );
}

function SourceLegend({ learnedCount }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
      <span className="font-medium">Source du facteur :</span>
      <SourceBadge source="appris" /> <span>historique (prioritaire)</span>
      <SourceBadge source="manuel" /> <span>saisie</span>
      <SourceBadge source="défaut" /> <span>codé</span>
      {learnedCount > 0 && (
        <span className="ml-1 text-emerald-600">— {learnedCount} facteur(s) appris supplantent la saisie manuelle.</span>
      )}
      <span className="w-full text-[10px] text-gray-400 italic">
        Les facteurs « appris » (recalculés sur le tonnage réel) priment sur vos saisies ; une saisie sert de repli là où il n'y a pas encore de facteur appris.
      </span>
    </div>
  );
}

function ParamInput({ label, value, onChange }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
      <input
        type="number"
        step="any"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="input-modern"
      />
    </div>
  );
}
