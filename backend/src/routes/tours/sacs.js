// Sacs collectés chez une association : dérivation du niveau de remplissage et
// répartition du poids pesé.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Le camion est pesé au centre de tri, jamais point par point. Jusqu'ici, la
// clôture d'une tournée répartissait donc le poids total À PARTS ÉGALES entre
// les points collectés — faute de mieux, et le commentaire de
// `completion-effects.js` l'assumait comme tel. Sur une tournée qui ramasse
// deux sacs chez l'une et quarante chez l'autre, cette moyenne écrit dans
// l'historique deux chiffres également faux, et c'est cet historique qui nourrit
// ensuite la prédiction de remplissage et la carte des associations.
//
// Le nombre de sacs déclaré par l'équipage au départ de chaque association
// (demande client d'août 2026) donne enfin une clé de répartition JUSTE :
//     poids d'un sac = poids total pesé ÷ total des sacs de la tournée
//     poids d'un point = ses sacs × poids d'un sac
// C'est une estimation — les sacs n'ont pas tous le même poids — mais elle
// repose sur une observation de terrain, là où la moyenne n'en avait aucune.
//
// MODULE PUR : aucune écriture, aucun accès base hors `lireBornesSacs`, qui ne
// fait que LIRE un réglage. Tout le reste se teste sans PostgreSQL.
const pool = require('../../config/database');

/**
 * Bornes de conversion « nombre de sacs → niveau 0-4 », valeurs par DÉFAUT.
 *
 * Lues comme des seuils d'entrée dans le niveau : 0 sac = niveau 0, à partir de
 * 1 sac niveau 1, à partir de 6 niveau 2, de 16 niveau 3, de 31 niveau 4.
 *
 * Ces nombres sont un POINT DE DÉPART, pas une règle : ils sont exposés dans
 * `settings` sous la clé `collecte.assoc_sacs_niveaux` et l'exploitation les
 * ajuste sans toucher au code (le volume d'un sac varie d'une structure à
 * l'autre). D'où l'interdiction d'écrire ces valeurs ailleurs qu'ici.
 */
const BORNES_DEFAUT = [1, 6, 16, 31];

/** Clé de réglage. Une seule occurrence dans tout le dépôt : celle-ci. */
const CLE_REGLAGE = 'collecte.assoc_sacs_niveaux';

// Un sac est une unité de manutention : quelques dizaines par association, pas
// plus. Le plafond ne sert qu'à rejeter une saisie manifestement erronée (doigt
// resté appuyé, valeur injectée) — il est volontairement très large pour ne
// jamais refuser un chargement réel.
const MAX_SACS = 5000;

/** Cache mémoire des bornes (même durée que les réglages d'arrêts GPS). */
const CACHE_TTL_MS = 60 * 1000;
let cacheBornes = { value: null, at: 0 };

/**
 * Nombre de sacs exploitable, ou `null`.
 *
 * DISTINCTION CARDINALE, qui justifie à elle seule que la colonne soit
 * nullable : `null` = « non déclaré » (tournée antérieure, application mobile
 * pas à jour, point marqué collecté depuis le back-office) ; `0` = « déclaré,
 * rien chargé ». Les confondre reviendrait à faire dire à un silence qu'il n'y
 * avait rien — et à sortir ce point de la répartition du poids.
 *
 * N'accepte que des entiers positifs : un demi-sac ne se compte pas, et une
 * valeur négative n'a aucun sens physique.
 */
function nbSacsValide(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n < 0 || n > MAX_SACS) return null;
  return n;
}

/**
 * Bornes utilisables, ou les défauts documentés.
 *
 * Accepte un tableau ou la chaîne JSON telle qu'elle est stockée en `settings`.
 * Exige 1 à 4 seuils entiers ≥ 1 STRICTEMENT croissants : deux seuils égaux
 * rendraient un niveau inatteignable, et un seuil à 0 empêcherait « rien
 * collecté » d'exister. Toute autre forme retombe sur les défauts — un réglage
 * mal saisi ne doit pas casser la clôture d'une tournée.
 *
 * Le plafond de 4 seuils n'est pas décoratif : le niveau alimente
 * `association_learning_feedback`, que le moteur de prédiction relit en
 * normalisant `(niveau / 4) × 100`. Un cinquième niveau produirait des taux de
 * remplissage supérieurs à 100 % sans que rien ne le signale.
 */
