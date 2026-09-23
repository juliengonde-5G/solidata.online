/**
 * Migration idempotente — Étiquettes v2 (2.57.0, demande client du 23/09/2026).
 *
 * Appelée par init-db.js DANS sa transaction (`client.query` uniquement, aucun
 * BEGIN/COMMIT). Rejouable autant de fois qu'on veut.
 *
 * CE QU'ELLE POSE, ET POURQUOI.
 *  - Un CODE numérique figé sur chaque valeur de gamme / catégorie / genre /
 *    saison (`ref_dimensions.code`) et sur chaque produit (`etiquettes_produits`) :
 *    ce sont les briques du nouveau code-barres hexadécimal
 *    (utils/codification-etiquettes.js). Un code attribué n'est JAMAIS changé ni
 *    réattribué — sinon un carton déjà étiqueté se relirait comme un autre produit.
 *  - `etiquettes_combinaisons` : une ligne par combinaison AUTORISÉE
 *    (gamme, catégorie, produit, genre, saison). C'est la table qui pilote le
 *    parcours Gamme → Catégorie → Produit → Genre → Saison : chaque étape ne
 *    propose que les valeurs encore possibles, et une étape à choix unique se
 *    saute d'elle-même. Le serveur refuse toute combinaison absente.
 *  - `produits_finis.reference_colis` (séquence globale) : l'identifiant unique
 *    du carton porté par la fin du code.
 *  - `etiquettes_impressions` : trace de chaque impression (création,
 *    réimpression) — une étiquette par carton, mais réimprimable si abîmée.
 *  - `sortie_cartons_journal` : trace de CHAQUE scan de sortie, réussi ou
 *    refusé (arbitrage D1). Sans identité de la personne : un profil unique et
 *    partagé fait les scans, un nom n'y dirait rien.
 *  - `etiquettes_correspondances` : ancienne valeur → nouvelle, pour les
 *    STATISTIQUES seulement (arbitrage C4). Les cartons historiques gardent leurs
 *    valeurs d'origine en base : on ne réécrit pas l'histoire.
 *
 * COHABITATION : rien de l'ancien référentiel n'est supprimé. Les gammes
 * STANDARD / EXPORT et les genres « Layette… » sont DÉSACTIVÉS (ils ne se
 * proposent plus à la saisie) et restent lisibles sur les cartons existants.
 */

const path = require('path');
const fs = require('fs');

const VERROU_SEED = 'etiquettes.referentiel_2026_seed';

