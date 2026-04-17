import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibrateSuccess, vibrateError, vibrateTap } from '../services/haptic';
import MobileShell from '../components/MobileShell';
import PrimaryActionBar from '../components/PrimaryActionBar';

// 5 niveaux métier conservés. Libellés courts, emoji pour lecture rapide.
const FILL_LEVELS = [
  { value: 0, label: 'Vide', pct: '0%', color: 'bg-gray-200', fg: 'text-gray-600' },
  { value: 1, label: '¼', pct: '25%', color: 'bg-blue-100', fg: 'text-blue-700' },
  { value: 2, label: '½', pct: '50%', color: 'bg-amber-100', fg: 'text-amber-700' },
  { value: 3, label: '¾', pct: '75%', color: 'bg-orange-100', fg: 'text-orange-700' },
  { value: 4, label: 'Plein', pct: '100%', color: 'bg-red-100', fg: 'text-red-700' },
];

// Anomalies fréquentes (affichées d'emblée) vs autres (derrière bouton).
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

export default function FillLevel() {
  const [fillLevel, setFillLevel] = useState(null);
  const [anomaly, setAnomaly] = useState('');
  const [showOtherAnomalies, setShowOtherAnomalies] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const scannedQR = localStorage.getItem('scanned_qr');

  const chooseLevel = (v) => {
    vibrateTap();
    setFillLevel(v);
  };

  const toggleAnomaly = (value) => {
    vibrateTap();
    setAnomaly(prev => (prev === value ? '' : value));
  };

  const submit = async () => {
    if (fillLevel === null) return;
    setLoading(true);
    setError('');
    try {
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
      if (!cav) {
        cav = cavs.find(c => c.status !== 'collected');
      }

      if (cav) {
        const cavId = cav.cav_id || cav.id;
        const collectRes = await fetch(`/api/tours/${tourId}/cav/${cavId}/collect-public`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'collected',
            fill_level: fillLevel,
            qr_scanned: !tourIsAssociation,
            notes: anomaly ? `${anomaly}${notes ? ': ' + notes : ''}` : notes,
          }),
        });
        if (!collectRes.ok) throw new Error('Erreur lors de l\'enregistrement');
      }
      vibrateSuccess();
      localStorage.removeItem('scanned_qr');
      localStorage.removeItem('selected_cav_id');
      localStorage.removeItem('qr_unavailable_reason');
      navigate('/tour-map');
    } catch (err) {
      vibrateError();
      setError(err.message || 'Erreur réseau, réessayez');
      console.error(err);
    }
    setLoading(false);
  };

  const selected = FILL_LEVELS.find(o => o.value === fillLevel);

  return (
    <MobileShell
      title="Remplissage"
      subtitle={scannedQR ? 'CAV identifié' : 'Niveau observé'}
      onBack={() => navigate('/tour-map')}
      usageHint="operational_stop"
      footer={
        <PrimaryActionBar
          primaryLabel="Valider la collecte"
          onPrimary={submit}
          loading={loading}
          disabled={fillLevel === null}
          error={error || null}
        />
      }
    >
      <div className="space-y-5">
        {/* 1. Niveau — gros boutons visuels, compatibles gants */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Niveau</p>
          <div className="grid grid-cols-5 gap-2">
            {FILL_LEVELS.map(level => {
              const active = fillLevel === level.value;
              return (
                <button
                  key={level.value}
                  type="button"
                  aria-label={`Remplissage ${level.pct}`}
                  aria-pressed={active}
                  onClick={() => chooseLevel(level.value)}
                  className={`flex flex-col items-center justify-center rounded-2xl border-2 transition-all min-h-[88px] px-1 ${
                    active
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 shadow-md'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${level.color} ${level.fg}`}>
                    {level.pct === '0%' ? '0' : level.pct === '100%' ? '100' : level.pct.replace('%', '')}
                  </span>
                  <span className="text-xs font-semibold text-gray-700 mt-1">{level.label}</span>
                </button>
              );
            })}
          </div>
          {selected && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-gray-500">Choisi</span>
              <span className="font-bold text-[var(--color-primary)]">{selected.pct} — {selected.label}</span>
            </div>
          )}
        </div>

        {/* 2. Anomalies fréquentes — cartes tactiles, plus de select */}
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

        {/* 3. Notes libres — repliées par défaut (pas de clavier dans le cas nominal) */}
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
