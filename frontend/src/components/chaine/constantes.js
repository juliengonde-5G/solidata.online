/**
 * constantes.js — vocabulaire et règles PURES du configurateur 2D de chaîne.
 *
 * Aucune dépendance React ni réseau : ce qui est ici est calculable et
 * vérifiable sans écran, et partagé par le canevas, la palette et le panneau
 * de propriétés (une seule définition de « ce qu'est un poste »).
 */

/** Les trois natures de bloc du plan (miroir du CHECK en base). */
export const CATEGORIES = [
  {
    valeur: 'poste',
    libelle: 'Poste de travail',
    description: 'Un emplacement tenu par un ou plusieurs opérateurs.',
    porteEffectif: true,
    couleurDefaut: '#2D8C4E',
  },
  {
    valeur: 'zone_depose',
    libelle: 'Zone de dépose',
    description: 'Un contenant ou une sortie de matière — personne n’y est affecté.',
    porteEffectif: false,
    couleurDefaut: '#0891B2',
  },
  {
    valeur: 'entree',
    libelle: 'Entrée de matière',
    description: 'L’arrivée d’original à trier sur la ligne.',
    porteEffectif: false,
    couleurDefaut: '#F59E0B',
  },
];

export const categorieMeta = (valeur) =>
  CATEGORIES.find((c) => c.valeur === valeur) || CATEGORIES[0];

/** Palette de couleurs proposée (stockée dans `proprietes.couleur`). */
export const COULEURS = [
  { valeur: '#2D8C4E', libelle: 'Vert Solidata' },
  { valeur: '#0891B2', libelle: 'Recyclage' },
  { valeur: '#7C3AED', libelle: 'Réemploi' },
  { valeur: '#F59E0B', libelle: 'Entrée' },
  { valeur: '#64748B', libelle: 'Déchets' },
  { valeur: '#DC2626', libelle: 'Point d’attention' },
];

/** Pas de la grille magnétique, en pourcentage de canevas. */
export const PAS_GRILLE = 1;

/** Tailles par défaut d'un bloc neuf, en pourcentage de canevas. */
export const TAILLE_DEFAUT = {
  poste: { largeur: 10, hauteur: 11 },
  zone_depose: { largeur: 7, hauteur: 9 },
  entree: { largeur: 9, hauteur: 10 },
};

export const TAILLE_MIN = 3;

/** Rapport largeur/hauteur du canevas, calé sur le plan V7 imprimé. */
export const RATIO_CANEVAS = 2.25;

/** Arrondit une valeur au pas de grille (ou au centième si l'aimant est levé). */
export function aimanter(valeur, aimantActif, pas = PAS_GRILLE) {
  if (!aimantActif) return Math.round(valeur * 100) / 100;
  return Math.round(valeur / pas) * pas;
}

/** Maintient un bloc entièrement dans le canevas. */
export function borner(valeur, taille) {
  const max = Math.max(0, 100 - (Number(taille) || 0));
  return Math.min(max, Math.max(0, Math.round(valeur * 100) / 100));
}

/**
 * Effectif mobilisé par un plan : somme des effectifs MAXIMUM des postes de
 * travail actifs. Miroir exact de la règle serveur — les deux doivent dire la
 * même chose, sinon l'écran annonce un compte que l'enregistrement dément.
 */
export function effectifTotal(blocs) {
  return (blocs || [])
    .filter((b) => b.categorie === 'poste' && b.actif !== false)
    .reduce((somme, b) => somme + (Number(b.effectif_max) || 0), 0);
}

/** Slug majuscule utilisable comme code de bloc. */
export function slugCode(texte) {
  return String(texte || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'BLOC';
}

/** Code unique dans le plan : `base`, puis `base_2`, `base_3`… */
export function genererCode(base, codesExistants) {
  const pris = new Set(codesExistants || []);
  const racine = slugCode(base);
  if (!pris.has(racine)) return racine;
  let n = 2;
  while (pris.has(`${racine}_${n}`) && n < 999) n += 1;
  return `${racine}_${n}`;
}

/**
 * Contrôles locaux AVANT l'appel serveur — mêmes règles que `normaliserBloc`
 * côté backend. Le serveur reste l'autorité ; ceci évite d'envoyer un plan
 * qu'on sait déjà refusé et de perdre le travail de l'utilisateur.
 * @returns {string[]} messages d'anomalie (vide si le plan est enregistrable)
 */
export function verifierPlan(blocs) {
  const anomalies = [];
  const vus = new Map();
  (blocs || []).forEach((b, i) => {
    const ou = b.libelle ? `« ${b.libelle} »` : `bloc n° ${i + 1}`;
    if (!b.code || !/^[A-Z0-9_]+$/.test(b.code)) {
      anomalies.push(`${ou} : code manquant ou invalide (lettres, chiffres et « _ » seulement).`);
    } else if (vus.has(b.code)) {
      anomalies.push(`Code en double : « ${b.code} » (${ou} et « ${vus.get(b.code)} »).`);
    } else {
      vus.set(b.code, b.libelle || `bloc n° ${i + 1}`);
    }
    if (!String(b.libelle || '').trim()) anomalies.push(`${ou} : libellé obligatoire.`);
    const mn = Number(b.effectif_min); const mx = Number(b.effectif_max);
    if (!Number.isInteger(mn) || mn < 0 || !Number.isInteger(mx) || mx < 0) {
      anomalies.push(`${ou} : les effectifs doivent être des entiers positifs ou nuls.`);
    } else if (mn > mx) {
      anomalies.push(`${ou} : effectif minimum (${mn}) supérieur au maximum (${mx}).`);
    }
  });
  return anomalies;
}

/** Bloc neuf, prêt à être posé au centre du canevas. */
export function blocNeuf(categorie, codesExistants, position = {}) {
  const meta = categorieMeta(categorie);
  const taille = TAILLE_DEFAUT[categorie] || TAILLE_DEFAUT.poste;
  const libelle = categorie === 'poste' ? 'Nouveau poste'
    : categorie === 'entree' ? 'Nouvelle entrée' : 'Nouvelle zone';
  return {
    code: genererCode(libelle, codesExistants),
    libelle,
    categorie,
    x: borner(position.x ?? 45, taille.largeur),
    y: borner(position.y ?? 45, taille.hauteur),
    largeur: taille.largeur,
    hauteur: taille.hauteur,
    obligatoire: false,
    actif: true,
    effectif_min: meta.porteEffectif ? 1 : 0,
    effectif_max: meta.porteEffectif ? 1 : 0,
    poste_operation_id: null,
    proprietes: { couleur: meta.couleurDefaut },
  };
}
