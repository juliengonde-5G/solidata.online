import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function CollectionProposals() {
  const [view, setView] = useState('daily'); // daily | weekly
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const m = new Date(d);
    m.setDate(diff);
    return m.toISOString().slice(0, 10);
  });
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [loading, setLoading] = useState(false);
  const [contextEdit, setContextEdit] = useState(null);
  const [savingContext, setSavingContext] = useState(false);

  const loadDaily = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tours/proposals/daily', { params: { date } });
      setDaily(res.data);
    } catch (err) {
      console.error(err);
      setDaily(null);
    }
    setLoading(false);
  };

  const loadWeekly = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tours/proposals/weekly', { params: { week_start: weekStart } });
      setWeekly(res.data);
    } catch (err) {
      console.error(err);
      setWeekly(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (view === 'daily') loadDaily();
    else loadWeekly();
  }, [view, date, weekStart]);

  const saveContext = async () => {
    if (!contextEdit) return;
    setSavingContext(true);
    try {
      await api.put('/tours/context', {
        date: contextEdit.date,
        weather_factor: contextEdit.weather_factor,
        traffic_factor: contextEdit.traffic_factor,
        duration_factor: contextEdit.duration_factor,
        notes: contextEdit.notes,
      });
      setContextEdit(null);
      if (view === 'daily') loadDaily();
      else loadWeekly();
    } catch (err) { console.error(err); }
    setSavingContext(false);
  };

  const createTourFromProposal = async (vehicleId, driverId) => {
    try {
      await api.post('/tours/intelligent', {
        vehicle_id: vehicleId,
        date,
        driver_employee_id: driverId || undefined,
      });
      loadDaily();
    } catch (err) { console.error(err); }
  };

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Propositions de collecte</h1>
            <p className="text-gray-500">Prédictions journalières et hebdomadaires — météo, trafic, apprentissage continu</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setView('daily')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'daily' ? 'bg-solidata-green text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              Jour
            </button>
            <button
              onClick={() => setView('weekly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'weekly' ? 'bg-solidata-green text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              Semaine
            </button>
          </div>
        </div>

        {view === 'daily' && (
          <div className="mb-4 flex items-center gap-4">
            <label className="text-sm font-medium text-gray-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}
        {view === 'weekly' && (
          <div className="mb-4 flex items-center gap-4">
            <label className="text-sm font-medium text-gray-600">Début de semaine (lundi)</label>
            <input
              type="date"
              value={weekStart}
              onChange={e => setWeekStart(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-solidata-green border-t-transparent" />
          </div>
        )}

        {!loading && view === 'daily' && daily && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border p-4 flex flex-wrap items-center gap-4">
              <span className="text-sm text-gray-500">Contexte du jour</span>
              <span className="text-sm">Météo : <strong>{(daily.context?.weatherFactor ?? 1).toFixed(2)}</strong></span>
              <span className="text-sm">Trafic : <strong>{(daily.context?.trafficFactor ?? 1).toFixed(2)}</strong></span>
              <span className="text-sm">Durée : <strong>{(daily.context?.durationFactor ?? 1).toFixed(2)}</strong></span>
              <button
                onClick={() => setContextEdit({ date, weather_factor: daily.context?.weatherFactor ?? 1, traffic_factor: daily.context?.trafficFactor ?? 1, duration_factor: daily.context?.durationFactor ?? 1, notes: '' })}
                className="text-solidata-green text-sm font-medium hover:underline"
              >
                Modifier le contexte
              </button>
            </div>

            <div className="grid gap-4">
              {daily.proposals?.map((p, idx) => (
                <div key={p.vehicle_id || idx} className="bg-white rounded-xl border overflow-hidden">
                  <div className="p-4 bg-gray-50 border-b flex items-center justify-between">
                    <h3 className="font-semibold">{p.vehicle_name}</h3>
                    <span className="text-sm text-gray-500">
                      {p.proposal?.stats?.totalCavs ?? 0} CAV · {p.proposal?.stats?.totalDistance ?? 0} km · {p.proposal?.stats?.estimatedDuration ?? 0} min
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-gray-600 whitespace-pre-wrap mb-4">{p.proposal?.explanation}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => createTourFromProposal(p.vehicle_id, daily.drivers?.[0]?.id)}
                        className="bg-solidata-green text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-solidata-green-dark"
                      >
                        Créer cette tournée
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {(!daily.proposals || daily.proposals.length === 0) && (
                <p className="text-gray-500 text-center py-8">Aucune proposition pour cette date (vérifier les véhicules disponibles).</p>
              )}
            </div>
          </div>
        )}

        {!loading && view === 'weekly' && weekly && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Semaine du {new Date(weekly.weekStart + 'T12:00:00').toLocaleDateString('fr-FR')} au {new Date(weekly.weekEnd + 'T12:00:00').toLocaleDateString('fr-FR')}</p>
            <div className="grid gap-3">
              {weekly.days?.map(day => (
                <div key={day.date} className="bg-white rounded-xl border p-4 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4">
                    <span className="font-medium capitalize">{day.dayName}</span>
                    <span className="text-sm text-gray-500">{day.date}</span>
                    {day.suggestedTour && (
                      <span className="text-sm">
                        {day.suggestedTour.cavCount} CAV · {day.suggestedTour.stats?.totalDistance ?? 0} km · Météo {day.context?.weatherFactor?.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {day.existingTours?.length > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{day.existingTours.length} tournée(s)</span>
                    )}
                    {day.availableVehicles === 0 && <span className="text-xs text-gray-400">Tous véhicules utilisés</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {contextEdit && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="font-bold mb-4">Contexte collecte — {contextEdit.date}</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Facteur météo (0.8–1.2)</label>
                  <input type="number" step="0.05" min="0.8" max="1.2" value={contextEdit.weather_factor} onChange={e => setContextEdit({ ...contextEdit, weather_factor: parseFloat(e.target.value) || 1 })} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Facteur trafic (0.8–1.2)</label>
                  <input type="number" step="0.05" min="0.8" max="1.2" value={contextEdit.traffic_factor} onChange={e => setContextEdit({ ...contextEdit, traffic_factor: parseFloat(e.target.value) || 1 })} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Facteur durée (0.8–1.2)</label>
                  <input type="number" step="0.05" min="0.8" max="1.2" value={contextEdit.duration_factor} onChange={e => setContextEdit({ ...contextEdit, duration_factor: parseFloat(e.target.value) || 1 })} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Notes</label>
                  <input type="text" value={contextEdit.notes || ''} onChange={e => setContextEdit({ ...contextEdit, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2" placeholder="Ex. Grève, travaux..." />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setContextEdit(null)} className="px-4 py-2 rounded-lg border text-sm">Annuler</button>
                <button onClick={saveContext} disabled={savingContext} className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">Enregistrer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
