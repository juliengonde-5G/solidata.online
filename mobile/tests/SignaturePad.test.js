// Rendu statique du pad de signature. Vitest tourne en environment: 'node'
// (pas de jsdom, pas de @testing-library — voir vitest.config.js et
// tests/DemoModeBanner.test.js) : on rend donc côté serveur, ce qui suffit à
// vérifier le marquage FALC, l'accessibilité et surtout `touch-action: none` —
// la propriété SANS laquelle signer fait défiler la page sous le doigt, défaut
// invisible à la souris. Écrit en .js (React.createElement, pas de JSX) : le
// plugin React n'est pas chargé pour les tests.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import SignaturePad from '../src/components/SignaturePad.jsx';

const PNG = `data:image/png;base64,${'A'.repeat(64)}`;
const baliseBouton = (html) => (html.match(/<button[^>]*>/) || [''])[0];

const rendre = (props = {}) =>
  renderToStaticMarkup(React.createElement(SignaturePad, { onChange: () => {}, ...props }));

describe('SignaturePad', () => {
  it('rend un canvas à la résolution interne bornée (poids du PNG maîtrisé)', () => {
    const html = rendre({ label: 'Signature de l’agent' });
    expect(html).toContain('<canvas');
    expect(html).toContain('width="600"');
    expect(html).toContain('height="220"');
  });

  it('neutralise le défilement tactile sur le canevas', () => {
    // Sans `touch-action: none`, le geste de signature est interprété comme un
    // défilement : le pad devient inutilisable au doigt.
    expect(rendre()).toMatch(/touch-action:\s*none/);
  });

  it('nomme le pad pour les technologies d’assistance', () => {
    const html = rendre({ label: 'Signature du chauffeur' });
    expect(html).toContain('aria-label="Signature du chauffeur"');
    expect(html).toContain('role="img"');
  });

  it('propose un bouton « Effacer » nommé, inactif tant que rien n’est signé', () => {
    const html = rendre({ label: 'Signature de l’agent' });
    expect(html).toContain('Effacer');
    expect(html).toContain('aria-label="Effacer signature de l’agent"');
    expect(baliseBouton(html)).toContain('disabled');
  });

  it('invite à signer quand le pad est vide', () => {
    const texte = rendre().replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'");
    expect(texte).toContain('Signez avec le doigt dans le cadre.');
  });

  it('confirme la signature quand une valeur est fournie', () => {
    const texte = rendre({ value: PNG }).replace(/<[^>]+>/g, ' ');
    expect(texte).toContain('Signature enregistrée');
  });

  it('dit clairement qu’il est désactivé (agent indisponible)', () => {
    const html = rendre({ disabled: true });
    expect(html).toContain('aria-disabled="true"');
    expect(html.replace(/<[^>]+>/g, ' ')).toContain('Signature désactivée.');
  });

  it('n’embarque aucune dépendance de dessin : le canevas est fait maison', () => {
    // Contrôle de doctrine (règle 5 de CLAUDE.md) : pas de librairie ajoutée.
    const src = new URL('../src/components/SignaturePad.jsx', import.meta.url);
    const code = fs.readFileSync(src, 'utf8');
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((i) => i.startsWith('.') || i === 'react')).toBe(true);
  });
});
