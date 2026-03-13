require('dotenv').config();
const pool = require('../config/database');

async function migrateExutoires() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATE-EXUTOIRES] Démarrage de la migration des tables exutoires...');

    await client.query('BEGIN');

    // ══════════════════════════════════════════
    // Référentiel clients exutoires
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients_exutoires (
        id SERIAL PRIMARY KEY,
        raison_sociale VARCHAR(255) NOT NULL,
        siret VARCHAR(14),
        adresse TEXT NOT NULL,
        code_postal VARCHAR(5) NOT NULL,
        ville VARCHAR(100) NOT NULL,
        contact_nom VARCHAR(100) NOT NULL,
        contact_email VARCHAR(255) NOT NULL,
        contact_telephone VARCHAR(20),
        type_client VARCHAR(20) NOT NULL DEFAULT 'recycleur'
          CHECK (type_client IN ('recycleur', 'negociant', 'industriel', 'autre')),
        actif BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table clients_exutoires créée');

    // ══════════════════════════════════════════
    // Grille tarifaire étendue
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS tarifs_exutoires (
        id SERIAL PRIMARY KEY,
        type_produit VARCHAR(30) NOT NULL
          CHECK (type_produit IN ('original', 'csr', 'effilo_blanc', 'effilo_couleur', 'jean', 'coton_blanc', 'coton_couleur')),
        prix_reference_tonne DECIMAL(10,2) NOT NULL,
        client_id INTEGER REFERENCES clients_exutoires(id),
        date_debut DATE NOT NULL,
        date_fin DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table tarifs_exutoires créée');

    // ══════════════════════════════════════════
    // Commandes exutoires
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS commandes_exutoires (
        id SERIAL PRIMARY KEY,
        reference VARCHAR(20) NOT NULL UNIQUE,
        client_id INTEGER NOT NULL REFERENCES clients_exutoires(id),
        type_produit VARCHAR(30) NOT NULL
          CHECK (type_produit IN ('original', 'csr', 'effilo_blanc', 'effilo_couleur', 'jean', 'coton_blanc', 'coton_couleur')),
        date_commande DATE NOT NULL,
        prix_tonne DECIMAL(10,2) NOT NULL,
        tonnage_prevu DECIMAL(10,3),
        frequence VARCHAR(20) NOT NULL DEFAULT 'unique'
          CHECK (frequence IN ('unique', 'hebdomadaire', 'bi_mensuel', 'mensuel')),
        date_fin_recurrence DATE,
        commande_parent_id INTEGER REFERENCES commandes_exutoires(id),
        notes TEXT,
        statut VARCHAR(20) NOT NULL DEFAULT 'en_attente'
          CHECK (statut IN ('en_attente', 'confirmee', 'en_preparation', 'chargee', 'expediee', 'pesee_recue', 'facturee', 'cloturee', 'annulee')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table commandes_exutoires créée');

    // ══════════════════════════════════════════
    // Préparations expédition
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS preparations_expedition (
        id SERIAL PRIMARY KEY,
        commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
        transporteur VARCHAR(255) NOT NULL,
        date_livraison_remorque TIMESTAMP NOT NULL,
        date_expedition TIMESTAMP NOT NULL,
        lieu_chargement VARCHAR(20) NOT NULL
          CHECK (lieu_chargement IN ('quai_chargement', 'garage_remorque', 'cours')),
        pesee_interne DECIMAL(10,3),
        notes_preparation TEXT,
        statut_preparation VARCHAR(20) NOT NULL DEFAULT 'planifiee'
          CHECK (statut_preparation IN ('planifiee', 'remorque_livree', 'en_chargement', 'prete', 'expediee')),
        heure_reception_remorque TIMESTAMP,
        heure_debut_chargement TIMESTAMP,
        heure_fin_chargement TIMESTAMP,
        heure_depart TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table preparations_expedition créée');

    // ══════════════════════════════════════════
    // Collaborateurs assignés aux préparations
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS preparation_collaborateurs (
        id SERIAL PRIMARY KEY,
        preparation_id INTEGER NOT NULL REFERENCES preparations_expedition(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        UNIQUE(preparation_id, employee_id)
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table preparation_collaborateurs créée');

    // ══════════════════════════════════════════
    // Contrôle pesée client
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS controles_pesee (
        id SERIAL PRIMARY KEY,
        commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
        pesee_client DECIMAL(10,3) NOT NULL,
        ecart_pesee DECIMAL(10,3),
        ecart_pourcentage DECIMAL(5,2),
        ticket_pesee_pdf VARCHAR(500),
        date_reception_ticket DATE NOT NULL,
        statut_controle VARCHAR(20) NOT NULL DEFAULT 'conforme'
          CHECK (statut_controle IN ('conforme', 'ecart_acceptable', 'litige', 'valide')),
        validee_par INTEGER REFERENCES users(id),
        date_validation TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table controles_pesee créée');

    // ══════════════════════════════════════════
    // Factures exutoires (contrôle OCR)
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS factures_exutoires (
        id SERIAL PRIMARY KEY,
        commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
        facture_pdf VARCHAR(500),
        ocr_date DATE,
        ocr_tonnage DECIMAL(10,3),
        ocr_montant DECIMAL(12,2),
        montant_attendu DECIMAL(12,2),
        ecart_montant DECIMAL(12,2),
        statut_facture VARCHAR(20) NOT NULL DEFAULT 'recue'
          CHECK (statut_facture IN ('recue', 'conforme', 'ecart', 'validee')),
        validee_par INTEGER REFERENCES users(id),
        date_validation TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table factures_exutoires créée');

    // ══════════════════════════════════════════
    // Historique des statuts
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS historique_commandes_exutoires (
        id SERIAL PRIMARY KEY,
        commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
        ancien_statut VARCHAR(20),
        nouveau_statut VARCHAR(20) NOT NULL,
        utilisateur_id INTEGER REFERENCES users(id),
        commentaire TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-EXUTOIRES] Table historique_commandes_exutoires créée');

    // ══════════════════════════════════════════
    // Index
    // ══════════════════════════════════════════
    await client.query('CREATE INDEX IF NOT EXISTS idx_commandes_exutoires_client ON commandes_exutoires(client_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_commandes_exutoires_statut ON commandes_exutoires(statut);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_commandes_exutoires_date ON commandes_exutoires(date_commande);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_commandes_exutoires_type ON commandes_exutoires(type_produit);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_commandes_exutoires_parent ON commandes_exutoires(commande_parent_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_preparations_lieu_dates ON preparations_expedition(lieu_chargement, date_livraison_remorque, date_expedition);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_preparations_commande ON preparations_expedition(commande_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_controles_commande ON controles_pesee(commande_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_factures_commande ON factures_exutoires(commande_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_tarifs_produit_client ON tarifs_exutoires(type_produit, client_id, date_debut);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_historique_commande ON historique_commandes_exutoires(commande_id);');
    console.log('[MIGRATE-EXUTOIRES] Index créés');

    await client.query('COMMIT');
    console.log('[MIGRATE-EXUTOIRES] Migration terminée avec succès');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[MIGRATE-EXUTOIRES] Erreur lors de la migration:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = migrateExutoires;

if (require.main === module) {
  migrateExutoires()
    .then(() => {
      console.log('[MIGRATE-EXUTOIRES] Script terminé');
      pool.end();
    })
    .catch((error) => {
      console.error('[MIGRATE-EXUTOIRES] Échec du script:', error);
      pool.end();
      process.exit(1);
    });
}
