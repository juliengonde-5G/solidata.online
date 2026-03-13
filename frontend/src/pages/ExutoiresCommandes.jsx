import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const TYPES_PRODUIT = {
  original: 'Original', csr: 'CSR', effilo_blanc: 'Effilo Blanc',
  effilo_couleur: 'Effilo Couleur', jean: 'Jean', coton_blanc: 'Coton Blanc', coton_couleur: 'Coton Couleur'
};
const STATUTS = {
  en_attente: { label: 'En attente', color: 'bg-gray-100 text-gray-700' },
  confirmee: { label: 'Confirmée', color: 'bg-blue-100 text-blue-700' },
  en_preparation: { label: 'En préparation', color: 'bg-yellow-100 text-yellow-700' },
  chargee: { label: 'Chargée', color: 'bg-orange-100 text-orange-700' },
  expediee: { label: 'Expédiée', color: 'bg-purple-100 text-purple-700' },
  pesee_recue: { label: 'Pesée reçue', color: 'bg-indigo-100 text-indigo-700' },
  facturee: { label: 'Facturée', color: 'bg-teal-100 text-teal-700' },
  cloturee: { label: 'Clôturée', color: 'bg-green-100 text-green-700' },
  annulee: { label: 'Annulée', color: 'bg-red-100 text-red-700' },
};
const FREQUENCES = { unique: 'Unique', hebdomadaire: 'Hebdomadaire', bi_mensuel: 'Bi-mensuel', mensuel: 'Mensuel' };

const EMPTY_FORM = {
  client_id: '',
  type_produit: [],
  date_commande: new Date().toISOString().slice(0, 10),
  prix_tonne: '',
  tonnage_prevu: '',
  frequence: 'unique',
  date_fin_recurrence: '',
  notes: '',
};

const STATUS_TRANSITIONS = {
  en_attente: { action: 'Confirmer', next: 'confirmee' },
  confirmee: { action: 'Préparer', next: 'en_preparation' },
  en_preparation: { action: 'Marquer chargée', next: 'chargee' },
  chargee: { action: 'Marquer expédiée', next: 'expediee' },
  expediee: { action: 'Pesée reçue', next: 'pesee_recue' },
  pesee_recue: { action: 'Facturer', next: 'facturee' },
  facturee: { action: 'Clôturer', next: 'cloturee' },
};

