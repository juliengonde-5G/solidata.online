/**
 * Identification du point de collecte — comment le chauffeur a désigné la
 * borne, et ce qu'on en garde.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE (arbitrage client du 10/09/2026)
 *
 * Jusqu'ici, les TROIS chemins d'identification — scan du QR, choix dans la
 * liste, code saisi à la main — étaient soumis au même contrôle de présence :
 * refus au-delà de 50 m de la borne. Le contrôle est juste pour un SCAN (il
 * empêche de valider un point depuis le dépôt en photographiant un QR), il est
 * FAUX pour les deux autres : le chauffeur qui déclare « QR indisponible » le
 * fait souvent PARCE QU'IL NE PEUT PAS APPROCHER — portail fermé, benne
 * inaccessible, travaux, véhicule stationné devant. Lui refuser la déclaration
 * au motif qu'il est trop loin, c'est lui interdire de rendre compte
 * précisément de la situation qu'il signale. Le passage ressortait alors « non
 * fait » sans motif, ou n'était pas saisi du tout.
 *
 * La contrainte est donc levée sur ces deux chemins — et remplacée par une
 * TRACE : la position au moment de la déclaration est relevée et voyage avec
 * la collecte, jusqu'au compte rendu de tournée qui affiche la distance au
 * point. On ne bloque plus, on rend compte : le gestionnaire voit « QR
 * indisponible, déclaré à 180 m » et juge lui-même, avec le motif sous les
 * yeux, au lieu d'un refus opposé au chauffeur sur le terrain.
 *
 * LE SCAN GARDE SON CONTRÔLE : c'est le seul chemin où la présence est
 * revendiquée sans autre preuve que le code lu.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * La position est BEST EFFORT et ne bloque JAMAIS. GPS refusé, hors service,
 * ou trop lent : la déclaration part quand même, sans position — le compte
 * rendu écrira « position non relevée » plutôt que d'inventer un point. Un
 * chauffeur ne doit pas rester devant une borne inaccessible à attendre un
 * satellite.
 */
import { getCurrentPosition } from './geo';

// Clés localStorage — historiques (déjà lues par FillLevel et le bordereau
// déchèterie), sauf `qr_unavailable_position` ajoutée par ce chantier.
const CLE_QR = 'scanned_qr';
const CLE_MOTIF = 'qr_unavailable_reason';
const CLE_POSITION = 'qr_unavailable_position';

/** Délai maximal accordé au GPS pour la trace : au-delà, on part sans. */
const DELAI_POSITION_MS = 6000;

/** Écriture tolérante : un stockage indisponible (navigation privée, quota)
 *  ne doit jamais faire échouer une identification. */
function ecrire(cle, valeur) {
  try {
    if (valeur == null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch { /* stockage indisponible — la trace sera simplement absente */ }
}

function lire(cle) {
  try { return localStorage.getItem(cle); } catch { return null; }
}

/** Le QR a bien été lu : aucune déclaration d'indisponibilité à conserver. */
export function enregistrerScan(codeLu) {
  ecrire(CLE_QR, codeLu);
  ecrire(CLE_MOTIF, null);
  ecrire(CLE_POSITION, null);
}

/**
 * Relève la position courante pour accompagner une déclaration.
 * @returns {Promise<{lat:number,lng:number,accuracy:number|null,at:string}|null>}
 *          `null` si le GPS n'a rien donné dans le délai — jamais une erreur.
 */
export async function relevePositionDeclaration() {
  try {
    const pos = await getCurrentPosition({ timeout: DELAI_POSITION_MS });
    if (pos == null || pos.lat == null || pos.lng == null) return null;
    return {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy ?? null,
      at: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[identification] position non relevée :', err?.message || err);
    return null;
  }
}

/**
 * Le chauffeur a désigné le point SANS scanner (liste ou code manuel).
 * @param {string} codeOuReference  ce qui identifiera le point côté serveur
 * @param {'fallback'|'manual'} motif
 * @param {object|null} position    relevé de `relevePositionDeclaration`
 */
export function enregistrerQrIndisponible(codeOuReference, motif, position) {
  ecrire(CLE_QR, codeOuReference);
  ecrire(CLE_MOTIF, motif);
  ecrire(CLE_POSITION, position ? JSON.stringify(position) : null);
}

/**
 * Relit comment le point courant a été identifié.
 * @returns {{qrScanne:boolean, motif:string|null, position:object|null}}
 */
export function lireIdentification() {
  const motif = lire(CLE_MOTIF);
  let position = null;
  const brut = lire(CLE_POSITION);
  if (brut) {
    try {
      const p = JSON.parse(brut);
      // Une position illisible ou incomplète est ÉCARTÉE : mieux vaut « non
      // relevée » qu'une coordonnée partielle qui se lirait comme une mesure.
      if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
        position = { lat: Number(p.lat), lng: Number(p.lng), accuracy: p.accuracy ?? null, at: p.at || null };
      }
    } catch { /* JSON corrompu — traité comme absent */ }
  }
  return { qrScanne: !motif, motif: motif || null, position };
}

/** Nettoyage de fin de passage (appelé au retour à la carte). */
export function oublierIdentification() {
  ecrire(CLE_QR, null);
  ecrire(CLE_MOTIF, null);
  ecrire(CLE_POSITION, null);
}
