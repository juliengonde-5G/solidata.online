import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import {
  NOTE_SUIVI_CATEGORIES, NOTE_SUIVI_CATEGORY_LABELS, NOTE_SUIVI_CATEGORY_COLORS, frDate,
} from './freins';

/**
 * JOURNAL DE SUIVI — notes et commentaires de la CIP (2.47.0).
 *
 * Ce que ça comble : entre deux entretiens formels, l'accompagnement est fait
 * d'échanges, d'appels de partenaires et de faits marquants qui n'avaient aucun
 * endroit où être écrits. Ils vivaient dans la mémoire de la CIP — donc ils
 * disparaissaient à son absence.
 *
 * Trois partis pris :
 *  1. La DATE DE L'ÉVÉNEMENT se saisit, elle n'est pas celle de la frappe : on
 *     note souvent le lendemain ce qui s'est passé la veille, et confondre les
 *     deux fausserait la chronologie du parcours.
 *  2. Une note modifiée ou supprimée laisse sa trace (badge « modifiée » +
 *     historique dépliable) : c'est ce qui en fait une pièce du dossier plutôt
 *     qu'un bloc-notes.
 *  3. Ces notes entrent dans le raisonnement de l'assistant IA — la mention est
 *     PERMANENTE sous le champ de saisie, pas cachée dans une aide.
 *
 * Backend : GET/POST/PUT/DELETE /insertion/notes-suivi (ADMIN/RH, chiffré,
 * chaque accès journalisé au registre RGPD).
 */
