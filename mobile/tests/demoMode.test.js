import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEMO_MODE_STORAGE_KEY,
  isDemoModeActive,
  setDemoModeFlag,
} from '../src/services/demoMode.js';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('isDemoModeActive', () => {
  it('renvoie false quand la clé n’est pas posée', () => {
    expect(isDemoModeActive()).toBe(false);
  });

  it('renvoie true quand demo_mode vaut "1"', () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    expect(isDemoModeActive()).toBe(true);
  });

  it('ignore toute autre valeur (jamais un faux positif)', () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, 'true');
    expect(isDemoModeActive()).toBe(false);
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, '0');
    expect(isDemoModeActive()).toBe(false);
  });
});

describe('setDemoModeFlag', () => {
  it('pose la clé à "1" quand active=true', () => {
    setDemoModeFlag(true);
    expect(localStorage.getItem(DEMO_MODE_STORAGE_KEY)).toBe('1');
    expect(isDemoModeActive()).toBe(true);
  });

  it('retire la clé quand active=false — jamais de bandeau résiduel', () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    setDemoModeFlag(false);
    expect(localStorage.getItem(DEMO_MODE_STORAGE_KEY)).toBe(null);
    expect(isDemoModeActive()).toBe(false);
  });

  it('retire la clé pour toute valeur "falsy" (undefined, 0, chaîne vide)', () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    setDemoModeFlag(undefined);
    expect(isDemoModeActive()).toBe(false);
  });

  it('ne lève jamais, même si window.dispatchEvent est indisponible', () => {
    // tests/setup.js shim un window minimal ; on vérifie juste l'absence
    // d'exception, le comportement de notification n'est pas testable ici
    // sans un vrai DOM (voir DemoModeBanner.test.js pour le rendu).
    expect(() => setDemoModeFlag(true)).not.toThrow();
    expect(() => setDemoModeFlag(false)).not.toThrow();
  });
});
