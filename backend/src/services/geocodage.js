// ══════════════════════════════════════════════════════════════════════════
// GÉOCODAGE — une adresse en coordonnées GPS
// ══════════════════════════════════════════════════════════════════════════
//
// Sert les formulaires de saisie de lieux : on tape une adresse, on récupère
// la latitude et la longitude, au lieu d'aller les chercher sur un autre site.
//
// SOURCE : la Base Adresse Nationale (api-adresse.data.gouv.fr). Service
// public français, gratuit, SANS clé et sans quota à surveiller. Même famille
// d'API que geo.api.gouv.fr, déjà utilisée pour le référentiel des communes.
//
// DOCTRINE : aucune coordonnée n'est devinée. Si le service ne répond pas, on
// renvoie `disponible: false` avec un message clair, et l'utilisateur saisit
// les coordonnées à la main comme aujourd'hui.

const BAN_URL = 'https://api-adresse.data.gouv.fr';
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
 * @returns {Array<{libelle, adresse, code_postal, commune, code_insee, latitude, longitude, score}>}
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
    };
  }).filter(Boolean).slice(0, MAX_RESULTATS);
}

/**
 * Adresse → coordonnées.
 * @param {string} requete
 * @param {object} [opts] { doFetch, autour: {lat, lng} }
 */
async function chercherAdresse(requete, opts = {}) {
  const q = String(requete || '').trim();
  if (q.length < 3) {
    return { disponible: false, message: 'Saisissez au moins trois caractères.', resultats: [] };
  }

  try {
    const params = new URLSearchParams({ q, limit: String(MAX_RESULTATS) });
    // Biais géographique : à requête ambiguë (« rue de la République »), les
    // adresses proches du territoire de collecte remontent en premier.
    if (opts.autour && Number.isFinite(opts.autour.lat)) {
      params.set('lat', String(opts.autour.lat));
      params.set('lon', String(opts.autour.lng));
    }
    const rep = await fetchAvecDelai(`${BAN_URL}/search/?${params}`, opts.doFetch || fetch);
    if (rep.ok) {
      const resultats = parseBan(await rep.json());
      return {
        disponible: true,
        resultats,
        message: resultats.length === 0 ? 'Aucune adresse trouvée.' : undefined,
      };
    }
  } catch (err) {
    console.warn('[GÉOCODAGE] Base Adresse Nationale indisponible :', err.message);
  }

  return {
    disponible: false,
    resultats: [],
    message: "Recherche d'adresse indisponible — saisissez les coordonnées à la main.",
  };
}

module.exports = { chercherAdresse, parseBan, MAX_RESULTATS, BAN_URL };
