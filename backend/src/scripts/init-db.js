require('dotenv').config();
const pool = require('../config/database');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('[INIT-DB] Démarrage de l\'initialisation...');

    await client.query('BEGIN');

    // Extension PostGIS
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    console.log('[INIT-DB] Extension PostGIS activée');

    // ══════════════════════════════════════════
    // MODULE 1 : Authentification & Admin
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE')),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(20),
        team_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT,
        category VARCHAR(50),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(10) NOT NULL CHECK (type IN ('sms', 'email')),
        category VARCHAR(50) NOT NULL,
        subject VARCHAR(255),
        body TEXT NOT NULL,
        variables TEXT[],
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module 1 (Auth & Admin) ✓');

    // ══════════════════════════════════════════
    // MODULE 2 : Recrutement
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidates (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        email VARCHAR(255),
        phone VARCHAR(20),
        gender VARCHAR(20),
        has_permis_b BOOLEAN DEFAULT false,
        has_caces BOOLEAN DEFAULT false,
        cv_raw_text TEXT,
        cv_file_path VARCHAR(500),
        source_email VARCHAR(255),
        status VARCHAR(30) NOT NULL DEFAULT 'received'
          CHECK (status IN ('received', 'preselected', 'interview', 'test', 'hired')),
        position_id INTEGER,
        appointment_date TIMESTAMP,
        appointment_location VARCHAR(255),
        sms_response VARCHAR(20),
        interviewer_name VARCHAR(100),
        interview_comment TEXT,
        practical_test_done BOOLEAN DEFAULT false,
        practical_test_result VARCHAR(20) CHECK (practical_test_result IN ('conforme', 'faible', 'recale')),
        practical_test_comment TEXT,
        assigned_team_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_history (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
        from_status VARCHAR(30),
        to_status VARCHAR(30) NOT NULL,
        comment TEXT,
        changed_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_skills (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
        skill_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'not_mentioned'
          CHECK (status IN ('not_mentioned', 'detected', 'confirmed')),
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(candidate_id, skill_name)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS skill_keywords (
        id SERIAL PRIMARY KEY,
        skill_name VARCHAR(100) NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        synonyms TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(skill_name, keyword)
      );
    `);
    console.log('[INIT-DB] Module 2 (Recrutement) ✓');

    // ══════════════════════════════════════════
    // MODULE 3 : PCM (Test personnalité)
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS pcm_sessions (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
        mode VARCHAR(20) NOT NULL CHECK (mode IN ('autonomous', 'accompanied')),
        access_token VARCHAR(255) UNIQUE,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pcm_answers (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES pcm_sessions(id) ON DELETE CASCADE,
        question_number INTEGER NOT NULL,
        answer_value TEXT NOT NULL,
        answer_voice_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pcm_reports (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES pcm_sessions(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
        base_type VARCHAR(20),
        phase_type VARCHAR(20),
        encrypted_report TEXT NOT NULL,
        risk_alert BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module 3 (PCM) ✓');

    // ══════════════════════════════════════════
    // MODULE 4 : Équipes & Planification
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(30) CHECK (type IN ('tri', 'collecte', 'logistique', 'btq_st_sever', 'btq_lhopital', 'administration')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        candidate_id INTEGER UNIQUE REFERENCES candidates(id) ON DELETE SET NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(255),
        photo_path VARCHAR(500),
        team_id INTEGER REFERENCES teams(id),
        position VARCHAR(100),
        contract_type VARCHAR(50),
        contract_start DATE,
        contract_end DATE,
        has_permis_b BOOLEAN DEFAULT false,
        has_caces BOOLEAN DEFAULT false,
        weekly_hours DOUBLE PRECISION DEFAULT 35,
        skills TEXT[],
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Positions (doit être créé AVANT employee_contracts et schedule qui le référencent)
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        type VARCHAR(50),
        month VARCHAR(20),
        slots_open INTEGER DEFAULT 1,
        slots_filled INTEGER DEFAULT 0,
        required_skills TEXT[],
        team_type VARCHAR(30),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Contrats employés
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_contracts (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        contract_type VARCHAR(30) NOT NULL CHECK (contract_type IN ('CDI', 'CDD', 'interim', 'stage', 'apprentissage')),
        duration_months INTEGER,
        start_date DATE NOT NULL,
        end_date DATE,
        origin VARCHAR(30) NOT NULL DEFAULT 'embauche' CHECK (origin IN ('embauche', 'renouvellement')),
        weekly_hours DOUBLE PRECISION NOT NULL DEFAULT 35 CHECK (weekly_hours IN (26, 35)),
        team_id INTEGER REFERENCES teams(id),
        position_id INTEGER REFERENCES positions(id),
        is_current BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Jours d'indisponibilité hebdomadaire
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_availability (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        day_off VARCHAR(10) NOT NULL CHECK (day_off IN ('lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche')),
        UNIQUE(employee_id, day_off)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schedule (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('work', 'training', 'rest', 'leave', 'vak')),
        position_id INTEGER REFERENCES positions(id),
        is_provisional BOOLEAN DEFAULT true,
        confirmed_by INTEGER REFERENCES users(id),
        confirmed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, date)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS work_hours (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        hours_worked DOUBLE PRECISION NOT NULL,
        overtime_hours DOUBLE PRECISION DEFAULT 0,
        type VARCHAR(20) DEFAULT 'normal' CHECK (type IN ('normal', 'training', 'absence', 'sick', 'holiday')),
        notes TEXT,
        validated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, date)
      );
    `);
    console.log('[INIT-DB] Module 4 (Équipes & Planning) ✓');

    // ══════════════════════════════════════════
    // MODULE 5 : Collecte
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS cav (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500),
        commune VARCHAR(100),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        geom GEOMETRY(Point, 4326),
        nb_containers INTEGER DEFAULT 1,
        qr_code_data VARCHAR(255) UNIQUE,
        qr_code_image_path VARCHAR(500),
        avg_fill_rate DOUBLE PRECISION DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'unavailable')),
        unavailable_reason TEXT,
        unavailable_since DATE,
        route_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_cav_geom ON cav USING GIST(geom);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_cav_status ON cav(status);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS cav_qr_scans (
        id SERIAL PRIMARY KEY,
        cav_id INTEGER REFERENCES cav(id) ON DELETE CASCADE,
        tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
        scanned_by INTEGER REFERENCES users(id),
        scan_type VARCHAR(30) DEFAULT 'collection' CHECK (scan_type IN ('collection', 'inspection', 'maintenance', 'inventory')),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        notes TEXT,
        scanned_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_cav_qr_scans_cav ON cav_qr_scans(cav_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_cav_qr_scans_date ON cav_qr_scans(scanned_at DESC);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        registration VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100),
        max_capacity_kg DOUBLE PRECISION NOT NULL DEFAULT 3500,
        team_id INTEGER REFERENCES teams(id),
        status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'maintenance', 'out_of_service')),
        current_km INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS standard_routes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        estimated_duration_minutes INTEGER,
        estimated_distance_km DOUBLE PRECISION,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS standard_route_cav (
        id SERIAL PRIMARY KEY,
        route_id INTEGER REFERENCES standard_routes(id) ON DELETE CASCADE,
        cav_id INTEGER REFERENCES cav(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        UNIQUE(route_id, cav_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tours (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        vehicle_id INTEGER REFERENCES vehicles(id),
        driver_employee_id INTEGER REFERENCES employees(id),
        standard_route_id INTEGER REFERENCES standard_routes(id),
        mode VARCHAR(20) NOT NULL CHECK (mode IN ('intelligent', 'standard', 'manual')),
        status VARCHAR(20) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled')),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        total_weight_kg DOUBLE PRECISION DEFAULT 0,
        ai_explanation TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tour_cav (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
        cav_id INTEGER REFERENCES cav(id),
        position INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending'
          CHECK (status IN ('pending', 'collected', 'skipped', 'incident')),
        fill_level INTEGER CHECK (fill_level BETWEEN 0 AND 5),
        qr_scanned BOOLEAN DEFAULT false,
        qr_unavailable BOOLEAN DEFAULT false,
        qr_unavailable_reason VARCHAR(100),
        photo_path VARCHAR(500),
        collected_at TIMESTAMP,
        notes TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tour_weights (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
        weight_kg DOUBLE PRECISION NOT NULL,
        recorded_at TIMESTAMP DEFAULT NOW(),
        recorded_by INTEGER REFERENCES employees(id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id),
        cav_id INTEGER REFERENCES cav(id),
        employee_id INTEGER REFERENCES employees(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        type VARCHAR(50) NOT NULL CHECK (type IN ('cav_problem', 'environment', 'vehicle_breakdown', 'accident', 'other')),
        description TEXT,
        photo_path VARCHAR(500),
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
        resolved_at TIMESTAMP,
        resolved_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS gps_positions (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
        vehicle_id INTEGER REFERENCES vehicles(id),
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        speed DOUBLE PRECISION,
        recorded_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_gps_tour ON gps_positions(tour_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_gps_time ON gps_positions(recorded_at);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS tonnage_history (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        cav_id INTEGER REFERENCES cav(id),
        route_name VARCHAR(100),
        weight_kg DOUBLE PRECISION NOT NULL,
        source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'mobile')),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_checklists (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        employee_id INTEGER REFERENCES employees(id),
        exterior_ok BOOLEAN NOT NULL,
        fuel_level VARCHAR(10) NOT NULL CHECK (fuel_level IN ('1/4', '1/2', '3/4', 'full')),
        km_start INTEGER NOT NULL,
        km_end INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module 5 (Collecte) ✓');

    // ══════════════════════════════════════════
    // MODULE 6 : Stock & Matériaux
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS matieres (
        id SERIAL PRIMARY KEY,
        categorie VARCHAR(100) NOT NULL,
        sous_categorie VARCHAR(100),
        qualite VARCHAR(50),
        destination_possible TEXT[],
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) NOT NULL CHECK (type IN ('entree', 'sortie')),
        date DATE NOT NULL,
        poids_kg DOUBLE PRECISION NOT NULL,
        matiere_id INTEGER REFERENCES matieres(id),
        destination VARCHAR(255),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        code_barre VARCHAR(20),
        origine VARCHAR(100),
        categorie_collecte VARCHAR(100),
        poids_brut_kg DOUBLE PRECISION,
        tare_kg DOUBLE PRECISION,
        vehicle_id INTEGER REFERENCES vehicles(id),
        tour_id INTEGER REFERENCES tours(id),
        scan_sortie_at TIMESTAMP,
        scan_inventaire_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS flux_sortants (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        type VARCHAR(30) NOT NULL CHECK (type IN ('vente', 'recyclage', 'upcycling', 'vak')),
        matiere_id INTEGER REFERENCES matieres(id),
        poids_kg DOUBLE PRECISION NOT NULL,
        valeur_euros DOUBLE PRECISION,
        destination VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module 6 (Stock & Matériaux) ✓');

    // ══════════════════════════════════════════
    // MODULE 7 : Facturation
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_address TEXT,
        client_email VARCHAR(255),
        date DATE NOT NULL,
        due_date DATE,
        total_ht DOUBLE PRECISION DEFAULT 0,
        total_tva DOUBLE PRECISION DEFAULT 0,
        total_ttc DOUBLE PRECISION DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
        paid_at TIMESTAMP,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS invoice_lines (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        description TEXT NOT NULL,
        quantity DOUBLE PRECISION DEFAULT 1,
        unit_price DOUBLE PRECISION DEFAULT 0,
        total DOUBLE PRECISION DEFAULT 0
      );
    `);
    console.log('[INIT-DB] Module 7 (Facturation) ✓');

    // ══════════════════════════════════════════
    // MODULE 8 : Production
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_daily (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        effectif_theorique INTEGER,
        effectif_reel INTEGER,
        entree_ligne_kg DOUBLE PRECISION DEFAULT 0,
        objectif_entree_ligne_kg DOUBLE PRECISION DEFAULT 1300,
        entree_recyclage_r3_kg DOUBLE PRECISION DEFAULT 0,
        objectif_entree_r3_kg DOUBLE PRECISION DEFAULT 1300,
        total_jour_t DOUBLE PRECISION DEFAULT 0,
        productivite_kg_per DOUBLE PRECISION DEFAULT 0,
        encadrant VARCHAR(100),
        commentaire TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reporting_refashion (
        id SERIAL PRIMARY KEY,
        periode VARCHAR(20) NOT NULL,
        tonnage_collecte DOUBLE PRECISION DEFAULT 0,
        tonnage_trie DOUBLE PRECISION DEFAULT 0,
        tonnage_valorise DOUBLE PRECISION DEFAULT 0,
        tonnage_recycle DOUBLE PRECISION DEFAULT 0,
        conformite_cdc BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module 8 (Production) ✓');

    // ══════════════════════════════════════════
    // MODULE V2 : Référentiels & Tri
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS associations (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(255) NOT NULL,
        type VARCHAR(100),
        adresse TEXT,
        commune VARCHAR(100),
        contact_nom VARCHAR(100),
        contact_tel VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS exutoires (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(50),
        adresse TEXT,
        contact_nom VARCHAR(100),
        contact_email VARCHAR(255),
        contact_tel VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS produits_catalogue (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(255) NOT NULL,
        categorie_eco_org VARCHAR(100) NOT NULL,
        genre VARCHAR(50),
        saison VARCHAR(20) DEFAULT 'Sans Saison',
        gamme VARCHAR(20) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(nom, categorie_eco_org, genre, saison, gamme)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS categories_sortantes (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL UNIQUE,
        famille VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT true
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS types_conteneurs (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(50) NOT NULL UNIQUE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chaines_tri (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT true
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS operations_tri (
        id SERIAL PRIMARY KEY,
        chaine_id INTEGER REFERENCES chaines_tri(id) NOT NULL,
        numero INTEGER NOT NULL,
        nom VARCHAR(100) NOT NULL,
        code VARCHAR(20) NOT NULL UNIQUE,
        est_obligatoire BOOLEAN DEFAULT true,
        description TEXT,
        UNIQUE(chaine_id, numero)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS postes_operation (
        id SERIAL PRIMARY KEY,
        operation_id INTEGER REFERENCES operations_tri(id) NOT NULL,
        nom VARCHAR(100) NOT NULL,
        code VARCHAR(20) NOT NULL UNIQUE,
        est_obligatoire BOOLEAN DEFAULT true,
        permet_doublure BOOLEAN DEFAULT false,
        competences_requises TEXT[],
        is_active BOOLEAN DEFAULT true
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sorties_operation (
        id SERIAL PRIMARY KEY,
        operation_id INTEGER REFERENCES operations_tri(id) NOT NULL,
        nom VARCHAR(100) NOT NULL,
        type_sortie VARCHAR(20) NOT NULL
          CHECK (type_sortie IN ('produit_fini', 'recyclage', 'csr', 'vers_operation', 'exutoire_direct')),
        operation_destination_id INTEGER REFERENCES operations_tri(id),
        categorie_sortante_id INTEGER REFERENCES categories_sortantes(id),
        UNIQUE(operation_id, nom)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS produits_finis (
        id SERIAL PRIMARY KEY,
        code_barre VARCHAR(20) NOT NULL UNIQUE,
        catalogue_id INTEGER REFERENCES produits_catalogue(id),
        produit VARCHAR(255),
        categorie_eco_org VARCHAR(100),
        genre VARCHAR(50),
        saison VARCHAR(20),
        gamme VARCHAR(20),
        poids_kg DOUBLE PRECISION NOT NULL,
        date_fabrication TIMESTAMP NOT NULL,
        poste_id INTEGER REFERENCES postes_operation(id),
        date_sortie TIMESTAMP,
        date_inventaire TIMESTAMP,
        exutoire_id INTEGER REFERENCES exutoires(id),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS expeditions (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        exutoire_id INTEGER REFERENCES exutoires(id) NOT NULL,
        categorie_sortante_id INTEGER REFERENCES categories_sortantes(id) NOT NULL,
        type_conteneur_id INTEGER REFERENCES types_conteneurs(id),
        nb_conteneurs INTEGER DEFAULT 1,
        poids_kg DOUBLE PRECISION NOT NULL,
        valeur_euros DOUBLE PRECISION,
        bon_livraison VARCHAR(100),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module V2 (Référentiels & Tri) ✓');

    // ══════════════════════════════════════════
    // MODULE : Grille tarifaire
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS grille_tarifaire (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        exutoire_id INTEGER REFERENCES exutoires(id),
        prix_tonne DOUBLE PRECISION NOT NULL,
        trimestre INTEGER CHECK (trimestre BETWEEN 1 AND 4),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS grille_tarifaire_uniq
      ON grille_tarifaire (annee, type, COALESCE(exutoire_id, 0), COALESCE(trimestre, 0));
    `);
    console.log('[INIT-DB] Module Grille tarifaire ✓');

    // ══════════════════════════════════════════
    // MODULE V2 : Refashion
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS refashion_dpav (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        trimestre INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
        stock_debut_t DOUBLE PRECISION DEFAULT 0,
        stock_fin_t DOUBLE PRECISION DEFAULT 0,
        achats_t DOUBLE PRECISION DEFAULT 0,
        ventes_reemploi_t DOUBLE PRECISION DEFAULT 0,
        ventes_recyclage_t DOUBLE PRECISION DEFAULT 0,
        csr_t DOUBLE PRECISION DEFAULT 0,
        energie_t DOUBLE PRECISION DEFAULT 0,
        tri_t DOUBLE PRECISION DEFAULT 0,
        conformite_cdc BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(annee, trimestre)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refashion_communes (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        trimestre INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
        commune VARCHAR(100) NOT NULL,
        code_postal VARCHAR(10),
        poids_kg DOUBLE PRECISION DEFAULT 0,
        UNIQUE(annee, trimestre, commune)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refashion_subventions (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        trimestre INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
        taux_reemploi_euro_t DOUBLE PRECISION DEFAULT 80,
        taux_recyclage_euro_t DOUBLE PRECISION DEFAULT 295,
        taux_csr_euro_t DOUBLE PRECISION DEFAULT 210,
        taux_energie_euro_t DOUBLE PRECISION DEFAULT 20,
        taux_entree_euro_t DOUBLE PRECISION DEFAULT 193,
        tonnage_reemploi DOUBLE PRECISION DEFAULT 0,
        tonnage_recyclage DOUBLE PRECISION DEFAULT 0,
        tonnage_csr DOUBLE PRECISION DEFAULT 0,
        tonnage_energie DOUBLE PRECISION DEFAULT 0,
        tonnage_entree DOUBLE PRECISION DEFAULT 0,
        part_non_tlc DOUBLE PRECISION DEFAULT 0,
        montant_reemploi DOUBLE PRECISION DEFAULT 0,
        montant_recyclage DOUBLE PRECISION DEFAULT 0,
        montant_csr DOUBLE PRECISION DEFAULT 0,
        montant_energie DOUBLE PRECISION DEFAULT 0,
        montant_entree DOUBLE PRECISION DEFAULT 0,
        montant_total DOUBLE PRECISION DEFAULT 0,
        UNIQUE(annee, trimestre)
      );
    `);
    console.log('[INIT-DB] Module V2 (Refashion) ✓');

    // ══════════════════════════════════════════
    // MODULE IA : Modèle prédictif collecte
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_fill_predictions (
        id SERIAL PRIMARY KEY,
        cav_id INTEGER REFERENCES cav(id) ON DELETE CASCADE,
        predicted_date DATE NOT NULL,
        predicted_fill_rate DOUBLE PRECISION NOT NULL,
        confidence DOUBLE PRECISION DEFAULT 0,
        model_version VARCHAR(50),
        features JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(cav_id, predicted_date)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_model_metadata (
        id SERIAL PRIMARY KEY,
        model_name VARCHAR(100) NOT NULL,
        version VARCHAR(50) NOT NULL,
        metrics JSONB,
        trained_at TIMESTAMP DEFAULT NOW(),
        training_samples INTEGER,
        is_active BOOLEAN DEFAULT true,
        model_path VARCHAR(500),
        UNIQUE(model_name, version)
      );
    `);
    console.log('[INIT-DB] Module IA (ML Prédictif) ✓');

    // Contexte collecte (météo, trafic) et apprentissage continu
    await client.query(`
      CREATE TABLE IF NOT EXISTS collection_context (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        weather_code VARCHAR(20),
        weather_label VARCHAR(50),
        temp_max DOUBLE PRECISION,
        precip_mm DOUBLE PRECISION,
        weather_factor DOUBLE PRECISION DEFAULT 1.0,
        traffic_factor DOUBLE PRECISION DEFAULT 1.0,
        duration_factor DOUBLE PRECISION DEFAULT 1.0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS evenements_locaux (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'brocante',
        date_debut DATE NOT NULL,
        date_fin DATE NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        adresse TEXT,
        commune VARCHAR(100),
        rayon_km DOUBLE PRECISION DEFAULT 2,
        bonus_factor DOUBLE PRECISION DEFAULT 1.2,
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TABLE tour_cav ADD COLUMN predicted_fill_rate DOUBLE PRECISION;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS collection_learning_feedback (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
        cav_id INTEGER REFERENCES cav(id) ON DELETE CASCADE,
        predicted_fill_rate DOUBLE PRECISION NOT NULL,
        observed_fill_level INTEGER CHECK (observed_fill_level BETWEEN 0 AND 5),
        predicted_weight_kg DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Tables contexte & apprentissage collecte ✓');

    // ══════════════════════════════════════════
    // MODULE : Historique (Dashboard Excel)
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS historique_mensuel (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
        section VARCHAR(50) NOT NULL,
        categorie VARCHAR(255) NOT NULL,
        valeur DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(annee, mois, section, categorie)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_historique_mensuel_annee ON historique_mensuel(annee, mois);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_historique_mensuel_section ON historique_mensuel(section);`);
    console.log('[INIT-DB] Table historique_mensuel ✓');

    // ══════════════════════════════════════════
    // MODULE RGPD : Conformité
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS rgpd_registre (
        id SERIAL PRIMARY KEY,
        nom_traitement VARCHAR(255) NOT NULL,
        finalite TEXT NOT NULL,
        base_legale VARCHAR(100) NOT NULL,
        categories_personnes TEXT,
        categories_donnees TEXT,
        destinataires TEXT,
        duree_conservation VARCHAR(100),
        mesures_securite TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rgpd_consents (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER NOT NULL,
        consent_type VARCHAR(100) NOT NULL,
        granted BOOLEAN DEFAULT true,
        comment TEXT,
        recorded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(entity_type, entity_id, consent_type)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rgpd_audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INTEGER,
        details JSONB,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rgpd_audit_created ON rgpd_audit_log(created_at DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rgpd_audit_action ON rgpd_audit_log(action);');
    console.log('[INIT-DB] Module RGPD ✓');

    // ══════════════════════════════════════════
    // MIGRATIONS (ajout colonnes sans casser l'existant)
    // ══════════════════════════════════════════
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN candidate_id INTEGER UNIQUE REFERENCES candidates(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // Tables pour exécution tri et colisages
    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_tracking (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        stock_movement_id INTEGER REFERENCES stock_movements(id),
        chaine_id INTEGER REFERENCES chaines_tri(id),
        poids_initial_kg DOUBLE PRECISION NOT NULL,
        poids_restant_kg DOUBLE PRECISION,
        status VARCHAR(20) DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'en_cours', 'termine', 'annule')),
        date_debut TIMESTAMP,
        date_fin TIMESTAMP,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS operation_executions (
        id SERIAL PRIMARY KEY,
        batch_id INTEGER REFERENCES batch_tracking(id) NOT NULL,
        operation_id INTEGER REFERENCES operations_tri(id) NOT NULL,
        status VARCHAR(20) DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'en_cours', 'termine')),
        poids_entree_kg DOUBLE PRECISION,
        poids_sortie_total_kg DOUBLE PRECISION,
        perte_kg DOUBLE PRECISION DEFAULT 0,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        completed_by INTEGER REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS operation_outputs (
        id SERIAL PRIMARY KEY,
        execution_id INTEGER REFERENCES operation_executions(id) NOT NULL,
        sortie_id INTEGER REFERENCES sorties_operation(id) NOT NULL,
        poids_kg DOUBLE PRECISION NOT NULL,
        categorie_sortante_id INTEGER REFERENCES categories_sortantes(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS colisages (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        categorie_sortante_id INTEGER REFERENCES categories_sortantes(id),
        type_conteneur_id INTEGER REFERENCES types_conteneurs(id),
        poids_kg DOUBLE PRECISION DEFAULT 0,
        nb_articles INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'ouvert' CHECK (status IN ('ouvert', 'scelle', 'expedie', 'livre')),
        exutoire_id INTEGER REFERENCES exutoires(id),
        expedition_id INTEGER REFERENCES expeditions(id),
        scelle_at TIMESTAMP,
        scelle_by INTEGER REFERENCES users(id),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS colisage_items (
        id SERIAL PRIMARY KEY,
        colisage_id INTEGER REFERENCES colisages(id) NOT NULL,
        output_id INTEGER REFERENCES operation_outputs(id),
        produit_fini_id INTEGER REFERENCES produits_finis(id),
        poids_kg DOUBLE PRECISION,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS colisage_history (
        id SERIAL PRIMARY KEY,
        colisage_id INTEGER REFERENCES colisages(id) NOT NULL,
        from_status VARCHAR(20),
        to_status VARCHAR(20) NOT NULL,
        comment TEXT,
        changed_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Status field for expeditions
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE expeditions ADD COLUMN status VARCHAR(20) DEFAULT 'preparee' CHECK (status IN ('preparee', 'chargee', 'expediee', 'livree'));
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // Status field for produits_finis
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE produits_finis ADD COLUMN status VARCHAR(20) DEFAULT 'en_stock' CHECK (status IN ('en_stock', 'colise', 'expedie', 'vendu'));
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    console.log('[INIT-DB] Migrations (candidate_id, exécution tri, colisages) ✓');

    // ══════════════════════════════════════════
    // DONNÉES INITIALES (Seeds)
    // ══════════════════════════════════════════

    // Admin par défaut
    const adminExists = await client.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(
        `INSERT INTO users (username, password_hash, email, role, first_name, last_name)
         VALUES ('admin', $1, 'admin@solidata.fr', 'ADMIN', 'Administrateur', 'Système')`,
        [hash]
      );
      console.log('[INIT-DB] Utilisateur admin créé (admin / admin123)');
    }

    // Migration: update teams constraint + data — drop ALL check constraints on type column
    const teamChecks = await client.query(`
      SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
      WHERE con.conrelid = 'teams'::regclass AND con.contype = 'c' AND att.attname = 'type'
    `);
    for (const row of teamChecks.rows) {
      await client.query(`ALTER TABLE teams DROP CONSTRAINT IF EXISTS "${row.conname}"`);
    }
    await client.query(`
      UPDATE teams SET type = 'logistique' WHERE type IS NOT NULL AND type NOT IN ('tri', 'collecte', 'logistique', 'btq_st_sever', 'btq_lhopital', 'administration');
      ALTER TABLE teams ADD CONSTRAINT teams_type_check
        CHECK (type IN ('tri', 'collecte', 'logistique', 'btq_st_sever', 'btq_lhopital', 'administration'));
    `);

    // Équipes par défaut
    const teamsExist = await client.query("SELECT id FROM teams LIMIT 1");
    if (teamsExist.rows.length === 0) {
      await client.query(`
        INSERT INTO teams (name, type) VALUES
          ('Tri', 'tri'),
          ('Collecte', 'collecte'),
          ('Logistique', 'logistique'),
          ('Btq St Sever', 'btq_st_sever'),
          ('Btq L''Hopital', 'btq_lhopital'),
          ('Administration', 'administration');
      `);
      console.log('[INIT-DB] 6 équipes créées');
    }

    // Postes par défaut
    const positionsExist = await client.query("SELECT id FROM positions LIMIT 1");
    if (positionsExist.rows.length === 0) {
      await client.query(`
        INSERT INTO positions (title, required_skills, team_type) VALUES
          ('Opérateur de tri', ARRAY['tri_textile', 'controle_qualite'], 'tri'),
          ('Opérateur Logistique', ARRAY['manutention', 'logistique'], 'logistique'),
          ('Chauffeur', ARRAY['permis_b', 'collecte'], 'collecte'),
          ('Suiveur', ARRAY['collecte', 'manutention'], 'collecte');
      `);
      console.log('[INIT-DB] 4 postes créés');
    }

    // Types de conteneurs
    const conteneursExist = await client.query("SELECT id FROM types_conteneurs LIMIT 1");
    if (conteneursExist.rows.length === 0) {
      await client.query(`
        INSERT INTO types_conteneurs (nom) VALUES
          ('Balles'), ('Cartons'), ('Bobines'), ('Sacs'), ('Remorques');
      `);
      console.log('[INIT-DB] 5 types de conteneurs créés');
    }

    // Catégories sortantes (17 catégories)
    const catExist = await client.query("SELECT id FROM categories_sortantes LIMIT 1");
    if (catExist.rows.length === 0) {
      await client.query(`
        INSERT INTO categories_sortantes (nom, famille) VALUES
          ('Chiffons Coton Blanc', 'chiffons'),
          ('Chiffons Coton Couleur', 'chiffons'),
          ('Chiffons Synthétiques', 'chiffons'),
          ('CSR Textile', 'csr'),
          ('CSR Non-Textile', 'csr'),
          ('Originaux 1er Choix', 'original'),
          ('Originaux 2ème Choix', 'original'),
          ('Originaux 3ème Choix', 'original'),
          ('Pré-classé Hiver', 'pre_classe'),
          ('Pré-classé Été', 'pre_classe'),
          ('Effilochage Coton', 'effilochage'),
          ('Effilochage Laine', 'effilochage'),
          ('Effilochage Synthétique', 'effilochage'),
          ('Déstockage', 'destockage'),
          ('VAK Export', 'vak'),
          ('VAK Afrique', 'vak'),
          ('VAK Moyen-Orient', 'vak'),
          ('Extra 1er Choix', 'extra'),
          ('Extra 2ème Choix', 'extra')
        ON CONFLICT (nom) DO NOTHING;
      `);
      console.log('[INIT-DB] Catégories sortantes créées');
    }

    // Chaînes de tri (2 chaînes)
    const chainesExist = await client.query("SELECT id FROM chaines_tri LIMIT 1");
    if (chainesExist.rows.length === 0) {
      const chaineQRes = await client.query(
        "INSERT INTO chaines_tri (nom, description) VALUES ('Qualité', 'Chaîne de tri qualité - textiles réutilisables et recyclables') RETURNING id"
      );
      const chaineQId = chaineQRes.rows[0].id;

      const chaineRRes = await client.query(
        "INSERT INTO chaines_tri (nom, description) VALUES ('Recyclage Exclusif', 'Chaîne recyclage - matières non réutilisables') RETURNING id"
      );
      const chaineRId = chaineRRes.rows[0].id;

      // Opérations chaîne Qualité
      await client.query(`
        INSERT INTO operations_tri (chaine_id, numero, nom, code, est_obligatoire, description) VALUES
          ($1, 1, 'Crackage 1', 'CRACK1', true, 'Premier tri grossier - séparation réutilisable/recyclable'),
          ($1, 2, 'Crackage 2', 'CRACK2', true, 'Second tri - affinage par catégorie'),
          ($1, 3, 'Recyclage', 'RECYC', true, 'Tri des matières recyclables par type'),
          ($1, 4, 'Réemploi', 'REEMP', true, 'Sélection des pièces réutilisables'),
          ($1, 5, 'Tri Fin', 'TRIFIN', false, 'Tri final par gamme et qualité');
      `, [chaineQId]);

      // Opération chaîne Recyclage Exclusif
      await client.query(`
        INSERT INTO operations_tri (chaine_id, numero, nom, code, est_obligatoire) VALUES
          ($1, 1, 'Recyclage Exclusif', 'REXCL', true);
      `, [chaineRId]);

      console.log('[INIT-DB] 2 chaînes de tri créées avec opérations');
    }

    // Templates de messages
    const templatesExist = await client.query("SELECT id FROM message_templates LIMIT 1");
    if (templatesExist.rows.length === 0) {
      await client.query(`
        INSERT INTO message_templates (name, type, category, subject, body, variables) VALUES
          ('Convocation entretien', 'sms', 'recrutement',
           NULL,
           'Bonjour {prenom}, votre entretien chez Solidarité Textiles est prévu le {date} à {heure} au {lieu}. Merci de confirmer par retour.',
           ARRAY['prenom', 'date', 'heure', 'lieu']),
          ('Confirmation recrutement', 'email', 'recrutement',
           'Bienvenue chez Solidarité Textiles',
           'Bonjour {prenom} {nom},\n\nNous avons le plaisir de vous confirmer votre recrutement au poste de {poste} dans l''équipe {equipe}.\n\nVotre date de début est le {date_debut}.\n\nCordialement,\nL''équipe RH',
           ARRAY['prenom', 'nom', 'poste', 'equipe', 'date_debut']),
          ('Refus candidature', 'email', 'recrutement',
           'Suite à votre candidature',
           'Bonjour {prenom} {nom},\n\nNous avons bien étudié votre candidature et nous ne sommes malheureusement pas en mesure de donner une suite favorable.\n\nCordialement,\nL''équipe RH',
           ARRAY['prenom', 'nom']),
          ('Rappel entretien', 'sms', 'recrutement',
           NULL,
           'Rappel : votre entretien chez Solidarité Textiles est demain {date} à {heure}. À bientôt !',
           ARRAY['date', 'heure']);
      `);
      console.log('[INIT-DB] 4 templates de messages créés');
    }

    // Paramètres par défaut
    const settingsExist = await client.query("SELECT id FROM settings LIMIT 1");
    if (settingsExist.rows.length === 0) {
      await client.query(`
        INSERT INTO settings (key, value, category) VALUES
          ('company_name', 'Solidarité Textiles', 'general'),
          ('company_address', 'Zone Industrielle, 76000 Rouen', 'general'),
          ('company_siret', '', 'general'),
          ('company_phone', '', 'general'),
          ('centre_tri_lat', '49.4231', 'collecte'),
          ('centre_tri_lng', '1.0993', 'collecte'),
          ('default_vehicle_capacity', '3500', 'collecte'),
          ('tva_rate', '20', 'facturation'),
          ('objectif_entree_ligne_kg', '1300', 'production'),
          ('objectif_entree_r3_kg', '1300', 'production'),
          ('co2_factor_kg', '3.6', 'environnement');
      `);
      console.log('[INIT-DB] Paramètres par défaut créés');
    }

    // ══════════════════════════════════════════
    // Migrations for existing databases
    // ══════════════════════════════════════════
    await client.query(`
      ALTER TABLE cav ALTER COLUMN latitude DROP NOT NULL;
      ALTER TABLE cav ALTER COLUMN longitude DROP NOT NULL;
    `);
    await client.query(`
      ALTER TABLE tonnage_history ADD COLUMN IF NOT EXISTS route_name VARCHAR(100);
    `);
    await client.query(`
      ALTER TABLE tonnage_history ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';
    `);

    await client.query('COMMIT');
    // ══════════════════════════════════════════
    // MIGRATION : Kanban statuses v2
    // ══════════════════════════════════════════
    console.log('[INIT-DB] Migration statuts Kanban...');

    // Add position_id column if missing
    await client.query(`
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS position_id INTEGER;
    `);
    await client.query(`
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS comment TEXT;
    `);

    // Drop ALL check constraints on status column FIRST (before updating values)
    const candidateChecks = await client.query(`
      SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
      WHERE con.conrelid = 'candidates'::regclass AND con.contype = 'c' AND att.attname = 'status'
    `);
    for (const row of candidateChecks.rows) {
      await client.query(`ALTER TABLE candidates DROP CONSTRAINT IF EXISTS "${row.conname}"`);
    }

    // Now migrate old statuses to new ones (constraint is gone, so new values are accepted)
    await client.query(`
      UPDATE candidates SET status = 'preselected' WHERE status = 'to_contact';
      UPDATE candidates SET status = 'interview' WHERE status = 'summoned';
      UPDATE candidates SET status = 'hired' WHERE status = 'recruited';
      UPDATE candidates SET status = 'received' WHERE status IS NULL OR status NOT IN ('received', 'preselected', 'interview', 'test', 'hired');
    `);

    // Re-add the constraint with the new allowed values
    await client.query(`
      ALTER TABLE candidates ADD CONSTRAINT candidates_status_check
        CHECK (status IN ('received', 'preselected', 'interview', 'test', 'hired'));
    `);

    // Migrate positions table: add new columns if missing
    await client.query(`
      ALTER TABLE positions ADD COLUMN IF NOT EXISTS title VARCHAR(200);
      ALTER TABLE positions ADD COLUMN IF NOT EXISTS type VARCHAR(50);
      ALTER TABLE positions ADD COLUMN IF NOT EXISTS month VARCHAR(20);
      ALTER TABLE positions ADD COLUMN IF NOT EXISTS slots_open INTEGER DEFAULT 1;
      ALTER TABLE positions ADD COLUMN IF NOT EXISTS slots_filled INTEGER DEFAULT 0;
      ALTER TABLE positions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    `);
    // Copy name to title if legacy 'name' column exists
    const hasNameCol = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'positions' AND column_name = 'name' LIMIT 1;
    `);
    if (hasNameCol.rows.length > 0) {
      await client.query(`UPDATE positions SET title = name WHERE title IS NULL AND name IS NOT NULL;`);
    }

    console.log('[INIT-DB] Migration statuts Kanban ✓');

    // ══════════════════════════════════════════
    // MIGRATION : Grille tarifaire + catégories Extra
    // ══════════════════════════════════════════
    await client.query(`
      INSERT INTO categories_sortantes (nom, famille) VALUES
        ('Extra 1er Choix', 'extra'),
        ('Extra 2ème Choix', 'extra')
      ON CONFLICT (nom) DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS grille_tarifaire (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        exutoire_id INTEGER REFERENCES exutoires(id),
        prix_tonne DOUBLE PRECISION NOT NULL,
        trimestre INTEGER CHECK (trimestre BETWEEN 1 AND 4),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS grille_tarifaire_uniq
      ON grille_tarifaire (annee, type, COALESCE(exutoire_id, 0), COALESCE(trimestre, 0));
    `);

    console.log('[INIT-DB] Migration grille tarifaire ✓');

    // ══════════════════════════════════════════
    // MIGRATION : Météo étendue + événements locaux
    // ══════════════════════════════════════════
    await client.query(`
      ALTER TABLE collection_context ADD COLUMN IF NOT EXISTS weather_label VARCHAR(50);
      ALTER TABLE collection_context ADD COLUMN IF NOT EXISTS temp_max DOUBLE PRECISION;
      ALTER TABLE collection_context ADD COLUMN IF NOT EXISTS precip_mm DOUBLE PRECISION;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS evenements_locaux (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'brocante',
        date_debut DATE NOT NULL,
        date_fin DATE NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        adresse TEXT,
        commune VARCHAR(100),
        rayon_km DOUBLE PRECISION DEFAULT 2,
        bonus_factor DOUBLE PRECISION DEFAULT 1.2,
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('[INIT-DB] Migration météo + événements locaux ✓');

    // ══════════════════════════════════════════
    // MIGRATION : UNIQUE index on cav.name + import Excel support
    // ══════════════════════════════════════════
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cav_name_unique ON cav (name);
    `);
    await client.query(`
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS tournee VARCHAR(100);
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS jours_collecte VARCHAR(100);
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS freq_passage INTEGER DEFAULT 0;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS last_collection_date DATE;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS next_collection_date DATE;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS estimated_fill_rate DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS daily_fill_rate DOUBLE PRECISION DEFAULT 0;
    `);
    console.log('[INIT-DB] Migration CAV (unique name + fill rate columns) ✓');

    console.log('\n[INIT-DB] ══════════════════════════════════════');
    console.log('[INIT-DB] Base de données initialisée avec succès !');
    console.log('[INIT-DB] ══════════════════════════════════════\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[INIT-DB] ERREUR :', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Ne faire process.exit que si le script est lancé en direct (node init-db.js)
// Sinon, quand on est chargé depuis le serveur, ne pas quitter le processus
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  module.exports = { initDatabase };
}
