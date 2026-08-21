import { useState, useEffect, useCallback } from 'react';
import { UserPlus } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '..';

// Les 3 rôles modifiables en cours de journée (PATCH /tours/:id/equipe accepte
// un ou plusieurs de ces champs, valeur null pour retirer).
const ROLE_FIELDS = [
  { key: 'driver_employee_id', nameKey: 'driver_name', label: 'Chauffeur' },
  { key: 'suiveur1_employee_id', nameKey: 'suiveur1_name', label: 'Suiveur 1' },
  { key: 'suiveur2_employee_id', nameKey: 'suiveur2_name', label: 'Suiveur 2' },
];

/**
 * TourEquipePanel — change le chauffeur / les suiveurs d'une tournée déjà
 * partie. Les sélecteurs sont contrôlés par `tour` (prop du parent) : un
 * échec de PATCH ne modifie jamais `tour`, donc le select revient
 * automatiquement à la dernière valeur connue (pas de rollback manuel à
 * coder — c'est la sémantique normale d'un composant contrôlé).
 *
 * Props :
 *  - tour       : objet `tour` du contrat GET /tours/:id/programme
 *  - modifiable : bool — la tournée peut-elle encore être modifiée
 *  - onChanged  : () => Promise<void> — appelé après un PATCH réussi
 *                 (recharge le programme complet + notifie la page parente)
 */
export default function TourEquipePanel({ tour, modifiable, onChanged }) {
  const toast = useToast();
  const [resources, setResources] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [savingField, setSavingField] = useState(null);

  const loadResources = useCallback(async () => {
    if (!tour?.date) return;
    setLoadError(null);
    try {
      const res = await api.get('/tours/planning/resources', { params: { date: String(tour.date).slice(0, 10) } });
      setResources(res.data);
    } catch (err) {
      console.error('[TourEquipePanel] planning/resources:', err);
      setLoadError('Impossible de charger la liste des collaborateurs affectables.');
    }
  }, [tour?.date]);

  useEffect(() => { loadResources(); }, [loadResources]);

  const drivers = resources?.drivers || [];
  const collecte = drivers.filter((d) => d.is_equipe_collecte);
  const autres = drivers.filter((d) => !d.is_equipe_collecte);

  const optionLabel = (d) => {
    const extra = [];
    if (d.is_day_off) extra.push('jour off');
    if (d.assigned_tour_id && d.assigned_tour_id !== tour.id) extra.push('déjà affecté');
    return `${d.first_name} ${d.last_name}${extra.length ? ` — ${extra.join(', ')}` : ''}`;
  };

  const handleChange = async (field, rawValue) => {
    const value = rawValue === '' ? null : parseInt(rawValue, 10);
    setSavingField(field);
    try {
      await api.patch(`/tours/${tour.id}/equipe`, { [field]: value });
      await onChanged?.();
    } catch (err) {
      const code = err.response?.data?.code;
      toast.error(
        code === 'ROLE_CUMULE'
          ? 'Cette personne occupe déjà un autre rôle (chauffeur ou suiveur) sur cette tournée — impossible de cumuler.'
          : code === 'TOURNEE_NON_MODIFIABLE'
            ? "Cette tournée n'est plus modifiable — équipe inchangée."
            : (err.response?.data?.error || "Erreur lors de la mise à jour de l'équipe")
      );
    } finally {
      setSavingField(null);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-2">
        <UserPlus className="w-3.5 h-3.5" />
        Équipe de la tournée
      </h3>
      {loadError && <p className="text-xs text-red-600 mb-2">{loadError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {ROLE_FIELDS.map((rf) => {
          const currentId = tour[rf.key];
          const hasCurrentInList = currentId != null && drivers.some((d) => d.id === currentId);
          return (
            <div key={rf.key}>
              <label className="block text-[11px] text-slate-400 mb-0.5">{rf.label}</label>
              <select
                value={currentId ?? ''}
                onChange={(e) => handleChange(rf.key, e.target.value)}
                disabled={!modifiable || savingField === rf.key || !resources}
                className="input-modern text-xs py-1.5 w-full"
              >
                <option value="">— Aucun —</option>
                {currentId != null && !hasCurrentInList && (
                  <option value={currentId}>{tour[rf.nameKey] || `#${currentId}`} (hors liste)</option>
                )}
                {collecte.map((d) => <option key={d.id} value={d.id}>{optionLabel(d)}</option>)}
                {autres.length > 0 && (
                  <optgroup label="Autres équipes — renfort exceptionnel">
                    {autres.map((d) => <option key={d.id} value={d.id}>{optionLabel(d)}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
          );
        })}
      </div>
      {!modifiable && (
        <p className="text-[11px] text-slate-400 mt-2">Tournée terminée ou annulée — équipe non modifiable.</p>
      )}
    </div>
  );
}