export default function ExutoiresCommandes() {
  const [commandes, setCommandes] = useState([]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({ actives: 0, tonnage_prevu: 0, ca_previsionnel: 0, en_attente: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Filters
  const [filterStatut, setFilterStatut] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  useEffect(() => { loadClients(); }, []);
  useEffect(() => { loadCommandes(); loadStats(); }, [filterStatut, filterType, filterDateFrom, filterDateTo, filterSearch]);

  const loadClients = async () => {
    try {
      const res = await api.get('/clients-exutoires');
      setClients(res.data);
    } catch (err) { console.error(err); }
  };

  const loadStats = async () => {
    try {
      const res = await api.get('/commandes-exutoires/stats');
      setStats(res.data);
    } catch (err) { console.error(err); }
  };

  const loadCommandes = async () => {
    try {
      const params = {};
      if (filterStatut) params.statut = filterStatut;
      if (filterType) params.type_produit = filterType;
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;
      if (filterSearch) params.search = filterSearch;
      const res = await api.get('/commandes-exutoires', { params });
      setCommandes(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const getClientName = (clientId) => {
    const c = clients.find(cl => cl.id === clientId);
    return c ? (c.raison_sociale || c.nom) : `Client #${clientId}`;
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, type_produit: [], date_commande: new Date().toISOString().slice(0, 10) });
    setShowForm(true);
  };

  const openEdit = (commande) => {
    setEditing(commande);
    const types = Array.isArray(commande.type_produit)
      ? commande.type_produit
      : commande.type_produit ? [commande.type_produit] : [];
    setForm({
      client_id: commande.client_id || '',
      type_produit: types,
      date_commande: commande.date_commande ? commande.date_commande.slice(0, 10) : '',
      prix_tonne: commande.prix_tonne || '',
      tonnage_prevu: commande.tonnage_prevu || '',
      frequence: commande.frequence || 'unique',
      date_fin_recurrence: commande.date_fin_recurrence ? commande.date_fin_recurrence.slice(0, 10) : '',
      notes: commande.notes || '',
    });
    setShowForm(true);
  };

  const openDetail = async (commande) => {
    try {
      const res = await api.get(`/commandes-exutoires/${commande.id}`);
      setShowDetail(res.data);
    } catch (err) {
      console.error(err);
      setShowDetail(commande);
    }
  };

  const fetchPrice = async (clientId, types) => {
    if (!clientId || !types || types.length === 0) return;
    try {
      // Fetch price for first type as reference
      const res = await api.get('/tarifs-exutoires/prix', { params: { type_produit: types[0], client_id: clientId } });
      if (res.data && res.data.prix_tonne != null) {
        setForm(prev => ({ ...prev, prix_tonne: res.data.prix_tonne }));
      }
    } catch (err) { console.error(err); }
  };

  const handleClientChange = (value) => {
    setForm(prev => ({ ...prev, client_id: value }));
    fetchPrice(value, form.type_produit);
  };

  const handleTypeToggle = (type) => {
    setForm(prev => {
      const types = prev.type_produit.includes(type)
        ? prev.type_produit.filter(t => t !== type)
        : [...prev.type_produit, type];
      return { ...prev, type_produit: types };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.type_produit || form.type_produit.length === 0) {
      alert('Veuillez sélectionner au moins un type de produit');
      return;
    }
    const payload = {
      ...form,
      client_id: form.client_id || null,
      tonnage_prevu: form.tonnage_prevu || null,
      date_fin_recurrence: form.frequence !== 'unique' ? (form.date_fin_recurrence || null) : null,
    };
    try {
      if (editing) {
        await api.put(`/commandes-exutoires/${editing.id}`, payload);
      } else {
        await api.post('/commandes-exutoires', payload);
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      loadCommandes();
      loadStats();
    } catch (err) { console.error(err); }
  };

  const handleStatusChange = async (commande, newStatut) => {
    try {
      await api.patch(`/commandes-exutoires/${commande.id}/statut`, { statut: newStatut });
      loadCommandes();
      loadStats();
      if (showDetail && showDetail.id === commande.id) {
        const res = await api.get(`/commandes-exutoires/${commande.id}`);
        setShowDetail(res.data);
      }
    } catch (err) { console.error(err); }
  };

  const handleCancel = async (commande) => {
    if (!window.confirm(`Annuler la commande "${commande.reference}" ?`)) return;
    try {
      await api.patch(`/commandes-exutoires/${commande.id}/annuler`);
      loadCommandes();
      loadStats();
      if (showDetail && showDetail.id === commande.id) {
        setShowDetail(null);
      }
    } catch (err) { console.error(err); }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
  const formatPrice = (v) => v != null ? parseFloat(v).toFixed(2) : '—';
  const formatTonnage = (v) => v != null ? parseFloat(v).toFixed(3) : '—';

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Commandes Exutoires</h1>
            <p className="text-gray-500">Gestion des commandes et expéditions exutoires</p>
          </div>
          <button onClick={openCreate} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouvelle commande
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">Commandes actives</p>
            <p className="text-2xl font-bold text-solidata-dark">{stats.actives || 0}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">Tonnage prévu</p>
            <p className="text-2xl font-bold text-blue-600">{formatTonnage(stats.tonnage_prevu)} <span className="text-sm font-normal text-gray-400">t</span></p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">CA prévisionnel</p>
            <p className="text-2xl font-bold text-green-600">{formatPrice(stats.ca_previsionnel)} <span className="text-sm font-normal text-gray-400">€</span></p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-500 font-medium">En attente de traitement</p>
            <p className="text-2xl font-bold text-orange-600">{stats.en_attente || 0}</p>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={filterStatut}
            onChange={e => setFilterStatut(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(STATUTS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Tous les types</option>
            {Object.entries(TYPES_PRODUIT).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="Date début"
          />
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="Date fin"
          />
          <input
            placeholder="Rechercher par client..."
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-64"
          />
        </div>

        {/* Orders table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Référence</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Client</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Type</th>
                <th className="text-right p-3 text-xs font-semibold text-gray-500">Tonnage (t)</th>
                <th className="text-right p-3 text-xs font-semibold text-gray-500">Prix (€/t)</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Fréquence</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {commandes.map(cmd => {
                const statut = STATUTS[cmd.statut] || { label: cmd.statut, color: 'bg-gray-100 text-gray-700' };
                const canEdit = ['en_attente', 'confirmee'].includes(cmd.statut);
                const canCancel = !['cloturee', 'annulee'].includes(cmd.statut);
                return (
                  <tr key={cmd.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm font-medium font-mono">{cmd.reference || `#${cmd.id}`}</td>
                    <td className="p-3 text-sm">{formatDate(cmd.date_commande)}</td>
                    <td className="p-3 text-sm">{cmd.client_nom || getClientName(cmd.client_id)}</td>
                    <td className="p-3 text-sm">
                      {Array.isArray(cmd.type_produit)
                        ? cmd.type_produit.map(t => TYPES_PRODUIT[t] || t).join(', ')
                        : TYPES_PRODUIT[cmd.type_produit] || cmd.type_produit || '—'}
                    </td>
                    <td className="p-3 text-sm text-right font-mono">{formatTonnage(cmd.tonnage_prevu)}</td>
                    <td className="p-3 text-sm text-right font-mono">{formatPrice(cmd.prix_tonne)}</td>
                    <td className="p-3 text-sm">{FREQUENCES[cmd.frequence] || cmd.frequence || '—'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${statut.color}`}>
                        {statut.label}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <button onClick={() => openDetail(cmd)} className="text-solidata-green hover:underline text-sm font-medium">
                          Voir
                        </button>
                        {canEdit && (
                          <button onClick={() => openEdit(cmd)} className="text-blue-600 hover:underline text-sm font-medium">
                            Modifier
                          </button>
                        )}
                        {canCancel && (
                          <button onClick={() => handleCancel(cmd)} className="text-red-500 hover:underline text-sm font-medium">
                            Annuler
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {commandes.length === 0 && (
                <tr><td colSpan="9" className="p-8 text-center text-gray-400">Aucune commande exutoire</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Create/Edit modal form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowForm(false); setEditing(null); }}>
            <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 w-[520px] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-4 text-solidata-dark">
                {editing ? 'Modifier la commande' : 'Nouvelle commande exutoire'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Client *</label>
                  <select
                    value={form.client_id}
                    onChange={e => handleClientChange(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  >
                    <option value="">Sélectionner un client...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.raison_sociale || c.nom}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Types de produit * <span className="text-gray-400">(plusieurs possibles)</span></label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {Object.entries(TYPES_PRODUIT).map(([k, v]) => (
                      <label key={k} className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${form.type_produit.includes(k) ? 'bg-solidata-green/10 border-solidata-green' : 'hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          checked={form.type_produit.includes(k)}
                          onChange={() => handleTypeToggle(k)}
                          className="accent-solidata-green"
                        />
                        {v}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Date de commande *</label>
                  <input
                    type="date"
                    value={form.date_commande}
                    onChange={e => setForm({ ...form, date_commande: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Prix (€/tonne) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.prix_tonne}
                    onChange={e => setForm({ ...form, prix_tonne: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Tonnage prévu (t)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.tonnage_prevu}
                    onChange={e => setForm({ ...form, tonnage_prevu: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    placeholder="0.000"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Fréquence *</label>
                  <select
                    value={form.frequence}
                    onChange={e => setForm({ ...form, frequence: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  >
                    {Object.entries(FREQUENCES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                {form.frequence !== 'unique' && (
                  <div>
                    <label className="text-xs text-gray-500">Date fin de récurrence</label>
                    <input
                      type="date"
                      value={form.date_fin_recurrence}
                      onChange={e => setForm({ ...form, date_fin_recurrence: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs text-gray-500">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    rows={3}
                  />
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

        {/* Detail modal */}
        {showDetail && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDetail(null)}>
            <div className="bg-white rounded-xl p-6 w-[600px] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-solidata-dark">
                  Commande {showDetail.reference || `#${showDetail.id}`}
                </h2>
                <span className={`px-2 py-1 rounded text-xs font-medium ${(STATUTS[showDetail.statut] || {}).color || 'bg-gray-100 text-gray-700'}`}>
                  {(STATUTS[showDetail.statut] || {}).label || showDetail.statut}
                </span>
              </div>

              {/* Informations générales */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">Informations générales</h3>
                <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Client :</span>{' '}
                    <span className="font-medium">{showDetail.client_nom || getClientName(showDetail.client_id)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Type :</span>{' '}
                    <span className="font-medium">
                      {Array.isArray(showDetail.type_produit)
                        ? showDetail.type_produit.map(t => TYPES_PRODUIT[t] || t).join(', ')
                        : TYPES_PRODUIT[showDetail.type_produit] || showDetail.type_produit}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Date commande :</span>{' '}
                    <span className="font-medium">{formatDate(showDetail.date_commande)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Fréquence :</span>{' '}
                    <span className="font-medium">{FREQUENCES[showDetail.frequence] || showDetail.frequence}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Prix :</span>{' '}
                    <span className="font-medium">{formatPrice(showDetail.prix_tonne)} €/t</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Tonnage prévu :</span>{' '}
                    <span className="font-medium">{formatTonnage(showDetail.tonnage_prevu)} t</span>
                  </div>
                  {showDetail.frequence !== 'unique' && showDetail.date_fin_recurrence && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Fin récurrence :</span>{' '}
                      <span className="font-medium">{formatDate(showDetail.date_fin_recurrence)}</span>
                    </div>
                  )}
                  {showDetail.notes && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Notes :</span>{' '}
                      <span className="font-medium">{showDetail.notes}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Préparation */}
              {showDetail.preparation && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Préparation</h3>
                  <div className="bg-yellow-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Date préparation :</span>{' '}
                      <span className="font-medium">{formatDate(showDetail.preparation.date)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Tonnage préparé :</span>{' '}
                      <span className="font-medium">{formatTonnage(showDetail.preparation.tonnage)} t</span>
                    </div>
                    {showDetail.preparation.notes && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Notes :</span>{' '}
                        <span className="font-medium">{showDetail.preparation.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Pesée */}
              {showDetail.pesee && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Pesée</h3>
                  <div className="bg-indigo-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Date pesée :</span>{' '}
                      <span className="font-medium">{formatDate(showDetail.pesee.date)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Tonnage pesé :</span>{' '}
                      <span className="font-medium">{formatTonnage(showDetail.pesee.tonnage)} t</span>
                    </div>
                    {showDetail.pesee.ecart != null && (
                      <div>
                        <span className="text-gray-500">Écart :</span>{' '}
                        <span className="font-medium">{formatTonnage(showDetail.pesee.ecart)} t</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Facture */}
              {showDetail.facture && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Facture</h3>
                  <div className="bg-teal-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">N° facture :</span>{' '}
                      <span className="font-medium">{showDetail.facture.numero || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Montant :</span>{' '}
                      <span className="font-medium">{formatPrice(showDetail.facture.montant)} €</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Date facture :</span>{' '}
                      <span className="font-medium">{formatDate(showDetail.facture.date)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowDetail(null)} className="flex-1 border rounded-lg py-2 text-sm">
                  Fermer
                </button>
                {STATUS_TRANSITIONS[showDetail.statut] && (
                  <button
                    onClick={() => handleStatusChange(showDetail, STATUS_TRANSITIONS[showDetail.statut].next)}
                    className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium"
                  >
                    {STATUS_TRANSITIONS[showDetail.statut].action}
                  </button>
                )}
                {!['cloturee', 'annulee'].includes(showDetail.statut) && (
                  <button
                    onClick={() => handleCancel(showDetail)}
                    className="border border-red-300 text-red-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50"
                  >
                    Annuler
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
