/**
 * Compte rendu de tournée — garde anti-dérive du budget de page.
 *
 * Le rapport tient en DEUX pages A4 parce qu'un seuil décide, au-delà d'une
 * certaine charge, de passer le tableau des points en deux colonnes resserrées.
 * Ce seuil compte des LIGNES (10/09/2026) : un point vaut deux unités, chaque
 * mention imprimée SOUS son nom en vaut une.
 *
 * LE PIÈGE QUE CETTE GARDE FERME : ajouter demain une troisième mention sous le
 * nom d'un point — c'est une ligne de plus par point concerné — sans l'ajouter
 * au calcul du poids. Le seuil se remettrait alors à mentir exactement comme il
 * mentait avant ce correctif, et le défaut ne se verrait qu'à l'impression
 * d'une grosse tournée, chez le gestionnaire.
 *
 * La garde lit le fichier SOURCE : elle couvre donc les mentions qui n'existent
 * pas encore. Elle vit dans la suite backend faute de coureur de tests côté
 * front (chantier T1.5 de l'audit) — le fichier, lui, est bien du front.
 */
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '../../../frontend/src/components/tours/pdf-tournee.js');

describe('budget de pagination du rapport de tournée', () => {
  const source = fs.readFileSync(FICHIER, 'utf8');

  it('compte le poids de la liste en lignes, jamais en nombre de points', () => {
    // Un seuil exprimé en points ignore les mentions : c'est le défaut corrigé.
    expect(source).toMatch(/function poidsListe\(points\)/);
    expect(source).toMatch(/BUDGET_COLONNE_UNIQUE/);
    expect(source).not.toMatch(/points\.length\s*>\s*SEUIL/);
  });

  it('pèse CHAQUE mention imprimée sous le nom du point', () => {
    // Les mentions sont les blocs `${p.champ ? `<br>…` : ''}` du tableau.
    const mentions = [...source.matchAll(/\$\{p\.([a-z_]+)\s*\?\s*`<br>/g)].map((m) => m[1]);
    expect(mentions.length).toBeGreaterThanOrEqual(2); // le test doit exercer quelque chose

    const poids = source.slice(source.indexOf('function poidsListe'));
    const corps = poids.slice(0, poids.indexOf('\n}'));
    const oubliees = mentions.filter((champ) => !corps.includes(`p.${champ}`));

    expect(oubliees).toEqual([]); // sinon : mention ajoutée sans être comptée
  });

  it('garde une marge sous la rupture mesurée (125 demi-lignes)', () => {
    const budget = Number((source.match(/const BUDGET_COLONNE_UNIQUE = (\d+)/) || [])[1]);
    expect(Number.isFinite(budget)).toBe(true);
    // Rupture mesurée au rendu Chromium : 125 demi-lignes sous charge maximale.
    // On interdit de la frôler ; on n'interdit pas de descendre.
    expect(budget).toBeLessThanOrEqual(118);
    expect(budget).toBeGreaterThan(0);
  });
});
