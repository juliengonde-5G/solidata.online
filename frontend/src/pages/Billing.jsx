import { useState, useEffect } from 'react';
import { FileText, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal, PageHeader } from '../components';
import api from '../services/api';

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

  // Impression A4 côté client (fenêtre print dédiée, comme le PCM / parcours).
  // On ne peut pas ouvrir directement /api/exports/invoice/:id : une navigation
  // navigateur ne porte pas le Bearer de l'intercepteur axios → 401.
  const exportPDF = async (inv) => {
    try {
      const res = await api.get(`/billing/invoices/${inv.id}`);
      const data = res.data || inv;
      const lines = data.lines || [];
      const esc = (v) => (v ?? '').toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const eur = (n) => (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
      const qte = (n) => (parseFloat(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
      const dt = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

      const totalHt = data.total_ht != null ? parseFloat(data.total_ht)
        : lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0);
      const totalTva = data.total_tva != null ? parseFloat(data.total_tva) : totalHt * 0.2;
      const totalTtc = data.total_ttc != null ? parseFloat(data.total_ttc) : totalHt + totalTva;

      const rowsHtml = lines.map((l) => {
        const lineTotal = l.total != null ? l.total : (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0);
        return `<tr>
          <td>${esc(l.description)}</td>
          <td style="text-align:right">${qte(l.quantity)}</td>
          <td style="text-align:right">${eur(l.unit_price)}</td>
          <td style="text-align:right">${eur(lineTotal)}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="4" style="text-align:center;color:#9ca3af">Aucune ligne</td></tr>';

      const w = window.open('', '_blank', 'width=820,height=1100');
      if (!w) { alert('Popup bloquée — autorisez les popups pour exporter la facture.'); return; }
      w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>
<title>Facture ${esc(data.invoice_number || '')}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; line-height: 1.5; }
  .header { background: #0D9488; color: white; padding: 16px 22px; display: flex; justify-content: space-between; align-items: flex-start; }
  .header h1 { font-size: 20px; font-weight: 700; }
  .header .sub { font-size: 11px; opacity: .9; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 4px; }
  .block-title { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: #f1f5f9; text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #475569; border-bottom: 2px solid #cbd5e1; }
  th:nth-child(n+2), td:nth-child(n+2) { text-align: right; }
  td { padding: 7px 8px; border-bottom: 1px solid #eef2f6; }
  .totals { margin: 8px 4px 0 auto; width: 46%; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .ttc { border-top: 2px solid #0D9488; margin-top: 4px; padding-top: 6px; font-weight: 700; font-size: 14px; color: #0D9488; }
  .notes { margin: 16px 4px; font-size: 11px; color: #4b5563; }
  .footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 22px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
  <div class="header">
    <div><h1>SOLIDATA — Facture</h1><div class="sub">Solidarité Textiles</div></div>
    <div style="text-align:right"><div style="font-size:15px;font-weight:700">${esc(data.invoice_number || '')}</div><div class="sub">Statut : ${esc(data.status || '—')}</div></div>
  </div>
  <div class="meta">
    <div>
      <div class="block-title">Client</div>
      <div style="font-weight:600">${esc(data.client_name || '—')}</div>
      <div>${esc(data.client_address || '')}</div>
      <div>${esc(data.client_email || '')}</div>
    </div>
    <div style="text-align:right">
      <div class="block-title">Dates</div>
      <div>Date d'émission : <strong>${dt(data.date)}</strong></div>
      <div>Échéance : <strong>${dt(data.due_date)}</strong></div>
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th>Qté</th><th>Prix unitaire</th><th>Total HT</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Total HT</span><span>${eur(totalHt)}</span></div>
    <div class="row"><span>TVA</span><span>${eur(totalTva)}</span></div>
    <div class="row ttc"><span>Total TTC</span><span>${eur(totalTtc)}</span></div>
  </div>
  ${data.notes ? `<div class="notes"><div class="block-title">Notes</div>${esc(data.notes)}</div>` : ''}
  <div class="footer">Document généré par SOLIDATA le ${new Date().toLocaleDateString('fr-FR')}</div>
</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 400);
    } catch (err) {
      console.error('Erreur export facture:', err);
      alert(err.response?.data?.error || 'Erreur lors de la génération de la facture.');
    }
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
      render: (inv) => <StatusBadge status={inv.status} size="sm" />,
    },
    {
      key: 'actions',
      label: '',
      render: (inv) => (
        <div className="flex gap-2">
          <button onClick={() => exportPDF(inv)} className="text-primary text-xs hover:underline">PDF</button>
          {inv.status === 'draft' && <button onClick={() => updateStatus(inv.id, 'sent')} className="text-blue-500 text-xs hover:underline">Envoyer</button>}
          {inv.status === 'sent' && <button onClick={() => updateStatus(inv.id, 'paid')} className="text-green-500 text-xs hover:underline">Payée</button>}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Facturation"
          subtitle="Gestion des factures"
          icon={FileText}
          actions={
            <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
              Nouvelle facture
            </button>
          }
        />

        <DataTable
          columns={columns}
          data={invoices}
          loading={loading}
          emptyIcon={FileText}
          emptyMessage="Aucune facture"
        />

        {/* Form */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouvelle facture" size="lg"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="submit" form="billing-form" className="flex-1 btn-primary text-sm">Créer</button>
          </>}
        >
          <form id="billing-form" onSubmit={createInvoice} className="space-y-3">
            <input placeholder="Nom du client *" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} className="input-modern" required />
            <input placeholder="Adresse du client" value={form.client_address} onChange={e => setForm({ ...form, client_address: e.target.value })} className="input-modern" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Date</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input-modern" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Échéance</label>
                <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="input-modern" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold">Lignes</label>
                <button type="button" onClick={addLine} className="text-primary text-xs font-medium">+ Ajouter une ligne</button>
              </div>
              {form.lines.map((line, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input placeholder="Description" value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} className="input-modern flex-1" />
                  <input type="number" placeholder="Qté" value={line.quantity} onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} className="input-modern w-16" />
                  <input type="number" step="0.01" placeholder="P.U." value={line.unit_price} onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)} className="input-modern w-24" />
                  <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 px-1">&times;</button>
                </div>
              ))}
              <div className="text-right text-sm mt-2">
                <p className="text-slate-500">Total HT : <span className="font-bold text-slate-800">{totalHT.toFixed(2)}€</span></p>
                <p className="text-slate-500">TVA 20% : <span className="font-bold">{(totalHT * 0.2).toFixed(2)}€</span></p>
                <p className="text-primary font-bold text-lg">TTC : {(totalHT * 1.2).toFixed(2)}€</p>
              </div>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
