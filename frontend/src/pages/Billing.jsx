import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const STATUS_LABELS = { draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };
const STATUS_COLORS = { draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-red-50 text-red-500' };

export default function Billing() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
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

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Facturation</h1>
            <p className="text-gray-500">Gestion des factures</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouvelle facture
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">N° Facture</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Client</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Échéance</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Total TTC</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-sm font-medium font-mono">{inv.invoice_number}</td>
                  <td className="p-3 text-sm">{inv.client_name}</td>
                  <td className="p-3 text-sm text-gray-500">{new Date(inv.date).toLocaleDateString('fr-FR')}</td>
                  <td className="p-3 text-sm text-gray-500">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-FR') : '—'}</td>
                  <td className="p-3 text-sm font-bold">{parseFloat(inv.total_ttc || 0).toFixed(2)}€</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[inv.status] || ''}`}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => exportPDF(inv.id)} className="text-solidata-green text-xs hover:underline">PDF</button>
                      {inv.status === 'draft' && <button onClick={() => updateStatus(inv.id, 'sent')} className="text-blue-500 text-xs hover:underline">Envoyer</button>}
                      {inv.status === 'sent' && <button onClick={() => updateStatus(inv.id, 'paid')} className="text-green-500 text-xs hover:underline">Payée</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan="7" className="p-8 text-center text-gray-400">Aucune facture</td></tr>
              )}
            </tbody>
          </table>
        </div>

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
                    <label className="text-xs text-gray-500">Date</label>
                    <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Échéance</label>
                    <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold">Lignes</label>
                    <button type="button" onClick={addLine} className="text-solidata-green text-xs font-medium">+ Ajouter une ligne</button>
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
                    <p className="text-gray-500">Total HT : <span className="font-bold text-solidata-dark">{totalHT.toFixed(2)}€</span></p>
                    <p className="text-gray-500">TVA 20% : <span className="font-bold">{(totalHT * 0.2).toFixed(2)}€</span></p>
                    <p className="text-solidata-green font-bold text-lg">TTC : {(totalHT * 1.2).toFixed(2)}€</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
