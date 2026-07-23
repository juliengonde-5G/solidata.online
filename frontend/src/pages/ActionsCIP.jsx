import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import { ListChecks } from 'lucide-react';
import api from '../services/api';
import QuickActionButton from '../components/insertion/QuickActionButton';
import {
  ACTION_STATUS_LABELS, ACTION_CATEGORY_LABELS, ACTION_PRIORITY_LABELS,
  ACTION_PRIORITY_COLORS, frDate,
} from '../components/insertion/freins';

/**
 * Actions CIP — tableau transversal de toutes les actions, tous salariés
 * (GET /insertion/actions-overview : { total, limit, offset, actions[] }).
 * Filtres : salarié, catégorie, criticité, partenaire, statut, en retard,
 * « mes salariés ». Tri serveur par échéance. Pagination. Édition rapide du
 * statut. « + Action » global. Export CSV client du tableau filtré.
 */

const PAGE_SIZE = 50;

const csvEscape = (v) => {
  const s = String(v == null ? '' : v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export default function ActionsCIP() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [employees, setEmployees] = useState([]);
  const [partenaires, setPartenaires] = useState([]);
  const [filters, setFilters] = useState({
    employee_id: '', category: '', priority: '', partenaire_id: '', statut: '', retard: false, mine: false,
  });

  useEffect(() => {
    api.get('/insertion').then((r) => setEmployees(Array.isArray(r.data) ? r.data : [])).catch(() => setEmployees([]));
    api.get('/insertion/partenaires').then((r) => setPartenaires(Array.isArray(r.data) ? r.data : [])).catch(() => setPartenaires([]));
  }, []);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.employee_id) params.append('employee_id', filters.employee_id);
    if (filters.category) params.append('category', filters.category);
    if (filters.priority) params.append('priority', filters.priority);
    if (filters.partenaire_id) params.append('partenaire_id', filters.partenaire_id);
    if (filters.statut) params.append('statut', filters.statut);
    if (filters.retard) params.append('retard', '1');
    if (filters.mine) params.append('mine', '1');
    params.append('limit', String(PAGE_SIZE));
    params.append('offset', String(page * PAGE_SIZE));
    api.get(`/insertion/actions-overview?${params}`)
      .then((r) => { if (alive) { setData(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters, page]);

  useEffect(() => load(), [load]);

  const setFilter = (k, v) => { setPage(0); setFilters((f) => ({ ...f, [k]: v })); };

  const updateStatus = async (action, status) => {
    try {
      await api.put(`/insertion/action-plans/${action.id}`, { status });
      setData((d) => d ? { ...d, actions: d.actions.map((a) => (a.id === action.id ? { ...a, status } : a)) } : d);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const exportCsv = () => {
    const rows = data?.actions || [];
    const header = ['Salarié', 'Action', 'Catégorie', 'Criticité', 'Statut', 'Échéance', 'En retard', 'Partenaire', 'Objectif lié', 'Entretien lié', 'Résultat'];
    const lines = rows.map((a) => [
      `${a.first_name} ${a.last_name}`, a.action_label,
      ACTION_CATEGORY_LABELS[a.category] || a.category || '',
      ACTION_PRIORITY_LABELS[a.priority] || a.priority || '',
      ACTION_STATUS_LABELS[a.status] || a.status || '',
      a.echeance ? String(a.echeance).slice(0, 10) : '',
      a.en_retard ? 'oui' : 'non',
      a.partenaire_nom || '', a.objectif_titre || '', a.milestone_titre || '', a.resultat || '',
    ].map(csvEscape).join(';'));
    const csv = '\uFEFF' + [header.join(';'), ...lines].join('\n'); // BOM → ouverture directe Excel FR
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `actions_cip_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const total = data?.total || 0;
  const nbPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const actions = data?.actions || [];
  const hasFilters = filters.employee_id || filters.category || filters.priority || filters.partenaire_id || filters.statut || filters.retard || filters.mine;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Actions CIP"
          subtitle="Toutes les actions d'accompagnement, tous salariés — triées par échéance"
          icon={ListChecks}
          actions={
            <div className="flex items-center gap-2">
              <QuickActionButton onCreated={load} />
              <button onClick={exportCsv} disabled={actions.length === 0}
                className="px-3 py-1.5 rounded-lg bg-slate-600 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                title="Exporte la page affichée (filtres appliqués) en CSV">
                Export CSV
              </button>
            </div>
          }
        />

        {/* Filtres */}
        <div className="bg-white rounded-lg border p-3 mb-4 flex items-center gap-2 flex-wrap">
          <select value={filters.employee_id} onChange={(e) => setFilter('employee_id', e.target.value)} className="input-modern py-1.5 text-sm w-auto">
            <option value="">Tous les salariés</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
          <select value={filters.category} onChange={(e) => setFilter('category', e.target.value)} className="input-modern py-1.5 text-sm w-auto">
            <option value="">Toutes catégories</option>
            {Object.entries(ACTION_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} className="input-modern py-1.5 text-sm w-auto">
            <option value="">Toute criticité</option>
            {Object.entries(ACTION_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.partenaire_id} onChange={(e) => setFilter('partenaire_id', e.target.value)} className="input-modern py-1.5 text-sm w-auto">
            <option value="">Tous partenaires</option>
            {partenaires.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
          <select value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} className="input-modern py-1.5 text-sm w-auto">
            <option value="">Tous statuts</option>
            {Object.entries(ACTION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={filters.retard} onChange={(e) => setFilter('retard', e.target.checked)} className="rounded border-gray-300" />
            En retard
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none" title="Salariés dont je suis le CIP référent">
            <input type="checkbox" checked={filters.mine} onChange={(e) => setFilter('mine', e.target.checked)} className="rounded border-gray-300" />
            Mes salariés
          </label>
          {hasFilters && (
            <button onClick={() => { setPage(0); setFilters({ employee_id: '', category: '', priority: '', partenaire_id: '', statut: '', retard: false, mine: false }); }}
              className="text-xs text-teal-700 underline">Réinitialiser</button>
          )}
          <span className="ml-auto text-xs text-gray-400">{total} action{total > 1 ? 's' : ''}</span>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
            <span aria-hidden="true">⚠</span><span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
          </div>
        )}

        {loading ? (
          <LoadingSpinner size="lg" message="Chargement des actions..." />
        ) : actions.length === 0 ? (
          <div className="bg-white rounded-lg border p-8 text-center text-gray-400">
            <p className="text-sm">{hasFilters ? 'Aucune action ne correspond à ces filtres.' : 'Aucune action pour le moment.'}</p>
            <p className="text-xs mt-1">Le bouton « + Action » (en haut) permet de noter une démarche en moins de 30 secondes.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-3 py-2 font-medium">Échéance</th>
                  <th className="px-3 py-2 font-medium">Salarié</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Catégorie</th>
                  <th className="px-3 py-2 font-medium">Criticité</th>
                  <th className="px-3 py-2 font-medium">Partenaire</th>
                  <th className="px-3 py-2 font-medium">Rattachement</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id} className={`border-b border-gray-100 ${a.en_retard ? 'bg-red-50/50' : 'hover:bg-gray-50'}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {a.echeance ? (
                        <span className={a.en_retard ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                          {frDate(a.echeance)}
                          {a.en_retard && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">retard</span>}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link to={`/insertion?employee=${a.employee_id}`} className="text-teal-700 hover:underline font-medium">
                        {a.first_name} {a.last_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 min-w-[220px]">
                      <span className={a.status === 'realise' ? 'line-through text-gray-400' : ''}>{a.action_label}</span>
                      {a.resultat && <p className="text-[11px] text-gray-400 mt-0.5">Résultat : {a.resultat}</p>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-blue-700">{ACTION_CATEGORY_LABELS[a.category] || a.category}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ACTION_PRIORITY_COLORS[a.priority] || ''}`}>{ACTION_PRIORITY_LABELS[a.priority] || a.priority}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{a.partenaire_nom || '—'}</td>
                    <td className="px-3 py-2 text-[11px] text-gray-400">
                      {a.objectif_titre && <span className="block">Objectif : {a.objectif_titre}</span>}
                      {a.milestone_titre && <span className="block">Entretien : {a.milestone_titre}</span>}
                      {!a.objectif_titre && !a.milestone_titre && '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <select value={a.status} onChange={(e) => updateStatus(a, e.target.value)}
                        className="text-xs border rounded px-1 py-0.5 bg-white">
                        {Object.entries(ACTION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}
            {nbPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-gray-500">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-2.5 py-1 rounded border disabled:opacity-40 hover:bg-gray-50">◄ Précédent</button>
                <span>Page {page + 1} / {nbPages} — {total} actions</span>
                <button onClick={() => setPage((p) => Math.min(nbPages - 1, p + 1))} disabled={page >= nbPages - 1}
                  className="px-2.5 py-1 rounded border disabled:opacity-40 hover:bg-gray-50">Suivant ►</button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
