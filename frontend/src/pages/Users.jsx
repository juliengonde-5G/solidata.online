import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const ROLE_LABELS = { ADMIN: 'Administrateur', MANAGER: 'Manager', RH: 'Ressources Humaines', COLLABORATEUR: 'Collaborateur', AUTORITE: 'Autorité' };
const ROLE_COLORS = { ADMIN: 'bg-red-100 text-red-700', MANAGER: 'bg-purple-100 text-purple-700', RH: 'bg-blue-100 text-blue-700', COLLABORATEUR: 'bg-green-100 text-green-700', AUTORITE: 'bg-yellow-100 text-yellow-700' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'COLLABORATEUR', first_name: '', last_name: '' });

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createUser = async (e) => {
    e.preventDefault();
    try {
      await api.post('/users', form);
      setShowForm(false);
      setForm({ username: '', email: '', password: '', role: 'COLLABORATEUR', first_name: '', last_name: '' });
      loadUsers();
    } catch (err) { console.error(err); }
  };

  const toggleActive = async (id, currentlyActive) => {
    try {
      await api.put(`/users/${id}`, { is_active: !currentlyActive });
      loadUsers();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Utilisateurs</h1>
            <p className="text-gray-500">Gestion des comptes — {users.length} utilisateur{users.length > 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouvel utilisateur
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Utilisateur</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Email</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Rôle</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Dernière connexion</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-solidata-green/20 text-solidata-green flex items-center justify-center text-xs font-bold">
                        {u.first_name?.[0] || u.username?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{u.first_name} {u.last_name}</p>
                        <p className="text-xs text-gray-400">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-sm">{u.email || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${ROLE_COLORS[u.role] || ''}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.is_active ? 'Actif' : 'Désactivé'}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-500">{u.last_login ? new Date(u.last_login).toLocaleString('fr-FR') : 'Jamais'}</td>
                  <td className="p-3">
                    <button onClick={() => toggleActive(u.id, u.is_active)} className={`text-xs font-medium hover:underline ${u.is_active ? 'text-red-500' : 'text-green-500'}`}>
                      {u.is_active ? 'Désactiver' : 'Activer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createUser} className="bg-white rounded-xl p-6 w-[400px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouvel utilisateur</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Prénom" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                  <input placeholder="Nom" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                </div>
                <input placeholder="Nom d'utilisateur *" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Mot de passe *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
