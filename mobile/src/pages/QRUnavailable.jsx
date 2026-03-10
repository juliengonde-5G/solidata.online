import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import MobileShell from '../components/MobileShell';

const REASONS = [
  { value: 'absent', label: 'QR Code absent', icon: '❌' },
  { value: 'illisible', label: 'QR Code illisible', icon: '🔍' },
  { value: 'endommage', label: 'QR Code endommage', icon: '💔' },
  { value: 'camera', label: 'Probleme camera', icon: '📷' },
];

export default function QRUnavailable() {
  const [reason, setReason] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [tourCavs, setTourCavs] = useState([]);
  const [selectedCav, setSelectedCav] = useState(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    const loadTourCavs = async () => {
      try {
        const res = await api.get(`/tours/${tourId}`);
        const cavs = (res.data.cavs || []).filter(c => c.status !== 'collected');
        setTourCavs(cavs);
      } catch (err) { console.error(err); }
    };
    if (tourId) loadTourCavs();
  }, [tourId]);

  const proceed = () => {
    const qrData = selectedCav?.qr_code_data || manualCode || `MANUAL-${reason}`;
    localStorage.setItem('scanned_qr', qrData);
    if (selectedCav) {
      localStorage.setItem('selected_cav_id', selectedCav.cav_id || selectedCav.id);
    }
    localStorage.setItem('qr_unavailable_reason', reason);
    navigate('/fill-level');
  };

  return (
    <MobileShell
      title="QR Code indisponible"
      subtitle="Indiquez la raison puis continuez"
      onBack={() => navigate('/tour-map')}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Pourquoi le QR n'a pas pu etre scanne ?</p>
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

        {tourCavs.length > 0 && (
          <div className="card-mobile p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Selectionner le CAV dans la liste</label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {tourCavs.map((cav, i) => (
                <button
                  key={cav.cav_id || i}
                  type="button"
                  onClick={() => { setSelectedCav(cav); setManualCode(cav.qr_code_data || ''); }}
                  className={`w-full text-left p-2.5 rounded-xl text-sm transition-all ${
                    selectedCav?.cav_id === cav.cav_id
                      ? 'bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)] font-semibold'
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <span className="font-medium">{cav.nom || cav.cav_name}</span>
                  {cav.commune && <span className="text-gray-400 ml-2 text-xs">{cav.commune}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Code manuel (optionnel)</label>
          <input
            value={manualCode}
            onChange={e => { setManualCode(e.target.value); setSelectedCav(null); }}
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
