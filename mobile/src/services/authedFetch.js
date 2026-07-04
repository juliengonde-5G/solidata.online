/**
 * fetch() authentifié pour le parcours chauffeur, avec ré-auth transparente.
 *
 * Remplace les appels `fetch('/api/tours/...-public')` bruts qui n'envoyaient
 * aucun token (les endpoints correspondants sont désormais protégés par JWT
 * côté backend — audit 07/2026).
 *
 * Comportement :
 *   - joint `Authorization: Bearer <mobile_token>` ;
 *   - sur 401, ré-authentifie via reauthDriver() (vehicle_token persisté) puis
 *     rejoue la requête une fois ;
 *   - si la ré-auth échoue (réseau coupé, ou token révoqué), lève une erreur
 *     marquée `retryable` AU LIEU de renvoyer un 4xx. C'est essentiel : la file
 *     de synchronisation offline supprime les éléments sur 4xx (pour éviter les
 *     boucles), mais un problème d'auth n'est jamais une donnée « invalide » —
 *     on conserve donc l'élément pour un rejeu ultérieur (zéro perte de collecte).
 */

import { reauthDriver } from './driverAuth';

export async function authedFetch(url, options = {}) {
  const send = (token) =>
    fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let token = null;
  try { token = localStorage.getItem('mobile_token'); } catch { /* ignore */ }

  let res = await send(token);
  if (res.status !== 401) return res;

  // JWT absent/expiré → ré-auth transparente puis un seul rejeu.
  let fresh;
  try {
    fresh = await reauthDriver();
  } catch {
    const err = new Error('reauth_unavailable');
    err.retryable = true; // ne PAS purger la file de sync
    throw err;
  }
  res = await send(fresh);
  if (res.status === 401) {
    // Toujours 401 après ré-auth réussie : anomalie serveur, on conserve.
    const err = new Error('still_unauthorized');
    err.retryable = true;
    throw err;
  }
  return res;
}
