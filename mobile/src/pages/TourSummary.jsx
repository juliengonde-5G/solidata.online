import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import OfflineActionBadge from '../components/OfflineActionBadge';
import { getPendingCount, syncEvents, syncAll } from '../services/sync';

export default function TourSummary() {
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/tours/${tourId}/summary-public`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Le backend renvoie { tour, stats }. On aplatit pour compatibilité
        // avec le rendu existant (data.total_weight_kg, data.cavs…).
        const flat = {
          ...(data.tour || {}),
          stats: data.stats || null,
          cavs: data.cavs || data.tour?.cavs || [],
          incidents: data.incidents || [],
          total_weight_kg: data.stats?.total_weight_kg ?? data.tour?.total_weight_kg ?? 0,
          started_at: data.tour?.started_at,
          completed_at: data.tour?.completed_at,
          estimated_distance_km: data.tour?.estimated_distance_km,
          checklist: data.checklist || null,
        };
        setTour(flat);
      } catch (err) {
        // Mode dégradé : on affiche quand même l'écran avec ce qu'on a
        // en local (pour le cas offline au moment de la finalisation).
        console.warn('[TourSummary] summary-public indisponible', err.message);
        setTour({ cavs: [], incidents: [], total_weight_kg: 0, degraded: true });
      }
      setLoading(false);
    };
    if (tourId) load();

    const onPending = (e) => setPending(e.detail?.counts?.total || 0);
    syncEvents.addEventListener('pending', onPending);
    getPendingCount();
    return () => syncEvents.removeEventListener('pending', onPending);
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
  const co2Saved = ((tour?.total_weight_kg || 0) * 1.493).toFixed(0);
  const kmStart = tour?.checklist?.km_start || 0;
  const kmEnd = tour?.checklist?.km_end || 0;
  const distanceParcourue = kmEnd > kmStart ? kmEnd - kmStart : null;
  // Décalage moyen (sur les points collectés avec prévu renseigné)
  const delayedPoints = cavs
    .map(c => c.delay_minutes)
    .filter(d => d !== null && d !== undefined && Number.isFinite(d));
  const avgDelay = delayedPoints.length > 0
    ? Math.round(delayedPoints.reduce((s, d) => s + d, 0) / delayedPoints.length)
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-2)]">
      <header
        className="text-center text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          padding: 'calc(var(--safe-top) + 32px) 20px 32px',
        }}
      >
        <div
          className="mx-auto mb-4 flex items-center justify-center"
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
          }}
        >
          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-extrabold text-2xl">Tournée terminée !</h1>
        <p className="text-white/80 text-sm mt-1">Récapitulatif #{tourId}</p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 -mt-2">
        <div
          className="bg-white overflow-hidden"
          style={{ borderRadius: 20, boxShadow: '0 2px 10px rgba(15,23,42,0.05)' }}
        >
          <div className="grid grid-cols-2 gap-px bg-gray-100">
            <StatCard label="CAV collectés" value={`${collected}/${cavs.length}`} icon="📍" />
            <StatCard label="Poids net" value={`${tour?.total_weight_kg || 0} kg`} icon="⚖️" />
            <StatCard label="Distance" value={distanceParcourue ? `${distanceParcourue} km` : `${tour?.estimated_distance_km ?? '—'} km`} icon="📏" />
            <StatCard label="Durée" value={tour?.completed_at && tour?.started_at ? `${Math.round((new Date(tour.completed_at) - new Date(tour.started_at)) / 60000)} min` : (tour?.estimated_duration_min ? `${tour.estimated_duration_min} min` : '—')} icon="⏱️" />
          </div>
        </div>

        <div
          className="mt-4 text-center"
          style={{
            background: 'linear-gradient(180deg, #F0FDFA 0%, #CCFBF1 100%)',
            border: '1px solid #99F6E4',
            borderRadius: 20,
            padding: 24,
          }}
        >
          <p className="text-3xl mb-2">🌿</p>
          <p className="text-xs text-teal-700 uppercase tracking-wider font-bold">Impact environnemental</p>
          <p className="text-2xl font-extrabold text-teal-900 mt-1">{co2Saved} kg CO₂</p>
          <p className="text-xs text-teal-700 mt-1">équivalent évité grâce à cette collecte</p>
        </div>

        {avgDelay !== null && (
          <div className="card-mobile p-4 mt-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Décalage moyen prévu / réalisé</p>
              <p className={`text-lg font-bold mt-0.5 ${avgDelay > 10 ? 'text-red-600' : avgDelay < -5 ? 'text-blue-600' : 'text-green-700'}`}>
                {avgDelay > 0 ? '+' : ''}{avgDelay} min
              </p>
            </div>
            <span className="text-2xl">⏱️</span>
          </div>
        )}

        <div className="card-mobile overflow-hidden mt-4 p-0">
          <div className="p-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm">Points de collecte</h3>
            {cavs.some(c => c.planned_passage_time) && (
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Prévu / réalisé</span>
            )}
          </div>
          <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {cavs.map((cav, i) => {
              const planned = cav.planned_passage_time
                ? new Date(cav.planned_passage_time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : null;
              const actual = cav.collected_at
                ? new Date(cav.collected_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : null;
              const delay = cav.delay_minutes;
              const delayClass = delay === null || delay === undefined
                ? ''
                : delay > 2 ? 'bg-red-100 text-red-700' : delay < -2 ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700';
              return (
                <div key={cav.id || i} className="p-3 flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${cav.status === 'collected' ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {cav.status === 'collected' ? '✓' : i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{cav.nom || cav.cav_name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {cav.commune}
                      {(planned || actual) && (
                        <span className="ml-2 text-gray-400">
                          {planned || '—'} / {actual || '—'}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    {cav.fill_level != null && (
                      <span className="text-[10px] text-gray-500">{cav.fill_level}/5</span>
                    )}
                    {delay !== null && delay !== undefined && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${delayClass}`}>
                        {delay > 0 ? '+' : ''}{delay} min
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
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

        <div className="mt-4 card-mobile p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">État de la tournée</p>
            <p className="text-xs text-gray-500">
              {pending > 0 ? `${pending} action${pending > 1 ? 's' : ''} encore à envoyer` : 'Toutes les données sont envoyées'}
            </p>
          </div>
          {pending > 0 ? (
            <button
              type="button"
              onClick={() => syncAll()}
              className="flex items-center gap-2"
              aria-label="Forcer la synchronisation"
            >
              <OfflineActionBadge status="pending" label={`${pending} à envoyer`} />
            </button>
          ) : (
            <OfflineActionBadge status="sent" label="Tout envoyé" />
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate('/tour-history')}
          className="btn-secondary-mobile py-3 text-base mt-4"
        >
          Voir l'historique de la tournée
        </button>

        <button type="button" onClick={finishDay} className="btn-primary-mobile py-4 text-lg mt-4">
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
