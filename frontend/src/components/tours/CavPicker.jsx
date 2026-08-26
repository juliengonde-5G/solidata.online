import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Plus, X, ArrowUp, ArrowDown, ArrowUpDown, MapPin } from 'lucide-react';
import api from '../../services/api';

/**
 * CavPicker — sélecteur réutilisable de points de collecte (CAV ou points
 * associatifs) avec liste ordonnée. Utilisé par Tours.jsx (mode manuel) et
 * RouteTemplates.jsx (composition des modèles).
 *
 * Props :
 *  - value      : number[]  — ids sélectionnés, DANS L'ORDRE de collecte
 *  - onChange   : (ids: number[]) => void
 *  - mode       : 'cav' (défaut) | 'association'
 *  - onOptimize : () => void  (optionnel) — si fourni, affiche le bouton
 *                 « Optimiser l'ordre » au-dessus de la sélection
 *  - optimizing : boolean — état de chargement du bouton optimiser
 *  - durations        : { [id]: number|null } (mode association uniquement)
 *                       — durée d'arrêt COURANTE de chaque point sélectionné.
 *                       `null` = pas d'ajustement, la cascade fiche > réglage
 *                       global s'applique côté serveur.
 *  - onDurationChange : (id, minutesOrNull) => void — appelé à chaque
 *                       modification ET pour préremplir automatiquement un
 *                       point qui vient d'entrer dans la sélection (depuis la
 *                       durée de sa fiche, `duree_collecte_min`, si connue).
 */

// Seuils repris de FillRateMap.jsx (getFillColor / getFillBg) pour une
// cohérence visuelle avec la carte des CAV.
function fillBadgeClass(rate) {
  if (rate >= 80) return 'bg-red-100 text-red-700';
  if (rate >= 60) return 'bg-orange-100 text-orange-700';
  if (rate >= 40) return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
}

// Provenance de la durée d'arrêt affichée (RG-C3, cascade tournée > fiche > global).
const DUREE_SOURCE_META = {
  ajustee: { label: 'ajustée', cls: 'bg-indigo-100 text-indigo-700' },
  fiche: { label: 'fiche', cls: 'bg-blue-100 text-blue-700' },
  global: { label: 'réglage global', cls: 'bg-slate-100 text-slate-500' },
};

const MIN_FILL_OPTIONS = [
  { value: 0, label: 'Tous les taux' },
  { value: 40, label: '≥ 40 %' },
  { value: 60, label: '≥ 60 %' },
  { value: 80, label: '≥ 80 %' },
];

