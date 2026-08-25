import { useState, useEffect, useCallback } from 'react';
import {
  GripVertical, Lock, Trash2, Plus, MapPin, AlertTriangle, Settings, ExternalLink,
} from 'lucide-react';
import api from '../../services/api';
import useConfirm from '../../hooks/useConfirm';
import { ErrorState, useToast } from '..';
import TourEquipePanel from './TourEquipePanel';
import AddCavToProgrammeModal from './AddCavToProgrammeModal';
import AddArretModal from './AddArretModal';
import { getArretCategoryMeta, getArretMotifMeta } from './arretCategories';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Écart signé, ou « — » quand il n'a pas pu être calculé (jamais « 0 » par défaut). */
function fmtEcart(valeur, unite) {
  if (valeur == null || !Number.isFinite(Number(valeur))) return '—';
  const v = Number(valeur);
  if (v === 0) return `sans changement`;
  return `${v > 0 ? '+' : ''}${v} ${unite}`;
}

/** Minutes → « 5 h 40 », lisible d'un coup d'œil. */
function fmtDuree(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '—';
  const m = Math.round(Number(minutes));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}


// Déplace l'élément d'index `from` vers l'index `to` (nouvelle liste, non mutée).
function moveItem(list, from, to) {
  const arr = [...list];
  const [moved] = arr.splice(from, 1);
  const insertAt = from < to ? to - 1 : to;
  arr.splice(insertAt, 0, moved);
  return arr;
}

const NOTIF_CHAUFFEUR = 'Le chauffeur a été prévenu automatiquement.';

/**
 * TourProgrammePanel — « reprendre la main » sur une tournée déjà partie :
 * réordonner le programme par glisser-déposer, ajouter/retirer des points de
 * collecte ou des arrêts techniques, changer l'équipe. Source de vérité
 * dédiée `GET /tours/:id/programme` (distincte de `/tours/active-summary`
 * utilisée par le tableau de synthèse au-dessus — celui-ci n'est pas modifié).
 *
 * Props :
 *  - tourId    : id de la tournée
 *  - onChanged : () => Promise<void> — callback optionnel pour rafraîchir la
 *                page parente (carte, tableau de synthèse) après une modification
 */
