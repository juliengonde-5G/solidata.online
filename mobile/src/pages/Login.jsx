/**
 * Login (landing « pas d'accès »).
 *
 * Le mobile chauffeur s'authentifie uniquement via le lien dédié au véhicule
 * (« 1 URL = 1 véhicule » — voir VehicleLogin.jsx). Cet écran est affiché
 * quand quelqu'un arrive sur `/` ou `/start` sans token : on lui dit
 * simplement de demander au responsable.
 *
 * Plus de sélection de véhicule dans la liste publique : c'était le trou
 * d'énumération que la migration V2.0.1 a fermé.
 */
export default function Login() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center text-white px-6"
      style={{
        background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
        padding: '60px 24px calc(var(--safe-bottom) + 40px)',
      }}
    >
      <div className="w-20 h-20 rounded-2xl bg-white shadow-xl flex items-center justify-center mb-6">
        <span className="text-[var(--color-primary-dark)] text-4xl font-extrabold leading-none">S</span>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight mb-2">SOLIDATA</h1>
      <p className="text-white/80 text-base mb-8">Application chauffeur</p>

      <div className="w-full max-w-sm bg-white text-gray-900 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start gap-3 mb-3">
          <div className="text-3xl" aria-hidden="true">🔑</div>
          <div className="flex-1">
            <p className="font-bold text-gray-900">Pas d'accès véhicule</p>
            <p className="text-sm text-gray-600 mt-1">
              Demande à ton responsable de paramétrer ton téléphone avec le lien
              de ton véhicule, puis ajoute-le à l'écran d'accueil.
            </p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 leading-relaxed">
          Une fois le raccourci sur l'écran d'accueil, un seul tap suffit pour
          démarrer ta tournée — plus rien à saisir.
        </div>
      </div>
    </div>
  );
}
