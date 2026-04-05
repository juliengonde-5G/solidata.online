import { useState, useEffect } from 'react';
import { FileText, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner } from '../components';
import api from '../services/api';

const STATUS_LABELS = { draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };
const STATUS_COLORS = { draft: 'bg-slate-100 text-slate-700', sent: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-red-50 text-red-500' };

export default function Billing() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    client_name: '', client_address: '', date: new Date().toISOString().slice(0, 10),
    due_date: '', lines: [{ description: '', quantity: 1, unit_price: 0 }],
  });

  useEffect(() => { loadInvoices(); }, []);

  const loadInvoices = async () => {
    try {
      const res = await api.get('/billing/invoices');
      setInvoices(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createInvoice = async (e) => {
    e.preventDefault();
    try {
      await api.post('/billing/invoices', form);
      setShowForm(false);
      setForm({ client_name: '', client_address: '', date: new Date().toISOString().slice(0, 10), due_date: '', lines: [{ description: '', quantity: 1, unit_price: 0 }] });
      loadInvoices();
    } catch (err) { console.error(err); }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/billing/invoices/${id}/status`, { status });
      loadInvoices();
    } catch (err) { console.error(err); }
  };

  const exportPDF = (id) => {
    window.open(`/api/exports/invoice/${id}`, '_blank');
  };

  const addLine = () => setForm({ ...form, lines: [...form.lines, { description: '', quantity: 1, unit_price: 0 }] });
  const updateLine = (i, field, value) => {
    const lines = [...form.lines];
    lines[i] = { ...lines[i], [field]: value };
    setForm({ ...form, lines });
  };
  const removeLine = (i) => setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) });

  const totalHT = form.lines.reduce((sum, l) => sum + (l.quantity * l.unit_price), 0);

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des factures..." /></Layout>;

  const columns = [
    { key: 'invoice_number', label: 'N° Facture', sortable: true, render: (inv) => <span className="font-medium font-mono">{inv.invoice_number}</span> },
    { key: 'client_name', label: 'Client', sortable: true },
    { key: 'date', label: 'Date', sortable: true, render: (inv) => <span className="text-slate-500">{new Date(inv.date).toLocaleDateString('fr-FR')}</span> },
    { key: 'due_date', label: 'Échéance', sortable: true, render: (inv) => <span className="text-slate-500">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-FR') : '—'}</span> },
    { key: 'total_ttc', label: 'Total TTC', sortable: true, align: 'right', render: (inv) => <span className="font-bold">{parseFloat(inv.total_ttc || 0).toFixed(2)}€</span> },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      render: (inv) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[inv.status] || ''}`}>
          {STATUS_LABELS[inv.status] || inv.status}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (inv) => (
        <div className="flex gap-2">
          <button onClick={() => exportPDF(inv.id)} className="text-primary text-xs hover:underline">PDF</button>
          {inv.status === 'draft' && <button onClick={() => updateStatus(inv.id, 'sent')} className="text-blue-500 text-xs hover:underline">Envoyer</button>}
          {inv.status === 'sent' && <button onClick={() => updateStatus(inv.id, 'paid')} className="text-green-500 text-xs hover:underline">Payée</button>}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Facturation</h1>
            <p className="text-slate-500">Gestion des factures</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
            <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
            Nouvelle facture
          </button>
        </div>

        <DataTable
          columns={columns}
          data={invoices}
          loading={loading}
          emptyIcon={FileText}
          emptyMessage="Aucune facture"
        />

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createInvoice} className="bg-white rounded-xl p-6 w-[560px] shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">Nouvelle facture</h2>
              <div className="space-y-3">
                <input placeholder="Nom du client *" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Adresse du client" value={form.client_address} onChange={e => setForm({ ...form, client_address: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Date</label>
                    <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Échéance</label>
                    <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold">Lignes</label>
                    <button type="button" onClick={addLine} className="text-primary text-xs font-medium">+ Ajouter une ligne</button>
                  </div>
                  {form.lines.map((line, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input placeholder="Description" value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                      <input type="number" placeholder="Qté" value={line.quantity} onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} className="w-16 border rounded-lg px-2 py-2 text-sm" />
                      <input type="number" step="0.01" placeholder="P.U." value={line.unit_price} onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)} className="w-24 border rounded-lg px-2 py-2 text-sm" />
                      <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 px-1">&times;</button>
                    </div>
                  ))}
                  <div className="text-right text-sm mt-2">
                    <p className="text-slate-500">Total HT : <span className="font-bold text-slate-800">{totalHT.toFixed(2)}€</span></p>
                    <p className="text-slate-500">TVA 20% : <span className="font-bold">{(totalHT * 0.2).toFixed(2)}€</span></p>
                    <p className="text-primary font-bold text-lg">TTC : {(totalHT * 1.2).toFixed(2)}€</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
