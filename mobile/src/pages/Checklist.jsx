import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateTap, vibrateSuccess, vibrateError } from '../services/haptic';
import MobileShell, { TourStepBar } from '../components/MobileShell';

const CHECKLIST_ITEMS = [
  { id: 'papiers', label: 'Papiers du véhicule', sub: 'carte grise, assurance', icon: '📄' },
  { id: 'permis', label: 'Permis de conduire', sub: 'sur toi', icon: '🪪' },
  { id: 'gilet', label: 'Gilet + EPI', sub: 'gilet, gants à portée', icon: '🦺' },
  { id: 'triangle', label: 'Triangle de signalisation', sub: 'en cas de panne', icon: '⚠️' },
  { id: 'extincteur', label: 'Extincteur', sub: 'présent et accessible', icon: '🧯' },
  { id: 'telephone', label: 'Téléphone chargé', sub: '> 50% batterie', icon: '📱' },
  { id: 'eclairage', label: 'Feux & clignotants', sub: 'test rapide avant / arrière', icon: '💡' },
  { id: 'pneus', label: 'Pneus & pression', sub: 'visuel autour du camion', icon: '🛞' },
  { id: 'niveaux', label: 'Niveaux moteur', sub: 'huile, liquide de refr.', icon: '🛢️' },
  { id: 'proprete', label: 'Benne propre', sub: 'vide, sans résidu', icon: '🧽' },
  { id: 'sacs_remballes', label: 'Sacs de remballes', sub: 'stock disponible', icon: '🛍️' },
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
        const res = await fetch(`/api/tours/${tourId}/public`);
        const data = await res.json();
        setTour(data);
      } catch (e) {}
    };
    if (tourId) load();
  }, [tourId]);

  const toggle = (id) => { vibrateTap(); setChecked(prev => ({ ...prev, [id]: !prev[id] })); };
  const allChecked = CHECKLIST_ITEMS.every(item => checked[item.id]);
  const checkedCount = CHECKLIST_ITEMS.filter(item => checked[item.id]).length;
  const progressPct = (checkedCount / CHECKLIST_ITEMS.length) * 100;

  const submit = async () => {
    try {
      // Sauvegarder la checklist et démarrer la tournée (endpoints publics)
      await fetch(`/api/tours/${tourId}/checklist-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: tour?.vehicle_id,
          exterior_ok: allChecked,
          fuel_level: '1/2',
          km_start: parseInt(kmStart, 10) || 0,
          notes,
        }),
      });
      await fetch(`/api/tours/${tourId}/start-public`, { method: 'PUT' });
      vibrateSuccess();
      navigate('/tour-map');
    } catch (err) { vibrateError(); console.error(err); }
  };

  return (
    <MobileShell
      title="Vérifications camion"
      subtitle="Avant le départ"
      onBack={() => navigate('/start')}
      usageHint="operational_stop"
      footer={
        <div className="primary-action-bar">
          <button
            type="button"
            onClick={submit}
            disabled={!allChecked}
            className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              minHeight: 84,
              borderRadius: 20,
              boxShadow: '0 8px 22px rgba(13,148,136,0.28)',
            }}
          >
            {allChecked
              ? <>▶ Démarrer la navigation</>
              : `Coche les ${CHECKLIST_ITEMS.length - checkedCount} dernier${CHECKLIST_ITEMS.length - checkedCount > 1 ? 's' : ''} point${CHECKLIST_ITEMS.length - checkedCount > 1 ? 's' : ''}`}
          </button>
        </div>
      }
    >
      <div className="mb-4">
        <TourStepBar currentPath="/checklist" />
      </div>

      {/* Progress bar + count */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-sm font-extrabold text-gray-800 min-w-[44px] text-right">
          {checkedCount}/{CHECKLIST_ITEMS.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {CHECKLIST_ITEMS.map(item => {
          const ok = !!checked[item.id];
          return (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={ok}
              aria-label={item.label}
              onClick={() => toggle(item.id)}
              className="w-full flex items-center gap-4 text-left bg-white active:scale-[0.99] transition-all"
              style={{
                minHeight: 72,
                padding: '14px 14px',
                borderRadius: 16,
                border: ok ? '2px solid var(--color-primary)' : '1px solid #E2E8F0',
                boxShadow: ok ? '0 2px 8px rgba(13,148,136,0.12)' : '0 1px 2px rgba(15,23,42,0.04)',
              }}
            >
              <div
                className="flex items-center justify-center text-xl flex-shrink-0"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: ok ? 'var(--color-primary-surface, #F0FDFA)' : '#F1F5F9',
                }}
              >
                <span aria-hidden="true">{item.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold text-gray-900 leading-tight">{item.label}</div>
                {item.sub && <div className="text-xs text-gray-500 mt-0.5">{item.sub}</div>}
              </div>
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: ok ? 'var(--color-primary)' : 'white',
                  border: ok ? '2px solid var(--color-primary)' : '2px solid #CBD5E1',
                  color: 'white',
                  fontWeight: 800,
                }}
              >
                {ok && (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-3">
        <div
          className="bg-white"
          style={{ borderRadius: 16, padding: 14, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Kilométrage départ</label>
          <input
            type="number"
            inputMode="numeric"
            value={kmStart}
            onChange={e => setKmStart(e.target.value)}
            placeholder="Ex. 45230"
            className="input-mobile"
          />
        </div>
        <div
          className="bg-white"
          style={{ borderRadius: 16, padding: 14, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anomalies constatées…"
            className="input-mobile min-h-[80px]"
            rows={2}
          />
        </div>
      </div>
    </MobileShell>
  );
}
