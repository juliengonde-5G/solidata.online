import { TileLayer } from 'react-leaflet';

/**
 * Fond de carte — SOURCE UNIQUE de toutes les cartes de l'application.
 *
 * POURQUOI CE COMPOSANT (28/08/2026) : les sept cartes du logiciel pointaient
 * chacune, en dur, vers les tuiles CARTO (`basemaps.cartocdn.com`). CARTO a
 * fermé son accès anonyme : les cartes affichent désormais « API Key required »
 * à la place du plan. Sept URL identiques recopiées, c'est sept endroits à
 * corriger le jour où le fournisseur change ses règles — d'où cette source
 * unique, sur le modèle de `utils/tours.js` et `utils/incidents.js`.
 *
 * CHOIX DU FOURNISSEUR : OpenStreetMap standard par défaut, parce qu'il ne
 * demande AUCUNE clé et fonctionne donc immédiatement, sans compte à ouvrir ni
 * secret à distribuer au navigateur. L'usage de SOLIDATA (quelques postes de
 * gestion, un plan consulté par intermittence) reste très en deçà de la
 * politique d'usage raisonnable d'OSM.
 *
 * Une clé de tuiles TomTom peut être fournie via `VITE_TOMTOM_TILES_KEY` : le
 * fond bascule alors automatiquement. Attention, cette clé-là est PUBLIQUE par
 * construction (le navigateur la met dans l'URL des tuiles) : elle doit être
 * une clé DÉDIÉE aux tuiles, restreinte au domaine, et surtout PAS la clé de
 * trafic `trafic.tomtom_api_key`, qui vit côté serveur et n'est jamais exposée.
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
