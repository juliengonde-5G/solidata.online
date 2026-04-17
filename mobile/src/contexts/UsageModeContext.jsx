import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  USAGE_MODES,
  DRIVING_SPEED_MPS,
  computeUsageMode,
  readOverride,
  writeOverride,
  isValidMode,
} from '../services/usageMode';

const UsageModeContext = createContext(null);

/**
 * Provider global du mode d'usage.
 * - Consomme les échantillons GPS via reportGpsSample (appelé depuis TourMap).
 * - Expose un screenHint modifiable par chaque écran (via MobileShell usageHint).
 * - Persiste l'override manuel dans localStorage pour les tests en dev.
 */
export function UsageModeProvider({ children }) {
  const [speed, setSpeed] = useState(null);
  const [screenHint, setScreenHintState] = useState(null);
  const [override, setOverrideState] = useState(() => readOverride());
  const [tick, setTick] = useState(0);
  const lastMovingAtRef = useRef(null);

  // Tick périodique pour faire évoluer short_stop → operational_stop
  // sans nouvel échantillon GPS.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const reportGpsSample = useCallback((sample) => {
    if (!sample) return;
    const raw = sample.speed;
    const s = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
    setSpeed(s);
    if (s !== null && s >= DRIVING_SPEED_MPS) {
      lastMovingAtRef.current = sample.timestamp || Date.now();
    }
  }, []);

  const setScreenHint = useCallback((hint) => {
    setScreenHintState(isValidMode(hint) ? hint : null);
  }, []);

  const setOverride = useCallback((mode) => {
    writeOverride(mode);
    setOverrideState(isValidMode(mode) ? mode : null);
  }, []);

  const mode = useMemo(
    () => computeUsageMode({
      now: Date.now(),
      speed,
      lastMovingAt: lastMovingAtRef.current,
      screenHint,
      override,
    }),
    // tick force la recomputation périodique ; lastMovingAtRef est une ref,
    // mais elle n'est lue qu'au moment du compute.
    [speed, screenHint, override, tick],
  );

  const value = useMemo(
    () => ({ mode, speed, override, setOverride, setScreenHint, reportGpsSample }),
    [mode, speed, override, setOverride, setScreenHint, reportGpsSample],
  );

  return <UsageModeContext.Provider value={value}>{children}</UsageModeContext.Provider>;
}

/**
 * Hook d'accès au mode d'usage.
 * Hors provider (ex. tests isolés), renvoie operational_stop par défaut.
 */
export function useUsageMode() {
  const ctx = useContext(UsageModeContext);
  if (!ctx) {
    return {
      mode: USAGE_MODES.OPERATIONAL_STOP,
      speed: null,
      override: null,
      setOverride: () => {},
      setScreenHint: () => {},
      reportGpsSample: () => {},
    };
  }
  return ctx;
}

export { USAGE_MODES };
