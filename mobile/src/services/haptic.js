/**
 * Retour haptique (vibration) pour feedback tactile terrain.
 * Utilise navigator.vibrate() (Android/Chrome).
 * Silencieux si non supporté (iOS Safari, desktop).
 */

export function vibrateSuccess() {
  if (navigator.vibrate) navigator.vibrate(100);
}

export function vibrateError() {
  if (navigator.vibrate) navigator.vibrate([100, 50, 200]);
}

export function vibrateTap() {
  if (navigator.vibrate) navigator.vibrate(30);
}
