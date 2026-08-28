import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter } from 'react-router-dom';
import BoutonAssistance from '../src/components/BoutonAssistance.jsx';

// Vitest tourne en `environment: 'node'` (voir vitest.config.js) : on rend donc
// côté serveur, sans JSX dans le fichier de test — même convention que
// tests/DemoModeBanner.test.js.

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ICI, '..', 'src');

function rendre(chemin = '/tour-map') {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [chemin] },
      React.createElement(BoutonAssistance))
  );
}

/** Boutons ronds en `position: fixed` présents dans le balisage rendu. */
function boutonsFlottants(html) {
  return html.match(/class="fixed [^"]*rounded-full[^"]*"/g) || [];
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('BoutonAssistance — un seul bouton flottant', () => {
  it('ne monte AUCUN bouton flottant sans session chauffeur', () => {
    expect(rendre()).toBe('');
  });

  it('monte EXACTEMENT un bouton flottant une fois authentifié', () => {
    localStorage.setItem('mobile_token', 'jeton');
    const html = rendre();
    expect(boutonsFlottants(html)).toHaveLength(1);
    expect(html).toContain('aria-label="Aide et messages"');
  });

  it('la bulle propre de l’assistant a disparu (c’était le doublon signalé)', () => {
    localStorage.setItem('mobile_token', 'jeton');
    const html = rendre();
    expect(html).not.toContain("Ouvrir l'assistant SolidataBot");
    // Un seul et même bouton dessert les trois usages : pas deux bulles.
    expect((html.match(/<button/g) || []).length).toBe(1);
  });

  it('s’efface sur l’écran Messages, sa propre destination', () => {
    localStorage.setItem('mobile_token', 'jeton');
    expect(boutonsFlottants(rendre('/messages'))).toHaveLength(0);
  });

  it('annonce le total des non-lus dans son libellé accessible', () => {
    localStorage.setItem('mobile_token', 'jeton');
    // Au premier rendu (avant tout appel réseau), aucun non-lu connu : pas de
    // pastille — on n'annonce jamais un chiffre qu'on n'a pas.
    const html = rendre();
    expect(html).toContain('aria-label="Aide et messages"');
    expect(html).not.toContain('bg-red-500');
  });
});

describe('Garde anti-doublon : un seul bouton flottant dans tout le paquet mobile', () => {
  /**
   * Le défaut signalé par le client — « le bouton messagerie apparaît deux
   * fois » — venait de DEUX composants montés côte à côte dans App.jsx, chacun
   * avec sa bulle ronde flottante et la même icône. Ce test ferme la porte par
   * laquelle il est passé : si un troisième composant réintroduit une bulle
   * flottante, la suite échoue.
   */
  function fichiersSource(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return fichiersSource(p);
      return /\.jsx?$/.test(e.name) ? [p] : [];
    });
  }

  it('un seul fichier déclare un bouton rond flottant en bas d’écran', () => {
    const coupables = [];
    for (const fichier of fichiersSource(SRC)) {
      const code = fs.readFileSync(fichier, 'utf8');
      // `className="fixed bottom-… rounded-full …"` : la signature d'une bulle.
      const bulles = code.match(/className="fixed bottom-[^"]*rounded-full[^"]*"/g) || [];
      if (bulles.length > 0) coupables.push(`${path.relative(SRC, fichier)} (${bulles.length})`);
    }
    expect(coupables).toEqual(['components/BoutonAssistance.jsx (1)']);
  });

  it('App.jsx ne monte qu’un seul composant de bouton flottant', () => {
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
    expect(app).toContain('<BoutonAssistance />');
    // Les deux composants fusionnés ne sont plus montés séparément.
    expect(app).not.toContain('<MessagesButton');
    expect(app).not.toContain('<SolidataBot');
    expect(fs.existsSync(path.join(SRC, 'components', 'MessagesButton.jsx'))).toBe(false);
  });
});

describe('Fond de carte du chauffeur', () => {
  it('la carte de tournée n’appelle plus les tuiles CARTO (clé exigée)', () => {
    const tourMap = fs.readFileSync(path.join(SRC, 'pages', 'TourMap.jsx'), 'utf8');
    expect(tourMap).not.toContain('cartocdn.com');
    expect(tourMap).toContain('<FondCarte />');
  });

  it('le fond partagé sert OpenStreetMap, sans clé, avec son attribution', () => {
    const fond = fs.readFileSync(path.join(SRC, 'components', 'FondCarte.jsx'), 'utf8');
    expect(fond).toContain('tile.openstreetmap.org');
    expect(fond).toContain('openstreetmap.org/copyright');
    // On analyse le CODE, pas les commentaires : le fichier EXPLIQUE pourquoi
    // CARTO a été abandonné, il ne doit simplement plus l'appeler.
    const codeSeul = fond.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    expect(codeSeul).not.toContain('cartocdn.com');
  });
});
