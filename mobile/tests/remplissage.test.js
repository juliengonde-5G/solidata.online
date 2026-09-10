// Le remplissage tel qu'on le REND au chauffeur dans son historique de journée.
//
// Défaut corrigé (10/09/2026) : « au-delà » — la borne débordait — s'affichait
// « 4/4 », c'est-à-dire exactement comme une borne pleine. L'échelle 0-4 ne
// sait pas porter le débordement ; le pourcentage, si.
import { describe, it, expect } from 'vitest';
import { FILL_LEVELS, libelleRemplissage, POURCENTAGE_DEBORDEMENT } from '../src/services/remplissage';

describe('libelleRemplissage', () => {
  it('nomme le débordement au lieu de le confondre avec le plein', () => {
    expect(libelleRemplissage(4, POURCENTAGE_DEBORDEMENT)).toMatch(/au-delà/);
    expect(libelleRemplissage(4, 100)).toBe('plein (100%)');
    expect(libelleRemplissage(4, POURCENTAGE_DEBORDEMENT))
      .not.toBe(libelleRemplissage(4, 100));
  });

  it('distingue « un fond » de « vide », que l’échelle confond (fill_level 0)', () => {
    expect(libelleRemplissage(0, 10)).toBe('un fond (10%)');
    expect(libelleRemplissage(0, 0)).toBe('vide (0%)');
  });

  it('sans pourcentage, retombe sur l’échelle — jamais sur le débordement', () => {
    expect(libelleRemplissage(4, null)).toBe('plein (100%)');
    expect(libelleRemplissage(2, undefined)).toBe('à moitié (50%)');
  });

  it('rien de déclaré → null (et surtout pas « vide »)', () => {
    expect(libelleRemplissage(null, null)).toBeNull();
    expect(libelleRemplissage(undefined, undefined)).toBeNull();
    expect(libelleRemplissage('', '')).toBeNull();
  });

  it('0 est une valeur, pas une absence', () => {
    expect(libelleRemplissage(0, 0)).not.toBeNull();
  });

  it('un pourcentage hors palier garde sa valeur', () => {
    expect(libelleRemplissage(3, 63)).toBe('63 %');
  });

  it('la table reste celle de la saisie : 7 paliers, un seul débordement', () => {
    expect(FILL_LEVELS).toHaveLength(7);
    expect(FILL_LEVELS.filter((l) => l.overflow)).toHaveLength(1);
  });
});
