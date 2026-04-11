import { useState, useEffect, useCallback } from 'react';
import { Warehouse, Scale, TrendingUp, ArrowDownUp, Plus, Lock, BookOpen, Download, Printer } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge } from '../components';
import api from '../services/api';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const ORIGINES_LABELS = {
  collecte_pav: 'Collecte PAV',
  collecte_association: 'Collecte association',
  retour_vak: 'Retour VAK',
  retour_magasin: 'Retour magasin',
  apport_volontaire: 'Apport volontaire',
  tri_batch: 'Tri (lot)',
  expedition_original: 'Expédition original',
  regularisation: 'Régularisation',
};

export default function InventaireOriginal() {
  const [activeTab, setActiveTab] = useState('historique');
  const [movements, setMovements] = useState([]);
  const [summary, setSummary] = useState(null);
  const [evolution, setEvolution] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ type: '', date_from: '', date_to: '', origine: '' });
  const [period, setPeriod] = useState(90);
  const [peseeMode, setPeseeMode] = useState('net'); // 'net' | 'brut_tare'
  const [peseeForm, setPeseeForm] = useState({
    date: new Date().toISOString().split('T')[0],
    poids_kg: '', poids_brut_kg: '', tare_kg: '',
    origine: 'retour_vak', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [ledger, setLedger] = useState({ lignes: [], totaux: null });
  const [ledgerFilters, setLedgerFilters] = useState({ date_from: '', date_to: '' });

  const loadMovements = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.type) params.set('type', filters.type);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (filters.origine) params.set('origine', filters.origine);
      params.set('limit', '200');
      const res = await api.get(`/stock-original?${params}`);
      setMovements(res.data);
    } catch (err) { console.error(err); }
  }, [filters]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.get('/stock-original/summary');
      setSummary(res.data);
    } catch (err) { console.error(err); }
  }, []);

  const loadEvolution = useCallback(async () => {
    try {
      const dateTo = new Date().toISOString().split('T')[0];
      const dateFrom = new Date(Date.now() - period * 86400000).toISOString().split('T')[0];
      const gran = period <= 30 ? 'day' : period <= 90 ? 'day' : 'week';
      const res = await api.get(`/stock-original/evolution?date_from=${dateFrom}&date_to=${dateTo}&granularity=${gran}`);
      setEvolution(res.data.map(r => ({
        ...r,
        period: new Date(r.period).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        entrees_kg: parseFloat(r.entrees_kg),
        sorties_kg: parseFloat(r.sorties_kg),
        stock_cumule_kg: parseFloat(r.stock_cumule_kg),
      })));
    } catch (err) { console.error(err); }
  }, [period]);

  const loadLedger = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (ledgerFilters.date_from) params.set('date_from', ledgerFilters.date_from);
      if (ledgerFilters.date_to) params.set('date_to', ledgerFilters.date_to);
      const res = await api.get(`/stock-original/ledger?${params}`);
      setLedger(res.data);
    } catch (err) { console.error(err); }
  }, [ledgerFilters]);

  useEffect(() => {
    Promise.all([loadMovements(), loadSummary(), loadEvolution(), loadLedger()])
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadMovements(); }, [filters, loadMovements]);
  useEffect(() => { loadEvolution(); }, [period, loadEvolution]);
  useEffect(() => { loadLedger(); }, [ledgerFilters, loadLedger]);

  const handlePesee = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const payload = {
        date: peseeForm.date,
        origine: peseeForm.origine,
        notes: peseeForm.notes || null,
      };
      if (peseeMode === 'brut_tare') {
        payload.poids_brut_kg = parseFloat(peseeForm.poids_brut_kg);
        payload.tare_kg = parseFloat(peseeForm.tare_kg);
        payload.poids_kg = payload.poids_brut_kg - payload.tare_kg;
      } else {
        payload.poids_kg = parseFloat(peseeForm.poids_kg);
      }
      await api.post('/stock-original/pesee', payload);
      setMessage({ type: 'success', text: `Pesee enregistree : ${payload.poids_kg} kg` });
      setPeseeForm({ ...peseeForm, poids_kg: '', poids_brut_kg: '', tare_kg: '', notes: '' });
      loadMovements();
      loadSummary();
      loadEvolution();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Erreur serveur' });
    }
    setSubmitting(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement inventaire original..." /></Layout>;

  const stockActuel = summary ? parseFloat(summary.stock_actuel_kg || 0) : 0;
  const totalEntrees = summary ? parseFloat(summary.total_entrees_kg || 0) : 0;
  const totalSorties = summary ? parseFloat(summary.total_sorties_kg || 0) : 0;
  const totalRegul = summary ? parseFloat(summary.total_regularisation_kg || 0) : 0;

  const tabs = [
    { id: 'historique', label: 'Historique', icon: ArrowDownUp },
    { id: 'journal', label: 'Journal de stock', icon: BookOpen },
    { id: 'pesee', label: 'Pesee manuelle', icon: Scale },
    { id: 'inventaire', label: 'Inventaire permanent', icon: TrendingUp },
  ];

  const movementColumns = [
    { key: 'date', label: 'Date', sortable: true, render: (m) => new Date(m.date).toLocaleDateString('fr-FR') },
    {
      key: 'type', label: 'Type', sortable: true,
      render: (m) => {
        const colors = { entree: 'bg-green-100 text-green-700', sortie: 'bg-red-100 text-red-700', regularisation: 'bg-amber-100 text-amber-700' };
        const labels = { entree: 'Entree', sortie: 'Sortie', regularisation: 'Regul.' };
        return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[m.type]}`}>{labels[m.type]}</span>;
      },
    },
    {
      key: 'poids_kg', label: 'Poids (kg)', sortable: true,
      render: (m) => {
        const val = parseFloat(m.poids_kg);
        const color = m.type === 'entree' ? 'text-green-600' : m.type === 'sortie' ? 'text-red-600' : val >= 0 ? 'text-amber-600' : 'text-red-600';
        return <span className={`font-medium ${color}`}>{m.type === 'sortie' ? '-' : ''}{Math.abs(val).toFixed(1)}</span>;
      },
    },
    { key: 'origine', label: 'Origine', render: (m) => <span className="text-slate-600 text-sm">{ORIGINES_LABELS[m.origine] || m.origine || '—'}</span> },
    { key: 'destination', label: 'Destination', render: (m) => <span className="text-slate-500 text-sm">{m.destination || '—'}</span> },
    { key: 'notes', label: 'Notes', render: (m) => <span className="text-slate-400 max-w-[200px] truncate block text-sm">{m.notes || '—'}</span> },
    { key: 'created_by_name', label: 'Par', render: (m) => <span className="text-slate-400 text-sm">{m.created_by_name || '—'}</span> },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Warehouse className="w-6 h-6 text-primary" strokeWidth={1.8} />
              Inventaire Original
            </h1>
            <p className="text-slate-500">Stock brut de collecte : <span className="font-semibold text-slate-700">{(stockActuel / 1000).toFixed(2)} tonnes</span></p>
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

        {/* Onglet Historique */}
        {activeTab === 'historique' && (
          <>
            {/* Filtres */}
            <div className="flex gap-3 mb-4 flex-wrap">
              <select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })} className="select-modern text-sm">
                <option value="">Tous les types</option>
                <option value="entree">Entrees</option>
                <option value="sortie">Sorties</option>
                <option value="regularisation">Regularisations</option>
              </select>
              <select value={filters.origine} onChange={e => setFilters({ ...filters, origine: e.target.value })} className="select-modern text-sm">
                <option value="">Toutes les origines</option>
                {Object.entries(ORIGINES_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input type="date" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} className="input-modern text-sm" />
              <input type="date" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} className="input-modern text-sm" />
              {(filters.type || filters.origine || filters.date_from || filters.date_to) && (
                <button onClick={() => setFilters({ type: '', date_from: '', date_to: '', origine: '' })} className="text-sm text-primary hover:underline">
                  Reinitialiser
                </button>
              )}
            </div>

            <DataTable
              columns={movementColumns}
              data={movements}
              loading={false}
              emptyIcon={ArrowDownUp}
              emptyMessage="Aucun mouvement de stock original"
              dense
            />
          </>
        )}

        {/* Onglet Journal de stock — grand livre ligne par ligne */}
        {activeTab === 'journal' && (
          <>
            {/* Filtres date + export */}
            <div className="flex gap-3 mb-4 items-center flex-wrap">
              <span className="text-sm text-slate-500">Periode :</span>
              <input type="date" value={ledgerFilters.date_from} onChange={e => setLedgerFilters({ ...ledgerFilters, date_from: e.target.value })} className="input-modern text-sm" />
              <span className="text-slate-400">—</span>
              <input type="date" value={ledgerFilters.date_to} onChange={e => setLedgerFilters({ ...ledgerFilters, date_to: e.target.value })} className="input-modern text-sm" />
              {(ledgerFilters.date_from || ledgerFilters.date_to) && (
                <button onClick={() => setLedgerFilters({ date_from: '', date_to: '' })} className="text-sm text-primary hover:underline">
                  Reinitialiser
                </button>
              )}
              <div className="ml-auto">
                <button onClick={() => {
                  const rows = ledger.lignes.map((l, i) => [
                    i + 1, new Date(l.date).toLocaleDateString('fr-FR'), l.type,
                    ORIGINES_LABELS[l.origine] || l.origine || '',
                    l.type === 'entree' ? parseFloat(l.entree_kg).toFixed(1) : '',
                    l.type === 'sortie' ? parseFloat(l.sortie_kg).toFixed(1) : '',
                    l.type === 'regularisation' && parseFloat(l.poids_kg) >= 0 ? parseFloat(l.regul_plus_kg).toFixed(1) : '',
                    l.type === 'regularisation' && parseFloat(l.poids_kg) < 0 ? parseFloat(l.regul_moins_kg).toFixed(1) : '',
                    parseFloat(l.solde_cumule_kg).toFixed(1),
                    l.notes || '',
                  ].join(';'));
                  const header = '#;Date;Type;Origine;Entree (kg);Sortie (kg);Regul+ (kg);Regul- (kg);Solde (kg);Notes';
                  const csv = [header, ...rows].join('\n');
                  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url;
                  a.download = `journal-stock-original-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click(); URL.revokeObjectURL(url);
                }} className="btn-ghost text-sm flex items-center gap-1.5">
                  <Download className="w-4 h-4" strokeWidth={1.8} /> Export CSV
                </button>
              </div>
            </div>

            {/* Totaux en haut */}
            {ledger.totaux && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div className="card-modern p-3 text-center">
                  <p className="text-xs text-slate-400">Lignes</p>
                  <p className="text-lg font-bold text-slate-700">{ledger.totaux.nb_lignes}</p>
                </div>
                <div className="card-modern p-3 text-center">
                  <p className="text-xs text-slate-400">Total entrees</p>
                  <p className="text-lg font-bold text-green-600">+{(ledger.totaux.total_entrees_kg / 1000).toFixed(2)} t</p>
                </div>
                <div className="card-modern p-3 text-center">
                  <p className="text-xs text-slate-400">Total sorties</p>
                  <p className="text-lg font-bold text-red-600">-{(ledger.totaux.total_sorties_kg / 1000).toFixed(2)} t</p>
                </div>
                <div className="card-modern p-3 text-center">
                  <p className="text-xs text-slate-400">Regularisations</p>
                  <p className="text-lg font-bold text-amber-600">
                    {ledger.totaux.total_regul_plus_kg > 0 && `+${(ledger.totaux.total_regul_plus_kg / 1000).toFixed(2)}`}
                    {ledger.totaux.total_regul_plus_kg > 0 && ledger.totaux.total_regul_moins_kg > 0 && ' / '}
                    {ledger.totaux.total_regul_moins_kg > 0 && `-${(ledger.totaux.total_regul_moins_kg / 1000).toFixed(2)}`}
                    {ledger.totaux.total_regul_plus_kg === 0 && ledger.totaux.total_regul_moins_kg === 0 && '0'} t
                  </p>
                </div>
                <div className="card-modern p-3 text-center border-primary/30 bg-primary/5">
                  <p className="text-xs text-slate-400">Solde final</p>
                  <p className="text-lg font-bold text-primary">{(ledger.totaux.solde_final_kg / 1000).toFixed(2)} t</p>
                </div>
              </div>
            )}

            {/* Tableau grand livre */}
            <div className="card-modern overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="text-left p-2.5 text-xs font-semibold text-slate-500 w-10">#</th>
                      <th className="text-left p-2.5 text-xs font-semibold text-slate-500">Date</th>
                      <th className="text-left p-2.5 text-xs font-semibold text-slate-500">Type</th>
                      <th className="text-left p-2.5 text-xs font-semibold text-slate-500">Origine / Reference</th>
                      <th className="text-right p-2.5 text-xs font-semibold text-green-600 bg-green-50/50">Entree (kg)</th>
                      <th className="text-right p-2.5 text-xs font-semibold text-red-600 bg-red-50/50">Sortie (kg)</th>
                      <th className="text-right p-2.5 text-xs font-semibold text-amber-600 bg-amber-50/50">Regul. (kg)</th>
                      <th className="text-right p-2.5 text-xs font-semibold text-primary bg-blue-50/50">Solde (kg)</th>
                      <th className="text-left p-2.5 text-xs font-semibold text-slate-500">Notes</th>
                      <th className="text-left p-2.5 text-xs font-semibold text-slate-500">Par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.lignes.map((l, idx) => {
                      const ref = l.tour_id ? `Tournee #${l.tour_id}` :
                                  l.batch_id ? `Lot #${l.batch_id}` :
                                  l.expedition_id ? `Expedition #${l.expedition_id}` :
                                  ORIGINES_LABELS[l.origine] || l.origine || '—';
                      return (
                        <tr key={l.id} className={`border-b hover:bg-slate-50 ${idx % 2 === 0 ? '' : 'bg-slate-25'}`}>
                          <td className="p-2.5 text-xs text-slate-300">{idx + 1}</td>
                          <td className="p-2.5 text-sm text-slate-700 whitespace-nowrap">{new Date(l.date).toLocaleDateString('fr-FR')}</td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              l.type === 'entree' ? 'bg-green-100 text-green-700' :
                              l.type === 'sortie' ? 'bg-red-100 text-red-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {l.type === 'entree' ? 'Entree' : l.type === 'sortie' ? 'Sortie' : 'Regul.'}
                            </span>
                          </td>
                          <td className="p-2.5 text-sm text-slate-600">{ref}</td>
                          <td className="p-2.5 text-right font-mono text-sm bg-green-50/30">
                            {parseFloat(l.entree_kg) > 0 ? <span className="text-green-600 font-medium">{parseFloat(l.entree_kg).toFixed(1)}</span> : <span className="text-slate-200">—</span>}
                          </td>
                          <td className="p-2.5 text-right font-mono text-sm bg-red-50/30">
                            {parseFloat(l.sortie_kg) > 0 ? <span className="text-red-600 font-medium">{parseFloat(l.sortie_kg).toFixed(1)}</span> : <span className="text-slate-200">—</span>}
                          </td>
                          <td className="p-2.5 text-right font-mono text-sm bg-amber-50/30">
                            {l.type === 'regularisation' ? (
                              <span className={parseFloat(l.poids_kg) >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                {parseFloat(l.poids_kg) >= 0 ? '+' : ''}{parseFloat(l.poids_kg).toFixed(1)}
                              </span>
                            ) : <span className="text-slate-200">—</span>}
                          </td>
                          <td className="p-2.5 text-right font-mono text-sm font-semibold text-primary bg-blue-50/30">
                            {parseFloat(l.solde_cumule_kg).toFixed(1)}
                          </td>
                          <td className="p-2.5 text-xs text-slate-400 max-w-[180px] truncate">{l.notes || '—'}</td>
                          <td className="p-2.5 text-xs text-slate-400 whitespace-nowrap">{l.created_by_name || '—'}</td>
                        </tr>
                      );
                    })}
                    {ledger.lignes.length === 0 && (
                      <tr><td colSpan={10} className="p-8 text-center text-slate-400">Aucun mouvement enregistre</td></tr>
                    )}
                  </tbody>
                  {ledger.lignes.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-100 font-semibold text-sm border-t-2">
                        <td colSpan={4} className="p-2.5 text-right text-slate-500">TOTAUX</td>
                        <td className="p-2.5 text-right font-mono text-green-700 bg-green-50/50">{ledger.totaux.total_entrees_kg.toFixed(1)}</td>
                        <td className="p-2.5 text-right font-mono text-red-700 bg-red-50/50">{ledger.totaux.total_sorties_kg.toFixed(1)}</td>
                        <td className="p-2.5 text-right font-mono text-amber-700 bg-amber-50/50">
                          {(ledger.totaux.total_regul_plus_kg - ledger.totaux.total_regul_moins_kg).toFixed(1)}
                        </td>
                        <td className="p-2.5 text-right font-mono text-primary font-bold bg-blue-50/50">{ledger.totaux.solde_final_kg.toFixed(1)}</td>
                        <td colSpan={2} className="p-2.5"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}

        {/* Onglet Pesee manuelle */}
        {activeTab === 'pesee' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-modern p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Scale className="w-5 h-5 text-primary" strokeWidth={1.8} />
                Nouvelle pesee
              </h2>

              {message && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {message.text}
                </div>
              )}

              <form onSubmit={handlePesee} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                  <input type="date" value={peseeForm.date} onChange={e => setPeseeForm({ ...peseeForm, date: e.target.value })} className="input-modern" required />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Origine</label>
                  <select value={peseeForm.origine} onChange={e => setPeseeForm({ ...peseeForm, origine: e.target.value })} className="select-modern" required>
                    <option value="retour_vak">Retour VAK</option>
                    <option value="retour_magasin">Retour magasin</option>
                    <option value="apport_volontaire">Apport volontaire</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">Mode de pesee</label>
                  <div className="flex bg-slate-100 rounded-lg p-0.5 w-fit">
                    <button type="button" onClick={() => setPeseeMode('net')}
                      className={`px-3 py-1.5 rounded-md text-sm ${peseeMode === 'net' ? 'bg-white shadow font-medium' : 'text-slate-500'}`}>
                      Poids net
                    </button>
                    <button type="button" onClick={() => setPeseeMode('brut_tare')}
                      className={`px-3 py-1.5 rounded-md text-sm ${peseeMode === 'brut_tare' ? 'bg-white shadow font-medium' : 'text-slate-500'}`}>
                      Brut - Tare
                    </button>
                  </div>
                </div>

                {peseeMode === 'net' ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Poids net (kg)</label>
                    <input type="number" step="0.1" min="0.1" value={peseeForm.poids_kg}
                      onChange={e => setPeseeForm({ ...peseeForm, poids_kg: e.target.value })}
                      className="input-modern" placeholder="Ex: 500" required />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">Poids brut (kg)</label>
                      <input type="number" step="0.1" min="0" value={peseeForm.poids_brut_kg}
                        onChange={e => setPeseeForm({ ...peseeForm, poids_brut_kg: e.target.value })}
                        className="input-modern" placeholder="Ex: 3500" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">Tare (kg)</label>
                      <input type="number" step="0.1" min="0" value={peseeForm.tare_kg}
                        onChange={e => setPeseeForm({ ...peseeForm, tare_kg: e.target.value })}
                        className="input-modern" placeholder="Ex: 3000" required />
                    </div>
                    {peseeForm.poids_brut_kg && peseeForm.tare_kg && (
                      <div className="col-span-2 p-2 bg-slate-50 rounded text-sm text-slate-600">
                        Poids net : <span className="font-bold text-primary">{(parseFloat(peseeForm.poids_brut_kg) - parseFloat(peseeForm.tare_kg)).toFixed(1)} kg</span>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
                  <textarea value={peseeForm.notes} onChange={e => setPeseeForm({ ...peseeForm, notes: e.target.value })} className="textarea-modern" rows="2" placeholder="Observations..." />
                </div>

                <button type="submit" disabled={submitting} className="w-full btn-primary text-sm">
                  {submitting ? 'Enregistrement...' : 'Enregistrer la pesee'}
                </button>
              </form>
            </div>

            {/* Dernieres pesees */}
            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-3">Dernieres pesees manuelles</h3>
              <div className="space-y-2">
                {movements.filter(m => m.type === 'entree' && ['retour_vak', 'retour_magasin', 'apport_volontaire'].includes(m.origine)).slice(0, 10).map(m => (
                  <div key={m.id} className="card-modern p-3 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{ORIGINES_LABELS[m.origine]}</span>
                      <p className="text-xs text-slate-400">{new Date(m.date).toLocaleDateString('fr-FR')} — {m.created_by_name}</p>
                    </div>
                    <span className="font-bold text-green-600">+{parseFloat(m.poids_kg).toFixed(1)} kg</span>
                  </div>
                ))}
                {movements.filter(m => m.type === 'entree' && ['retour_vak', 'retour_magasin', 'apport_volontaire'].includes(m.origine)).length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-8">Aucune pesee manuelle enregistree</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Onglet Inventaire permanent */}
        {activeTab === 'inventaire' && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="card-modern p-4">
                <p className="text-xs text-slate-500">Stock actuel</p>
                <p className="text-2xl font-bold text-slate-800">{(stockActuel / 1000).toFixed(2)}<span className="text-sm font-normal text-slate-400 ml-1">t</span></p>
              </div>
              <div className="card-modern p-4">
                <p className="text-xs text-slate-500">Total entrees</p>
                <p className="text-2xl font-bold text-green-600">{(totalEntrees / 1000).toFixed(2)}<span className="text-sm font-normal text-slate-400 ml-1">t</span></p>
              </div>
              <div className="card-modern p-4">
                <p className="text-xs text-slate-500">Total sorties</p>
                <p className="text-2xl font-bold text-red-600">{(totalSorties / 1000).toFixed(2)}<span className="text-sm font-normal text-slate-400 ml-1">t</span></p>
              </div>
              <div className="card-modern p-4">
                <p className="text-xs text-slate-500">Regularisations</p>
                <p className={`text-2xl font-bold ${totalRegul >= 0 ? 'text-amber-600' : 'text-red-600'}`}>{totalRegul >= 0 ? '+' : ''}{(totalRegul / 1000).toFixed(2)}<span className="text-sm font-normal text-slate-400 ml-1">t</span></p>
              </div>
            </div>

            {/* Period selector */}
            <div className="flex gap-2 mb-4">
              {[{ days: 30, label: '30 jours' }, { days: 90, label: '90 jours' }, { days: 365, label: '1 an' }].map(p => (
                <button key={p.days} onClick={() => setPeriod(p.days)}
                  className={`px-3 py-1.5 rounded-md text-sm ${period === p.days ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Chart */}
            <div className="card-modern p-6">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">Evolution du stock original</h3>
              {evolution.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <ComposedChart data={evolution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'kg', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: 'Stock cumule (kg)', angle: 90, position: 'insideRight', style: { fontSize: 11 } }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="entrees_kg" fill="#22c55e" name="Entrees (kg)" radius={[2, 2, 0, 0]} />
                    <Bar yAxisId="left" dataKey="sorties_kg" fill="#ef4444" name="Sorties (kg)" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="stock_cumule_kg" stroke="#3b82f6" strokeWidth={2} name="Stock cumule (kg)" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-slate-400 py-12">Aucune donnee pour la periode selectionnee</p>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
