import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateSuccess, vibrateError, vibrateTap } from '../services/haptic';
import MobileShell from '../components/MobileShell';
import PrimaryActionBar from '../components/PrimaryActionBar';
import StepConfirmScreen from '../components/StepConfirmScreen';
import CAVContainerIcon from '../components/CAVContainerIcon';
import {
  addPendingCollect, deleteItem, newClientId, STORES,
  draftKey, saveDraft, readDraft, clearDraft,
} from '../services/db';
import { sendCollect, getPendingCount } from '../services/sync';

// 6 niveaux visuels. Le backend ne gère que 0-4 : 'overflow' mappe sur 4
// (plein) avec une anomalie 'debordement' automatiquement posée.
const FILL_LEVELS = [
  { value: 0, label: 'vide',          pct: '0%',   visual: 'empty',         store: 0 },
  { value: 1, label: 'un peu',        pct: '25%',  visual: 'quarter',       store: 1 },
  { value: 2, label: 'à moitié',      pct: '50%',  visual: 'half',          store: 2 },
  { value: 3, label: 'presque plein', pct: '75%',  visual: 'three_quarter', store: 3 },
  { value: 4, label: 'plein',         pct: '100%', visual: 'full',          store: 4 },
  { value: 5, label: 'au-delà',       pct: '++',   visual: 'overflow',      store: 4, overflow: true },
];

const COMMON_ANOMALIES = [
  { value: 'debordement', label: 'Débordement', icon: '🟨' },
  { value: 'acces_bloque', label: 'Accès bloqué', icon: '🚧' },
  { value: 'conteneur_endommage', label: 'Conteneur endommagé', icon: '⚠️' },
  { value: 'dechets_non_conformes', label: 'Déchets non conformes', icon: '🗑' },
];
const OTHER_ANOMALIES = [
  { value: 'vandalisme', label: 'Vandalisme' },
  { value: 'cle_cassee', label: 'Clé cassée' },
];
const ANOMALY_LABELS = [...COMMON_ANOMALIES, ...OTHER_ANOMALIES].reduce((acc, a) => {
  acc[a.value] = a.label;
  return acc;
}, {});

