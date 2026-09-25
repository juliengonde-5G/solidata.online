// Catalogue de commande des boutiques et avancement de la préparation (2.58.0).
//
// UNE CATÉGORIE COMMANDABLE = gamme + produit + genre + saison (arbitrage client
// du 25/09/2026 : le détail de l'étiquette). La catégorie éco-organisme en
// découle et n'entre pas dans la clé.
//
// La liste est la plus EXHAUSTIVE possible :
//   • toutes les combinaisons actives du référentiel d'étiquetage, stock nul compris
//     (une boutique peut commander ce qui n'est pas encore produit : c'est un besoin) ;
//   • les catégories du stock historique qui ne figurent plus au référentiel
//     (« hors référentiel ») — SEULEMENT tant qu'il en reste en stock : l'ancienne
//     nomenclature disparaît progressivement (2.59.0).
//
// Le stock historique porte d'anciens libellés (« BTQ STAND », « Layette Fille »…).
// Il est regroupé sous la valeur actuelle par la table etiquettes_correspondances
// — la MÊME table que les statistiques — sans rien réécrire dans produits_finis.
// Un genre ou une saison absents (anciens cartons Upcycling, 2.53.0 : « sans
// objet ») sont lus « Sans Genre » / « Sans Saison », les valeurs du référentiel
// qui disent exactement cela.

const GAMMES_COMMANDABLES = ['BTQ', 'EXTRA', 'VAK', 'CHIF', 'UP'];
const STATUTS_RESERVANT = ['envoyee', 'ajustee', 'en_preparation'];

// Cartons normalisés — fragment partagé par TOUTES les requêtes de ce module :
// le catalogue, la réservation et l'avancement doivent regrouper de la même façon.
const CTE_CARTONS = `
  pf AS (
    SELECT p.id, p.poids_kg, p.status, p.date_sortie, p.code_barre,
           p.sortie_commande_type, p.sortie_commande_id,
           COALESCE(cg.nouvelle_valeur, p.gamme) AS gamme,
           COALESCE(cc.nouvelle_valeur, p.categorie_eco_org) AS categorie_eco_org,
           COALESCE(cp.nouvelle_valeur, p.produit) AS produit,
           COALESCE(cn.nouvelle_valeur, NULLIF(p.genre, ''), 'Sans Genre') AS genre,
           COALESCE(cs.nouvelle_valeur, NULLIF(p.saison, ''), 'Sans Saison') AS saison
      FROM produits_finis p
      LEFT JOIN etiquettes_correspondances cg ON cg.type = 'gamme' AND cg.ancienne_valeur = p.gamme
      LEFT JOIN etiquettes_correspondances cc ON cc.type = 'categorie_eco_org' AND cc.ancienne_valeur = p.categorie_eco_org
      LEFT JOIN etiquettes_correspondances cp ON cp.type = 'produit' AND cp.ancienne_valeur = p.produit
      LEFT JOIN etiquettes_correspondances cn ON cn.type = 'genre' AND cn.ancienne_valeur = p.genre
      LEFT JOIN etiquettes_correspondances cs ON cs.type = 'saison' AND cs.ancienne_valeur = p.saison
  )`;

/**
 * Catalogue commandable, une ligne par catégorie.
 * @param db pool ou client pg
 * @param {{ excludeCommandeId?: number|null }} opts — la commande en cours de
 *   modification ne se réserve pas à elle-même.
 */
