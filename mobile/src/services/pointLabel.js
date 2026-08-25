/**
 * Libellé d'un point de collecte pour l'écran du chauffeur.
 *
 * Les points sont nommés « COMMUNE - adresse » dans le référentiel
 * (« CAUDEBEC-LÈS-ELBEUF - 67 Rue de Strasbourg »). Sur un téléphone, ce nom
 * complet dépasse la largeur disponible : le titre était tronqué et le chauffeur
 * perdait la RUE — la seule information dont il ait besoin, puisqu'il est déjà
 * dans la commune, affichée juste en dessous.
 *
 * On retire donc le préfixe de commune quand il fait double emploi. Le nom reste
 * intact dès qu'il ne commence pas exactement par la commune : on ne coupe
 * jamais un libellé au hasard.
 */

/** Casse, accents et espaces neutralisés — pour COMPARER, jamais pour afficher. */
function normaliser(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Séparateurs rencontrés entre la commune et l'adresse. */
const SEPARATEURS = ['-', '–', '—', ':', '·'];

/**
 * Retire le préfixe de commune d'un nom de point.
 *
 * La découpe se fait au premier séparateur dont la partie GAUCHE correspond
 * exactement à la commune. C'est indispensable ici : beaucoup de communes
 * contiennent elles-mêmes des tirets (« CAUDEBEC-LÈS-ELBEUF »), et couper au
 * premier tiret venu produirait « LÈS-ELBEUF - 67 Rue… ».
 *
 * @returns {string} l'adresse seule, ou le nom d'origine si rien ne correspond.
 */
export function retirerPrefixeCommune(nom, commune) {
  const brut = String(nom ?? '').trim();
  if (!brut || !commune) return brut;

  const cible = normaliser(commune);
  if (!cible || !normaliser(brut).startsWith(cible)) return brut;

  for (let i = 0; i < brut.length; i += 1) {
    if (!SEPARATEURS.includes(brut[i])) continue;
    if (normaliser(brut.slice(0, i)) !== cible) continue;
    const reste = brut.slice(i + 1).trim();
    // Un nom réduit à la seule commune n'a pas d'adresse à isoler.
    return reste || brut;
  }
  return brut;
}

/**
 * Titre et sous-titre d'un point, prêts à afficher.
 * @param {object} point  {nom|cav_name, commune, address}
 * @returns {{titre: string, sousTitre: string|null}}
 */
export function libellePoint(point) {
  const nom = point?.nom || point?.cav_name || '';
  const commune = point?.commune || '';
  const titre = retirerPrefixeCommune(nom, commune);

  // Le sous-titre porte la commune. L'adresse du référentiel n'est ajoutée que
  // si elle dit autre chose que le titre — sinon on répéterait la même ligne.
  const adresse = String(point?.address || '').trim();
  const complement = adresse && normaliser(adresse) !== normaliser(titre) ? adresse : null;
  const sousTitre = [commune, complement].filter(Boolean).join(' · ') || null;

  return { titre, sousTitre };
}
