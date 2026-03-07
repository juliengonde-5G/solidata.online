import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-solidata-green text-white p-4 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg">Bonjour {user?.first_name}</h1>
          <p className="text-white/70 text-xs">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <button onClick={logout} className="bg-white/20 rounded-lg px-3 py-1.5 text-sm">Déconnexion</button>
      </header>

      <div className="p-4">
        <h2 className="font-bold text-lg mb-4">Sélectionner une tournée</h2>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Chargement...</div>
        ) : tours.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-medium text-gray-600">Aucune tournée planifiée</p>
            <p className="text-sm text-gray-400 mt-1">Contactez votre responsable</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tours.map(tour => (
              <button
                key={tour.id}
                onClick={() => setSelectedTour(tour)}
                className={`w-full bg-white rounded-2xl p-4 shadow-sm text-left transition ${selectedTour?.id === tour.id ? 'ring-2 ring-solidata-green' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold">Tournée #{tour.id}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{tour.mode === 'intelligent' ? 'IA' : tour.mode}</span>
                </div>
                <div className="text-sm text-gray-500 space-y-1">
                  <p>🚛 {tour.registration || 'Véhicule non assigné'}</p>
                  <p>📍 {tour.nb_cav || 0} points de collecte</p>
                  <p>📏 {tour.estimated_distance_km || '—'} km estimés</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {selectedTour && (
          <button onClick={startTour} className="w-full mt-6 bg-solidata-green text-white font-bold py-4 rounded-2xl shadow-lg text-lg">
            Démarrer la tournée
          </button>
        )}
      </div>
    </div>
  );
}
