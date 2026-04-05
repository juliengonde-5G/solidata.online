import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const URGENCY_COLORS = {
  critique: 'bg-red-100 text-red-700 border-red-200',
  attention: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};

const MILESTONE_STATUS_COLORS = {
  a_planifier: 'bg-gray-100 text-gray-600 border-gray-300',
  planifie: 'bg-blue-100 text-blue-700 border-blue-300',
  realise: 'bg-green-100 text-green-700 border-green-300',
  reporte: 'bg-orange-100 text-orange-700 border-orange-300',
};

const MILESTONE_STATUS_LABELS = {
  a_planifier: 'A planifier',
  planifie: 'Planifie',
  realise: 'Realise',
  reporte: 'Reporte',
};

const FREIN_COLORS = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-green-50 text-green-600',
  3: 'bg-yellow-100 text-yellow-700',
  4: 'bg-orange-100 text-orange-700',
  5: 'bg-red-100 text-red-700',
};

const FREIN_KEYS = ['mobilite', 'sante', 'finances', 'famille', 'linguistique', 'administratif', 'numerique'];
const FREIN_LABELS = { mobilite: 'Mobilite', sante: 'Sante', finances: 'Finances', famille: 'Famille', linguistique: 'Langue', administratif: 'Administratif', numerique: 'Numerique' };

const ACTION_STATUS = { a_faire: 'A faire', en_cours: 'En cours', realise: 'Realise', abandonne: 'Abandonne' };
const ACTION_CATEGORIES = { competence: 'Competence', insertion: 'Insertion', socialisation: 'Socialisation', frein: 'Levee de frein' };

const RADAR_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];

// ═══════════════════════════════════════
// RADAR CHART SVG
// ═══════════════════════════════════════