export default function FillLevel() {
  const [fillLevel, setFillLevel] = useState(null);
  const [anomaly, setAnomaly] = useState('');
  const [showOtherAnomalies, setShowOtherAnomalies] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { cavName, pendingId, status }
  const [cavName, setCavName] = useState(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const scannedQR = localStorage.getItem('scanned_qr');

  useEffect(() => {
    // Récupère le nom du CAV pour l'afficher dans la confirmation.
    const cachedName = localStorage.getItem('selected_cav_name');
    if (cachedName) setCavName(cachedName);

    // Pré-remplissage si un draft existe pour (tour, cav) : typiquement
    // au retour d'un "Corriger" depuis StepConfirmScreen.
    const cavIdLs = localStorage.getItem('selected_cav_id');
    if (!tourId || !cavIdLs) return;
    const key = draftKey('collect', tourId, cavIdLs);
    readDraft(key).then(d => {
      if (!d) return;
      if (typeof d.fillLevel === 'number') setFillLevel(d.fillLevel);
      if (d.anomaly) setAnomaly(d.anomaly);
      if (d.notes) { setNotes(d.notes); setNotesOpen(true); }
    }).catch(() => {});
  }, [tourId]);

  const chooseLevel = (v) => { vibrateTap(); setFillLevel(v); };
  const toggleAnomaly = (value) => {
    vibrateTap();
    setAnomaly(prev => (prev === value ? '' : value));
  };

  const submit = async () => {
    if (fillLevel === null) return;
    // Résout la valeur à envoyer et l'anomalie implicite pour le niveau ++.
    const levelObj = FILL_LEVELS.find(l => l.value === fillLevel);
    const storeLevel = levelObj ? levelObj.store : fillLevel;
    const effectiveAnomaly = levelObj?.overflow && !anomaly ? 'debordement' : anomaly;
    setLoading(true);
    setError('');
    try {
      // 1) charger la tournée pour retrouver le CAV à marquer.
      const tourRes = await fetch(`/api/tours/${tourId}/public`);
      if (!tourRes.ok) throw new Error('Impossible de charger la tournée');
      const tourData = await tourRes.json();
      const cavs = tourData.cavs || [];
      const tourIsAssociation = tourData.collection_type === 'association';

      const selectedCavId = localStorage.getItem('selected_cav_id');
      let cav = null;
      if (selectedCavId) {
        cav = cavs.find(c => String(c.cav_id) === String(selectedCavId) || String(c.id) === String(selectedCavId));
      }
      if (!cav) cav = cavs.find(c => c.status !== 'collected');

      if (!cav) {
        throw new Error('Aucun CAV à collecter dans cette tournée');
      }

      const cavId = cav.cav_id || cav.id;
      const displayName = cav.nom || cav.cav_name || 'CAV';
      setCavName(displayName);

      // 2) Persiste un draft pour pouvoir re-pré-remplir le formulaire via
      //    "Corriger" tant que l'action n'est pas sent.
      const dKey = draftKey('collect', tourId, cavId);
      await saveDraft(dKey, { fillLevel, anomaly, notes });

      // 3) Toujours écrire dans la file offline d'abord pour garantir aucune
      //    perte de donnée, même si le submit backend échoue.
      const payload = {
        clientId: newClientId(),
        tourId,
        cavId,
        fillLevel: storeLevel,
        anomaly: effectiveAnomaly,
        notes,
        qrScanned: !tourIsAssociation,
      };
      const pendingId = await addPendingCollect(payload);

      // 3) Si online, tenter l'envoi immédiat. Si ça passe, on peut supprimer
      //    l'entrée locale. Sinon on la laisse pour sync ultérieure.
      let status = 'pending';
      if (navigator.onLine) {
        try {
          await sendCollect(payload);
          await deleteItem(STORES.pendingCollects, pendingId);
          status = 'sent';
        } catch (e) {
          if (e?.response?.status >= 400 && e?.response?.status < 500) {
            // 4xx : backend a rejeté — on supprime pour éviter la boucle.
            await deleteItem(STORES.pendingCollects, pendingId);
            status = 'retry';
          } else {
            status = 'pending';
          }
        }
      }

      // Si envoi serveur OK, le draft devient sans valeur : on le supprime
      // pour éviter de mentir à l'utilisateur au prochain retour.
      if (status === 'sent') {
        try { await clearDraft(dKey); } catch {}
      }

      await getPendingCount();
      vibrateSuccess();
      setConfirm({ cavName: displayName, pendingId, status, cavId });
    } catch (err) {
      vibrateError();
      setError(err.message || 'Erreur, réessayez');
      console.error('[FillLevel] submit', err);
    }
    setLoading(false);
  };

  const finishAndReturn = async () => {
    // Draft conservé si non envoyé pour pouvoir corriger plus tard.
    // Nettoyé explicitement si déjà envoyé au serveur (fait dans submit).
    localStorage.removeItem('scanned_qr');
    localStorage.removeItem('selected_cav_id');
    localStorage.removeItem('selected_cav_name');
    localStorage.removeItem('qr_unavailable_reason');
    navigate('/tour-map');
  };

  const correct = async () => {
    // Retour édition : le draft (saveDraft dans submit) est déjà posé, le
    // useEffect le re-lira au re-render de l'écran de saisie. On supprime
    // la file locale pour que le prochain submit crée une entrée propre.
    if (confirm?.pendingId) {
      try { await deleteItem(STORES.pendingCollects, confirm.pendingId); } catch {}
    }
    await getPendingCount();
    setConfirm(null);
  };

  const selected = FILL_LEVELS.find(o => o.value === fillLevel);

  const summaryLines = useMemo(() => {
    const lines = [];
    if (selected) lines.push({ label: 'Niveau', value: `${selected.pct} — ${selected.label}` });
    if (anomaly) lines.push({ label: 'Anomalie', value: ANOMALY_LABELS[anomaly] || anomaly });
    if (notes) lines.push({ label: 'Note', value: notes });
    return lines;
  }, [selected, anomaly, notes]);

  if (confirm) {
    // "Corriger" n'est proposé que si l'action n'a pas encore quitté le
    // mobile. Le backend n'expose pas de endpoint uncollect-public, donc
    // un rollback serveur n'est pas possible aujourd'hui (cf. contrat
    // backend recommandé dans DOCUMENTATION_MOBILE.md).
    const canCorrect = confirm.status !== 'sent';
    return (
      <StepConfirmScreen
        title="Collecte enregistrée"
        cavName={confirm.cavName}
        status={confirm.status}
        summaryLines={summaryLines}
        primaryLabel="Continuer"
        onPrimary={finishAndReturn}
        secondaryLabel={canCorrect ? 'Corriger' : null}
        onCorrect={canCorrect ? correct : null}
        onAutoReturn={finishAndReturn}
        autoReturnMs={8000}
      />
    );
  }

  return (
    <MobileShell
      title="Remplissage"
      subtitle={scannedQR ? 'CAV identifié' : 'Niveau observé'}
      onBack={() => navigate('/tour-map')}
      usageHint="operational_stop"
      footer={
        <PrimaryActionBar
          primaryLabel="Valider · point suivant"
          onPrimary={submit}
          loading={loading}
          disabled={fillLevel === null}
          error={error || null}
          pendingOffline={!navigator.onLine}
        />
      }
    >
      <div className="space-y-5">
        {/* 1. Niveau — grille 3x2 avec CAV iconographique */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-bold mb-3">
            Niveau de remplissage
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {FILL_LEVELS.map(level => {
              const active = fillLevel === level.value;
              return (
                <button
                  key={level.value}
                  type="button"
                  aria-label={`Remplissage ${level.pct}`}
                  aria-pressed={active}
                  onClick={() => chooseLevel(level.value)}
                  className="flex flex-col items-center justify-center gap-1.5 bg-white active:scale-[0.97] transition-all"
                  style={{
                    minHeight: 120,
                    padding: '10px 6px',
                    borderRadius: 14,
                    border: active
                      ? '3px solid var(--color-primary)'
                      : '2px solid #E2E8F0',
                    color: active && level.overflow ? '#7F1D1D' : active ? 'var(--color-primary-dark)' : '#334155',
                    boxShadow: active
                      ? '0 6px 16px rgba(13,148,136,0.22)'
                      : 'none',
                    background: active && level.overflow ? '#FEE2E2' : 'white',
                  }}
                >
                  <CAVContainerIcon level={level.visual} size={40} active={active} />
                  <span className="text-base font-extrabold leading-none">
                    {level.pct === '++' ? 'Au-delà' : level.pct}
                  </span>
                  <span className="text-[11px] font-semibold opacity-70 leading-tight">
                    {level.label}
                  </span>
                </button>
              );
            })}
          </div>
          {selected && (
            <div
              className="mt-3 text-sm font-semibold"
              style={{
                background: 'var(--color-primary-surface, #F0FDFA)',
                border: '1px solid #99F6E4',
                color: 'var(--color-primary-dark)',
                borderRadius: 12,
                padding: '10px 14px',
              }}
            >
              ✓ Niveau enregistré : <b>{selected.label}</b>
              {' '}({selected.overflow ? 'dépassement' : selected.pct})
            </div>
          )}
        </div>

        {/* 2. Anomalies — cartes tactiles */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Anomalie (optionnel)</p>
          <div className="grid grid-cols-2 gap-2">
            {COMMON_ANOMALIES.map(a => {
              const active = anomaly === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleAnomaly(a.value)}
                  className={`card-mobile p-3 flex items-center gap-2 text-left transition-all ${
                    active ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5' : ''
                  }`}
                >
                  <span className="text-xl" aria-hidden="true">{a.icon}</span>
                  <span className="text-sm font-semibold text-gray-800">{a.label}</span>
                </button>
              );
            })}
          </div>

          {!showOtherAnomalies && (
            <button
              type="button"
              onClick={() => setShowOtherAnomalies(true)}
              className="mt-2 text-sm font-medium text-[var(--color-primary)] underline"
            >
              Autres anomalies
            </button>
          )}

          {showOtherAnomalies && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {OTHER_ANOMALIES.map(a => {
                const active = anomaly === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleAnomaly(a.value)}
                    className={`card-mobile p-3 text-sm font-medium text-gray-700 transition-all ${
                      active ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5' : ''
                    }`}
                  >
                    {a.label}
                  </button>
                );
              })}
              {anomaly && (
                <button
                  type="button"
                  onClick={() => setAnomaly('')}
                  className="card-mobile p-3 text-sm text-gray-500"
                >
                  Effacer
                </button>
              )}
            </div>
          )}
        </div>

        {/* 2bis. Actions secondaires — incident / camion plein */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => navigate('/incident')}
            className="w-full flex items-center gap-3 text-left bg-white active:scale-[0.99] transition-transform"
            style={{
              minHeight: 60,
              padding: '12px 14px',
              borderRadius: 14,
              border: '2px solid #FECACA',
              color: '#B91C1C',
            }}
          >
            <span className="text-xl" aria-hidden="true">⚠</span>
            <span className="flex-1 font-bold text-[15px]">Déclarer un incident</span>
            <span aria-hidden="true" className="text-gray-400">→</span>
          </button>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem('intermediate_return', 'true');
              navigate('/weigh-in');
            }}
            className="w-full flex items-center gap-3 text-left bg-white active:scale-[0.99] transition-transform"
            style={{
              minHeight: 60,
              padding: '12px 14px',
              borderRadius: 14,
              border: '2px solid #FDE68A',
              color: '#B45309',
            }}
          >
            <span className="text-xl" aria-hidden="true">🚚</span>
            <span className="flex-1 font-bold text-[15px]">Camion plein → centre de tri</span>
            <span aria-hidden="true" className="text-gray-400">→</span>
          </button>
        </div>

        {/* 3. Notes libres — repliées par défaut */}
        <div>
          {!notesOpen ? (
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              className="text-sm font-medium text-[var(--color-primary)] underline"
            >
              Ajouter une note
            </button>
          ) : (
            <div className="card-mobile p-4 space-y-2">
              <label className="block text-sm font-medium text-gray-700">Note</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Observations…"
                className="input-mobile min-h-[80px]"
                rows={3}
              />
              <button
                type="button"
                onClick={() => { setNotes(''); setNotesOpen(false); }}
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
