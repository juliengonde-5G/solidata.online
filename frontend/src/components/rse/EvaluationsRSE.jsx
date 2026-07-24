import { useState, useEffect, useCallback, Fragment } from 'react';
import { Plus, ClipboardList, Check, Lock, RefreshCw } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import {
  EVAL_TYPE_LABELS, EVAL_STATUT_LABELS, CHAPITRE_LABELS, NIVEAU_LABELS,
  niveauBadgeClasses, UserSelect, frDate, isoDate, apiErr,
} from './rseShared';

// ── Formulaire de création de campagne ───────────────────────────────────────
function CreateEvalForm({ users, restricted, onClose, onSaved }) {
  const [form, setForm] = useState({ type: 'auto_evaluation', libelle: '', date_evaluation: '', evaluateur_user_id: null, synthese: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.libelle.trim()) { setError('Le libellé est obligatoire.'); return; }
    setSaving(true); setError(null);
    try {
      const r = await api.post('/rse/evaluations', {
        type: form.type,
        libelle: form.libelle.trim(),
        date_evaluation: form.date_evaluation || null,
        evaluateur_user_id: form.evaluateur_user_id,
        synthese: form.synthese.trim() || null,
      });
      onSaved(r.data?.id);
    } catch (err) {
      setError(apiErr(err, 'Impossible de créer la campagne.'));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen onClose={onClose} title="Nouvelle campagne d'évaluation" size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50">
            {saving ? 'Création…' : 'Créer la campagne'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="ev-type">Type</label>
          <select id="ev-type" value={form.type} onChange={(e) => set('type', e.target.value)} className="input-modern w-full text-sm">
            {Object.entries(EVAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="ev-lib">Libellé <span className="text-red-500">*</span></label>
          <input id="ev-lib" value={form.libelle} onChange={(e) => set('libelle', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. Auto-évaluation état zéro 2027" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="ev-date">Date</label>
            <input id="ev-date" type="date" value={form.date_evaluation} onChange={(e) => set('date_evaluation', e.target.value)} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="ev-eval">Évaluateur</label>
            <UserSelect id="ev-eval" value={form.evaluateur_user_id} onChange={(v) => set('evaluateur_user_id', v)} users={users} placeholder="Non attribué" />
            {restricted && <p className="text-[11px] text-amber-600 mt-1">Liste d'utilisateurs restreinte.</p>}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="ev-synth">Synthèse (facultatif)</label>
          <textarea id="ev-synth" value={form.synthese} onChange={(e) => set('synthese', e.target.value)} rows={2} className="input-modern w-full text-sm" />
        </div>
      </div>
    </Modal>
  );
}

// ── Ligne de cotation d'un critère dans une campagne ──────────────────────────
function ItemRow({ critere, item, actions, readonly, onSave }) {
  const [niveau, setNiveau] = useState(item?.niveau_constate ?? null);
  const [constat, setConstat] = useState(item?.constat || '');
  const [ecart, setEcart] = useState(item?.ecart || '');
  const [actionId, setActionId] = useState(item?.action_id ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Resynchronise si l'item est rechargé/enregistré côté serveur (nouvelle
  // référence d'objet). N'écrase pas l'indicateur de succès (timeout dédié).
  useEffect(() => {
    setNiveau(item?.niveau_constate ?? null);
    setConstat(item?.constat || '');
    setEcart(item?.ecart || '');
    setActionId(item?.action_id ?? null);
  }, [item]);

  const dirty =
    (niveau ?? null) !== (item?.niveau_constate ?? null) ||
    (constat || '') !== (item?.constat || '') ||
    (ecart || '') !== (item?.ecart || '') ||
    (actionId ?? null) !== (item?.action_id ?? null);

  const doSave = async () => {
    setSaving(true);
    try {
      await onSave(critere.code, { niveau_constate: niveau, constat: constat.trim() || null, ecart: ecart.trim() || null, action_id: actionId });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally { setSaving(false); }
  };

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-2 py-2 whitespace-nowrap">
        <span className="font-semibold text-slate-700">{critere.code}</span>
        <p className="text-[11px] text-slate-400 max-w-[150px] leading-tight">{critere.intitule}</p>
      </td>
      <td className="px-2 py-2">
        <select value={niveau ?? ''} disabled={readonly}
          onChange={(e) => setNiveau(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          className="input-modern py-1 text-xs w-full min-w-[90px]" aria-label={`Niveau constaté ${critere.code}`}>
          <option value="">Non coté</option>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} · {NIVEAU_LABELS[n]}</option>)}
        </select>
      </td>
      <td className="px-2 py-2">
        <input value={constat} disabled={readonly} onChange={(e) => setConstat(e.target.value)}
          className="input-modern py-1 text-xs w-full min-w-[140px]" placeholder="Constat factuel" aria-label={`Constat ${critere.code}`} />
      </td>
      <td className="px-2 py-2">
        <input value={ecart} disabled={readonly} onChange={(e) => setEcart(e.target.value)}
          className="input-modern py-1 text-xs w-full min-w-[120px]" placeholder="Écart au niveau supérieur" aria-label={`Écart ${critere.code}`} />
      </td>
      <td className="px-2 py-2">
        <select value={actionId ?? ''} disabled={readonly}
          onChange={(e) => setActionId(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          className="input-modern py-1 text-xs w-full min-w-[130px]" aria-label={`Action corrective ${critere.code}`}>
          <option value="">—</option>
          {actions.map((a) => <option key={a.id} value={a.id}>{a.titre}</option>)}
        </select>
      </td>
      {!readonly && (
        <td className="px-2 py-2 whitespace-nowrap">
          <button onClick={doSave} disabled={!dirty || saving}
            className={`text-xs px-2 py-1 rounded ${dirty ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400'} disabled:opacity-60`}>
            {saving ? '…' : saved ? <Check className="w-3.5 h-3.5 inline" /> : 'Enregistrer'}
          </button>
        </td>
      )}
    </tr>
  );
}

export default function EvaluationsRSE({ criteres, users, restricted, canWrite }) {
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actions, setActions] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [synthese, setSynthese] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  const loadList = useCallback(() => {
    setLoadingList(true);
    api.get('/rse/evaluations')
      .then((r) => { setList(Array.isArray(r.data) ? r.data : []); setError(null); })
      .catch((err) => setError(apiErr(err)))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { api.get('/rse/actions').then((r) => setActions(Array.isArray(r.data) ? r.data : [])).catch(() => setActions([])); }, []);

  const loadDetail = useCallback((id) => {
    if (!id) { setDetail(null); return; }
    setLoadingDetail(true);
    api.get(`/rse/evaluations/${id}`)
      .then((r) => { setDetail(r.data); setSynthese(r.data?.synthese || ''); })
      .catch((err) => setError(apiErr(err)))
      .finally(() => setLoadingDetail(false));
  }, []);

  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const itemsByCode = {};
  for (const it of detail?.items || []) itemsByCode[it.critere_code] = it;

  const saveItem = async (code, patch) => {
    try {
      const r = await api.post(`/rse/evaluations/${selectedId}/items`, { critere_code: code, ...patch });
      const saved = r.data;
      // Patch local ciblé : seule la ligne enregistrée change de référence
      // (les autres lignes en cours d'édition ne sont pas réinitialisées).
      setDetail((d) => {
        if (!d) return d;
        const items = Array.isArray(d.items) ? [...d.items] : [];
        const idx = items.findIndex((i) => i.critere_code === code);
        if (idx >= 0) items[idx] = { ...items[idx], ...saved };
        else items.push(saved);
        return { ...d, items };
      });
      loadList(); // met à jour le compteur « N critère(s) coté(s) » dans la liste
    } catch (err) { setError(apiErr(err)); throw err; }
  };

  const saveSynthese = async () => {
    setSavingMeta(true); setError(null);
    try {
      await api.put(`/rse/evaluations/${selectedId}`, { synthese: synthese.trim() || null });
      setDetail((d) => (d ? { ...d, synthese: synthese.trim() || null } : d));
    } catch (err) { setError(apiErr(err)); }
    setSavingMeta(false);
  };

  const setStatut = async (statut) => {
    setConfirmClose(false);
    try {
      await api.put(`/rse/evaluations/${selectedId}`, { statut });
      setDetail((d) => (d ? { ...d, statut } : d));
      loadList();
    } catch (err) { setError(apiErr(err)); }
  };

  const isClosed = detail?.statut === 'cloturee';
  const readonly = isClosed || !canWrite;
  const nbCotes = (detail?.items || []).filter((i) => i.niveau_constate != null).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Campagnes d'évaluation</h2>
        {canWrite && (
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouvelle campagne
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Liste des campagnes */}
        <div className="space-y-2">
          {loadingList ? (
            <LoadingSpinner size="md" message="Chargement…" />
          ) : list.length === 0 ? (
            <div className="bg-white rounded-lg border p-6 text-center text-slate-400 text-sm">
              Aucune campagne. {canWrite && 'Créez une auto-évaluation ou un audit interne.'}
            </div>
          ) : (
            list.map((e) => (
              <button key={e.id} onClick={() => setSelectedId(e.id)}
                className={`w-full text-left rounded-lg border p-3 transition ${selectedId === e.id ? 'border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{EVAL_TYPE_LABELS[e.type] || e.type}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${e.statut === 'cloturee' ? 'bg-slate-200 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>
                    {e.statut === 'cloturee' ? <Lock className="w-3 h-3" /> : null}{EVAL_STATUT_LABELS[e.statut] || e.statut}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-700 mt-1.5">{e.libelle}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {e.date_evaluation ? frDate(e.date_evaluation) : 'sans date'}{e.evaluateur_nom ? ` · ${e.evaluateur_nom}` : ''} · {e.nb_items || 0} critère(s) coté(s)
                </p>
              </button>
            ))
          )}
        </div>

        {/* Détail de la campagne */}
        <div>
          {!selectedId ? (
            <div className="bg-white rounded-lg border p-10 text-center text-slate-400">
              <ClipboardList className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-sm">Sélectionnez une campagne pour coter les 27 critères.</p>
            </div>
          ) : loadingDetail || !detail ? (
            <LoadingSpinner size="lg" message="Chargement de la campagne…" />
          ) : (
            <div className="space-y-3">
              {/* En-tête campagne */}
              <div className="bg-white rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{EVAL_TYPE_LABELS[detail.type]}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isClosed ? 'bg-slate-200 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>{EVAL_STATUT_LABELS[detail.statut]}</span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-800 mt-1">{detail.libelle}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {detail.date_evaluation ? frDate(detail.date_evaluation) : 'sans date'}{detail.evaluateur_nom ? ` · évaluateur : ${detail.evaluateur_nom}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-slate-800">{nbCotes}<span className="text-sm font-normal text-slate-400">/27</span></div>
                    <div className="text-[11px] text-slate-400">critères cotés</div>
                    {canWrite && (
                      isClosed ? (
                        <button onClick={() => setStatut('en_cours')} className="mt-2 text-xs inline-flex items-center gap-1 text-slate-500 hover:text-emerald-700">
                          <RefreshCw className="w-3.5 h-3.5" /> Rouvrir
                        </button>
                      ) : (
                        <button onClick={() => setConfirmClose(true)} className="mt-2 text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-700 text-white hover:bg-slate-800">
                          <Lock className="w-3.5 h-3.5" /> Clôturer
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Synthèse */}
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="ev-detail-synth">Synthèse de la campagne</label>
                  <textarea id="ev-detail-synth" value={synthese} onChange={(e) => setSynthese(e.target.value)} disabled={readonly}
                    rows={2} className="input-modern w-full text-sm" placeholder="Analyse d'ensemble, écarts majeurs, décisions…" />
                  {!readonly && (
                    <div className="flex justify-end mt-1">
                      <button onClick={saveSynthese} disabled={savingMeta || synthese === (detail.synthese || '')}
                        className="text-xs px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                        {savingMeta ? 'Enregistrement…' : 'Enregistrer la synthèse'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {isClosed && (
                <div className="text-xs bg-slate-100 border border-slate-200 text-slate-600 rounded-lg p-2.5 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Campagne clôturée — cotations en lecture seule. Rouvrez-la pour modifier.
                </div>
              )}

              {/* Grille de cotation des 27 critères */}
              <div className="bg-white rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                      <th className="px-2 py-2 font-medium">Critère</th>
                      <th className="px-2 py-2 font-medium">Niveau constaté</th>
                      <th className="px-2 py-2 font-medium">Constat</th>
                      <th className="px-2 py-2 font-medium">Écart</th>
                      <th className="px-2 py-2 font-medium">Action corrective</th>
                      {!readonly && <th className="px-2 py-2 font-medium" />}
                    </tr>
                  </thead>
                  <tbody>
                    {criteres.map((c, i) => {
                      const prevCh = criteres[i - 1]?.chapitre;
                      return (
                        <Fragment key={c.code}>
                          {c.chapitre !== prevCh && (
                            <tr className="bg-slate-50/70">
                              <td colSpan={readonly ? 5 : 6} className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                                Chapitre {c.chapitre} — {CHAPITRE_LABELS[c.chapitre]}
                              </td>
                            </tr>
                          )}
                          <ItemRow critere={c} item={itemsByCode[c.code]} actions={actions} readonly={readonly} onSave={saveItem} />
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <CreateEvalForm
          users={users}
          restricted={restricted}
          onClose={() => setCreateOpen(false)}
          onSaved={(id) => { setCreateOpen(false); loadList(); if (id) setSelectedId(id); }}
        />
      )}

      <ConfirmDialog
        isOpen={confirmClose}
        title="Clôturer la campagne ?"
        message="Les cotations passeront en lecture seule. La campagne pourra être rouverte ensuite."
        confirmLabel="Clôturer"
        confirmVariant="primary"
        onConfirm={() => setStatut('cloturee')}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