export default function TourProgrammePanel({ tourId, onChanged }) {
  const toast = useToast();
  const { confirm, ConfirmDialogElement } = useConfirm();

  const [tour, setTour] = useState(null);
  const [modifiable, setModifiable] = useState(true);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const [removingId, setRemovingId] = useState(null);

  const [showAddCav, setShowAddCav] = useState(false);
  const [showAddArret, setShowAddArret] = useState(false);
  // Effet chiffré de la dernière modification. Sans lui, on déplaçait des
  // lignes sans jamais savoir ce que ça coûtait en kilomètres, en minutes, ni
  // si la journée tenait encore dans le temps de travail.
  const [impact, setImpact] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/tours/${tourId}/programme`);
      setTour(res.data.tour);
      setModifiable(res.data.modifiable !== false);
      setPoints(res.data.points || []);
    } catch (err) {
      console.error('[TourProgrammePanel] programme:', err);
      setLoadError('Impossible de charger le programme de cette tournée');
    } finally {
      setLoading(false);
    }
  }, [tourId]);

  useEffect(() => { load(); }, [load]);

  // Après une modification de points : la réponse de l'API porte déjà le
  // programme à jour (pas besoin de recharger tour/modifiable).
  const afterPointsChange = async () => {
    toast.success(NOTIF_CHAUFFEUR);
    await onChanged?.();
  };

  // Après un changement d'équipe : il faut recharger `tour` (driver_name,
  // suiveur1_name…) puisque les sélecteurs sont pilotés par ce même objet.
  const afterTeamChange = async () => {
    toast.success(NOTIF_CHAUFFEUR);
    await load();
    await onChanged?.();
  };

  // ── Réordonnancement par glisser-déposer (HTML5 natif, cf. PlanningTournees.jsx) ──
  const handleDragStart = (e, index) => {
    if (!modifiable || !points[index]?.editable) return;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* Safari */ }
  };

  const handleDragOverRow = (e, index) => {
    if (dragIndex === null) return;
    e.preventDefault();
    if (overIndex !== index) setOverIndex(index);
  };

  const handleDragLeaveRow = (index) => {
    setOverIndex((cur) => (cur === index ? null : cur));
  };

  const resetDragState = () => { setDragIndex(null); setOverIndex(null); };

  const handleDrop = async (e, dropIndex) => {
    e.preventDefault();
    const from = dragIndex;
    resetDragState();
    if (from === null || from === dropIndex || !modifiable) return;

    const previous = points;
    const reordered = moveItem(points, from, dropIndex);
    setPoints(reordered); // retour visuel immédiat
    setSavingOrder(true);
    try {
      const res = await api.put(`/tours/${tourId}/programme/ordre`, {
        ordre: reordered.map((p) => ({ kind: p.kind, id: p.id })),
      });
      setPoints(res.data.points || reordered);
      setImpact(res.data.impact || null);
      await afterPointsChange();
    } catch (err) {
      // Jamais mentir sur l'ordre réel : on restaure l'ordre précédent.
      setPoints(previous);
      const code = err.response?.data?.code;
      toast.error(
        code === 'POINT_DEJA_TRAITE'
          ? "Un point déjà traité ne peut pas changer de position — ordre précédent restauré."
          : code === 'ORDRE_INCOHERENT'
            ? "Cet ordre n'était pas valide — ordre précédent restauré."
            : code === 'TOURNEE_NON_MODIFIABLE'
              ? "Cette tournée n'est plus modifiable — ordre précédent restauré."
              : (err.response?.data?.error || "Échec de l'enregistrement du nouvel ordre — ordre précédent restauré.")
      );
    } finally {
      setSavingOrder(false);
    }
  };

  // ── Retrait d'un point ───────────────────────────────────────────────
  const removePoint = async (point) => {
    const ok = await confirm({
      title: 'Retirer ce point du programme ?',
      message: `« ${point.name} » sera retiré du programme de cette tournée. Le chauffeur sera prévenu.`,
      confirmLabel: 'Retirer',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setRemovingId(point.id);
    try {
      const url = point.kind === 'cav'
        ? `/tours/${tourId}/programme/cav/${point.id}`
        : `/tours/${tourId}/programme/arret/${point.id}`;
      const res = await api.delete(url);
      setPoints(res.data.points || []);
      setImpact(res.data.impact || null);
      await afterPointsChange();
    } catch (err) {
      const code = err.response?.data?.code;
      toast.error(
        code === 'POINT_DEJA_TRAITE'
          ? 'Ce point a déjà été traité — il ne peut plus être retiré.'
          : code === 'TOURNEE_NON_MODIFIABLE'
            ? "Cette tournée n'est plus modifiable."
            : (err.response?.data?.error || 'Erreur lors du retrait de ce point')
      );
      load(); // resynchronise sur l'état réel du serveur — jamais laisser l'écran mentir
    } finally {
      setRemovingId(null);
    }
  };

  const handlePointsUpdated = (serverPoints, serverImpact) => {
    setPoints(serverPoints || []);
    if (serverImpact !== undefined) setImpact(serverImpact || null);
    afterPointsChange();
  };

  if (loading && !tour) {
    return <p className="text-xs text-slate-400 py-4 text-center">Chargement du programme…</p>;
  }
  if (loadError && !tour) {
    return <ErrorState variant="card" title="Programme indisponible" message={loadError} onRetry={load} />;
  }

  const existingCavIds = points.filter((p) => p.kind === 'cav').map((p) => p.ref_id);

  return (
    <div className="mt-4">
      {ConfirmDialogElement}

      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5" />
          Programme de la tournée
        </h3>
        {tour?.is_demo && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">
            Démo formation
          </span>
        )}
      </div>

      {loadError && tour && (
        <div className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Impossible d'actualiser le programme — les données affichées peuvent être obsolètes.
        </div>
      )}

      {!modifiable && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Tournée {tour?.status === 'cancelled' ? 'annulée' : 'terminée'} — programme en lecture seule.
        </div>
      )}

      {/* Équipe */}
      {tour && (
        <div className="mb-3">
          <TourEquipePanel tour={tour} modifiable={modifiable} onChanged={afterTeamChange} />
        </div>
      )}

      {/* Effet de la dernière modification. Affiché seulement APRÈS un geste :
          on ne montre pas un bilan permanent, on répond à « qu'est-ce que je
          viens de changer ? ». */}
      {impact && (
        <div
          className={`mb-2 rounded-lg border px-3 py-2 text-xs ${
            impact.calculable === false
              ? 'border-slate-200 bg-slate-50 text-slate-600'
              : impact.budget?.bascule_hors_budget
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-teal-200 bg-teal-50 text-teal-800'
          }`}
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">
                {impact.calculable === false
                  ? 'Effet non calculé'
                  : impact.budget?.bascule_hors_budget
                    ? 'La journée ne tient plus dans le temps de travail'
                    : 'Effet de la modification'}
              </p>
              {impact.calculable === false ? (
                <p className="mt-0.5">{impact.motif}</p>
              ) : (
                <>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      Distance&nbsp;:{' '}
                      <strong>{fmtEcart(impact.ecart?.distance_km, 'km')}</strong>
                      {' '}({impact.apres?.distance_km} km au total)
                    </span>
                    <span>
                      Travail&nbsp;:{' '}
                      <strong>{fmtEcart(impact.ecart?.duree_travail_min, 'min')}</strong>
                      {' '}({fmtDuree(impact.apres?.duree_travail_min)} sur {fmtDuree(impact.budget?.budget_travail_min)})
                    </span>
                  </p>
                  <p className="mt-0.5">
                    Retour estimé à <strong>{impact.horaires?.heure_fin_estimee || '—'}</strong>
                    {impact.horaires?.heure_fin_precedente
                      && impact.horaires.heure_fin_precedente !== impact.horaires.heure_fin_estimee
                      && <> (au lieu de {impact.horaires.heure_fin_precedente})</>}
                    {impact.budget?.depassement_min > 0
                      && <> — dépassement de {impact.budget.depassement_min} min</>}
                  </p>
                  {impact.budget?.revient_dans_budget && (
                    <p className="mt-0.5 font-medium">La journée retombe dans le temps de travail.</p>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setImpact(null)}
              className="flex-shrink-0 text-slate-400 hover:text-slate-600"
              aria-label="Masquer l'effet de la modification"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Liste ordonnée des points */}
      <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
        {points.length === 0 ? (
          <div className="text-center py-8 px-3">
            <MapPin className="w-6 h-6 text-slate-300 mx-auto mb-1.5" />
            <p className="text-xs text-slate-400">Aucun point dans cette tournée.</p>
          </div>
        ) : points.map((point, index) => {
          const isCav = point.kind === 'cav';
          const categoryMeta = !isCav ? getArretCategoryMeta(point.categorie) : null;
          // Un retour au centre se lit par son MOTIF, pas par son lieu : les
          // trois motifs se déroulent au même endroit.
          const motifMeta = !isCav ? getArretMotifMeta(point.motif) : null;
          const Icon = isCav ? MapPin : categoryMeta.icon;
          const done = point.editable === false;
          const skipped = isCav && !!point.skip_reason;
          const canDrag = modifiable && point.editable;
          const isBeingDragged = dragIndex === index;
          const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <div
              key={`${point.kind}-${point.id}`}
              draggable={canDrag}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOverRow(e, index)}
              onDragLeave={() => handleDragLeaveRow(index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={resetDragState}
              className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-0 transition-colors
                ${isBeingDragged ? 'opacity-40' : ''}
                ${isDropTarget ? 'bg-teal-50 ring-1 ring-inset ring-teal-300' : done ? 'bg-slate-50/70' : 'bg-white'}
              `}
            >
              {point.editable ? (
                <GripVertical
                  className={`w-4 h-4 flex-shrink-0 ${modifiable ? 'text-slate-300 cursor-grab active:cursor-grabbing' : 'text-slate-200'}`}
                  aria-hidden="true"
                />
              ) : (
                <span title="Déjà traité — verrouillé" className="flex-shrink-0">
                  <Lock className="w-3.5 h-3.5 text-slate-300" />
                </span>
              )}

              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold grid place-items-center">
                {point.position}
              </span>

              <span className={`flex-shrink-0 p-1.5 rounded-lg ${isCav ? 'bg-teal-50 text-teal-600' : `${categoryMeta.bg} ${categoryMeta.color}`}`}>
                <Icon className="w-3.5 h-3.5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{point.name}</p>
                <p className="text-[11px] text-slate-400 truncate">
                  {isCav
                    ? (point.commune || point.address || '—')
                    : `${motifMeta ? motifMeta.label : categoryMeta.label}${point.duree_min ? ` · ${point.duree_min} min` : ''}`}
                  {!isCav && point.arrived_at ? ` · arrivée à ${fmtTime(point.arrived_at)}` : ''}
                  {point.collected_at ? ` · collecté à ${fmtTime(point.collected_at)}` : ''}
                </p>
              </div>

              {isCav && point.fill_level != null && (
                <span className="flex-shrink-0 text-[10px] font-bold text-slate-500" title="Remplissage constaté">
                  {point.fill_level}/5
                </span>
              )}

              <span
                className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                  skipped ? 'bg-red-100 text-red-700' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
                title={skipped ? point.skip_reason : undefined}
              >
                {skipped ? 'Sauté' : done ? 'Fait' : 'À faire'}
              </span>

              {point.editable && modifiable && (
                <button
                  type="button"
                  onClick={() => removePoint(point)}
                  disabled={removingId === point.id}
                  className="flex-shrink-0 p-1 text-slate-400 hover:text-red-600 disabled:opacity-40"
                  aria-label={`Retirer ${point.name}`}
                  title="Retirer ce point du programme"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {savingOrder && <p className="text-[11px] text-slate-400 mt-1 px-1">Enregistrement du nouvel ordre…</p>}

      {/* Ajout de points */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-2.5">
        <button
          type="button"
          onClick={() => setShowAddCav(true)}
          disabled={!modifiable}
          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Ajouter un point de collecte
        </button>
        <button
          type="button"
          onClick={() => setShowAddArret(true)}
          disabled={!modifiable}
          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Ajouter un arrêt technique
        </button>
        <a
          href="/admin-lieux-techniques"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-teal-600"
        >
          <Settings className="w-3 h-3" /> Gérer les lieux d'arrêt <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {showAddCav && (
        <AddCavToProgrammeModal
          tourId={tourId}
          excludeIds={existingCavIds}
          onClose={() => setShowAddCav(false)}
          onAdded={handlePointsUpdated}
        />
      )}
      {showAddArret && (
        <AddArretModal
          tourId={tourId}
          onClose={() => setShowAddArret(false)}
          onAdded={handlePointsUpdated}
        />
      )}
    </div>
  );
}
