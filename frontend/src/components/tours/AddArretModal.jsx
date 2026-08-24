import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Settings, ExternalLink } from 'lucide-react';
import api from '../../services/api';
import { getArretCategoryMeta } from './arretCategories';

/**
 * AddArretModal — ajoute un arrêt technique au programme d'une tournée en
 * cours : soit un lieu du référentiel (`/tours/lieux-techniques`), soit un
 * libellé ponctuel (dépannage imprévu, etc.). Reste ouverte après un ajout
 * réussi pour permettre d'enchaîner plusieurs arrêts (ex. carburant puis
 * pause) sans réouvrir la modale.
 *
 * Props :
 *  - tourId  : id de la tournée
 *  - onClose : () => void
 *  - onAdded : (points) => void — appelé avec le programme à jour renvoyé par l'API
 */
export default function AddArretModal({ tourId, onClose, onAdded }) {
  const [mode, setMode] = useState('lieu'); // 'lieu' | 'libre'
  const [lieux, setLieux] = useState([]);
  const [loadingLieux, setLoadingLieux] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [lieuId, setLieuId] = useState('');
  const [libelle, setLibelle] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successCount, setSuccessCount] = useState(0);

  const loadLieux = useCallback(async () => {
    setLoadingLieux(true);
    setLoadError(null);
    try {
      const res = await api.get('/tours/lieux-techniques');
      setLieux((res.data || []).filter((l) => l.is_active !== false));
    } catch (err) {
      console.error('[AddArretModal] lieux-techniques:', err);
      setLoadError('Impossible de charger le référentiel des lieux');
    } finally {
      setLoadingLieux(false);
    }
  }, []);

  useEffect(() => { loadLieux(); }, [loadLieux]);

  const canSubmit = mode === 'lieu' ? !!lieuId : libelle.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedNotes = notes.trim() || undefined;
      const body = mode === 'lieu'
        ? { lieu_id: parseInt(lieuId, 10), notes: trimmedNotes }
        : { libelle: libelle.trim(), notes: trimmedNotes };
      const res = await api.post(`/tours/${tourId}/programme/arret`, body);
      onAdded(res.data.points);
      setSuccessCount((c) => c + 1);
      setLieuId('');
      setLibelle('');
      setNotes('');
    } catch (err) {
      const code = err.response?.data?.code;
      setError(
        code === 'TOURNEE_NON_MODIFIABLE'
          ? "Cette tournée n'est plus modifiable."
          : (err.response?.data?.error || "Erreur lors de l'ajout de l'arrêt")
      );
    } finally {
      setSaving(false);
    }
  };

  // Portail vers <body> : au-dessus d'une carte Leaflet (calques à z-index
  // 400, contrôles à 800), une modale rendue dans le flux de la page passe
  // dessous et se retrouve tronquée.
  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-[2000] flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-6">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 text-sm">Ajouter un arrêt technique</h3>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('lieu')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${mode === 'lieu' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Lieu du référentiel
            </button>
            <button
              type="button"
              onClick={() => setMode('libre')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${mode === 'libre' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Libellé ponctuel
            </button>
          </div>

          {mode === 'lieu' ? (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Lieu *</label>
              {loadError ? (
                <p className="text-xs text-red-600">{loadError}</p>
              ) : (
                <select value={lieuId} onChange={(e) => setLieuId(e.target.value)} disabled={loadingLieux} className="input-modern text-sm w-full">
                  <option value="">{loadingLieux ? 'Chargement…' : '— Choisir un lieu —'}</option>
                  {lieux.map((l) => {
                    const meta = getArretCategoryMeta(l.categorie);
                    return <option key={l.id} value={l.id}>{l.nom} — {meta.label}{l.duree_min ? ` (${l.duree_min} min)` : ''}</option>;
                  })}
                </select>
              )}
              {!loadingLieux && lieux.length === 0 && !loadError && (
                <p className="text-[11px] text-slate-400 mt-1">Aucun lieu actif dans le référentiel.</p>
              )}
              <a
                href="/admin-lieux-techniques"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:underline mt-1.5"
              >
                <Settings className="w-3 h-3" /> Gérer les lieux d'arrêt <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Libellé *</label>
              <input
                value={libelle}
                onChange={(e) => setLibelle(e.target.value)}
                placeholder="Ex. Dépannage ponctuel — garage Dupont"
                className="input-modern text-sm w-full"
                maxLength={200}
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-500 mb-1">Notes (facultatif)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="input-modern text-sm w-full resize-none"
              maxLength={500}
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">{error}</div>
          )}
          {successCount > 0 && !error && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
              {successCount} arrêt{successCount > 1 ? 's' : ''} ajouté{successCount > 1 ? 's' : ''} au programme. Vous pouvez en ajouter un autre ou fermer.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">
            Fermer
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !canSubmit}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Ajout…' : 'Ajouter au programme'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
