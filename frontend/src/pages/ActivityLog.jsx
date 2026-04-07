import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const ACTION_LABELS = {
  login: 'Connexion', logout: 'Déconnexion', create: 'Création', update: 'Modification',
  delete: 'Suppression', password_change: 'Changement MDP', login_failed: 'Échec connexion',
};
const ACTION_COLORS = {
  login: 'bg-blue-100 text-blue-700', logout: 'bg-purple-100 text-purple-700',
  create: 'bg-green-100 text-green-700', update: 'bg-yellow-100 text-yellow-700',
  delete: 'bg-red-100 text-red-700', password_change: 'bg-orange-100 text-orange-700',
  login_failed: 'bg-red-200 text-red-800',
};
const ENTITY_LABELS = {
  vehicle: 'Véhicule', user: 'Utilisateur', employee: 'Collaborateur',
  candidate: 'Candidat', tour: 'Tournée', cav: 'CAV', team: 'Équipe',
  stock: 'Stock', production: 'Production', billing: 'Facturation',
  tri: 'Tri', expedition: 'Expédition', setting: 'Paramètre',
  referentiel: 'Référentiel', insertion: 'Insertion', pointage: 'Pointage',
  finance: 'Finance', newsfeed: 'Actualité', client_exutoire: 'Client exutoire',
  commande_exutoire: 'Commande exutoire', pennylane: 'Pennylane',
};

const TABS = [
  { id: 'activity', label: 'Activité', icon: '📋' },
  { id: 'connections', label: 'Connexions', icon: '🔐' },
  { id: 'sessions', label: 'Sessions', icon: '🖥️' },
  { id: 'chatbot', label: 'SolidataBot', icon: '🤖' },
];

