// Codification des étiquettes carton — SOURCE UNIQUE (2.57.0, demande client du 23/09/2026).
//
// NOUVEAU FORMAT (« v2 ») — 13 caractères hexadécimaux, lus dans l'ordre du
// parcours de saisie : Gamme → Catégorie → Produit → Genre → Saison → Référence.
//
//     G  C  PP  NN  S  RRRRRR
//     │  │  │   │   │  └── référence UNIQUE du colis (séquence globale, 6 hex = 16,7 M cartons)
//     │  │  │   │   └───── saison      (1 hex : 0 = Sans Saison)
//     │  │  │   └───────── genre       (2 hex : 00 = Sans Genre)
//     │  │  └───────────── produit     (2 hex)
//     │  └──────────────── catégorie   (1 hex)
//     └─────────────────── gamme       (1 hex)
//
// Exemple : gamme VAK (3), Textiles (1), produit 0x2A, Adulte Femme (02), Hiver (2),
// colis n° 31 → « 312A02200001F ».
//
// POURQUOI la référence porte seule l'unicité : les cinq premiers champs DÉCRIVENT
// le carton (on lit le produit sans base de données), la référence l'IDENTIFIE.
// Deux cartons identiques ne diffèrent que par elle — et c'est elle, pas le reste
// du code, qu'une séquence PostgreSQL garantit unique, même avec plusieurs postes
// qui impriment en même temps.
//
// COHABITATION avec l'ancienne codification : aucun code v2 ne commence par « P »
// (lettre hors de l'alphabet hexadécimal), alors que TOUS les anciens codes en
// commencent par un. Les deux familles ne peuvent donc jamais se confondre, et
// les anciens codes restent lus tels quels, sans conversion.
//
// Anciens formats recensés dans le fichier de stock (Dashboard 2026, 14 387 cartons) :
//   • P + poste + 4 caractères base 24   « P10AAH »            (formule Excel BASE(n;24))
//   • P + poste + 3 caractères base 24   « P1115 »             (premières étiquettes, compteur non complété)
//   • P + poste + AAMMJJhhmmss            « P1250320155908 »    (étiquettes horodatées, printemps 2025)
//   • PF-<millisecondes>                   (kiosque balance SOLIDATA)

const HEX = /^[0-9A-F]+$/;
const LARGEURS = { gamme: 1, categorie: 1, produit: 2, genre: 2, saison: 1, reference: 6 };
const LONGUEUR_V2 = Object.values(LARGEURS).reduce((a, b) => a + b, 0); // 13
const REFERENCE_MAX = 16 ** LARGEURS.reference - 1;

function hex(n, largeur, champ) {
  if (!Number.isInteger(n) || n < 0 || n > 16 ** largeur - 1) {
    throw new Error(`Code ${champ} hors bornes (${n}) : 0..${16 ** largeur - 1}`);
  }
  return n.toString(16).toUpperCase().padStart(largeur, '0');
}

/** Compose le code v2 à partir des codes numériques de chaque dimension. */
function composerCode({ gamme, categorie, produit, genre, saison, reference }) {
  return hex(gamme, LARGEURS.gamme, 'gamme')
    + hex(categorie, LARGEURS.categorie, 'catégorie')
    + hex(produit, LARGEURS.produit, 'produit')
    + hex(genre, LARGEURS.genre, 'genre')
    + hex(saison, LARGEURS.saison, 'saison')
    + hex(reference, LARGEURS.reference, 'référence');
}

/** Décompose un code v2 (déjà normalisé) en codes numériques, ou null. */
function decomposerCodeV2(code) {
  if (typeof code !== 'string' || code.length !== LONGUEUR_V2 || !HEX.test(code)) return null;
  const out = {};
  let i = 0;
  for (const [champ, largeur] of Object.entries(LARGEURS)) {
    out[champ] = parseInt(code.slice(i, i + largeur), 16);
    i += largeur;
  }
  return out;
}