function normaliserBornes(brut) {
  let val = brut;
  if (typeof val === 'string') {
    try { val = JSON.parse(val); } catch { return [...BORNES_DEFAUT]; }
  }
  if (!Array.isArray(val) || val.length < 1 || val.length > 4) return [...BORNES_DEFAUT];
  const b = val.map((x) => (typeof x === 'number' ? x : Number(x)));
  for (let i = 0; i < b.length; i += 1) {
    if (!Number.isInteger(b[i]) || b[i] < 1 || b[i] > MAX_SACS) return [...BORNES_DEFAUT];
    if (i > 0 && b[i] <= b[i - 1]) return [...BORNES_DEFAUT];
  }
  return b;
}

/**
 * Niveau de remplissage 0-4 DÉRIVÉ du nombre de sacs.
 *
 * Pourquoi conserver un niveau alors qu'on a mieux : `fill_level` est la
 * colonne que lit l'apprentissage association depuis toujours
 * (`association_learning_feedback`, puis `predictAssociationFillRate`).
 * L'abandonner ferait repartir le modèle de zéro et rendrait l'historique
 * existant incomparable au nouveau. Le niveau reste donc la monnaie du moteur —
 * il cesse simplement d'être DEVINÉ par le chauffeur pour être CALCULÉ à partir
 * de ce qu'il a réellement compté.
 *
 * @param {number|string|null} nbSacs
 * @param {number[]|string} [bornes] seuils d'entrée dans chaque niveau
 * @returns {number|null} 0-4, ou `null` si aucun nombre de sacs n'est déclaré
 */
function niveauDepuisSacs(nbSacs, bornes = BORNES_DEFAUT) {
  const n = nbSacsValide(nbSacs);
  if (n === null) return null;
  const b = normaliserBornes(bornes);
  let niveau = 0;
  for (let i = 0; i < b.length; i += 1) {
    if (n >= b[i]) niveau = i + 1;
  }
  return niveau;
}

/**
 * Lit les bornes en base (cache 60 s). Résilient : table absente, réglage
 * manquant ou illisible → défauts documentés, jamais d'échec propagé.
 */
async function lireBornesSacs(db = pool) {
  const now = Date.now();
  if (cacheBornes.value && now - cacheBornes.at < CACHE_TTL_MS) return cacheBornes.value;
  let valeurs = [...BORNES_DEFAUT];
  try {
    const r = await db.query('SELECT value FROM settings WHERE key = $1', [CLE_REGLAGE]);
    if (r.rows.length > 0) valeurs = normaliserBornes(r.rows[0].value);
  } catch (err) {
    console.warn('[TOURS] Bornes « sacs → niveau » illisibles, défauts appliqués :', err.message);
  }
  cacheBornes = { value: valeurs, at: now };
  return valeurs;
}

/** Vide le cache (tests, changement de réglage à chaud). */
function resetBornesCache() {
  cacheBornes = { value: null, at: 0 };
}

