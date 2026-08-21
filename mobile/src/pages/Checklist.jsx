import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateTap, vibrateSuccess, vibrateError } from '../services/haptic';
import MobileShell, { TourStepBar } from '../components/MobileShell';
import VehicleDamageMap from '../components/VehicleDamageMap';
import { authedFetch } from '../services/authedFetch';
import { addPendingChecklist, deleteItem, newClientId, STORES } from '../services/db';
import { sendChecklist, getPendingCount } from '../services/sync';
import { toApiPayload } from '../services/vehicleDamage';

const CHECKLIST_ITEMS = [
  { id: 'papiers', label: 'Papiers du véhicule', sub: 'carte grise, assurance', icon: '📄' },
  { id: 'permis', label: 'Permis de conduire', sub: 'sur toi', icon: '🪪' },
  { id: 'gilet', label: 'Gilet + EPI', sub: 'gilet, gants à portée', icon: '🦺' },
  { id: 'triangle', label: 'Triangle de signalisation', sub: 'en cas de panne', icon: '⚠️' },
  { id: 'extincteur', label: 'Extincteur', sub: 'présent et accessible', icon: '🧯' },
  { id: 'telephone', label: 'Téléphone chargé', sub: '> 50% batterie', icon: '📱' },
  { id: 'eclairage', label: 'Feux & clignotants', sub: 'test rapide avant / arrière', icon: '💡' },
  { id: 'pneus', label: 'Pneus & pression', sub: 'visuel autour du camion', icon: '🛞' },
  { id: 'niveaux', label: 'Tableau de bord', sub: 'Pas de voyants allumés', icon: '🔔' },
  { id: 'proprete', label: 'Benne propre', sub: 'vide, sans résidu', icon: '🧽' },
  { id: 'sacs_remballes', label: 'Sacs de remballes', sub: 'stock disponible', icon: '🛍️' },
];

/** Formate un horodatage ISO en heure FR courte (« 8h12 » → « 08:12 »). Ne
 * lève jamais — une date illisible retombe simplement sur `null`. */
function formatHeure(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/**
 * Écran plein cadre pour deux cas particuliers du départ en tournée :
 *  - le message de prévention routière renvoyé après validation ;
 *  - l'information « checklist déjà faite aujourd'hui » (409).
 * Toujours un bouton explicite pour continuer — jamais d'avance automatique
 * sur un message qui mérite d'être lu (cf. StepConfirmScreen pour les
 * confirmations routinières avec retour auto).
 */
function InfoScreen({ emoji, accent, title, text, meta, onContinue }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-2)]">
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-lg"
          style={{ background: accent }}
        >
          <span style={{ fontSize: 40 }} aria-hidden="true">{emoji}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {text && <p className="text-gray-600 mt-3 max-w-sm leading-relaxed">{text}</p>}
        {meta && <p className="text-sm text-gray-400 mt-3">{meta}</p>}
      </div>
      <div className="primary-action-bar">
        <button
          type="button"
          onClick={() => { vibrateTap(); onContinue(); }}
          className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform"
          style={{ minHeight: 72, borderRadius: 18, boxShadow: '0 8px 22px rgba(13,148,136,0.28)' }}
        >
          Continuer
        </button>
      </div>
    </div>
  );
}

