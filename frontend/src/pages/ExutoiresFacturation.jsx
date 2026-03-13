import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const STATUTS_PESEE = {
  conforme: { label: 'Conforme', color: 'bg-green-100 text-green-700' },
  ecart_acceptable: { label: 'Écart acceptable', color: 'bg-yellow-100 text-yellow-700' },
  litige: { label: 'Litige', color: 'bg-red-100 text-red-700' },
  valide: { label: 'Validé', color: 'bg-blue-100 text-blue-700' },
};

const STATUTS_FACTURE = {
  recue: { label: 'Reçue', color: 'bg-gray-100 text-gray-700' },
  conforme: { label: 'Conforme', color: 'bg-green-100 text-green-700' },
  ecart: { label: 'Écart', color: 'bg-yellow-100 text-yellow-700' },
  validee: { label: 'Validée', color: 'bg-blue-100 text-blue-700' },
};

export default function ExutoiresFacturation() {
  const [activeTab, setActiveTab] = useState('pesee');
  const [loading, setLoading] = useState(true);

  // Contrôles pesée
  const [controles, setControles] = useState([]);
  const [showControleForm, setShowControleForm] = useState(false);
  const [commandesExpediees, setCommandesExpediees] = useState([]);
  const [controleForm, setControleForm] = useState({
    commande_id: '',
    pesee_client: '',
    date_reception_ticket: '',
    ticket_pesee: null,
    notes: '',
  });

  // Factures
  const [factures, setFactures] = useState([]);
  const [showFactureForm, setShowFactureForm] = useState(false);
  const [commandesPesee, setCommandesPesee] = useState([]);
  const [factureForm, setFactureForm] = useState({
    commande_id: '',
    facture: null,
  });
  const [showOcrModal, setShowOcrModal] = useState(null);
  const [ocrForm, setOcrForm] = useState({
    ocr_date: '',
    ocr_tonnage: '',
    ocr_montant: '',
  });

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      const [controlesRes, facturesRes] = await Promise.all([
        api.get('/controles-pesee'),
        api.get('/factures-exutoires'),
      ]);
      setControles(controlesRes.data);
      setFactures(facturesRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadControles = async () => {
    try {
      const res = await api.get('/controles-pesee');
      setControles(res.data);
    } catch (err) { console.error(err); }
  };

  const loadFactures = async () => {
    try {
      const res = await api.get('/factures-exutoires');
      setFactures(res.data);
    } catch (err) { console.error(err); }
  };

  const loadCommandesExpediees = async () => {
    try {
      const res = await api.get('/commandes-exutoires', { params: { statut: 'expediee' } });
      setCommandesExpediees(res.data);
    } catch (err) { console.error(err); }
  };

  const loadCommandesPesee = async () => {
    try {
      const res = await api.get('/commandes-exutoires', { params: { statut: 'pesee_recue' } });
      setCommandesPesee(res.data);
    } catch (err) { console.error(err); }
  };

  // --- Contrôles pesée ---

  const openControleForm = () => {
    setControleForm({ commande_id: '', pesee_client: '', date_reception_ticket: '', ticket_pesee: null, notes: '' });
    loadCommandesExpediees();
    setShowControleForm(true);
  };

  const submitControle = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('commande_id', controleForm.commande_id);
    fd.append('pesee_client', controleForm.pesee_client);
    fd.append('date_reception_ticket', controleForm.date_reception_ticket);
    if (controleForm.ticket_pesee) fd.append('ticket_pesee', controleForm.ticket_pesee);
    if (controleForm.notes) fd.append('notes', controleForm.notes);
    try {
      await api.post('/controles-pesee', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowControleForm(false);
      loadControles();
    } catch (err) { console.error(err); }
  };

  const validerControle = async (id) => {
    try {
      await api.patch(`/controles-pesee/${id}/valider`);
      loadControles();
    } catch (err) { console.error(err); }
  };

  // --- Factures ---

  const openFactureForm = () => {
    setFactureForm({ commande_id: '', facture: null });
    loadCommandesPesee();
    setShowFactureForm(true);
  };

  const submitFacture = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('commande_id', factureForm.commande_id);
    if (factureForm.facture) fd.append('facture', factureForm.facture);
    try {
      const res = await api.post('/factures-exutoires', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowFactureForm(false);
      loadFactures();
      // Open OCR correction modal with returned data
      if (res.data) {
        openOcrModal(res.data);
      }
    } catch (err) { console.error(err); }
  };

  const openOcrModal = (facture) => {
    setOcrForm({
      ocr_date: facture.ocr_date || '',
      ocr_tonnage: facture.ocr_tonnage != null ? String(facture.ocr_tonnage) : '',
      ocr_montant: facture.ocr_montant != null ? String(facture.ocr_montant) : '',
    });
    setShowOcrModal(facture);
  };

  const submitOcrCorrection = async () => {
    if (!showOcrModal) return;
    try {
      await api.put(`/factures-exutoires/${showOcrModal.id}`, {
        ocr_date: ocrForm.ocr_date || null,
        ocr_tonnage: ocrForm.ocr_tonnage ? parseFloat(ocrForm.ocr_tonnage) : null,
        ocr_montant: ocrForm.ocr_montant ? parseFloat(ocrForm.ocr_montant) : null,
      });
      setShowOcrModal(null);
      loadFactures();
    } catch (err) { console.error(err); }
  };

  const validerFacture = async (id) => {
    try {
      await api.patch(`/factures-exutoires/${id}/valider`);
      loadFactures();
    } catch (err) { console.error(err); }
  };

  // --- Helpers ---

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
  const formatTonnage = (v) => v != null ? parseFloat(v).toFixed(3) : '—';
  const formatAmount = (v) => v != null ? parseFloat(v).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €' : '—';
  const formatPercent = (v) => v != null ? parseFloat(v).toFixed(2) + ' %' : '—';

  const ecartColor = (pct) => {
    if (pct == null) return '';
    const abs = Math.abs(parseFloat(pct));
    if (abs > 5) return 'text-red-600 font-semibold';
    if (abs > 2) return 'text-yellow-600 font-medium';
    return 'text-green-600';
  };

  // Summary stats for pesée
  const peseeStats = {
    conformes: controles.filter(c => c.statut === 'conforme').length,
    ecarts: controles.filter(c => c.statut === 'ecart_acceptable').length,
    litiges: controles.filter(c => c.statut === 'litige').length,
    en_attente: controles.filter(c => c.statut !== 'valide').length,
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Facturation & Contrôles</h1>
            <p className="text-gray-500 text-sm">Contrôles de pesée et gestion des factures exutoires</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('pesee')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'pesee'
                ? 'bg-white text-solidata-dark shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Contrôles Pesée
          </button>
          <button
            onClick={() => setActiveTab('factures')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'factures'
                ? 'bg-white text-solidata-dark shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Factures
          </button>
        </div>

        {/* ========== TAB: Contrôles Pesée ========== */}
        {activeTab === 'pesee' && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 font-medium">Conformes</p>
                <p className="text-2xl font-bold text-green-600">{peseeStats.conformes}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 font-medium">Écarts acceptables</p>
                <p className="text-2xl font-bold text-yellow-600">{peseeStats.ecarts}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 font-medium">Litiges</p>
                <p className="text-2xl font-bold text-red-600">{peseeStats.litiges}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 font-medium">En attente validation</p>
                <p className="text-2xl font-bold text-blue-600">{peseeStats.en_attente}</p>
              </div>
            </div>

            {/* Action button */}
            <div className="flex justify-end mb-4">
              <button onClick={openControleForm} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
                + Nouveau contrôle
              </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Commande</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Client</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Type</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Pesée interne (t)</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Pesée client (t)</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Écart (t)</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Écart (%)</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {controles.map(ctrl => {
                    const statut = STATUTS_PESEE[ctrl.statut] || { label: ctrl.statut, color: 'bg-gray-100 text-gray-700' };
                    return (
                      <tr key={ctrl.id} className="border-t hover:bg-gray-50">
                        <td className="p-3 text-sm font-medium font-mono">{ctrl.commande_reference || `#${ctrl.commande_id}`}</td>
                        <td className="p-3 text-sm">{ctrl.client_nom || '—'}</td>
                        <td className="p-3 text-sm">{ctrl.type_produit || '—'}</td>
                        <td className="p-3 text-sm text-right font-mono">{formatTonnage(ctrl.pesee_interne)}</td>
                        <td className="p-3 text-sm text-right font-mono">{formatTonnage(ctrl.pesee_client)}</td>
                        <td className={`p-3 text-sm text-right font-mono ${ecartColor(ctrl.ecart_pct)}`}>{formatTonnage(ctrl.ecart)}</td>
                        <td className={`p-3 text-sm text-right font-mono ${ecartColor(ctrl.ecart_pct)}`}>{formatPercent(ctrl.ecart_pct)}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${statut.color}`}>
                            {statut.label}
                          </span>
                        </td>
                        <td className="p-3 text-sm">{formatDate(ctrl.date_reception_ticket)}</td>
                        <td className="p-3">
                          {ctrl.statut !== 'valide' && (
                            <button
                              onClick={() => validerControle(ctrl.id)}
                              className="text-solidata-green hover:underline text-sm font-medium"
                            >
                              Valider
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {controles.length === 0 && (
                    <tr><td colSpan="10" className="p-8 text-center text-gray-400">Aucun contrôle de pesée</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ========== TAB: Factures ========== */}
        {activeTab === 'factures' && (
          <>
            {/* Action button */}
            <div className="flex justify-end mb-4">
              <button onClick={openFactureForm} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
                + Uploader une facture
              </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Commande</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Client</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Date OCR</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Tonnage OCR</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Montant OCR (€)</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Montant attendu (€)</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-500">Écart (€)</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map(fac => {
                    const statut = STATUTS_FACTURE[fac.statut] || { label: fac.statut, color: 'bg-gray-100 text-gray-700' };
                    const ecartMontant = (fac.ocr_montant != null && fac.montant_attendu != null)
                      ? parseFloat(fac.ocr_montant) - parseFloat(fac.montant_attendu)
                      : null;
                    return (
                      <tr key={fac.id} className="border-t hover:bg-gray-50">
                        <td className="p-3 text-sm font-medium font-mono">{fac.commande_reference || `#${fac.commande_id}`}</td>
                        <td className="p-3 text-sm">{fac.client_nom || '—'}</td>
                        <td className="p-3 text-sm">{formatDate(fac.ocr_date)}</td>
                        <td className="p-3 text-sm text-right font-mono">{formatTonnage(fac.ocr_tonnage)}</td>
                        <td className="p-3 text-sm text-right font-mono">{formatAmount(fac.ocr_montant)}</td>
                        <td className="p-3 text-sm text-right font-mono">{formatAmount(fac.montant_attendu)}</td>
                        <td className={`p-3 text-sm text-right font-mono ${ecartMontant != null && Math.abs(ecartMontant) > 0.01 ? 'text-red-600 font-semibold' : 'text-green-600'}`}>
                          {ecartMontant != null ? ecartMontant.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €' : '—'}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${statut.color}`}>
                            {statut.label}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => openOcrModal(fac)}
                              className="text-blue-600 hover:underline text-sm font-medium"
                            >
                              Corriger
                            </button>
                            {fac.statut !== 'validee' && (
                              <button
                                onClick={() => validerFacture(fac.id)}
                                className="text-solidata-green hover:underline text-sm font-medium"
                              >
                                Valider
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {factures.length === 0 && (
                    <tr><td colSpan="9" className="p-8 text-center text-gray-400">Aucune facture exutoire</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ========== MODAL: Nouveau contrôle pesée ========== */}
        {showControleForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowControleForm(false)}>
            <form onSubmit={submitControle} className="bg-white rounded-xl p-6 w-[520px] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-4 text-solidata-dark">Nouveau contrôle de pesée</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Commande *</label>
                  <select
                    value={controleForm.commande_id}
                    onChange={e => setControleForm({ ...controleForm, commande_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  >
                    <option value="">Sélectionner une commande...</option>
                    {commandesExpediees.map(cmd => (
                      <option key={cmd.id} value={cmd.id}>
                        {cmd.reference} — {cmd.client_nom || 'Client'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Pesée client (tonnes) *</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={controleForm.pesee_client}
                    onChange={e => setControleForm({ ...controleForm, pesee_client: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    placeholder="0.000"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Date de réception du ticket *</label>
                  <input
                    type="date"
                    value={controleForm.date_reception_ticket}
                    onChange={e => setControleForm({ ...controleForm, date_reception_ticket: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Ticket de pesée (PDF)</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => setControleForm({ ...controleForm, ticket_pesee: e.target.files[0] || null })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Notes</label>
                  <textarea
                    value={controleForm.notes}
                    onChange={e => setControleForm({ ...controleForm, notes: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    rows={3}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowControleForm(false)} className="flex-1 border rounded-lg py-2 text-sm">
                  Annuler
                </button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">
                  Créer
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ========== MODAL: Upload facture ========== */}
        {showFactureForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowFactureForm(false)}>
            <form onSubmit={submitFacture} className="bg-white rounded-xl p-6 w-[520px] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-4 text-solidata-dark">Uploader une facture</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Commande *</label>
                  <select
                    value={factureForm.commande_id}
                    onChange={e => setFactureForm({ ...factureForm, commande_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  >
                    <option value="">Sélectionner une commande...</option>
                    {commandesPesee.map(cmd => (
                      <option key={cmd.id} value={cmd.id}>
                        {cmd.reference} — {cmd.client_nom || 'Client'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Facture (PDF) *</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => setFactureForm({ ...factureForm, facture: e.target.files[0] || null })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowFactureForm(false)} className="flex-1 border rounded-lg py-2 text-sm">
                  Annuler
                </button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">
                  Uploader
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ========== MODAL: Correction OCR ========== */}
        {showOcrModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowOcrModal(null)}>
            <div className="bg-white rounded-xl p-6 w-[480px] shadow-xl" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-2 text-solidata-dark">Correction OCR</h2>
              <p className="text-sm text-gray-500 mb-4">
                Vérifiez et corrigez les valeurs extraites de la facture{' '}
                <span className="font-medium text-gray-700">{showOcrModal.commande_reference || `#${showOcrModal.commande_id}`}</span>
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Date extraite</label>
                  <input
                    type="date"
                    value={ocrForm.ocr_date}
                    onChange={e => setOcrForm({ ...ocrForm, ocr_date: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Tonnage extrait (tonnes)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={ocrForm.ocr_tonnage}
                    onChange={e => setOcrForm({ ...ocrForm, ocr_tonnage: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    placeholder="0.000"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Montant extrait (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={ocrForm.ocr_montant}
                    onChange={e => setOcrForm({ ...ocrForm, ocr_montant: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowOcrModal(null)} className="flex-1 border rounded-lg py-2 text-sm">
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={submitOcrCorrection}
                  className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium"
                >
                  Corriger
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