/** Forme lisible imprimée sous le code-barres : « 3-1-2A-02-2-00001F ». */
function formeLisible(code) {
  if (!decomposerCodeV2(code)) return code;
  const parts = [];
  let i = 0;
  for (const largeur of Object.values(LARGEURS)) { parts.push(code.slice(i, i + largeur)); i += largeur; }
  return parts.join('-');
}

// ── Lecture d'un scan ────────────────────────────────────────────────────────
// Une douchette paramétrée en QWERTY branchée sur un poste AZERTY tape la rangée
// du haut SANS majuscule : « 1 » devient « & », « 0 » devient « à »… et le « A »
// devient « Q ». Le code lu est alors inconnu alors que le carton existe. On ne
// corrige QUE si le texte porte au moins un de ces caractères, impossibles dans
// un code réel : un code propre n'est jamais retouché.
const RANGEE_AZERTY = { '&': '1', 'é': '2', '"': '3', "'": '4', '(': '5', '-': '6', 'è': '7', '_': '8', 'ç': '9', 'à': '0' };
const SIGNES_AZERTY = /[&é"'(èçà_]/;

function normaliserScan(brut) {
  if (brut === null || brut === undefined) return '';
  // Caractères de contrôle et espaces (préfixes/suffixes de douchette, CR/LF, tabulations).
  let s = String(brut).replace(/[\s\u0000-\u001F\u007F]/g, '');
  if (!s) return '';
  // Le tiret est légitime dans « PF-… » : la correction AZERTY n'est tentée que
  // si un signe SANS ambiguïté est présent.
  if (SIGNES_AZERTY.test(s)) {
    s = s.split('').map((ch) => {
      if (RANGEE_AZERTY[ch]) return RANGEE_AZERTY[ch];
      if (ch === 'q' || ch === 'Q') return 'A';
      if (ch === ',') return 'M';
      return ch;
    }).join('');
  }
  return s.toUpperCase();
}

/**
 * Identifie le format d'un code (après normalisation) et en extrait ce qui peut
 * l'être sans base de données. Ne dit JAMAIS qu'un code existe : seule la base le sait.
 * @returns {{ normalise: string, format: 'v2'|'ancien_base24'|'ancien_horodate'|'balance'|'inconnu', details: object|null }}
 */
function analyserCode(brut) {
  const normalise = normaliserScan(brut);
  const v2 = decomposerCodeV2(normalise);
  if (v2) return { normalise, format: 'v2', details: v2 };

  let m = /^P([0-9])([0-9A-N]{3,4})$/.exec(normalise);
  if (m) return { normalise, format: 'ancien_base24', details: { poste: Number(m[1]) } };

  m = /^P([0-9])(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(normalise);
  if (m) {
    const [, poste, aa, mo, jj, hh, mi, ss] = m.map((x, i) => (i === 0 ? x : Number(x)));
    const valide = mo >= 1 && mo <= 12 && jj >= 1 && jj <= 31 && hh <= 23 && mi <= 59 && ss <= 59;
    if (valide) {
      return {
        normalise,
        format: 'ancien_horodate',
        details: { poste, horodatage: `20${String(aa).padStart(2, '0')}-${String(mo).padStart(2, '0')}-${String(jj).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(ss).padStart(2, '0')}` },
      };
    }
  }

  if (/^PF-\d+$/.test(normalise)) return { normalise, format: 'balance', details: null };

  return { normalise, format: 'inconnu', details: null };
}

const LIBELLES_FORMAT = {
  v2: 'Nouvelle codification',
  ancien_base24: 'Ancienne codification (compteur de poste)',
  ancien_horodate: 'Ancienne codification (horodatée)',
  balance: 'Kiosque balance',
  inconnu: 'Format non reconnu',
};

module.exports = {
  LARGEURS, LONGUEUR_V2, REFERENCE_MAX, LIBELLES_FORMAT,
  composerCode, decomposerCodeV2, formeLisible, normaliserScan, analyserCode,
};
