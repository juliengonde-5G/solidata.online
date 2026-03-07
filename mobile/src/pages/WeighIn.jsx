import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function WeighIn() {
  const [grossWeight, setGrossWeight] = useState('');
  const [tareWeight, setTareWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));

  const submit = async () => {
    setLoading(true);
    try {
      await api.post(`/tours/${tourId}/weigh-in`, {
        gross_weight_kg: parseFloat(grossWeight) || 0,
        tare_weight_kg: parseFloat(tareWeight) || 0,
        net_weight_kg: netWeight,
      });
      await api.put(`/tours/${tourId}/status`, { status: 'completed' });
      navigate('/tour-summary');
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-solidata-green text-white p-4">
        <button onClick={() => navigate('/return-centre')} className="text-white/70 text-sm mb-1">← Retour</button>
        <h1 className="font-bold text-lg">Pesée du véhicule</h1>
      </header>

      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
          <p className="text-5xl mb-2">⚖️</p>
          <p className="text-gray-500 text-sm">Enregistrez les données de pesée</p>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Poids brut (kg)</label>
          <input
            type="number"
            value={grossWeight}
            onChange={e => setGrossWeight(e.target.value)}
            placeholder="Poids véhicule chargé"
            className="w-full border rounded-lg px-3 py-3 text-lg font-bold text-center"
          />
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium block mb-2">Tare véhicule (kg)</label>
          <input
            type="number"
            value={tareWeight}
            onChange={e => setTareWeight(e.target.value)}
            placeholder="Poids véhicule à vide"
            className="w-full border rounded-lg px-3 py-3 text-lg font-bold text-center"
          />
        </div>

        {/* Net weight display */}
        <div className="bg-solidata-green/10 border border-solidata-green/30 rounded-2xl p-6 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Poids net collecté</p>
          <p className="text-4xl font-black text-solidata-green">{netWeight.toFixed(0)}</p>
          <p className="text-sm text-gray-500">kilogrammes</p>
          <p className="text-xs text-gray-400 mt-1">{(netWeight / 1000).toFixed(2)} tonnes</p>
        </div>

        <button
          onClick={submit}
          disabled={!grossWeight || !tareWeight || loading}
          className="w-full bg-solidata-green text-white font-bold py-4 rounded-2xl shadow-lg disabled:opacity-50"
        >
          {loading ? 'Finalisation...' : 'Valider la pesée'}
        </button>
      </div>
    </div>
  );
}
