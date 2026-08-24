// ══════════════════════════════════════════════════════════════════════════
// GÉOCODAGE — adresse ↔ coordonnées
// ══════════════════════════════════════════════════════════════════════════
//
// SOURCE PRINCIPALE : la Base Adresse Nationale (api-adresse.data.gouv.fr).
// Service public français, gratuit, SANS clé et sans quota à surveiller, et
// de très loin le plus précis sur les adresses françaises — c'est tout le
// territoire de collecte. Même famille d'API que geo.api.gouv.fr, déjà
// utilisée pour le référentiel des communes.
//
// REPLI : TomTom, uniquement si la BAN ne répond pas ET qu'une clé est déjà
// configurée (le géocodage TomTom dispose de 20 000 appels/mois en offre
// gratuite ; l'usage réel ici — créer un lieu, corriger une borne — se compte
// en dizaines par mois).
//
// DOCTRINE : aucune coordonnée n'est devinée. Si les deux sources se taisent,
// on renvoie `disponible: false` avec un message clair, et l'utilisateur
// saisit les coordonnées à la main comme aujourd'hui.

const BAN_URL = 'https://api-adresse.data.gouv.fr';
const TOMTOM_GEO = 'https://api.tomtom.com/search/2';
const TIMEOUT_MS = parseInt(process.env.GEOCODAGE_TIMEOUT_MS, 10) || 5000;
/** Nombre maximal de propositions renvoyées à l'écran. */
const MAX_RESULTATS = 5;

async function fetchAvecDelai(url, doFetch = fetch) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    return await doFetch(url, { signal: controleur.signal });
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Normalise une réponse BAN en propositions exploitables (fonction PURE).
 * @returns {Array<{libelle, adresse, code_postal, commune, code_insee, latitude, longitude, score, source}>}
 */
function parseBan(data) {
  const features = data && Array.isArray(data.features) ? data.features : [];
  return features.map((f) => {
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || [];
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      libelle: p.label || [p.name, p.postcode, p.city].filter(Boolean).join(' '),
      adresse: p.name || null,
      code_postal: p.postcode || null,
      commune: p.city || null,
      code_insee: p.citycode || null,
      latitude: Math.round(lat * 1e6) / 1e6,
      longitude: Math.round(lng * 1e6) / 1e6,
      // Score de confiance rendu par la BAN, transmis TEL QUEL : c'est à
      // l'utilisateur de trancher entre deux propositions proches.
      score: Number.isFinite(Number(p.score)) ? Math.round(Number(p.score) * 100) / 100 : null,
      source: 'ban',
    };
  }).filter(Boolean).slice(0, MAX_RESULTATS);
}

