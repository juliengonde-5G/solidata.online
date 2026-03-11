import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function QRUnavailable() {
  const [reason, setReason] = useState('');
  const [manualCode, setManualCode] = useState('');
  const navigate = useNavigate();

  const REASONS = [
    { value: 'absent', label: 'QR Code absent', icon: '❌' },
    { value: 'illisible', label: 'QR Code illisible', icon: '🔍' },
    { value: 'endommage', label: 'QR Code endommagé', icon: '💔' },
    { value: 'camera', label: 'Problème caméra', icon: '📷' },
  ];

  const proceed = () => {
    localStorage.setItem('scanned_qr', manualCode || `MANUAL-${reason}`);
    navigate('/fill-level');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-solidata-green text-white p-4">
        <button onClick={() => navigate('/tour-map')} className="text-white/70 text-sm mb-1">← Retour</button>
        <h1 className="font-bold text-lg">QR Code indisponible</h1>
      </header>

      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-600">Indiquez la raison pour laquelle le QR code n'a pas pu être scanné :</p>

        <div className="space-y-2">
          {REASONS.map(r => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              className={`w-full flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm transition ${reason === r.value ? 'ring-2 ring-solidata-green' : ''}`}
            >
              <span className="text-2xl">{r.icon}</span>
              <span className="font-medium text-sm">{r.label}</span>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Code manuel (optionnel)</label>
          <input
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            placeholder="Saisir l'identifiant du conteneur"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <button
          onClick={proceed}
          disabled={!reason}
          className="w-full bg-solidata-green text-white font-bold py-4 rounded-2xl shadow-lg disabled:opacity-50"
        >
          Continuer sans QR
        </button>
      </div>
    </div>
  );
}