async function chargerCatalogue(db, { excludeCommandeId = null } = {}) {
  const { rows } = await db.query(`
    WITH ${CTE_CARTONS},
    referentiel AS (
      SELECT c.gamme, c.categorie_eco_org, ep.nom AS produit, c.genre, c.saison
        FROM etiquettes_combinaisons c
        JOIN etiquettes_produits ep ON ep.id = c.produit_id
       WHERE c.is_active AND ep.is_active AND c.gamme = ANY($1::varchar[])
    ),
    stock AS (
      SELECT gamme, produit, genre, saison,
             MIN(categorie_eco_org) AS categorie_eco_org,
             COUNT(*) FILTER (WHERE status = 'en_stock' AND date_sortie IS NULL)::int AS stock_cartons,
             COALESCE(SUM(poids_kg) FILTER (WHERE status = 'en_stock' AND date_sortie IS NULL), 0)::float AS stock_kg,
             AVG(poids_kg)::float AS poids_moyen_kg
        FROM pf
       WHERE gamme = ANY($1::varchar[]) AND produit IS NOT NULL
       GROUP BY gamme, produit, genre, saison
    ),
    lignes_ouvertes AS (
      SELECT l.gamme, l.produit, l.genre, l.saison,
             GREATEST(COALESCE(l.nb_cartons_ajuste, l.nb_cartons_demande)
               - (SELECT COUNT(*) FROM pf
                   WHERE pf.sortie_commande_type = 'btq' AND pf.sortie_commande_id = l.commande_id
                     AND pf.gamme = l.gamme AND pf.produit = l.produit
                     AND pf.genre = l.genre AND pf.saison = l.saison), 0) AS reste
        FROM boutique_commande_lignes l
        JOIN boutique_commandes bc ON bc.id = l.commande_id
       WHERE bc.statut = ANY($2::varchar[]) AND l.nb_cartons_demande IS NOT NULL
         AND ($3::int IS NULL OR bc.id <> $3::int)
    ),
    reserve AS (
      SELECT gamme, produit, genre, saison, SUM(reste)::int AS reserve_cartons
        FROM lignes_ouvertes GROUP BY gamme, produit, genre, saison
    ),
    -- Nouvelle nomenclature : toujours proposée, stock nul compris (on peut
    -- commander ce qui n'est pas encore produit). Ancienne nomenclature : seulement
    -- tant qu'il en reste en stock — elle disparaît d'elle-même à mesure que le
    -- stock historique s'écoule (demande client 25/09/2026).
    cles AS (
      SELECT gamme, produit, genre, saison FROM referentiel
      UNION
      SELECT gamme, produit, genre, saison FROM stock WHERE stock_cartons > 0
    )
    SELECT k.gamme, k.produit, k.genre, k.saison,
           COALESCE((SELECT MIN(r.categorie_eco_org) FROM referentiel r
                      WHERE r.gamme = k.gamme AND r.produit = k.produit
                        AND r.genre = k.genre AND r.saison = k.saison),
                    s.categorie_eco_org) AS categorie_eco_org,
           EXISTS (SELECT 1 FROM referentiel r
                    WHERE r.gamme = k.gamme AND r.produit = k.produit
                      AND r.genre = k.genre AND r.saison = k.saison) AS au_referentiel,
           COALESCE(s.stock_cartons, 0) AS stock_cartons,
           COALESCE(s.stock_kg, 0) AS stock_kg,
           s.poids_moyen_kg,
           COALESCE(rv.reserve_cartons, 0) AS reserve_cartons
      FROM cles k
      LEFT JOIN stock s ON s.gamme = k.gamme AND s.produit = k.produit AND s.genre = k.genre AND s.saison = k.saison
      LEFT JOIN reserve rv ON rv.gamme = k.gamme AND rv.produit = k.produit AND rv.genre = k.genre AND rv.saison = k.saison
  `, [GAMMES_COMMANDABLES, STATUTS_RESERVANT, excludeCommandeId]);

  return trierCatalogue(rows.map((r) => {
    const stock = Number(r.stock_cartons) || 0;
    const reserve = Number(r.reserve_cartons) || 0;
    return {
      cle: cleCategorie(r),
      gamme: r.gamme,
      categorie_eco_org: r.categorie_eco_org || null,
      produit: r.produit,
      genre: r.genre,
      saison: r.saison,
      au_referentiel: !!r.au_referentiel,
      stock_cartons: stock,
      stock_kg: Math.round((Number(r.stock_kg) || 0) * 10) / 10,
      poids_moyen_kg: r.poids_moyen_kg === null || r.poids_moyen_kg === undefined
        ? null : Math.round(Number(r.poids_moyen_kg) * 10) / 10,
      reserve_cartons: reserve,
      disponible_cartons: stock - reserve, // peut être négatif : c'est une information
    };
  }));
}

/** Clé d'une catégorie commandable. */
function cleCategorie({ gamme, produit, genre, saison }) {
  return [gamme, produit, genre, saison].map((v) => String(v ?? '')).join('|');
}

/** Libellé lisible d'une ligne (« Robes — Adulte Femme — Été »). */
function libelleCategorie({ produit, genre, saison }) {
  return [produit, genre, saison].filter(Boolean).join(' — ');
}

const ORDRE_GAMMES = new Map(GAMMES_COMMANDABLES.map((g, i) => [g, i]));
function trierCatalogue(lignes) {
  return lignes.sort((a, b) => (ORDRE_GAMMES.get(a.gamme) ?? 99) - (ORDRE_GAMMES.get(b.gamme) ?? 99)
    || String(a.categorie_eco_org || '').localeCompare(String(b.categorie_eco_org || ''), 'fr')
    || String(a.produit).localeCompare(String(b.produit), 'fr')
    || String(a.genre).localeCompare(String(b.genre), 'fr')
    || String(a.saison).localeCompare(String(b.saison), 'fr'));
}

/**
 * Valide et normalise les lignes envoyées par l'écran contre le catalogue.
 * Le serveur décide : une catégorie inconnue, une quantité illisible ou un
 * doublon sont refusés — jamais « rangés au mieux ».
 * @returns {{ lignes: object[] } | { erreur: string, code: string }}
 */
