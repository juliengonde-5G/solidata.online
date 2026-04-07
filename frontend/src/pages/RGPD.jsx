import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { DataTable, Modal } from '../components';
import { Shield, ScrollText } from 'lucide-react';
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

  const registreColumns = [
    { key: 'nom_traitement', label: 'Traitement', sortable: true, render: (r) => <span className="font-medium">{r.nom_traitement}</span> },
    { key: 'finalite', label: 'Finalité', render: (r) => <span className="text-gray-600">{r.finalite}</span> },
    { key: 'base_legale', label: 'Base légale', render: (r) => <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs">{r.base_legale}</span> },
    { key: 'duree_conservation', label: 'Durée conservation', render: (r) => r.duree_conservation || '—' },
    { key: 'is_active', label: 'Statut', render: (r) => (
      <span className={`px-2 py-0.5 rounded-full text-xs ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
        {r.is_active ? 'Actif' : 'Inactif'}
      </span>
    )},
  ];

  const auditColumns = [
    { key: 'created_at', label: 'Date', sortable: true, render: (a) => <span className="text-gray-500">{new Date(a.created_at).toLocaleString('fr-FR')}</span> },
    { key: 'user_name', label: 'Utilisateur', render: (a) => `${a.first_name} ${a.last_name}` },
    { key: 'action', label: 'Action', render: (a) => <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">{a.action}</span> },
    { key: 'entity_type', label: 'Type' },
    { key: 'entity_id', label: 'ID' },
    { key: 'details', label: 'Détails', render: (a) => <span className="text-gray-500 text-xs max-w-xs truncate block">{a.details ? JSON.stringify(a.details) : '—'}</span> },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Conformité RGPD</h1>
            <p className="text-sm text-gray-500">Gestion de la protection des données personnelles</p>
          </div>
          {tab === 'registre' && (
            <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
              Nouveau traitement
            </button>
          )}
          {tab === 'droits' && (
            <button onClick={handlePurge} className="btn-danger text-sm">
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
              <DataTable
                columns={registreColumns}
                data={registre}
                loading={false}
                emptyIcon={Shield}
                emptyMessage="Aucun traitement enregistré"
              />
            )}

            {tab === 'droits' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="font-semibold mb-3">Droit d'accès / Droit à l'effacement</h3>
                  <div className="flex gap-3 items-end">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Type</label>
                      <select value={searchEntity.type} onChange={e => setSearchEntity({ ...searchEntity, type: e.target.value })}
                        className="select-modern w-auto">
                        <option value="candidate">Candidat</option>
                        <option value="employee">Employé</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">ID</label>
                      <input type="number" value={searchEntity.id} onChange={e => setSearchEntity({ ...searchEntity, id: e.target.value })}
                        placeholder="ID" className="input-modern w-24" />
                    </div>
                    <button onClick={handleExport} className="btn-primary text-sm">Exporter les données</button>
                    <button onClick={handleAnonymize} className="btn-danger text-sm">Anonymiser</button>
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
              <DataTable
                columns={auditColumns}
                data={audit}
                loading={false}
                emptyIcon={ScrollText}
                emptyMessage="Aucune entrée"
                dense
              />
            )}
          </>
        )}

        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouveau traitement" size="lg"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="submit" form="rgpd-form" className="flex-1 btn-primary text-sm">Créer</button>
          </>}
        >
          <form id="rgpd-form" onSubmit={addTraitement} className="space-y-3">
            <input placeholder="Nom du traitement *" value={form.nom_traitement} onChange={e => setForm({ ...form, nom_traitement: e.target.value })} className="input-modern" required />
            <textarea placeholder="Finalité *" value={form.finalite} onChange={e => setForm({ ...form, finalite: e.target.value })} className="textarea-modern" rows={2} required />
            <select value={form.base_legale} onChange={e => setForm({ ...form, base_legale: e.target.value })} className="select-modern">
              {BASES.map(b => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
            </select>
            <input placeholder="Catégories de personnes" value={form.categories_personnes} onChange={e => setForm({ ...form, categories_personnes: e.target.value })} className="input-modern" />
            <input placeholder="Catégories de données" value={form.categories_donnees} onChange={e => setForm({ ...form, categories_donnees: e.target.value })} className="input-modern" />
            <input placeholder="Destinataires" value={form.destinataires} onChange={e => setForm({ ...form, destinataires: e.target.value })} className="input-modern" />
            <input placeholder="Durée de conservation" value={form.duree_conservation} onChange={e => setForm({ ...form, duree_conservation: e.target.value })} className="input-modern" />
            <textarea placeholder="Mesures de sécurité" value={form.mesures_securite} onChange={e => setForm({ ...form, mesures_securite: e.target.value })} className="textarea-modern" rows={2} />
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
