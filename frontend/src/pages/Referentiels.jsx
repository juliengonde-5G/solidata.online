import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, StatusBadge } from '../components';
import { Building2, Truck } from 'lucide-react';
import api from '../services/api';

export default function Referentiels() {
  const [view, setView] = useState('associations');
  const [associations, setAssociations] = useState([]);
  const [exutoires, setExutoires] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [conteneurs, setConteneurs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [aRes, eRes, cRes, tRes] = await Promise.all([
        api.get('/referentiels/associations'),
        api.get('/referentiels/exutoires'),
        api.get('/referentiels/catalogue'),
        api.get('/referentiels/conteneurs'),
      ]);
      setAssociations(aRes.data);
      setExutoires(eRes.data);
      setCatalogue(cRes.data);
      setConteneurs(tRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createItem = async (e) => {
    e.preventDefault();
    try {
      if (view === 'associations') await api.post('/referentiels/associations', form);
      else if (view === 'exutoires') await api.post('/referentiels/exutoires', form);
      else if (view === 'catalogue') await api.post('/referentiels/catalogue', form);
      setShowForm(false);
      setForm({});
      loadAll();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des référentiels..." /></Layout>;

  const tabs = [
    { key: 'associations', label: 'Associations', count: associations.length },
    { key: 'exutoires', label: 'Débouchés', count: exutoires.length },
    { key: 'catalogue', label: 'Catalogue Produits', count: catalogue.length },
    { key: 'conteneurs', label: 'Types Conteneurs', count: conteneurs.length },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Référentiels</h1>
            <p className="text-gray-500">Données de référence</p>
          </div>
          {view !== 'conteneurs' && (
            <button onClick={() => { setForm({}); setShowForm(true); }} className="btn-primary text-sm">
              + Ajouter
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setView(t.key)} className={`px-3 py-1.5 rounded-lg text-sm ${view === t.key ? 'bg-primary text-white' : 'bg-gray-100'}`}>
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Associations */}
        {view === 'associations' && (
          <DataTable
            columns={[
              { key: 'nom', label: 'Nom', sortable: true, render: (a) => <span className="font-medium">{a.nom}</span> },
              { key: 'type', label: 'Type', render: (a) => <span className="text-gray-500">{a.type || '—'}</span> },
              { key: 'commune', label: 'Commune', sortable: true, render: (a) => a.commune || '—' },
              { key: 'contact', label: 'Contact', render: (a) => <span className="text-gray-500">{a.contact_nom || '—'} {a.contact_tel ? `(${a.contact_tel})` : ''}</span> },
              { key: 'is_active', label: 'Statut', render: (a) => <StatusBadge status={a.is_active !== false ? 'active' : 'inactive'} size="sm" /> },
            ]}
            data={associations}
            loading={false}
            emptyIcon={Building2}
            emptyMessage="Aucune association"
          />
        )}

        {/* Débouchés */}
        {view === 'exutoires' && (
          <DataTable
            columns={[
              { key: 'nom', label: 'Nom', sortable: true, render: (e) => <span className="font-medium">{e.nom}</span> },
              { key: 'type', label: 'Type', render: (e) => <span className="text-gray-500">{e.type || '—'}</span> },
              { key: 'adresse', label: 'Adresse', render: (e) => e.adresse || '—' },
              { key: 'contact_nom', label: 'Contact', render: (e) => <span className="text-gray-500">{e.contact_nom || '—'}</span> },
            ]}
            data={exutoires}
            loading={false}
            emptyIcon={Truck}
            emptyMessage="Aucun débouché"
          />
        )}

        {/* Catalogue */}
        {view === 'catalogue' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {catalogue.map(p => (
              <div key={p.id} className="bg-white rounded-lg shadow-sm border p-4">
                <h3 className="font-medium text-sm">{p.nom}</h3>
                <div className="mt-2 space-y-1 text-xs text-gray-500">
                  <p>Catégorie éco-org : {p.categorie_eco_org || '—'}</p>
                  <p>Genre : {p.genre || '—'}</p>
                  <p>Saison : {p.saison || '—'}</p>
                  <p>Gamme : {p.gamme || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Conteneurs */}
        {view === 'conteneurs' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {conteneurs.map(c => (
              <div key={c.id} className="bg-white rounded-xl shadow-sm border p-5">
                <h3 className="font-bold">{c.nom}</h3>
                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <p>Capacité : {c.capacite_litres || '—'} L</p>
                  <p>Poids max : {c.poids_max_kg || '—'} kg</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createItem} className="bg-white rounded-xl p-6 w-[400px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">
                {view === 'associations' ? 'Nouvelle association' : view === 'exutoires' ? 'Nouveau débouché' : 'Nouveau produit'}
              </h2>
              <div className="space-y-3">
                <input placeholder="Nom *" value={form.nom || ''} onChange={e => setForm({ ...form, nom: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Type" value={form.type || ''} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                {view === 'associations' && (
                  <>
                    <input placeholder="Adresse" value={form.adresse || ''} onChange={e => setForm({ ...form, adresse: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <input placeholder="Commune" value={form.commune || ''} onChange={e => setForm({ ...form, commune: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <input placeholder="Nom contact" value={form.contact_nom || ''} onChange={e => setForm({ ...form, contact_nom: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <input placeholder="Tél contact" value={form.contact_tel || ''} onChange={e => setForm({ ...form, contact_tel: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </>
                )}
                {view === 'exutoires' && (
                  <>
                    <input placeholder="Adresse" value={form.adresse || ''} onChange={e => setForm({ ...form, adresse: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <input placeholder="Nom contact" value={form.contact_nom || ''} onChange={e => setForm({ ...form, contact_nom: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <input placeholder="Email contact" value={form.contact_email || ''} onChange={e => setForm({ ...form, contact_email: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <input placeholder="Tél contact" value={form.contact_tel || ''} onChange={e => setForm({ ...form, contact_tel: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </>
                )}
                {view === 'catalogue' && (
                  <>
                    <input placeholder="Catégorie éco-org" value={form.categorie_eco_org || ''} onChange={e => setForm({ ...form, categorie_eco_org: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    <select value={form.genre || ''} onChange={e => setForm({ ...form, genre: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="">Genre</option>
                      <option value="homme">Homme</option>
                      <option value="femme">Femme</option>
                      <option value="enfant">Enfant</option>
                      <option value="mixte">Mixte</option>
                    </select>
                    <select value={form.saison || ''} onChange={e => setForm({ ...form, saison: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="">Saison</option>
                      <option value="Été">Été</option>
                      <option value="Hiver">Hiver</option>
                      <option value="Mi-saison">Mi-saison</option>
                      <option value="Sans Saison">Sans Saison</option>
                    </select>
                    <input placeholder="Gamme" value={form.gamme || ''} onChange={e => setForm({ ...form, gamme: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