/**
 * Répartit un poids pesé entre les points collectés — AU PRORATA DES SACS quand
 * la tournée les a déclarés, à parts égales sinon.
 *
 * FONCTION PURE : elle ne lit ni n'écrit rien. Elle est la source UNIQUE de la
 * règle de répartition, partagée par la clôture de tournée (qui écrit
 * l'historique) et par le compte rendu (qui l'affiche) — les deux doivent dire
 * la même chose, sans quoi le rapport contredirait la base.
 *
 * TROIS REPLIS, chacun NOMMÉ — jamais silencieux :
 *
 *  1. Aucun point ne déclare ses sacs. Cas normal des tournées antérieures et
 *     des applications mobiles pas encore à jour : le comportement historique
 *     est conservé à l'identique.
 *
 *  2. Déclaration INCOMPLÈTE (certains points déclarent, d'autres non). Le
 *     prorata est alors refusé À DESSEIN, et c'est le point le plus discutable
 *     du module : appliqué à un sous-ensemble, il attribuerait tout le poids de
 *     la tournée aux seuls points déclarants et ZÉRO aux autres — alors qu'ils
 *     ont bien été collectés. Le dénominateur serait faux (il manque des sacs)
 *     et l'erreur serait invisible. Une moyenne grossière sur tous vaut mieux
 *     qu'un chiffre précis sur les uns et un mensonge sur les autres.
 *
 *  3. Total des sacs à ZÉRO alors que du textile a été pesé. Contradiction de
 *     terrain (« rien chargé » partout, et pourtant le camion pèse) : on ne
 *     divise pas par zéro, et surtout on ne fait pas disparaître des kilos
 *     réellement rentrés.
 *
 * @param {Array<{point_id:*, nb_sacs?:*}>} points points RÉELLEMENT collectés
 * @param {number} totalPese poids total pesé sur la tournée, en kg
 * @returns {{mode:string, motif:string|null, total_sacs:number|null,
 *            nb_points:number, nb_points_declares:number,
 *            nb_points_sans_declaration:number, poids_par_sac_kg:number|null,
 *            parts:Array<{point_id:*, nb_sacs:number|null, poids_kg:number}>}}
 */
function repartirPoids(points, totalPese) {
  const liste = Array.isArray(points) ? points : [];
  const brut = typeof totalPese === 'number' ? totalPese : Number(totalPese);
  const total = Number.isFinite(brut) ? brut : null;

  const declares = liste.filter((p) => nbSacsValide(p && p.nb_sacs) !== null);
  const manquants = liste.length - declares.length;
  const totalSacs = declares.reduce((s, p) => s + nbSacsValide(p.nb_sacs), 0);

  const base = {
    total_sacs: declares.length > 0 ? totalSacs : null,
    nb_points: liste.length,
    nb_points_declares: declares.length,
    nb_points_sans_declaration: manquants,
  };

  if (liste.length === 0) {
    return { mode: 'aucun', motif: 'Aucun point collecté', poids_par_sac_kg: null, parts: [], ...base };
  }
  // Rien à répartir : ce n'est pas un repli de répartition, c'est une absence de
  // poids. La dire distinctement évite de faire passer une tournée non pesée
  // pour une tournée mal déclarée.
  if (total === null || total <= 0) {
    return { mode: 'aucun', motif: 'Aucun poids pesé à répartir', poids_par_sac_kg: null, parts: [], ...base };
  }

  const partsEgales = (motif) => ({
    mode: 'parts_egales',
    motif,
    poids_par_sac_kg: null,
    parts: liste.map((p) => ({
      point_id: p.point_id,
      nb_sacs: nbSacsValide(p && p.nb_sacs),
      poids_kg: total / liste.length,
    })),
    ...base,
  });

  if (declares.length === 0) {
    return partsEgales('Aucun point ne déclare de nombre de sacs — répartition à parts égales');
  }
  if (manquants > 0) {
    return partsEgales(
      `Déclaration incomplète : ${manquants} point(s) collecté(s) sans nombre de sacs — répartition à parts égales`
    );
  }
  if (totalSacs <= 0) {
    return partsEgales('Aucun sac déclaré alors que du textile a été pesé — répartition à parts égales');
  }

  const poidsParSac = total / totalSacs;
  return {
    mode: 'prorata_sacs',
    motif: null,
    poids_par_sac_kg: poidsParSac,
    parts: liste.map((p) => {
      const n = nbSacsValide(p.nb_sacs);
      return { point_id: p.point_id, nb_sacs: n, poids_kg: n * poidsParSac };
    }),
    ...base,
  };
}

module.exports = {
  BORNES_DEFAUT,
  CLE_REGLAGE,
  MAX_SACS,
  nbSacsValide,
  normaliserBornes,
  niveauDepuisSacs,
  lireBornesSacs,
  resetBornesCache,
  repartirPoids,
};
