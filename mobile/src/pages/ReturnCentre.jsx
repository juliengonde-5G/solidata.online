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
    >
      <div className="mb-4">
        <TourStepBar currentPath="/return-centre" />
      </div>
      <div className="space-y-4">
        <div className="card-mobile p-6 text-center bg-blue-50 border border-blue-100">
          <p className="text-4xl mb-2">🏭</p>
          <p className="font-semibold text-blue-800">Vous êtes de retour au centre</p>
          <p className="text-sm text-blue-600 mt-1">Indiquez le kilométrage puis passez à la pesée.</p>
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Kilométrage arrivée</label>
          <input
            type="number"
            value={kmEnd}
            onChange={e => setKmEnd(e.target.value)}
            placeholder="Ex. 45280"
            className="input-mobile"
          />
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Commentaires sur la tournée..."
            className="input-mobile min-h-[80px]"
            rows={2}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="btn-primary-mobile py-4 text-base disabled:opacity-50"
        >
          {loading ? 'Enregistrement...' : 'Passer à la pesée'}
        </button>
      </div>
    </MobileShell>
  );
}
