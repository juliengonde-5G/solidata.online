import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { vibrateTap, vibrateSuccess, vibrateError } from '../services/haptic';
import MobileShell, { TourStepBar } from '../components/MobileShell';

const CHECKLIST_ITEMS = [
  { id: 'papiers', label: 'Papiers du véhicule', icon: '📄' },
  { id: 'permis', label: 'Permis de conduire', icon: '🪪' },
  { id: 'gilet', label: 'Gilet de sécurité', icon: '🦺' },
  { id: 'triangle', label: 'Triangle de signalisation', icon: '⚠️' },
  { id: 'extincteur', label: 'Extincteur', icon: '🧯' },
  { id: 'telephone', label: 'Téléphone chargé', icon: '📱' },
  { id: 'eclairage', label: 'Éclairage fonctionnel', icon: '💡' },
  { id: 'pneus', label: 'État des pneus', icon: '🔧' },
  { id: 'niveaux', label: 'Niveaux (huile, liquide refr.)', icon: '🛢️' },
  { id: 'proprete', label: 'Propreté du véhicule', icon: '🧹' },
];

export default function Checklist() {
  const [checked, setChecked] = useState({});
  const [notes, setNotes] = useState('');
  const [kmStart, setKmStart] = useState('');
  const [tour, setTour] = useState(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/tours/${tourId}`);
        setTour(res.data);
      } catch (e) {}
    };
    if (tourId) load();
  }, [tourId]);

  const toggle = (id) => { vibrateTap(); setChecked(prev => ({ ...prev, [id]: !prev[id] })); };
  const allChecked = CHECKLIST_ITEMS.every(item => checked[item.id]);
  const checkedCount = CHECKLIST_ITEMS.filter(item => checked[item.id]).length;

  const submit = async () => {
    try {
      await api.post(`/tours/${tourId}/checklist`, {
        vehicle_id: tour?.vehicle_id,
        employee_id: tour?.driver_employee_id,
        exterior_ok: allChecked,
        fuel_level: '1/2',
        km_start: parseInt(kmStart, 10) || 0,
      });
      await api.put(`/tours/${tourId}/status`, { status: 'in_progress' });
      vibrateSuccess();
      navigate('/tour-map');
    } catch (err) { vibrateError(); console.error(err); }
  };

  return (
    <MobileShell
      title="Checklist départ"
      subtitle={`Tournée #${tourId} — ${checkedCount}/${CHECKLIST_ITEMS.length} vérifiés`}
      onBack={() => navigate('/vehicle-select')}
    >
      <div className="mb-4">
        <TourStepBar currentPath="/checklist" />
      </div>

      <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-6">
        <div
          className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
          style={{ width: `${(checkedCount / CHECKLIST_ITEMS.length) * 100}%` }}
        />
      </div>

      <div className="space-y-2">
        {CHECKLIST_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            role="checkbox"
            aria-checked={!!checked[item.id]}
            aria-label={item.label}
            onClick={() => toggle(item.id)}
            className={`w-full flex items-center gap-4 card-mobile p-4 transition-all ${
              checked[item.id] ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5' : ''
            }`}
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="flex-1 text-left font-medium text-gray-800">{item.label}</span>
            <div
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                checked[item.id] ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-gray-300'
              }`}
            >
              {checked[item.id] && (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Kilométrage départ</label>
          <input
            type="number"
            value={kmStart}
            onChange={e => setKmStart(e.target.value)}
            placeholder="Ex. 45230"
            className="input-mobile"
          />
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anomalies constatées..."
            className="input-mobile min-h-[80px]"
            rows={2}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!allChecked}
          className="btn-primary-mobile py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {allChecked ? 'Démarrer la tournée' : `${CHECKLIST_ITEMS.length - checkedCount} point(s) restant(s)`}
        </button>
      </div>
    </MobileShell>
  );
}
