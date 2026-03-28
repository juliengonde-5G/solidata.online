import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

export default function Login() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const { driverStart, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) { navigate('/vehicle-select'); return; }
    loadVehicles();
  }, [user]);

  const loadVehicles = async () => {
    try {
      const res = await api.get('/vehicles/available');
      setVehicles(res.data || []);
    } catch (err) {
      // Fallback: charger sans auth (endpoint public)
      try {
        const res = await fetch('/api/vehicles/available');
        const data = await res.json();
        setVehicles(data || []);
      } catch { setError('Impossible de charger les véhicules'); }
    }
    setLoading(false);
  };

  const selectVehicle = async (vehicle) => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      await driverStart(vehicle.id);
      navigate('/vehicle-select');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion');
    }
    setStarting(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[var(--color-primary)] to-[var(--color-primary-dark)] p-4">
      {/* Header */}
      <div className="text-center pt-8 pb-6">
        <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-xl">
          <span className="text-[var(--color-primary)] text-3xl font-bold">S</span>
        </div>
        <h1 className="text-white text-2xl font-bold tracking-tight">SOLIDATA</h1>
        <p className="text-white/80 text-sm mt-1">Choisis ton vehicule pour demarrer</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-white/80">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-white border-t-transparent mb-3" />
          <span className="text-sm">Chargement des vehicules...</span>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="card-mobile p-8 text-center">
          <div className="text-4xl mb-3">🚛</div>
          <p className="font-medium text-gray-700">Aucun vehicule disponible</p>
          <p className="text-sm text-gray-500 mt-1">Contactez votre responsable</p>
          <button onClick={loadVehicles} className="mt-4 text-sm text-[var(--color-primary)] font-medium">
            Recharger
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {vehicles.map(v => (
            <button
              key={v.id}
              onClick={() => selectVehicle(v)}
              disabled={starting}
              className="w-full card-mobile text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center text-2xl flex-shrink-0">
                  🚛
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-lg">{v.registration}</p>
                  {v.name && <p className="text-sm text-gray-600">{v.name}</p>}
                  {v.driver_name && (
                    <p className="text-xs text-gray-400 mt-0.5">Chauffeur : {v.driver_name}</p>
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
  );
}
