import { useState, useEffect } from 'react';
import { UserPlus, Users as UsersIcon, KeyRound, Pencil } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, StatusBadge, LoadingSpinner, Modal, PageHeader } from '../components';
import api from '../services/api';

const ROLE_LABELS = { ADMIN: 'Administrateur', MANAGER: 'Manager', RH: 'Ressources Humaines', COLLABORATEUR: 'Collaborateur', AUTORITE: 'Autorité', RESP_BTQ: 'Responsable Boutique', DPO: 'DPO (protection des données)', FINANCE: 'Finance (consultation)', QHSE: 'QHSE' };

const BUILTIN_ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([key, label]) => ({ key, label, builtin: true }));

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'COLLABORATEUR', first_name: '', last_name: '' });
  // Rôles assignables : intégrés + personnalisés (créés dans « Habilitations »).
  const [roleOptions, setRoleOptions] = useState(BUILTIN_ROLE_OPTIONS);
  const roleLabel = (key) => roleOptions.find((r) => r.key === key)?.label || ROLE_LABELS[key] || key;

  // Édition
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [newPassword, setNewPassword] = useState('');
  const [editError, setEditError] = useState('');
  const [editMsg, setEditMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadUsers(); }, []);
  useEffect(() => {
    api.get('/permissions/roles')
      .then((r) => { if (Array.isArray(r.data?.roles) && r.data.roles.length) setRoleOptions(r.data.roles); })
      .catch(() => { /* garde les rôles intégrés par défaut */ });
  }, []);

  const loadUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createUser = async (e) => {
    e.preventDefault();
    if (!form.password || form.password.length < 10) {
      alert('Le mot de passe doit contenir au moins 10 caractères.');
      return;
    }
    try {
      await api.post('/users', form);
      setShowForm(false);
      setForm({ username: '', email: '', password: '', role: 'COLLABORATEUR', first_name: '', last_name: '' });
      loadUsers();
    } catch (err) { alert(err.response?.data?.error || 'Erreur lors de la création'); }
  };

  const toggleActive = async (id, currentlyActive) => {
    try {
      await api.put(`/users/${id}`, { is_active: !currentlyActive });
      loadUsers();
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const openEdit = (u) => {
    setEditUser(u);
    setEditForm({
      email: u.email || '', role: u.role, first_name: u.first_name || '',
      last_name: u.last_name || '', phone: u.phone || '', is_active: u.is_active !== false,
    });
    setNewPassword(''); setEditError(''); setEditMsg('');
  };

  const saveEdit = async () => {
    if (!editUser) return;
    setBusy(true); setEditError(''); setEditMsg('');
    try {
      await api.put(`/users/${editUser.id}`, {
        email: editForm.email || null,
        role: editForm.role,
        first_name: editForm.first_name || null,
        last_name: editForm.last_name || null,
        phone: editForm.phone || null,
        is_active: editForm.is_active,
      });
      setEditMsg('Modifications enregistrées.');
      loadUsers();
    } catch (err) { setEditError(err.response?.data?.error || err.message); }
    setBusy(false);
  };

  const resetPassword = async () => {
    if (!editUser) return;
    if (!newPassword || newPassword.length < 10) { setEditError('Mot de passe de 10 caractères minimum.'); return; }
    setBusy(true); setEditError(''); setEditMsg('');
    try {
      await api.put(`/users/${editUser.id}/reset-password`, { newPassword });
      setNewPassword('');
      setEditMsg('Mot de passe réinitialisé. L\'utilisateur devra se reconnecter (sessions invalidées).');
    } catch (err) { setEditError(err.response?.data?.error || err.message); }
    setBusy(false);
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
    { key: 'role', label: 'Rôle', sortable: true, render: (u) => <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">{roleLabel(u.role)}</span> },
    { key: 'is_active', label: 'Statut', sortable: true, render: (u) => <StatusBadge status={u.is_active ? 'active' : 'inactive'} size="sm" /> },
    {
      key: 'actions',
      label: '',
      render: (u) => (
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => openEdit(u)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
            <Pencil className="w-3.5 h-3.5" /> Modifier
          </button>
          <button onClick={() => toggleActive(u.id, u.is_active)} className={`text-xs font-medium hover:underline ${u.is_active ? 'text-red-500' : 'text-green-500'}`}>
            {u.is_active ? 'Désactiver' : 'Activer'}
          </button>
        </div>
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

        <DataTable columns={columns} data={users} loading={loading} emptyIcon={UserPlus} emptyMessage="Aucun utilisateur trouvé" />

        {/* Création */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouvel utilisateur" size="sm">
          <form onSubmit={createUser}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Prénom" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} className="input-modern" />
                <input placeholder="Nom" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} className="input-modern" />
              </div>
              <input placeholder="Nom d'utilisateur *" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="input-modern" required />
              <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-modern" />
              <input placeholder="Mot de passe * (min. 10 caractères)" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="input-modern" minLength={10} required />
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="select-modern">
                {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
              <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
            </div>
          </form>
        </Modal>

        {/* Édition + réinitialisation MDP */}
        <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={editUser ? `Modifier — ${editUser.first_name || ''} ${editUser.last_name || ''} (@${editUser.username})` : ''} size="sm">
          {editUser && (
            <div className="space-y-4">
              {editError && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{editError}</div>}
              {editMsg && <div className="text-sm bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2">{editMsg}</div>}

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Prénom</label>
                    <input value={editForm.first_name} onChange={e => setEditForm({ ...editForm, first_name: e.target.value })} className="input-modern mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Nom</label>
                    <input value={editForm.last_name} onChange={e => setEditForm({ ...editForm, last_name: e.target.value })} className="input-modern mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Email</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="input-modern mt-1" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium">Rôle (habilitation)</label>
                  <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="select-modern mt-1">
                    {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">La visibilité des modules par rôle se règle dans « Habilitations modules ».</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded" />
                  Compte actif
                </label>
                <button onClick={saveEdit} disabled={busy} className="w-full btn-primary text-sm">
                  {busy ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </button>
              </div>

              <div className="border-t pt-3">
                <label className="text-xs text-slate-500 font-medium flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" /> Réinitialiser le mot de passe</label>
                <div className="flex gap-2 mt-1">
                  <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Nouveau mot de passe (min. 10)" className="input-modern flex-1" />
                  <button onClick={resetPassword} disabled={busy || newPassword.length < 10} className="px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-semibold hover:bg-amber-200 disabled:opacity-50 whitespace-nowrap">
                    Réinitialiser
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Réinitialiser déconnecte l'utilisateur (sessions invalidées).</p>
              </div>

              <div className="flex justify-end">
                <button onClick={() => setEditUser(null)} className="btn-ghost text-sm">Fermer</button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
