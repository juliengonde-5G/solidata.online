import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateSuccess, vibrateError, vibrateTap } from '../services/haptic';
import StepConfirmScreen from '../components/StepConfirmScreen';
import OfflineActionBadge from '../components/OfflineActionBadge';
import { addPendingWeight, deleteItem, newClientId, STORES } from '../services/db';
import { sendWeight, getPendingCount } from '../services/sync';

export default function WeighIn() {
  const [grossWeight, setGrossWeight] = useState('');
  const [tareWeight, setTareWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { status, pendingId, net, tare, gross }
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const isIntermediate = localStorage.getItem('intermediate_return') === 'true';

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const netWeight = Math.max(0, (parseFloat(grossWeight) || 0) - (parseFloat(tareWeight) || 0));

  const step = (delta) => {
    vibrateTap();
    setGrossWeight(prev => {
      const current = parseFloat(prev) || 0;
      const next = Math.max(0, current + delta);
      return String(next);
    });
  };

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      const tare = parseFloat(tareWeight) || 0;
      const gross = parseFloat(grossWeight) || 0;
      const finalize = !isIntermediate;

      // 1) Écriture offline-first — zéro perte.
      const record = {
        clientId: newClientId(),
        tourId,
        weightKg: netWeight,
        tareKg: tare,
        isIntermediate,
        finalize,
        notes: null,
      };
      const pendingId = await addPendingWeight(record);

      // 2) Tentative d'envoi immédiat si online.
      let status = 'pending';
      if (navigator.onLine) {
        try {
          await sendWeight(record);
          try { await deleteItem(STORES.pendingWeights, pendingId); } catch {}
          status = 'sent';
        } catch (e) {
          if (e?.response?.status >= 400 && e?.response?.status < 500) {
            try { await deleteItem(STORES.pendingWeights, pendingId); } catch {}
            status = 'retry';
          } else {
            status = 'pending';
          }
        }
      }

      await getPendingCount();
      vibrateSuccess();
      setConfirm({ status, pendingId, gross, tare, net: netWeight });
    } catch (err) {
      vibrateError();
      console.error('[WeighIn] submit', err);
      setError(err.message || 'Erreur, réessayez');
    }
    setLoading(false);
  };

  const finishAndNavigate = () => {
    if (isIntermediate) {
      localStorage.removeItem('intermediate_return');
      navigate('/tour-map');
    } else {
      navigate('/tour-summary');
    }
  };

  const summaryLines = useMemo(() => {
    if (!confirm) return [];
    return [
      { label: 'Poids brut', value: `${confirm.gross.toFixed(0)} kg` },
      { label: 'Tare', value: `${confirm.tare.toFixed(0)} kg` },
      { label: 'Poids net', value: `${confirm.net.toFixed(0)} kg` },
    ];
  }, [confirm]);

  if (confirm) {
    return (
      <StepConfirmScreen
        title={isIntermediate ? 'Pesée intermédiaire enregistrée' : 'Pesée enregistrée'}
        cavName={isIntermediate ? null : 'Tournée terminée'}
        status={confirm.status}
        summaryLines={summaryLines}
        primaryLabel={isIntermediate ? 'Reprendre la collecte' : 'Voir le récapitulatif'}
        onPrimary={finishAndNavigate}
        onAutoReturn={finishAndNavigate}
        autoReturnMs={8000}
      />
    );
  }

  const canSubmit = !loading && grossWeight !== '' && tareWeight !== '';
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-2)]">
      {/* Amber header */}
      <header
        className="flex-shrink-0 flex items-center gap-3 text-white"
        style={{
          background: '#B45309',
          padding: 'calc(var(--safe-top) + 20px) 18px 16px',
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (isIntermediate) { localStorage.removeItem('intermediate_return'); navigate('/tour-map'); }
            else { navigate('/return-centre'); }
          }}
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
          <p className="text-[11px] uppercase tracking-widest font-bold opacity-85">🏭 Centre de tri Rouen</p>
          <h1 className="font-extrabold text-lg leading-tight">
            {isIntermediate ? 'Pesée intermédiaire' : 'Pesée du chargement'}
          </h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-6 space-y-4">
        <p className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">
          Poids net sur bascule
        </p>

        {/* Readout card */}
        <div
          className="bg-white text-center"
          style={{
            borderRadius: 20,
            padding: '26px 20px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 2px 10px rgba(15,23,42,0.04)',
          }}
        >
          <div
            className="font-extrabold text-gray-900"
            style={{ fontSize: 72, lineHeight: 1, letterSpacing: '-0.03em' }}
          >
            {netWeight.toFixed(0)}
            <span className="text-gray-400 ml-2" style={{ fontSize: 28 }}>kg</span>
          </div>

          <div className="flex justify-center gap-2.5 mt-5">
            {[-5, -1, +1, +5].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => step(d)}
                aria-label={`Ajuster poids de ${d > 0 ? '+' : ''}${d} kg`}
                className="font-extrabold active:scale-95 transition-transform"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: '#F1F5F9',
                  color: '#1E293B',
                  border: 'none',
                  fontSize: 20,
                }}
              >
                {d > 0 ? `+${d}` : `${d}`}
              </button>
            ))}
          </div>

          <div
            className="inline-flex items-center gap-2 mt-4"
            style={{
              background: 'var(--color-primary-surface, #F0FDFA)',
              color: 'var(--color-primary-dark)',
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            🔗 Bascule connectée · auto-lecture
          </div>
        </div>

        {/* Manual inputs */}
        <div className="grid grid-cols-2 gap-2.5">
          <div
            className="bg-white"
            style={{ borderRadius: 14, padding: 12, border: '1px solid #E2E8F0' }}
          >
            <label className="block text-xs font-semibold text-gray-600 mb-1">Poids brut (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              value={grossWeight}
              onChange={e => setGrossWeight(e.target.value)}
              placeholder="Chargé"
              className="w-full bg-transparent outline-none text-center text-lg font-bold text-gray-900"
            />
          </div>
          <div
            className="bg-white"
            style={{ borderRadius: 14, padding: 12, border: '1px solid #E2E8F0' }}
          >
            <label className="block text-xs font-semibold text-gray-600 mb-1">Tare (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              value={tareWeight}
              onChange={e => setTareWeight(e.target.value)}
              placeholder="À vide"
              className="w-full bg-transparent outline-none text-center text-lg font-bold text-gray-900"
            />
          </div>
        </div>

        {/* Recap déchargement */}
        <div
          className="bg-white"
          style={{ borderRadius: 14, padding: 14, border: '1px solid #E2E8F0' }}
        >
          <p className="text-xs font-semibold text-gray-500 mb-2">Récap déchargement</p>
          <div className="flex justify-between items-baseline text-sm mb-1">
            <span className="text-gray-600">Tournée</span>
            <span className="font-bold text-gray-900">#{tourId || '—'}</span>
          </div>
          <div className="flex justify-between items-baseline text-sm mb-1">
            <span className="text-gray-600">Type</span>
            <span className="font-bold text-gray-900">
              {isIntermediate ? 'Intermédiaire' : 'Finale'}
            </span>
          </div>
          <div className="flex justify-between items-baseline text-sm">
            <span className="text-gray-600">Heure</span>
            <span className="font-bold text-gray-900">{now}</span>
          </div>
        </div>

        {!online && (
          <div className="flex items-center justify-center">
            <OfflineActionBadge status="pending" label="Hors ligne — sera envoyé" />
          </div>
        )}
      </div>

      <div className="primary-action-bar flex flex-col gap-2">
        {error && (
          <div className="primary-action-hint primary-action-hint--error" role="alert">{error}</div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            minHeight: 72,
            borderRadius: 18,
            boxShadow: '0 8px 22px rgba(13,148,136,0.28)',
          }}
        >
          {loading
            ? 'Enregistrement…'
            : isIntermediate
              ? '✓ Valider et reprendre la tournée'
              : '✓ Valider et voir le récap'}
        </button>
      </div>
    </div>
  );
}
