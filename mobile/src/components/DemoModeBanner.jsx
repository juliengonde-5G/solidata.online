import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isDemoModeActive, DEMO_MODE_EVENT } from '../services/demoMode';

/**
 * Bandeau global « MODE DÉMO — FORMATION ».
 *
 * Affiché UNIQUEMENT sur le véhicule dédié « DÉMO FORMATION » (le backend
 * neutralise déjà toutes les écritures durables pour ce véhicule) — ce
 * bandeau sert à RASSURER le chauffeur en formation : texte FALC, gros
 * caractères, message simple.
 *
 * Placé en haut de l'écran comme SyncStatusBanner/DriverMessageBanner (voir
 * ces fichiers pour le style), donc ne peut jamais recouvrir un bouton
 * d'action : dans toute l'app, les actions principales sont ancrées en BAS
 * de l'écran (PrimaryActionBar, footer de MobileShell — voir
 * mobile/src/components/MobileShell.jsx), jamais en haut.
 *
 * Couleur violette, volontairement DISTINCTE des autres bandeaux (ambre =
 * consigne du responsable, ambre/bleu/rouge/slate = statut de synchro) pour
 * qu'on ne confonde jamais une session de démo avec une alerte terrain.
 *
 * Le drapeau `demo_mode` (localStorage) est écrit/retiré par AuthContext.
 * Comme ce composant est monté une seule fois à la racine de l'app, avant
 * l'authentification chauffeur, on écoute l'évènement DEMO_MODE_EVENT
 * (déclenché par services/demoMode.js) pour se mettre à jour immédiatement
 * après driver-start, sans attendre une navigation ou un rechargement.
 */
export default function DemoModeBanner() {
  const [active, setActive] = useState(() => isDemoModeActive());
  const ref = useRef(null);

  useEffect(() => {
    const onChange = () => setActive(isDemoModeActive());
    window.addEventListener(DEMO_MODE_EVENT, onChange);
    // Robustesse multi-onglets (PWA ouverte 2 fois) : l'évènement natif
    // « storage » ne se déclenche que sur les AUTRES onglets, mais ne
    // coûte rien à écouter en plus.
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(DEMO_MODE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  // Ce bandeau est PERMANENT pendant toute la formation, contrairement aux
  // deux autres bandeaux fixés en haut (synchro, consigne du responsable) qui
  // sont éphémères. Sans décalage, il masquerait donc en CONTINU l'état de
  // synchronisation — or « Hors ligne, rien n'est perdu » est justement un des
  // messages que le stagiaire doit apprendre à reconnaître. On mesure la
  // hauteur réelle du bandeau (safe-area comprise, variable selon l'appareil)
  // et on la publie en variable CSS : `index.css` s'en sert pour glisser le
  // bandeau de synchro juste en dessous.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!active || !ref.current) {
      root.style.removeProperty('--demo-banner-h');
      document.body.classList.remove('demo-mode-on');
      return undefined;
    }
    const el = ref.current;
    const publier = () => root.style.setProperty('--demo-banner-h', `${el.offsetHeight}px`);
    publier();
    document.body.classList.add('demo-mode-on');
    // ResizeObserver est natif (aucune dépendance) ; absent d'environnements
    // de test très anciens → on dégrade sur la seule mesure initiale.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publier) : null;
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
      root.style.removeProperty('--demo-banner-h');
      document.body.classList.remove('demo-mode-on');
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-label="Mode démo formation actif"
      className="fixed top-0 left-0 right-0"
      style={{ zIndex: 200 }}
    >
      <div
        className="bg-violet-600 text-white shadow-lg border-b-4 border-violet-800"
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
      >
        <div className="px-4 py-2.5 flex items-center gap-2.5">
          <span aria-hidden="true" className="text-xl flex-shrink-0">🎓</span>
          <div className="min-w-0">
            <p className="font-extrabold tracking-wide text-sm leading-tight">
              MODE DÉMO — FORMATION
            </p>
            <p className="text-violet-50 text-xs leading-snug mt-0.5">
              Vous vous entraînez. Rien n'est enregistré pour de vrai.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
