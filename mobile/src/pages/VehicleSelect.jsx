import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { getVehicleToken } from '../services/driverAuth';
import MobileShell, { TourStepBar } from '../components/MobileShell';

// Statuts pour lesquels le véhicule ne doit pas partir en tournée.
const BLOCKING_STATUS = {
  maintenance: 'Ce véhicule est en maintenance.',
  out_of_service: 'Ce véhicule est hors service.',
};

/**
 * Écran de départ en tournée.
 *
 * Session chauffeur (raccourci « 1 URL = 1 véhicule ») : ce n'est PAS un
 * sélecteur — le véhicule est déjà déterminé par le lien. L'API ne renvoie que
 * ce véhicule (ou sa tournée du jour) ; l'écran se contente de le confirmer
 * avant le départ. Le parc n'est jamais listé.
 */
export default function VehicleSelect() {
  const [tours, setTours] = useState([]);
  const [selectedTour, setSelectedTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Le vehicle_token n'est présent que si l'app a été ouverte par le raccourci
  // véhicule → l'écran est en mode confirmation, pas en mode sélection.
  const isVehicleSession = Boolean(getVehicleToken());

  useEffect(() => { loadData(); }, []);

  // `keepError` : après un échec de prise en charge on recharge la liste sans
  // effacer le message d'erreur qui vient d'être affiché au chauffeur.
  const loadData = async ({ keepError = false } = {}) => {
    if (!keepError) setError('');
    try {
      const res = await api.get('/tours/my');
      const list = Array.isArray(res.data) ? res.data : [];
      setTours(list);
      // Si une tournée est déjà in_progress pour ce chauffeur, reprendre directement
      const inProgress = list.find(t => t.status === 'in_progress');
      if (inProgress) {
        localStorage.setItem('current_tour_id', inProgress.id);
        navigate('/tour-map');
        return;
      }
      // Session véhicule : une seule entrée possible → pré-sélection.
      // Sinon : pré-sélectionner le véhicule attitré du chauffeur.
      const preselect = isVehicleSession ? list[0] : list.find(t => t.is_assigned_vehicle);
      if (preselect) setSelectedTour(preselect);
    } catch (err) {
      console.error(err);
      setError("Impossible de charger ton véhicule. Vérifie le réseau et réessaie.");
    }
    setLoading(false);
  };

  const startTour = async () => {
    if (!selectedTour || claiming) return;
    setClaiming(true);
    try {
      if (selectedTour.is_free_vehicle) {
        // Vehicule libre sans tournee : creer une tournee a la volee
        const res = await api.post('/tours/claim-vehicle', { vehicle_id: selectedTour.vehicle_id });
        localStorage.setItem('current_tour_id', res.data.id);
      } else {
        await api.put(`/tours/${selectedTour.id}/claim`);
        localStorage.setItem('current_tour_id', selectedTour.id);
      }
      navigate('/checklist');
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la prise du véhicule';
      setError(msg);
      setSelectedTour(null);
      loadData({ keepError: true });
    }
    setClaiming(false);
  };

  const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  // Véhicule immobilisé : on l'affiche quand même (c'est LE véhicule du lien),
  // mais le départ est bloqué avec le motif réel plutôt qu'un écran vide.
  const blockedReason = selectedTour && selectedTour.is_free_vehicle
    ? BLOCKING_STATUS[selectedTour.vehicle_status] || null
    : null;

  return (
    <MobileShell
      title={`Bonjour ${user?.first_name || ''}`}
      subtitle={dateLabel}
      usageHint="operational_stop"
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

      <h2 className="font-extrabold text-gray-900 text-xl mb-4">
        {isVehicleSession ? 'Votre véhicule' : 'Choisir votre véhicule'}
      </h2>

      {error && (
        <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-semibold text-red-800">{error}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); loadData(); }}
            className="mt-2 text-sm font-bold text-red-700 underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--color-primary)] border-t-transparent mb-3" />
          <span className="text-sm">Chargement...</span>
        </div>
      ) : tours.length === 0 ? (
        <div className="card-mobile p-8 text-center" style={{ borderRadius: 20 }}>
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4 text-3xl">
            🚛
          </div>
          <p className="font-semibold text-gray-800">
            {isVehicleSession ? 'Véhicule indisponible' : 'Aucun véhicule disponible'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {isVehicleSession
              ? "Ton véhicule n'est plus accessible. Demande à ton responsable de reparamétrer ton téléphone."
              : "Aucune tournée n'est planifiée pour aujourd'hui."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tours.map((tour, idx) => {
            const tourKey = tour.id || `free-${tour.vehicle_id || idx}`;
            const isSelected = selectedTour && (
              (tour.id && selectedTour.id === tour.id) ||
              (tour.is_free_vehicle && selectedTour.vehicle_id === tour.vehicle_id)
            );
            return (
              <button
                key={tourKey}
                type="button"
                onClick={() => setSelectedTour(tour)}
                className={`w-full bg-white text-left transition-all active:scale-[0.99] ${
                  isSelected ? 'ring-2 ring-[var(--color-primary)]' : ''
                }`}
                style={{
                  borderRadius: 20,
                  padding: 16,
                  boxShadow: isSelected
                    ? '0 8px 22px rgba(13,148,136,0.18)'
                    : '0 2px 6px rgba(15,23,42,0.06)',
                }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 flex items-center justify-center text-2xl flex-shrink-0"
                    style={{
                      borderRadius: 16,
                      background: tour.is_free_vehicle ? 'var(--color-primary-surface, #F0FDFA)' : '#F1F5F9',
                    }}
                  >
                    {tour.is_free_vehicle ? '\u{1F697}' : '\u{1F69B}'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-extrabold text-gray-900 text-lg leading-tight">{tour.registration || 'Vehicule'}</p>
                      {tour.is_assigned_vehicle && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          Mon véhicule
                        </span>
                      )}
                    </div>
                    {tour.vehicle_name && <p className="text-sm text-gray-600 truncate mt-0.5">{tour.vehicle_name}</p>}
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      {tour.is_free_vehicle ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          Vehicule disponible
                        </span>
                      ) : (
                        <>
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                            Tournée planifiée
                          </span>
                          <span className="text-xs text-gray-500">
                            {tour.nb_cav || 0} points
                          </span>
                          {tour.mode === 'intelligent' && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                              IA
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedTour && (
        <div className="mt-6 pt-4">
          {blockedReason && (
            <div className="mb-3 rounded-2xl bg-amber-50 border border-amber-200 p-4">
              <p className="text-sm font-semibold text-amber-900">{blockedReason}</p>
              <p className="text-sm text-amber-800 mt-1">Vois avec ton responsable avant de partir.</p>
            </div>
          )}
          <button
            type="button"
            onClick={startTour}
            disabled={claiming || Boolean(blockedReason)}
            className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-50"
            style={{
              minHeight: 84,
              borderRadius: 20,
              boxShadow: '0 8px 22px rgba(13,148,136,0.28)',
            }}
          >
            <span aria-hidden="true">▶</span>
            {claiming
              ? 'Prise en charge…'
              : isVehicleSession
                ? `Démarrer avec ${selectedTour.registration || 'ce véhicule'}`
                : `Prendre ${selectedTour.registration || 'ce véhicule'}`}
          </button>
        </div>
      )}
    </MobileShell>
  );
}
