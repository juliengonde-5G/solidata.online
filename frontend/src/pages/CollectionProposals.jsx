import { useState, useEffect, useCallback } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { Modal, PageHeader, Section, ErrorState } from '../components';
import EstimationPanel from '../components/tours/EstimationPanel';
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

  // Bornes en risque de saturation (bandeau en tête)
  const [saturation, setSaturation] = useState(null);
  const [saturationLoading, setSaturationLoading] = useState(true);
  const [saturationError, setSaturationError] = useState(null);

  // État de création par jour pour la vue semaine : { [date]: { state: 'creating'|'done'|'error', message? } }
  const [weeklyStatus, setWeeklyStatus] = useState({});
  const [planningAll, setPlanningAll] = useState(false);
  const [planAllProgress, setPlanAllProgress] = useState(null);
  const [planAllSummary, setPlanAllSummary] = useState(null);

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
    else { loadWeekly(); setWeeklyStatus({}); setPlanAllSummary(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, weekStart]);

  useEffect(() => { loadSaturation(); }, [loadSaturation]);

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
      }, { timeout: 120000 });
      loadDaily();
    } catch (err) { console.error(err); }
  };

  // Une proposition PAR véhicule et par jour (backend `day.proposals[]`) ;
  // repli sur l'ancienne forme mono-véhicule `suggestedTour` si absente.
  const dayProposals = (day) =>
    (day.proposals?.length ? day.proposals : (day.suggestedTour ? [day.suggestedTour] : []))
      .filter(p => p?.vehicle?.id);
  const propKey = (day, p) => `${day.date}:${p.vehicle.id}`;

  const createProposal = async (day, proposal) => {
    const key = propKey(day, proposal);
    setWeeklyStatus(s => ({ ...s, [key]: { state: 'creating' } }));
    try {
      await api.post('/tours/intelligent', { date: day.date, vehicle_id: proposal.vehicle.id }, { timeout: 120000 });
      setWeeklyStatus(s => ({ ...s, [key]: { state: 'done' } }));
      loadWeekly();
    } catch (err) {
      console.error(err);
      setWeeklyStatus(s => ({ ...s, [key]: { state: 'error', message: err.response?.data?.error || 'Échec de la création' } }));
    }
  };

  const weekCandidates = () => {
    const out = [];
    for (const day of weekly?.days || []) {
      if (day.existingTours?.length > 0) continue;
      for (const proposal of dayProposals(day)) {
        if (weeklyStatus[propKey(day, proposal)]?.state !== 'done') out.push({ day, proposal });
      }
    }
    return out;
  };

  const planWholeWeek = async () => {
    const candidates = weekCandidates();
    if (candidates.length === 0) return;
    setPlanningAll(true);
    setPlanAllSummary(null);
    setPlanAllProgress({ done: 0, total: candidates.length });
    let created = 0, failed = 0;
    for (const { day, proposal } of candidates) {
      const key = propKey(day, proposal);
      setWeeklyStatus(s => ({ ...s, [key]: { state: 'creating' } }));
      try {
        await api.post('/tours/intelligent', { date: day.date, vehicle_id: proposal.vehicle.id }, { timeout: 120000 });
        setWeeklyStatus(s => ({ ...s, [key]: { state: 'done' } }));
        created++;
      } catch (err) {
        console.error(err);
        setWeeklyStatus(s => ({ ...s, [key]: { state: 'error', message: err.response?.data?.error || 'Échec de la création' } }));
        failed++;
      }
      setPlanAllProgress(p => ({ done: (p?.done || 0) + 1, total: candidates.length }));
    }
    setPlanAllSummary({ created, failed, total: candidates.length });
    setPlanningAll(false);
    loadWeekly();
  };

  const planAllCandidateCount = weekCandidates().length;

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <PageHeader
          title="Propositions de collecte"
          subtitle="Prédictions journalières et hebdomadaires — météo, trafic, apprentissage continu"
          icon={Sparkles}
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
          <div className="mb-4 flex items-center gap-4 flex-wrap">
            <label className="text-sm font-medium text-gray-600">Début de semaine (lundi)</label>
            <input
              type="date"
              value={weekStart}
              onChange={e => setWeekStart(e.target.value)}
              className="input-modern w-auto"
            />
            <button
              onClick={planWholeWeek}
              disabled={planningAll || planAllCandidateCount === 0}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {planningAll
                ? `Planification… (${planAllProgress?.done ?? 0}/${planAllProgress?.total ?? 0})`
                : `Planifier toute la semaine${planAllCandidateCount > 0 ? ` (${planAllCandidateCount})` : ''}`}
            </button>
            {planAllSummary && (
              <span className={`text-xs font-medium ${planAllSummary.failed > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {planAllSummary.created} tournée{planAllSummary.created > 1 ? 's' : ''} créée{planAllSummary.created > 1 ? 's' : ''}
                {planAllSummary.failed > 0 ? `, ${planAllSummary.failed} échec${planAllSummary.failed > 1 ? 's' : ''}` : ''}
              </span>
            )}
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
                    {p.proposal?.estimation && (
                      <div className="mb-4">
                        <EstimationPanel estimation={p.proposal.estimation} compact />
                      </div>
                    )}
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
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <p className="font-semibold text-amber-900">Aucune proposition pour cette date</p>
                  {daily.diagnostics && (
                    <ul className="text-sm text-amber-800 space-y-1 list-disc pl-5">
                      <li>Véhicules totaux : <strong>{daily.diagnostics.totalVehicles}</strong></li>
                      <li>Déjà affectés à une tournée non terminée : <strong>{daily.diagnostics.usedVehicles}</strong></li>
                      <li>Candidats restants : <strong>{daily.diagnostics.candidateVehicles}</strong></li>
                      <li>Tentatives effectuées : <strong>{daily.diagnostics.attemptedVehicles}</strong></li>
                      <li>Échecs : <strong>{daily.diagnostics.skippedCount}</strong></li>
                    </ul>
                  )}
                  {daily.skipped && daily.skipped.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-900 mb-1">Détail des échecs :</p>
                      <ul className="text-xs text-amber-700 space-y-1">
                        {daily.skipped.map((s, i) => (
                          <li key={i}>• <strong>{s.vehicle_name}</strong> : {s.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {daily.diagnostics?.candidateVehicles === 0 && (
                    <p className="text-xs text-amber-800 italic">
                      Tous les véhicules sont déjà affectés à des tournées non terminées ou non annulées pour cette date.
                      Annuler ou clôturer une tournée existante pour libérer un véhicule.
                    </p>
                  )}
                </div>
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
              {weekly.days?.map(day => {
                const hasExisting = day.existingTours?.length > 0;
                const proposals = dayProposals(day);
                return (
                  <div key={day.date} className="bg-white rounded-xl border p-4 space-y-2">
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
                        {hasExisting && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{day.existingTours.length} tournée(s)</span>
                        )}
                        {day.availableVehicles === 0 && <span className="text-xs text-gray-400">Tous véhicules utilisés</span>}
                      </div>
                    </div>

                    {/* Une proposition par véhicule disponible */}
                    {!hasExisting && proposals.map(proposal => {
                      const status = weeklyStatus[propKey(day, proposal)];
                      return (
                        <div key={proposal.vehicle.id} className="flex items-center justify-between flex-wrap gap-2 pl-2 border-l-2 border-slate-100">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-sm font-medium text-slate-700">
                              {proposal.vehicle.name || proposal.vehicle.registration}
                            </span>
                            <span className="text-sm text-gray-500">
                              {proposal.cavCount} CAV · {proposal.stats?.totalDistance ?? 0} km · {proposal.stats?.estimatedDuration ?? 0} min
                            </span>
                            {proposal.estimation && (
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${proposal.estimation.faisable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                {Math.round(proposal.estimation.poids_estime_kg || 0)} kg · {Math.round(proposal.estimation.taux_remplissage_vehicule_pct || 0)}% véhicule
                                {proposal.estimation.pause_dejeuner_incluse ? ' · pause incluse' : ''}
                              </span>
                            )}
                            {proposal.saturation_non_couverte?.length > 0 && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                {proposal.saturation_non_couverte.length} borne(s) saturée(s) non couverte(s)
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2 items-center">
                            {status?.state === 'done' ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Créée
                              </span>
                            ) : (
                              <button
                                onClick={() => createProposal(day, proposal)}
                                disabled={status?.state === 'creating' || planningAll}
                                className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {status?.state === 'creating' ? 'Création…' : status?.state === 'error' ? 'Réessayer' : 'Créer cette tournée'}
                              </button>
                            )}
                          </div>
                          {status?.state === 'error' && (
                            <p className="w-full text-xs text-red-600">{status.message}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
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
