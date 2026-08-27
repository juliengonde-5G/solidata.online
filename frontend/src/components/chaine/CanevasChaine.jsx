import { useCallback, useRef } from 'react';
import BlocChaine from './BlocChaine';
import { aimanter, borner, PAS_GRILLE, RATIO_CANEVAS, TAILLE_MIN } from './constantes';

/**
 * CanevasChaine — la surface 2D du plan.
 *
 * AUCUNE librairie : le glisser-déposer est écrit avec les évènements
 * `pointer*`, qui couvrent d'un seul code la souris, le stylet et le tactile
 * (un atelier travaille souvent sur tablette). `setPointerCapture` garantit que
 * le bloc suit le doigt même s'il sort du canevas, et `touch-action: none`
 * empêche le geste de faire défiler la page au lieu de déplacer le bloc.
 *
 * Les positions sont des POURCENTAGES : le plan reste juste quelle que soit la
 * taille de l'écran, et s'imprime tel quel.
 */
export default function CanevasChaine({
  blocs, selection, lectureSeule, aimantActif = true, zoom = 1,
  onSelectionner, onDeplacer, onRedimensionner, onDebutAction, onSupprimerSelection,
}) {
  const canevasRef = useRef(null);
  // Geste en cours. `jalon` évite d'empiler un pas d'annulation par pixel
  // parcouru : on n'en pose qu'un, au premier mouvement réel.
  const gesteRef = useRef(null);

  const pourcentage = useCallback((clientX, clientY) => {
    const rect = canevasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  const debutDeplacement = useCallback((e, bloc) => {
    onSelectionner?.(bloc.code);
    if (lectureSeule) return;
    const p = pourcentage(e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesteRef.current = {
      type: 'deplacement', code: bloc.code, pointerId: e.pointerId,
      ecartX: p.x - Number(bloc.x), ecartY: p.y - Number(bloc.y), jalon: false,
    };
  }, [lectureSeule, onSelectionner, pourcentage]);

  const debutRedimension = useCallback((e, bloc) => {
    if (lectureSeule) return;
    const p = pourcentage(e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesteRef.current = {
      type: 'redimension', code: bloc.code, pointerId: e.pointerId,
      origineX: p.x, origineY: p.y,
      largeur: Number(bloc.largeur) || 8, hauteur: Number(bloc.hauteur) || 9,
      x: Number(bloc.x), y: Number(bloc.y), jalon: false,
    };
  }, [lectureSeule, pourcentage]);

  const enMouvement = useCallback((e) => {
    const g = gesteRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const p = pourcentage(e.clientX, e.clientY);
    if (!p) return;
    if (!g.jalon) { onDebutAction?.(); g.jalon = true; }

    if (g.type === 'deplacement') {
      const bloc = blocs.find((b) => b.code === g.code);
      if (!bloc) return;
      const x = borner(aimanter(p.x - g.ecartX, aimantActif), bloc.largeur);
      const y = borner(aimanter(p.y - g.ecartY, aimantActif), bloc.hauteur);
      onDeplacer?.(g.code, x, y);
    } else {
      const largeur = Math.max(TAILLE_MIN,
        Math.min(100 - g.x, aimanter(g.largeur + (p.x - g.origineX), aimantActif)));
      const hauteur = Math.max(TAILLE_MIN,
        Math.min(100 - g.y, aimanter(g.hauteur + (p.y - g.origineY), aimantActif)));
      onRedimensionner?.(g.code, largeur, hauteur);
    }
  }, [aimantActif, blocs, onDebutAction, onDeplacer, onRedimensionner, pourcentage]);

  const finGeste = useCallback((e) => {
    const g = gesteRef.current;
    if (g && g.pointerId === e.pointerId) gesteRef.current = null;
  }, []);

  // Clavier : déplacer la sélection sans souris (accessibilité, et précision au
  // pas de grille quand le doigt tremble sur une tablette).
  const auClavier = useCallback((e) => {
    if (lectureSeule || !selection) return;
    const bloc = blocs.find((b) => b.code === selection);
    if (!bloc) return;
    const pas = e.shiftKey ? PAS_GRILLE * 5 : PAS_GRILLE;
    const deltas = {
      ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas],
    };
    if (deltas[e.key]) {
      e.preventDefault();
      onDebutAction?.();
      const [dx, dy] = deltas[e.key];
      onDeplacer?.(bloc.code, borner(Number(bloc.x) + dx, bloc.largeur), borner(Number(bloc.y) + dy, bloc.hauteur));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onSupprimerSelection?.();
    }
    if (e.key === 'Escape') onSelectionner?.(null);
  }, [blocs, lectureSeule, onDebutAction, onDeplacer, onSelectionner, onSupprimerSelection, selection]);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div
        ref={canevasRef}
        onPointerMove={enMouvement}
        onPointerUp={finGeste}
        onPointerCancel={finGeste}
        onKeyDown={auClavier}
        onPointerDown={(e) => { if (e.target === e.currentTarget) onSelectionner?.(null); }}
        tabIndex={0}
        role="application"
        aria-label="Plan de la chaîne de tri"
        className="relative bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
        style={{
          width: `${Math.round(zoom * 100)}%`,
          minWidth: `${Math.round(zoom * 980)}px`,
          aspectRatio: `${RATIO_CANEVAS}`,
          // Grille de repère : purement visuelle, alignée sur le pas magnétique.
          backgroundImage:
            'linear-gradient(to right, rgba(100,116,139,0.10) 1px, transparent 1px),'
            + 'linear-gradient(to bottom, rgba(100,116,139,0.10) 1px, transparent 1px)',
          backgroundSize: `${PAS_GRILLE * 5}% ${PAS_GRILLE * 5}%`,
          touchAction: 'none',
        }}
      >
        {blocs.map((bloc) => (
          <BlocChaine
            key={bloc.code}
            bloc={bloc}
            selectionne={bloc.code === selection}
            lectureSeule={lectureSeule}
            onSelectionner={onSelectionner}
            onPointerDownDeplacement={debutDeplacement}
            onPointerDownRedimension={debutRedimension}
          />
        ))}

        {blocs.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 px-6 text-center">
            Ce plan est vide — ajoutez un poste, une zone de dépose ou une entrée depuis la palette.
          </p>
        )}
      </div>
    </div>
  );
}
