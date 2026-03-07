import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const CHECKLIST_ITEMS = [
  { id: 'papiers', label: 'Papiers du véhicule', icon: '📄' },
  { id: 'permis', label: 'Permis de conduire', icon: '🪪' },
  { id: 'gilet', label: 'Gilet de sécurité', icon: '🦺' },
  { id: 'triangle', label: 'Triangle de signalisation', icon: '⚠️' },
  { id: 'extincteur', label: 'Extincteur', icon: '🧯' },
  { id: 'telephone', label: 'Téléphone chargé', icon: '📱' },
  { id: 'eclairage', label: 'Éclairage fonctionnel', icon: '💡' },
  { id: 'pneus', label: 'État des pneus', icon: '🔧' },
  { id: 'niveaux', label: 'Niveaux (huile, liquide refr.)', icon: '🛢️' },
  { id: 'proprete', label: 'Propreté du véhicule', icon: '🧹' },
];

export default function Checklist() {
  const [checked, setChecked] = useState({});
  const [notes, setNotes] = useState('');
  const [kmStart, setKmStart] = useState('');
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  const toggle = (id) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  const allChecked = CHECKLIST_ITEMS.every(item => checked[item.id]);
  const checkedCount = CHECKLIST_ITEMS.filter(item => checked[item.id]).length;

  const submit = async () => {
    try {
      await api.post(`/tours/${tourId}/checklist`, {
        items: checked,
        notes,
        km_start: parseInt(kmStart) || 0,
      });
      await api.put(`/tours/${tourId}/status`, { status: 'in_progress' });
      navigate('/tour-map');
    } catch (err) { console.error(err); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-solidata-green text-white p-4">
        <button onClick={() => navigate('/vehicle-select')} className="text-white/70 text-sm mb-1">← Retour</button>
        <h1 className="font-bold text-lg">Checklist départ</h1>
        <p className="text-white/70 text-xs">Tournée #{tourId} — {checkedCount}/{CHECKLIST_ITEMS.length} vérifiés</p>
      </header>

      {/* Progress bar */}
      <div className="h-1 bg-gray-200">
        <div className="h-1 bg-solidata-green transition-all" style={{ width: `${(checkedCount / CHECKLIST_ITEMS.length) * 100}%` }} />
      </div>

      <div className="p-4 space-y-3">
        {CHECKLIST_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => toggle(item.id)}
            className={`w-full flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm transition ${checked[item.id] ? 'ring-2 ring-solidata-green bg-solidata-green/5' : ''}`}
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="flex-1 text-left font-medium text-sm">{item.label}</span>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${checked[item.id] ? 'bg-solidata-green border-solidata-green text-white' : 'border-gray-300'}`}>
              {checked[item.id] && <span className="text-xs">✓</span>}
            </div>
          </button>
        ))}

        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium text-gray-600 block mb-2">Kilométrage départ</label>
          <input
            type="number"
            value={kmStart}
            onChange={e => setKmStart(e.target.value)}
            placeholder="Ex: 45230"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm">
          <label className="text-sm font-medium text-gray-600 block mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anomalies constatées..."
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows="2"
          />
        </div>

        <button
          onClick={submit}
          disabled={!allChecked}
          className="w-full bg-solidata-green text-white font-bold py-4 rounded-2xl shadow-lg text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {allChecked ? 'Démarrer la tournée' : `${CHECKLIST_ITEMS.length - checkedCount} point(s) restant(s)`}
        </button>
      </div>
    </div>
  );
}
