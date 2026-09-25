import { describe, it, expect } from 'vitest';
import { lienGuidage } from '../src/services/geo';

describe('lienGuidage — guidage vers le centre de tri', () => {
  it('construit le lien Google Maps depuis les coordonnées renvoyées par le serveur', () => {
    expect(lienGuidage({ latitude: 49.4231, longitude: 1.0993 }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=49.4231,1.0993&travelmode=driving');
  });
  it('accepte des coordonnées en chaîne (NUMERIC PostgreSQL)', () => {
    expect(lienGuidage({ latitude: '49.4231', longitude: '1.0993' })).toContain('destination=49.4231,1.0993');
  });
  it("ne lance aucun guidage sans destination exploitable", () => {
    expect(lienGuidage(null)).toBeNull();
    expect(lienGuidage(undefined)).toBeNull();
    expect(lienGuidage({ latitude: null, longitude: 1 })).toBeNull();
    expect(lienGuidage({ latitude: '', longitude: '' })).toBeNull();
    expect(lienGuidage({ latitude: 'abc', longitude: 1 })).toBeNull();
  });
  it('(0, 0) est une valeur par défaut, pas une position', () => {
    expect(lienGuidage({ latitude: 0, longitude: 0 })).toBeNull();
  });
});
