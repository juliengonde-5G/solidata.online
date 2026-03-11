import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const FILL_LEVELS = [
  { value: 0, label: 'Vide', emoji: '⬜', color: 'bg-gray-100 text-gray-600' },
  { value: 25, label: '25%', emoji: '🟦', color: 'bg-blue-100 text-blue-600' },
  { value: 50, label: '50%', emoji: '🟨', color: 'bg-yellow-100 text-yellow-600' },
  { value: 75, label: '75%', emoji: '🟧', color: 'bg-orange-100 text-orange-600' },
  { value: 100, label: 'Plein', emoji: '🟥', color: 'bg-red-100 text-red-600' },
];

export default function FillLevel() {
  const [fillLevel, setFillLevel] = useState(null);
  const [anomaly, setAnomaly] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const scannedQR = localStorage.getItem('scanned_qr');

  const submit = async () => {
    if (fillLevel === null) return;
    setLoading(true);
    try {
      // Get current CAV info from tour
      const tourRes = await api.get(`/tours/${tourId}`);
      const cavs = tourRes.data.cavs || [];
      const currentIndex = cavs.findIndex(c => c.status !== 'collected');
      if (currentIndex >= 0) {
        await api.put(`/tours/${tourId}/cav/${cavs[currentIndex].id || cavs[currentIndex].cav_id}`, {
          status: 'collected',
          fill_level: fillLevel,
          qr_code: scannedQR,
          anomaly,
          notes,
        });
      }
      localStorage.removeItem('scanned_qr');
      navigate('/tour-map');
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-solidata-green text-white p-4">
        <button onClick={() => navigate('/tour-map')} className="text-white/70 text-sm mb-1">← Retour carte</button>
        <h1 className="font-bold text-lg">Niveau de remplissage</h1>
        {scannedQR && <p className="text-white/70 text-xs">QR : {scannedQR}</p>}
      </header>

      <div className="p-4 space-y-4">
        {/* Fill Level Selection */}
        <div>
          <p className="font-medium text-sm mb-3">Estimez le niveau de remplissage :</p>
          <div className="grid grid-cols-5 gap-2">
            {FILL_LEVELS.map(level => (
              <button
                key={level.value}
                onClick={() => setFillLevel(level.value)}
                className={`flex flex-col items-center p-3 rounded-xl border-2 transition ${
                  fillLevel === level.value ? 'border-solidata-green bg-solidata-green/5' : 'border-transparent bg-white'
                } shadow-sm`}
              >
                <span className="text-2xl mb-1">{level.emoji}</span>
                <span className="text-xs font-medium">{level.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Visual bar */}
        {fillLevel !== null && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Remplissage</span>
              <span className="font-bold text-solidata-green">{fillLevel}%</span>
            </div>
            <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-solidata-green to-solidata-green-dark"
                style={{ width: `${fillLevel}%` }}
              />
            </div>
          </div>
        )}

        {/* Anomaly */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Anomalie constatée</label>
          <select value={anomaly} onChange={e => setAnomaly(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">Aucune anomalie</option>
            <option value="debordement">Débordement</option>
            <option value="vandalisme">Vandalisme</option>
            <option value="acces_bloque">Accès bloqué</option>
            <option value="conteneur_endommage">Conteneur endommagé</option>
            <option value="dechets_non_conformes">Déchets non conformes</option>
          </select>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Observations..."
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows="2"
          />
        </div>

        <button
          onClick={submit}
          disabled={fillLevel === null || loading}
          className="w-full bg-solidata-green text-white font-bold py-4 rounded-2xl shadow-lg disabled:opacity-50"
        >
          {loading ? 'Enregistrement...' : 'Valider la collecte'}
        </button>
      </div>
    </div>
  );
}
