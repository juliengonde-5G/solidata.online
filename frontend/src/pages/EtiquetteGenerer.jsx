import { useState, useMemo, useEffect } from 'react';
import { ShoppingBag, Shirt, Footprints, Recycle, Printer, ChevronLeft, Check, Tag, Delete } from 'lucide-react';
import Layout from '../components/Layout';
import EtiquetteA4 from '../components/EtiquetteA4';
import api from '../services/api';
import '../styles/etiquette-print.css';

const CATEGORY_VISUALS = {
  Textiles: { icon: Shirt, color: '#2563EB', bg: '#DBEAFE' },
  Chaussures: { icon: Footprints, color: '#92400E', bg: '#FED7AA' },
  Maroquinerie: { icon: ShoppingBag, color: '#8B5A2B', bg: '#FEF3C7' },
  Chiffons: { icon: Recycle, color: '#475569', bg: '#E2E8F0' },
};

const STEPS = ['Catégorie', 'Genre', 'Saison', 'Gamme', 'Produit', 'Poids'];

export default function EtiquetteGenerer() {
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState({ categorie: '', genre: '', saison: '', gamme: '', produit: '', poids: '' });
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [poste, setPoste] = useState(null);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [p, o] = await Promise.all([
          api.get('/etiquettes/postes'),
          api.get('/etiquettes/options'),
        ]);
        if (cancelled) return;
        setPoste(p.data[0] || null);
        setOptions(o.data || []);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message || 'Erreur réseau');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const categories = useMemo(() => {
    const set = new Set(options.map(o => o.categorie_eco_org).filter(Boolean));
    return Array.from(set).map((key) => ({
      key, label: key,
      ...(CATEGORY_VISUALS[key] || { icon: Tag, color: '#475569', bg: '#E2E8F0' }),
    }));
  }, [options]);

  const filteredBy = (field, base) => {
    const set = new Set(base.map(o => o[field]).filter(Boolean));
    return Array.from(set).sort();
  };
  const filtered = useMemo(() => options.filter(o =>
    (!sel.categorie || o.categorie_eco_org === sel.categorie)
  ), [options, sel.categorie]);
  const genres = useMemo(() => filteredBy('genre', filtered), [filtered]);
  const saisons = useMemo(() => filteredBy('saison', filtered.filter(o => !sel.genre || o.genre === sel.genre)), [filtered, sel.genre]);
  const gammes = useMemo(() => filteredBy('gamme', filtered.filter(o =>
    (!sel.genre || o.genre === sel.genre) && (!sel.saison || o.saison === sel.saison)
  )), [filtered, sel.genre, sel.saison]);
  const produits = useMemo(() => {
    const list = filtered.filter(o =>
      (!sel.genre || o.genre === sel.genre) &&
      (!sel.saison || o.saison === sel.saison) &&
      (!sel.gamme || o.gamme === sel.gamme)
    );
    return list.map(o => ({ id: o.id, label: o.nom }));
  }, [filtered, sel.genre, sel.saison, sel.gamme]);

  const reset = () => {
    setSel({ categorie: '', genre: '', saison: '', gamme: '', produit: '', poids: '' });
    setStep(0);
    setSuccess(null);
    setError(null);
  };

  const onPrint = async () => {
    if (!poste) { setError('Aucun poste actif'); return; }
    const cat = options.find(o =>
      o.categorie_eco_org === sel.categorie && o.genre === sel.genre &&
      o.saison === sel.saison && o.gamme === sel.gamme && o.nom === sel.produit
    );
    if (!cat) { setError('Combinaison produit introuvable au catalogue'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/etiquettes/generer', {
        poste_id: poste.id,
        catalogue_id: cat.id,
        poids_kg: parseFloat(sel.poids.replace(',', '.')),
      });
      setSuccess(data);
      setTimeout(() => window.print(), 250);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onPoidsKey = (k) => {
    setSel((prev) => {
      let p = prev.poids;
      if (k === 'del') p = p.slice(0, -1);
      else if (k === ',') { if (!p.includes(',') && p.length > 0) p += ','; }
      else if (p.length < 5) {
        if (p === '0' && k !== ',') p = k;
        else p += k;
      }
      return { ...prev, poids: p };
    });
  };

  const canPrint = sel.categorie && sel.genre && sel.saison && sel.gamme && sel.produit && sel.poids && parseFloat(sel.poids.replace(',', '.')) > 0 && !submitting;
  const stepValid =
    (step === 0 && sel.categorie) ||
    (step === 1 && sel.genre) ||
    (step === 2 && sel.saison) ||
    (step === 3 && sel.gamme) ||
    (step === 4 && sel.produit) ||
    (step === 5 && canPrint);

  return (
    <Layout>
      <div className="no-print min-h-[calc(100vh-60px)] bg-slate-50 flex flex-col">
        <header className="bg-white border-b px-6 py-4 flex items-center gap-4 shadow-sm">
          <Tag className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-800 flex-1">Génération d'étiquette</h1>
          <div className="text-sm text-slate-500">{poste ? poste.nom : '—'}</div>
        </header>

        {error && (
          <div className="bg-rose-50 border-b border-rose-200 px-6 py-3 text-rose-800 text-sm">{error}</div>
        )}

        <nav className="bg-white border-b px-6 py-3 flex gap-2 overflow-x-auto">
          {STEPS.map((label, i) => (
            <button
              key={label}
              onClick={() => i < step && setStep(i)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition ${
                i === step
                  ? 'bg-emerald-600 text-white shadow'
                  : i < step
                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 p-8">
          {step === 0 && (
            <div>
              <h2 className="text-xl font-bold text-slate-700 mb-6">Choisir la catégorie</h2>
              {loading && (
                <div className="bg-white rounded-2xl shadow p-8 text-center text-slate-500">
                  Chargement du catalogue…
                </div>
              )}
              {!loading && categories.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-amber-900">
                  <div className="text-xl font-bold mb-3">Catalogue vide</div>
                  <p className="mb-2">Aucun produit dans <code className="px-1 bg-amber-100 rounded">produits_catalogue</code>. Pour peupler le référentiel depuis le fichier Excel historique :</p>
                  <pre className="bg-white border rounded p-3 text-xs overflow-x-auto">node backend/src/scripts/seed-catalogue.js --commit</pre>
                  <p className="mt-3 text-sm">Pour aussi importer les 10 398 cartons historiques :</p>
                  <pre className="bg-white border rounded p-3 text-xs overflow-x-auto">node backend/src/scripts/import-saisie-produit.js --commit</pre>
                </div>
              )}
              {!loading && categories.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                  {categories.map((c) => {
                    const Icon = c.icon;
                    const active = sel.categorie === c.key;
                    return (
                      <button
                        key={c.key}
                        onClick={() => { setSel({ ...sel, categorie: c.key, genre: '', saison: '', gamme: '', produit: '' }); setStep(1); }}
                        className={`relative aspect-square rounded-2xl shadow-md flex flex-col items-center justify-center gap-4 transition transform hover:scale-105 ${
                          active ? 'ring-4 ring-emerald-500' : ''
                        }`}
                        style={{ background: c.bg, color: c.color }}
                      >
                        <Icon className="w-24 h-24" strokeWidth={1.5} />
                        <span className="text-2xl font-bold">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <PickGrid title="Genre" items={genres} value={sel.genre} onPick={(v) => { setSel({ ...sel, genre: v, saison: '', gamme: '', produit: '' }); setStep(2); }} />
          )}
          {step === 2 && (
            <PickGrid title="Saison" items={saisons} value={sel.saison} onPick={(v) => { setSel({ ...sel, saison: v, gamme: '', produit: '' }); setStep(3); }} cols={3} />
          )}
          {step === 3 && (
            <PickGrid title="Gamme" items={gammes} value={sel.gamme} onPick={(v) => { setSel({ ...sel, gamme: v, produit: '' }); setStep(4); }} cols={3} />
          )}
          {step === 4 && (
            <PickGrid
              title="Produit"
              items={produits.map(p => p.label)}
              value={sel.produit}
              onPick={(v) => { setSel({ ...sel, produit: v }); setStep(5); }}
            />
          )}

          {step === 5 && (
            <div>
              <h2 className="text-xl font-bold text-slate-700 mb-6">Poids du carton (kg)</h2>
              <div className="bg-white rounded-3xl shadow-lg p-8 max-w-md mx-auto">
                <div className="text-7xl font-extrabold text-center text-slate-800 mb-6 min-h-[7rem] flex items-center justify-center">
                  {sel.poids || '0'}
                  <span className="text-3xl text-slate-400 ml-3">kg</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'del'].map((k) => (
                    <button
                      key={k}
                      onClick={() => onPoidsKey(k)}
                      className="aspect-square rounded-2xl text-3xl font-bold bg-slate-100 hover:bg-slate-200 active:bg-slate-300 transition flex items-center justify-center"
                    >
                      {k === 'del' ? <Delete className="w-8 h-8" /> : k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-w-md mx-auto mt-8">
                <button
                  onClick={onPrint}
                  disabled={!canPrint}
                  className="w-full h-32 rounded-3xl text-3xl font-extrabold bg-emerald-600 text-white shadow-xl hover:bg-emerald-700 active:scale-95 transition disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-4"
                >
                  <Printer className="w-12 h-12" />
                  IMPRIMER
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="bg-white border-t px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="px-5 py-3 rounded-xl bg-slate-200 hover:bg-slate-300 disabled:opacity-40 flex items-center gap-2 font-semibold"
          >
            <ChevronLeft className="w-5 h-5" /> Retour
          </button>
          <div className="text-sm text-slate-600 flex flex-wrap gap-x-4">
            {sel.categorie && <span>📦 {sel.categorie}</span>}
            {sel.genre && <span>👤 {sel.genre}</span>}
            {sel.saison && <span>🌤️ {sel.saison}</span>}
            {sel.gamme && <span>🏷️ {sel.gamme}</span>}
            {sel.produit && <span>🎯 {sel.produit}</span>}
            {sel.poids && <span>⚖️ {sel.poids} kg</span>}
          </div>
          <button
            onClick={reset}
            className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-600"
          >
            Annuler
          </button>
        </footer>

        {success && (
          <div className="fixed inset-0 z-50 bg-emerald-600/95 flex flex-col items-center justify-center text-white">
            <Check className="w-40 h-40 mb-6" strokeWidth={3} />
            <div className="text-3xl font-bold mb-2">Étiquette imprimée</div>
            <div className="text-6xl font-extrabold tracking-wider mb-8">{success.code_barre}</div>
            <button
              onClick={reset}
              className="px-8 py-4 rounded-2xl bg-white text-emerald-700 text-xl font-bold shadow-xl hover:bg-emerald-50"
            >
              Nouvelle étiquette
            </button>
          </div>
        )}
      </div>

      {success && <EtiquetteA4 data={success} />}
    </Layout>
  );
}

function PickGrid({ title, items, value, onPick, cols }) {
  const colsClass = cols === 3 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-700 mb-6">{title}</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {items.map((it) => (
          <button
            key={it}
            onClick={() => onPick(it)}
            className={`px-6 py-8 rounded-2xl text-xl font-bold shadow-md transition transform hover:scale-105 ${
              value === it ? 'bg-emerald-600 text-white ring-4 ring-emerald-300' : 'bg-white text-slate-800 hover:bg-emerald-50'
            }`}
          >
            {it}
          </button>
        ))}
      </div>
    </div>
  );
}
