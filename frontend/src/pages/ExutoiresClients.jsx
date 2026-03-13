import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const TYPE_LABELS = {
  recycleur: 'Recycleur',
  negociant: 'Négociant',
  industriel: 'Industriel',
  autre: 'Autre',
};

const TYPE_BADGES = {
  recycleur: 'bg-green-50 text-green-700',
  negociant: 'bg-blue-50 text-blue-700',
  industriel: 'bg-orange-50 text-orange-700',
  autre: 'bg-gray-100 text-gray-600',
};

const EMPTY_FORM = {
  raison_sociale: '',
  siret: '',
  adresse: '',
  code_postal: '',
  ville: '',
  contact_nom: '',
  contact_email: '',
  contact_telephone: '',
  type_client: 'recycleur',
};

export default function ExutoiresClients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  useEffect(() => { loadClients(); }, []);

  const loadClients = async () => {
    try {
      const res = await api.get('/clients-exutoires');
      setClients(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const filtered = clients.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.raison_sociale || '').toLowerCase().includes(q) ||
      (c.ville || '').toLowerCase().includes(q) ||
      (c.contact_nom || '').toLowerCase().includes(q)
    );
  });

  const stats = {
    total: clients.filter(c => c.is_active !== false).length,
    recycleur: clients.filter(c => c.type_client === 'recycleur' && c.is_active !== false).length,
    negociant: clients.filter(c => c.type_client === 'negociant' && c.is_active !== false).length,
    industriel: clients.filter(c => c.type_client === 'industriel' && c.is_active !== false).length,
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (client) => {
    setEditing(client);
    setForm({
      raison_sociale: client.raison_sociale || '',
      siret: client.siret || '',
      adresse: client.adresse || '',
      code_postal: client.code_postal || '',
      ville: client.ville || '',
      contact_nom: client.contact_nom || '',
      contact_email: client.contact_email || '',
      contact_telephone: client.contact_telephone || '',
      type_client: client.type_client || 'recycleur',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/clients-exutoires/${editing.id}`, form);
      } else {
        await api.post('/clients-exutoires', form);
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      loadClients();
    } catch (err) { console.error(err); }
  };

  const handleDisable = async (client) => {
    if (!window.confirm(`Désactiver le client "${client.raison_sociale}" ?`)) return;
    try {
      await api.delete(`/clients-exutoires/${client.id}`);
      loadClients();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Clients Exutoires</h1>
            <p className="text-gray-500">Gestion des clients exutoires et débouchés</p>
          </div>
          <button onClick={openCreate} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouveau client
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">Total clients actifs</p>
            <p className="text-2xl font-bold text-solidata-dark">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">Recycleurs</p>
            <p className="text-2xl font-bold text-green-600">{stats.recycleur}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">Négociants</p>
            <p className="text-2xl font-bold text-blue-600">{stats.negociant}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">Industriels</p>
            <p className="text-2xl font-bold text-orange-600">{stats.industriel}</p>
          </div>
        </div>

        {/* Search bar */}
        <div className="mb-4">
          <input
            placeholder="Rechercher par raison sociale, ville ou contact..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-80"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Raison sociale</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Ville</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Type</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Contact</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Email</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Téléphone</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(client => (
                <tr key={client.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-sm font-medium">{client.raison_sociale}</td>
                  <td className="p-3 text-sm">{client.ville || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${TYPE_BADGES[client.type_client] || TYPE_BADGES.autre}`}>
                      {TYPE_LABELS[client.type_client] || client.type_client || '—'}
                    </span>
                  </td>
                  <td className="p-3 text-sm">{client.contact_nom || '—'}</td>
                  <td className="p-3 text-sm">{client.contact_email || '—'}</td>
                  <td className="p-3 text-sm">{client.contact_telephone || '—'}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(client)} className="text-solidata-green hover:underline text-sm font-medium">
                        Modifier
                      </button>
                      <button onClick={() => handleDisable(client)} className="text-red-500 hover:underline text-sm font-medium">
                        Désactiver
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="7" className="p-8 text-center text-gray-400">Aucun client exutoire</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Modal form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowForm(false); setEditing(null); }}>
            <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 w-[500px] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-4 text-solidata-dark">
                {editing ? 'Modifier le client' : 'Nouveau client exutoire'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Raison sociale *</label>
                  <input
                    value={form.raison_sociale}
                    onChange={e => setForm({ ...form, raison_sociale: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">SIRET</label>
                  <input
                    value={form.siret}
                    onChange={e => setForm({ ...form, siret: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Adresse *</label>
                  <textarea
                    value={form.adresse}
                    onChange={e => setForm({ ...form, adresse: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    rows={2}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Code postal *</label>
                    <input
                      value={form.code_postal}
                      onChange={e => setForm({ ...form, code_postal: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Ville *</label>
                    <input
                      value={form.ville}
                      onChange={e => setForm({ ...form, ville: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Nom du contact *</label>
                  <input
                    value={form.contact_nom}
                    onChange={e => setForm({ ...form, contact_nom: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Email du contact *</label>
                  <input
                    type="email"
                    value={form.contact_email}
                    onChange={e => setForm({ ...form, contact_email: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Téléphone du contact</label>
                  <input
                    value={form.contact_telephone}
                    onChange={e => setForm({ ...form, contact_telephone: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Type de client</label>
                  <select
                    value={form.type_client}
                    onChange={e => setForm({ ...form, type_client: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 border rounded-lg py-2 text-sm">
                  Annuler
                </button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">
                  {editing ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
