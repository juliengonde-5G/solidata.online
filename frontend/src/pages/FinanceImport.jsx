import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, DataTable, StatusBadge, LoadingSpinner } from '../components';

// ══════════════════════════════════════════
// FINANCE IMPORT — Import fichiers comptables
// Upload GL, Transactions, Budget + Historique
// ══════════════════════════════════════════

const IMPORT_ZONES = [
  {
    key: 'gl',
    label: 'Grand Livre (GL)',
    description: 'Fichier CSV/Excel des ecritures du grand livre',
    endpoint: '/finance/import/gl',
    accept: '.csv,.xlsx,.xls',
  },
  {
    key: 'transactions',
    label: 'Ecritures bancaires',
    description: 'Releves bancaires ou ecritures de tresorerie',
    endpoint: '/finance/import/transactions',
    accept: '.csv,.xlsx,.xls,.ofx',
  },
  {
    key: 'budget',
    label: 'Budget',
    description: 'Budget previsionnel par compte et par mois',
    endpoint: '/finance/import/budget',
    accept: '.csv,.xlsx,.xls',
  },
];

const LOG_COLUMNS = [
  { key: 'date', label: 'Date', sortable: true, render: (row) => formatDate(row.date) },
  { key: 'type', label: 'Type', sortable: true, render: (row) => (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
      {row.type === 'gl' ? 'Grand Livre' : row.type === 'transactions' ? 'Ecritures' : 'Budget'}
    </span>
  )},
  { key: 'filename', label: 'Fichier', sortable: true },
  { key: 'lignes', label: 'Lignes', sortable: true, render: (row) => fmt(row.lignes) },
  { key: 'status', label: 'Statut', sortable: true, render: (row) => (
    <StatusBadge status={row.status} />
  )},
  { key: 'user', label: 'Utilisateur', sortable: true },
];

const fmt = (v) => v != null ? Number(v).toLocaleString('fr-FR') : '—';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function FinanceImport() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadStates, setUploadStates] = useState({});

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/finance/logs', { params: { year } });
      setLogs(res.data);
    } catch (err) {
      console.error('Erreur chargement logs import:', err);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleUpload = async (zone, file) => {
    if (!file) return;
    setUploadStates((s) => ({ ...s, [zone.key]: { uploading: true } }));

    const formData = new FormData();
    formData.append('file', file);
    formData.append('year', year);

    try {
      const res = await api.post(zone.endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadStates((s) => ({
        ...s,
        [zone.key]: { success: true, message: res.data?.message || `${fmt(res.data?.lignes || 0)} lignes importees` },
      }));
      loadLogs();
    } catch (err) {
      setUploadStates((s) => ({
        ...s,
        [zone.key]: { error: true, message: err.response?.data?.detail || 'Erreur lors de l\'import' },
      }));
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Import Comptable"
          subtitle="Importer les donnees financieres"
          icon={IconUpload}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Import' },
          ]}
          actions={
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          }
        />

        {/* Zones d'upload */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {IMPORT_ZONES.map((zone) => (
            <UploadZone
              key={zone.key}
              zone={zone}
              state={uploadStates[zone.key]}
              onUpload={(file) => handleUpload(zone, file)}
            />
          ))}
        </div>

        {/* Historique des imports */}
        <div className="card-modern p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <IconClock className="w-5 h-5 text-slate-400" />
            Historique des imports
          </h3>
          <DataTable
            columns={LOG_COLUMNS}
            data={logs}
            loading={loading}
            emptyMessage="Aucun import effectue"
          />
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// Upload Zone component
// ══════════════════════════════════════════

function UploadZone({ zone, state, onUpload }) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = '';
  };

  return (
    <div className="card-modern p-6">
      <h4 className="font-semibold text-slate-800 mb-1">{zone.label}</h4>
      <p className="text-xs text-slate-500 mb-4">{zone.description}</p>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragOver
            ? 'border-teal-400 bg-teal-50'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        {state?.uploading ? (
          <div className="flex flex-col items-center gap-2">
            <LoadingSpinner />
            <span className="text-sm text-slate-500">Import en cours...</span>
          </div>
        ) : (
          <>
            <IconUpload className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-600 font-medium">
              Glissez un fichier ici
            </p>
            <p className="text-xs text-slate-400 mt-1">ou cliquez pour selectionner</p>
            <p className="text-xs text-slate-400 mt-1">{zone.accept}</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={zone.accept}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Result badge */}
      {state?.success && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          <IconCheck className="w-4 h-4 flex-shrink-0" />
          {state.message}
        </div>
      )}
      {state?.error && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <IconX className="w-4 h-4 flex-shrink-0" />
          {state.message}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// SVG Icons
// ══════════════════════════════════════════

function IconUpload({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
}
function IconClock({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={1.8} /><path strokeLinecap="round" strokeWidth={1.8} d="M12 6v6l4 2" /></svg>;
}
function IconCheck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
}
function IconX({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
}
