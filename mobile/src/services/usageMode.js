/**
 * Mode d'usage — logique pure (sans React) utilisée par UsageModeContext.
 * Trois modes :
 *   - driving            : navigation active OU vitesse GPS significative
 *   - short_stop         : arrêt récent après déplacement (fenêtre glissante)
 *   - operational_stop   : écran de saisie métier, ou immobile depuis longtemps / GPS indisponible
 */

export const USAGE_MODES = Object.freeze({
  DRIVING: 'driving',
  SHORT_STOP: 'short_stop',
  OPERATIONAL_STOP: 'operational_stop',
});

// Seuil de vitesse considéré comme "en conduite" (m/s). 2 m/s ≈ 7,2 km/h.
export const DRIVING_SPEED_MPS = 2.0;

// Fenêtre d'arrêt court après le dernier déplacement significatif (ms).
export const SHORT_STOP_WINDOW_MS = 60_000;

// Clé localStorage pour l'override manuel (tests en dev).
export const OVERRIDE_STORAGE_KEY = 'usage_mode_override';

export function isValidMode(value) {
  return value === USAGE_MODES.DRIVING
    || value === USAGE_MODES.SHORT_STOP
    || value === USAGE_MODES.OPERATIONAL_STOP;
}

/**
 * Détermine le mode d'usage à partir de l'état courant.
 * Fonction pure : mêmes entrées → même sortie.
 *
 * @param {object} params
 * @param {number} [params.now]           timestamp courant (ms)
 * @param {number|null} [params.speed]    vitesse GPS en m/s (null si indisponible)
 * @param {number|null} [params.lastMovingAt] timestamp du dernier point en mouvement
 * @param {string|null} [params.screenHint] mode suggéré par l'écran courant
 * @param {string|null} [params.override]  override manuel (prioritaire)
 * @returns {string} un des USAGE_MODES
 */
export function computeUsageMode({
  now = Date.now(),
  speed = null,
  lastMovingAt = null,
  screenHint = null,
  override = null,
} = {}) {
  if (isValidMode(override)) return override;

  // L'écran peut forcer explicitement "operational_stop" (formulaire de saisie).
  if (screenHint === USAGE_MODES.OPERATIONAL_STOP) {
    return USAGE_MODES.OPERATIONAL_STOP;
  }

  if (typeof speed === 'number' && speed >= DRIVING_SPEED_MPS) {
    return USAGE_MODES.DRIVING;
  }

  if (lastMovingAt && now - lastMovingAt <= SHORT_STOP_WINDOW_MS) {
    return USAGE_MODES.SHORT_STOP;
  }

  // Fallback : GPS absent ou immobile depuis longtemps.
  // On respecte une suggestion d'écran si elle est valide, sinon operational_stop.
  return isValidMode(screenHint) ? screenHint : USAGE_MODES.OPERATIONAL_STOP;
}

export function readOverride() {
  try {
    const v = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    return isValidMode(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeOverride(mode) {
  try {
    if (!mode) localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    else if (isValidMode(mode)) localStorage.setItem(OVERRIDE_STORAGE_KEY, mode);
  } catch {
    // localStorage indisponible (mode privé strict) — on ignore.
  }
}
