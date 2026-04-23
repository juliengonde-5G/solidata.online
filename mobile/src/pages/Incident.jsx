import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateTap, vibrateSuccess, vibrateError } from '../services/haptic';
import MobileShell from '../components/MobileShell';
import PrimaryActionBar from '../components/PrimaryActionBar';
import StepConfirmScreen from '../components/StepConfirmScreen';
import {
  addPendingIncident, updatePendingIncident, deleteItem, newClientId, STORES,
} from '../services/db';
import { sendIncident, getPendingCount } from '../services/sync';

const INCIDENT_TYPES = [
  { value: 'cav_problem',       label: 'CAV dégradée',      sub: 'cassée, tag, dépôt sauvage', icon: '🗑' },
  { value: 'environment',       label: 'CAV inaccessible',  sub: 'bloquée, fermée, travaux',    icon: '🚧' },
  { value: 'cav_overflow',      label: 'Débordement',       sub: 'sacs autour, dépôt extérieur', icon: '⚠' },
  { value: 'vehicle_breakdown', label: 'Problème véhicule', sub: 'panne, hayon, crevaison',     icon: '🚚' },
  { value: 'security',          label: 'Sécurité',          sub: 'agression, menace, tension',  icon: '🛡' },
  { value: 'other',             label: 'Autre',             sub: 'à préciser',                  icon: '💬' },
];
const TYPE_LABELS = INCIDENT_TYPES.reduce((acc, t) => { acc[t.value] = t.label; return acc; }, {});

// Phrases prédéfinies par type — couvrent 80% des cas courants et évitent
// d'imposer une saisie clavier terrain.
const PRESETS = {
  vehicle_breakdown: ['Moteur', 'Pneu crevé', 'Freins', 'Batterie', 'Carburant', 'Hayon'],
  accident: ['Tôle froissée', 'Piéton / cycliste', 'Autre véhicule', 'Matériel urbain'],
  cav_problem: ['Serrure cassée', 'Conteneur endommagé', 'Tag / graffiti', 'Accès bloqué'],
  cav_overflow: ['Sacs autour', 'Dépôt sauvage', 'Déchets non conformes'],
  environment: ['Bloquée', 'Travaux', 'Stationnement gênant'],
  security: ['Agression', 'Menace', 'Tension'],
  other: [],
};

/**
 * Flux incident rapide :
 *   phase = 'type'    : l'utilisateur tape le type. Sauvegarde locale
 *                       immédiate + tentative d'envoi si online. Passage
 *                       direct en 'confirm'.
 *   phase = 'confirm' : StepConfirmScreen + bouton "Ajouter un détail".
 *   phase = 'detail'  : presets cliquables + saisie libre optionnelle.
 *                       La mise à jour enrichit la file locale. Si l'envoi
 *                       initial avait réussi, un incident enrichi est
 *                       renvoyé en nouvelle ligne (cf. hypothèse backend).
 */
