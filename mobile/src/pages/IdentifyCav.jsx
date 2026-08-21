import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { vibrateSuccess, vibrateError } from '../services/haptic';
import PrimaryActionBar from '../components/PrimaryActionBar';
import { authedFetch } from '../services/authedFetch';
import { getCurrentPosition, distanceMeters } from '../services/geo';
import { isDemoModeActive } from '../services/demoMode';

// Sécurité anti-fraude : impossible de valider un point sans être physiquement
// à proximité du CAV concerné (scan QR, sélection dans la liste, ou code
// manuel — les 3 chemins revendiquent la même présence).
const MAX_SCAN_DISTANCE_M = 50;

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
  const [proximityError, setProximityError] = useState('');
  const [checkingProximity, setCheckingProximity] = useState(false);
  const scannerRef = useRef(null);
  const startingRef = useRef(false);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const expectedCavId = localStorage.getItem('selected_cav_id');

  // Vérifie que l'appareil est à moins de MAX_SCAN_DISTANCE_M du CAV visé.
  // Fail-open si la géolocalisation est indisponible/refusée/expirée : on ne
  // bloque pas la collecte pour une contrainte technique du téléphone — le
  // but est d'empêcher une validation À DISTANCE, pas de rendre l'appli
  // inutilisable dès que le GPS est mauvais. Renvoie true si le passage est
  // autorisé (à proximité, coordonnées inconnues, ou géoloc indisponible).
  const ensureNearCav = async (cav) => {
    // MODE DÉMO (formations) : le stagiaire s'entraîne en salle, à des
    // kilomètres des vrais CAV du scénario. Le contrôle de présence n'a aucun
    // sens ici et rendrait l'exercice impossible — il est donc levé. La règle
    // reste ENTIÈRE sur les vraies tournées : le mode démo ne s'active que par
    // le lien du véhicule de formation, jamais sur un véhicule d'exploitation.
    if (isDemoModeActive()) return true;
    const lat = cav?.latitude, lng = cav?.longitude;
    if (lat == null || lng == null) return true; // CAV sans coordonnées connues
    setCheckingProximity(true);
    setProximityError('');
    try {
      const pos = await getCurrentPosition();
      const dist = distanceMeters(pos.lat, pos.lng, lat, lng);
      if (dist != null && dist > MAX_SCAN_DISTANCE_M) {
        vibrateError();
        setProximityError(
          `Trop loin du CAV (≈ ${Math.round(dist)} m, ${MAX_SCAN_DISTANCE_M} m max). Rapproche-toi puis réessaie.`
        );
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[IdentifyCav] géolocalisation indisponible', err);
      return true;
    } finally {
      setCheckingProximity(false);
    }
  };

  useEffect(() => {
    if (tourId) loadTourCavs();
  }, [tourId]);

  useEffect(() => {
    if (phase === 'scan') startScanner();
    return () => stopScanner();
  }, [phase]);

  const loadTourCavs = async () => {
    try {
      const res = await authedFetch(`/api/tours/${tourId}/public`);
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

  const handleScanSuccess = async (decodedText) => {
    if (checkingProximity) return; // vérification déjà en cours pour un scan précédent
    // Pause immédiate : évite que le scanner ne redéclenche ce handler en
    // boucle sur le même code pendant qu'on interroge le GPS.
    try { scannerRef.current?.pause(true); } catch { /* noop */ }
    const near = await ensureNearCav(expectedCav);
    if (!near) {
      try { scannerRef.current?.resume(); } catch { /* noop */ }
      return;
    }
    vibrateSuccess();
    localStorage.setItem('scanned_qr', decodedText);
    localStorage.removeItem('qr_unavailable_reason');
    stopScanner();
    navigate('/fill-level');
  };

  const confirmCav = async (cav) => {
    if (!cav || checkingProximity) return;
    const near = await ensureNearCav(cav);
    if (!near) return;
    const cavId = cav.cav_id || cav.id;
    localStorage.setItem('selected_cav_id', String(cavId));
    localStorage.setItem('selected_cav_name', cav.nom || cav.cav_name || '');
    localStorage.setItem('scanned_qr', cav.qr_code_data || `CAV-${cavId}`);
    localStorage.setItem('qr_unavailable_reason', 'fallback');
    stopScanner();
    navigate('/fill-level');
  };

  const submitManualCode = async () => {
    const code = manualCode.trim();
    if (!code || checkingProximity) return;
    // Le code saisi n'identifie pas un CAV précis côté client : on vérifie la
    // proximité au CAV attendu (même hypothèse que resolveCurrentCav côté
    // FillLevel — c'est le point que ce parcours de collecte adresse).
    const near = await ensureNearCav(expectedCav);
    if (!near) return;
    localStorage.setItem('scanned_qr', code);
    localStorage.setItem('qr_unavailable_reason', 'manual');
    stopScanner();
    navigate('/fill-level');
  };

  const otherCavs = tourCavs.filter(c => (c.cav_id || c.id) !== (expectedCav?.cav_id || expectedCav?.id));

  if (phase === 'scan') {
    return (
      <div className="min-h-screen flex flex-col bg-black text-white overflow-hidden">
        <header
          className="flex-shrink-0 flex items-center justify-between gap-3"
          style={{ padding: '50px 14px 14px' }}
        >
          <button
            type="button"
            aria-label="Retour à la carte"
            onClick={() => { stopScanner(); navigate('/tour-map'); }}
            className="touch-target flex items-center justify-center text-white/90 text-base font-medium px-3"
            style={{
              borderRadius: 14,
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
            }}
          >
            ← Carte
          </button>
          <div className="text-center">
            <p className="text-[11px] uppercase tracking-widest opacity-70 font-bold">
              {expectedCav ? (expectedCav.commune || 'Point en cours') : 'Identifier le CAV'}
            </p>
            <p className="text-base font-bold">
              {expectedCav?.nom || expectedCav?.cav_name || 'Scan QR'}
            </p>
          </div>
          <div className="touch-target w-[72px]" aria-hidden="true" />
        </header>

        <div className="px-6 pb-2 text-center">
          <h1 className="text-2xl font-extrabold">Scanne la CAV</h1>
          <p className="text-sm text-white/70 mt-1">Approche le QR code du conteneur</p>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-5">
          {cameraError ? (
            <div className="text-center max-w-sm">
              <p className="text-red-300 mb-6 text-sm">{cameraError}</p>
              <button type="button" onClick={() => setPhase('fallback')} className="btn-primary-mobile py-3.5">
                Choisir dans la liste
              </button>
            </div>
          ) : (
            <>
              <div
                className="relative overflow-hidden"
                style={{
                  width: 250,
                  height: 250,
                  borderRadius: 28,
                  background: 'rgba(255,255,255,0.04)',
                  border: '3px solid rgba(255,255,255,0.25)',
                }}
              >
                <div id="qr-reader" className="w-full h-full" />

                {/* Corner brackets */}
                {['tl', 'tr', 'bl', 'br'].map(pos => {
                  const base = {
                    position: 'absolute',
                    width: 34,
                    height: 34,
                    borderColor: 'var(--color-primary-light, #14B8A6)',
                    borderStyle: 'solid',
                    borderWidth: 0,
                    pointerEvents: 'none',
                  };
                  if (pos === 'tl') Object.assign(base, { top: -3, left: -3, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 });
                  if (pos === 'tr') Object.assign(base, { top: -3, right: -3, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 16 });
                  if (pos === 'bl') Object.assign(base, { bottom: -3, left: -3, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 16 });
                  if (pos === 'br') Object.assign(base, { bottom: -3, right: -3, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 16 });
                  return <div key={pos} style={base} />;
                })}

                {/* Animated scan line */}
                <div
                  className="animate-scan-line pointer-events-none"
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 20,
                    right: 20,
                    height: 2,
                    background: 'var(--color-primary-light, #14B8A6)',
                    boxShadow: '0 0 18px rgba(20,184,166,0.8)',
                    borderRadius: 2,
                  }}
                />
              </div>

              <p className="text-white/60 text-sm mt-6">
                {checkingProximity ? 'Vérification de la position…' : 'Cherche le QR code…'}
              </p>
              {expectedCav && (
                <p className="text-white/80 text-sm mt-1 font-medium">
                  Attendu : {expectedCav.nom || expectedCav.cav_name}
                </p>
              )}
              {proximityError && (
                <div
                  className="mt-4 text-sm font-semibold text-center"
                  style={{
                    maxWidth: 300,
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: 'rgba(220,38,38,0.2)',
                    border: '1px solid rgba(220,38,38,0.4)',
                    color: '#FCA5A5',
                  }}
                  role="alert"
                >
                  {proximityError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Fallback actions */}
        <div
          className="flex-shrink-0 flex flex-col gap-2.5"
          style={{ padding: '14px 16px calc(var(--safe-bottom) + 16px)' }}
        >
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setPhase('fallback')}
              className="flex-1 font-semibold text-sm"
              style={{
                minHeight: 56,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: 'white',
              }}
            >
              ⌨ Saisir le code
            </button>
            <button
              type="button"
              onClick={() => setPhase('fallback')}
              className="flex-1 font-semibold text-sm"
              style={{
                minHeight: 56,
                borderRadius: 14,
                background: 'rgba(220,38,38,0.2)',
                border: '1px solid rgba(220,38,38,0.4)',
                color: '#FCA5A5',
              }}
            >
              ⚠ QR indisponible
            </button>
          </div>
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
        {proximityError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 font-medium" role="alert">
            {proximityError}
          </div>
        )}
        {checkingProximity && (
          <p className="text-sm text-gray-500 font-medium">Vérification de la position…</p>
        )}

        {expectedCav && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Attendu ici</p>
            <button
              type="button"
              onClick={() => confirmCav(expectedCav)}
              disabled={checkingProximity}
              className="w-full card-mobile p-4 flex items-center gap-3 ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5 text-left disabled:opacity-50"
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
                  disabled={checkingProximity}
                  className="w-full card-mobile p-3 text-left flex items-center gap-3 disabled:opacity-50"
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
