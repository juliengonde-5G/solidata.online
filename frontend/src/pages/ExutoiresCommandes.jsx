import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight, Calendar, Building2, Store,
  Repeat, Pause, Play, Sparkles, AlertTriangle, History,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, KanbanBoard, StatusBadge, ErrorState, useToast } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';
import PreparationExutoire from '../components/logistique/PreparationExutoire';
import FicheCommandeBoutique from '../components/logistique/FicheCommandeBoutique';
import {
  COLONNES, colonneDe, depuisExutoire, depuisBoutique, actionDeplacement,
  estAncienneTerminee, libelleStatut, STATUTS_PREPARATION,
} from '../utils/logistique-commandes';

/**
 * SUIVI DES COMMANDES — UN SEUL tableau pour la logistique (2.59.0).
 *
 * Les commandes des exutoires ET celles des boutiques s'y suivent ensemble,
 * colonne par colonne ; une carte se fait avancer par glisser-déposer (même
 * principe que le recrutement) et tout le reste se gère dans la fiche de la
 * commande, selon son statut — préparation et chargement compris (la page
 * « Préparation » est retirée). Les règles de déplacement vivent dans
 * utils/logistique-commandes.js.
 */

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

// Actions de statut directes de la fiche exutoire. Les étapes confirmée →
// en préparation → chargée → expédiée ne sont PAS ici : elles passent par la
// section « Préparation & chargement » de la fiche (c'est elle qui planifie le
// chargement et, à l'expédition, sort la marchandise du stock).
const STATUS_TRANSITIONS = {
  en_attente: { action: 'Confirmer', next: 'confirmee' },
  expediee: { action: 'Pesée client reçue', next: 'pesee_recue' },
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

  // Suivi unifié : commandes boutiques à côté des commandes exutoires.
  const [commandesBoutiques, setCommandesBoutiques] = useState([]);
  const [boutiquesErreur, setBoutiquesErreur] = useState(null);
  const [ficheBoutique, setFicheBoutique] = useState(null);
  const [ficheMessage, setFicheMessage] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filtres
  const [filterOrigine, setFilterOrigine] = useState(''); // '' | 'exutoire' | 'boutique'
  const [filterType, setFilterType] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [historiqueComplet, setHistoriqueComplet] = useState(false);

  useEffect(() => { loadClients(); loadCommandes(); loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      setStats((prev) => ({
        ...prev,
        ...d,
        tonnage_prevu: d.total_tonnage_prevu ?? 0,
        ca_previsionnel: d.total_ca_prevu ?? 0,
      }));
    } catch (err) { console.error(err); }
  };

  // Les deux listes sont chargées ensemble ; l'échec de l'une ne vide pas
  // l'autre, et il est DIT (un tableau à moitié vide sans explication ferait
  // croire qu'il n'y a pas de commande).
  const loadCommandes = useCallback(async () => {
    const [exu, btq] = await Promise.allSettled([
      api.get('/commandes-exutoires'),
      api.get('/boutique-commandes'),
    ]);
    if (exu.status === 'fulfilled') {
      setCommandes(exu.value.data || []);
      setLoadError(null);
    } else {
      console.error(exu.reason);
      setLoadError('Impossible de charger les commandes exutoires. Vérifiez votre connexion puis réessayez.');
    }
    if (btq.status === 'fulfilled') {
      setCommandesBoutiques(btq.value.data || []);
      setBoutiquesErreur(null);
    } else {
      console.error(btq.reason);
      setBoutiquesErreur('Les commandes des boutiques n\'ont pas pu être chargées.');
    }
    setLoading(false);
  }, []);

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

  const openDetail = async (commande, message = '') => {
    setActionError('');
    setOccurrences(null);
    setFicheMessage(message);
    try {
      const res = await api.get(`/commandes-exutoires/${commande.id}`);
      setShowDetail(res.data);
      if (estModeleRecurrent(res.data)) loadOccurrences(res.data.id);
    } catch (err) {
      console.error(err);
      setShowDetail(commande);
    }
  };

  const rechargerDetail = async () => {
    if (!showDetail) return;
    try {
      const res = await api.get(`/commandes-exutoires/${showDetail.id}`);
      setShowDetail(res.data);
    } catch (err) { console.error(err); }
    loadCommandes();
    loadStats();
  };

  const openBoutique = async (id, message = '') => {
    setFicheMessage(message);
    try {
      const res = await api.get(`/boutique-commandes/${id}`);
      setFicheBoutique(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Commande boutique introuvable');
    }
  };

  // Ouvre la fiche d'une carte du tableau (quelle que soit son origine).
  const ouvrirFiche = (item, message = '') => (item.type === 'boutique'
    ? openBoutique(item.nativeId, message)
    : openDetail(item.raw, message));

  // Lien profond `?commande=btq-12` / `?commande=exu-7` (notification d'une
  // nouvelle commande boutique, occupation de la zone de chargement…).
  useEffect(() => {
    const cible = searchParams.get('commande');
    if (!cible) return;
    const [type, idTxt] = cible.split('-');
    const id = Number(idTxt);
    if (Number.isInteger(id) && id > 0) {
      if (type === 'btq') openBoutique(id);
      else if (type === 'exu') openDetail({ id });
    }
    const p = new URLSearchParams(searchParams);
    p.delete('commande');
    setSearchParams(p, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Action sur une commande boutique depuis sa fiche.
  const actionBoutique = async (verbe, body, succes, demanderConfirmation = false) => {
    if (!ficheBoutique) return;
    if (demanderConfirmation) {
      const ok = await confirm({
        title: 'Annuler cette commande ?',
        message: `La commande ${ficheBoutique.reference} de ${ficheBoutique.boutique_nom || 'la boutique'} sera annulée.`,
        confirmLabel: 'Annuler la commande',
        confirmVariant: 'danger',
      });
      if (!ok) return;
    }
    setActionBusy(true);
    try {
      await api.patch(`/boutique-commandes/${ficheBoutique.id}/${verbe}`, body || {});
      toast.success(succes);
      setFicheMessage('');
      const res = await api.get(`/boutique-commandes/${ficheBoutique.id}`);
      setFicheBoutique(res.data);
      loadCommandes();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action refusée');
    }
    setActionBusy(false);
  };

  // ── Glisser-déposer (même mécanique que le kanban du recrutement) ────────
  const deplacer = async (item, cible) => {
    const action = actionDeplacement(item, cible);
    if (action.kind === 'rien') return;
    if (action.kind === 'refus') { toast.error(action.message); return; }
    if (action.kind === 'fiche') { ouvrirFiche(item, action.message); return; }
    try {
      await api.patch(action.url, action.body || {});
      toast.success(`${item.reference} — ${action.succes}`);
      loadCommandes();
      loadStats();
    } catch (err) {
      // Refus du serveur (ex. aucun carton scanné) : on ouvre la fiche avec le
      // motif, là où l'on peut y remédier.
      const motif = err.response?.data?.error || 'Déplacement refusé';
      toast.error(motif);
      ouvrirFiche(item, motif);
    }
  };
  const onDragStart = (e, id) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); };
  const onDragEnd = () => { setDraggedId(null); setDragOver(null); };
  const onDragOverCol = (e, col) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(col); };
  const onDragLeaveCol = (e, col) => { if (e.currentTarget.contains(e.relatedTarget)) return; if (dragOver === col) setDragOver(null); };

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

  // ── Tableau unifié ────────────────────────────────────────────────────────
  const toutes = useMemo(() => [
    ...commandes.map(depuisExutoire),
    ...commandesBoutiques.filter((c) => c.statut !== 'brouillon').map(depuisBoutique),
  ], [commandes, commandesBoutiques]);

  const visibles = useMemo(() => {
    const mots = filterSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return toutes.filter((c) => {
      if (filterOrigine && c.type !== filterOrigine) return false;
      if (filterType && (c.type !== 'exutoire' || !c.types_produit.includes(filterType))) return false;
      if (!historiqueComplet && estAncienneTerminee(c)) return false;
      if (mots.length) {
        const texte = `${c.reference || ''} ${c.destinataire || ''}`.toLowerCase();
        if (!mots.every((m) => texte.includes(m))) return false;
      }
      return true;
    });
  }, [toutes, filterOrigine, filterType, filterSearch, historiqueComplet]);

  const itemsByColumn = useMemo(() => {
    const out = Object.fromEntries(COLONNES.map((c) => [c.key, []]));
    out._annulees = [];
    for (const cmd of visibles) {
      if (cmd.statut === 'annulee') { out._annulees.push(cmd); continue; }
      const col = colonneDe(cmd);
      if (col && out[col]) out[col].push(cmd);
    }
    // À traiter : la plus ancienne d'abord (c'est elle qui attend le plus).
    out.a_traiter.sort((x, y) => String(x.date_commande).localeCompare(String(y.date_commande)));
    return out;
  }, [visibles]);

  const onDropCol = (e, col) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    const item = toutes.find((c) => c.id === id);
    if (item) deplacer(item, col);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des commandes..." /></Layout>;

  const actives = COLONNES.filter((c) => c.key !== 'terminee')
    .reduce((acc, c) => acc + (itemsByColumn[c.key]?.length || 0), 0);
  const kpiList = [
    { key: 'actives', label: 'Commandes en cours', value: actives, accent: 'slate' },
    { key: 'a_traiter', label: 'À traiter', value: itemsByColumn.a_traiter.length, accent: 'orange' },
    {
      key: 'boutiques',
      label: 'Commandes boutiques en cours',
      value: toutes.filter((c) => c.type === 'boutique' && ['envoyee', 'ajustee', 'en_preparation'].includes(c.statut)).length,
      accent: 'blue',
    },
    { key: 'tonnage', label: 'Tonnage prévu (exutoires)', value: formatTonnage(stats.tonnage_prevu), unit: 't', accent: 'green' },
  ];

  const boardColumns = COLONNES.map((c) => ({
    key: c.key,
    label: c.label,
    accent: c.accent,
    onAdd: c.key === 'a_traiter' ? () => openCreate() : null,
  }));

  const origines = [
    { key: '', label: 'Toutes', count: toutes.filter((c) => c.statut !== 'annulee').length },
    { key: 'exutoire', label: 'Exutoires', count: toutes.filter((c) => c.type === 'exutoire' && c.statut !== 'annulee').length },
    { key: 'boutique', label: 'Boutiques', count: toutes.filter((c) => c.type === 'boutique' && c.statut !== 'annulee').length },
  ];

  const renderCommandeCard = (item) => {
    if (item.type === 'boutique') {
      const voulu = item.nb_cartons_voulu;
      return (
        <div>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase">{item.reference}</span>
            <div className="flex items-center gap-1 text-slate-400">
              <Calendar className="w-3 h-3" />
              <span className="text-[10px]">{formatDate(item.date_commande)}</span>
            </div>
          </div>
          <p className="font-medium text-sm text-slate-800 leading-tight line-clamp-2">
            <Store className="w-3.5 h-3.5 text-pink-500 inline mr-1 -mt-0.5" />
            {item.destinataire || 'Boutique'}
          </p>
          <span className="inline-flex items-center mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">
            Commande boutique
          </span>
          {item.date_prevue && (
            <p className="text-[11px] text-slate-500 mt-1">Livraison souhaitée : {formatDate(item.date_prevue)}</p>
          )}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 uppercase">Cartons</span>
              <span className="text-xs font-semibold text-slate-700 font-mono">
                {voulu != null
                  ? (['en_preparation', 'expediee'].includes(item.statut) ? `${item.nb_cartons_scannes}/${voulu}` : voulu)
                  : `${Number(item.poids_total_demande_kg || 0).toFixed(0)} kg`}
              </span>
            </div>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{libelleStatut(item)}</span>
          </div>
        </div>
      );
    }
    const cmd = item.raw;
    const statusInfo = STATUTS[cmd.statut] || {};
    const clientName = cmd.raison_sociale || cmd.client_nom || getClientName(cmd.client_id);
    const types = item.types_produit;
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
        {/* Occurrence générée dont le créneau n'a pas pu être posé : sans ce
            badge, elle est indiscernable d'une commande en attente ordinaire. */}
        {cmd.creneau_a_poser === true && (
          <span
            className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
            title="Aucune préparation n'est rattachée à cette commande : le créneau de chargement reste à poser dans sa fiche."
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
        {item.statut_preparation && ['en_preparation', 'chargee'].includes(cmd.statut) && (
          <p className="text-[11px] text-amber-700 mt-1">
            {STATUTS_PREPARATION[item.statut_preparation] || item.statut_preparation}
            {item.date_prevue ? ` · départ ${formatDate(item.date_prevue)}` : ''}
          </p>
        )}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 uppercase">Tonnage</span>
            <span className="text-xs font-semibold text-slate-700 font-mono">
              {formatTonnage(cmd.tonnage_prevu)}<span className="text-slate-400 font-normal"> t</span>
            </span>
          </div>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusInfo.color || 'bg-slate-100 text-slate-700'}`}>
            {statusInfo.label || cmd.statut}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      {ConfirmDialogElement}
      {(loadError || boutiquesErreur) && (
        <div className="px-6 pt-4 space-y-2">
          {loadError && <ErrorState variant="card" title="Commandes exutoires indisponibles" message={loadError} onRetry={loadCommandes} />}
          {boutiquesErreur && <ErrorState variant="card" title="Commandes boutiques indisponibles" message={boutiquesErreur} onRetry={loadCommandes} />}
        </div>
      )}
      <KanbanBoard
        title="Commandes"
        subtitle="Exutoires et boutiques : un seul suivi — glissez une carte pour la faire avancer, cliquez pour ouvrir sa fiche"
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
              Nouvelle commande exutoire
            </button>
          </div>
        }
        kpis={kpiList}
        search={{
          value: filterSearch,
          onChange: setFilterSearch,
          placeholder: 'Rechercher par client, boutique, référence…',
        }}
        extraTopBar={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Origine :</span>
              {origines.map((o) => (
                <button
                  key={o.key || 'toutes'}
                  onClick={() => setFilterOrigine(o.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    filterOrigine === o.key
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {o.label}<span className="ml-1 opacity-70">({o.count})</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Produit :</span>
              <select
                value={filterType || ''}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <option value="">Tous</option>
                {Object.entries(TYPES_PRODUIT_OPTIONS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" className="accent-primary" checked={historiqueComplet} onChange={(e) => setHistoriqueComplet(e.target.checked)} />
              <History className="w-3.5 h-3.5" /> Afficher les commandes terminées depuis plus de 30 jours
            </label>
          </div>
        }
        columns={boardColumns}
        itemsByColumn={itemsByColumn}
        renderCard={renderCommandeCard}
        onCardClick={(item) => ouvrirFiche(item)}
        dnd={{ onDragStart, onDragEnd, onDragOverCol, onDragLeaveCol, onDropCol, draggedId, dragOverColumn: dragOver }}
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
        <Modal isOpen={!!showDetail} onClose={() => { setShowDetail(null); setFicheMessage(''); }} title={showDetail ? `Commande ${showDetail.reference || `#${showDetail.id}`} — ${showDetail.raison_sociale || getClientName(showDetail.client_id)}` : ''} size="lg">
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
                    <span className="font-medium">{showDetail.raison_sociale || showDetail.client_nom || getClientName(showDetail.client_id)}</span>
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

              {/* Préparation & chargement — gérés ICI (la page « Préparation » est retirée). */}
              {showDetail.statut !== 'annulee' || showDetail.preparation ? (
                <PreparationExutoire
                  key={showDetail.id}
                  commande={showDetail}
                  onChange={rechargerDetail}
                  message={ficheMessage}
                  confirm={confirm}
                />
              ) : null}

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
                {['en_attente', 'confirmee', 'en_preparation', 'chargee'].includes(showDetail.statut) && (
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

        {/* Fiche d'une commande boutique */}
        <Modal
          isOpen={!!ficheBoutique}
          onClose={() => { setFicheBoutique(null); setFicheMessage(''); }}
          title={ficheBoutique ? `Commande ${ficheBoutique.reference} — ${ficheBoutique.boutique_nom || 'boutique'}` : ''}
          size="lg"
        >
          {ficheBoutique && (
            <FicheCommandeBoutique
              key={`${ficheBoutique.id}-${ficheBoutique.statut}`}
              commande={ficheBoutique}
              onAction={actionBoutique}
              busy={actionBusy}
              message={ficheMessage}
            />
          )}
        </Modal>
      </div>
    </Layout>
  );
}
