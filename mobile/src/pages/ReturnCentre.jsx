import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function ReturnCentre() {
  const [kmEnd, setKmEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  const submit = async () => {
    setLoading(true);
    try {
      await api.post(`/tours/${tourId}/checklist`, {
        type: 'return',
        km_end: parseInt(kmEnd) || 0,
        notes,
      });
      navigate('/weigh-in');
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-solidata-green text-white p-4">
        <button onClick={() => navigate('/tour-map')} className="text-white/70 text-sm mb-1">← Retour carte</button>
        <h1 className="font-bold text-lg">Retour au centre de tri</h1>
      </header>

      <div className="p-4 space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-3xl mb-2">🏭</p>
          <p className="font-bold text-blue-700">Centre de tri — Solidarité Textiles</p>
          <p className="text-xs text-blue-500 mt-1">Vous êtes de retour au centre</p>
        </div>

        {/* Checklist retour */}
        <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
          <h3 className="font-medium text-sm">Vérification retour</h3>
          {[
            { id: 'vehicule_ok', label: 'Véhicule en bon état' },
            { id: 'proprete', label: 'Véhicule propre' },
            { id: 'outils', label: 'Outils rangés' },
          ].map(item => (
            <label key={item.id} className="flex items-center gap-3 p-2">
              <input type="checkbox" className="w-5 h-5 rounded border-gray-300 text-solidata-green" />
              <span className="text-sm">{item.label}</span>
            </label>
          ))}
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Kilométrage arrivée</label>
          <input
            type="number"
            value={kmEnd}
            onChange={e => setKmEnd(e.target.value)}
            placeholder="Ex: 45280"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Commentaires sur la tournée..."
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows="2"
          />
        </div>

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-solidata-green text-white font-bold py-4 rounded-2xl shadow-lg disabled:opacity-50"
        >
          {loading ? 'Enregistrement...' : 'Passer à la pesée'}
        </button>
      </div>
    </div>
  );
}
