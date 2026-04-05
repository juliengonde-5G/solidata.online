import { useState, useEffect, useCallback } from 'react';
import { Wrench } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const STATUS_COLORS = { ok: 'bg-green-100 text-green-700', bientot: 'bg-yellow-100 text-yellow-700', depasse: 'bg-red-100 text-red-700' };
const STATUS_LABELS = { ok: 'OK', bientot: 'Bientôt', depasse: 'Dépassé' };

export default function VehicleMaintenance() {
  const [tab, setTab] = useState('plans');
  const [profiles, setProfiles] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(true);

  // Profil sélectionné
  const [selectedProfile, setSelectedProfile] = useState(null);

  // Véhicule sélectionné pour historique
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [events, setEvents] = useState([]);

  // Formulaire nouveau profil
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileForm, setProfileForm] = useState({ vehicle_type: '', brand: '', model: '', engine_code: '', timing_system: 'courroie', adblue_equipped: true, revision_km: 30000, revision_months: 24 });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [profilesRes, vehiclesRes, overviewRes] = await Promise.all([
        api.get('/vehicles/maintenance/profiles-db'),
        api.get('/vehicles'),
        api.get('/vehicles/maintenance/overview').catch(() => ({ data: [] })),
      ]);
      setProfiles(profilesRes.data);
      setVehicles(vehiclesRes.data);
      setOverview(overviewRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadVehicleDetail = useCallback(async (vehicleId) => {
    try {
      const [schedRes, eventsRes] = await Promise.all([
        api.get(`/vehicles/maintenance/schedule/${vehicleId}`),
        api.get(`/vehicles/${vehicleId}/events`),
      ]);
      setSchedule(schedRes.data);
      setEvents(eventsRes.data);
    } catch (err) { console.error(err); }
  }, []);

  const selectVehicle = (v) => {
    setSelectedVehicle(v);
    loadVehicleDetail(v.id);
    setTab('historique');
  };

  const deleteProfile = async (id) => {
    if (!window.confirm('Supprimer ce profil constructeur ?')) return;
    try {
      await api.delete(`/vehicles/maintenance/profiles-db/${id}`);
      loadAll();
      if (selectedProfile?.id === id) setSelectedProfile(null);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
  const formatCost = (c) => c ? `${parseFloat(c).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €` : '—';

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de la maintenance..." /></Layout>;

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Maintenance véhicules</h1>
            <p className="text-slate-500 text-sm">Plans constructeurs, suivi entretien, alertes</p>
          </div>
          <div className="flex gap-2">
            {['plans', 'flotte', 'historique'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-teal-600 text-white' : 'bg-white border text-slate-600 hover:bg-slate-50'}`}>
                {t === 'plans' ? 'Plans constructeurs' : t === 'flotte' ? 'État flotte' : 'Historique véhicule'}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ TAB PLANS CONSTRUCTEURS ═══ */}
        {tab === 'plans' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{profiles.length} profil(s) constructeur en base</p>
              <button onClick={() => setShowProfileForm(true)} className="btn-primary text-sm">
                + Ajouter un profil
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {profiles.map(p => (
                <div key={p.id} onClick={() => setSelectedProfile(selectedProfile?.id === p.id ? null : p)}
                  className={`bg-white rounded-xl border p-5 cursor-pointer transition hover:shadow-md ${selectedProfile?.id === p.id ? 'ring-2 ring-teal-500 shadow-md' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-bold text-slate-800">{p.brand} {p.model}</p>
                      <p className="text-xs text-slate-400">{p.engine_code || '—'}</p>
                    </div>
                    <div className="flex gap-1">
                      {p.timing_system === 'courroie' && <span className="px-2 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700">Courroie</span>}
                      {p.timing_system === 'chaine' && <span className="px-2 py-0.5 rounded text-[10px] bg-green-100 text-green-700">Chaîne</span>}
                      {p.adblue_equipped && <span className="px-2 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700">AdBlue</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-slate-400">Révision :</span> <span className="font-medium">{(p.revision_km || 0).toLocaleString()} km</span></div>
                    <div><span className="text-slate-400">ou</span> <span className="font-medium">{p.revision_months} mois</span></div>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">{p.items?.length || 0} opérations • Source : {p.source || 'constructeur'}</div>
                  <button onClick={(e) => { e.stopPropagation(); deleteProfile(p.id); }} className="mt-2 text-xs text-red-400 hover:text-red-600">Supprimer</button>
                </div>
              ))}
            </div>

            {/* Détail profil sélectionné */}
            {selectedProfile && (
              <div className="bg-white rounded-xl border shadow-sm p-6">
                <h3 className="font-bold text-slate-800 mb-4">{selectedProfile.brand} {selectedProfile.model} — Plan d'entretien</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 uppercase bg-slate-50">
                        <th className="px-3 py-2">Opération</th>
                        <th className="px-3 py-2 text-right">Intervalle km</th>
                        <th className="px-3 py-2 text-right">Intervalle mois</th>
                        <th className="px-3 py-2 text-right">Coût estimé</th>
                        <th className="px-3 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedProfile.items || []).map((item, i) => (
                        <tr key={i} className="border-t hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-medium">{item.label_fr}</td>
                          <td className="px-3 py-2.5 text-right">{item.interval_km ? `${item.interval_km.toLocaleString()} km` : '—'}</td>
                          <td className="px-3 py-2.5 text-right">{item.interval_months ? `${item.interval_months} mois` : '—'}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-teal-600">{formatCost(item.estimated_cost_eur)}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-400 max-w-xs truncate">{item.interval_note || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td className="px-3 py-2" colSpan="3">Coût total cycle complet estimé</td>
                        <td className="px-3 py-2 text-right text-teal-700">
                          {formatCost((selectedProfile.items || []).reduce((sum, i) => sum + (parseFloat(i.estimated_cost_eur) || 0), 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB ÉTAT FLOTTE ═══ */}
        {tab === 'flotte' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-slate-400">Véhicules actifs</p>
                <p className="text-2xl font-bold text-slate-800">{vehicles.filter(v => v.status !== 'out_of_service').length}</p>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-slate-400">En maintenance</p>
                <p className="text-2xl font-bold text-orange-600">{vehicles.filter(v => v.status === 'maintenance').length}</p>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-slate-400">Alertes actives</p>
                <p className="text-2xl font-bold text-red-600">{overview.filter(v => v.computed_alerts?.length > 0).length}</p>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-slate-400">Profils constructeur</p>
                <p className="text-2xl font-bold text-teal-600">{profiles.length}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase bg-slate-50">
                    <th className="px-4 py-3">Véhicule</th>
                    <th className="px-4 py-3">Immatriculation</th>
                    <th className="px-4 py-3 text-right">Km</th>
                    <th className="px-4 py-3">Profil</th>
                    <th className="px-4 py-3">Dernière révision</th>
                    <th className="px-4 py-3">Alertes</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map(v => (
                    <tr key={v.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{v.name || `${v.registration}`}</td>
                      <td className="px-4 py-3 font-mono text-xs">{v.registration}</td>
                      <td className="px-4 py-3 text-right">{(v.current_km || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs">{v.vehicle_type || '—'}</td>
                      <td className="px-4 py-3 text-xs">{formatDate(v.last_maintenance_date)}</td>
                      <td className="px-4 py-3">
                        {(v.computed_alerts || []).length > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {v.computed_alerts.map((a, i) => (
                              <span key={i} className={`px-2 py-0.5 rounded text-[10px] font-medium ${a.urgency === 'critique' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                {a.type}
                              </span>
                            ))}
                          </div>
                        ) : <span className="text-green-500 text-xs">✓ RAS</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => selectVehicle(v)} className="text-xs text-teal-600 hover:underline">Détail</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ TAB HISTORIQUE VÉHICULE ═══ */}
        {tab === 'historique' && (
          <div className="space-y-4">
            {!selectedVehicle ? (
              <div className="bg-white rounded-xl border p-8 text-center">
                <p className="text-slate-400 mb-4">Sélectionnez un véhicule dans l'onglet "État flotte"</p>
                <button onClick={() => setTab('flotte')} className="btn-primary text-sm">Voir la flotte</button>
              </div>
            ) : (
              <>
                {/* En-tête véhicule */}
                <div className="bg-white rounded-xl border p-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">{selectedVehicle.name || selectedVehicle.registration}</h2>
                    <p className="text-sm text-slate-500">{selectedVehicle.registration} • {(selectedVehicle.current_km || 0).toLocaleString()} km • Profil : {schedule?.profile_name || '—'}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-500">{schedule?.profile_source === 'database' ? '📋 Profil constructeur (base)' : '⚙️ Profil hardcodé'}</span>
                </div>

                {/* Grille d'entretien */}
                {schedule?.schedule?.length > 0 && (
                  <div className="bg-white rounded-xl border shadow-sm p-6">
                    <h3 className="font-bold text-slate-800 mb-4">Plan de maintenance — état actuel</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 uppercase bg-slate-50">
                            <th className="px-3 py-2">Opération</th>
                            <th className="px-3 py-2 text-right">Intervalle</th>
                            <th className="px-3 py-2 text-right">Dernier (km)</th>
                            <th className="px-3 py-2 text-right">Dernier (date)</th>
                            <th className="px-3 py-2 text-right">Depuis</th>
                            <th className="px-3 py-2">État</th>
                            {schedule.profile_source === 'database' && <th className="px-3 py-2 text-right">Coût</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {schedule.schedule.map((op, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2.5 font-medium">{op.label}</td>
                              <td className="px-3 py-2.5 text-right text-xs">
                                {op.intervalle_km ? `${op.intervalle_km.toLocaleString()} km` : ''}
                                {op.intervalle_km && op.intervalle_months ? ' / ' : ''}
                                {op.intervalle_months ? `${op.intervalle_months} mois` : ''}
                              </td>
                              <td className="px-3 py-2.5 text-right">{op.last_km ? op.last_km.toLocaleString() : '—'}</td>
                              <td className="px-3 py-2.5 text-right text-xs">{formatDate(op.last_date)}</td>
                              <td className="px-3 py-2.5 text-right">{op.km_since?.toLocaleString() || '—'} km</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-gray-200 rounded-full h-2">
                                    <div className={`h-2 rounded-full ${op.status === 'ok' ? 'bg-green-500' : op.status === 'bientot' ? 'bg-yellow-500' : 'bg-red-500'}`}
                                      style={{ width: `${Math.min(op.ratio || 0, 100)}%` }} />
                                  </div>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[op.status] || ''}`}>
                                    {op.ratio || 0}%
                                  </span>
                                </div>
                              </td>
                              {schedule.profile_source === 'database' && (
                                <td className="px-3 py-2.5 text-right text-xs text-teal-600">{formatCost(op.estimated_cost_eur)}</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Historique des événements */}
                <div className="bg-white rounded-xl border shadow-sm p-6">
                  <h3 className="font-bold text-slate-800 mb-4">Historique d'entretien</h3>
                  {events.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">Aucun événement enregistré</p>
                  ) : (
                    <div className="space-y-3">
                      {events.map(e => (
                        <div key={e.id} className="flex items-start gap-4 p-3 rounded-lg bg-slate-50">
                          <div className="w-12 text-center">
                            <p className="text-xs font-bold text-slate-800">{new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric' })}</p>
                            <p className="text-[10px] text-slate-400">{new Date(e.event_date).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}</p>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="capitalize font-medium text-sm">{e.event_type?.replace('_', ' ')}</span>
                              {e.km_at_event && <span className="text-xs text-slate-400">{e.km_at_event.toLocaleString()} km</span>}
                            </div>
                            {e.description && <p className="text-xs text-slate-500 mt-1">{e.description}</p>}
                            <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                              {e.cost && <span>💰 {formatCost(e.cost)}</span>}
                              {e.performed_by && <span>🔧 {e.performed_by}</span>}
                              <span>👤 {e.created_by_name}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ MODAL NOUVEAU PROFIL ═══ */}
        {showProfileForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                const vehicleType = `${profileForm.brand} ${profileForm.model}`;
                await api.post('/vehicles/maintenance/profiles-db', { ...profileForm, vehicle_type: vehicleType, items: [] });
                setShowProfileForm(false);
                setProfileForm({ vehicle_type: '', brand: '', model: '', engine_code: '', timing_system: 'courroie', adblue_equipped: true, revision_km: 30000, revision_months: 24 });
                loadAll();
              } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
            }} className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouveau profil constructeur</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Marque *</label>
                    <input required value={profileForm.brand} onChange={e => setProfileForm({ ...profileForm, brand: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="FIAT" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Modèle *</label>
                    <input required value={profileForm.model} onChange={e => setProfileForm({ ...profileForm, model: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="Ducato 2.3 MultiJet" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Code moteur</label>
                  <input value={profileForm.engine_code} onChange={e => setProfileForm({ ...profileForm, engine_code: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="F1AGL411x" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Distribution</label>
                    <select value={profileForm.timing_system} onChange={e => setProfileForm({ ...profileForm, timing_system: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                      <option value="courroie">Courroie</option>
                      <option value="chaine">Chaîne</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">AdBlue</label>
                    <select value={profileForm.adblue_equipped} onChange={e => setProfileForm({ ...profileForm, adblue_equipped: e.target.value === 'true' })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Révision (km)</label>
                    <input type="number" value={profileForm.revision_km} onChange={e => setProfileForm({ ...profileForm, revision_km: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Révision (mois)</label>
                    <input type="number" value={profileForm.revision_months} onChange={e => setProfileForm({ ...profileForm, revision_months: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button type="button" onClick={() => setShowProfileForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
