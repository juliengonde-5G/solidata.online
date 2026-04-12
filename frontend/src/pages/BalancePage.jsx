import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// ─── Référentiel contenants ───────────────────────────────────────────────────
const CONTENANTS = [
  { id: 'bac_metal',           label: 'Bac métal',         tare: 80,  emoji: '🗑️',  couleur: 'bg-gray-200  border-gray-400',  texte: 'text-gray-800' },
  { id: 'bac_metal_jaune',     label: 'Bac jaune',         tare: 145, emoji: '🟡',  couleur: 'bg-yellow-100 border-yellow-400', texte: 'text-yellow-900' },
  { id: 'geobox_rouge',        label: 'Geobox rouge',      tare: 38,  emoji: '📦',  couleur: 'bg-red-100   border-red-400',   texte: 'text-red-900' },
  { id: 'geobox_noir',         label: 'Geobox noir',       tare: 44,  emoji: '📦',  couleur: 'bg-gray-800  border-gray-900',  texte: 'text-white' },
  { id: 'chariot_grillagee',   label: 'Chariot grillagé',  tare: 98,  emoji: '🛒',  couleur: 'bg-zinc-200  border-zinc-400',  texte: 'text-zinc-900' },
  { id: 'chariot_curon_petit', label: 'Chariot curon S',   tare: 55,  emoji: '🛒',  couleur: 'bg-blue-100  border-blue-400',  texte: 'text-blue-900' },
  { id: 'chariot_curon_grand', label: 'Chariot curon L',   tare: 90,  emoji: '🛒',  couleur: 'bg-blue-200  border-blue-500',  texte: 'text-blue-900' },
  { id: 'palette_eur',         label: 'Palette EUR',        tare: 22,  emoji: '🪵',  couleur: 'bg-amber-100 border-amber-400', texte: 'text-amber-900' },
  { id: 'demi_palette',        label: 'Demi-palette',       tare: 7,   emoji: '🪵',  couleur: 'bg-amber-50  border-amber-300', texte: 'text-amber-800' },
  { id: 'poubelle_4roues',     label: 'Poubelle 4 roues',  tare: 39,  emoji: '🗑️',  couleur: 'bg-slate-200 border-slate-400', texte: 'text-slate-900' },
  { id: 'chariot_pal',         label: 'Chariot + PAL',     tare: 120, emoji: '🛒',  couleur: 'bg-green-100 border-green-400', texte: 'text-green-900' },
  { id: 'petite_poubelle',     label: 'Petite poubelle',   tare: 6,   emoji: '🪣',  couleur: 'bg-slate-100 border-slate-300', texte: 'text-slate-700' },
  { id: 'sans_contenant',      label: 'Sans contenant',    tare: 0,   emoji: '⚖️',  couleur: 'bg-white     border-gray-300',  texte: 'text-gray-700' },
  { id: 'tare_manuelle',       label: 'Tare manuelle',     tare: null, emoji: '✏️',  couleur: 'bg-purple-100 border-purple-400', texte: 'text-purple-900' },
];

const MOTIFS_ENTREE = [
  { id: 'apport_volontaire', label: 'Apport Volontaire', emoji: '🚚', sous: 'Dépôt extérieur', couleur: 'bg-emerald-500 hover:bg-emerald-600' },
  { id: 'retour',            label: 'Retour',            emoji: '↩️', sous: 'Retour interne',   couleur: 'bg-teal-500   hover:bg-teal-600' },
];

const MOTIFS_SORTIE = [
  { id: 'atelier_tri',          label: 'Atelier de tri',       emoji: '✂️', sous: 'En-cours production', couleur: 'bg-orange-500 hover:bg-orange-600' },
  { id: 'tri_preclasse',        label: 'Tri pré-classé',       emoji: '📋', sous: 'Produit fini direct',  couleur: 'bg-amber-500  hover:bg-amber-600' },
  { id: 'original_conditionne', label: 'Original Conditionné', emoji: '📦', sous: 'Produit fini conditionné', couleur: 'bg-yellow-600 hover:bg-yellow-700' },
];

