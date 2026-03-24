import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const ACTION_LABELS = {
  login: 'Connexion', create: 'Création', update: 'Modification', delete: 'Suppression',
};
const ACTION_COLORS = {
  login: 'bg-blue-100 text-blue-700', create: 'bg-green-100 text-green-700',
  update: 'bg-yellow-100 text-yellow-700', delete: 'bg-red-100 text-red-700',
};
const ENTITY_LABELS = {
  vehicle: 'Véhicule', user: 'Utilisateur', employee: 'Collaborateur',
  candidate: 'Candidat', tour: 'Tournée', cav: 'CAV',
};

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', entity_type: '' });
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => { loadLogs(); loadStats(); }, []);
  useEffect(() => { loadLogs(); }, [filters, page]);

  const loadLogs = async () => {
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (filters.action) params.set('action', filters.action);
      if (filters.entity_type) params.set('entity_type', filters.entity_type);
      const res = await api.get(`/activity-log?${params}`);
      setLogs(res.data.rows);
      setTotal(res.data.total);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadStats = async () => {
    try {
      const res = await api.get('/activity-log/stats');
      setStats(res.data);
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-solidata-dark">Journal d'activité</h1>
          <p className="text-gray-500">Historique des actions utilisateurs — {total} entrée{total > 1 ? 's' : ''}</p>
        </div>

        {/* Stats rapides */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-400 mb-1">Actions aujourd'hui</p>
              <p className="text-2xl font-bold text-solidata-green">{stats.today}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-400 mb-2">Top actions (30j)</p>
              <div className="space-y-1">
                {stats.by_action.slice(0, 4).map(a => (
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
              <p className="text-xs text-gray-400 mb-2">Utilisateurs les plus actifs (30j)</p>
              <div className="space-y-1">
                {stats.by_user.slice(0, 4).map(u => (
                  <div key={u.user_id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{u.first_name} {u.last_name}</span>
                    <span className="text-gray-500 font-medium">{u.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Filtres */}
        <div className="flex gap-3 mb-4">
          <select value={filters.action} onChange={e => { setFilters({ ...filters, action: e.target.value }); setPage(0); }} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Toutes les actions</option>
            <option value="login">Connexion</option>
            <option value="create">Création</option>
            <option value="update">Modification</option>
            <option value="delete">Suppression</option>
          </select>
          <select value={filters.entity_type} onChange={e => { setFilters({ ...filters, entity_type: e.target.value }); setPage(0); }} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Toutes les entités</option>
            <option value="vehicle">Véhicules</option>
            <option value="user">Utilisateurs</option>
            <option value="employee">Collaborateurs</option>
            <option value="candidate">Candidats</option>
            <option value="tour">Tournées</option>
          </select>
        </div>

        {/* Tableau */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entité</th>
                <th className="px-4 py-3">Détails</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{log.first_name} {log.last_name}</span>
                    {log.role && <span className="text-xs text-gray-400 ml-1">({log.role})</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-gray-100'}`}>
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {ENTITY_LABELS[log.entity_type] || log.entity_type || '—'}
                    {log.entity_id && <span className="text-gray-400 ml-1">#{log.entity_id}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {log.details?.path || '—'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucune activité enregistrée</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">Page {page + 1} / {Math.ceil(total / limit)}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30">Précédent</button>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total} className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30">Suivant</button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
