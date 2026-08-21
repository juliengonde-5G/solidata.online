import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Info, AlertTriangle, RefreshCw, MapPin, ArrowRight } from 'lucide-react';
import Layout from '../components/Layout';
import { Modal, PageHeader, Section, ErrorState } from '../components';
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
  const [dailyError, setDailyError] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [weeklyError, setWeeklyError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [contextEdit, setContextEdit] = useState(null);
  const [savingContext, setSavingContext] = useState(false);
  const [contextSaveError, setContextSaveError] = useState(null);

  // Bornes en risque de saturation (bandeau en tête)
  const [saturation, setSaturation] = useState(null);
  const [saturationLoading, setSaturationLoading] = useState(true);
  const [saturationError, setSaturationError] = useState(null);

  const loadDaily = async () => {
    setLoading(true);
    setDailyError(null);
    try {
      const res = await api.get('/tours/proposals/daily', { params: { date } });
      setDaily(res.data);
    } catch (err) {
      console.error(err);
      setDaily(null);
      setDailyError(err.response?.data?.error || 'Impossible de charger le contexte du jour');
    }
    setLoading(false);
  };

  const loadWeekly = async () => {
    setLoading(true);
    setWeeklyError(null);
    try {
      const res = await api.get('/tours/proposals/weekly', { params: { week_start: weekStart } });
      setWeekly(res.data);
    } catch (err) {
      console.error(err);
      setWeekly(null);
      setWeeklyError(err.response?.data?.error || 'Impossible de charger le contexte de la semaine');
    }
    setLoading(false);
  };

  const loadSaturation = useCallback(async () => {
    setSaturationLoading(true);
    setSaturationError(null);
    try {
      const res = await api.get('/tours/saturation-risks', { params: { days: 7 } });
      setSaturation(res.data);
    } catch (err) {
      console.error(err);
      setSaturationError('Impossible de charger les risques de saturation');
    }
    setSaturationLoading(false);
  }, []);

  useEffect(() => {
    if (view === 'daily') loadDaily();
    else loadWeekly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, weekStart]);

  useEffect(() => { loadSaturation(); }, [loadSaturation]);

  const openContextEdit = () => {
    setContextSaveError(null);
    setContextEdit({
      date,
      weather_factor: daily?.context?.weatherFactor ?? 1,
      traffic_factor: daily?.context?.trafficFactor ?? 1,
      duration_factor: daily?.context?.durationFactor ?? 1,
      notes: '',
    });
  };

  const closeContextEdit = () => {
    setContextEdit(null);
    setContextSaveError(null);
  };

  const saveContext = async () => {
    if (!contextEdit) return;
    setSavingContext(true);
    setContextSaveError(null);
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
    } catch (err) {
      console.error(err);
      setContextSaveError(err.response?.data?.error || "Échec de l'enregistrement du contexte");
    }
    setSavingContext(false);
  };

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <PageHeader
          title="Contexte de collecte"
          subtitle="Météo, calendrier scolaire et bornes à risque de saturation — pour éclairer la planification. La création des tournées se fait depuis Planning tournées."
          icon={Info}
          actions={
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
          }
        />

        {/* Renvoi explicite vers l'écran de création de tournées */}
        <div className="card-modern p-4 flex items-center justify-between gap-3 flex-wrap bg-primary/5 border-primary/20">
          <div className="flex items-center gap-3">
            <MapPin className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm text-slate-700">
              Cette page n'affiche que le <strong>contexte</strong> de la journée. Pour créer, modifier ou planifier une tournée, direction <strong>Planning tournées</strong>.
            </p>
          </div>
          <Link
            to="/planning-tournees"
            className="btn-primary text-sm inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            Aller à Planning tournées <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Bornes en risque de saturation */}
        <Section
          title="Bornes en risque de saturation"
          subtitle={saturation ? `Horizon ${saturation.horizon_jours} jours — seuil ${saturation.seuil_pct}%` : undefined}
          icon={AlertTriangle}
          padded={false}
          actions={
            <button onClick={loadSaturation} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <RefreshCw className="w-3 h-3" /> Actualiser
            </button>
          }
        >
          {saturationLoading ? (
            <p className="text-sm text-slate-400 p-4">Chargement…</p>
          ) : saturationError ? (
            <div className="p-4"><ErrorState variant="card" title="Erreur" message={saturationError} onRetry={loadSaturation} /></div>
          ) : !saturation?.risques?.length ? (
            <p className="text-sm text-slate-400 p-4">Aucune borne en risque de saturation sur la période.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 uppercase bg-slate-50">
                    <th className="px-3 py-2">Borne</th>
                    <th className="px-3 py-2">Commune</th>
                    <th className="px-3 py-2 text-right">Remplissage actuel</th>
                    <th className="px-3 py-2">Saturation prévue</th>
                    <th className="px-3 py-2">Couverture</th>
                  </tr>
                </thead>
                <tbody>
                  {saturation.risques.map(r => (
                    <tr key={r.cav_id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{r.name}</td>
                      <td className="px-3 py-2 text-slate-500">{r.commune || '—'}</td>
                      <td className={`px-3 py-2 text-right font-bold ${r.fill_actuel_pct >= 80 ? 'text-red-600' : 'text-amber-600'}`}>
                        {Math.round(r.fill_actuel_pct)}%
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {r.date_saturation_prevue ? new Date(r.date_saturation_prevue).toLocaleDateString('fr-FR') : '—'}
                        {r.jours_avant_saturation != null && (
                          <span className="text-slate-400"> (J{r.jours_avant_saturation >= 0 ? '+' : ''}{r.jours_avant_saturation})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.couverture?.couvert ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            Couverte{r.couverture.tour_date ? ` le ${new Date(r.couverture.tour_date).toLocaleDateString('fr-FR')}` : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            Aucune rotation planifiée
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {view === 'daily' && (
          <div className="mb-4 flex items-center gap-4 flex-wrap">
            <label className="text-sm font-medium text-gray-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="input-modern w-auto"
            />
            <span className="text-sm text-slate-500 capitalize">
              {new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
        {view === 'weekly' && (
          <div className="mb-4 flex items-center gap-4 flex-wrap">
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

        {!loading && view === 'daily' && dailyError && (
          <ErrorState variant="card" title="Erreur" message={dailyError} onRetry={loadDaily} />
        )}

        {!loading && view === 'daily' && daily && (
          <div className="space-y-6">
            {/* Panneau de contexte : météo + calendrier + véhicules du jour */}
            <div className="card-modern overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-b">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-700">Contexte prédictif du jour</h3>
                  <button
                    onClick={openContextEdit}
                    className="text-primary text-xs font-medium hover:underline"
                  >
                    Modifier le contexte
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

                  {/* Véhicules du jour */}
                  <div className="bg-white rounded-lg p-3 border">
                    <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">Véhicules aujourd'hui</p>
                    {daily.diagnostics ? (
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="text-xs text-gray-400 block">Parc total</span>
                          <span className="font-medium">{daily.diagnostics.totalVehicles}</span>
                        </div>
                        <div>
                          <span className="text-xs text-gray-400 block">Déjà en tournée</span>
                          <span className="font-medium">{daily.diagnostics.usedVehicles}</span>
                        </div>
                        <div>
                          <span className="text-xs text-gray-400 block">Disponibles</span>
                          <span className={`font-bold ${daily.diagnostics.candidateVehicles === 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                            {daily.diagnostics.candidateVehicles}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Non disponible</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && view === 'weekly' && weeklyError && (
          <ErrorState variant="card" title="Erreur" message={weeklyError} onRetry={loadWeekly} />
        )}

        {!loading && view === 'weekly' && weekly && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Semaine du {new Date(weekly.weekStart + 'T12:00:00').toLocaleDateString('fr-FR')} au {new Date(weekly.weekEnd + 'T12:00:00').toLocaleDateString('fr-FR')}</p>

            {/* Vacances de la semaine */}
            {weekly.upcomingVacations?.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
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
                <div key={day.date} className="card-modern p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="font-medium capitalize w-24">{day.dayName}</span>
                      <span className="text-sm text-gray-500">{day.date}</span>
                      {/* Météo inline */}
                      {day.context?.weatherLabel && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                          {day.context.weatherLabel}
                          {day.context.tempMax != null && ` ${day.context.tempMax}°C`}
                          {' '}x{day.context.weatherFactor?.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 items-center flex-wrap justify-end">
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
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{day.existingTours.length} tournée(s) planifiée(s)</span>
                      )}
                      {day.availableVehicles === 0 ? (
                        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded">Tous véhicules utilisés</span>
                      ) : day.availableVehicles != null && (
                        <span className="text-xs text-gray-400">{day.availableVehicles} véhicule(s) disponible(s)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Modal isOpen={!!contextEdit} onClose={closeContextEdit} title={`Contexte collecte — ${contextEdit?.date || ''}`} size="sm" footer={
          <>
            <button onClick={closeContextEdit} className="px-4 py-2 rounded-lg border text-sm">Annuler</button>
            <button onClick={saveContext} disabled={savingContext} className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {savingContext ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </>
        }>
          {contextEdit && (
            <div className="space-y-3">
              {contextSaveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{contextSaveError}</p>
              )}
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
