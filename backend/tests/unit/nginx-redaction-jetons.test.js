// ═══════════════════════════════════════════════════════════════════════════
// GARDE STATIQUE — les jetons d'accès SANS COMPTE ne doivent pas s'écrire en
// clair dans les journaux nginx (correctif M-06 de la revue de sécurité PR C).
// ───────────────────────────────────────────────────────────────────────────
// La rédaction du jeton VÉHICULE existe depuis la 2.0.1, avec ce raisonnement :
// « c'est une clé d'auth physique ». Le jeton de l'encadrant technique en est
// une aussi — il ouvre pendant 60 jours, sans session, le formulaire qui fonde
// un renouvellement de CDDI — et il s'écrivait entier dans access.log.
//
// Ce test lit le fichier de configuration RÉEL et rejoue ses expressions sur
// des adresses : il tombera si quelqu'un retire une ligne du `map`, et il
// couvre les DEUX chemins (la page servie par le front et l'API qu'elle
// appelle), qu'il est facile d'oublier l'un ou l'autre.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const CONF = path.join(__dirname, '../../../deploy/nginx/nginx.conf');

/** Les expressions du bloc `map $request_uri $redacted_request_uri`. */
function motifsDeRedaction() {
  const conf = fs.readFileSync(CONF, 'utf8');
  const bloc = conf.match(/map \$request_uri \$redacted_request_uri \{([\s\S]*?)\n\s*\}/);
  expect(bloc).not.toBeNull();
  return [...bloc[1].matchAll(/"~([^"]+)"/g)].map(([, motif]) => motif
    // nginx nomme ses captures `(?<x>…)`, la syntaxe de JavaScript est la même.
    .replace(/\(\?</g, '(?<'));
}

const redige = (url) => motifsDeRedaction().some((m) => new RegExp(m).test(url));

describe('rédaction des jetons dans les access logs nginx', () => {
  const HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  test('le jeton VÉHICULE reste rédigé (non-régression 2.0.1)', () => {
    expect(redige(`/v/${HEX}`)).toBe(true);
  });

  test('le jeton de l’encadrant est rédigé sur la PAGE et sur l’API', () => {
    expect(redige(`/eti/renouvellement/${HEX}`)).toBe(true);
    expect(redige(`/api/eti/renouvellement/${HEX}`)).toBe(true);
    // Avec une chaîne de requête, la capture `rest` doit encore mordre.
    expect(redige(`/eti/renouvellement/${HEX}?src=sms`)).toBe(true);
  });

  test('une adresse sans jeton n’est pas rédigée (le journal reste lisible)', () => {
    expect(redige('/api/eti/renouvellement/zz')).toBe(false);
    expect(redige('/api/insertion/echeances')).toBe(false);
  });
});
