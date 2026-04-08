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
    // MODULE 4b : Pointage / Badgeage
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS pointage_terminals (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        location VARCHAR(200) DEFAULT 'Centre de tri',
        api_key VARCHAR(255) NOT NULL UNIQUE,
        is_active BOOLEAN DEFAULT true,
        last_ping TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS badges (
        id SERIAL PRIMARY KEY,
        badge_uid VARCHAR(50) NOT NULL UNIQUE,
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        label VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        assigned_at TIMESTAMP,
        unassigned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pointage_events (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        badge_uid VARCHAR(50),
        terminal_id INTEGER REFERENCES pointage_terminals(id),
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        event_time TIMESTAMP NOT NULL DEFAULT NOW(),
        event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('entry', 'exit', 'unknown', 'excess')),
        status VARCHAR(20) NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'rejected', 'duplicate')),
        source VARCHAR(20) NOT NULL DEFAULT 'badge' CHECK (source IN ('badge', 'manual')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Index pour performances
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pointage_events_date ON pointage_events(date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pointage_events_employee ON pointage_events(employee_id, date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_badges_uid ON badges(badge_uid);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_badges_employee ON badges(employee_id);`);

    console.log('[INIT-DB] Module 4b (Pointage / Badgeage) ✓');

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

    // Note: cav_qr_scans est créée plus bas, après la table tours (dépendance FK)

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
        estimated_distance_km DOUBLE PRECISION,
        estimated_duration_min INTEGER,
        nb_cav INTEGER DEFAULT 0,
        ai_explanation TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // cav_qr_scans : créée ici car dépend de tours(id)
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
    // Ajouter les colonnes distance/durée/nb_cav à tours si manquantes
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE tours ADD COLUMN estimated_distance_km DOUBLE PRECISION;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE tours ADD COLUMN estimated_duration_min INTEGER;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE tours ADD COLUMN nb_cav INTEGER DEFAULT 0;
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

      // Postes de travail pour chaque opération (correspondant à la feuille de production Excel)
      // Récupérer les IDs des opérations
      const opsResult = await client.query("SELECT id, code FROM operations_tri ORDER BY id");
      const opsByCode = {};
      for (const op of opsResult.rows) opsByCode[op.code] = op.id;

      if (opsByCode.CRACK1) {
        await client.query(`
          INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure) VALUES
            ($1, 'Craquage poste 1', 'CRACK1_P1', true, false),
            ($1, 'Craquage poste 2', 'CRACK1_P2', true, false)
        `, [opsByCode.CRACK1]);
      }
      if (opsByCode.CRACK2) {
        await client.query(`
          INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure) VALUES
            ($1, 'Craquage 2 poste 1', 'CRACK2_P1', false, false)
        `, [opsByCode.CRACK2]);
      }
      if (opsByCode.RECYC) {
        await client.query(`
          INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure) VALUES
            ($1, 'Recyclage R1', 'RECYC_R1', true, false),
            ($1, 'Recyclage R2', 'RECYC_R2', true, false),
            ($1, 'Recyclage R3', 'RECYC_R3', true, false),
            ($1, 'Recyclage R4', 'RECYC_R4', true, false)
        `, [opsByCode.RECYC]);
      }
      if (opsByCode.REEMP) {
        await client.query(`
          INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure) VALUES
            ($1, 'Réutilisation', 'REEMP_P1', true, true)
        `, [opsByCode.REEMP]);
      }
      if (opsByCode.TRIFIN) {
        await client.query(`
          INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure) VALUES
            ($1, 'Homme VAK / BTQ', 'TRIFIN_HVAK', false, true),
            ($1, 'Femme VAK / BTQ', 'TRIFIN_FVAK', false, true),
            ($1, 'Layette VAK / BTQ', 'TRIFIN_LVAK', false, true),
            ($1, 'Accessoire', 'TRIFIN_ACC', false, true),
            ($1, 'Chiffon', 'TRIFIN_CHF', false, true)
        `, [opsByCode.TRIFIN]);
      }
      if (opsByCode.REXCL) {
        await client.query(`
          INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure) VALUES
            ($1, 'Recyclage exclusif', 'REXCL_P1', true, true)
        `, [opsByCode.REXCL]);
      }
      console.log('[INIT-DB] Postes de travail chaîne de tri créés');
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

    // Migration : Postes de travail chaîne de tri (si opérations existent mais postes non créés)
    try {
      const postesExist = await client.query("SELECT id FROM postes_operation LIMIT 1");
      if (postesExist.rows.length === 0) {
        const opsResult = await client.query("SELECT id, code FROM operations_tri ORDER BY id");
        if (opsResult.rows.length > 0) {
          const opsByCode = {};
          for (const op of opsResult.rows) opsByCode[op.code] = op.id;

          const postes = [];
          if (opsByCode.CRACK1) postes.push(
            [opsByCode.CRACK1, 'Craquage poste 1', 'CRACK1_P1', true, false],
            [opsByCode.CRACK1, 'Craquage poste 2', 'CRACK1_P2', true, false]
          );
          if (opsByCode.CRACK2) postes.push(
            [opsByCode.CRACK2, 'Craquage 2 poste 1', 'CRACK2_P1', false, false]
          );
          if (opsByCode.RECYC) postes.push(
            [opsByCode.RECYC, 'Recyclage R1', 'RECYC_R1', true, false],
            [opsByCode.RECYC, 'Recyclage R2', 'RECYC_R2', true, false],
            [opsByCode.RECYC, 'Recyclage R3', 'RECYC_R3', true, false],
            [opsByCode.RECYC, 'Recyclage R4', 'RECYC_R4', true, false]
          );
          if (opsByCode.REEMP) postes.push(
            [opsByCode.REEMP, 'Réutilisation', 'REEMP_P1', true, true]
          );
          if (opsByCode.TRIFIN) postes.push(
            [opsByCode.TRIFIN, 'Homme VAK / BTQ', 'TRIFIN_HVAK', false, true],
            [opsByCode.TRIFIN, 'Femme VAK / BTQ', 'TRIFIN_FVAK', false, true],
            [opsByCode.TRIFIN, 'Layette VAK / BTQ', 'TRIFIN_LVAK', false, true],
            [opsByCode.TRIFIN, 'Accessoire', 'TRIFIN_ACC', false, true],
            [opsByCode.TRIFIN, 'Chiffon', 'TRIFIN_CHF', false, true]
          );
          if (opsByCode.REXCL) postes.push(
            [opsByCode.REXCL, 'Recyclage exclusif', 'REXCL_P1', true, true]
          );

          for (const [opId, nom, code, oblig, doublure] of postes) {
            await client.query(
              `INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING`,
              [opId, nom, code, oblig, doublure]
            );
          }
          console.log('[INIT-DB] Migration : postes de travail chaîne de tri créés');
        }
      }
    } catch (e) { console.warn('[INIT-DB] Migration postes_operation:', e.message); }

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

    // ══════════════════════════════════════════
    // MIGRATION : CAV photo
    // ══════════════════════════════════════════
    await client.query(`
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS photo_path VARCHAR(500);
    `);
    console.log('[INIT-DB] Migration CAV photo ✓');

    // ══════════════════════════════════════════
    // MIGRATION : FKs manquantes + indexes performance
    // ══════════════════════════════════════════
    // FK users.team_id -> teams(id)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD CONSTRAINT fk_users_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    // FK candidates.assigned_team_id -> teams(id)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE candidates ADD CONSTRAINT fk_candidates_team FOREIGN KEY (assigned_team_id) REFERENCES teams(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    // FK candidates.position_id -> positions(id)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE candidates ADD CONSTRAINT fk_candidates_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    // Index on tonnage_history.cav_id for performance
    await client.query('CREATE INDEX IF NOT EXISTS idx_tonnage_history_cav ON tonnage_history(cav_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_tonnage_history_date ON tonnage_history(date DESC);');
    // Index on stock_movements
    await client.query('CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(date DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type);');
    // Index on tours
    await client.query('CREATE INDEX IF NOT EXISTS idx_tours_date ON tours(date);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_tours_status ON tours(status);');
    // Schedule poste_code column for planning hebdo
    await client.query(`
      DO $$ BEGIN ALTER TABLE schedule ADD COLUMN poste_code VARCHAR(50); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_schedule_poste ON schedule(poste_code);');

    // Schedule: colonne periode (matin/apres_midi/journee) pour demi-journées
    await client.query(`
      DO $$ BEGIN ALTER TABLE schedule ADD COLUMN periode VARCHAR(20) DEFAULT 'journee'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    // Changer la contrainte UNIQUE pour permettre matin + apres_midi sur le même jour
    try {
      await client.query(`ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_employee_id_date_key`);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE schedule ADD CONSTRAINT schedule_employee_id_date_periode_key UNIQUE (employee_id, date, periode);
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$;
      `);
    } catch (e) { /* constraint may already be updated */ }
    await client.query('CREATE INDEX IF NOT EXISTS idx_schedule_periode ON schedule(periode);');
    // Candidate rejected status migration
    const candidateChecks2 = await client.query(`
      SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
      WHERE con.conrelid = 'candidates'::regclass AND con.contype = 'c' AND att.attname = 'status'
    `);
    for (const row of candidateChecks2.rows) {
      await client.query(`ALTER TABLE candidates DROP CONSTRAINT IF EXISTS "${row.conname}"`);
    }
    await client.query(`
      UPDATE candidates SET status = 'received' WHERE status IN ('preselected') OR status IS NULL;
      UPDATE candidates SET status = 'interview' WHERE status IN ('test');
      UPDATE candidates SET status = 'received' WHERE status NOT IN ('received', 'interview', 'hired', 'rejected');
    `);
    await client.query(`
      ALTER TABLE candidates ADD CONSTRAINT candidates_status_check
        CHECK (status IN ('received', 'interview', 'hired', 'rejected'));
    `);
    // Employee insertion tracking columns
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_status VARCHAR(30) DEFAULT 'none'
        CHECK (insertion_status IN ('none', 'en_parcours', 'termine', 'abandon'));
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_start_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_end_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS prescripteur VARCHAR(100);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS visite_medicale_date DATE;
    `);
    // Purge expired refresh tokens (cleanup)
    await client.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');

    // ══════════════════════════════════════════
    // TABLE : Plan de recrutement mensuel
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS recruitment_plan (
        id SERIAL PRIMARY KEY,
        position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
        month VARCHAR(7) NOT NULL,
        slots_needed INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(position_id, month)
      );
    `);

    console.log('[INIT-DB] Migration FKs + indexes + statuts ✓');

    // ══════════════════════════════════════════
    // MODULE : Parcours d'insertion — Diagnostics CIP
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_diagnostics (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),

        -- IDENTITÉ & CONTEXTE SOCIAL
        parcours_anterieur TEXT,
        contraintes_sante TEXT,
        contraintes_mobilite TEXT,
        contraintes_familiales TEXT,
        autres_contraintes TEXT,

        -- DIAGNOSTIC FREINS SOCIAUX (1-5 : 1=pas de frein, 5=frein majeur)
        frein_mobilite INTEGER DEFAULT 1 CHECK (frein_mobilite BETWEEN 1 AND 5),
        frein_mobilite_detail TEXT,
        frein_sante INTEGER DEFAULT 1 CHECK (frein_sante BETWEEN 1 AND 5),
        frein_sante_detail TEXT,
        frein_finances INTEGER DEFAULT 1 CHECK (frein_finances BETWEEN 1 AND 5),
        frein_finances_detail TEXT,
        frein_famille INTEGER DEFAULT 1 CHECK (frein_famille BETWEEN 1 AND 5),
        frein_famille_detail TEXT,
        frein_linguistique INTEGER DEFAULT 1 CHECK (frein_linguistique BETWEEN 1 AND 5),
        frein_linguistique_detail TEXT,
        frein_administratif INTEGER DEFAULT 1 CHECK (frein_administratif BETWEEN 1 AND 5),
        frein_administratif_detail TEXT,
        frein_numerique INTEGER DEFAULT 1 CHECK (frein_numerique BETWEEN 1 AND 5),
        frein_numerique_detail TEXT,

        -- QUESTIONNAIRE PCM SIMPLIFIÉ (réponses brutes)
        pcm_q_travail_ideal TEXT,
        pcm_q_reaction_stress TEXT,
        pcm_q_relation_equipe TEXT,
        pcm_q_motivation TEXT,
        pcm_q_apprentissage TEXT,
        pcm_q_communication TEXT,

        -- OBSERVATIONS CIP EN SITUATION DE TRAVAIL
        obs_taches_realisees TEXT,
        obs_points_forts TEXT,
        obs_difficultes TEXT,
        obs_comportement_equipe TEXT,
        obs_autonomie_ponctualite TEXT,

        -- PRÉFÉRENCES & MOTIVATIONS
        pref_aime_faire TEXT,
        pref_ne_veut_plus TEXT,
        pref_environnement_prefere TEXT,
        pref_environnement_eviter TEXT,
        pref_objectifs TEXT,

        -- EXPLORAMA / OUTILS D'EXPLORATION
        explorama_interets TEXT,
        explorama_rejets TEXT,
        explorama_gestes_positifs TEXT,
        explorama_gestes_negatifs TEXT,
        explorama_environnements TEXT,
        explorama_rythme TEXT,

        -- CAUSES DETAILLEES DES FREINS
        frein_mobilite_causes TEXT,
        frein_sante_causes TEXT,
        frein_finances_causes TEXT,
        frein_famille_causes TEXT,
        frein_linguistique_causes TEXT,
        frein_administratif_causes TEXT,
        frein_numerique_causes TEXT,

        -- ORIENTATION CIP
        cip_hypotheses_metiers TEXT,
        cip_questions TEXT,

        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id)
      );
    `);
    console.log('[INIT-DB] Module Insertion Diagnostics ✓');

    // ══════════════════════════════════════════
    // MODULE : Fil d'actualite
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_articles (
        id SERIAL PRIMARY KEY,
        category VARCHAR(30) NOT NULL CHECK (category IN ('metier', 'local')),
        title VARCHAR(255) NOT NULL,
        summary TEXT,
        content TEXT,
        source_url VARCHAR(500),
        source_name VARCHAR(100),
        tags TEXT[],
        is_pinned BOOLEAN DEFAULT false,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module News Articles ✓');

    // ══════════════════════════════════════════
    // MODULE : Notification triggers
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_triggers (
        id SERIAL PRIMARY KEY,
        event VARCHAR(100) NOT NULL,
        template_id INTEGER REFERENCES message_templates(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        delay_hours INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module Notification Triggers ✓');

    // ══════════════════════════════════════════
    // MODULE : Objectifs periodiques
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS periodic_objectives (
        id SERIAL PRIMARY KEY,
        section VARCHAR(50) NOT NULL,
        label VARCHAR(255) NOT NULL,
        target_value DOUBLE PRECISION NOT NULL,
        period VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[INIT-DB] Module Periodic Objectives ✓');

    // ══════════════════════════════════════════
    // MODULE : Parcours insertion — Jalons obligatoires (Diagnostic, M+3, M+6, M+10, Sortie)
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_milestones (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        milestone_type VARCHAR(30) NOT NULL CHECK (milestone_type IN ('Diagnostic accueil', 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan Sortie')),
        due_date DATE NOT NULL,
        completed_date DATE,
        status VARCHAR(30) NOT NULL DEFAULT 'a_planifier'
          CHECK (status IN ('a_planifier', 'planifie', 'realise', 'reporte')),
        interview_date TIMESTAMP,
        interviewer_id INTEGER REFERENCES users(id),
        -- Scores freins au moment du bilan (1-5)
        frein_mobilite INTEGER CHECK (frein_mobilite BETWEEN 1 AND 5),
        frein_sante INTEGER CHECK (frein_sante BETWEEN 1 AND 5),
        frein_finances INTEGER CHECK (frein_finances BETWEEN 1 AND 5),
        frein_famille INTEGER CHECK (frein_famille BETWEEN 1 AND 5),
        frein_linguistique INTEGER CHECK (frein_linguistique BETWEEN 1 AND 5),
        frein_administratif INTEGER CHECK (frein_administratif BETWEEN 1 AND 5),
        frein_numerique INTEGER CHECK (frein_numerique BETWEEN 1 AND 5),
        -- Questionnaire CIP (reponses par section)
        cip_integration TEXT,
        cip_competences TEXT,
        cip_projet_pro TEXT,
        cip_socialisation TEXT,
        -- Contenu du bilan
        bilan_professionnel TEXT,
        bilan_social TEXT,
        objectifs_realises TEXT,
        objectifs_prochaine_periode TEXT,
        observations TEXT,
        actions_a_mener TEXT,
        -- Avis global
        avis_global VARCHAR(30) CHECK (avis_global IN ('tres_positif', 'positif', 'mitige', 'insuffisant')),
        -- Bilan Sortie specifique
        sortie_classification VARCHAR(20) CHECK (sortie_classification IN ('positive', 'negative')),
        sortie_type VARCHAR(50),
        sortie_commentaires TEXT,
        sortie_employeur TEXT,
        sortie_formation TEXT,
        -- AI recommendations snapshot
        ai_recommendations JSONB,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, milestone_type)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_milestones_employee ON insertion_milestones(employee_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_milestones_status ON insertion_milestones(status);');

    // Plan d'action CIP par jalon
    await client.query(`
      CREATE TABLE IF NOT EXISTS cip_action_plans (
        id SERIAL PRIMARY KEY,
        milestone_id INTEGER NOT NULL REFERENCES insertion_milestones(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        action_label TEXT NOT NULL,
        category VARCHAR(30) NOT NULL CHECK (category IN ('competence', 'insertion', 'socialisation', 'frein')),
        frein_type VARCHAR(30),
        priority VARCHAR(20) DEFAULT 'moyenne' CHECK (priority IN ('haute', 'moyenne', 'basse')),
        status VARCHAR(20) DEFAULT 'a_faire' CHECK (status IN ('a_faire', 'en_cours', 'realise', 'abandonne')),
        echeance DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_action_plans_milestone ON cip_action_plans(milestone_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_action_plans_employee ON cip_action_plans(employee_id);');

    // Alertes planification entretiens insertion
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_interview_alerts (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        milestone_type VARCHAR(30) NOT NULL,
        alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN ('planification', 'rappel_j7', 'rappel_j1', 'retard')),
        sent_at TIMESTAMP,
        is_sent BOOLEAN DEFAULT false,
        target_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('[INIT-DB] Module Parcours Insertion ✓');

    // ══════════════════════════════════════════
    // MODULE : Maintenance préventive véhicules
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_maintenance (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        vehicle_type VARCHAR(50) NOT NULL DEFAULT 'generic',
        last_maintenance_date DATE,
        last_maintenance_km INTEGER,
        maintenance_interval_km INTEGER DEFAULT 20000,
        maintenance_interval_months INTEGER DEFAULT 12,
        controle_technique_date DATE,
        oil_change_km INTEGER,
        oil_change_date DATE,
        tire_change_km INTEGER,
        tire_change_date DATE,
        brake_check_km INTEGER,
        brake_check_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(vehicle_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_maintenance_alerts (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
        alerts JSONB NOT NULL DEFAULT '[]',
        is_resolved BOOLEAN DEFAULT false,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(vehicle_id, alert_date)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_maint_alerts_vehicle ON vehicle_maintenance_alerts(vehicle_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_maint_alerts_resolved ON vehicle_maintenance_alerts(is_resolved);');
    console.log('[INIT-DB] Module Maintenance Véhicules ✓');

    // ══════════════════════════════════════════
    // MODULE : Capteurs ultrasons CAV (LoRaWAN)
    // ══════════════════════════════════════════
    await client.query(`
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_reference VARCHAR(100);
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_type VARCHAR(50) DEFAULT 'ultrasonic';
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_last_reading DOUBLE PRECISION;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_last_reading_at TIMESTAMP;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cav_sensor_readings (
        id SERIAL PRIMARY KEY,
        cav_id INTEGER NOT NULL REFERENCES cav(id) ON DELETE CASCADE,
        sensor_reference VARCHAR(100) NOT NULL,
        fill_level_percent DOUBLE PRECISION NOT NULL CHECK (fill_level_percent BETWEEN 0 AND 100),
        distance_cm DOUBLE PRECISION,
        battery_level DOUBLE PRECISION,
        temperature DOUBLE PRECISION,
        rssi INTEGER,
        raw_data JSONB,
        reading_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_sensor_readings_cav ON cav_sensor_readings(cav_id, reading_at DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sensor_readings_ref ON cav_sensor_readings(sensor_reference);');
    console.log('[INIT-DB] Module Capteurs CAV ✓');

    // ══════════════════════════════════════════
    // MODULE : Inventaire physique produits finis
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_batches (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        type VARCHAR(20) NOT NULL DEFAULT 'partiel' CHECK (type IN ('partiel', 'complet')),
        status VARCHAR(20) NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours', 'valide', 'annule')),
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        total_theorique_kg DOUBLE PRECISION DEFAULT 0,
        total_physique_kg DOUBLE PRECISION DEFAULT 0,
        ecart_kg DOUBLE PRECISION DEFAULT 0,
        ecart_percent DOUBLE PRECISION DEFAULT 0,
        validated_by INTEGER REFERENCES users(id),
        validated_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id SERIAL PRIMARY KEY,
        batch_id INTEGER NOT NULL REFERENCES inventory_batches(id) ON DELETE CASCADE,
        categorie_sortante_id INTEGER REFERENCES categories_sortantes(id),
        categorie_nom VARCHAR(255),
        stock_theorique_kg DOUBLE PRECISION DEFAULT 0,
        stock_physique_kg DOUBLE PRECISION DEFAULT 0,
        ecart_kg DOUBLE PRECISION DEFAULT 0,
        ecart_percent DOUBLE PRECISION DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_inventory_items_batch ON inventory_items(batch_id);');
    console.log('[INIT-DB] Module Inventaire Physique ✓');

    // ══════════════════════════════════════════
    // MODULE : Taux de captation (population communes)
    // ══════════════════════════════════════════
    await client.query(`
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS population_commune INTEGER;
    `);
    await client.query(`ALTER TABLE cav ADD COLUMN IF NOT EXISTS communaute_communes VARCHAR(255);`);
    await client.query(`ALTER TABLE cav ADD COLUMN IF NOT EXISTS surface VARCHAR(100);`);
    await client.query(`ALTER TABLE cav ADD COLUMN IF NOT EXISTS ref_refashion VARCHAR(100);`);
    await client.query(`ALTER TABLE cav ADD COLUMN IF NOT EXISTS entite_detentrice VARCHAR(255);`);
    await client.query(`ALTER TABLE cav ADD COLUMN IF NOT EXISTS code_postal VARCHAR(10);`);
    console.log('[INIT-DB] Colonnes population_commune, communaute_communes, surface, ref_refashion, entite_detentrice, code_postal ajoutées à CAV ✓');

    // ══════════════════════════════════════════
    // INDEX ADDITIONNELS (Performance)
    // ══════════════════════════════════════════
    await client.query('CREATE INDEX IF NOT EXISTS idx_candidates_appointment ON candidates(appointment_date) WHERE appointment_date IS NOT NULL;');
    await client.query('CREATE INDEX IF NOT EXISTS idx_employee_contracts_end ON employee_contracts(end_date) WHERE end_date IS NOT NULL;');
    await client.query('CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_vehicle ON vehicle_maintenance(vehicle_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_employees_insertion ON employees(insertion_status) WHERE insertion_status != \'none\';');
    console.log('[INIT-DB] Index additionnels créés ✓');

    // ══════════════════════════════════════════
    // MODULE : Parcours recrutement (entretien + mise en situation + documents)
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS recruitment_interviews (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        interview_date DATE,
        interviewer_id INTEGER REFERENCES users(id),
        -- I. Présentation
        presentation_mots TEXT,
        parcours_professionnel TEXT,
        experiences_marquantes TEXT,
        -- II. Situation actuelle
        situation_actuelle VARCHAR(30) CHECK (situation_actuelle IN ('reconversion', 'retour_emploi', 'autre')),
        situation_actuelle_autre TEXT,
        duree_sans_emploi VARCHAR(30) CHECK (duree_sans_emploi IN ('moins_6_mois', '6_mois_1_an', 'plus_1_an')),
        difficultes_recherche TEXT[],
        difficultes_recherche_autre TEXT,
        -- III. Freins à l'emploi
        freins_emploi TEXT[],
        freins_emploi_autre TEXT,
        contraintes_horaires VARCHAR(20) CHECK (contraintes_horaires IN ('oui', 'certainement', 'non')),
        contraintes_horaires_detail TEXT,
        structure_accompagnement TEXT[],
        structure_accompagnement_autre TEXT,
        -- IV. Motivation
        motivation_integration TEXT,
        motivation_reprise TEXT,
        attentes TEXT[],
        attentes_autre TEXT,
        -- V. Compétences et savoir-être
        experience_activite TEXT[],
        comportement_equipe TEXT,
        reaction_consigne TEXT,
        travail_physique VARCHAR(20) CHECK (travail_physique IN ('oui', 'non', 'ne_sais_pas')),
        -- VI. Organisation et engagement
        disponibilite_horaires VARCHAR(20) CHECK (disponibilite_horaires IN ('oui', 'non', 'autre')),
        disponibilite_autre TEXT,
        organisation_ponctualite TEXT,
        -- VII. Projet professionnel
        idee_metier VARCHAR(20) CHECK (idee_metier IN ('oui', 'non', 'autre')),
        idee_metier_detail TEXT,
        amelioration_souhaitee TEXT,
        question_ouverte TEXT,
        -- Évaluation globale
        evaluation_globale VARCHAR(20) CHECK (evaluation_globale IN ('favorable', 'reserve', 'defavorable')),
        commentaire_evaluateur TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mise_en_situation (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        type VARCHAR(30) NOT NULL CHECK (type IN ('collecte_manutention', 'craquage', 'qualite')),
        evaluator_id INTEGER REFERENCES users(id),
        evaluation_date DATE DEFAULT CURRENT_DATE,
        -- Critères d'évaluation (1-5)
        respect_consignes INTEGER CHECK (respect_consignes BETWEEN 1 AND 5),
        capacite_physique INTEGER CHECK (capacite_physique BETWEEN 1 AND 5),
        endurance INTEGER CHECK (endurance BETWEEN 1 AND 5),
        comprehension INTEGER CHECK (comprehension BETWEEN 1 AND 5),
        qualite_travail INTEGER CHECK (qualite_travail BETWEEN 1 AND 5),
        rapidite INTEGER CHECK (rapidite BETWEEN 1 AND 5),
        securite INTEGER CHECK (securite BETWEEN 1 AND 5),
        autonomie INTEGER CHECK (autonomie BETWEEN 1 AND 5),
        -- Résultat global
        resultat VARCHAR(20) CHECK (resultat IN ('conforme', 'a_ameliorer', 'non_conforme')),
        points_forts TEXT,
        points_amelioration TEXT,
        commentaire TEXT,
        duree_minutes INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recruitment_documents (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        document_type VARCHAR(50) NOT NULL CHECK (document_type IN (
          'livret_accueil', 'charte_insertion', 'procedure_recrutement',
          'fiche_mise_en_situation_collecte', 'fiche_mise_en_situation_craquage',
          'fiche_mise_en_situation_qualite'
        )),
        delivered_at TIMESTAMP DEFAULT NOW(),
        delivered_by INTEGER REFERENCES users(id),
        delivery_method VARCHAR(20) CHECK (delivery_method IN ('telechargement', 'email', 'remise_main')),
        UNIQUE(candidate_id, document_type)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recruitment_interviews_candidate ON recruitment_interviews(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_mise_en_situation_candidate ON mise_en_situation(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_recruitment_documents_candidate ON recruitment_documents(candidate_id);
    `);

    console.log('[INIT-DB] Module Parcours Recrutement (entretien + mise en situation + documents) ✓');

    // ══════════════════════════════════════════
    // MIGRATION : Vues matérialisées pour reporting
    // ══════════════════════════════════════════
    console.log('[INIT-DB] Migration vues matérialisées...');

    // Vue matérialisée : KPIs collecte mensuels
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_collecte_mensuelle AS
      SELECT
        TO_CHAR(date, 'YYYY-MM') as mois,
        COUNT(*) as nb_tours,
        ROUND(SUM(total_weight_kg)::numeric, 1) as total_kg,
        ROUND(AVG(total_weight_kg)::numeric, 1) as avg_kg_tour,
        COUNT(DISTINCT driver_employee_id) as nb_chauffeurs
      FROM tours
      WHERE status = 'completed'
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY mois;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_collecte_mois ON mv_collecte_mensuelle(mois);
    `);

    // Vue matérialisée : KPIs production mensuels
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_production_mensuelle AS
      SELECT
        TO_CHAR(date, 'YYYY-MM') as mois,
        ROUND(SUM(total_jour_t)::numeric, 2) as total_trie_t,
        ROUND(AVG(total_jour_t)::numeric, 2) as avg_jour_t,
        COUNT(*) as nb_jours
      FROM production_daily
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY mois;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_production_mois ON mv_production_mensuelle(mois);
    `);

    // Vue matérialisée : statistiques CAV
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_cav_stats AS
      SELECT
        c.id as cav_id,
        c.name,
        c.commune,
        c.status,
        COUNT(DISTINCT tc.tour_id) as nb_collectes_total,
        ROUND(AVG(tw.weight_kg)::numeric, 1) as avg_weight_kg,
        MAX(t.date) as derniere_collecte,
        COUNT(DISTINCT tc.tour_id) FILTER (WHERE t.date >= NOW() - INTERVAL '90 days') as nb_collectes_90j
      FROM cav c
      LEFT JOIN tour_cav tc ON tc.cav_id = c.id
      LEFT JOIN tours t ON tc.tour_id = t.id AND t.status = 'completed'
      LEFT JOIN tour_weights tw ON tw.tour_id = t.id
      GROUP BY c.id, c.name, c.commune, c.status;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_cav_stats_id ON mv_cav_stats(cav_id);
    `);

    // Vue matérialisée : KPIs RH
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_rh_stats AS
      SELECT
        TO_CHAR(CURRENT_DATE, 'YYYY-MM') as mois,
        COUNT(*) FILTER (WHERE is_active = true) as nb_actifs,
        COUNT(*) FILTER (WHERE insertion_status = 'en_parcours') as nb_en_parcours,
        COUNT(*) FILTER (WHERE insertion_status = 'termine') as nb_insertion_termines
      FROM employees;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_rh_stats_mois ON mv_rh_stats(mois);
    `);

    console.log('[INIT-DB] Vues matérialisées créées ✓');

    // ══════════════════════════════════════════
    // MIGRATIONS v1.3.0 — Véhicules enrichis + Événements + Journal d'activité
    // ══════════════════════════════════════════

    // Colonnes manquantes sur vehicles (brand, model, type, tare, maintenance, assurance)
    const vehicleMigrations = [
      { col: 'brand', def: "VARCHAR(50)" },
      { col: 'model', def: "VARCHAR(50)" },
      { col: 'type', def: "VARCHAR(30) DEFAULT 'utilitaire'" },
      { col: 'tare_weight_kg', def: "DOUBLE PRECISION" },
      { col: 'next_maintenance', def: "DATE" },
      { col: 'insurance_expiry', def: "DATE" },
      { col: 'assigned_driver_id', def: "INTEGER REFERENCES employees(id) ON DELETE SET NULL" },
      { col: 'vehicle_type', def: "VARCHAR(100) DEFAULT 'generic'" },
    ];
    for (const m of vehicleMigrations) {
      await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ${m.col} ${m.def}`);
    }
    console.log('[INIT-DB] Migration vehicles colonnes enrichies ✓');

    // Table événements véhicules (historique accidents, entretiens, CT, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_events (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('entretien', 'accident', 'controle_technique', 'reparation', 'pneus', 'vidange', 'freins', 'autre')),
        event_date DATE NOT NULL DEFAULT CURRENT_DATE,
        km_at_event INTEGER,
        description TEXT,
        cost DOUBLE PRECISION,
        performed_by VARCHAR(100),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle ON vehicle_events(vehicle_id, event_date DESC)');
    console.log('[INIT-DB] Table vehicle_events créée ✓');

    // Table journal d'activité utilisateurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_activity_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        username VARCHAR(100),
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INTEGER,
        details JSONB,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_activity_log_created ON user_activity_log(created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_activity_log_user ON user_activity_log(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_activity_log_action ON user_activity_log(action)');
    console.log('[INIT-DB] Table user_activity_log créée ✓');

    // Table sessions utilisateurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        token_hash VARCHAR(64),
        ip_address VARCHAR(50),
        user_agent TEXT,
        started_at TIMESTAMP DEFAULT NOW(),
        last_activity TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active) WHERE is_active = true');
    console.log('[INIT-DB] Table user_sessions créée ✓');

    // Table historique SolidataBot
    await client.query(`
      CREATE TABLE IF NOT EXISTS chatbot_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        username VARCHAR(100),
        session_id VARCHAR(100),
        user_message TEXT NOT NULL,
        bot_reply TEXT,
        tokens_used INTEGER,
        response_time_ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_chatbot_history_user ON chatbot_history(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chatbot_history_created ON chatbot_history(created_at DESC)');
    console.log('[INIT-DB] Table chatbot_history créée ✓');

    // Table temps de collecte réels par CAV (appris via GPS)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cav_collection_times (
        id SERIAL PRIMARY KEY,
        cav_id INTEGER REFERENCES cav(id),
        tour_id INTEGER,
        vehicle_id INTEGER,
        arrived_at TIMESTAMP,
        departed_at TIMESTAMP,
        duration_seconds INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_cav_collection_times_cav ON cav_collection_times(cav_id)');
    console.log('[INIT-DB] Table cav_collection_times créée ✓');

    // ══════════════════════════════════════════
    // MODULE FEUILLE DE PRODUCTION (suivi quotidien chaîne de tri)
    // ══════════════════════════════════════════

    // Colonnes supplémentaires sur production_daily
    const prodDailyMigrations = [
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS encadrant_atelier TEXT",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS controleur_tri TEXT",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS consigne TEXT",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS effectif_tri INTEGER",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS effectif_recuperation INTEGER",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS effectif_cp INTEGER",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS effectif_formation INTEGER",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS effectif_abs_injustifiee INTEGER",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS effectif_am INTEGER",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS entree_recyclage_r4_kg DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS objectif_entree_r4_kg DOUBLE PRECISION DEFAULT 900",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS objectif_recyclage_pct DOUBLE PRECISION DEFAULT 70",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS objectif_reutilisation_pct DOUBLE PRECISION DEFAULT 30",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS objectif_csr_pct VARCHAR(20) DEFAULT '<10%'",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS resultat_ligne_ok BOOLEAN",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS resultat_r3_ok BOOLEAN",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS resultat_r4_ok BOOLEAN",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS resultat_general_ok BOOLEAN",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS signature_encadrant TEXT",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS signature_direction TEXT",
    ];
    for (const sql of prodDailyMigrations) {
      try { await client.query(sql); } catch(e) { /* colonne existe déjà */ }
    }

    // Postes opérateurs par jour (affectation matin/après-midi)
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_postes (
        id SERIAL PRIMARY KEY,
        production_date DATE NOT NULL,
        poste VARCHAR(50) NOT NULL,
        periode VARCHAR(20) NOT NULL CHECK (periode IN ('matin', 'apres_midi')),
        employe_nom VARCHAR(100),
        employe_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(production_date, poste, periode, employe_nom)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_production_postes_date ON production_postes(production_date)');

    // Chariots / pesées par ligne
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_chariots (
        id SERIAL PRIMARY KEY,
        production_date DATE NOT NULL,
        ligne VARCHAR(20) NOT NULL CHECK (ligne IN ('r1r2', 'r3', 'r4')),
        numero INTEGER NOT NULL,
        poids_kg DOUBLE PRECISION NOT NULL,
        heure TIME,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_production_chariots_date ON production_chariots(production_date)');

    // Historique commentaires production
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_commentaires (
        id SERIAL PRIMARY KEY,
        production_date DATE NOT NULL,
        commentaire TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'general' CHECK (type IN ('general', 'consigne', 'resultat')),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_production_commentaires_date ON production_commentaires(production_date)');

    console.log('[INIT-DB] Module Feuille de Production ✓');

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
