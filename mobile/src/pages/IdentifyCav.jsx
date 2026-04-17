import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { vibrateSuccess } from '../services/haptic';
import PrimaryActionBar from '../components/PrimaryActionBar';

/**
 * Flux unifié d'identification d'un CAV :
 *   1) scan QR (caméra arrière) par défaut,
 *   2) bascule immédiate en fallback si erreur caméra ou refus utilisateur,
 *   3) fallback = sélection du CAV attendu / liste des restants / code manuel.
 *
 * Conserve la logique existante : scanned_qr, selected_cav_id,
 * qr_unavailable_reason en localStorage, navigation vers /fill-level.
 */
export default function IdentifyCav() {
  const [phase, setPhase] = useState('scan'); // 'scan' | 'fallback'
  const [cameraError, setCameraError] = useState('');
  const [tourCavs, setTourCavs] = useState([]);
  const [expectedCav, setExpectedCav] = useState(null);
  const [manualCode, setManualCode] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const scannerRef = useRef(null);
  const startingRef = useRef(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const expectedCavId = localStorage.getItem('selected_cav_id');

  useEffect(() => {
    if (tourId) loadTourCavs();
  }, [tourId]);

  useEffect(() => {
    if (phase === 'scan') startScanner();
    return () => stopScanner();
  }, [phase]);

  const loadTourCavs = async () => {
    try {
      const res = await fetch(`/api/tours/${tourId}/public`);
      const data = await res.json();
      const pending = (data.cavs || []).filter(c => c.status !== 'collected');
      setTourCavs(pending);
      const expected = pending.find(c => String(c.cav_id || c.id) === String(expectedCavId)) || pending[0] || null;
      setExpectedCav(expected);
    } catch (err) {
      console.error('[IdentifyCav] loadTourCavs', err);
    }
  };

  const startScanner = async () => {
    if (startingRef.current || scannerRef.current) return;
    startingRef.current = true;
    setCameraError('');
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleScanSuccess,
        () => {} // erreurs de frame ignorées
      );
    } catch (err) {
      console.warn('[IdentifyCav] camera unavailable', err);
      setCameraError('Camera indisponible — passage en saisie manuelle');
      scannerRef.current = null;
      setPhase('fallback');
    } finally {
      startingRef.current = false;
    }
  };

  const stopScanner = () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try {
      s.stop().catch(() => {});
    } catch {
      // noop
    }
  };

  const handleScanSuccess = (decodedText) => {
    vibrateSuccess();
    localStorage.setItem('scanned_qr', decodedText);
    localStorage.removeItem('qr_unavailable_reason');
    stopScanner();
    navigate('/fill-level');
  };

  const confirmCav = (cav) => {
    if (!cav) return;
    const cavId = cav.cav_id || cav.id;
    localStorage.setItem('selected_cav_id', String(cavId));
    localStorage.setItem('selected_cav_name', cav.nom || cav.cav_name || '');
    localStorage.setItem('scanned_qr', cav.qr_code_data || `CAV-${cavId}`);
    localStorage.setItem('qr_unavailable_reason', 'fallback');
    stopScanner();
    navigate('/fill-level');
  };

  const submitManualCode = () => {
    const code = manualCode.trim();
    if (!code) return;
    localStorage.setItem('scanned_qr', code);
    localStorage.setItem('qr_unavailable_reason', 'manual');
    stopScanner();
    navigate('/fill-level');
  };

  const otherCavs = tourCavs.filter(c => (c.cav_id || c.id) !== (expectedCav?.cav_id || expectedCav?.id));

  if (phase === 'scan') {
    return (
      <div className="min-h-screen flex flex-col bg-gray-900">
        <header className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-gray-900 text-white">
          <button
            type="button"
            aria-label="Retour à la carte"
            onClick={() => { stopScanner(); navigate('/tour-map'); }}
            className="touch-target flex items-center justify-center rounded-xl text-white/80 hover:bg-white/10 text-sm font-medium px-3"
          >
            ← Carte
          </button>
          <h1 className="font-bold text-base">Identifier le CAV</h1>
          <button
            type="button"
            aria-label="QR absent, passage en saisie manuelle"
            onClick={() => setPhase('fallback')}
            className="touch-target flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-sm font-medium px-4"
          >
            QR absent
          </button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          {cameraError ? (
            <div className="text-center max-w-sm">
              <p className="text-red-400 mb-6">{cameraError}</p>
              <button type="button" onClick={() => setPhase('fallback')} className="btn-primary-mobile py-3.5">
                Choisir dans la liste
              </button>
            </div>
          ) : (
            <>
              <div className="relative w-full max-w-sm aspect-square rounded-3xl overflow-hidden ring-4 ring-white/20">
                <div id="qr-reader" className="w-full h-full" />
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-56 h-56 border-4 border-[var(--color-primary)] rounded-2xl" />
                </div>
              </div>
              <p className="text-white/60 text-sm mt-6">Visez le QR code du conteneur</p>
              {expectedCav && (
                <p className="text-white/80 text-sm mt-2 font-medium">
                  Attendu : {expectedCav.nom || expectedCav.cav_name}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // phase === 'fallback'
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-2)]">
      <header className="screen-header flex-shrink-0 flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setPhase('scan')}
            className="touch-target flex items-center justify-center rounded-xl text-white/90 hover:bg-white/10 active:bg-white/20 -ml-1"
            aria-label="Retour au scanner"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="font-bold text-lg truncate">Identifier le CAV</h1>
            <p className="text-white/80 text-sm truncate">Choisissez dans la liste</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 space-y-4">
        {expectedCav && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Attendu ici</p>
            <button
              type="button"
              onClick={() => confirmCav(expectedCav)}
              className="w-full card-mobile p-4 flex items-center gap-3 ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5 text-left"
            >
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-gray-900 truncate">{expectedCav.nom || expectedCav.cav_name}</span>
                {expectedCav.commune && (
                  <span className="block text-sm text-gray-500 truncate">{expectedCav.commune}</span>
                )}
              </span>
              <span className="touch-target flex items-center justify-center rounded-xl bg-[var(--color-primary)] text-white px-4 font-semibold">
                C'est lui
              </span>
            </button>
          </div>
        )}

        {otherCavs.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Autres CAV restants</p>
            <div className="space-y-1.5">
              {otherCavs.map((cav) => (
                <button
                  key={cav.cav_id || cav.id}
                  type="button"
                  onClick={() => confirmCav(cav)}
                  className="w-full card-mobile p-3 text-left flex items-center gap-3"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-gray-800 truncate">{cav.nom || cav.cav_name}</span>
                    {cav.commune && (
                      <span className="block text-xs text-gray-400 truncate">{cav.commune}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setManualOpen(v => !v)}
            className="text-sm font-medium text-[var(--color-primary)] underline"
          >
            {manualOpen ? 'Masquer la saisie manuelle' : 'Saisir un code manuel'}
          </button>
          {manualOpen && (
            <div className="card-mobile p-4 mt-2 space-y-3">
              <label className="block text-sm font-medium text-gray-700">Code du conteneur</label>
              <input
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                placeholder="Ex : CAV-00123"
                className="input-mobile"
              />
              <button
                type="button"
                onClick={submitManualCode}
                disabled={!manualCode.trim()}
                className="btn-secondary-mobile py-3 disabled:opacity-50"
              >
                Utiliser ce code
              </button>
            </div>
          )}
        </div>
      </div>

      <PrimaryActionBar
        primaryLabel="Retour au scanner"
        onPrimary={() => setPhase('scan')}
      />
    </div>
  );
}
