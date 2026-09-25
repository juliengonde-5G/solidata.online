// Commandes boutiques en CARTONS par catégorie de stock (2.58.0, demande client).
//
// Jusqu'ici une ligne de commande portait une catégorie libre (« FEMME »,
// « ENFANTS »…) et un POIDS. Une boutique commande désormais un NOMBRE DE
// CARTONS d'une catégorie du stock de produits finis — la même granularité que
// l'étiquette : gamme + produit + genre + saison.
//
// Migration ADDITIVE et idempotente : les commandes déjà passées au poids
// restent telles quelles (poids_demande_kg conservé), les nouvelles colonnes sont
// nullables. Une ligne « au poids » et une ligne « en cartons » cohabitent donc
// dans l'historique sans conversion — une conversion inventerait un nombre de
// cartons qu'aucune boutique n'a demandé.
async function run(client) {
  // Le libellé « Produit — Genre — Saison » dépasse 100 caractères sur certains produits.
  await client.query(`ALTER TABLE boutique_commande_lignes ALTER COLUMN categorie TYPE TEXT`);
  // Une ligne en cartons n'a pas de poids demandé : la contrainte ne vaut plus que pour l'historique.
  await client.query(`ALTER TABLE boutique_commande_lignes ALTER COLUMN poids_demande_kg DROP NOT NULL`);

  const colonnes = [
    ['gamme', 'VARCHAR(100)'],
    ['categorie_eco_org', 'VARCHAR(100)'],
    ['produit', 'VARCHAR(255)'],
    ['genre', 'VARCHAR(100)'],
    ['saison', 'VARCHAR(100)'],
    ['nb_cartons_demande', 'INTEGER'],
    ['nb_cartons_ajuste', 'INTEGER'],
    ['nb_cartons_expedies', 'INTEGER'],
    // Estimation (nombre × poids moyen d'un carton de la catégorie) : jamais une pesée.
    ['poids_estime_kg', 'DECIMAL(10,2)'],
  ];
  for (const [nom, type] of colonnes) {
    await client.query(`ALTER TABLE boutique_commande_lignes ADD COLUMN IF NOT EXISTS ${nom} ${type}`);
  }

  // Bornes : pas de minimum ni de maximum MÉTIER (arbitrage client), mais une
  // ligne à zéro ou négative ne veut rien dire.
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_btq_lignes_cartons') THEN
        ALTER TABLE boutique_commande_lignes ADD CONSTRAINT chk_btq_lignes_cartons
          CHECK ((nb_cartons_demande IS NULL OR nb_cartons_demande > 0)
             AND (nb_cartons_ajuste IS NULL OR nb_cartons_ajuste >= 0)
             AND (nb_cartons_expedies IS NULL OR nb_cartons_expedies >= 0));
      END IF;
    END $$;
  `);

  // Une catégorie ne figure qu'une fois par commande (sinon l'avancement du
  // scan ne saurait pas à quelle ligne rattacher un carton).
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_btq_lignes_categorie
      ON boutique_commande_lignes (commande_id, gamme, produit, genre, saison)
      WHERE nb_cartons_demande IS NOT NULL
  `);

  // Cartons sortis pour une commande boutique : l'avancement et l'expédition les relisent.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_pf_sortie_commande
      ON produits_finis (sortie_commande_type, sortie_commande_id)
      WHERE sortie_commande_id IS NOT NULL
  `);
}

module.exports = { run };
