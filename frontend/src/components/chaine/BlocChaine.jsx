import { Lock, Users, EyeOff, LogIn, Package } from 'lucide-react';
import { categorieMeta } from './constantes';

/**
 * BlocChaine — un bloc du plan, positionné en POURCENTAGE du canevas.
 *
 * Aucune librairie de glisser-déposer : le bloc se contente d'exposer ses
 * évènements pointeur (souris ET tactile, même code) ; le canevas parent tient
 * la logique de déplacement. Un bloc reste focalisable au clavier : le plan
 * doit pouvoir se relire et se corriger sans souris.
 */
export default function BlocChaine({
  bloc, selectionne, lectureSeule,
  onPointerDownDeplacement, onPointerDownRedimension, onSelectionner,
}) {
  const meta = categorieMeta(bloc.categorie);
  const couleur = bloc.proprietes?.couleur || meta.couleurDefaut;
  const inactif = bloc.actif === false;
  const estPoste = bloc.categorie === 'poste';

  const Icone = bloc.categorie === 'entree' ? LogIn : bloc.categorie === 'zone_depose' ? Package : Users;

  const effectif = bloc.effectif_min === bloc.effectif_max
    ? `${bloc.effectif_max}`
    : `${bloc.effectif_min}–${bloc.effectif_max}`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selectionne}
      aria-label={`${meta.libelle} ${bloc.libelle}${estPoste ? `, ${effectif} personne(s)` : ''}`
        + `${bloc.obligatoire ? ', obligatoire' : ''}${inactif ? ', désactivé' : ''}`}
      onPointerDown={(e) => onPointerDownDeplacement?.(e, bloc)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectionner?.(bloc.code); }
      }}
      onFocus={() => onSelectionner?.(bloc.code)}
      className={[
        'absolute rounded-lg border-2 px-1 py-1 overflow-hidden select-none',
        'flex flex-col items-center justify-center text-center transition-shadow',
        lectureSeule ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        selectionne ? 'ring-2 ring-offset-1 ring-teal-500 shadow-lg z-20' : 'z-10 hover:shadow-md',
        inactif ? 'opacity-45' : '',
        bloc.obligatoire ? 'border-solid' : 'border-dashed',
      ].join(' ')}
      style={{
        left: `${bloc.x}%`,
        top: `${bloc.y}%`,
        width: `${bloc.largeur || 8}%`,
        height: `${bloc.hauteur || 9}%`,
        borderColor: couleur,
        backgroundColor: `${couleur}1A`, // même teinte, très diluée
        touchAction: 'none',             // indispensable : sinon le tactile fait défiler la page
      }}
      title={`${bloc.libelle} — ${meta.libelle}${bloc.obligatoire ? ' (obligatoire)' : ' (facultatif)'}`}
    >
      <div className="flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide"
        style={{ color: couleur }}>
        <Icone className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
        {bloc.obligatoire && <Lock className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />}
        {inactif && <EyeOff className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />}
        {estPoste && <span className="tabular-nums">{effectif}</span>}
      </div>

      <div className="text-[10px] leading-[1.15] font-medium text-slate-800 line-clamp-4 break-words w-full">
        {bloc.libelle}
      </div>

      {/* Poignée de redimensionnement — même mécanique pointeur que le déplacement. */}
      {!lectureSeule && selectionne && (
        <span
          role="slider"
          tabIndex={-1}
          aria-label="Redimensionner le bloc"
          aria-valuenow={Math.round(bloc.largeur || 0)}
          onPointerDown={(e) => { e.stopPropagation(); onPointerDownRedimension?.(e, bloc); }}
          className="absolute -right-1 -bottom-1 w-3.5 h-3.5 rounded-sm bg-teal-600 border-2 border-white
                     cursor-nwse-resize shadow"
          style={{ touchAction: 'none' }}
        />
      )}
    </div>
  );
}
