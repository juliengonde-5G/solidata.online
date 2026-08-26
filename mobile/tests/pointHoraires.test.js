// Écran chauffeur — horaires du jour (RG-A8) et rendez-vous (RG-B6) d'un
// point association. Le point sensible : ne JAMAIS confondre les trois états
// des horaires (renseigné / fermé / inconnu) — une confusion ici produit un
// écran qui rassure ou inquiète à tort.
import { describe, test, expect } from 'vitest';
import {
  formatHeureFalc,
  formatPlageFalc,
  infoHorairesJour,
  texteRdv,
} from '../src/services/pointHoraires.js';

describe('formatHeureFalc', () => {
  test('heure ronde : les minutes à zéro sont tues', () => {
    expect(formatHeureFalc('09:00')).toBe('9h');
    expect(formatHeureFalc('00:00')).toBe('0h');
    expect(formatHeureFalc('23:00')).toBe('23h');
  });

  test('minutes non nulles : deux chiffres, comme à l\'oral', () => {
    expect(formatHeureFalc('09:30')).toBe('9h30');
    expect(formatHeureFalc('14:05')).toBe('14h05');
    expect(formatHeureFalc('23:59')).toBe('23h59');
  });

  test('colonne TIME PostgreSQL avec secondes : les secondes sont ignorées', () => {
    expect(formatHeureFalc('10:30:00')).toBe('10h30');
    expect(formatHeureFalc('09:00:00')).toBe('9h');
  });

  test('heure sur un seul chiffre acceptée', () => {
    expect(formatHeureFalc('9:30')).toBe('9h30');
  });

  test('valeurs illisibles : jamais d\'heure inventée', () => {
    expect(formatHeureFalc(null)).toBeNull();
    expect(formatHeureFalc(undefined)).toBeNull();
    expect(formatHeureFalc('')).toBeNull();
    expect(formatHeureFalc('abc')).toBeNull();
    expect(formatHeureFalc('25:00')).toBeNull(); // heure hors bornes
    expect(formatHeureFalc('12:70')).toBeNull(); // minute hors bornes
    expect(formatHeureFalc(930)).toBeNull(); // pas une chaîne
    expect(formatHeureFalc({})).toBeNull();
  });
});

describe('formatPlageFalc', () => {
  test('plage simple', () => {
    expect(formatPlageFalc({ debut: '09:00', fin: '12:00' })).toBe('9h–12h');
  });

  test('bornes avec minutes', () => {
    expect(formatPlageFalc({ debut: '14:00', fin: '17:30' })).toBe('14h–17h30');
  });

  test('plage incomplète ou invalide : rien d\'inventé', () => {
    expect(formatPlageFalc({ debut: '09:00' })).toBeNull();
    expect(formatPlageFalc({ debut: '09:00', fin: 'abc' })).toBeNull();
    expect(formatPlageFalc(null)).toBeNull();
    expect(formatPlageFalc(undefined)).toBeNull();
    expect(formatPlageFalc('09:00-12:00')).toBeNull();
  });
});

describe('infoHorairesJour — les trois états ne se confondent jamais', () => {
  test('état INCONNU (undefined, champ pas encore renvoyé par le backend) → rien', () => {
    expect(infoHorairesJour(undefined)).toBeNull();
  });

  test('état INCONNU (null, horaires non renseignés en fiche) → rien', () => {
    expect(infoHorairesJour(null)).toBeNull();
  });

  test('état FERMÉ (tableau vide) → message calme, jamais un blocage', () => {
    const info = infoHorairesJour([]);
    expect(info).not.toBeNull();
    expect(info.etat).toBe('ferme');
    expect(info.texte).toBe("Fermé aujourd'hui — le passage a été forcé par le bureau");
  });

  test('état OUVERT (une plage) → heure lisible, pas de zéro superflu', () => {
    const info = infoHorairesJour([{ debut: '09:00', fin: '12:00' }]);
    expect(info.etat).toBe('ouvert');
    expect(info.texte).toBe("Ouvert aujourd'hui : 9h–12h");
  });

  test('état OUVERT (deux plages) → jointes par « · », comme l\'exemple du CDC', () => {
    const info = infoHorairesJour([
      { debut: '09:00', fin: '12:00' },
      { debut: '14:00', fin: '17:00' },
    ]);
    expect(info.texte).toBe("Ouvert aujourd'hui : 9h–12h · 14h–17h");
  });

  test('undefined et [] ne produisent JAMAIS le même résultat', () => {
    const inconnu = infoHorairesJour(undefined);
    const ferme = infoHorairesJour([]);
    expect(inconnu).toBeNull();
    expect(ferme).not.toBeNull();
    expect(ferme.etat).toBe('ferme');
  });

  test('null et [] ne produisent JAMAIS le même résultat', () => {
    const inconnu = infoHorairesJour(null);
    const ferme = infoHorairesJour([]);
    expect(inconnu).toBeNull();
    expect(ferme).not.toBeNull();
  });

  test('forme inattendue (objet, chaîne) : rien n\'est inventé', () => {
    expect(infoHorairesJour('ouvert')).toBeNull();
    expect(infoHorairesJour({ lundi: [] })).toBeNull();
  });

  test('tableau non vide mais entièrement illisible : ni fermé ni ouvert inventé', () => {
    expect(infoHorairesJour([{ debut: 'x', fin: 'y' }])).toBeNull();
  });

  test('plages partiellement illisibles : seules les plages valides sont gardées', () => {
    const info = infoHorairesJour([
      { debut: '09:00', fin: '12:00' },
      { debut: 'x', fin: 'y' },
    ]);
    expect(info.etat).toBe('ouvert');
    expect(info.texte).toBe("Ouvert aujourd'hui : 9h–12h");
  });
});

describe('texteRdv', () => {
  test('sans rendez-vous (null ou undefined) : rien', () => {
    expect(texteRdv(null)).toBeNull();
    expect(texteRdv(undefined)).toBeNull();
  });

  test('objet vide ou heure_debut manquante : rien', () => {
    expect(texteRdv({})).toBeNull();
    expect(texteRdv({ tolerance_min: 15 })).toBeNull();
  });

  test('rendez-vous à heure fixe (colonne TIME avec secondes)', () => {
    expect(texteRdv({ heure_debut: '10:30:00' })).toBe('Rendez-vous à 10h30');
  });

  test('heure_fin identique à heure_debut : traité comme une heure fixe', () => {
    expect(texteRdv({ heure_debut: '10:30:00', heure_fin: '10:30:00' })).toBe('Rendez-vous à 10h30');
  });

  test('créneau (heure_fin différente) : les deux bornes sont dites', () => {
    expect(texteRdv({ heure_debut: '10:00:00', heure_fin: '10:30:00' }))
      .toBe('Rendez-vous entre 10h et 10h30');
  });

  test('heure_debut illisible : rien n\'est affiché', () => {
    expect(texteRdv({ heure_debut: 'abc' })).toBeNull();
  });

  test('la tolérance n\'apparaît jamais dans le texte (phrase courte, FALC)', () => {
    const texte = texteRdv({ heure_debut: '10:30:00', tolerance_min: 15 });
    expect(texte).not.toMatch(/15/);
  });
});
