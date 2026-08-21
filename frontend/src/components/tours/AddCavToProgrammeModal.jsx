import { useState, useEffect, useMemo } from 'react';
import { X, Search, Plus, MapPin } from 'lucide-react';
import api from '../../services/api';

// Seuils repris de CavPicker.jsx / FillRateMap.jsx pour une cohérence visuelle.
function fillBadgeClass(rate) {
  if (rate >= 80) return 'bg-red-100 text-red-700';
  if (rate >= 60) return 'bg-orange-100 text-orange-700';
  if (rate >= 40) return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
}

/**
 * AddCavToProgrammeModal — ajoute UN point de collecte (CAV) au programme
 * d'une tournée déjà partie. Recherche simple (nom/adresse/commune) sur le
 * référentiel `/cav/fill-rate` (même source que CavPicker), en excluant les
 * CAV déjà présents au programme. Chaque clic déclenche immédiatement
 * POST /tours/:id/programme/cav — pas de composition différée : la tournée
 * est en cours, l'ajout doit être visible tout de suite.
 *
 * Props :
 *  - tourId      : id de la tournée
 *  - excludeIds  : number[] — ids des CAV déjà au programme (ref_id)
 *  - onClose     : () => void
 *  - onAdded     : (points) => void — appelé avec le programme à jour renvoyé par l'API
 */
export default function AddCavToProgrammeModal({ tourId, excludeIds, onClose, onAdded }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [addingId, setAddingId] = useState(null);
  const [addError, setAddError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/cav/fill-rate')
      .then((res) => { if (!cancelled) setItems(res.data?.cavs || []); })
      .catch((err) => {
        console.error('[AddCavToProgrammeModal] fill-rate:', err);
        if (!cancelled) setLoadError('Impossible de charger la liste des CAV');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items.filter((i) => !(excludeIds || []).includes(i.id));
    if (q) {
      list = list.filter((i) =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.address || '').toLowerCase().includes(q) ||
        (i.commune || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
  }, [items, excludeIds, search]);

  const addItem = async (cav) => {
    setAddingId(cav.id);
    setAddError(null);
    try {
      const res = await api.post(`/tours/${tourId}/programme/cav`, { cav_id: cav.id });
      onAdded(res.data.points);
    } catch (err) {
      const code = err.response?.data?.code;
      setAddError(
        code === 'POINT_DEJA_PRESENT'
          ? `« ${cav.name} » est déjà au programme de cette tournée.`
          : code === 'TOURNEE_NON_MODIFIABLE'
            ? "Cette tournée n'est plus modifiable."
            : (err.response?.data?.error || "Erreur lors de l'ajout de ce point")
      );
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-6 flex flex-col max-h-[85vh]">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold text-slate-800 text-sm">Ajouter un point de collecte</h3>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 border-b border-slate-100 flex-shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nom, adresse, commune…"
              className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
        </div>

        {addError && (
          <div className="mx-3 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 flex-shrink-0">
            {addError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {loading ? (
            <p className="text-xs text-slate-400 text-center py-6">Chargement…</p>
          ) : loadError ? (
            <p className="text-xs text-red-500 text-center py-6">{loadError}</p>
          ) : available.length === 0 ? (
            <div className="text-center py-8 px-3">
              <MapPin className="w-6 h-6 text-slate-300 mx-auto mb-1.5" />
              <p className="text-xs text-slate-400">Aucun CAV disponible{search ? ' pour cette recherche' : ''}.</p>
            </div>
          ) : available.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => addItem(item)}
              disabled={addingId === item.id}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-teal-50/60 transition-colors disabled:opacity-50"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-slate-100 text-slate-400 grid place-items-center">
                <Plus className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-slate-700 truncate">{item.name}</span>
                <span className="block text-[10px] text-slate-400 truncate">{item.commune || item.address || '—'}</span>
              </span>
              {item.fill_rate != null && (
                <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${fillBadgeClass(item.fill_rate)}`}>
                  {addingId === item.id ? '…' : `${item.fill_rate}%`}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex justify-end flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
