import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ScanLine, Check, X, Package, AlertTriangle, Store, Layers, Scale,
  BookOpen, RotateCcw, Keyboard,
} from 'lucide-react';
import Layout from '../components/Layout';
import useScannerInput from '../hooks/useScannerInput';
import { beepSuccess, beepError, beepAlreadyOut, unlockAudio } from '../utils/beep';
import { visuelGamme } from '../utils/etiquettes-visuels';
import api from '../services/api';

// Durée minimale du flash plein écran (contrat § 3.2) : il doit rester visible
// assez longtemps pour être vu depuis la douchette, sans lever les yeux vers
// l'écran au bon moment. 1,2 s est le plancher demandé — au-delà, un nouveau
// scan qui arrive remplace immédiatement le flash en cours.
const FLASH_MIN_MS = 1200;

function nouveauSessionId() {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch { /* ignore */ }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayParis() {
  // Le journal par défaut est celui du jour courant, heure de Paris (le serveur
  // applique la même règle par défaut côté GET /journal — on l'anticipe pour ne
  // jamais afficher « aucun scan » à cause d'un décalage de fuseau côté client).
  const fmt = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

const RESULTAT_LABELS = {
  ok: 'Sorti',
  inconnu: 'Inconnu',
  deja_sorti: 'Déjà sorti',
  commande_fermee: 'Commande fermée',
  invalide: 'Invalide',
  annulation: 'Annulation',
};

const RESULTAT_COLORS = {
  ok: 'bg-emerald-100 text-emerald-800',
  inconnu: 'bg-rose-100 text-rose-800',
  deja_sorti: 'bg-amber-100 text-amber-800',
  commande_fermee: 'bg-rose-100 text-rose-800',
  invalide: 'bg-rose-100 text-rose-800',
  annulation: 'bg-slate-200 text-slate-700',
};

function GammeBadge({ gamme }) {
  if (!gamme) return null;
  const v = visuelGamme(gamme);
  return (
    <span
      className="px-2 py-0.5 text-xs font-semibold rounded"
      style={{ color: v.color, background: v.bg }}
    >
      {gamme}
    </span>
  );
}

// ── Journal du jour ──────────────────────────────────────────────────────────
function JournalPanel({ onClose }) {
  const [date, setDate] = useState(todayParis());
  const [resultatFiltre, setResultatFiltre] = useState('');
  const [data, setData] = useState({ items: [], compteurs: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const charger = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = { date, limit: 500 };
    if (resultatFiltre) params.resultat = resultatFiltre;
    api.get('/sortie-cartons/journal', { params })
      .then(({ data: d }) => setData(d || { items: [], compteurs: {} }))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [date, resultatFiltre]);

  useEffect(() => { charger(); }, [charger]);

  const compteurs = data.compteurs || {};
  const totalScans = Object.values(compteurs).reduce((s, n) => s + Number(n || 0), 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <BookOpen className="w-6 h-6 text-slate-600" />
          <h2 className="text-xl font-bold text-slate-800 flex-1">Journal du jour</h2>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold">Fermer</button>
        </div>

        <div className="px-6 py-3 border-b flex flex-wrap items-center gap-3 bg-slate-50">
          <label className="text-sm text-slate-600 flex items-center gap-2">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded-lg px-2 py-1 text-sm"
            />
          </label>
          <select
            value={resultatFiltre}
            onChange={(e) => setResultatFiltre(e.target.value)}
            className="border rounded-lg px-2 py-1 text-sm"
          >
            <option value="">Tous les résultats</option>
            {Object.entries(RESULTAT_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button onClick={charger} className="ml-auto text-sm px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold">
            Actualiser
          </button>
        </div>

        <div className="px-6 py-3 border-b flex flex-wrap gap-2">
          {Object.entries(RESULTAT_LABELS).map(([k, l]) => (
            <span key={k} className={`px-3 py-1 rounded-full text-xs font-semibold ${RESULTAT_COLORS[k]}`}>
              {l} : {compteurs[k] ?? 0}
            </span>
          ))}
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-white">
            Total : {totalScans}
          </span>
        </div>

        {error && <div className="mx-6 mt-3 bg-rose-50 text-rose-700 p-3 rounded text-sm">{error}</div>}

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading && <div className="text-slate-400 text-center py-8">Chargement…</div>}
          {!loading && data.items?.length === 0 && (
            <div className="text-slate-400 text-center py-8 text-sm">Aucun scan pour cette date.</div>
          )}
          {!loading && data.items?.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2 pr-3">Heure</th>
                  <th className="py-2 pr-3">Code lu</th>
                  <th className="py-2 pr-3">Format</th>
                  <th className="py-2 pr-3">Résultat</th>
                  <th className="py-2 pr-3">Produit</th>
                  <th className="py-2 pr-3">Commande</th>
                  <th className="py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-slate-500">
                      {it.scanned_at ? new Date(it.scanned_at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }) : '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono">{it.code_lu}</td>
                    <td className="py-2 pr-3 text-slate-500">{it.format}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${RESULTAT_COLORS[it.resultat] || 'bg-slate-100 text-slate-700'}`}>
                        {RESULTAT_LABELS[it.resultat] || it.resultat}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{it.carton?.produit || '—'}</td>
                    <td className="py-2 pr-3 text-slate-500">
                      {it.commande_type && it.commande_type !== 'libre' ? `${it.commande_type} #${it.commande_id}` : '—'}
                    </td>
                    <td className="py-2 text-slate-500 max-w-xs truncate" title={it.message}>{it.message || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SortieCartons() {
  const [mode, setMode] = useState(null); // 'btq' | 'vak' | 'libre'
  const [orders, setOrders] = useState([]);
  const [order, setOrder] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [scanned, setScanned] = useState([]);
  const [flash, setFlash] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [error, setError] = useState(null);
  const [showJournal, setShowJournal] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [busy, setBusy] = useState(false);
  const flashTimerRef = useRef(null);

  useEffect(() => {
    if (mode !== 'btq' && mode !== 'vak') return;
    if (order) return;
    let cancelled = false;
    setLoadingOrders(true);
    api.get(`/sortie-cartons/commandes-actives/${mode}`)
      .then(({ data }) => { if (!cancelled) setOrders(data); })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.error || e.message); })
      .finally(() => { if (!cancelled) setLoadingOrders(false); });
    return () => { cancelled = true; };
  }, [mode, order]);

  const scanning = mode === 'libre' || !!order;

  const afficherFlash = useCallback((next) => {
    // Le flash reste visible au minimum FLASH_MIN_MS : un scan qui arriverait
    // plus vite (rafale douchette) remplace le contenu mais respecte le
    // plancher de temps déjà écoulé pour ne jamais couper un affichage avant
    // qu'il ait pu être lu.
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlash(next);
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MIN_MS);
  }, []);

  const handleScan = useCallback(async (codeBrut) => {
    if (!scanning || busy) return;
    const code = String(codeBrut || '').trim();
    if (!code) return;
    setBusy(true);
    try {
      const payload = {
        code_barre: code,
        commande_type: mode,
        session_id: sessionId,
      };
      if (mode !== 'libre' && order) payload.commande_id = order.id;
      const { data } = await api.post('/sortie-cartons/scan', payload);
      // resultat: 'ok'
      beepSuccess();
      setScanned((prev) => [{ ...data.carton, scanned_at: new Date() }, ...prev]);
      afficherFlash({
        kind: 'ok',
        code,
        carton: data.carton,
        formatLibelle: null,
        message: null,
      });
      setError(null);
    } catch (e) {
      const body = e.response?.data || {};
      const resultat = body.resultat;
      if (resultat === 'deja_sorti') {
        beepAlreadyOut();
        afficherFlash({
          kind: 'already',
          code,
          carton: body.carton,
          formatLibelle: null,
          message: body.error || 'Ce carton a déjà été sorti.',
        });
      } else {
        // inconnu / invalide / commande_fermee → même traitement rouge
        beepError();
        afficherFlash({
          kind: 'error',
          code,
          carton: null,
          formatLibelle: body.format_libelle || null,
          message: body.error || 'Erreur',
        });
      }
    } finally {
      setBusy(false);
    }
  }, [scanning, busy, mode, order, sessionId, afficherFlash]);

  // Écoute HID globale — n'agit pas quand le focus est dans un champ texte
  // (le champ de saisie manuelle ci-dessous, notamment).
  useScannerInput({ onScan: handleScan, enabled: scanning });

  const soumettreManuel = (e) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode('');
    handleScan(code);
  };

  const totalKg = useMemo(
    () => scanned.reduce((s, c) => s + Number(c.poids_kg || 0), 0),
    [scanned]
  );

  const demarrerSession = () => setSessionId(nouveauSessionId());

  const pickOrder = async (o, type) => {
    unlockAudio();
    demarrerSession();
    setOrder({ ...o, type });
    setError(null);
    try {
      const { data } = await api.get(`/sortie-cartons/session/${type}/${o.id}`);
      setScanned((data.items || []).map((it) => ({ ...it, scanned_at: it.date_sortie ? new Date(it.date_sortie) : new Date() })));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const enterLibre = () => {
    unlockAudio();
    demarrerSession();
    setMode('libre');
    setScanned([]);
  };

  const leaveScan = () => {
    setMode(null);
    setOrder(null);
    setScanned([]);
    setFlash(null);
    setSessionId(null);
    setError(null);
  };

  const annuler = async (item) => {
    const confirmMsg = `Annuler la sortie du carton ${item.code_barre} ?`;
    if (!window.confirm(confirmMsg)) return;
    // Motif facultatif — demandé après confirmation pour ne pas bloquer le
    // geste courant (l'annulation reste rare, mais ne doit jamais réclamer
    // deux confirmations en cascade pour le cas simple).
    // eslint-disable-next-line no-alert
    const motif = window.prompt('Motif (facultatif) :', '') || undefined;
    try {
      const payload = {
        code_barre: item.code_barre,
        commande_type: mode,
      };
      if (mode !== 'libre' && order) payload.commande_id = order.id;
      if (motif) payload.motif = motif;
      await api.post('/sortie-cartons/annuler', payload);
      setScanned((prev) => prev.filter((s) => s.code_barre !== item.code_barre));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  // ── Écran d'entrée : choix du mode ────────────────────────────────────────
  if (!mode) {
    return (
      <Layout>
        <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
          <header className="flex items-center gap-4 mb-8">
            <ScanLine className="w-8 h-8 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-800 flex-1">Sortie cartons par scan</h1>
            <button
              onClick={() => setShowJournal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border shadow-sm hover:shadow font-semibold text-slate-700"
            >
              <BookOpen className="w-4 h-4" /> Journal du jour
            </button>
          </header>

          <div className="grid gap-6 md:grid-cols-3 max-w-6xl">
            <button
              onClick={() => setMode('btq')}
              className="bg-white rounded-3xl shadow-md hover:shadow-xl p-10 text-left transition transform hover:-translate-y-1 border-2 border-emerald-200 hover:border-emerald-500"
            >
              <Store className="w-16 h-16 text-emerald-600 mb-4" strokeWidth={1.5} />
              <div className="text-2xl font-bold text-slate-800 mb-2">Sur commande boutique</div>
              <div className="text-sm text-slate-500">Scan rattaché à une commande boutique active. Les cartons sont liés à la commande pour la traçabilité.</div>
            </button>
            <button
              onClick={() => setMode('vak')}
              className="bg-white rounded-3xl shadow-md hover:shadow-xl p-10 text-left transition transform hover:-translate-y-1 border-2 border-amber-200 hover:border-amber-500"
            >
              <Scale className="w-16 h-16 text-amber-600 mb-4" strokeWidth={1.5} />
              <div className="text-2xl font-bold text-slate-800 mb-2">Commande VAK / exutoire</div>
              <div className="text-sm text-slate-500">Scan rattaché à une commande de Vente au kilo ou d'exutoire active.</div>
            </button>
            <button
              onClick={enterLibre}
              className="bg-white rounded-3xl shadow-md hover:shadow-xl p-10 text-left transition transform hover:-translate-y-1 border-2 border-blue-200 hover:border-blue-500"
            >
              <Layers className="w-16 h-16 text-blue-600 mb-4" strokeWidth={1.5} />
              <div className="text-2xl font-bold text-slate-800 mb-2">Scan libre</div>
              <div className="text-sm text-slate-500">Sortie de stock sans rattachement à une commande. Le carton est marqué expédié sans destination.</div>
            </button>
          </div>
        </div>
        {showJournal && <JournalPanel onClose={() => setShowJournal(false)} />}
      </Layout>
    );
  }

  // ── Écran de choix de commande (btq / vak) ────────────────────────────────
  if ((mode === 'btq' || mode === 'vak') && !order) {
    const isBtq = mode === 'btq';
    return (
      <Layout>
        <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
          <header className="flex items-center gap-4 mb-8">
            <button onClick={leaveScan} className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold">← Retour</button>
            {isBtq ? <Store className="w-8 h-8 text-emerald-600" /> : <Scale className="w-8 h-8 text-amber-600" />}
            <h1 className="text-2xl font-bold text-slate-800 flex-1">
              {isBtq ? 'Choisir la commande boutique' : 'Choisir la commande VAK / exutoire'}
            </h1>
            <button
              onClick={() => setShowJournal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border shadow-sm hover:shadow font-semibold text-slate-700"
            >
              <BookOpen className="w-4 h-4" /> Journal
            </button>
          </header>

          {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}
          {loadingOrders && <div className="text-slate-400">Chargement…</div>}
          {!loadingOrders && orders.length === 0 && (
            <div className="bg-white rounded-2xl shadow p-8 text-center text-slate-500">
              {isBtq
                ? 'Aucune commande boutique active. Une commande doit être au statut envoyée, ajustée ou en préparation.'
                : 'Aucune commande VAK / exutoire active. Une commande doit être confirmée, en préparation ou chargée.'}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => pickOrder(o, mode)}
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
        {showJournal && <JournalPanel onClose={() => setShowJournal(false)} />}
      </Layout>
    );
  }

  // ── Écran de scan ──────────────────────────────────────────────────────────
  const headerLabel = mode === 'libre' ? 'Mode scan libre' : order.label;
  const headerSub = mode === 'libre'
    ? 'Sans rattachement commande'
    : `${order.reference} • ${mode === 'btq' ? 'Boutique' : 'VAK / exutoire'}`;
  const accent = mode === 'libre' ? 'text-blue-600' : mode === 'btq' ? 'text-emerald-600' : 'text-amber-600';

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 flex flex-col">
        <header className="bg-white border-b px-6 py-4 flex items-center gap-4 shadow-sm">
          <button onClick={leaveScan} className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold">← Changer</button>
          {mode === 'libre' ? <Layers className={`w-7 h-7 ${accent}`} /> : mode === 'btq' ? <Store className={`w-7 h-7 ${accent}`} /> : <Scale className={`w-7 h-7 ${accent}`} />}
          <div className="flex-1">
            <div className="text-xs text-slate-500">{headerSub}</div>
            <div className="text-xl font-bold text-slate-800">{headerLabel}</div>
          </div>
          <button
            onClick={() => setShowJournal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700"
          >
            <BookOpen className="w-4 h-4" /> Journal
          </button>
          <div className="text-right">
            <div className="text-xs text-slate-500">Cartons / Poids</div>
            <div className="text-2xl font-extrabold text-slate-800">{scanned.length} <span className="text-slate-400 text-lg">/</span> {totalKg.toFixed(1)} kg</div>
          </div>
        </header>

        {error && <div className="mx-6 mt-3 bg-rose-50 text-rose-700 p-3 rounded text-sm">{error}</div>}

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="bg-white rounded-3xl shadow-lg flex flex-col items-center justify-center min-h-[380px] relative overflow-hidden">
              {flash?.kind === 'ok' && (
                <div className="absolute inset-0 bg-emerald-500/95 flex flex-col items-center justify-center text-white p-6 text-center">
                  <Check className="w-32 h-32 mb-4" strokeWidth={3} />
                  <div className="text-3xl font-extrabold mb-1 font-mono break-all">{flash.carton?.code_barre || flash.code}</div>
                  {flash.carton?.code_lisible && (
                    <div className="text-lg font-mono opacity-90 mb-2">{flash.carton.code_lisible}</div>
                  )}
                  <div className="text-2xl font-bold">{flash.carton?.produit}</div>
                  <div className="text-xl">{flash.carton?.poids_kg} kg • {flash.carton?.gamme}</div>
                </div>
              )}
              {flash?.kind === 'error' && (
                <div className="absolute inset-0 bg-rose-600/95 flex flex-col items-center justify-center text-white p-6 text-center">
                  <X className="w-32 h-32 mb-4" strokeWidth={3} />
                  <div className="text-2xl font-extrabold mb-2">{flash.message}</div>
                  {flash.formatLibelle && (
                    <div className="text-lg opacity-90 mb-2">{flash.formatLibelle}</div>
                  )}
                  <div className="text-xl font-mono mt-2 break-all">{flash.code}</div>
                </div>
              )}
              {flash?.kind === 'already' && (
                <div className="absolute inset-0 bg-amber-500/95 flex flex-col items-center justify-center text-white p-6 text-center">
                  <AlertTriangle className="w-32 h-32 mb-4" strokeWidth={2.5} />
                  <div className="text-3xl font-extrabold">Déjà sorti</div>
                  {flash.carton?.produit && <div className="text-xl mt-1">{flash.carton.produit}</div>}
                  <div className="text-xl mt-2 font-mono break-all">{flash.code}</div>
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

            <div className="bg-white rounded-2xl shadow p-4">
              <form onSubmit={soumettreManuel} className="flex items-center gap-3">
                <Keyboard className="w-5 h-5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Code-barres endommagé — saisie manuelle"
                  className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
                  disabled={busy}
                />
                <button
                  type="submit"
                  disabled={busy || !manualCode.trim()}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-semibold"
                >
                  Valider
                </button>
              </form>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-lg p-4 flex flex-col">
            <div className="px-2 py-2 mb-2 border-b flex items-center justify-between">
              <h3 className="font-bold text-slate-700">Cartons sortis de la session</h3>
              <span className="text-xs text-slate-400">{scanned.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {scanned.length === 0 && <div className="text-slate-400 text-center py-8 text-sm">Aucun scan</div>}
              {scanned.map((s, i) => (
                <div key={`${s.code_barre}-${i}`} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Package className="w-5 h-5 text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-slate-800 truncate">{s.code_barre}</div>
                    <div className="text-xs text-slate-500 truncate">{s.produit}</div>
                  </div>
                  <GammeBadge gamme={s.gamme} />
                  <div className="text-sm font-bold text-slate-700 tabular-nums shrink-0">{s.poids_kg} kg</div>
                  <button
                    onClick={() => annuler(s)}
                    title="Annuler la sortie"
                    className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-500 shrink-0"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="bg-white border-t px-6 py-3 flex items-center justify-between text-sm text-slate-500">
          <span>Astuce : cette page écoute la douchette en permanence. Cliquez n'importe où dans la fenêtre si rien ne se passe.</span>
          <span>{mode === 'libre' ? 'Sortie libre' : order.reference}</span>
        </footer>
      </div>
      {showJournal && <JournalPanel onClose={() => setShowJournal(false)} />}
    </Layout>
  );
}