const CONTENANT_MAP = Object.fromEntries(CONTENANTS.map(c => [c.id, c]));

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Historique compact ───────────────────────────────────────────────────────
function Historique({ lignes }) {
  const [open, setOpen] = useState(false);
  const totalEntrees = lignes.filter(m => m.type === 'entree').reduce((s, m) => s + parseFloat(m.poids_kg), 0);
  const totalSorties = lignes.filter(m => m.type === 'sortie').reduce((s, m) => s + parseFloat(m.poids_kg), 0);

  return (
    <div className="border-t border-gray-200 bg-white">
      {/* Barre cliquable */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-3 text-sm"
      >
        <span className="font-semibold text-gray-600">
          Saisies du jour ({lignes.length})
        </span>
        <div className="flex items-center gap-4">
          <span className="text-green-700 font-bold">+{totalEntrees.toFixed(0)} kg</span>
          <span className="text-orange-700 font-bold">-{totalSorties.toFixed(0)} kg</span>
          <span className="text-gray-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto max-h-52 overflow-y-auto px-4 pb-3">
          {lignes.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-4">Aucune saisie aujourd'hui</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-left border-b">
                  <th className="py-1 pr-3">Heure</th>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 pr-3">Motif</th>
                  <th className="py-1 pr-3">Contenant</th>
                  <th className="py-1 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(m => {
                  const ct = CONTENANT_MAP[m.contenant];
                  const motif = m.type === 'entree'
                    ? MOTIFS_ENTREE.find(x => x.id === m.origine)
                    : MOTIFS_SORTIE.find(x => x.id === m.destination);
                  return (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1 pr-3 text-gray-400">
                        {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.type === 'entree' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                          {m.type === 'entree' ? '↓ ENTRÉE' : '↑ SORTIE'}
                        </span>
                      </td>
                      <td className="py-1 pr-3">{motif?.label || '—'}</td>
                      <td className="py-1 pr-3">{ct ? `${ct.emoji} ${ct.label}` : '—'}</td>
                      <td className="py-1 text-right font-bold">{parseFloat(m.poids_kg).toFixed(1)} kg</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Écran succès ─────────────────────────────────────────────────────────────
function EcranSucces({ poidsNet, mode, motif, onRecommencer }) {
  useEffect(() => {
    const t = setTimeout(onRecommencer, 3500);
    return () => clearTimeout(t);
  }, [onRecommencer]);

  return (
    <div className={`flex-1 flex flex-col items-center justify-center gap-6 px-8 ${mode === 'entree' ? 'bg-green-50' : 'bg-orange-50'}`}>
      <div className={`w-28 h-28 rounded-full flex items-center justify-center text-6xl shadow-lg ${mode === 'entree' ? 'bg-green-500' : 'bg-orange-500'}`}>
        ✓
      </div>
      <div className="text-center">
        <p className={`text-5xl font-black ${mode === 'entree' ? 'text-green-700' : 'text-orange-700'}`}>
          {parseFloat(poidsNet).toFixed(1)} kg
        </p>
        <p className="text-xl font-semibold text-gray-600 mt-2">
          {motif?.label}
        </p>
        <p className="text-gray-400 mt-1">Enregistré ✓</p>
      </div>
      <button
        onClick={onRecommencer}
        className="mt-4 px-8 py-3 rounded-2xl bg-white border-2 border-gray-300 text-gray-700 font-bold text-lg shadow"
      >
        Nouvelle saisie
      </button>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function BalancePage() {
  const [heure, setHeure] = useState('');
  const [step, setStep] = useState(0); // 0=mode, 1=motif, 2=contenant, 3=poids
  const [mode, setMode] = useState(null);       // 'entree' | 'sortie'
  const [motif, setMotif] = useState(null);      // objet motif
  const [contenant, setContenant] = useState(null); // objet contenant
  const [poidsBrut, setPoidsBrut] = useState('');
  const [tareManuelle, setTareManuelle] = useState('');
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState(null);   // { poidsNet }
  const [historique, setHistorique] = useState([]);

  // Horloge
  useEffect(() => {
    const tick = () => setHeure(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, []);

  const chargerHistorique = useCallback(async () => {
    try {
      const res = await axios.get('/api/stock-original/balance-historique', { params: { date: todayISO() } });
      setHistorique(res.data);
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => { chargerHistorique(); }, [chargerHistorique]);

  // Calcul tare effective
  const tare = contenant
    ? (contenant.id === 'tare_manuelle' ? parseFloat(tareManuelle) || 0 : contenant.tare)
    : 0;
  const brut = parseFloat(poidsBrut) || 0;
  const net = brut - tare;
  const netValide = net > 0;

  // ── Navigation ──────────────────────────────────────────────
  const reset = useCallback(() => {
    setStep(0); setMode(null); setMotif(null); setContenant(null);
    setPoidsBrut(''); setTareManuelle(''); setErreur(''); setSucces(null);
  }, []);

  function choisirMode(m) { setMode(m); setStep(1); }
  function choisirMotif(m) { setMotif(m); setStep(2); }
  function choisirContenant(c) { setContenant(c); setStep(3); }
  function retour() {
    setErreur('');
    if (step === 1) { setMode(null); setStep(0); }
    else if (step === 2) { setMotif(null); setStep(1); }
    else if (step === 3) { setContenant(null); setPoidsBrut(''); setTareManuelle(''); setStep(2); }
  }

  // ── Enregistrement ──────────────────────────────────────────
  async function enregistrer() {
    if (!netValide) { setErreur('Poids net invalide — vérifiez la saisie'); return; }
    setSaving(true); setErreur('');
    try {
      const payload = {
        date: todayISO(),
        poids_brut_kg: brut,
        contenant: contenant.id,
        tare_kg: tare,
      };
      if (mode === 'entree') {
        payload.origine = motif.id;
        await axios.post('/api/stock-original/balance-entree', payload);
      } else {
        payload.destination = motif.id;
        await axios.post('/api/stock-original/balance-sortie', payload);
      }
      await chargerHistorique();
      setSucces({ poidsNet: net });
    } catch (err) {
      setErreur(err.response?.data?.error || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  const motifs = mode === 'entree' ? MOTIFS_ENTREE : MOTIFS_SORTIE;
  const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // ─── Rendu succès ─────────────────────────────────────────────────────────
  if (succes) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <Header heure={heure} dateLabel={dateLabel} />
        <EcranSucces
          poidsNet={succes.poidsNet}
          mode={mode}
          motif={motif}
          onRecommencer={reset}
        />
        <Historique lignes={historique} />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <Header heure={heure} dateLabel={dateLabel} />

      {/* Fil d'Ariane minimaliste */}
      {step > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
          <button onClick={retour} className="flex items-center gap-1 text-gray-500 hover:text-gray-800 font-medium text-sm">
            ← Retour
          </button>
          <span className="text-gray-300">|</span>
          {mode && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${mode === 'entree' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
              {mode === 'entree' ? '↓ ENTRÉE' : '↑ SORTIE'}
            </span>
          )}
          {motif && <span className="text-sm text-gray-600">{motif.emoji} {motif.label}</span>}
          {contenant && <span className="text-sm text-gray-600">{contenant.emoji} {contenant.label}</span>}
        </div>
      )}

      {/* Zone principale */}
      <div className="flex-1 overflow-y-auto">

        {/* ── STEP 0 : Choisir le mode ─────────────────────────────── */}
        {step === 0 && (
          <div className="h-full flex flex-col p-4 gap-4">
            <p className="text-center text-gray-400 font-medium text-sm uppercase tracking-widest">Que faites-vous ?</p>
            <div className="flex-1 grid grid-rows-2 gap-4">
              <button
                onClick={() => choisirMode('entree')}
                className="rounded-3xl bg-green-500 hover:bg-green-600 active:scale-95 transition-all shadow-lg flex flex-col items-center justify-center gap-3 text-white"
              >
                <span className="text-7xl">📥</span>
                <span className="text-3xl font-black tracking-wide">ENTRÉE</span>
                <span className="text-green-200 text-base font-medium">Stock qui arrive</span>
              </button>
              <button
                onClick={() => choisirMode('sortie')}
                className="rounded-3xl bg-orange-500 hover:bg-orange-600 active:scale-95 transition-all shadow-lg flex flex-col items-center justify-center gap-3 text-white"
              >
                <span className="text-7xl">📤</span>
                <span className="text-3xl font-black tracking-wide">SORTIE</span>
                <span className="text-orange-200 text-base font-medium">Stock qui part</span>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 1 : Choisir le motif ─────────────────────────────── */}
        {step === 1 && (
          <div className="h-full flex flex-col p-4 gap-4">
            <p className="text-center text-gray-400 font-medium text-sm uppercase tracking-widest">Pourquoi ?</p>
            <div className={`flex-1 grid gap-4 ${motifs.length === 2 ? 'grid-rows-2' : 'grid-rows-3'}`}>
              {motifs.map(m => (
                <button
                  key={m.id}
                  onClick={() => choisirMotif(m)}
                  className={`rounded-3xl ${m.couleur} active:scale-95 transition-all shadow-lg flex flex-col items-center justify-center gap-2 text-white`}
                >
                  <span className="text-6xl">{m.emoji}</span>
                  <span className="text-2xl font-black">{m.label}</span>
                  <span className="text-white/70 text-sm">{m.sous}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2 : Choisir le contenant ──────────────────────────── */}
        {step === 2 && (
          <div className="p-4">
            <p className="text-center text-gray-400 font-medium text-sm uppercase tracking-widest mb-4">Quel contenant ?</p>
            <div className="grid grid-cols-3 gap-3 pb-4">
              {CONTENANTS.map(c => (
                <button
                  key={c.id}
                  onClick={() => choisirContenant(c)}
                  className={`rounded-2xl border-2 ${c.couleur} active:scale-95 transition-all shadow-sm flex flex-col items-center justify-center gap-1 py-4 px-2`}
                >
                  <span className="text-4xl leading-none">{c.emoji}</span>
                  <span className={`text-xs font-bold text-center leading-tight mt-1 ${c.texte}`}>{c.label}</span>
                  {c.tare !== null
                    ? <span className={`text-lg font-black ${c.texte}`}>{c.tare} kg</span>
                    : <span className={`text-xs font-semibold ${c.texte} opacity-70`}>à saisir</span>
                  }
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 3 : Saisie du poids ────────────────────────────────── */}
        {step === 3 && (
          <div className="flex flex-col h-full p-4 gap-4">
            {/* Récap contenant */}
            <div className={`rounded-2xl border-2 ${contenant.couleur} flex items-center gap-4 px-5 py-3`}>
              <span className="text-4xl">{contenant.emoji}</span>
              <div>
                <p className={`font-bold text-base ${contenant.texte}`}>{contenant.label}</p>
                <p className={`text-sm ${contenant.texte} opacity-70`}>Tare : {contenant.id === 'tare_manuelle' ? '—' : `${contenant.tare} kg`}</p>
              </div>
            </div>

            {/* Tare manuelle */}
            {contenant.id === 'tare_manuelle' && (
              <div>
                <label className="block text-sm font-bold text-gray-600 mb-1">Tare (kg)</label>
                <input
                  type="number" min="0" step="0.1"
                  value={tareManuelle}
                  onChange={e => setTareManuelle(e.target.value)}
                  className="w-full border-2 border-purple-300 rounded-2xl px-4 py-3 text-2xl font-bold text-center focus:outline-none focus:border-purple-500"
                  placeholder="0"
                />
              </div>
            )}

            {/* Saisie poids brut */}
            <div className="flex-1 flex flex-col">
              <label className="block text-sm font-bold text-gray-600 mb-1">Poids sur balance (kg)</label>
              <input
                type="number" min="0" step="0.1"
                value={poidsBrut}
                onChange={e => { setPoidsBrut(e.target.value); setErreur(''); }}
                className="w-full border-2 border-gray-300 rounded-2xl px-4 py-4 text-4xl font-black text-center focus:outline-none focus:border-green-500"
                placeholder="0"
                autoFocus
              />
            </div>

            {/* Calcul net */}
            {poidsBrut && (
              <div className={`rounded-2xl px-6 py-4 flex items-center justify-between ${netValide ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
                <div className="text-sm text-gray-500 space-y-0.5">
                  <p>{brut.toFixed(1)} kg brut</p>
                  <p>— {tare.toFixed(1)} kg tare</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 uppercase font-semibold">Poids net</p>
                  <p className={`text-4xl font-black ${netValide ? 'text-green-700' : 'text-red-600'}`}>
                    {net.toFixed(1)} kg
                  </p>
                </div>
              </div>
            )}

            {erreur && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm font-medium">
                ✗ {erreur}
              </div>
            )}

            {/* Bouton confirmer */}
            <button
              onClick={enregistrer}
              disabled={saving || !netValide}
              className={`w-full py-5 rounded-2xl text-white text-2xl font-black shadow-lg active:scale-95 transition-all ${
                mode === 'entree'
                  ? 'bg-green-500 hover:bg-green-600 disabled:bg-gray-200'
                  : 'bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200'
              } disabled:text-gray-400`}
            >
              {saving ? '…' : mode === 'entree' ? '✓ ENREGISTRER ENTRÉE' : '✓ ENREGISTRER SORTIE'}
            </button>
          </div>
        )}
      </div>

      {/* Historique repliable en bas */}
      <Historique lignes={historique} />
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ heure, dateLabel }) {
  return (
    <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm" style={{ backgroundColor: '#2D8C4E' }}>S</div>
        <div>
          <p className="font-bold text-gray-800 text-sm leading-none">SOLIDATA</p>
          <p className="text-[10px] text-gray-400 capitalize">{dateLabel}</p>
        </div>
      </div>
      <span className="text-xl font-mono font-bold text-gray-600">{heure}</span>
    </header>
  );
}
