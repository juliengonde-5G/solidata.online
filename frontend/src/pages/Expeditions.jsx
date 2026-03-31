import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function Expeditions() {
  const [expeditions, setExpeditions] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [exutoires, setExutoires] = useState([]);
  const [form, setForm] = useState({
    exutoire_id: '', date_expedition: new Date().toISOString().slice(0, 10),
    poids_total_kg: '', nb_palettes: '', transporteur: '', bon_livraison: '', notes: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [expRes, sumRes, exuRes] = await Promise.all([
        api.get('/expeditions'),
        api.get('/expeditions/summary'),
        api.get('/referentiels/exutoires'),
      ]);
      setExpeditions(expRes.data);
      setSummary(sumRes.data);
      setExutoires(exuRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createExpedition = async (e) => {
    e.preventDefault();
    try {
      await api.post('/expeditions', form);
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Expéditions</h1>
            <p className="text-gray-500">Suivi des expéditions et livraisons</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouvelle expédition
          </button>
        </div>

        {/* Monthly Summary */}
        {summary.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {summary.slice(0, 4).map(s => (
              <div key={s.month || s.exutoire} className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500">{s.exutoire_nom || s.month}</p>
                <p className="text-xl font-bold text-solidata-green">{parseFloat(s.total_kg || 0).toFixed(0)} <span className="text-xs font-normal text-gray-400">kg</span></p>
                <p className="text-xs text-gray-400">{s.nb_expeditions || 0} expéditions</p>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Destinataire</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Poids (kg)</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Palettes</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Transporteur</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">BL</th>
              </tr>
            </thead>
            <tbody>
              {expeditions.map(exp => (
                <tr key={exp.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-sm font-medium">{new Date(exp.date_expedition).toLocaleDateString('fr-FR')}</td>
                  <td className="p-3 text-sm">{exp.exutoire_nom || '—'}</td>
                  <td className="p-3 text-sm font-medium">{exp.poids_total_kg}</td>
                  <td className="p-3 text-sm">{exp.nb_palettes || '—'}</td>
                  <td className="p-3 text-sm text-gray-500">{exp.transporteur || '—'}</td>
                  <td className="p-3 text-sm text-gray-400">{exp.bon_livraison || '—'}</td>
                </tr>
              ))}
              {expeditions.length === 0 && (
                <tr><td colSpan="6" className="p-8 text-center text-gray-400">Aucune expédition</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createExpedition} className="bg-white rounded-xl p-6 w-[420px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouvelle expédition</h2>
              <div className="space-y-3">
                <select value={form.exutoire_id} onChange={e => setForm({ ...form, exutoire_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">Destinataire *</option>
                  {exutoires.map(ex => <option key={ex.id} value={ex.id}>{ex.nom}</option>)}
                </select>
                <input type="date" value={form.date_expedition} onChange={e => setForm({ ...form, date_expedition: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input type="number" placeholder="Poids total (kg) *" value={form.poids_total_kg} onChange={e => setForm({ ...form, poids_total_kg: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input type="number" placeholder="Nb palettes" value={form.nb_palettes} onChange={e => setForm({ ...form, nb_palettes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Transporteur" value={form.transporteur} onChange={e => setForm({ ...form, transporteur: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="N° Bon de livraison" value={form.bon_livraison} onChange={e => setForm({ ...form, bon_livraison: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows="2" />
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
