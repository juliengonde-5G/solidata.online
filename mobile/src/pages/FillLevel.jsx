import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import MobileShell from '../components/MobileShell';

const FILL_LEVELS = [
  { value: 0, label: 'Vide', emoji: '⬜', pct: '0%' },
  { value: 1, label: '¼', emoji: '🟦', pct: '25%' },
  { value: 2, label: '½', emoji: '🟨', pct: '50%' },
  { value: 3, label: '¾', emoji: '🟧', pct: '75%' },
  { value: 4, label: 'Plein', emoji: '🟥', pct: '100%' },
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
      const tourRes = await api.get(`/tours/${tourId}`);
      const cavs = tourRes.data.cavs || [];
      const currentIndex = cavs.findIndex(c => c.status !== 'collected');
      if (currentIndex >= 0) {
        const cav = cavs[currentIndex];
        await api.put(`/tours/${tourId}/cav/${cav.cav_id}`, {
          status: 'collected',
          fill_level: fillLevel,
          qr_scanned: true,
          notes: anomaly ? `${anomaly}${notes ? ': ' + notes : ''}` : notes,
        });
      }
      localStorage.removeItem('scanned_qr');
      navigate('/tour-map');
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const selectedOption = FILL_LEVELS.find(o => o.value === fillLevel);
  const pctDisplay = selectedOption ? selectedOption.pct : '—';

  return (
    <MobileShell
      title="Niveau de remplissage"
      subtitle={scannedQR ? `QR scanné` : 'Estimez le remplissage du conteneur'}
      onBack={() => navigate('/tour-map')}
    >
      <div className="space-y-6">
        <p className="font-medium text-gray-700">Choisissez le niveau observé :</p>
        <div className="grid grid-cols-5 gap-2">
          {FILL_LEVELS.map(level => (
            <button
              key={level.value}
              type="button"
              onClick={() => setFillLevel(level.value)}
              className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all min-h-[72px] ${
                fillLevel === level.value
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 shadow-md'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <span className="text-2xl mb-1">{level.emoji}</span>
              <span className="text-xs font-semibold text-gray-700">{level.label}</span>
            </button>
          ))}
        </div>

        {fillLevel !== null && (
          <div className="card-mobile p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Remplissage</span>
              <span className="font-bold text-lg text-[var(--color-primary)]">{pctDisplay}</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-dark)]"
                style={{ width: `${(fillLevel / 4) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Anomalie constatée</label>
          <select
            value={anomaly}
            onChange={e => setAnomaly(e.target.value)}
            className="input-mobile"
          >
            <option value="">Aucune anomalie</option>
            <option value="debordement">Débordement</option>
            <option value="vandalisme">Vandalisme</option>
            <option value="acces_bloque">Accès bloqué</option>
            <option value="conteneur_endommage">Conteneur endommagé</option>
            <option value="dechets_non_conformes">Déchets non conformes</option>
          </select>
        </div>

        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Observations..."
            className="input-mobile min-h-[80px]"
            rows={2}
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={fillLevel === null || loading}
          className="btn-primary-mobile py-4 text-base"
        >
          {loading ? 'Enregistrement...' : 'Valider la collecte'}
        </button>
      </div>
    </MobileShell>
  );
}
