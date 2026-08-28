import { useState, useEffect, useCallback } from 'react';
import { Scale, Plus, Pencil, Trash2, X } from 'lucide-react';
import api from '../../services/api';
import useConfirm from '../../hooks/useConfirm';
import { ErrorState, useToast } from '..';

/**
 * TourPeseesPanel — les pesées d'une tournée, saisissables depuis le bureau.
 *
 * Demande client (08/2026) : « rajouter pour le gestionnaire la possibilité de
 * saisir / modifier les poids d'une collecte ». Jusqu'ici le poids n'était
 * saisissable que par le chauffeur, sur l'écran mobile de pesée : un oubli au
 * pont-bascule ou une virgule de travers restaient sans recours, alors que ce
 * chiffre commande le tonnage par borne, l'entrée de stock et l'apprentissage
 * du moteur prédictif.
 *
 * Le total affiché est la SOMME DE TOUTES LES PESÉES, intermédiaires comprises
 * — une pesée intermédiaire est un chargement réellement déposé au centre par
 * un équipage qui repart collecter, pas un relevé provisoire.
 *
 * Props :
 *  - tourId    : id de la tournée
 *  - onChanged : () => Promise<void> — rafraîchit la page parente
 */

function fmtDateHeure(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Poids affiché sans décimale inutile (« 905 kg », « 905,5 kg »). */
function fmtKg(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
}

const FORMULAIRE_VIDE = { weight_kg: '', tare_kg: '', is_intermediate: false, notes: '' };

export default function TourPeseesPanel({ tourId, onChanged }) {
  const toast = useToast();
  const { confirm, ConfirmDialogElement } = useConfirm();

  const [bloc, setBloc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // `null` = formulaire fermé ; `'nouvelle'` = ajout ; un id = correction.
  const [edition, setEdition] = useState(null);
  const [form, setForm] = useState(FORMULAIRE_VIDE);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [suppressionId, setSuppressionId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/tours/${tourId}/pesees`);
      setBloc(res.data);
    } catch (err) {
      console.error('[TourPeseesPanel] pesées :', err);
      setLoadError(err.response?.data?.error || 'Impossible de charger les pesées de cette tournée');
    } finally {
      setLoading(false);
    }
  }, [tourId]);

  useEffect(() => { load(); }, [load]);

  const ouvrirAjout = () => {
    setEdition('nouvelle');
    setForm(FORMULAIRE_VIDE);
    setFormError(null);
  };

  const ouvrirCorrection = (pesee) => {
    setEdition(pesee.id);
    setForm({
      weight_kg: pesee.weight_kg ?? '',
      tare_kg: pesee.tare_kg ?? '',
      is_intermediate: !!pesee.is_intermediate,
      notes: pesee.notes || '',
    });
    setFormError(null);
  };

  const fermer = () => { setEdition(null); setFormError(null); };

  const enregistrer = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const corps = {
      weight_kg: form.weight_kg,
      tare_kg: form.tare_kg === '' ? null : form.tare_kg,
      is_intermediate: form.is_intermediate,
      notes: form.notes.trim() || null,
    };
    try {
      if (edition === 'nouvelle') {
        await api.post(`/tours/${tourId}/pesees`, corps);
        toast.success('Pesée enregistrée — le total de la tournée est à jour.');
      } else {
        await api.put(`/tours/${tourId}/pesees/${edition}`, corps);
        toast.success('Pesée corrigée — le total de la tournée est à jour.');
      }
      fermer();
      await load();
      await onChanged?.();
    } catch (err) {
      // Jamais de catch muet : le motif du refus est celui du serveur.
      setFormError(err.response?.data?.error || "L'enregistrement de la pesée a échoué.");
    } finally {
      setSaving(false);
    }
  };

  const supprimer = async (pesee) => {
    const ok = await confirm({
      title: 'Supprimer cette pesée ?',
      message: `La pesée de ${fmtKg(pesee.weight_kg)} du ${fmtDateHeure(pesee.recorded_at)} sera retirée `
        + 'de la tournée, et le poids total recalculé sans elle. Cette suppression est définitive.',
      confirmLabel: 'Supprimer la pesée',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setSuppressionId(pesee.id);
    try {
      await api.delete(`/tours/${tourId}/pesees/${pesee.id}`);
      toast.success('Pesée supprimée — le total de la tournée est à jour.');
      await load();
      await onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'La suppression de la pesée a échoué.');
      load(); // resynchronise sur l'état réel : l'écran ne doit jamais mentir
    } finally {
      setSuppressionId(null);
    }
  };

  if (loading && !bloc) {
    return (
      <div className="mt-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Pesées de la tournée</h4>
        <p className="text-xs text-slate-400 italic">Chargement des pesées…</p>
      </div>
    );
  }
  if (loadError && !bloc) {
    return (
      <div className="mt-4">
        <ErrorState variant="card" title="Pesées indisponibles" message={loadError} onRetry={load} />
      </div>
    );
  }

  const pesees = bloc?.pesees || [];
  const modifiable = bloc?.modifiable !== false;

  return (
    <div className="mt-4">
      {ConfirmDialogElement}

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5" />
          Pesées de la tournée
        </h4>
        <span className="text-xs text-slate-600">
          Total pesé : <strong className="tabular-nums">{fmtKg(bloc?.total_kg ?? 0)}</strong>
        </span>
      </div>

      {loadError && bloc && (
        <div className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Impossible d'actualiser les pesées — les valeurs affichées peuvent être obsolètes.
        </div>
      )}

      {!modifiable && (
        <div className="mb-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
          Tournée close : les pesées sont en lecture seule. Le tonnage et l'entrée de stock ont déjà
          été enregistrés à la clôture — un écart se régularise par un mouvement de stock daté.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
        {pesees.length === 0 ? (
          <p className="text-xs text-slate-400 px-3 py-4 text-center">
            Aucune pesée enregistrée sur cette tournée.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left py-1.5 px-2">Enregistrée le</th>
                <th className="text-right py-1.5 px-2">Poids collecté</th>
                <th className="text-right py-1.5 px-2">Tare</th>
                <th className="text-left py-1.5 px-2">Type</th>
                <th className="text-left py-1.5 px-2">Remarque</th>
                <th className="text-right py-1.5 px-2 w-16">Action</th>
              </tr>
            </thead>
            <tbody>
              {pesees.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap">{fmtDateHeure(p.recorded_at)}</td>
                  <td className="py-1.5 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmtKg(p.weight_kg)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-500 whitespace-nowrap">
                    {p.tare_kg == null ? '—' : fmtKg(p.tare_kg)}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                      p.is_intermediate ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}
                    >
                      {p.is_intermediate ? 'Vidage en cours de tournée' : 'Pesée finale'}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-slate-500">{p.notes || '—'}</td>
                  <td className="py-1.5 px-2">
                    {modifiable ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => ouvrirCorrection(p)}
                          className="p-1 text-slate-400 hover:text-teal-700"
                          aria-label={`Corriger la pesée de ${fmtKg(p.weight_kg)}`}
                          title="Corriger cette pesée"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => supprimer(p)}
                          disabled={suppressionId === p.id}
                          className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-40"
                          aria-label={`Supprimer la pesée de ${fmtKg(p.weight_kg)}`}
                          title="Supprimer cette pesée"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Formulaire d'ajout / de correction, déplié sur place : la saisie d'un
          poids se fait en regard des pesées déjà enregistrées, pas dans une
          fenêtre qui les masque. */}
      {edition !== null && (
        <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-700">
              {edition === 'nouvelle' ? 'Nouvelle pesée' : 'Corriger la pesée'}
            </p>
            <button type="button" onClick={fermer} aria-label="Fermer le formulaire" className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label htmlFor={`pesee-poids-${tourId}`} className="block text-[11px] text-slate-500 mb-0.5">
                Poids collecté (kg) *
              </label>
              <input
                id={`pesee-poids-${tourId}`}
                type="number" min="0" step="1" inputMode="decimal"
                value={form.weight_kg}
                onChange={(e) => setForm((f) => ({ ...f, weight_kg: e.target.value }))}
                className="input-modern text-sm w-full"
              />
            </div>
            <div>
              <label htmlFor={`pesee-tare-${tourId}`} className="block text-[11px] text-slate-500 mb-0.5">
                Tare du véhicule (kg)
              </label>
              <input
                id={`pesee-tare-${tourId}`}
                type="number" min="0" step="1" inputMode="decimal"
                value={form.tare_kg}
                onChange={(e) => setForm((f) => ({ ...f, tare_kg: e.target.value }))}
                placeholder="Facultatif"
                className="input-modern text-sm w-full"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 mt-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={form.is_intermediate}
              onChange={(e) => setForm((f) => ({ ...f, is_intermediate: e.target.checked }))}
              className="rounded border-slate-300"
            />
            Vidage en cours de tournée (camion plein, l'équipage repart collecter)
          </label>
          <div className="mt-2">
            <label htmlFor={`pesee-notes-${tourId}`} className="block text-[11px] text-slate-500 mb-0.5">
              Remarque (facultatif)
            </label>
            <input
              id={`pesee-notes-${tourId}`}
              value={form.notes}
              maxLength={500}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Ex. saisie d'après le ticket de pesée du pont-bascule"
              className="input-modern text-sm w-full"
            />
          </div>
          {formError && (
            <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5" role="alert">
              {formError}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={fermer} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs hover:bg-white">
              Annuler
            </button>
            <button
              type="button"
              onClick={enregistrer}
              disabled={saving || String(form.weight_kg).trim() === ''}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer la pesée'}
            </button>
          </div>
        </div>
      )}

      {modifiable && edition === null && (
        <div className="px-1 py-2">
          <button
            type="button"
            onClick={ouvrirAjout}
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800"
          >
            <Plus className="w-3.5 h-3.5" /> Saisir une pesée
          </button>
        </div>
      )}

      <p className="text-[10px] text-slate-400 px-1">
        Le total comprend les vidages en cours de tournée : chacun est un chargement réellement
        déposé au centre de tri.
      </p>
    </div>
  );
}
