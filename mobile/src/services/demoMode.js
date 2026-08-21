/**
 * Mode démo (formation) — logique pure, sans dépendance React.
 *
 * Le véhicule dédié « DÉMO FORMATION » a son propre lien /v/<token>. Le
 * backend renvoie `user.is_demo` à POST /auth/driver-start et `is_demo` sur
 * l'objet tournée de GET /tours/:id/public. Toute écriture durable est déjà
 * neutralisée CÔTÉ SERVEUR — ce module ne fait que rendre le mode visible
 * côté chauffeur (bandeau + encart), il ne change aucun comportement métier.
 *
 * Le drapeau est persisté en localStorage par AuthContext (`driverStart`
 * pose '1', `logout` retire la clé — jamais de bandeau résiduel sur un
 * téléphone reparamétré d'un véhicule démo vers un vrai véhicule).
 *
 * DemoModeBanner est monté une seule fois à la racine de l'app (App.jsx),
 * AVANT que `driverStart()` ait pu poser le drapeau (l'authentification
 * chauffeur survient après ce montage). Un simple `useState` initialisé au
 * montage ne verrait donc jamais le passage à '1'. On notifie les
 * composants à l'écoute via un évènement `window` plutôt que d'ajouter un
 * état React global supplémentaire pour un signal aussi ponctuel.
 */

export const DEMO_MODE_STORAGE_KEY = 'demo_mode';
export const DEMO_MODE_EVENT = 'solidata:demo-mode-changed';

/** Lecture défensive du drapeau démo (jamais d'exception hors navigateur / stockage bloqué). */
export function isDemoModeActive() {
  try {
    return localStorage.getItem(DEMO_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Pose ou retire le drapeau selon `active`, et notifie les auditeurs
 * (ex. DemoModeBanner) pour un affichage immédiat sans navigation ni
 * rechargement de page. À appeler depuis AuthContext après driver-start et
 * au logout.
 */
export function setDemoModeFlag(active) {
  try {
    if (active) {
      localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
    }
  } catch {
    /* ignore : stockage indisponible (navigation privée, quota…) */
  }
  try {
    window.dispatchEvent(new CustomEvent(DEMO_MODE_EVENT));
  } catch {
    /* ignore : environnement sans window (SSR, tests) */
  }
}
