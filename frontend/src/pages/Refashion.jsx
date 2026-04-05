import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

export default function Refashion() {
  const [dpav, setDpav] = useState(null);
  const [communes, setCommunes] = useState([]);
  const [subventions, setSubventions] = useState([]);
  const [quarter, setQuarter] = useState(`${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dpav');

  useEffect(() => { loadData(); }, [quarter]);

  const loadData = async () => {
    try {
      const year = quarter.split('-Q')[0];
      const q = quarter.split('-Q')[1];
      const [dpavRes, communesRes, subRes] = await Promise.all([
        api.get(`/refashion/dpav?year=${year}&quarter=${q}`),
        api.get('/refashion/communes'),
        api.get('/refashion/subventions'),
      ]);
      setDpav(dpavRes.data);
      setCommunes(communesRes.data);
      setSubventions(subRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const currentYear = new Date().getFullYear();
  const quarters = [];
  for (let y = currentYear; y >= currentYear - 2; y--) {
    for (let q = 4; q >= 1; q--) quarters.push(`${y}-Q${q}`);
  }

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Refashion</h1>
            <p className="text-gray-500">DPAV trimestriel, communes et subventions</p>
          </div>
          <div className="flex gap-2">
            <select value={quarter} onChange={e => setQuarter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              {quarters.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
            <button onClick={() => setView('dpav')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'dpav' ? 'bg-primary text-white' : 'bg-gray-100'}`}>DPAV</button>
            <button onClick={() => setView('communes')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'communes' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Communes</button>
            <button onClick={() => setView('subventions')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'subventions' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Subventions</button>
          </div>
        </div>

        {view === 'dpav' && dpav && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <DPAVCard label="Réemploi" value={dpav.reemploi_t} rate="80€/t" color="text-green-600" />
              <DPAVCard label="Recyclage" value={dpav.recyclage_t} rate="295€/t" color="text-blue-600" />
              <DPAVCard label="CSR" value={dpav.csr_t} rate="210€/t" color="text-orange-600" />
              <DPAVCard label="Énergie" value={dpav.energie_t} rate="20€/t" color="text-red-600" />
              <DPAVCard label="Entrée" value={dpav.entree_t} rate="193€/t" color="text-purple-600" />
            </div>

            {/* Total */}
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total subvention estimée — {quarter}</p>
                  <p className="text-3xl font-bold text-primary">{(dpav.total_subvention || 0).toLocaleString('fr-FR')} €</p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>Tonnage total : {(dpav.total_t || 0).toFixed(1)}t</p>
                  <p>Nb de communes : {dpav.nb_communes || 0}</p>
                </div>
              </div>
            </div>

            {/* Detail table */}
            {dpav.details && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 text-xs font-semibold text-gray-500">Catégorie</th>
                      <th className="text-left p-3 text-xs font-semibold text-gray-500">Tonnage (t)</th>
                      <th className="text-left p-3 text-xs font-semibold text-gray-500">Taux (€/t)</th>
                      <th className="text-left p-3 text-xs font-semibold text-gray-500">Subvention (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dpav.details.map(d => (
                      <tr key={d.categorie} className="border-t">
                        <td className="p-3 text-sm font-medium">{d.categorie}</td>
                        <td className="p-3 text-sm">{d.tonnage?.toFixed(2)}</td>
                        <td className="p-3 text-sm text-gray-500">{d.taux}€</td>
                        <td className="p-3 text-sm font-medium text-primary">{d.subvention?.toLocaleString('fr-FR')}€</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === 'communes' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Commune</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Code INSEE</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Population</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Nb CAV</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Convention</th>
                </tr>
              </thead>
              <tbody>
                {communes.map(c => (
                  <tr key={c.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm font-medium">{c.nom}</td>
                    <td className="p-3 text-sm text-gray-500">{c.code_insee}</td>
                    <td className="p-3 text-sm">{c.population?.toLocaleString('fr-FR') || '—'}</td>
                    <td className="p-3 text-sm">{c.nb_cav || 0}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${c.has_convention ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.has_convention ? 'Active' : 'Non'}
                      </span>
                    </td>
                  </tr>
                ))}
                {communes.length === 0 && (
                  <tr><td colSpan="5" className="p-8 text-center text-gray-400">Aucune commune</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {view === 'subventions' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Année</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Trimestre</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Montant (€)</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Date versement</th>
                </tr>
              </thead>
              <tbody>
                {subventions.map(s => (
                  <tr key={s.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm">{s.year}</td>
                    <td className="p-3 text-sm">Q{s.quarter}</td>
                    <td className="p-3 text-sm font-medium text-primary">{parseFloat(s.montant || 0).toLocaleString('fr-FR')}€</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        s.status === 'paid' ? 'bg-green-100 text-green-700' :
                        s.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {s.status === 'paid' ? 'Versé' : s.status === 'pending' ? 'En attente' : s.status}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-gray-500">{s.date_versement ? new Date(s.date_versement).toLocaleDateString('fr-FR') : '—'}</td>
                  </tr>
                ))}
                {subventions.length === 0 && (
                  <tr><td colSpan="5" className="p-8 text-center text-gray-400">Aucune subvention</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

function DPAVCard({ label, value, rate, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{(value || 0).toFixed(2)}t</p>
      <p className="text-xs text-gray-400">{rate}</p>
    </div>
  );
}
