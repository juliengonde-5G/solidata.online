import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * VehicleLogin — point d'entrée chauffeur (« 1 URL = 1 véhicule »).
 *
 * URL : `/v/:token` (ex. https://m.solidata.online/v/a3f9b2e1d8c74f06).
 *
 * Flux :
 *   1. Le manager paramètre cette URL une fois sur le téléphone du chauffeur
 *      au dépôt et l'ajoute à l'écran d'accueil (« Ajouter à l'écran d'accueil »).
 *   2. Toute ouverture du raccourci re-déclenche l'auth automatiquement :
 *      POST /api/auth/driver-start { vehicle_token } → JWT stocké en localStorage.
 *   3. L'URL est immédiatement nettoyée via history.replaceState pour que
 *      le token ne reste pas visible dans la barre d'adresse pendant la session.
 *   4. Si une tournée du jour existe pour ce véhicule, on enchaîne sur la
 *      checklist ; sinon on bascule sur l'écran de départ, qui ne propose que
 *      CE véhicule (confirmation avant création de la tournée à la volée —
 *      jamais une liste du parc : le lien détermine déjà le véhicule).
 *
 * Erreurs :
 *   - 401 : token inconnu, révoqué (régénéré côté admin), ou véhicule archivé.
 *   - Réseau : message clair, bouton Réessayer.
 */
export default function VehicleLogin() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { driverStart } = useAuth();
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  // Garde-fou React StrictMode : éviter la double-exécution en dev.
  const hasAuthenticated = useRef(false);

  const attemptAuth = async () => {
    setError('');
    setRetrying(false);
    try {
      const data = await driverStart(token);

      // Cleanup immédiat : on retire le token de la barre d'adresse pour qu'il
      // n'apparaisse plus dans l'historique navigateur pendant la session.
      // Le raccourci écran d'accueil garde l'URL d'origine, donc la prochaine
      // ouverture re-déclenche l'auth — pas de problème.
      window.history.replaceState(null, '', '/');

      // Persister les infos véhicule pour les pages downstream qui les lisent
      // depuis localStorage (compat avec l'existant : Login.jsx faisait pareil).
      if (data?.user?.vehicle_id) {
        localStorage.setItem('selected_vehicle_id', String(data.user.vehicle_id));
      }
      if (data?.user?.vehicle_registration) {
        localStorage.setItem('selected_vehicle_reg', data.user.vehicle_registration);
      }

      // Récupérer la tournée du jour pour ce véhicule. Le token JWT
      // fraîchement émis est déjà posé via l'AuthContext → l'intercepteur
      // axios l'enverra. On utilise fetch ici pour rester légers.
      const tourRes = await fetch(
        `/api/tours/vehicle/${data.user.vehicle_id}/today`,
        { headers: { Authorization: `Bearer ${data.token}` } }
      );
      if (tourRes.ok) {
        const tourData = await tourRes.json();
        if (tourData?.tour?.id) {
          localStorage.setItem('current_tour_id', String(tourData.tour.id));
          navigate('/checklist', { replace: true });
          return;
        }
      }
      // Pas de tournée planifiée aujourd'hui → /vehicle-select affiche le seul
      // véhicule de la session pour confirmation du départ (GET /tours/my est
      // borné au véhicule du jeton).
      navigate('/vehicle-select', { replace: true });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 404) {
        setError(
          "Lien invalide. Demande à ton responsable de te reparamétrer le téléphone."
        );
      } else {
        setError("Connexion impossible. Vérifie le réseau et réessaie.");
        setRetrying(true);
      }
    }
  };

  useEffect(() => {
    if (hasAuthenticated.current) return;
    hasAuthenticated.current = true;
    if (!token || !/^[a-f0-9]{32}$/.test(token)) {
      setError("Lien invalide. Demande à ton responsable de te reparamétrer le téléphone.");
      return;
    }
    attemptAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center text-white px-6"
      style={{
        background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
      }}
    >
      <div className="w-20 h-20 rounded-2xl bg-white shadow-xl flex items-center justify-center mb-6">
        <span className="text-[var(--color-primary-dark)] text-4xl font-extrabold leading-none">S</span>
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight mb-2">SOLIDATA</h1>

      {!error ? (
        <>
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-white border-t-transparent my-6" />
          <p className="text-white/85 text-base">Connexion en cours…</p>
        </>
      ) : (
        <div className="w-full max-w-sm bg-white text-gray-900 rounded-2xl p-6 mt-6 shadow-xl">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-bold text-gray-900">Accès refusé</p>
              <p className="text-sm text-gray-600 mt-1">{error}</p>
            </div>
          </div>
          {retrying && (
            <button
              type="button"
              onClick={attemptAuth}
              className="w-full bg-[var(--color-primary)] text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform"
            >
              Réessayer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
