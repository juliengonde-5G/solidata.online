// Le nom d'un point porte la commune en préfixe ; sur un téléphone, la rue —
// seule information utile au chauffeur — disparaissait dans la troncature.
import { describe, test, expect } from 'vitest';
import { retirerPrefixeCommune, libellePoint } from '../src/services/pointLabel';

describe('retirerPrefixeCommune', () => {
  test('retire la commune et son séparateur', () => {
    expect(retirerPrefixeCommune('ELBEUF - 26 Rue Leveillé', 'ELBEUF'))
      .toBe('26 Rue Leveillé');
  });

  test('une commune à tirets n\'est pas coupée au premier tiret venu', () => {
    // Le cas qui casserait une découpe naïve : « CAUDEBEC-LÈS-ELBEUF ».
    expect(retirerPrefixeCommune(
      'CAUDEBEC-LÈS-ELBEUF - 67 Rue de Strasbourg (Place de l\'Assemblée)',
      'CAUDEBEC-LÈS-ELBEUF',
    )).toBe('67 Rue de Strasbourg (Place de l\'Assemblée)');
  });

  test('casse et accents ne bloquent pas la reconnaissance', () => {
    expect(retirerPrefixeCommune('Caudebec-lès-Elbeuf – 856 Rue Emile Zola', 'CAUDEBEC-LES-ELBEUF'))
      .toBe('856 Rue Emile Zola');
  });

  test('un nom qui ne commence pas par la commune reste intact', () => {
    expect(retirerPrefixeCommune('Parking Leader Price', 'SAINT-PIERRE-LÈS-ELBEUF'))
      .toBe('Parking Leader Price');
  });

  test('un nom réduit à la commune est conservé — rien à isoler', () => {
    expect(retirerPrefixeCommune('ELBEUF', 'ELBEUF')).toBe('ELBEUF');
    expect(retirerPrefixeCommune('ELBEUF -', 'ELBEUF')).toBe('ELBEUF -');
  });

  test('sans commune connue, on ne coupe rien', () => {
    expect(retirerPrefixeCommune('ELBEUF - 26 Rue Leveillé', '')).toBe('ELBEUF - 26 Rue Leveillé');
    expect(retirerPrefixeCommune('ELBEUF - 26 Rue Leveillé', null)).toBe('ELBEUF - 26 Rue Leveillé');
  });

  test('valeurs absentes : jamais d\'exception', () => {
    expect(retirerPrefixeCommune(null, 'ELBEUF')).toBe('');
    expect(retirerPrefixeCommune(undefined, undefined)).toBe('');
  });
});

describe('libellePoint', () => {
  test('titre = la rue, sous-titre = la commune', () => {
    const r = libellePoint({
      cav_name: 'CAUDEBEC-LÈS-ELBEUF - 67 Rue de Strasbourg',
      commune: 'CAUDEBEC-LÈS-ELBEUF',
    });
    expect(r.titre).toBe('67 Rue de Strasbourg');
    expect(r.sousTitre).toBe('CAUDEBEC-LÈS-ELBEUF');
  });

  test('une adresse qui répète le titre n\'est pas ajoutée deux fois', () => {
    const r = libellePoint({
      cav_name: 'ELBEUF - 26 Rue Leveillé',
      commune: 'ELBEUF',
      address: '26 Rue Leveillé',
    });
    expect(r.sousTitre).toBe('ELBEUF');
  });

  test('une adresse qui complète le titre est affichée', () => {
    const r = libellePoint({
      cav_name: 'ELBEUF - Carrefour Market',
      commune: 'ELBEUF',
      address: '7 Rue du Neubourg',
    });
    expect(r.titre).toBe('Carrefour Market');
    expect(r.sousTitre).toBe('ELBEUF · 7 Rue du Neubourg');
  });

  test('point vide : aucun sous-titre inventé', () => {
    expect(libellePoint({})).toEqual({ titre: '', sousTitre: null });
  });
});