function validerLignesCartons(lignesBrutes, catalogue) {
  if (!Array.isArray(lignesBrutes) || lignesBrutes.length === 0) {
    return { erreur: 'Choisissez au moins une catégorie', code: 'COMMANDE_VIDE' };
  }
  const index = new Map(catalogue.map((c) => [c.cle, c]));
  const vues = new Set();
  const lignes = [];
  for (const l of lignesBrutes) {
    const cle = cleCategorie(l || {});
    const cat = index.get(cle);
    if (!cat) {
      return { erreur: `Catégorie inconnue du stock et du référentiel : ${libelleCategorie(l || {}) || '(vide)'}`, code: 'CATEGORIE_INCONNUE' };
    }
    const n = Number(l.nb_cartons);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) {
      return { erreur: `Nombre de cartons invalide pour ${libelleCategorie(cat)}`, code: 'QUANTITE_INVALIDE' };
    }
    if (vues.has(cle)) {
      return { erreur: `${libelleCategorie(cat)} figure deux fois dans la commande`, code: 'DOUBLON' };
    }
    vues.add(cle);
    lignes.push({
      gamme: cat.gamme,
      categorie_eco_org: cat.categorie_eco_org,
      produit: cat.produit,
      genre: cat.genre,
      saison: cat.saison,
      categorie: `${cat.gamme} · ${libelleCategorie(cat)}`,
      nb_cartons: n,
      poids_estime_kg: cat.poids_moyen_kg === null ? null : Math.round(n * cat.poids_moyen_kg * 100) / 100,
      notes: typeof l.notes === 'string' && l.notes.trim() ? l.notes.trim().slice(0, 500) : null,
    });
  }
  return { lignes };
}

/**
 * Rattache des cartons sortis aux lignes d'une commande (fonction PURE).
 * Un carton va à la ligne de même catégorie ; sans ligne correspondante il est
 * « hors commande » — signalé, jamais refusé (il est déjà physiquement parti).
 */
function calculerAvancement(lignes, cartons) {
  const parCle = new Map();
  const resultat = lignes.map((l) => {
    const enCartons = l.nb_cartons_demande !== null && l.nb_cartons_demande !== undefined;
    const voulu = enCartons
      ? Number(l.nb_cartons_ajuste ?? l.nb_cartons_demande)
      : null;
    const item = {
      ligne_id: l.id,
      en_cartons: enCartons,
      libelle: enCartons ? `${l.gamme} · ${libelleCategorie(l)}` : l.categorie,
      gamme: l.gamme ?? null,
      voulu,
      scannes: 0,
      scannes_kg: 0,
    };
    if (enCartons) parCle.set(cleCategorie(l), item);
    return item;
  });
  const horsCommande = [];
  const ligneParCarton = {};
  for (const c of cartons) {
    const item = parCle.get(cleCategorie(c));
    ligneParCarton[c.id] = item ? item.ligne_id : null;
    if (item) {
      item.scannes += 1;
      item.scannes_kg += Number(c.poids_kg) || 0;
    } else {
      horsCommande.push(c);
    }
  }
  for (const item of resultat) {
    item.scannes_kg = Math.round(item.scannes_kg * 10) / 10;
    item.reste = item.voulu === null ? null : Math.max(item.voulu - item.scannes, 0);
    item.depasse = item.voulu !== null && item.scannes > item.voulu;
  }
  const totalVoulu = resultat.reduce((s, i) => s + (i.voulu || 0), 0);
  const totalScannes = cartons.length;
  return {
    lignes: resultat,
    hors_commande: horsCommande.map((c) => ({ id: c.id, code_barre: c.code_barre, produit: c.produit, gamme: c.gamme, genre: c.genre, saison: c.saison, poids_kg: Number(c.poids_kg) || 0 })),
    ligne_par_carton: ligneParCarton,
    total_voulu: totalVoulu,
    total_scannes: totalScannes,
    total_kg: Math.round(cartons.reduce((s, c) => s + (Number(c.poids_kg) || 0), 0) * 10) / 10,
  };
}

/** Avancement de la préparation d'une commande boutique (lignes + cartons sortis). */
async function etatPreparation(db, commandeId) {
  const [lignes, cartons] = await Promise.all([
    db.query('SELECT * FROM boutique_commande_lignes WHERE commande_id = $1 ORDER BY id', [commandeId]),
    db.query(`WITH ${CTE_CARTONS}
      SELECT id, code_barre, poids_kg, gamme, produit, genre, saison FROM pf
       WHERE sortie_commande_type = 'btq' AND sortie_commande_id = $1`, [commandeId]),
  ]);
  return calculerAvancement(lignes.rows, cartons.rows);
}

module.exports = {
  GAMMES_COMMANDABLES,
  STATUTS_RESERVANT,
  CTE_CARTONS,
  chargerCatalogue,
  cleCategorie,
  libelleCategorie,
  validerLignesCartons,
  calculerAvancement,
  etatPreparation,
};
