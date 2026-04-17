import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateSuccess, vibrateError } from '../services/haptic';
import MobileShell, { TourStepBar } from '../components/MobileShell';
import PrimaryActionBar from '../components/PrimaryActionBar';
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
            // Rejet 4xx → suppression pour éviter la boucle, l'utilisateur
            // verra le statut "à renvoyer" (incohérence à corriger manuellement).
            try { await deleteItem(STORES.pendingWeights, pendingId); } catch {}
            status = 'retry';
          } else {
            status = 'pending';
          }
        }
      }

      await getPendingCount();
      vibrateSuccess();
      // Nettoie le flag intermediate seulement APRES l'affichage de la
      // confirmation pour que l'écran suivant aille au bon endroit.
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

  return (
    <MobileShell
      usageHint="operational_stop"
      title={isIntermediate ? 'Pesée intermédiaire' : 'Pesée du véhicule'}
      subtitle={isIntermediate ? 'Déchargement partiel — pesez puis reprenez' : 'Enregistrez les données de pesée'}
      onBack={() => {
        if (isIntermediate) { localStorage.removeItem('intermediate_return'); navigate('/tour-map'); }
        else { navigate('/return-centre'); }
      }}
      footer={
        <PrimaryActionBar
          primaryLabel={isIntermediate ? 'Enregistrer et reprendre' : 'Valider la pesée'}
          onPrimary={submit}
          loading={loading}
          disabled={!grossWeight || !tareWeight}
          error={error || null}
          pendingOffline={!online}
        />
      }
    >
      <div className="mb-4">
        <TourStepBar currentPath="/weigh-in" />
      </div>
      <div className="space-y-4">
        <div className="card-mobile p-6 text-center">
          <p className="text-4xl mb-2">⚖️</p>
          <p className="text-gray-600 text-sm">Poids brut − Tare = Poids net collecté</p>
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Poids brut (kg)</label>
          <input
            type="number"
            inputMode="decimal"
            value={grossWeight}
            onChange={e => setGrossWeight(e.target.value)}
            placeholder="Véhicule chargé"
            className="input-mobile text-center text-lg font-semibold"
          />
        </div>
        <div className="card-mobile p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Tare véhicule (kg)</label>
          <input
            type="number"
            inputMode="decimal"
            value={tareWeight}
            onChange={e => setTareWeight(e.target.value)}
            placeholder="Véhicule à vide"
            className="input-mobile text-center text-lg font-semibold"
          />
        </div>
        <div className="card-mobile p-6 text-center bg-[var(--color-primary)]/10 border-2 border-[var(--color-primary)]/30 rounded-2xl">
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Poids net collecté</p>
          <p className="text-4xl font-black text-[var(--color-primary)]">{netWeight.toFixed(0)}</p>
          <p className="text-sm text-gray-500">kg ({(netWeight / 1000).toFixed(2)} t)</p>
        </div>
        {!online && (
          <div className="flex items-center justify-center">
            <OfflineActionBadge status="pending" label="Hors ligne — sera envoyé" />
          </div>
        )}
      </div>
    </MobileShell>
  );
}
