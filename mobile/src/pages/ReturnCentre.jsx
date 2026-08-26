import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MobileShell, { TourStepBar } from '../components/MobileShell';
import { authedFetch } from '../services/authedFetch';

export default function ReturnCentre() {
  const [kmEnd, setKmEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  // Rien n'a été collecté depuis la dernière pesée : le camion est vide, et lui
  // demander son poids n'a pas de sens. L'équipage saisissait alors 0, ce qui
  // inscrivait au rapport une pesée qui ne dit rien.
  // La pesée reste ATTEIGNABLE en second bouton : on ne l'impose plus, on ne
  // l'interdit jamais — c'est l'équipage qui est devant le camion, pas nous.
  const peseeAttendue = localStorage.getItem('pesee_attendue') !== '0';

  const [erreur, setErreur] = useState('');

  const terminer = async (versPesee) => {
    setLoading(true);
    setErreur('');
    try {
      // C'est la pesée finale qui clôture normalement la tournée (sync.js).
      // Quand il n'y a rien à peser, la clôture doit donc se faire ICI, sinon la
      // tournée resterait éternellement « en retour au centre » — et sans elle,
      // ni tonnage, ni mouvement de stock, ni apprentissage du moteur.
      const res = await authedFetch(`/api/tours/${tourId}/status-public`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: versPesee ? 'returning' : 'completed',
          km_end: parseInt(kmEnd, 10) || 0,
          notes,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      localStorage.removeItem('pesee_attendue');
      navigate(versPesee ? '/weigh-in' : '/tour-summary');
    } catch (err) {
      // Avant, l'erreur était avalée et l'écran avançait quand même : le
      // chauffeur croyait sa tournée enregistrée alors qu'elle ne l'était pas.
      console.error(err);
      setErreur("Enregistrement impossible. Vérifiez la connexion, puis réessayez — n'avancez pas tant que ce message est affiché.");
    }
    setLoading(false);
  };

  return (
    <MobileShell
      title="Retour au centre"
      subtitle="Centre de tri — Solidarité Textiles"
      onBack={() => navigate('/tour-map')}
      usageHint="operational_stop"
      footer={
        <div className="primary-action-bar" style={{ display: 'grid', gap: 10 }}>
          <button
            type="button"
            onClick={() => terminer(peseeAttendue)}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-50"
            style={{ minHeight: 72, borderRadius: 18, boxShadow: '0 8px 22px rgba(13,148,136,0.28)' }}
          >
            {loading ? 'Enregistrement…' : (peseeAttendue ? '→ Passer à la pesée' : '→ Terminer la tournée')}
          </button>
          {!peseeAttendue && (
            <button
              type="button"
              onClick={() => terminer(true)}
              disabled={loading}
              className="w-full font-bold text-base text-[var(--color-primary)] bg-white active:scale-[0.98] transition-transform disabled:opacity-50"
              style={{ minHeight: 56, borderRadius: 16, border: '2px solid var(--color-primary)' }}
            >
              J'ai quand même du textile à peser
            </button>
          )}
        </div>
      }
    >
      <div className="mb-4">
        <TourStepBar currentPath="/return-centre" />
      </div>
      {erreur && (
        <div
          role="alert"
          className="mb-4 rounded-2xl px-4 py-3 text-base font-bold"
          style={{ background: '#FEE2E2', border: '2px solid #FCA5A5', color: '#991B1B' }}
        >
          {erreur}
        </div>
      )}
      <div className="space-y-4">
        <div
          className="text-center"
          style={{
            background: 'linear-gradient(180deg, #F0FDFA 0%, #CCFBF1 100%)',
            border: '1px solid #99F6E4',
            borderRadius: 20,
            padding: '24px 16px',
          }}
        >
          <p className="text-4xl mb-2">🏭</p>
          <p className="font-extrabold text-teal-900 text-lg">Vous êtes de retour au centre</p>
          <p className="text-sm text-teal-700 mt-1">
            Indiquez le kilométrage puis passez à la pesée.
          </p>
        </div>
        <div
          className="bg-white"
          style={{ borderRadius: 20, padding: 16, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Kilométrage arrivée</label>
          <input
            type="number"
            inputMode="numeric"
            value={kmEnd}
            onChange={e => setKmEnd(e.target.value)}
            placeholder="Ex. 45280"
            className="input-mobile"
          />
        </div>
        <div
          className="bg-white"
          style={{ borderRadius: 20, padding: 16, border: '1px solid #E2E8F0' }}
        >
          <label className="block text-sm font-semibold text-gray-700 mb-2">Remarques</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Commentaires sur la tournée…"
            className="input-mobile min-h-[80px]"
            rows={2}
          />
        </div>
      </div>
    </MobileShell>
  );
}
