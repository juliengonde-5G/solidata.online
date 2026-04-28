import { useState, useEffect } from 'react';
import { UserPlus, Users as UsersIcon } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, StatusBadge, LoadingSpinner, Modal, PageHeader } from '../components';
import api from '../services/api';

const ROLE_LABELS = { ADMIN: 'Administrateur', MANAGER: 'Manager', RH: 'Ressources Humaines', COLLABORATEUR: 'Collaborateur', AUTORITE: 'Autorité' };

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

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des utilisateurs..." /></Layout>;

  const columns = [
    {
      key: 'user',
      label: 'Utilisateur',
      sortable: true,
      render: (u) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
            {u.first_name?.[0] || u.username?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-sm">{u.first_name} {u.last_name}</p>
            <p className="text-xs text-slate-400">@{u.username}</p>
          </div>
        </div>
      ),
    },
    { key: 'email', label: 'Email', sortable: true, render: (u) => u.email || '—' },
    {
      key: 'role',
      label: 'Rôle',
      sortable: true,
      render: (u) => <StatusBadge status={u.role} size="sm" />,
    },
    {
      key: 'is_active',
      label: 'Statut',
      sortable: true,
      render: (u) => <StatusBadge status={u.is_active ? 'active' : 'inactive'} size="sm" />,
    },
    {
      key: 'last_login',
      label: 'Dernière connexion',
      sortable: true,
      render: (u) => <span className="text-xs text-slate-500">{u.last_login ? new Date(u.last_login).toLocaleString('fr-FR') : 'Jamais'}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (u) => (
        <button onClick={() => toggleActive(u.id, u.is_active)} className={`text-xs font-medium hover:underline ${u.is_active ? 'text-red-500' : 'text-green-500'}`}>
          {u.is_active ? 'Désactiver' : 'Activer'}
        </button>
      ),
    },
  ];

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Utilisateurs"
          subtitle={`Gestion des comptes — ${users.length} utilisateur${users.length > 1 ? 's' : ''}`}
          icon={UsersIcon}
          actions={
            <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
              <UserPlus className="w-4 h-4 mr-2" strokeWidth={1.8} />
              Nouvel utilisateur
            </button>
          }
        />

        <DataTable
          columns={columns}
          data={users}
          loading={loading}
          emptyIcon={UserPlus}
          emptyMessage="Aucun utilisateur trouvé"
        />

        {/* Form */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouvel utilisateur" size="sm">
          <form onSubmit={createUser}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Prénom" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} className="input-modern" />
                <input placeholder="Nom" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} className="input-modern" />
              </div>
              <input placeholder="Nom d'utilisateur *" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="input-modern" required />
              <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-modern" />
              <input placeholder="Mot de passe *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="input-modern" required />
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="select-modern">
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
              <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
