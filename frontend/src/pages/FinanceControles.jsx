import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, Download, RefreshCw, ShieldCheck, X } from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, LoadingSpinner } from '../components';

// ══════════════════════════════════════════
// FINANCE CONTROLES — Verifications automatiques
// 9 controles avec statuts vert/orange/rouge
// ══════════════════════════════════════════

const STATUS_CONFIG = {
  ok: { label: 'OK', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', icon: Check },
  warning: { label: 'Attention', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', icon: AlertTriangle },
  error: { label: 'Erreur', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500', icon: X },
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
      const res = await api.get(`/finance/controls/${year}`);
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
          icon={ShieldCheck}
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
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Actualiser
              </button>
              <button
                onClick={handleExport}
                className="btn-primary text-sm"
              >
                <Download className="w-4 h-4" />
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
            <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Aucun controle disponible. Cliquez sur Actualiser pour lancer les verifications.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {checks.map((check, i) => {
              const config = STATUS_CONFIG[check.status] || STATUS_CONFIG.ok;
              const StatusIcon = config.icon;

              return (
                <div
                  key={check.id || i}
                  className={`rounded-xl border p-5 ${config.bg} ${config.border} transition-all`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StatusIcon className={`w-5 h-5 ${config.text}`} />
                      <h4 className="font-semibold text-slate-800 text-sm">{check.name || check.label}</h4>
                    </div>
                    <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>
                      {config.label}
                    </span>
                  </div>
                  <p className={`text-sm font-medium mb-2 ${config.text}`}>{check.desc || check.detail}</p>
                  {check.explanation && (
                    <p className="text-xs text-slate-600 leading-relaxed mb-2">{check.explanation}</p>
                  )}
                  {check.action && (
                    <p className="text-xs font-medium text-slate-700 bg-white/60 rounded-lg px-3 py-2 border border-slate-200">
                      Action : {check.action}
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

