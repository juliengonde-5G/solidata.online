import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function TourSummary() {
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/tours/${tourId}`);
        setTour(res.data);
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    if (tourId) load();
  }, [tourId]);

  const finishDay = () => {
    localStorage.removeItem('current_tour_id');
    navigate('/vehicle-select');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-surface-2)]">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--color-primary)] border-t-transparent" />
        <p className="mt-4 text-gray-500 text-sm">Chargement...</p>
      </div>
    );
  }

  const cavs = tour?.cavs || [];
  const collected = cavs.filter(c => c.status === 'collected').length;
  const co2Saved = ((tour?.total_weight_kg || 0) * 3.6).toFixed(0);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-2)]">
      <header className="screen-header text-center pb-6">
        <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-bold text-2xl">Tournée terminée !</h1>
        <p className="text-white/80 text-sm mt-1">Récapitulatif #{tourId}</p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 -mt-2">
        <div className="bg-white rounded-3xl shadow-[var(--shadow-card)] overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-gray-100">
            <StatCard label="CAV collectés" value={`${collected}/${cavs.length}`} icon="📍" />
            <StatCard label="Poids net" value={`${tour?.total_weight_kg || 0} kg`} icon="⚖️" />
            <StatCard label="Distance" value={`${tour?.estimated_distance_km ?? '—'} km`} icon="📏" />
            <StatCard label="Durée" value={tour?.estimated_duration_min ? `${tour.estimated_duration_min} min` : '—'} icon="⏱️" />
          </div>
        </div>

        <div className="card-mobile p-6 mt-4 text-center bg-green-50 border border-green-100">
          <p className="text-3xl mb-2">🌿</p>
          <p className="text-xs text-green-700 uppercase tracking-wider font-medium">Impact environnemental</p>
          <p className="text-2xl font-bold text-green-800 mt-1">{co2Saved} kg CO₂</p>
          <p className="text-xs text-green-600 mt-1">équivalent évité grâce à cette collecte</p>
        </div>

        <div className="card-mobile overflow-hidden mt-4 p-0">
          <div className="p-3 bg-gray-50 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800 text-sm">Points de collecte</h3>
          </div>
          <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
            {cavs.map((cav, i) => (
              <div key={i} className="p-3 flex items-center gap-3">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${cav.status === 'collected' ? 'bg-green-500' : 'bg-gray-300'}`}>
                  {cav.status === 'collected' ? '✓' : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{cav.nom || cav.cav_name}</p>
                  <p className="text-xs text-gray-500 truncate">{cav.commune}</p>
                </div>
                {cav.fill_level != null && (
                  <span className="text-xs text-gray-500 flex-shrink-0">{cav.fill_level}/5</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {tour?.incidents?.length > 0 && (
          <div className="card-mobile p-4 mt-4 bg-red-50 border border-red-100">
            <h3 className="font-semibold text-red-800 text-sm mb-2">Incidents signalés ({tour.incidents.length})</h3>
            {tour.incidents.map((inc, i) => (
              <p key={i} className="text-xs text-red-700">{inc.type} — {inc.description || '—'}</p>
            ))}
          </div>
        )}

        <button type="button" onClick={finishDay} className="btn-primary-mobile py-4 text-lg mt-6">
          Terminer la journée
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white p-4 text-center">
      <p className="text-2xl mb-1">{icon}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
