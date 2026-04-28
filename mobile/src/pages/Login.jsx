import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    try {
      const res = await fetch('/api/vehicles/available');
      const data = await res.json();
      setVehicles(data || []);
    } catch {
      setError('Impossible de charger les véhicules');
    }
    setLoading(false);
  };

  const selectVehicle = async (vehicle) => {
    if (starting) return;
    setStarting(true);
    setError('');

    // Stocker le véhicule sélectionné
    localStorage.setItem('selected_vehicle_id', vehicle.id);
    localStorage.setItem('selected_vehicle_reg', vehicle.registration);

    try {
      // Chercher la tournée du jour pour ce véhicule
      const res = await fetch(`/api/tours/vehicle/${vehicle.id}/today`);
      const data = await res.json();

      if (data.tour) {
        localStorage.setItem('current_tour_id', data.tour.id);
        navigate('/checklist');
      } else {
        setError('Aucune tournée planifiée pour ce véhicule aujourd\'hui.');
        setStarting(false);
      }
    } catch {
      setError('Erreur lors de la recherche de la tournée.');
      setStarting(false);
    }
  };

  const only = vehicles.length === 1 ? vehicles[0] : null;

  return (
    <div
      className="min-h-screen flex flex-col text-white"
      style={{
        background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
        padding: '60px 24px calc(var(--safe-bottom) + 40px)',
      }}
    >
      {/* Brand header */}
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white shadow-xl flex items-center justify-center">
          <span className="text-[var(--color-primary-dark)] text-4xl font-extrabold leading-none">S</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">SOLIDATA</h1>
        <p className="text-white/85 text-base mt-2">
          {only
            ? <>Camion <b>{only.registration}</b> · dépôt Rouen</>
            : 'Choisis ton véhicule'}
        </p>
      </div>

      {/* Visual spacer with truck emoji */}
      <div className="flex-1 flex items-center justify-center py-8">
        {loading ? (
          <div className="flex flex-col items-center text-white/80">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-white border-t-transparent mb-3" />
            <span className="text-sm">Chargement des véhicules…</span>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="w-full max-w-sm bg-white/10 border border-white/20 rounded-[20px] p-6 text-center backdrop-blur-sm">
            <div className="text-5xl mb-2">🚛</div>
            <p className="font-semibold">Aucun véhicule disponible</p>
            <p className="text-sm text-white/80 mt-1">Contacte ton responsable</p>
            <button
              type="button"
              onClick={loadVehicles}
              className="mt-4 text-sm font-semibold underline underline-offset-2"
            >
              Recharger
            </button>
          </div>
        ) : only ? (
          <div className="text-[110px] leading-none">🚚</div>
        ) : (
          <div className="w-full space-y-3">
            {vehicles.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => selectVehicle(v)}
                disabled={starting}
                className="w-full bg-white text-left active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ borderRadius: 20, padding: '14px 16px', boxShadow: '0 6px 16px rgba(0,0,0,0.15)' }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 flex-shrink-0 flex items-center justify-center text-2xl"
                    style={{ borderRadius: 16, background: 'var(--color-primary-surface, #F0FDFA)' }}
                  >
                    🚛
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-gray-900 text-lg leading-tight">{v.registration}</p>
                    {v.name && <p className="text-sm text-gray-600 truncate">{v.name}</p>}
                    {v.tour_id && (
                      <span className="mt-1 inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                        Tournée planifiée
                      </span>
                    )}
                  </div>
                  <svg className="w-5 h-5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Single-vehicle CTA */}
      {only && (
        <div>
          <button
            type="button"
            onClick={() => selectVehicle(only)}
            disabled={starting}
            className="w-full flex items-center justify-center gap-3 font-extrabold text-xl bg-white text-[var(--color-primary-dark)] active:scale-[0.98] transition-transform disabled:opacity-60"
            style={{
              minHeight: 84,
              borderRadius: 24,
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            }}
          >
            <span aria-hidden="true">▶</span>
            {starting ? 'Préparation…' : 'Démarrer ma tournée'}
          </button>
          <p className="text-center text-white/70 text-xs mt-4">
            Appuie pour commencer la vérification du camion
          </p>
        </div>
      )}
    </div>
  );
}
