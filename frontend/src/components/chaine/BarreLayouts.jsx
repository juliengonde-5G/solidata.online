import { CheckCircle2, Copy, FilePlus2, Trash2, Users } from 'lucide-react';

/**
 * BarreLayouts — gestion des plans : lequel on édite, lequel est en vigueur,
 * duplication, activation, suppression.
 *
 * Le plan ACTIF est celui que suit l'atelier : il porte un repère explicite,
 * et on ne peut pas le supprimer (le serveur refuse en 409) — la manœuvre est
 * d'en activer un autre d'abord.
 */
export default function BarreLayouts({
  layouts, layoutId, layoutCourant, lectureSeule, peutSupprimer, occupe,
  onChanger, onNouveau, onDupliquer, onActiver, onSupprimer,
}) {
  const actif = layoutCourant?.is_actif === true;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm text-slate-500" htmlFor="chaine-layout">Plan</label>
      <select
        id="chaine-layout"
        value={layoutId || ''}
        onChange={(e) => onChanger(Number(e.target.value))}
        className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white min-w-[16rem]
                   focus:outline-none focus:ring-2 focus:ring-teal-500/40"
      >
        {layouts.length === 0 && <option value="">Aucun plan enregistré</option>}
        {layouts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nom}{l.is_actif ? ' — en vigueur' : ''}
          </option>
        ))}
      </select>

      {actif ? (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-50 text-teal-700
                         text-xs font-medium border border-teal-200">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Plan en vigueur
        </span>
      ) : layoutId ? (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600
                         text-xs border border-slate-200">
          Variante de travail
        </span>
      ) : null}

      {layoutCourant && (
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          {layoutCourant.nb_postes ?? 0} poste(s)
        </span>
      )}

      {!lectureSeule && (
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <button
            type="button" onClick={onNouveau} disabled={occupe}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300
                       bg-white text-sm text-slate-700 hover:border-teal-400 disabled:opacity-50"
          >
            <FilePlus2 className="w-4 h-4" aria-hidden="true" /> Nouveau plan
          </button>
          <button
            type="button" onClick={onDupliquer} disabled={occupe || !layoutId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300
                       bg-white text-sm text-slate-700 hover:border-teal-400 disabled:opacity-50"
          >
            <Copy className="w-4 h-4" aria-hidden="true" /> Dupliquer
          </button>
          <button
            type="button" onClick={onActiver} disabled={occupe || !layoutId || actif}
            title={actif ? 'Ce plan est déjà celui que suit l’atelier' : 'Faire de ce plan le plan en vigueur'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-500
                       bg-teal-50 text-sm text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Mettre en vigueur
          </button>
          {peutSupprimer && (
            <button
              type="button" onClick={onSupprimer} disabled={occupe || !layoutId || actif}
              title={actif ? 'Activez un autre plan avant de supprimer celui-ci' : 'Supprimer ce plan'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200
                         bg-white text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" /> Supprimer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
