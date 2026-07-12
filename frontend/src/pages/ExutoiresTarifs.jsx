import { useState, useEffect } from 'react';
import { Plus, Tag } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, Modal, PageHeader } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

// Item 38a — Nomenclature alignée sur le backend (tarifs-exutoires.js
// TYPES_PRODUIT_VALIDES) et sur le CHECK SQL de tarifs_exutoires (init-db.js).
// TYPES_PRODUIT = libellés de TOUS les types (affichage/lecture, y compris les
// types historiques effilo_*). TYPES_PRODUIT_CREABLES = gammes actives proposées
// à la création/édition (les effilo_* restent lisibles/éditables mais ne sont
// plus proposés à la création, comme côté backend).
const TYPES_PRODUIT = {
  original: 'Original',
  csr: 'CSR',
  essuyage: 'Essuyage',
  tricot: 'Tricot',
  merinos: 'Mérinos',
  jean: 'Jean',
  coton_blanc: 'Coton Blanc',
  coton_couleur: 'Coton Couleur',
  // Types historiques — affichage/édition uniquement (plus proposés à la création)
  effilo_blanc: 'Effilo Blanc (obsolète)',
  effilo_couleur: 'Effilo Couleur (obsolète)'
};

const TYPES_PRODUIT_CREABLES = ['original', 'csr', 'essuyage', 'tricot', 'merinos', 'jean', 'coton_blanc', 'coton_couleur'];

const TYPE_COLORS = {
  original: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' },
  csr: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-800' },
  essuyage: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800' },
  tricot: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', badge: 'bg-cyan-100 text-cyan-800' },
  merinos: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800' },
  jean: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-800' },
  coton_blanc: { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-700', badge: 'bg-teal-100 text-teal-800' },
  coton_couleur: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', badge: 'bg-pink-100 text-pink-800' },
  effilo_blanc: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800' },
  effilo_couleur: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800' }
};

export default function ExutoiresTarifs() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [tarifs, setTarifs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState('');
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
    setFormError('');
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (tarif) => {
    setEditing(tarif);
    setFormError('');
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
    setFormError('');
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
    } catch (err) {
      console.error(err);
      setFormError(err.response?.data?.error || 'Enregistrement du tarif impossible. Vérifiez les champs et réessayez.');
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Supprimer ce tarif ?',
      message: 'Cette action est définitive.',
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/tarifs-exutoires/${id}`);
      loadData();
    } catch (err) { console.error(err); }
  };

  const prixReference = tarifs.filter(t => !t.client_id);
  const prixNegocies = tarifs.filter(t => t.client_id);

  // Cartes de prix de référence : gammes actives + tout type historique qui a
  // déjà un tarif de référence (ne pas masquer les anciens tarifs effilo_*).
  const referenceCardTypes = [
    ...TYPES_PRODUIT_CREABLES,
    ...prixReference.map(t => t.type_produit).filter(t => !TYPES_PRODUIT_CREABLES.includes(t)),
  ].filter((t, i, arr) => arr.indexOf(t) === i);

  // Options du menu déroulant : gammes actives + (si on édite un tarif d'un type
  // historique) ce type, pour permettre sa relecture/édition sans le reproposer
  // aux nouveaux tarifs.
  const typeOptions = [
    ...TYPES_PRODUIT_CREABLES,
    ...(form.type_produit && !TYPES_PRODUIT_CREABLES.includes(form.type_produit) ? [form.type_produit] : []),
  ];

  const getClientName = (clientId) => {
    const c = clients.find(cl => cl.id === clientId);
    return c ? c.raison_sociale : `Client #${clientId}`;
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des tarifs..." /></Layout>;

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="p-6">
        {/* Header */}
        <PageHeader
          title="Grille Tarifaire Logistique"
          subtitle="Gestion des prix de référence et négociés"
          icon={Tag}
          actions={
            <button onClick={openCreate} className="btn-primary text-sm">
              <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
              Nouveau tarif
            </button>
          }
        />

        {/* Prix de référence */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Prix de référence</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {referenceCardTypes.map(type => {
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
                      <div className="text-xs text-slate-500 mt-2">
                        Depuis le {new Date(tarif.date_debut).toLocaleDateString('fr-FR')}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-400 italic">Non défini</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Prix négociés par client */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Prix négociés par client</h2>
          {(() => {
            const prixNegociesColumns = [
              { key: 'client_id', label: 'Client', sortable: true, render: (t) => (
                <span className="font-medium">{getClientName(t.client_id)}</span>
              )},
              { key: 'type_produit', label: 'Type produit', sortable: true, render: (t) => {
                const colors = TYPE_COLORS[t.type_produit] || {};
                return <span className={`text-xs font-semibold px-2 py-1 rounded-full ${colors.badge}`}>{TYPES_PRODUIT[t.type_produit] || t.type_produit}</span>;
              }},
              { key: 'prix_reference_tonne', label: 'Prix (€/t)', align: 'right', sortable: true, render: (t) => (
                <span className="font-mono font-medium">{parseFloat(t.prix_reference_tonne).toFixed(2)}</span>
              )},
              { key: 'date_debut', label: 'Date début', sortable: true, render: (t) => (
                <span className="text-slate-600">{new Date(t.date_debut).toLocaleDateString('fr-FR')}</span>
              )},
              { key: 'date_fin', label: 'Date fin', render: (t) => (
                <span className="text-slate-600">{t.date_fin ? new Date(t.date_fin).toLocaleDateString('fr-FR') : '—'}</span>
              )},
              { key: 'actions', label: 'Actions', align: 'right', render: (t) => (
                <>
                  <button onClick={() => openEdit(t)} className="text-primary hover:underline text-sm mr-3">Modifier</button>
                  <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:underline text-sm">Supprimer</button>
                </>
              )},
            ];
            return (
              <DataTable
                columns={prixNegociesColumns}
                data={prixNegocies}
                loading={false}
                emptyIcon={Tag}
                emptyMessage="Aucun prix négocié"
              />
            );
          })()}
        </div>

        {/* Modal */}
        <Modal isOpen={showModal} onClose={() => { setShowModal(false); resetForm(); }} title={editing ? 'Modifier le tarif' : 'Nouveau tarif'} size="sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type de produit</label>
              <select
                value={form.type_produit}
                onChange={e => setForm({ ...form, type_produit: e.target.value })}
                required
                className="input-modern"
              >
                <option value="">Sélectionner...</option>
                {typeOptions.map((key) => (
                  <option key={key} value={key}>{TYPES_PRODUIT[key] || key}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Prix (€/tonne)</label>
              <input
                type="number"
                step="0.01"
                value={form.prix_reference_tonne}
                onChange={e => setForm({ ...form, prix_reference_tonne: e.target.value })}
                required
                className="input-modern"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client</label>
              <select
                value={form.client_id}
                onChange={e => setForm({ ...form, client_id: e.target.value })}
                className="input-modern"
              >
                <option value="">Prix de référence (aucun client)</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.raison_sociale}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date début</label>
              <input
                type="date"
                value={form.date_debut}
                onChange={e => setForm({ ...form, date_debut: e.target.value })}
                required
                className="input-modern"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date fin <span className="text-slate-400">(optionnel)</span></label>
              <input
                type="date"
                value={form.date_fin}
                onChange={e => setForm({ ...form, date_fin: e.target.value })}
                className="input-modern"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowModal(false); resetForm(); }}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="btn-primary text-sm"
              >
                {editing ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
