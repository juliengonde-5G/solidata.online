import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateSuccess, vibrateError, vibrateTap } from '../services/haptic';
import StepConfirmScreen from '../components/StepConfirmScreen';
import { addPendingEndOfDay, deleteItem, STORES } from '../services/db';
import { sendEndOfDay, getPendingCount } from '../services/sync';

// 3 sections × 2 déclarations, dans l'ordre exact demandé. `key` = champ
// stocké (voir services/db.js addPendingEndOfDay et le backend
// end-of-day-public), `label` = texte affiché tel quel.
const SECTIONS = [
  {
    title: 'Le chauffeur',
    items: [
      { key: 'chauffeurNonFume', label: "Je n'ai pas fumé dans le véhicule" },
      { key: 'chauffeurPasObjetPersonnel', label: "Je n'ai pas laissé d'objet personnel dans le véhicule" },
    ],
  },
  {
    title: 'Le suiveur',
    items: [
      { key: 'suiveurNonFume', label: "Je n'ai pas fumé dans le véhicule" },
      { key: 'suiveurPasObjetPersonnel', label: "Je n'ai pas laissé d'objet personnel dans le véhicule" },
    ],
  },
  {
    title: 'Le binôme',
    items: [
      { key: 'binomeVehiculeVide', label: 'Le véhicule est vide' },
      { key: 'binomeVehiculeOk', label: 'Le véhicule est en bon état ou que les défauts ont été déclarés' },
    ],
  },
];
const ALL_KEYS = SECTIONS.flatMap((s) => s.items.map((i) => i.key));

export default function EndOfDayChecklist() {
  const [checked, setChecked] = useState({});
  const [remarques, setRemarques] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { status, pendingId }
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  const toggle = (key) => { vibrateTap(); setChecked((prev) => ({ ...prev, [key]: !prev[key] })); };
  const allChecked = ALL_KEYS.every((k) => checked[k]);
  const checkedCount = ALL_KEYS.filter((k) => checked[k]).length;

  const finishDay = () => {
    localStorage.removeItem('current_tour_id');
    navigate('/vehicle-select');
  };

  const submit = async () => {
    if (!allChecked) return;
    setLoading(true);
    setError('');
    try {
      const record = {
        tourId,
        chauffeurNonFume: true,
        chauffeurPasObjetPersonnel: true,
        suiveurNonFume: true,
        suiveurPasObjetPersonnel: true,
        binomeVehiculeVide: true,
        binomeVehiculeOk: true,
        remarques: remarques.trim() || null,
      };
      const pendingId = await addPendingEndOfDay(record);

      let status = 'pending';
      if (navigator.onLine) {
        try {
          await sendEndOfDay(record);
          await deleteItem(STORES.pendingEndOfDay, pendingId);
          status = 'sent';
        } catch (e) {
          if (e?.response?.status >= 400 && e?.response?.status < 500) {
            await deleteItem(STORES.pendingEndOfDay, pendingId);
            status = 'retry';
          } else {
            status = 'pending';
          }
        }
      }

      await getPendingCount();
      vibrateSuccess();
      setConfirm({ status });
    } catch (err) {
      vibrateError();
      setError(err.message || 'Erreur, réessayez');
      console.error('[EndOfDayChecklist] submit', err);
    }
    setLoading(false);
  };

  if (confirm) {
    return (
      <StepConfirmScreen
        title="Déclarations enregistrées"
        status={confirm.status}
        summaryLines={remarques.trim() ? [{ label: 'Remarques', value: remarques.trim() }] : []}
        primaryLabel="Terminer la journée"
        onPrimary={finishDay}
        onAutoReturn={finishDay}
        autoReturnMs={8000}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-2)]">
      <header
        className="text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          padding: 'calc(var(--safe-top) + 20px) 20px 20px',
        }}
      >
        <p className="text-[11px] uppercase tracking-widest font-bold opacity-85">Fin de journée</p>
        <h1 className="font-extrabold text-xl leading-tight">Déclarations avant de partir</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 space-y-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="card-mobile p-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-bold mb-3">
              {section.title}
            </p>
            <div className="space-y-2">
              {section.items.map((item) => {
                const active = !!checked[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggle(item.key)}
                    aria-pressed={active}
                    className="w-full flex items-center gap-3 text-left bg-white active:scale-[0.99] transition-transform"
                    style={{
                      minHeight: 56,
                      padding: '12px 14px',
                      borderRadius: 14,
                      border: active ? '2px solid var(--color-primary)' : '2px solid #E2E8F0',
                      background: active ? 'var(--color-primary-surface, #F0FDFA)' : 'white',
                    }}
                  >
                    <span
                      className="flex items-center justify-center flex-shrink-0"
                      style={{
                        width: 26, height: 26, borderRadius: 8,
                        border: active ? 'none' : '2px solid #CBD5E1',
                        background: active ? 'var(--color-primary)' : 'white',
                        color: 'white', fontSize: 16, fontWeight: 900,
                      }}
                      aria-hidden="true"
                    >
                      {active ? '✓' : ''}
                    </span>
                    <span className="flex-1 font-semibold text-[14px] text-gray-800">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="card-mobile p-4 space-y-2">
          <label className="block text-sm font-semibold text-gray-700">Remarques / Commentaires</label>
          <textarea
            value={remarques}
            onChange={(e) => setRemarques(e.target.value)}
            placeholder="Optionnel…"
            className="input-mobile min-h-[80px]"
            rows={3}
          />
        </div>

        <p className="text-center text-xs text-gray-400">{checkedCount}/{ALL_KEYS.length} déclarations cochées</p>
      </div>

      <div className="primary-action-bar flex flex-col gap-2">
        {error && (
          <div className="primary-action-hint primary-action-hint--error" role="alert">{error}</div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!allChecked || loading}
          className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            minHeight: 72,
            borderRadius: 18,
            boxShadow: '0 8px 22px rgba(13,148,136,0.28)',
          }}
        >
          {loading ? 'Enregistrement…' : '✓ Valider les déclarations'}
        </button>
      </div>
    </div>
  );
}
