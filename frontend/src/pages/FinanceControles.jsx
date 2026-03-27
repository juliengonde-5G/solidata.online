import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, LoadingSpinner } from '../components';

// ══════════════════════════════════════════
// FINANCE CONTROLES — Verifications automatiques
// 9 controles avec statuts vert/orange/rouge
// ══════════════════════════════════════════

const STATUS_CONFIG = {
  ok: { label: 'OK', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', icon: IconCheck },
  warning: { label: 'Attention', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', icon: IconAlert },
  error: { label: 'Erreur', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500', icon: IconX },
};

export default function FinanceControles() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/controles/${year}`);
      setChecks(res.data?.checks || res.data || []);
    } catch (err) {
      console.error('Erreur chargement controles:', err);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadChecks();
  }, [loadChecks]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post(`/finance/controles/${year}/refresh`);
      await loadChecks();
    } catch (err) {
      console.error('Erreur rafraichissement:', err);
    }
    setRefreshing(false);
  };

  const handleExport = async () => {
    try {
      const res = await api.get(`/finance/controles/${year}/export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `controles_finance_${year}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erreur export:', err);
    }
  };

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warning: checks.filter((c) => c.status === 'warning').length,
    error: checks.filter((c) => c.status === 'error').length,
  };

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Controles Finance"
          subtitle="Verifications automatiques des donnees comptables"
          icon={IconShield}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Controles' },
          ]}
          actions={
            <div className="flex items-center gap-3">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <IconRefresh className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Actualiser
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors"
              >
                <IconDownload className="w-4 h-4" />
                Exporter
              </button>
            </div>
          }
        />

        {/* Synthese badges */}
        {!loading && checks.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium text-emerald-700">{summary.ok} OK</span>
            </div>
            {summary.warning > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-sm font-medium text-amber-700">{summary.warning} Attention</span>
              </div>
            )}
            {summary.error > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-sm font-medium text-red-700">{summary.error} Erreur{summary.error > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        )}

        {/* Controles */}
        {loading ? (
          <div className="flex items-center justify-center py-32"><LoadingSpinner /></div>
        ) : checks.length === 0 ? (
          <div className="card-modern p-16 text-center">
            <IconShield className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Aucun controle disponible. Cliquez sur Actualiser pour lancer les verifications.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {checks.map((check, i) => {
              const config = STATUS_CONFIG[check.status] || STATUS_CONFIG.ok;
              const StatusIcon = config.icon;

              return (
                <div
                  key={check.key || i}
                  className={`rounded-xl border p-5 ${config.bg} ${config.border} transition-all hover:shadow-sm`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${config.dot}`} />
                      <span className={`text-xs font-semibold uppercase tracking-wider ${config.text}`}>
                        {config.label}
                      </span>
                    </div>
                    <StatusIcon className={`w-5 h-5 ${config.text}`} />
                  </div>
                  <h4 className="font-semibold text-slate-800 mb-1 text-sm">{check.label}</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">{check.detail}</p>
                  {check.value != null && (
                    <p className={`text-lg font-bold mt-2 ${config.text}`}>
                      {typeof check.value === 'number'
                        ? Number(check.value).toLocaleString('fr-FR')
                        : check.value}
                    </p>
                  )}
                  {check.last_check && (
                    <p className="text-xs text-slate-400 mt-2">
                      Verifie le {new Date(check.last_check).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// SVG Icons
// ══════════════════════════════════════════

function IconShield({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
}
function IconCheck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
}
function IconAlert({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
}
function IconX({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
}
function IconRefresh({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
}
function IconDownload({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
}
