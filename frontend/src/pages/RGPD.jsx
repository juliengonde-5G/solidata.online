import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function RGPD() {
  const [tab, setTab] = useState('registre');
  const [registre, setRegistre] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nom_traitement: '', finalite: '', base_legale: 'consentement', categories_personnes: '', categories_donnees: '', destinataires: '', duree_conservation: '', mesures_securite: '' });
  const [searchEntity, setSearchEntity] = useState({ type: 'candidate', id: '' });
  const [exportData, setExportData] = useState(null);

  useEffect(() => { loadData(); }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'registre') {
        const r = await api.get('/rgpd/registre');
        setRegistre(r.data);
      } else if (tab === 'audit') {
        const r = await api.get('/rgpd/audit');
        setAudit(r.data);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const addTraitement = async (e) => {
    e.preventDefault();
    try {
      await api.post('/rgpd/registre', form);
      setShowForm(false);
      setForm({ nom_traitement: '', finalite: '', base_legale: 'consentement', categories_personnes: '', categories_donnees: '', destinataires: '', duree_conservation: '', mesures_securite: '' });
      loadData();
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const handleExport = async () => {
    if (!searchEntity.id) return alert('ID requis');
    try {
      const r = await api.get(`/rgpd/export/${searchEntity.type}/${searchEntity.id}`);
      setExportData(r.data);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const handleAnonymize = async () => {
    if (!searchEntity.id) return alert('ID requis');
    const reason = prompt('Motif d\'anonymisation (obligatoire) :');
    if (!reason) return;
    if (!window.confirm(`ATTENTION : Anonymiser définitivement les données ${searchEntity.type} #${searchEntity.id} ?`)) return;
    try {
      await api.post(`/rgpd/anonymize/${searchEntity.type}/${searchEntity.id}`, { reason });
      alert('Données anonymisées');
      setExportData(null);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const handlePurge = async () => {
    if (!window.confirm('Purger les candidatures non recrutées de plus de 24 mois ?')) return;
    try {
      const r = await api.post('/rgpd/purge-expired');
      alert(r.data.message);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const TABS = [
    { key: 'registre', label: 'Registre des traitements' },
    { key: 'droits', label: 'Droits des personnes' },
    { key: 'audit', label: 'Journal d\'audit' },
  ];

  const BASES = ['consentement', 'contrat', 'obligation_legale', 'interet_legitime', 'mission_publique', 'interet_vital'];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Conformité RGPD</h1>
            <p className="text-sm text-gray-500">Gestion de la protection des données personnelles</p>
          </div>
          {tab === 'registre' && (
            <button onClick={() => setShowForm(true)} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90">
              Nouveau traitement
            </button>
          )}
          {tab === 'droits' && (
            <button onClick={handlePurge} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600">
              Purge auto (24 mois)
            </button>
          )}
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
            {tab === 'registre' && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Traitement</th>
                      <th className="px-4 py-3 text-left">Finalité</th>
                      <th className="px-4 py-3 text-left">Base légale</th>
                      <th className="px-4 py-3 text-left">Durée conservation</th>
                      <th className="px-4 py-3 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {registre.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{r.nom_traitement}</td>
                        <td className="px-4 py-3 text-gray-600">{r.finalite}</td>
                        <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs">{r.base_legale}</span></td>
                        <td className="px-4 py-3">{r.duree_conservation || '—'}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.is_active ? 'Actif' : 'Inactif'}</span></td>
                      </tr>
                    ))}
                    {registre.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun traitement enregistré</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'droits' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="font-semibold mb-3">Droit d'accès / Droit à l'effacement</h3>
                  <div className="flex gap-3 items-end">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Type</label>
                      <select value={searchEntity.type} onChange={e => setSearchEntity({ ...searchEntity, type: e.target.value })}
                        className="border rounded-lg px-3 py-2 text-sm">
                        <option value="candidate">Candidat</option>
                        <option value="employee">Employé</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">ID</label>
                      <input type="number" value={searchEntity.id} onChange={e => setSearchEntity({ ...searchEntity, id: e.target.value })}
                        placeholder="ID" className="border rounded-lg px-3 py-2 text-sm w-24" />
                    </div>
                    <button onClick={handleExport} className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600">Exporter les données</button>
                    <button onClick={handleAnonymize} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600">Anonymiser</button>
                  </div>
                </div>
                {exportData && (
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold mb-3">Données exportées ({exportData.type} #{exportData.id})</h3>
                    <pre className="bg-gray-50 rounded-lg p-4 text-xs overflow-auto max-h-96">{JSON.stringify(exportData.data, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}

            {tab === 'audit' && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Utilisateur</th>
                      <th className="px-4 py-3 text-left">Action</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">ID</th>
                      <th className="px-4 py-3 text-left">Détails</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {audit.map(a => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500">{new Date(a.created_at).toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-3">{a.first_name} {a.last_name}</td>
                        <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">{a.action}</span></td>
                        <td className="px-4 py-3">{a.entity_type}</td>
                        <td className="px-4 py-3">{a.entity_id}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{a.details ? JSON.stringify(a.details) : '—'}</td>
                      </tr>
                    ))}
                    {audit.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune entrée</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
            <form onSubmit={addTraitement} className="bg-white rounded-xl p-6 w-[540px] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-4">Nouveau traitement</h2>
              <div className="space-y-3">
                <input placeholder="Nom du traitement *" value={form.nom_traitement} onChange={e => setForm({ ...form, nom_traitement: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <textarea placeholder="Finalité *" value={form.finalite} onChange={e => setForm({ ...form, finalite: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} required />
                <select value={form.base_legale} onChange={e => setForm({ ...form, base_legale: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {BASES.map(b => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
                </select>
                <input placeholder="Catégories de personnes" value={form.categories_personnes} onChange={e => setForm({ ...form, categories_personnes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Catégories de données" value={form.categories_donnees} onChange={e => setForm({ ...form, categories_donnees: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Destinataires" value={form.destinataires} onChange={e => setForm({ ...form, destinataires: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Durée de conservation" value={form.duree_conservation} onChange={e => setForm({ ...form, duree_conservation: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <textarea placeholder="Mesures de sécurité" value={form.mesures_securite} onChange={e => setForm({ ...form, mesures_securite: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-primary text-white rounded-lg py-2 text-sm font-medium">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
