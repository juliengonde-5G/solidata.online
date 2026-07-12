import { useState, useEffect, useCallback, useMemo } from 'react';
import { ScanLine, Plus, Trash2, CheckCircle2, RotateCcw, Package, AlertTriangle } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, StatusBadge } from '../components';
import api from '../services/api';

// Badges par famille Refashion (aligné sur les vues DPAV de la vague 1).
const FAMILLE_BADGE = {
  reutilisation: { label: 'Réutilisation', cls: 'bg-emerald-100 text-emerald-700' },
  recyclage: { label: 'Recyclage', cls: 'bg-blue-100 text-blue-700' },
  csr: { label: 'CSR', cls: 'bg-amber-100 text-amber-700' },
  elimination: { label: 'Élimination', cls: 'bg-rose-100 text-rose-700' },
  retour: { label: 'Retour', cls: 'bg-slate-200 text-slate-700' },
};

const nf = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export default function TriExecution() {
  const [loading, setLoading] = useState(true);
  const [chains, setChains] = useState([]);
  const [categories, setCategories] = useState([]);
  const [batches, setBatches] = useState([]);
  const [todayExecs, setTodayExecs] = useState([]);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  // Formulaire de démarrage
  const [source, setSource] = useState('existing'); // 'existing' | 'new'
  const [startForm, setStartForm] = useState({
    batch_id: '', new_chaine_id: '', new_poids: '', operation_id: '', poids_entree_kg: '',
  });
  const [operations, setOperations] = useState([]);
  const [starting, setStarting] = useState(false);

  // Exécution active (panneau de saisie des sorties)
  const [activeExec, setActiveExec] = useState(null);
  const [outputForm, setOutputForm] = useState({ categorie_sortante_id: '', poids_kg: '' });
  const [addingOutput, setAddingOutput] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeRecap, setCompleteRecap] = useState(null);

  const loadReferentiels = useCallback(async () => {
    try {
      const [chainsRes, catRes, batchRes, execRes] = await Promise.all([
        api.get('/tri/chaines'),
        api.get('/tri/categories'),
        api.get('/tri/batches'),
        api.get('/tri/executions'),
      ]);
      setChains((chainsRes.data || []).filter((c) => c.is_active !== false));
      setCategories(catRes.data || []);
      setBatches(batchRes.data || []);
      setTodayExecs(execRes.data || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Impossible de charger les données du tri');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReferentiels(); }, [loadReferentiels]);

  // Chaîne courante (existant = chaîne du lot, nouveau = chaîne choisie).
  const activeChaineId = useMemo(() => {
    if (source === 'new') return startForm.new_chaine_id ? parseInt(startForm.new_chaine_id) : null;
    const b = batches.find((x) => String(x.id) === String(startForm.batch_id));
    return b ? b.chaine_id : null;
  }, [source, startForm.new_chaine_id, startForm.batch_id, batches]);

  // Charge les opérations de la chaîne courante pour le sélecteur d'opération.
  useEffect(() => {
    let cancelled = false;
    if (!activeChaineId) { setOperations([]); return; }
    api.get(`/tri/chaines/${activeChaineId}`)
      .then((res) => {
        if (cancelled) return;
        const ops = (res.data?.operations || []).filter((o) => o.is_active !== false);
        setOperations(ops);
      })
      .catch(() => { if (!cancelled) setOperations([]); });
    // Réinitialise l'opération choisie quand la chaîne change.
    setStartForm((f) => ({ ...f, operation_id: '' }));
    return () => { cancelled = true; };
  }, [activeChaineId]);

  const availableBatches = useMemo(
    () => batches.filter((b) => ['en_attente', 'en_cours'].includes(b.status)),
    [batches]
  );

  const openExecution = async (id) => {
    setConfirmComplete(false);
    setCompleteRecap(null);
    try {
      const res = await api.get(`/tri/executions/${id}`);
      setActiveExec(res.data);
      setOutputForm({ categorie_sortante_id: '', poids_kg: '' });
    } catch (e) {
      setError(e.response?.data?.error || 'Détail de l’exécution indisponible');
    }
  };

  const startExecution = async () => {
    setMsg(null); setError(null);
    const poids = startForm.poids_entree_kg ? parseFloat(String(startForm.poids_entree_kg).replace(',', '.')) : null;
    if (!startForm.operation_id) { setError('Choisissez une opération.'); return; }
    if (poids == null || Number.isNaN(poids) || poids <= 0) { setError('Saisissez un poids d’entrée (> 0).'); return; }

    setStarting(true);
    try {
      let batchId = startForm.batch_id ? parseInt(startForm.batch_id) : null;
      if (source === 'new') {
        const chaineId = parseInt(startForm.new_chaine_id);
        const poidsInit = parseFloat(String(startForm.new_poids).replace(',', '.'));
        if (!chaineId || !poidsInit || poidsInit <= 0) {
          setError('Choisissez une chaîne et un poids initial (> 0) pour le nouveau lot.');
          setStarting(false);
          return;
        }
        const bres = await api.post('/tri/batches', { chaine_id: chaineId, poids_initial_kg: poidsInit });
        batchId = bres.data.id;
      }
      if (!batchId) { setError('Choisissez un lot source.'); setStarting(false); return; }

      const eres = await api.post('/tri/executions', {
        batch_id: batchId,
        operation_id: parseInt(startForm.operation_id),
        poids_entree_kg: poids,
      });
      setStartForm({ batch_id: '', new_chaine_id: '', new_poids: '', operation_id: '', poids_entree_kg: '' });
      setSource('existing');
      setMsg('Exécution démarrée. Saisissez les sorties par catégorie.');
      await loadReferentiels();
      await openExecution(eres.data.id);
    } catch (e) {
      setError(e.response?.data?.error || 'Impossible de démarrer l’exécution');
    } finally {
      setStarting(false);
    }
  };

  const addOutput = async () => {
    if (!activeExec) return;
    setError(null);
    const poids = outputForm.poids_kg ? parseFloat(String(outputForm.poids_kg).replace(',', '.')) : null;
    if (!outputForm.categorie_sortante_id) { setError('Choisissez une catégorie sortante.'); return; }
    if (poids == null || Number.isNaN(poids) || poids <= 0) { setError('Saisissez un poids de sortie (> 0).'); return; }
    setAddingOutput(true);
    try {
      await api.post(`/tri/executions/${activeExec.id}/outputs`, {
        categorie_sortante_id: parseInt(outputForm.categorie_sortante_id),
        poids_kg: poids,
      });
      setOutputForm({ categorie_sortante_id: '', poids_kg: '' });
      await openExecution(activeExec.id);
    } catch (e) {
      setError(e.response?.data?.error || 'Ajout de la sortie impossible');
    } finally {
      setAddingOutput(false);
    }
  };

  const deleteOutput = async (outputId) => {
    if (!activeExec) return;
    try {
      await api.delete(`/tri/executions/${activeExec.id}/outputs/${outputId}`);
      await openExecution(activeExec.id);
    } catch (e) {
      setError(e.response?.data?.error || 'Suppression impossible');
    }
  };

  const completeExecution = async () => {
    if (!activeExec) return;
    setCompleting(true); setError(null);
    try {
      const res = await api.put(`/tri/executions/${activeExec.id}/complete`, {});
      await loadReferentiels();
      // Rafraîchit l'exécution (passe en 'termine') PUIS pose le récapitulatif
      // (openExecution réinitialise completeRecap → l'ordre est important).
      await openExecution(activeExec.id);
      setCompleteRecap({
        perte_kg: res.data.perte_kg,
        poids_sortie_total_kg: res.data.poids_sortie_total_kg,
        stock_lines_created: res.data.stock_lines_created,
      });
      setConfirmComplete(false);
    } catch (e) {
      setError(e.response?.data?.error || 'Clôture de l’exécution impossible');
    } finally {
      setCompleting(false);
    }
  };

  // Totaux du panneau actif (calcul honnête : perte = entrée − sorties, jamais négative).
  const totals = useMemo(() => {
    if (!activeExec) return null;
    const entree = Number(activeExec.poids_entree_kg || 0);
    const sortie = (activeExec.outputs || []).reduce((s, o) => s + Number(o.poids_kg || 0), 0);
    const perte = Math.max(0, entree - sortie);
    const pertePct = entree > 0 ? (perte / entree) * 100 : 0;
    const surplus = sortie > entree;
    return { entree, sortie, perte, pertePct, surplus };
  }, [activeExec]);

  // Catégories groupées par famille (pour l'optgroup du sélecteur de sortie).
  const categoriesByFamille = useMemo(() => {
    const groups = {};
    for (const c of categories) {
      const k = c.famille || 'Autres';
      (groups[k] = groups[k] || []).push(c);
    }
    return groups;
  }, [categories]);

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de l'atelier de tri..." /></Layout>;

  const activeIsOpen = activeExec && activeExec.status !== 'termine';

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader
          title="Saisie d'exécution du tri"
          subtitle="Enregistrer un crackage ou un tri fin par lot, et ses sorties par catégorie"
          icon={ScanLine}
        />

        {error && (
          <div className="mb-4 rounded-lg px-4 py-3 text-sm bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-2">
            <AlertTriangle size={16} /> {error}
          </div>
        )}
        {msg && !error && (
          <div className="mb-4 rounded-lg px-4 py-3 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200">
            {msg}
          </div>
        )}

        {/* ═══ ÉTAPE 1 — Démarrer une exécution (masquée quand une exéc. est ouverte) ═══ */}
        {!activeIsOpen && (
          <section className="card-modern p-6 mb-6">
            <h2 className="text-lg font-bold text-slate-800 mb-1">1. Démarrer une exécution</h2>
            <p className="text-sm text-gray-500 mb-4">Choisissez le lot source, l'opération et le poids d'entrée.</p>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSource('existing')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold ${source === 'existing' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
              >Lot existant</button>
              <button
                onClick={() => setSource('new')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold ${source === 'new' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
              >Nouveau lot</button>
            </div>

            {source === 'existing' ? (
              <label className="flex flex-col gap-1 text-sm mb-4 max-w-xl">
                <span className="text-gray-600 font-medium">Lot source</span>
                <select
                  value={startForm.batch_id}
                  onChange={(e) => setStartForm({ ...startForm, batch_id: e.target.value })}
                  className="input-modern"
                >
                  <option value="">Choisir un lot disponible…</option>
                  {availableBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.chaine_nom || 'sans chaîne'} · restant {nf(b.poids_restant_kg ?? b.poids_initial_kg)} kg
                    </option>
                  ))}
                </select>
                {availableBatches.length === 0 && (
                  <span className="text-xs text-amber-600">Aucun lot disponible — créez-en un via « Nouveau lot ».</span>
                )}
              </label>
            ) : (
              <div className="flex flex-wrap gap-4 mb-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-gray-600 font-medium">Chaîne</span>
                  <select
                    value={startForm.new_chaine_id}
                    onChange={(e) => setStartForm({ ...startForm, new_chaine_id: e.target.value })}
                    className="input-modern min-w-[220px]"
                  >
                    <option value="">Choisir une chaîne…</option>
                    {chains.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-gray-600 font-medium">Poids initial du lot (kg)</span>
                  <input
                    type="number" min="0" step="0.1" inputMode="decimal"
                    value={startForm.new_poids}
                    onChange={(e) => setStartForm({ ...startForm, new_poids: e.target.value })}
                    className="input-modern w-40" placeholder="0"
                  />
                </label>
              </div>
            )}

            {/* Sélecteur d'opération (gros boutons atelier) */}
            {activeChaineId && (
              <div className="mb-4">
                <span className="text-sm text-gray-600 font-medium block mb-2">Opération</span>
                {operations.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucune opération active sur cette chaîne.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {operations.map((op) => {
                      const sel = String(startForm.operation_id) === String(op.id);
                      return (
                        <button
                          key={op.id}
                          onClick={() => setStartForm({ ...startForm, operation_id: op.id })}
                          className={`text-left px-4 py-3 rounded-xl border-2 transition ${sel ? 'border-primary bg-primary/10' : 'border-slate-200 hover:border-slate-300'}`}
                        >
                          <span className="block text-xs text-gray-400">Opération {op.numero}</span>
                          <span className="block font-semibold text-slate-800">{op.nom}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <label className="flex flex-col gap-1 text-sm mb-4 max-w-xs">
              <span className="text-gray-600 font-medium">Poids d'entrée (kg)</span>
              <input
                type="number" min="0" step="0.1" inputMode="decimal"
                value={startForm.poids_entree_kg}
                onChange={(e) => setStartForm({ ...startForm, poids_entree_kg: e.target.value })}
                className="input-modern text-lg font-semibold" placeholder="0"
              />
            </label>

            <button
              onClick={startExecution}
              disabled={starting}
              className="px-6 py-3 rounded-xl text-base font-bold bg-primary text-white disabled:opacity-50 flex items-center gap-2"
            >
              <Plus size={18} /> {starting ? 'Démarrage…' : 'Démarrer l’exécution'}
            </button>
          </section>
        )}

        {/* ═══ ÉTAPE 2 & 3 — Panneau de l'exécution ouverte ═══ */}
        {activeExec && (
          <section className="card-modern p-6 mb-6 border-2 border-primary/30">
            <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  {activeExec.status === 'termine' ? 'Exécution terminée' : '2. Saisir les sorties'}
                </h2>
                <p className="text-sm text-gray-500">
                  Lot <span className="font-mono font-semibold">{activeExec.batch_code}</span>
                  {' · '}{activeExec.chaine_nom || '—'}
                  {' · '}Opération {activeExec.numero} — {activeExec.operation_nom}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={activeExec.status === 'termine' ? 'completed' : 'in_progress'} size="sm" />
                <button onClick={() => { setActiveExec(null); setCompleteRecap(null); setConfirmComplete(false); }} className="text-gray-400 hover:text-gray-600 text-sm">Fermer</button>
              </div>
            </div>

            {/* Bandeau totaux (calcul en continu) */}
            {totals && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-gray-500">Entrée</p>
                  <p className="text-xl font-bold text-slate-800">{nf(totals.entree)} kg</p>
                </div>
                <div className="rounded-xl bg-blue-50 p-3">
                  <p className="text-xs text-gray-500">Sorties cumulées</p>
                  <p className="text-xl font-bold text-blue-600">{nf(totals.sortie)} kg</p>
                </div>
                <div className={`rounded-xl p-3 ${totals.surplus ? 'bg-rose-50' : 'bg-amber-50'}`}>
                  <p className="text-xs text-gray-500">{totals.surplus ? 'Sorties > entrée' : 'Perte estimée'}</p>
                  <p className={`text-xl font-bold ${totals.surplus ? 'text-rose-600' : 'text-amber-600'}`}>
                    {totals.surplus ? `+${nf(totals.sortie - totals.entree)} kg` : `${nf(totals.perte)} kg`}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-gray-500">Taux de perte</p>
                  <p className="text-xl font-bold text-slate-800">{totals.surplus ? '—' : `${totals.pertePct.toFixed(1)} %`}</p>
                </div>
              </div>
            )}
            {totals?.surplus && (
              <div className="mb-4 rounded-lg px-4 py-2 text-sm bg-rose-50 text-rose-700 border border-rose-200">
                Les sorties dépassent le poids d'entrée : vérifiez les pesées avant de clôturer.
              </div>
            )}

            {/* Formulaire d'ajout de sortie (seulement si en cours) */}
            {activeIsOpen && (
              <div className="flex flex-wrap items-end gap-3 mb-5 p-4 rounded-xl bg-slate-50">
                <label className="flex flex-col gap-1 text-sm flex-1 min-w-[240px]">
                  <span className="text-gray-600 font-medium">Catégorie sortante</span>
                  <select
                    value={outputForm.categorie_sortante_id}
                    onChange={(e) => setOutputForm({ ...outputForm, categorie_sortante_id: e.target.value })}
                    className="input-modern"
                  >
                    <option value="">Choisir une catégorie…</option>
                    {Object.entries(categoriesByFamille).map(([famille, cats]) => (
                      <optgroup key={famille} label={famille}>
                        {cats.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-gray-600 font-medium">Poids (kg)</span>
                  <input
                    type="number" min="0" step="0.1" inputMode="decimal"
                    value={outputForm.poids_kg}
                    onChange={(e) => setOutputForm({ ...outputForm, poids_kg: e.target.value })}
                    className="input-modern w-32 text-lg font-semibold" placeholder="0"
                  />
                </label>
                <button
                  onClick={addOutput}
                  disabled={addingOutput}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-solidata-green text-white disabled:opacity-50 flex items-center gap-2"
                >
                  <Plus size={16} /> Ajouter la sortie
                </button>
              </div>
            )}

            {/* Liste des sorties saisies */}
            <h3 className="text-sm font-semibold text-slate-600 mb-2">Sorties saisies ({(activeExec.outputs || []).length})</h3>
            {(activeExec.outputs || []).length === 0 ? (
              <p className="text-sm text-gray-400 py-3">Aucune sortie saisie pour l'instant.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Catégorie</th>
                      <th className="py-2 pr-3">Famille Refashion</th>
                      <th className="py-2 pr-3 text-right">Poids</th>
                      {activeIsOpen && <th className="py-2 pr-3"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {activeExec.outputs.map((o) => {
                      const fam = FAMILLE_BADGE[o.famille_refashion];
                      return (
                        <tr key={o.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-medium text-slate-800">{o.categorie_nom || `#${o.categorie_sortante_id}`}</td>
                          <td className="py-2 pr-3">
                            {fam ? <span className={`text-xs px-2 py-0.5 rounded-full ${fam.cls}`}>{fam.label}</span> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{nf(o.poids_kg)} kg</td>
                          {activeIsOpen && (
                            <td className="py-2 pr-3 text-right">
                              <button onClick={() => deleteOutput(o.id)} className="text-rose-500 hover:text-rose-700" title="Supprimer cette sortie">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Récapitulatif de clôture (après complétion) */}
            {completeRecap && (
              <div className="mt-5 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                <p className="font-semibold text-emerald-800 flex items-center gap-2 mb-2">
                  <CheckCircle2 size={18} /> Exécution clôturée
                </p>
                <ul className="text-sm text-emerald-700 space-y-1">
                  <li>Sorties totales : <span className="font-semibold">{nf(completeRecap.poids_sortie_total_kg)} kg</span></li>
                  <li>Perte calculée : <span className="font-semibold">{nf(completeRecap.perte_kg)} kg</span></li>
                  <li className="flex items-center gap-1">
                    <Package size={14} />
                    {completeRecap.stock_lines_created} entrée(s) de stock créée(s) — une par catégorie triée (reversement automatique).
                  </li>
                </ul>
              </div>
            )}

            {/* Bouton de clôture (seulement si en cours) */}
            {activeIsOpen && (
              <div className="mt-5 flex items-center gap-3">
                {!confirmComplete ? (
                  <button
                    onClick={() => setConfirmComplete(true)}
                    disabled={(activeExec.outputs || []).length === 0}
                    className="px-6 py-3 rounded-xl text-base font-bold bg-primary text-white disabled:opacity-50 flex items-center gap-2"
                    title={(activeExec.outputs || []).length === 0 ? 'Ajoutez au moins une sortie' : 'Clôturer'}
                  >
                    <CheckCircle2 size={18} /> Terminer l'exécution
                  </button>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-slate-600">Clôturer et reverser les sorties en stock ?</span>
                    <button onClick={completeExecution} disabled={completing} className="px-5 py-2.5 rounded-lg text-sm font-bold bg-emerald-600 text-white disabled:opacity-50">
                      {completing ? 'Clôture…' : 'Oui, terminer'}
                    </button>
                    <button onClick={() => setConfirmComplete(false)} className="px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600">Annuler</button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ═══ EXÉCUTIONS DU JOUR ═══ */}
        <section className="card-modern p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-slate-800">Exécutions du jour</h2>
            <button onClick={loadReferentiels} className="text-primary text-sm font-medium hover:underline flex items-center gap-1">
              <RotateCcw size={14} /> Actualiser
            </button>
          </div>
          {todayExecs.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">Aucune exécution enregistrée aujourd'hui.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-3">Lot</th>
                    <th className="py-2 pr-3">Opération</th>
                    <th className="py-2 pr-3 text-right">Entrée</th>
                    <th className="py-2 pr-3 text-right">Sorties</th>
                    <th className="py-2 pr-3 text-center">Sorties saisies</th>
                    <th className="py-2 pr-3 text-center">Statut</th>
                    <th className="py-2 pr-3 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {todayExecs.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-mono font-medium">{e.batch_code}</td>
                      <td className="py-2 pr-3">{e.operation_nom || '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono">{nf(e.poids_entree_kg)} kg</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {e.status === 'termine' ? nf(e.poids_sortie_total_kg) : nf(e.poids_sortie_courant)} kg
                      </td>
                      <td className="py-2 pr-3 text-center">{e.nb_sorties}</td>
                      <td className="py-2 pr-3 text-center">
                        <StatusBadge status={e.status === 'termine' ? 'completed' : 'in_progress'} size="sm" />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <button onClick={() => openExecution(e.id)} className="text-primary text-sm font-medium hover:underline">
                          {e.status === 'termine' ? 'Voir' : 'Reprendre'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
