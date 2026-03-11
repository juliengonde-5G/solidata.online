import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import DiagrammeFluxTri from '../components/DiagrammeFluxTri';

export default function ChaineTri() {
  const [chains, setChains] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedChain, setSelectedChain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vue, setVue] = useState('diagramme'); // diagramme | chaines

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [chainsRes, catRes] = await Promise.all([
        api.get('/tri/chaines'),
        api.get('/tri/categories'),
      ]);
      setChains(chainsRes.data);
      setCategories(catRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadChainDetail = async (id) => {
    try {
      const res = await api.get(`/tri/chaines/${id}`);
      setSelectedChain(res.data);
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Chaînes de tri</h1>
            <p className="text-gray-500">Flux de tri, postes de travail et exutoires</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setVue('diagramme')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${vue === 'diagramme' ? 'bg-solidata-green text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Diagramme des flux
            </button>
            <button
              onClick={() => setVue('chaines')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${vue === 'chaines' ? 'bg-solidata-green text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Chaînes & catégories
            </button>
          </div>
        </div>

        {/* Diagramme des flux (mapping Chaîne Qualité + Recyclage Exclusif) */}
        {vue === 'diagramme' && (
          <div className="mb-8">
            <DiagrammeFluxTri />
          </div>
        )}

        {/* Chains (vue détail chaînes / catégories) */}
        {vue === 'chaines' && (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {chains.map(chain => (
            <div key={chain.id} className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-lg">{chain.nom}</h3>
                <span className={`px-2 py-1 rounded text-xs font-medium ${chain.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {chain.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              {chain.description && <p className="text-sm text-gray-500 mb-3">{chain.description}</p>}
              <div className="text-xs text-gray-500 mb-3">
                {chain.nb_operations || 0} opérations · {chain.nb_postes || 0} postes
              </div>
              <button onClick={() => loadChainDetail(chain.id)} className="text-solidata-green text-sm font-medium hover:underline">
                Voir les opérations →
              </button>
            </div>
          ))}
        </div>

        {/* Chain Detail */}
        {selectedChain && (
          <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{selectedChain.nom} — Opérations</h2>
              <button onClick={() => setSelectedChain(null)} className="text-gray-400 hover:text-gray-600 text-sm">Fermer</button>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {selectedChain.operations?.map((op, i) => (
                <div key={op.id} className="flex items-center gap-2">
                  <div className="bg-solidata-green/10 border border-solidata-green/30 rounded-xl p-4 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded-full bg-solidata-green text-white flex items-center justify-center text-xs font-bold">{op.numero ?? op.ordre}</span>
                      <h4 className="font-semibold text-sm">{op.nom}</h4>
                    </div>
                    {op.description && <p className="text-xs text-gray-500">{op.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">{op.nb_postes || 0} postes</p>
                  </div>
                  {i < (selectedChain.operations?.length || 0) - 1 && (
                    <span className="text-gray-300 text-xl">→</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Categories sortantes */}
        <div>
          <h2 className="text-xl font-bold text-solidata-dark mb-4">Catégories sortantes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map(cat => (
              <div key={cat.id} className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.couleur || '#8BC540' }}></div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{cat.nom}</p>
                  <p className="text-xs text-gray-400">{cat.code || '—'}</p>
                </div>
                <span className="text-xs text-gray-400">{cat.categorie_refashion || '—'}</span>
              </div>
            ))}
          </div>
        </div>
        </>
        )}
      </div>
    </Layout>
  );
}
