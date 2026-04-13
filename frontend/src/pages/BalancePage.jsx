import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Gift, Store, ArrowUpRight, ArrowDownToLine } from 'lucide-react';

// ─── Icônes SVG custom ────────────────────────────────────────────────────────

// Chariot / hand-truck (montant vertical + plateforme + roues)
const SvgChariot = ({ size = 64, color = 'white' }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Montant vertical */}
    <rect x="18" y="8" width="6" height="38" rx="3" fill={color} />
    {/* Poignée horizontale en haut */}
    <rect x="18" y="8" width="22" height="6" rx="3" fill={color} />
    {/* Plateforme basse */}
    <rect x="12" y="42" width="28" height="6" rx="3" fill={color} />
    {/* Roue gauche */}
    <circle cx="16" cy="54" r="6" stroke={color} strokeWidth="3.5" fill="none" />
    <circle cx="16" cy="54" r="2" fill={color} />
    {/* Roue droite */}
    <circle cx="36" cy="54" r="6" stroke={color} strokeWidth="3.5" fill="none" />
    <circle cx="36" cy="54" r="2" fill={color} />
  </svg>
);

// Palette bois (3 planches + 3 blocs support + lisse basse)
const SvgPalette = ({ size = 64, color = 'white' }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Lisse basse */}
    <rect x="6" y="50" width="52" height="7" rx="2" fill={color} />
    {/* 3 blocs de support */}
    <rect x="8"  y="36" width="12" height="14" rx="2" fill={color} />
    <rect x="26" y="36" width="12" height="14" rx="2" fill={color} />
    <rect x="44" y="36" width="12" height="14" rx="2" fill={color} />
    {/* Planche du dessus (large) */}
    <rect x="4" y="28" width="56" height="8" rx="2" fill={color} />
    {/* 2 planches supplémentaires avec espaces */}
    <rect x="4"  y="18" width="24" height="7" rx="2" fill={color} />
    <rect x="36" y="18" width="24" height="7" rx="2" fill={color} />
    <rect x="4"  y="8"  width="56" height="7" rx="2" fill={color} />
  </svg>
);

// Caisse à lattes (boîte + barreaux verticaux + cerclage)
const SvgCaisse = ({ size = 64, color = 'white' }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Contour boîte */}
    <rect x="6" y="14" width="52" height="42" rx="3" stroke={color} strokeWidth="3.5" fill="none" />
    {/* Fond bas */}
    <rect x="6" y="50" width="52" height="6" rx="2" fill={color} />
    {/* 3 barreaux verticaux */}
    <rect x="19" y="14" width="4" height="42" rx="2" fill={color} />
    <rect x="30" y="14" width="4" height="42" rx="2" fill={color} />
    <rect x="41" y="14" width="4" height="42" rx="2" fill={color} />
    {/* Cerclage horizontal milieu */}
    <rect x="6" y="32" width="52" height="4" rx="2" fill={color} />
    {/* Haut (couvercle) */}
    <rect x="6" y="8" width="52" height="8" rx="3" fill={color} />
  </svg>
);

// Boîte carton ouverte (2 rabats en V)
const SvgBoite = ({ size = 64, color = 'white' }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Corps boîte */}
    <rect x="8" y="28" width="48" height="30" rx="3" stroke={color} strokeWidth="3.5" fill="none" />
    {/* Fond bas */}
    <rect x="8" y="52" width="48" height="6" rx="2" fill={color} />
    {/* Rabat gauche relevé */}
    <path d="M8 28 L8 14 L30 22 L30 28" stroke={color} strokeWidth="3.5" strokeLinejoin="round" fill="none" />
    {/* Rabat droit relevé */}
    <path d="M56 28 L56 14 L34 22 L34 28" stroke={color} strokeWidth="3.5" strokeLinejoin="round" fill="none" />
  </svg>
);

