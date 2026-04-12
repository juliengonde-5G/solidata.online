import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// ─────────────────────────────────────────────
// Référentiel contenants et leurs tares (kg)
// ─────────────────────────────────────────────
const CONTENANTS = [
  { id: 'bac_metal',           label: 'Bac métal',                  tare: 80 },
  { id: 'bac_metal_jaune',     label: 'Bac métal jaune',             tare: 145 },
  { id: 'geobox_rouge',        label: 'Geobox rouge ajouré',         tare: 38 },
  { id: 'geobox_noir',         label: 'Geobox noir',                 tare: 44 },
  { id: 'chariot_grillagee',   label: 'Chariot aire grillagée',      tare: 98 },
  { id: 'chariot_curon_petit', label: 'Chariot curon petit',         tare: 55 },
  { id: 'chariot_curon_grand', label: 'Chariot curon grand',         tare: 90 },
  { id: 'palette_eur',         label: 'Palette EUR',                 tare: 22 },
  { id: 'demi_palette',        label: 'Demi palette légère',         tare: 7 },
  { id: 'poubelle_4roues',     label: 'Poubelle 4 roues',            tare: 39 },
  { id: 'chariot_pal',         label: 'Chariot grillagée + PAL EUR', tare: 120 },
  { id: 'petite_poubelle',     label: 'Petite poubelle grise',       tare: 6 },
  { id: 'sans_contenant',      label: 'Sans contenant',              tare: 0 },
  { id: 'tare_manuelle',       label: 'Tare manuelle',               tare: null },
];

const MOTIFS_ENTREE = [
  { id: 'apport_volontaire', label: 'Apport Volontaire' },
  { id: 'retour',            label: 'Retour' },
];

const MOTIFS_SORTIE = [
  { id: 'atelier_tri',          label: 'Vers Atelier de tri' },
  { id: 'tri_preclasse',        label: 'Vers Tri pré-classé' },
  { id: 'original_conditionne', label: 'Vers Original Conditionné' },
];

const CONTENANT_LABEL = Object.fromEntries(CONTENANTS.map(c => [c.id, c.label]));

