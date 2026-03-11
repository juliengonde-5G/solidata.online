import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const INCIDENT_TYPES = [
  { value: 'panne_vehicule', label: 'Panne véhicule', icon: '🚛', color: 'bg-red-100' },
  { value: 'accident', label: 'Accident', icon: '💥', color: 'bg-red-100' },
  { value: 'conteneur_endommage', label: 'Conteneur endommagé', icon: '📦', color: 'bg-orange-100' },
  { value: 'acces_impossible', label: 'Accès impossible', icon: '🚫', color: 'bg-orange-100' },
  { value: 'debordement', label: 'Débordement / Épandage', icon: '🗑️', color: 'bg-yellow-100' },
  { value: 'vandalisme', label: 'Vandalisme', icon: '🔨', color: 'bg-purple-100' },
  { value: 'autre', label: 'Autre', icon: '📝', color: 'bg-gray-100' },
];

export default function Incident() {
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('minor');
  const [photo, setPhoto] = useState(null);
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
      formData.append('severity', severity);
      if (photo) formData.append('photo', photo);

      // Get GPS position
      if ('geolocation' in navigator) {
        try {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          formData.append('latitude', pos.coords.latitude);
          formData.append('longitude', pos.coords.longitude);
        } catch {}
      }

      await api.post(`/tours/${tourId}/incidents`, formData);
      navigate('/tour-map');
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-red-500 text-white p-4">
        <button onClick={() => navigate('/tour-map')} className="text-white/70 text-sm mb-1">← Retour carte</button>
        <h1 className="font-bold text-lg">Signaler un incident</h1>
      </header>

      <div className="p-4 space-y-4">
        {/* Type */}
        <div>
          <p className="font-medium text-sm mb-2">Type d'incident :</p>
          <div className="grid grid-cols-2 gap-2">
            {INCIDENT_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`flex items-center gap-2 p-3 rounded-xl border-2 transition text-left ${
                  type === t.value ? 'border-red-500 bg-red-50' : `border-transparent ${t.color}`
                } shadow-sm`}
              >
                <span className="text-xl">{t.icon}</span>
                <span className="text-xs font-medium">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Gravité</label>
          <div className="flex gap-2">
            {[
              { value: 'minor', label: 'Mineure', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
              { value: 'major', label: 'Majeure', color: 'bg-orange-100 text-orange-700 border-orange-300' },
              { value: 'critical', label: 'Critique', color: 'bg-red-100 text-red-700 border-red-300' },
            ].map(s => (
              <button
                key={s.value}
                onClick={() => setSeverity(s.value)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 ${severity === s.value ? s.color : 'bg-gray-50 text-gray-400 border-gray-200'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Décrivez l'incident..."
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows="3"
          />
        </div>

        {/* Photo */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Photo (optionnel)</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={e => setPhoto(e.target.files[0])}
            className="text-sm"
          />
          {photo && <p className="text-xs text-green-600 mt-1">Photo sélectionnée : {photo.name}</p>}
        </div>

        <button
          onClick={submit}
          disabled={!type || loading}
          className="w-full bg-red-500 text-white font-bold py-4 rounded-2xl shadow-lg disabled:opacity-50"
        >
          {loading ? 'Envoi...' : 'Signaler l\'incident'}
        </button>
      </div>
    </div>
  );
}
