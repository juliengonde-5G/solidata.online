import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Modal } from '../components';
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
            <h1 className="text-2xl font-bold text-slate-800">Propositions de collecte</h1>
            <p className="text-gray-500">Prédictions journalières et hebdomadaires — météo, trafic, apprentissage continu</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setView('daily')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'daily' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              Jour
            </button>
            <button
              onClick={() => setView('weekly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'weekly' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'}`}
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
              className="input-modern w-auto"
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
              className="input-modern w-auto"
            />
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && view === 'daily' && daily && (
          <div className="space-y-6">
            {/* Panneau de référence : météo + calendrier */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-b">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-700">Références du calcul prédictif</h3>
                  <button
                    onClick={() => setContextEdit({ date, weather_factor: daily.context?.weatherFactor ?? 1, traffic_factor: daily.context?.trafficFactor ?? 1, duration_factor: daily.context?.durationFactor ?? 1, notes: '' })}
                    className="text-primary text-xs font-medium hover:underline"
                  >
                    Modifier le contexte
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Météo */}
                  <div className="bg-white rounded-lg p-3 border">
                    <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Météo du jour</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-xs text-gray-400 block">Conditions</span>
                        <span className="font-medium">{daily.context?.weatherLabel || 'Non disponible'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Temp. max</span>
                        <span className="font-medium">{daily.context?.tempMax != null ? `${daily.context.tempMax}°C` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Précipitations</span>
                        <span className="font-medium">{daily.context?.precipMm != null ? `${daily.context.precipMm} mm` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Facteur météo</span>
                        <span className={`font-mono font-bold ${(daily.context?.weatherFactor ?? 1) < 1 ? 'text-orange-600' : (daily.context?.weatherFactor ?? 1) > 1 ? 'text-green-600' : 'text-gray-700'}`}>
                          x{(daily.context?.weatherFactor ?? 1).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-2 text-xs text-gray-500">
                      <span>Trafic : <strong>x{(daily.context?.trafficFactor ?? 1).toFixed(2)}</strong></span>
                      <span>Durée : <strong>x{(daily.context?.durationFactor ?? 1).toFixed(2)}</strong></span>
                    </div>
                    {daily.context?.notes && (
                      <p className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">{daily.context.notes}</p>
                    )}
                  </div>

                  {/* Calendrier congés */}
                  <div className="bg-white rounded-lg p-3 border">
                    <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-2">Calendrier des congés</p>

                    {/* Statut vacances du jour */}
                    {daily.vacationStatus ? (
                      <div className={`rounded-lg px-3 py-2 mb-2 text-sm ${
                        daily.vacationStatus.status === 'during' ? 'bg-purple-100 text-purple-800' :
                        daily.vacationStatus.status === 'pre' ? 'bg-amber-50 text-amber-800' :
                        'bg-blue-50 text-blue-800'
                      }`}>
                        <span className="font-medium">
                          {daily.vacationStatus.status === 'during' ? 'En vacances' :
                           daily.vacationStatus.status === 'pre' ? 'Semaine pré-vacances' :
                           'Semaine post-vacances'}
                        </span>
                        <span className="ml-1">— {daily.vacationStatus.name}</span>
                        <span className="ml-2 font-mono text-xs">(x{daily.vacationStatus.bonus})</span>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mb-2">Hors période de vacances scolaires</p>
                    )}

                    {/* Jour férié */}
                    {daily.holiday && (
                      <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 mb-2 text-sm">
                        <span className="font-medium">Jour férié</span>
                        <span className="ml-2 font-mono text-xs">(x{daily.holiday.bonus})</span>
                      </div>
                    )}

                    {/* Facteurs appliqués */}
                    {daily.referenceCalendar && (
                      <div className="flex gap-3 text-xs text-gray-500 mb-2">
                        <span>Saisonnier : <strong>x{daily.referenceCalendar.seasonalFactor}</strong></span>
                        <span>Jour semaine : <strong>x{daily.referenceCalendar.dayOfWeekFactor}</strong></span>
                      </div>
                    )}

                    {/* Prochaines vacances */}
                    {daily.referenceCalendar?.upcomingVacations?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 mb-1">Prochaines vacances :</p>
                        <div className="space-y-1">
                          {daily.referenceCalendar.upcomingVacations.map((v, i) => (
                            <div key={i} className="text-xs flex justify-between bg-gray-50 rounded px-2 py-1">
                              <span className="font-medium">{v.name}</span>
                              <span className="text-gray-400">
                                {new Date(v.start + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — {new Date(v.end + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Jours fériés proches */}
                    {daily.referenceCalendar?.nearbyHolidays?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 mb-1">Jours fériés proches :</p>
                        <div className="flex flex-wrap gap-1">
                          {daily.referenceCalendar.nearbyHolidays.map((h, i) => (
                            <span key={i} className="inline-block bg-red-50 text-red-600 text-xs px-2 py-0.5 rounded">
                              {new Date(h + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
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
                        className="btn-primary text-sm"
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

            {/* Vacances de la semaine */}
            {weekly.upcomingVacations?.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center gap-3">
                <span className="text-purple-600 font-medium text-sm">Vacances scolaires :</span>
                {weekly.upcomingVacations.map((v, i) => (
                  <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-lg">
                    {v.name} ({new Date(v.start + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — {new Date(v.end + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-3">
              {weekly.days?.map(day => (
                <div key={day.date} className="bg-white rounded-xl border p-4 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4">
                    <span className="font-medium capitalize w-24">{day.dayName}</span>
                    <span className="text-sm text-gray-500">{day.date}</span>
                    {day.suggestedTour && (
                      <span className="text-sm">
                        {day.suggestedTour.cavCount} CAV · {day.suggestedTour.stats?.totalDistance ?? 0} km
                      </span>
                    )}
                    {/* Météo inline */}
                    {day.context?.weatherLabel && (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                        {day.context.weatherLabel}
                        {day.context.tempMax != null && ` ${day.context.tempMax}°C`}
                        {' '}x{day.context.weatherFactor?.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    {/* Badges vacances / férié */}
                    {day.vacationStatus && (
                      <span className={`text-xs px-2 py-1 rounded ${
                        day.vacationStatus.status === 'during' ? 'bg-purple-100 text-purple-700' :
                        day.vacationStatus.status === 'pre' ? 'bg-amber-50 text-amber-700' :
                        'bg-blue-50 text-blue-700'
                      }`}>
                        {day.vacationStatus.status === 'during' ? 'Vacances' :
                         day.vacationStatus.status === 'pre' ? 'Pré-vacances' : 'Post-vacances'}
                      </span>
                    )}
                    {day.holiday && (
                      <span className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded">Férié</span>
                    )}
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

        <Modal isOpen={!!contextEdit} onClose={() => setContextEdit(null)} title={`Contexte collecte — ${contextEdit?.date || ''}`} size="sm" footer={
          <>
            <button onClick={() => setContextEdit(null)} className="px-4 py-2 rounded-lg border text-sm">Annuler</button>
            <button onClick={saveContext} disabled={savingContext} className="btn-primary text-sm">Enregistrer</button>
          </>
        }>
          {contextEdit && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Facteur météo (0.8–1.2)</label>
                <input type="number" step="0.05" min="0.8" max="1.2" value={contextEdit.weather_factor} onChange={e => setContextEdit({ ...contextEdit, weather_factor: parseFloat(e.target.value) || 1 })} className="input-modern" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Facteur trafic (0.8–1.2)</label>
                <input type="number" step="0.05" min="0.8" max="1.2" value={contextEdit.traffic_factor} onChange={e => setContextEdit({ ...contextEdit, traffic_factor: parseFloat(e.target.value) || 1 })} className="input-modern" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Facteur durée (0.8–1.2)</label>
                <input type="number" step="0.05" min="0.8" max="1.2" value={contextEdit.duration_factor} onChange={e => setContextEdit({ ...contextEdit, duration_factor: parseFloat(e.target.value) || 1 })} className="input-modern" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Notes</label>
                <input type="text" value={contextEdit.notes || ''} onChange={e => setContextEdit({ ...contextEdit, notes: e.target.value })} className="input-modern" placeholder="Ex. Grève, travaux..." />
              </div>
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
