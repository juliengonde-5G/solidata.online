// Arrivée déclarée chez une association — la mémoire locale du geste.
//
// Une association n'a pas de QR code : le seul témoin du passage est
// l'équipage. Ce qui est mesuré ici — l'écart entre l'arrivée et le départ —
// sert à corriger les durées d'arrêt estimées et à juger les rendez-vous. Une
// erreur de quelques minutes n'est donc pas cosmétique : elle se propage aux
// tournées suivantes.
import { describe, test, expect, beforeEach } from 'vitest';
import {
  clefArrivee, poserArrivee, lireArrivee, effacerArrivee,
  dureeSurPlaceMin, formatDuree, formatHeure,
} from '../src/services/arriveeAssociation.js';

beforeEach(() => { localStorage.clear(); });

describe('poserArrivee / lireArrivee', () => {
  test('la PREMIÈRE déclaration fait foi — un double appui ne la repousse pas', () => {
    const t0 = new Date('2026-08-26T09:00:00Z');
    const t1 = new Date('2026-08-26T09:40:00Z');
    poserArrivee(7, 42, t0);
    poserArrivee(7, 42, t1);   // rejeu, retour en arrière, rechargement…
    // Sans cette garantie, un arrêt long se raccourcirait tout seul à chaque appui.
    expect(lireArrivee(7, 42)).toBe(t0.toISOString());
  });

  test('chaque point de chaque tournée a sa propre arrivée', () => {
    poserArrivee(7, 42, new Date('2026-08-26T09:00:00Z'));
    poserArrivee(7, 43, new Date('2026-08-26T10:30:00Z'));
    poserArrivee(8, 42, new Date('2026-08-27T08:15:00Z'));

    expect(lireArrivee(7, 42)).toBe('2026-08-26T09:00:00.000Z');
    expect(lireArrivee(7, 43)).toBe('2026-08-26T10:30:00.000Z');
    expect(lireArrivee(8, 42)).toBe('2026-08-27T08:15:00.000Z');
    expect(clefArrivee(7, 42)).not.toBe(clefArrivee(8, 42));
  });

  test('aucune arrivée déclarée → null, jamais une heure inventée', () => {
    expect(lireArrivee(7, 42)).toBeNull();
  });

  test('valeur illisible en mémoire → null plutôt qu’une date absurde', () => {
    localStorage.setItem(clefArrivee(7, 42), 'pas-une-date');
    expect(lireArrivee(7, 42)).toBeNull();
  });

  test('effacerArrivee libère la place pour le passage suivant', () => {
    poserArrivee(7, 42, new Date('2026-08-26T09:00:00Z'));
    effacerArrivee(7, 42);
    expect(lireArrivee(7, 42)).toBeNull();
  });
});

describe('dureeSurPlaceMin', () => {
  test('compte les minutes écoulées depuis l’arrivée', () => {
    const arrivee = '2026-08-26T09:00:00Z';
    expect(dureeSurPlaceMin(arrivee, new Date('2026-08-26T09:12:00Z'))).toBe(12);
    expect(dureeSurPlaceMin(arrivee, new Date('2026-08-26T10:05:00Z'))).toBe(65);
  });

  test('arrivée inconnue → null, et surtout PAS 0', () => {
    // « arrivé à l'instant » et « on ne sait pas » sont deux informations
    // différentes : les confondre inscrirait une durée d'arrêt de zéro minute.
    expect(dureeSurPlaceMin(null)).toBeNull();
    expect(dureeSurPlaceMin(undefined)).toBeNull();
    expect(dureeSurPlaceMin('n’importe quoi')).toBeNull();
  });

  test('horloge en arrière (mise à l’heure du téléphone) → 0, jamais un négatif', () => {
    expect(dureeSurPlaceMin('2026-08-26T09:00:00Z', new Date('2026-08-26T08:55:00Z'))).toBe(0);
  });
});

describe('formatDuree', () => {
  test('sous une heure : en minutes', () => {
    expect(formatDuree(0)).toBe('0 min');
    expect(formatDuree(45)).toBe('45 min');
  });

  test('au-delà : heures et minutes, sans calcul mental', () => {
    expect(formatDuree(60)).toBe('1 h 00');
    expect(formatDuree(65)).toBe('1 h 05');
    expect(formatDuree(150)).toBe('2 h 30');
  });

  test('inconnu → null (l’écran affichera « — »)', () => {
    expect(formatDuree(null)).toBeNull();
    expect(formatDuree(undefined)).toBeNull();
  });
});

describe('formatHeure', () => {
  test('une heure lisible, ou rien', () => {
    expect(formatHeure('2026-08-26T09:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(formatHeure(null)).toBeNull();
    expect(formatHeure('pas-une-date')).toBeNull();
  });
});
