import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import { Heart } from 'lucide-react';
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

// Section repliable (questionnaire progressif) — évite le « mur de champs ».
// `badge` affiche le remplissage (ex. « 3/7 ») sans avoir à déplier.
function Collapsible({ title, subtitle, defaultOpen = true, badge, badgeTone = 'slate', children }) {
  const [open, setOpen] = useState(defaultOpen);
  const tones = { slate: 'bg-slate-200 text-slate-600', green: 'bg-green-100 text-green-700', amber: 'bg-amber-100 text-amber-700' };
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left">
        <span className="text-sm font-semibold text-slate-700">
          {title}{subtitle && <span className="ml-2 text-xs font-normal text-slate-400">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2">
          {badge != null && <span className={`text-xs px-2 py-0.5 rounded-full ${tones[badgeTone] || tones.slate}`}>{badge}</span>}
          <span className={`text-slate-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        </span>
      </button>
      {open && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
}

// Compte les champs non vides parmi une liste de clés d'un objet.
const countFilled = (obj, keys) => keys.filter((k) => { const v = obj && obj[k]; return v != null && v !== '' && v !== 0; }).length;

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

function BilanPanel({ milestone, employeeId, employeeName, allMilestones, onSave, onClose, onDirtyChange }) {
  const [form, setForm] = useState({ ...milestone });
  const [template, setTemplate] = useState(null);
  const [actionPlans, setActionPlans] = useState([]);
  const [newAction, setNewAction] = useState({ action_label: '', category: 'competence', priority: 'moyenne', frein_type: '' });
  const [saving, setSaving] = useState(false);
  const [radarData, setRadarData] = useState(null);
  const [bilanError, setBilanError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const markDirty = () => { setDirty(true); if (onDirtyChange) onDirtyChange(true); };
  const clearDirty = () => { setDirty(false); if (onDirtyChange) onDirtyChange(false); };
  const requestClose = () => {
    if (dirty && !window.confirm('Des modifications de ce bilan ne sont pas enregistrées. Fermer sans enregistrer ?')) return;
    clearDirty(); onClose();
  };

  useEffect(() => {
    // Pré-remplissage : si ce jalon n'a pas encore de freins, reprendre ceux du
    // dernier jalon réalisé, et les objectifs « prochaine période » précédents.
    const hasFreins = FREIN_KEYS.some((k) => milestone[`frein_${k}`]);
    if (!hasFreins && Array.isArray(allMilestones)) {
      const prev = allMilestones
        .filter((m) => m.id !== milestone.id && m.status === 'realise' && FREIN_KEYS.some((k) => m[`frein_${k}`]))
        .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))[0];
      if (prev) {
        setForm((f) => {
          const next = { ...f };
          FREIN_KEYS.forEach((k) => { if (!next[`frein_${k}`] && prev[`frein_${k}`]) next[`frein_${k}`] = prev[`frein_${k}`]; });
          if (!next.objectifs_realises && prev.objectifs_prochaine_periode) next.objectifs_realises = prev.objectifs_prochaine_periode;
          return next;
        });
      }
    }
    api.get(`/insertion/interview-template/${milestone.milestone_type}`).then(r => setTemplate(r.data)).catch(() => setBilanError('Questionnaire indisponible — rechargez la page.'));
    api.get(`/insertion/action-plans/${employeeId}`).then(r => {
      setActionPlans(r.data.filter(a => a.milestone_id === milestone.id));
    }).catch(() => setBilanError('Plans d\'action indisponibles — rechargez la page.'));
    api.get(`/insertion/milestones/${employeeId}/radar`).then(r => setRadarData(r.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestone.id, milestone.milestone_type, employeeId]);

  const handleSave = async () => {
    setSaving(true); setBilanError(null);
    try {
      await api.put(`/insertion/milestones/${milestone.id}`, form);
      clearDirty();
      onSave();
    } catch (err) {
      setBilanError('Erreur : ' + (err.response?.data?.error || err.message));
    }
    setSaving(false);
  };

  const handleAddAction = async () => {
    if (!newAction.action_label) return;
    setBilanError(null);
    try {
      const res = await api.post('/insertion/action-plans', {
        milestone_id: milestone.id,
        employee_id: employeeId,
        ...newAction,
      });
      setActionPlans([...actionPlans, res.data]);
      setNewAction({ action_label: '', category: 'competence', priority: 'moyenne', frein_type: '' });
    } catch (err) {
      setBilanError('Erreur : ' + (err.response?.data?.error || err.message));
    }
  };

  const handleUpdateAction = async (id, updates) => {
    try {
      const res = await api.put(`/insertion/action-plans/${id}`, updates);
      setActionPlans(actionPlans.map(a => a.id === id ? res.data : a));
    } catch (err) { setBilanError('Erreur mise à jour action : ' + (err.response?.data?.error || err.message)); }
  };

  const isSortie = milestone.milestone_type === 'Bilan Sortie';
  const nbFreinsEval = FREIN_KEYS.filter((k) => form['frein_' + k]).length;
  const nbQuestionnaire = template ? countFilled(form, template.sections.map((s) => s.champ)) : 0;
  const nbBilan = countFilled(form, ['bilan_professionnel', 'bilan_social', 'objectifs_realises', 'objectifs_prochaine_periode', 'observations']);

  return (
    <div className="bg-white border rounded-lg p-4 space-y-6" onChange={markDirty}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">{milestone.milestone_type}{dirty && <span className="ml-2 text-xs text-amber-600 font-normal">• non enregistré</span>}</h3>
        <div className="flex items-center gap-3">
          <button onClick={() => exportBilanJalonPDF(employeeName || '', form)} className="text-teal-700 text-sm font-medium hover:underline">Exporter PDF</button>
          <button onClick={requestClose} className="text-gray-400 hover:text-gray-600">Fermer</button>
        </div>
      </div>

      {bilanError && (
        <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{bilanError}</span>
          <button onClick={() => setBilanError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {/* Status et date */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Statut</label>
          <select value={form.status || 'a_planifier'} onChange={e => setForm({ ...form, status: e.target.value })}
            className="input-modern py-1">
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
            className="input-modern py-1" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date realisation</label>
          <input type="date" value={form.completed_date || ''}
            onChange={e => setForm({ ...form, completed_date: e.target.value })}
            className="input-modern py-1" />
        </div>
      </div>

      {/* Questionnaire CIP */}
      {template && (
        <Collapsible title={template.titre || "Questionnaire d'entretien"} defaultOpen
          badge={nbQuestionnaire + '/' + template.sections.length}
          badgeTone={nbQuestionnaire === template.sections.length ? 'green' : (nbQuestionnaire ? 'amber' : 'slate')}>
          <p className="text-sm text-gray-500">{template.description}</p>
          {template.sections.map((section, si) => (
            <div key={si} className="bg-gray-50 rounded p-3 space-y-2">
              <h5 className="font-medium text-gray-700 text-sm">{section.titre}</h5>
              {section.questions.map((q, qi) => (
                <p key={qi} className="text-xs text-gray-500 italic ml-2">- {q}</p>
              ))}
              <textarea value={form[section.champ] || ''} onChange={e => setForm({ ...form, [section.champ]: e.target.value })}
                placeholder={`Reponses et observations pour "${section.titre}"...`}
                className="input-modern py-1 mt-1" rows={3} />
            </div>
          ))}
        </Collapsible>
      )}

      {/* Evaluation des freins */}
      <Collapsible title="Évaluation des freins" defaultOpen badge={nbFreinsEval + '/7'}
        badgeTone={nbFreinsEval === 7 ? 'green' : (nbFreinsEval ? 'amber' : 'slate')}>
        <div className="grid grid-cols-2 gap-3">
          {FREIN_KEYS.map(key => (
            <div key={key} className="flex items-center gap-2">
              <label className="text-xs w-24 text-gray-600">{FREIN_LABELS[key]}</label>
              <input type="range" min="1" max="5" value={form[`frein_${key}`] || 3}
                onChange={e => setForm({ ...form, [`frein_${key}`]: parseInt(e.target.value) })}
                className="flex-1" />
              <span className={`text-xs px-1.5 py-0.5 rounded ${form[`frein_${key}`] ? FREIN_COLORS[form[`frein_${key}`]] : 'bg-gray-100 text-gray-400'}`}>
                {form[`frein_${key}`] ? `${form[`frein_${key}`]}/5` : 'à évaluer'}
              </span>
            </div>
          ))}
        </div>
      </Collapsible>

      {/* Radar chart */}
      {radarData && radarData.series.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 border-b pb-1 mb-3">Evolution des freins</h4>
          <RadarChart data={radarData} />
        </div>
      )}

      {/* Bilan */}
      <Collapsible title="Bilan & objectifs" defaultOpen badge={nbBilan + '/5'} badgeTone={nbBilan === 5 ? 'green' : (nbBilan ? 'amber' : 'slate')}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bilan professionnel</label>
          <textarea value={form.bilan_professionnel || ''} onChange={e => setForm({ ...form, bilan_professionnel: e.target.value })}
            className="input-modern py-1" rows={3} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bilan social</label>
          <textarea value={form.bilan_social || ''} onChange={e => setForm({ ...form, bilan_social: e.target.value })}
            className="input-modern py-1" rows={3} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Objectifs realises</label>
          <textarea value={form.objectifs_realises || ''} onChange={e => setForm({ ...form, objectifs_realises: e.target.value })}
            className="input-modern py-1" rows={2} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Objectifs prochaine periode</label>
          <textarea value={form.objectifs_prochaine_periode || ''} onChange={e => setForm({ ...form, objectifs_prochaine_periode: e.target.value })}
            className="input-modern py-1" rows={2} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Observations</label>
          <textarea value={form.observations || ''} onChange={e => setForm({ ...form, observations: e.target.value })}
            className="input-modern py-1" rows={2} />
        </div>
      </div>
      </Collapsible>

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
              className="input-modern py-1">
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
              className="input-modern py-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">SIRET employeur (optionnel)</label>
              <input type="text" pattern="\d{14}" maxLength="14"
                value={form.sortie_employeur_siret || ''}
                onChange={e => setForm({ ...form, sortie_employeur_siret: e.target.value })}
                className="input-modern py-1" placeholder="14 chiffres" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Durée contrat (mois)</label>
              <input type="number" min="0" max="60"
                value={form.sortie_duree_contrat_mois || ''}
                onChange={e => setForm({ ...form, sortie_duree_contrat_mois: e.target.value ? parseInt(e.target.value) : null })}
                className="input-modern py-1" placeholder="ex: 12" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Commentaires CIP sortie</label>
            <textarea value={form.sortie_commentaires || ''}
              onChange={e => setForm({ ...form, sortie_commentaires: e.target.value })}
              className="input-modern py-1" rows={3} />
          </div>
        </div>
      )}

      {/* Plan d'action CIP */}
      <Collapsible title="Plan d'action CIP" defaultOpen={actionPlans.length > 0} badge={actionPlans.length || null} badgeTone="amber">
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
            className="input-modern py-1 flex-1" />
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
      </Collapsible>

      {/* Bouton sauvegarder */}
      <div className="flex justify-end gap-2 pt-2 border-t">
        <button onClick={requestClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
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

// ═══════════════════════════════════════
// EXPORT PDF (impression navigateur A4 — même mécanisme que le PCM)
// ═══════════════════════════════════════

const MILESTONE_STATUS_HEX = { a_planifier: '#6b7280', planifie: '#2563eb', realise: '#16a34a', reporte: '#ea580c' };
const FREIN_LABEL_BY_KEY = { frein_mobilite: 'Mobilité', frein_sante: 'Santé', frein_finances: 'Finances', frein_famille: 'Famille', frein_linguistique: 'Langue', frein_administratif: 'Administratif', frein_numerique: 'Numérique' };

function openPrintWindow(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (!w) { alert('Popup bloquée — autorisez les popups pour exporter le PDF.'); return; }
  w.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>' + title + '</title><style>'
    + '@page { size: A4; margin: 15mm 12mm; }'
    + '* { box-sizing: border-box; margin: 0; padding: 0; }'
    + "body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.45; }"
    + '.header { background: #0D9488; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }'
    + '.header h1 { font-size: 18px; font-weight: 700; }'
    + '.header .sub { font-size: 11px; opacity: .9; }'
    + '.section { margin: 12px 0; padding: 0 4px; }'
    + '.section-title { font-size: 13px; font-weight: 700; color: #0D9488; border-bottom: 2px solid #0D9488; padding-bottom: 3px; margin-bottom: 8px; }'
    + '.card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; white-space: pre-wrap; }'
    + '.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: white; font-size: 10px; font-weight: 600; }'
    + 'table { width: 100%; border-collapse: collapse; font-size: 10px; }'
    + 'th { background: #f9fafb; text-align: left; padding: 5px 6px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }'
    + 'td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }'
    + '.footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; }'
    + '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
    + '</style></head><body>' + bodyHtml + '</body></html>');
  w.document.close();
  setTimeout(() => w.print(), 400);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

function exportFicheParcoursPDF(analysis, diagnostic) {
  const e = analysis.employee || {};
  const nom = (e.first_name || '') + ' ' + (e.last_name || '');
  const today = new Date().toLocaleDateString('fr-FR');

  const freinsRows = FREIN_KEYS.map((k) => {
    const v = diagnostic && diagnostic['frein_' + k];
    const det = diagnostic && diagnostic['frein_' + k + '_detail'];
    return '<tr><td>' + esc(FREIN_LABELS[k]) + '</td><td>' + (v ? v + '/5' : '<em>non évalué</em>') + '</td><td>' + esc(det || '') + '</td></tr>';
  }).join('');

  const jalonsRows = (analysis.milestones || []).map((m) =>
    '<tr><td>' + esc(m.milestone_type) + '</td><td><span class="badge" style="background:' + (MILESTONE_STATUS_HEX[m.status] || '#6b7280') + '">' + esc(MILESTONE_STATUS_LABELS[m.status] || m.status) + '</span></td><td>' + frDate(m.due_date) + '</td><td>' + frDate(m.completed_date) + '</td></tr>'
  ).join('');

  const presc = e.prescripteur_nom ? esc(e.prescripteur_nom) + (e.prescripteur_type ? ' (' + esc(e.prescripteur_type) + ')' : '') : (e.prescripteur ? esc(e.prescripteur) : '—');

  const body =
    '<div class="header"><div><h1>SOLIDATA — Fiche parcours d\'insertion</h1>'
    + '<div class="sub">' + esc(nom) + ' — édité le ' + today + '</div></div>'
    + '<div class="sub" style="text-align:right">Suivi CIP</div></div>'
    + '<div class="section"><div class="section-title">Situation</div><div class="card">'
    + '<strong>Poste :</strong> ' + esc(e.position || '—') + '   <strong>Équipe :</strong> ' + esc(e.team_name || '—') + '\n'
    + '<strong>Début de parcours :</strong> ' + frDate(e.insertion_start_date) + '   <strong>Fin de contrat :</strong> ' + frDate(e.contract_end) + '\n'
    + '<strong>Prescripteur / orienteur :</strong> ' + presc + '</div></div>'
    + '<div class="section"><div class="section-title">Diagnostic — parcours antérieur</div><div class="card">' + esc((diagnostic && diagnostic.parcours_anterieur) || '—') + '</div></div>'
    + '<div class="section"><div class="section-title">Freins périphériques</div><table><thead><tr><th>Frein</th><th>Niveau</th><th>Observations</th></tr></thead><tbody>' + freinsRows + '</tbody></table></div>'
    + '<div class="section"><div class="section-title">Jalons du parcours</div><table><thead><tr><th>Jalon</th><th>Statut</th><th>Échéance</th><th>Réalisé le</th></tr></thead><tbody>' + jalonsRows + '</tbody></table></div>'
    + '<div class="footer">SOLIDATA ERP — Document confidentiel (RGPD) — ' + today + '</div>';

  openPrintWindow('Parcours_' + (e.last_name || e.id), body);
}

function exportBilanJalonPDF(employeeName, ms) {
  const today = new Date().toLocaleDateString('fr-FR');
  const sections = [
    ['cip_integration', 'Intégration / accueil'], ['cip_competences', 'Compétences'],
    ['cip_projet_pro', 'Projet professionnel'], ['cip_socialisation', 'Vie sociale / quotidien'],
    ['bilan_professionnel', 'Bilan professionnel'], ['bilan_social', 'Bilan social'],
    ['objectifs_realises', 'Objectifs réalisés'], ['objectifs_prochaine_periode', 'Objectifs — prochaine période'],
    ['observations', 'Observations'],
  ].filter(([k]) => ms[k]).map(([k, label]) =>
    '<div class="section"><div class="section-title">' + label + '</div><div class="card">' + esc(ms[k]) + '</div></div>'
  ).join('');

  const freins = FREIN_KEYS.map((k) => ms['frein_' + k] ? esc(FREIN_LABELS[k]) + ' ' + ms['frein_' + k] + '/5' : null).filter(Boolean).join(' · ') || '—';

  const body =
    '<div class="header"><div><h1>SOLIDATA — Bilan ' + esc(ms.milestone_type) + '</h1>'
    + '<div class="sub">' + esc(employeeName) + ' — édité le ' + today + '</div></div></div>'
    + '<div class="section"><div class="card"><strong>Statut :</strong> ' + esc(MILESTONE_STATUS_LABELS[ms.status] || ms.status || '—')
    + '   <strong>Échéance :</strong> ' + frDate(ms.due_date) + '   <strong>Réalisé le :</strong> ' + frDate(ms.completed_date)
    + (ms.avis_global ? '\n<strong>Avis global :</strong> ' + esc(ms.avis_global.replace('_', ' ')) : '') + '</div></div>'
    + '<div class="section"><div class="section-title">Freins évalués</div><div class="card">' + freins + '</div></div>'
    + sections
    + '<div class="footer">SOLIDATA ERP — Document confidentiel (RGPD) — ' + today + '</div>';

  openPrintWindow('Bilan_' + esc(ms.milestone_type) + '_' + employeeName, body);
}

// ═══════════════════════════════════════
// COHORTE PANEL — Tableau de bord CIP (pilotage)
// ═══════════════════════════════════════

function DashCard({ label, value, tone, sub }) {
  const tones = {
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone] || tones.slate}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide">{label}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function CohortePanel({ onSelect }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ia, setIa] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/insertion/cohorte/stats')
      .then((r) => { if (alive) { setStats(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const runIaCohorte = async () => {
    setIaLoading(true); setIaError(null);
    try {
      const r = await api.get('/insertion/ia/cohorte');
      setIa(r.data);
    } catch (err) {
      const d = err.response?.data;
      setIaError(err.response?.status === 503
        ? (d?.error || 'Analyse IA non configurée (clé Anthropic absente).')
        : ((d?.error || err.message) + (d?.hint ? ' — ' + d.hint : '')));
    }
    setIaLoading(false);
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement du tableau de bord..." />;
  if (error) return <div className="bg-white rounded-lg border p-4"><div className="text-red-600 text-sm p-3 bg-red-50 rounded border border-red-200">Impossible de charger le tableau de bord : {error}</div></div>;
  if (!stats) return null;

  const s = stats.sorties || {};
  const freinsSorted = Object.entries(stats.freins_moyennes || {})
    .filter(([, v]) => v != null)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Tableau de bord CIP — pilotage de la cohorte</h3>
          <button onClick={runIaCohorte} disabled={iaLoading}
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
            {iaLoading ? 'Analyse IA…' : 'Analyser la cohorte (IA)'}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DashCard label="En parcours" value={stats.nb_actifs} tone="blue" />
          <DashCard label="Jalons en retard" value={stats.nb_jalons_en_retard} tone={stats.nb_jalons_en_retard ? 'red' : 'green'} sub={`${stats.taux_retard_jalons}% des jalons`} />
          <DashCard label="À venir (7 j)" value={stats.nb_jalons_a_venir} tone={stats.nb_jalons_a_venir ? 'amber' : 'slate'} />
          <DashCard label={`Sorties dynamiques ${stats.annee}`} value={s.taux_dynamiques != null ? s.taux_dynamiques + '%' : '—'} tone="green" sub={`${s.positives || 0}/${s.total || 0} sorties`} />
        </div>
        {iaError && <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{iaError}</div>}
        {ia && (
          <div className="mt-3 bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
            {ia.synthese && <p className="text-sm text-slate-700">{ia.synthese}</p>}
            {ia.alertes?.length > 0 && (
              <div className="text-xs text-red-700"><span className="font-semibold">Alertes :</span> {ia.alertes.join(' · ')}</div>
            )}
            {ia.recommandations_cip?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-violet-700 mb-1">Recommandations CIP</p>
                <ul className="list-disc list-inside text-xs text-slate-700 space-y-0.5">
                  {ia.recommandations_cip.map((r, i) => <li key={i}>{typeof r === 'string' ? r : (r.action || JSON.stringify(r))}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Jalons en retard */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Jalons en retard ({stats.jalons_en_retard?.length || 0})
          </h4>
          {stats.jalons_en_retard?.length ? (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {stats.jalons_en_retard.map((j) => (
                <button key={j.id} onClick={() => onSelect(j.employee_id)}
                  className="w-full text-left flex items-center justify-between p-2 rounded hover:bg-red-50 text-sm">
                  <span>{j.first_name} {j.last_name} — <span className="text-gray-500">{j.milestone_type}</span></span>
                  <span className="text-xs text-red-600 font-medium">{Math.abs(j.days_until)} j</span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Aucun jalon en retard 👍</p>}
        </div>

        {/* À venir 7j */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> À planifier / à venir (7 j)
          </h4>
          {stats.jalons_a_venir_7j?.length ? (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {stats.jalons_a_venir_7j.map((j) => (
                <button key={j.id} onClick={() => onSelect(j.employee_id)}
                  className="w-full text-left flex items-center justify-between p-2 rounded hover:bg-amber-50 text-sm">
                  <span>{j.first_name} {j.last_name} — <span className="text-gray-500">{j.milestone_type}</span></span>
                  <span className="text-xs text-amber-600 font-medium">J-{j.days_until}</span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Rien dans les 7 jours.</p>}
        </div>

        {/* Salariés à risque */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500" /> Fins de contrat (&lt; 60 j)
          </h4>
          {stats.salaries_a_risque?.length ? (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {stats.salaries_a_risque.map((c) => (
                <button key={c.id} onClick={() => onSelect(c.id)}
                  className="w-full text-left flex items-center justify-between p-2 rounded hover:bg-orange-50 text-sm">
                  <span>{c.first_name} {c.last_name}</span>
                  <span className={`text-xs font-medium ${c.days <= 15 ? 'text-red-600' : 'text-orange-600'}`}>
                    {c.days < 0 ? 'échu' : c.days + ' j'} — {frDate(c.contract_end)}
                  </span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Aucune fin de contrat proche.</p>}
        </div>

        {/* Freins moyens de la cohorte */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2">Freins moyens de la cohorte</h4>
          {freinsSorted.length ? (
            <div className="space-y-1.5">
              {freinsSorted.map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-24 text-xs text-gray-600">{FREIN_LABEL_BY_KEY[key] || key}</span>
                  <div className="flex-1 bg-gray-200 rounded-full h-2.5">
                    <div className={`h-2.5 rounded-full ${val <= 2 ? 'bg-green-500' : val < 4 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${(val / 5) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{val}</span>
                </div>
              ))}
              {stats.frein_dominant && (
                <p className="text-xs text-gray-500 mt-2">Frein dominant : <strong>{FREIN_LABEL_BY_KEY[stats.frein_dominant]}</strong></p>
              )}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Pas encore d'évaluation de freins.</p>}
        </div>
      </div>

      {/* Sorties par type */}
      {s.total > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2">Sorties {stats.annee} — {s.positives}/{s.total} positives ({s.taux_dynamiques}%)</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(s.par_type || {}).map(([type, n]) => (
              <span key={type} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700">{type} : <strong>{n}</strong></span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [panelError, setPanelError] = useState(null);
  const [showDashboard, setShowDashboard] = useState(true);
  const [diagDirty, setDiagDirty] = useState(false);
  const [bilanDirty, setBilanDirty] = useState(false);
  const [iaAnalyse, setIaAnalyse] = useState(null);
  const [iaEntretien, setIaEntretien] = useState(null);
  const [iaError, setIaError] = useState(null);
  const [iaLoadingProfil, setIaLoadingProfil] = useState(false);
  const [iaLoadingEntretien, setIaLoadingEntretien] = useState(false);
  const [iaDiag, setIaDiag] = useState(null);
  const [iaDiagLoading, setIaDiagLoading] = useState(false);

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
    api.get('/insertion/freins-definitions').then(r => setFreinsDefinitions(r.data)).catch((err) => console.error('[Insertion] freins-definitions indisponible:', err));
  }, []);

  // Garde-fou : prévient la perte de saisie non enregistrée (diagnostic ou bilan).
  const confirmLeave = () => ((!diagDirty && !bilanDirty) || window.confirm('Des modifications ne sont pas enregistrées. Continuer sans les enregistrer ?'));
  useEffect(() => {
    const handler = (e) => { if (diagDirty || bilanDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [diagDirty, bilanDirty]);

  const selectEmployee = async (emp) => {
    setSelectedEmployee(emp);
    setShowDashboard(false);
    setActiveTab('timeline');
    setActiveBilan(null);
    setPanelError(null);
    setDiagDirty(false); setBilanDirty(false);
    setIaAnalyse(null); setIaEntretien(null); setIaError(null);
    setLoading(true);
    try {
      const [analysisRes, diagRes] = await Promise.all([
        api.get(`/insertion/${emp.id}`),
        api.get(`/insertion/diagnostic/${emp.id}`),
      ]);
      setAnalysis(analysisRes.data);
      setDiagnostic(diagRes.data || {});
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message || 'Erreur de chargement du parcours');
    }
    setLoading(false);
  };

  const selectEmployeeById = (id) => {
    const emp = employees.find((e) => e.id === id) || { id };
    selectEmployee(emp);
  };

  const initializeMilestones = async () => {
    if (!selectedEmployee) return;
    setPanelError(null);
    try {
      await api.post(`/insertion/milestones/${selectedEmployee.id}/initialize`);
      selectEmployee(selectedEmployee);
    } catch (err) {
      setPanelError((err.response?.data?.error || err.message) + (err.response?.data?.detail ? ` — ${err.response.data.detail}` : ''));
    }
  };

  const saveDiagnostic = async () => {
    if (!selectedEmployee || !diagnostic) return;
    setSavingDiag(true);
    setPanelError(null);
    try {
      await api.put(`/insertion/diagnostic/${selectedEmployee.id}`, diagnostic);
      setDiagDirty(false);
      selectEmployee(selectedEmployee);
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message || 'Erreur lors de l\'enregistrement du diagnostic');
    }
    setSavingDiag(false);
  };

  const tabs = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'diagnostic', label: 'Diagnostic CIP' },
    { id: 'bilans', label: 'Bilans & Jalons' },
    { id: 'freins', label: 'Freins' },
    { id: 'analyse', label: 'Synthèse & métiers' },
    { id: 'ai', label: 'Assistant IA' },
  ];

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Parcours d'insertion"
          subtitle="Suivi M1/M6/M12, freins périphériques et plans d'action"
          icon={Heart}
        />

        <div className="grid grid-cols-12 gap-4">
          {/* Liste employes */}
          <div className="col-span-3 bg-white rounded-lg border p-3 max-h-[80vh] overflow-y-auto">
            <button onClick={() => { if (!confirmLeave()) return; setShowDashboard(true); setSelectedEmployee(null); setPanelError(null); setDiagDirty(false); setBilanDirty(false); }}
              className={`w-full mb-3 px-3 py-2 rounded text-sm font-semibold transition ${showDashboard ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              Tableau de bord CIP
            </button>
            <h2 className="font-semibold text-gray-700 mb-2">Salaries en parcours ({employees.length})</h2>
            {loadError && <div className="text-red-600 text-xs mb-2 p-2 bg-red-50 rounded">{loadError}</div>}
            {!loadError && employees.length === 0 && <div className="text-gray-400 text-sm p-2">Aucun salarie actif trouve</div>}
            {employees.map(emp => (
              <button key={emp.id} onClick={() => { if (confirmLeave()) selectEmployee(emp); }}
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
            {(!selectedEmployee || showDashboard) && (
              <CohortePanel onSelect={selectEmployeeById} />
            )}

            {selectedEmployee && !showDashboard && loading && (
              <LoadingSpinner size="lg" message="Chargement des parcours..." />
            )}

            {selectedEmployee && !showDashboard && panelError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
                <span aria-hidden="true">⚠</span><span>{panelError}</span>
                <button onClick={() => setPanelError(null)} className="ml-auto text-red-500 hover:text-red-700" aria-label="Fermer">×</button>
              </div>
            )}

            {selectedEmployee && !showDashboard && !loading && analysis && (
              <>
                {/* Header employe */}
                <div className="bg-white rounded-lg border p-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">{analysis.employee.first_name} {analysis.employee.last_name}</h2>
                    <div className="text-sm text-gray-500">
                      {analysis.employee.position} - {analysis.employee.team_name}
                      {analysis.employee.insertion_start_date && ` | Debut: ${new Date(analysis.employee.insertion_start_date).toLocaleDateString('fr-FR')}`}
                      {analysis.employee.contract_end && ` | Fin contrat: ${new Date(analysis.employee.contract_end).toLocaleDateString('fr-FR')}`}
                    </div>
                    <div className="flex gap-2 mt-1 flex-wrap items-center">
                      {analysis.has_pcm && <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">PCM recrutement</span>}
                      {analysis.has_diagnostic && <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">Diagnostic CIP</span>}
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                        Confiance: {Math.round((analysis.confiance || 0) * 100)}%
                      </span>
                      {(analysis.employee.prescripteur_nom || analysis.employee.prescripteur) && (
                        <span className="text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-700">
                          Prescripteur : {analysis.employee.prescripteur_nom || analysis.employee.prescripteur}
                          {analysis.employee.prescripteur_type ? ` (${analysis.employee.prescripteur_type})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button onClick={initializeMilestones} className="btn-primary text-sm whitespace-nowrap">
                      Initialiser jalons
                    </button>
                    <button onClick={() => exportFicheParcoursPDF(analysis, diagnostic)}
                      className="px-3 py-1.5 rounded-lg border border-teal-300 text-teal-700 text-sm font-medium hover:bg-teal-50 whitespace-nowrap">
                      Exporter la fiche PDF
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-white rounded-lg border p-1">
                  {tabs.map(tab => (
                    <button key={tab.id} onClick={() => { if (!confirmLeave()) return; setActiveTab(tab.id); setActiveBilan(null); setBilanDirty(false); }}
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
                  <div className="bg-white rounded-lg border p-4 space-y-4" onChange={() => setDiagDirty(true)}>
                    <h3 className="font-semibold text-gray-800">Diagnostic CIP {diagDirty && <span className="ml-2 text-xs text-amber-600 font-normal">• non enregistré</span>}</h3>
                    <p className="text-sm text-gray-500">Remplir lors du diagnostic d'accueil (M+1 max). Le PCM est automatiquement recupere depuis le module recrutement.</p>

                    {(() => {
                      const nbFreins = FREIN_KEYS.filter(k => diagnostic[`frein_${k}`]).length;
                      const obsKeys = ['obs_points_forts', 'obs_difficultes', 'obs_comportement_equipe', 'obs_autonomie_ponctualite', 'pref_aime_faire', 'pref_ne_veut_plus'];
                      const nbObs = countFilled(diagnostic, obsKeys);
                      return (
                        <>
                          <Collapsible title="Parcours antérieur" defaultOpen badge={diagnostic.parcours_anterieur ? '✓' : null} badgeTone="green">
                            <textarea value={diagnostic.parcours_anterieur || ''} onChange={e => setDiagnostic({ ...diagnostic, parcours_anterieur: e.target.value })}
                              className="input-modern py-1" rows={3} placeholder="Ce que la personne a fait avant d'arriver…" />
                          </Collapsible>

                          <Collapsible title="Freins périphériques" subtitle="évaluez chaque frein" defaultOpen badge={`${nbFreins}/7`} badgeTone={nbFreins === 7 ? 'green' : nbFreins ? 'amber' : 'slate'}>
                            <p className="text-xs text-gray-400 -mt-1">Utilisez les questions pour guider l'entretien, puis évaluez le niveau (laissez « à évaluer » si non abordé).</p>
                            {freinsDefinitions && FREIN_KEYS.map(key => {
                              const def = freinsDefinitions[key];
                              if (!def) return null;
                              return (
                                <div key={key} className="bg-gray-50 rounded p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <h5 className="font-medium text-gray-700">{def.label}</h5>
                                    <div className="flex items-center gap-2">
                                      <input type="range" min="1" max="5" value={diagnostic[`frein_${key}`] || 3}
                                        onChange={e => setDiagnostic({ ...diagnostic, [`frein_${key}`]: parseInt(e.target.value) })} />
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${diagnostic[`frein_${key}`] ? FREIN_COLORS[diagnostic[`frein_${key}`]] : 'bg-gray-100 text-gray-400'}`}>
                                        {diagnostic[`frein_${key}`] ? `${diagnostic[`frein_${key}`]}/5` : 'à évaluer'}
                                      </span>
                                    </div>
                                  </div>
                                  {def.questions_indirectes && def.questions_indirectes.map((qi, i) => (
                                    <p key={i} className="text-xs text-gray-500 italic ml-2">- {qi.q}</p>
                                  ))}
                                  <textarea value={diagnostic[`frein_${key}_detail`] || ''}
                                    onChange={e => setDiagnostic({ ...diagnostic, [`frein_${key}_detail`]: e.target.value })}
                                    placeholder={`Observations ${def.label}...`}
                                    className="input-modern py-1 text-xs" rows={2} />
                                </div>
                              );
                            })}
                          </Collapsible>

                          <Collapsible title="Observations professionnelles" defaultOpen={false} badge={`${nbObs}/6`} badgeTone={nbObs === 6 ? 'green' : nbObs ? 'amber' : 'slate'}>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                ['obs_points_forts', 'Points forts observes'], ['obs_difficultes', 'Difficultes observees'],
                                ['obs_comportement_equipe', 'Comportement en equipe'], ['obs_autonomie_ponctualite', 'Autonomie / Ponctualite'],
                                ['pref_aime_faire', 'Ce que la personne aime faire'], ['pref_ne_veut_plus', 'Ce qu\'elle ne veut plus faire'],
                              ].map(([key, label]) => (
                                <div key={key}>
                                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                                  <textarea value={diagnostic[key] || ''} onChange={e => setDiagnostic({ ...diagnostic, [key]: e.target.value })}
                                    className="input-modern py-1" rows={2} />
                                </div>
                              ))}
                            </div>
                          </Collapsible>
                        </>
                      );
                    })()}

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
                        employeeName={`${analysis.employee.first_name} ${analysis.employee.last_name}`}
                        allMilestones={analysis.milestones}
                        onDirtyChange={setBilanDirty}
                        onSave={() => { setBilanDirty(false); setActiveBilan(null); selectEmployee(selectedEmployee); }}
                        onClose={() => { setBilanDirty(false); setActiveBilan(null); }} />
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
                            setIaLoadingProfil(true); setIaError(null);
                            try {
                              const res = await api.get(`/insertion/ia/profil/${selectedEmployee.id}`);
                              setIaAnalyse(res.data);
                            } catch (err) { const d = err.response?.data; setIaError((d?.error || 'Erreur analyse IA') + (d?.hint ? ' — ' + d.hint : '')); }
                            setIaLoadingProfil(false);
                          }} disabled={iaLoadingProfil}
                            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
                            {iaLoadingProfil ? 'Analyse…' : 'Analyser le profil'}
                          </button>
                          <button onClick={async () => {
                            setIaLoadingEntretien(true); setIaError(null);
                            try {
                              const nextMilestone = analysis.milestones?.find(m => m.status !== 'realise');
                              const mType = nextMilestone?.milestone_type || 'Bilan M+3';
                              const res = await api.get(`/insertion/ia/entretien/${selectedEmployee.id}?type=${encodeURIComponent(mType)}`);
                              setIaEntretien(res.data);
                            } catch (err) { const d = err.response?.data; setIaError((d?.error || 'Erreur préparation entretien') + (d?.hint ? ' — ' + d.hint : '')); }
                            setIaLoadingEntretien(false);
                          }} disabled={iaLoadingEntretien}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                            {iaLoadingEntretien ? 'Préparation…' : 'Préparer entretien'}
                          </button>
                          <button onClick={async () => {
                            setIaDiagLoading(true); setIaDiag(null); setIaError(null);
                            try {
                              const res = await api.get('/insertion/ia/diagnostic');
                              setIaDiag(res.data);
                            } catch (err) { setIaDiag(err.response?.data || { ok: false, message: err.message }); }
                            setIaDiagLoading(false);
                          }} disabled={iaDiagLoading}
                            title="Teste la connexion à Claude sans dépendre d'un salarié (clé, modèle, réseau)"
                            className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-300 disabled:opacity-50">
                            {iaDiagLoading ? 'Test…' : 'Tester la connexion IA'}
                          </button>
                        </div>
                      </div>

                      {iaDiag && (
                        <div className={`mb-3 text-xs rounded-lg p-3 border ${iaDiag.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                          <p className="font-semibold mb-1">
                            {iaDiag.ok ? '✓ Connexion IA opérationnelle' : '✗ Échec de la connexion IA'}
                          </p>
                          <ul className="space-y-0.5 font-mono text-[11px]">
                            <li>configured : {String(iaDiag.configured)}{iaDiag.key_length ? ` (clé longueur ${iaDiag.key_length})` : ''}</li>
                            <li>model : {iaDiag.model || '—'}</li>
                            {iaDiag.status != null && <li>status HTTP : {iaDiag.status}</li>}
                            {iaDiag.type && <li>type : {iaDiag.type}</li>}
                            {iaDiag.latency_ms != null && <li>latence : {iaDiag.latency_ms} ms</li>}
                            {iaDiag.message && <li className="whitespace-pre-wrap break-words">message : {iaDiag.message}</li>}
                            {iaDiag.reply && <li>réponse : « {iaDiag.reply} »</li>}
                          </ul>
                          {!iaDiag.ok && iaDiag.configured === false && (
                            <p className="mt-2 not-italic">→ La variable <code>ANTHROPIC_API_KEY</code> n'est pas transmise au conteneur backend. Vérifiez le <code>.env</code> serveur puis <code>docker compose ... restart backend</code>.</p>
                          )}
                          {!iaDiag.ok && iaDiag.status === 404 && (
                            <p className="mt-2">→ Le modèle <code>{iaDiag.model}</code> n'est pas disponible pour cette clé. Définissez <code>CLAUDE_MODEL</code> sur un modèle autorisé puis redémarrez le backend.</p>
                          )}
                          {!iaDiag.ok && iaDiag.status === 401 && (
                            <p className="mt-2">→ Clé <code>ANTHROPIC_API_KEY</code> invalide ou révoquée.</p>
                          )}
                        </div>
                      )}

                      {iaError && (
                        <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 flex items-start gap-2">
                          <span aria-hidden="true">⚠</span><span>{iaError}</span>
                        </div>
                      )}

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
                          {iaAnalyse.risque_decrochage?.signaux_alerte?.length > 0 && (
                            <div className="text-xs text-red-700 bg-red-50 rounded-lg p-2 border border-red-200">
                              <span className="font-semibold">Signaux d'alerte :</span> {iaAnalyse.risque_decrochage.signaux_alerte.join(' · ')}
                            </div>
                          )}
                          {iaAnalyse.freins_prioritaires?.length > 0 && (
                            <div className="text-xs"><span className="font-semibold text-violet-700">Freins prioritaires :</span> {iaAnalyse.freins_prioritaires.join(', ')}</div>
                          )}
                          {iaAnalyse.pcm_adaptation?.vigilances && (
                            <div className="text-xs bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Vigilances PCM :</span> {iaAnalyse.pcm_adaptation.vigilances}</div>
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
                          {iaEntretien.freins_a_aborder?.length > 0 && (
                            <div className="text-xs bg-white rounded-lg p-2 border">
                              <span className="font-semibold text-blue-700">Freins à aborder :</span> {iaEntretien.freins_a_aborder.join(', ')}
                            </div>
                          )}
                          {iaEntretien.points_vigilance?.length > 0 && (
                            <div className="text-xs bg-amber-50 rounded-lg p-2 border border-amber-200 text-amber-800">
                              <span className="font-semibold">Points de vigilance :</span> {iaEntretien.points_vigilance.join(' · ')}
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
