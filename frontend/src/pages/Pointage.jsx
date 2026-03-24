import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const TABS = ['daily', 'badges', 'manual', 'alerts', 'log', 'monthly'];
const TAB_LABELS = { daily: 'Journée', badges: 'Badges', manual: 'Saisie manuelle', alerts: 'Alertes', log: 'Registre', monthly: 'Mensuel' };

export default function Pointage() {
  const [tab, setTab] = useState('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [employees, setEmployees] = useState([]);
  const [dailySummary, setDailySummary] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [badges, setBadges] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [movementLog, setMovementLog] = useState([]);
  const [loading, setLoading] = useState(false);

  // Manual entry form
  const [manualForm, setManualForm] = useState({ employee_id: '', date: '', entry_am: '', exit_am: '', entry_pm: '', exit_pm: '', notes: '' });
  const [manualMsg, setManualMsg] = useState('');

  // Badge form
  const [badgeForm, setBadgeForm] = useState({ badge_uid: '', employee_id: '', label: '' });
  const [badgeMsg, setBadgeMsg] = useState('');

  useEffect(() => {
    api.get('/employees?is_active=true').then(r => setEmployees(r.data)).catch(() => {});
  }, []);

  const loadDaily = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/pointage/daily-summary?date=${date}`);
      setDailySummary(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [date]);

  const loadMonthly = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/pointage/monthly-summary?month=${month}`);
      setMonthlySummary(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [month]);

  const loadBadges = useCallback(async () => {
    try {
      const res = await api.get('/pointage/badges');
      setBadges(res.data);
    } catch (err) { console.error(err); }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const res = await api.get(`/pointage/alerts?date=${date}`);
      setAlerts(res.data);
    } catch (err) { console.error(err); }
  }, [date]);

  const loadLog = useCallback(async () => {
    try {
      const res = await api.get(`/pointage/movement-log?date_from=${date}&date_to=${date}`);
      setMovementLog(res.data);
    } catch (err) { console.error(err); }
  }, [date]);

  useEffect(() => {
    if (tab === 'daily') loadDaily();
    if (tab === 'badges') loadBadges();
    if (tab === 'alerts') loadAlerts();
    if (tab === 'log') loadLog();
    if (tab === 'monthly') loadMonthly();
  }, [tab, date, month, loadDaily, loadMonthly, loadBadges, loadAlerts, loadLog]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setManualMsg('');
    try {
      await api.post('/pointage/manual', manualForm);
      setManualMsg('Heures enregistrées avec succès');
      setManualForm({ employee_id: '', date: '', entry_am: '', exit_am: '', entry_pm: '', exit_pm: '', notes: '' });
    } catch (err) {
      setManualMsg('Erreur : ' + (err.response?.data?.error || err.message));
    }
  };

  const handleBadgeCreate = async (e) => {
    e.preventDefault();
    setBadgeMsg('');
    try {
      await api.post('/pointage/badges', badgeForm);
      setBadgeMsg('Badge enregistré');
      setBadgeForm({ badge_uid: '', employee_id: '', label: '' });
      loadBadges();
    } catch (err) {
      setBadgeMsg('Erreur : ' + (err.response?.data?.error || err.message));
    }
  };

  const handleBadgeAssign = async (badgeId, employeeId) => {
    try {
      await api.put(`/pointage/badges/${badgeId}/assign`, { employee_id: employeeId });
      loadBadges();
    } catch (err) { console.error(err); }
  };

  const handleBadgeDeactivate = async (badgeId) => {
    if (!confirm('Désactiver ce badge ?')) return;
    try {
      await api.put(`/pointage/badges/${badgeId}/deactivate`);
      loadBadges();
    } catch (err) { console.error(err); }
  };

  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '-';

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-solidata-dark">Pointage</h1>
          <p className="text-gray-500">Gestion des badgeages et suivi des heures</p>
        </div>

        {/* Onglets */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${tab === t ? 'bg-white shadow text-solidata-dark' : 'text-gray-500 hover:text-gray-700'}`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* ═══ ONGLET JOURNÉE ═══ */}
        {tab === 'daily' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <button onClick={loadDaily} className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm hover:bg-solidata-green-dark">Actualiser</button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-400">Chargement...</div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Collaborateur</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Équipe</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Entrée AM</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Sortie AM</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Entrée PM</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Sortie PM</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Heures</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dailySummary.map(row => {
                      const events = typeof row.events === 'string' ? JSON.parse(row.events) : row.events;
                      const entryEvents = events.filter(e => e.event_type === 'entry');
                      const exitEvents = events.filter(e => e.event_type === 'exit');
                      const badgeCount = parseInt(row.badge_count) || 0;
                      return (
                        <tr key={row.employee_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{row.first_name} {row.last_name}</td>
                          <td className="px-4 py-3 text-gray-500">{row.team_name || '-'}</td>
                          <td className="px-4 py-3 text-center">{formatTime(entryEvents[0]?.event_time)}</td>
                          <td className="px-4 py-3 text-center">{formatTime(exitEvents[0]?.event_time)}</td>
                          <td className="px-4 py-3 text-center">{formatTime(entryEvents[1]?.event_time)}</td>
                          <td className="px-4 py-3 text-center">{formatTime(exitEvents[1]?.event_time)}</td>
                          <td className="px-4 py-3 text-center font-semibold">{row.hours_worked ? `${row.hours_worked}h` : '-'}</td>
                          <td className="px-4 py-3 text-center">
                            {badgeCount === 0 && <span className="inline-block px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-500">Non badgé</span>}
                            {badgeCount > 0 && badgeCount < 4 && <span className="inline-block px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-700">Partiel ({badgeCount}/4)</span>}
                            {badgeCount >= 4 && <span className="inline-block px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Complet</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {dailySummary.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucune donnée pour cette date</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══ ONGLET BADGES ═══ */}
        {tab === 'badges' && (
          <div>
            <form onSubmit={handleBadgeCreate} className="bg-white rounded-xl shadow-sm border p-4 mb-6">
              <h3 className="font-semibold mb-3">Enregistrer un nouveau badge</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input type="text" placeholder="UID du badge (ex: A1B2C3D4)" value={badgeForm.badge_uid}
                  onChange={e => setBadgeForm({ ...badgeForm, badge_uid: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" required />
                <select value={badgeForm.employee_id} onChange={e => setBadgeForm({ ...badgeForm, employee_id: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                  <option value="">Non affecté</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                </select>
                <input type="text" placeholder="Libellé (optionnel)" value={badgeForm.label}
                  onChange={e => setBadgeForm({ ...badgeForm, label: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                <button type="submit" className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm hover:bg-solidata-green-dark">Enregistrer</button>
              </div>
              {badgeMsg && <p className={`mt-2 text-sm ${badgeMsg.startsWith('Erreur') ? 'text-red-600' : 'text-green-600'}`}>{badgeMsg}</p>}
            </form>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">UID Badge</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Libellé</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Collaborateur</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Statut</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Affecté le</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {badges.map(badge => (
                    <tr key={badge.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{badge.badge_uid}</td>
                      <td className="px-4 py-3">{badge.label || '-'}</td>
                      <td className="px-4 py-3">
                        {badge.employee_id ? (
                          <span className="font-medium">{badge.first_name} {badge.last_name}</span>
                        ) : (
                          <select onChange={e => e.target.value && handleBadgeAssign(badge.id, e.target.value)} className="border rounded px-2 py-1 text-xs" defaultValue="">
                            <option value="">Affecter...</option>
                            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {badge.is_active
                          ? <span className="inline-block px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Actif</span>
                          : <span className="inline-block px-2 py-1 rounded-full text-xs bg-red-100 text-red-700">Inactif</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{badge.assigned_at ? new Date(badge.assigned_at).toLocaleDateString('fr-FR') : '-'}</td>
                      <td className="px-4 py-3 text-center">
                        {badge.is_active && (
                          <button onClick={() => handleBadgeDeactivate(badge.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Désactiver</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {badges.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun badge enregistré</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ ONGLET SAISIE MANUELLE ═══ */}
        {tab === 'manual' && (
          <div className="max-w-2xl">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="font-semibold mb-4">Saisie manuelle des heures</h3>
              <p className="text-sm text-gray-500 mb-4">Permet au manager de saisir ou corriger les horaires d'un collaborateur.</p>

              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Collaborateur</label>
                    <select value={manualForm.employee_id} onChange={e => setManualForm({ ...manualForm, employee_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                      <option value="">Sélectionner...</option>
                      {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <input type="date" value={manualForm.date} onChange={e => setManualForm({ ...manualForm, date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Entrée matin</label>
                    <input type="time" value={manualForm.entry_am} onChange={e => setManualForm({ ...manualForm, entry_am: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sortie matin</label>
                    <input type="time" value={manualForm.exit_am} onChange={e => setManualForm({ ...manualForm, exit_am: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Entrée après-midi</label>
                    <input type="time" value={manualForm.entry_pm} onChange={e => setManualForm({ ...manualForm, entry_pm: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sortie après-midi</label>
                    <input type="time" value={manualForm.exit_pm} onChange={e => setManualForm({ ...manualForm, exit_pm: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <input type="text" value={manualForm.notes} onChange={e => setManualForm({ ...manualForm, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Motif de la saisie manuelle..." />
                </div>

                <button type="submit" className="bg-solidata-green text-white px-6 py-2 rounded-lg text-sm hover:bg-solidata-green-dark font-medium">Enregistrer</button>
                {manualMsg && <p className={`text-sm ${manualMsg.startsWith('Erreur') ? 'text-red-600' : 'text-green-600'}`}>{manualMsg}</p>}
              </form>
            </div>
          </div>
        )}

        {/* ═══ ONGLET ALERTES ═══ */}
        {tab === 'alerts' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <button onClick={loadAlerts} className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm hover:bg-solidata-green-dark">Actualiser</button>
            </div>

            {alerts.length === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <p className="text-green-700 font-medium">Aucune alerte pour cette date</p>
                <p className="text-green-600 text-sm mt-1">Tous les collaborateurs planifiés ont badgé.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-red-50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-red-700">Collaborateur</th>
                      <th className="text-left px-4 py-3 font-medium text-red-700">Équipe</th>
                      <th className="text-center px-4 py-3 font-medium text-red-700">Type d'alerte</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {alerts.map(alert => (
                      <tr key={alert.employee_id} className="hover:bg-red-50/50">
                        <td className="px-4 py-3 font-medium">{alert.first_name} {alert.last_name}</td>
                        <td className="px-4 py-3 text-gray-500">{alert.team_name || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          {alert.alert_type === 'absent'
                            ? <span className="inline-block px-3 py-1 rounded-full text-xs bg-red-100 text-red-700 font-medium">Absent - Non badgé</span>
                            : <span className="inline-block px-3 py-1 rounded-full text-xs bg-yellow-100 text-yellow-700 font-medium">Badgeage incomplet</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══ ONGLET REGISTRE ═══ */}
        {tab === 'log' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <button onClick={loadLog} className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm hover:bg-solidata-green-dark">Actualiser</button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Heure</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Collaborateur</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Type</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Statut</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Terminal</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {movementLog.map(ev => (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{formatTime(ev.event_time)}</td>
                      <td className="px-4 py-3">{ev.first_name ? `${ev.first_name} ${ev.last_name}` : <span className="text-gray-400">Inconnu ({ev.badge_uid})</span>}</td>
                      <td className="px-4 py-3 text-center">
                        {ev.event_type === 'entry' && <span className="text-green-600 font-medium">Entrée</span>}
                        {ev.event_type === 'exit' && <span className="text-blue-600 font-medium">Sortie</span>}
                        {ev.event_type === 'unknown' && <span className="text-red-600 font-medium">Inconnu</span>}
                        {ev.event_type === 'excess' && <span className="text-orange-600 font-medium">Excédent</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ev.status === 'accepted' && <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Accepté"></span>}
                        {ev.status === 'rejected' && <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Refusé"></span>}
                        {ev.status === 'duplicate' && <span className="inline-block w-2 h-2 rounded-full bg-yellow-500" title="Doublon"></span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{ev.source === 'manual' ? 'Manuel' : 'Badge'}{ev.created_by_name ? ` (${ev.created_by_name})` : ''}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{ev.terminal_name || '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{ev.notes || ''}</td>
                    </tr>
                  ))}
                  {movementLog.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun mouvement enregistré</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ ONGLET MENSUEL ═══ */}
        {tab === 'monthly' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <button onClick={loadMonthly} className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm hover:bg-solidata-green-dark">Actualiser</button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Collaborateur</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Équipe</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Heures contrat/sem</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Jours badgés</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Jours travaillés</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Total heures</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Heures sup.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {monthlySummary.map(row => (
                    <tr key={row.employee_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{row.first_name} {row.last_name}</td>
                      <td className="px-4 py-3 text-gray-500">{row.team_name || '-'}</td>
                      <td className="px-4 py-3 text-center">{row.weekly_hours}h</td>
                      <td className="px-4 py-3 text-center">{row.days_badged}</td>
                      <td className="px-4 py-3 text-center">{row.days_worked}</td>
                      <td className="px-4 py-3 text-center font-semibold">{parseFloat(row.total_hours).toFixed(1)}h</td>
                      <td className="px-4 py-3 text-center">
                        {parseFloat(row.total_overtime) > 0
                          ? <span className="text-orange-600 font-medium">{parseFloat(row.total_overtime).toFixed(1)}h</span>
                          : <span className="text-gray-400">0</span>}
                      </td>
                    </tr>
                  ))}
                  {monthlySummary.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune donnée pour ce mois</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
