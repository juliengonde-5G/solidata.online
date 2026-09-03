// ═══════════════════════════════════════════════════════════════════════════
// REPRISE D'UNE TOURNÉE TERMINÉE — les règles, vérifiées sans base
// ───────────────────────────────────────────────────────────────────────────
// Deux familles de règles sont verrouillées ici :
//
//  1. L'HORODATAGE d'une pesée reprise. Une pesée oubliée a eu lieu à une heure
//     précise, que l'administrateur saisit : la refuser quand elle est illisible
//     vaut mieux que de lui substituer « maintenant », qui la rangerait au
//     mauvais jour et fausserait le tonnage de deux journées à la fois.
//
//  2. Les PALIERS de remplissage. Le mobile n'envoie pas un pourcentage libre :
//     il présente sept paliers nommés et en déduit DEUX colonnes. Corriger un
//     volume déclaré, c'est choisir le palier que le chauffeur aurait dû
//     cocher — jamais taper deux nombres qui pourraient se contredire.
//     Le dernier test est une GARDE : il échoue si la table du serveur cesse de
//     correspondre à celle du mobile, pour que les deux ne dérivent pas en
//     silence (elles ne peuvent pas être fusionnées : le mobile fonctionne hors
//     ligne et ne peut aller chercher aucun référentiel).
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const {
  lireInstantParis, PALIERS_REMPLISSAGE, lirePalier, palierDepuisStockage,
} = require('../../src/routes/tours/reprise-service');

describe('Horodatage d\'une pesée reprise', () => {
  test('accepte « AAAA-MM-JJ HH:MM » et le normalise', () => {
    expect(lireInstantParis('2026-08-28 16:00')).toEqual({ valeur: '2026-08-28 16:00', jour: '2026-08-28' });
  });

  test('accepte la forme ISO du navigateur (« T » et secondes)', () => {
    expect(lireInstantParis('2026-08-28T16:00').valeur).toBe('2026-08-28 16:00');
    expect(lireInstantParis('2026-08-28T16:00:45').valeur).toBe('2026-08-28 16:00');
  });

  test('refuse une forme illisible, sans valeur de remplacement', () => {
    ['', null, undefined, 'hier', '28/08/2026 16:00', '2026-08-28'].forEach((v) => {
      const r = lireInstantParis(v);
      expect(r.error).toBeDefined();
      expect(r.valeur).toBeUndefined();
    });
  });

  test('refuse une date qui n\'existe pas au calendrier', () => {
    // La forme est bonne, la date non : sans ce contrôle, PostgreSQL
    // l'accepterait parfois en la décalant, et la pesée changerait de jour.
    expect(lireInstantParis('2026-02-30 10:00').error).toBeDefined();
    expect(lireInstantParis('2026-13-01 10:00').error).toBeDefined();
    expect(lireInstantParis('2026-08-28 25:00').error).toBeDefined();
  });

  test('le 29 février d\'une année bissextile reste valide', () => {
    expect(lireInstantParis('2028-02-29 08:30').valeur).toBe('2028-02-29 08:30');
  });
});

describe('Paliers de remplissage', () => {
  test('un code inconnu ne retombe sur aucun palier', () => {
    expect(lirePalier('plein')).toMatchObject({ fill_level: 4, fill_percent: 100 });
    expect(lirePalier('inconnu')).toBeNull();
    expect(lirePalier(null)).toBeNull();
  });

  test('« un fond » et « vide » partagent le niveau 0 mais pas le pourcentage', () => {
    // C'est toute la raison d'être de `fill_percent` : l'échelle 0-4 ne sait
    // pas distinguer une borne vide d'une borne à peine entamée.
    expect(lirePalier('vide')).toMatchObject({ fill_level: 0, fill_percent: 0 });
    expect(lirePalier('fond')).toMatchObject({ fill_level: 0, fill_percent: 10 });
  });

  test('« plein » et « au-delà » partagent le niveau 4 mais pas le pourcentage', () => {
    expect(lirePalier('plein').fill_percent).toBe(100);
    expect(lirePalier('au_dela').fill_percent).toBe(110);
  });

  test('retrouve le palier d\'un couple stocké, le pourcentage faisant foi', () => {
    expect(palierDepuisStockage(0, 10)).toEqual({ palier: lirePalier('fond'), exact: true });
    expect(palierDepuisStockage(4, 110)).toEqual({ palier: lirePalier('au_dela'), exact: true });
  });

  test('sans pourcentage, la correspondance est approchée — et le DIT', () => {
    // Points saisis par un mobile antérieur à `fill_percent` : on propose le
    // premier palier du niveau, en signalant que ce n'est pas une certitude.
    const r = palierDepuisStockage(4, null);
    expect(r.palier.code).toBe('plein');
    expect(r.exact).toBe(false);
  });

  test('aucun niveau déclaré → aucun palier proposé', () => {
    expect(palierDepuisStockage(null, null)).toEqual({ palier: null, exact: false });
  });

  test('tous les niveaux restent dans l\'échelle acceptée par la base (0-5)', () => {
    PALIERS_REMPLISSAGE.forEach((p) => {
      expect(p.fill_level).toBeGreaterThanOrEqual(0);
      expect(p.fill_level).toBeLessThanOrEqual(5);
      expect(p.fill_percent).toBeGreaterThanOrEqual(0);
      expect(p.fill_percent).toBeLessThanOrEqual(150);
    });
  });

  // ── GARDE ANTI-DÉRIVE ────────────────────────────────────────────────────
  test('la table du serveur correspond à celle du mobile', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../mobile/src/pages/FillLevel.jsx'), 'utf8'
    );
    const bloc = /const FILL_LEVELS = \[([\s\S]*?)\];/.exec(src);
    expect(bloc).not.toBeNull();

    // Chaque ligne du mobile porte son palier stocké (`store`) et son
    // pourcentage affiché (`pct`), duquel il dérive la valeur envoyée.
    const duMobile = [...bloc[1].matchAll(
      /\{\s*value:\s*\d+,\s*label:\s*'([^']+)',\s*pct:\s*'([^']+)'[^}]*store:\s*(\d+)([^}]*)\}/g
    )].map((m) => ({
      libelle: m[1],
      fill_level: Number(m[3]),
      // « ++ » est le débordement : le mobile envoie 110 (cf. submit()).
      fill_percent: /overflow:\s*true/.test(m[4]) ? 110 : parseInt(m[2], 10),
    }));

    expect(duMobile).toHaveLength(PALIERS_REMPLISSAGE.length);
    duMobile.forEach((m, i) => {
      const serveur = PALIERS_REMPLISSAGE[i];
      expect({ libelle: m.libelle, fill_level: m.fill_level, fill_percent: m.fill_percent })
        .toEqual({
          libelle: serveur.libelle.replace(' (débordement)', ''),
          fill_level: serveur.fill_level,
          fill_percent: serveur.fill_percent,
        });
    });
  });
});
