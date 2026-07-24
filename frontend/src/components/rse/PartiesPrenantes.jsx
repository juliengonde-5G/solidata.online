import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, MessageSquare, Filter } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import {
  PP_CATEGORIES, INFLUENCE_INTERET_LABELS, INTERACTION_TYPE_LABELS, INTERACTION_TYPE_STYLES,
  frDate, apiErr,
} from './rseShared';

// ── Matrice influence × intérêt (buckets 4×4, sans chevauchement) ────────────
function MatricePP({ pps, onSelect }) {
  const actifs = pps.filter((p) => p.actif !== false);
  const nonPositionnees = actifs.filter((p) => p.influence == null || p.interet == null);
  const cell = (inf, itr) => actifs.filter((p) => p.influence === inf && p.interet === itr);
  const cellTone = (inf, itr) => {
    if (inf >= 3 && itr >= 3) return 'bg-emerald-50 border-emerald-200';
    if (inf >= 3) return 'bg-amber-50 border-amber-200';
    if (itr >= 3) return 'bg-blue-50 border-blue-200';
    return 'bg-slate-50 border-slate-200';
  };
  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Matrice influence × intérêt</h3>
      <div className="flex gap-2">
        {/* Axe Y */}
        <div className="flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold text-slate-400 uppercase [writing-mode:vertical-rl] rotate-180">Influence →</span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-4 gap-1.5">
            {[4, 3, 2, 1].map((inf) => (
              [1, 2, 3, 4].map((itr) => {
                const items = cell(inf, itr);
                return (
                  <div key={`${inf}-${itr}`} className={`min-h-[62px] rounded-lg border p-1.5 ${cellTone(inf, itr)}`}>
                    <div className="text-[9px] text-slate-400 mb-0.5">I{inf}·A{itr}</div>
                    <div className="flex flex-wrap gap-1">
                      {items.map((p) => (
                        <button key={p.id} onClick={() => onSelect(p)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 truncate max-w-[110px]"
                          title={`${p.nom}${p.categorie ? ` (${p.categorie})` : ''}`}>
                          {p.nom}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            ))}
          </div>
          <div className="text-center text-[10px] font-semibold text-slate-400 uppercase mt-1">Intérêt →</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-slate-400">
        <span><span className="inline-block w-2.5 h-2.5 rounded bg-emerald-100 border border-emerald-200 mr-1 align-middle" />Piloter de près (influence & intérêt forts)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded bg-amber-100 border border-amber-200 mr-1 align-middle" />Satisfaire</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded bg-blue-100 border border-blue-200 mr-1 align-middle" />Informer</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded bg-slate-100 border border-slate-200 mr-1 align-middle" />Surveiller</span>
      </div>
      {nonPositionnees.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-2">
          Non positionnées (influence/intérêt à renseigner) : {nonPositionnees.map((p) => p.nom).join(', ')}
        </p>
      )}
    </div>
  );
}

// ── Formulaire partie prenante ────────────────────────────────────────────────
function PPForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    nom: initial?.nom || '', categorie: initial?.categorie || '',
    influence: initial?.influence ?? '', interet: initial?.interet ?? '',
    attentes: initial?.attentes || '', actif: initial?.actif ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.nom.trim()) { setError('Le nom est obligatoire.'); return; }
    setSaving(true); setError(null);
    const payload = {
      nom: form.nom.trim(),
      categorie: form.categorie.trim() || null,
      influence: form.influence === '' ? null : parseInt(form.influence, 10),
      interet: form.interet === '' ? null : parseInt(form.interet, 10),
      attentes: form.attentes.trim() || null,
    };
    if (initial?.id) payload.actif = form.actif;
    try {
      if (initial?.id) await api.put(`/rse/parties-prenantes/${initial.id}`, payload);
      else await api.post('/rse/parties-prenantes', payload);
      onSaved();
    } catch (err) { setError(apiErr(err)); setSaving(false); }
  };

  return (
    <Modal
      isOpen onClose={onClose} title={initial?.id ? 'Modifier la partie prenante' : 'Nouvelle partie prenante'} size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pp-nom">Nom <span className="text-red-500">*</span></label>
          <input id="pp-nom" value={form.nom} onChange={(e) => set('nom', e.target.value)} className="input-modern w-full text-sm" placeholder="Ex. DDETS 76, France Travail, Métropole…" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pp-cat">Catégorie</label>
          <input id="pp-cat" list="pp-cat-list" value={form.categorie} onChange={(e) => set('categorie', e.target.value)} className="input-modern w-full text-sm" placeholder="Financeur, prescripteur…" />
          <datalist id="pp-cat-list">{PP_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pp-inf">Influence</label>
            <select id="pp-inf" value={form.influence} onChange={(e) => set('influence', e.target.value)} className="input-modern w-full text-sm">
              <option value="">Non évaluée</option>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} · {INFLUENCE_INTERET_LABELS[n]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pp-itr">Intérêt</label>
            <select id="pp-itr" value={form.interet} onChange={(e) => set('interet', e.target.value)} className="input-modern w-full text-sm">
              <option value="">Non évalué</option>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} · {INFLUENCE_INTERET_LABELS[n]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pp-att">Attentes</label>
          <textarea id="pp-att" value={form.attentes} onChange={(e) => set('attentes', e.target.value)} rows={2} className="input-modern w-full text-sm" />
        </div>
        {initial?.id && (
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={form.actif} onChange={(e) => set('actif', e.target.checked)} className="rounded border-slate-300" />
            Partie prenante active
          </label>
        )}
      </div>
    </Modal>
  );
}

// ── Formulaire d'interaction ──────────────────────────────────────────────────
function InteractionForm({ pps, defaultPP, onClose, onSaved }) {
  const [form, setForm] = useState({
    partie_prenante_id: defaultPP || '', date_interaction: '', canal: '', objet: '', type: 'dialogue', reponse_apportee: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.partie_prenante_id) { setError('Sélectionnez une partie prenante.'); return; }
    setSaving(true); setError(null);
    try {
      await api.post('/rse/interactions', {
        partie_prenante_id: parseInt(form.partie_prenante_id, 10),
        date_interaction: form.date_interaction || null,
        canal: form.canal.trim() || null,
        objet: form.objet.trim() || null,
        type: form.type,
        reponse_apportee: form.reponse_apportee.trim() || null,
      });
      onSaved();
    } catch (err) { setError(apiErr(err)); setSaving(false); }
  };

  return (
    <Modal
      isOpen onClose={onClose} title="Nouvelle interaction" size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="int-pp">Partie prenante <span className="text-red-500">*</span></label>
          <select id="int-pp" value={form.partie_prenante_id} onChange={(e) => set('partie_prenante_id', e.target.value)} className="input-modern w-full text-sm">
            <option value="">Sélectionner…</option>
            {pps.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="int-date">Date</label>
            <input id="int-date" type="date" value={form.date_interaction} onChange={(e) => set('date_interaction', e.target.value)} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="int-type">Type</label>
            <select id="int-type" value={form.type} onChange={(e) => set('type', e.target.value)} className="input-modern w-full text-sm">
              {Object.entries(INTERACTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="int-canal">Canal</label>
          <input id="int-canal" value={form.canal} onChange={(e) => set('canal', e.target.value)} className="input-modern w-full text-sm" placeholder="COPIL, e-mail, réunion, téléphone…" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="int-objet">Objet</label>
          <textarea id="int-objet" value={form.objet} onChange={(e) => set('objet', e.target.value)} rows={2} className="input-modern w-full text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="int-rep">Réponse apportée</label>
          <textarea id="int-rep" value={form.reponse_apportee} onChange={(e) => set('reponse_apportee', e.target.value)} rows={2} className="input-modern w-full text-sm" placeholder="Boucle de retour : ce qui a été fait / répondu" />
        </div>
      </div>
    </Modal>
  );
}

export default function PartiesPrenantes({ canWrite }) {
  const [pps, setPps] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ppFormOpen, setPpFormOpen] = useState(false);
  const [editingPP, setEditingPP] = useState(null);
  const [intFormOpen, setIntFormOpen] = useState(false);
  const [intDefaultPP, setIntDefaultPP] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const [filterPP, setFilterPP] = useState('');

  const loadPps = useCallback(() => {
    setLoading(true);
    api.get('/rse/parties-prenantes')
      .then((r) => { setPps(Array.isArray(r.data) ? r.data : []); setError(null); })
      .catch((err) => setError(apiErr(err)))
      .finally(() => setLoading(false));
  }, []);

  const loadInteractions = useCallback(() => {
    const p = new URLSearchParams();
    if (filterPP) p.append('partie_prenante_id', filterPP);
    api.get(`/rse/interactions?${p}`)
      .then((r) => setInteractions(Array.isArray(r.data) ? r.data : []))
      .catch((err) => setError(apiErr(err)));
  }, [filterPP]);

  useEffect(() => { loadPps(); }, [loadPps]);
  useEffect(() => { loadInteractions(); }, [loadInteractions]);

  const removePP = async (p) => {
    try {
      await api.delete(`/rse/parties-prenantes/${p.id}`);
      setConfirmDel(null);
      loadPps(); loadInteractions();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  const openPP = (p) => { setEditingPP(p); setPpFormOpen(true); };
  const newInteraction = (ppId = '') => { setIntDefaultPP(ppId); setIntFormOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Parties prenantes</h2>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button onClick={() => newInteraction('')} className="btn-ghost text-sm inline-flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4" /> Interaction
            </button>
            <button onClick={() => openPP(null)} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Partie prenante
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement des parties prenantes…" />
      ) : (
        <>
          {pps.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
              <p className="text-sm">Aucune partie prenante enregistrée.</p>
              {canWrite && <p className="text-xs mt-1">Cartographiez financeurs, prescripteurs, clients, collectivités, fournisseurs et partenaires.</p>}
            </div>
          ) : (
            <>
              <MatricePP pps={pps} onSelect={openPP} />

              {/* Tableau des PP */}
              <div className="bg-white rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                      <th className="px-3 py-2 font-medium">Nom</th>
                      <th className="px-3 py-2 font-medium">Catégorie</th>
                      <th className="px-3 py-2 font-medium">Influence</th>
                      <th className="px-3 py-2 font-medium">Intérêt</th>
                      <th className="px-3 py-2 font-medium">Attentes</th>
                      <th className="px-3 py-2 font-medium">Échanges</th>
                      {canWrite && <th className="px-3 py-2 font-medium text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pps.map((p) => (
                      <tr key={p.id} className={`border-b border-slate-100 ${p.actif === false ? 'opacity-50' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2 font-medium text-slate-700">
                          {p.nom}{p.actif === false && <span className="ml-1.5 text-[10px] text-slate-400">(inactive)</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{p.categorie || '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{p.influence != null ? `${p.influence} · ${INFLUENCE_INTERET_LABELS[p.influence]}` : '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{p.interet != null ? `${p.interet} · ${INFLUENCE_INTERET_LABELS[p.interet]}` : '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 max-w-[220px] truncate" title={p.attentes || ''}>{p.attentes || '—'}</td>
                        <td className="px-3 py-2 text-xs">
                          <button onClick={() => setFilterPP(String(p.id))} className="text-emerald-700 hover:underline" title="Filtrer le journal sur cette partie prenante">
                            {p.nb_interactions || 0} échange{(p.nb_interactions || 0) > 1 ? 's' : ''}
                          </button>
                        </td>
                        {canWrite && (
                          <td className="px-3 py-2 whitespace-nowrap text-right">
                            <button onClick={() => newInteraction(String(p.id))} className="text-slate-400 hover:text-emerald-600 p-1" title="Ajouter une interaction" aria-label="Ajouter une interaction">
                              <MessageSquare className="w-4 h-4" />
                            </button>
                            <button onClick={() => openPP(p)} className="text-slate-400 hover:text-emerald-600 p-1" title="Modifier" aria-label="Modifier">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => setConfirmDel(p)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Journal des interactions */}
          <div className="bg-white rounded-lg border">
            <div className="flex items-center justify-between gap-2 flex-wrap p-3 border-b">
              <h3 className="text-sm font-semibold text-slate-700">Journal des dialogues, demandes & réclamations</h3>
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <select value={filterPP} onChange={(e) => setFilterPP(e.target.value)} className="input-modern py-1 text-sm w-auto">
                  <option value="">Toutes les parties prenantes</option>
                  {pps.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                </select>
              </div>
            </div>
            {interactions.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">Aucune interaction enregistrée{filterPP ? ' pour cette partie prenante' : ''}.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {interactions.map((it) => (
                  <li key={it.id} className="p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${INTERACTION_TYPE_STYLES[it.type] || ''}`}>{INTERACTION_TYPE_LABELS[it.type] || it.type}</span>
                      <span className="font-medium text-slate-700 text-sm">{it.partie_prenante_nom}</span>
                      {it.canal && <span className="text-xs text-slate-400">· {it.canal}</span>}
                      <span className="ml-auto text-xs text-slate-400">{it.date_interaction ? frDate(it.date_interaction) : ''}</span>
                    </div>
                    {it.objet && <p className="text-sm text-slate-600 mt-1">{it.objet}</p>}
                    {it.reponse_apportee && <p className="text-xs text-slate-500 mt-1"><span className="font-medium text-slate-600">Réponse :</span> {it.reponse_apportee}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {ppFormOpen && (
        <PPForm initial={editingPP} onClose={() => setPpFormOpen(false)} onSaved={() => { setPpFormOpen(false); loadPps(); }} />
      )}
      {intFormOpen && (
        <InteractionForm pps={pps} defaultPP={intDefaultPP} onClose={() => setIntFormOpen(false)}
          onSaved={() => { setIntFormOpen(false); loadInteractions(); loadPps(); }} />
      )}
      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer la partie prenante ?"
        message={confirmDel ? `« ${confirmDel.nom} » et son journal d'interactions seront supprimés.` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => removePP(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
