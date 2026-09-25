/**
 * Logique PURE du parcours d'étiquetage — 2.57.0 (Étiquettes v2, 23/09/2026).
 *
 * Parcours arbitré avec le client : Gamme → Catégorie → Produit → Genre →
 * Saison → Poids. Chaque étape liste les valeurs DISTINCTES des combinaisons
 * compatibles avec les choix déjà faits (pas une liste figée) ; si une étape
 * n'offre qu'UNE seule valeur possible, elle est posée automatiquement et
 * sautée — l'enchaînement est RÉCURSIF : poser une valeur automatique peut
 * réduire l'étape suivante à une seule valeur elle aussi (cas Upcycling :
 * gamme UP → catégorie/produit/genre/saison tous posés d'un coup, on atterrit
 * directement sur le Poids).
 *
 * Aucun état React ici : ce module ne connaît que des tableaux et des objets
 * simples, pour pouvoir être réutilisé tel quel par `ProduitsFinis.jsx` (la
 * voie manuelle) et testé sans navigateur ni backend.
 *
 * Une COMBINAISON (telle que servie par GET /etiquettes/referentiel) a la
 * forme : { gamme, categorie_eco_org, produit_id, produit, genre, saison }.
 * Un CHOIX en cours de constitution ne porte QUE les champs déjà décidés
 * (gamme, categorie_eco_org, produit_id, genre, saison) — un champ absent
 * signifie « pas encore choisi », jamais une chaîne vide.
 */

/**
 * Les 5 étapes de dimension, DANS L'ORDRE du parcours. `id` et `champ` sont
 * volontairement identiques (le champ du choix ET l'identifiant de l'étape) :
 * ça évite une table de correspondance de plus à tenir à jour.
 */
export const ETAPES = [
  { id: 'gamme', champ: 'gamme', label: 'Gamme' },
  { id: 'categorie_eco_org', champ: 'categorie_eco_org', label: 'Catégorie' },
  { id: 'produit_id', champ: 'produit_id', label: 'Produit' },
  { id: 'genre', champ: 'genre', label: 'Genre' },
  { id: 'saison', champ: 'saison', label: 'Saison' },
];

/** Le poids n'est pas une dimension du référentiel (pas de liste à choisir) :
 * c'est une SIXIÈME étape, saisie au pavé numérique, jamais auto-posée. */
export const ETAPE_POIDS = { id: 'poids', champ: 'poids', label: 'Poids' };

/** Ordre complet des identifiants d'étape (dimensions puis poids), utile pour
 * les fonctions qui doivent balayer ou tronquer le parcours. */
const ORDRE_COMPLET = [...ETAPES.map((e) => e.id), ETAPE_POIDS.id];

/** Un champ de choix est « décidé » s'il n'est ni absent ni vide — un champ à
 * `''` (reset intermédiaire d'un formulaire) compte comme non décidé. */
function estDecide(valeur) {
  return valeur !== undefined && valeur !== null && valeur !== '';
}

/**
 * Options DISTINCTES pour une étape donnée, compte tenu des choix déjà faits
 * sur les étapes QUI LA PRÉCÈDENT (les étapes suivantes ne filtrent jamais en
 * arrière — changer le genre après la saison n'a pas de sens dans ce parcours,
 * la saison redevient simplement à choisir si le genre change).
 *
 * @param {Array<object>} combinaisons
 * @param {object} choix
 * @param {string} etapeId - un id de ETAPES (jamais 'poids', qui n'a pas d'options)
 * @returns {Array} pour l'étape 'produit_id' : [{id, nom}] ; sinon : [string]
 *   dans l'ordre de première apparition dans `combinaisons` (le référentiel
 *   backend trie déjà ses lignes par `ordre` puis valeur — cet ordre-là est
 *   préservé, jamais retrié ici).
 */
export function optionsEtape(combinaisons, choix, etapeId) {
  const idx = ETAPES.findIndex((e) => e.id === etapeId);
  if (idx === -1) return [];
  const precedentes = ETAPES.slice(0, idx);
  const compatibles = (combinaisons || []).filter((c) =>
    precedentes.every((p) => !estDecide(choix[p.champ]) || c[p.champ] === choix[p.champ])
  );
  const champ = ETAPES[idx].champ;
  if (champ === 'produit_id') {
    const vus = new Map();
    for (const c of compatibles) {
      if (c.produit_id != null && !vus.has(c.produit_id)) {
        vus.set(c.produit_id, { id: c.produit_id, nom: c.produit });
      }
    }
    return Array.from(vus.values());
  }
  const vus = [];
  for (const c of compatibles) {
    const v = c[champ];
    if (estDecide(v) && !vus.includes(v)) vus.push(v);
  }
  return vus;
}

/** Étapes de dimension pas encore décidées dans `choix`, dans l'ordre du
 * parcours — sert à afficher une progression ou à savoir combien il reste. */
export function etapesRestantes(choix) {
  return ETAPES.filter((e) => !estDecide(choix[e.champ]));
}

