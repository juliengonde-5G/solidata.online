// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — `utils/date-iso.js`, le helper de jour civil partagé
// ───────────────────────────────────────────────────────────────────────────
// Ce module est la réponse à une famille entière de défauts de la PR B (D-01 à
// D-03, D-05) : `node-pg` rend une colonne `DATE` sous forme d'objet `Date`
// construit à minuit **LOCAL**, et deux raccourcis se partagent les dégâts —
// `String(uneDate).slice(...)`, qui découpe « Sun Mar 02 », et `toISOString()`,
// qui rend la VEILLE sous tout fuseau positif.
//
// Les tests de fuseau tournent sous `TZ` réglé à la volée : c'est le seul
// moyen de prouver l'indépendance au fuseau sans relancer Jest.
// ═══════════════════════════════════════════════════════════════════════════
const {
  isoDate, moisDe, anneeDe, aujourdhuiParis, jourParis,
  decalerJours, ajouterMois, ecartJours,
} = require('../../../src/utils/date-iso');

/** Rejoue `fn` sous un fuseau donné, et le restaure quoi qu'il arrive. */
function sousFuseau(tz, fn) {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant;
  }
}

describe('isoDate — la conversion, et rien d’autre', () => {
  test('une chaîne déjà ISO est rendue telle quelle, sans passer par un Date', () => {
    expect(isoDate('2025-03-02')).toBe('2025-03-02');
    expect(isoDate('2025-03-02T10:00:00Z')).toBe('2025-03-02');
    expect(isoDate('2025-03-02 10:00:00+02')).toBe('2025-03-02');
  });

  test('un objet Date est lu par ses composantes LOCALES', () => {
    expect(isoDate(new Date(2025, 6, 1))).toBe('2025-07-01');
    expect(isoDate(new Date(2025, 0, 1))).toBe('2025-01-01');
  });

  // LE test de ce fichier. `new Date(annee, mois, jour)` construit exactement
  // ce que le pilote construit pour une colonne DATE : minuit local.
  test('une colonne DATE se lit pareil sous TOUS les fuseaux (D-05)', () => {
    for (const tz of ['UTC', 'Europe/Paris', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
      const lu = sousFuseau(tz, () => isoDate(new Date(2025, 6, 1)));
      expect({ tz, lu }).toEqual({ tz, lu: '2025-07-01' });
    }
  });

  test('rien n’est inventé : une valeur illisible rend null', () => {
    expect(isoDate(null)).toBeNull();
    expect(isoDate(undefined)).toBeNull();
    expect(isoDate('')).toBeNull();
    expect(isoDate('n’importe quoi')).toBeNull();
    expect(isoDate(new Date('invalide'))).toBeNull();
  });

  test('la sentinelle 1900-01-01 reste une date comme une autre (D-03)', () => {
    // Le défaut D-03 venait de ce que `String(uneDate).slice(0, 10)` rendait
    // « Mon Jan 01 », et qu'en ASCII les lettres passent après les chiffres :
    // la sentinelle était donc « supérieure » à '1900-01-01' et prise pour une
    // vraie date. Ici, la comparaison de chaînes redevient fiable.
    expect(isoDate(new Date(1900, 0, 1))).toBe('1900-01-01');
    expect(isoDate(new Date(1900, 0, 1)) > '1900-01-01').toBe(false);
  });
});

describe('moisDe / anneeDe — plus jamais de NaN silencieux (D-01)', () => {
  test('le mois se lit sur un Date comme sur une chaîne', () => {
    expect(moisDe(new Date(2026, 2, 1))).toBe(3);
    expect(moisDe('2026-03-01')).toBe(3);
    expect(anneeDe(new Date(2026, 2, 1))).toBe(2026);
  });

  test('le raccourci d’origine, lui, donnait NaN — la démonstration', () => {
    const brut = Number(String(new Date(2026, 2, 1)).slice(5, 7));
    expect(Number.isNaN(brut)).toBe(true);       // « ar » → NaN
    expect(moisDe(new Date(2026, 2, 1))).toBe(3); // le helper, lui, répond
  });

  test('illisible → null, jamais 0 (un mois 0 n’existe pas)', () => {
    expect(moisDe('rien')).toBeNull();
    expect(anneeDe(null)).toBeNull();
  });
});

describe('jour civil de Paris (m-07)', () => {
  test('aujourdhuiParis rend bien AAAA-MM-JJ quel que soit le fuseau du serveur', () => {
    for (const tz of ['UTC', 'America/Los_Angeles']) {
      expect(sousFuseau(tz, aujourdhuiParis)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('un instant juste après minuit à Paris est DÉJÀ le lendemain', () => {
    // 31 décembre 2026, 23 h 30 UTC = 1er janvier 2027, 00 h 30 à Paris.
    // L'horloge du conteneur (UTC) dirait encore « 2026-12-31 ».
    const instant = new Date(Date.UTC(2026, 11, 31, 23, 30));
    expect(jourParis(instant)).toBe('2027-01-01');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  test('le changement d’heure est géré sans table à maintenir', () => {
    // Dernier dimanche de mars 2026 : passage à UTC+2 à 01 h UTC.
    expect(jourParis(new Date(Date.UTC(2026, 2, 28, 23, 30)))).toBe('2026-03-29'); // hiver, +1
    expect(jourParis(new Date(Date.UTC(2026, 6, 15, 22, 30)))).toBe('2026-07-16'); // été, +2
  });
});

describe('arithmétique de jours civils — UTC pur, aucun changement d’heure ne mord', () => {
  test('decalerJours traverse une fin de mois et une année bissextile', () => {
    expect(decalerJours('2026-02-28', 1)).toBe('2026-03-01');
    expect(decalerJours('2024-02-28', 1)).toBe('2024-02-29');
    expect(decalerJours('2026-01-01', -1)).toBe('2025-12-31');
  });

  test('decalerJours ne perd pas de jour au passage à l’heure d’été', () => {
    // Le 29 mars 2026 ne dure que 23 h à Paris : une arithmétique locale
    // sauterait la journée.
    expect(sousFuseau('Europe/Paris', () => decalerJours('2026-03-28', 1))).toBe('2026-03-29');
    expect(sousFuseau('Europe/Paris', () => decalerJours('2026-03-29', 1))).toBe('2026-03-30');
  });

  test('ajouterMois conserve le débordement de fin de mois des appelants', () => {
    expect(ajouterMois('2026-03-23', 6)).toBe('2026-09-23');
    expect(ajouterMois('2026-08-31', 6)).toBe('2027-03-03'); // comportement `Date`, inchangé
    expect(ajouterMois(new Date(2026, 2, 23), 6)).toBe('2026-09-23');
    expect(ajouterMois(null, 6)).toBeNull();
  });

  test('ecartJours compte des jours entiers, y compris à travers un changement d’heure', () => {
    expect(ecartJours('2026-01-01', '2026-03-02')).toBe(60);
    expect(sousFuseau('Europe/Paris', () => ecartJours('2026-03-28', '2026-03-30'))).toBe(2);
    expect(ecartJours('2026-03-02', '2026-01-01')).toBe(-60);
    expect(ecartJours(null, '2026-01-01')).toBeNull();
  });
});
