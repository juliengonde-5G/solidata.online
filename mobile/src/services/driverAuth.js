/**
 * Ré-authentification chauffeur transparente.
 *
 * Le JWT chauffeur (émis par POST /auth/driver-start) expire au bout de
 * JWT_EXPIRES_IN et n'a PAS de refresh token (driver-start renvoie
 * refreshToken: null). Pour ne pas perdre l'accès en cours de tournée — ni,
 * surtout, perdre des données de collecte mises en file offline puis rejouées
 * après expiration — on ré-authentifie à la demande à partir du `vehicle_token`
 * persisté sur l'appareil (le même secret que le raccourci « 1 URL = 1
 * véhicule » de l'écran d'accueil).
 *
 * Stocker le vehicle_token en localStorage n'ajoute pas de surface d'exposition :
 * il est déjà présent en clair dans l'URL du raccourci sur ce téléphone, et le
 * modèle de sécurité est « possession de l'appareil = ce chauffeur ».
 */

const VEHICLE_TOKEN_KEY = 'mobile_vehicle_token';

export function setVehicleToken(token) {
  try {
    if (token && /^[a-f0-9]{32}$/.test(token)) {
      localStorage.setItem(VEHICLE_TOKEN_KEY, token);
    }
  } catch { /* localStorage indisponible — ignore */ }
}

export function getVehicleToken() {
  try {
    return localStorage.getItem(VEHICLE_TOKEN_KEY);
  } catch {
    return null;
  }
}

// Déduplication : une seule ré-auth concurrente (les rejeux de sync sont
// nombreux et parallèles — on ne veut pas N appels driver-start simultanés).
let reauthInFlight = null;

/**
 * Ré-authentifie le chauffeur via le vehicle_token persisté et met à jour le
 * `mobile_token`. Utilise fetch (pas l'instance axios) pour éviter toute
 * récursion avec l'intercepteur 401.
 * @returns {Promise<string>} le nouveau JWT
 * @throws si aucun vehicle_token n'est disponible ou si le serveur refuse
 */
export function reauthDriver() {
  if (reauthInFlight) return reauthInFlight;

  reauthInFlight = (async () => {
    const vt = getVehicleToken();
    if (!vt || !/^[a-f0-9]{32}$/.test(vt)) {
      throw new Error('no_vehicle_token');
    }
    const res = await fetch('/api/auth/driver-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_token: vt }),
    });
    if (!res.ok) {
      const err = new Error(`reauth_failed_${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (data?.token) {
      try { localStorage.setItem('mobile_token', data.token); } catch { /* ignore */ }
    }
    return data?.token;
  })();

  // Nettoyage du verrou quelle que soit l'issue.
  reauthInFlight.catch(() => {}).finally(() => { reauthInFlight = null; });
  return reauthInFlight;
}