function RadarChart({ data }) {
  if (!data || !data.axes || data.series.length === 0) return null;
  const size = 300, cx = size / 2, cy = size / 2, r = 110;
  const axes = data.axes;
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;

  const getPoint = (index, value) => {
    const angle = angleStep * index - Math.PI / 2;
    const dist = (value / 5) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size + 40} viewBox={`0 0 ${size} ${size + 40}`}>
        {[1, 2, 3, 4, 5].map(level => (
          <polygon key={level} points={axes.map((_, i) => { const p = getPoint(i, level); return `${p.x},${p.y}`; }).join(' ')}
            fill="none" stroke="#e5e7eb" strokeWidth={level === 5 ? 1.5 : 0.5} />
        ))}
        {axes.map((label, i) => {
          const p = getPoint(i, 5.5);
          return <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#6b7280">{label}</text>;
        })}
        {axes.map((_, i) => {
          const p = getPoint(i, 5);
          return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth="0.5" />;
        })}
        {data.series.map((series, si) => (
          <polygon key={si}
            points={series.data.map((v, i) => { const p = getPoint(i, v || 1); return `${p.x},${p.y}`; }).join(' ')}
            fill={RADAR_COLORS[si % RADAR_COLORS.length]} fillOpacity="0.15"
            stroke={RADAR_COLORS[si % RADAR_COLORS.length]} strokeWidth="2" />
        ))}
        {data.series.map((series, si) =>
          series.data.map((v, i) => {
            const p = getPoint(i, v || 1);
            return <circle key={`${si}-${i}`} cx={p.x} cy={p.y} r="3" fill={RADAR_COLORS[si % RADAR_COLORS.length]} />;
          })
        )}
        {data.series.map((series, si) => (
          <g key={`legend-${si}`} transform={`translate(${20 + si * 120}, ${size + 10})`}>
            <rect width="12" height="12" fill={RADAR_COLORS[si % RADAR_COLORS.length]} rx="2" />
            <text x="16" y="10" fontSize="10" fill="#374151">{series.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════
// TIMELINE COMPONENT
// ═══════════════════════════════════════

function TimelineView({ timeline }) {
  if (!timeline || !timeline.events) return null;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">Progression: {timeline.progression}%</span>
        {timeline.duree_totale_mois && <span className="text-sm text-gray-500">Duree: {timeline.duree_totale_mois} mois</span>}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${timeline.progression}%` }} />
      </div>
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
        {timeline.events.map((event, i) => {
          const isRealise = event.status === 'realise';
          const isCurrent = event.status === 'planifie';
          return (
            <div key={i} className="relative flex items-start mb-6 pl-10">
              <div className={`absolute left-2.5 w-3 h-3 rounded-full border-2 ${
                isRealise ? 'bg-green-500 border-green-500' :
                isCurrent ? 'bg-blue-500 border-blue-500 animate-pulse' :
                'bg-white border-gray-300'
              }`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${isRealise ? 'text-green-700' : isCurrent ? 'text-blue-700' : 'text-gray-500'}`}>
                    {event.label}
                  </span>
                  {event.status && event.type === 'milestone' && (
                    <span className={`text-xs px-2 py-0.5 rounded ${MILESTONE_STATUS_COLORS[event.status] || ''}`}>
                      {MILESTONE_STATUS_LABELS[event.status] || event.status}
                    </span>
                  )}
                  {event.avis_global && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      event.avis_global === 'tres_positif' || event.avis_global === 'positif' ? 'bg-green-100 text-green-700' :
                      event.avis_global === 'mitige' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                    }`}>{event.avis_global.replace('_', ' ')}</span>
                  )}
                  {event.sortie_classification && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      event.sortie_classification === 'positive' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>Sortie {event.sortie_classification}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {event.date ? new Date(event.date).toLocaleDateString('fr-FR') : 'Date non definie'}
                  {event.description && ` — ${event.description}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// BILAN PANEL — Formulaire d'un jalon
// ═══════════════════════════════════════

function BilanPanel({ milestone, employeeId, onSave, onClose }) {
  const [form, setForm] = useState({ ...milestone });
  const [template, setTemplate] = useState(null);
  const [actionPlans, setActionPlans] = useState([]);
  const [newAction, setNewAction] = useState({ action_label: '', category: 'competence', priority: 'moyenne', frein_type: '' });
  const [saving, setSaving] = useState(false);
  const [radarData, setRadarData] = useState(null);

  useEffect(() => {
    // Load CIP questionnaire template
    api.get(`/insertion/interview-template/${milestone.milestone_type}`).then(r => setTemplate(r.data)).catch(() => {});
    // Load action plans
    api.get(`/insertion/action-plans/${employeeId}`).then(r => {
      setActionPlans(r.data.filter(a => a.milestone_id === milestone.id));
    }).catch(() => {});
    // Load radar data
    api.get(`/insertion/milestones/${employeeId}/radar`).then(r => setRadarData(r.data)).catch(() => {});
  }, [milestone.id, milestone.milestone_type, employeeId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/insertion/milestones/${milestone.id}`, form);
      onSave();
    } catch (err) {
      alert('Erreur: ' + (err.response?.data?.error || err.message));
    }
    setSaving(false);
  };

  const handleAddAction = async () => {
    if (!newAction.action_label) return;
    try {
      const res = await api.post('/insertion/action-plans', {
        milestone_id: milestone.id,
        employee_id: employeeId,
        ...newAction,
      });
      setActionPlans([...actionPlans, res.data]);
      setNewAction({ action_label: '', category: 'competence', priority: 'moyenne', frein_type: '' });
    } catch (err) {
      alert('Erreur: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleUpdateAction = async (id, updates) => {
    try {
      const res = await api.put(`/insertion/action-plans/${id}`, updates);
      setActionPlans(actionPlans.map(a => a.id === id ? res.data : a));
    } catch {}
  };

  const isSortie = milestone.milestone_type === 'Bilan Sortie';

  return (
    <div className="bg-white border rounded-lg p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">{milestone.milestone_type}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">Fermer</button>
      </div>

      {/* Status et date */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Statut</label>
          <select value={form.status || 'a_planifier'} onChange={e => setForm({ ...form, status: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm">
            <option value="a_planifier">A planifier</option>
            <option value="planifie">Planifie</option>
            <option value="realise">Realise</option>
            <option value="reporte">Reporte</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date entretien</label>
          <input type="datetime-local" value={form.interview_date ? form.interview_date.substring(0, 16) : ''}
            onChange={e => setForm({ ...form, interview_date: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date realisation</label>
          <input type="date" value={form.completed_date || ''}
            onChange={e => setForm({ ...form, completed_date: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm" />
        </div>
      </div>

      {/* Questionnaire CIP */}
      {template && (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-700 border-b pb-1">{template.titre}</h4>
          <p className="text-sm text-gray-500">{template.description}</p>
          {template.sections.map((section, si) => (
            <div key={si} className="bg-gray-50 rounded p-3 space-y-2">
              <h5 className="font-medium text-gray-700 text-sm">{section.titre}</h5>
              {section.questions.map((q, qi) => (
                <p key={qi} className="text-xs text-gray-500 italic ml-2">- {q}</p>
              ))}
              <textarea value={form[section.champ] || ''} onChange={e => setForm({ ...form, [section.champ]: e.target.value })}
                placeholder={`Reponses et observations pour "${section.titre}"...`}
                className="w-full border rounded px-2 py-1 text-sm mt-1" rows={3} />
            </div>
          ))}
        </div>
      )}

      {/* Evaluation des freins */}
      <div>
        <h4 className="font-semibold text-gray-700 border-b pb-1 mb-3">Evaluation des freins</h4>
        <div className="grid grid-cols-2 gap-3">
          {FREIN_KEYS.map(key => (
            <div key={key} className="flex items-center gap-2">
              <label className="text-xs w-24 text-gray-600">{FREIN_LABELS[key]}</label>
              <input type="range" min="1" max="5" value={form[`frein_${key}`] || 1}
                onChange={e => setForm({ ...form, [`frein_${key}`]: parseInt(e.target.value) })}
                className="flex-1" />
              <span className={`text-xs px-1.5 py-0.5 rounded ${FREIN_COLORS[form[`frein_${key}`] || 1]}`}>
                {form[`frein_${key}`] || 1}/5
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Radar chart */}
      {radarData && radarData.series.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 border-b pb-1 mb-3">Evolution des freins</h4>
          <RadarChart data={radarData} />
        </div>
      )}

      {/* Bilan */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bilan professionnel</label>
          <textarea value={form.bilan_professionnel || ''} onChange={e => setForm({ ...form, bilan_professionnel: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm" rows={3} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bilan social</label>
          <textarea value={form.bilan_social || ''} onChange={e => setForm({ ...form, bilan_social: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm" rows={3} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Objectifs realises</label>
          <textarea value={form.objectifs_realises || ''} onChange={e => setForm({ ...form, objectifs_realises: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm" rows={2} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Objectifs prochaine periode</label>
          <textarea value={form.objectifs_prochaine_periode || ''} onChange={e => setForm({ ...form, objectifs_prochaine_periode: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm" rows={2} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Observations</label>
          <textarea value={form.observations || ''} onChange={e => setForm({ ...form, observations: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm" rows={2} />
        </div>
      </div>

      {/* Avis global */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Avis global</label>
        <div className="flex gap-2">
          {[['tres_positif', 'Tres positif', 'bg-green-500'], ['positif', 'Positif', 'bg-green-300'], ['mitige', 'Mitige', 'bg-yellow-400'], ['insuffisant', 'Insuffisant', 'bg-red-400']].map(([val, label, color]) => (
            <button key={val} onClick={() => setForm({ ...form, avis_global: val })}
              className={`px-3 py-1 rounded text-sm text-white ${form.avis_global === val ? color : 'bg-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Bilan Sortie specifique */}
      {isSortie && (
        <div className="bg-purple-50 border border-purple-200 rounded p-4 space-y-3">
          <h4 className="font-semibold text-purple-800">Rapport de sortie</h4>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name="sortie_class" value="positive"
                checked={form.sortie_classification === 'positive'}
                onChange={e => setForm({ ...form, sortie_classification: e.target.value })} />
              <span className="text-sm text-green-700 font-medium">Sortie positive</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="sortie_class" value="negative"
                checked={form.sortie_classification === 'negative'}
                onChange={e => setForm({ ...form, sortie_classification: e.target.value })} />
              <span className="text-sm text-red-700 font-medium">Sortie negative</span>
            </label>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type de sortie</label>
            <select value={form.sortie_type || ''} onChange={e => setForm({ ...form, sortie_type: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm">
              <option value="">Selectionner...</option>
              <option value="CDI">CDI</option>
              <option value="CDD">CDD &gt; 6 mois</option>
              <option value="CDD_court">CDD &lt; 6 mois</option>
              <option value="formation">Formation qualifiante</option>
              <option value="creation_activite">Creation d'activite</option>
              <option value="autre_IAE">Autre structure IAE</option>
              <option value="sans_suite">Sans suite / Abandon</option>
              <option value="fin_contrat">Fin de contrat sans solution</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employeur / Organisme de formation</label>
            <input type="text" value={form.sortie_employeur || ''}
              onChange={e => setForm({ ...form, sortie_employeur: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Commentaires CIP sortie</label>
            <textarea value={form.sortie_commentaires || ''}
              onChange={e => setForm({ ...form, sortie_commentaires: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm" rows={3} />
          </div>
        </div>
      )}

      {/* Plan d'action CIP */}
      <div>
        <h4 className="font-semibold text-gray-700 border-b pb-1 mb-3">Plan d'action CIP</h4>
        {actionPlans.length > 0 && (
          <div className="space-y-2 mb-3">
            {actionPlans.map(ap => (
              <div key={ap.id} className="flex items-center gap-2 bg-gray-50 rounded p-2">
                <select value={ap.status} onChange={e => handleUpdateAction(ap.id, { status: e.target.value })}
                  className="text-xs border rounded px-1 py-0.5">
                  {Object.entries(ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  ap.priority === 'haute' ? 'bg-red-100 text-red-700' : ap.priority === 'moyenne' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                }`}>{ap.priority}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{ACTION_CATEGORIES[ap.category]}</span>
                <span className="text-sm flex-1">{ap.action_label}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input type="text" value={newAction.action_label} placeholder="Nouvelle action..."
            onChange={e => setNewAction({ ...newAction, action_label: e.target.value })}
            className="flex-1 border rounded px-2 py-1 text-sm" />
          <select value={newAction.category} onChange={e => setNewAction({ ...newAction, category: e.target.value })}
            className="border rounded px-1 py-1 text-xs">
            {Object.entries(ACTION_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={newAction.priority} onChange={e => setNewAction({ ...newAction, priority: e.target.value })}
            className="border rounded px-1 py-1 text-xs">
            <option value="haute">Haute</option>
            <option value="moyenne">Moyenne</option>
            <option value="basse">Basse</option>
          </select>
          <button onClick={handleAddAction} className="btn-primary text-xs">+</button>
        </div>
      </div>

      {/* Bouton sauvegarder */}
      <div className="flex justify-end gap-2 pt-2 border-t">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Enregistrement...' : 'Enregistrer le bilan'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// AI RECOMMENDATIONS PANEL
// ═══════════════════════════════════════

function AIRecommendationsPanel({ recommendations }) {
  if (!recommendations) return null;
  const { alertes, propositions, accompagnement } = recommendations;

  return (
    <div className="space-y-4">
      {alertes && alertes.length > 0 && (
        <div>
          <h4 className="font-semibold text-red-700 text-sm mb-2">Alertes IA</h4>
          {alertes.map((a, i) => (
            <div key={i} className={`p-2 rounded mb-1 text-sm ${a.urgence === 'haute' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
              <div className="font-medium">{a.message}</div>
              {a.actions_suggerees && a.actions_suggerees.length > 0 && (
                <ul className="mt-1 text-xs text-gray-600 list-disc list-inside">
                  {a.actions_suggerees.map((act, j) => <li key={j}>{act}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {propositions && propositions.length > 0 && (
        <div>
          <h4 className="font-semibold text-blue-700 text-sm mb-2">Propositions IA</h4>
          {propositions.map((p, i) => (
            <div key={i} className="p-2 rounded mb-1 text-sm bg-blue-50 border border-blue-200">
              <div className="font-medium">{p.message}</div>
              {p.detail && <div className="text-xs text-gray-600 mt-0.5">{p.detail}</div>}
            </div>
          ))}
        </div>
      )}
      {accompagnement && accompagnement.length > 0 && (
        <div>
          <h4 className="font-semibold text-purple-700 text-sm mb-2">Accompagnement CIP</h4>
          {accompagnement.map((a, i) => (
            <div key={i} className="p-2 rounded mb-1 text-sm bg-purple-50 border border-purple-200">
              <div className="font-medium">{a.message}</div>
              {a.detail && <div className="text-xs text-gray-600 mt-0.5">{a.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════

export default function InsertionParcours() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState('timeline');
  const [activeBilan, setActiveBilan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [savingDiag, setSavingDiag] = useState(false);
  const [freinsDefinitions, setFreinsDefinitions] = useState(null);

  const [loadError, setLoadError] = useState(null);
  const [iaAnalyse, setIaAnalyse] = useState(null);
  const [iaEntretien, setIaEntretien] = useState(null);
  const [iaCohorte, setIaCohorte] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);

  const loadEmployees = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await api.get('/insertion');
      setEmployees(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('[InsertionParcours] Erreur chargement:', err);
      setLoadError(err.response?.data?.detail || err.message || 'Erreur de chargement');
    }
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => {
    api.get('/insertion/freins-definitions').then(r => setFreinsDefinitions(r.data)).catch(() => {});
  }, []);

  const selectEmployee = async (emp) => {
    setSelectedEmployee(emp);
    setActiveTab('timeline');
    setActiveBilan(null);
    setLoading(true);
    try {
      const [analysisRes, diagRes] = await Promise.all([
        api.get(`/insertion/${emp.id}`),
        api.get(`/insertion/diagnostic/${emp.id}`),
      ]);
      setAnalysis(analysisRes.data);
      setDiagnostic(diagRes.data || {});
    } catch {}
    setLoading(false);
  };

  const initializeMilestones = async () => {
    if (!selectedEmployee) return;
    try {
      await api.post(`/insertion/milestones/${selectedEmployee.id}/initialize`);
      selectEmployee(selectedEmployee);
    } catch (err) {
      alert('Erreur: ' + (err.response?.data?.error || err.message));
    }
  };

  const saveDiagnostic = async () => {
    if (!selectedEmployee || !diagnostic) return;
    setSavingDiag(true);
    try {
      await api.put(`/insertion/diagnostic/${selectedEmployee.id}`, diagnostic);
      selectEmployee(selectedEmployee);
    } catch (err) {
      alert('Erreur: ' + (err.response?.data?.error || err.message));
    }
    setSavingDiag(false);
  };

  const tabs = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'diagnostic', label: 'Diagnostic CIP' },
    { id: 'bilans', label: 'Bilans & Jalons' },
    { id: 'freins', label: 'Freins' },
    { id: 'analyse', label: 'Analyse IA' },
    { id: 'ai', label: 'Recommandations IA' },
  ];

  return (
    <Layout>
      <div className="p-4 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Parcours d'insertion</h1>

        <div className="grid grid-cols-12 gap-4">
          {/* Liste employes */}
          <div className="col-span-3 bg-white rounded-lg border p-3 max-h-[80vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-700 mb-2">Salaries en parcours ({employees.length})</h2>
            {loadError && <div className="text-red-600 text-xs mb-2 p-2 bg-red-50 rounded">{loadError}</div>}
            {!loadError && employees.length === 0 && <div className="text-gray-400 text-sm p-2">Aucun salarie actif trouve</div>}
            {employees.map(emp => (
              <button key={emp.id} onClick={() => selectEmployee(emp)}
                className={`w-full text-left p-2 rounded mb-1 text-sm transition ${
                  selectedEmployee?.id === emp.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                }`}>
                <div className="font-medium">{emp.first_name} {emp.last_name}</div>
                <div className="text-xs text-gray-500">{emp.team_name || 'Equipe ?'} - {emp.position || 'Poste ?'}</div>
                <div className="flex gap-1 mt-1">
                  {emp.has_pcm && <span className="text-xs px-1 rounded bg-purple-100 text-purple-700">PCM</span>}
                  {emp.has_diagnostic && <span className="text-xs px-1 rounded bg-green-100 text-green-700">Diag</span>}
                  {emp.urgency && <span className={`text-xs px-1 rounded ${URGENCY_COLORS[emp.urgency]}`}>{emp.urgency}</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Contenu principal */}
          <div className="col-span-9 space-y-4">
            {!selectedEmployee && (
              <div className="bg-white rounded-lg border p-8 text-center text-gray-400">
                Selectionnez un salarie pour voir son parcours d'insertion
              </div>
            )}

            {selectedEmployee && loading && (
              <LoadingSpinner size="lg" message="Chargement des parcours..." />
            )}

            {selectedEmployee && !loading && analysis && (
              <>
                {/* Header employe */}
                <div className="bg-white rounded-lg border p-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">{analysis.employee.first_name} {analysis.employee.last_name}</h2>
                    <div className="text-sm text-gray-500">
                      {analysis.employee.position} - {analysis.employee.team_name}
                      {analysis.employee.insertion_start_date && ` | Debut: ${new Date(analysis.employee.insertion_start_date).toLocaleDateString('fr-FR')}`}
                    </div>
                    <div className="flex gap-2 mt-1">
                      {analysis.has_pcm && <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">PCM recrutement</span>}
                      {analysis.has_diagnostic && <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">Diagnostic CIP</span>}
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                        Confiance: {Math.round((analysis.confiance || 0) * 100)}%
                      </span>
                    </div>
                  </div>
                  <button onClick={initializeMilestones}
                    className="btn-primary text-sm">
                    Initialiser jalons
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-white rounded-lg border p-1">
                  {tabs.map(tab => (
                    <button key={tab.id} onClick={() => { setActiveTab(tab.id); setActiveBilan(null); }}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                        activeTab === tab.id ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab: Timeline */}
                {activeTab === 'timeline' && analysis.timeline && (
                  <div className="bg-white rounded-lg border p-4">
                    <h3 className="font-semibold text-gray-800 mb-4">Timeline du parcours</h3>
                    <TimelineView timeline={analysis.timeline} />
                  </div>
                )}

                {/* Tab: Diagnostic CIP */}
                {activeTab === 'diagnostic' && diagnostic && (
                  <div className="bg-white rounded-lg border p-4 space-y-4">
                    <h3 className="font-semibold text-gray-800">Diagnostic CIP</h3>
                    <p className="text-sm text-gray-500">Remplir lors du diagnostic d'accueil (M+1 max). Le PCM est automatiquement recupere depuis le module recrutement.</p>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Parcours anterieur</label>
                      <textarea value={diagnostic.parcours_anterieur || ''} onChange={e => setDiagnostic({ ...diagnostic, parcours_anterieur: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm" rows={3} />
                    </div>

                    {/* Freins avec questions indirectes */}
                    <h4 className="font-semibold text-gray-700 border-b pb-1">Evaluation des freins</h4>
                    <p className="text-xs text-gray-400">Utilisez les questions ci-dessous pour guider l'entretien. Evaluez ensuite le niveau de frein.</p>
                    {freinsDefinitions && FREIN_KEYS.map(key => {
                      const def = freinsDefinitions[key];
                      if (!def) return null;
                      return (
                        <div key={key} className="bg-gray-50 rounded p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <h5 className="font-medium text-gray-700">{def.label}</h5>
                            <div className="flex items-center gap-2">
                              <input type="range" min="1" max="5" value={diagnostic[`frein_${key}`] || 1}
                                onChange={e => setDiagnostic({ ...diagnostic, [`frein_${key}`]: parseInt(e.target.value) })} />
                              <span className={`text-xs px-1.5 py-0.5 rounded ${FREIN_COLORS[diagnostic[`frein_${key}`] || 1]}`}>
                                {diagnostic[`frein_${key}`] || 1}/5
                              </span>
                            </div>
                          </div>
                          {def.questions_indirectes && def.questions_indirectes.map((qi, i) => (
                            <p key={i} className="text-xs text-gray-500 italic ml-2">- {qi.q}</p>
                          ))}
                          <textarea value={diagnostic[`frein_${key}_detail`] || ''}
                            onChange={e => setDiagnostic({ ...diagnostic, [`frein_${key}_detail`]: e.target.value })}
                            placeholder={`Observations ${def.label}...`}
                            className="w-full border rounded px-2 py-1 text-xs" rows={2} />
                        </div>
                      );
                    })}

                    {/* Observations & preferences */}
                    <h4 className="font-semibold text-gray-700 border-b pb-1">Observations professionnelles</h4>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ['obs_points_forts', 'Points forts observes'], ['obs_difficultes', 'Difficultes observees'],
                        ['obs_comportement_equipe', 'Comportement en equipe'], ['obs_autonomie_ponctualite', 'Autonomie / Ponctualite'],
                        ['pref_aime_faire', 'Ce que la personne aime faire'], ['pref_ne_veut_plus', 'Ce qu\'elle ne veut plus faire'],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <label className="block text-xs text-gray-500 mb-1">{label}</label>
                          <textarea value={diagnostic[key] || ''} onChange={e => setDiagnostic({ ...diagnostic, [key]: e.target.value })}
                            className="w-full border rounded px-2 py-1 text-sm" rows={2} />
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end pt-2 border-t">
                      <button onClick={saveDiagnostic} disabled={savingDiag}
                        className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                        {savingDiag ? 'Enregistrement...' : 'Enregistrer le diagnostic'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Tab: Bilans & Jalons */}
                {activeTab === 'bilans' && (
                  <div className="space-y-4">
                    {activeBilan ? (
                      <BilanPanel milestone={activeBilan} employeeId={selectedEmployee.id}
                        onSave={() => { setActiveBilan(null); selectEmployee(selectedEmployee); }}
                        onClose={() => setActiveBilan(null)} />
                    ) : (
                      <div className="bg-white rounded-lg border p-4">
                        <h3 className="font-semibold text-gray-800 mb-4">Jalons du parcours</h3>
                        {(!analysis.milestones || analysis.milestones.length === 0) ? (
                          <div className="text-center text-gray-400 py-4">
                            Aucun jalon. Cliquez sur "Initialiser jalons" pour creer le parcours.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {analysis.milestones.map(ms => (
                              <button key={ms.id} onClick={() => setActiveBilan(ms)}
                                className="w-full text-left p-3 rounded border hover:bg-gray-50 transition flex items-center justify-between">
                                <div>
                                  <span className="font-medium text-gray-800">{ms.milestone_type}</span>
                                  <span className="text-xs text-gray-500 ml-2">
                                    Echeance: {ms.due_date ? new Date(ms.due_date).toLocaleDateString('fr-FR') : '?'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {ms.avis_global && (
                                    <span className={`text-xs px-2 py-0.5 rounded ${
                                      ms.avis_global === 'tres_positif' || ms.avis_global === 'positif' ? 'bg-green-100 text-green-700' :
                                      ms.avis_global === 'mitige' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                                    }`}>{ms.avis_global.replace('_', ' ')}</span>
                                  )}
                                  <span className={`text-xs px-2 py-0.5 rounded ${MILESTONE_STATUS_COLORS[ms.status]}`}>
                                    {MILESTONE_STATUS_LABELS[ms.status]}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Freins */}
                {activeTab === 'freins' && analysis.freins_sociaux && (
                  <div className="bg-white rounded-lg border p-4 space-y-4">
                    <h3 className="font-semibold text-gray-800">Cartographie des freins</h3>
                    <div className="space-y-2">
                      {analysis.freins_sociaux.freins.map(f => (
                        <div key={f.type} className="flex items-center gap-3 p-2 rounded bg-gray-50">
                          <span className="w-24 text-sm font-medium text-gray-700">{f.label}</span>
                          <div className="flex-1 bg-gray-200 rounded-full h-3">
                            <div className={`h-3 rounded-full ${
                              f.niveau <= 2 ? 'bg-green-500' : f.niveau === 3 ? 'bg-yellow-500' : f.niveau === 4 ? 'bg-orange-500' : 'bg-red-500'
                            }`} style={{ width: `${f.niveau * 20}%` }} />
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded ${FREIN_COLORS[f.niveau]}`}>{f.niveau}/5</span>
                        </div>
                      ))}
                    </div>
                    {analysis.freins_sociaux.plan_actions.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-700 mt-4 mb-2">Actions prioritaires</h4>
                        {analysis.freins_sociaux.plan_actions.map((a, i) => (
                          <div key={i} className={`p-2 rounded mb-1 text-sm ${a.priorite === 'haute' ? 'bg-red-50 border-l-4 border-red-400' : 'bg-yellow-50 border-l-4 border-yellow-400'}`}>
                            <div className="font-medium">{a.action}</div>
                            <div className="text-xs text-gray-500">{a.detail} — Echeance: {a.echeance}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Analyse IA */}
                {activeTab === 'analyse' && analysis && (
                  <div className="space-y-4">
                    {analysis.fiche_synthese && (
                      <div className="bg-white rounded-lg border p-4">
                        <h3 className="font-semibold text-gray-800 mb-2">Fiche synthese</h3>
                        <p className="text-sm text-gray-700">{analysis.fiche_synthese.resume}</p>
                        {analysis.fiche_synthese.forces?.length > 0 && (
                          <div className="mt-2">
                            <span className="text-xs font-medium text-green-700">Forces: </span>
                            <span className="text-xs text-gray-600">{analysis.fiche_synthese.forces.join(', ')}</span>
                          </div>
                        )}
                        <div className="flex gap-2 mt-2 text-xs">
                          {analysis.data_sources && Object.values(analysis.data_sources).filter(s => s.available).map((s, i) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">{s.label}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.pistes_metiers?.length > 0 && (
                      <div className="bg-white rounded-lg border p-4">
                        <h3 className="font-semibold text-gray-800 mb-2">Pistes metiers</h3>
                        {analysis.pistes_metiers.slice(0, 3).map((p, i) => (
                          <div key={i} className="flex items-center gap-3 p-2 rounded bg-gray-50 mb-1">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold"
                              style={{ backgroundColor: p.score >= 70 ? '#10B981' : p.score >= 50 ? '#F59E0B' : '#EF4444' }}>
                              {p.score}%
                            </div>
                            <div className="flex-1">
                              <div className="font-medium text-sm">{p.metier}</div>
                              <div className="text-xs text-gray-500">{p.pourquoi}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Recommandations IA */}
                {activeTab === 'ai' && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-lg border p-4">
                      <h3 className="font-semibold text-gray-800 mb-4">Recommandations algorithmiques</h3>
                      <AIRecommendationsPanel recommendations={analysis.ai_recommendations} />
                      {(!analysis.ai_recommendations ||
                        (!analysis.ai_recommendations.alertes?.length && !analysis.ai_recommendations.propositions?.length && !analysis.ai_recommendations.accompagnement?.length)) && (
                        <p className="text-sm text-gray-400 text-center py-4">Pas de recommandation pour le moment. Completez le diagnostic et les bilans.</p>
                      )}
                    </div>

                    {/* Analyse IA Claude */}
                    <div className="bg-white rounded-lg border p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-800">Analyse IA approfondie (Claude)</h3>
                        <div className="flex gap-2">
                          <button onClick={async () => {
                            setIaLoading(true);
                            try {
                              const res = await api.get(`/insertion/ia/profil/${selectedEmployee.id}`);
                              setIaAnalyse(res.data);
                            } catch (err) { setIaAnalyse({ synthese: err.response?.data?.error || 'Erreur' }); }
                            setIaLoading(false);
                          }} disabled={iaLoading}
                            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
                            {iaLoading ? 'Analyse...' : 'Analyser le profil'}
                          </button>
                          <button onClick={async () => {
                            setIaLoading(true);
                            try {
                              const nextMilestone = analysis.milestones?.find(m => m.status !== 'realise');
                              const mType = nextMilestone?.milestone_type || 'Bilan M+3';
                              const res = await api.get(`/insertion/ia/entretien/${selectedEmployee.id}?type=${encodeURIComponent(mType)}`);
                              setIaEntretien(res.data);
                            } catch (err) { setIaEntretien({ intro_conseillee: err.response?.data?.error || 'Erreur' }); }
                            setIaLoading(false);
                          }} disabled={iaLoading}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                            Preparer entretien
                          </button>
                        </div>
                      </div>

                      {iaAnalyse && (
                        <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 mb-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-violet-800 text-sm">Analyse profil</h4>
                            {iaAnalyse.score_progression != null && (
                              <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                                iaAnalyse.score_progression >= 60 ? 'bg-emerald-100 text-emerald-700' :
                                iaAnalyse.score_progression >= 30 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                              }`}>Progression : {iaAnalyse.score_progression}%</span>
                            )}
                          </div>
                          {iaAnalyse.synthese && <p className="text-sm text-slate-700">{iaAnalyse.synthese}</p>}
                          {iaAnalyse.pcm_adaptation && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              <div className="bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Communication :</span> {iaAnalyse.pcm_adaptation.communication}</div>
                              <div className="bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Management :</span> {iaAnalyse.pcm_adaptation.management}</div>
                            </div>
                          )}
                          {iaAnalyse.risque_decrochage && (
                            <div className={`text-xs rounded-lg p-2 border ${
                              iaAnalyse.risque_decrochage.niveau === 'eleve' ? 'bg-red-50 border-red-200 text-red-700' :
                              iaAnalyse.risque_decrochage.niveau === 'moyen' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                              'bg-green-50 border-green-200 text-green-700'
                            }`}>
                              Risque decrochage : <strong>{iaAnalyse.risque_decrochage.niveau}</strong>
                              {iaAnalyse.risque_decrochage.facteurs?.length > 0 && ` — ${iaAnalyse.risque_decrochage.facteurs.join(', ')}`}
                            </div>
                          )}
                          {iaAnalyse.plan_action_propose?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-violet-700 mb-1">Plan d'action propose</p>
                              <div className="space-y-1">
                                {iaAnalyse.plan_action_propose.map((a, i) => (
                                  <div key={i} className="text-xs bg-white rounded p-2 border flex justify-between">
                                    <span>{a.action}</span>
                                    <span className="text-gray-400 ml-2">{a.echeance}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {iaAnalyse.prochaine_etape && (
                            <div className="text-xs bg-teal-50 rounded-lg p-2 border border-teal-200 text-teal-800">
                              <strong>Prochaine etape :</strong> {iaAnalyse.prochaine_etape}
                            </div>
                          )}
                        </div>
                      )}

                      {iaEntretien && (
                        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 space-y-3">
                          <h4 className="font-semibold text-blue-800 text-sm">Guide d'entretien</h4>
                          {iaEntretien.intro_conseillee && (
                            <div className="text-xs bg-white rounded-lg p-2 border">
                              <span className="font-semibold text-blue-700">Introduction :</span> {iaEntretien.intro_conseillee}
                            </div>
                          )}
                          {iaEntretien.questions_cles?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-blue-700 mb-1">Questions cles</p>
                              <div className="space-y-1">
                                {iaEntretien.questions_cles.map((q, i) => (
                                  <div key={i} className="text-xs bg-white rounded p-2 border">
                                    <p className="font-medium text-gray-800">{q.question}</p>
                                    {q.conseil_pcm && <p className="text-gray-400 mt-0.5 italic">{q.conseil_pcm}</p>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {iaEntretien.conclusion_conseillee && (
                            <div className="text-xs bg-white rounded-lg p-2 border">
                              <span className="font-semibold text-blue-700">Conclusion :</span> {iaEntretien.conclusion_conseillee}
                            </div>
                          )}
                          {iaEntretien.duree_estimee && (
                            <p className="text-[10px] text-blue-500">Duree estimee : {iaEntretien.duree_estimee}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
