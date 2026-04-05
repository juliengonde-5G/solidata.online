import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function AdminDB() {
  const [tab, setTab] = useState('info');
  const [info, setInfo] = useState(null);
  const [backups, setBackups] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { loadData(); }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'info') {
        const r = await api.get('/admin-db/info');
        setInfo(r.data);
      } else if (tab === 'backups') {
        const r = await api.get('/admin-db/backups');
        setBackups(r.data);
      } else if (tab === 'stats') {
        const r = await api.get('/admin-db/stats');
        setStats(r.data);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createBackup = async () => {
    setActionLoading(true);
    try {
      const r = await api.post('/admin-db/backup');
      alert(`Sauvegarde créée : ${r.data.filename} (${r.data.size})`);
      loadData();
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
    setActionLoading(false);
  };

  const restoreBackup = async (filename) => {
    if (!window.confirm(`ATTENTION : Restaurer la sauvegarde ${filename} ? Les données actuelles seront écrasées.`)) return;
    setActionLoading(true);
    try {
      await api.post('/admin-db/restore', { filename });
      alert('Restauration effectuée');
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
    setActionLoading(false);
  };

  const deleteBackup = async (filename) => {
    if (!window.confirm(`Supprimer la sauvegarde ${filename} ?`)) return;
    try {
      await api.delete(`/admin-db/backups/${filename}`);
      loadData();
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const runVacuum = async () => {
    if (!window.confirm('Lancer l\'optimisation de la base (VACUUM ANALYZE) ?')) return;
    setActionLoading(true);
    try {
      const r = await api.post('/admin-db/vacuum');
      alert(r.data.message);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
    setActionLoading(false);
  };

  const purgeTable = async (table) => {
    const months = prompt(`Supprimer les données de "${table}" plus anciennes que combien de mois ?`, '12');
    if (!months) return;
    if (!window.confirm(`Confirmer la purge de "${table}" (> ${months} mois) ? Cette action est irréversible.`)) return;
    try {
      const r = await api.post('/admin-db/purge', { table, months: parseInt(months), confirm: 'CONFIRMER_PURGE' });
      alert(r.data.message);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const TABS = [
    { key: 'info', label: 'Informations' },
    { key: 'backups', label: 'Sauvegardes' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'stats', label: 'Statistiques' },
  ];

  const PURGEABLE = ['gps_positions', 'tonnage_history', 'candidate_history', 'collection_learning_feedback'];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Administration Base de Données</h1>
            <p className="text-sm text-gray-500">Gestion, sauvegarde et maintenance de la base PostgreSQL</p>
          </div>
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : (
          <>
            {tab === 'info' && info && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <Card label="Taille de la base" value={info.database_size} />
                  <Card label="Connexions actives" value={info.connections?.active || 0} />
                  <Card label="Connexions idle" value={info.connections?.idle || 0} />
                </div>
                <div className="bg-white rounded-xl border overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 font-semibold text-sm">Tables ({info.tables?.length || 0})</div>
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-gray-500 bg-gray-50/50">
                      <tr><th className="px-4 py-2 text-left">Table</th><th className="px-4 py-2 text-left">Taille</th><th className="px-4 py-2 text-right">Lignes (est.)</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {info.tables?.map(t => {
                        const rc = info.row_counts?.find(r => r.table_name === t.tablename);
                        return (
                          <tr key={t.tablename} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-mono text-xs">{t.tablename}</td>
                            <td className="px-4 py-2">{t.size}</td>
                            <td className="px-4 py-2 text-right">{rc ? Number(rc.estimated_rows).toLocaleString('fr-FR') : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'backups' && (
              <div className="space-y-4">
                <button onClick={createBackup} disabled={actionLoading} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                  {actionLoading ? 'Sauvegarde en cours...' : 'Créer une sauvegarde'}
                </button>
                <div className="bg-white rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr><th className="px-4 py-3 text-left">Fichier</th><th className="px-4 py-3 text-left">Taille</th><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-right">Actions</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {backups.map(b => (
                        <tr key={b.filename} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs">{b.filename}</td>
                          <td className="px-4 py-3">{b.size}</td>
                          <td className="px-4 py-3">{new Date(b.created_at).toLocaleString('fr-FR')}</td>
                          <td className="px-4 py-3 text-right space-x-2">
                            <button onClick={() => restoreBackup(b.filename)} className="text-blue-600 hover:underline text-xs">Restaurer</button>
                            <button onClick={() => deleteBackup(b.filename)} className="text-red-600 hover:underline text-xs">Supprimer</button>
                          </td>
                        </tr>
                      ))}
                      {backups.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucune sauvegarde</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'maintenance' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="font-semibold mb-3">Optimisation</h3>
                  <p className="text-sm text-gray-500 mb-3">VACUUM ANALYZE permet de récupérer l'espace disque et mettre à jour les statistiques du planificateur de requêtes.</p>
                  <button onClick={runVacuum} disabled={actionLoading} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                    {actionLoading ? 'Optimisation en cours...' : 'Lancer VACUUM ANALYZE'}
                  </button>
                </div>
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="font-semibold mb-3">Purge de données anciennes</h3>
                  <p className="text-sm text-gray-500 mb-3">Supprimer les données historiques au-delà de la durée de conservation réglementaire.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {PURGEABLE.map(table => (
                      <button key={table} onClick={() => purgeTable(table)}
                        className="text-left border rounded-lg px-4 py-3 hover:bg-red-50 transition">
                        <p className="font-mono text-sm">{table}</p>
                        <p className="text-xs text-gray-400 mt-1">Purger les données anciennes</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'stats' && stats && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 font-semibold text-sm">Activité par table</div>
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-gray-500 bg-gray-50/50">
                      <tr><th className="px-4 py-2 text-left">Table</th><th className="px-4 py-2 text-right">Insertions</th><th className="px-4 py-2 text-right">Mises à jour</th><th className="px-4 py-2 text-right">Suppressions</th><th className="px-4 py-2 text-left">Dernier VACUUM</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {stats.table_activity?.map(t => (
                        <tr key={t.relname} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs">{t.relname}</td>
                          <td className="px-4 py-2 text-right">{Number(t.n_tup_ins).toLocaleString('fr-FR')}</td>
                          <td className="px-4 py-2 text-right">{Number(t.n_tup_upd).toLocaleString('fr-FR')}</td>
                          <td className="px-4 py-2 text-right">{Number(t.n_tup_del).toLocaleString('fr-FR')}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{t.last_vacuum ? new Date(t.last_vacuum).toLocaleString('fr-FR') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {stats.unused_indexes?.length > 0 && (
                  <div className="bg-white rounded-xl border overflow-hidden">
                    <div className="px-4 py-3 bg-amber-50 font-semibold text-sm text-amber-800">Index non utilisés</div>
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-gray-500 bg-gray-50/50">
                        <tr><th className="px-4 py-2 text-left">Index</th><th className="px-4 py-2 text-left">Table</th><th className="px-4 py-2 text-left">Taille</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {stats.unused_indexes.map(i => (
                          <tr key={i.indexrelname}><td className="px-4 py-2 font-mono text-xs">{i.indexrelname}</td><td className="px-4 py-2">{i.relname}</td><td className="px-4 py-2">{i.index_size}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function Card({ label, value }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
