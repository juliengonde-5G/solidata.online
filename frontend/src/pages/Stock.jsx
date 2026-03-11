import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function Stock() {
  const [summary, setSummary] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState([]);
  const [activeTab, setActiveTab] = useState('stock');
  const [inventories, setInventories] = useState([]);
  const [selectedInv, setSelectedInv] = useState(null);
  const [invDetail, setInvDetail] = useState(null);
  const [form, setForm] = useState({
    categorie_sortante_id: '', type: 'entree', quantity_kg: '', source: '', notes: '',
  });

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (activeTab === 'inventaire') loadInventories(); }, [activeTab]);

  const loadData = async () => {
    try {
      const [sumRes, movRes, catRes] = await Promise.all([
        api.get('/stock/summary'),
        api.get('/stock?limit=100'),
        api.get('/tri/categories'),
      ]);
      setSummary(sumRes.data?.byCategory || sumRes.data || []);
      setMovements(movRes.data);
      setCategories(catRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadInventories = async () => {
    try {
      const res = await api.get('/stock/inventories');
      setInventories(res.data);
    } catch (err) { console.error(err); }
  };

  const createMovement = async (e) => {
    e.preventDefault();
    try {
      await api.post('/stock', {
        type: form.type,
        date: new Date().toISOString().split('T')[0],
        poids_kg: parseFloat(form.quantity_kg),
        matiere_id: form.categorie_sortante_id || null,
        destination: form.source || null,
        notes: form.notes || null,
      });
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
  };

  const createInventory = async (type) => {
    try {
      const res = await api.post('/stock/inventories', { type });
      loadInventories();
      openInventory(res.data.id);
    } catch (err) { console.error(err); }
  };

  const openInventory = async (id) => {
    try {
      const res = await api.get(`/stock/inventories/${id}`);
      setSelectedInv(id);
      setInvDetail(res.data);
    } catch (err) { console.error(err); }
  };

  const saveInventoryItems = async () => {
    if (!invDetail) return;
    try {
      await api.put(`/stock/inventories/${selectedInv}/items`, {
        items: invDetail.items.map(it => ({
          id: it.id,
          stock_physique_kg: it.stock_physique_kg,
          notes: it.notes,
        })),
      });
      openInventory(selectedInv);
      loadInventories();
    } catch (err) { console.error(err); }
  };

  const validateInventory = async () => {
    try {
      await api.post(`/stock/inventories/${selectedInv}/validate`);
      openInventory(selectedInv);
      loadInventories();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  const totalStock = summary.reduce((acc, s) => acc + (parseFloat(s.solde_kg || s.stock_kg) || 0), 0);

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Gestion des stocks</h1>
            <p className="text-gray-500">Stock total : {(totalStock / 1000).toFixed(1)} tonnes</p>
          </div>
          <div className="flex gap-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setActiveTab('stock')} className={`px-3 py-1.5 rounded-md text-sm ${activeTab === 'stock' ? 'bg-white shadow font-medium' : 'text-gray-500'}`}>Stock</button>
              <button onClick={() => setActiveTab('inventaire')} className={`px-3 py-1.5 rounded-md text-sm ${activeTab === 'inventaire' ? 'bg-white shadow font-medium' : 'text-gray-500'}`}>Inventaire</button>
            </div>
            {activeTab === 'stock' && (
              <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
                + Mouvement de stock
              </button>
            )}
          </div>
        </div>

        {activeTab === 'stock' && (
          <>
            {/* Summary by Category */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
              {summary.map(s => (
                <div key={s.categorie_id || s.categorie} className="bg-white rounded-xl shadow-sm border p-4">
                  <p className="text-xs text-gray-500 truncate">{s.categorie_nom || s.categorie}</p>
                  <p className="text-xl font-bold text-solidata-dark">{parseFloat(s.solde_kg || s.stock_kg || 0).toFixed(0)} <span className="text-xs font-normal text-gray-400">kg</span></p>
                  <div className="mt-1 h-1.5 bg-gray-100 rounded-full">
                    <div className="h-1.5 bg-solidata-green rounded-full" style={{ width: `${Math.min((parseFloat(s.solde_kg || s.stock_kg) / Math.max(totalStock, 1)) * 100 * 4, 100)}%` }}></div>
                  </div>
                </div>
              ))}
            </div>

            {/* Movements Table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="p-3 border-b bg-gray-50">
                <h3 className="font-semibold text-sm">Derniers mouvements</h3>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Catégorie</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Type</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Quantité (kg)</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Source</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map(m => (
                    <tr key={m.id} className="border-t hover:bg-gray-50">
                      <td className="p-3 text-sm">{new Date(m.date || m.created_at).toLocaleDateString('fr-FR')}</td>
                      <td className="p-3 text-sm">{m.matiere_categorie || m.categorie_nom || '—'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${m.type === 'entree' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {m.type === 'entree' ? 'Entrée' : 'Sortie'}
                        </span>
                      </td>
                      <td className="p-3 text-sm font-medium">{m.poids_kg || m.quantity_kg}</td>
                      <td className="p-3 text-sm text-gray-500">{m.origine || m.destination || '—'}</td>
                      <td className="p-3 text-sm text-gray-400 max-w-[200px] truncate">{m.notes || '—'}</td>
                    </tr>
                  ))}
                  {movements.length === 0 && (
                    <tr><td colSpan="6" className="p-8 text-center text-gray-400">Aucun mouvement de stock</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'inventaire' && (
          <div className="space-y-4">
            <div className="flex gap-2 mb-4">
              <button onClick={() => createInventory('partiel')} className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-solidata-green-dark">
                + Inventaire partiel
              </button>
              <button onClick={() => createInventory('complet')} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                + Inventaire complet
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Liste des inventaires */}
              <div className="space-y-2">
                {inventories.map(inv => (
                  <button key={inv.id} onClick={() => openInventory(inv.id)}
                    className={`w-full text-left p-3 rounded-lg border text-sm ${selectedInv === inv.id ? 'border-solidata-green bg-solidata-green/5' : 'bg-white hover:bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{inv.code}</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${inv.status === 'valide' ? 'bg-green-100 text-green-700' : inv.status === 'annule' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                        {inv.status === 'valide' ? 'Valide' : inv.status === 'annule' ? 'Annule' : 'En cours'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(inv.date).toLocaleDateString('fr-FR')} — {inv.type === 'complet' ? 'Complet' : 'Partiel'}
                      {inv.ecart_percent ? ` — Ecart: ${inv.ecart_percent > 0 ? '+' : ''}${inv.ecart_percent}%` : ''}
                    </p>
                  </button>
                ))}
                {inventories.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">Aucun inventaire. Creez-en un pour commencer.</p>
                )}
              </div>

              {/* Detail inventaire */}
              <div className="lg:col-span-2">
                {!invDetail ? (
                  <div className="bg-white rounded-xl border p-8 text-center text-gray-400">Selectionnez un inventaire</div>
                ) : (
                  <div className="bg-white rounded-xl border p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold">{invDetail.code}</h3>
                        <p className="text-xs text-gray-400">{new Date(invDetail.date).toLocaleDateString('fr-FR')} — {invDetail.type === 'complet' ? 'Inventaire complet' : 'Inventaire partiel'}</p>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        {invDetail.ecart_kg !== 0 && (
                          <span className={`font-bold ${invDetail.ecart_kg > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            Ecart: {invDetail.ecart_kg > 0 ? '+' : ''}{invDetail.ecart_kg?.toFixed(1)} kg ({invDetail.ecart_percent > 0 ? '+' : ''}{invDetail.ecart_percent}%)
                          </span>
                        )}
                      </div>
                    </div>

                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-2 text-xs font-semibold text-gray-500">Categorie</th>
                          <th className="text-right p-2 text-xs font-semibold text-gray-500">Theorique (kg)</th>
                          <th className="text-right p-2 text-xs font-semibold text-gray-500">Physique (kg)</th>
                          <th className="text-right p-2 text-xs font-semibold text-gray-500">Ecart</th>
                          <th className="text-left p-2 text-xs font-semibold text-gray-500">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invDetail.items?.map(item => (
                          <tr key={item.id} className="border-t">
                            <td className="p-2 text-sm">{item.categorie_nom}</td>
                            <td className="p-2 text-sm text-right text-gray-500">{parseFloat(item.stock_theorique_kg || 0).toFixed(1)}</td>
                            <td className="p-2">
                              {invDetail.status === 'en_cours' ? (
                                <input type="number" step="0.1" value={item.stock_physique_kg || ''}
                                  onChange={e => {
                                    const updated = invDetail.items.map(it =>
                                      it.id === item.id ? { ...it, stock_physique_kg: e.target.value } : it
                                    );
                                    setInvDetail({ ...invDetail, items: updated });
                                  }}
                                  className="w-24 border rounded px-2 py-1 text-sm text-right" />
                              ) : (
                                <span className="text-right block">{parseFloat(item.stock_physique_kg || 0).toFixed(1)}</span>
                              )}
                            </td>
                            <td className={`p-2 text-sm text-right font-medium ${(item.ecart_kg || 0) > 0 ? 'text-green-600' : (item.ecart_kg || 0) < 0 ? 'text-red-600' : ''}`}>
                              {item.ecart_kg ? `${item.ecart_kg > 0 ? '+' : ''}${parseFloat(item.ecart_kg).toFixed(1)}` : '—'}
                            </td>
                            <td className="p-2">
                              {invDetail.status === 'en_cours' ? (
                                <input value={item.notes || ''}
                                  onChange={e => {
                                    const updated = invDetail.items.map(it =>
                                      it.id === item.id ? { ...it, notes: e.target.value } : it
                                    );
                                    setInvDetail({ ...invDetail, items: updated });
                                  }}
                                  className="w-full border rounded px-2 py-1 text-sm" placeholder="Notes" />
                              ) : (
                                <span className="text-xs text-gray-400">{item.notes || '—'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {invDetail.status === 'en_cours' && (
                      <div className="flex gap-2 mt-4">
                        <button onClick={saveInventoryItems} className="flex-1 bg-solidata-green text-white py-2 rounded-lg text-sm font-medium hover:bg-solidata-green-dark">
                          Enregistrer les saisies
                        </button>
                        <button onClick={validateInventory} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                          Valider l'inventaire
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createMovement} className="bg-white rounded-xl p-6 w-[400px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Mouvement de stock</h2>
              <div className="space-y-3">
                <select value={form.categorie_sortante_id} onChange={e => setForm({ ...form, categorie_sortante_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">Catégorie *</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="entree">Entrée</option>
                  <option value="sortie">Sortie</option>
                </select>
                <input type="number" placeholder="Quantité (kg) *" value={form.quantity_kg} onChange={e => setForm({ ...form, quantity_kg: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows="2" />
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Enregistrer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
