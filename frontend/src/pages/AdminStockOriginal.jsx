import { useState, useEffect, useCallback } from 'react';
import { Scale, Lock, Unlock, Edit3, History, Search } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, Modal } from '../components';
import api from '../services/api';

const ORIGINES_LABELS = {
  collecte_pav: 'Collecte PAV',
  collecte_association: 'Collecte association',
  retour_vak: 'Retour VAK',
  retour_magasin: 'Retour magasin',
  apport_volontaire: 'Apport volontaire',
  tri_batch: 'Tri (lot)',
  expedition_original: 'Expedition original',
  regularisation: 'Regularisation',
};

export default function AdminStockOriginal() {
  const [activeTab, setActiveTab] = useState('regularisation');
  const [loading, setLoading] = useState(true);
  const [locks, setLocks] = useState([]);
  const [movements, setMovements] = useState([]);
  const [audit, setAudit] = useState([]);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Regularisation form
  const [regulForm, setRegulForm] = useState({
    date: new Date().toISOString().split('T')[0],
    poids_kg: '', motif: '', notes: '',
  });

  // Edit modal
  const [editModal, setEditModal] = useState(false);
  const [editMovement, setEditMovement] = useState(null);
  const [editForm, setEditForm] = useState({ date: '', poids_kg: '', notes: '' });

  // Lock confirm
  const [lockConfirm, setLockConfirm] = useState(null);

  // Search filters for modifications tab
  const [searchFilters, setSearchFilters] = useState({ date_from: '', date_to: '' });

  const loadLocks = useCallback(async () => {
    try {
      const res = await api.get('/stock-original/locks');
      setLocks(res.data);
    } catch (err) { console.error(err); }
  }, []);

  const loadMovements = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchFilters.date_from) params.set('date_from', searchFilters.date_from);
      if (searchFilters.date_to) params.set('date_to', searchFilters.date_to);
      params.set('limit', '100');
      const res = await api.get(`/stock-original?${params}`);
      setMovements(res.data);
    } catch (err) { console.error(err); }
  }, [searchFilters]);

  useEffect(() => {
    Promise.all([loadLocks(), loadMovements()])
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadMovements(); }, [searchFilters, loadMovements]);

  const isLocked = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const quarter = Math.ceil((d.getMonth() + 1) / 3);
    return locks.some(l => l.year === year && l.quarter === quarter);
  };

  // Regularisation
  const handleRegularisation = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await api.post('/stock-original/regularisation', {
        date: regulForm.date,
        poids_kg: parseFloat(regulForm.poids_kg),
        motif: regulForm.motif,
        notes: regulForm.notes || null,
      });
      setMessage({ type: 'success', text: `Regularisation enregistree : ${regulForm.poids_kg} kg` });
      setRegulForm({ ...regulForm, poids_kg: '', motif: '', notes: '' });
      loadMovements();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Erreur serveur' });
    }
    setSubmitting(false);
  };

  // Edit movement
  const openEdit = async (movement) => {
    setEditMovement(movement);
    setEditForm({
      date: new Date(movement.date).toISOString().split('T')[0],
      poids_kg: movement.poids_kg,
      notes: movement.notes || '',
    });
    setAudit([]);
    try {
      const res = await api.get(`/stock-original/audit/${movement.id}`);
      setAudit(res.data);
    } catch (err) { console.error(err); }
    setEditModal(true);
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.put(`/stock-original/${editMovement.id}`, {
        date: editForm.date,
        poids_kg: parseFloat(editForm.poids_kg),
        notes: editForm.notes || null,
      });
      setEditModal(false);
      setMessage({ type: 'success', text: 'Mouvement modifie avec succes' });
      loadMovements();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Erreur modification' });
    }
    setSubmitting(false);
  };

  // Locks
  const handleLock = async (year, quarter) => {
    try {
      await api.post('/stock-original/locks', { year, quarter });
      setLockConfirm(null);
      setMessage({ type: 'success', text: `Trimestre Q${quarter} ${year} verrouille` });
      loadLocks();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Erreur verrouillage' });
    }
  };

  const handleUnlock = async (lockId) => {
    try {
      await api.delete(`/stock-original/locks/${lockId}`);
      setMessage({ type: 'success', text: 'Trimestre deverrouille' });
      loadLocks();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Erreur deverrouillage' });
    }
  };

  // Generate quarters grid (last 2 years)
  const generateQuarters = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const quarters = [];
    for (let y = currentYear; y >= currentYear - 1; y--) {
      for (let q = 4; q >= 1; q--) {
        const lock = locks.find(l => l.year === y && l.quarter === q);
        quarters.push({ year: y, quarter: q, lock });
      }
    }
    return quarters;
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement administration stock..." /></Layout>;

  const tabs = [
    { id: 'regularisation', label: 'Regularisation', icon: Scale },
    { id: 'modifications', label: 'Modifications', icon: Edit3 },
    { id: 'verrouillage', label: 'Verrouillage', icon: Lock },
  ];

  const movementColumns = [
    { key: 'id', label: '#', render: (m) => <span className="text-xs text-slate-400">#{m.id}</span> },
    { key: 'date', label: 'Date', sortable: true, render: (m) => new Date(m.date).toLocaleDateString('fr-FR') },
    {
      key: 'type', label: 'Type', sortable: true,
      render: (m) => {
        const colors = { entree: 'bg-green-100 text-green-700', sortie: 'bg-red-100 text-red-700', regularisation: 'bg-amber-100 text-amber-700' };
        const labels = { entree: 'Entree', sortie: 'Sortie', regularisation: 'Regul.' };
        return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[m.type]}`}>{labels[m.type]}</span>;
      },
    },
    { key: 'poids_kg', label: 'Poids (kg)', sortable: true, render: (m) => <span className="font-medium">{parseFloat(m.poids_kg).toFixed(1)}</span> },
    { key: 'origine', label: 'Origine', render: (m) => <span className="text-sm">{ORIGINES_LABELS[m.origine] || m.origine || '—'}</span> },
    {
      key: 'actions', label: '',
      render: (m) => {
        const locked = isLocked(m.date);
        return (
          <button onClick={() => !locked && openEdit(m)} disabled={locked}
            className={`px-2 py-1 rounded text-xs ${locked ? 'text-slate-300 cursor-not-allowed' : 'text-primary hover:bg-primary/5'}`}>
            {locked ? <Lock className="w-3.5 h-3.5 inline" /> : <Edit3 className="w-3.5 h-3.5 inline" />}
            {locked ? ' Verrouille' : ' Modifier'}
          </button>
        );
      },
    },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Scale className="w-6 h-6 text-primary" strokeWidth={1.8} />
              Administration Stock Original
            </h1>
            <p className="text-slate-500">Regularisation, modification et verrouillage trimestriel</p>
          </div>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${activeTab === tab.id ? 'bg-white shadow font-medium text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                <tab.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message.text}
            <button onClick={() => setMessage(null)} className="float-right text-xs hover:underline">Fermer</button>
          </div>
        )}

        {/* Onglet Regularisation */}
        {activeTab === 'regularisation' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-modern p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4">Mouvement correctif</h2>
              <p className="text-sm text-slate-500 mb-4">
                Saisissez un poids positif pour ajouter du stock, negatif pour en retirer. Le motif est obligatoire.
              </p>

              <form onSubmit={handleRegularisation} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                  <input type="date" value={regulForm.date} onChange={e => setRegulForm({ ...regulForm, date: e.target.value })} className="input-modern" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Poids (kg) — positif ou negatif</label>
                  <input type="number" step="0.1" value={regulForm.poids_kg}
                    onChange={e => setRegulForm({ ...regulForm, poids_kg: e.target.value })}
                    className="input-modern" placeholder="Ex: -150 ou +200" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Motif *</label>
                  <textarea value={regulForm.motif} onChange={e => setRegulForm({ ...regulForm, motif: e.target.value })}
                    className="textarea-modern" rows="2" placeholder="Raison de la regularisation..." required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
                  <textarea value={regulForm.notes} onChange={e => setRegulForm({ ...regulForm, notes: e.target.value })}
                    className="textarea-modern" rows="2" placeholder="Observations complementaires..." />
                </div>
                <button type="submit" disabled={submitting} className="w-full btn-primary text-sm">
                  {submitting ? 'Enregistrement...' : 'Enregistrer la regularisation'}
                </button>
              </form>
            </div>

            {/* Dernieres regularisations */}
            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-3">Dernieres regularisations</h3>
              <div className="space-y-2">
                {movements.filter(m => m.type === 'regularisation').slice(0, 10).map(m => (
                  <div key={m.id} className="card-modern p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium">{m.motif || 'Sans motif'}</span>
                        <p className="text-xs text-slate-400">{new Date(m.date).toLocaleDateString('fr-FR')} — {m.created_by_name}</p>
                      </div>
                      <span className={`font-bold ${parseFloat(m.poids_kg) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {parseFloat(m.poids_kg) >= 0 ? '+' : ''}{parseFloat(m.poids_kg).toFixed(1)} kg
                      </span>
                    </div>
                    {m.notes && <p className="text-xs text-slate-400 mt-1">{m.notes}</p>}
                  </div>
                ))}
                {movements.filter(m => m.type === 'regularisation').length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-8">Aucune regularisation</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Onglet Modifications */}
        {activeTab === 'modifications' && (
          <>
            <div className="flex gap-3 mb-4 items-center">
              <Search className="w-4 h-4 text-slate-400" />
              <input type="date" value={searchFilters.date_from} onChange={e => setSearchFilters({ ...searchFilters, date_from: e.target.value })} className="input-modern text-sm" />
              <span className="text-slate-400">—</span>
              <input type="date" value={searchFilters.date_to} onChange={e => setSearchFilters({ ...searchFilters, date_to: e.target.value })} className="input-modern text-sm" />
              {(searchFilters.date_from || searchFilters.date_to) && (
                <button onClick={() => setSearchFilters({ date_from: '', date_to: '' })} className="text-sm text-primary hover:underline">
                  Reinitialiser
                </button>
              )}
            </div>

            <DataTable
              columns={movementColumns}
              data={movements}
              loading={false}
              emptyIcon={Edit3}
              emptyMessage="Aucun mouvement"
              dense
            />
          </>
        )}

        {/* Onglet Verrouillage */}
        {activeTab === 'verrouillage' && (
          <div>
            <p className="text-sm text-slate-500 mb-6">
              Le verrouillage trimestriel fige les mouvements de stock original pour la declaration Refashion.
              Une fois verrouille, aucune modification ni regularisation n'est possible sur cette periode.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {generateQuarters().map(q => (
                <div key={`${q.year}-${q.quarter}`} className={`card-modern p-5 text-center ${q.lock ? 'border-green-200 bg-green-50/50' : ''}`}>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {q.lock ? (
                      <Lock className="w-5 h-5 text-green-600" strokeWidth={1.8} />
                    ) : (
                      <Unlock className="w-5 h-5 text-slate-300" strokeWidth={1.8} />
                    )}
                    <span className="font-bold text-lg text-slate-800">Q{q.quarter} {q.year}</span>
                  </div>

                  {q.lock ? (
                    <>
                      <p className="text-xs text-green-600 font-medium mb-1">Verrouille</p>
                      <p className="text-xs text-slate-400">{new Date(q.lock.locked_at).toLocaleDateString('fr-FR')}</p>
                      <p className="text-xs text-slate-400 mb-3">{q.lock.locked_by_name}</p>
                      <button onClick={() => handleUnlock(q.lock.id)}
                        className="text-xs text-red-500 hover:text-red-700 hover:underline">
                        Deverrouiller
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-slate-400 mb-3">Non verrouille</p>
                      <button onClick={() => setLockConfirm(q)}
                        className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90">
                        Confirmer declaration Refashion
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lock confirmation dialog */}
        {lockConfirm && (
          <Modal isOpen={true} onClose={() => setLockConfirm(null)} title="Confirmer le verrouillage" size="sm"
            footer={<>
              <button onClick={() => setLockConfirm(null)} className="flex-1 btn-ghost">Annuler</button>
              <button onClick={() => handleLock(lockConfirm.year, lockConfirm.quarter)} className="flex-1 btn-primary text-sm">
                Verrouiller Q{lockConfirm.quarter} {lockConfirm.year}
              </button>
            </>}
          >
            <p className="text-sm text-slate-600">
              Etes-vous sur de vouloir verrouiller le trimestre <strong>Q{lockConfirm.quarter} {lockConfirm.year}</strong> ?
            </p>
            <p className="text-sm text-amber-600 mt-2">
              Une fois verrouille, aucune modification ne sera possible sur les mouvements de cette periode.
            </p>
          </Modal>
        )}

        {/* Edit modal */}
        <Modal isOpen={editModal} onClose={() => setEditModal(false)} title={`Modifier mouvement #${editMovement?.id}`} size="md"
          footer={<>
            <button onClick={() => setEditModal(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="submit" form="edit-form" disabled={submitting} className="flex-1 btn-primary text-sm">
              {submitting ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </>}
        >
          <form id="edit-form" onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
              <input type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} className="input-modern" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Poids (kg)</label>
              <input type="number" step="0.1" value={editForm.poids_kg} onChange={e => setEditForm({ ...editForm, poids_kg: e.target.value })} className="input-modern" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
              <textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} className="textarea-modern" rows="2" />
            </div>
          </form>

          {/* Audit trail */}
          {audit.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <h4 className="text-sm font-semibold text-slate-500 flex items-center gap-1 mb-2">
                <History className="w-3.5 h-3.5" /> Historique des modifications
              </h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {audit.map(a => (
                  <div key={a.id} className="text-xs text-slate-500 flex items-center gap-2">
                    <span className="text-slate-300">{new Date(a.created_at).toLocaleString('fr-FR')}</span>
                    <span className={`px-1.5 py-0.5 rounded ${a.action === 'create' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                      {a.action === 'create' ? 'Creation' : 'Modification'}
                    </span>
                    {a.field_name && <span>{a.field_name}: {a.old_value} → {a.new_value}</span>}
                    <span className="text-slate-300">{a.user_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
