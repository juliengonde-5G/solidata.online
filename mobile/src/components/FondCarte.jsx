import { TileLayer } from 'react-leaflet';

/**
 * Fond de carte du chauffeur — source unique des tuiles de l'application
 * mobile.
 *
 * POURQUOI (28/08/2026) : la carte de tournée pointait en dur vers les tuiles
 * CARTO (`basemaps.cartocdn.com`). CARTO a fermé son accès anonyme — les
 * tuiles renvoient désormais « API Key required » à la place du plan. Sur un
 * écran de bureau c'est gênant ; dans une cabine, le chauffeur perd purement
 * et simplement sa carte.
 *
 * MÊME SOLUTION QUE LE WEB, PAS LE MÊME FICHIER : `frontend/` et `mobile/`
 * sont deux paquets npm indépendants (deux images Docker, deux builds Vite) —
 * l'un ne peut pas importer un composant de l'autre. Ce fichier est donc le
 * miroir assumé de `frontend/src/components/FondCarte.jsx` : même fournisseur,
 * même attribution, même variable d'environnement. Toute évolution de l'un
 * doit être reportée sur l'autre.
 *
 * CHOIX DU FOURNISSEUR : OpenStreetMap standard, parce qu'il ne demande AUCUNE
 * clé — donc rien à distribuer sur les téléphones des chauffeurs, et rien qui
 * expire un matin de tournée. L'usage de SOLIDATA (quelques camions, un plan
 * consulté par intermittence) reste très en deçà de la politique d'usage
 * raisonnable d'OSM.
 *
 * Une clé de tuiles TomTom peut être fournie via `VITE_TOMTOM_TILES_KEY` : le
 * fond bascule alors automatiquement. Attention, cette clé-là est PUBLIQUE par
 * construction (le navigateur la met dans l'URL des tuiles) : elle doit être
 * DÉDIÉE aux tuiles et restreinte au domaine, et surtout PAS la clé de trafic
 * `trafic.tomtom_api_key`, qui vit côté serveur et n'est jamais exposée.
 */

const TOMTOM_TILES_KEY = import.meta.env?.VITE_TOMTOM_TILES_KEY || '';

export const FOND_ATTRIBUTION = TOMTOM_TILES_KEY
  ? '&copy; <a href="https://tomtom.com" target="_blank" rel="noreferrer">TomTom</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const URL_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const URL_TOMTOM = `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${TOMTOM_TILES_KEY}`;

/** Le fond employé, nommé — pratique pour l'afficher dans un écran de réglages. */
export const FOND_NOM = TOMTOM_TILES_KEY ? 'TomTom' : 'OpenStreetMap';

export default function FondCarte(props) {
  return (
    <TileLayer
      url={TOMTOM_TILES_KEY ? URL_TOMTOM : URL_OSM}
      attribution={FOND_ATTRIBUTION}
      maxZoom={19}
      {...props}
    />
  );
}
