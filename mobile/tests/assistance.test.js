import { describe, it, expect } from 'vitest';
import {
  sommeNonLus, libelleBadge, repartitionNonLus, boutonVisible, lienNotifications,
  USAGES_ASSISTANCE, EVENEMENT_CONSIGNES,
} from '../src/services/assistance.js';

/**
 * Règles du bouton d'assistance unique (28/08/2026) — fusion de l'assistant,
 * de la messagerie et de l'historique des notifications sous UN seul bouton.
 */

describe('sommeNonLus — un seul bouton, un seul chiffre', () => {
  it('additionne les non-lus de la messagerie et les consignes du responsable', () => {
    expect(sommeNonLus({ messagerie: 3, consignes: 2 })).toBe(5);
  });

  it('rend 0 quand rien n’est en attente', () => {
    expect(sommeNonLus({ messagerie: 0, consignes: 0 })).toBe(0);
    expect(sommeNonLus({})).toBe(0);
    expect(sommeNonLus()).toBe(0);
  });

  it('ignore toute valeur non exploitable plutôt que d’afficher un chiffre faux', () => {
    expect(sommeNonLus({ messagerie: null, consignes: 4 })).toBe(4);
    expect(sommeNonLus({ messagerie: 'beaucoup', consignes: 1 })).toBe(1);
    expect(sommeNonLus({ messagerie: -7, consignes: 2 })).toBe(2);
    expect(sommeNonLus({ messagerie: NaN, consignes: undefined })).toBe(0);
    expect(sommeNonLus({ messagerie: 2.9, consignes: 0 })).toBe(2);
  });
});

describe('libelleBadge — pastille lisible en plein soleil', () => {
  it('n’affiche AUCUNE pastille à zéro (un « 0 » se lirait comme à traiter)', () => {
    expect(libelleBadge(0)).toBeNull();
    expect(libelleBadge(null)).toBeNull();
    expect(libelleBadge(-3)).toBeNull();
  });

  it('affiche le nombre jusqu’à 9, puis « 9+ »', () => {
    expect(libelleBadge(1)).toBe('1');
    expect(libelleBadge(9)).toBe('9');
    expect(libelleBadge(10)).toBe('9+');
    expect(libelleBadge(240)).toBe('9+');
  });
});

describe('repartitionNonLus — Messages d’un côté, Notifications de l’autre', () => {
  const conversations = [
    { id: 7, type: 'systeme', non_lus: 2 },
    { id: 9, type: 'directe', non_lus: 1 },
    { id: 11, type: 'directe', non_lus: 3 },
  ];

  it('range le fil « SOLIDATA » dans Notifications et les personnes dans Messages', () => {
    const r = repartitionNonLus(conversations);
    expect(r.disponible).toBe(true);
    expect(r.conversationSystemeId).toBe(7);
    expect(r.nonLusNotifications).toBe(2);
    expect(r.nonLusMessages).toBe(4);
  });

  it('la somme des deux lignes égale le badge du bouton', () => {
    const r = repartitionNonLus(conversations);
    expect(r.nonLusMessages + r.nonLusNotifications)
      .toBe(sommeNonLus({ messagerie: 6, consignes: 0 }));
  });

  it('sans conversation système, aucun identifiant n’est inventé', () => {
    const r = repartitionNonLus([{ id: 9, type: 'directe', non_lus: 1 }]);
    expect(r.conversationSystemeId).toBeNull();
    expect(r.nonLusNotifications).toBe(0);
  });

  it('hors ligne (liste absente) : « indisponible », et surtout pas des zéros', () => {
    for (const entree of [null, undefined, 'boom', {}]) {
      const r = repartitionNonLus(entree);
      expect(r.disponible).toBe(false);
      expect(r.conversationSystemeId).toBeNull();
    }
  });

  it('tolère les entrées bancales sans planter (compteur illisible = 0)', () => {
    const r = repartitionNonLus([null, { type: 'directe', non_lus: 'trois' }, { id: 5, type: 'systeme' }]);
    expect(r.disponible).toBe(true);
    expect(r.nonLusMessages).toBe(0);
    expect(r.nonLusNotifications).toBe(0);
    expect(r.conversationSystemeId).toBe(5);
  });
});

describe('boutonVisible', () => {
  it('reste caché tant que le chauffeur n’est pas authentifié', () => {
    expect(boutonVisible({ authentifie: false, chemin: '/tour-map' })).toBe(false);
  });

  it('s’efface sur sa propre destination (écran Messages)', () => {
    expect(boutonVisible({ authentifie: true, chemin: '/messages' })).toBe(false);
    expect(boutonVisible({ authentifie: true, chemin: '/messages?conversation=7' })).toBe(false);
  });

  it('s’affiche sur les écrans de tournée', () => {
    for (const chemin of ['/tour-map', '/fill-level', '/checklist', '/association-stop']) {
      expect(boutonVisible({ authentifie: true, chemin })).toBe(true);
    }
  });
});

describe('lienNotifications', () => {
  it('ouvre le fil système quand on le connaît', () => {
    expect(lienNotifications(7)).toBe('/messages?conversation=7');
  });

  it('retombe sur la liste plutôt que de deviner un identifiant', () => {
    expect(lienNotifications(null)).toBe('/messages');
    expect(lienNotifications(undefined)).toBe('/messages');
  });
});

describe('contrat du module', () => {
  it('expose les trois usages réunis sous le bouton unique', () => {
    expect(USAGES_ASSISTANCE).toEqual(['assistant', 'messages', 'notifications']);
  });

  it('nomme l’événement partagé avec la bannière des consignes', () => {
    expect(typeof EVENEMENT_CONSIGNES).toBe('string');
    expect(EVENEMENT_CONSIGNES.length).toBeGreaterThan(0);
  });
});