// Minutes → « XhMM » (affichage compact de la barre de durée).
function fmtHM(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

export default function CavPicker({
  value, onChange, mode = 'cav', onOptimize, optimizing = false,
  // Durée prévisionnelle « au fil de l'eau » : le parent recalcule l'estimation
  // à chaque ajout/retrait de point et la passe ici — la barre reste visible en
  // tête de la colonne Sélection pendant qu'on compose la tournée.
  estimation = null, estimating = false, estimationHint = null,
  // Durée d'arrêt ajustable par point (mode association — RG-C2/C3 du chantier
  // tournées associations). Ignoré en mode CAV.
  durations = null, onDurationChange = null,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [commune, setCommune] = useState('');
  const [minFill, setMinFill] = useState(0);
  const [sortBy, setSortBy] = useState(mode === 'association' ? 'name' : 'fill_desc');

  const selectedIds = value || [];

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (mode === 'association') {
        const res = await api.get('/association-points', { params: { status: 'active' } });
        setItems((res.data || []).map(p => ({
          id: p.id,
          name: p.name,
          address: p.address,
          commune: p.ville,
          fillRate: null,
          // Durée par défaut de la fiche (RG-C1) — `null` = non renseignée,
          // le réglage global s'appliquera côté serveur.
          duree_collecte_min: p.duree_collecte_min != null ? Number(p.duree_collecte_min) : null,
        })));
      } else {
        const res = await api.get('/cav/fill-rate');
        setItems((res.data?.cavs || []).map(c => ({
          id: c.id,
          name: c.name,
          address: c.address,
          commune: c.commune,
          fillRate: c.fill_rate,
        })));
      }
    } catch (err) {
      console.error(err);
      setLoadError("Impossible de charger la liste des points de collecte");
    }
    setLoading(false);
  }, [mode]);

  useEffect(() => { load(); }, [load]);

  const itemsById = useMemo(() => {
    const map = {};
    items.forEach(i => { map[i.id] = i; });
    return map;
  }, [items]);

  const communes = useMemo(() => {
    const set = new Set(items.map(i => i.commune).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [items]);

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items.filter(i => !selectedIds.includes(i.id));
    if (q) {
      list = list.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.address || '').toLowerCase().includes(q) ||
        (i.commune || '').toLowerCase().includes(q));
    }
    if (commune) list = list.filter(i => i.commune === commune);
    if (mode === 'cav' && minFill > 0) list = list.filter(i => (i.fillRate ?? 0) >= minFill);

    list = [...list].sort((a, b) => {
      if (sortBy === 'fill_desc') return (b.fillRate ?? -1) - (a.fillRate ?? -1);
      return (a.name || '').localeCompare(b.name || '', 'fr');
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedIds, search, commune, minFill, sortBy, mode]);

  const selected = useMemo(
    () => selectedIds.map(id => itemsById[id]).filter(Boolean),
    [selectedIds, itemsById]
  );

  // Préremplissage de la durée d'arrêt (RG-C2) : tout point qui entre dans la
  // sélection — par clic ici, ou par une sélection posée par le parent (choix
  // d'un modèle, préremplissage depuis une demande) — reçoit sa durée de fiche
  // si elle est connue, sinon `null` (le réglage global s'appliquera côté
  // serveur ; jamais de nombre deviné affiché ici). Ne touche jamais une
  // valeur déjà présente dans `durations` (ajustement du gestionnaire ou
  // rechargement après un premier passage).
  useEffect(() => {
    if (mode !== 'association' || typeof onDurationChange !== 'function') return;
    selectedIds.forEach((id) => {
      if (durations && Object.prototype.hasOwnProperty.call(durations, id)) return;
      const item = itemsById[id];
      onDurationChange(id, item && item.duree_collecte_min != null ? item.duree_collecte_min : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedIds, itemsById, durations, onDurationChange]);

  const setDuration = (id, raw) => {
    if (typeof onDurationChange !== 'function') return;
    if (raw === '' || raw == null) { onDurationChange(id, null); return; }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) { onDurationChange(id, null); return; }
    onDurationChange(id, Math.min(480, Math.max(1, n)));
  };

  // Provenance affichée de la durée courante (RG-C3) : ajustée (le
  // gestionnaire l'a modifiée pour cette tournée) > fiche (valeur du point,
  // reprise telle quelle) > réglage global (rien de connu ici, jamais de
  // nombre inventé à l'écran).
  const dureeSource = (item) => {
    const val = durations ? durations[item.id] : null;
    if (val == null) return 'global';
    if (item.duree_collecte_min != null && val === item.duree_collecte_min) return 'fiche';
    return 'ajustee';
  };

  const addItem = (id) => { if (!selectedIds.includes(id)) onChange([...selectedIds, id]); };
  const removeItem = (id) => onChange(selectedIds.filter(v => v !== id));
  const moveUp = (idx) => {
    if (idx <= 0) return;
    const next = [...selectedIds];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };
  const moveDown = (idx) => {
    if (idx >= selectedIds.length - 1) return;
    const next = [...selectedIds];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  };

  const noun = mode === 'association' ? 'point' : 'CAV';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Colonne disponibles */}
      <div className="rounded-xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="p-2.5 bg-slate-50 border-b border-slate-200 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Rechercher un ${noun}, une adresse, une commune…`}
              className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary bg-white"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <select value={commune} onChange={e => setCommune(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white flex-1 min-w-[110px]">
              <option value="">Toutes communes</option>
              {communes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {mode === 'cav' && (
              <select value={minFill} onChange={e => setMinFill(parseInt(e.target.value, 10))} className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white">
                {MIN_FILL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white">
              {mode === 'cav' && <option value="fill_desc">Trier : remplissage</option>}
              <option value="name">Trier : nom (A-Z)</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-72 divide-y divide-slate-100">
          {loading ? (
            <p className="text-xs text-slate-400 text-center py-6">Chargement…</p>
          ) : loadError ? (
            <p className="text-xs text-red-500 text-center py-6">{loadError}</p>
          ) : available.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">Aucun {noun} disponible</p>
          ) : available.map(item => (
            <button
              type="button"
              key={item.id}
              onClick={() => addItem(item.id)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-teal-50/60 transition-colors"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-slate-100 text-slate-400 grid place-items-center group-hover:bg-teal-100">
                <Plus className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-slate-700 truncate">{item.name}</span>
                <span className="block text-[10px] text-slate-400 truncate">{item.commune || item.address || '—'}</span>
              </span>
              {mode === 'cav' && item.fillRate != null && (
                <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${fillBadgeClass(item.fillRate)}`}>
                  {item.fillRate}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Colonne sélection ordonnée */}
      <div className="rounded-xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">
            Sélection ({selected.length})
          </span>
          {onOptimize && (
            <button
              type="button"
              onClick={onOptimize}
              disabled={optimizing || selected.length < 2}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Réordonner les points sélectionnés pour minimiser la distance"
            >
              <ArrowUpDown className="w-3 h-3" />
              {optimizing ? 'Optimisation…' : "Optimiser l'ordre"}
            </button>
          )}
        </div>

        {/* Durée prévisionnelle au fil de l'eau (recalculée à chaque point) */}
        {(estimating || estimation || (estimationHint && selected.length > 0)) && (
          (() => {
            if (estimating) {
              return (
                <div className="px-2.5 py-1.5 border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className="animate-spin rounded-full h-3 w-3 border-2 border-teal-500 border-t-transparent flex-shrink-0" />
                  Calcul de la durée prévisionnelle…
                </div>
              );
            }
            if (!estimation) {
              return (
                <div className="px-2.5 py-1.5 border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                  {estimationHint}
                </div>
              );
            }
            const travail = estimation.duree_travail_min || 0;
            const budget = estimation.budget_travail_min || 0;
            const ratio = budget > 0 ? travail / budget : 0;
            const depasse = (estimation.depassement_min || 0) > 0 || estimation.faisable === false;
            const cls = depasse
              ? 'bg-red-50 text-red-700 border-red-200'
              : ratio > 0.85
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200';
            return (
              <div className={`px-2.5 py-1.5 border-b text-[11px] ${cls}`}>
                <span className="font-semibold">
                  Durée prévisionnelle : {fmtHM(travail)} / {fmtHM(budget)} de travail
                </span>
                {depasse && estimation.depassement_min > 0 && (
                  <span className="font-semibold"> — dépassement +{fmtHM(estimation.depassement_min)}</span>
                )}
                <span className="opacity-80">
                  {' '}· {Math.round(estimation.poids_estime_kg || 0)} kg
                  {estimation.nb_retours_vidage > 0 ? ` · ${estimation.nb_retours_vidage} retour${estimation.nb_retours_vidage > 1 ? 's' : ''} de vidage` : ''}
                  {estimation.pause_dejeuner_incluse ? ' · pause déjeuner incluse' : ''}
                </span>
              </div>
            );
          })()
        )}

        <div className="flex-1 overflow-y-auto max-h-72 divide-y divide-slate-100">
          {selected.length === 0 ? (
            <div className="text-center py-8 px-3">
              <MapPin className="w-6 h-6 text-slate-300 mx-auto mb-1.5" />
              <p className="text-xs text-slate-400">Cliquez sur un élément à gauche pour l'ajouter à la tournée.</p>
            </div>
          ) : selected.map((item, idx) => (
            <div key={item.id} className="px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold grid place-items-center">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-slate-700 truncate">{item.name}</span>
                  <span className="block text-[10px] text-slate-400 truncate">{item.commune || item.address || '—'}</span>
                </span>
                {mode === 'cav' && item.fillRate != null && (
                  <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${fillBadgeClass(item.fillRate)}`}>
                    {item.fillRate}%
                  </span>
                )}
                <div className="flex items-center flex-shrink-0">
                  <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0} aria-label="Monter" className="p-1 text-slate-400 hover:text-teal-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveDown(idx)} disabled={idx === selected.length - 1} aria-label="Descendre" className="p-1 text-slate-400 hover:text-teal-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => removeItem(item.id)} aria-label="Retirer" className="p-1 text-slate-400 hover:text-red-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {/* Durée d'arrêt ajustable (RG-C2/C3) — mode association, et
                  uniquement quand l'appelant fournit `onDurationChange` : un
                  appelant existant qui n'a pas encore adopté ce prop (ex.
                  RouteTemplates.jsx) garde exactement son affichage actuel,
                  jamais un champ qui aurait l'air de fonctionner sans agir. */}
              {mode === 'association' && typeof onDurationChange === 'function' && (
                <div className="flex items-center gap-1.5 mt-1 pl-7">
                  <input
                    type="number"
                    min="1"
                    max="480"
                    value={durations && durations[item.id] != null ? durations[item.id] : ''}
                    onChange={(e) => setDuration(item.id, e.target.value)}
                    placeholder="—"
                    aria-label={`Durée d'arrêt pour ${item.name}`}
                    className="w-14 text-[11px] border border-slate-200 rounded px-1.5 py-0.5 text-center focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                  <span className="text-[10px] text-slate-400">min</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${DUREE_SOURCE_META[dureeSource(item)].cls}`}>
                    {DUREE_SOURCE_META[dureeSource(item)].label}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
