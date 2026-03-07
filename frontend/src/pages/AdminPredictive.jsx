import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function AdminPredictive() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newHoliday, setNewHoliday] = useState('');

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    try {
      const res = await api.get('/tours/predictive-config');
      setConfig(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
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

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;
  if (!config) return <Layout><div className="p-6 text-red-500">Erreur de chargement</div></Layout>;

  return (
    <Layout>
      <div className="p-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Moteur prédictif</h1>
            <p className="text-gray-500">Variables et paramètres de l'algorithme d'optimisation des tournées</p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className={`px-5 py-2.5 rounded-lg text-white font-medium transition ${saved ? 'bg-green-500' : 'bg-solidata-green hover:bg-solidata-green/90'}`}
          >
            {saving ? 'Sauvegarde...' : saved ? 'Sauvegardé !' : 'Sauvegarder'}
          </button>
        </div>

        {/* Centre de tri */}
        <Section title="Centre de tri" desc="Coordonnées du point de départ/retour des tournées">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Latitude</label>
              <input type="number" step="0.0001" value={config.centreTri.lat} readOnly className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Longitude</label>
              <input type="number" step="0.0001" value={config.centreTri.lng} readOnly className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Modifiable via les variables d'environnement CENTRE_TRI_LAT / CENTRE_TRI_LNG</p>
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
                  className="w-full border rounded px-1 py-1.5 text-sm text-center"
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
                  className="w-full border rounded px-2 py-2 text-sm text-center"
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
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <button onClick={addHoliday} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600">
              Ajouter
            </button>
          </div>
        </Section>

        {/* Explication algorithme */}
        <Section title="Fonctionnement de l'algorithme" desc="">
          <div className="text-sm text-gray-600 space-y-3">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <p><strong>Prédiction de remplissage</strong> — Pour chaque CAV, l'historique des 180 derniers jours est analysé. Le remplissage est estimé en fonction du poids moyen, du nombre de jours depuis la dernière collecte, et des facteurs saisonniers/jour de semaine/jours fériés.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <p><strong>Scoring de priorité</strong> — Chaque CAV reçoit un score basé sur son remplissage prédit, le nombre de jours depuis la dernière collecte, le nombre de conteneurs, et la confiance de la prédiction.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
              <p><strong>Sélection des CAV</strong> — Les CAV sont triés par score décroissant, puis sélectionnés jusqu'à remplir le véhicule à {Math.round(config.scoring.vehicleFillTarget * 100)}% de sa capacité.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">4</span>
              <p><strong>Optimisation TSP + 2-opt</strong> — L'algorithme du plus proche voisin (Nearest Neighbor) construit un itinéraire initial, puis l'amélioration 2-opt inverse des segments de route pour réduire la distance totale.</p>
            </div>
          </div>
        </Section>
      </div>
    </Layout>
  );
}

function Section({ title, desc, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
      <h2 className="text-lg font-semibold text-solidata-dark mb-1">{title}</h2>
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
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
    </div>
  );
}