function formatHeure(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatPoids(kg) {
  if (kg == null) return '—';
  return `${parseFloat(kg).toFixed(1)} kg`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Formulaire de saisie (entrée ou sortie)
function FormulaireBalance({ mode, onSuccess }) {
  const initForm = () => ({
    motif: mode === 'entree' ? 'apport_volontaire' : 'atelier_tri',
    contenant: '',
    poids_brut: '',
    tare_manuelle: '',
    operateur: '',
  });

  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'ok'|'error', msg }

  const contenantSelectionne = CONTENANTS.find(c => c.id === form.contenant);
  const tare = contenantSelectionne
    ? (form.contenant === 'tare_manuelle' ? parseFloat(form.tare_manuelle) || 0 : contenantSelectionne.tare)
    : null;
  const poidsBrut = parseFloat(form.poids_brut) || 0;
  const poidsNet = (tare !== null && poidsBrut > 0) ? poidsBrut - tare : null;
  const poidsNetValide = poidsNet !== null && poidsNet > 0;

  function reset() {
    setForm(initForm());
    setFeedback(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.contenant || !form.poids_brut) {
      setFeedback({ type: 'error', msg: 'Sélectionner un contenant et saisir le poids.' });
      return;
    }
    if (!poidsNetValide) {
      setFeedback({ type: 'error', msg: 'Poids net invalide. Vérifier la saisie.' });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const payload = {
        date: todayISO(),
        poids_brut_kg: poidsBrut,
        contenant: form.contenant,
        tare_kg: tare,
        operateur: form.operateur || undefined,
      };

      if (mode === 'entree') {
        payload.origine = form.motif;
        await axios.post('/api/stock-original/balance-entree', payload);
        setFeedback({ type: 'ok', msg: `Entrée enregistrée — ${formatPoids(poidsNet)} net` });
      } else {
        payload.destination = form.motif;
        const res = await axios.post('/api/stock-original/balance-sortie', payload);
        let msg = `Sortie enregistrée — ${formatPoids(poidsNet)} net`;
        if (res.data.produit_fini) {
          msg += ` · Produit fini créé (${res.data.produit_fini.code_barre})`;
        }
        setFeedback({ type: 'ok', msg });
      }

      reset();
      onSuccess();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de l\'enregistrement.';
      setFeedback({ type: 'error', msg });
    } finally {
      setSaving(false);
    }
  }

  const motifs = mode === 'entree' ? MOTIFS_ENTREE : MOTIFS_SORTIE;
  const motifLabel = mode === 'entree' ? 'Motif d\'entrée' : 'Destination';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Motif */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{motifLabel}</label>
        <select
          value={form.motif}
          onChange={e => setForm(f => ({ ...f, motif: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {motifs.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Contenant */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Contenant</label>
        <select
          value={form.contenant}
          onChange={e => setForm(f => ({ ...f, contenant: e.target.value, tare_manuelle: '' }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">— Sélectionner un contenant —</option>
          {CONTENANTS.map(c => (
            <option key={c.id} value={c.id}>
              {c.label}{c.tare !== null ? ` — tare ${c.tare} kg` : ' — tare à saisir'}
            </option>
          ))}
        </select>
      </div>

      {/* Tare manuelle si besoin */}
      {form.contenant === 'tare_manuelle' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tare manuelle (kg)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.tare_manuelle}
            onChange={e => setForm(f => ({ ...f, tare_manuelle: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Ex : 65"
          />
        </div>
      )}

      {/* Poids brut */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Poids sur balance (kg brut)</label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={form.poids_brut}
          onChange={e => setForm(f => ({ ...f, poids_brut: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="Ex : 250"
          autoFocus
        />
      </div>

      {/* Résumé tare / net */}
      {form.contenant && form.poids_brut && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between text-sm">
          <span className="text-gray-600">
            {poidsBrut} kg brut — {tare} kg tare
          </span>
          <span className={`text-2xl font-bold ${poidsNetValide ? 'text-green-700' : 'text-red-600'}`}>
            {poidsNet !== null ? `${poidsNet.toFixed(1)} kg net` : '—'}
          </span>
        </div>
      )}

      {/* Opérateur (optionnel) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Opérateur (optionnel)</label>
        <input
          type="text"
          value={form.operateur}
          onChange={e => setForm(f => ({ ...f, operateur: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="Initiales ou nom"
          maxLength={50}
        />
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          feedback.type === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {feedback.type === 'ok' ? '✓ ' : '✗ '}{feedback.msg}
        </div>
      )}

      {/* Bouton */}
      <button
        type="submit"
        disabled={saving || !poidsNetValide}
        className={`w-full py-3 rounded-lg text-white font-bold text-lg transition-colors ${
          mode === 'entree'
            ? 'bg-green-600 hover:bg-green-700 disabled:bg-gray-300'
            : 'bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300'
        }`}
      >
        {saving ? 'Enregistrement...' : mode === 'entree' ? 'Enregistrer l\'entrée' : 'Enregistrer la sortie'}
      </button>
    </form>
  );
}

// Tableau historique du jour
function HistoriqueDuJour({ historique, loading }) {
  const totalEntrees = historique.filter(m => m.type === 'entree').reduce((s, m) => s + parseFloat(m.poids_kg), 0);
  const totalSorties = historique.filter(m => m.type === 'sortie').reduce((s, m) => s + parseFloat(m.poids_kg), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-800">Historique du jour</h2>
        <div className="flex gap-4 text-sm">
          <span className="text-green-700 font-semibold">Entrées : {totalEntrees.toFixed(1)} kg</span>
          <span className="text-orange-700 font-semibold">Sorties : {totalSorties.toFixed(1)} kg</span>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Chargement...</p>
      ) : historique.length === 0 ? (
        <p className="text-gray-400 text-sm italic">Aucune saisie aujourd'hui.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 text-left">
                <th className="px-3 py-2 font-medium">Heure</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Motif / Destination</th>
                <th className="px-3 py-2 font-medium">Contenant</th>
                <th className="px-3 py-2 font-medium text-right">Brut</th>
                <th className="px-3 py-2 font-medium text-right">Tare</th>
                <th className="px-3 py-2 font-medium text-right">Net</th>
                <th className="px-3 py-2 font-medium">Opérateur</th>
              </tr>
            </thead>
            <tbody>
              {historique.map(m => (
                <tr key={m.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{formatHeure(m.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                      m.type === 'entree'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-orange-100 text-orange-800'
                    }`}>
                      {m.type === 'entree' ? 'Entrée' : 'Sortie'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {m.type === 'entree'
                      ? MOTIFS_ENTREE.find(x => x.id === m.origine)?.label || m.origine
                      : MOTIFS_SORTIE.find(x => x.id === m.destination)?.label || m.destination
                    }
                  </td>
                  <td className="px-3 py-2 text-gray-600">{CONTENANT_LABEL[m.contenant] || m.contenant || '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{m.poids_brut_kg ? `${parseFloat(m.poids_brut_kg).toFixed(1)}` : '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{m.tare_kg != null ? `${parseFloat(m.tare_kg).toFixed(1)}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatPoids(m.poids_kg)}</td>
                  <td className="px-3 py-2 text-gray-500">{m.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────
export default function BalancePage() {
  const [heure, setHeure] = useState('');
  const [activeMode, setActiveMode] = useState('entree'); // 'entree' | 'sortie'
  const [historique, setHistorique] = useState([]);
  const [loadingHistorique, setLoadingHistorique] = useState(false);

  // Horloge temps réel
  useEffect(() => {
    function tick() {
      setHeure(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const chargerHistorique = useCallback(async () => {
    setLoadingHistorique(true);
    try {
      const res = await axios.get('/api/stock-original/balance-historique', {
        params: { date: todayISO() },
      });
      setHistorique(res.data);
    } catch {
      // silencieux
    } finally {
      setLoadingHistorique(false);
    }
  }, []);

  useEffect(() => {
    chargerHistorique();
  }, [chargerHistorique]);

  const dateAffichee = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#2D8C4E' }}>
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">SOLIDATA — Balance</h1>
            <p className="text-xs text-gray-500 capitalize">{dateAffichee}</p>
          </div>
        </div>
        <span className="text-2xl font-mono font-semibold text-gray-700">{heure}</span>
      </header>

      {/* Corps */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 space-y-6">

        {/* Sélecteur mode */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white">
          <button
            onClick={() => setActiveMode('entree')}
            className={`flex-1 py-4 text-base font-bold transition-colors ${
              activeMode === 'entree'
                ? 'bg-green-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Entrée en stock
          </button>
          <button
            onClick={() => setActiveMode('sortie')}
            className={`flex-1 py-4 text-base font-bold transition-colors ${
              activeMode === 'sortie'
                ? 'bg-orange-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Sortie de stock
          </button>
        </div>

        {/* Formulaire */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className={`text-base font-bold mb-4 ${activeMode === 'entree' ? 'text-green-700' : 'text-orange-700'}`}>
            {activeMode === 'entree' ? 'Enregistrer une entrée' : 'Enregistrer une sortie'}
          </h2>
          <FormulaireBalance
            key={activeMode}
            mode={activeMode}
            onSuccess={chargerHistorique}
          />
        </div>

        {/* Historique */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <HistoriqueDuJour historique={historique} loading={loadingHistorique} />
        </div>
      </main>
    </div>
  );
}
