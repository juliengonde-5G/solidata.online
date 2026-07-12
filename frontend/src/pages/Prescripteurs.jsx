import { useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Section, Modal, DataTable, ErrorState } from '../components';
import { Building2 } from 'lucide-react';
import useAsyncData from '../hooks/useAsyncData';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

// Référentiel des organismes prescripteurs (conformité IAE — source des
// prescriptions, donnée obligatoire pour le reporting FSE+ / France Travail).
const EMPTY = { nom: '', type: 'FT', contact_nom: '', contact_email: '', contact_phone: '', region: '', siret: '', notes: '', actif: true };

export default function Prescripteurs() {
  const { user } = useAuth();
  const canEdit = ['ADMIN', 'RH'].includes(user?.base_role || user?.role);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const fetchData = useCallback(async () => {
    const [listRes, typesRes] = await Promise.all([
      api.get('/prescripteurs'),
      api.get('/prescripteurs/types').catch(() => ({ data: [] })),
    ]);
    return { list: listRes.data || [], types: typesRes.data || [] };
  }, []);
  const { data, loading, error, reload } = useAsyncData(fetchData, { initialData: { list: [], types: [] } });
  const { list = [], types = [] } = data || {};

  const typeLabel = (t) => types.find((x) => x.value === t)?.label || t;
  const visible = showInactive ? list : list.filter((p) => p.actif !== false);

  const openCreate = () => { setForm(EMPTY); setEditingId(null); setFormError(''); setModalOpen(true); };
  const openEdit = (p) => {
    setForm({
      nom: p.nom || '', type: p.type || 'FT', contact_nom: p.contact_nom || '',
      contact_email: p.contact_email || '', contact_phone: p.contact_phone || '',
      region: p.region || '', siret: p.siret || '', notes: p.notes || '', actif: p.actif !== false,
    });
    setEditingId(p.id); setFormError(''); setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.nom.trim()) { setFormError('Le nom de l’organisme est obligatoire.'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        nom: form.nom.trim(), type: form.type,
        contact_nom: form.contact_nom.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        region: form.region.trim() || null,
        siret: form.siret.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editingId) { payload.actif = form.actif; await api.put(`/prescripteurs/${editingId}`, payload); }
      else { await api.post('/prescripteurs', payload); }
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Erreur lors de l’enregistrement.');
    } finally { setSaving(false); }
  };

  const deactivate = async (p) => {
    if (!window.confirm(`Désactiver le prescripteur « ${p.nom} » ?`)) return;
    try { await api.delete(`/prescripteurs/${p.id}`); reload(); }
    catch (err) { window.alert(err.response?.data?.error || 'Erreur lors de la désactivation.'); }
  };

  const reactivate = async (p) => {
    try { await api.put(`/prescripteurs/${p.id}`, { actif: true }); reload(); }
    catch (err) { window.alert(err.response?.data?.error || 'Erreur lors de la réactivation.'); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des prescripteurs..." /></Layout>;
  if (error) return <Layout><div className="p-6"><ErrorState title="Impossible de charger les prescripteurs" onRetry={reload} variant="card" /></div></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Prescripteurs"
          subtitle={`${visible.length} organisme${visible.length > 1 ? 's' : ''} · conformité IAE / FSE+`}
          icon={Building2}
          actions={canEdit && <button onClick={openCreate} className="btn-primary text-sm">+ Nouveau prescripteur</button>}
        />

        <Section title="Organismes prescripteurs">
          <div className="flex items-center gap-3 mb-4 text-sm">
            <label className="flex items-center gap-2 text-gray-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
              Afficher les inactifs
            </label>
          </div>
          <DataTable
            columns={[
              { key: 'nom', label: 'Organisme', sortable: true, render: (p) => (
                <div>
                  <p className="font-medium text-sm">{p.nom}</p>
                  {p.siret && <p className="text-xs text-gray-400">SIRET {p.siret}</p>}
                </div>
              ) },
              { key: 'type', label: 'Type', sortable: true, render: (p) => (
                <span className="px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700">{typeLabel(p.type)}</span>
              ) },
              { key: 'contact', label: 'Contact', render: (p) => (
                <div className="text-xs text-gray-600">
                  {p.contact_nom && <p>{p.contact_nom}</p>}
                  {p.contact_email && <p className="text-gray-400">{p.contact_email}</p>}
                  {p.contact_phone && <p className="text-gray-400">{p.contact_phone}</p>}
                  {!p.contact_nom && !p.contact_email && !p.contact_phone && <span className="text-gray-300">—</span>}
                </div>
              ) },
              { key: 'region', label: 'Région', render: (p) => p.region || '—' },
              { key: 'actif', label: 'Statut', render: (p) => (
                p.actif !== false
                  ? <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Actif</span>
                  : <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-500">Inactif</span>
              ) },
              ...(canEdit ? [{ key: 'actions', label: '', render: (p) => (
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => openEdit(p)} className="text-xs text-primary hover:underline">Modifier</button>
                  {p.actif !== false
                    ? <button onClick={() => deactivate(p)} className="text-xs text-red-600 hover:underline">Désactiver</button>
                    : <button onClick={() => reactivate(p)} className="text-xs text-green-600 hover:underline">Réactiver</button>}
                </div>
              ) }] : []),
            ]}
            data={visible}
            emptyMessage="Aucun prescripteur enregistré."
          />
        </Section>

        {modalOpen && (
          <Modal isOpen onClose={() => setModalOpen(false)} title={editingId ? 'Modifier le prescripteur' : 'Nouveau prescripteur'} size="md">
            <form onSubmit={submit} className="space-y-3">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                  <span>⚠</span><span>{formError}</span>
                </div>
              )}
              <div>
                <label className="text-gray-700 text-xs font-medium">Organisme <span className="text-red-500">*</span></label>
                <input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} className="input-modern mt-1" placeholder="Ex: France Travail agence Rouen" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 text-xs">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-modern mt-1">
                    {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 text-xs">Région</label>
                  <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="input-modern mt-1" placeholder="Normandie" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 text-xs">Contact (nom)</label>
                  <input value={form.contact_nom} onChange={(e) => setForm({ ...form, contact_nom: e.target.value })} className="input-modern mt-1" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs">SIRET</label>
                  <input value={form.siret} onChange={(e) => setForm({ ...form, siret: e.target.value })} className="input-modern mt-1" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs">Email</label>
                  <input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="input-modern mt-1" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs">Téléphone</label>
                  <input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="input-modern mt-1" />
                </div>
              </div>
              <div>
                <label className="text-gray-500 text-xs">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-modern mt-1" rows={2} />
              </div>
              {editingId && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded" />
                  Actif
                </label>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" disabled={saving} className="flex-1 btn-primary text-sm">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </Layout>
  );
}