export default function Checklist() {
  const [checked, setChecked] = useState({});
  const [notes, setNotes] = useState('');
  const [kmStart, setKmStart] = useState('');
  const [tour, setTour] = useState(null);
  const [damages, setDamages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Écran d'information après validation :
  //  - { type: 'prevention', titre, texte } — message de prévention routière ;
  //  - { type: 'deja_faite', faiteLe } — 409 CHECKLIST_DEJA_FAITE.
  const [postScreen, setPostScreen] = useState(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authedFetch(`/api/tours/${tourId}/public`);
        const data = await res.json();
        setTour(data);
      } catch (e) {}
    };
    if (tourId) load();
  }, [tourId]);

  const toggle = (id) => { vibrateTap(); setChecked(prev => ({ ...prev, [id]: !prev[id] })); };
  const allChecked = CHECKLIST_ITEMS.every(item => checked[item.id]);
  const checkedCount = CHECKLIST_ITEMS.filter(item => checked[item.id]).length;
  const progressPct = (checkedCount / CHECKLIST_ITEMS.length) * 100;

  // Bascule véhicule "in_progress" côté serveur puis rejoint la carte de
  // tournée. TOUJOURS best-effort et TOUJOURS exécuté quel que soit le sort
  // de la checklist elle-même (réseau coupé compris) : le chauffeur ne doit
  // jamais rester bloqué sur cet écran faute de réseau.
  const finalizeDeparture = async () => {
    try {
      await authedFetch(`/api/tours/${tourId}/start-public`, { method: 'PUT' });
    } catch (e) {
      console.warn('[Checklist] start-public non confirmé (réseau) :', e?.message || e);
    }
    navigate('/tour-map');
  };

  const submit = async () => {
    if (!allChecked || loading) return;
    setLoading(true);
    setError('');

    const payload = {
      clientId: newClientId(),
      tourId,
      vehicleId: tour?.vehicle_id,
      exteriorOk: allChecked,
      fuelLevel: '1/2',
      kmStart: parseInt(kmStart, 10) || 0,
      notes,
      degats: toApiPayload(damages),
    };

    // Toujours écrire dans la file offline d'abord — aucune perte possible,
    // même si l'envoi réseau échoue ou n'est pas tenté (hors ligne).
    let pendingId = null;
    try {
      pendingId = await addPendingChecklist(payload);
    } catch (e) {
      console.error('[Checklist] addPendingChecklist', e);
    }
    const clearPending = async () => {
      if (pendingId != null) {
        try { await deleteItem(STORES.pendingChecklists, pendingId); } catch { /* noop */ }
      }
    };

    let messagePrevention = null;
    let dejaFaiteInfo = null; // { faiteLe } quand 409
    let hardError = null;

    if (navigator.onLine) {
      try {
        const data = await sendChecklist(payload);
        await clearPending();
        messagePrevention = data?.message_prevention || null;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 409) {
          // Checklist déjà remplie aujourd'hui pour ce véhicule — pas une
          // erreur : on informe le chauffeur et on le laisse continuer.
          await clearPending();
          dejaFaiteInfo = { faiteLe: err.response?.data?.faite_le || null };
        } else if (status >= 400 && status < 500) {
          // Donnée rejetée par le serveur — on n'insiste pas silencieusement :
          // le chauffeur voit l'erreur et peut réessayer.
          await clearPending();
          hardError = err.response?.data?.error || "La vérification n'a pas pu être enregistrée. Réessaie.";
        } else {
          // Réseau / 5xx : reste dans la file pour un envoi ultérieur — ne
          // bloque jamais le départ (aucun message de prévention à montrer,
          // on n'a pas de réponse serveur).
          console.warn('[Checklist] checklist différée (réseau) :', err?.message || err);
        }
      }
    }
    // Hors ligne dès le départ : la checklist reste en file (rejouée à la
    // reconnexion via syncAll), aucun appel réseau n'est tenté — comme les
    // autres écrans offline-first de l'app (FillLevel, EndOfDayChecklist).

    await getPendingCount();

    if (hardError) {
      vibrateError();
      setError(hardError);
      setLoading(false);
      return;
    }

    vibrateSuccess();
    setLoading(false);

    if (messagePrevention) {
      setPostScreen({ type: 'prevention', titre: messagePrevention.titre, texte: messagePrevention.texte });
      return;
    }
    if (dejaFaiteInfo) {
      setPostScreen({ type: 'deja_faite', faiteLe: dejaFaiteInfo.faiteLe });
      return;
    }
    await finalizeDeparture();
  };

  if (postScreen?.type === 'prevention') {
    return (
      <InfoScreen
        emoji="🚦"
        accent="var(--color-primary)"
        title={postScreen.titre || 'Message de prévention'}
        text={postScreen.texte}
        onContinue={finalizeDeparture}
      />
    );
  }

  if (postScreen?.type === 'deja_faite') {
    const heure = formatHeure(postScreen.faiteLe);
    return (
      <InfoScreen
        emoji="🕒"
        accent="#0284C7"
        title="Vérification déjà faite"
        text={heure
          ? `La vérification du camion pour aujourd'hui a déjà été faite, à ${heure}.`
          : "La vérification du camion pour aujourd'hui a déjà été faite."}
        meta="Tu peux continuer vers la carte de la tournée."
        onContinue={finalizeDeparture}
      />
    );
  }

  return (
    <MobileShell
      title="Vérifications camion"
      subtitle="Avant le départ"
      onBack={() => navigate('/start')}
      usageHint="operational_stop"
      footer={
        <div className="primary-action-bar">
          {error && (
            <div className="primary-action-hint primary-action-hint--error" role="alert">{error}</div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!allChecked || loading}
            className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              minHeight: 84,
              borderRadius: 20,
              boxShadow: '0 8px 22px rgba(13,148,136,0.28)',
            }}
          >
            {loading
              ? 'Enregistrement…'
              : allChecked
                ? <>▶ Démarrer la navigation</>
                : `Coche les ${CHECKLIST_ITEMS.length - checkedCount} dernier${CHECKLIST_ITEMS.length - checkedCount > 1 ? 's' : ''} point${CHECKLIST_ITEMS.length - checkedCount > 1 ? 's' : ''}`}
          </button>
        </div>
      }
    >
      <div className="mb-4">
        <TourStepBar currentPath="/checklist" />
      </div>

      {/* Progress bar + count */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-sm font-extrabold text-gray-800 min-w-[44px] text-right">
          {checkedCount}/{CHECKLIST_ITEMS.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {CHECKLIST_ITEMS.map(item => {
          const ok = !!checked[item.id];
          return (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={ok}
              aria-label={item.label}
              onClick={() => toggle(item.id)}
              className="w-full flex items-center gap-4 text-left bg-white active:scale-[0.99] transition-all"
              style={{
                minHeight: 72,
                padding: '14px 14px',
                borderRadius: 16,
                border: ok ? '2px solid var(--color-primary)' : '1px solid #E2E8F0',
                boxShadow: ok ? '0 2px 8px rgba(13,148,136,0.12)' : '0 1px 2px rgba(15,23,42,0.04)',
              }}
            >
              <div
                className="flex items-center justify-center text-xl flex-shrink-0"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: ok ? 'var(--color-primary-surface, #F0FDFA)' : '#F1F5F9',
                }}
              >
                <span aria-hidden="true">{item.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold text-gray-900 leading-tight">{item.label}</div>
                {item.sub && <div className="text-xs text-gray-500 mt-0.5">{item.sub}</div>}
              </div>
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: ok ? 'var(--color-primary)' : 'white',
                  border: ok ? '2px solid var(--color-primary)' : '2px solid #CBD5E1',
                  color: 'white',
                  fontWeight: 800,
                }}
              >
                {ok && (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <VehicleDamageMap value={damages} onChange={setDamages} />
      </div>

      <div className="mt-5 space-y-3">
        <div
          className="bg-white"
          style={{ borderRadius: 16, padding: 14, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Kilométrage départ</label>
          <input
            type="number"
            inputMode="numeric"
            value={kmStart}
            onChange={e => setKmStart(e.target.value)}
            placeholder="Ex. 45230"
            className="input-mobile"
          />
        </div>
        <div
          className="bg-white"
          style={{ borderRadius: 16, padding: 14, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anomalies constatées…"
            className="input-mobile min-h-[80px]"
            rows={2}
          />
        </div>
      </div>
    </MobileShell>
  );
}
