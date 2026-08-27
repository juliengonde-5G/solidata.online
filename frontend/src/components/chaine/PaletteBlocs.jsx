import { Plus, Magnet, ZoomIn, ZoomOut } from 'lucide-react';
import { CATEGORIES } from './constantes';

/**
 * PaletteBlocs — ajout d'un bloc au plan et réglages du canevas.
 * Le bloc neuf est posé au centre : il est immédiatement sélectionné, donc
 * visible et déplaçable — jamais créé « quelque part » hors de l'écran.
 */
export default function PaletteBlocs({
  lectureSeule, aimantActif, onBasculerAimant, zoom, onZoom, onAjouter,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!lectureSeule && CATEGORIES.map((c) => (
        <button
          key={c.valeur}
          type="button"
          onClick={() => onAjouter(c.valeur)}
          title={c.description}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300
                     bg-white text-sm text-slate-700 hover:border-teal-400 hover:text-teal-700 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.couleurDefaut }} />
          {c.libelle}
        </button>
      ))}

      <div className="flex items-center gap-2 ml-auto">
        {!lectureSeule && (
          <button
            type="button"
            onClick={onBasculerAimant}
            aria-pressed={aimantActif}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              aimantActif
                ? 'border-teal-500 bg-teal-50 text-teal-700'
                : 'border-slate-300 bg-white text-slate-600'
            }`}
            title="Aligner les blocs sur la grille pendant le déplacement"
          >
            <Magnet className="w-4 h-4" aria-hidden="true" />
            Grille magnétique {aimantActif ? 'activée' : 'désactivée'}
          </button>
        )}

        <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white">
          <button
            type="button" onClick={() => onZoom(-0.25)} disabled={zoom <= 1}
            className="px-2 py-1.5 text-slate-600 disabled:opacity-40 hover:text-teal-700"
            aria-label="Réduire le plan"
          >
            <ZoomOut className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className="px-1 text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)} %</span>
          <button
            type="button" onClick={() => onZoom(0.25)} disabled={zoom >= 2}
            className="px-2 py-1.5 text-slate-600 disabled:opacity-40 hover:text-teal-700"
            aria-label="Agrandir le plan"
          >
            <ZoomIn className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
