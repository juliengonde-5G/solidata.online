import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Download, ShieldCheck, RefreshCw } from 'lucide-react';
import api from '../services/api';

const EXPORTS = [
  { slug: 'tonnage-annuel-tournee', label: 'Tonnage annuel par tournée', desc: 'Volume collecté mensuel par tournée (Annuel du Dashboard 2026)' },
  { slug: 'dpav-communes', label: 'DPAV — Tonnages par commune', desc: 'Tonnages par code postal & commune (CSV Refashion)' },
  { slug: 'dpav-sortants', label: 'DPAV — Sortants par exutoire', desc: 'Tonnages sortants par section DPAV (I à VII) et exutoire' },
  { slug: 'subvention-mensuelle', label: 'Subvention Refashion mensuelle', desc: 'Calcul mensuel basé sur le taux €/t entrant en vigueur' },
  { slug: 'coherence-tri-filiere', label: 'Cohérence entrées / sorties', desc: 'Balance mensuelle entre entrée chaîne de tri et sorties scellées' },
];

export default function AdminRefashionExports() {
  const currentYear = new Date().getFullYear();
  const [annee, setAnnee] = useState(currentYear);
  const [trimestre, setTrimestre] = useState('');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState({});
  const [error, setError] = useState(null);

  const load = async (slug) => {
    setLoading(p => ({ ...p, [slug]: true }));
    setError(null);
    try {
      const q = new URLSearchParams({ annee, ...(trimestre ? { trimestre } : {}) });
      const r = await api.get(`/refashion/exports/${slug}?${q}`);
      setData(p => ({ ...p, [slug]: r.data }));
    } catch (e) { setError(`${slug} : ${e.response?.data?.error || e.message}`); }
    finally { setLoading(p => ({ ...p, [slug]: false })); }
  };

  useEffect(() => {
    EXPORTS.forEach(e => load(e.slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annee, trimestre]);

  const downloadCsv = (slug) => {
    const q = new URLSearchParams({ annee, ...(trimestre ? { trimestre } : {}), format: 'csv' });
    const token = localStorage.getItem('token');
    fetch(`/api/refashion/exports/${slug}?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${slug}_${annee}${trimestre ? `_T${trimestre}` : ''}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
  };

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
        <header className="flex items-center gap-4 mb-6">
          <ShieldCheck className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-800">Exports DPAV Refashion (Dashboard 2026)</h1>
        </header>

        <div className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Année</label>
            <select value={annee} onChange={e => setAnnee(parseInt(e.target.value))} className="px-3 py-2 border rounded-lg">
              {Array.from({ length: 5 }, (_, i) => currentYear - i).map(y =>
                <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Trimestre (optionnel)</label>
            <select value={trimestre} onChange={e => setTrimestre(e.target.value)} className="px-3 py-2 border rounded-lg">
              <option value="">Tous</option>
              {[1, 2, 3, 4].map(t => <option key={t} value={t}>T{t}</option>)}
            </select>
          </div>
          <button onClick={() => EXPORTS.forEach(e => load(e.slug))}
            className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Recharger
          </button>
        </div>

        {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}

        <div className="grid gap-4">
          {EXPORTS.map(e => {
            const rows = data[e.slug] || [];
            return (
              <div key={e.slug} className="bg-white rounded-2xl shadow p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-slate-800">{e.label}</h3>
                    <p className="text-xs text-slate-500">{e.desc}</p>
                  </div>
                  <button onClick={() => downloadCsv(e.slug)}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm flex items-center gap-2 hover:bg-emerald-700">
                    <Download className="w-4 h-4" /> CSV
                  </button>
                </div>
                <div className="text-sm text-slate-600">
                  {loading[e.slug] ? 'Chargement…' :
                    rows.length === 0 ? <span className="italic text-slate-400">Aucune ligne pour cette période</span> :
                    <span><strong>{rows.length}</strong> ligne(s) — premier enregistrement :{' '}
                      <code className="bg-slate-100 px-1 rounded text-xs">{Object.entries(rows[0]).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' · ')}</code>
                    </span>
                  }
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
