import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const EVENT_TYPES = [
  { value: 'brocante', label: 'Brocante' },
  { value: 'vide_grenier', label: 'Vide-grenier' },
  { value: 'marche', label: 'Marché' },
  { value: 'foire', label: 'Foire' },
  { value: 'festival', label: 'Festival' },
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
    if (iaAjustements.facteurs_saisonniers_proposes?.length === 12) {
      newConfig.seasonal = iaAjustements.facteurs_saisonniers_proposes;
    }
    if (iaAjustements.facteurs_jours_proposes?.length === 7) {
      newConfig.dayOfWeek = iaAjustements.facteurs_jours_proposes;
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Moteur prédictif</h1>
            <p className="text-gray-500">Variables et paramètres de l'algorithme d'optimisation des tournées</p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className={`px-5 py-2.5 rounded-lg text-white font-medium transition ${saved ? 'bg-green-500' : 'bg-primary hover:bg-primary/90'}`}
          >
            {saving ? 'Sauvegarde...' : saved ? 'Sauvegardé !' : 'Sauvegarder'}
          </button>
        </div>

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
        <Section title="Facteurs saisonniers" desc="Multiplicateur de remplissage par mois (1.0 = normal)">
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
              </div>
            ))}
          </div>
        </Section>

        {/* Facteurs jour de semaine */}
        <Section title="Facteurs jour de semaine" desc="Multiplicateur par jour (lundi=1er)">
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
        {showEventForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createEvent} className="bg-white rounded-xl p-6 w-[520px] shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">Nouvel événement local</h2>
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
                <button type="button" onClick={() => setShowEventForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}

function EventRow({ evt, onDelete, past }) {
  const typeLabel = EVENT_TYPES.find(t => t.value === evt.type)?.label || evt.type;
  const dateDebut = new Date(evt.date_debut + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const dateFin = new Date(evt.date_fin + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

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
    <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      {desc && <p className="text-xs text-gray-400 mb-4">{desc}</p>}
      {children}
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
