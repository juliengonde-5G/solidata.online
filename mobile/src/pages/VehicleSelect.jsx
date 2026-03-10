import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import MobileShell, { TourStepBar } from '../components/MobileShell';

export default function VehicleSelect() {
  const [tours, setTours] = useState([]);
  const [selectedTour, setSelectedTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const res = await api.get('/tours/my');
      setTours(res.data);
      // Si une tournée est déjà in_progress pour ce chauffeur, reprendre directement
      const inProgress = res.data.find(t => t.status === 'in_progress');
      if (inProgress) {
        localStorage.setItem('current_tour_id', inProgress.id);
        navigate('/tour-map');
        return;
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const startTour = async () => {
    if (!selectedTour || claiming) return;
    setClaiming(true);
    try {
      await api.put(`/tours/${selectedTour.id}/claim`);
      localStorage.setItem('current_tour_id', selectedTour.id);
      navigate('/checklist');
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la prise du véhicule';
      alert(msg);
      setSelectedTour(null);
      loadData();
    }
    setClaiming(false);
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

      <h2 className="font-semibold text-gray-800 text-lg mb-4">Choisir votre véhicule</h2>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--color-primary)] border-t-transparent mb-3" />
          <span className="text-sm">Chargement...</span>
        </div>
      ) : tours.length === 0 ? (
        <div className="card-mobile p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4 text-3xl">
            🚛
          </div>
          <p className="font-medium text-gray-700">Aucun véhicule disponible</p>
          <p className="text-sm text-gray-500 mt-1">Aucune tournée n'est planifiée pour aujourd'hui.</p>
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
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0">
                  🚛
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-lg">{tour.registration || 'Véhicule'}</p>
                  {tour.vehicle_name && <p className="text-sm text-gray-600">{tour.vehicle_name}</p>}
                  <p className="text-sm text-gray-500 mt-1">
                    {tour.nb_cav || 0} points de collecte
                    {tour.mode === 'intelligent' && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">IA</span>}
                  </p>
                </div>
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
            disabled={claiming}
            className="btn-primary-mobile py-4 text-lg disabled:opacity-50"
          >
            {claiming ? 'Prise en charge...' : `Prendre ${selectedTour.registration || 'ce véhicule'}`}
          </button>
        </div>
      )}
    </MobileShell>
  );
}
