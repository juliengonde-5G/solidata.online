import { useState, useEffect, useCallback } from 'react';
import { Route, Plus, X } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, Section, DataTable, StatusBadge, ErrorState, ConfirmDialog } from '../components';
import CavPicker from '../components/tours/CavPicker';
import EstimationPanel from '../components/tours/EstimationPanel';
import api from '../services/api';

function fmtDur(min) {
  if (min == null) return '—';
  const v = Math.round(min);
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

const TABS = [
  { key: 'cav', label: 'Modèles CAV', basePath: '/tours/routes', accent: 'bg-teal-600' },
  { key: 'association', label: 'Modèles associations', basePath: '/tours/association-routes', accent: 'bg-orange-500' },
];

export default function RouteTemplates() {
  const [activeTab, setActiveTab] = useState('cav');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = création, sinon la ligne éditée
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIds, setFormIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [referenceVehicle, setReferenceVehicle] = useState(null);
  const [previewEstimation, setPreviewEstimation] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const tab = TABS.find(t => t.key === activeTab);
  const basePath = tab.basePath;

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDeleteBlockedInfo(null);
    setDeleteTarget(null);
    try {
      const res = await api.get(`${basePath}/list`, includeInactive ? { params: { include_inactive: 1 } } : undefined);
      setRoutes(res.data || []);
    } catch (err) {
      console.error(err);
      setError("Impossible de charger les modèles de tournée");
    }
    setLoading(false);
  }, [basePath, includeInactive]);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // Véhicule de référence pour l'aperçu d'estimation (le contrat exige un
  // vehicle_id ; on prend le premier véhicule disponible, affiché explicitement).
  useEffect(() => {
    api.get('/vehicles?available=true')
      .then(res => { if (res.data?.length) setReferenceVehicle(res.data[0]); })
      .catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormDescription('');
    setFormIds([]);
    setSaveError(null);
    setPreviewEstimation(null);
    setEditorOpen(true);
  };

  const openEdit = async (route) => {
    setEditing(route);
    setFormName(route.name || '');
    setFormDescription(route.description || '');
    setFormIds([]);
    setSaveError(null);
    setPreviewEstimation(null);
    setEditorOpen(true);
    try {
      const res = await api.get(`${basePath}/${route.id}`);
      const list = activeTab === 'cav' ? res.data?.cavs : res.data?.points;
      const ids = (list || [])
        .map(p => p.cav_id ?? p.association_point_id ?? p.id)
        .filter(v => v != null);
      setFormIds(ids);
    } catch (err) {
      console.error(err);
      setSaveError('Impossible de charger la composition de ce modèle');
    }
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
  };

  // Aperçu d'estimation — debounce 600 ms sur la composition.
  useEffect(() => {
    if (!editorOpen || !referenceVehicle || formIds.length === 0) {
      setPreviewEstimation(null);
      return;
    }
    const idsKey = activeTab === 'cav' ? 'cav_ids' : 'association_point_ids';
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await api.post('/tours/estimate', {
          vehicle_id: referenceVehicle.id,
          [idsKey]: formIds,
        }, { timeout: 120000 });
        setPreviewEstimation(res.data?.estimation || null);
      } catch (err) {
        console.error(err);
        setPreviewError(err.response?.data?.error || "Aperçu indisponible");
        setPreviewEstimation(null);
      }
      setPreviewLoading(false);
    }, 600);
    return () => clearTimeout(t);
  }, [editorOpen, formIds, referenceVehicle, activeTab]);

  const saveRoute = async () => {
    if (!formName.trim() || formIds.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const idsKey = activeTab === 'cav' ? 'cav_ids' : 'association_point_ids';
      const payload = { name: formName.trim(), description: formDescription.trim() || null, [idsKey]: formIds };
      if (editing) {
        await api.put(`${basePath}/${editing.id}`, payload);
      } else {
        await api.post(basePath, payload);
      }
      setEditorOpen(false);
      setEditing(null);
      loadRoutes();
    } catch (err) {
      console.error(err);
      setSaveError(err.response?.data?.error || "Erreur lors de l'enregistrement du modèle");
    }
    setSaving(false);
  };

  const toggleActive = async (route) => {
    try {
      await api.put(`${basePath}/${route.id}`, { is_active: route.is_active === false });
      loadRoutes();
    } catch (err) {
      console.error(err);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`${basePath}/${deleteTarget.id}`);
      setDeleteTarget(null);
      loadRoutes();
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.code === 'ROUTE_UTILISEE') {
        setDeleteBlockedInfo(deleteTarget);
      } else {
        console.error(err);
      }
      setDeleteTarget(null);
    }
    setDeleting(false);
  };

  const columns = [
    { key: 'name', label: 'Nom', sortable: true, render: r => <span className="font-semibold text-slate-800">{r.name}</span> },
    { key: 'description', label: 'Description', render: r => <span className="text-slate-500 text-xs">{r.description || '—'}</span> },
    { key: 'cav_count', label: 'Points', sortable: true, align: 'right', render: r => r.cav_count ?? r.point_count ?? '—' },
    { key: 'estimated_duration_minutes', label: 'Durée estimée', sortable: true, render: r => fmtDur(r.estimated_duration_minutes) },
    { key: 'estimated_distance_km', label: 'Distance', sortable: true, render: r => r.estimated_distance_km != null ? `${Number(r.estimated_distance_km).toFixed(1)} km` : '—' },
    { key: 'is_active', label: 'Statut', render: r => <StatusBadge status={r.is_active === false ? 'inactive' : 'active'} size="sm" /> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: r => (
        <div className="flex items-center gap-3 justify-end whitespace-nowrap">
          <button onClick={() => openEdit(r)} className="text-teal-600 text-xs font-semibold hover:underline">Modifier</button>
          <button onClick={() => toggleActive(r)} className="text-slate-500 text-xs font-semibold hover:underline">{r.is_active === false ? 'Activer' : 'Désactiver'}</button>
          <button onClick={() => setDeleteTarget(r)} className="text-red-500 text-xs font-semibold hover:underline">Supprimer</button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Modèles de tournées"
          subtitle="Listes de CAV ou de points associatifs réutilisables, affectables en un clic à une tournée"
          icon={Route}
          actions={
            <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-teal-glow transition-all active:scale-[0.98]">
              <Plus className="w-4 h-4" strokeWidth={2.2} />
              Nouveau modèle
            </button>
          }
        />

        {/* Onglets */}
        <div className="flex gap-2 mb-4">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === t.key ? `${t.accent} text-white` : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Bandeau modèle utilisé (409 à la suppression) */}
        {deleteBlockedInfo && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-amber-800">
              <strong>{deleteBlockedInfo.name}</strong> est utilisé par des tournées passées — désactivez-le plutôt.
            </p>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button onClick={() => { toggleActive(deleteBlockedInfo); setDeleteBlockedInfo(null); }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700">Désactiver</button>
              <button onClick={() => setDeleteBlockedInfo(null)} className="text-xs text-amber-700 hover:underline">Fermer</button>
            </div>
          </div>
        )}

        {error ? (
          <ErrorState title="Impossible de charger les modèles" onRetry={loadRoutes} variant="card" />
        ) : (
          <Section
            title={tab.label}
            subtitle={`${routes.length} modèle${routes.length > 1 ? 's' : ''}`}
            icon={Route}
            padded={false}
            actions={
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
                Voir les inactifs
              </label>
            }
          >
            <DataTable
              columns={columns}
              data={routes}
              loading={loading}
              emptyIcon={Route}
              emptyMessage="Aucun modèle de tournée"
              emptyAction={{ label: 'Créer un modèle', onClick: openCreate }}
            />
          </Section>
        )}

        {/* Éditeur — panneau plein écran */}
        {editorOpen && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-stretch sm:items-center justify-center sm:p-6">
            <div className="bg-white w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-5xl sm:rounded-2xl flex flex-col overflow-hidden shadow-elevated">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
                <h2 className="text-lg font-bold text-slate-800">
                  {editing ? `Modifier — ${editing.name}` : `Nouveau modèle (${tab.label})`}
                </h2>
                <button onClick={closeEditor} aria-label="Fermer" className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-500 block mb-1">Nom du modèle *</label>
                    <input value={formName} onChange={e => setFormName(e.target.value)} className="input-modern" placeholder="Ex. Tournée Rouen Centre — lundi" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 block mb-1">Description</label>
                    <input value={formDescription} onChange={e => setFormDescription(e.target.value)} className="input-modern" placeholder="Notes internes (optionnel)" />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-2">
                    Composition ({activeTab === 'cav' ? 'CAV' : 'points associatifs'}) — {formIds.length} sélectionné{formIds.length > 1 ? 's' : ''}
                  </label>
                  <CavPicker
                    mode={activeTab === 'cav' ? 'cav' : 'association'}
                    value={formIds}
                    onChange={setFormIds}
                  />
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1.5">
                    Aperçu de l'estimation
                    {referenceVehicle && <span className="text-slate-400 font-normal"> — sur la base du véhicule {referenceVehicle.registration}</span>}
                  </p>
                  {!referenceVehicle ? (
                    <p className="text-xs text-slate-400 italic">Aucun véhicule disponible pour l'aperçu — l'estimation sera calculée lors de l'affectation d'une tournée.</p>
                  ) : (
                    <EstimationPanel estimation={previewEstimation} loading={previewLoading} error={previewError} compact />
                  )}
                </div>

                {saveError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
                <button onClick={closeEditor} className="px-4 py-2 rounded-button text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Annuler</button>
                <button
                  onClick={saveRoute}
                  disabled={saving || !formName.trim() || formIds.length === 0}
                  className="px-5 py-2 rounded-button bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfirmDialog
          isOpen={!!deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={doDelete}
          title="Supprimer le modèle"
          message={deleteTarget ? `Voulez-vous vraiment supprimer le modèle « ${deleteTarget.name} » ? Cette action est irréversible.` : ''}
          confirmLabel="Supprimer"
          confirmVariant="danger"
          loading={deleting}
        />
      </div>
    </Layout>
  );
}
