import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DemoModeBanner from '../src/components/DemoModeBanner.jsx';
import { DEMO_MODE_STORAGE_KEY } from '../src/services/demoMode.js';

// Vitest est configuré en environment: 'node' (pas de jsdom/happy-dom, pas
// de @testing-library — voir vitest.config.js) : on rend donc le composant
// côté serveur (react-dom/server), ce qui suffit à vérifier la logique
// d'affichage conditionnel sans dépendance supplémentaire. Écrit en .js
// (React.createElement, pas de JSX) : vitest.config.js n'embarque pas le
// plugin @vitejs/plugin-react, donc du JSX brut dans un fichier de test
// échouerait à la transformation (« React is not defined »).

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('DemoModeBanner', () => {
  it('ne rend rien quand le mode démo n’est pas actif', () => {
    const html = renderToStaticMarkup(React.createElement(DemoModeBanner));
    expect(html).toBe('');
  });

  it('affiche le bandeau MODE DÉMO — FORMATION quand demo_mode="1"', () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    const html = renderToStaticMarkup(React.createElement(DemoModeBanner));
    expect(html).toContain('MODE DÉMO');
    expect(html).toContain('FORMATION');
    expect(html).toContain('Vous vous entraînez');
    expect(html).toContain('role="status"');
  });

  it('ne rend rien pour une valeur autre que "1" (pas de faux positif)', () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, 'yes');
    const html = renderToStaticMarkup(React.createElement(DemoModeBanner));
    expect(html).toBe('');
  });

  it('retombe sur l’absence d’affichage si le drapeau est retiré', () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    expect(renderToStaticMarkup(React.createElement(DemoModeBanner))).not.toBe('');
    localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
    expect(renderToStaticMarkup(React.createElement(DemoModeBanner))).toBe('');
  });
});
