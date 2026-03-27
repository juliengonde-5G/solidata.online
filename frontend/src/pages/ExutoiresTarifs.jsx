import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const TYPES_PRODUIT = {
  original: 'Original',
  csr: 'CSR',
  effilo_blanc: 'Effilo Blanc',
  effilo_couleur: 'Effilo Couleur',
  jean: 'Jean',
  coton_blanc: 'Coton Blanc',
  coton_couleur: 'Coton Couleur'
};

const TYPE_COLORS = {
  original: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' },
  csr: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-800' },
  effilo_blanc: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800' },
  effilo_couleur: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800' },
  jean: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-800' },
  coton_blanc: { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-700', badge: 'bg-teal-100 text-teal-800' },
  coton_couleur: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', badge: 'bg-pink-100 text-pink-800' }
};

export default function ExutoiresTarifs() {
  const [tarifs, setTarifs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    type_produit: '',
    prix_reference_tonne: '',
    client_id: '',
    date_debut: '',
    date_fin: ''
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [tarifRes, clientRes] = await Promise.all([
        api.get('/tarifs-exutoires'),
        api.get('/clients-exutoires')
      ]);
      setTarifs(tarifRes.data);
      setClients(clientRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const resetForm = () => {
    setForm({ type_produit: '', prix_reference_tonne: '', client_id: '', date_debut: '', date_fin: '' });
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (tarif) => {
    setEditing(tarif);
    setForm({
      type_produit: tarif.type_produit || '',
      prix_reference_tonne: tarif.prix_reference_tonne || '',
      client_id: tarif.client_id || '',
      date_debut: tarif.date_debut ? tarif.date_debut.slice(0, 10) : '',
      date_fin: tarif.date_fin ? tarif.date_fin.slice(0, 10) : ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      client_id: form.client_id || null,
      date_fin: form.date_fin || null
    };
    try {
      if (editing) {
        await api.put(`/tarifs-exutoires/${editing.id}`, payload);
      } else {
        await api.post('/tarifs-exutoires', payload);
      }
      setShowModal(false);
      resetForm();
      loadData();
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce tarif ?')) return;
    try {
      await api.delete(`/tarifs-exutoires/${id}`);
      loadData();
    } catch (err) { console.error(err); }
  };

  const prixReference = tarifs.filter(t => !t.client_id);
  const prixNegocies = tarifs.filter(t => t.client_id);

  const getClientName = (clientId) => {
    const c = clients.find(cl => cl.id === clientId);
    return c ? c.raison_sociale : `Client #${clientId}`;
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Grille Tarifaire Logistique</h1>
            <p className="text-gray-500">Gestion des prix de référence et négociés</p>
          </div>
          <button onClick={openCreate} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouveau tarif
          </button>
        </div>

        {/* Prix de référence */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-solidata-dark mb-4">Prix de référence</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Object.keys(TYPES_PRODUIT).map(type => {
              const tarif = prixReference.find(t => t.type_produit === type);
              const colors = TYPE_COLORS[type] || {};
              return (
                <div
                  key={type}
                  className={`rounded-xl shadow-sm border p-4 cursor-pointer hover:shadow-md transition-shadow ${colors.bg} ${colors.border}`}
                  onClick={() => tarif && openEdit(tarif)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${colors.badge}`}>
                      {TYPES_PRODUIT[type]}
                    </span>
                  </div>
                  {tarif ? (
                    <>
                      <div className={`text-2xl font-bold ${colors.text}`}>
                        {parseFloat(tarif.prix_reference_tonne).toFixed(2)} <span className="text-sm font-normal">€/t</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        Depuis le {new Date(tarif.date_debut).toLocaleDateString('fr-FR')}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-400 italic">Non défini</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Prix négociés par client */}
        <div>
          <h2 className="text-lg font-semibold text-solidata-dark mb-4">Prix négociés par client</h2>
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type produit</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Prix (€/t)</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date début</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date fin</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {prixNegocies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun prix négocié</td>
                  </tr>
                ) : (
                  prixNegocies.map(t => {
                    const colors = TYPE_COLORS[t.type_produit] || {};
                    return (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{getClientName(t.client_id)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${colors.badge}`}>
                            {TYPES_PRODUIT[t.type_produit] || t.type_produit}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium">
                          {parseFloat(t.prix_reference_tonne).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(t.date_debut).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {t.date_fin ? new Date(t.date_fin).toLocaleDateString('fr-FR') : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openEdit(t)} className="text-solidata-green hover:underline text-sm mr-3">
                            Modifier
                          </button>
                          <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:underline text-sm">
                            Supprimer
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-solidata-dark mb-4">
                {editing ? 'Modifier le tarif' : 'Nouveau tarif'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type de produit</label>
                  <select
                    value={form.type_produit}
                    onChange={e => setForm({ ...form, type_produit: e.target.value })}
                    required
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-solidata-green focus:border-solidata-green"
                  >
                    <option value="">Sélectionner...</option>
                    {Object.entries(TYPES_PRODUIT).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prix (€/tonne)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.prix_reference_tonne}
                    onChange={e => setForm({ ...form, prix_reference_tonne: e.target.value })}
                    required
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-solidata-green focus:border-solidata-green"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                  <select
                    value={form.client_id}
                    onChange={e => setForm({ ...form, client_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-solidata-green focus:border-solidata-green"
                  >
                    <option value="">Prix de référence (aucun client)</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.raison_sociale}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date début</label>
                  <input
                    type="date"
                    value={form.date_debut}
                    onChange={e => setForm({ ...form, date_debut: e.target.value })}
                    required
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-solidata-green focus:border-solidata-green"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date fin <span className="text-gray-400">(optionnel)</span></label>
                  <input
                    type="date"
                    value={form.date_fin}
                    onChange={e => setForm({ ...form, date_fin: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-solidata-green focus:border-solidata-green"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); resetForm(); }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium"
                  >
                    {editing ? 'Enregistrer' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
