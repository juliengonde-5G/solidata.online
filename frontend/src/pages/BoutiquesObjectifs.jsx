import { useState, useEffect } from 'react';
import { Target, Save } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import Layout from '../components/Layout';
import { LoadingSpinner, useToast, PageHeader } from '../components';
import api from '../services/api';

const MOIS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

export default function BoutiquesObjectifs() {
  const toast = useToast();
  const [boutiques, setBoutiques] = useState([]);
  const [boutiqueId, setBoutiqueId] = useState('');
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [objectifs, setObjectifs] = useState([]);
  const [ventes, setVentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/boutiques?active=true').then(res => {
      setBoutiques(res.data || []);
      if (res.data?.length > 0) setBoutiqueId(String(res.data[0].id));
    });
  }, []);

  useEffect(() => { if (boutiqueId) load(); }, [boutiqueId, annee]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/boutique-objectifs/compare?boutique_id=${boutiqueId}&annee=${annee}`);
      const objs = res.data.objectifs.filter(o => o.segment === 'global');
      // Construire un tableau de 12 mois
      const grid = Array.from({ length: 12 }, (_, i) => {
        const existing = objs.find(o => o.mois === i + 1);
        return {
          mois: i + 1,
          ca_objectif_ht: existing?.ca_objectif_ht || '',
          nb_tickets_objectif: existing?.nb_tickets_objectif || '',
          panier_moyen_objectif: existing?.panier_moyen_objectif || '',
        };
      });
      setObjectifs(grid);
      setVentes(res.data.ventes_global || []);
    } catch (e) { toast.error('Erreur chargement'); }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = objectifs
        .filter(o => o.ca_objectif_ht !== '' && o.ca_objectif_ht !== null)
        .map(o => ({
          mois: o.mois,
          ca_objectif_ht: parseFloat(o.ca_objectif_ht) || 0,
          nb_tickets_objectif: o.nb_tickets_objectif ? parseInt(o.nb_tickets_objectif) : null,
          panier_moyen_objectif: o.panier_moyen_objectif ? parseFloat(o.panier_moyen_objectif) : null,
        }));
      await api.post('/boutique-objectifs/bulk', { boutique_id: parseInt(boutiqueId), annee, segment: 'global', objectifs: payload });
      toast.success('Objectifs enregistrés');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur sauvegarde');
    }
    setSaving(false);
  }

  const chartData = MOIS.map((m, i) => {
    const obj = objectifs[i];
    const v = ventes.find(x => x.mois === i + 1);
    return {
      mois: m,
      objectif: parseFloat(obj?.ca_objectif_ht) || 0,
      realise: v?.ca_ttc || 0,
    };
  });

  if (loading && boutiques.length === 0) return <Layout><LoadingSpinner size="lg" /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-6xl">
        <PageHeader
          title="Objectifs de vente"
          subtitle="Budget annuel ventilé en objectifs mensuels de CA TTC"
          icon={Target}
        />

        <div className="bg-white rounded-card shadow-card p-4 mb-4 flex flex-wrap gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Boutique</label>
            <select value={boutiqueId} onChange={(e) => setBoutiqueId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              {boutiques.map(b => <option key={b.id} value={b.id}>{b.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Année</label>
            <input type="number" value={annee} onChange={(e) => setAnnee(parseInt(e.target.value) || new Date().getFullYear())} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-28" />
          </div>
        </div>

        {loading ? <LoadingSpinner /> : (
          <>
            <div className="bg-white rounded-card shadow-card p-4 mb-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Saisie des objectifs mensuels</h3>
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2 px-2">Mois</th>
                    <th className="text-right py-2 px-2">CA objectif TTC (€)</th>
                    <th className="text-right py-2 px-2">Nb tickets</th>
                    <th className="text-right py-2 px-2">Panier moy. (€)</th>
                    <th className="text-right py-2 px-2">CA réalisé</th>
                    <th className="text-right py-2 px-2">% atteinte</th>
                  </tr>
                </thead>
                <tbody>
                  {objectifs.map((o, i) => {
                    const v = ventes.find(x => x.mois === o.mois);
                    const realise = v?.ca_ttc || 0;
                    const objNum = parseFloat(o.ca_objectif_ht) || 0;
                    const pct = objNum > 0 ? (realise / objNum) * 100 : null;
                    return (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2 px-2 font-medium">{MOIS[i]}</td>
                        <td className="py-2 px-2">
                          <input type="number" step="100" value={o.ca_objectif_ht} onChange={(e) => {
                            const n = [...objectifs]; n[i].ca_objectif_ht = e.target.value; setObjectifs(n);
                          }} className="w-28 border border-slate-300 rounded px-2 py-1 text-right" />
                        </td>
                        <td className="py-2 px-2">
                          <input type="number" value={o.nb_tickets_objectif} onChange={(e) => {
                            const n = [...objectifs]; n[i].nb_tickets_objectif = e.target.value; setObjectifs(n);
                          }} className="w-20 border border-slate-300 rounded px-2 py-1 text-right" />
                        </td>
                        <td className="py-2 px-2">
                          <input type="number" step="0.1" value={o.panier_moyen_objectif} onChange={(e) => {
                            const n = [...objectifs]; n[i].panier_moyen_objectif = e.target.value; setObjectifs(n);
                          }} className="w-20 border border-slate-300 rounded px-2 py-1 text-right" />
                        </td>
                        <td className="py-2 px-2 text-right text-slate-600">{realise.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</td>
                        <td className="py-2 px-2 text-right font-medium">
                          {pct !== null ? (
                            <span className={pct >= 100 ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600'}>
                              {pct.toFixed(0)}%
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex justify-end mt-4">
                <button onClick={save} disabled={saving} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                  <Save className="w-4 h-4" />
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-card shadow-card p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Objectif vs Réalisé ({annee})</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip formatter={(v) => `${v.toLocaleString('fr-FR')} €`} />
                  <Legend />
                  <Bar dataKey="objectif" fill="#FBCFE8" name="Objectif" />
                  <Bar dataKey="realise" fill="#EC4899" name="Réalisé" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
