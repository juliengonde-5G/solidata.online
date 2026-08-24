import { useState, useEffect, useCallback, useMemo } from 'react';
import { MapPinned, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, Section, DataTable, StatusBadge, ErrorState, Modal } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';
import AdresseGeocodee from '../components/AdresseGeocodee';
import { ARRET_CATEGORIES, getArretCategoryMeta } from '../components/tours/arretCategories';

const EMPTY_FORM = {
  nom: '', categorie: 'autre', adresse: '', latitude: '', longitude: '', duree_min: '', notes: '', is_active: true,
};

/**
 * AdminLieuxTechniques — référentiel des lieux d'arrêt technique (magasin,
 * entretien, carburant, déchèterie, administratif, pause, autre) utilisés par
 * le panneau « Programme de la tournée » de Collecte en direct pour composer
 * des arrêts techniques. Page dédiée sous Opérations → Collecte → Réglages
 * (cohérente avec le référentiel Associations déjà géré ainsi) : le
 * gestionnaire peut créer/modifier/désactiver ses lieux indépendamment d'une
 * tournée précise, et y revenir depuis la modale d'ajout d'arrêt (nouvel onglet).
 */
export default function AdminLieuxTechniques() {
  const { confirm, ConfirmDialogElement } = useConfirm();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategorie, setFilterCategorie] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [alert, setAlert] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const showAlertMsg = (msg, type = 'success') => {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/tours/lieux-techniques', includeInactive ? { params: { include_inactive: 1 } } : undefined);
      setList(res.data || []);
    } catch (err) {
      console.error('[AdminLieuxTechniques] load:', err);
      setLoadError("Impossible de charger le référentiel des lieux d'arrêt");
    }
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((l) => {
      if (filterCategorie && l.categorie !== filterCategorie) return false;
      if (q && !(l.nom || '').toLowerCase().includes(q) && !(l.adresse || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [list, search, filterCategorie]);

  const openCreate = () => {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      nom: item.nom || '',
      categorie: item.categorie || 'autre',
      adresse: item.adresse || '',
      latitude: item.latitude ?? '',
      longitude: item.longitude ?? '',
      duree_min: item.duree_min ?? '',
      notes: item.notes || '',
      is_active: item.is_active !== false,
    });
    setSaveError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { setSaveError('Le nom est requis'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        nom: form.nom.trim(),
        categorie: form.categorie,
        adresse: form.adresse.trim() || null,
        latitude: form.latitude === '' ? null : parseFloat(form.latitude),
        longitude: form.longitude === '' ? null : parseFloat(form.longitude),
        duree_min: form.duree_min === '' ? null : parseInt(form.duree_min, 10),
        notes: form.notes.trim() || null,
        is_active: !!form.is_active,
      };
      if (editItem) {
        await api.put(`/tours/lieux-techniques/${editItem.id}`, body);
        showAlertMsg('Lieu mis à jour');
      } else {
        await api.post('/tours/lieux-techniques', body);
        showAlertMsg('Lieu créé');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      setSaveError(err.response?.data?.error || "Erreur lors de l'enregistrement");
    }
    setSaving(false);
  };

  const toggleActive = async (item) => {
    try {
      await api.put(`/tours/lieux-techniques/${item.id}`, { is_active: item.is_active === false });
      showAlertMsg(item.is_active === false ? 'Lieu réactivé' : 'Lieu désactivé');
      loadData();
    } catch (err) {
      showAlertMsg(err.response?.data?.error || 'Erreur lors du changement de statut', 'error');
    }
  };

  const askDelete = async (item) => {
    const ok = await confirm({
      title: 'Supprimer ce lieu ?',
      message: `« ${item.nom} » sera définitivement supprimé du référentiel. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setDeleteTarget(item);
    setDeleting(true);
    setDeleteBlockedInfo(null);
    try {
      await api.delete(`/tours/lieux-techniques/${item.id}`);
      showAlertMsg('Lieu supprimé');
      loadData();
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.code === 'LIEU_UTILISE') {
        setDeleteBlockedInfo(item);
      } else {
        showAlertMsg(err.response?.data?.error || 'Erreur lors de la suppression', 'error');
      }
    }
    setDeleteTarget(null);
    setDeleting(false);
  };

  const columns = [
    {
      key: 'nom', label: 'Nom', sortable: true,
      render: (r) => <span className="font-semibold text-slate-800">{r.nom}</span>,
    },
    {
      key: 'categorie', label: 'Catégorie', sortable: true,
      render: (r) => {
        const meta = getArretCategoryMeta(r.categorie);
        const Icon = meta.icon;
        return (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
            <Icon className="w-3 h-3" /> {meta.label}
          </span>
        );
      },
    },
    { key: 'adresse', label: 'Adresse', render: (r) => <span className="text-slate-500 text-xs">{r.adresse || '—'}</span> },
    { key: 'duree_min', label: 'Durée', sortable: true, align: 'right', render: (r) => (r.duree_min != null ? `${r.duree_min} min` : '—') },
    { key: 'is_active', label: 'Statut', render: (r) => <StatusBadge status={r.is_active === false ? 'inactive' : 'active'} size="sm" /> },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => (
        <div className="flex items-center gap-3 justify-end whitespace-nowrap">
          <button onClick={() => openEdit(r)} className="text-teal-600 text-xs font-semibold hover:underline">Modifier</button>
          <button onClick={() => toggleActive(r)} className="text-slate-500 text-xs font-semibold hover:underline">
            {r.is_active === false ? 'Activer' : 'Désactiver'}
          </button>
          <button onClick={() => askDelete(r)} disabled={deleting && deleteTarget?.id === r.id} className="text-red-500 text-xs font-semibold hover:underline disabled:opacity-40">
            Supprimer
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="p-4 sm:p-6 space-y-4">
        {alert && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${alert.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {alert.msg}
          </div>
        )}

        <PageHeader
          title="Lieux d'arrêt (référentiel)"
          subtitle="Lieux utilisables comme arrêts techniques dans le programme d'une tournée"
          icon={MapPinned}
          actions={
            <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-all active:scale-[0.98]">
              <Plus className="w-4 h-4" /> Nouveau lieu
            </button>
          }
        />

        {/* Bandeau lieu utilisé (409 à la suppression) */}
        {deleteBlockedInfo && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-amber-800">
              <strong>{deleteBlockedInfo.nom}</strong> est déjà utilisé par une ou plusieurs tournées — désactivez-le plutôt que de le supprimer.
            </p>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button onClick={() => { toggleActive(deleteBlockedInfo); setDeleteBlockedInfo(null); }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700">
                Désactiver
              </button>
              <button onClick={() => setDeleteBlockedInfo(null)} className="text-xs text-amber-700 hover:underline">Fermer</button>
            </div>
          </div>
        )}

        {/* Filtres */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Rechercher un nom, une adresse…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-modern flex-1"
          />
          <select value={filterCategorie} onChange={(e) => setFilterCategorie(e.target.value)} className="select-modern w-auto">
            <option value="">Toutes les catégories</option>
            {ARRET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none whitespace-nowrap px-1">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Voir les inactifs
          </label>
        </div>

        {loadError ? (
          <ErrorState title="Impossible de charger le référentiel" onRetry={loadData} variant="card" />
        ) : (
          <Section title="Lieux d'arrêt" subtitle={`${filtered.length} lieu${filtered.length > 1 ? 'x' : ''}`} icon={MapPinned} padded={false}>
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyIcon={MapPinned}
              emptyMessage="Aucun lieu d'arrêt dans le référentiel"
              emptyAction={{ label: 'Créer un lieu', onClick: openCreate }}
            />
          </Section>
        )}

        {/* Création / édition */}
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Modifier le lieu' : "Nouveau lieu d'arrêt"} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Nom *</label>
                <input type="text" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} className="input-modern" placeholder="Ex. Station Total — Rouen" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Catégorie *</label>
                <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} className="select-modern w-full">
                  {ARRET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            {/* Adresse et coordonnées : reconnaissance automatique dans les
                deux sens (Base Adresse Nationale, repli TomTom). La saisie
                manuelle reste possible si le service ne répond pas. */}
            <AdresseGeocodee
              adresse={form.adresse}
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={(champs) => setForm((f) => ({ ...f, ...champs }))}
            />

            <div>
              <label className="text-xs text-slate-500">Durée (minutes)</label>
              <input type="number" min="0" value={form.duree_min} onChange={(e) => setForm({ ...form, duree_min: e.target.value })} className="input-modern" placeholder="Ex. 15" />
            </div>

            <div>
              <label className="text-xs text-slate-500">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="input-modern resize-none" />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Actif (utilisable dans une tournée)
            </label>

            {saveError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 btn-ghost">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary text-sm">
                {saving ? 'Enregistrement...' : editItem ? 'Mettre à jour' : 'Créer'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