function chargerReferentiel() {
  const p = path.join(__dirname, '..', '..', 'data', 'etiquettes-referentiel-2026.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function run(client) {
  // ── (a) Codes sur le référentiel des dimensions ────────────────────────────
  await client.query(`ALTER TABLE ref_dimensions ADD COLUMN IF NOT EXISTS code SMALLINT`);
  await client.query(`ALTER TABLE ref_dimensions ADD COLUMN IF NOT EXISTS definition VARCHAR(120)`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ref_dimensions_type_code
      ON ref_dimensions(type, code) WHERE code IS NOT NULL
  `);

  // ── (b) Produits de la codification v2 ─────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS etiquettes_produits (
      id SERIAL PRIMARY KEY,
      nom VARCHAR(255) NOT NULL UNIQUE,
      code SMALLINT NOT NULL UNIQUE CHECK (code BETWEEN 1 AND 255),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── (c) Combinaisons autorisées ────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS etiquettes_combinaisons (
      id SERIAL PRIMARY KEY,
      gamme VARCHAR(100) NOT NULL,
      categorie_eco_org VARCHAR(100) NOT NULL,
      produit_id INTEGER NOT NULL REFERENCES etiquettes_produits(id) ON DELETE RESTRICT,
      genre VARCHAR(100) NOT NULL,
      saison VARCHAR(100) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      source VARCHAR(30) NOT NULL DEFAULT 'referentiel_2026',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (gamme, categorie_eco_org, produit_id, genre, saison)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_etiq_combi_actives
      ON etiquettes_combinaisons(gamme, categorie_eco_org) WHERE is_active
  `);

  // ── (d) Produits finis : référence de colis, codification, combinaison ─────
  await client.query(`CREATE SEQUENCE IF NOT EXISTS produits_finis_reference_seq START 1 MINVALUE 1 MAXVALUE 16777215`);
  await client.query(`ALTER TABLE produits_finis ADD COLUMN IF NOT EXISTS reference_colis INTEGER`);
  await client.query(`ALTER TABLE produits_finis ADD COLUMN IF NOT EXISTS codification VARCHAR(12)`);
  await client.query(`ALTER TABLE produits_finis ADD COLUMN IF NOT EXISTS combinaison_id INTEGER REFERENCES etiquettes_combinaisons(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE produits_finis ADD COLUMN IF NOT EXISTS nb_impressions INTEGER NOT NULL DEFAULT 1`);
  await client.query(`ALTER TABLE produits_finis ADD COLUMN IF NOT EXISTS derniere_impression_at TIMESTAMP`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_produits_finis_reference_colis
      ON produits_finis(reference_colis) WHERE reference_colis IS NOT NULL
  `);
  // Filet : une ligne insérée sans `codification` est classée d'après son code.
  await client.query(`
    UPDATE produits_finis SET codification = CASE
        WHEN code_barre ~ '^[0-9A-F]{13}$' THEN 'v2'
        WHEN code_barre LIKE 'PF-%' THEN 'balance'
        ELSE 'ancien' END
    WHERE codification IS NULL
  `);

  // ── (e) Journal des impressions ────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS etiquettes_impressions (
      id SERIAL PRIMARY KEY,
      produit_fini_id INTEGER NOT NULL REFERENCES produits_finis(id) ON DELETE CASCADE,
      type VARCHAR(12) NOT NULL CHECK (type IN ('creation','reimpression')),
      motif VARCHAR(200),
      poste_etiquetage_id INTEGER REFERENCES postes_etiquetage(id) ON DELETE SET NULL,
      imprime_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_etiq_impressions_pf ON etiquettes_impressions(produit_fini_id)`);

  // ── (f) Journal des scans de sortie ────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS sortie_cartons_journal (
      id BIGSERIAL PRIMARY KEY,
      scanned_at TIMESTAMP NOT NULL DEFAULT NOW(),
      session_id VARCHAR(40),
      code_lu VARCHAR(64) NOT NULL,
      code_normalise VARCHAR(64),
      format VARCHAR(20),
      resultat VARCHAR(20) NOT NULL
        CHECK (resultat IN ('ok','inconnu','deja_sorti','commande_fermee','invalide','annulation')),
      produit_fini_id INTEGER REFERENCES produits_finis(id) ON DELETE SET NULL,
      commande_type VARCHAR(10),
      commande_id INTEGER,
      message VARCHAR(200)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sortie_journal_date ON sortie_cartons_journal(scanned_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sortie_journal_pf ON sortie_cartons_journal(produit_fini_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sortie_journal_session ON sortie_cartons_journal(session_id)`);

  // ── (g) Correspondances ancienne → nouvelle valeur (statistiques) ──────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS etiquettes_correspondances (
      type VARCHAR(30) NOT NULL CHECK (type IN ('gamme','categorie_eco_org','genre','saison','produit')),
      ancienne_valeur VARCHAR(255) NOT NULL,
      nouvelle_valeur VARCHAR(255) NOT NULL,
      PRIMARY KEY (type, ancienne_valeur)
    )
  `);

  // ── (h) Référentiel 2026 ───────────────────────────────────────────────────
  const ref = chargerReferentiel();
  const TYPES = [['gamme', ref.gammes], ['categorie_eco_org', ref.categories], ['genre', ref.genres], ['saison', ref.saisons]];

  // Codes : posés à CHAQUE démarrage, mais seulement là où il n'y en a pas
  // (jamais changés). Une valeur absente est ajoutée ACTIVE ; une valeur que
  // l'exploitant a désactivée n'est PAS réactivée (doctrine 2.26.4).
  for (const [type, valeurs] of TYPES) {
    for (const [i, v] of valeurs.entries()) {
      // Un code déjà porté par une AUTRE valeur (valeur renommée à la main) ne
      // doit pas faire échouer tout le démarrage : on n'attribue pas, on le dit.
      const pris = await client.query(
        `SELECT valeur FROM ref_dimensions WHERE type = $1 AND code = $2 AND valeur <> $3`,
        [type, v.code, v.valeur]
      );
      const code = pris.rowCount ? null : v.code;
      if (pris.rowCount) {
        console.warn(`[INIT-DB] Étiquettes v2 : code ${v.code} (${type}) déjà porté par « ${pris.rows[0].valeur} » — « ${v.valeur} » reste sans code`);
      }
      await client.query(
        `INSERT INTO ref_dimensions (type, valeur, ordre, code, definition)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (type, valeur) DO UPDATE SET
           code = COALESCE(ref_dimensions.code, EXCLUDED.code),
           definition = COALESCE(ref_dimensions.definition, EXCLUDED.definition)`,
        [type, v.valeur, i, code, v.definition || null]
      );
    }
  }
  for (const p of ref.produits) {
    await client.query(
      `INSERT INTO etiquettes_produits (nom, code) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [p.nom, p.code]
    );
  }
  for (const [type, table] of Object.entries(ref.correspondances_historiques || {})) {
    const t = type === 'categorie' ? 'categorie_eco_org' : type;
    for (const [ancienne, nouvelle] of Object.entries(table)) {
      await client.query(
        `INSERT INTO etiquettes_correspondances (type, ancienne_valeur, nouvelle_valeur)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [t, ancienne, nouvelle]
      );
    }
  }

  // Combinaisons + retrait des anciennes valeurs de la SAISIE : une seule fois
  // (verrou). Une combinaison supprimée ou désactivée par l'exploitant ne
  // revient jamais au redémarrage.
  const verrou = await client.query(`SELECT 1 FROM settings WHERE key = $1`, [VERROU_SEED]);
  if (verrou.rowCount === 0) {
    const ids = new Map((await client.query(`SELECT id, nom FROM etiquettes_produits`)).rows.map((r) => [r.nom, r.id]));
    let n = 0;
    for (const l of ref.lignes) {
      const pid = ids.get(l.produit);
      if (!pid) continue;
      for (const g of l.gammes) for (const ge of l.genres) for (const s of l.saisons) {
        const r = await client.query(
          `INSERT INTO etiquettes_combinaisons (gamme, categorie_eco_org, produit_id, genre, saison)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [g, l.categorie, pid, ge, s]
        );
        n += r.rowCount;
      }
    }
    // Retirées de la saisie, conservées pour l'historique.
    await client.query(`
      UPDATE ref_dimensions SET is_active = false
      WHERE (type = 'gamme' AND valeur IN ('STANDARD','EXPORT'))
         OR (type = 'genre' AND valeur IN ('Layette','Layette Fille','Layette Garçon'))
    `);
    await client.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [VERROU_SEED, JSON.stringify({ applique_le: new Date().toISOString(), combinaisons: n })]
    );
    console.log(`[INIT-DB] Étiquettes v2 : ${n} combinaisons seedées, gammes STANDARD/EXPORT et genres Layette retirés de la saisie`);
  }
}

module.exports = { run, VERROU_SEED, chargerReferentiel };