export default function ActivityLog() {
  const [tab, setTab] = useState('activity');
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatStats, setChatStats] = useState(null);
  const [chatTotal, setChatTotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', entity_type: '', user_id: '' });
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState([]);
  const limit = 50;

  useEffect(() => {
    loadStats(); loadUsers();
    // Load active session count for stats card
    api.get('/activity-log/sessions?active_only=true').then(r => setActiveSessionCount(r.data.active_count || 0)).catch(() => {});
  }, []);
  useEffect(() => { setPage(0); }, [tab]);
  useEffect(() => {
    if (tab === 'activity') loadLogs();
    else if (tab === 'connections') loadConnections();
    else if (tab === 'sessions') loadSessions();
    else if (tab === 'chatbot') loadChatHistory();
  }, [tab, filters, page]);

  const loadUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data || []);
    } catch (err) { console.error(err); }
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (filters.action) params.set('action', filters.action);
      if (filters.entity_type) params.set('entity_type', filters.entity_type);
      if (filters.user_id) params.set('user_id', filters.user_id);
      const res = await api.get(`/activity-log?${params}`);
      setLogs(res.data.rows);
      setTotal(res.data.total);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadConnections = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (filters.user_id) params.set('user_id', filters.user_id);
      const res = await api.get(`/activity-log/connections?${params}`);
      setLogs(res.data.rows);
      setTotal(res.data.total);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = await api.get('/activity-log/sessions?active_only=false');
      setSessions(res.data.rows || []);
      setActiveSessionCount(res.data.active_count || 0);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadChatHistory = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (filters.user_id) params.set('user_id', filters.user_id);
      const [histRes, statsRes] = await Promise.all([
        api.get(`/chat/history?${params}`),
        api.get('/chat/history/stats'),
      ]);
      setChatHistory(histRes.data.rows || []);
      setChatTotal(histRes.data.total || 0);
      setChatStats(statsRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadStats = async () => {
    try {
      const res = await api.get('/activity-log/stats');
      setStats(res.data);
    } catch (err) { console.error(err); }
  };

  const killSession = async (sessionId) => {
    if (!confirm('Forcer la déconnexion de cette session ?')) return;
    try {
      await api.delete(`/activity-log/sessions/${sessionId}`);
      loadSessions();
    } catch (err) { console.error(err); }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—';

  const formatDuration = (start, end) => {
    if (!start) return '—';
    const ms = (end ? new Date(end) : new Date()) - new Date(start);
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}`;
    const days = Math.floor(hours / 24);
    return `${days}j ${hours % 24}h`;
  };

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Journal d'activité</h1>
          <p className="text-gray-500">Suivi des actions, connexions et sessions utilisateurs</p>
        </div>

        {/* Stats rapides */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-400 mb-1">Actions aujourd'hui</p>
              <p className="text-2xl font-bold text-[var(--color-primary)]">{stats.today}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-400 mb-1">Sessions actives</p>
              <p className="text-2xl font-bold text-blue-600">{activeSessionCount}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-400 mb-2">Top actions (30j)</p>
              <div className="space-y-1">
                {stats.by_action?.slice(0, 3).map(a => (
                  <div key={a.action} className="flex items-center justify-between text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[a.action] || 'bg-gray-100'}`}>
                      {ACTION_LABELS[a.action] || a.action}
                    </span>
                    <span className="text-gray-600 font-medium">{a.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-400 mb-2">Plus actifs (30j)</p>
              <div className="space-y-1">
                {stats.by_user?.slice(0, 3).map(u => (
                  <div key={u.user_id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{u.first_name} {u.last_name}</span>
                    <span className="text-gray-500 font-medium">{u.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Onglets */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id ? 'bg-white shadow-sm text-[var(--color-primary)]' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Filtres */}
        {tab !== 'sessions' && (
          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={filters.user_id}
              onChange={e => { setFilters({ ...filters, user_id: e.target.value }); setPage(0); }}
              className="select-modern w-auto"
            >
              <option value="">Tous les utilisateurs</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.role})</option>
              ))}
            </select>
            {tab === 'activity' && (
              <>
                <select value={filters.action} onChange={e => { setFilters({ ...filters, action: e.target.value }); setPage(0); }} className="select-modern w-auto">
                  <option value="">Toutes les actions</option>
                  <option value="login">Connexion</option>
                  <option value="logout">Déconnexion</option>
                  <option value="create">Création</option>
                  <option value="update">Modification</option>
                  <option value="delete">Suppression</option>
                  <option value="password_change">Changement MDP</option>
                </select>
                <select value={filters.entity_type} onChange={e => { setFilters({ ...filters, entity_type: e.target.value }); setPage(0); }} className="select-modern w-auto">
                  <option value="">Toutes les entités</option>
                  {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        {/* Contenu par onglet */}
        {loading ? (
          <LoadingSpinner size="lg" message="Chargement des logs..." />
        ) : tab === 'chatbot' ? (
          /* SolidataBot History */
          <div className="space-y-4">
            {chatStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl shadow-sm border p-4">
                  <p className="text-xs text-gray-400 mb-1">Total conversations</p>
                  <p className="text-2xl font-bold text-[var(--color-primary)]">{chatStats.total}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border p-4">
                  <p className="text-xs text-gray-400 mb-1">Aujourd'hui</p>
                  <p className="text-2xl font-bold text-blue-600">{chatStats.today}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border p-4">
                  <p className="text-xs text-gray-400 mb-1">Temps de réponse moyen</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {chatStats.avg_response_ms > 1000 ? `${(chatStats.avg_response_ms / 1000).toFixed(1)}s` : `${chatStats.avg_response_ms}ms`}
                  </p>
                </div>
              </div>
            )}
            <div className="flex gap-3 mb-2">
              <select
                value={filters.user_id}
                onChange={e => { setFilters({ ...filters, user_id: e.target.value }); setPage(0); }}
                className="select-modern w-auto"
              >
                <option value="">Tous les utilisateurs</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
                ))}
              </select>
            </div>
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Utilisateur</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3">Réponse</th>
                    <th className="px-4 py-3">Temps</th>
                  </tr>
                </thead>
                <tbody>
                  {chatHistory.map(ch => (
                    <tr key={ch.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(ch.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{ch.first_name} {ch.last_name}</span>
                        {ch.role && <span className="text-xs text-gray-400 ml-1">({ch.role})</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={ch.user_message}>{ch.user_message}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-sm truncate" title={ch.bot_reply}>{ch.bot_reply?.slice(0, 120)}{ch.bot_reply?.length > 120 ? '...' : ''}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {ch.response_time_ms ? `${(ch.response_time_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                    </tr>
                  ))}
                  {chatHistory.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucune conversation enregistrée</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {chatTotal > limit && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">Page {page + 1} / {Math.ceil(chatTotal / limit)} — {chatTotal} message{chatTotal > 1 ? 's' : ''}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30">Précédent</button>
                  <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= chatTotal} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30">Suivant</button>
                </div>
              </div>
            )}
          </div>
        ) : tab === 'sessions' ? (
          /* Sessions */
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">
                {activeSessionCount} session{activeSessionCount > 1 ? 's' : ''} active{activeSessionCount > 1 ? 's' : ''}
              </span>
              <button onClick={loadSessions} className="text-xs text-[var(--color-primary)] hover:underline">Actualiser</button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3">Utilisateur</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Début</th>
                  <th className="px-4 py-3">Dernière activité</th>
                  <th className="px-4 py-3">Durée</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} className={`border-t hover:bg-gray-50 ${s.is_active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{s.first_name} {s.last_name}</span>
                      {s.role && <span className="text-xs text-gray-400 ml-1">({s.role})</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.ip_address || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(s.started_at)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(s.last_activity)}</td>
                    <td className="px-4 py-3 text-gray-600 font-medium">{formatDuration(s.started_at, s.ended_at)}</td>
                    <td className="px-4 py-3">
                      {s.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Terminée</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.is_active && (
                        <button
                          onClick={() => killSession(s.id)}
                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                        >
                          Déconnecter
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune session enregistrée</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Activity & Connections */
          <>
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Utilisateur</th>
                    <th className="px-4 py-3">Action</th>
                    {tab === 'activity' && <th className="px-4 py-3">Entité</th>}
                    <th className="px-4 py-3">IP</th>
                    <th className="px-4 py-3">Détails</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(log.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{log.first_name} {log.last_name}</span>
                        {log.role && <span className="text-xs text-gray-400 ml-1">({log.role})</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-gray-100'}`}>
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      {tab === 'activity' && (
                        <td className="px-4 py-3 text-gray-600">
                          {ENTITY_LABELS[log.entity_type] || log.entity_type || '—'}
                          {log.entity_id && <span className="text-gray-400 ml-1">#{log.entity_id}</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs">{log.ip_address || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{log.details?.path || '—'}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan={tab === 'activity' ? 6 : 5} className="px-4 py-8 text-center text-gray-400">Aucune entrée</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-gray-500">Page {page + 1} / {Math.ceil(total / limit)} — {total} entrée{total > 1 ? 's' : ''}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30">Précédent</button>
                  <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30">Suivant</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
