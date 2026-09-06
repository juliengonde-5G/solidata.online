// Rendu statique de l'écran « Bordereau déchèterie ». Vitest tourne en
// environment: 'node' (voir vitest.config.js) : on rend côté serveur, dans un
// MemoryRouter parce que l'écran consomme useNavigate. `useUsageMode` retombe
// sur operational_stop hors provider (UsageModeContext.jsx), aucun mock requis.
// Écrit en .js (React.createElement, pas de JSX) : le plugin React n'est pas
// chargé pour les tests.
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import DecheterieBordereau from '../src/pages/DecheterieBordereau.jsx';

const rendre = () =>
  renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/decheterie-bordereau'] },
      React.createElement(DecheterieBordereau),
    ),
  );

/** Balise ouvrante du bouton portant cet aria-label (attributs dans l'ordre JSX). */
const baliseBouton = (html, label) => {
  const m = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  return m ? m[0] : '';
};

const texteDe = (html) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/').replace(/\s+/g, ' ');

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  localStorage.setItem('current_tour_id', '681');
  localStorage.setItem('selected_cav_id', '338');
  localStorage.setItem('selected_cav_name', '1 Quai du Pré aux loups');
});

describe('DecheterieBordereau — les trois temps du bordereau', () => {
  it('numérote les trois blocs dans l’ordre du quai', () => {
    const t = texteDe(rendre());
    expect(t).toContain('1. Poids collecté (kg)');
    expect(t).toContain('2. Signature de l’agent de la déchèterie');
    expect(t).toContain('3. Votre signature');
  });

  it('dit que le poids est INDICATIF et n’est pas une pesée', () => {
    const t = texteDe(rendre());
    expect(t).toContain('Poids indicatif pour la Métropole');
    expect(t).toContain('ce n’est pas une pesée');
  });

  it('affiche le point courant en sous-titre', () => {
    expect(texteDe(rendre())).toContain('1 Quai du Pré aux loups');
  });

  it('propose le compteur ±10 / ±50 et les raccourcis 50 / 100 / 200 kg', () => {
    const html = rendre();
    expect(html).toContain('aria-label="Cinquante kilos de moins"');
    expect(html).toContain('aria-label="Dix kilos de moins"');
    expect(html).toContain('aria-label="Dix kilos de plus"');
    expect(html).toContain('aria-label="Cinquante kilos de plus"');
    const t = texteDe(html);
    expect(t).toContain('50 kg');
    expect(t).toContain('100 kg');
    expect(t).toContain('200 kg');
  });

  it('laisse la saisie clavier ouverte (une grosse déchèterie ne se compte pas en +50)', () => {
    const html = rendre();
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('aria-label="Poids indicatif en kilogrammes"');
  });

  it('rend les DEUX pads de signature, nommés', () => {
    const html = rendre();
    expect(html).toContain('aria-label="Signature de l’agent"');
    expect(html).toContain('aria-label="Signature du chauffeur"');
    expect((html.match(/<canvas/g) || [])).toHaveLength(2);
  });

  it('offre le choix explicite « L’agent n’est pas disponible »', () => {
    const t = texteDe(rendre());
    expect(t).toContain('L’agent n’est pas disponible');
  });

  it('désactive la barre d’action tant que le bordereau est incomplet', () => {
    const html = rendre();
    expect(html).toContain('aria-label="Valider le bordereau"');
    // Le bouton primaire de PrimaryActionBar porte `disabled` quand la
    // validation échoue — à l'ouverture, rien n'est saisi ni signé.
    expect(baliseBouton(html, 'Valider le bordereau')).toContain('disabled');
  });

  it('liste en clair ce qu’il reste à faire', () => {
    const t = texteDe(rendre());
    expect(t).toContain('Il reste à faire');
    expect(t).toContain('Indiquez le poids indicatif en kg.');
    expect(t).toContain('Faites signer l’agent de la déchèterie');
    expect(t).toContain('Signez le bordereau (signature du chauffeur).');
  });

  it('dit sans contexte de passage plutôt que d’ouvrir un formulaire mort', () => {
    localStorage.removeItem('selected_cav_id');
    const html = rendre();
    // Barre désactivée : rien ne peut partir sans tournée ni point.
    expect(baliseBouton(html, 'Valider le bordereau')).toContain('disabled');
  });
});