export default function NotesSuiviPanel({ employeeId, readOnly = false, onChanged }) {
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);   // note en cours de correction
  const [historique, setHistorique] = useState({}); // { [noteId]: [versions] }

  const vide = { contenu: '', categorie: 'suivi', date_note: new Date().toISOString().slice(0, 10) };
  const [form, setForm] = useState(vide);

  const load = useCallback(() => {
    let alive = true;
    api.get(`/insertion/notes-suivi/${employeeId}`)
      .then((r) => { if (alive) { setNotes(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [employeeId]);

  useEffect(() => load(), [load]);

  const fermer = () => { setShowForm(false); setEditing(null); setForm(vide); };

  const enregistrer = async () => {
    const contenu = form.contenu.trim();
    if (!contenu) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/insertion/notes-suivi/${editing.id}`, {
          contenu, categorie: form.categorie, date_note: form.date_note,
        });
      } else {
        await api.post('/insertion/notes-suivi', {
          employee_id: employeeId, contenu, categorie: form.categorie, date_note: form.date_note,
        });
      }
      fermer();
      load();
      setError(null);
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  const supprimer = async (note) => {
    // La suppression retire la note de l'écran mais conserve son dernier état
    // dans l'historique : le dire ici évite de le faire croire irréversible.
    if (!window.confirm('Supprimer cette note ? Son dernier état restera consultable dans l\'historique.')) return;
    try {
      await api.delete(`/insertion/notes-suivi/${note.id}`);
      load();
      if (onChanged) onChanged();
    } catch (err) { setError(err.response?.data?.error || err.message); }
  };

  const basculerHistorique = async (note) => {
    if (historique[note.id]) { setHistorique((h) => ({ ...h, [note.id]: null })); return; }
    try {
      const r = await api.get(`/insertion/notes-suivi/${note.id}/historique`);
      setHistorique((h) => ({ ...h, [note.id]: Array.isArray(r.data) ? r.data : [] }));
    } catch (err) { setError(err.response?.data?.error || err.message); }
  };

  const ouvrirEdition = (note) => {
    setEditing(note);
    setShowForm(true);
    setForm({
      contenu: note.contenu || '',
      categorie: note.categorie || 'suivi',
      date_note: (note.date_note || '').slice(0, 10),
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="font-semibold text-gray-700 text-sm">Notes / commentaires ({notes.length})</h4>
        {!readOnly && !showForm && (
          <button type="button" onClick={() => { setEditing(null); setForm(vide); setShowForm(true); }}
            className="px-3 py-1 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700">
            + Note
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

      {showForm && !readOnly && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-gray-600">
              Date de l'événement
              <input type="date" value={form.date_note}
                onChange={(e) => setForm({ ...form, date_note: e.target.value })}
                className="input-modern py-1 text-xs ml-1" />
            </label>
            <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}
              className="text-xs border rounded px-2 py-1 bg-white">
              {NOTE_SUIVI_CATEGORIES.map((c) => (
                <option key={c} value={c}>{NOTE_SUIVI_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <textarea value={form.contenu} onChange={(e) => setForm({ ...form, contenu: e.target.value })}
            rows={4} maxLength={5000} autoFocus
            placeholder="Ce qui s'est passé, ce qui a été dit, ce qui reste à vérifier…"
            className="input-modern text-sm w-full" />
          <p className="text-[10px] text-gray-500">
            Cette note est datée, conservée dans le dossier et <strong>prise en compte par l'assistant IA</strong> lors
            de l'analyse du profil et de la préparation des entretiens. Accès réservé aux comptes ADMIN et RH ;
            chaque consultation est journalisée.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={enregistrer} disabled={saving || !form.contenu.trim()}
              className="px-3 py-1 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50">
              {saving ? 'Enregistrement…' : (editing ? 'Enregistrer la correction' : 'Ajouter la note')}
            </button>
            <button type="button" onClick={fermer} className="px-3 py-1 rounded-lg border text-xs text-gray-600">Annuler</button>
            {editing && <span className="text-[10px] text-gray-500">La version actuelle sera conservée dans l'historique.</span>}
          </div>
        </div>
      )}

      {loaded && notes.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-4 border border-dashed rounded-lg">
          <p>Aucune note de suivi.</p>
          {!readOnly && (
            <p className="text-xs mt-1">
              Un échange dans l'atelier, un appel d'un partenaire, un fait marquant : c'est ici qu'il se note.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-gray-700">{frDate(n.date_note)}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${NOTE_SUIVI_CATEGORY_COLORS[n.categorie] || 'bg-gray-100 text-gray-600'}`}>
                {NOTE_SUIVI_CATEGORY_LABELS[n.categorie] || n.categorie}
              </span>
              {n.milestone_titre && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-500">Entretien : {n.milestone_titre}</span>
              )}
              <span className="flex-1" />
              {n.versions_anterieures > 0 && (
                <button type="button" onClick={() => basculerHistorique(n)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">
                  modifiée ({n.versions_anterieures}) — {historique[n.id] ? 'masquer' : 'voir l\'historique'}
                </button>
              )}
              {!readOnly && (
                <>
                  <button type="button" onClick={() => ouvrirEdition(n)} className="text-[10px] text-gray-500 hover:text-teal-700">Modifier</button>
                  <button type="button" onClick={() => supprimer(n)} className="text-[10px] text-gray-400 hover:text-red-600">Supprimer</button>
                </>
              )}
            </div>

            {n.contenu_illisible ? (
              <p className="mt-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-1.5">
                Contenu illisible (clé de chiffrement modifiée) — la note ne peut pas être affichée.
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap">{n.contenu}</p>
            )}

            <div className="mt-1 text-[10px] text-gray-400">
              {n.created_by_name ? `Écrite par ${n.created_by_name}` : 'Auteur non renseigné'}
              {n.created_at ? ` le ${frDate(n.created_at)}` : ''}
              {n.updated_at ? ` — corrigée le ${frDate(n.updated_at)}${n.updated_by_name ? ` par ${n.updated_by_name}` : ''}` : ''}
            </div>

            {historique[n.id] && (
              <div className="mt-2 border-t pt-2 space-y-1">
                {historique[n.id].length === 0 && <p className="text-[11px] text-gray-400">Aucune version antérieure.</p>}
                {historique[n.id].map((v) => (
                  <div key={v.id} className="text-[11px] bg-gray-50 border border-gray-200 rounded p-1.5">
                    <div className="text-gray-500">
                      Version du {frDate(v.date_note)} — remplacée le {frDate(v.changed_at)}
                      {v.changed_by_name ? ` par ${v.changed_by_name}` : ''}
                    </div>
                    <div className="text-gray-700 whitespace-pre-wrap mt-0.5">
                      {v.contenu_illisible ? '(contenu illisible)' : v.contenu}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