// ─── Groupes de contenants ────────────────────────────────────────────────────
const GROUPES = [
  {
    id: 'chariots',
    label: 'Chariots',
    couleur: '#3B82F6',
    bg: 'bg-blue-500',
    bgHover: 'hover:bg-blue-600',
    border: 'border-blue-400',
    light: 'bg-blue-50',
    Icon: SvgChariot,
    contenants: [
      { id: 'bac_metal',           label: 'Bac métal',        tare: 80  },
      { id: 'chariot_grillagee',   label: 'Chariot grillagé', tare: 98  },
      { id: 'chariot_curon_petit', label: 'Chariot curon S',  tare: 55  },
      { id: 'chariot_curon_grand', label: 'Chariot curon L',  tare: 90  },
      { id: 'chariot_pal',         label: 'Chariot + PAL',    tare: 120 },
    ],
  },
  {
    id: 'palettes',
    label: 'Palettes',
    couleur: '#D97706',
    bg: 'bg-amber-600',
    bgHover: 'hover:bg-amber-700',
    border: 'border-amber-400',
    light: 'bg-amber-50',
    Icon: SvgPalette,
    contenants: [
      { id: 'palette_eur',  label: 'Palette EUR',  tare: 22 },
      { id: 'demi_palette', label: 'Demi-palette', tare: 7  },
    ],
  },
  {
    id: 'bacs',
    label: 'Bacs & Geoboxes',
    couleur: '#EF4444',
    bg: 'bg-red-500',
    bgHover: 'hover:bg-red-600',
    border: 'border-red-400',
    light: 'bg-red-50',
    Icon: SvgCaisse,
    contenants: [
      { id: 'geobox_rouge',    label: 'Geobox rouge',     tare: 38  },
      { id: 'geobox_noir',     label: 'Geobox noir',      tare: 44  },
      { id: 'petite_poubelle', label: 'Petite poubelle',  tare: 6   },
      { id: 'bac_metal_jaune', label: 'Bac jaune',        tare: 145 },
      { id: 'poubelle_4roues', label: 'Poubelle 4 roues', tare: 39  },
    ],
  },
  {
    id: 'autres',
    label: 'Autres',
    couleur: '#7C3AED',
    bg: 'bg-violet-600',
    bgHover: 'hover:bg-violet-700',
    border: 'border-violet-400',
    light: 'bg-violet-50',
    Icon: SvgBoite,
    contenants: [
      { id: 'sans_contenant', label: 'Sans contenant', tare: 0    },
      { id: 'tare_manuelle',  label: 'Tare manuelle',  tare: null },
    ],
  },
];

// Lookup à plat
const CONTENANT_MAP = Object.fromEntries(
  GROUPES.flatMap(g => g.contenants.map(c => [c.id, { ...c, groupe: g }]))
);

// ─── Icônes motifs ────────────────────────────────────────────────────────────
const IconDonEntrant = ({ size = 56 }) => (
  <div className="relative inline-flex items-end justify-center" style={{ width: size, height: size }}>
    <Gift size={size * 0.8} color="white" strokeWidth={1.8} />
    <ArrowDownToLine size={size * 0.42} color="white" strokeWidth={2.5}
      className="absolute -bottom-1 -right-2" />
  </div>
);

const IconMagasinSortie = ({ size = 56 }) => (
  <div className="relative inline-flex items-start justify-center" style={{ width: size, height: size }}>
    <Store size={size * 0.8} color="white" strokeWidth={1.8} />
    <ArrowUpRight size={size * 0.42} color="white" strokeWidth={2.8}
      className="absolute -top-1 -right-2" />
  </div>
);

const IconMultiflux = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 60 60" fill="none">
    <line x1="4"  y1="30" x2="22" y2="30" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
    <circle cx="25" cy="30" r="3.5" fill="white"/>
    <line x1="25" y1="30" x2="52" y2="12" stroke="white" strokeWidth="2.8" strokeLinecap="round"/>
    <line x1="25" y1="30" x2="52" y2="30" stroke="white" strokeWidth="2.8" strokeLinecap="round"/>
    <line x1="25" y1="30" x2="52" y2="48" stroke="white" strokeWidth="2.8" strokeLinecap="round"/>
    <circle cx="54" cy="12" r="3" fill="white"/>
    <circle cx="54" cy="30" r="3" fill="white"/>
    <circle cx="54" cy="48" r="3" fill="white"/>
  </svg>
);

const MOTIFS_ENTREE = [
  {
    id: 'apport_volontaire',
    label: 'Apport Volontaire',
    commentaire: 'Entrée qui ne vient pas de la collecte',
    Icon: IconDonEntrant,
    couleur: 'bg-emerald-500 hover:bg-emerald-600',
  },
  {
    id: 'retour',
    label: 'Retour',
    commentaire: 'Retour VAK, magasin…',
    Icon: IconMagasinSortie,
    couleur: 'bg-teal-500 hover:bg-teal-600',
  },
];

