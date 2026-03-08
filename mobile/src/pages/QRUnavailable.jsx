import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MobileShell from '../components/MobileShell';

const REASONS = [
  { value: 'absent', label: 'QR Code absent', icon: '❌' },
  { value: 'illisible', label: 'QR Code illisible', icon: '🔍' },
  { value: 'endommage', label: 'QR Code endommagé', icon: '💔' },
  { value: 'camera', label: 'Problème caméra', icon: '📷' },
];

export default function QRUnavailable() {
  const [reason, setReason] = useState('');
  const [manualCode, setManualCode] = useState('');
  const navigate = useNavigate();

  const proceed = () => {
    localStorage.setItem('scanned_qr', manualCode || `MANUAL-${reason}`);
    navigate('/fill-level');
  };

  return (
    <MobileShell
      title="QR Code indisponible"
      subtitle="Indiquez la raison puis continuez"
      onBack={() => navigate('/tour-map')}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Pourquoi le QR n'a pas pu être scanné ?</p>
        <div className="space-y-2">
          {REASONS.map(r => (
            <button
              key={r.value}
              type="button"
              onClick={() => setReason(r.value)}
              className={`w-full flex items-center gap-4 card-mobile p-4 transition-all ${
                reason === r.value ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5' : ''
              }`}
            >
              <span className="text-2xl">{r.icon}</span>
              <span className="font-medium text-gray-800">{r.label}</span>
            </button>
          ))}
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Code manuel (optionnel)</label>
          <input
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            placeholder="Identifiant du conteneur"
            className="input-mobile"
          />
        </div>
        <button
          type="button"
          onClick={proceed}
          disabled={!reason}
          className="btn-primary-mobile py-4 disabled:opacity-50"
        >
          Continuer sans QR
        </button>
      </div>
    </MobileShell>
  );
}
