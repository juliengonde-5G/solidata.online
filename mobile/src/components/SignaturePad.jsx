// `React` est importé explicitement (et non seulement les hooks) : les tests
// rendent ce composant via react-dom/server sans le plugin JSX automatique
// (vitest.config.js), donc le JSX y est compilé en React.createElement.
// Même convention que components/DemoModeBanner.jsx.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { signatureExploitable } from '../services/signature';
import { vibrateTap } from '../services/haptic';

/**
 * Pad de signature manuscrite — <canvas> MAISON, aucune librairie.
 *
 * Le dépôt est léger par design (règle 5 de CLAUDE.md) : une signature, c'est
 * un trait qui suit un doigt, pas une dépendance de plus à faire vivre.
 *
 * Trois choix qui ne sont pas cosmétiques :
 *
 *  • POINTER EVENTS + `setPointerCapture`. Le doigt qui sort du cadre en
 *    finissant un paraphe garde la main : sans capture, le trait s'arrêterait
 *    net au bord et la signature serait tronquée. Même patron que l'éditeur de
 *    chaîne de tri du back-office (frontend/src/components/chaine/CanevasChaine.jsx).
 *
 *  • `touchAction: 'none'`. Sans elle, le navigateur interprète le geste comme
 *    un défilement : on signe et la page glisse sous le doigt. C'est LE défaut
 *    qui rend un pad tactile inutilisable, et il ne se voit pas à la souris.
 *
 *  • RÉSOLUTION INTERNE BORNÉE à 600 × 220, `devicePixelRatio` volontairement
 *    IGNORÉ. Suivre la densité d'écran quadruplerait la surface sur un
 *    téléphone récent, donc le poids du PNG — or ce PNG part dans une file
 *    hors ligne et se heurte à une borne serveur de 200 Ko. Le trait est
 *    légèrement moins net qu'il pourrait l'être ; une signature reste une
 *    signature, et elle arrive à destination.
 *
 * Le fond reste TRANSPARENT : le générateur de PDF pose la signature sur le
 * formulaire de la Métropole ; un rectangle blanc y masquerait la ligne
 * imprimée sous le paraphe.
 */

const LARGEUR = 600;
const HAUTEUR = 220;
const EPAISSEUR_TRAIT = 3;

export default function SignaturePad({
  value = null,
  onChange,
  disabled = false,
  label = 'Signature',
  id,
}) {
  const canvasRef = useRef(null);
  const traitsRef = useRef([]);        // [[{x,y}, …], …]
  const enCoursRef = useRef(false);
  const dernierEmisRef = useRef(null); // dernière valeur émise PAR NOUS
  const [aDesTraits, setADesTraits] = useState(false);

  const contexte = () => {
    const c = canvasRef.current;
    if (!c || typeof c.getContext !== 'function') return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = EPAISSEUR_TRAIT;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    return ctx;
  };

  const viderCanvas = useCallback(() => {
    traitsRef.current = [];
    setADesTraits(false);
    const c = canvasRef.current;
    const ctx = contexte();
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
  }, []);

  // Le parent a repris la main (bouton « Effacer » d'un autre bloc, bascule
  // « agent indisponible ») : on suit. La garde sur `dernierEmisRef` évite
  // d'effacer un début de tracé que NOUS venons de déclarer inexploitable —
  // le chauffeur doit pouvoir compléter son paraphe, pas le voir disparaître.
  useEffect(() => {
    if (value == null && dernierEmisRef.current != null) {
      viderCanvas();
      dernierEmisRef.current = null;
    }
  }, [value, viderCanvas]);

  const emettre = useCallback((v) => {
    dernierEmisRef.current = v;
    if (onChange) onChange(v);
  }, [onChange]);

  /** Coordonnées du pointeur ramenées au repère interne du canevas. */
  const point = (e) => {
    const c = canvasRef.current;
    if (!c || typeof c.getBoundingClientRect !== 'function') return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    const sx = r.width ? c.width / r.width : 1;
    const sy = r.height ? c.height / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const debut = (e) => {
    if (disabled) return;
    e.preventDefault?.();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    enCoursRef.current = true;
    const p = point(e);
    traitsRef.current.push([p]);
    setADesTraits(true);
    const ctx = contexte();
    if (ctx) { ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  };

  const bouge = (e) => {
    if (disabled || !enCoursRef.current) return;
    e.preventDefault?.();
    const p = point(e);
    const trait = traitsRef.current[traitsRef.current.length - 1];
    if (trait) trait.push(p);
    const ctx = contexte();
    if (ctx) { ctx.lineTo(p.x, p.y); ctx.stroke(); }
  };

  const fin = (e) => {
    if (!enCoursRef.current) return;
    enCoursRef.current = false;
    // `releasePointerCapture` lève NotFoundError si le pointeur n'était pas
    // capturé (navigateur sans capture, ou capture déjà relâchée) : une
    // signature ne doit pas échouer pour ça.
    try { e?.currentTarget?.releasePointerCapture?.(e.pointerId); } catch { /* sans effet */ }
    // Un simple appui produit un ou deux points : ce n'est pas une signature,
    // et le dire tout de suite vaut mieux qu'un refus serveur cinq écrans plus
    // loin. Le tracé reste à l'écran, le chauffeur peut le compléter.
    if (!signatureExploitable(traitsRef.current)) {
      emettre(null);
      return;
    }
    const c = canvasRef.current;
    let dataUrl = null;
    try { dataUrl = c && typeof c.toDataURL === 'function' ? c.toDataURL('image/png') : null; } catch { dataUrl = null; }
    emettre(dataUrl);
  };

  const effacer = () => {
    vibrateTap();
    viderCanvas();
    emettre(null);
  };

  const signee = value != null;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[13px] font-bold text-[var(--color-text-secondary)]" id={id ? `${id}-label` : undefined}>
          {label}
        </span>
        <button
          type="button"
          onClick={effacer}
          disabled={disabled || (!aDesTraits && !signee)}
          className="font-bold text-[13px] px-3 disabled:opacity-30"
          style={{ minHeight: 44, borderRadius: 12, border: '2px solid #E2E8F0', background: '#F8FAFC' }}
          aria-label={`Effacer ${label.toLowerCase()}`}
        >
          Effacer
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={LARGEUR}
        height={HAUTEUR}
        role="img"
        aria-label={label}
        aria-disabled={disabled ? 'true' : 'false'}
        onPointerDown={debut}
        onPointerMove={bouge}
        onPointerUp={fin}
        onPointerCancel={fin}
        onPointerLeave={fin}
        style={{
          // Sans ceci, signer fait DÉFILER la page sous le doigt.
          touchAction: 'none',
          width: '100%',
          height: 200,
          display: 'block',
          borderRadius: 16,
          border: `2px ${signee ? 'solid #34D399' : 'dashed #CBD5E1'}`,
          background: disabled ? '#F1F5F9' : '#FFFFFF',
          opacity: disabled ? 0.55 : 1,
          cursor: disabled ? 'not-allowed' : 'crosshair',
        }}
      />
      <p className="mt-1.5 text-[12px] font-semibold" style={{ color: signee ? '#047857' : '#64748B' }}>
        {disabled
          ? 'Signature désactivée.'
          : signee
            ? '✓ Signature enregistrée'
            : 'Signez avec le doigt dans le cadre.'}
      </p>
    </div>
  );
}
