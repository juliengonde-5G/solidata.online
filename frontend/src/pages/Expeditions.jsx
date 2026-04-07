import { useState, useEffect } from 'react';
import { Ship, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, Modal } from '../components';
import api from '../services/api';

export default function Expeditions() {
  const [expeditions, setExpeditions] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [exutoires, setExutoires] = useState([]);
  const [form, setForm] = useState({
    exutoire_id: '', date_expedition: new Date().toISOString().slice(0, 10),
    poids_total_kg: '', nb_palettes: '', transporteur: '', bon_livraison: '', notes: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [expRes, sumRes, exuRes] = await Promise.all([
        api.get('/expeditions'),
        api.get('/expeditions/summary'),
        api.get('/referentiels/exutoires'),
      ]);
      setExpeditions(expRes.data);
      setSummary(sumRes.data);
      setExutoires(exuRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createExpedition = async (e) => {
    e.preventDefault();
    try {
      await api.post('/expeditions', form);
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des expéditions..." /></Layout>;

  const columns = [
    {
      key: 'date_expedition',
      label: 'Date',
      sortable: true,
      render: (exp) => <span className="font-medium">{new Date(exp.date_expedition).toLocaleDateString('fr-FR')}</span>,
    },
    { key: 'exutoire_nom', label: 'Destinataire', sortable: true, render: (exp) => exp.exutoire_nom || '—' },
    { key: 'poids_total_kg', label: 'Poids (kg)', sortable: true, render: (exp) => <span className="font-medium">{exp.poids_total_kg}</span> },
    { key: 'nb_palettes', label: 'Palettes', sortable: true, render: (exp) => exp.nb_palettes || '—' },
    { key: 'transporteur', label: 'Transporteur', render: (exp) => <span className="text-slate-500">{exp.transporteur || '—'}</span> },
    { key: 'bon_livraison', label: 'BL', render: (exp) => <span className="text-slate-400">{exp.bon_livraison || '—'}</span> },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Expéditions</h1>
            <p className="text-slate-500">Suivi des expéditions et livraisons</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
            <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
            Nouvelle expédition
          </button>
        </div>

        {/* Monthly Summary */}
        {summary.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {summary.slice(0, 4).map(s => (
              <div key={s.month || s.exutoire} className="card-modern p-4">
                <p className="text-xs text-slate-500">{s.exutoire_nom || s.month}</p>
                <p className="text-xl font-bold text-primary">{parseFloat(s.total_kg || 0).toFixed(0)} <span className="text-xs font-normal text-slate-400">kg</span></p>
                <p className="text-xs text-slate-400">{s.nb_expeditions || 0} expéditions</p>
              </div>
            ))}
          </div>
        )}

        <DataTable
          columns={columns}
          data={expeditions}
          loading={loading}
          emptyIcon={Ship}
          emptyMessage="Aucune expédition"
        />

        {/* Form */}
        {showForm && (
          <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouvelle expédition" size="sm">
            <form onSubmit={createExpedition} className="space-y-3">
                <select value={form.exutoire_id} onChange={e => setForm({ ...form, exutoire_id: e.target.value })} className="input-modern" required>
                  <option value="">Destinataire *</option>
                  {exutoires.map(ex => <option key={ex.id} value={ex.id}>{ex.nom}</option>)}
                </select>
                <input type="date" value={form.date_expedition} onChange={e => setForm({ ...form, date_expedition: e.target.value })} className="input-modern" required />
                <input type="number" placeholder="Poids total (kg) *" value={form.poids_total_kg} onChange={e => setForm({ ...form, poids_total_kg: e.target.value })} className="input-modern" required />
                <input type="number" placeholder="Nb palettes" value={form.nb_palettes} onChange={e => setForm({ ...form, nb_palettes: e.target.value })} className="input-modern" />
                <input placeholder="Transporteur" value={form.transporteur} onChange={e => setForm({ ...form, transporteur: e.target.value })} className="input-modern" />
                <input placeholder="N° Bon de livraison" value={form.bon_livraison} onChange={e => setForm({ ...form, bon_livraison: e.target.value })} className="input-modern" />
                <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-modern" rows="2" />
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </Layout>
  );
}
