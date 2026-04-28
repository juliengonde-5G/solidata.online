import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MobileShell, { TourStepBar } from '../components/MobileShell';

export default function ReturnCentre() {
  const [kmEnd, setKmEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  const submit = async () => {
    setLoading(true);
    try {
      await fetch(`/api/tours/${tourId}/status-public`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'returning',
          km_end: parseInt(kmEnd, 10) || 0,
          notes,
        }),
      });
      navigate('/weigh-in');
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  return (
    <MobileShell
      title="Retour au centre"
      subtitle="Centre de tri — Solidarité Textiles"
      onBack={() => navigate('/tour-map')}
      usageHint="operational_stop"
      footer={
        <div className="primary-action-bar">
          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-50"
            style={{ minHeight: 72, borderRadius: 18, boxShadow: '0 8px 22px rgba(13,148,136,0.28)' }}
          >
            {loading ? 'Enregistrement…' : '→ Passer à la pesée'}
          </button>
        </div>
      }
    >
      <div className="mb-4">
        <TourStepBar currentPath="/return-centre" />
      </div>
      <div className="space-y-4">
        <div
          className="text-center"
          style={{
            background: 'linear-gradient(180deg, #F0FDFA 0%, #CCFBF1 100%)',
            border: '1px solid #99F6E4',
            borderRadius: 20,
            padding: '24px 16px',
          }}
        >
          <p className="text-4xl mb-2">🏭</p>
          <p className="font-extrabold text-teal-900 text-lg">Vous êtes de retour au centre</p>
          <p className="text-sm text-teal-700 mt-1">
            Indiquez le kilométrage puis passez à la pesée.
          </p>
        </div>
        <div
          className="bg-white"
          style={{ borderRadius: 20, padding: 16, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Kilométrage arrivée</label>
          <input
            type="number"
            inputMode="numeric"
            value={kmEnd}
            onChange={e => setKmEnd(e.target.value)}
            placeholder="Ex. 45280"
            className="input-mobile"
          />
        </div>
        <div
          className="bg-white"
          style={{ borderRadius: 20, padding: 16, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Commentaires sur la tournée…"
            className="input-mobile min-h-[80px]"
            rows={2}
          />
        </div>
      </div>
    </MobileShell>
  );
}
