import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import { FAMILLE_OPTIONS, categorieLabel, apiErr } from './achatsShared';

const EMPTY = { famille: 'transverse', critere: '', poids: '', actif: true };

function CritereForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY, ...initial,
    poids: initial?.poids == null ? '' : String(initial.poids),
    famille: initial?.famille || 'transverse',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!form.critere.trim()) { setError("L'intitulé du critère est obligatoire."); return; }
    let poids = null;
    if (String(form.poids).trim() !== '') {
      const n = parseInt(form.poids, 10);
      if (!Number.isFinite(n) || n < 0 || n > 100) { setError('Le poids doit être un entier entre 0 et 100.'); return; }
      poids = n;
    }
    setSaving(true); setError(null);
    const payload = {
      famille: (form.famille || 'transverse').trim() || 'transverse',
      critere: form.critere.trim(),
      poids,
      actif: !!form.actif,
    };
    try {
      if (initial?.id) await api.put(`/achats/criteres/${initial.id}`, payload);
      else await api.post('/achats/criteres', payload);
      onSaved();
    } catch (err) {
      setError(apiErr(err, "Impossible d'enregistrer le critère."));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial?.id ? "Modifier le critère" : "Nouveau critère d'achat"}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cr-famille">Famille</label>
          <input id="cr-famille" list="cr-famille-list" value={form.famille} onChange={(e) => set('famille', e.target.value)}
            className="input-modern w-full text-sm" placeholder="transverse, fournitures, epi…" />
          <datalist id="cr-famille-list">{FAMILLE_OPTIONS.map((c) => <option key={c} value={c}>{categorieLabel(c)}</option>)}</datalist>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cr-critere">Critère <span className="text-red-500">*</span></label>
          <input id="cr-critere" value={form.critere} onChange={(e) => set('critere', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. Privilégier un fournisseur local (< 50 km)" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cr-poids">Poids (0 à 100, optionnel)</label>
          <input id="cr-poids" type="number" min={0} max={100} value={form.poids} onChange={(e) => set('poids', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. 20" />
          <p className="text-[11px] text-slate-400 mt-1">Pondération relative du critère dans la grille d'évaluation d'achat.</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={!!form.actif} onChange={(e) => set('actif', e.target.checked)} className="rounded border-slate-300" />
          Critère actif
        </label>
      </div>
    </Modal>
  );
}

export default function CriteresAchat({ canWrite }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.get('/achats/criteres')
      .then((r) => { if (alive) { setRows(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  const toggleActif = async (c) => {
    try {
      await api.put(`/achats/criteres/${c.id}`, { actif: !c.actif });
      load();
    } catch (err) { setError(apiErr(err)); }
  };

  const remove = async (c) => {
    try {
      await api.delete(`/achats/criteres/${c.id}`);
      setConfirmDel(null);
      load();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  // Regroupement par famille.
  const byFamille = {};
  for (const c of rows) (byFamille[c.famille || 'transverse'] = byFamille[c.famille || 'transverse'] || []).push(c);
  const familles = Object.keys(byFamille).sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Critères d'achat responsable</h2>
        {canWrite && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouveau critère
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400">Grille de critères administrable, regroupée par famille d'achat. Un critère désactivé reste tracé mais n'entre plus dans l'évaluation.</p>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement des critères…" />
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
          <p className="text-sm">Aucun critère d'achat au référentiel.</p>
          {canWrite && <p className="text-xs mt-1">Définissez vos critères (local, inclusif, éco-conçu, réemploi…) par famille d'achat.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {familles.map((fam) => (
            <div key={fam} className="bg-white rounded-lg border overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">{categorieLabel(fam)}</span>
                <span className="text-xs text-slate-400">{byFamille[fam].length} critère{byFamille[fam].length > 1 ? 's' : ''}</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {byFamille[fam].map((c) => (
                    <tr key={c.id} className={`border-b border-slate-100 last:border-0 ${c.actif ? '' : 'bg-slate-50/50'}`}>
                      <td className="px-3 py-2">
                        <span className={c.actif ? 'text-slate-700' : 'text-slate-400 line-through'}>{c.critere}</span>
                        {!c.actif && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inactif</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right w-24">
                        {c.poids != null
                          ? <span className="text-xs text-slate-500">poids {c.poids}</span>
                          : <span className="text-xs text-slate-300">—</span>}
                      </td>
                      {canWrite && (
                        <td className="px-3 py-2 whitespace-nowrap text-right w-32">
                          <button onClick={() => toggleActif(c)} className="text-slate-400 hover:text-emerald-600 p-1"
                            title={c.actif ? 'Désactiver' : 'Réactiver'} aria-label={c.actif ? 'Désactiver' : 'Réactiver'}>
                            {c.actif ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                          <button onClick={() => { setEditing(c); setFormOpen(true); }} className="text-slate-400 hover:text-emerald-600 p-1" title="Modifier" aria-label="Modifier">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => setConfirmDel(c)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <CritereForm
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer le critère ?"
        message={confirmDel ? `Le critère « ${confirmDel.critere} » sera supprimé. Pour le conserver sans l'évaluer, désactivez-le plutôt.` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => remove(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