const MOTIFS_SORTIE = [
  {
    id: 'atelier_tri',
    label: 'Atelier de tri',
    commentaire: 'Tout ce qui part vers la chaîne',
    Icon: IconMultiflux,
    couleur: 'bg-orange-500 hover:bg-orange-600',
  },
  {
    id: 'tri_preclasse',
    label: 'Tri pré-classé',
    commentaire: 'Produit fini direct',
    emoji: '📋',
    couleur: 'bg-amber-500 hover:bg-amber-600',
  },
  {
    id: 'original_conditionne',
    label: 'Original Conditionné',
    commentaire: 'Produit fini conditionné',
    emoji: '📦',
    couleur: 'bg-yellow-600 hover:bg-yellow-700',
  },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Historique replié ────────────────────────────────────────────────────────
function Historique({ lignes }) {
  const [open, setOpen] = useState(false);
  const totalE = lignes.filter(m => m.type === 'entree').reduce((s, m) => s + parseFloat(m.poids_kg), 0);
  const totalS = lignes.filter(m => m.type === 'sortie').reduce((s, m) => s + parseFloat(m.poids_kg), 0);

  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-3 text-sm">
        <span className="font-semibold text-gray-500">Saisies du jour ({lignes.length})</span>
        <div className="flex items-center gap-4">
          <span className="text-green-700 font-bold">+{totalE.toFixed(0)} kg</span>
          <span className="text-orange-700 font-bold">-{totalS.toFixed(0)} kg</span>
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto px-4 pb-3">
          {lignes.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-3">Aucune saisie</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b">
                  <th className="text-left py-1 pr-2">Heure</th>
                  <th className="text-left py-1 pr-2">Type</th>
                  <th className="text-left py-1 pr-2">Motif</th>
                  <th className="text-right py-1">Net</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(m => {
                  const motif = m.type === 'entree'
                    ? MOTIFS_ENTREE.find(x => x.id === m.origine)
                    : MOTIFS_SORTIE.find(x => x.id === m.destination);
                  return (
                    <tr key={m.id} className="border-b border-gray-50">
                      <td className="py-1 pr-2 text-gray-400">
                        {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1 pr-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.type === 'entree' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                          {m.type === 'entree' ? '↓' : '↑'}
                        </span>
                      </td>
                      <td className="py-1 pr-2">{motif?.label || '—'}</td>
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
      <div className={`w-28 h-28 rounded-full flex items-center justify-center text-6xl shadow-lg text-white ${mode === 'entree' ? 'bg-green-500' : 'bg-orange-500'}`}>
        ✓
      </div>
      <div className="text-center">
        <p className={`text-6xl font-black ${mode === 'entree' ? 'text-green-700' : 'text-orange-700'}`}>
          {parseFloat(poidsNet).toFixed(1)} kg
        </p>
        <p className="text-xl font-semibold text-gray-600 mt-2">{motif?.label}</p>
        <p className="text-gray-400 mt-1">Enregistré ✓</p>
      </div>
      <button onClick={onRecommencer}
        className="mt-4 px-8 py-3 rounded-2xl bg-white border-2 border-gray-300 text-gray-700 font-bold text-lg shadow">
        Nouvelle saisie
      </button>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ heure, dateLabel }) {
  return (
    <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm"
          style={{ backgroundColor: '#2D8C4E' }}>S</div>
        <div>
          <p className="font-bold text-gray-800 text-sm leading-none">SOLIDATA</p>
          <p className="text-[10px] text-gray-400 capitalize">{dateLabel}</p>
        </div>
      </div>
      <span className="text-xl font-mono font-bold text-gray-600">{heure}</span>
    </header>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function BalancePage() {
  const [heure, setHeure] = useState('');
  // Steps: 0=mode, 1=motif, 2=groupe, 3=contenant, 4=poids
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState(null);
  const [motif, setMotif] = useState(null);
  const [groupe, setGroupe] = useState(null);
  const [contenant, setContenant] = useState(null);
  const [poidsBrut, setPoidsBrut] = useState('');
  const [tareManuelle, setTareManuelle] = useState('');
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState(null);
  const [historique, setHistorique] = useState([]);

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

  const tare = contenant
    ? (contenant.id === 'tare_manuelle' ? parseFloat(tareManuelle) || 0 : contenant.tare)
    : 0;
  const brut = parseFloat(poidsBrut) || 0;
  const net = brut - tare;
  const netValide = net > 0;

  const reset = useCallback(() => {
    setStep(0); setMode(null); setMotif(null); setGroupe(null); setContenant(null);
    setPoidsBrut(''); setTareManuelle(''); setErreur(''); setSucces(null);
  }, []);

  function retour() {
    setErreur('');
    if (step === 1) { setMode(null); setStep(0); }
    else if (step === 2) { setMotif(null); setStep(1); }
    else if (step === 3) { setGroupe(null); setStep(2); }
    else if (step === 4) { setContenant(null); setPoidsBrut(''); setTareManuelle(''); setStep(3); }
  }

  async function enregistrer() {
    if (!netValide) { setErreur('Poids net invalide — vérifiez la saisie'); return; }
    setSaving(true); setErreur('');
    try {
      const payload = { date: todayISO(), poids_brut_kg: brut, contenant: contenant.id, tare_kg: tare };
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

  if (succes) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <Header heure={heure} dateLabel={dateLabel} />
        <EcranSucces poidsNet={succes.poidsNet} mode={mode} motif={motif} onRecommencer={reset} />
        <Historique lignes={historique} />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <Header heure={heure} dateLabel={dateLabel} />

      {/* Fil d'Ariane */}
      {step > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
          <button onClick={retour} className="flex items-center gap-1 text-gray-500 hover:text-gray-800 font-medium text-sm">
            ← Retour
          </button>
          <span className="text-gray-300">|</span>
          {mode && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${mode === 'entree' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
              {mode === 'entree' ? '↓ ENTRÉE' : '↑ SORTIE'}
            </span>
          )}
          {motif && <span className="text-sm text-gray-600">{motif.label}</span>}
          {groupe && <span className="text-sm text-gray-400">· {groupe.label}</span>}
          {contenant && <span className="text-sm text-gray-600">· {contenant.label}</span>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">

        {/* ── STEP 0 : Mode ─────────────────────────────────────────── */}
        {step === 0 && (
          <div className="h-full flex flex-col p-4 gap-4">
            <p className="text-center text-gray-400 font-medium text-sm uppercase tracking-widest">Que faites-vous ?</p>
            <div className="flex-1 grid grid-rows-2 gap-4">
              <button onClick={() => { setMode('entree'); setStep(1); }}
                className="rounded-3xl bg-green-500 hover:bg-green-600 active:scale-95 transition-all shadow-lg flex flex-col items-center justify-center gap-3 text-white">
                <span className="text-7xl">📥</span>
                <span className="text-3xl font-black tracking-wide">ENTRÉE</span>
                <span className="text-green-200 text-base">Stock qui arrive</span>
              </button>
              <button onClick={() => { setMode('sortie'); setStep(1); }}
                className="rounded-3xl bg-orange-500 hover:bg-orange-600 active:scale-95 transition-all shadow-lg flex flex-col items-center justify-center gap-3 text-white">
                <span className="text-7xl">📤</span>
                <span className="text-3xl font-black tracking-wide">SORTIE</span>
                <span className="text-orange-200 text-base">Stock qui part</span>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 1 : Motif ────────────────────────────────────────── */}
        {step === 1 && (
          <div className="h-full flex flex-col p-4 gap-4">
            <p className="text-center text-gray-400 font-medium text-sm uppercase tracking-widest">Pourquoi ?</p>
            <div className={`flex-1 grid gap-4 ${motifs.length === 2 ? 'grid-rows-2' : 'grid-rows-3'}`}>
              {motifs.map(m => (
                <button key={m.id} onClick={() => { setMotif(m); setStep(2); }}
                  className={`rounded-3xl ${m.couleur} active:scale-95 transition-all shadow-lg flex flex-col items-center justify-center gap-2 text-white px-6`}>
                  {m.Icon ? (
                    <m.Icon size={64} />
                  ) : (
                    <span className="text-6xl">{m.emoji}</span>
                  )}
                  <span className="text-2xl font-black">{m.label}</span>
                  <span className="text-white/70 text-sm text-center leading-tight">{m.commentaire}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2 : Groupe de contenant (2×2) ───────────────────── */}
        {step === 2 && (
          <div className="h-full flex flex-col p-4 gap-3">
            <p className="text-center text-gray-400 font-medium text-sm uppercase tracking-widest">Quel type de contenant ?</p>
            <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-4">
              {GROUPES.map(g => (
                <button
                  key={g.id}
                  onClick={() => { setGroupe(g); setStep(3); }}
                  className={`rounded-3xl ${g.bg} ${g.bgHover} active:scale-95 transition-all shadow-lg flex flex-col items-center justify-center gap-3`}
                >
                  <g.Icon size={72} color="white" />
                  <span className="text-white font-black text-xl text-center leading-tight px-2">{g.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 3 : Contenant du groupe ──────────────────────────── */}
        {step === 3 && groupe && (
          <div className="h-full flex flex-col p-4 gap-3">
            <p className="text-center text-gray-400 font-medium text-sm uppercase tracking-widest">Quel contenant ?</p>
            <div className={`flex-1 grid gap-3 ${
              groupe.contenants.length <= 2
                ? 'grid-cols-2 grid-rows-1 content-center'
                : groupe.contenants.length <= 4
                  ? 'grid-cols-2'
                  : 'grid-cols-3'
            }`}>
              {groupe.contenants.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setContenant({ ...c, groupe }); setStep(4); }}
                  className={`rounded-2xl border-2 ${groupe.border} ${groupe.light} active:scale-95 transition-all shadow-sm flex flex-col items-center justify-center gap-2 py-5 px-2`}
                >
                  <groupe.Icon size={44} color={groupe.couleur} />
                  <span className="text-sm font-bold text-center leading-tight text-gray-800">
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 4 : Poids ────────────────────────────────────────── */}
        {step === 4 && contenant && (
          <div className="flex flex-col h-full p-4 gap-4">
            {/* Récap contenant */}
            <div className={`rounded-2xl border-2 ${contenant.groupe.border} ${contenant.groupe.light} flex items-center gap-4 px-5 py-3 shrink-0`}>
              <contenant.groupe.Icon size={40} color={contenant.groupe.couleur} />
              <span className="font-bold text-lg text-gray-800">{contenant.label}</span>
            </div>

            {/* Tare manuelle si besoin */}
            {contenant.id === 'tare_manuelle' && (
              <div className="shrink-0">
                <label className="block text-sm font-bold text-gray-500 mb-1 uppercase tracking-wide">Tare (kg)</label>
                <input type="number" min="0" step="0.1" value={tareManuelle}
                  onChange={e => setTareManuelle(e.target.value)}
                  className="w-full border-2 border-violet-300 rounded-2xl px-4 py-3 text-2xl font-bold text-center focus:outline-none focus:border-violet-500"
                  placeholder="0" />
              </div>
            )}

            {/* Saisie poids brut */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-sm font-bold text-gray-500 mb-1 uppercase tracking-wide">Poids sur balance (kg)</label>
              <input type="number" min="0" step="0.1" value={poidsBrut}
                onChange={e => { setPoidsBrut(e.target.value); setErreur(''); }}
                className="w-full border-2 border-gray-300 rounded-2xl px-4 py-4 text-5xl font-black text-center focus:outline-none focus:border-green-500 flex-1"
                placeholder="0" autoFocus />
            </div>

            {/* Résultat net */}
            {poidsBrut && (
              <div className={`rounded-2xl px-6 py-4 flex items-center justify-between shrink-0 ${netValide ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
                <div className="text-sm text-gray-400 space-y-0.5">
                  <p>{brut.toFixed(1)} kg brut</p>
                  <p>— {tare.toFixed(1)} kg tare</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Poids net</p>
                  <p className={`text-5xl font-black ${netValide ? 'text-green-700' : 'text-red-600'}`}>
                    {net.toFixed(1)} kg
                  </p>
                </div>
              </div>
            )}

            {erreur && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm font-medium shrink-0">
                ✗ {erreur}
              </div>
            )}

            <button onClick={enregistrer} disabled={saving || !netValide}
              className={`w-full py-5 rounded-2xl text-white text-2xl font-black shadow-lg active:scale-95 transition-all shrink-0 ${
                mode === 'entree'
                  ? 'bg-green-500 hover:bg-green-600 disabled:bg-gray-200'
                  : 'bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200'
              } disabled:text-gray-400`}>
              {saving ? '…' : mode === 'entree' ? '✓  ENREGISTRER ENTRÉE' : '✓  ENREGISTRER SORTIE'}
            </button>
          </div>
        )}
      </div>

      <Historique lignes={historique} />
    </div>
  );
}
