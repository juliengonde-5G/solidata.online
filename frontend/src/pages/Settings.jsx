import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function Settings() {
  const [settings, setSettings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editSetting, setEditSetting] = useState(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', type: 'email', subject: '', body: '', variables: '' });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [setRes, tmplRes, healthRes] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/templates'),
        api.get('/health').catch(() => ({ data: null })),
      ]);
      setSettings(setRes.data);
      setTemplates(tmplRes.data);
      setHealth(healthRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
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

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-solidata-dark">Paramètres</h1>
          <p className="text-gray-500">Configuration de l'application</p>
        </div>

        {/* État du système */}
        {health && (
          <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
            <h2 className="font-semibold text-solidata-dark mb-4">État du système</h2>
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
                    <button onClick={() => setEditSetting(s.key)} className="text-solidata-green text-xs hover:underline">Modifier</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Message Templates */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="font-semibold">Modèles de messages</h2>
            <button onClick={() => setShowTemplateForm(true)} className="text-solidata-green text-sm font-medium hover:underline">+ Ajouter</button>
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

        {/* Template Form */}
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
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Créer</button>
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
