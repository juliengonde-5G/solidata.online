import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReponsesRapides from '../src/components/messagerie/ReponsesRapides.jsx';
import { REPONSES_RAPIDES } from '../src/services/messagerie.js';

// Vitest est configuré en environment: 'node' (pas de jsdom/happy-dom, pas de
// @testing-library — voir vitest.config.js et tests/DemoModeBanner.test.js) :
// on rend donc le composant côté serveur (react-dom/server), ce qui suffit à
// vérifier le texte FIGÉ (contrat §4) et les attributs FALC (cibles ≥ 48 px,
// role de groupe) sans dépendance supplémentaire. Écrit en .js
// (React.createElement, pas de JSX) : vitest.config.js n'embarque pas le
// plugin @vitejs/plugin-react, donc du JSX brut dans un fichier de test
// échouerait à la transformation.

describe('REPONSES_RAPIDES — contrat §4', () => {
  it('expose exactement les trois réponses figées, dans cet ordre', () => {
    expect(REPONSES_RAPIDES).toEqual([
      "J'ai compris",
      "J'arrive",
      'Je suis bloqué, rappelez-moi',
    ]);
  });
});

describe('ReponsesRapides', () => {
  it('affiche les trois boutons avec le texte exact du contrat', () => {
    const html = renderToStaticMarkup(React.createElement(ReponsesRapides, { onSelect: () => {} }));
    // Le HTML échappe l'apostrophe (&#x27;) — on compare le texte réellement
    // affiché à l'écran (balises retirées), pas le marquage brut.
    const texte = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'");
    REPONSES_RAPIDES.forEach((libelle) => expect(texte).toContain(libelle));
    // Trois boutons, pas un de plus (aucune reformulation ajoutée).
    expect((html.match(/<button/g) || [])).toHaveLength(3);
  });

  it('regroupe les boutons dans un groupe accessible nommé', () => {
    const html = renderToStaticMarkup(React.createElement(ReponsesRapides, { onSelect: () => {} }));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Réponses rapides"');
  });

  it('chaque bouton est un <button type="button"> (jamais de soumission de formulaire)', () => {
    const html = renderToStaticMarkup(React.createElement(ReponsesRapides, { onSelect: () => {} }));
    expect((html.match(/type="button"/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('mode conduite FALC : cible tactile ≥ 48 px (min-height inline)', () => {
    const html = renderToStaticMarkup(React.createElement(ReponsesRapides, { onSelect: () => {} }));
    const hauteurs = [...html.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(hauteurs.length).toBeGreaterThan(0);
    hauteurs.forEach((h) => expect(h).toBeGreaterThanOrEqual(48));
  });

  it('disabled=true : les trois boutons portent l’attribut disabled (envoi en cours)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReponsesRapides, { onSelect: () => {}, disabled: true })
    );
    expect((html.match(/disabled=""/g) || []).length).toBe(3);
  });

  it('disabled=false (défaut) : aucun bouton désactivé', () => {
    const html = renderToStaticMarkup(React.createElement(ReponsesRapides, { onSelect: () => {} }));
    expect(html).not.toContain('disabled=""');
  });

  it('ne lève pas si onSelect est absent (défensif)', () => {
    expect(() => renderToStaticMarkup(React.createElement(ReponsesRapides, {}))).not.toThrow();
  });
});
