import { useState, useMemo, useEffect } from 'react';
import { ScanLine, Check, X, Package, AlertTriangle, Truck, Store } from 'lucide-react';
import Layout from '../components/Layout';
import useScannerInput from '../hooks/useScannerInput';
import { beepSuccess, beepError, beepAlreadyOut, unlockAudio } from '../utils/beep';
import api from '../services/api';

const GAMME_COLORS = {
  'BTQ STAND': 'bg-emerald-600',
  'BTQ EXTRA': 'bg-violet-600',
  'VAK': 'bg-blue-600',
  'CHIF': 'bg-slate-500',
  'Pvak': 'bg-cyan-600',
};

export default function SortieCartons() {
  const [type, setType] = useState('btq');
  const [orders, setOrders] = useState([]);
  const [order, setOrder] = useState(null);
  const [scanned, setScanned] = useState([]);
  const [flash, setFlash] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (order) return;
    let cancelled = false;
    setLoadingOrders(true);
    api.get(`/etiquettes/commandes-actives/${type}`)
      .then(({ data }) => { if (!cancelled) setOrders(data); })
      .catch(e => { if (!cancelled) setError(e.response?.data?.error || e.message); })
      .finally(() => { if (!cancelled) setLoadingOrders(false); });
    return () => { cancelled = true; };
  }, [type, order]);

  const handleScan = async (code) => {
    if (!order) return;
    if (scanned.find(s => s.code_barre === code)) {
      beepAlreadyOut();
      setFlash({ kind: 'already', code, at: Date.now() });
      setTimeout(() => setFlash(null), 600);
      return;
    }
    try {
      const { data } = await api.post('/etiquettes/sortie-scan', {
        code_barre: code,
        commande_type: order.type,
        commande_id: order.id,
      });
      beepSuccess();
      setScanned(prev => [{ ...data.carton, scanned_at: new Date() }, ...prev]);
      setFlash({ kind: 'ok', code, carton: data.carton, at: Date.now() });
      setTimeout(() => setFlash(null), 600);
    } catch (e) {
      const errCode = e.response?.data?.code;
      if (errCode === 'ALREADY_OUT') beepAlreadyOut();
      else beepError();
      setFlash({
        kind: errCode === 'ALREADY_OUT' ? 'already' : 'error',
        code,
        message: e.response?.data?.error || 'Erreur',
        at: Date.now(),
      });
      setTimeout(() => setFlash(null), 600);
    }
  };

  useScannerInput({ onScan: handleScan, enabled: !!order });

  const totalKg = useMemo(() => scanned.reduce((s, c) => s + Number(c.poids_kg || 0), 0), [scanned]);

  const pickOrder = async (o) => {
    unlockAudio();
    setOrder({ ...o, type });
    try {
      const { data } = await api.get(`/etiquettes/sortie-session/${type}/${o.id}`);
      setScanned(data.items || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  if (!order) {
    return (
      <Layout>
        <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
          <header className="flex items-center gap-4 mb-8">
            <ScanLine className="w-8 h-8 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-800">Sortie cartons par scan</h1>
          </header>

          <div className="bg-white rounded-2xl shadow p-2 inline-flex gap-2 mb-6">
            <button
              onClick={() => setType('btq')}
              className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 ${type === 'btq' ? 'bg-emerald-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Store className="w-5 h-5" /> Boutique (BTQ)
            </button>
            <button
              onClick={() => setType('vak')}
              className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 ${type === 'vak' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Truck className="w-5 h-5" /> Vrac / Exutoires (VAK)
            </button>
          </div>

          <h2 className="text-lg font-semibold text-slate-700 mb-4">Choisir la commande active</h2>
          {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}
          {loadingOrders && <div className="text-slate-400">Chargement…</div>}
          {!loadingOrders && orders.length === 0 && (
            <div className="bg-white rounded-2xl shadow p-8 text-center text-slate-500">
              Aucune commande active dans ce module pour le moment.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => pickOrder(o)}
                className="bg-white rounded-2xl shadow hover:shadow-lg p-6 text-left transition transform hover:-translate-y-1"
              >
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">{o.reference}</div>
                <div className="text-xl font-bold text-slate-800 mb-3">{o.label}</div>
                <span className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                  {(o.statut || '').replace('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 flex flex-col">
        <header className="bg-white border-b px-6 py-4 flex items-center gap-4 shadow-sm">
          <button onClick={() => setOrder(null)} className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold">← Changer</button>
          <ScanLine className="w-7 h-7 text-blue-600" />
          <div className="flex-1">
            <div className="text-xs text-slate-500">{order.reference} • {order.type === 'btq' ? 'Boutique' : 'Vrac'}</div>
            <div className="text-xl font-bold text-slate-800">{order.label}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Cartons / Poids</div>
            <div className="text-2xl font-extrabold text-slate-800">{scanned.length} <span className="text-slate-400 text-lg">/</span> {totalKg.toFixed(1)} kg</div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
          <div className="lg:col-span-2 bg-white rounded-3xl shadow-lg flex flex-col items-center justify-center min-h-[400px] relative overflow-hidden">
            {flash?.kind === 'ok' && (
              <div className="absolute inset-0 bg-emerald-500/95 flex flex-col items-center justify-center text-white animate-pulse">
                <Check className="w-32 h-32 mb-4" strokeWidth={3} />
                <div className="text-4xl font-extrabold mb-1">{flash.carton.code_barre}</div>
                <div className="text-2xl font-bold">{flash.carton.produit}</div>
                <div className="text-xl">{flash.carton.poids_kg} kg • {flash.carton.gamme}</div>
              </div>
            )}
            {flash?.kind === 'error' && (
              <div className="absolute inset-0 bg-rose-600/95 flex flex-col items-center justify-center text-white">
                <X className="w-32 h-32 mb-4" strokeWidth={3} />
                <div className="text-3xl font-extrabold">Code inconnu</div>
                <div className="text-xl mt-2">{flash.code}</div>
              </div>
            )}
            {flash?.kind === 'already' && (
              <div className="absolute inset-0 bg-amber-500/95 flex flex-col items-center justify-center text-white">
                <AlertTriangle className="w-32 h-32 mb-4" strokeWidth={2.5} />
                <div className="text-3xl font-extrabold">Déjà sorti</div>
                <div className="text-xl mt-2">{flash.code}</div>
              </div>
            )}
            {!flash && (
              <div className="text-center text-slate-400">
                <ScanLine className="w-32 h-32 mx-auto mb-4" strokeWidth={1.5} />
                <div className="text-2xl font-semibold">Scannez un carton</div>
                <div className="text-sm mt-2">La douchette envoie le code et appuie « Entrée »</div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl shadow-lg p-4 flex flex-col">
            <div className="px-2 py-2 mb-2 border-b">
              <h3 className="font-bold text-slate-700">Derniers scans</h3>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {scanned.length === 0 && <div className="text-slate-400 text-center py-8 text-sm">Aucun scan</div>}
              {scanned.map((s, i) => (
                <div key={`${s.code_barre}-${i}`} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Package className="w-5 h-5 text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-slate-800 truncate">{s.code_barre}</div>
                    <div className="text-xs text-slate-500 truncate">{s.produit}</div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-semibold text-white rounded ${GAMME_COLORS[s.gamme] || 'bg-slate-500'}`}>{s.gamme}</span>
                  <div className="text-sm font-bold text-slate-700 tabular-nums">{s.poids_kg} kg</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="bg-white border-t px-6 py-3 flex items-center justify-between text-sm text-slate-500">
          <span>Astuce : cette page écoute la douchette en permanence. Cliquez n'importe où dans la fenêtre si rien ne se passe.</span>
          <span>{order.reference}</span>
        </footer>
      </div>
    </Layout>
  );
}
