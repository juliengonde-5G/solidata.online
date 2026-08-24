/**
 * Géocodage adresse ↔ coordonnées.
 *
 * Source principale : la Base Adresse Nationale — service public, gratuit,
 * sans clé, et le plus précis sur le territoire de collecte.
 * Doctrine vérifiée ici : aucune coordonnée n'est devinée. Service muet →
 * `disponible: false` avec un message, jamais un résultat de remplacement.
 */
const {
  chercherAdresse, adresseDepuisCoordonnees, parseBan, parseTomtom, MAX_RESULTATS,
} = require('../../src/services/geocodage');

const REPONSE_BAN = {
  features: [
    {
      geometry: { type: 'Point', coordinates: [1.099312, 49.423145] },
      properties: {
        label: '12 Rue de la République 76000 Rouen', name: '12 Rue de la République',
        postcode: '76000', city: 'Rouen', citycode: '76540', score: 0.9721,
      },
    },
    {
      geometry: { type: 'Point', coordinates: [1.0721, 49.4501] },
      properties: {
        label: '12 Rue de la République 76770 Le Houlme', name: '12 Rue de la République',
        postcode: '76770', city: 'Le Houlme', citycode: '76366', score: 0.81,
      },
    },
  ],
};

function faussetFetch(reponses) {
  const appels = [];
  const impl = async (url) => {
    appels.push(url);
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  impl.appels = appels;
  return impl;
}
const ok = (json) => ({ ok: true, json: async () => json });

describe('parseBan', () => {
  test('extrait coordonnées, commune et code INSEE', () => {
    const r = parseBan(REPONSE_BAN);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      latitude: 49.423145, longitude: 1.099312,
      commune: 'Rouen', code_postal: '76000', code_insee: '76540', source: 'ban',
    });
  });

  test('le score de confiance est transmis TEL QUEL (l’utilisateur tranche)', () => {
    expect(parseBan(REPONSE_BAN)[0].score).toBe(0.97);
  });

  test('une adresse sans coordonnées exploitables est écartée', () => {
    const r = parseBan({ features: [{ geometry: { coordinates: ['x', null] }, properties: {} }] });
    expect(r).toHaveLength(0);
  });

  test('charge utile vide ou inattendue → tableau vide, jamais d’erreur', () => {
    expect(parseBan(null)).toEqual([]);
    expect(parseBan({})).toEqual([]);
  });
});

describe('parseTomtom', () => {
  test('normalise dans la MÊME forme que la BAN', () => {
    const r = parseTomtom({ results: [{
      position: { lat: 49.42, lon: 1.09 },
      address: { freeformAddress: '1 Rue X, 76000 Rouen', streetName: 'Rue X',
        streetNumber: '1', postalCode: '76000', municipality: 'Rouen' },
      score: 8.4,
    }] });
    expect(r[0]).toMatchObject({
      latitude: 49.42, longitude: 1.09, commune: 'Rouen',
      code_postal: '76000', source: 'tomtom',
    });
  });
});

describe('chercherAdresse', () => {
  test('requête trop courte : refusée sans appel réseau', async () => {
    const f = faussetFetch([]);
    const r = await chercherAdresse('ru', { doFetch: f });
    expect(r.disponible).toBe(false);
    expect(f.appels).toHaveLength(0);
  });

  test('la BAN répond : propositions renvoyées, aucun appel TomTom', async () => {
    const f = faussetFetch([ok(REPONSE_BAN)]);
    const r = await chercherAdresse('12 rue de la République', { doFetch: f, cleTomtom: 'K' });
    expect(r.disponible).toBe(true);
    expect(r.source).toBe('ban');
    expect(r.resultats).toHaveLength(2);
    expect(f.appels).toHaveLength(1);
    expect(f.appels[0]).toContain('api-adresse.data.gouv.fr');
  });

  test('biais géographique : la recherche est centrée sur le territoire', async () => {
    const f = faussetFetch([ok(REPONSE_BAN)]);
    await chercherAdresse('rue de la République', {
      doFetch: f, autour: { lat: 49.4231, lng: 1.0993 },
    });
    expect(f.appels[0]).toContain('lat=49.4231');
    expect(f.appels[0]).toContain('lon=1.0993');
  });

  test('BAN muette + clé TomTom : repli, et il est signalé', async () => {
    const f = faussetFetch([
      new Error('réseau'),
      ok({ results: [{ position: { lat: 49.4, lon: 1.1 }, address: { freeformAddress: 'X' } }] }),
    ]);
    const r = await chercherAdresse('12 rue de la République', { doFetch: f, cleTomtom: 'K' });
    expect(r.disponible).toBe(true);
    expect(r.source).toBe('tomtom');
    expect(f.appels[1]).toContain('api.tomtom.com');
  });

  test('les deux sources muettes : AUCUNE coordonnée inventée', async () => {
    const f = faussetFetch([new Error('réseau'), new Error('réseau')]);
    const r = await chercherAdresse('12 rue de la République', { doFetch: f, cleTomtom: 'K' });
    expect(r.disponible).toBe(false);
    expect(r.resultats).toEqual([]);
    expect(r.message).toMatch(/saisissez les coordonnées à la main/i);
  });

  test('sans clé TomTom, la BAN muette suffit à conclure', async () => {
    const f = faussetFetch([new Error('réseau')]);
    const r = await chercherAdresse('12 rue de la République', { doFetch: f });
    expect(r.disponible).toBe(false);
    expect(f.appels).toHaveLength(1);
  });

  test('nombre de propositions borné', async () => {
    const nombreux = { features: Array.from({ length: 20 }, (_, i) => ({
      geometry: { coordinates: [1 + i / 1000, 49 + i / 1000] },
      properties: { label: `Adresse ${i}`, city: 'Rouen' },
    })) };
    const r = await chercherAdresse('rue', { doFetch: faussetFetch([ok(nombreux)]) });
    expect(r.resultats.length).toBeLessThanOrEqual(MAX_RESULTATS);
  });
});

describe('adresseDepuisCoordonnees', () => {
  test('coordonnées valides : adresse retrouvée', async () => {
    const r = await adresseDepuisCoordonnees(49.4231, 1.0993, {
      doFetch: faussetFetch([ok(REPONSE_BAN)]),
    });
    expect(r.disponible).toBe(true);
    expect(r.resultat.commune).toBe('Rouen');
  });

  test('coordonnées aberrantes : refusées sans appel réseau', async () => {
    const f = faussetFetch([]);
    expect((await adresseDepuisCoordonnees(999, 1, { doFetch: f })).disponible).toBe(false);
    expect((await adresseDepuisCoordonnees('abc', 1, { doFetch: f })).disponible).toBe(false);
    expect(f.appels).toHaveLength(0);
  });

  test('aucune adresse à cet endroit : le DIT, sans en inventer une', async () => {
    const r = await adresseDepuisCoordonnees(49.4, 1.1, {
      doFetch: faussetFetch([ok({ features: [] })]),
    });
    expect(r.disponible).toBe(true);
    expect(r.resultat).toBeNull();
    expect(r.message).toMatch(/aucune adresse/i);
  });
});
