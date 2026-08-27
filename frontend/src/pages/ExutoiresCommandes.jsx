import { useState, useEffect, useMemo } from 'react';
import {
  Inbox, Package, Truck, CheckCircle2,
  ArrowUpRight, Calendar, Building2,
  Repeat, Pause, Play, Sparkles, AlertTriangle,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, KanbanBoard, StatusBadge, ErrorState } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

// Map complet (incluant les anciens types) — utilisé UNIQUEMENT pour afficher
// le libellé d'une commande historique. Pour les nouvelles commandes, voir
// TYPES_PRODUIT_OPTIONS ci-dessous.
const TYPES_PRODUIT = {
  original: 'Original',
  csr: 'CSR',
  essuyage: 'Essuyage',
  tricot: 'Tricot',
  merinos: 'Mérinos',
  jean: 'Jean',
  coton_blanc: 'Coton Blanc',
  coton_couleur: 'Coton Couleur',
  // Anciens types — affichage historique uniquement
  effilo_blanc: 'Effilo Blanc (obsolète)',
  effilo_couleur: 'Effilo Couleur (obsolète)',
};
// Types proposés à la création/édition — sans les obsolètes
const TYPES_PRODUIT_OPTIONS = {
  original: 'Original',
  csr: 'CSR',
  essuyage: 'Essuyage',
  tricot: 'Tricot',
  merinos: 'Mérinos',
  jean: 'Jean',
  coton_blanc: 'Coton Blanc',
  coton_couleur: 'Coton Couleur',
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
const FREQUENCES = { unique: 'Unique', hebdomadaire: 'Hebdomadaire', bi_mensuel: 'Bi-mensuel (tous les 14 jours)', mensuel: 'Mensuel' };

// Un MODÈLE récurrent est la commande d'origine : fréquence répétée ET aucun
// parent. C'est un statut DÉRIVÉ — aucune colonne « est_modèle » en base, donc
// rien qui puisse se désynchroniser de la réalité.
const estModeleRecurrent = (cmd) => !!cmd && cmd.frequence && cmd.frequence !== 'unique' && !cmd.commande_parent_id;
const estOccurrenceGeneree = (cmd) => !!cmd && !!cmd.commande_parent_id;

const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Rythme de passage, DÉDUIT de la date de la commande d'origine — il n'est pas
 * saisi séparément : un « jour préféré » stocké à part pourrait contredire la
 * date réelle de la commande, et c'est elle qui pilote le calcul des échéances.
 */
function libelleRythme(frequence, dateCommande) {
  if (!frequence || frequence === 'unique' || !dateCommande) return null;
  const d = new Date(dateCommande);
  if (Number.isNaN(d.getTime())) return null;
  if (frequence === 'hebdomadaire') return `tous les ${JOURS_SEMAINE[d.getDay()]}`;
  if (frequence === 'bi_mensuel') return `tous les 14 jours, un ${JOURS_SEMAINE[d.getDay()]}`;
  if (frequence === 'mensuel') return `le ${d.getDate()} de chaque mois`;
  return null;
}

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

// Item 38b + résiduel v1-3 — Les passages confirmée → en_préparation → chargée →
// expédiée sont retirés des raccourcis directs de la fiche commande : c'est la page
// « Préparation d'expédition » qui pilote ce cycle (planification transporteur,
// chargement, pesée interne) et, à l'expédition, décrémente le stock (mouvement de
// sortie). Avancer le statut depuis la fiche sautait ce chemin et faisait « avancer »
// la commande sans jamais préparer ni sortir la marchandise. On grise donc ces actions
// avec une explication (le backend renvoie aussi un 409 sur le passage → expédiée sans
// préparation liée).
const STATUS_TRANSITIONS = {
  en_attente: { action: 'Confirmer', next: 'confirmee' },
  confirmee: {
    action: 'Préparer',
    blocked: true,
    hint: "La préparation se planifie depuis la page « Préparation d'expédition » (transporteur, chargement, pesée interne) — c'est elle qui fait avancer la commande.",
  },
  en_preparation: {
    action: 'Marquer chargée',
    blocked: true,
    hint: "Le chargement se suit depuis la page « Préparation d'expédition » — c'est elle qui fait avancer la commande.",
  },
  chargee: {
    action: 'Marquer expédiée',
    blocked: true,
    hint: "Pour expédier, passez par la Préparation d'expédition — c'est elle qui décrémente le stock.",
  },
  expediee: { action: 'Pesée reçue', next: 'pesee_recue' },
  pesee_recue: { action: 'Facturer', next: 'facturee' },
  facturee: { action: 'Clôturer', next: 'cloturee' },
};

export default function ExutoiresCommandes() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [commandes, setCommandes] = useState([]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({ actives: 0, tonnage_prevu: 0, ca_previsionnel: 0, en_attente: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Récurrence (lot L7)
  const [occurrences, setOccurrences] = useState(null);
  const [recurrenceBusy, setRecurrenceBusy] = useState(false);
  const [generation, setGeneration] = useState(null);   // aperçu ou bilan de génération
  const [generationErr, setGenerationErr] = useState('');

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
      const d = res.data || {};
      // Le backend renvoie total_tonnage_prevu / total_ca_prevu (en tonnes / €) ;
      // les cartes KPI lisent tonnage_prevu / ca_previsionnel. On aligne les noms
      // pour ne plus afficher « — ». actives / en_attente restent dérivés du kanban.
      setStats((prev) => ({
        ...prev,
        ...d,
        tonnage_prevu: d.total_tonnage_prevu ?? 0,
        ca_previsionnel: d.total_ca_prevu ?? 0,
      }));
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
      setLoadError(null);
    } catch (err) {
      console.error(err);
      setLoadError('Impossible de charger les commandes exutoires. Vérifiez votre connexion puis réessayez.');
    }
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
    setActionError('');
    setOccurrences(null);
    try {
      const res = await api.get(`/commandes-exutoires/${commande.id}`);
      setShowDetail(res.data);
      if (estModeleRecurrent(res.data)) loadOccurrences(res.data.id);
    } catch (err) {
      console.error(err);
      setShowDetail(commande);
    }
  };

  // ── Récurrence ────────────────────────────────────────────────────────────
  const loadOccurrences = async (commandeId) => {
    try {
      const res = await api.get(`/commandes-exutoires/${commandeId}/occurrences`);
      setOccurrences(res.data);
    } catch (err) {
      console.error(err);
      setActionError(err.response?.data?.error || "Impossible de charger les occurrences de cette commande récurrente.");
    }
  };

  const toggleRecurrence = async (commande, suspendre) => {
    setActionError('');
    setRecurrenceBusy(true);
    try {
      await api.patch(`/commandes-exutoires/${commande.id}/recurrence`, { recurrence_suspendue: suspendre });
      const res = await api.get(`/commandes-exutoires/${commande.id}`);
      setShowDetail(res.data);
      await loadOccurrences(commande.id);
      loadCommandes();
    } catch (err) {
      console.error(err);
      setActionError(err.response?.data?.error || (suspendre ? "La suspension a échoué." : "La reprise a échoué."));
    }
    setRecurrenceBusy(false);
  };

  /**
   * `simulation` = aperçu sans aucune écriture. On la propose systématiquement
   * avant l'application : générer des commandes et des créneaux de chargement
   * est une décision d'exploitation, pas un clic anodin.
   */
  const genererOccurrences = async (simulation) => {
    setGenerationErr('');
    setRecurrenceBusy(true);
    try {
      const res = await api.post(`/commandes-exutoires/recurrence/generer${simulation ? '?simulation=1' : ''}`);
      setGeneration({ ...res.data, simulation });
      if (!simulation) { loadCommandes(); loadStats(); }
    } catch (err) {
      console.error(err);
      setGenerationErr(err.response?.data?.error || "La génération des commandes récurrentes a échoué.");
    }
    setRecurrenceBusy(false);
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
    setActionError('');
    try {
      await api.patch(`/commandes-exutoires/${commande.id}/statut`, { statut: newStatut });
      loadCommandes();
      loadStats();
      if (showDetail && showDetail.id === commande.id) {
        const res = await api.get(`/commandes-exutoires/${commande.id}`);
        setShowDetail(res.data);
      }
    } catch (err) {
      console.error(err);
      setActionError(err.response?.data?.error || 'Le changement de statut a échoué.');
    }
  };

  const handleCancel = async (commande) => {
    const ok = await confirm({
      title: 'Annuler cette commande ?',
      message: `Confirmer l'annulation de la commande "${commande.reference}". Cette action ne peut pas être inversée.`,
      confirmLabel: 'Annuler la commande',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setActionError('');
    try {
      await api.patch(`/commandes-exutoires/${commande.id}/annuler`);
      loadCommandes();
      loadStats();
      if (showDetail && showDetail.id === commande.id) {
        setShowDetail(null);
      }
    } catch (err) {
      console.error(err);
      setActionError(err.response?.data?.error || "L'annulation a échoué.");
    }
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

  const statutFilters = [
    { key: '', label: 'Toutes', count: totalActive },
    ...Object.entries(STATUTS).map(([k, v]) => ({
      key: k,
      label: v.label,
      count: commandes.filter((c) => c.statut === k).length,
    })),
  ];

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
        {/* Récurrence : le modèle et ses occurrences ne se lisent pas de la même
            façon. Le badge dit LEQUEL des deux on regarde. */}
        {estModeleRecurrent(cmd) && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
            <Repeat className="w-3 h-3" />
            Modèle récurrent · {FREQUENCES[cmd.frequence] || cmd.frequence}
            {cmd.recurrence_suspendue ? ' (suspendu)' : ''}
          </span>
        )}
        {estOccurrenceGeneree(cmd) && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
            <Sparkles className="w-3 h-3" />
            Générée automatiquement{cmd.reference_parent ? ` · ${cmd.reference_parent}` : ''}
          </span>
        )}
        {/* Créneau de chargement non posé : le moteur a refusé (aucun gabarit
            de préparation, ou créneau occupé) et a laissé la commande en
            attente. Sans ce badge, elle est indiscernable d'une commande en
            attente ordinaire — c'est exactement ce qui la faisait passer
            inaperçue semaine après semaine. */}
        {cmd.creneau_a_poser === true && (
          <span
            className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
            title="Aucune préparation d'expédition n'est rattachée à cette commande : le créneau de chargement reste à poser à la main."
          >
            <AlertTriangle className="w-3 h-3" />
            Créneau de chargement à poser
          </span>
        )}
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
      {ConfirmDialogElement}
      {loadError && (
        <div className="px-6 pt-4">
          <ErrorState variant="card" title="Commandes indisponibles" message={loadError} onRetry={loadCommandes} />
        </div>
      )}
      <KanbanBoard
        title="Commandes Logistiques"
        subtitle="Pipeline des commandes clients → expéditions"
        headerActions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => genererOccurrences(true)}
              disabled={recurrenceBusy}
              title="Voir les commandes que la récurrence créerait, sans rien enregistrer"
              className="btn-ghost text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <Repeat className="w-4 h-4" />
              Commandes récurrentes
            </button>
            <button onClick={openCreate} className="btn-primary text-sm flex items-center gap-1.5">
              <ArrowUpRight className="w-4 h-4" />
              Nouvelle commande
            </button>
          </div>
        }
        kpis={kpiList}
        search={{
          value: filterSearch,
          onChange: setFilterSearch,
          placeholder: 'Rechercher par client, référence…',
        }}
        extraTopBar={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Statut :</span>
              {statutFilters.map((s) => (
                <button
                  key={s.key || 'all'}
                  onClick={() => setFilterStatut(s.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    (filterStatut || '') === s.key
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {s.label}
                  {s.count != null && <span className="ml-1 opacity-70">({s.count})</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Type :</span>
              <select
                value={filterType || ''}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <option value="">Tous les types</option>
                {Object.entries(TYPES_PRODUIT_OPTIONS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        }
        columns={boardColumns}
        itemsByColumn={itemsByColumn}
        renderCard={renderCommandeCard}
        onCardClick={(cmd) => openDetail(cmd)}
        emptyState={
          (itemsByColumn._annulees?.length || 0) > 0 ? (
            <div className="text-xs text-slate-500 text-center">
              {itemsByColumn._annulees.length} commande(s) annulée(s).
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
                  {Object.entries(TYPES_PRODUIT_OPTIONS).map(([k, v]) => (
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
                <>
                  {/* Le jour de passage n'est pas un champ à part : il DÉCOULE de
                      la date de commande ci-dessus. Un « jour préféré » saisi
                      séparément pourrait la contredire, et c'est bien la date de
                      commande qui pilote le calcul des échéances. */}
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800">
                    <p className="font-semibold flex items-center gap-1.5">
                      <Repeat className="w-3.5 h-3.5" />
                      Commande récurrente
                    </p>
                    <p className="mt-1">
                      {libelleRythme(form.frequence, form.date_commande)
                        ? <>Passage <strong>{libelleRythme(form.frequence, form.date_commande)}</strong>, déduit de la date de commande.
                          Pour changer de jour, modifiez la date de commande.</>
                        : <>Renseignez la date de commande ci-dessus : c'est elle qui fixe le jour de passage.</>}
                    </p>
                    <p className="mt-1">
                      Les commandes suivantes et leur créneau de chargement sont créés automatiquement.
                      Une préparation n'est posée que si un transporteur et un lieu ont déjà été saisis
                      sur cette commande et que le créneau est libre — rien n'est deviné.
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Date fin de récurrence <span className="text-gray-400">(facultatif — sans fin si vide)</span></label>
                    <input
                      type="date"
                      value={form.date_fin_recurrence}
                      onChange={e => setForm({ ...form, date_fin_recurrence: e.target.value })}
                      className="input-modern mt-1"
                    />
                  </div>
                </>
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

        {/* Génération des commandes récurrentes — aperçu PUIS application */}
        <Modal
          isOpen={!!generation || !!generationErr}
          onClose={() => { setGeneration(null); setGenerationErr(''); }}
          title="Commandes récurrentes"
          size="lg"
        >
          {generationErr && (
            <div className="mb-4">
              <ErrorState variant="card" title="Génération impossible" message={generationErr} />
            </div>
          )}
          {generation && (
            <>
              <div className={`rounded-lg p-3 text-sm mb-4 border ${generation.simulation ? 'bg-slate-50 border-slate-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <p className="font-semibold">
                  {generation.simulation ? 'Aperçu — rien n\'a été enregistré' : 'Commandes créées'}
                </p>
                <p className="mt-1 text-gray-700">
                  {generation.modeles_examines} commande(s) récurrente(s) examinée(s) sur un horizon de{' '}
                  {generation.horizon_jours} jours.{' '}
                  <strong>{generation.generees?.length || 0}</strong>{' '}
                  {generation.simulation ? 'commande(s) seraient créées' : 'commande(s) créée(s)'},{' '}
                  <strong>{generation.preparations?.length || 0}</strong> créneau(x) de chargement positionné(s).
                </p>
              </div>

              {(generation.generees?.length || 0) === 0 && (generation.ignorees?.length || 0) === 0 && (
                <p className="text-sm text-gray-600">
                  Rien à générer : aucune commande récurrente active n'a d'échéance dans l'horizon,
                  ou tout est déjà créé.
                </p>
              )}

              {(generation.generees?.length || 0) > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">
                    {generation.simulation ? 'Seraient créées' : 'Créées'}
                  </h3>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 pr-2 font-medium">Date</th>
                          <th className="py-1 pr-2 font-medium">Référence</th>
                          <th className="py-1 font-medium">Commande d'origine</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generation.generees.map((g, i) => (
                          <tr key={`${g.parent_id}-${g.date_commande}-${i}`} className="border-t border-slate-100">
                            <td className="py-1 pr-2">{formatDate(g.date_commande)}</td>
                            <td className="py-1 pr-2 font-mono">{g.reference}</td>
                            <td className="py-1 font-mono text-gray-500">{g.reference_parent || `#${g.parent_id}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Ce qui n'a PAS été fait est dit, avec son motif — jamais escamoté. */}
              {(generation.ignorees?.length || 0) > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Non générées — motif</h3>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <table className="w-full text-xs">
                      <tbody>
                        {generation.ignorees.map((ig, i) => (
                          <tr key={i} className="border-t border-amber-100 first:border-0">
                            <td className="py-1 pr-2 whitespace-nowrap">{ig.date ? formatDate(ig.date) : '—'}</td>
                            <td className="py-1 pr-2 font-mono text-gray-500 whitespace-nowrap">{ig.reference_parent || `#${ig.parent_id}`}</td>
                            <td className="py-1 text-amber-900">{ig.motif}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => { setGeneration(null); setGenerationErr(''); }}
                  className="flex-1 btn-ghost"
                >
                  Fermer
                </button>
                {generation.simulation && (generation.generees?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => genererOccurrences(false)}
                    disabled={recurrenceBusy}
                    className="flex-1 btn-primary text-sm disabled:opacity-50"
                  >
                    Créer ces {generation.generees.length} commande(s)
                  </button>
                )}
              </div>
            </>
          )}
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

              {/* ── Occurrence générée : d'où elle vient ─────────────────── */}
              {estOccurrenceGeneree(showDetail) && (
                <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-semibold text-sky-800">
                    <Sparkles className="w-4 h-4" />
                    Commande générée automatiquement
                  </p>
                  <p className="text-sky-700 mt-1">
                    Issue de la commande récurrente{' '}
                    <span className="font-mono font-semibold">{showDetail.reference_parent || `#${showDetail.commande_parent_id}`}</span>.
                    Pour arrêter les prochaines, ouvrez la commande d'origine et suspendez sa récurrence — annuler
                    celle-ci ne suspend rien.
                  </p>
                </div>
              )}

              {/* ── Modèle récurrent : pilotage ───────────────────────────── */}
              {estModeleRecurrent(showDetail) && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                    <Repeat className="w-4 h-4 text-violet-600" />
                    Récurrence
                  </h3>
                  <div className={`rounded-lg p-3 text-sm border ${showDetail.recurrence_suspendue ? 'bg-amber-50 border-amber-200' : 'bg-violet-50 border-violet-200'}`}>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-gray-500">Rythme :</span>{' '}
                        <span className="font-medium">
                          {FREQUENCES[showDetail.frequence] || showDetail.frequence}
                          {libelleRythme(showDetail.frequence, showDetail.date_commande)
                            && ` — ${libelleRythme(showDetail.frequence, showDetail.date_commande)}`}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Prochaine échéance :</span>{' '}
                        {/* Jamais de date inventée : tant que la génération n'a
                            pas tourné, on dit qu'on ne sait pas encore. */}
                        <span className="font-medium">
                          {occurrences?.motif_indisponible
                            ? <span className="text-amber-700">indisponible ({occurrences.motif_indisponible})</span>
                            : occurrences?.prochaine_echeance
                              ? formatDate(occurrences.prochaine_echeance)
                              : <span className="text-gray-500 italic">non encore calculée</span>}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-gray-500">État :</span>{' '}
                        <span className="font-medium">
                          {showDetail.recurrence_suspendue
                            ? 'Suspendue — aucune nouvelle commande ne sera créée'
                            : 'Active — les prochaines commandes sont créées automatiquement'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {showDetail.recurrence_suspendue ? (
                        <button
                          onClick={() => toggleRecurrence(showDetail, false)}
                          disabled={recurrenceBusy}
                          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5" /> Reprendre la récurrence
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleRecurrence(showDetail, true)}
                          disabled={recurrenceBusy}
                          className="btn-ghost text-xs flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Pause className="w-3.5 h-3.5" /> Suspendre la récurrence
                        </button>
                      )}
                    </div>

                    <div className="mt-3 border-t border-violet-200 pt-2">
                      <p className="text-xs font-semibold text-gray-600 mb-1">
                        Commandes déjà générées{occurrences ? ` (${occurrences.occurrences.length})` : ''}
                      </p>
                      {!occurrences && <p className="text-xs text-gray-500">Chargement…</p>}
                      {occurrences && occurrences.occurrences.length === 0 && (
                        <p className="text-xs text-gray-500 italic">Aucune commande générée pour l'instant.</p>
                      )}
                      {occurrences && occurrences.occurrences.length > 0 && (
                        <div className="max-h-48 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-500">
                                <th className="py-1 pr-2 font-medium">Référence</th>
                                <th className="py-1 pr-2 font-medium">Date</th>
                                <th className="py-1 pr-2 font-medium">Statut</th>
                                <th className="py-1 font-medium">Expédition</th>
                              </tr>
                            </thead>
                            <tbody>
                              {occurrences.occurrences.map((o) => (
                                <tr key={o.id} className="border-t border-violet-100">
                                  <td className="py-1 pr-2 font-mono">{o.reference}</td>
                                  <td className="py-1 pr-2">{formatDate(o.date_commande)}</td>
                                  <td className="py-1 pr-2">{STATUTS[o.statut]?.label || o.statut}</td>
                                  <td className="py-1">
                                    {o.date_expedition
                                      ? formatDate(o.date_expedition)
                                      : <span className="text-gray-400 italic">pas de préparation</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Préparation d'expédition (préparations_expedition) — v1-3 : champs réels de l'API */}
              {showDetail.preparation && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Préparation d'expédition</h3>
                  <div className="bg-yellow-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
                    {showDetail.preparation.transporteur && (
                      <div>
                        <span className="text-gray-500">Transporteur :</span>{' '}
                        <span className="font-medium">{showDetail.preparation.transporteur}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Date d'expédition :</span>{' '}
                      <span className="font-medium">{formatDate(showDetail.preparation.date_expedition)}</span>
                    </div>
                    {showDetail.preparation.pesee_interne != null && (
                      <div>
                        <span className="text-gray-500">Pesée interne :</span>{' '}
                        <span className="font-medium">{formatTonnage(showDetail.preparation.pesee_interne)} t</span>
                      </div>
                    )}
                    {showDetail.preparation.statut_preparation && (
                      <div>
                        <span className="text-gray-500">Statut préparation :</span>{' '}
                        <span className="font-medium">{({ planifiee: 'Planifiée', remorque_livree: 'Remorque livrée', en_chargement: 'En chargement', prete: 'Prête', expediee: 'Expédiée' }[showDetail.preparation.statut_preparation]) || showDetail.preparation.statut_preparation}</span>
                      </div>
                    )}
                    {showDetail.preparation.notes_preparation && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Notes :</span>{' '}
                        <span className="font-medium">{showDetail.preparation.notes_preparation}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Contrôle pesée client (controles_pesee) — v1-3 : clé controle_pesee + champs réels */}
              {showDetail.controle_pesee && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Contrôle pesée</h3>
                  <div className="bg-indigo-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Réception ticket :</span>{' '}
                      <span className="font-medium">{formatDate(showDetail.controle_pesee.date_reception_ticket)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Pesée client :</span>{' '}
                      <span className="font-medium">{formatTonnage(showDetail.controle_pesee.pesee_client)} t</span>
                    </div>
                    {showDetail.controle_pesee.pesee_interne != null && (
                      <div>
                        <span className="text-gray-500">Pesée interne :</span>{' '}
                        <span className="font-medium">{formatTonnage(showDetail.controle_pesee.pesee_interne)} t</span>
                      </div>
                    )}
                    {showDetail.controle_pesee.ecart_pesee != null && (
                      <div>
                        <span className="text-gray-500">Écart :</span>{' '}
                        <span className="font-medium">
                          {formatTonnage(showDetail.controle_pesee.ecart_pesee)} t
                          {showDetail.controle_pesee.ecart_pourcentage != null && ` (${parseFloat(showDetail.controle_pesee.ecart_pourcentage).toFixed(1)} %)`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Facture (factures_exutoires — factures Pennylane rapprochées, ou OCR historique) */}
              {showDetail.facture && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">Facture</h3>
                  <div className="bg-teal-50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
                    {(showDetail.facture.pennylane_invoice_number || showDetail.facture.pennylane_external_reference) && (
                      <div>
                        <span className="text-gray-500">N° facture :</span>{' '}
                        <span className="font-medium">{showDetail.facture.pennylane_invoice_number || showDetail.facture.pennylane_external_reference}</span>
                      </div>
                    )}
                    {(() => {
                      const montant = showDetail.facture.montant_ttc ?? showDetail.facture.montant_ht ?? showDetail.facture.ocr_montant;
                      if (montant == null) return null;
                      const suffixe = showDetail.facture.montant_ttc != null ? ' TTC' : showDetail.facture.montant_ht != null ? ' HT' : '';
                      return (
                        <div>
                          <span className="text-gray-500">Montant :</span>{' '}
                          <span className="font-medium">{formatPrice(montant)} €{suffixe}</span>
                        </div>
                      );
                    })()}
                    {(showDetail.facture.date_facture || showDetail.facture.ocr_date) && (
                      <div>
                        <span className="text-gray-500">Date facture :</span>{' '}
                        <span className="font-medium">{formatDate(showDetail.facture.date_facture || showDetail.facture.ocr_date)}</span>
                      </div>
                    )}
                    {showDetail.facture.ecart_montant != null && (
                      <div>
                        <span className="text-gray-500">Écart montant :</span>{' '}
                        <span className="font-medium">{formatPrice(showDetail.facture.ecart_montant)} €</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {actionError && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </div>
              )}
              {STATUS_TRANSITIONS[showDetail.statut]?.blocked && (
                <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  {STATUS_TRANSITIONS[showDetail.statut].hint}
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowDetail(null)} className="flex-1 btn-ghost">
                  Fermer
                </button>
                {STATUS_TRANSITIONS[showDetail.statut] && (
                  STATUS_TRANSITIONS[showDetail.statut].blocked ? (
                    <button
                      type="button"
                      disabled
                      title={STATUS_TRANSITIONS[showDetail.statut].hint}
                      className="flex-1 bg-slate-100 text-slate-400 rounded-lg px-4 py-2 text-sm font-medium cursor-not-allowed"
                    >
                      {STATUS_TRANSITIONS[showDetail.statut].action}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStatusChange(showDetail, STATUS_TRANSITIONS[showDetail.statut].next)}
                      className="flex-1 btn-primary text-sm"
                    >
                      {STATUS_TRANSITIONS[showDetail.statut].action}
                    </button>
                  )
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
