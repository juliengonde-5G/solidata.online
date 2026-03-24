import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { vibrateTap, vibrateSuccess, vibrateError } from '../services/haptic';
import MobileShell from '../components/MobileShell';

const INCIDENT_TYPES = [
  { value: 'vehicle_breakdown', label: 'Panne véhicule', icon: '🚛' },
  { value: 'accident', label: 'Accident', icon: '💥' },
  { value: 'cav_problem', label: 'Conteneur / CAV', icon: '📦' },
  { value: 'environment', label: 'Environnement', icon: '🚫' },
  { value: 'other', label: 'Autre', icon: '📝' },
];

export default function Incident() {
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  const submit = async () => {
    if (!type) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('description', description);
      formData.append('cav_id', '');
      formData.append('vehicle_id', '');
      formData.append('employee_id', '');

      await api.post(`/tours/${tourId}/incidents`, formData);
      vibrateSuccess();
      navigate('/tour-map');
    } catch (err) { vibrateError(); console.error(err); }
    setLoading(false);
  };

  return (
    <MobileShell
      title="Signaler un incident"
      subtitle="Décrivez ce qui s'est passé"
      onBack={() => navigate('/tour-map')}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Type d'incident :</p>
        <div className="grid grid-cols-2 gap-2">
          {INCIDENT_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              aria-label={`Type incident : ${t.label}`}
              onClick={() => { vibrateTap(); setType(t.value); }}
              className={`flex items-center gap-3 card-mobile p-4 text-left transition-all ${
                type === t.value ? 'ring-2 ring-red-500 bg-red-50' : ''
              }`}
            >
              <span className="text-2xl">{t.icon}</span>
              <span className="text-sm font-medium text-gray-800">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Décrivez l'incident..."
            className="input-mobile min-h-[100px]"
            rows={3}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!type || loading}
          className="w-full py-4 rounded-2xl font-bold text-white bg-red-500 disabled:opacity-50 transition-all active:scale-[0.98]"
        >
          {loading ? 'Envoi...' : "Signaler l'incident"}
        </button>
      </div>
    </MobileShell>
  );
}
