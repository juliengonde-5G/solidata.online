import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useToast } from '../Toast';
import { ACTION_CATEGORY_LABELS, ACTION_PRIORITY_LABELS, entretienLabel } from './freins';
import { getInsertionParametres, PARAMETRES_DEFAUTS, plusJours } from './parametres';

/**
 * « + Action » global (REC-UX-04) — saisie d'une action au vol en ≤ 30 s.
 * 2 champs obligatoires : salarié (pré-rempli si contexte, récents d'abord)
 * et libellé. Le reste a des valeurs par défaut (catégorie insertion,
 * criticité moyenne, échéance +N j — N lu dans les réglages
 * insertion.echeance_action_defaut_jours, défaut 14, REC-UX-18) ; partenaire
 * et rattachement facultatifs, repliés. Entrée = valider. Toast de
 * confirmation, aucune navigation.
 */

const RECENTS_KEY = 'solidata_insertion_recents';
function getRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
}
export function pushRecent(employeeId) {
  try {
    const r = [employeeId, ...getRecents().filter((x) => x !== employeeId)].slice(0, 8);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(r));
  } catch { /* stockage local indisponible */ }
}

export default function QuickActionButton({ defaultEmployeeId = null, defaultEmployeeName = '', defaultMilestoneId = null, onCreated, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 whitespace-nowrap ${className}`}
        title="Noter une action au vol (≤ 30 s) — Entrée pour valider">
        + Action
      </button>
      {open && (
        <QuickActionModal
          defaultEmployeeId={defaultEmployeeId}
          defaultEmployeeName={defaultEmployeeName}
          defaultMilestoneId={defaultMilestoneId}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      )}
    </>
  );
}

function QuickActionModal({ defaultEmployeeId, defaultEmployeeName, defaultMilestoneId, onClose, onCreated }) {
  const toast = useToast();
  const [employees, setEmployees] = useState([]);
  const [partenaires, setPartenaires] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [objectifs, setObjectifs] = useState([]);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const labelRef = useRef(null);
  const searchRef = useRef(null);

  const [form, setForm] = useState({
    employee_id: defaultEmployeeId || null,
    action_label: '',
    category: 'insertion',
    priority: 'moyenne',
    echeance: plusJours(PARAMETRES_DEFAUTS.echeance_action_defaut_jours),
    partenaire_id: '',
    milestone_id: defaultMilestoneId || '',
    objectif_id: '',
  });

  useEffect(() => {
    api.get('/insertion').then((r) => setEmployees(Array.isArray(r.data) ? r.data : [])).catch(() => setEmployees([]));
    api.get('/insertion/partenaires?actifs=1').then((r) => setPartenaires(Array.isArray(r.data) ? r.data : [])).catch(() => setPartenaires([]));
    // Échéance par défaut paramétrée (REC-UX-18) — appliquée seulement si
    // l'utilisateur n'a pas déjà modifié le champ.
    getInsertionParametres().then((p) => {
      const jours = Number(p.echeance_action_defaut_jours) || PARAMETRES_DEFAUTS.echeance_action_defaut_jours;
      setForm((f) => (f.echeance === plusJours(PARAMETRES_DEFAUTS.echeance_action_defaut_jours)
        ? { ...f, echeance: plusJours(jours) } : f));
    });
  }, []);

  // Rattachements (facultatifs) chargés quand un salarié est choisi ET que le
  // panneau « plus d'options » est ouvert — pas de requête inutile sur le geste court.
  useEffect(() => {
    if (!form.employee_id || !showMore) return;
    api.get(`/insertion/milestones/${form.employee_id}`).then((r) => setMilestones(Array.isArray(r.data) ? r.data : [])).catch(() => setMilestones([]));
    api.get(`/insertion/objectifs/${form.employee_id}`).then((r) => setObjectifs(Array.isArray(r.data) ? r.data : [])).catch(() => setObjectifs([]));
  }, [form.employee_id, showMore]);

  useEffect(() => {
    const t = setTimeout(() => (defaultEmployeeId ? labelRef.current : searchRef.current)?.focus(), 60);
    return () => clearTimeout(t);
  }, [defaultEmployeeId]);

  // Salariés : récents d'abord, puis filtre de recherche.
  const recents = getRecents();
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filtered = employees
    .filter((e) => !search.trim() || norm(`${e.first_name} ${e.last_name}`).includes(norm(search).trim()))
    .sort((a, b) => {
      const ra = recents.indexOf(a.id), rb = recents.indexOf(b.id);
      if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
    });

  const selectedEmp = employees.find((e) => e.id === form.employee_id)
    || (defaultEmployeeId ? { id: defaultEmployeeId, first_name: defaultEmployeeName, last_name: '' } : null);

  const submit = async () => {
    if (saving) return;
    if (!form.employee_id) { setError('Choisissez le salarié concerné.'); return; }
    if (!form.action_label.trim()) { setError("Indiquez ce qu'il y a à faire (libellé)."); labelRef.current?.focus(); return; }
    setSaving(true); setError(null);
    try {
      await api.post('/insertion/action-plans', {
        employee_id: form.employee_id,
        action_label: form.action_label.trim(),
        category: form.category,
        priority: form.priority,
        echeance: form.echeance || null,
        partenaire_id: form.partenaire_id ? Number(form.partenaire_id) : null,
        milestone_id: form.milestone_id ? Number(form.milestone_id) : null,
        objectif_id: form.objectif_id ? Number(form.objectif_id) : null,
      });
      pushRecent(form.employee_id);
      const emp = employees.find((e) => e.id === form.employee_id);
      toast.success(`Action ajoutée pour ${emp ? `${emp.first_name} ${emp.last_name}` : defaultEmployeeName || 'le salarié'}`);
      if (onCreated) onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Erreur lors de l'ajout de l'action");
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Nouvelle action</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="Fermer">×</button>
        </div>

        {error && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}

        {/* Salarié (obligatoire) */}
        {selectedEmp && form.employee_id ? (
          <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 text-sm">
            <span className="font-medium text-teal-800">{selectedEmp.first_name} {selectedEmp.last_name}</span>
            {!defaultEmployeeId && (
              <button type="button" onClick={() => setForm({ ...form, employee_id: null, milestone_id: '', objectif_id: '' })}
                className="text-xs text-teal-700 hover:underline">Changer</button>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Salarié <span className="text-red-500">*</span></label>
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un salarié…" className="input-modern py-1.5 w-full" />
            <ul className="max-h-36 overflow-y-auto border rounded-lg mt-1 divide-y">
              {filtered.slice(0, 20).map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => { setForm({ ...form, employee_id: e.id }); setTimeout(() => labelRef.current?.focus(), 30); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-teal-50 flex items-center justify-between">
                    <span>{e.first_name} {e.last_name}</span>
                    {recents.includes(e.id) && <span className="text-[10px] text-gray-400">récent</span>}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-3 py-2 text-xs text-gray-400">Aucun salarié trouvé.</li>}
            </ul>
          </div>
        )}

        {/* Libellé (obligatoire) */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Quoi ? <span className="text-red-500">*</span></label>
          <input ref={labelRef} value={form.action_label} onChange={(e) => setForm({ ...form, action_label: e.target.value })}
            placeholder="Ex. : Rappeler la CAF pour le dossier APL" className="input-modern py-1.5 w-full" />
        </div>

        {/* Valeurs par défaut visibles, modifiables d'un geste */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] text-gray-400 mb-0.5">Catégorie</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-modern py-1 text-xs w-full">
              {Object.entries(ACTION_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-0.5">Criticité</label>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input-modern py-1 text-xs w-full">
              {Object.entries(ACTION_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-0.5">Échéance</label>
            <input type="date" value={form.echeance} onChange={(e) => setForm({ ...form, echeance: e.target.value })} className="input-modern py-1 text-xs w-full" />
          </div>
        </div>

        {/* Facultatif, replié */}
        {!showMore ? (
          <button type="button" onClick={() => setShowMore(true)} className="text-xs text-gray-400 hover:text-gray-600 underline">
            + partenaire / rattachement (facultatif)
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-2 border-t pt-2">
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">Partenaire mobilisé</label>
              <select value={form.partenaire_id} onChange={(e) => setForm({ ...form, partenaire_id: e.target.value })} className="input-modern py-1 text-xs w-full">
                <option value="">— aucun —</option>
                {partenaires.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-gray-400 mb-0.5">Entretien lié</label>
                <select value={form.milestone_id} onChange={(e) => setForm({ ...form, milestone_id: e.target.value })} className="input-modern py-1 text-xs w-full" disabled={!form.employee_id}>
                  <option value="">— aucun —</option>
                  {milestones.map((m) => <option key={m.id} value={m.id}>{entretienLabel(m)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-gray-400 mb-0.5">Objectif lié</label>
                <select value={form.objectif_id} onChange={(e) => setForm({ ...form, objectif_id: e.target.value })} className="input-modern py-1 text-xs w-full" disabled={!form.employee_id}>
                  <option value="">— aucun —</option>
                  {objectifs.map((o) => <option key={o.id} value={o.id}>{o.titre}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-gray-400">Entrée pour valider · Échap pour annuler</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
            <button type="button" onClick={submit} disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
              {saving ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
