import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { vibrateSuccess, vibrateError } from '../services/haptic';
import MobileShell, { TourStepBar } from '../components/MobileShell';

export default function WeighIn() {
  const [grossWeight, setGrossWeight] = useState('');
  const [tareWeight, setTareWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const isIntermediate = localStorage.getItem('intermediate_return') === 'true';

  const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));

  const submit = async () => {
    setLoading(true);
    try {
      await api.post(`/tours/${tourId}/weigh`, {
        weight_kg: netWeight,
      });
      if (isIntermediate) {
        // Retour intermédiaire : enregistrer la pesée puis reprendre la collecte
        localStorage.removeItem('intermediate_return');
        vibrateSuccess();
        navigate('/tour-map');
      } else {
        await api.put(`/tours/${tourId}/status`, { status: 'completed' });
        vibrateSuccess();
        navigate('/tour-summary');
      }
    } catch (err) { vibrateError(); console.error(err); }
    setLoading(false);
  };

  return (
    <MobileShell title={isIntermediate ? "Pesée intermédiaire" : "Pesée du véhicule"} subtitle={isIntermediate ? "Déchargement partiel — pesez puis reprenez la collecte" : "Enregistrez les données de pesée"} onBack={() => { if (isIntermediate) { localStorage.removeItem('intermediate_return'); navigate('/tour-map'); } else { navigate('/return-centre'); } }}>
      <div className="mb-4">
        <TourStepBar currentPath="/weigh-in" />
      </div>
      <div className="space-y-4">
        <div className="card-mobile p-6 text-center">
          <p className="text-4xl mb-2">⚖️</p>
          <p className="text-gray-600 text-sm">Poids brut − Tare = Poids net collecté</p>
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Poids brut (kg)</label>
          <input
            type="number"
            value={grossWeight}
            onChange={e => setGrossWeight(e.target.value)}
            placeholder="Véhicule chargé"
            className="input-mobile text-center text-lg font-semibold"
          />
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Tare véhicule (kg)</label>
          <input
            type="number"
            value={tareWeight}
            onChange={e => setTareWeight(e.target.value)}
            placeholder="Véhicule à vide"
            className="input-mobile text-center text-lg font-semibold"
          />
        </div>
        <div className="card-mobile p-6 text-center bg-[var(--color-primary)]/10 border-2 border-[var(--color-primary)]/30 rounded-2xl">
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Poids net collecté</p>
          <p className="text-4xl font-black text-[var(--color-primary)]">{netWeight.toFixed(0)}</p>
          <p className="text-sm text-gray-500">kg ({(netWeight / 1000).toFixed(2)} t)</p>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!grossWeight || !tareWeight || loading}
          className="btn-primary-mobile py-4 text-base disabled:opacity-50"
        >
          {loading ? 'Enregistrement...' : isIntermediate ? 'Enregistrer et reprendre' : 'Valider la pesée'}
        </button>
      </div>
    </MobileShell>
  );
}
