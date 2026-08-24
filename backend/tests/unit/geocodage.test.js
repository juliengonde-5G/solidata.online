/**
 * Géocodage : une adresse → des coordonnées GPS.
 *
 * Source : la Base Adresse Nationale — service public, gratuit, sans clé.
 * Doctrine vérifiée ici : aucune coordonnée n'est devinée. Service muet →
 * `disponible: false` avec un message, jamais un résultat de remplacement.
 */
const { chercherAdresse, parseBan, MAX_RESULTATS } = require('../../src/services/geocodage');

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
  test('extrait les coordonnées, la commune et le code INSEE', () => {
    const r = parseBan(REPONSE_BAN);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      latitude: 49.423145, longitude: 1.099312,
      commune: 'Rouen', code_postal: '76000', code_insee: '76540',
    });
  });

  test('le score de confiance est transmis TEL QUEL (l’utilisateur tranche)', () => {
    expect(parseBan(REPONSE_BAN)[0].score).toBe(0.97);
  });

  test('une adresse sans coordonnées exploitables est écartée', () => {
    expect(parseBan({ features: [{ geometry: { coordinates: ['x', null] }, properties: {} }] }))
      .toHaveLength(0);
  });

  test('charge utile vide ou inattendue → tableau vide, jamais d’erreur', () => {
    expect(parseBan(null)).toEqual([]);
    expect(parseBan({})).toEqual([]);
  });
});

describe('chercherAdresse', () => {
  test('requête trop courte : refusée sans appel réseau', async () => {
    const f = faussetFetch([]);
    const r = await chercherAdresse('ru', { doFetch: f });
    expect(r.disponible).toBe(false);
    expect(f.appels).toHaveLength(0);
  });

  test('adresse trouvée : coordonnées renvoyées', async () => {
    const f = faussetFetch([ok(REPONSE_BAN)]);
    const r = await chercherAdresse('12 rue de la République', { doFetch: f });
    expect(r.disponible).toBe(true);
    expect(r.resultats).toHaveLength(2);
    expect(r.resultats[0].latitude).toBe(49.423145);
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

  test('aucune adresse ne correspond : le DIT, sans en inventer une', async () => {
    const r = await chercherAdresse('zzzzz', { doFetch: faussetFetch([ok({ features: [] })]) });
    expect(r.disponible).toBe(true);
    expect(r.resultats).toEqual([]);
    expect(r.message).toMatch(/aucune adresse/i);
  });

  test('service muet : AUCUNE coordonnée inventée', async () => {
    const r = await chercherAdresse('12 rue de la République', {
      doFetch: faussetFetch([new Error('réseau')]),
    });
    expect(r.disponible).toBe(false);
    expect(r.resultats).toEqual([]);
    expect(r.message).toMatch(/saisissez les coordonnées à la main/i);
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
