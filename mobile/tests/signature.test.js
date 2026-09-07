// ═══════════════════════════════════════════════════════════════════════════
// SIGNATURE MANUSCRITE — logique pure (chantier 2.50.0)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests protègent : une signature est la seule donnée du parcours
// chauffeur qui engage un TIERS et qui ne se recueille jamais deux fois. Deux
// erreurs symétriques seraient graves :
//   • accepter un doigt posé par erreur (un point noir de 3 px reporté sur un
//     document officiel se lit comme une signature) ;
//   • refuser un vrai paraphe, ou le laisser partir dans une forme que le
//     serveur rejettera quand plus personne ne pourra le refaire.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  SIGNATURE_MIN_POINTS,
  SIGNATURE_MAX_OCTETS,
  signatureExploitable,
  estDataUrlPng,
  tailleDataUrlOctets,
  signaturePresentableAuServeur,
} from '../src/services/signature.js';

/** Fabrique un tracé de n points. */
const trait = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));
/** Fabrique une dataURL PNG dont la charge base64 fait `n` caractères. */
const png = (n = 40) => `data:image/png;base64,${'A'.repeat(n)}`;

describe('signatureExploitable — le geste volontaire, pas l’accident', () => {
  it('refuse une absence de tracé', () => {
    expect(signatureExploitable([])).toBe(false);
    expect(signatureExploitable(null)).toBe(false);
    expect(signatureExploitable(undefined)).toBe(false);
    expect(signatureExploitable('signature')).toBe(false);
  });

  it('refuse un simple appui (un ou deux points)', () => {
    expect(signatureExploitable([trait(1)])).toBe(false);
    expect(signatureExploitable([trait(2)])).toBe(false);
  });

  it('refuse juste en dessous du seuil et accepte juste au-dessus', () => {
    expect(signatureExploitable([trait(SIGNATURE_MIN_POINTS - 1)])).toBe(false);
    expect(signatureExploitable([trait(SIGNATURE_MIN_POINTS)])).toBe(true);
  });

  it('additionne les tracés : un paraphe en plusieurs levers de doigt compte', () => {
    // 3 traits de 5 points = 15 points ≥ 12 : c'est une signature, même si
    // aucun trait ne franchit seul le seuil.
    expect(signatureExploitable([trait(5), trait(5), trait(5)])).toBe(true);
  });

  it('ignore une entrée mal formée au milieu sans planter', () => {
    expect(signatureExploitable([trait(6), null, trait(8)])).toBe(true);
  });
});

describe('estDataUrlPng — la forme exigée par le serveur', () => {
  it('accepte une dataURL PNG base64', () => {
    expect(estDataUrlPng(png())).toBe(true);
    expect(estDataUrlPng('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('refuse un autre type d’image', () => {
    expect(estDataUrlPng('data:image/jpeg;base64,AAAA')).toBe(false);
    expect(estDataUrlPng('data:image/svg+xml;base64,AAAA')).toBe(false);
  });

  it('refuse une charge vide, une URL nue, ou n’importe quoi d’autre', () => {
    expect(estDataUrlPng('data:image/png;base64,')).toBe(false);
    expect(estDataUrlPng('https://exemple.fr/signature.png')).toBe(false);
    expect(estDataUrlPng(null)).toBe(false);
    expect(estDataUrlPng(undefined)).toBe(false);
    expect(estDataUrlPng(42)).toBe(false);
  });

  it('refuse une charge qui n’est pas du base64', () => {
    expect(estDataUrlPng('data:image/png;base64,<<script>>')).toBe(false);
  });
});

describe('tailleDataUrlOctets — le poids RÉEL, remplissage déduit', () => {
  it('4 caractères base64 valent 3 octets', () => {
    expect(tailleDataUrlOctets('data:image/png;base64,AAAA')).toBe(3);
  });

  it('déduit le remplissage final', () => {
    expect(tailleDataUrlOctets('data:image/png;base64,AAA=')).toBe(2);
    expect(tailleDataUrlOctets('data:image/png;base64,AA==')).toBe(1);
  });

  it('vaut 0 pour ce qui n’est pas une dataURL exploitable', () => {
    expect(tailleDataUrlOctets('')).toBe(0);
    expect(tailleDataUrlOctets(null)).toBe(0);
    expect(tailleDataUrlOctets('pas-une-dataurl')).toBe(0);
    expect(tailleDataUrlOctets('data:image/png;base64,')).toBe(0);
  });
});

describe('signaturePresentableAuServeur — les deux règles ne se séparent jamais', () => {
  it('accepte un PNG sous la borne', () => {
    expect(signaturePresentableAuServeur(png(400))).toBe(true);
  });

  it('refuse un PNG au-delà de la borne serveur (200 Ko décodés)', () => {
    // 4 caractères ↦ 3 octets : il faut donc dépasser 200 000 × 4/3 caractères.
    const trop = png(Math.ceil((SIGNATURE_MAX_OCTETS + 10) * 4 / 3));
    expect(tailleDataUrlOctets(trop)).toBeGreaterThan(SIGNATURE_MAX_OCTETS);
    expect(signaturePresentableAuServeur(trop)).toBe(false);
  });

  it('refuse ce qui n’est pas un PNG, quelle que soit la taille', () => {
    expect(signaturePresentableAuServeur('data:image/jpeg;base64,AAAA')).toBe(false);
    expect(signaturePresentableAuServeur(null)).toBe(false);
  });
});