/** Normalise une réponse TomTom Search (fonction PURE). */
function parseTomtom(data) {
  const results = data && Array.isArray(data.results) ? data.results : [];
  return results.map((r) => {
    const lat = Number(r.position?.lat);
    const lng = Number(r.position?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const a = r.address || {};
    return {
      libelle: a.freeformAddress || [a.streetName, a.postalCode, a.municipality].filter(Boolean).join(' '),
      adresse: a.streetName ? [a.streetNumber, a.streetName].filter(Boolean).join(' ') : null,
      code_postal: a.postalCode || null,
      commune: a.municipality || null,
      code_insee: null,
      latitude: Math.round(lat * 1e6) / 1e6,
      longitude: Math.round(lng * 1e6) / 1e6,
      score: Number.isFinite(Number(r.score)) ? Math.round(Number(r.score) * 100) / 100 : null,
      source: 'tomtom',
    };
  }).filter(Boolean).slice(0, MAX_RESULTATS);
}

/**
 * Adresse → coordonnées.
 * @param {string} requete
 * @param {object} [opts] { doFetch, cleTomtom, autour: {lat, lng} }
 */
async function chercherAdresse(requete, opts = {}) {
  const q = String(requete || '').trim();
  if (q.length < 3) {
    return { disponible: false, message: 'Saisissez au moins trois caractères.', resultats: [] };
  }
  const doFetch = opts.doFetch || fetch;

  try {
    const params = new URLSearchParams({ q, limit: String(MAX_RESULTATS) });
    // Biais géographique : à requête ambiguë (« rue de la République »), les
    // adresses proches du territoire de collecte remontent en premier.
    if (opts.autour && Number.isFinite(opts.autour.lat)) {
      params.set('lat', String(opts.autour.lat));
      params.set('lon', String(opts.autour.lng));
    }
    const rep = await fetchAvecDelai(`${BAN_URL}/search/?${params}`, doFetch);
    if (rep.ok) {
      const resultats = parseBan(await rep.json());
      if (resultats.length > 0) return { disponible: true, source: 'ban', resultats };
      return { disponible: true, source: 'ban', resultats: [], message: 'Aucune adresse trouvée.' };
    }
  } catch (err) {
    console.warn('[GÉOCODAGE] BAN indisponible :', err.message);
  }

  if (opts.cleTomtom) {
    try {
      const params = new URLSearchParams({ key: opts.cleTomtom, limit: String(MAX_RESULTATS), countrySet: 'FR' });
      const rep = await fetchAvecDelai(
        `${TOMTOM_GEO}/geocode/${encodeURIComponent(q)}.json?${params}`, doFetch);
      if (rep.ok) return { disponible: true, source: 'tomtom', resultats: parseTomtom(await rep.json()) };
    } catch (err) {
      console.warn('[GÉOCODAGE] TomTom indisponible :', err.message);
    }
  }

  return {
    disponible: false,
    resultats: [],
    message: "Service de recherche d'adresse indisponible — saisissez les coordonnées à la main.",
  };
}

/**
 * Coordonnées → adresse.
 * @param {number} lat
 * @param {number} lng
 * @param {object} [opts] { doFetch, cleTomtom }
 */
async function adresseDepuisCoordonnees(lat, lng, opts = {}) {
  const la = parseFloat(lat);
  const lo = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    return { disponible: false, message: 'Coordonnées invalides.', resultat: null };
  }
  const doFetch = opts.doFetch || fetch;

  try {
    const rep = await fetchAvecDelai(`${BAN_URL}/reverse/?lat=${la}&lon=${lo}`, doFetch);
    if (rep.ok) {
      const resultats = parseBan(await rep.json());
      if (resultats.length > 0) return { disponible: true, source: 'ban', resultat: resultats[0] };
      return { disponible: true, source: 'ban', resultat: null, message: 'Aucune adresse à cet endroit.' };
    }
  } catch (err) {
    console.warn('[GÉOCODAGE] BAN inverse indisponible :', err.message);
  }

  if (opts.cleTomtom) {
    try {
      const rep = await fetchAvecDelai(
        `${TOMTOM_GEO}/reverseGeocode/${la},${lo}.json?key=${encodeURIComponent(opts.cleTomtom)}`, doFetch);
      if (rep.ok) {
        const data = await rep.json();
        const a = data?.addresses?.[0]?.address;
        if (a) {
          return {
            disponible: true, source: 'tomtom',
            resultat: {
              libelle: a.freeformAddress || null,
              adresse: a.streetName ? [a.streetNumber, a.streetName].filter(Boolean).join(' ') : null,
              code_postal: a.postalCode || null,
              commune: a.municipality || null,
              code_insee: null,
              latitude: la, longitude: lo, score: null, source: 'tomtom',
            },
          };
        }
      }
    } catch (err) {
      console.warn('[GÉOCODAGE] TomTom inverse indisponible :', err.message);
    }
  }

  return {
    disponible: false, resultat: null,
    message: "Service d'adresse indisponible — saisissez l'adresse à la main.",
  };
}

module.exports = {
  chercherAdresse, adresseDepuisCoordonnees,
  parseBan, parseTomtom, MAX_RESULTATS, BAN_URL,
};
