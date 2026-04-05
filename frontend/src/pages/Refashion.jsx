import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, StatusBadge } from '../components';
import { MapPin, Coins } from 'lucide-react';
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
          <DataTable
            columns={[
              { key: 'nom', label: 'Commune', sortable: true, render: (c) => <span className="font-medium">{c.nom}</span> },
              { key: 'code_insee', label: 'Code INSEE', render: (c) => <span className="text-gray-500">{c.code_insee}</span> },
              { key: 'population', label: 'Population', sortable: true, render: (c) => c.population?.toLocaleString('fr-FR') || '—' },
              { key: 'nb_cav', label: 'Nb CAV', sortable: true, render: (c) => c.nb_cav || 0 },
              { key: 'has_convention', label: 'Convention', render: (c) => (
                <StatusBadge status={c.has_convention ? 'active' : 'inactive'} size="sm" label={c.has_convention ? 'Active' : 'Non'} />
              )},
            ]}
            data={communes}
            loading={false}
            emptyIcon={MapPin}
            emptyMessage="Aucune commune"
          />
        )}

        {view === 'subventions' && (
          <DataTable
            columns={[
              { key: 'year', label: 'Année', sortable: true },
              { key: 'quarter', label: 'Trimestre', render: (s) => `Q${s.quarter}` },
              { key: 'montant', label: 'Montant (€)', sortable: true, render: (s) => <span className="font-medium text-primary">{parseFloat(s.montant || 0).toLocaleString('fr-FR')}€</span> },
              { key: 'status', label: 'Statut', render: (s) => (
                <StatusBadge status={s.status} size="sm" label={s.status === 'paid' ? 'Verse' : undefined} />
              )},
              { key: 'date_versement', label: 'Date versement', render: (s) => <span className="text-gray-500">{s.date_versement ? new Date(s.date_versement).toLocaleDateString('fr-FR') : '—'}</span> },
            ]}
            data={subventions}
            loading={false}
            emptyIcon={Coins}
            emptyMessage="Aucune subvention"
          />
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