/** Vrai quand les 5 dimensions sont posées (peu importe qu'elles l'aient été
 * à la main ou automatiquement) — il ne reste alors que le poids. */
export function estComplet(choix) {
  return ETAPES.every((e) => estDecide(choix[e.champ]));
}

/**
 * Cœur du parcours : pose automatiquement, DE PROCHE EN PROCHE, toute étape
 * qui n'a qu'une seule valeur possible compte tenu de ce qui est déjà choisi,
 * et s'arrête sur la première étape qui en offre plusieurs (ou sur `poids` si
 * les 5 dimensions ont pu être posées d'un coup).
 *
 * @param {Array<object>} combinaisons
 * @param {object} choixDepart - choix déjà faits (peut être `{}`)
 * @param {object} [automatiqueDepart] - drapeaux « posé automatiquement »
 *   déjà connus, à faire progresser (permet d'appeler la fonction en boucle
 *   sans perdre la trace de ce qui a été auto-posé plus tôt).
 * @returns {{choix:object, automatique:object, etape:string, options:Array|null, termine:boolean}}
 *   `options` est `null` pour l'étape 'poids' (rien à choisir dans une liste) ;
 *   `[]` signifie qu'aucune combinaison n'est compatible avec les choix faits
 *   (ne devrait jamais arriver sur un parcours mené par l'écran, seulement si
 *   le référentiel a changé sous les pieds de l'opérateur — l'écran doit alors
 *   inviter à recommencer plutôt que de deviner).
 */
export function appliquerAutomatiques(combinaisons, choixDepart, automatiqueDepart = {}) {
  let choix = { ...choixDepart };
  let automatique = { ...automatiqueDepart };
  for (const etape of ETAPES) {
    if (estDecide(choix[etape.champ])) continue; // déjà décidé (main ou auto)
    const options = optionsEtape(combinaisons, choix, etape.id);
    if (options.length === 1) {
      const unique = etape.champ === 'produit_id' ? options[0].id : options[0];
      choix = { ...choix, [etape.champ]: unique };
      automatique = { ...automatique, [etape.champ]: true };
      continue; // récursif : l'étape suivante peut à son tour se réduire à une seule valeur
    }
    return { choix, automatique, etape: etape.id, options, termine: false };
  }
  return { choix, automatique, etape: ETAPE_POIDS.id, options: null, termine: true };
}

/**
 * Retour au fil d'Ariane : revenir à une étape efface son propre choix ET
 * tous les choix qui la suivent (dimension ou poids) — garder un genre choisi
 * pour une autre catégorie n'aurait pas de sens. Les drapeaux « automatique »
 * des champs effacés disparaissent avec eux : une fois qu'on repasse par là,
 * la valeur (même si elle finit par être identique) est à nouveau déterminée
 * par `appliquerAutomatiques`, pas figée comme « automatique » d'une décision
 * précédente qui n'existe plus.
 *
 * @param {object} choix
 * @param {object} automatique
 * @param {string} etapeId
 * @returns {{choix:object, automatique:object}}
 */
export function revenirA(choix, automatique, etapeId) {
  const idx = ORDRE_COMPLET.indexOf(etapeId);
  if (idx === -1) return { choix, automatique };
  const nouveauChoix = { ...choix };
  const nouvelAutomatique = { ...automatique };
  for (let i = idx; i < ORDRE_COMPLET.length; i++) {
    delete nouveauChoix[ORDRE_COMPLET[i]];
    delete nouvelAutomatique[ORDRE_COMPLET[i]];
  }
  return { choix: nouveauChoix, automatique: nouvelAutomatique };
}

/** Nom lisible d'un produit choisi (choix.produit_id est un identifiant, pas
 * un nom) — cherché dans les combinaisons plutôt que dupliqué dans le choix,
 * pour n'avoir qu'une seule source. Retombe sur l'id en texte si introuvable
 * (référentiel changé sous les pieds de l'opérateur) plutôt que d'afficher
 * un vide silencieux. */
export function nomProduit(combinaisons, produitId) {
  if (produitId == null) return '';
  const trouve = (combinaisons || []).find((c) => c.produit_id === produitId);
  return trouve ? trouve.produit : String(produitId);
}

/** Construit le corps de `POST /etiquettes/generer` (ou `/produits-finis`)
 * à partir d'un choix complet + poids + poste + lot facultatif. Ne fait
 * AUCUNE validation de cohérence (c'est le serveur qui vérifie que la
 * combinaison existe réellement, `COMBINAISON_INVALIDE` sinon) — juste la
 * mise en forme, pour ne pas la dupliquer entre l'écran d'étiquetage et le
 * formulaire manuel de ProduitsFinis. */
export function corpsGeneration(choix, { poidsKg, posteId, lotId } = {}) {
  return {
    poste_id: posteId,
    gamme: choix.gamme,
    categorie_eco_org: choix.categorie_eco_org,
    produit_id: choix.produit_id,
    genre: choix.genre,
    saison: choix.saison,
    poids_kg: poidsKg,
    batch_id: lotId || undefined,
  };
}
