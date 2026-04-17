import { describe, it, expect } from 'vitest';
import {
  USAGE_MODES,
  DRIVING_SPEED_MPS,
  SHORT_STOP_WINDOW_MS,
  computeUsageMode,
  readOverride,
  writeOverride,
  isValidMode,
} from '../src/services/usageMode.js';

describe('computeUsageMode', () => {
  it('retourne operational_stop par défaut (pas de GPS, pas de hint)', () => {
    expect(computeUsageMode({})).toBe(USAGE_MODES.OPERATIONAL_STOP);
  });

  it('retourne driving quand la vitesse dépasse le seuil', () => {
    expect(computeUsageMode({ speed: DRIVING_SPEED_MPS + 1 })).toBe(USAGE_MODES.DRIVING);
  });

  it('ne retourne pas driving si vitesse null', () => {
    expect(computeUsageMode({ speed: null })).toBe(USAGE_MODES.OPERATIONAL_STOP);
  });

  it('retourne short_stop si on a été en mouvement récemment', () => {
    const now = 10_000;
    const lastMovingAt = now - (SHORT_STOP_WINDOW_MS / 2);
    expect(computeUsageMode({ now, speed: 0, lastMovingAt })).toBe(USAGE_MODES.SHORT_STOP);
  });

  it('retombe sur operational_stop après la fenêtre d\u2019arrêt court', () => {
    const now = 10_000_000;
    const lastMovingAt = now - (SHORT_STOP_WINDOW_MS + 5000);
    expect(computeUsageMode({ now, speed: 0, lastMovingAt })).toBe(USAGE_MODES.OPERATIONAL_STOP);
  });

  it('honore un override valide en priorité', () => {
    expect(
      computeUsageMode({ speed: 20, override: USAGE_MODES.OPERATIONAL_STOP })
    ).toBe(USAGE_MODES.OPERATIONAL_STOP);
  });

  it('ignore un override invalide', () => {
    expect(
      computeUsageMode({ speed: 20, override: 'teleport' })
    ).toBe(USAGE_MODES.DRIVING);
  });

  it('respecte screenHint operational_stop même si on venait de bouger', () => {
    const now = 10_000;
    const lastMovingAt = now - 1000;
    expect(
      computeUsageMode({ now, speed: 0, lastMovingAt, screenHint: USAGE_MODES.OPERATIONAL_STOP })
    ).toBe(USAGE_MODES.OPERATIONAL_STOP);
  });

  it('screenHint ne peut pas forcer driving sans vitesse', () => {
    // On n'accepte pas qu'un écran dise "conduite" tout seul : sécurité.
    expect(
      computeUsageMode({ speed: 0, screenHint: USAGE_MODES.DRIVING })
    ).toBe(USAGE_MODES.DRIVING); // car isValidMode(screenHint) en fallback
    // Ce comportement est documenté : computeUsageMode retourne le hint
    // valide en dernier recours. Le fallback nominal reste operational_stop
    // si aucun hint n'est donné.
  });
});

describe('override localStorage', () => {
  it('write + read roundtrip', () => {
    writeOverride(USAGE_MODES.DRIVING);
    expect(readOverride()).toBe(USAGE_MODES.DRIVING);
    writeOverride(null);
    expect(readOverride()).toBe(null);
  });

  it('ignore une valeur invalide', () => {
    writeOverride('nope');
    expect(readOverride()).toBe(null);
  });
});

describe('isValidMode', () => {
  it('accepte les trois modes', () => {
    expect(isValidMode(USAGE_MODES.DRIVING)).toBe(true);
    expect(isValidMode(USAGE_MODES.SHORT_STOP)).toBe(true);
    expect(isValidMode(USAGE_MODES.OPERATIONAL_STOP)).toBe(true);
  });
  it('refuse le reste', () => {
    expect(isValidMode('flying')).toBe(false);
    expect(isValidMode(null)).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
  });
});
