import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function TourSummary() {
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    loadTour();
  }, []);

  const loadTour = async () => {
    try {
      const res = await api.get(`/tours/${tourId}`);
      setTour(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const finishDay = () => {
    localStorage.removeItem('current_tour_id');
    navigate('/vehicle-select');
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Chargement...</div>;

  const cavs = tour?.cavs || [];
  const collected = cavs.filter(c => c.status === 'collected').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-solidata-green text-white p-4 text-center">
        <p className="text-5xl mb-2">✅</p>
        <h1 className="font-bold text-xl">Tournée terminée !</h1>
        <p className="text-white/70 text-sm">Récapitulatif de la tournée #{tourId}</p>
      </header>

      <div className="p-4 space-y-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="CAV collectés" value={`${collected}/${cavs.length}`} icon="📍" />
          <StatCard label="Poids net" value={`${tour?.total_weight_kg || 0} kg`} icon="⚖️" />
          <StatCard label="Distance" value={`${tour?.estimated_distance_km || '—'} km`} icon="📏" />
          <StatCard label="Durée" value={tour?.estimated_duration_min ? `${tour.estimated_duration_min} min` : '—'} icon="⏱️" />
        </div>

        {/* CO2 savings */}
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
          <p className="text-3xl mb-1">🌿</p>
          <p className="text-xs text-green-600 uppercase tracking-wider">Impact environnemental</p>
          <p className="text-2xl font-bold text-green-700 mt-1">
            {((tour?.total_weight_kg || 0) * 3.2).toFixed(0)} kg CO₂
          </p>
          <p className="text-xs text-green-500 mt-1">économisés grâce à cette collecte</p>
        </div>

        {/* CAV Detail */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-3 bg-gray-50 border-b">
            <h3 className="font-semibold text-sm">Points de collecte</h3>
          </div>
          <div className="divide-y">
            {cavs.map((cav, i) => (
              <div key={i} className="p-3 flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${cav.status === 'collected' ? 'bg-green-500' : 'bg-gray-300'}`}>
                  {cav.status === 'collected' ? '✓' : i + 1}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{cav.nom || cav.cav_name}</p>
                  <p className="text-xs text-gray-400">{cav.commune}</p>
                </div>
                {cav.fill_level !== undefined && (
                  <span className="text-xs text-gray-500">{cav.fill_level}%</span>
                )}
                {cav.collected_weight_kg && (
                  <span className="text-xs font-medium">{cav.collected_weight_kg} kg</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Incidents */}
        {tour?.incidents && tour.incidents.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <h3 className="font-semibold text-sm text-red-700 mb-2">Incidents signalés ({tour.incidents.length})</h3>
            {tour.incidents.map((inc, i) => (
              <div key={i} className="text-xs text-red-600">
                <span className="font-medium">{inc.type}</span> — {inc.description || 'Pas de description'}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={finishDay}
          className="w-full bg-solidata-green text-white font-bold py-4 rounded-2xl shadow-lg text-lg"
        >
          Terminer la journée
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 text-center">
      <p className="text-2xl mb-1">{icon}</p>
      <p className="text-lg font-bold text-solidata-dark">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
