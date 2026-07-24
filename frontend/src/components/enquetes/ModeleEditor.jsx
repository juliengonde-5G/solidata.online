import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, Eye, Save, X, Check,
} from 'lucide-react';
import { Modal, LoadingSpinner } from '../../components';
import api from '../../services/api';
import QuestionField from './QuestionField';
import {
  CATEGORIES, CATEGORIE_LABELS, TYPES_QUESTION, TYPE_LABELS, TYPE_STYLES,
  needsOptions, normalizeOptions, apiErr,
} from './enquetesShared';

/**
 * Constructeur / éditeur d'un modèle de questionnaire.
 *
 * Le modèle doit exister (avoir un id) avant de recevoir des questions
 * (endpoints imbriqués /modeles/:id/questions). Pour un nouveau modèle, on
 * enregistre d'abord les métadonnées (POST /modeles) puis on bascule en mode
 * édition avec l'id renvoyé. Aperçu du rendu respondant via QuestionField.
 */
export default function ModeleEditor({ modeleId, canWrite, onClose, onSaved }) {
  const [id, setId] = useState(modeleId || null);
  const [meta, setMeta] = useState({ titre: '', description: '', categorie: 'qvct', anonyme: true, actif: true });
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(!!modeleId);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [error, setError] = useState(null);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [editingQid, setEditingQid] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState({});
  const [touched, setTouched] = useState(false); // une modif a-t-elle eu lieu ?

  const setM = (k, v) => { setMeta((m) => ({ ...m, [k]: v })); setMetaDirty(true); };

  const loadModele = useCallback(async (mid) => {
    setLoading(true);
    try {
      const r = await api.get(`/enquetes/modeles/${mid}`);
      setMeta({
        titre: r.data.titre || '', description: r.data.description || '',
        categorie: r.data.categorie || 'autre', anonyme: r.data.anonyme !== false, actif: r.data.actif !== false,
      });
      setQuestions(Array.isArray(r.data.questions) ? r.data.questions : []);
      setMetaDirty(false);
      setError(null);
    } catch (err) { setError(apiErr(err)); }
    setLoading(false);
  }, []);

  useEffect(() => { if (modeleId) loadModele(modeleId); }, [modeleId, loadModele]);

  const reloadQuestions = useCallback(async (mid) => {
    try {
      const r = await api.get(`/enquetes/modeles/${mid}`);
      setQuestions(Array.isArray(r.data.questions) ? r.data.questions : []);
    } catch (err) { setError(apiErr(err)); }
  }, []);

  const saveMeta = async () => {
    if (!meta.titre.trim()) { setError('Le titre du modèle est obligatoire.'); return; }
    setSavingMeta(true); setError(null);
    const payload = {
      titre: meta.titre.trim(), description: meta.description.trim() || null,
      categorie: meta.categorie, anonyme: !!meta.anonyme, actif: !!meta.actif,
    };
    try {
      if (id) {
        await api.put(`/enquetes/modeles/${id}`, payload);
        setMetaDirty(false); setTouched(true);
      } else {
        const r = await api.post('/enquetes/modeles', payload);
        setId(r.data.id); setMetaDirty(false); setTouched(true);
      }
    } catch (err) { setError(apiErr(err, 'Impossible d\'enregistrer le modèle.')); }
    setSavingMeta(false);
  };

  const addQuestion = async (payload) => {
    const ordre = (questions.reduce((mx, q) => Math.max(mx, q.ordre || 0), 0) || 0) + 1;
    try {
      await api.post(`/enquetes/modeles/${id}/questions`, { ...payload, ordre });
      setAddingQuestion(false); setTouched(true);
      await reloadQuestions(id);
    } catch (err) { setError(apiErr(err, 'Ajout de la question impossible.')); }
  };

  const updateQuestion = async (qid, payload) => {
    try {
      await api.put(`/enquetes/modeles/${id}/questions/${qid}`, payload);
      setEditingQid(null); setTouched(true);
      await reloadQuestions(id);
    } catch (err) { setError(apiErr(err, 'Modification impossible.')); }
  };

  const deleteQuestion = async (qid) => {
    try {
      await api.delete(`/enquetes/modeles/${id}/questions/${qid}`);
      setTouched(true);
      await reloadQuestions(id);
    } catch (err) { setError(apiErr(err, 'Suppression impossible.')); }
  };

  // Réordonnancement : échange l'ordre de deux questions adjacentes.
  const move = async (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= questions.length) return;
    const a = questions[index];
    const b = questions[target];
    const oa = a.ordre ?? index;
    const ob = b.ordre ?? target;
    // MAJ optimiste de l'ordre d'affichage
    const next = questions.slice();
    next[index] = b; next[target] = a;
    setQuestions(next);
    try {
      await Promise.all([
        api.put(`/enquetes/modeles/${id}/questions/${a.id}`, { ordre: ob }),
        api.put(`/enquetes/modeles/${id}/questions/${b.id}`, { ordre: oa }),
      ]);
      setTouched(true);
      await reloadQuestions(id);
    } catch (err) { setError(apiErr(err, 'Réordonnancement impossible.')); await reloadQuestions(id); }
  };

  const close = () => { if (touched) onSaved(); else onClose(); };

  return (
    <Modal
      isOpen
      onClose={close}
      title={id ? 'Modifier le modèle d\'enquête' : 'Nouveau modèle d\'enquête'}
      size="xl"
      footer={
        <button type="button" onClick={close} className="btn-primary text-sm px-4 py-1.5">Terminer</button>
      }
    >
      {loading ? (
        <LoadingSpinner size="lg" message="Chargement du modèle…" />
      ) : (
        <div className="space-y-5">
          {error && (
            <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 flex items-start gap-2">
              <span aria-hidden="true">⚠</span><span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
            </div>
          )}

          {/* Métadonnées du modèle */}
          <section className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="mo-titre">Titre <span className="text-red-500">*</span></label>
              <input id="mo-titre" value={meta.titre} onChange={(e) => setM('titre', e.target.value)} disabled={!canWrite}
                className="input-modern w-full text-sm" placeholder="Ex. Baromètre QVCT — conditions de travail" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="mo-desc">Description / consigne</label>
              <textarea id="mo-desc" value={meta.description} onChange={(e) => setM('description', e.target.value)} disabled={!canWrite}
                rows={2} className="input-modern w-full text-sm" placeholder="Message d'introduction affiché aux répondants." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="mo-cat">Catégorie</label>
                <select id="mo-cat" value={meta.categorie} onChange={(e) => setM('categorie', e.target.value)} disabled={!canWrite}
                  className="input-modern w-full text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORIE_LABELS[c]}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600 mt-6 cursor-pointer select-none">
                <input type="checkbox" checked={meta.anonyme} onChange={(e) => setM('anonyme', e.target.checked)} disabled={!canWrite} className="rounded border-slate-300" />
                Enquête anonyme
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 mt-6 cursor-pointer select-none">
                <input type="checkbox" checked={meta.actif} onChange={(e) => setM('actif', e.target.checked)} disabled={!canWrite} className="rounded border-slate-300" />
                Modèle actif
              </label>
            </div>
            {meta.anonyme && (
              <p className="text-[11px] text-slate-400">
                Les réponses ne sont reliées à aucun compte. Les résultats sont restitués de façon agrégée uniquement (seuil d'anonymat : 5 réponses minimum).
              </p>
            )}
            {canWrite && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={saveMeta} disabled={savingMeta || (id && !metaDirty)}
                  className="btn-primary text-sm px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Save className="w-4 h-4" /> {savingMeta ? 'Enregistrement…' : id ? 'Enregistrer le modèle' : 'Créer le modèle'}
                </button>
                {id && !metaDirty && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> à jour</span>}
              </div>
            )}
          </section>

          {/* Questions */}
          <section className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h3 className="text-base font-semibold text-slate-800">Questions ({questions.length})</h3>
              <div className="flex items-center gap-2">
                {questions.length > 0 && (
                  <button type="button" onClick={() => setShowPreview((s) => !s)}
                    className="btn-ghost text-sm inline-flex items-center gap-1.5">
                    <Eye className="w-4 h-4" /> {showPreview ? 'Masquer l\'aperçu' : 'Aperçu'}
                  </button>
                )}
                {canWrite && id && !addingQuestion && (
                  <button type="button" onClick={() => { setAddingQuestion(true); setEditingQid(null); }}
                    className="btn-primary text-sm inline-flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> Ajouter une question
                  </button>
                )}
              </div>
            </div>

            {!id && (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                Enregistrez d'abord le modèle pour pouvoir ajouter des questions.
              </p>
            )}

            {id && questions.length === 0 && !addingQuestion && (
              <p className="text-sm text-slate-400 py-3">Aucune question pour l'instant. Ajoutez-en une pour construire le questionnaire.</p>
            )}

            <div className="space-y-2">
              {questions.map((q, i) => (
                editingQid === q.id ? (
                  <QuestionForm
                    key={q.id}
                    initial={q}
                    onCancel={() => setEditingQid(null)}
                    onSubmit={(payload) => updateQuestion(q.id, payload)}
                  />
                ) : (
                  <div key={q.id} className="border border-slate-200 rounded-lg p-3 flex items-start gap-3 bg-white">
                    <div className="flex flex-col items-center gap-0.5 pt-0.5">
                      <button type="button" onClick={() => move(i, -1)} disabled={!canWrite || i === 0}
                        className="text-slate-400 hover:text-teal-600 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Monter la question">
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <span className="text-[11px] text-slate-400 font-medium">{i + 1}</span>
                      <button type="button" onClick={() => move(i, 1)} disabled={!canWrite || i === questions.length - 1}
                        className="text-slate-400 hover:text-teal-600 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Descendre la question">
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-800">{q.libelle}</span>
                        {q.obligatoire && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-semibold">obligatoire</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_STYLES[q.type] || 'bg-slate-100 text-slate-600'}`}>{TYPE_LABELS[q.type] || q.type}</span>
                        {needsOptions(q.type) && (
                          <span className="text-[11px] text-slate-400">
                            {normalizeOptions(q.options).map((o) => o.label).join(' · ') || 'aucune option'}
                          </span>
                        )}
                      </div>
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => { setEditingQid(q.id); setAddingQuestion(false); }} className="text-slate-400 hover:text-teal-600 p-1" title="Modifier" aria-label="Modifier la question">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => deleteQuestion(q.id)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer la question">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              ))}

              {addingQuestion && (
                <QuestionForm
                  initial={null}
                  onCancel={() => setAddingQuestion(false)}
                  onSubmit={addQuestion}
                />
              )}
            </div>
          </section>

          {/* Aperçu respondant */}
          {showPreview && questions.length > 0 && (
            <section className="border-t border-slate-100 pt-4">
              <h3 className="text-base font-semibold text-slate-800 mb-1">Aperçu (vue répondant)</h3>
              <p className="text-xs text-slate-400 mb-3">Simulation du rendu — les réponses ne sont pas enregistrées.</p>
              <div className="bg-slate-50 rounded-xl p-4 space-y-5">
                {questions.map((q, i) => (
                  <div key={q.id}>
                    <p className="text-base font-semibold text-slate-800 mb-2">
                      {i + 1}. {q.libelle} {q.obligatoire && <span className="text-red-500">*</span>}
                    </p>
                    <QuestionField
                      question={q}
                      value={previewAnswers[q.id]}
                      onChange={(v) => setPreviewAnswers((a) => ({ ...a, [q.id]: v }))}
                      idPrefix="preview"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Formulaire d'une question (ajout / édition) ──────────────────────────────
function QuestionForm({ initial, onCancel, onSubmit }) {
  const [libelle, setLibelle] = useState(initial?.libelle || '');
  const [type, setType] = useState(initial?.type || 'echelle');
  const [obligatoire, setObligatoire] = useState(initial?.obligatoire ?? true);
  const [options, setOptions] = useState(() => {
    const norm = normalizeOptions(initial?.options).map((o) => o.label);
    return norm.length ? norm : ['', ''];
  });
  const [err, setErr] = useState(null);
  const withOptions = needsOptions(type);

  const setOpt = (i, v) => setOptions((o) => o.map((x, idx) => (idx === i ? v : x)));
  const addOpt = () => setOptions((o) => [...o, '']);
  const removeOpt = (i) => setOptions((o) => (o.length <= 1 ? o : o.filter((_, idx) => idx !== i)));

  const submit = () => {
    if (!libelle.trim()) { setErr('L\'intitulé de la question est obligatoire.'); return; }
    let cleanOptions = [];
    if (withOptions) {
      cleanOptions = options.map((s) => s.trim()).filter(Boolean);
      if (cleanOptions.length < 2) { setErr('Renseignez au moins deux options.'); return; }
    }
    setErr(null);
    onSubmit({ libelle: libelle.trim(), type, obligatoire, options: cleanOptions });
  };

  return (
    <div className="border-2 border-teal-200 bg-teal-50/40 rounded-lg p-3 space-y-3">
      {err && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{err}</div>}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="qf-libelle">Intitulé <span className="text-red-500">*</span></label>
        <input id="qf-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} autoFocus
          className="input-modern w-full text-sm" placeholder="Ex. Je me sens en sécurité à mon poste de travail" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="qf-type">Type de réponse</label>
          <select id="qf-type" value={type} onChange={(e) => setType(e.target.value)} className="input-modern w-full text-sm">
            {TYPES_QUESTION.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          {type === 'echelle' && <p className="text-[11px] text-slate-400 mt-1">Échelle de 1 (faible) à 5 (élevé).</p>}
          {type === 'note_10' && <p className="text-[11px] text-slate-400 mt-1">Note de 0 à 10.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 mt-6 cursor-pointer select-none">
          <input type="checkbox" checked={obligatoire} onChange={(e) => setObligatoire(e.target.checked)} className="rounded border-slate-300" />
          Réponse obligatoire
        </label>
      </div>

      {withOptions && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Options de réponse</label>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={o} onChange={(e) => setOpt(i, e.target.value)} className="input-modern flex-1 text-sm" placeholder={`Option ${i + 1}`} />
                <button type="button" onClick={() => removeOpt(i)} className="text-slate-400 hover:text-red-600 p-1" aria-label="Retirer l'option">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addOpt} className="mt-2 text-sm text-teal-700 inline-flex items-center gap-1 hover:underline">
            <Plus className="w-3.5 h-3.5" /> Ajouter une option
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
        <button type="button" onClick={submit} className="btn-primary text-sm px-4 py-1.5">{initial ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </div>
  );
}
