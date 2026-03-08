import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import MobileShell, { TourStepBar } from '../components/MobileShell';

export default function VehicleSelect() {
  const [vehicles, setVehicles] = useState([]);
  const [tours, setTours] = useState([]);
  const [selectedTour, setSelectedTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [vRes, tRes] = await Promise.all([
        api.get('/vehicles?available=true'),
        api.get('/tours?status=planned'),
      ]);
      setVehicles(vRes.data);
      setTours(tRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const startTour = () => {
    if (selectedTour) {
      localStorage.setItem('current_tour_id', selectedTour.id);
      navigate('/checklist');
    }
  };

  const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <MobileShell
      title={`Bonjour ${user?.first_name || ''}`}
      subtitle={dateLabel}
      rightAction={
        <button
          onClick={logout}
          className="touch-target flex items-center justify-center rounded-xl text-white/90 hover:bg-white/10 active:bg-white/20 text-sm font-medium px-3"
        >
          Déconnexion
        </button>
      }
    >
      <div className="mb-4">
        <TourStepBar currentPath="/vehicle-select" />
      </div>

      <h2 className="font-semibold text-gray-800 text-lg mb-4">Choisir une tournée</h2>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--color-primary)] border-t-transparent mb-3" />
          <span className="text-sm">Chargement...</span>
        </div>
      ) : tours.length === 0 ? (
        <div className="card-mobile p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4 text-3xl">
            📋
          </div>
          <p className="font-medium text-gray-700">Aucune tournée planifiée</p>
          <p className="text-sm text-gray-500 mt-1">Contactez votre responsable pour obtenir une affectation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tours.map(tour => (
            <button
              key={tour.id}
              type="button"
              onClick={() => setSelectedTour(tour)}
              className={`w-full card-mobile text-left transition-all ${
                selectedTour?.id === tour.id
                  ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5'
                  : 'hover:shadow-[var(--shadow-card-hover)]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-gray-900">Tournée #{tour.id}</span>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                  {tour.mode === 'intelligent' ? 'IA' : tour.mode}
                </span>
              </div>
              <div className="text-sm text-gray-500 space-y-1">
                <p className="flex items-center gap-2">🚛 {tour.vehicle_registration || tour.registration || 'Véhicule non assigné'}</p>
                <p className="flex items-center gap-2">📍 {tour.cav_count ?? tour.nb_cav ?? 0} points de collecte</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedTour && (
        <div className="mt-6 pt-4">
          <button
            type="button"
            onClick={startTour}
            className="btn-primary-mobile py-4 text-lg"
          >
            Démarrer la tournée
          </button>
        </div>
      )}
    </MobileShell>
  );
}
