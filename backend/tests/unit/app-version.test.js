// ═══════════════════════════════════════════════════════════════════════════
// GARDE — la version de l'outil portée par les documents transmis (M-05)
// ───────────────────────────────────────────────────────────────────────────
// Quatre surfaces composent leur en-tête avec
// `process.env.APP_VERSION || require('package.json').version`, et
// `backend/package.json` valait « 1.0.0 » tandis qu'`APP_VERSION` n'était
// déclarée NI dans `docker-compose.prod.yml`, NI dans `.env.example`. Les trois
// documents que la structure transmet à l'autorité — export FSE+ participants,
// tableau des freins (d), synthèse de dialogue de gestion (e) — portaient donc
// tous une version fausse, et le snapshot de chaque synthèse générée
// l'enregistrait : rejouer une synthèse ne disait jamais quelle version l'avait
// produite, ce qui prive le snapshot d'une part de sa valeur probante.
//
// Mentionner la version est une RÈGLE COMMUNE IMPÉRATIVE de la matrice de
// l'autorité (09 § 2). Cette garde tombe si l'un des trois maillons se défait.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..', '..');
const pkg = require('../../package.json');

describe('APP_VERSION — les documents transmis portent une version vraie', () => {
  it('`backend/package.json` ne porte plus la version par défaut', () => {
    expect(pkg.version).not.toBe('1.0.0');
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('le repli des quatre surfaces donne donc une version utilisable', () => {
    const { APP_VERSION } = require('../../src/services/dialogue-gestion');
    expect(APP_VERSION).not.toBe('1.0.0');
  });

  it('`APP_VERSION` est DÉCLARÉE dans le compose de production', () => {
    const compose = fs.readFileSync(path.join(RACINE, 'docker-compose.prod.yml'), 'utf8');
    expect(compose).toMatch(/APP_VERSION:\s*\$\{APP_VERSION/);
  });

  it('…et documentée dans les deux `.env.example`', () => {
    for (const f of ['.env.example', path.join('backend', '.env.example')]) {
      const env = fs.readFileSync(path.join(RACINE, f), 'utf8');
      expect([f, /^APP_VERSION=/m.test(env)]).toEqual([f, true]);
    }
  });
});
