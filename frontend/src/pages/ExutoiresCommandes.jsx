import { useState, useEffect, useMemo } from 'react';
import {
  ShoppingCart, Inbox, Package, Truck, CheckCircle2,
  ArrowUpRight, Calendar, Tag as TagIcon, Building2,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, KanbanBoard, StatusBadge } from '../components';
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

// Regroupement des 9 statuts de workflow en 4 colonnes kanban
// (mirror du visuel ticket board Open/Pending/Resolved/Closed).
const KANBAN_COLUMNS = [
  {
    key: 'nouveau',
    label: 'Nouvelles',
    icon: Inbox,
    accent: 'bg-slate-400',
    statuts: ['en_attente'],
  },
  {
    key: 'en_cours',
    label: 'En préparation',
    icon: Package,
    accent: 'bg-amber-500',
    statuts: ['confirmee', 'en_preparation', 'chargee'],
  },
  {
    key: 'expedie',
    label: 'Expédiées',
    icon: Truck,
    accent: 'bg-indigo-500',
    statuts: ['expediee', 'pesee_recue'],
  },
  {
    key: 'termine',
    label: 'Terminées',
    icon: CheckCircle2,
    accent: 'bg-emerald-500',
    statuts: ['facturee', 'cloturee'],
  },
];

// Index inversé : statut → colonne kanban
const STATUT_TO_COLUMN = KANBAN_COLUMNS.reduce((acc, col) => {
  col.statuts.forEach((s) => { acc[s] = col.key; });
  return acc;
}, {});

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

  // Regroupement des commandes filtrées par colonne kanban
  const itemsByColumn = useMemo(() => {
    const out = Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.key, []]));
    out._annulees = [];
    for (const cmd of commandes) {
      if (cmd.statut === 'annulee') { out._annulees.push(cmd); continue; }
      const colKey = STATUT_TO_COLUMN[cmd.statut];
      if (colKey && out[colKey]) out[colKey].push(cmd);
    }
    return out;
  }, [commandes]);

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des commandes..." /></Layout>;

  // KPIs en haut du kanban
  const totalActive = KANBAN_COLUMNS.reduce((acc, c) => acc + (itemsByColumn[c.key]?.length || 0), 0);
  const kpiList = [
    {
      key: 'total',
      label: 'Commandes actives',
      value: stats.actives || totalActive,
      accent: 'slate',
      delta: stats.actives_delta != null ? {
        direction: stats.actives_delta >= 0 ? 'up' : 'down',
        value: `${Math.abs(stats.actives_delta)}%`,
        text: 'vs mois dernier',
      } : null,
    },
    {
      key: 'tonnage',
      label: 'Tonnage prévu',
      value: formatTonnage(stats.tonnage_prevu),
      unit: 't',
      accent: 'blue',
    },
    {
      key: 'ca',
      label: 'CA prévisionnel',
      value: formatPrice(stats.ca_previsionnel),
      unit: '€',
      accent: 'green',
    },
    {
      key: 'en_attente',
      label: 'En attente',
      value: stats.en_attente || (itemsByColumn.nouveau?.length ?? 0),
      accent: 'orange',
    },
  ];

  // Sidebar : vue par statut réel + filtres type de produit
  const sidebar = {
    views: {
      title: 'Vues',
      active: filterStatut || 'all',
      onSelect: (k) => setFilterStatut(k === 'all' ? '' : k),
      items: [
        { key: 'all', label: 'Toutes', icon: ShoppingCart, count: totalActive },
        ...Object.entries(STATUTS).map(([k, v]) => ({
          key: k,
          label: v.label,
          count: commandes.filter((c) => c.statut === k).length,
        })),
      ],
    },
    categories: {
      title: 'Type de produit',
      active: filterType || 'all',
      onSelect: (k) => setFilterType(k === 'all' ? '' : k),
      items: [
        { key: 'all', label: 'Tous les types', icon: TagIcon },
        ...Object.entries(TYPES_PRODUIT).map(([k, v]) => ({ key: k, label: v, icon: TagIcon })),
      ],
    },
  };

  // Colonnes passées à KanbanBoard
  const boardColumns = KANBAN_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    accent: c.accent,
    onAdd: c.key === 'nouveau' ? () => openCreate() : null,
  }));

  // Rendu d'une carte de commande (format ticket board)
  const renderCommandeCard = (cmd) => {
    const statusInfo = STATUTS[cmd.statut] || {};
    const clientName = cmd.client_nom || getClientName(cmd.client_id);
    const types = Array.isArray(cmd.type_produit) ? cmd.type_produit : (cmd.type_produit ? [cmd.type_produit] : []);
    const statusColorClass = statusInfo.color || 'bg-slate-100 text-slate-700';
    return (
      <div>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase">
            {cmd.reference || `#${String(cmd.id).padStart(4, '0')}`}
          </span>
          <div className="flex items-center gap-1 text-slate-400">
            <Calendar className="w-3 h-3" />
            <span className="text-[10px]">{formatDate(cmd.date_commande)}</span>
          </div>
        </div>
        <p className="font-medium text-sm text-slate-800 leading-tight line-clamp-2">
          <Building2 className="w-3.5 h-3.5 text-slate-400 inline mr-1 -mt-0.5" />
          {clientName}
        </p>
        {types.length > 0 && (
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            {types.map((t) => TYPES_PRODUIT[t] || t).join(' · ')}
          </p>
        )}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 uppercase">Tonnage</span>
            <span className="text-xs font-semibold text-slate-700 font-mono">
              {formatTonnage(cmd.tonnage_prevu)}<span className="text-slate-400 font-normal"> t</span>
            </span>
          </div>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColorClass}`}>
            {statusInfo.label || cmd.statut}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <KanbanBoard
        title="Commandes Logistiques"
        subtitle="Pipeline des commandes clients → expéditions"
        headerActions={
          <button onClick={openCreate} className="btn-primary text-sm flex items-center gap-1.5">
            <ArrowUpRight className="w-4 h-4" />
            Nouvelle commande
          </button>
        }
        kpis={kpiList}
        sidebar={sidebar}
        search={{
          value: filterSearch,
          onChange: setFilterSearch,
          placeholder: 'Rechercher par client, référence…',
        }}
        columns={boardColumns}
        itemsByColumn={itemsByColumn}
        renderCard={renderCommandeCard}
        onCardClick={(cmd) => openDetail(cmd)}
        emptyState={
          (itemsByColumn._annulees?.length || 0) > 0 ? (
            <div className="text-xs text-slate-500 text-center">
              {itemsByColumn._annulees.length} commande(s) annulée(s) — filtrable via la sidebar.
            </div>
          ) : null
        }
      />
      <div className="p-0">
        {/* Modals conservés à l'identique */}
        {/* Create/Edit modal form */}
        <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Modifier la commande' : 'Nouvelle commande logistique'} size="md">
          <form onSubmit={handleSubmit}>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Client *</label>
                <select
                  value={form.client_id}
                  onChange={e => handleClientChange(e.target.value)}
                  className="select-modern mt-1"
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
                    <label key={k} className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${form.type_produit.includes(k) ? 'bg-primary/10 border-primary' : 'hover:bg-gray-50'}`}>
                      <input
                        type="checkbox"
                        checked={form.type_produit.includes(k)}
                        onChange={() => handleTypeToggle(k)}
                        className="accent-primary"
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
                  className="input-modern mt-1"
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
                  className="input-modern mt-1"
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
                  className="input-modern mt-1"
                  placeholder="0.000"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Fréquence *</label>
                <select
                  value={form.frequence}
                  onChange={e => setForm({ ...form, frequence: e.target.value })}
                  className="select-modern mt-1"
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
                    className="input-modern mt-1"
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="textarea-modern mt-1"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 btn-ghost">
                Annuler
              </button>
              <button type="submit" className="flex-1 btn-primary text-sm">
                {editing ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Detail modal */}
        <Modal isOpen={!!showDetail} onClose={() => setShowDetail(null)} title={showDetail ? `Commande ${showDetail.reference || `#${showDetail.id}`}` : ''} size="lg">
          {showDetail && (
            <>
              <div className="flex justify-end -mt-2 mb-4">
                <StatusBadge status={showDetail.statut} label={STATUTS[showDetail.statut]?.label} />
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
                <button onClick={() => setShowDetail(null)} className="flex-1 btn-ghost">
                  Fermer
                </button>
                {STATUS_TRANSITIONS[showDetail.statut] && (
                  <button
                    onClick={() => handleStatusChange(showDetail, STATUS_TRANSITIONS[showDetail.statut].next)}
                    className="flex-1 btn-primary text-sm"
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
            </>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
