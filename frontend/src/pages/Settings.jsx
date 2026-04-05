import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const TARIF_TYPES = [
  { key: 'soutien_tri', label: 'Soutien au tri', unit: '€/t entrée tri', parTrimestre: true },
  { key: 'vak', label: 'VAK (sortie VAK)', unit: '€/t sortie' },
  { key: 'boutique', label: 'Boutiques', unit: '€/t sortie' },
  { key: 'extra', label: 'Extra', unit: '€/t sortie' },
  { key: 'original', label: 'Original', unit: '€/t sortie', parClient: true },
  { key: 'effilochage', label: 'Effilochage', unit: '€/t sortie', parClient: true },
  { key: 'csr', label: 'CSR', unit: '€/t sortie (coût fixe annuel)' },
];

export default function Settings() {
  const [settings, setSettings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editSetting, setEditSetting] = useState(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', type: 'email', subject: '', body: '', variables: '' });

  // Tarifs
  const [tarifs, setTarifs] = useState([]);
  const [exutoires, setExutoires] = useState([]);
  const [tarifAnnee, setTarifAnnee] = useState(new Date().getFullYear());
  const [editTarif, setEditTarif] = useState(null);
  const [tarifForm, setTarifForm] = useState({ type: '', exutoire_id: '', prix_tonne: '', trimestre: '' });

  // Objectifs periodiques
  const [objectives, setObjectives] = useState([]);
  const [objAnnee, setObjAnnee] = useState(new Date().getFullYear());
  const [showObjForm, setShowObjForm] = useState(false);
  const [objForm, setObjForm] = useState({ domaine: 'collecte', indicateur: '', unite: '', periode: 'mensuel', mois: '', trimestre: '', valeur_cible: '', commentaire: '' });

  // Declencheurs automatiques
  const [triggers, setTriggers] = useState([]);
  const [triggerEvents, setTriggerEvents] = useState([]);
  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [triggerForm, setTriggerForm] = useState({ name: '', event: '', template_id: '', delay_minutes: 0 });

  // Pennylane
  const [plConfig, setPlConfig] = useState(null);
  const [plTesting, setPlTesting] = useState(false);
  const [plTestResult, setPlTestResult] = useState(null);
  const [plForm, setPlForm] = useState({ api_key: '', company_id: '', is_active: false });
  const [plSaving, setPlSaving] = useState(false);

  useEffect(() => { loadData(); loadTriggers(); loadPennylane(); }, []);
  useEffect(() => { loadTarifs(); }, [tarifAnnee]);
  useEffect(() => { loadObjectives(); }, [objAnnee]);

  const loadData = async () => {
    try {
      const [setRes, tmplRes, healthRes, exuRes] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/templates'),
        api.get('/health').catch(() => ({ data: null })),
        api.get('/referentiels/exutoires').catch(() => ({ data: [] })),
      ]);
      setSettings(setRes.data);
      setTemplates(tmplRes.data);
      setHealth(healthRes.data);
      setExutoires(exuRes.data.filter(e => e.is_active !== false));
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadPennylane = async () => {
    try {
      const [cfgRes, statusRes] = await Promise.all([
        api.get('/pennylane/config').catch(() => ({ data: null })),
        api.get('/pennylane/status').catch(() => ({ data: null })),
      ]);
      const cfg = cfgRes.data || {};
      const st = statusRes.data || {};
      setPlConfig({ ...cfg, ...st });
      if (cfg.company_id) {
        setPlForm(prev => ({ ...prev, company_id: cfg.company_id || '', is_active: cfg.is_active || false }));
      }
    } catch (err) { console.error('[Settings] Pennylane load error:', err); }
  };

  const savePennylane = async () => {
    setPlSaving(true);
    try {
      await api.put('/pennylane/config', plForm);
      setPlTestResult(null);
      loadPennylane();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur sauvegarde Pennylane');
    }
    setPlSaving(false);
  };

  const testPennylane = async () => {
    setPlTesting(true);
    setPlTestResult(null);
    try {
      const res = await api.post('/pennylane/test');
      setPlTestResult(res.data);
      if (res.data.connected) loadPennylane();
    } catch (err) {
      setPlTestResult({ connected: false, error: err.response?.data?.error || 'Erreur de connexion' });
    }
    setPlTesting(false);
  };

  const loadTarifs = async () => {
    try {
      const res = await api.get(`/settings/tarifs?annee=${tarifAnnee}`);
      setTarifs(res.data);
    } catch (err) { console.error(err); }
  };

  const updateSetting = async (key, value) => {
    try {
      await api.put(`/settings/${key}`, { value });
      setEditSetting(null);
      loadData();
    } catch (err) { console.error(err); }
  };

  const createTemplate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/settings/templates', templateForm);
      setShowTemplateForm(false);
      setTemplateForm({ name: '', type: 'email', subject: '', body: '', variables: '' });
      loadData();
    } catch (err) { console.error(err); }
  };

  const saveTarif = async (e) => {
    e.preventDefault();
    try {
      await api.put('/settings/tarifs', {
        annee: tarifAnnee,
        type: tarifForm.type,
        exutoire_id: tarifForm.exutoire_id || null,
        prix_tonne: parseFloat(tarifForm.prix_tonne),
        trimestre: tarifForm.trimestre ? parseInt(tarifForm.trimestre) : null,
      });
      setEditTarif(null);
      setTarifForm({ type: '', exutoire_id: '', prix_tonne: '', trimestre: '' });
      loadTarifs();
    } catch (err) { console.error(err); }
  };

  const deleteTarif = async (id) => {
    if (!confirm('Supprimer ce tarif ?')) return;
    try {
      await api.delete(`/settings/tarifs/${id}`);
      loadTarifs();
    } catch (err) { console.error(err); }
  };

  const openTarifEdit = (type) => {
    setEditTarif(type);
    setTarifForm({ type, exutoire_id: '', prix_tonne: '', trimestre: '' });
  };

  // Objectifs
  const loadObjectives = async () => {
    try {
      const res = await api.get(`/settings/objectives?annee=${objAnnee}`);
      setObjectives(res.data);
    } catch (err) { console.error(err); }
  };

  const createObjective = async (e) => {
    e.preventDefault();
    try {
      await api.post('/settings/objectives', { ...objForm, annee: objAnnee, valeur_cible: parseFloat(objForm.valeur_cible), mois: objForm.mois ? parseInt(objForm.mois) : null, trimestre: objForm.trimestre ? parseInt(objForm.trimestre) : null });
      setShowObjForm(false);
      setObjForm({ domaine: 'collecte', indicateur: '', unite: '', periode: 'mensuel', mois: '', trimestre: '', valeur_cible: '', commentaire: '' });
      loadObjectives();
    } catch (err) { console.error(err); }
  };

  const deleteObjective = async (id) => {
    if (!confirm('Supprimer cet objectif ?')) return;
    try {
      await api.delete(`/settings/objectives/${id}`);
      loadObjectives();
    } catch (err) { console.error(err); }
  };

  // Declencheurs automatiques
  const loadTriggers = async () => {
    try {
      const res = await api.get('/settings/triggers');
      setTriggers(res.data.triggers || []);
      setTriggerEvents(res.data.events || []);
    } catch (err) { console.error(err); }
  };

  const createTrigger = async (e) => {
    e.preventDefault();
    try {
      await api.post('/settings/triggers', { ...triggerForm, template_id: parseInt(triggerForm.template_id), delay_minutes: parseInt(triggerForm.delay_minutes) || 0 });
      setShowTriggerForm(false);
      setTriggerForm({ name: '', event: '', template_id: '', delay_minutes: 0 });
      loadTriggers();
    } catch (err) { console.error(err); }
  };

  const toggleTrigger = async (id, currentActive) => {
    try {
      await api.put(`/settings/triggers/${id}`, { is_active: !currentActive });
      loadTriggers();
    } catch (err) { console.error(err); }
  };

  const deleteTrigger = async (id) => {
    if (!confirm('Supprimer ce declencheur ?')) return;
    try {
      await api.delete(`/settings/triggers/${id}`);
      loadTriggers();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des paramètres..." /></Layout>;

  // Group tarifs by type
  const tarifsByType = {};
  tarifs.forEach(t => {
    if (!tarifsByType[t.type]) tarifsByType[t.type] = [];
    tarifsByType[t.type].push(t);
  });

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Paramètres</h1>
          <p className="text-gray-500">Configuration de l'application</p>
        </div>

        {/* État du système */}
        {health && (
          <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
            <h2 className="font-semibold text-slate-800 mb-4">État du système</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatusItem label="API" active={health.status === 'ok'} />
              <StatusItem label="Base de données" active={health.database?.connected} />
              <StatusItem label="PostGIS" active={!!health.database?.postgis} />
              <StatusItem label="Auth" active={health.modules?.auth} />
            </div>
            <p className="text-xs text-gray-400 mt-4">
              PostgreSQL {health.database?.version?.split(' ').slice(0, 2).join(' ')} • PostGIS {health.database?.postgis}
            </p>
          </div>
        )}

        {/* Pennylane */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h2 className="font-semibold text-slate-800">Connexion Pennylane</h2>
                <p className="text-xs text-gray-400">Comptabilite — synchronisation factures</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {plConfig?.active ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Connecte
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> Deconnecte
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Cle API Pennylane</label>
              <input
                type="password"
                placeholder="pl_api_..."
                value={plForm.api_key}
                onChange={e => setPlForm({ ...plForm, api_key: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Vide = conserver la cle existante</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">ID Societe Pennylane</label>
              <input
                placeholder="ex: solidarite-textiles"
                value={plForm.company_id}
                onChange={e => setPlForm({ ...plForm, company_id: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col justify-between">
              <label className="flex items-center gap-2 text-sm mt-5">
                <input type="checkbox" checked={plForm.is_active} onChange={e => setPlForm({ ...plForm, is_active: e.target.checked })} className="rounded" />
                Connexion active
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={savePennylane}
              disabled={plSaving || !plForm.company_id}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {plSaving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button
              onClick={testPennylane}
              disabled={plTesting || !plConfig?.configured}
              className="px-4 py-2 bg-white border border-indigo-300 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
            >
              {plTesting ? 'Test...' : 'Tester la connexion'}
            </button>
            <a href="/pennylane" className="px-4 py-2 text-indigo-600 text-sm hover:underline">
              Page Pennylane complete →
            </a>
          </div>

          {plTestResult && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${plTestResult.connected ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {plTestResult.connected ? `Connexion reussie — ${plTestResult.company || 'OK'}` : `Echec — ${plTestResult.error}`}
            </div>
          )}

          {plConfig?.last_sync && (
            <p className="text-xs text-gray-400 mt-3">Derniere sync : {new Date(plConfig.last_sync).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} • {plConfig.total_mappings || 0} element(s) synchronise(s)</p>
          )}
        </div>

        {/* Settings */}
        <div className="bg-white rounded-xl shadow-sm border mb-8">
          <div className="p-4 border-b bg-gray-50">
            <h2 className="font-semibold">Paramètres généraux</h2>
          </div>
          <div className="divide-y">
            {settings.map(s => (
              <div key={s.key} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{s.key}</p>
                  <p className="text-xs text-gray-400">{s.description || ''}</p>
                </div>
                {editSetting === s.key ? (
                  <div className="flex gap-2">
                    <input
                      defaultValue={s.value}
                      onKeyDown={(e) => { if (e.key === 'Enter') updateSetting(s.key, e.target.value); }}
                      className="border rounded px-2 py-1 text-sm w-48"
                      autoFocus
                    />
                    <button onClick={() => setEditSetting(null)} className="text-gray-400 text-sm">Annuler</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 font-mono bg-gray-50 px-2 py-1 rounded">{s.value}</span>
                    <button onClick={() => setEditSetting(s.key)} className="text-primary text-xs hover:underline">Modifier</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ══════════ GRILLE TARIFAIRE ══════════ */}
        <div className="bg-white rounded-xl shadow-sm border mb-8">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Grille tarifaire</h2>
              <p className="text-xs text-gray-400 mt-0.5">Prix à la tonne sortie — tarifs par année</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setTarifAnnee(a => a - 1)} className="px-2 py-1 border rounded text-sm hover:bg-gray-100">&laquo;</button>
              <span className="font-mono font-bold text-lg min-w-[60px] text-center">{tarifAnnee}</span>
              <button onClick={() => setTarifAnnee(a => a + 1)} className="px-2 py-1 border rounded text-sm hover:bg-gray-100">&raquo;</button>
            </div>
          </div>

          <div className="divide-y">
            {TARIF_TYPES.map(tt => {
              const rows = tarifsByType[tt.key] || [];
              return (
                <div key={tt.key} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-medium text-sm">{tt.label}</span>
                      <span className="text-xs text-gray-400 ml-2">{tt.unit}</span>
                      {tt.parClient && <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded">par client</span>}
                      {tt.parTrimestre && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded">par trimestre</span>}
                    </div>
                    <button onClick={() => openTarifEdit(tt.key)} className="text-primary text-xs font-medium hover:underline">+ Ajouter</button>
                  </div>

                  {rows.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400">
                          {tt.parTrimestre && <th className="text-left font-normal pb-1">Trimestre</th>}
                          {tt.parClient && <th className="text-left font-normal pb-1">Client</th>}
                          <th className="text-right font-normal pb-1">Prix (€/t)</th>
                          <th className="text-right font-normal pb-1 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.id} className="border-t border-gray-100">
                            {tt.parTrimestre && <td className="py-1.5">T{r.trimestre}</td>}
                            {tt.parClient && <td className="py-1.5">{r.exutoire_nom || '—'}</td>}
                            <td className="py-1.5 text-right font-mono">{parseFloat(r.prix_tonne).toFixed(2)}</td>
                            <td className="py-1.5 text-right">
                              <button onClick={() => deleteTarif(r.id)} className="text-red-400 hover:text-red-600 text-xs">Suppr.</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-gray-300 italic">Aucun tarif défini pour {tarifAnnee}</p>
                  )}

                  {/* Inline form */}
                  {editTarif === tt.key && (
                    <form onSubmit={saveTarif} className="mt-3 flex items-end gap-2 bg-gray-50 rounded-lg p-3">
                      {tt.parTrimestre && (
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-500 block mb-0.5">Trimestre</label>
                          <select value={tarifForm.trimestre} onChange={e => setTarifForm({ ...tarifForm, trimestre: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm" required>
                            <option value="">—</option>
                            <option value="1">T1</option>
                            <option value="2">T2</option>
                            <option value="3">T3</option>
                            <option value="4">T4</option>
                          </select>
                        </div>
                      )}
                      {tt.parClient && (
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-500 block mb-0.5">Client</label>
                          <select value={tarifForm.exutoire_id} onChange={e => setTarifForm({ ...tarifForm, exutoire_id: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm" required>
                            <option value="">Choisir…</option>
                            {exutoires.map(ex => <option key={ex.id} value={ex.id}>{ex.nom}</option>)}
                          </select>
                        </div>
                      )}
                      <div className="flex-1">
                        <label className="text-[10px] text-gray-500 block mb-0.5">Prix €/tonne</label>
                        <input type="number" step="0.01" min="0" value={tarifForm.prix_tonne} onChange={e => setTarifForm({ ...tarifForm, prix_tonne: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm" required placeholder="0.00" />
                      </div>
                      <button type="submit" className="btn-primary text-sm">OK</button>
                      <button type="button" onClick={() => setEditTarif(null)} className="text-gray-400 text-sm px-2 py-1.5">Annuler</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Message Templates */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="font-semibold">Modèles de messages</h2>
            <button onClick={() => setShowTemplateForm(true)} className="text-primary text-sm font-medium hover:underline">+ Ajouter</button>
          </div>
          <div className="divide-y">
            {templates.map(t => (
              <div key={t.id} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${t.type === 'email' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      {t.type.toUpperCase()}
                    </span>
                    <h3 className="font-medium text-sm">{t.name}</h3>
                  </div>
                  <span className={`text-xs ${t.is_active ? 'text-green-600' : 'text-red-500'}`}>
                    {t.is_active ? 'Actif' : 'Inactif'}
                  </span>
                </div>
                {t.subject && <p className="text-xs text-gray-500">Objet : {t.subject}</p>}
                <p className="text-xs text-gray-400 mt-1 truncate">{t.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Template Form Modal */}
        {showTemplateForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createTemplate} className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouveau modele de message</h2>
              <div className="space-y-3">
                <input placeholder="Nom du template *" value={templateForm.name} onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <select value={templateForm.type} onChange={e => setTemplateForm({ ...templateForm, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
                {templateForm.type === 'email' && (
                  <input placeholder="Objet de l'email" value={templateForm.subject} onChange={e => setTemplateForm({ ...templateForm, subject: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                )}
                <textarea placeholder="Corps du message *" value={templateForm.body} onChange={e => setTemplateForm({ ...templateForm, body: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" rows={4} required />
                <p className="text-[10px] text-gray-400">Variables : {'{prenom}'}, {'{nom}'}, {'{date}'}, {'{heure}'}, {'{lieu}'}, {'{poste}'}, {'{equipe}'}</p>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowTemplateForm(false)} className="px-4 py-2 text-gray-500 text-sm">Annuler</button>
                <button type="submit" className="btn-primary text-sm">Creer</button>
              </div>
            </form>
          </div>
        )}

        {/* Declencheurs automatiques */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Declencheurs automatiques</h2>
              <p className="text-xs text-gray-400 mt-0.5">Definir quand envoyer automatiquement un email ou SMS</p>
            </div>
            <button onClick={() => setShowTriggerForm(true)} className="btn-primary text-xs">+ Declencheur</button>
          </div>
          <div className="divide-y">
            {triggers.length === 0 ? (
              <p className="p-6 text-center text-gray-400 text-sm">Aucun declencheur configure</p>
            ) : triggers.map(t => (
              <div key={t.id} className="p-4 flex items-center gap-3">
                <button
                  onClick={() => toggleTrigger(t.id, t.is_active)}
                  className={`w-10 h-5 rounded-full transition flex-shrink-0 ${t.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${t.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{t.name}</p>
                  <p className="text-xs text-gray-400">
                    Evenement : {triggerEvents.find(e => e.value === t.event)?.label || t.event}
                    {t.delay_minutes > 0 && ` (delai : ${t.delay_minutes} min)`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${t.template_type === 'email' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {(t.template_type || '').toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500 truncate max-w-[120px]">{t.template_name}</span>
                  <button onClick={() => deleteTrigger(t.id)} className="text-red-400 hover:text-red-600 text-xs ml-2">Suppr.</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trigger Form Modal */}
        {showTriggerForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createTrigger} className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouveau declencheur</h2>
              <div className="space-y-3">
                <input placeholder="Nom (ex: Rappel entretien J-1) *" value={triggerForm.name} onChange={e => setTriggerForm({ ...triggerForm, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <select value={triggerForm.event} onChange={e => setTriggerForm({ ...triggerForm, event: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">-- Evenement declencheur --</option>
                  {triggerEvents.map(ev => (
                    <option key={ev.value} value={ev.value}>{ev.label}</option>
                  ))}
                </select>
                <select value={triggerForm.template_id} onChange={e => setTriggerForm({ ...triggerForm, template_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">-- Template a utiliser --</option>
                  {templates.filter(t => t.is_active).map(t => (
                    <option key={t.id} value={t.id}>[{t.type.toUpperCase()}] {t.name}</option>
                  ))}
                </select>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Delai avant envoi (minutes)</label>
                  <input type="number" min="0" value={triggerForm.delay_minutes} onChange={e => setTriggerForm({ ...triggerForm, delay_minutes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0 = immediat" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowTriggerForm(false)} className="px-4 py-2 text-gray-500 text-sm">Annuler</button>
                <button type="submit" className="btn-primary text-sm">Creer</button>
              </div>
            </form>
          </div>
        )}

        {/* Objectifs periodiques */}
        <div className="bg-white rounded-xl shadow-sm border mb-8">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Objectifs periodiques</h2>
              <p className="text-xs text-gray-400 mt-0.5">Definir les cibles par domaine et par periode</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setObjAnnee(objAnnee - 1)} className="text-gray-400 hover:text-gray-600 px-1">&lt;</button>
              <span className="font-bold text-sm">{objAnnee}</span>
              <button onClick={() => setObjAnnee(objAnnee + 1)} className="text-gray-400 hover:text-gray-600 px-1">&gt;</button>
              <button onClick={() => setShowObjForm(true)} className="ml-3 btn-primary text-xs">+ Objectif</button>
            </div>
          </div>
          {objectives.length === 0 ? (
            <p className="p-6 text-center text-gray-400 text-sm">Aucun objectif defini pour {objAnnee}</p>
          ) : (
            <div className="divide-y">
              {['collecte', 'production', 'tri', 'rh', 'commercial', 'logistique'].map(dom => {
                const items = objectives.filter(o => o.domaine === dom);
                if (items.length === 0) return null;
                return (
                  <div key={dom} className="p-4">
                    <p className="text-xs font-bold uppercase text-gray-400 mb-2">{dom}</p>
                    <div className="space-y-1.5">
                      {items.map(obj => (
                        <div key={obj.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                          <div className="flex-1">
                            <span className="text-sm font-medium">{obj.indicateur}</span>
                            <span className="text-xs text-gray-400 ml-2">
                              {obj.periode === 'mensuel' && obj.mois ? `Mois ${obj.mois}` : obj.periode === 'trimestriel' && obj.trimestre ? `T${obj.trimestre}` : obj.periode}
                            </span>
                          </div>
                          <span className="font-bold text-sm text-primary mr-3">{obj.valeur_cible} {obj.unite}</span>
                          <button onClick={() => deleteObjective(obj.id)} className="text-red-400 hover:text-red-600 text-xs">Suppr.</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Objectif Form Modal */}
        {showObjForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createObjective} className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouvel objectif — {objAnnee}</h2>
              <div className="space-y-3">
                <select value={objForm.domaine} onChange={e => setObjForm({ ...objForm, domaine: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="collecte">Collecte</option>
                  <option value="production">Production</option>
                  <option value="tri">Tri</option>
                  <option value="rh">RH</option>
                  <option value="commercial">Commercial</option>
                  <option value="logistique">Logistique</option>
                </select>
                <input placeholder="Indicateur (ex: Tonnage collecte) *" value={objForm.indicateur} onChange={e => setObjForm({ ...objForm, indicateur: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Unite (ex: tonnes, %, EUR)" value={objForm.unite} onChange={e => setObjForm({ ...objForm, unite: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <select value={objForm.periode} onChange={e => setObjForm({ ...objForm, periode: e.target.value, mois: '', trimestre: '' })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="mensuel">Mensuel</option>
                  <option value="trimestriel">Trimestriel</option>
                  <option value="annuel">Annuel</option>
                </select>
                {objForm.periode === 'mensuel' && (
                  <select value={objForm.mois} onChange={e => setObjForm({ ...objForm, mois: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Tous les mois</option>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'][m-1]}</option>)}
                  </select>
                )}
                {objForm.periode === 'trimestriel' && (
                  <select value={objForm.trimestre} onChange={e => setObjForm({ ...objForm, trimestre: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Tous les trimestres</option>
                    <option value="1">T1</option>
                    <option value="2">T2</option>
                    <option value="3">T3</option>
                    <option value="4">T4</option>
                  </select>
                )}
                <input type="number" step="0.01" placeholder="Valeur cible *" value={objForm.valeur_cible} onChange={e => setObjForm({ ...objForm, valeur_cible: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Commentaire" value={objForm.commentaire} onChange={e => setObjForm({ ...objForm, commentaire: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowObjForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Creer</button>
              </div>
            </form>
          </div>
        )}

        {showTemplateForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createTemplate} className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouveau modèle</h2>
              <div className="space-y-3">
                <input placeholder="Nom du modèle *" value={templateForm.name} onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <select value={templateForm.type} onChange={e => setTemplateForm({ ...templateForm, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
                <input placeholder="Objet (email)" value={templateForm.subject} onChange={e => setTemplateForm({ ...templateForm, subject: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <textarea placeholder="Corps du message *" value={templateForm.body} onChange={e => setTemplateForm({ ...templateForm, body: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows="5" required />
                <input placeholder="Variables (ex: {nom}, {date})" value={templateForm.variables} onChange={e => setTemplateForm({ ...templateForm, variables: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowTemplateForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}

function StatusItem({ label, active }) {
  return (
    <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
      <span className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-green-500' : 'bg-red-400'}`} />
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`ml-auto text-xs font-medium ${active ? 'text-green-600' : 'text-red-500'}`}>
        {active ? 'OK' : 'KO'}
      </span>
    </div>
  );
}