export default function Incident() {
  const [phase, setPhase] = useState('type');
  const [type, setType] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [alreadySent, setAlreadySent] = useState(false);
  const [sendStatus, setSendStatus] = useState('pending');
  const [selectedPresets, setSelectedPresets] = useState([]);
  const [freeText, setFreeText] = useState('');
  const [freeOpen, setFreeOpen] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const vehicleId = localStorage.getItem('selected_vehicle_id');
  const cavId = localStorage.getItem('selected_cav_id');

  const backToMap = () => navigate('/tour-map');

  const chooseType = async (t) => {
    if (phase !== 'type') return;
    vibrateTap();
    setType(t);
    setError('');

    // Enregistrement local immédiat — aucune perte possible.
    const cId = newClientId();
    setClientId(cId);
    const record = {
      clientId: cId,
      tourId,
      type: t.value,
      description: null,
      cavId: cavId ? parseInt(cavId) : null,
      vehicleId: vehicleId ? parseInt(vehicleId) : null,
    };
    let localId = null;
    try {
      localId = await addPendingIncident(record);
      setPendingId(localId);
    } catch (err) {
      console.error('[Incident] addPendingIncident', err);
    }

    vibrateSuccess();
    setPhase('confirm');

    // Tentative d'envoi immédiat si online (non bloquante pour l'UI).
    if (navigator.onLine) {
      try {
        await sendIncident(record);
        if (localId) {
          try { await deleteItem(STORES.pendingIncidents, localId); } catch {}
        }
        setAlreadySent(true);
        setSendStatus('sent');
      } catch (err) {
        if (err?.response?.status >= 400 && err?.response?.status < 500) {
          // Rejet backend — supprimer l'entrée locale, statut "à renvoyer"
          if (localId) {
            try { await deleteItem(STORES.pendingIncidents, localId); } catch {}
          }
          setSendStatus('retry');
        } else {
          setSendStatus('pending');
        }
      } finally {
        await getPendingCount();
      }
    }
  };

  // Aucun nettoyage nécessaire au retour : la file est déjà purgée sur succès.
  const cleanupIfSent = async () => getPendingCount();

  const togglePreset = (p) => {
    vibrateTap();
    setSelectedPresets(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const composedDescription = () => {
    const parts = [...selectedPresets];
    if (freeText.trim()) parts.push(freeText.trim());
    return parts.length ? parts.join(' | ') : null;
  };

  const saveDetail = async () => {
    const description = composedDescription();
    setSavingDetail(true);
    setError('');
    try {
      if (!alreadySent && pendingId) {
        // Pas encore envoyé : on enrichit simplement la file locale.
        await updatePendingIncident(pendingId, { description });
      } else {
        // Déjà envoyé : backend actuel n'expose pas de PATCH. On poste un
        // incident complémentaire de type 'other' pour conserver la trace.
        // Cf. hypothèse backend (idempotence / PATCH à prévoir).
        const complement = {
          clientId: newClientId(),
          tourId,
          type: type?.value || 'other',
          description,
          cavId: cavId ? parseInt(cavId) : null,
          vehicleId: vehicleId ? parseInt(vehicleId) : null,
        };
        const extraPending = await addPendingIncident(complement);
        if (navigator.onLine) {
          try {
            await sendIncident(complement);
            await deleteItem(STORES.pendingIncidents, extraPending);
          } catch (err) {
            if (err?.response?.status >= 400 && err?.response?.status < 500) {
              await deleteItem(STORES.pendingIncidents, extraPending);
            }
          }
        }
      }
      await cleanupIfSent();
      await getPendingCount();
      vibrateSuccess();
      backToMap();
    } catch (err) {
      vibrateError();
      setError(err.message || 'Erreur, réessayez');
    }
    setSavingDetail(false);
  };

  // ── Rendu par phase ─────────────────────────────────────────────────────

  if (phase === 'confirm') {
    return (
      <StepConfirmScreen
        title="Incident signalé"
        cavName={type ? TYPE_LABELS[type.value] : null}
        status={sendStatus}
        summaryLines={[{ label: 'Type', value: TYPE_LABELS[type?.value] || '—' }]}
        primaryLabel="Terminer"
        onPrimary={async () => { await cleanupIfSent(); backToMap(); }}
        secondaryLabel="Ajouter un détail"
        onCorrect={() => setPhase('detail')}
        onAutoReturn={async () => { await cleanupIfSent(); backToMap(); }}
        autoReturnMs={10000}
      />
    );
  }

  if (phase === 'detail') {
    const presets = PRESETS[type?.value] || [];
    return (
      <MobileShell
        title="Détail de l'incident"
        subtitle={TYPE_LABELS[type?.value]}
        onBack={() => setPhase('confirm')}
        usageHint="operational_stop"
        footer={
          <PrimaryActionBar
            primaryLabel="Enregistrer"
            onPrimary={saveDetail}
            loading={savingDetail}
            disabled={selectedPresets.length === 0 && !freeText.trim()}
            error={error || null}
          />
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-gray-600">
            Choisissez ce qui correspond. La saisie libre reste optionnelle.
          </p>

          {presets.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Causes fréquentes</p>
              <div className="grid grid-cols-2 gap-2">
                {presets.map(p => {
                  const active = selectedPresets.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={active}
                      onClick={() => togglePreset(p)}
                      className={`card-mobile p-3 text-left text-sm font-semibold transition-all ${
                        active ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5 text-gray-900' : 'text-gray-800'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            {!freeOpen ? (
              <button
                type="button"
                onClick={() => setFreeOpen(true)}
                className="text-sm font-medium text-[var(--color-primary)] underline"
              >
                Ajouter une description libre
              </button>
            ) : (
              <div className="card-mobile p-4 space-y-2">
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder="Précisez si nécessaire…"
                  className="input-mobile min-h-[80px]"
                  rows={3}
                />
                <button
                  type="button"
                  onClick={() => { setFreeText(''); setFreeOpen(false); }}
                  className="text-xs text-gray-500 underline"
                >
                  Masquer
                </button>
              </div>
            )}
          </div>
        </div>
      </MobileShell>
    );
  }

  // phase === 'type' (par défaut)
  const cavName = localStorage.getItem('selected_cav_name');
  const hhmm = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FAFAF9' }}>
      {/* Red header */}
      <header
        className="flex-shrink-0 flex items-center gap-3 text-white"
        style={{
          background: '#DC2626',
          padding: 'calc(var(--safe-top) + 20px) 18px 16px',
        }}
      >
        <button
          type="button"
          onClick={backToMap}
          aria-label="Retour"
          className="touch-target flex items-center justify-center"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.2)',
            color: 'white',
            fontSize: 20,
          }}
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-widest font-bold opacity-85">⚠ Nouvel incident</p>
          <h1 className="font-extrabold text-lg leading-tight">Qu'est-ce qui se passe ?</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-6 space-y-5">
        {/* Context pill */}
        <div
          className="bg-white flex items-center justify-between text-xs text-gray-600"
          style={{ borderRadius: 12, padding: '10px 12px', border: '1px solid #E2E8F0' }}
        >
          <span>📍 {cavName || 'Position actuelle'}</span>
          <span className="font-bold text-gray-900">{hhmm}</span>
        </div>

        <p className="text-sm text-gray-600 leading-snug">
          Un seul tap suffit. Les détails sont optionnels et pourront être ajoutés juste après.
        </p>

        {/* Type grid 2x3 */}
        <div>
          <p className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mb-3">
            Type d'incident
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {INCIDENT_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                aria-label={`Signaler : ${t.label}`}
                onClick={() => chooseType(t)}
                className="flex flex-col items-center justify-center gap-1 text-center bg-white active:scale-[0.97] transition-all"
                style={{
                  minHeight: 96,
                  padding: '12px 10px',
                  borderRadius: 14,
                  border: '2px solid #E2E8F0',
                  color: '#1E293B',
                }}
              >
                <span className="text-[28px] leading-none" aria-hidden="true">{t.icon}</span>
                <span className="text-[14px] font-extrabold leading-tight">{t.label}</span>
                <span className="text-[10px] font-medium opacity-60 leading-tight">{t.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 font-medium">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
