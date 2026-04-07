import { useState, useEffect } from 'react';
import { Factory } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, StatusBadge } from '../components';
import api from '../services/api';
import DiagrammeFluxTri from '../components/DiagrammeFluxTri';

const POSTES_LABELS = {
  'Crack 1': { color: 'bg-blue-500', short: 'CR1' },
  'Crack 2': { color: 'bg-blue-400', short: 'CR2' },
  'R1': { color: 'bg-green-500', short: 'R1' },
  'R2': { color: 'bg-green-400', short: 'R2' },
  'R3': { color: 'bg-amber-500', short: 'R3' },
  'R4': { color: 'bg-amber-400', short: 'R4' },
  'Réu': { color: 'bg-purple-500', short: 'RÉU' },
  'Triage fin': { color: 'bg-pink-500', short: 'TF' },
  'Chiffons': { color: 'bg-teal-500', short: 'CHF' },
};

export default function ChaineTri() {
  const [chains, setChains] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedChain, setSelectedChain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vue, setVue] = useState('diagramme'); // diagramme | chaines | production
  const [prodData, setProdData] = useState([]);
  const [prodMonth, setProdMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (vue === 'production') loadProdData(); }, [vue, prodMonth]);

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

  const loadProdData = async () => {
    try {
      const res = await api.get(`/production?month=${prodMonth}`);
      setProdData(res.data || []);
    } catch (err) { console.error(err); }
  };

  const loadChainDetail = async (id) => {
    try {
      const res = await api.get(`/tri/chaines/${id}`);
      setSelectedChain(res.data);
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de la chaîne de tri..." /></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Chaînes de tri</h1>
            <p className="text-gray-500">Flux de tri, postes de travail et débouchés</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setVue('diagramme')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${vue === 'diagramme' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Diagramme des flux
            </button>
            <button
              onClick={() => setVue('chaines')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${vue === 'chaines' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Chaînes & catégories
            </button>
            <button
              onClick={() => setVue('production')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${vue === 'production' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Production & Effectifs
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
                <StatusBadge status={chain.is_active ? 'active' : 'inactive'} size="sm" />
              </div>
              {chain.description && <p className="text-sm text-gray-500 mb-3">{chain.description}</p>}
              <div className="text-xs text-gray-500 mb-3">
                {chain.nb_operations || 0} opérations · {chain.nb_postes || 0} postes
              </div>
              <button onClick={() => loadChainDetail(chain.id)} className="text-primary text-sm font-medium hover:underline">
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
                  <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">{op.numero ?? op.ordre}</span>
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
          <h2 className="text-xl font-bold text-slate-800 mb-4">Catégories sortantes</h2>
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

        {/* ═══ VUE PRODUCTION & EFFECTIFS ═══ */}
        {vue === 'production' && (
          <div>
            {/* Month selector */}
            <div className="flex items-center gap-4 mb-6">
              <input
                type="month"
                value={prodMonth}
                onChange={e => setProdMonth(e.target.value)}
                className="input-modern w-auto"
              />
              <span className="text-sm text-gray-500">{prodData.length} jours enregistrés</span>
            </div>

            {/* Summary cards */}
            {prodData.length > 0 && (() => {
              const avgEffectif = (prodData.reduce((s, d) => s + (d.effectif_reel || 0), 0) / prodData.length).toFixed(1);
              const totalEntree = prodData.reduce((s, d) => s + (d.entree_ligne_kg || 0) + (d.entree_recyclage_r3_kg || 0), 0);
              const totalSortie = prodData.reduce((s, d) => s + (d.total_jour_t || 0) * 1000, 0);
              const avgProductivite = (prodData.reduce((s, d) => s + (d.productivite_kg_per || 0), 0) / prodData.length).toFixed(0);
              return (
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="bg-white rounded-xl shadow-sm border p-4">
                    <p className="text-xs text-gray-500 font-medium">Effectif moyen / jour</p>
                    <p className="text-2xl font-bold text-slate-800">{avgEffectif}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border p-4">
                    <p className="text-xs text-gray-500 font-medium">Total entrée (kg)</p>
                    <p className="text-2xl font-bold text-blue-600">{totalEntree.toLocaleString('fr-FR')}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border p-4">
                    <p className="text-xs text-gray-500 font-medium">Total sortie (kg)</p>
                    <p className="text-2xl font-bold text-green-600">{totalSortie.toLocaleString('fr-FR')}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border p-4">
                    <p className="text-xs text-gray-500 font-medium">Productivité moy. (kg/pers)</p>
                    <p className="text-2xl font-bold text-purple-600">{avgProductivite}</p>
                  </div>
                </div>
              );
            })()}

            {/* Daily chart - bar chart with stacked bars */}
            <div className="bg-white rounded-xl shadow-sm border p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-600 mb-4">Production journalière & effectifs</h3>
              {prodData.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Aucune donnée pour ce mois</p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="flex items-end gap-1 min-h-[220px]" style={{ minWidth: prodData.length * 42 }}>
                    {prodData.map((day, i) => {
                      const entreeLigne = day.entree_ligne_kg || 0;
                      const entreeR3 = day.entree_recyclage_r3_kg || 0;
                      const totalKg = entreeLigne + entreeR3;
                      const maxKg = Math.max(...prodData.map(d => (d.entree_ligne_kg || 0) + (d.entree_recyclage_r3_kg || 0)), 1);
                      const barHeight = (totalKg / maxKg) * 180;
                      const ligneH = totalKg > 0 ? (entreeLigne / totalKg) * barHeight : 0;
                      const r3H = barHeight - ligneH;
                      const dateStr = new Date(day.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
                      const isWeekend = [0, 6].includes(new Date(day.date).getDay());

                      return (
                        <div key={i} className="flex flex-col items-center" style={{ width: 36 }}>
                          {/* Effectif badge on top */}
                          <span className={`text-[10px] font-bold mb-1 ${(day.effectif_reel || 0) < (day.effectif_theorique || 0) ? 'text-red-500' : 'text-slate-800'}`}>
                            {day.effectif_reel || 0}
                          </span>
                          {/* Stacked bar */}
                          <div className="flex flex-col justify-end" style={{ height: 180 }}>
                            <div className="bg-blue-400 rounded-t" style={{ height: ligneH, width: 24 }} title={`Ligne: ${entreeLigne} kg`} />
                            <div className="bg-amber-400 rounded-b" style={{ height: r3H, width: 24 }} title={`R3: ${entreeR3} kg`} />
                          </div>
                          {/* Date label */}
                          <span className={`text-[9px] mt-1 ${isWeekend ? 'text-red-400' : 'text-gray-400'}`}>{dateStr}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 rounded" /> Chaîne Qualité (ligne)</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded" /> Recyclage Exclusif (R3)</span>
                    <span className="flex items-center gap-1"><span className="text-[10px] font-bold text-slate-800">N</span> = effectif réel</span>
                  </div>
                </div>
              )}
            </div>

            {/* Daily detail table */}
            {(() => {
              const prodColumns = [
                { key: 'date', label: 'Date', sortable: true, render: (day) => (
                  <span className="font-medium">{new Date(day.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                )},
                { key: 'effectif_theorique', label: 'Effectif théo.', align: 'center', render: (day) => day.effectif_theorique || '—' },
                { key: 'effectif_reel', label: 'Effectif réel', align: 'center', render: (day) => {
                  const effDiff = (day.effectif_reel || 0) - (day.effectif_theorique || 0);
                  return <span className={`font-medium ${effDiff < 0 ? 'text-red-600' : 'text-green-600'}`}>{day.effectif_reel || '—'}</span>;
                }},
                { key: 'entree_ligne_kg', label: 'Entrée ligne (kg)', align: 'right', sortable: true, render: (day) => (
                  <span className="font-mono">{(day.entree_ligne_kg || 0).toLocaleString('fr-FR')}</span>
                )},
                { key: 'entree_recyclage_r3_kg', label: 'Entrée R3 (kg)', align: 'right', sortable: true, render: (day) => (
                  <span className="font-mono">{(day.entree_recyclage_r3_kg || 0).toLocaleString('fr-FR')}</span>
                )},
                { key: 'total_jour_t', label: 'Total jour (t)', align: 'right', sortable: true, render: (day) => (
                  <span className="font-mono font-medium">{day.total_jour_t ? parseFloat(day.total_jour_t).toFixed(3) : '—'}</span>
                )},
                { key: 'productivite_kg_per', label: 'Productivité (kg/pers)', align: 'right', sortable: true, render: (day) => (
                  <span className="font-mono">{day.productivite_kg_per ? Math.round(day.productivite_kg_per) : '—'}</span>
                )},
                { key: 'encadrant', label: 'Encadrant', render: (day) => (
                  <span className="text-gray-600">{day.encadrant || '—'}</span>
                )},
              ];
              return (
                <DataTable
                  columns={prodColumns}
                  data={prodData}
                  loading={false}
                  emptyIcon={Factory}
                  emptyMessage="Aucune donnée pour ce mois"
                  dense
                />
              );
            })()}
          </div>
        )}
      </div>
    </Layout>
  );
}
