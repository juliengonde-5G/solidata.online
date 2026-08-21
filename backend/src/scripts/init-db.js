require('dotenv').config();
const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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
        role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ', 'DPO', 'FINANCE', 'QHSE')),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(20),
        team_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // must_change_password (audit 2026-07-11, item 1) : force le changement du
    // mot de passe au premier login (compte admin initial notamment). Idempotent.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;`);

    // Révocation de session effective (audit vague 3, item 3.C-1) — approche
    // « token_version » sans Redis : le JWT d'accès embarque token_version au
    // moment de l'émission ; authenticate compare à la valeur en base. Toute
    // révocation (logout, reset mdp, désactivation, déconnexion forcée)
    // incrémente token_version → les jetons portant l'ancienne valeur sont
    // rejetés (code TOKEN_REVOKED). Idempotent.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;`);

    // Verrouillage léger anti-brute-force (audit vague 3, item 3.C-3) : compteur
    // d'échecs récents (fenêtre glissante), horodatage du dernier échec et
    // blocage temporaire (jamais définitif — pas de DoS possible sur un compte).
    // Idempotent.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMP;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Index (audit vague 3, item 3.C-4) : /refresh lit par `token` à chaque
    // rafraîchissement (seq scan sinon), logout/reset/désactivation suppriment
    // par `user_id`. Idempotents.
    await client.query('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT,
        category VARCHAR(50),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Habilitations par module (V2.4) : DENY-overlay par rôle sur les sections
    // de 1er niveau de la sidebar. Absence de ligne = autorisé (défaut).
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_module_access (
        role VARCHAR(50) NOT NULL,
        module_key VARCHAR(50) NOT NULL,
        allowed BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (role, module_key)
      );
    `);
    // Élargit role si la table préexistait en VARCHAR(30) (clés de rôles custom).
    await client.query(`DO $$ BEGIN ALTER TABLE role_module_access ALTER COLUMN role TYPE VARCHAR(50); EXCEPTION WHEN others THEN NULL; END $$;`);

    // Rôles personnalisés (V2.4.1) : un rôle custom hérite des accès d'un rôle
    // de base intégré (base_role) et se restreint via role_module_access.
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_roles (
        role_key VARCHAR(50) PRIMARY KEY,
        label VARCHAR(100) NOT NULL,
        base_role VARCHAR(30) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // users.role : lever la contrainte CHECK (limitée aux 6 rôles intégrés) et
    // élargir la colonne pour accueillir les clés de rôles personnalisés.
    // La validation du rôle est faite au niveau applicatif (built-in ∪ custom).
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        BEGIN ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50); EXCEPTION WHEN others THEN NULL; END;
        FOR cname IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'users'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%role%'
        LOOP
          EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
      END $$;
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
    // ── Intégrité PCM (vague 3, item 3.B) : contrainte d'unicité anti-doublon ──
    // pcm_answers n'avait aucune clé (session_id, question_number) → une resoumission
    // du questionnaire empilait des réponses en double (cf. POST /pcm/submit, qui
    // insérait ligne à ligne hors transaction). On dédoublonne l'existant (on conserve
    // la DERNIÈRE réponse par question, id le plus élevé) PUIS on pose la contrainte, ce
    // qui autorise un UPSERT idempotent `ON CONFLICT (session_id, question_number)`.
    // Idempotent (garde par nom de contrainte) et tolérant base neuve (table vide).
    await client.query(`
      DO $$
      BEGIN
        DELETE FROM pcm_answers a
         USING pcm_answers b
         WHERE a.session_id = b.session_id
           AND a.question_number = b.question_number
           AND a.id < b.id;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'pcm_answers_session_question_key'
        ) THEN
          ALTER TABLE pcm_answers
            ADD CONSTRAINT pcm_answers_session_question_key UNIQUE (session_id, question_number);
        END IF;
      END $$;
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
        -- v1-5 : plage raisonnable au lieu de IN (26,35) qui coerçait les temps réels 24/28/30
        weekly_hours DOUBLE PRECISION NOT NULL DEFAULT 35 CHECK (weekly_hours > 0 AND weekly_hours <= 48),
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
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        -- Nullable par conception : le mobile chauffeur s'authentifie par un lien
        -- unique de VÉHICULE (« 1 URL = 1 véhicule »). Une tournée peut donc
        -- démarrer sans fiche employé identifiée (véhicule sans chauffeur affecté,
        -- salarié de paie sans compte utilisateur). Le rattachement RH est posé
        -- quand il est connu, jamais inventé.
        driver_employee_id INTEGER REFERENCES employees(id),
        standard_route_id INTEGER REFERENCES standard_routes(id),
        mode VARCHAR(20) NOT NULL CHECK (mode IN ('intelligent', 'standard', 'manual')),
        status VARCHAR(20) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'paused', 'returning', 'completed', 'cancelled')),
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
        tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
        cav_id INTEGER NOT NULL REFERENCES cav(id) ON DELETE CASCADE,
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
        tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
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

    // Déclarations de fin de journée (chauffeur / suiveur / binôme) — pendant
    // mobile de vehicle_checklists (départ), posée au retour au centre de tri
    // (TourSummary.jsx « Terminer la journée »). Les 6 booléens sont NOT NULL :
    // le backend impose qu'ils soient tous à true, jamais une déclaration
    // partielle — l'écran mobile ne permet d'ailleurs pas d'envoyer autrement.
    await client.query(`
      CREATE TABLE IF NOT EXISTS tour_end_of_day_declarations (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        employee_id INTEGER REFERENCES employees(id),
        chauffeur_non_fume BOOLEAN NOT NULL,
        chauffeur_pas_objet_personnel BOOLEAN NOT NULL,
        suiveur_non_fume BOOLEAN NOT NULL,
        suiveur_pas_objet_personnel BOOLEAN NOT NULL,
        binome_vehicule_vide BOOLEAN NOT NULL,
        binome_vehicule_ok BOOLEAN NOT NULL,
        remarques TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_end_of_day_tour ON tour_end_of_day_declarations(tour_id);');

    // ── Vague 2 (item 62) — Canal manager → chauffeur ─────────────────────
    // Consignes envoyées par le responsable logistique (web) au chauffeur en
    // tournée (bannière mobile). vehicle_id = destinataire (« 1 URL = 1 véhicule »),
    // tour_id optionnel (une consigne peut concerner une tournée précise ou non).
    // read_at renseigné quand le chauffeur tape « J'ai compris » (accusé de lecture).
    // CREATE simple + idempotent : users/vehicles/tours existent déjà plus haut,
    // rien à ALTER → chemin « base neuve » sûr.
    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_messages (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        read_at TIMESTAMP
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_driver_messages_vehicle ON driver_messages(vehicle_id, read_at);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_driver_messages_tour ON driver_messages(tour_id);');

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

    // ══════════════════════════════════════════
    // V2 — Réconciliation tonnage (collecte ↔ tri ↔ Refashion DPAV)
    //
    // Audit Direction (D2 + D7) + Enterprise Architect (Rupture #1) :
    // 3 sources de poids actuellement non rapprochées en SQL :
    //   (a) tours.total_weight_kg (kg pesés à la bascule du centre)
    //   (b) production_daily.entree_ligne_kg (kg déclarés entrant ligne tri)
    //   (c) production_daily.total_jour_t × 1000 (sortie tri valorisée)
    //
    // La déclaration Refashion DPAV exige (a) ET (b) — décision métier
    // confirmée par la Direction. La sortie (c) sert au calcul du taux
    // de valorisation.
    // ══════════════════════════════════════════

    // Vue par jour : facilite le diagnostic des écarts (alertes >2%)
    await client.query(`
      CREATE OR REPLACE VIEW vw_tonnage_reconciliation_jour AS
      SELECT
        COALESCE(t.date, pd.date)                          AS date,
        COALESCE(t.collecte_brut_kg, 0)::FLOAT             AS collecte_brut_kg,
        COALESCE(pd.entree_ligne_kg, 0)::FLOAT             AS tri_entree_kg,
        COALESCE(pd.total_jour_t, 0)::FLOAT * 1000         AS tri_sortie_kg,
        (COALESCE(t.collecte_brut_kg, 0) - COALESCE(pd.entree_ligne_kg, 0))::FLOAT
                                                            AS ecart_collecte_tri_kg,
        CASE WHEN COALESCE(t.collecte_brut_kg, 0) > 0
          THEN ROUND(((COALESCE(t.collecte_brut_kg, 0) - COALESCE(pd.entree_ligne_kg, 0))
                     / t.collecte_brut_kg * 100)::numeric, 2)
          ELSE NULL
        END                                                 AS ecart_pct
      FROM (
        SELECT date, SUM(total_weight_kg) AS collecte_brut_kg
        FROM tours WHERE status = 'completed'
        GROUP BY date
      ) t
      FULL OUTER JOIN production_daily pd ON pd.date = t.date;
    `);

    // Vue Refashion DPAV (trimestriel) — pré-remplissage formulaire conforme
    await client.query(`
      CREATE OR REPLACE VIEW vw_refashion_dpav_source AS
      SELECT
        EXTRACT(YEAR FROM d)::INT                           AS annee,
        EXTRACT(QUARTER FROM d)::INT                        AS trimestre,
        TO_CHAR(d, 'YYYY-"Q"Q')                             AS periode,
        ROUND((SUM(collecte_brut_kg) / 1000.0)::numeric, 3)::FLOAT     AS collecte_brut_t,
        ROUND((SUM(tri_entree_kg) / 1000.0)::numeric, 3)::FLOAT        AS tri_entree_t,
        ROUND((SUM(tri_sortie_kg) / 1000.0)::numeric, 3)::FLOAT        AS tri_sortie_t,
        ROUND((SUM(ecart_collecte_tri_kg) / 1000.0)::numeric, 3)::FLOAT AS ecart_t,
        CASE WHEN SUM(collecte_brut_kg) > 0
          THEN ROUND((SUM(ecart_collecte_tri_kg) / SUM(collecte_brut_kg) * 100)::numeric, 2)
          ELSE NULL
        END                                                  AS ecart_pct,
        CASE WHEN SUM(tri_entree_kg) > 0
          THEN ROUND((SUM(tri_sortie_kg) / SUM(tri_entree_kg) * 100)::numeric, 2)
          ELSE NULL
        END                                                  AS taux_valorisation_pct
      FROM vw_tonnage_reconciliation_jour, LATERAL (SELECT date AS d) sub
      WHERE date IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM d), EXTRACT(QUARTER FROM d), TO_CHAR(d, 'YYYY-"Q"Q')
      ORDER BY annee DESC, trimestre DESC;
    `);

    console.log('[INIT-DB] Module 8 (Production + vues réconciliation Refashion) ✓');

    // ══════════════════════════════════════════
    // MODULE V2 : Référentiels & Tri
    // ══════════════════════════════════════════
    // Note : la table `associations` historique a été supprimée (doublon avec
    // association_points). La suppression est appliquée plus bas dans la
    // section migrations V2.2.

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
        model_path TEXT,
        UNIQUE(model_name, version)
      );
    `);
    // Migration idempotente : le modèle sérialisé (JSON complet) dépasse 500 car.
    // → passer model_path en TEXT sur les bases existantes (VARCHAR(500) faisait
    // échouer POST /api/ml/train à l'insertion). No-op si déjà TEXT.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE ml_model_metadata ALTER COLUMN model_path TYPE TEXT;
      EXCEPTION WHEN others THEN NULL; END $$;
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
    // Horaire prévisionnel de passage au CAV, calculé au démarrage de la
    // tournée (OSRM). Sert à comparer prévu/réalisé et à calculer le
    // décalage par point.
    await client.query(`
      ALTER TABLE tour_cav ADD COLUMN IF NOT EXISTS planned_passage_time TIMESTAMP;
    `);

    // Historique des ré-optimisations d'une tournée en cours (Niveau 2.6).
    // Chaque proposition enregistre : motif, ordre avant / après (positions
    // des CAV restants), état d'acceptation par le chauffeur. Expose
    // also la trace des propositions auto (incident, retard, plein).
    await client.query(`
      CREATE TABLE IF NOT EXISTS tour_reoptimizations (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
        trigger_reason VARCHAR(40) NOT NULL
          CHECK (trigger_reason IN ('manual', 'incident', 'skipped', 'full', 'delay', 'inaccessible')),
        triggered_by VARCHAR(10) NOT NULL DEFAULT 'auto'
          CHECK (triggered_by IN ('auto', 'manager', 'driver')),
        current_lat DOUBLE PRECISION,
        current_lng DOUBLE PRECISION,
        old_sequence JSONB NOT NULL,
        new_sequence JSONB NOT NULL,
        old_distance_km DOUBLE PRECISION,
        new_distance_km DOUBLE PRECISION,
        old_duration_min DOUBLE PRECISION,
        new_duration_min DOUBLE PRECISION,
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
        decided_at TIMESTAMP,
        decided_by_user_id INTEGER REFERENCES users(id),
        notes TEXT,
        triggered_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tour_reopt_tour ON tour_reoptimizations(tour_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tour_reopt_status ON tour_reoptimizations(status);`);

    // Abonnements push (Web Push API + VAPID) — Niveau 2.2. Un user peut
    // avoir plusieurs endpoints (poste de travail + mobile perso).
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        platform VARCHAR(20) DEFAULT 'web'
          CHECK (platform IN ('web', 'mobile')),
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);');

    // Niveau 3.3 : clés API pour partenaires (Refashion, Métropole Rouen,
    // associations, etc.). La clé elle-même n'est jamais stockée en clair :
    // seul le hash SHA-256 l'est. Les scopes limitent les endpoints publics
    // accessibles (ex: 'cav:read', 'stats:read').
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        key_prefix VARCHAR(12) NOT NULL UNIQUE,
        key_hash VARCHAR(128) NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        active BOOLEAN DEFAULT true,
        created_by INTEGER REFERENCES users(id),
        last_used_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);');
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

    // Suiveurs (équipiers accompagnant le chauffeur, 0 à 2 par tournée) —
    // affectés depuis Planning tournées au même titre que le chauffeur.
    // Bornés à 2 par demande métier : deux colonnes nullable suffisent, pas de
    // table de jonction. Vocabulaire aligné sur tour_end_of_day_declarations.
    await client.query(`
      ALTER TABLE tours ADD COLUMN IF NOT EXISTS suiveur1_employee_id INTEGER REFERENCES employees(id);
      ALTER TABLE tours ADD COLUMN IF NOT EXISTS suiveur2_employee_id INTEGER REFERENCES employees(id);
    `);

    // Pondération météo APPRISE des dépôts (services/weather-learning.js) :
    // 4 facteurs semaine/week-end × beau temps/autre, recalculés mensuellement
    // depuis les intervalles réels entre collectes croisés avec la météo
    // quotidienne. Vide tant que l'échantillon est insuffisant (le moteur garde
    // alors la règle par défaut « week-end ensoleillé ×1.15 »).
    await client.query(`
      CREATE TABLE IF NOT EXISTS predictive_weather_factors (
        segment VARCHAR(20) PRIMARY KEY,
        factor DOUBLE PRECISION NOT NULL,
        jours INTEGER,
        intervalles INTEGER,
        cavs INTEGER,
        computed_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS collection_learning_feedback (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
        cav_id INTEGER REFERENCES cav(id) ON DELETE CASCADE,
        predicted_fill_rate DOUBLE PRECISION NOT NULL,
        observed_fill_level INTEGER CHECK (observed_fill_level BETWEEN 0 AND 5),
        observed_fill_rate DOUBLE PRECISION,
        source VARCHAR(20) DEFAULT 'manual',
        predicted_weight_kg DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Colonnes canoniques (item 51) : `observed_fill_rate` (vérité terrain capteur
    // 0-120 %) et `source` (manual/sensor) — historiquement ajoutées seulement par
    // migrate-cav-sensors.js. On les garantit ici aussi (idempotent) pour que la
    // boucle de feedback capteur ait toujours ses colonnes.
    await client.query(`DO $$ BEGIN ALTER TABLE collection_learning_feedback ADD COLUMN observed_fill_rate DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
    await client.query(`DO $$ BEGIN ALTER TABLE collection_learning_feedback ADD COLUMN source VARCHAR(20) DEFAULT 'manual'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
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
        base_legale TEXT NOT NULL,
        categories_personnes TEXT,
        categories_donnees TEXT,
        destinataires TEXT,
        duree_conservation TEXT,
        mesures_securite TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Hotfix prod v2.22.1 — les fiches art. 30 récentes (badgeuse notamment)
    // portent des bases légales et des durées de conservation DÉTAILLÉES
    // (136 et 312 caractères mesurés), au-delà du VARCHAR(100) historique.
    // CREATE TABLE IF NOT EXISTS ne re-type jamais une base ancienne :
    // élargissement idempotent explicite (prouvé rejouable sur PostgreSQL 16).
    await client.query('ALTER TABLE rgpd_registre ALTER COLUMN base_legale TYPE TEXT;');
    await client.query('ALTER TABLE rgpd_registre ALTER COLUMN duree_conservation TYPE TEXT;');

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

    // MIGRATION 2026-04-15 : ajout du statut `returning` aux tournées
    // (le chauffeur a terminé sa collecte et revient au centre de tri).
    // Fix bug C4 : mobile/ReturnCentre.jsx envoyait 'returning' mais la
    // CHECK constraint d'origine ne l'acceptait pas → violation + données
    // perdues.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE tours DROP CONSTRAINT IF EXISTS tours_status_check;
        ALTER TABLE tours ADD CONSTRAINT tours_status_check
          CHECK (status IN ('planned', 'in_progress', 'paused', 'returning', 'completed', 'cancelled'));
      EXCEPTION WHEN undefined_table THEN NULL; END $$;
    `);

    // MIGRATION 2026-04-15 : colonnes km_start/km_end/notes manquantes sur
    // tours (fix bug C6 + C7 : km_end envoyé par mobile/ReturnCentre mais
    // jamais stocké, cascade TourSummary distance = null).
    await client.query(`
      ALTER TABLE tours ADD COLUMN IF NOT EXISTS km_start INTEGER;
      ALTER TABLE tours ADD COLUMN IF NOT EXISTS km_end INTEGER;
      ALTER TABLE tours ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // MIGRATION 2026-04-15 : colonnes tare_kg / is_intermediate / notes
    // sur tour_weights (fix bug C5 : données mobile WeighIn perdues).
    await client.query(`
      ALTER TABLE tour_weights ADD COLUMN IF NOT EXISTS tare_kg DOUBLE PRECISION;
      ALTER TABLE tour_weights ADD COLUMN IF NOT EXISTS is_intermediate BOOLEAN DEFAULT FALSE;
      ALTER TABLE tour_weights ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // NB : la table driver_messages (canal manager → chauffeur, item 62) est
    // créée au Module 5 (Collecte), après vehicle_checklists — un second CREATE
    // dupliqué ici a été retiré au debug vague 2 (divergence sur ON DELETE).

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

    // FK batch_id : traçabilité produit fini ↔ lot matière entrant
    // (P1#11 — audit Refashion DPAV : audit traçabilité éco-organisme).
    // Optionnel pour rétro-compat (les anciens PF n'ont pas de batch).
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE produits_finis ADD COLUMN batch_id INTEGER REFERENCES batch_tracking(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_produits_finis_batch ON produits_finis(batch_id);');

    // V1.9 — postes d'étiquetage (génération séquentielle d'IDs cartons en base24)
    await client.query(`
      CREATE TABLE IF NOT EXISTS postes_etiquetage (
        id SERIAL PRIMARY KEY,
        numero_poste SMALLINT NOT NULL UNIQUE CHECK (numero_poste BETWEEN 1 AND 9),
        nom VARCHAR(80) NOT NULL,
        compteur_actuel INTEGER NOT NULL DEFAULT 0 CHECK (compteur_actuel >= 0 AND compteur_actuel < 331776),
        is_active BOOLEAN DEFAULT true,
        derniere_etiquette_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    const postesExist = await client.query("SELECT id FROM postes_etiquetage LIMIT 1");
    if (postesExist.rows.length === 0) {
      await client.query(`INSERT INTO postes_etiquetage (numero_poste, nom) VALUES (1, 'Poste 1')`);
    }

    // ALTERS produits_finis pour piste de sortie scan
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE produits_finis ADD COLUMN poste_etiquetage_id INTEGER REFERENCES postes_etiquetage(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE produits_finis ADD COLUMN sortie_commande_type VARCHAR(10) CHECK (sortie_commande_type IN ('btq', 'vak', 'libre'));
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    // V1.9.1 : étend la CHECK existante pour accepter 'libre' si la colonne préexistait
    await client.query(`
      DO $$
      DECLARE c text;
      BEGIN
        SELECT con.conname INTO c FROM pg_constraint con
        JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
        WHERE con.conrelid = 'produits_finis'::regclass AND con.contype = 'c'
          AND att.attname = 'sortie_commande_type' LIMIT 1;
        IF c IS NOT NULL THEN
          EXECUTE 'ALTER TABLE produits_finis DROP CONSTRAINT ' || quote_ident(c);
        END IF;
        ALTER TABLE produits_finis ADD CONSTRAINT produits_finis_sortie_commande_type_check
          CHECK (sortie_commande_type IS NULL OR sortie_commande_type IN ('btq','vak','libre'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE produits_finis ADD COLUMN sortie_commande_id INTEGER;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE produits_finis ADD COLUMN scanned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pf_status_sortie ON produits_finis(status, date_sortie) WHERE date_sortie IS NULL;
    `);

    // V1.9.2 — référentiel des dimensions (genres, saisons, gammes, catégories eco-org)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ref_dimensions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(30) NOT NULL CHECK (type IN ('categorie_eco_org','genre','saison','gamme')),
        valeur VARCHAR(100) NOT NULL,
        ordre SMALLINT DEFAULT 100,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(type, valeur)
      );
      CREATE INDEX IF NOT EXISTS idx_ref_dimensions_type_active ON ref_dimensions(type, is_active);
    `);

    // Seed dimensions + produits_catalogue depuis le JSON Excel-extrait, uniquement si tables vides
    const dimsCount = await client.query(`SELECT COUNT(*)::int AS n FROM ref_dimensions`);
    const catCount = await client.query(`SELECT COUNT(*)::int AS n FROM produits_catalogue`);
    if (dimsCount.rows[0].n === 0 || catCount.rows[0].n === 0) {
      try {
        const seedPath = require('path').join(__dirname, '..', 'data', 'catalogue-base.json');
        const seed = JSON.parse(require('fs').readFileSync(seedPath, 'utf-8'));

        if (dimsCount.rows[0].n === 0) {
          const cats = Array.from(new Set(seed.produits.map(p => p.categorie_eco_org)));
          const all = [
            ...cats.map((v, i) => ['categorie_eco_org', v, i]),
            ...(seed.genres || []).map((v, i) => ['genre', v, i]),
            ...(seed.saisons || []).map((v, i) => ['saison', v, i]),
            ...(seed.gammes || []).map((v, i) => ['gamme', v, i]),
          ];
          for (const [type, valeur, ordre] of all) {
            await client.query(
              `INSERT INTO ref_dimensions (type, valeur, ordre) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [type, valeur, ordre]
            );
          }
          console.log(`[INIT-DB] ref_dimensions seedé : ${all.length} valeurs`);
        }

        if (catCount.rows[0].n === 0) {
          for (const p of seed.produits) {
            await client.query(
              `INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme, is_active)
               VALUES ($1, $2, $3, $4, $5, true)
               ON CONFLICT DO NOTHING`,
              [p.nom, p.categorie_eco_org, 'Sans Genre', 'Sans Saison', 'VAK']
            );
          }
          console.log(`[INIT-DB] produits_catalogue seedé : ${seed.produits.length} produits (défauts Sans Genre / Sans Saison / VAK)`);
        }
      } catch (e) {
        console.warn(`[INIT-DB] Seed catalogue non-appliqué (${e.message}) — utiliser scripts/seed-catalogue.js manuellement`);
      }
    }

    // V2.0 — Audit Refashion & Métropole (P0)
    // -- Agrément Refashion sur exutoires
    for (const sql of [
      `ALTER TABLE exutoires ADD COLUMN agrement_refashion BOOLEAN DEFAULT false`,
      `ALTER TABLE exutoires ADD COLUMN agrement_numero VARCHAR(50)`,
      `ALTER TABLE exutoires ADD COLUMN agrement_date_debut DATE`,
      `ALTER TABLE exutoires ADD COLUMN agrement_date_fin DATE`,
      `ALTER TABLE exutoires ADD COLUMN agrement_notes TEXT`,
    ]) {
      await client.query(`DO $$ BEGIN ${sql}; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
    }

    // -- Audit-trail DPAV
    for (const sql of [
      `ALTER TABLE refashion_dpav ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE refashion_dpav ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE refashion_dpav ADD COLUMN updated_at TIMESTAMP`,
    ]) {
      await client.query(`DO $$ BEGIN ${sql}; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS refashion_dpav_history (
        id SERIAL PRIMARY KEY,
        dpav_id INTEGER NOT NULL,
        annee INTEGER NOT NULL,
        trimestre INTEGER NOT NULL,
        action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
        snapshot JSONB NOT NULL,
        changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        changed_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_refashion_dpav_history_period ON refashion_dpav_history(annee, trimestre, changed_at DESC);
    `);

    // -- Paramétrage taux subvention Refashion (versionné par convention/avenant)
    await client.query(`
      CREATE TABLE IF NOT EXISTS refashion_taux_subvention (
        id SERIAL PRIMARY KEY,
        taux_euro_par_tonne NUMERIC(10,2) NOT NULL CHECK (taux_euro_par_tonne >= 0),
        valid_from DATE NOT NULL,
        valid_to DATE,
        source_document VARCHAR(255),
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
      );
      CREATE INDEX IF NOT EXISTS idx_refashion_taux_valid_from ON refashion_taux_subvention(valid_from DESC);
    `);
    // Vague 2 (item 52e) — pièce justificative (convention / avenant) attachée au
    // taux conventionné, consultable par l'auditeur Refashion (AUTORITE). Le champ
    // texte `source_document` reste pour la référence lisible ; ces colonnes portent
    // le fichier téléchargeable. ADD COLUMN IF NOT EXISTS = idempotent + base-neuve safe.
    await client.query(`ALTER TABLE refashion_taux_subvention ADD COLUMN IF NOT EXISTS justificatif_path TEXT`);
    await client.query(`ALTER TABLE refashion_taux_subvention ADD COLUMN IF NOT EXISTS justificatif_original_name TEXT`);
    await client.query(`ALTER TABLE refashion_taux_subvention ADD COLUMN IF NOT EXISTS justificatif_mime VARCHAR(120)`);

    // -- Référentiel communes INSEE (Métropole Rouen + EPCI limitrophes — Lot 10 2026-08)
    await client.query(`
      CREATE TABLE IF NOT EXISTS referentiel_communes (
        code_insee VARCHAR(5) PRIMARY KEY,
        nom VARCHAR(150) NOT NULL,
        code_postal VARCHAR(5),
        epci_code VARCHAR(20),
        epci_nom TEXT,
        population_insee INTEGER,
        is_metropole_rouen BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ref_communes_epci ON referentiel_communes(epci_code) WHERE is_metropole_rouen = true;
      CREATE INDEX IF NOT EXISTS idx_ref_communes_cp ON referentiel_communes(code_postal);
    `);
    // Lot 10 (2026-08) — élargissement du référentiel aux EPCI limitrophes (Eure 27 /
    // Seine-Maritime 76). Sur les bases EXISTANTES, epci_code/epci_nom datent du sprint
    // P0 05/2026 en VARCHAR(10)/VARCHAR(150) : on garantit leur existence (ADD IF NOT
    // EXISTS, no-op si présentes) puis on élargit les types (code EPCI = SIREN 9
    // chiffres, marge à 20 ; nom libre en TEXT). Idempotent : l'ALTER TYPE n'est joué
    // que si le type courant est plus étroit. AUCUN backfill SQL de epci_code ici :
    // les communes déjà présentes sans EPCI recevront 200023414 (Métropole Rouen) au
    // prochain POST /api/communes/refresh-metropole (upsert via l'API geo.api.gouv.fr).
    await client.query(`ALTER TABLE referentiel_communes ADD COLUMN IF NOT EXISTS epci_code VARCHAR(20)`);
    await client.query(`ALTER TABLE referentiel_communes ADD COLUMN IF NOT EXISTS epci_nom TEXT`);
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'referentiel_communes' AND column_name = 'epci_code'
                     AND character_maximum_length IS NOT NULL AND character_maximum_length < 20) THEN
          ALTER TABLE referentiel_communes ALTER COLUMN epci_code TYPE VARCHAR(20);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'referentiel_communes' AND column_name = 'epci_nom'
                     AND data_type <> 'text') THEN
          ALTER TABLE referentiel_communes ALTER COLUMN epci_nom TYPE TEXT;
        END IF;
      END $$;
    `);
    // Index plein (le partiel idx_ref_communes_epci ne couvre que la Métropole) pour
    // le filtre par EPCI de la page Admin > Communes.
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ref_communes_epci_all ON referentiel_communes(epci_code)`);
    await client.query(`DO $$ BEGIN ALTER TABLE cav ADD COLUMN code_insee_commune VARCHAR(5) REFERENCES referentiel_communes(code_insee) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cav_code_insee ON cav(code_insee_commune);`);

    // Seed referentiel_communes depuis JSON s'il est vide
    const refCommunesCount = await client.query(`SELECT COUNT(*)::int AS n FROM referentiel_communes`);
    if (refCommunesCount.rows[0].n === 0) {
      try {
        const seedPath = require('path').join(__dirname, '..', 'data', 'communes-metropole-rouen.json');
        const seed = JSON.parse(require('fs').readFileSync(seedPath, 'utf-8'));
        for (const c of seed) {
          await client.query(
            `INSERT INTO referentiel_communes (code_insee, nom, code_postal, epci_code, epci_nom, population_insee, is_metropole_rouen)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
            [c.code_insee, c.nom, c.code_postal, c.epci_code, c.epci_nom, c.population_insee, c.is_metropole_rouen ?? true]
          );
        }
        console.log(`[INIT-DB] referentiel_communes seedé : ${seed.length} communes`);
      } catch (e) {
        console.warn(`[INIT-DB] Seed communes non-appliqué (${e.message}) — fichier manquant`);
      }
    }

    // V2.1 — gammes réduites à EXTRA / STANDARD / VAK / EXPORT (refonte UI)
    // V2.2 — suppression effective des anciennes gammes (BTQ EXTRA, BTQ STAND, CHIF, Pvak)
    await client.query(`
      DELETE FROM ref_dimensions
      WHERE type = 'gamme' AND valeur NOT IN ('EXTRA','STANDARD','VAK','EXPORT')
    `);
    for (const [valeur, ordre] of [['EXTRA', 0], ['STANDARD', 1], ['VAK', 2], ['EXPORT', 3]]) {
      await client.query(
        `INSERT INTO ref_dimensions (type, valeur, ordre) VALUES ('gamme', $1, $2)
         ON CONFLICT (type, valeur) DO UPDATE SET is_active = true, ordre = EXCLUDED.ordre`,
        [valeur, ordre]
      );
    }

    // V2.2 — la table `associations` du référentiel fait doublon avec
    // `association_points` (module collecte). Suppression de la table inutilisée.
    await client.query(`DROP TABLE IF EXISTS associations CASCADE`);

    // V2.3 — Refonte categories_sortantes alignée Dashboard 2026 (P1-A)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE categories_sortantes ADD COLUMN famille_refashion VARCHAR(30)
          CHECK (famille_refashion IN ('reutilisation','recyclage','csr','elimination','retour'));
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN ALTER TABLE categories_sortantes ADD COLUMN ordre SMALLINT DEFAULT 100;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // Seed des 18 catégories sortantes (17 Dashboard + Refus de tri obligatoire)
    const categoriesSortantes = [
      { nom: 'Original',                     famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 10 },
      { nom: 'Pré-classé Textiles',          famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 20 },
      { nom: 'Pré-classé Chaussures par paire', famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 21 },
      { nom: 'Pré-classé Sacs Ceintures',    famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 22 },
      { nom: 'Pré-classé Linge de maison',   famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 23 },
      { nom: '2nd choix (VAK) Textiles',     famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 30 },
      { nom: '2nd choix (VAK) Chaussures',   famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 31 },
      { nom: '2nd choix (VAK) Maroquinerie', famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 32 },
      { nom: 'Destockage Textiles',          famille: 'Réutilisation', famille_refashion: 'reutilisation', ordre: 40 },
      { nom: 'Effilochage Coton',            famille: 'Recyclage',     famille_refashion: 'recyclage',     ordre: 50 },
      { nom: 'Effilochage Jean',             famille: 'Recyclage',     famille_refashion: 'recyclage',     ordre: 51 },
      { nom: 'Effilochage Mérinos',          famille: 'Recyclage',     famille_refashion: 'recyclage',     ordre: 52 },
      { nom: 'Effilochage Tricot',           famille: 'Recyclage',     famille_refashion: 'recyclage',     ordre: 53 },
      { nom: 'Chiffons blanc',               famille: 'Chiffons',      famille_refashion: 'recyclage',     ordre: 60 },
      { nom: 'Chiffons couleur',             famille: 'Chiffons',      famille_refashion: 'recyclage',     ordre: 61 },
      { nom: 'CSR Textiles',                 famille: 'CSR',           famille_refashion: 'csr',           ordre: 70 },
      { nom: 'CSR Chaussures',               famille: 'CSR',           famille_refashion: 'csr',           ordre: 71 },
      { nom: 'Refus de tri',                 famille: 'Élimination',   famille_refashion: 'elimination',   ordre: 90 },
    ];
    for (const c of categoriesSortantes) {
      await client.query(
        `INSERT INTO categories_sortantes (nom, famille, famille_refashion, ordre, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (nom) DO UPDATE SET
           famille = EXCLUDED.famille,
           famille_refashion = EXCLUDED.famille_refashion,
           ordre = EXCLUDED.ordre,
           is_active = true`,
        [c.nom, c.famille, c.famille_refashion, c.ordre]
      );
    }

    // V2.3 — audit-trail operation_outputs + motif non-collecte tour_cav (P1-B)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE operation_outputs ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // Vague 2 (items 56/57) — UI d'exécution du tri + administration du référentiel tri.
    // (a) operation_outputs.sortie_id devient NULLABLE : la saisie atelier est pilotée
    //     par la CATÉGORIE sortante (categorie_sortante_id, qui pilote le reversement
    //     stock à la complétion). Aucune sortie_operation n'est seedée → sortie_id NOT NULL
    //     rendait la saisie impossible. Tolère base neuve (table déjà créée plus haut).
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE operation_outputs ALTER COLUMN sortie_id DROP NOT NULL;
      EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
    `);
    // (b) operations_tri.is_active : permet la désactivation depuis l'admin référentiel
    //     (symétrie avec chaines_tri / postes_operation / categories_sortantes).
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE operations_tri ADD COLUMN is_active BOOLEAN DEFAULT true;
      EXCEPTION WHEN duplicate_column THEN NULL; WHEN undefined_table THEN NULL; END $$;
    `);
    // (c) index FK/lecture pour la liste des exécutions du jour et le détail.
    await client.query(`
      DO $$ BEGIN
        CREATE INDEX IF NOT EXISTS idx_operation_executions_batch ON operation_executions(batch_id);
        CREATE INDEX IF NOT EXISTS idx_operation_executions_started ON operation_executions(started_at);
        CREATE INDEX IF NOT EXISTS idx_operation_outputs_execution ON operation_outputs(execution_id);
      EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE tour_cav ADD COLUMN skip_reason VARCHAR(30)
          CHECK (skip_reason IS NULL OR skip_reason IN
            ('cav_fermee','bouchee','acces_impossible','proprietaire_absent','vide','autre'));
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // Mobile collecte : case « J'ai fait de la remballe » (FillLevel.jsx) et
    // photo d'audit aléatoire (une par tournée). `photo_path` existait déjà
    // sur tour_cav (jamais écrit) ; ajouté ici sur tour_association_point pour
    // que les tournées association bénéficient du même contrôle photo.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE tour_cav ADD COLUMN remballe BOOLEAN DEFAULT false;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    // NB : les colonnes homologues de tour_association_point sont ajoutees PLUS
    // BAS, apres le CREATE TABLE de cette table — deux DO blocks places ici les
    // ajoutaient AVANT sa creation : sur une base NEUVE, undefined_table (non
    // rattrape par duplicate_column) annulait TOUTE la transaction et la
    // reconstruction from scratch echouait (regression du correctif 2.7.0,
    // constatee par execution reelle : 0 table creee).

    // Vague 1 (item 45) — checklist véhicule : persister les remarques/anomalies
    // saisies par le chauffeur au départ. Le champ `notes` était envoyé par le
    // mobile (Checklist.jsx) mais jamais déstructuré ni stocké → perdu.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE vehicle_checklists ADD COLUMN notes TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // Vague 1 (item 44) — cycle de vie des incidents : commentaire de résolution
    // (obligatoire pour les statuts resolved/closed via PATCH /api/incidents/:id).
    // Les colonnes status/resolved_at/resolved_by existent déjà (schéma incidents).
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE incidents ADD COLUMN resolution_notes TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // V2.3 — 5 vues SQL Dashboard 2026 (P1-C : QHSE permanent)
    await client.query(`
      CREATE OR REPLACE VIEW vw_tonnage_annuel_tournee AS
      SELECT EXTRACT(YEAR FROM t.date)::int AS annee,
             EXTRACT(MONTH FROM t.date)::int AS mois,
             COALESCE(sr.name, 'Tournée ad hoc') AS tournee,
             COALESCE(SUM(tw.weight_kg), 0)::int AS poids_kg,
             COUNT(DISTINCT t.id)::int AS nb_tournees
      FROM tours t
      LEFT JOIN tour_weights tw ON tw.tour_id = t.id
      LEFT JOIN standard_routes sr ON t.standard_route_id = sr.id
      WHERE t.status = 'completed'
      GROUP BY annee, mois, sr.name
      ORDER BY annee, mois, sr.name;
    `);

    await client.query(`
      -- REPOINTAGE audit 2026-07-12 (item 26, vague 1 — arbitrage A1).
      -- AVANT : cette vue (et vw_coherence_tri_filiere plus bas) s'appuyaient sur
      -- la table \`colisages\`, une couche de conditionnement JAMAIS adoptée en
      -- exploitation (0 UI de création de colisage — vérifié) → vues vides →
      -- audit Refashion impossible (persona auditeur 2/10, vue « sortants par
      -- famille » sans aucune source).
      -- APRÈS : on les repointe sur \`produits_finis\`, la table RÉELLEMENT
      -- alimentée (étiquetage douchette / balance / saisie manuelle — plusieurs
      -- pages front actives). Décision A1 : PAS d'UI colisage en vague 1, on
      -- repointe les preuves d'audit sur les données réelles. Re-basculable sur
      -- \`colisages\` si le workflow de conditionnement est un jour adopté.
      --
      -- Mapping produit → catégorie → famille_refashion :
      --   produits_finis.categorie_eco_org (Textiles / Chaussures / Maroquinerie /
      --   Linge / Chiffons…) est mappé sur les 5 familles Refashion via un CASE
      --   documenté. Un produit non mappable sort en famille 'non_classe' (jamais
      --   perdu). LIMITE CONNUE : produits_finis capture surtout la réutilisation
      --   et les chiffons (recyclage) ; les tonnages CSR / effilochage / refus de
      --   tri partent en VRAC et ne deviennent pas des produits finis catalogués —
      --   ils n'apparaissent donc pas ici (à documenter côté écran).
      -- Un « sortant » = un produit fini expédié vers un exutoire (date_sortie
      -- renseignée).
      -- DROP préalable : la nouvelle définition renomme une colonne
      -- (nb_colisages → nb_produits) et change des types (section_dpav) —
      -- CREATE OR REPLACE seul échouerait sur une base existante. Aucune autre
      -- vue ne dépend de celle-ci (consommée uniquement au runtime par
      -- /refashion/exports), donc pas de CASCADE.
      DROP VIEW IF EXISTS vw_dpav_sortants;
      CREATE OR REPLACE VIEW vw_dpav_sortants AS
      WITH pf_classe AS (
        SELECT
          EXTRACT(YEAR FROM pf.date_sortie)::int    AS annee,
          EXTRACT(QUARTER FROM pf.date_sortie)::int AS trimestre,
          COALESCE(NULLIF(pf.categorie_eco_org, ''), '(non renseigné)') AS categorie,
          COALESCE(e.nom, '(sans exutoire)')        AS exutoire,
          pf.poids_kg,
          CASE
            WHEN pf.categorie_eco_org ILIKE '%chiffon%'                 THEN 'recyclage'
            WHEN pf.categorie_eco_org ILIKE '%csr%'                     THEN 'csr'
            WHEN pf.categorie_eco_org ILIKE '%refus%'
              OR pf.gamme ILIKE '%refus%'                               THEN 'elimination'
            WHEN pf.categorie_eco_org IS NOT NULL
             AND pf.categorie_eco_org <> ''                            THEN 'reutilisation'
            ELSE 'non_classe'
          END AS famille_refashion
        FROM produits_finis pf
        LEFT JOIN exutoires e ON pf.exutoire_id = e.id
        WHERE pf.date_sortie IS NOT NULL
      )
      SELECT annee, trimestre,
             CASE famille_refashion
               WHEN 'reutilisation' THEN 'Réutilisation'
               WHEN 'recyclage'     THEN 'Recyclage'
               WHEN 'csr'           THEN 'CSR'
               WHEN 'elimination'   THEN 'Élimination'
               WHEN 'retour'        THEN 'Retour'
               ELSE 'Non classé'
             END                                     AS section_dpav,
             famille_refashion,
             categorie,
             exutoire,
             ROUND((SUM(poids_kg) / 1000.0)::numeric, 3) AS tonnage_t,
             COUNT(*)::int                           AS nb_produits
      FROM pf_classe
      GROUP BY annee, trimestre, famille_refashion, categorie, exutoire
      ORDER BY annee, trimestre, section_dpav, exutoire;
    `);

    await client.query(`
      -- Correctif audit 07/2026 : l'ancienne définition joignait tours × tour_weights
      -- × tour_cav dans le même GROUP BY → produit cartésien. Chaque pesée était
      -- comptée une fois PAR CAV collecté et attribuée en TOTAL à chaque commune,
      -- gonflant le tonnage territorial (~×nb_cav). On calcule maintenant le poids
      -- total par tournée et le nombre de CAV collectés dans des CTE SÉPARÉES, puis
      -- on répartit uniformément (total / nb_cav) sur chaque CAV collecté et on
      -- agrège par commune — total conservé, plus de double-comptage.
      CREATE OR REPLACE VIEW vw_dpav_communes AS
      WITH poids_tour AS (
        SELECT tour_id, SUM(weight_kg) AS poids_total_kg
        FROM tour_weights GROUP BY tour_id
      ), cav_par_tour AS (
        SELECT tour_id, COUNT(*) AS nb_cav_collectes
        FROM tour_cav WHERE status = 'collected' GROUP BY tour_id
      )
      SELECT EXTRACT(YEAR FROM t.date)::int AS annee,
             EXTRACT(QUARTER FROM t.date)::int AS trimestre,
             COALESCE(rc.code_insee, '')::text AS code_insee,
             COALESCE(rc.nom, c.commune, '(non rattaché)') AS commune,
             COALESCE(rc.code_postal, '') AS code_postal,
             COALESCE(ROUND(SUM(pt.poids_total_kg::numeric / NULLIF(cpt.nb_cav_collectes, 0))), 0)::int AS poids_kg
      FROM tours t
      JOIN tour_cav tc ON tc.tour_id = t.id AND tc.status = 'collected'
      JOIN cav c ON tc.cav_id = c.id
      JOIN poids_tour pt ON pt.tour_id = t.id
      JOIN cav_par_tour cpt ON cpt.tour_id = t.id
      LEFT JOIN referentiel_communes rc ON c.code_insee_commune = rc.code_insee
      WHERE t.status = 'completed'
      GROUP BY annee, trimestre, rc.code_insee, COALESCE(rc.nom, c.commune, '(non rattaché)'), rc.code_postal
      ORDER BY annee, trimestre, commune;
    `);

    await client.query(`
      CREATE OR REPLACE VIEW vw_subvention_refashion_mensuelle AS
      WITH entree AS (
        SELECT EXTRACT(YEAR FROM date)::int AS annee,
               EXTRACT(MONTH FROM date)::int AS mois,
               SUM(entree_ligne_kg)::int AS tonnage_trie_kg
        FROM production_daily
        GROUP BY annee, mois
      ), taux AS (
        SELECT taux_euro_par_tonne, valid_from, COALESCE(valid_to, '9999-12-31'::date) AS valid_to
        FROM refashion_taux_subvention
      )
      SELECT e.annee, e.mois,
             e.tonnage_trie_kg,
             t.taux_euro_par_tonne,
             ROUND((e.tonnage_trie_kg / 1000.0 * t.taux_euro_par_tonne)::numeric, 2) AS subvention_eur
      FROM entree e
      LEFT JOIN taux t ON make_date(e.annee, e.mois, 15) BETWEEN t.valid_from AND t.valid_to
      ORDER BY e.annee, e.mois;
    `);

    await client.query(`
      -- REPOINTAGE audit 2026-07-12 (item 26, vague 1 — arbitrage A1).
      -- AVANT : le sortant reposait sur \`colisages\` (jamais alimenté) → vue vide.
      -- APRÈS : sortant = poids des \`produits_finis\` fabriqués dans le mois
      -- (table réellement alimentée) ; entrant inchangé (production_daily.
      -- entree_ligne_kg). L'écart mesure la part de l'entrée tri retrouvée en
      -- produits finis conditionnés — il reste STRUCTURELLEMENT positif tant que
      -- les flux vrac (CSR / effilochage / refus de tri) ne transitent pas par
      -- produits_finis. FULL OUTER JOIN pour ne perdre aucun mois (entrée seule
      -- OU sortie seule). Re-basculable sur colisages si adopté.
      -- DROP préalable par cohérence avec vw_dpav_sortants (change de structure
      -- interne) ; aucune vue dépendante → pas de CASCADE.
      DROP VIEW IF EXISTS vw_coherence_tri_filiere;
      CREATE OR REPLACE VIEW vw_coherence_tri_filiere AS
      WITH entrant AS (
        SELECT EXTRACT(YEAR FROM date)::int AS annee,
               EXTRACT(MONTH FROM date)::int AS mois,
               SUM(entree_ligne_kg)::int AS entree_kg
        FROM production_daily
        GROUP BY annee, mois
      ), sortant AS (
        SELECT EXTRACT(YEAR FROM pf.date_fabrication)::int AS annee,
               EXTRACT(MONTH FROM pf.date_fabrication)::int AS mois,
               SUM(pf.poids_kg)::int AS sortie_kg
        FROM produits_finis pf
        WHERE pf.date_fabrication IS NOT NULL
        GROUP BY annee, mois
      )
      SELECT annee, mois,
             COALESCE(e.entree_kg, 0) AS entree_kg,
             COALESCE(s.sortie_kg, 0) AS sortie_kg,
             (COALESCE(e.entree_kg, 0) - COALESCE(s.sortie_kg, 0)) AS ecart_kg,
             ROUND(100.0 * (COALESCE(e.entree_kg, 0) - COALESCE(s.sortie_kg, 0))::numeric
                   / NULLIF(COALESCE(e.entree_kg, 0), 0), 2) AS ecart_pct
      FROM entrant e
      FULL OUTER JOIN sortant s USING (annee, mois)
      ORDER BY annee, mois;
    `);

    console.log('[INIT-DB] Migrations P1 (categories_sortantes refonte + audit-trail + 5 vues SQL) ✓');

    // V2.4 — P2-A : suppression de flux_sortants (orphelin, jamais écrite, remplacée par vw_dpav_sortants)
    await client.query(`DROP TABLE IF EXISTS flux_sortants CASCADE`);

    // V2.4 — P2-C : précision sortie d'insertion (employeur + SIRET + durée contrat)
    // Fix debug Vague 1 : ce bloc s'exécute AVANT le CREATE TABLE insertion_milestones
    // (plus bas dans le fichier) → sur une base NEUVE la table n'existe pas encore et
    // l'erreur undefined_table (42P01) avortait toute l'initialisation (bloquant pour
    // la reconstruction / un nouvel environnement). On tolère l'absence de table :
    // les 2 colonnes sont désormais aussi dans la définition canonique de la table.
    await client.query(`DO $$ BEGIN
      ALTER TABLE insertion_milestones ADD COLUMN sortie_employeur_siret VARCHAR(14);
    EXCEPTION WHEN duplicate_column THEN NULL; WHEN undefined_table THEN NULL; END $$;`);
    await client.query(`DO $$ BEGIN
      ALTER TABLE insertion_milestones ADD COLUMN sortie_duree_contrat_mois SMALLINT
        CHECK (sortie_duree_contrat_mois IS NULL OR sortie_duree_contrat_mois >= 0);
    EXCEPTION WHEN duplicate_column THEN NULL; WHEN undefined_table THEN NULL; END $$;`);

    console.log('[INIT-DB] Migrations P2 (DROP flux_sortants + employeur sortie) ✓');

    console.log('[INIT-DB] Migrations (candidate_id, exécution tri, colisages, batch_id PF, étiquetage, ref_dimensions, audit P0, gammes V2.1) ✓');

    // ══════════════════════════════════════════
    // DONNÉES INITIALES (Seeds)
    // ══════════════════════════════════════════

    // Admin par défaut (audit 2026-07-11, item 1)
    // On ne réécrase JAMAIS un compte admin existant (garde-fou historique conservé).
    // Sur une base fraîche, le mot de passe est ALÉATOIRE (jamais de valeur connue
    // type « admin123 ») : il est affiché UNE SEULE FOIS dans les logs de démarrage,
    // et le compte est marqué must_change_password=true (changement obligatoire au
    // premier login).
    const adminExists = await client.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminExists.rows.length === 0) {
      const initialPassword = crypto.randomBytes(16).toString('hex'); // 32 caractères hex, entropie forte
      const hash = await bcrypt.hash(initialPassword, 10);
      await client.query(
        `INSERT INTO users (username, password_hash, email, role, first_name, last_name, must_change_password)
         VALUES ('admin', $1, 'admin@solidata.fr', 'ADMIN', 'Administrateur', 'Système', true)`,
        [hash]
      );
      console.log('');
      console.log('================================================================');
      console.log('  MOT DE PASSE ADMIN INITIAL — notez-le, il ne sera PLUS affiché.');
      console.log('  Changement OBLIGATOIRE à la première connexion.');
      console.log('  --------------------------------------------------------------');
      console.log('  Identifiant  : admin');
      console.log(`  Mot de passe : ${initialPassword}`);
      console.log('================================================================');
      console.log('');
    }

    // Compte de SERVICE « chauffeur » : identité générique portée par les JWT
    // du mode véhicule (« 1 URL = 1 véhicule », auth.js /driver-start) quand le
    // chauffeur affecté n'a pas de compte utilisateur propre — le cas normal,
    // les fiches salariés venant de la paie. Mot de passe aléatoire jamais
    // communiqué : ce compte ne sert PAS à se connecter, uniquement à porter
    // l'identité des jetons chauffeur dans la journalisation. Sans lui,
    // driver-start refuse (503) au lieu de retomber silencieusement sur l'id 1.
    const chauffeurExists = await client.query("SELECT id FROM users WHERE username = 'chauffeur'");
    if (chauffeurExists.rows.length === 0) {
      const servicePassword = crypto.randomBytes(24).toString('hex');
      const serviceHash = await bcrypt.hash(servicePassword, 10);
      await client.query(
        `INSERT INTO users (username, password_hash, email, role, first_name, last_name, must_change_password)
         VALUES ('chauffeur', $1, 'chauffeur@solidata.fr', 'COLLABORATEUR', 'Chauffeur', 'Collecte', false)`,
        [serviceHash]
      );
      console.log('[INIT-DB] Compte de service « chauffeur » créé (jetons du mode véhicule)');
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

    // Migration : contraintes NOT NULL sur colonnes opérationnelles critiques
    // Appliquées uniquement si aucune valeur NULL existante (évite les erreurs sur BDD legacy)
    try {
      const nullTours = await client.query('SELECT COUNT(*) FROM tours WHERE vehicle_id IS NULL');
      if (parseInt(nullTours.rows[0].count) === 0) {
        await client.query('ALTER TABLE tours ALTER COLUMN vehicle_id SET NOT NULL');
        console.log('[INIT-DB] Migration NOT NULL tours.vehicle_id ✓');
      } else {
        console.warn('[INIT-DB] Migration NOT NULL tours.vehicle_id ignorée : valeurs NULL existantes (' + nullTours.rows[0].count + ' lignes)');
      }
      // driver_employee_id : NOT NULL RETIRÉ (idempotent). Le mobile chauffeur
      // s'authentifie par le lien unique du VÉHICULE — un camion sans chauffeur
      // affecté doit pouvoir partir en tournée. La contrainte bloquait la prise
      // de tournée depuis le mobile ; l'intégrité utile (véhicule) est conservée.
      await client.query('ALTER TABLE tours ALTER COLUMN driver_employee_id DROP NOT NULL');
    } catch (e) { console.warn('[INIT-DB] Migration NOT NULL tours :', e.message); }

    try {
      const nullTourCav = await client.query('SELECT COUNT(*) FROM tour_cav WHERE tour_id IS NULL OR cav_id IS NULL');
      if (parseInt(nullTourCav.rows[0].count) === 0) {
        await client.query('ALTER TABLE tour_cav ALTER COLUMN tour_id SET NOT NULL');
        await client.query('ALTER TABLE tour_cav ALTER COLUMN cav_id SET NOT NULL');
        console.log('[INIT-DB] Migration NOT NULL tour_cav.tour_id + cav_id ✓');
      } else {
        console.warn('[INIT-DB] Migration NOT NULL tour_cav ignorée : valeurs NULL existantes (' + nullTourCav.rows[0].count + ' lignes)');
      }
    } catch (e) { console.warn('[INIT-DB] Migration NOT NULL tour_cav :', e.message); }

    try {
      const nullGps = await client.query('SELECT COUNT(*) FROM gps_positions WHERE tour_id IS NULL OR vehicle_id IS NULL');
      if (parseInt(nullGps.rows[0].count) === 0) {
        await client.query('ALTER TABLE gps_positions ALTER COLUMN tour_id SET NOT NULL');
        await client.query('ALTER TABLE gps_positions ALTER COLUMN vehicle_id SET NOT NULL');
        console.log('[INIT-DB] Migration NOT NULL gps_positions.tour_id + vehicle_id ✓');
      } else {
        console.warn('[INIT-DB] Migration NOT NULL gps_positions ignorée : valeurs NULL existantes (' + nullGps.rows[0].count + ' lignes)');
      }
    } catch (e) { console.warn('[INIT-DB] Migration NOT NULL gps_positions :', e.message); }
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
      -- Fraîcheur de la photo (exigence 08/2026) : le chauffeur doit fournir une
      -- photo quand le CAV n'en a aucune, ou quand la sienne dépasse le seuil
      -- paramétrable « collecte.photo_fraicheur_mois » (défaut 6). La date de prise
      -- de vue devient donc une donnée métier (pas un horodatage technique) et
      -- l'origine permet de distinguer une photo posée au back-office ('admin')
      -- d'une photo prise sur le terrain ('chauffeur').
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS photo_taken_at TIMESTAMP;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS photo_source VARCHAR(20);
    `);
    // Backfill one-shot des photos déjà en base : leur date de prise de vue
    // EXACTE est inconnue (elle n'était pas enregistrée). On l'approxime par
    // `updated_at` — approximation ASSUMÉE, marquée `photo_source='import'` pour
    // rester traçable. Sans elle, tous les CAV déjà photographiés seraient vus
    // « sans date » donc à re-photographier dès le prochain passage, à rebours
    // de la demande client (« si une photo existe, pas besoin d'en reprendre »).
    // Idempotent : le WHERE ne retient que les lignes non encore datées.
    await client.query(`
      UPDATE cav
         SET photo_taken_at = COALESCE(updated_at, created_at),
             photo_source = COALESCE(photo_source, 'import')
       WHERE photo_path IS NOT NULL AND photo_taken_at IS NULL;
    `);
    console.log('[INIT-DB] Migration CAV photo (fraîcheur + origine) ✓');

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

    // Perf P0 #4 — Index FK manquants sur tables time-series et chemins critiques
    await client.query('CREATE INDEX IF NOT EXISTS idx_tour_cav_tour_id ON tour_cav(tour_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_tour_cav_cav_id ON tour_cav(cav_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_incidents_tour_id ON incidents(tour_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_gps_positions_vehicle_recorded ON gps_positions(vehicle_id, recorded_at DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_stock_movements_matiere ON stock_movements(matiere_id);');

    // A1 (audit 07/2026) — stock_movements.matiere_id classe en réalité le stock
    // par categories_sortantes (front Stock.jsx + inventaire), mais la FK pointait
    // la table legacy matieres (jamais seedée, vide) → toute saisie catégorisée
    // violait la FK (500) et le stock trié restait « Non classé ». matieres étant
    // vide, tous les matiere_id existants sont NULL → repointage sûr vers
    // categories_sortantes (source de classification vivante depuis la refonte P1).
    await client.query(`
      UPDATE stock_movements SET matiere_id = NULL
      WHERE matiere_id IS NOT NULL
        AND matiere_id NOT IN (SELECT id FROM categories_sortantes)
    `);
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE constraint_name = 'stock_movements_matiere_id_fkey'
                     AND table_name = 'stock_movements') THEN
          ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_matiere_id_fkey;
        END IF;
        ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_matiere_id_fkey
          FOREIGN KEY (matiere_id) REFERENCES categories_sortantes(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_tour_weights_tour ON tour_weights(tour_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_tours_driver_date ON tours(driver_employee_id, date DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);');
    // Fix debug Vague 1 : employees.insertion_status est ajoutée par une migration
    // PLUS BAS dans le fichier — sur une base NEUVE la colonne n'existe pas encore
    // ici et l'index avortait toute l'initialisation. Tolérant (l'index sera créé
    // au passage suivant d'init-db, exécuté à chaque déploiement).
    await client.query(`DO $$ BEGIN
      CREATE INDEX IF NOT EXISTS idx_employees_insertion_status ON employees(insertion_status);
    EXCEPTION WHEN undefined_column THEN NULL; END $$;`);
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
    // Vague 2 (item 61b) — CIP référent : rattache un salarié à un conseiller
    // (utilisateur RH/ADMIN). Permet le filtre « mes salariés » sur le tableau de
    // bord CIP. users existe déjà (créé plus haut) → FK sûre.
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS cip_referent_user_id INTEGER REFERENCES users(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_cip_referent ON employees(cip_referent_user_id) WHERE cip_referent_user_id IS NOT NULL`);

    // V1.8+ : Champs étendus pour import Malibou (CSV 12 colonnes)
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS malibou_id VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_name VARCHAR(100);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender VARCHAR(10);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality VARCHAR(100);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS qualification TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255);
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_malibou_id ON employees(malibou_id) WHERE malibou_id IS NOT NULL`);

    // V2.2 : Import complet Malibou (feuilles « Informations salariés » + « Contrats »).
    // Toutes les infos exploitables opérationnellement de l'export sont accueillies.
    // NB RGPD (minimisation) : le N° de sécurité sociale, l'IBAN et le BIC de
    // l'export NE SONT PAS repris ici — ils restent dans le logiciel de paie
    // (aucun usage métier dans l'ERP, réduction de la surface d'exposition).
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS address VARCHAR(255);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS city VARCHAR(120);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS country VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civility VARCHAR(15);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_city VARCHAR(120);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_country VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_department VARCHAR(10);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS disability_status VARCHAR(60);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS residence_permit_type VARCHAR(120);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS residence_permit_number VARCHAR(60);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS residence_permit_renewal VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS medical_visit_frequency VARCHAR(20);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS seniority_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_malibou_id VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_name VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_time_type VARCHAR(40);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS gross_salary VARCHAR(60);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS siret VARCHAR(14);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS establishment VARCHAR(120);
    `);
    // Lien hiérarchique résolu (manager_id) — FK auto-référente, ajout tolérant.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id)`);

    // V2.3.1 : les champs texte issus de l'export (longueur non maîtrisée côté
    // Malibou) passent en TEXT pour éliminer les « value too long for type
    // character varying(N) » à l'import (ex. « Renouvellement titre de séjour »
    // qui était en VARCHAR(30)). Idempotent : ne convertit que si pas déjà TEXT.
    await client.query(`
      DO $$
      DECLARE col text;
      BEGIN
        FOREACH col IN ARRAY ARRAY[
          'address','city','postal_code','country','civility','birth_city','birth_country',
          'birth_department','disability_status','residence_permit_type','residence_permit_number',
          'residence_permit_renewal','medical_visit_frequency','manager_malibou_id','manager_name',
          'work_time_type','gross_salary','siret','establishment','qualification'
        ] LOOP
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name=col AND data_type <> 'text') THEN
            EXECUTE format('ALTER TABLE employees ALTER COLUMN %I TYPE TEXT', col);
          END IF;
        END LOOP;
      END $$;
    `);

    // ── Conformité IAE — Prescripteurs (P1#14)
    await client.query(`
      CREATE TABLE IF NOT EXISTS prescripteur_orgas (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(150) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('PE', 'FT', 'ML', 'CD', 'CCAS', 'CAP_EMPLOI', 'AUTRE_ASSO', 'DIRECT')),
        contact_nom VARCHAR(100),
        contact_email VARCHAR(150),
        contact_phone VARCHAR(30),
        region VARCHAR(50),
        siret VARCHAR(14),
        actif BOOLEAN DEFAULT true,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_prescripteur_orgas_type ON prescripteur_orgas(type);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prescripteur_orgas_actif ON prescripteur_orgas(actif);');

    // FK structurée employee → prescripteur (en plus du free text 'prescripteur'
    // gardé pour rétrocompat). Permet le reporting Pôle Emploi / FSE+.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN prescripteur_id INTEGER REFERENCES prescripteur_orgas(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN date_prescription DATE;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_employees_prescripteur ON employees(prescripteur_id);');

    // ── Conformité droit du travail — Visite médicale post-embauche (P1#13)
    // Légalement : visite d'information et de prévention dans les 3 mois (CDDI 2 mois).
    // On enregistre la date prévisionnelle (auto J+90) + la date réalisée + résultat.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN visite_medicale_due_date DATE;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN visite_medicale_resultat VARCHAR(30)
          CHECK (visite_medicale_resultat IN ('conforme', 'restrictions', 'inapte', 'a_revoir'));
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN visite_medicale_notes TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    // Index partiel sur les visites en retard (pour scheduler alertes)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_visite_due
      ON employees(visite_medicale_due_date)
      WHERE visite_medicale_date IS NULL AND visite_medicale_due_date IS NOT NULL;
    `);

    // Backfill visite_medicale_due_date pour les employés existants : J+90 après contract_start.
    await client.query(`
      UPDATE employees
      SET visite_medicale_due_date = contract_start + INTERVAL '90 days'
      WHERE contract_start IS NOT NULL
        AND visite_medicale_due_date IS NULL
        AND visite_medicale_date IS NULL;
    `);

    // ── Item 43 — Dernière visite médicale PÉRIODIQUE (distincte de la visite
    // post-embauche portée par visite_medicale_date) → fin de la conflation
    // à l'import (collaborator-import.applyMedicalVisit).
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE employees ADD COLUMN last_medical_visit_date DATE;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // ── Item 41 — Réconciliation du CDDI dans la table de contrats normalisée.
    // Le CHECK d'origine de employee_contracts.contract_type excluait 'CDDI',
    // ce qui forçait la coercition CDDI→CDD à l'import (perte silencieuse de
    // l'objet métier central du suivi d'insertion). On élargit le CHECK pour
    // accueillir 'CDDI' (superset : aucune ligne existante ne viole la nouvelle
    // contrainte). Idempotent (drop-then-add, comme les autres CHECK du fichier).
    await client.query('ALTER TABLE employee_contracts DROP CONSTRAINT IF EXISTS employee_contracts_contract_type_check');
    await client.query(`ALTER TABLE employee_contracts ADD CONSTRAINT employee_contracts_contract_type_check
      CHECK (contract_type IN ('CDI', 'CDD', 'CDDI', 'interim', 'stage', 'apprentissage'))`);

    // ── v1-5 — Plage de temps de travail réaliste sur employee_contracts.
    // Le CHECK d'origine weekly_hours IN (26, 35) coerçait les temps réels
    // (24 / 28 / 30 h) à l'import : la quotité réelle était écrasée à 35. On le
    // remplace par une plage 0 < h <= 48 (superset : les valeurs 26/35
    // existantes restent valides). Idempotent (drop-then-add, comme ci-dessus).
    // employee_contracts est créée bien plus haut dans ce même run → pas de
    // risque undefined_table sur le chemin « base neuve ».
    await client.query('ALTER TABLE employee_contracts DROP CONSTRAINT IF EXISTS employee_contracts_weekly_hours_check');
    await client.query(`ALTER TABLE employee_contracts ADD CONSTRAINT employee_contracts_weekly_hours_check
      CHECK (weekly_hours > 0 AND weekly_hours <= 48)`);

    // ── Lot 3 (2026-08) — Import paie Malibou : HISTORIQUE DES CONTRATS ──────
    // L'export fournit TOUTES les lignes de la feuille « Contrats » : une ligne
    // par AVENANT, l'« ID contrat » (ctr_…) étant partagé par les avenants d'un
    // même contrat. Colonnes d'accueil (idempotentes) :
    //  • malibou_contract_id + avenant_date = clé d'upsert (index unique partiel) ;
    //  • start_date / end_date portent la PÉRIODE EFFECTIVE reconstituée (règle
    //    métier : la ligne précédente, triée par date d'avenant, s'arrête la
    //    VEILLE de la suivante) ;
    //  • official_start_date / official_end_date = dates brutes du contrat
    //    (la date de début officielle = date d'embauche UNIQUE, répétée sur
    //    chaque ligne d'avenant du même contrat).
    await client.query(`
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS malibou_contract_id TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS avenant_date DATE;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS official_start_date DATE;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS official_end_date DATE;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS trial_period_end DATE;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS motif_cdd TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS statut_cadre BOOLEAN;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS qualification TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS position_title TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS gross_salary TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS work_time_type TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS work_time_category TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS days_per_week DOUBLE PRECISION;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS hours_per_year DOUBLE PRECISION;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS days_per_year DOUBLE PRECISION;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS weekly_schedule JSONB;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS dpae_reference TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS dpae_date DATE;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS siret TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS establishment TEXT;
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS source VARCHAR(20);
      ALTER TABLE employee_contracts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_contracts_malibou
      ON employee_contracts(malibou_contract_id, avenant_date)
      WHERE malibou_contract_id IS NOT NULL AND avenant_date IS NOT NULL;
    `);
    // Une ligne d'avenant n'est ni une embauche ni un renouvellement de contrat :
    // le CHECK origin s'élargit (superset — drop-then-add, pattern du fichier).
    await client.query('ALTER TABLE employee_contracts DROP CONSTRAINT IF EXISTS employee_contracts_origin_check');
    await client.query(`ALTER TABLE employee_contracts ADD CONSTRAINT employee_contracts_origin_check
      CHECK (origin IN ('embauche', 'renouvellement', 'avenant'))`);

    // Contacts d'urgence (feuille « Informations salariés ») — intérêt légitime
    // employeur (obligation de sécurité). La doctrine de minimisation demeure :
    // NIR, IBAN et BIC de l'export restent volontairement NON importés.
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_email TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact2_name TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact2_phone TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact2_email TEXT;
    `);

    // Heures hebdomadaires de l'export paie (feuille « Heures travaillées »,
    // une ligne par salarié × semaine ISO). work_hours est JOURNALIER
    // (UNIQUE(employee_id, date)) : répartir des heures hebdo sur des jours
    // inventerait de la donnée → stockage HEBDO dédié, fidèle à la granularité
    // source (la paie fait foi ; work_hours reste la saisie ERP quotidienne).
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_week_hours (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        iso_year INTEGER NOT NULL,
        iso_week INTEGER NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
        week_start DATE,
        week_end DATE,
        statut VARCHAR(40),
        hours_worked DOUBLE PRECISION,
        hours_expected DOUBLE PRECISION,
        hours_contract DOUBLE PRECISION,
        hours_absence DOUBLE PRECISION,
        hs_0 DOUBLE PRECISION,
        hs_25 DOUBLE PRECISION,
        hs_50 DOUBLE PRECISION,
        h_inf DOUBLE PRECISION,
        hc_0 DOUBLE PRECISION,
        hc_10 DOUBLE PRECISION,
        hours_exc_sunday DOUBLE PRECISION,
        hours_exc_holiday DOUBLE PRECISION,
        hours_exc_night DOUBLE PRECISION,
        source VARCHAR(20) DEFAULT 'malibou',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, iso_year, iso_week)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_week_hours_year_week ON employee_week_hours(iso_year, iso_week);');

    // Absences/congés de l'export paie (feuille « Congés & Télétravail »).
    // On n'écrit PAS dans work_hours (journalier, hours_worked NOT NULL,
    // collision avec la saisie RH réelle et sémantique inventée) : table dédiée
    // à la période native [début → fin], catégorisée vers l'enum ERP
    // (holiday/sick/absence) pour les restitutions.
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_leaves (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        leave_type TEXT NOT NULL,
        type_category VARCHAR(20) CHECK (type_category IN ('holiday', 'sick', 'absence')),
        request_date DATE,
        start_date DATE NOT NULL,
        end_date DATE,
        half_day_start BOOLEAN,
        half_day_end BOOLEAN,
        duration_days DOUBLE PRECISION,
        duration_working_days DOUBLE PRECISION,
        statut VARCHAR(40),
        validator_name TEXT,
        validated_at DATE,
        source VARCHAR(20) DEFAULT 'malibou',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, leave_type, start_date)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_employee_leaves_dates ON employee_leaves(start_date, end_date);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee ON employee_leaves(employee_id);');

    // Registre RGPD (art. 30) — le traitement « gestion administrative RH »
    // s'étend aux données rapatriées de la paie (historique contractuel, heures
    // hebdomadaires, absences, contacts d'urgence). Seed idempotent.
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Import du logiciel de paie (contrats, heures, absences, contacts d''urgence)',
        'Synchronisation de la base RH depuis l''export du logiciel de paie : historique contractuel (contrat d''origine et avenants, planning hebdomadaire contractuel), heures hebdomadaires travaillées/attendues/supplémentaires, absences et congés validés, contacts d''urgence. Sert le suivi des parcours (CDDI, renouvellements), le planning et le reporting RH agrégé.',
        'Exécution du contrat de travail et obligation légale (Code du travail)',
        'Salariés (permanents et parcours d''insertion)',
        'Identité et coordonnées, données contractuelles (dates, quotité, salaire brut contractuel, période d''essai, DPAE), heures et absences hebdomadaires, type d''absence (dont maladie — durée seulement, aucun motif médical), contacts d''urgence (nom, téléphone, email). MINIMISATION : le NIR, l''IBAN et le BIC présents dans l''export ne sont PAS importés.',
        'Service RH, direction ; agrégats non nominatifs pour le reporting',
        'Durée du contrat + prescriptions légales ; anonymisation au rythme de la fiche salarié',
        'Accès restreint ADMIN/RH (import), lecture RH/MANAGER selon rôles, upsert idempotent non destructif, journalisation applicative'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Import du logiciel de paie (contrats, heures, absences, contacts d''urgence)'
      );
    `);

    // ── Item 40 — Recopie des compétences opérationnelles (permis B / CACES)
    // depuis la fiche candidat liée. Ces booléens conditionnent l'affectation
    // « chauffeur » / « cariste » du planning hebdo (planning-hebdo.js) mais
    // n'étaient éditables que sur le candidat et jamais recopiés à la liaison.
    // Backfill idempotent : ne remonte que false→true (ne dégrade jamais une
    // valeur saisie côté RH).
    await client.query(`
      UPDATE employees e SET has_permis_b = true
      FROM candidates c
      WHERE e.candidate_id = c.id AND c.has_permis_b = true AND e.has_permis_b IS DISTINCT FROM true
    `);
    await client.query(`
      UPDATE employees e SET has_caces = true
      FROM candidates c
      WHERE e.candidate_id = c.id AND c.has_caces = true AND e.has_caces IS DISTINCT FROM true
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
        -- NULL = non évalué (pas de DEFAULT : un axe jamais évalué ne vaut pas 1)
        frein_mobilite INTEGER CHECK (frein_mobilite BETWEEN 1 AND 5),
        frein_mobilite_detail TEXT,
        frein_sante INTEGER CHECK (frein_sante BETWEEN 1 AND 5),
        frein_sante_detail TEXT,
        frein_finances INTEGER CHECK (frein_finances BETWEEN 1 AND 5),
        frein_finances_detail TEXT,
        frein_famille INTEGER CHECK (frein_famille BETWEEN 1 AND 5),
        frein_famille_detail TEXT,
        frein_linguistique INTEGER CHECK (frein_linguistique BETWEEN 1 AND 5),
        frein_linguistique_detail TEXT,
        frein_administratif INTEGER CHECK (frein_administratif BETWEEN 1 AND 5),
        frein_administratif_detail TEXT,
        frein_numerique INTEGER CHECK (frein_numerique BETWEEN 1 AND 5),
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
    // NOTE (audit 07/2026) : la table periodic_objectives est créée et possédée
    // par routes/settings.js (schéma domaine/indicateur/valeur_cible/periode/
    // annee/mois — utilisé par le CRUD Settings, le dashboard /objectifs et le
    // scorecard). Un second CREATE incompatible (section/label/target_value/
    // is_active) existait ici et entrait en course avec le premier selon
    // l'ordre de chargement → schéma imprévisible. Supprimé : une seule
    // définition canonique, côté settings.js.
    console.log('[INIT-DB] Module Periodic Objectives → défini dans settings.js');

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
        -- P2-C (reporting DREETS / FSE+) : présents aussi dans la définition
        -- canonique pour qu'une base NEUVE les ait (la migration ALTER plus haut
        -- ne s'applique qu'aux bases existantes — elle tourne avant ce CREATE).
        sortie_employeur_siret VARCHAR(14),
        sortie_duree_contrat_mois SMALLINT CHECK (sortie_duree_contrat_mois IS NULL OR sortie_duree_contrat_mois >= 0),
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

    // ══════════════════════════════════════════════════════════════
    // MIGRATIONS insertion — SOURCE UNIQUE (rapatriées de l'ancienne IIFE
    // d'auto-migration de routes/insertion/index.js, retirée en Vague 3 pour
    // supprimer la double définition du schéma — cause racine du bug 2.3.2
    // « column ... does not exist ». Idempotent : ADD COLUMN IF NOT EXISTS.
    // Sur une base NEUVE, les CREATE TABLE ci-dessus ont déjà toutes ces
    // colonnes → no-op. Sur une base ANCIENNE (créée par un init-db antérieur
    // dont la définition avait divergé), ceci garantit que TOUTES les colonnes
    // écrites par PUT /diagnostic et PUT /milestones existent.
    // Les freins de diagnostics sont rétro-ajoutés SANS CHECK : une colonne
    // recréée ne doit pas rejeter d'anciennes valeurs (le PUT envoie 1-5 ou NULL).
    // ══════════════════════════════════════════════════════════════
    await client.query(`
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS created_by INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS updated_by INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS parcours_anterieur TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS contraintes_sante TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS contraintes_mobilite TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS contraintes_familiales TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS autres_contraintes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_mobilite INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_mobilite_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_mobilite_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_sante INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_sante_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_sante_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_finances INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_finances_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_finances_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_famille INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_famille_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_famille_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_linguistique INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_linguistique_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_linguistique_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_administratif INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_administratif_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_administratif_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_numerique INTEGER;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_numerique_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_numerique_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS obs_taches_realisees TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS obs_points_forts TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS obs_difficultes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS obs_comportement_equipe TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS obs_autonomie_ponctualite TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS pref_aime_faire TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS pref_ne_veut_plus TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS pref_environnement_prefere TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS pref_environnement_eviter TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS pref_objectifs TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS explorama_interets TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS explorama_rejets TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS explorama_gestes_positifs TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS explorama_gestes_negatifs TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS explorama_environnements TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS explorama_rythme TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS cip_hypotheses_metiers TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS cip_questions TEXT;
    `);
    await client.query(`
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS frein_numerique INTEGER CHECK (frein_numerique BETWEEN 1 AND 5);
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS cip_integration TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS cip_competences TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS cip_projet_pro TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS cip_socialisation TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS sortie_classification VARCHAR(20) CHECK (sortie_classification IN ('positive', 'negative'));
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS sortie_type VARCHAR(50);
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS sortie_commentaires TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS sortie_employeur TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS sortie_formation TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS ai_recommendations JSONB;
    `);
    // NB : l'ancien anti-doublon (employee_id, milestone_type) — DELETE des
    // doublons + index unique idx_milestones_emp_type_unique — est RETIRÉ ici :
    // le modèle « entretiens » (migration ci-dessous) autorise volontairement
    // N occurrences d'un même type (bilans intermédiaires, renouvellements,
    // suivis post-sortie). Le DELETE aurait détruit ces occurrences légitimes
    // à chaque démarrage. L'unicité résiduelle (un diagnostic d'accueil et un
    // bilan de sortie par salarié ET par parcours) est garantie par les index
    // uniques PARTIELS créés ci-dessous.

    // ══════════════════════════════════════════════════════════════
    // -- Migration extension entretiens 2026-07 (PR1) --
    // insertion_milestones devient la table des ENTRETIENS du parcours
    // (types requalifiés + occurrences multiples + n° de parcours), le
    // diagnostic est versionné par parcours, et 5 tables satellites sont
    // créées (objectifs, partenaires, PMSMP, satisfaction de sortie,
    // historique probant des entretiens). Tout est idempotent (ADD COLUMN
    // IF NOT EXISTS, DO blocks avec scan pg_constraint — pattern users.role,
    // CREATE TABLE IF NOT EXISTS, seeds gardés).
    // Réf. : rapports/insertion-2026-07-22/05-plan-codage.md §1 + §6bis.
    // ══════════════════════════════════════════════════════════════

    // (a) Nouvelles colonnes insertion_milestones (modèle entretien élargi).
    // Les 2 nouveaux freins (logement / judiciaire) : SANS défaut, CHECK 1-5
    // porté par l'ADD COLUMN (appliqué uniquement si la colonne vient d'être
    // créée — colonnes neuves, aucune ancienne valeur à rejeter).
    await client.query(`
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS titre VARCHAR(120);
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS parcours_num SMALLINT NOT NULL DEFAULT 1;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS previous_milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS previous_review JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS validations JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS ia_preparation JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS ia_preparation_at TIMESTAMP;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES employee_contracts(id) ON DELETE SET NULL;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS renouvellement_form JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS renouvellement_avis VARCHAR(30) CHECK (renouvellement_avis IN ('favorable', 'favorable_reserves', 'defavorable'));
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS renouvellement_duree_mois SMALLINT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS sortie_documents JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS post_sortie_situation VARCHAR(30) CHECK (post_sortie_situation IN ('emploi_durable', 'emploi_transition', 'formation', 'recherche_emploi', 'autre', 'injoignable'));
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS post_sortie_commentaire TEXT;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS remise_salarie JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS fse_sortie JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS frein_logement INTEGER CHECK (frein_logement BETWEEN 1 AND 5);
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS frein_judiciaire INTEGER CHECK (frein_judiciaire BETWEEN 1 AND 5);
    `);

    // (b+c+d) Requalification de milestone_type (5 libellés français figés →
    // 5 types techniques) + fin de l'unicité (employee_id, milestone_type).
    // ORDRE CRITIQUE (prouvé sur base legacy peuplée) :
    //   1. DROP de l'ancien CHECK (nom auto, scan pg_constraint) — sinon les
    //      UPDATE de migration seraient rejetés par la contrainte en place ;
    //   2. DROP de la contrainte UNIQUE(employee_id, milestone_type) et de
    //      l'index idx_milestones_emp_type_unique AVANT les UPDATE : le
    //      renommage FUSIONNE 'Bilan M+3'/'M+6'/'M+10' en un même type
    //      'bilan_intermediaire' → plusieurs lignes (employé, type) identiques,
    //      la clé encore en place ferait échouer l'UPDATE (duplicate key) ;
    //   3. UPDATE de données idempotents (backfill titre AVANT le renommage,
    //      pour conserver le libellé d'origine) ;
    //   4. ADD du nouveau CHECK (gardé par existence) ;
    //   5. index uniques PARTIELS de remplacement (un diagnostic d'accueil et
    //      un bilan de sortie par salarié ET par parcours — bilans
    //      intermédiaires / renouvellements / post-sortie multiples) + index
    //      de consultation.
    // ⚠ Phase B : reprendre les ON CONFLICT (employee_id, milestone_type) de
    // routes.js:267 et engine.js:1551 (la clé n'existe plus).
    // NB filtre du CHECK : marqueur « bilan_intermediaire » choisi sans
    // collision LIKE — dans '%diagnostic_accueil%' le « _ » est un joker
    // 1-caractère qui matcherait AUSSI l'ancien libellé « Diagnostic accueil »
    // (espace), alors que « bilan_intermediaire » n'a aucun équivalent dans
    // l'ancienne contrainte. Le nouveau CHECK est ainsi épargné aux exécutions
    // suivantes (aucun drop/re-add inutile).
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        FOR cname IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'insertion_milestones'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%milestone_type%'
            AND pg_get_constraintdef(oid) NOT ILIKE '%bilan_intermediaire%'
        LOOP
          EXECUTE 'ALTER TABLE insertion_milestones DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
      END $$;
    `);
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        FOR cname IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'insertion_milestones'::regclass AND contype = 'u'
            AND pg_get_constraintdef(oid) ILIKE '%milestone_type%'
        LOOP
          EXECUTE 'ALTER TABLE insertion_milestones DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
      END $$;
    `);
    await client.query('DROP INDEX IF EXISTS idx_milestones_emp_type_unique;');
    await client.query(`
      UPDATE insertion_milestones SET titre = 'Diagnostic d''accueil' WHERE titre IS NULL AND milestone_type = 'Diagnostic accueil';
      UPDATE insertion_milestones SET titre = milestone_type WHERE titre IS NULL AND milestone_type IN ('Bilan M+3', 'Bilan M+6', 'Bilan M+10');
      UPDATE insertion_milestones SET titre = 'Bilan de sortie' WHERE titre IS NULL AND milestone_type = 'Bilan Sortie';
      UPDATE insertion_milestones SET milestone_type = 'diagnostic_accueil' WHERE milestone_type = 'Diagnostic accueil';
      UPDATE insertion_milestones SET milestone_type = 'bilan_intermediaire' WHERE milestone_type IN ('Bilan M+3', 'Bilan M+6', 'Bilan M+10');
      UPDATE insertion_milestones SET milestone_type = 'bilan_sortie' WHERE milestone_type = 'Bilan Sortie';
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'insertion_milestones'::regclass AND conname = 'insertion_milestones_milestone_type_check'
        ) THEN
          ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_milestone_type_check
            CHECK (milestone_type IN ('diagnostic_accueil', 'bilan_intermediaire', 'renouvellement', 'bilan_sortie', 'suivi_post_sortie'));
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_accueil_unique
        ON insertion_milestones(employee_id, parcours_num) WHERE milestone_type = 'diagnostic_accueil';
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_sortie_unique
        ON insertion_milestones(employee_id, parcours_num) WHERE milestone_type = 'bilan_sortie';
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_milestones_emp_due ON insertion_milestones(employee_id, due_date);');

    // (e) Nomenclature des sorties (D8, EXG-06) : le binaire positive/negative
    // devient 4 catégories. L'ancienne valeur est CONSERVÉE dans
    // sortie_classification_legacy, le mapping s'appuie sur sortie_type.
    // Même ordre critique que (b+c) : DROP CHECK → UPDATE → ADD CHECK.
    // L'UPDATE ne touche que les lignes encore en ancien référentiel
    // (WHERE IN positive/negative) → idempotent, legacy jamais écrasé.
    await client.query(`
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS sortie_classification_legacy VARCHAR(20);
    `);
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        FOR cname IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'insertion_milestones'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%sortie_classification%'
            AND pg_get_constraintdef(oid) NOT ILIKE '%emploi_durable%'
        LOOP
          EXECUTE 'ALTER TABLE insertion_milestones DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
      END $$;
    `);
    await client.query(`
      UPDATE insertion_milestones SET
        sortie_classification_legacy = sortie_classification,
        sortie_classification = CASE
          WHEN sortie_type IN ('CDI', 'CDD', 'creation_activite') THEN 'emploi_durable'
          WHEN sortie_type IN ('CDD_court', 'interim') THEN 'emploi_transition'
          WHEN sortie_type IN ('formation', 'autre_IAE') THEN 'sortie_positive'
          WHEN sortie_classification = 'negative' THEN 'autre'
          ELSE 'sortie_positive'
        END
      WHERE sortie_classification IN ('positive', 'negative');
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'insertion_milestones'::regclass AND conname = 'insertion_milestones_sortie_classification_check'
        ) THEN
          ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_sortie_classification_check
            CHECK (sortie_classification IN ('emploi_durable', 'emploi_transition', 'sortie_positive', 'autre'));
        END IF;
      END $$;
    `);

    // (f) Diagnostic refondu (Lot 2) : n° de parcours + rubriques structurées
    // de la trame officielle (logement, droits, santé, budget, mobilité,
    // situation pro, projet pro, expression du salarié, linguistique,
    // situation familiale), 2 nouveaux freins, détail à cases multiples en
    // JSONB (D5), données FSE+ d'entrée (§6bis-1) et statut de saisie du
    // stepper (brouillon repris / complet — §6bis-4).
    // commentaire_sante / frein_sante_detail / frein_sante_causes /
    // frein_judiciaire_detail sont CHIFFRÉS applicativement en couche route
    // (utils/field-crypto.js) — colonnes TEXT ordinaires côté schéma.
    await client.query(`
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS parcours_num SMALLINT NOT NULL DEFAULT 1;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS logement_statut VARCHAR(30) CHECK (logement_statut IN ('locataire_social', 'locataire_prive', 'proprietaire', 'heberge', 'sans_abri'));
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS logement_satisfaction BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS commentaire_logement TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS piece_identite_validite DATE;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS allocataire_caf BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS ressources TEXT[];
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS commentaire_droits TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS mutuelle_statut VARCHAR(30);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS rqth BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS rqth_fin DATE;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS contre_indications BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS suivi_sante BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS commentaire_sante TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS difficultes_financieres BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS credits_en_cours BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS commentaire_budget TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS permis_b_statut VARCHAR(20) CHECK (permis_b_statut IN ('oui', 'non', 'code_en_cours', 'conduite_en_cours'));
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS vehicule BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS moyen_transport TEXT[];
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS commentaire_mobilite TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS autre_employeur BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS autre_employeur_heures NUMERIC(4,1);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS souhait_complement_heures BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS niveau_formation VARCHAR(10);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS metiers_souhaites TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS pret_a_se_former VARCHAR(20);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS cpf_accessible BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS projet_formation TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS emploi_vise TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS emploi_vise_rome VARCHAR(8);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS commentaire_projet TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS attentes_parcours TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS difficultes_exprimees TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS objectifs_exprimes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS aide_souhaitee TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS cecrl_niveau VARCHAR(2);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS commentaire_linguistique TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS situation_familiale VARCHAR(20) CHECK (situation_familiale IN ('marie', 'celibataire', 'en_couple', 'divorce', 'veuf'));
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS nb_enfants SMALLINT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS enfants_a_charge BOOLEAN;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_logement INTEGER CHECK (frein_logement BETWEEN 1 AND 5);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_logement_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_logement_causes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_judiciaire INTEGER CHECK (frein_judiciaire BETWEEN 1 AND 5);
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS frein_judiciaire_detail TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS questionnaire_detail JSONB;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS fse_entree JSONB;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS statut_saisie VARCHAR(15) NOT NULL DEFAULT 'complet' CHECK (statut_saisie IN ('en_cours', 'complet'));

      -- Fin des DEFAULT 1 hérités sur les 7 freins historiques : « non évalué »
      -- se stocke NULL, jamais 1 (revue Codex PR#73). Idempotent.
      ALTER TABLE insertion_diagnostics ALTER COLUMN frein_mobilite DROP DEFAULT;
      ALTER TABLE insertion_diagnostics ALTER COLUMN frein_sante DROP DEFAULT;
      ALTER TABLE insertion_diagnostics ALTER COLUMN frein_finances DROP DEFAULT;
      ALTER TABLE insertion_diagnostics ALTER COLUMN frein_famille DROP DEFAULT;
      ALTER TABLE insertion_diagnostics ALTER COLUMN frein_linguistique DROP DEFAULT;
      ALTER TABLE insertion_diagnostics ALTER COLUMN frein_administratif DROP DEFAULT;
      ALTER TABLE insertion_diagnostics ALTER COLUMN frein_numerique DROP DEFAULT;

      -- Réparation des squelettes pollués par ces DEFAULT (diagnostic créé au
      -- link-employee sans passage CIP : updated_by NULL et les 7 axes à 1).
      -- Ces « 1 » ne sont pas des évaluations → remis à NULL. Une fiche
      -- réellement évaluée porte updated_by (posé par le PUT) et est exclue.
      UPDATE insertion_diagnostics
      SET frein_mobilite = NULL, frein_sante = NULL, frein_finances = NULL,
          frein_famille = NULL, frein_linguistique = NULL,
          frein_administratif = NULL, frein_numerique = NULL
      WHERE updated_by IS NULL
        AND frein_mobilite = 1 AND frein_sante = 1 AND frein_finances = 1
        AND frein_famille = 1 AND frein_linguistique = 1
        AND frein_administratif = 1 AND frein_numerique = 1;
    `);
    // Un diagnostic PAR PARCOURS : UNIQUE(employee_id) → UNIQUE(employee_id,
    // parcours_num). ⚠ Phase B : le PUT /diagnostic fait ON CONFLICT
    // (employee_id) (routes.js:175) et le squelette de link-employee aussi
    // (conversion.js:128-133) — à reprendre en ON CONFLICT (employee_id, parcours_num).
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        FOR cname IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'insertion_diagnostics'::regclass AND contype = 'u'
            AND pg_get_constraintdef(oid) NOT ILIKE '%parcours_num%'
        LOOP
          EXECUTE 'ALTER TABLE insertion_diagnostics DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'insertion_diagnostics'::regclass AND conname = 'insertion_diagnostics_employee_parcours_key'
        ) THEN
          ALTER TABLE insertion_diagnostics
            ADD CONSTRAINT insertion_diagnostics_employee_parcours_key UNIQUE (employee_id, parcours_num);
        END IF;
      END $$;
    `);

    // (g) employees — conformité IAE : Pass IAE (n°, période), dérogation de
    // prolongation CDDI (motifs légaux), critères d'éligibilité (texte +
    // LOCALISATION des justificatifs, jamais les pièces), identifiant France
    // Travail, n° de parcours courant.
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS pass_iae_number VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS pass_iae_start DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS pass_iae_end DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS cddi_derogation_motif VARCHAR(30) CHECK (cddi_derogation_motif IN ('formation_en_cours', 'senior_50', 'rqth', 'cdi_inclusion'));
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS cddi_derogation_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS eligibilite_criteres TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS eligibilite_justificatifs_ref TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS france_travail_id VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS parcours_num SMALLINT NOT NULL DEFAULT 1;
    `);

    // (h) candidates — PROP-02 : prescripteur structuré + Pass IAE +
    // éligibilité saisis dès le recrutement, recopiés vers employees au
    // link-employee (phase B). prescripteur_orgas est créée plus haut → FK sûre.
    await client.query(`
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS prescripteur_id INTEGER REFERENCES prescripteur_orgas(id) ON DELETE SET NULL;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pass_iae_number VARCHAR(30);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pass_iae_start DATE;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pass_iae_end DATE;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS eligibilite_criteres TEXT;
    `);

    // (j) Tables satellites du parcours (Lots 3-4 + §6bis-4).
    // Objectifs individualisés (avec sous-objectifs via parent_id).
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_objectifs (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES insertion_objectifs(id) ON DELETE CASCADE,
        milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL,
        titre VARCHAR(200) NOT NULL,
        description TEXT,
        origine VARCHAR(10) NOT NULL DEFAULT 'cip' CHECK (origine IN ('salarie', 'cip')),
        echeance DATE,
        date_butoir DATE,
        statut VARCHAR(25) NOT NULL DEFAULT 'en_cours'
          CHECK (statut IN ('a_venir', 'en_cours', 'atteint', 'partiellement_atteint', 'abandonne', 'reporte')),
        ordre SMALLINT NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_objectifs_employee ON insertion_objectifs(employee_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_objectifs_parent ON insertion_objectifs(parent_id);');

    // Référentiel des partenaires mobilisables par les actions CIP.
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_partenaires (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(150) NOT NULL UNIQUE,
        categorie VARCHAR(30),
        contact_nom VARCHAR(120),
        contact_tel VARCHAR(30),
        contact_email VARCHAR(150),
        actif BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // PMSMP — périodes de mise en situation en milieu professionnel (EXG-05).
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_pmsmp (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        entreprise VARCHAR(200) NOT NULL,
        siret VARCHAR(14),
        objet VARCHAR(30) NOT NULL CHECK (objet IN ('decouvrir_metier', 'confirmer_projet', 'initier_recrutement')),
        date_debut DATE NOT NULL,
        date_fin DATE NOT NULL,
        tuteur VARCHAR(120),
        bilan TEXT,
        saisie_outil_officiel BOOLEAN NOT NULL DEFAULT false,
        convention_ref VARCHAR(60),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_pmsmp_employee ON insertion_pmsmp(employee_id);');

    // Questionnaire de satisfaction de sortie — UNE réponse par salarié ET
    // par parcours (§6bis-4 : parcours_num remplace l'unicité simple du plan).
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_satisfaction_sortie (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        parcours_num SMALLINT NOT NULL DEFAULT 1,
        milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL,
        date_reponse DATE,
        reponses JSONB NOT NULL DEFAULT '{}'::jsonb,
        situation_sortie VARCHAR(30),
        satisfaction_globale SMALLINT CHECK (satisfaction_globale BETWEEN 1 AND 4),
        suggestions TEXT,
        avis_transmis TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, parcours_num)
      );
    `);

    // Historique probant des entretiens (verrouillage/réouverture tracés —
    // §6bis-4, pattern refashion_dpav_history : snapshot JSONB par action).
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_milestones_history (
        id SERIAL PRIMARY KEY,
        milestone_id INTEGER NOT NULL REFERENCES insertion_milestones(id) ON DELETE CASCADE,
        snapshot JSONB NOT NULL,
        action VARCHAR(20) NOT NULL CHECK (action IN ('update', 'close', 'reopen')),
        changed_by INTEGER REFERENCES users(id),
        changed_at TIMESTAMP DEFAULT NOW(),
        motif TEXT
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_ms_history_milestone ON insertion_milestones_history(milestone_id, changed_at DESC);');

    // (i) cip_action_plans : action possible HORS entretien (milestone_id
    // devient nullable — DROP NOT NULL est nativement idempotent), rattachable
    // à un objectif et à un partenaire (FK déclarées APRÈS la création des
    // tables ci-dessus), résultat, durée passée (§6bis-4), auteur.
    await client.query('ALTER TABLE cip_action_plans ALTER COLUMN milestone_id DROP NOT NULL;');
    await client.query(`
      ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS objectif_id INTEGER REFERENCES insertion_objectifs(id) ON DELETE SET NULL;
      ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS partenaire_id INTEGER REFERENCES insertion_partenaires(id) ON DELETE SET NULL;
      ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS resultat TEXT;
      ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS duree_minutes INTEGER;
      ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
    `);

    // (k) Seed idempotent du référentiel partenaires (ON CONFLICT (nom) DO
    // NOTHING — un partenaire renommé/complété par l'utilisateur n'est jamais
    // écrasé). Catégories : administratif, emploi, logement, sante, justice,
    // formation, mobilite, autre.
    await client.query(`
      INSERT INTO insertion_partenaires (nom, categorie) VALUES
        ('CAF', 'administratif'),
        ('France Travail', 'emploi'),
        ('CPAM', 'sante'),
        ('ANTS', 'administratif'),
        ('SOLIHA', 'logement'),
        ('Action Logement', 'logement'),
        ('Bailleur social', 'logement'),
        ('OPCO', 'formation'),
        ('Mission locale', 'emploi'),
        ('Département 76', 'administratif'),
        ('Centre des finances publiques', 'administratif'),
        ('Banque de France', 'autre'),
        ('Organisme de formation', 'formation'),
        ('Auto-école sociale', 'mobilite'),
        ('SPIP', 'justice'),
        ('Avocat / aide juridictionnelle', 'justice')
      ON CONFLICT (nom) DO NOTHING;
    `);

    // (l) Registre RGPD (art. 30) — traitement « accompagnement
    // socio-professionnel » : couvre les données art. 9 (santé) et art. 10
    // (judiciaire) du diagnostic/des entretiens. Idempotent (WHERE NOT EXISTS,
    // même pattern que les seeds QHSE / sous-traitance IA plus bas).
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Accompagnement socio-professionnel des salariés en insertion',
        'Suivi individualisé du parcours d''insertion (conventionnement IAE) : diagnostic socio-professionnel d''accueil, entretiens et bilans périodiques, évaluation des freins périphériques (9 axes), objectifs et plans d''action d''accompagnement, périodes d''immersion (PMSMP), renouvellements de contrat, bilan et suivi post-sortie, questionnaire de satisfaction ; entretien de période d''essai et checklist d''embauche (continuité recrutement), évaluations de compétences métier par l''encadrant technique et co-construction du projet (SWOT, portefeuille de compétences, style d''apprentissage) ; reporting réglementaire agrégé (DREETS/ASP, FSE+, financeurs).',
        'Obligation légale et mission d''intérêt public (IAE, art. L5132-1 s. Code du travail)',
        'Salariés en parcours d''insertion (CDDI) et candidats liés',
        'Identité et situation socio-professionnelle, freins périphériques (scores 1-5 et observations), dont : données de SANTÉ (art. 9 RGPD — commentaires chiffrés applicativement, aucun diagnostic médical) et données JUDICIAIRES (art. 10 RGPD — niveau de frein et impact organisationnel factuel uniquement, détail chiffré), logement, ressources/budget, mobilité, situation familiale, formation et projet professionnel, Pass IAE, données FSE+ (entrée/sortie), grilles de compétences métier (notes /10 évaluées par l''encadrant technique, sans donnée sensible), portefeuille de compétences, style d''apprentissage et checklist d''embauche',
        'CIP et service RH (nominatif), direction ; agrégats NON nominatifs uniquement : financeurs et comités de pilotage (DREETS, FSE+, convention)',
        'Parcours + 24 mois après dernier contact (anonymisation) ; FSE+ : piste d''audit séparée >= 5 ans',
        'Chiffrement applicatif AES-256 des champs santé/judiciaire (utils/field-crypto.js), masquage par rôle (MANAGER sans accès aux données sensibles), accès restreint ADMIN/RH pour l''écriture, pseudonymisation systématique avant tout appel IA (utils/pii-pseudonymize.js), journalisation applicative des consultations et exports ; champs FSE+ exclus de l''anonymisation à 2 ans (piste d''audit >= 5 ans après dernier paiement, archivage à accès restreint — à inscrire à l''AIPD)'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Accompagnement socio-professionnel des salariés en insertion'
      );
    `);

    // (m — phase B) Alertes Pass IAE : élargit le CHECK alert_type de
    // insertion_interview_alerts (pass_iae_7m / pass_iae_2m — job scheduler
    // checkPassIaeExpiring). Même pattern DROP-scan + ADD gardé ; le marqueur
    // 'pass_iae_7m' épargne le nouveau CHECK aux exécutions suivantes.
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        FOR cname IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'insertion_interview_alerts'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%alert_type%'
            AND pg_get_constraintdef(oid) NOT ILIKE '%pass_iae_7m%'
        LOOP
          EXECUTE 'ALTER TABLE insertion_interview_alerts DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'insertion_interview_alerts'::regclass AND conname = 'insertion_interview_alerts_alert_type_check'
        ) THEN
          ALTER TABLE insertion_interview_alerts ADD CONSTRAINT insertion_interview_alerts_alert_type_check
            CHECK (alert_type IN ('planification', 'rappel_j7', 'rappel_j1', 'retard', 'pass_iae_7m', 'pass_iae_2m'));
        END IF;
      END $$;
    `);

    // (n — phase D) Acquittements d'alertes de la fiche salarié (« Vu — me le
    // rappeler dans N jours ») : journalisés en base au lieu du localStorage
    // navigateur — partagés entre CIP et audités. Une ligne = un type d'alerte
    // mis en veille jusqu'à acked_until pour un salarié ; GET /insertion/
    // alertes/:employeeId filtre les acquittements non expirés.
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_alert_acks (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        alert_type VARCHAR(40) NOT NULL,
        acked_by INTEGER REFERENCES users(id),
        acked_until TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_alert_acks_emp ON insertion_alert_acks(employee_id, alert_type, acked_until DESC);');

    console.log('[INIT-DB] Migration extension entretiens 2026-07 (PR1) ✓');

    // ══════════════════════════════════════════════════════════════
    // -- Migration Lot 8 — espace encadrant technique, co-construction et
    //    continuité recrutement (2026-07 PR3) --
    // Couvre EXG-26 (grilles de compétences par filière, administrables),
    // EXG-27 (volet accompagnement social/professionnel noté, N/E hors moyenne),
    // EXG-28 (SWOT / besoins / COA), EXG-32 (portefeuille de compétences, CECRL,
    // style d'apprentissage Kolb) et EXG-30/PROP-03/PROP-05 (entretien de
    // période d'essai + checklist d'embauche). Tout idempotent (ADD COLUMN IF
    // NOT EXISTS, CREATE TABLE IF NOT EXISTS, DO block scan pg_constraint pour le
    // CHECK milestone_type élargi, seeds gardés ON CONFLICT DO NOTHING).
    // ══════════════════════════════════════════════════════════════

    // (8a) insertion_milestones — type 'periode_essai' ajouté au CHECK +
    // formulaire/décision de période d'essai. Même pattern DROP-scan + ADD gardé
    // que le CHECK d'origine : le marqueur 'periode_essai' épargne le nouveau
    // CHECK aux exécutions suivantes. ORDRE : le bloc PR1 (plus haut) crée le
    // CHECK à 5 valeurs (base neuve) ; ce bloc l'élargit à 6 valeurs. Sur base
    // déjà migrée, le DROP-scan PR1 (« NOT ILIKE bilan_intermediaire ») laisse
    // en place le CHECK à 6 valeurs (il contient bilan_intermediaire), et son
    // ADD gardé ne recrée rien (contrainte déjà nommée).
    await client.query(`
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS periode_essai_form JSONB;
      ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS periode_essai_decision VARCHAR(20) CHECK (periode_essai_decision IN ('confirme', 'rompu', 'a_revoir'));
    `);
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        FOR cname IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'insertion_milestones'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%milestone_type%'
            AND pg_get_constraintdef(oid) NOT ILIKE '%periode_essai%'
        LOOP
          EXECUTE 'ALTER TABLE insertion_milestones DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'insertion_milestones'::regclass AND conname = 'insertion_milestones_milestone_type_check'
        ) THEN
          ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_milestone_type_check
            CHECK (milestone_type IN ('diagnostic_accueil', 'bilan_intermediaire', 'renouvellement', 'bilan_sortie', 'suivi_post_sortie', 'periode_essai'));
        END IF;
      END $$;
    `);

    // (8b) insertion_diagnostics — co-construction : SWOT d'entrée (EXG-28),
    // besoins exprimés, COA ; portefeuille de compétences + savoir-faire/être
    // + style d'apprentissage Kolb (EXG-32 ; cecrl_niveau existe déjà PR1).
    // Champs NON sensibles → visibles ETI (aucun ajout à MANAGER_HIDDEN_FIELDS).
    await client.query(`
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS swot_atouts TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS swot_faiblesses TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS swot_opportunites TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS swot_menaces TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS besoins_exprimes TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS coa_texte TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS portefeuille_interets JSONB;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS portefeuille_competences JSONB;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS savoir_faire TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS savoir_etre TEXT;
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS style_apprentissage VARCHAR(20) CHECK (style_apprentissage IN ('adaptateur', 'divergeur', 'assimilateur', 'convergeur'));
      ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS style_apprentissage_reponses JSONB;
    `);

    // (8c) Grilles de compétences ADMINISTRABLES par filière (EXG-26/27).
    // Référentiel = items (rubrique + item) par filière ; UNIQUE(filiere,
    // rubrique, item) pour un seed idempotent. Les 4 filières ST (tri, collecte,
    // logistique, boutique) + 'transverse' (comportement / accompagnement).
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_competence_referentiels (
        id SERIAL PRIMARY KEY,
        filiere VARCHAR(20) NOT NULL CHECK (filiere IN ('tri', 'collecte', 'logistique', 'boutique', 'transverse')),
        rubrique VARCHAR(120) NOT NULL,
        item VARCHAR(200) NOT NULL,
        ordre SMALLINT NOT NULL DEFAULT 0,
        actif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(filiere, rubrique, item)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_competence_referentiels_filiere ON insertion_competence_referentiels(filiere, actif);');

    // Évaluations périodiques (par tranches 1-6 / 6-12 / 12-18 / 18-24 mois),
    // saisies par l'ETI, triple validation (salarié/ETI/CIP) en JSONB horodaté.
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_competence_evaluations (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        parcours_num SMALLINT NOT NULL DEFAULT 1,
        filiere VARCHAR(20),
        periode VARCHAR(20),
        date_evaluation DATE,
        evaluateur_id INTEGER REFERENCES users(id),
        statut VARCHAR(15) NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
        validations JSONB,
        synthese TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_competence_eval_employee ON insertion_competence_evaluations(employee_id, parcours_num);');

    // Notes /10 ou N/E (non_evalue) par item ; rubrique/item SNAPSHOT dénormalisé
    // pour résister à la suppression d'un item du référentiel (FK SET NULL).
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_competence_scores (
        id SERIAL PRIMARY KEY,
        evaluation_id INTEGER NOT NULL REFERENCES insertion_competence_evaluations(id) ON DELETE CASCADE,
        referentiel_id INTEGER REFERENCES insertion_competence_referentiels(id) ON DELETE SET NULL,
        rubrique VARCHAR(120),
        item VARCHAR(200),
        note SMALLINT CHECK (note BETWEEN 0 AND 10),
        non_evalue BOOLEAN NOT NULL DEFAULT false,
        observation TEXT,
        objectif TEXT
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_competence_scores_eval ON insertion_competence_scores(evaluation_id);');

    // Seed idempotent d'un jeu de départ ADMINISTRABLE (éditable ensuite). Un
    // item renommé/désactivé par l'utilisateur n'est jamais réécrit (ON CONFLICT
    // (filiere, rubrique, item) DO NOTHING). Rubrique « Comportement » commune +
    // volet « Accompagnement social et professionnel » (EXG-27) en transverse ;
    // activités métier par filière.
    await client.query(`
      INSERT INTO insertion_competence_referentiels (filiere, rubrique, item, ordre) VALUES
        ('transverse', 'Comportement', 'Assiduité', 1),
        ('transverse', 'Comportement', 'Ponctualité', 2),
        ('transverse', 'Comportement', 'Respect des consignes', 3),
        ('transverse', 'Comportement', 'Respect des règles de sécurité', 4),
        ('transverse', 'Comportement', 'Intégration dans l''équipe', 5),
        ('transverse', 'Comportement', 'Communication', 6),
        ('transverse', 'Comportement', 'Autonomie au poste', 7),
        ('transverse', 'Accompagnement social et professionnel', 'Assiduité aux rendez-vous', 1),
        ('transverse', 'Accompagnement social et professionnel', 'Autonomie dans les démarches', 2),
        ('transverse', 'Accompagnement social et professionnel', 'Compétences informatiques / numériques', 3),
        ('transverse', 'Accompagnement social et professionnel', 'Intérêt pour le projet professionnel', 4),
        ('transverse', 'Accompagnement social et professionnel', 'CV / lettre de motivation / TRE', 5),
        ('transverse', 'Accompagnement social et professionnel', 'Enquêtes métiers', 6),
        ('transverse', 'Accompagnement social et professionnel', 'PMSMP réalisée(s)', 7),
        ('tri', 'Activités métier', 'Ouverture des sacs / craquage', 1),
        ('tri', 'Activités métier', 'Tri par catégorie et qualité', 2),
        ('tri', 'Activités métier', 'Cadence de tri', 3),
        ('tri', 'Activités métier', 'Reconnaissance des matières textiles', 4),
        ('tri', 'Activités métier', 'Conditionnement / mise en balle', 5),
        ('collecte', 'Activités métier', 'Conduite et sécurité du véhicule', 1),
        ('collecte', 'Activités métier', 'Manutention et port de charges', 2),
        ('collecte', 'Activités métier', 'Vidage des points d''apport (CAV)', 3),
        ('collecte', 'Activités métier', 'Tenue de la feuille de tournée', 4),
        ('collecte', 'Activités métier', 'Relation avec les partenaires / usagers', 5),
        ('logistique', 'Activités métier', 'Réception et contrôle des flux', 1),
        ('logistique', 'Activités métier', 'Préparation de commandes', 2),
        ('logistique', 'Activités métier', 'Gestion et rangement du stock', 3),
        ('logistique', 'Activités métier', 'Utilisation des engins (transpalette / CACES)', 4),
        ('logistique', 'Activités métier', 'Étiquetage et traçabilité', 5),
        ('boutique', 'Activités métier', 'Accueil et relation client', 1),
        ('boutique', 'Activités métier', 'Tenue de caisse', 2),
        ('boutique', 'Activités métier', 'Mise en rayon et merchandising', 3),
        ('boutique', 'Activités métier', 'Étiquetage et valorisation des produits', 4),
        ('boutique', 'Activités métier', 'Gestion des stocks boutique', 5)
      ON CONFLICT (filiere, rubrique, item) DO NOTHING;
    `);

    // (8d) Checklist d'embauche (EXG-30 / PROP-05) — une par salarié, items en
    // JSONB (promesse_embauche, contrat_signe, mutuelle, charte_insertion,
    // livret_accueil, reglement_interieur, formation_poste), chacun
    // { fait, date, responsable }. Pas de moteur d'état (ERP léger).
    await client.query(`
      CREATE TABLE IF NOT EXISTS insertion_checklist_embauche (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
        items JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("[INIT-DB] Migration Lot 8 — encadrant / co-construction / période d'essai (PR3) ✓");

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

    // Niveau 2.8 : contrats d'entretien véhicule (prestataire externe)
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_maintenance_contracts (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        prestataire VARCHAR(150) NOT NULL,
        type_contrat VARCHAR(20) NOT NULL DEFAULT 'partiel'
          CHECK (type_contrat IN ('full', 'partiel')),
        debut DATE NOT NULL,
        fin DATE NOT NULL,
        tarif_mensuel_eur DECIMAL(10,2),
        operations_incluses TEXT[],
        contact_nom VARCHAR(150),
        contact_telephone VARCHAR(30),
        contact_email VARCHAR(150),
        document_path VARCHAR(500),
        notes TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_maint_contracts_vehicle ON vehicle_maintenance_contracts(vehicle_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_maint_contracts_active ON vehicle_maintenance_contracts(active);');

    console.log('[INIT-DB] Module Maintenance Véhicules ✓');

    // ══════════════════════════════════════════
    // MODULE : Capteurs ultrasons CAV (LoRaWAN - Milesight EM400-MUD / Orange Live Objects)
    // ══════════════════════════════════════════
    await client.query(`
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_reference VARCHAR(100);
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_type VARCHAR(50) DEFAULT 'ultrasonic';
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_last_reading DOUBLE PRECISION;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_last_reading_at TIMESTAMP;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS lora_deveui VARCHAR(23);
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS lora_appeui VARCHAR(23);
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS lora_appkey_encrypted TEXT;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_height_cm INTEGER;
      -- Calibration deux points (10/07/2026) : distance sonde→textile quand le CAV est PLEIN
      -- (zone morte / niveau de collecte, typ. 25–45 cm). NULL = modèle mono-point historique
      -- (plein = distance 0). Permet à un CAV réellement plein d'atteindre 100 % au lieu de
      -- plafonner artificiellement (cf. remplissage figé ~85 %). Cf. utils/milesight-em400mud.js.
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_distance_full_cm INTEGER;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_install_date DATE;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_reporting_interval_min INTEGER DEFAULT 180;
      -- Migration 15/05/2026 : alignement défaut 360 → 180 min (cf. paramétrage Milesight EM400-MUD)
      -- Ne touche que les CAV laissés à l'ancien défaut, préserve les valeurs personnalisées.
      UPDATE cav SET sensor_reporting_interval_min = 180 WHERE sensor_reporting_interval_min = 360;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_status VARCHAR(20) DEFAULT 'inactive';
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_battery_level DOUBLE PRECISION;
      ALTER TABLE cav ADD COLUMN IF NOT EXISTS sensor_last_rssi INTEGER;
    `);
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_cav_lora_deveui ON cav(lora_deveui) WHERE lora_deveui IS NOT NULL;');

    await client.query(`
      CREATE TABLE IF NOT EXISTS cav_sensor_readings (
        id SERIAL PRIMARY KEY,
        cav_id INTEGER NOT NULL REFERENCES cav(id) ON DELETE CASCADE,
        sensor_reference VARCHAR(100) NOT NULL,
        fill_level_percent DOUBLE PRECISION NOT NULL CHECK (fill_level_percent BETWEEN 0 AND 120),
        distance_cm DOUBLE PRECISION,
        battery_level DOUBLE PRECISION,
        temperature DOUBLE PRECISION,
        rssi INTEGER,
        snr DOUBLE PRECISION,
        sf SMALLINT,
        fport SMALLINT,
        fcnt INTEGER,
        tilt_detected BOOLEAN DEFAULT false,
        alarm_type VARCHAR(30),
        raw_data JSONB,
        reading_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_sensor_readings_cav ON cav_sensor_readings(cav_id, reading_at DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sensor_readings_ref ON cav_sensor_readings(sensor_reference);');
    // Anti-doublon : un uplink LoRaWAN identifié par (cav_id, fcnt) ne doit être stocké
    // qu'une fois, même si webhook HTTP + MQTT sont actifs en parallèle. Index partiel
    // (fcnt peut être NULL pour les payloads aplatis via /api/cav/sensor-reading).
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_sensor_readings_cav_fcnt ON cav_sensor_readings(cav_id, fcnt) WHERE fcnt IS NOT NULL;');

    // Table des alertes capteur (cycle de vie trigger → ack → résolution)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cav_sensor_alerts (
        id SERIAL PRIMARY KEY,
        cav_id INTEGER NOT NULL REFERENCES cav(id) ON DELETE CASCADE,
        reading_id INTEGER REFERENCES cav_sensor_readings(id) ON DELETE SET NULL,
        alert_type VARCHAR(30) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'warning',
        message TEXT,
        triggered_at TIMESTAMP NOT NULL DEFAULT NOW(),
        acknowledged_at TIMESTAMP,
        acknowledged_by INTEGER REFERENCES users(id),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_sensor_alerts_cav_open ON cav_sensor_alerts(cav_id) WHERE resolved_at IS NULL;');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sensor_alerts_type ON cav_sensor_alerts(alert_type, triggered_at DESC);');

    console.log('[INIT-DB] Module Capteurs CAV (LoRaWAN Milesight) ✓');

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
      // V1.7+ : clôture de journée (manager valide en fin de journée)
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL",
      "ALTER TABLE production_daily ADD COLUMN IF NOT EXISTS validation_comment TEXT",
    ];
    for (const sql of prodDailyMigrations) {
      try { await client.query(sql); } catch(e) { /* colonne existe déjà */ }
    }

    // Objectifs de production (trimestriel = entrée matière, mensuel = répartition tri)
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_objectives (
        id SERIAL PRIMARY KEY,
        period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('trimestriel', 'mensuel')),
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        type VARCHAR(40) NOT NULL,
        value_kg DOUBLE PRECISION,
        value_pct DOUBLE PRECISION,
        alert_threshold_pct DOUBLE PRECISION,
        commentaire TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (period_type, period_start, type)
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_prod_obj_period ON production_objectives(period_start, period_end)");

    // Consignes du directeur (durée variable : un jour ou une plage)
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_consignes (
        id SERIAL PRIMARY KEY,
        date_start DATE NOT NULL,
        date_end DATE NOT NULL,
        message TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_prod_consignes_dates ON production_consignes(date_start, date_end)");

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

    // ══════════════════════════════════════════
    // MODULE : Collecte Association
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS association_points (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500),
        complement_adresse VARCHAR(255),
        code_postal VARCHAR(10),
        ville VARCHAR(100),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        geom GEOMETRY(Point, 4326),
        contact_phone VARCHAR(50),
        contact_info TEXT,
        avg_fill_rate DOUBLE PRECISION DEFAULT 0,
        status VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'temporairement_indisponible')),
        unavailable_reason TEXT,
        unavailable_since DATE,
        route_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_association_points_geom ON association_points USING GIST(geom);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_association_points_status ON association_points(status);');

    // Table de jonction tournée ↔ point association (parallèle à tour_cav)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tour_association_point (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
        association_point_id INTEGER REFERENCES association_points(id),
        position INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending'
          CHECK (status IN ('pending', 'collected', 'skipped', 'incident')),
        fill_level INTEGER CHECK (fill_level BETWEEN 0 AND 5),
        collected_at TIMESTAMP,
        notes TEXT
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_tour_assoc_tour ON tour_association_point(tour_id);');
    await client.query(`
      ALTER TABLE tour_association_point ADD COLUMN IF NOT EXISTS planned_passage_time TIMESTAMP;
    `);
    // Mobile collecte : remballe + photo d'audit (cf. commentaire vers tour_cav
    // plus haut). Places ICI, apres le CREATE TABLE — jamais avant.
    await client.query(`
      ALTER TABLE tour_association_point ADD COLUMN IF NOT EXISTS remballe BOOLEAN DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE tour_association_point ADD COLUMN IF NOT EXISTS photo_path VARCHAR(500);
    `);

    // Route standard association (jonction route ↔ points association)
    await client.query(`
      CREATE TABLE IF NOT EXISTS standard_route_association (
        id SERIAL PRIMARY KEY,
        route_id INTEGER REFERENCES standard_routes(id) ON DELETE CASCADE,
        association_point_id INTEGER REFERENCES association_points(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        UNIQUE(route_id, association_point_id)
      );
    `);

    // Historique tonnages association (parallèle à tonnage_history)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tonnage_history_association (
        id SERIAL PRIMARY KEY,
        association_point_id INTEGER REFERENCES association_points(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        weight_kg DOUBLE PRECISION NOT NULL,
        tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
        route_name VARCHAR(100),
        source VARCHAR(20) DEFAULT 'manual',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_tonnage_assoc_point ON tonnage_history_association(association_point_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_tonnage_assoc_date ON tonnage_history_association(date DESC);');

    // ML feedback association (parallèle à collection_learning_feedback)
    await client.query(`
      CREATE TABLE IF NOT EXISTS association_learning_feedback (
        id SERIAL PRIMARY KEY,
        tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
        association_point_id INTEGER REFERENCES association_points(id) ON DELETE CASCADE,
        predicted_fill_rate DOUBLE PRECISION NOT NULL,
        observed_fill_level INTEGER CHECK (observed_fill_level BETWEEN 0 AND 5),
        predicted_weight_kg DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migration : ajouter collection_type aux tours
    await client.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS collection_type VARCHAR(20) DEFAULT 'pav' CHECK (collection_type IN ('pav', 'association'))`);

    // Migration : ajouter origine_type aux stock_movements
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS origine_type VARCHAR(20) DEFAULT 'pav' CHECK (origine_type IN ('pav', 'association'))`);

    console.log('[INIT-DB] Module Collecte Association ✓');

    // ══════════════════════════════════════════
    // MODULE : Stock Original (Inventaire matière brute collectée)
    // ══════════════════════════════════════════

    // Table principale des mouvements de stock original
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_original_movements (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL CHECK (type IN ('entree', 'sortie', 'regularisation')),
        date DATE NOT NULL,
        poids_kg DOUBLE PRECISION NOT NULL,
        poids_brut_kg DOUBLE PRECISION,
        tare_kg DOUBLE PRECISION,
        origine VARCHAR(50),
        destination VARCHAR(255),
        notes TEXT,
        motif TEXT,
        tour_id INTEGER REFERENCES tours(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        batch_id INTEGER,
        expedition_id INTEGER,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_original_date ON stock_original_movements(date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_original_type ON stock_original_movements(type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_original_tour ON stock_original_movements(tour_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_original_batch ON stock_original_movements(batch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_original_expedition ON stock_original_movements(expedition_id)`);

    // Verrouillage trimestriel (déclarations Refashion)
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_period_locks (
        id SERIAL PRIMARY KEY,
        year INTEGER NOT NULL,
        quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
        locked_at TIMESTAMP DEFAULT NOW(),
        locked_by INTEGER REFERENCES users(id),
        notes TEXT,
        UNIQUE(year, quarter)
      )
    `);

    // Audit trail des modifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_original_audit (
        id SERIAL PRIMARY KEY,
        movement_id INTEGER REFERENCES stock_original_movements(id) ON DELETE SET NULL,
        action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
        field_name VARCHAR(50),
        old_value TEXT,
        new_value TEXT,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_original_audit_movement ON stock_original_audit(movement_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_original_audit_created ON stock_original_audit(created_at DESC)`);

    console.log('[INIT-DB] Module Stock Original ✓');

    // ══════════════════════════════════════════
    // Migration : champs balance sur stock_original_movements
    // ══════════════════════════════════════════
    await client.query(`
      ALTER TABLE stock_original_movements ADD COLUMN IF NOT EXISTS contenant VARCHAR(100);
    `);
    await client.query(`
      ALTER TABLE stock_original_movements ADD COLUMN IF NOT EXISTS source VARCHAR(50);
    `);
    console.log('[INIT-DB] Migration balance (contenant, source) ✓');

    // ══════════════════════════════════════════
    // VAGUE 1 — Lot Stock & produits finis (items 29-32)
    //   . Poste balance (jeton kiosque) + traçabilité poste
    //   . Régularisation d'inventaire (lien mouvement → inventaire)
    //   . Correction auditée des mouvements (contre-écriture liée)
    //   . Sortie carton → stock (lien mouvement → produit fini)
    //   . Source de création des produits finis (3 voies)
    // Placé ici car toutes les tables référencées existent déjà
    // (stock_movements, produits_finis, inventory_batches, stock_original_movements).
    // ══════════════════════════════════════════
    // pgcrypto requis pour gen_random_bytes (jeton de poste) — idempotent, la
    // création « officielle » plus loin reste sans effet (IF NOT EXISTS).
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Poste de balance : jeton d'accès au kiosque public /balance/:token
    // (même logique que vehicles.qr_token — 1 URL = 1 poste, révocable).
    await client.query(`
      CREATE TABLE IF NOT EXISTS postes_balance (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(80) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    const posteBalExist = await client.query('SELECT id FROM postes_balance LIMIT 1');
    if (posteBalExist.rows.length === 0) {
      const seedToken = require('crypto').randomBytes(16).toString('hex');
      await client.query(
        `INSERT INTO postes_balance (nom, token) VALUES ('Balance principale', $1)`,
        [seedToken]
      );
      // Log unique (à la création seulement) pour que l'ops récupère l'URL kiosque.
      console.log(`[INIT-DB] Poste balance créé — URL kiosque à paramétrer une fois : /balance/${seedToken}`);
    }

    // produits_finis : source de création (etiquette / manuel / balance) + poste balance
    await client.query(`ALTER TABLE produits_finis ADD COLUMN IF NOT EXISTS source VARCHAR(20)`);
    await client.query(`ALTER TABLE produits_finis ADD COLUMN IF NOT EXISTS poste_balance_id INTEGER REFERENCES postes_balance(id) ON DELETE SET NULL`);

    // stock_movements : updated_at (manquait — utilisé par controles-pesee),
    // lien inventaire (régularisation) + lien produit fini (sortie carton) +
    // contre-écriture (correction auditée, pattern comptable).
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS inventory_batch_id INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS produit_fini_id INTEGER REFERENCES produits_finis(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reversed_of_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reversal_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reversal_reason TEXT`);
    await client.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_inventory ON stock_movements(inventory_batch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_produit_fini ON stock_movements(produit_fini_id)`);

    // stock_original_movements : identité du poste balance sur les écritures kiosque
    await client.query(`ALTER TABLE stock_original_movements ADD COLUMN IF NOT EXISTS poste_balance_id INTEGER REFERENCES postes_balance(id) ON DELETE SET NULL`);

    // inventory_items : drapeau « compté » explicite (item 29). Distingue sans
    // ambiguïté une ligne réellement saisie (compté, y compris 0) d'une ligne non
    // comptée → seules les lignes comptées avec écart sont régularisées à la
    // validation, jamais les non-comptées (évite d'effacer du stock à tort).
    await client.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS counted BOOLEAN DEFAULT false`);
    // Sécurité rétro : les inventaires EN COURS d'avant cette vague avaient
    // stock_physique_kg=0 par défaut (indistinct de « compté zéro »). Ces lignes
    // (0 + non comptées) repassent à NULL pour s'afficher « non compté » et ne pas
    // être régularisées. Ciblé (counted=false) → sans effet sur les 0 réellement
    // comptés (counted=true) ni sur les rejeux de déploiement.
    await client.query(`
      UPDATE inventory_items ii SET stock_physique_kg = NULL, ecart_kg = NULL, ecart_percent = NULL
      FROM inventory_batches ib
      WHERE ii.batch_id = ib.id AND ib.status = 'en_cours'
        AND ii.stock_physique_kg = 0 AND ii.counted = false
    `);

    console.log('[INIT-DB] Migration Vague 1 — Stock & produits finis ✓');

    // ══════════════════════════════════════════
    // MODULE BOUTIQUES : performance retail 2nde main
    // ══════════════════════════════════════════

    // Migration rôles utilisateurs : la validation du rôle est faite au niveau
    // APPLICATIF (rôles intégrés ∪ rôles personnalisés `custom_roles`, cf.
    // users.isValidRole + middleware/auth.resolveBaseRole). On retire donc toute
    // CHECK constraint résiduelle figée sur users.role : une liste en dur casserait
    // à la fois les rôles personnalisés (clés CR_*) ET les rôles intégrés ajoutés
    // ensuite (DPO / FINANCE / QHSE, vague 2). Idempotent + base-neuve safe (la
    // table users existe déjà, créée en tête de ce script).
    try {
      const roleChecks = await client.query(`
        SELECT con.conname FROM pg_constraint con
        JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
        WHERE con.conrelid = 'users'::regclass AND con.contype = 'c' AND att.attname = 'role'
      `);
      for (const row of roleChecks.rows) {
        await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "${row.conname}"`);
      }
      // Colonne élargie pour accueillir les clés de rôles personnalisés.
      await client.query(`ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50)`).catch(() => {});
      console.log('[INIT-DB] Migration users.role : validation applicative (aucune CHECK figée) ✓');
    } catch (e) {
      console.warn('[INIT-DB] Migration users_role_check:', e.message);
    }

    // Table 1 : boutiques (référentiel)
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutiques (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20) NOT NULL UNIQUE,
        adresse TEXT,
        ville VARCHAR(100),
        code_postal VARCHAR(10),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        telephone VARCHAR(20),
        responsable_id INTEGER REFERENCES users(id),
        team_id INTEGER REFERENCES teams(id),
        budget_annuel DECIMAL(12,2) DEFAULT 0,
        csv_folder_path VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        ouverture_lundi BOOLEAN DEFAULT true,
        ouverture_mardi BOOLEAN DEFAULT true,
        ouverture_mercredi BOOLEAN DEFAULT true,
        ouverture_jeudi BOOLEAN DEFAULT true,
        ouverture_vendredi BOOLEAN DEFAULT true,
        ouverture_samedi BOOLEAN DEFAULT true,
        ouverture_dimanche BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Cloisonnement RESP_BTQ (audit 2026-07-11, item 55a) : affectation
    // explicite d'un utilisateur (typiquement RESP_BTQ) à une ou plusieurs
    // boutiques. Un RESP_BTQ ne voit/gère que les boutiques de son périmètre
    // (union avec le lien historique boutiques.responsable_id). ADMIN/MANAGER
    // ne sont jamais cloisonnés. Référence users + boutiques déjà créées.
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_boutiques (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        boutique_id INTEGER NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, boutique_id)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_boutiques_user ON user_boutiques(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_boutiques_boutique ON user_boutiques(boutique_id)');

    // Table 2 : boutique_import_batches (traçabilité imports CSV)
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_import_batches (
        id SERIAL PRIMARY KEY,
        boutique_id INTEGER NOT NULL REFERENCES boutiques(id),
        filename VARCHAR(255) NOT NULL,
        file_hash VARCHAR(64),
        date_debut DATE,
        date_fin DATE,
        nb_lignes_total INTEGER DEFAULT 0,
        nb_lignes_importees INTEGER DEFAULT 0,
        nb_lignes_erreur INTEGER DEFAULT 0,
        nb_tickets_reconstitues INTEGER DEFAULT 0,
        ca_total_ttc DECIMAL(12,2) DEFAULT 0,
        statut VARCHAR(20) NOT NULL DEFAULT 'en_cours'
          CHECK (statut IN ('en_cours', 'termine', 'erreur', 'doublon')),
        erreurs JSONB,
        source VARCHAR(20) DEFAULT 'manuel'
          CHECK (source IN ('auto', 'manuel')),
        imported_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_import_hash ON boutique_import_batches(file_hash)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_import_boutique ON boutique_import_batches(boutique_id)`);

    // Table 3 : boutique_tickets (tickets reconstitués)
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_tickets (
        id SERIAL PRIMARY KEY,
        boutique_id INTEGER NOT NULL REFERENCES boutiques(id),
        date_ticket TIMESTAMP NOT NULL,
        minute_key VARCHAR(16) NOT NULL,
        nb_articles INTEGER DEFAULT 0,
        total_ttc DECIMAL(10,2) DEFAULT 0,
        total_ht DECIMAL(10,4) DEFAULT 0,
        batch_id INTEGER REFERENCES boutique_import_batches(id),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(boutique_id, minute_key)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_tickets_date ON boutique_tickets(date_ticket)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_tickets_boutique ON boutique_tickets(boutique_id)`);

    // Table 4 : boutique_ventes (lignes de vente importées)
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_ventes (
        id SERIAL PRIMARY KEY,
        boutique_id INTEGER NOT NULL REFERENCES boutiques(id),
        batch_id INTEGER NOT NULL REFERENCES boutique_import_batches(id) ON DELETE CASCADE,
        ticket_id INTEGER REFERENCES boutique_tickets(id),
        date_vente TIMESTAMP NOT NULL,
        rayon VARCHAR(50) NOT NULL,
        segment VARCHAR(30) NOT NULL
          CHECK (segment IN ('ventes_courantes', 'promotions', 'consommables')),
        id_article INTEGER,
        article VARCHAR(255) NOT NULL,
        quantite INTEGER NOT NULL DEFAULT 1,
        prix_unitaire_ttc DECIMAL(10,2) NOT NULL,
        total_ht DECIMAL(10,4) NOT NULL,
        total_ttc DECIMAL(10,2) NOT NULL,
        montant_tva DECIMAL(10,4) NOT NULL,
        taux_tva DECIMAL(5,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_date ON boutique_ventes(date_vente)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_boutique ON boutique_ventes(boutique_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_rayon ON boutique_ventes(rayon)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_segment ON boutique_ventes(segment)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_batch ON boutique_ventes(batch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_ticket ON boutique_ventes(ticket_id)`);
    // Index composites (boutique + date) — le dashboard filtre toujours par
    // boutique ET plage de dates ; les index mono-colonne obligeaient un
    // bitmap-and. (VAK a déjà ses équivalents (vak_id, date_*).)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_boutique_date ON boutique_ventes(boutique_id, date_vente)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_tickets_boutique_date ON boutique_tickets(boutique_id, date_ticket)`);

    // Table 5 : boutique_commandes (en-tête commandes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_commandes (
        id SERIAL PRIMARY KEY,
        reference VARCHAR(20) NOT NULL UNIQUE,
        boutique_id INTEGER NOT NULL REFERENCES boutiques(id),
        date_commande DATE NOT NULL,
        date_livraison_souhaitee DATE,
        statut VARCHAR(20) NOT NULL DEFAULT 'brouillon'
          CHECK (statut IN ('brouillon', 'envoyee', 'ajustee', 'en_preparation', 'expediee', 'annulee')),
        notes TEXT,
        poids_total_demande_kg DECIMAL(10,2) DEFAULT 0,
        poids_total_ajuste_kg DECIMAL(10,2),
        created_by INTEGER REFERENCES users(id),
        ajuste_par INTEGER REFERENCES users(id),
        expedie_par INTEGER REFERENCES users(id),
        date_expedition TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_btq_commandes_boutique ON boutique_commandes(boutique_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_btq_commandes_statut ON boutique_commandes(statut)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_btq_commandes_date ON boutique_commandes(date_commande DESC)`);

    // Table 6 : boutique_commande_lignes
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_commande_lignes (
        id SERIAL PRIMARY KEY,
        commande_id INTEGER NOT NULL REFERENCES boutique_commandes(id) ON DELETE CASCADE,
        categorie VARCHAR(100) NOT NULL,
        poids_demande_kg DECIMAL(10,2) NOT NULL,
        poids_ajuste_kg DECIMAL(10,2),
        poids_expedie_kg DECIMAL(10,2),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_btq_cmd_lignes_commande ON boutique_commande_lignes(commande_id)`);

    // Table 7 : boutique_commande_historique
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_commande_historique (
        id SERIAL PRIMARY KEY,
        commande_id INTEGER NOT NULL REFERENCES boutique_commandes(id) ON DELETE CASCADE,
        ancien_statut VARCHAR(20),
        nouveau_statut VARCHAR(20) NOT NULL,
        commentaire TEXT,
        utilisateur_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_btq_cmd_hist_commande ON boutique_commande_historique(commande_id)`);

    // Table 8 : boutique_objectifs
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_objectifs (
        id SERIAL PRIMARY KEY,
        boutique_id INTEGER NOT NULL REFERENCES boutiques(id),
        annee INTEGER NOT NULL,
        mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
        ca_objectif_ttc DECIMAL(12,2) NOT NULL,
        nb_tickets_objectif INTEGER,
        panier_moyen_objectif DECIMAL(10,2),
        segment VARCHAR(30) DEFAULT 'global'
          CHECK (segment IN ('global', 'ventes_courantes', 'promotions')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(boutique_id, annee, mois, segment)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_btq_objectifs_boutique ON boutique_objectifs(boutique_id, annee)`);

    // Table 9 : boutique_meteo_quotidien
    await client.query(`
      CREATE TABLE IF NOT EXISTS boutique_meteo_quotidien (
        id SERIAL PRIMARY KEY,
        boutique_id INTEGER NOT NULL REFERENCES boutiques(id),
        date DATE NOT NULL,
        weather_code INTEGER,
        weather_label VARCHAR(50),
        temp_min DECIMAL(4,1),
        temp_max DECIMAL(4,1),
        precipitation_mm DECIMAL(6,1),
        wind_speed_max DECIMAL(5,1),
        sunshine_hours DECIMAL(4,1),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(boutique_id, date)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_btq_meteo_date ON boutique_meteo_quotidien(boutique_id, date)`);

    // Migration 16/04/2026 : colonne num_ticket (vrai numéro ticket LogicS, nouveau format CSV)
    // Rayon;Date;Num_Ticket;ID Article;Article;... au lieu de Rayon;Date;ID Article;...
    // Permet de différencier correctement les tickets qui chevauchent la même minute.
    await client.query(`ALTER TABLE boutique_tickets ADD COLUMN IF NOT EXISTS num_ticket VARCHAR(32)`);
    await client.query(`ALTER TABLE boutique_ventes ADD COLUMN IF NOT EXISTS num_ticket VARCHAR(32)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_tickets_num ON boutique_tickets(boutique_id, num_ticket) WHERE num_ticket IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boutique_ventes_num ON boutique_ventes(boutique_id, num_ticket) WHERE num_ticket IS NOT NULL`);

    // Migration 25/04/2026 : configuration import mail LogicS automatique par boutique
    await client.query(`ALTER TABLE boutiques ADD COLUMN IF NOT EXISTS logics_mail_folder VARCHAR(255) DEFAULT 'INBOX'`);
    await client.query(`ALTER TABLE boutiques ADD COLUMN IF NOT EXISTS logics_mail_subject_keyword VARCHAR(255)`);
    await client.query(`ALTER TABLE boutiques ADD COLUMN IF NOT EXISTS logics_mail_sender VARCHAR(255)`);

    // Migration 29/04/2026 : ON DELETE CASCADE sur boutique_tickets.batch_id
    // pour que la suppression d'un batch d'import retire aussi ses tickets reconstitués
    // (sinon FK NO ACTION bloque la suppression côté UI Import).
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'boutique_tickets'
            AND constraint_name = 'boutique_tickets_batch_id_fkey'
        ) THEN
          ALTER TABLE boutique_tickets DROP CONSTRAINT boutique_tickets_batch_id_fkey;
        END IF;
        ALTER TABLE boutique_tickets
          ADD CONSTRAINT boutique_tickets_batch_id_fkey
          FOREIGN KEY (batch_id) REFERENCES boutique_import_batches(id) ON DELETE CASCADE;
      END$$;
    `);

    // Seed : boutique St-Sever (référence géographique : Rouen)
    const btqExist = await client.query("SELECT id FROM boutiques LIMIT 1");
    if (btqExist.rows.length === 0) {
      const teamStSever = await client.query("SELECT id FROM teams WHERE type = 'btq_st_sever' LIMIT 1");
      const teamLhopital = await client.query("SELECT id FROM teams WHERE type = 'btq_lhopital' LIMIT 1");
      await client.query(`
        INSERT INTO boutiques (nom, code, adresse, ville, code_postal, latitude, longitude, team_id, budget_annuel, csv_folder_path)
        VALUES
          ('Boutique St-Sever', 'st_sever', 'Centre commercial St-Sever', 'Rouen', '76100', 49.4331, 1.0856, $1, 100000, '/data/boutiques-csv/st_sever'),
          ('Boutique L''Hopital', 'lhopital', 'Rue de L''Hopital', 'Rouen', '76000', 49.4431, 1.0993, $2, 80000, '/data/boutiques-csv/lhopital')
      `, [teamStSever.rows[0]?.id || null, teamLhopital.rows[0]?.id || null]);
      console.log("[INIT-DB] Seed boutiques (St-Sever, L'Hopital) ✓");
    }

    // ══════════════════════════════════════════════════════════════════
    // MIGRATION : Renommer objectifs TTC → HT (objectifs définis en HT)
    // ══════════════════════════════════════════════════════════════════
    // Les objectifs sont définis par l'utilisateur en HT, pas en TTC
    // Renommer ca_objectif_ttc → ca_objectif_ht pour clarifier
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'boutique_objectifs'
            AND column_name = 'ca_objectif_ttc'
        ) THEN
          ALTER TABLE boutique_objectifs
            RENAME COLUMN ca_objectif_ttc TO ca_objectif_ht;
          RAISE NOTICE '[INIT-DB] Migration: boutique_objectifs.ca_objectif_ttc → ca_objectif_ht ✓';
        END IF;
      END$$;
    `);

    console.log('[INIT-DB] Module Boutiques ✓');

    // ══════════════════════════════════════════════════════════════════
    // MODULE VAK — Vente au Kilo (caisse SumUp, événement mensuel)
    // ══════════════════════════════════════════════════════════════════
    // Une VAK = un événement de 2-3 jours au siège (Rouen, 49.4231 / 1.0993)
    // Source principale : API SumUp (OAuth + webhooks live)
    // Fallback : import CSV manuel (Rapport-ventes-YYYY-MM-DD_YYYY-MM-DD.csv)

    await client.query(`
      CREATE TABLE IF NOT EXISTS vaks (
        id SERIAL PRIMARY KEY,
        libelle TEXT NOT NULL,
        date_debut DATE NOT NULL,
        date_fin DATE NOT NULL,
        lieu TEXT DEFAULT 'Siège - Rouen',
        latitude DOUBLE PRECISION DEFAULT 49.4231,
        longitude DOUBLE PRECISION DEFAULT 1.0993,
        ca_objectif_ttc NUMERIC(10,2),
        poids_objectif_kg NUMERIC(10,2),
        kg_approvisionnes NUMERIC(10,2),
        compte_caisse VARCHAR(200),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CHECK (date_fin >= date_debut)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_vaks_dates ON vaks(date_debut, date_fin)');
    // Approvisionnement (kg de textile mis en vente pour la VAK) — SAISIE MANUELLE :
    // il n'existe aucune source stock fiable rattachée à une session VAK de détail
    // (le flux « VAK » du tri/étiquettes vise l'EXPORT vers exutoires, pas la vente
    // au kilo au siège). Base du KPI « taux d'écoulement » = kg vendus / kg approvisionnés.
    // ADD COLUMN IF NOT EXISTS : no-op sur base neuve (colonne déjà créée), migre les bases existantes.
    await client.query('ALTER TABLE vaks ADD COLUMN IF NOT EXISTS kg_approvisionnes NUMERIC(10,2)');
    // Filtre de périmètre par caisse (2.21.3) : plusieurs caisses SumUp
    // encaissent sur le même compte marchand (« Caissier Frip & Co » = la VAK,
    // « Caisse Vintiz » = ventes à la pièce toute l'année qui polluent les KPI
    // de l'événement). `compte_caisse` = un ou PLUSIEURS alias séparés par des
    // virgules (nom d'affichage de la colonne « Compte » du rapport CSV et/ou
    // `username` API — les deux formes existent). NULL/vide = pas de filtre.
    // SÉMANTIQUE (services/sumup.sqlPerimetreCaisse) : on n'exclut que les
    // tickets dont le compte est CONNU ET DIFFÉRENT ; compte NULL = compté.
    await client.query('ALTER TABLE vaks ADD COLUMN IF NOT EXISTS compte_caisse VARCHAR(200)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS vak_import_batches (
        id SERIAL PRIMARY KEY,
        vak_id INTEGER REFERENCES vaks(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        file_hash VARCHAR(64) UNIQUE NOT NULL,
        date_debut DATE,
        date_fin DATE,
        nb_lignes_total INTEGER DEFAULT 0,
        nb_lignes_importees INTEGER DEFAULT 0,
        nb_lignes_erreur INTEGER DEFAULT 0,
        nb_tickets_reconstitues INTEGER DEFAULT 0,
        ca_total_ttc NUMERIC(10,2) DEFAULT 0,
        poids_total_kg NUMERIC(10,3) DEFAULT 0,
        statut VARCHAR(20) DEFAULT 'en_cours',
        erreurs JSONB,
        source VARCHAR(16) DEFAULT 'csv_manuel',
        imported_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_batches_vak ON vak_import_batches(vak_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_batches_hash ON vak_import_batches(file_hash)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS vak_tickets (
        id SERIAL PRIMARY KEY,
        vak_id INTEGER REFERENCES vaks(id) ON DELETE CASCADE,
        sumup_transaction_id VARCHAR(64) UNIQUE,
        ref_transaction VARCHAR(64) NOT NULL,
        date_ticket TIMESTAMP NOT NULL,
        moyen_paiement VARCHAR(64),
        entry_mode VARCHAR(32),
        nb_articles INTEGER DEFAULT 0,
        poids_kg NUMERIC(8,3) DEFAULT 0,
        total_ttc NUMERIC(10,2) DEFAULT 0,
        total_ht NUMERIC(10,2) DEFAULT 0,
        total_tva NUMERIC(10,2) DEFAULT 0,
        compte VARCHAR(120),
        batch_id INTEGER REFERENCES vak_import_batches(id) ON DELETE SET NULL,
        source VARCHAR(16) NOT NULL DEFAULT 'csv_manuel',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(vak_id, ref_transaction)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_tickets_vak_date ON vak_tickets(vak_id, date_ticket)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_tickets_sumup_id ON vak_tickets(sumup_transaction_id) WHERE sumup_transaction_id IS NOT NULL');
    // Compte de caisse du ticket (2.21.3) : colonne « Compte » du rapport CSV
    // (nom d'affichage) ou `username` de l'API SumUp (login/email) — NULL si
    // la source ne l'expose pas (webhook minimal). Base du filtre de périmètre
    // par caisse (vaks.compte_caisse ci-dessus) : les agrégats excluent les
    // tickets au compte CONNU ET DIFFÉRENT, jamais les NULL.
    await client.query('ALTER TABLE vak_tickets ADD COLUMN IF NOT EXISTS compte VARCHAR(120)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS vak_ventes (
        id SERIAL PRIMARY KEY,
        vak_id INTEGER REFERENCES vaks(id) ON DELETE CASCADE,
        ticket_id INTEGER REFERENCES vak_tickets(id) ON DELETE CASCADE,
        batch_id INTEGER REFERENCES vak_import_batches(id) ON DELETE SET NULL,
        date_vente TIMESTAMP NOT NULL,
        ref_transaction VARCHAR(64),
        moyen_paiement VARCHAR(64),
        description TEXT,
        segment VARCHAR(32),
        unite VARCHAR(8),
        quantite NUMERIC(10,3) DEFAULT 0,
        prix_unitaire_ttc NUMERIC(10,2) DEFAULT 0,
        remise NUMERIC(10,2) DEFAULT 0,
        total_ht NUMERIC(10,2) DEFAULT 0,
        total_ttc NUMERIC(10,2) DEFAULT 0,
        total_tva NUMERIC(10,2) DEFAULT 0,
        taux_tva NUMERIC(5,2) DEFAULT 20,
        compte VARCHAR(64),
        source VARCHAR(16) NOT NULL DEFAULT 'csv_manuel',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_ventes_vak_date ON vak_ventes(vak_id, date_vente)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_ventes_segment ON vak_ventes(segment)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_ventes_paiement ON vak_ventes(moyen_paiement)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_ventes_ticket ON vak_ventes(ticket_id)');
    // ── Alignement FK batch (vague 3, item 3.B) ──
    // vak_ventes.batch_id était ON DELETE CASCADE alors que vak_tickets.batch_id est
    // ON DELETE SET NULL : supprimer un batch CSV effaçait les lignes de vente mais
    // conservait les tickets → analyses par segment (issues de vak_ventes) à zéro tandis
    // que les KPI ticket restaient (désynchronisation silencieuse). On réaligne sur
    // SET NULL (détachement symétrique, aucune perte). Idempotent : ne s'exécute que si
    // la contrainte est encore en CASCADE ('c') — rattrape les bases déjà créées.
    await client.query(`
      DO $$
      DECLARE cname text; deltype "char";
      BEGIN
        SELECT c.conname, c.confdeltype INTO cname, deltype
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         WHERE c.conrelid = 'vak_ventes'::regclass AND c.contype = 'f' AND a.attname = 'batch_id'
         LIMIT 1;
        IF cname IS NOT NULL AND deltype = 'c' THEN
          EXECUTE format('ALTER TABLE vak_ventes DROP CONSTRAINT %I', cname);
          ALTER TABLE vak_ventes
            ADD CONSTRAINT vak_ventes_batch_id_fkey
            FOREIGN KEY (batch_id) REFERENCES vak_import_batches(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vak_meteo_quotidien (
        id SERIAL PRIMARY KEY,
        vak_id INTEGER REFERENCES vaks(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        weather_code INTEGER,
        weather_label VARCHAR(50),
        temp_min DECIMAL(4,1),
        temp_max DECIMAL(4,1),
        precipitation_mm DECIMAL(6,1),
        wind_speed_max DECIMAL(5,1),
        sunshine_hours DECIMAL(4,1),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(vak_id, date)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vak_sumup_sync_log (
        id SERIAL PRIMARY KEY,
        sync_type VARCHAR(20) NOT NULL,
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        status VARCHAR(16),
        nb_transactions_received INTEGER DEFAULT 0,
        nb_transactions_inserted INTEGER DEFAULT 0,
        nb_transactions_skipped INTEGER DEFAULT 0,
        oldest_time TIMESTAMP,
        newest_time TIMESTAMP,
        error_message TEXT,
        triggered_by INTEGER REFERENCES users(id),
        details JSONB
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_vak_sumup_sync_started ON vak_sumup_sync_log(started_at DESC)');

    console.log('[INIT-DB] Module VAK (Vente au Kilo) ✓');

    // ══════════════════════════════════════════
    // OBSERVABILITÉ — Journal des exécutions de jobs (Vague 3 — item 3.D-1a)
    // Trace chaque run du scheduler (début/fin/statut/erreur/volume) pour
    // détecter les chaînes silencieusement cassées. Sans FK (jobs = système,
    // pas d'utilisateur) → aucune dépendance d'ordre, tolérant à une base neuve.
    // Alimenté par le wrapper runInstrumented() de services/scheduler.js ;
    // lu par GET /api/monitoring/jobs.
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_runs (
        id SERIAL PRIMARY KEY,
        job_name VARCHAR(100) NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMP,
        status VARCHAR(16),               -- success | error | timeout
        error_message TEXT,
        items_processed INTEGER,
        duration_ms INTEGER
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_job_runs_name_started ON job_runs(job_name, started_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC)');
    console.log('[INIT-DB] Table job_runs (observabilité scheduler) ✓');

    // ══════════════════════════════════════════
    // V3 — Seuils d'alerte configurables (Direction D6 / action 11)
    // Dashboard exécutif : la Direction définit ses propres seuils min/max.
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS alert_thresholds (
        id SERIAL PRIMARY KEY,
        domaine VARCHAR(30) NOT NULL,
        indicateur VARCHAR(80) NOT NULL UNIQUE,
        libelle VARCHAR(150) NOT NULL,
        seuil_min DOUBLE PRECISION,
        seuil_max DOUBLE PRECISION,
        unite VARCHAR(20),
        severite VARCHAR(20) DEFAULT 'warning' CHECK (severite IN ('info', 'warning', 'error', 'critical')),
        actif BOOLEAN DEFAULT true,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_alert_thresholds_actif ON alert_thresholds(actif) WHERE actif = true;');

    await client.query(`
      INSERT INTO alert_thresholds (domaine, indicateur, libelle, seuil_min, seuil_max, unite, severite, notes)
      VALUES
        ('collecte',  'tonnage_collecte_mois',  'Tonnage collecte mois',     5000, null, 'kg',          'warning', 'Cible mensuelle indicative.'),
        ('tri',       'taux_valorisation',      'Taux de valorisation',      75,   null, '%',           'warning', 'Objectif Refashion >75%.'),
        ('tri',       'productivite_tri',       'Productivité tri',          600,  null, 'kg/pers/j',   'warning', 'Cible productivité historique.'),
        ('boutique',  'ca_boutique_mois',       'CA boutiques mois',         5000, null, '€',           'warning', 'À calibrer selon objectifs.'),
        ('insertion', 'sorties_positives_12m',  'Sorties positives 12 mois', 55,   null, '%',           'warning', 'Cible IAE >55%.')
      ON CONFLICT (indicateur) DO NOTHING;
    `);
    // Vague 2 (item 60c) — seuil de saturation stock par matière (alertes
    // consolidées « boîte du directeur »). Désactivé par défaut (actif=false) :
    // aucune alerte tant que l'admin n'a pas calibré le seuil selon la capacité
    // de l'entrepôt et activé le seuil depuis /admin-alert-thresholds.
    await client.query(`
      INSERT INTO alert_thresholds (domaine, indicateur, libelle, seuil_min, seuil_max, unite, severite, actif, notes)
      VALUES ('stock', 'stock_matiere_max', 'Saturation stock par matière', null, 10000, 'kg', 'warning', false,
              'Alerte le tableau de bord si le stock d''une matière dépasse ce seuil. À calibrer selon la capacité de l''entrepôt, puis activer.')
      ON CONFLICT (indicateur) DO NOTHING;
    `);
    console.log('[INIT-DB] Alert thresholds Dashboard exécutif ✓');

    // ══════════════════════════════════════════
    // V2 — Référentiel unifié `partners` (Enterprise Architect Ch1)
    //
    // Fusion exutoires + clients_exutoires + boutiques (côté aval) en une
    // table maître. Les associations (collecte) restent dans leur table
    // dédiée (collecte = points d'apport, sémantique différente).
    //
    // Approche additive : la table `partners` est la nouvelle source de
    // vérité, les anciennes tables sont conservées en lecture seule
    // (rollback possible). Les colonnes source_table/source_id permettent
    // de tracer l'origine. Les FK partner_id sont ajoutées en parallèle
    // sur expeditions/commandes_exutoires/produits_finis/factures_exutoires.
    // ══════════════════════════════════════════

    await client.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id SERIAL PRIMARY KEY,
        type VARCHAR(30) NOT NULL CHECK (type IN (
          'exutoire_recycleur', 'exutoire_negociant', 'exutoire_industriel',
          'exutoire_autre', 'boutique'
        )),
        nom VARCHAR(255) NOT NULL,
        siret VARCHAR(14),
        adresse TEXT,
        code_postal VARCHAR(10),
        ville VARCHAR(100),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        contact_nom VARCHAR(150),
        contact_email VARCHAR(255),
        contact_tel VARCHAR(30),
        actif BOOLEAN DEFAULT true,
        notes TEXT,
        -- Origine pour rétrocompat (rollback) — drop après migration finale
        source_table VARCHAR(50),
        source_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_partner_source UNIQUE (source_table, source_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_partners_type ON partners(type);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_partners_actif ON partners(actif) WHERE actif = true;');
    await client.query('CREATE INDEX IF NOT EXISTS idx_partners_nom ON partners(nom);');

    // Backfill 1 : exutoires (table simple type) → partners
    // Les anciens "exutoires" couvrent recycleurs/négociants/industriels avec
    // le champ libre 'type'. On mappe vers les enum :
    //   recycl* → exutoire_recycleur, negoc* → exutoire_negociant,
    //   industr* → exutoire_industriel, sinon → exutoire_autre
    await client.query(`
      INSERT INTO partners (type, nom, adresse, contact_nom, contact_email,
                            contact_tel, actif, source_table, source_id)
      SELECT
        CASE
          WHEN LOWER(COALESCE(e.type, '')) LIKE '%recycl%'  THEN 'exutoire_recycleur'
          WHEN LOWER(COALESCE(e.type, '')) LIKE '%negoc%'   THEN 'exutoire_negociant'
          WHEN LOWER(COALESCE(e.type, '')) LIKE '%industr%' THEN 'exutoire_industriel'
          ELSE 'exutoire_autre'
        END AS type,
        e.nom, e.adresse, e.contact_nom, e.contact_email, e.contact_tel,
        COALESCE(e.is_active, true) AS actif,
        'exutoires' AS source_table, e.id AS source_id
      FROM exutoires e
      ON CONFLICT (source_table, source_id) DO NOTHING;
    `);

    // Backfill 2 : clients_exutoires (table riche) → partners
    // type_client mappe directement aux enum exutoire_*.
    await client.query(`
      INSERT INTO partners (type, nom, siret, adresse, code_postal, ville,
                            contact_nom, contact_email, contact_tel, actif,
                            source_table, source_id)
      SELECT
        CASE c.type_client
          WHEN 'recycleur'  THEN 'exutoire_recycleur'
          WHEN 'negociant'  THEN 'exutoire_negociant'
          WHEN 'industriel' THEN 'exutoire_industriel'
          ELSE 'exutoire_autre'
        END AS type,
        c.raison_sociale, c.siret, c.adresse, c.code_postal, c.ville,
        c.contact_nom, c.contact_email, c.contact_telephone,
        COALESCE(c.actif, true),
        'clients_exutoires', c.id
      FROM clients_exutoires c
      ON CONFLICT (source_table, source_id) DO NOTHING;
    `);

    // Backfill 3 : boutiques → partners (côté aval = exutoire de produits triés)
    await client.query(`
      INSERT INTO partners (type, nom, adresse, code_postal, ville,
                            latitude, longitude, contact_tel, actif,
                            source_table, source_id)
      SELECT
        'boutique', b.nom, b.adresse, b.code_postal, b.ville,
        b.latitude, b.longitude, b.telephone,
        COALESCE(b.is_active, true),
        'boutiques', b.id
      FROM boutiques b
      ON CONFLICT (source_table, source_id) DO NOTHING;
    `);

    // Ajouter les FK partner_id en parallèle des anciennes (additive)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE expeditions ADD COLUMN partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE commandes_exutoires ADD COLUMN partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE produits_finis ADD COLUMN partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE factures_exutoires ADD COLUMN partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // Backfill FK partner_id (lookup via source_table + source_id)
    await client.query(`
      UPDATE expeditions e SET partner_id = p.id
      FROM partners p
      WHERE p.source_table = 'exutoires' AND p.source_id = e.exutoire_id
        AND e.partner_id IS NULL;
    `);
    await client.query(`
      UPDATE produits_finis pf SET partner_id = p.id
      FROM partners p
      WHERE p.source_table = 'exutoires' AND p.source_id = pf.exutoire_id
        AND pf.partner_id IS NULL;
    `);
    await client.query(`
      UPDATE commandes_exutoires c SET partner_id = p.id
      FROM partners p
      WHERE p.source_table = 'clients_exutoires' AND p.source_id = c.client_id
        AND c.partner_id IS NULL;
    `);
    await client.query(`
      UPDATE factures_exutoires f SET partner_id = p.id
      FROM partners p, commandes_exutoires c
      WHERE p.source_table = 'clients_exutoires' AND p.source_id = c.client_id
        AND c.id = f.commande_id
        AND f.partner_id IS NULL;
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_expeditions_partner ON expeditions(partner_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_commandes_exutoires_partner ON commandes_exutoires(partner_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_produits_finis_partner ON produits_finis(partner_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_factures_exutoires_partner ON factures_exutoires(partner_id);');

    console.log('[INIT-DB] Référentiel unifié `partners` + migration ✓');

    // ══════════════════════════════════════════
    // V1.8+ — Contrôle facturation Pennylane
    // Outil de réconciliation (PAS de génération) : on PULL les factures
    // émises sur Pennylane → on les rapproche d'une commande_exutoires
    // → on compare quantité facturée vs pesée_client → alerte non-bloquante.
    // ══════════════════════════════════════════
    const facturesExutoiresMigrations = [
      // Colonnes pour relier à une facture Pennylane importée
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS pennylane_invoice_id VARCHAR(80)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS pennylane_invoice_number VARCHAR(80)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS pennylane_external_reference VARCHAR(120)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS pennylane_customer_id VARCHAR(80)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS pennylane_customer_name VARCHAR(255)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS pennylane_data JSONB",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP DEFAULT NOW()",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'pennylane'",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS date_facture DATE",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS quantite_facturee DECIMAL(10,3)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS unite_quantite VARCHAR(10) DEFAULT 't'",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS montant_ht DECIMAL(12,2)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS montant_ttc DECIMAL(12,2)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS ecart_quantite DECIMAL(10,3)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS ecart_quantite_pct DECIMAL(6,2)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS pesee_client_kg DECIMAL(10,3)",
      "ALTER TABLE factures_exutoires ADD COLUMN IF NOT EXISTS rapprochement_mode VARCHAR(20)",
      // commande_id devient nullable (factures non rapprochées)
      "ALTER TABLE factures_exutoires ALTER COLUMN commande_id DROP NOT NULL",
    ];
    for (const sql of facturesExutoiresMigrations) {
      try { await client.query(sql); } catch (e) { /* ignore — colonne déjà présente */ }
    }
    // Index pour anti-doublon Pennylane et lookup rapide
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_factures_exutoires_pennylane_id ON factures_exutoires(pennylane_invoice_id) WHERE pennylane_invoice_id IS NOT NULL");
    await client.query("CREATE INDEX IF NOT EXISTS idx_factures_exutoires_commande ON factures_exutoires(commande_id) WHERE commande_id IS NOT NULL");
    await client.query("CREATE INDEX IF NOT EXISTS idx_factures_exutoires_source ON factures_exutoires(source)");

    // Élargir le CHECK de statut_facture pour accepter "rapprochement_manuel" et "ecart_valide"
    try {
      await client.query("ALTER TABLE factures_exutoires DROP CONSTRAINT IF EXISTS factures_exutoires_statut_facture_check");
      await client.query(`
        ALTER TABLE factures_exutoires ADD CONSTRAINT factures_exutoires_statut_facture_check
        CHECK (statut_facture IN ('recue', 'conforme', 'ecart', 'validee', 'rapprochement_manuel', 'ecart_valide'))
      `);
    } catch (e) { /* ignore — contrainte déjà à jour */ }

    // Setting global : tolérance d'écart facturation (% — défaut 5)
    try {
      await client.query(`
        INSERT INTO settings (key, value, category)
        VALUES ('facturation_tolerance_pct', '5', 'facturation')
        ON CONFLICT (key) DO NOTHING
      `);
    } catch (e) { /* settings table peut ne pas exister sur ancienne installation */ }

    console.log('[INIT-DB] Contrôle facturation Pennylane (factures_exutoires étendue) ✓');

    // ══════════════════════════════════════════
    // V1.8.2 — Refonte référentiels métier
    // (a) commandes_exutoires.type_produit : effilo_* → essuyage + tricot + merinos
    // (b) categories_sortantes : soft-delete + renommages + nouveaux choix BTQ/VAK/Export
    // ══════════════════════════════════════════

    // (a) Types de produit pour commandes — DROP + UPDATE + recréer CHECK
    // Note : migrate-exutoires.js convertit type_produit en TEXT[] pour le
    // support multi-types. On adapte la syntaxe au type courant de la colonne.
    try {
      const colType = await client.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'commandes_exutoires' AND column_name = 'type_produit'
      `);
      const isArray = colType.rows[0]?.data_type === 'ARRAY';
      await client.query(`
        ALTER TABLE commandes_exutoires
        DROP CONSTRAINT IF EXISTS commandes_exutoires_type_produit_check
      `);
      if (isArray) {
        await client.query(`
          UPDATE commandes_exutoires
          SET type_produit = ARRAY['essuyage']::TEXT[]
          WHERE 'effilo_blanc' = ANY(type_produit) OR 'effilo_couleur' = ANY(type_produit)
        `);
        // CHECK constraint sur ARRAY : tous les éléments du tableau doivent
        // être dans la whitelist (utilise <@ pour subset).
        await client.query(`
          ALTER TABLE commandes_exutoires
          ADD CONSTRAINT commandes_exutoires_type_produit_check
          CHECK (type_produit <@ ARRAY['original', 'csr', 'essuyage', 'tricot', 'merinos', 'jean', 'coton_blanc', 'coton_couleur']::TEXT[])
        `);
      } else {
        await client.query(`
          UPDATE commandes_exutoires
          SET type_produit = 'essuyage'
          WHERE type_produit IN ('effilo_blanc', 'effilo_couleur')
        `);
        await client.query(`
          ALTER TABLE commandes_exutoires
          ADD CONSTRAINT commandes_exutoires_type_produit_check
          CHECK (type_produit IN ('original', 'csr', 'essuyage', 'tricot', 'merinos', 'jean', 'coton_blanc', 'coton_couleur'))
        `);
      }
      console.log(`[INIT-DB] commandes_exutoires.type_produit étendu (mode ${isArray ? 'ARRAY' : 'scalaire'}) ✓`);
    } catch (e) {
      console.error('[INIT-DB] Erreur migration type_produit :', e.message);
    }

    // (a bis) Item 38a — tarifs_exutoires.type_produit : aligner le CHECK sur la
    // nomenclature actuelle (essuyage/tricot/merinos) TOUT EN conservant les
    // types historiques (effilo_blanc/effilo_couleur) pour la lecture et
    // l'édition des anciens tarifs. Sans ce realignement, aucun tarif de
    // référence ni négocié ne peut être enregistré pour les gammes actuelles.
    // Idempotent : DROP CONSTRAINT IF EXISTS puis ADD (même nom).
    // Table créée par migrate-exutoires.js — en prod elle existe déjà ; sur une
    // base neuve où elle n'existe pas encore, l'ALTER échoue et est journalisé
    // (le CHECK sera réaligné au prochain init-db, comportement identique au
    // bloc commandes_exutoires ci-dessus).
    try {
      await client.query(`
        ALTER TABLE tarifs_exutoires
        DROP CONSTRAINT IF EXISTS tarifs_exutoires_type_produit_check
      `);
      await client.query(`
        ALTER TABLE tarifs_exutoires
        ADD CONSTRAINT tarifs_exutoires_type_produit_check
        CHECK (type_produit IN ('original', 'csr', 'essuyage', 'tricot', 'merinos', 'jean', 'coton_blanc', 'coton_couleur', 'effilo_blanc', 'effilo_couleur'))
      `);
      console.log('[INIT-DB] tarifs_exutoires.type_produit aligné (essuyage/tricot/merinos + legacy effilo_*) ✓');
    } catch (e) {
      console.error('[INIT-DB] Erreur migration tarifs_exutoires.type_produit :', e.message);
    }

    // (b) Catégories sortantes — soft-delete via is_active
    try {
      await client.query(`
        ALTER TABLE categories_sortantes
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true
      `);
      // Renommages (préservent les FK). On garde le rename uniquement si la
      // cible n'existe pas déjà — sinon le seed L1602 a déjà créé la nouvelle
      // catégorie et le rename violerait l'UNIQUE constraint sur nom.
      await client.query(`
        UPDATE categories_sortantes SET nom = 'Recyclage Coton', famille = 'recyclage'
        WHERE nom = 'Effilochage Coton'
          AND NOT EXISTS (SELECT 1 FROM categories_sortantes WHERE nom = 'Recyclage Coton')
      `);
      await client.query(`
        UPDATE categories_sortantes SET nom = 'Recyclage Tricot', famille = 'recyclage'
        WHERE nom = 'Effilochage Laine'
          AND NOT EXISTS (SELECT 1 FROM categories_sortantes WHERE nom = 'Recyclage Tricot')
      `);
      await client.query(`
        UPDATE categories_sortantes SET nom = 'Extra'
        WHERE nom = 'Extra 1er Choix'
          AND NOT EXISTS (SELECT 1 FROM categories_sortantes WHERE nom = 'Extra')
      `);
      // Soft-delete (11 catégories)
      await client.query(`
        UPDATE categories_sortantes SET is_active = false
        WHERE nom IN (
          'Chiffons Synthétiques',
          'Déstockage',
          'Effilochage Synthétique',
          'Extra 2ème Choix',
          'Originaux 1er Choix',
          'Originaux 2ème Choix',
          'Originaux 3ème Choix',
          'Pré-classé Été',
          'Pré-classé Hiver',
          'VAK Afrique',
          'VAK Export',
          'VAK Moyen-Orient'
        )
      `);
      // Nouveaux ajouts (idempotent)
      await client.query(`
        INSERT INTO categories_sortantes (nom, famille, is_active) VALUES
          ('Recyclage Jean',     'recyclage', true),
          ('Recyclage Mérinos',  'recyclage', true),
          ('Essuyage',           'essuyage',  true),
          ('1er Choix (BTQ)',    'choix',     true),
          ('2ème Choix (VAK)',   'choix',     true),
          ('3ème Choix (Export)','choix',     true)
        ON CONFLICT (nom) DO UPDATE SET famille = EXCLUDED.famille, is_active = true
      `);
      console.log('[INIT-DB] Catégories sortantes refondues (3 renommées, 11 désactivées, 6 ajoutées) ✓');
    } catch (e) {
      console.error('[INIT-DB] Erreur migration categories_sortantes :', e.message);
    }

    // V1.8.3 — Archivage véhicules (soft-delete pour véhicules retirés du service)
    try {
      await client.query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false");
      await client.query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP");
      await client.query("CREATE INDEX IF NOT EXISTS idx_vehicles_archived ON vehicles(is_archived)");
      console.log('[INIT-DB] Vehicles : colonne is_archived ajoutée ✓');
    } catch (e) {
      console.error('[INIT-DB] Erreur ALTER vehicles is_archived :', e.message);
    }

    // V2.0.1 — URL d'accès unique par véhicule (« 1 URL = 1 véhicule »)
    //
    // Pattern : le chauffeur ouvre https://m.solidata.online/v/<qr_token>
    // sur son téléphone (paramétré une fois par le manager au dépôt),
    // installe le raccourci sur l'écran d'accueil, et toute ré-ouverture
    // re-authentifie automatiquement contre le véhicule lié à ce token.
    //
    // Le token remplace l'ancien `vehicle_id` (entier énumérable) comme
    // credential du flux /api/auth/driver-start. Régénération côté admin
    // = révocation immédiate de l'ancien raccourci.
    try {
      await client.query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS qr_token VARCHAR(32) UNIQUE");
      // pgcrypto pour gen_random_bytes (postgis seul ne suffit pas) — idempotent
      await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      // Backfill : tout véhicule existant reçoit un token unique aléatoire (16 octets hex = 32 caractères).
      // Idempotent : la clause WHERE évite d'écraser un token déjà attribué.
      await client.query("UPDATE vehicles SET qr_token = encode(gen_random_bytes(16), 'hex') WHERE qr_token IS NULL");
      // Défaut pour les futurs INSERT + NOT NULL après backfill.
      await client.query("ALTER TABLE vehicles ALTER COLUMN qr_token SET DEFAULT encode(gen_random_bytes(16), 'hex')");
      await client.query("ALTER TABLE vehicles ALTER COLUMN qr_token SET NOT NULL");
      await client.query("CREATE INDEX IF NOT EXISTS idx_vehicles_qr_token ON vehicles(qr_token)");
      console.log('[INIT-DB] Vehicles : qr_token (URL d\'accès chauffeur) ✓');
    } catch (e) {
      console.error('[INIT-DB] Erreur ALTER vehicles qr_token :', e.message);
    }

    // V1.8.4 — Auto-discovery événements + jours fériés/vacances scolaires
    try {
      // Étendre evenements_locaux pour traçabilité source + lien CAV/association
      await client.query("ALTER TABLE evenements_locaux ADD COLUMN IF NOT EXISTS source VARCHAR(40)");
      await client.query("ALTER TABLE evenements_locaux ADD COLUMN IF NOT EXISTS external_id VARCHAR(120)");
      await client.query("ALTER TABLE evenements_locaux ADD COLUMN IF NOT EXISTS cav_id INTEGER REFERENCES cav(id) ON DELETE SET NULL");
      await client.query("ALTER TABLE evenements_locaux ADD COLUMN IF NOT EXISTS association_point_id INTEGER");
      await client.query("ALTER TABLE evenements_locaux ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP DEFAULT NOW()");
      // Index unique anti-doublon par source + external_id (events auto-découverts uniquement)
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_evenements_locaux_external
        ON evenements_locaux(source, external_id)
        WHERE external_id IS NOT NULL
      `);
      // Audit des runs de découverte (date de dernière mise à jour visible côté UI)
      await client.query(`
        CREATE TABLE IF NOT EXISTS event_discovery_runs (
          id SERIAL PRIMARY KEY,
          source VARCHAR(40) NOT NULL,
          scope VARCHAR(40) DEFAULT 'all',
          started_at TIMESTAMP DEFAULT NOW(),
          completed_at TIMESTAMP,
          events_found INTEGER DEFAULT 0,
          events_inserted INTEGER DEFAULT 0,
          events_skipped INTEGER DEFAULT 0,
          status VARCHAR(20) DEFAULT 'running',
          error TEXT,
          triggered_by VARCHAR(20) DEFAULT 'manual'
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_event_runs_source_completed ON event_discovery_runs(source, completed_at DESC)");

      // Jours fériés (FR métropole — api.gouv.fr)
      await client.query(`
        CREATE TABLE IF NOT EXISTS jours_feries (
          id SERIAL PRIMARY KEY,
          date DATE UNIQUE NOT NULL,
          nom VARCHAR(100) NOT NULL,
          zone VARCHAR(20) DEFAULT 'metropole',
          source VARCHAR(40) DEFAULT 'api.gouv.fr',
          imported_at TIMESTAMP DEFAULT NOW()
        )
      `);
      // Vacances scolaires zone B (Rouen) — opendata.education.gouv.fr
      await client.query(`
        CREATE TABLE IF NOT EXISTS vacances_scolaires (
          id SERIAL PRIMARY KEY,
          zone VARCHAR(10) NOT NULL DEFAULT 'B',
          description VARCHAR(100) NOT NULL,
          date_debut DATE NOT NULL,
          date_fin DATE NOT NULL,
          annee_scolaire VARCHAR(20),
          source VARCHAR(40) DEFAULT 'opendata.education.gouv.fr',
          imported_at TIMESTAMP DEFAULT NOW(),
          UNIQUE (zone, date_debut, description)
        )
      `);
      console.log('[INIT-DB] Auto-discovery + jours fériés + vacances scolaires ✓');
    } catch (e) {
      console.error('[INIT-DB] Erreur migration auto-discovery :', e.message);
    }


    // ══════════════════════════════════════════
    // V2 — State machine centralisée (Enterprise Architect Ch2)
    // Audit transverse de toutes les transitions d'état métier.
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS state_transitions_audit (
        id BIGSERIAL PRIMARY KEY,
        machine VARCHAR(50) NOT NULL,
        entity_type VARCHAR(80) NOT NULL,
        entity_id INTEGER NOT NULL,
        from_state VARCHAR(40),
        to_state VARCHAR(40) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_role VARCHAR(20),
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_state_audit_entity ON state_transitions_audit(entity_type, entity_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_state_audit_machine ON state_transitions_audit(machine, created_at DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_state_audit_user ON state_transitions_audit(user_id);');
    console.log('[INIT-DB] Audit state-machine ✓');

    // ══════════════════════════════════════════
    // MODULE QHSE (Qualité-Hygiène-Sécurité-Environnement) — Vague 2, item 58 (A4)
    //
    // Module minimal intégré (arbitrage A4) pour le responsable QHSE :
    //   (a) registre des accidents / presqu'accidents (+ taux de fréquence TF /
    //       taux de gravité TG)
    //   (b) habilitations à échéance (CACES, SST, habilitation électrique, permis)
    //   (c) dotation EPI
    // Publics : ADMIN, MANAGER, rôle QHSE. Données de santé MINIMISÉES :
    // description factuelle des faits uniquement, AUCUN diagnostic médical.
    // Tables créées après users/employees (FK) et rgpd_registre (seed ci-dessous).
    // ══════════════════════════════════════════

    // (a) Registre accidents / presqu'accidents
    await client.query(`
      CREATE TABLE IF NOT EXISTS qhse_events (
        id SERIAL PRIMARY KEY,
        type VARCHAR(30) NOT NULL CHECK (type IN ('accident_travail','accident_trajet','presqu_accident','soin_benin')),
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        date_event DATE NOT NULL,
        lieu VARCHAR(20) NOT NULL DEFAULT 'autre' CHECK (lieu IN ('tri','collecte','boutique','autre')),
        description TEXT,
        gravite VARCHAR(20) CHECK (gravite IN ('mineure','moderee','grave','critique')),
        jours_arret INTEGER NOT NULL DEFAULT 0,
        avec_arret BOOLEAN NOT NULL DEFAULT false,
        mesures_prises TEXT,
        statut VARCHAR(20) NOT NULL DEFAULT 'declare' CHECK (statut IN ('declare','analyse','clos')),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_events_date ON qhse_events(date_event);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_events_statut ON qhse_events(statut);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_events_employee ON qhse_events(employee_id);');

    // (b) Habilitations à échéance (statut calculé au vol depuis date_expiration ;
    //     la table QHSE devient la source de vérité DATÉE des CACES/permis, et
    //     synchronise employees.has_caces / has_permis_b qui pilotent le planning).
    await client.query(`
      CREATE TABLE IF NOT EXISTS qhse_habilitations (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type VARCHAR(30) NOT NULL CHECK (type IN ('caces_1','caces_3','caces_5','sst','habilitation_electrique','permis','autre')),
        libelle VARCHAR(150),
        date_obtention DATE,
        date_expiration DATE,
        organisme VARCHAR(150),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_hab_employee ON qhse_habilitations(employee_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_hab_expiration ON qhse_habilitations(date_expiration);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_hab_type ON qhse_habilitations(type);');

    // (c) Dotation EPI
    await client.query(`
      CREATE TABLE IF NOT EXISTS qhse_epi_dotations (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type_epi VARCHAR(30) NOT NULL CHECK (type_epi IN ('chaussures','gants','gilet_hv','casque_antibruit','autre')),
        taille VARCHAR(30),
        date_dotation DATE NOT NULL,
        date_peremption DATE,
        quantite INTEGER NOT NULL DEFAULT 1,
        remarque TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_epi_employee ON qhse_epi_dotations(employee_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_epi_peremption ON qhse_epi_dotations(date_peremption);');

    // Registre RGPD — traitement QHSE (idempotent via WHERE NOT EXISTS).
    // rgpd_registre n'a pas de mécanisme de seed dédié ; on inscrit ici le
    // traitement QHSE (données de sécurité, sans diagnostic médical) pour la
    // conformité art. 30 RGPD (registre des activités de traitement).
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Suivi QHSE (accidents, habilitations, EPI)',
        'Prévention des risques professionnels : registre des accidents du travail et presqu''accidents, suivi des habilitations à échéance (CACES, SST, habilitation électrique, permis), dotation des équipements de protection individuelle.',
        'Obligation légale (Code du travail, art. L4121-1 et suivants)',
        'Salariés (y compris salariés en parcours d''insertion)',
        'Identité, faits d''accident (description factuelle, sans diagnostic médical), jours d''arrêt de travail, habilitations et dates de validité, dotations EPI',
        'Responsable QHSE, direction, service RH',
        'Registre de sécurité : 5 ans ; habilitations / EPI : durée du contrat + archivage légal',
        'Accès restreint aux rôles ADMIN/MANAGER/QHSE, journalisation applicative, minimisation (aucun diagnostic médical stocké)'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Suivi QHSE (accidents, habilitations, EPI)'
      );
    `);
    console.log('[INIT-DB] Module QHSE (accidents, habilitations, EPI) + registre RGPD ✓');

    // ══════════════════════════════════════════
    // QHSE — RSEI-06 (documents de prévention : DUERP, plan de prévention, RPS)
    //        + RSEI-07 (retours d'expérience SST sur qhse_events)
    // Sert le critère 2.4 « Santé et sécurité au travail » du référentiel RSEi :
    //   - RSEI-06 : registre des documents de prévention avec pièce jointe
    //     (pattern Refashion), date de mise à jour, TRACE de la consultation des
    //     IRP/CSE, et échéance de révision (alerte scheduler checkQhseDocuments) —
    //     transforme l'attendu N1 le plus scruté du 2.4 en preuve d'un clic.
    //   - RSEI-07 : boucle REX (analyse des causes → action corrective →
    //     efficacité vérifiée) portée par les accidents/presqu'accidents déjà saisis.
    // RGPD : documents de prévention = pièces ORGANISATIONNELLES non nominatives
    // (le DUERP porte sur des unités de travail, pas sur des personnes) ; le
    // traitement QHSE au registre art. 30 (ci-dessus) couvre le module.
    // ══════════════════════════════════════════

    // RSEI-07 — colonnes de retour d'expérience sur le registre d'évènements.
    await client.query(`ALTER TABLE qhse_events ADD COLUMN IF NOT EXISTS analyse_causes TEXT;`);
    await client.query(`ALTER TABLE qhse_events ADD COLUMN IF NOT EXISTS action_corrective TEXT;`);
    await client.query(`ALTER TABLE qhse_events ADD COLUMN IF NOT EXISTS efficacite_verifiee_le DATE;`);
    await client.query(`ALTER TABLE qhse_events ADD COLUMN IF NOT EXISTS efficacite_constat TEXT;`);

    // RSEI-06 — registre des documents de prévention (DUERP, plan de prévention,
    // volet RPS, protocole de sécurité, consignes). Un enregistrement par
    // document/version ; l'historique des versions = les lignes successives.
    await client.query(`
      CREATE TABLE IF NOT EXISTS qhse_documents (
        id SERIAL PRIMARY KEY,
        type VARCHAR(30) NOT NULL CHECK (type IN ('duerp','plan_prevention','rps','protocole_securite','consignes','autre')),
        titre VARCHAR(200) NOT NULL,
        version VARCHAR(50),
        date_document DATE,
        date_maj DATE,
        date_revision_prevue DATE,
        irp_consultation_date DATE,
        irp_consultation_avis TEXT,
        fichier_path TEXT,
        fichier_original_name VARCHAR(255),
        fichier_mime VARCHAR(120),
        remarque TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_documents_type ON qhse_documents(type);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qhse_documents_revision ON qhse_documents(date_revision_prevue);');
    console.log('[INIT-DB] QHSE — documents de prévention (RSEI-06) + REX SST (RSEI-07) ✓');

    // ══════════════════════════════════════════
    // RH — RSEI-12 : plan de formation formalisé (besoins → planifié → réalisé)
    // Sert le critère RSEi 2.1 « Emplois et compétences » (le socle N3 exige un
    // ajustement en cours d'année tracé) et alimente 2.6/B10. Ce que l'ERP porte du
    // 2.1 : la formalisation, le suivi et la mesure du plan — l'ingénierie reste RH.
    // NON NOMINATIF par conception : le plan porte sur des ACTIONS (nb de participants
    // prévus/réalisés), pas sur des individus ; les heures individuelles sont déjà
    // dans work_hours (type 'training'). Aucun employee_id → aucune surface RGPD
    // nouvelle. Couvre permanents ET salariés en parcours (public_cible).
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS formation_actions (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        intitule VARCHAR(200) NOT NULL,
        type_formation VARCHAR(30) NOT NULL DEFAULT 'autre'
          CHECK (type_formation IN ('interne','externe','obligatoire_securite','habilitation','tutorat','autre')),
        origine_besoin VARCHAR(30) NOT NULL DEFAULT 'autre'
          CHECK (origine_besoin IN ('entretien','reglementaire','projet_entreprise','souhait_salarie','autre')),
        public_cible VARCHAR(20) NOT NULL DEFAULT 'tous'
          CHECK (public_cible IN ('permanents','parcours','tous')),
        organisme VARCHAR(150),
        statut VARCHAR(20) NOT NULL DEFAULT 'identifie'
          CHECK (statut IN ('identifie','planifie','realise','annule')),
        date_prevue DATE,
        date_realisation DATE,
        nb_participants_prevus INTEGER,
        nb_participants_realises INTEGER,
        heures_prevues NUMERIC(8,2),
        heures_realisees NUMERIC(8,2),
        cout_prevu NUMERIC(10,2),
        cout_realise NUMERIC(10,2),
        commentaire TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT chk_formation_nonneg CHECK (
          (nb_participants_prevus IS NULL OR nb_participants_prevus >= 0) AND
          (nb_participants_realises IS NULL OR nb_participants_realises >= 0) AND
          (heures_prevues IS NULL OR heures_prevues >= 0) AND
          (heures_realisees IS NULL OR heures_realisees >= 0) AND
          (cout_prevu IS NULL OR cout_prevu >= 0) AND
          (cout_realise IS NULL OR cout_realise >= 0)
        )
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_formation_actions_annee ON formation_actions(annee);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_formation_actions_statut ON formation_actions(statut);');
    // Revue Codex PR#82 : garde anti-négatif aussi sur une table déjà créée sans la
    // contrainte (ajout idempotent — la table est neuve, aucune donnée négative attendue).
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_formation_nonneg') THEN
        ALTER TABLE formation_actions ADD CONSTRAINT chk_formation_nonneg CHECK (
          (nb_participants_prevus IS NULL OR nb_participants_prevus >= 0) AND
          (nb_participants_realises IS NULL OR nb_participants_realises >= 0) AND
          (heures_prevues IS NULL OR heures_prevues >= 0) AND
          (heures_realisees IS NULL OR heures_realisees >= 0) AND
          (cout_prevu IS NULL OR cout_prevu >= 0) AND
          (cout_realise IS NULL OR cout_realise >= 0)
        );
      END IF;
    END $$;`);
    console.log('[INIT-DB] RH — plan de formation (RSEI-12) ✓');

    // Registre RGPD — sous-traitance IA (Anthropic) — Vague 3, item 3.C-6.
    // Documente le recours au modèle Claude (Anthropic PBC, sous-traitant art. 28)
    // pour l'aide à l'analyse insertion et l'assistant conversationnel. Les données
    // transmises sont PSEUDONYMISÉES (utils/pii-pseudonymize.js). Idempotent.
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Assistance IA — sous-traitance Anthropic (analyse insertion & assistant conversationnel)',
        'Aide à l''analyse des parcours d''insertion (croisement profil PCM × freins périphériques, préparation d''entretiens CIP, bilan de cohorte, rapport d''audit de structure) et assistant conversationnel interne (SolidataBot). AUCUNE décision automatisée au sens de l''art. 22 RGPD : le CIP / l''utilisateur reste seul décideur, l''IA ne produit que des recommandations. Traitement confié à un sous-traitant (art. 28 RGPD) dont l''API commerciale ne réutilise pas les requêtes pour l''entraînement de ses modèles.',
        'Intérêt légitime ; sous-traitance art. 28 RGPD (Anthropic PBC)',
        'Salariés en parcours d''insertion (et candidats liés) ; utilisateurs de l''assistant conversationnel',
        'Données PSEUDONYMISÉES avant transmission : jetons d''identité (« Salarié A », aucun nom réel), poste / filière, tranche d''âge (jamais la date de naissance exacte), scores des 7 freins périphériques (dont indication de santé sous forme de score), type PCM, verbatims CIP anonymisés. Coordonnées et identifiants directs (email, téléphone, matricule, titre de séjour, NIR) exclus ou masqués avant envoi. Pour le chatbot : données AGRÉGÉES ou données propres de l''utilisateur uniquement.',
        'Anthropic PBC (fournisseur du modèle Claude, sous-traitant art. 28 RGPD) via son API',
        'Analyses non stockées (générées à la demande) ; historique chatbot conservé pour supervision',
        'Pseudonymisation systématique avant envoi (backend/src/utils/pii-pseudonymize.js) ; accès restreint (analyses insertion réservées aux rôles ADMIN/RH, chatbot filtré par rôle avec outils en lecture seule) ; transport chiffré TLS ; clé API en variable d''environnement (jamais en base ni en clair) ; journalisation applicative.'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Assistance IA — sous-traitance Anthropic (analyse insertion & assistant conversationnel)'
      );
    `);
    console.log('[INIT-DB] Registre RGPD — sous-traitance IA Anthropic ✓');

    // ══════════════════════════════════════════
    // Module Pilotage RSE (RSEI-10) — 28e module
    //
    // Outille la démarche de labellisation RSEi (référentiel 2026, évaluation
    // AFNOR) : les 27 critères du référentiel, le plan d'action RSE, le registre
    // de preuves (P-AAAA-NNN, péremption/fraîcheur), les campagnes d'auto-évaluation
    // et d'audit interne, la matrice des parties prenantes et le journal des
    // dialogues/réclamations. Cadrage : rapports/rsei-2026-07-22/03 §3 ; méthode
    // du référent : rapport 02 (§4 grille de cotation, §6 registre, §7 tableau
    // de bord). CONFIDENTIALITÉ by design : ce module ne manipule QUE des agrégats
    // non nominatifs — aucune donnée individuelle de parcours n'y entre (jamais de
    // JOIN sur les tables insertion nominatives ; les indicateurs insertion sont
    // lus via les endpoints agrégés existants). Toutes les tables créées après
    // users (FK pilote/responsable/created_by).
    // ══════════════════════════════════════════

    // (a) Les 27 critères du référentiel (versionnés par `referentiel`). Le niveau
    //     visé et le niveau auto-évalué sont NULLABLES = « non coté » : doctrine
    //     « jamais de valeur inventée » (rapport 02 §4.2). 1 pilote métier / critère.
    await client.query(`
      CREATE TABLE IF NOT EXISTS rsei_criteres (
        id SERIAL PRIMARY KEY,
        referentiel VARCHAR(30) NOT NULL DEFAULT 'RSEi-2026',
        chapitre SMALLINT NOT NULL CHECK (chapitre BETWEEN 1 AND 5),
        code VARCHAR(10) NOT NULL,
        intitule TEXT NOT NULL,
        niveau_vise SMALLINT CHECK (niveau_vise BETWEEN 1 AND 4),
        niveau_auto_evalue SMALLINT CHECK (niveau_auto_evalue BETWEEN 1 AND 4),
        pilote_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        commentaire TEXT,
        ordre INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (referentiel, code)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_criteres_ref ON rsei_criteres(referentiel);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_criteres_pilote ON rsei_criteres(pilote_user_id);');

    // Seed idempotent des 27 critères EXACTS (référentiel RSEi-2026). Les niveaux
    // restent NULL (non cotés). ON CONFLICT (referentiel, code) DO NOTHING : un
    // réimport ne réécrit jamais un critère déjà coté par le référent.
    await client.query(`
      INSERT INTO rsei_criteres (referentiel, chapitre, code, intitule, ordre) VALUES
        ('RSEi-2026', 1, '1.1', 'Projet d''entreprise et modèle d''affaires', 1),
        ('RSEi-2026', 1, '1.2', 'Identification et dialogue avec les parties prenantes', 2),
        ('RSEi-2026', 1, '1.3', 'Gouvernance et instances de décisions stratégiques', 3),
        ('RSEi-2026', 1, '1.4', 'Ancrage territorial', 4),
        ('RSEi-2026', 1, '1.5', 'Pilotage du projet d''entreprise et plan d''action RSE', 5),
        ('RSEi-2026', 1, '1.6', 'Veille technologique et concurrentielle', 6),
        ('RSEi-2026', 1, '1.7', 'Achats durables et socialement responsables', 7),
        ('RSEi-2026', 1, '1.8', 'Indicateurs économiques et de gouvernance responsables', 8),
        ('RSEi-2026', 2, '2.1', 'Emplois et compétences', 9),
        ('RSEi-2026', 2, '2.2', 'Promotion de l''égalité et de la diversité', 10),
        ('RSEi-2026', 2, '2.3', 'Dialogue social', 11),
        ('RSEi-2026', 2, '2.4', 'Santé et sécurité au travail', 12),
        ('RSEi-2026', 2, '2.5', 'Organisation, contenu et réalisation du travail', 13),
        ('RSEi-2026', 2, '2.6', 'Indicateurs liés aux ressources humaines', 14),
        ('RSEi-2026', 3, '3.1', 'Mission d''inclusion', 15),
        ('RSEi-2026', 3, '3.2', 'Accueil, recrutement et intégration', 16),
        ('RSEi-2026', 3, '3.3', 'Accompagnement durant le parcours', 17),
        ('RSEi-2026', 3, '3.4', 'Préparation à la sortie', 18),
        ('RSEi-2026', 4, '4.1', 'Démarche environnementale', 19),
        ('RSEi-2026', 4, '4.2', 'Énergies et GES', 20),
        ('RSEi-2026', 4, '4.3', 'Préservation de la ressource et contribution à l''économie circulaire', 21),
        ('RSEi-2026', 4, '4.4', 'Sensibilisation aux enjeux environnementaux et partenariats', 22),
        ('RSEi-2026', 4, '4.5', 'Indicateurs environnementaux', 23),
        ('RSEi-2026', 5, '5.1', 'Évaluations internes', 24),
        ('RSEi-2026', 5, '5.2', 'Analyse des résultats', 25),
        ('RSEi-2026', 5, '5.3', 'Évaluation de la satisfaction des parties prenantes', 26),
        ('RSEi-2026', 5, '5.4', 'Bilan et amélioration du plan d''action RSE', 27)
      ON CONFLICT (referentiel, code) DO NOTHING;
    `);

    // (b) Plan d'action RSE (décalque de cip_action_plans). Un ou plusieurs
    //     critères servis (critere_codes TEXT[]).
    await client.query(`
      CREATE TABLE IF NOT EXISTS rsei_actions (
        id SERIAL PRIMARY KEY,
        titre TEXT NOT NULL,
        description TEXT,
        critere_codes TEXT[] NOT NULL DEFAULT '{}',
        responsable_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        indicateur TEXT,
        echeance DATE,
        moyens TEXT,
        statut VARCHAR(15) NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'en_cours', 'realise', 'abandonne')),
        priorite VARCHAR(10) NOT NULL DEFAULT 'moyenne' CHECK (priorite IN ('haute', 'moyenne', 'basse')),
        date_realisation DATE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // date_realisation (revue Codex PR#75) : date effective de solde d'une
    // action, pour distinguer « soldée à l'échéance » d'un simple statut realise.
    await client.query(`ALTER TABLE rsei_actions ADD COLUMN IF NOT EXISTS date_realisation DATE;`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_actions_statut ON rsei_actions(statut);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_actions_echeance ON rsei_actions(echeance);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_actions_responsable ON rsei_actions(responsable_user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_actions_criteres ON rsei_actions USING GIN (critere_codes);');

    // (c) Registre de preuves (rapport 02 §6). Référence P-AAAA-NNN générée à la
    //     création. `source` = module ERP ou externe ; `lien_interne` = deep-link
    //     vers un écran ERP (référencer plutôt que dupliquer) ; `fichier_path` =
    //     pièce uploadée (pattern justificatifs Refashion) ; `echeance_fraicheur`
    //     = date de péremption (< 12 mois pour les preuves d'activité, §4.3).
    await client.query(`
      CREATE TABLE IF NOT EXISTS rsei_preuves (
        id SERIAL PRIMARY KEY,
        reference VARCHAR(20) NOT NULL UNIQUE,
        intitule TEXT NOT NULL,
        critere_codes TEXT[] NOT NULL DEFAULT '{}',
        type VARCHAR(30),
        source VARCHAR(120),
        lien_interne TEXT,
        fichier_path TEXT,
        fichier_original_name TEXT,
        fichier_mime VARCHAR(120),
        date_preuve DATE,
        echeance_fraicheur DATE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_preuves_fraicheur ON rsei_preuves(echeance_fraicheur);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_preuves_date ON rsei_preuves(date_preuve);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_preuves_criteres ON rsei_preuves USING GIN (critere_codes);');

    // (d) Campagnes d'évaluation (auto-évaluation annuelle + audit interne 5.1).
    await client.query(`
      CREATE TABLE IF NOT EXISTS rsei_evaluations (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL CHECK (type IN ('auto_evaluation', 'audit_interne')),
        libelle TEXT NOT NULL,
        date_evaluation DATE,
        evaluateur_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        statut VARCHAR(15) NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'cloturee')),
        synthese TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_evaluations_date ON rsei_evaluations(date_evaluation);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_evaluations_statut ON rsei_evaluations(statut);');

    // (e) Cotation par critère d'une campagne (constat + écart + action corrective
    //     liée). UNIQUE(evaluation_id, critere_code) : une cotation par critère.
    //     FK action_id déclarée APRÈS rsei_actions (créée en (b)).
    await client.query(`
      CREATE TABLE IF NOT EXISTS rsei_evaluation_items (
        id SERIAL PRIMARY KEY,
        evaluation_id INTEGER NOT NULL REFERENCES rsei_evaluations(id) ON DELETE CASCADE,
        critere_code VARCHAR(10) NOT NULL,
        niveau_constate SMALLINT CHECK (niveau_constate BETWEEN 1 AND 4),
        constat TEXT,
        ecart TEXT,
        action_id INTEGER REFERENCES rsei_actions(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (evaluation_id, critere_code)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_eval_items_eval ON rsei_evaluation_items(evaluation_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_eval_items_critere ON rsei_evaluation_items(critere_code);');

    // (f) Matrice d'impact des parties prenantes (1.2).
    await client.query(`
      CREATE TABLE IF NOT EXISTS rsei_parties_prenantes (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        categorie VARCHAR(30),
        influence SMALLINT CHECK (influence BETWEEN 1 AND 4),
        interet SMALLINT CHECK (interet BETWEEN 1 AND 4),
        attentes TEXT,
        actif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_pp_categorie ON rsei_parties_prenantes(categorie);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_pp_actif ON rsei_parties_prenantes(actif);');

    // (g) Journal des dialogues / demandes / réclamations des PP (5.3 N2).
    await client.query(`
      CREATE TABLE IF NOT EXISTS rsei_interactions (
        id SERIAL PRIMARY KEY,
        partie_prenante_id INTEGER NOT NULL REFERENCES rsei_parties_prenantes(id) ON DELETE CASCADE,
        date_interaction DATE,
        canal VARCHAR(60),
        objet TEXT,
        type VARCHAR(15) NOT NULL DEFAULT 'dialogue' CHECK (type IN ('dialogue', 'demande', 'reclamation', 'information')),
        reponse_apportee TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_interactions_pp ON rsei_interactions(partie_prenante_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsei_interactions_date ON rsei_interactions(date_interaction);');

    // Registre RGPD — traitement « Pilotage RSE » (agrégats non nominatifs).
    // Idempotent via WHERE NOT EXISTS. Documente la minimisation : ce module ne
    // contient AUCUNE donnée individuelle de parcours (confidentialité ch. 3).
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Pilotage RSE (agrégats non nominatifs)',
        'Pilotage et évaluation de la démarche RSE en vue de la labellisation RSEi (référentiel 2026, évaluation AFNOR) : tableau de bord des 27 critères, plan d''action RSE, registre de preuves, campagnes d''auto-évaluation et d''audit interne, matrice des parties prenantes et journal des dialogues/réclamations. AUCUNE donnée individuelle de salarié en parcours n''est traitée dans ce module (les indicateurs d''inclusion sont lus sous forme d''agrégats non nominatifs).',
        'Intérêt légitime (démarche volontaire de RSE et de labellisation)',
        'Utilisateurs internes (pilotes de critères, référent RSE, direction) ; contacts des parties prenantes externes (financeurs, prescripteurs, clients, collectivités, fournisseurs, partenaires)',
        'Rattachements utilisateurs (pilote / responsable d''action / évaluateur), preuves documentaires et liens internes, cotations de maturité, coordonnées et attentes des parties prenantes externes, journal des interactions. AUCUNE donnée de catégorie particulière ni donnée nominative de parcours d''insertion.',
        'Référent RSE, direction, pilotes de critères ; évaluateur AFNOR (consultation in situ le cas échéant)',
        'Cycle de labellisation en cours + cycle précédent (6 ans glissants)',
        'Accès restreint (lecture ADMIN/MANAGER/RH — dont rôle personnalisé REF_RSE de base MANAGER ; écriture ADMIN/RH), journalisation applicative (autoLogActivity), agrégats non nominatifs uniquement, uploads filtrés (MIME + extension) et servis avec en-têtes anti-sniffing'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Pilotage RSE (agrégats non nominatifs)'
      );
    `);
    console.log('[INIT-DB] Module Pilotage RSE (RSEI-10) — 7 tables + 27 critères + registre RGPD ✓');

    // ══════════════════════════════════════════
    // Module Énergie & GES (RSEI-11) — 29e module
    //
    // Comble le critère 4.2 « Énergies et GES » (le seul à 0 du référentiel RSEi)
    // et alimente 4.1 / 4.5 (B3 énergie/GES, B6 eau de l'export VSME RSEI-09).
    // Cadrage : rapports/rsei-2026-07-22/03-plan-action-rsei.md §2.2 (RSEI-11).
    //   (a) énergie bâtiments : relevés mensuels par site/compteur (électricité,
    //       gaz, eau) ;
    //   (b) carburant flotte : pleins par véhicule (date, litres, €, km) → L/100 km,
    //       la dérive = signal maintenance (synergie module véhicules) ;
    //   (c) conversion GES méthode ADEME — même mécanique que metropole.js (CO2
    //       évité), mais facteurs DISTINCTS pour les émissions PROPRES, stockés en
    //       base et PARAMÉTRABLES (ges_facteurs). Intensité tCO2e / CA.
    // Toutes les tables créées après users (FK saisi_par) et vehicles (FK des
    // pleins), déjà présentes plus haut → chemin « base neuve » sûr.
    // ══════════════════════════════════════════

    // (a) Sites / bâtiments de la structure.
    await client.query(`
      CREATE TABLE IF NOT EXISTS energie_sites (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(120) NOT NULL,
        adresse TEXT,
        actif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_energie_sites_actif ON energie_sites(actif);');
    // Seed idempotent d'au moins le siège (Le Houlme) — WHERE NOT EXISTS (pas de
    // clé naturelle unique sur nom : un réimport ne recrée pas de doublon).
    await client.query(`
      INSERT INTO energie_sites (nom, adresse)
      SELECT 'Siège — Le Houlme', 'Centre de tri, Le Houlme (76)'
      WHERE NOT EXISTS (SELECT 1 FROM energie_sites WHERE nom = 'Siège — Le Houlme');
    `);

    // (b) Compteurs d'un site (électricité, gaz, eau, autre). unite par défaut
    //     'kWh' (mettre 'm3' pour l'eau et le gaz facturé au m3).
    await client.query(`
      CREATE TABLE IF NOT EXISTS energie_compteurs (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES energie_sites(id) ON DELETE CASCADE,
        type VARCHAR(15) NOT NULL CHECK (type IN ('electricite', 'gaz', 'eau', 'autre')),
        reference VARCHAR(80),
        unite VARCHAR(10) NOT NULL DEFAULT 'kWh',
        actif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_energie_compteurs_site ON energie_compteurs(site_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_energie_compteurs_actif ON energie_compteurs(actif);');

    // (c) Relevés mensuels d'un compteur (consommation de la période + coût €).
    //     UNIQUE(compteur, année, mois) : un relevé par compteur et par mois.
    await client.query(`
      CREATE TABLE IF NOT EXISTS energie_releves (
        id SERIAL PRIMARY KEY,
        compteur_id INTEGER NOT NULL REFERENCES energie_compteurs(id) ON DELETE CASCADE,
        periode_annee SMALLINT NOT NULL,
        periode_mois SMALLINT NOT NULL CHECK (periode_mois BETWEEN 1 AND 12),
        valeur NUMERIC(14,3) NOT NULL,
        cout_euros NUMERIC(12,2),
        saisi_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (compteur_id, periode_annee, periode_mois)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_energie_releves_compteur ON energie_releves(compteur_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_energie_releves_periode ON energie_releves(periode_annee, periode_mois);');

    // (d) Pleins de carburant par véhicule (rapprochés du kilométrage relevé au
    //     plein → L/100 km). vehicle_id SET NULL (un plein reste tracé même si le
    //     véhicule est supprimé). km_compteur = relevé du compteur AU plein (saisie
    //     terrain : les checklists mobiles / GPS ne donnent pas le km à la pompe).
    await client.query(`
      CREATE TABLE IF NOT EXISTS carburant_pleins (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
        date_plein DATE NOT NULL,
        litres NUMERIC(10,2) NOT NULL,
        cout_euros NUMERIC(12,2),
        km_compteur INTEGER,
        type_carburant VARCHAR(12) NOT NULL DEFAULT 'gazole'
          CHECK (type_carburant IN ('gazole', 'essence', 'gnv', 'electrique', 'adblue', 'autre')),
        saisi_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_carburant_pleins_vehicle ON carburant_pleins(vehicle_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_carburant_pleins_date ON carburant_pleins(date_plein);');

    // (e) Facteurs d'émission GES (kg CO2e par unité), méthode ADEME. STOCKÉS EN
    //     BASE et PARAMÉTRABLES (édition ADMIN/RH via PUT /api/energie/facteurs) —
    //     à la différence des facteurs de CO2 ÉVITÉ hardcodés de metropole.js, ces
    //     facteurs d'émissions PROPRES doivent pouvoir être ajustés/versionnés.
    //     UNIQUE(poste, annee).
    //
    //     ⚠ VALEURS INDICATIVES à ajuster par la structure — elles ne prétendent PAS
    //     à l'exactitude réglementaire. Ordres de grandeur « usage France »,
    //     sources ADEME Base Empreinte (à confirmer/millésimer par le référent RSE).
    //     Repères indicatifs : électricité ~0,052 kgCO2e/kWh (usage) ; gaz naturel
    //     ~0,227 kgCO2e/kWh PCI ; eau ~0,132 kgCO2e/m3 ; gazole ~2,51 kgCO2e/L ;
    //     essence ~2,28 kgCO2e/L ; GNV ~2,96 kgCO2e/kg.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ges_facteurs (
        id SERIAL PRIMARY KEY,
        poste VARCHAR(20) NOT NULL,
        unite VARCHAR(10) NOT NULL,
        facteur_kgco2e NUMERIC(12,5) NOT NULL,
        source VARCHAR(120) NOT NULL DEFAULT 'ADEME Base Empreinte',
        annee SMALLINT,
        actif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (poste, annee)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_ges_facteurs_poste ON ges_facteurs(poste);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ges_facteurs_actif ON ges_facteurs(actif);');
    // Seed idempotent (ON CONFLICT (poste, annee) DO NOTHING). Millésime 2024
    // (concret pour que ON CONFLICT s'applique). Valeurs INDICATIVES et
    // PARAMÉTRABLES — la structure les ajuste avec ses propres facteurs ADEME.
    await client.query(`
      INSERT INTO ges_facteurs (poste, unite, facteur_kgco2e, source, annee) VALUES
        ('electricite', 'kWh', 0.05200, 'ADEME Base Empreinte (indicatif, à ajuster)', 2024),
        ('gaz',         'kWh', 0.22700, 'ADEME Base Empreinte (indicatif, à ajuster)', 2024),
        ('eau',         'm3',  0.13200, 'ADEME Base Empreinte (indicatif, à ajuster)', 2024),
        ('gazole',      'L',   2.51000, 'ADEME Base Empreinte (indicatif, à ajuster)', 2024),
        ('essence',     'L',   2.28000, 'ADEME Base Empreinte (indicatif, à ajuster)', 2024),
        ('gnv',         'kg',  2.96000, 'ADEME Base Empreinte (indicatif, à ajuster)', 2024)
      ON CONFLICT (poste, annee) DO NOTHING;
    `);

    // Registre RGPD — traitement « Énergie & GES » (données quasi non personnelles).
    // Idempotent via WHERE NOT EXISTS. Minimisation : seules des consommations et
    // des pleins (données techniques) + le rattachement de l'utilisateur ayant SAISI
    // la donnée (saisi_par) sont conservés — aucune donnée personnelle sensible.
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Énergie & GES (mesure des impacts environnementaux propres)',
        'Mesurer les consommations d''énergie des bâtiments (électricité, gaz, eau) et de carburant de la flotte, calculer les émissions de GES (méthode ADEME, facteurs paramétrables) et l''intensité carbone, au titre de la démarche RSE (critère RSEi 4.2) et de l''export VSME (B3/B6).',
        'Intérêt légitime (démarche volontaire de RSE et de mesure d''impact environnemental)',
        'Utilisateurs internes ayant saisi les relevés/pleins (saisi_par)',
        'Consommations d''énergie et d''eau par site/compteur, pleins de carburant par véhicule (date, litres, coût, kilométrage), facteurs d''émission. Rattachement à l''utilisateur ayant effectué la saisie. AUCUNE donnée de catégorie particulière.',
        'Référent RSE, direction, QHSE, RH',
        'Historique de mesure conservé pour le suivi pluriannuel (≥ 5 ans, piste d''audit environnemental)',
        'Accès restreint (lecture ADMIN/MANAGER/RH/QHSE ; écriture ADMIN/RH/MANAGER ; facteurs d''émission éditables ADMIN/RH), requêtes SQL paramétrées, journalisation applicative (autoLogActivity)'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Énergie & GES (mesure des impacts environnementaux propres)'
      );
    `);
    console.log('[INIT-DB] Module Énergie & GES (RSEI-11) — 5 tables + 6 facteurs ADEME + siège + registre RGPD ✓');

    // ══════════════════════════════════════════
    // Module Enquêtes (RSEI-13) — 30e module
    //
    // Mini-moteur GÉNÉRIQUE de questionnaires ANONYMES : modèles administrables
    // (échelles + texte libre), diffusion par lien/QR (token de campagne), mode
    // kiosque FALC, restitution AGRÉGÉE avec SEUIL D'ANONYMAT n ≥ 5, archivage des
    // campagnes = preuve datée. Cadrage : rapports/rsei-2026-07-22/03 §2.2 (RSEI-13).
    // Usages : enquête conditions de travail/QVCT tous salariés (2.5), mesure de
    // participation aux sensibilisations (4.4), questionnaire d'intégration M1
    // (RSEI-14, 3.2), enquêtes PP externes (RSEI-16).
    //
    // ANONYMAT RÉEL by design (principe du module) : la table des RÉPONSES ne porte
    // AUCUNE clé étrangère vers users/employees. Une réponse à une campagne anonyme
    // n'est rattachée à personne — seul un `jeton_unicite` FACULTATIF (opaque, sans
    // identité) permet d'éviter les doublons. Le seuil n ≥ 5 est appliqué à la
    // RESTITUTION (routes/enquetes.js), pas au stockage. Registre RGPD dédié.
    // ══════════════════════════════════════════

    // pgcrypto requis pour gen_random_bytes (token de campagne) — idempotent. Ce
    // module est en fin d'init-db (chemin « base neuve »), on (re)garantit l'extension.
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // (a) Modèles de questionnaire (réutilisables). `anonyme` gouverne la
    //     restitution (verbatims bruts seulement si anonyme, cf. routes). `categorie`
    //     classe l'usage RSEi (qvct / satisfaction / integration / sensibilisation /
    //     parties_prenantes / autre).
    await client.query(`
      CREATE TABLE IF NOT EXISTS enquete_modeles (
        id SERIAL PRIMARY KEY,
        titre TEXT NOT NULL,
        description TEXT,
        categorie VARCHAR(20) NOT NULL DEFAULT 'autre'
          CHECK (categorie IN ('qvct', 'satisfaction', 'integration', 'sensibilisation', 'parties_prenantes', 'autre')),
        anonyme BOOLEAN NOT NULL DEFAULT true,
        actif BOOLEAN NOT NULL DEFAULT true,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_enquete_modeles_categorie ON enquete_modeles(categorie);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_enquete_modeles_actif ON enquete_modeles(actif);');

    // (b) Questions d'un modèle. `type` : echelle / choix_unique / choix_multiple /
    //     texte / oui_non / note_10. `options` JSONB = libellés de choix (pour les
    //     types à choix). CASCADE : supprimer un modèle supprime ses questions.
    await client.query(`
      CREATE TABLE IF NOT EXISTS enquete_questions (
        id SERIAL PRIMARY KEY,
        modele_id INTEGER NOT NULL REFERENCES enquete_modeles(id) ON DELETE CASCADE,
        ordre INTEGER NOT NULL DEFAULT 0,
        libelle TEXT NOT NULL,
        type VARCHAR(15) NOT NULL
          CHECK (type IN ('echelle', 'choix_unique', 'choix_multiple', 'texte', 'oui_non', 'note_10')),
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        obligatoire BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_enquete_questions_modele ON enquete_questions(modele_id, ordre);');

    // (c) Campagnes de diffusion d'un modèle. `token` (hex 32) = lien de réponse
    //     anonyme (diffusion lien/QR, pattern qr_token véhicule). `statut` :
    //     brouillon → ouverte → close. modele_id en REFERENCES SANS cascade
    //     (NO ACTION) : une campagne archivée = preuve datée, elle protège son
    //     modèle de la suppression (DELETE modèle → 409 s'il a des campagnes).
    await client.query(`
      CREATE TABLE IF NOT EXISTS enquete_campagnes (
        id SERIAL PRIMARY KEY,
        modele_id INTEGER NOT NULL REFERENCES enquete_modeles(id),
        titre TEXT NOT NULL,
        public_cible VARCHAR(120),
        token VARCHAR(64) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
        date_ouverture DATE,
        date_cloture DATE,
        statut VARCHAR(12) NOT NULL DEFAULT 'brouillon'
          CHECK (statut IN ('brouillon', 'ouverte', 'close')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_enquete_campagnes_modele ON enquete_campagnes(modele_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_enquete_campagnes_statut ON enquete_campagnes(statut);');
    // idx sur token superflu (UNIQUE crée déjà l'index).

    // (d) Réponses anonymes. ⚠ AUCUNE FK vers users/employees : le principe même du
    //     module est l'anonymat. `reponses` JSONB = { question_id → valeur }.
    //     `jeton_unicite` FACULTATIF (opaque, sans identité) : anti-doublon sans
    //     identifier — unique PAR campagne quand renseigné (index partiel).
    await client.query(`
      CREATE TABLE IF NOT EXISTS enquete_reponses (
        id SERIAL PRIMARY KEY,
        campagne_id INTEGER NOT NULL REFERENCES enquete_campagnes(id) ON DELETE CASCADE,
        submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        jeton_unicite VARCHAR(80),
        reponses JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_enquete_reponses_campagne ON enquete_reponses(campagne_id);');
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_enquete_reponses_jeton
       ON enquete_reponses(campagne_id, jeton_unicite) WHERE jeton_unicite IS NOT NULL;`
    );

    // Registre RGPD — traitement « Enquêtes internes » (anonymes, agrégats n≥5).
    // Idempotent via WHERE NOT EXISTS. Minimisation : les réponses ne portent aucune
    // identité ; la restitution est agrégée avec un seuil d'anonymat strict (n≥5).
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Enquêtes internes (anonymes, agrégats seuil n≥5)',
        'Recueillir de manière ANONYME l''avis des salariés et des parties prenantes (conditions de travail/QVCT, satisfaction, intégration, participation aux sensibilisations) via des questionnaires diffusés par lien/QR, au titre de la démarche RSE (critères RSEi 2.5, 5.3, 3.2, 4.4). La restitution est exclusivement AGRÉGÉE et soumise à un SEUIL D''ANONYMAT (aucun détail en deçà de 5 réponses).',
        'Intérêt légitime (démarche volontaire de RSE ; écoute des parties prenantes)',
        'Salariés et parties prenantes répondant volontairement et anonymement aux campagnes',
        'Réponses aux questionnaires (échelles, choix, notes, texte libre). AUCUNE donnée d''identité n''est collectée pour une campagne anonyme : les réponses ne sont rattachées à aucun utilisateur ni salarié. Un jeton d''unicité facultatif et opaque (anti-doublon) ne permet pas de ré-identifier le répondant. AUCUNE donnée de catégorie particulière attendue.',
        'Référent RSE, direction, RH, QHSE (résultats agrégés uniquement)',
        'Campagnes archivées comme preuve datée de la démarche (cycle de labellisation + cycle précédent)',
        'Anonymat structurel (aucune FK vers users/employees sur les réponses), seuil d''anonymat n≥5 appliqué à la restitution, endpoints de réponse publics sans collecte d''identité, requêtes SQL paramétrées, journalisation applicative côté administration (autoLogActivity)'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Enquêtes internes (anonymes, agrégats seuil n≥5)'
      );
    `);
    console.log('[INIT-DB] Module Enquêtes (RSEI-13) — 4 tables + registre RGPD ✓');

    // ══════════════════════════════════════════
    // MODULE 33 — TEMPS & PRÉSENCE (badgeuse)
    //
    // EMPLACEMENT : cette section est volontairement placée AVANT celle du
    // module « Achats responsables » et non en fin de fichier. Le test
    // tests/unit/scripts/achats-schema.test.js vérifie que la section Achats
    // ne contient aucune table nominative en la délimitant jusqu'au bloc
    // « HOTFIX 2026-05 — Resync » : un module inséré entre les deux tomberait
    // dans ce périmètre et ferait échouer cette garde à tort (badgeuse_badges
    // référence légitimement employees). Ne pas déplacer plus bas sans borner
    // d'abord la tranche de ce test.
    //
    // Badgeuse physique (poste Raspberry Pi + lecteur RFID) et back-office de
    // gestion du temps. Références : docs/badgeuse/MODELE_DONNEES.md,
    // CONTRAT_API_DEVICE.md, CONTRAT_INTEGRITE.md, CONTRAT_HMAC.md,
    // ADR-0001/0002/0003.
    //
    // MODULE NEUF ET DISTINCT (ADR-0003) : préfixe `badgeuse_`, routes
    // /api/badgeuse/*. Le module 25 « Pointage » legacy (tables
    // pointage_terminals / badges / pointage_events) n'est NI modifié NI
    // supprimé — les deux coexistent sans interférence de données. Le module
    // badgeuse n'écrit PAS dans work_hours ni employee_week_hours (pas de
    // double comptage avec l'import paie ; l'export fichier est le seul
    // livrable paie de la V1).
    //
    // EXIGENCES STRUCTURELLES portées par ce schéma :
    //  - MINIMISATION : aucune colonne d'UID de badge en clair (uniquement
    //    `uid_hmac`), AUCUNE colonne photo (NOTE_JURIDIQUE §3.4 : exclusion
    //    absolue), aucune donnée de santé ni de statut IAE.
    //  - INALTÉRABILITÉ : badgeuse_pointages porte une chaîne cryptographique
    //    par poste (hash_precedent / hash_courant / chaine_valide). Les champs
    //    couverts par la chaîne ne sont JAMAIS mis à jour ; aucun DELETE dans
    //    le code applicatif (seule la purge RGPD planifiée supprime, BO-10).
    //  - IDEMPOTENCE : uuid UNIQUE + (device_id, sequence_device) unique
    //    partiel — le rejeu d'un lot ne duplique aucune heure.
    //  - TRAÇABILITÉ DU TRAITEMENT : les corrections sont ADDITIVES (table
    //    séparée), l'enregistrement brut reste intact.
    // ══════════════════════════════════════════

    // (a) Sites. Multi-site dès la V1 (risque « extension Vernon », SPEC §9).
    //     La clé HMAC du site vit dans `settings` (badgeuse.hmac_key_site_<id>),
    //     CHIFFRÉE AES-256-GCM — jamais en base en clair, jamais dans Git.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_sites (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        libelle VARCHAR(120),
        actif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      INSERT INTO badgeuse_sites (code, libelle)
      SELECT 'LH', 'Le Houlme — atelier'
      WHERE NOT EXISTS (SELECT 1 FROM badgeuse_sites WHERE code = 'LH');
    `);
    //     Coordonnées du site (écran de veille : météo du LIEU du poste).
    //     Volontairement NULLABLES et NON seedées : tant qu'elles ne sont pas
    //     renseignées, la météo retombe sur le réglage `badgeuse.meteo_*`
    //     (cascade documentée). Poser ici une valeur « probable » reviendrait à
    //     afficher la météo d'un endroit que personne n'a validé.
    await client.query('ALTER TABLE badgeuse_sites ADD COLUMN IF NOT EXISTS latitude NUMERIC(8,4);');
    await client.query('ALTER TABLE badgeuse_sites ADD COLUMN IF NOT EXISTS longitude NUMERIC(8,4);');

    // (b) Postes de pointage. `api_key_hash` = SHA-256 hex de la clé device :
    //     la clé elle-même n'est montrée qu'UNE FOIS à l'appairage et n'est
    //     jamais stockée. Comparaison à temps constant côté route.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_devices (
        id SERIAL PRIMARY KEY,
        code VARCHAR(30) NOT NULL UNIQUE,
        libelle VARCHAR(120),
        site_id INTEGER REFERENCES badgeuse_sites(id) ON DELETE SET NULL,
        api_key_hash VARCHAR(64),
        actif BOOLEAN NOT NULL DEFAULT true,
        version_logicielle VARCHAR(30),
        cible VARCHAR(10),
        dernier_heartbeat TIMESTAMPTZ,
        heartbeat_info JSONB,
        cree_le TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_devices_site ON badgeuse_devices(site_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_devices_actif ON badgeuse_devices(actif);');

    // (c) Badges. `uid_hmac` UNIQUE = HMAC-SHA256(clé de site, UID normalisé) —
    //     CONTRAT_HMAC : l'UID en clair n'existe NI côté poste NI côté serveur.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_badges (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        uid_hmac VARCHAR(64) NOT NULL,
        statut VARCHAR(15) NOT NULL DEFAULT 'actif'
          CHECK (statut IN ('actif', 'perdu', 'vole', 'restitue', 'desactive')),
        attribue_le TIMESTAMPTZ DEFAULT NOW(),
        restitue_le TIMESTAMPTZ,
        commentaire VARCHAR(300),
        cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Un seul badge ACTIF par salarié (index partiel unique) — un badge déclaré
    // perdu/volé libère immédiatement la place pour son remplaçant.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_badgeuse_badges_actif_unique
      ON badgeuse_badges(employee_id) WHERE statut = 'actif';
    `);
    // Un badge physique SURVIT aux personnes : au depart d'un salarie, le meme
    // support est reattribue. L'unicite ne porte donc PAS sur l'empreinte dans
    // l'absolu (l'historique garde une ligne par periode de detention) mais sur
    // l'empreinte ACTIVE : une seule personne porte un badge donne a la fois.
    // Migration : la contrainte UNIQUE de colonne des premieres versions est
    // levee si elle existe (DO-scan pg_constraint — son nom est genere).
    await client.query(`
      DO $$ DECLARE c RECORD; BEGIN
        FOR c IN SELECT conname FROM pg_constraint
                 WHERE conrelid = 'badgeuse_badges'::regclass AND contype = 'u'
        LOOP
          EXECUTE format('ALTER TABLE badgeuse_badges DROP CONSTRAINT %I', c.conname);
        END LOOP;
      END $$;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_badgeuse_badges_uid_actif_unique
      ON badgeuse_badges(uid_hmac) WHERE statut = 'actif';
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_badges_employee ON badgeuse_badges(employee_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_badges_statut ON badgeuse_badges(statut);');

    // (d) Historique complet du cycle de vie d'un badge (BO-01).
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_badge_historique (
        id SERIAL PRIMARY KEY,
        badge_id INTEGER REFERENCES badgeuse_badges(id) ON DELETE CASCADE,
        evenement VARCHAR(30) NOT NULL
          CHECK (evenement IN ('attribution', 'perte', 'vol', 'restitution', 'desactivation', 'reactivation')),
        details JSONB,
        auteur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_badge_historique_badge ON badgeuse_badge_historique(badge_id);');

    // (e) Pointages bruts — JAMAIS modifiés, JAMAIS supprimés.
    //     employee_id NULL = orphelin non rattaché (badge inconnu / hors plage).
    //     device_id NULL = saisie manuelle serveur.
    //     La chaîne d'intégrité (hash_precedent/hash_courant) est calculée par le
    //     POSTE à la capture (donc hors ligne compris) et VÉRIFIÉE par le serveur
    //     à la réception : en cas de rupture le pointage est stocké quand même
    //     avec chaine_valide=false — on n'efface jamais une preuve, même imparfaite.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_pointages (
        id BIGSERIAL PRIMARY KEY,
        uuid UUID NOT NULL UNIQUE,
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        device_id INTEGER REFERENCES badgeuse_devices(id) ON DELETE SET NULL,
        uid_hmac VARCHAR(64),
        horodatage_utc TIMESTAMPTZ NOT NULL,
        horodatage_local VARCHAR(30),
        fuseau VARCHAR(40) DEFAULT 'Europe/Paris',
        sens VARCHAR(10) NOT NULL DEFAULT 'inconnu'
          CHECK (sens IN ('entree', 'sortie', 'inconnu')),
        source VARCHAR(10) NOT NULL DEFAULT 'badge'
          CHECK (source IN ('badge', 'manuel', 'import')),
        statut VARCHAR(10) NOT NULL DEFAULT 'brut'
          CHECK (statut IN ('brut', 'traite', 'orphelin')),
        orphelin_raison VARCHAR(30),
        sequence_device BIGINT,
        hash_precedent VARCHAR(64),
        hash_courant VARCHAR(64),
        chaine_valide BOOLEAN NOT NULL DEFAULT true,
        recu_le TIMESTAMPTZ DEFAULT NOW(),
        cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_pointages_employee_date ON badgeuse_pointages(employee_id, horodatage_utc);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_pointages_horodatage ON badgeuse_pointages(horodatage_utc);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_pointages_statut ON badgeuse_pointages(statut);');
    // Idempotence forte : une séquence de poste ne peut être réutilisée.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_badgeuse_pointages_device_sequence
      ON badgeuse_pointages(device_id, sequence_device) WHERE device_id IS NOT NULL;
    `);

    // (f) Corrections ADDITIVES (BO-03). L'enregistrement brut est intouché :
    //     une correction s'AJOUTE et porte son motif (liste FERMÉE — un champ
    //     libre serait proscrit par la minimisation, NOTE_JURIDIQUE §3.4) et son
    //     auteur. `motif_detail` n'est exigé que pour le motif 'autre'
    //     (contrainte applicative, cf. routes/badgeuse.js).
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_corrections (
        id SERIAL PRIMARY KEY,
        pointage_id BIGINT REFERENCES badgeuse_pointages(id) ON DELETE SET NULL,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type VARCHAR(15) NOT NULL CHECK (type IN ('ajout', 'modification', 'annulation')),
        horodatage_corrige TIMESTAMPTZ,
        sens_corrige VARCHAR(10) CHECK (sens_corrige IN ('entree', 'sortie')),
        motif_code VARCHAR(30) NOT NULL
          CHECK (motif_code IN ('oubli_badge', 'badge_defaillant', 'mission_exterieure', 'rdv_accompagnement', 'formation', 'autre')),
        motif_detail VARCHAR(200),
        auteur_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_corrections_employee ON badgeuse_corrections(employee_id, horodatage_corrige);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_corrections_pointage ON badgeuse_corrections(pointage_id);');

    // (g) Feuilles de temps mensuelles (BO-04) — circuit encadrant → RH.
    //     `detail` JSONB = journées calculées par services/badgeuse-engine.js
    //     (événements effectifs, heures, anomalies, règles appliquées) : la
    //     feuille porte la TRACE des règles qui l'ont produite.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_feuilles_temps (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        periode VARCHAR(7) NOT NULL,
        heures_theoriques NUMERIC(6,2),
        heures_pointees NUMERIC(6,2),
        heures_validees NUMERIC(6,2),
        detail JSONB,
        statut VARCHAR(20) NOT NULL DEFAULT 'brouillon'
          CHECK (statut IN ('brouillon', 'validee_encadrant', 'validee_rh')),
        valide_encadrant_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        valide_encadrant_le TIMESTAMPTZ,
        valide_rh_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        valide_rh_le TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(employee_id, periode)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_feuilles_periode ON badgeuse_feuilles_temps(periode);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_feuilles_statut ON badgeuse_feuilles_temps(statut);');

    // (h) Contenus de veille de l'écran (BO-08 / AFF-05).
    //     AUCUNE donnée personnelle : finalité « communication interne »
    //     DISSOCIÉE du décompte du temps (NOTE_JURIDIQUE §3.2) — d'où l'absence
    //     volontaire de toute FK vers employees/users côté contenu diffusé, et
    //     l'interdiction d'un message individuel en veille (§3.5).
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_contenus (
        id SERIAL PRIMARY KEY,
        site_id INTEGER REFERENCES badgeuse_sites(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL DEFAULT 'message'
          CHECK (type IN ('message', 'image', 'planning', 'compte_a_rebours', 'meteo')),
        titre VARCHAR(200),
        corps TEXT,
        media_url VARCHAR(300),
        ordre INTEGER NOT NULL DEFAULT 0,
        duree_sec INTEGER NOT NULL DEFAULT 10 CHECK (duree_sec BETWEEN 5 AND 60),
        visible_du DATE,
        visible_au DATE,
        actif BOOLEAN NOT NULL DEFAULT true,
        cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_contenus_site ON badgeuse_contenus(site_id, actif, ordre);');

    // ── ÉCRAN D'INFORMATION v2 (CDC_AFFICHAGE_V2, ADR-0004) ──────────────────
    //
    // (i) CONSENTEMENT à l'affichage festif (ADR-0004 §4). Afficher un
    //     anniversaire est une divulgation NON NÉCESSAIRE au traitement :
    //     elle exige un consentement libre, recueilli individuellement,
    //     RÉVOCABLE et TRACÉ (date + auteur, plus rgpd_audit_log côté route).
    //     Défaut `false` : l'absence de choix n'est jamais un accord.
    //     Seuls des BOOLÉENS partent ensuite vers le poste — la date de
    //     naissance ne quitte jamais le serveur (CONTRAT_API_DEVICE §3bis).
    await client.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS badgeuse_optin_festif BOOLEAN NOT NULL DEFAULT false;');
    await client.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS badgeuse_optin_festif_le TIMESTAMPTZ;');
    await client.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS badgeuse_optin_festif_par INTEGER REFERENCES users(id) ON DELETE SET NULL;');

    // (i bis) APPAIRAGE PAR CODE COURT (ADR-0005). Mettre un poste en service
    //     exigeait de recopier DEUX clés de 64 caractères hex au clavier d'un
    //     Raspberry : illisible, et première cause d'échec de mise en service.
    //     Un code de 8 caractères, à USAGE UNIQUE et à DURÉE LIMITÉE, est
    //     échangé contre la configuration complète du poste.
    //     `appairage_code_hash` = SHA-256 du code : comme la clé device, le
    //     secret lui-même n'est JAMAIS stocké — il n'est montré qu'une fois à
    //     l'ADMIN. `appairage_expire_le` borne la fenêtre (défaut 15 min,
    //     `badgeuse.appairage_ttl_minutes`) ; les deux colonnes sont remises à
    //     NULL dès la première réclamation réussie (consommation).
    await client.query('ALTER TABLE badgeuse_devices ADD COLUMN IF NOT EXISTS appairage_code_hash VARCHAR(64);');
    await client.query('ALTER TABLE badgeuse_devices ADD COLUMN IF NOT EXISTS appairage_expire_le TIMESTAMPTZ;');

    // (j) Contenus enrichis : médias téléversés / liens rapatriés par le
    //     SERVEUR, et paramètres des générateurs.
    //     `fichier` est un chemin RELATIF à uploads/badgeuse (jamais un chemin
    //     absolu, jamais une URL externe : le poste ne contacte aucun domaine
    //     tiers — la CSP du kiosque reste 'self', ADR-0004 §6).
    //     `source_url` garde la trace du lien d'origine (provenance auditable),
    //     `media_sha256` permet au poste de vérifier son cache local.
    //     `config` JSONB porte les paramètres du générateur (ex. {"nb_actus":3}).
    await client.query('ALTER TABLE badgeuse_contenus ADD COLUMN IF NOT EXISTS fichier VARCHAR(300);');
    await client.query('ALTER TABLE badgeuse_contenus ADD COLUMN IF NOT EXISTS media_type VARCHAR(10);');
    await client.query('ALTER TABLE badgeuse_contenus ADD COLUMN IF NOT EXISTS media_sha256 VARCHAR(64);');
    await client.query('ALTER TABLE badgeuse_contenus ADD COLUMN IF NOT EXISTS source_url VARCHAR(500);');
    await client.query('ALTER TABLE badgeuse_contenus ADD COLUMN IF NOT EXISTS config JSONB;');

    //     Élargissement de la CHECK `type` aux 7 nouveaux types. DO-scan de
    //     pg_constraint (même parade que `milestone_type` du module Insertion
    //     et que `users.role`) : CREATE TABLE IF NOT EXISTS ne re-contraint
    //     JAMAIS une table existante, une base déjà déployée garderait sinon
    //     l'ancienne liste et refuserait tout contenu v2. Idempotent : la
    //     contrainte est reconstruite à l'identique à chaque exécution.
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        FOR cname IN
          SELECT con.conname FROM pg_constraint con
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
          WHERE con.conrelid = 'badgeuse_contenus'::regclass
            AND con.contype = 'c' AND att.attname = 'type'
        LOOP
          EXECUTE 'ALTER TABLE badgeuse_contenus DROP CONSTRAINT ' || quote_ident(cname);
        END LOOP;
        ALTER TABLE badgeuse_contenus ADD CONSTRAINT badgeuse_contenus_type_check
          CHECK (type IN ('message', 'image', 'planning', 'compte_a_rebours', 'meteo',
                          'annonces', 'actus', 'tournees', 'social', 'media', 'lien', 'vak_live',
                          'presse', 'tournees_carte'));
      END $$;
    `);

    // (k) Posts sociaux rapatriés par le serveur (ADR-0004 §6 : API Meta Graph
    //     officielle ou saisie manuelle — JAMAIS de scraping). L'image est
    //     TÉLÉCHARGÉE côté serveur puis servie au poste par l'API device :
    //     le kiosque ne joint aucun domaine externe.
    //     AUCUNE donnée personnelle de salarié : ce sont des publications
    //     PUBLIQUES des comptes DE la structure (pas de FK employees/users).
    //     `UNIQUE(reseau, post_id)` rend la synchronisation idempotente.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_social_posts (
        id SERIAL PRIMARY KEY,
        reseau VARCHAR(20) NOT NULL CHECK (reseau IN ('instagram', 'facebook')),
        compte VARCHAR(100) NOT NULL,
        post_id VARCHAR(100) NOT NULL,
        permalink VARCHAR(500),
        legende TEXT,
        media_fichier VARCHAR(300),
        media_sha256 VARCHAR(64),
        publie_le TIMESTAMPTZ,
        sync_le TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(reseau, post_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_social_posts_publie ON badgeuse_social_posts(publie_le DESC);');

    // (l) MÉTÉO de l'écran de veille. Le poste ne contacte pas Open-Meteo (CSP
    //     'self') : le SERVEUR rafraîchit (job syncBadgeuseMeteo) et la
    //     playlist lit ici. Cache indexé par COORDONNÉES arrondies à 4
    //     décimales (~11 m) et non par site : deux sites au même endroit
    //     partagent le relevé, et le cache survit à la suppression d'un site.
    //     `releve_le` est renvoyé au poste : une prévision porte toujours sa
    //     date de relevé, jamais une fraîcheur supposée.
    //     AUCUNE donnée personnelle.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_meteo (
        id SERIAL PRIMARY KEY,
        latitude NUMERIC(8,4) NOT NULL,
        longitude NUMERIC(8,4) NOT NULL,
        jour DATE NOT NULL,
        code SMALLINT,
        libelle VARCHAR(40),
        temp_min NUMERIC(5,1),
        temp_max NUMERIC(5,1),
        precip_mm NUMERIC(6,1),
        vent_max NUMERIC(6,1),
        releve_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (latitude, longitude, jour)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_meteo_jour ON badgeuse_meteo(jour);');

    // (m) PRESSE NATIONALE (ADR-0006) — articles rapatriés par le serveur
    //     depuis les flux RSS paramétrés (`badgeuse.presse_flux`). Un article
    //     = un écran. `UNIQUE(flux, guid)` rend la synchronisation idempotente
    //     (le même article vu deux fois n'ajoute pas un second écran).
    //     La vignette est TÉLÉCHARGÉE côté serveur (sous-dossier `presse/`) et
    //     servie par l'API device : le poste ne joint aucun site de presse.
    //     AUCUNE donnée personnelle : ce sont des publications de presse.
    await client.query(`
      CREATE TABLE IF NOT EXISTS badgeuse_presse_articles (
        id SERIAL PRIMARY KEY,
        flux VARCHAR(120) NOT NULL,
        source VARCHAR(120),
        guid VARCHAR(400) NOT NULL,
        titre TEXT NOT NULL,
        chapo TEXT,
        lien VARCHAR(600),
        publie_le TIMESTAMPTZ,
        media_fichier VARCHAR(300),
        media_sha256 VARCHAR(64),
        media_type VARCHAR(10),
        sync_le TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (flux, guid)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_badgeuse_presse_publie ON badgeuse_presse_articles(publie_le DESC);');

    // Registre RGPD — traitement « Temps & Présence (badgeuse) ». Fiche art. 30
    // OBLIGATOIRE avant la mise en service (NOTE_JURIDIQUE §3.8). Idempotent.
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Temps & Présence (badgeuse) — décompte du temps de travail',
        'Décompter le temps de travail effectif des salariés au moyen d''un dispositif de badgeage sans contact, établir les feuilles de temps mensuelles, produire les états pour la paie et les déclarations de volumes d''heures aux financeurs de l''insertion (ASP). Une finalité SECONDE et DISSOCIÉE, sans donnée personnelle, est assurée par le même écran : la communication interne (consignes, informations collectives).',
        'Obligation légale (art. L.3171-2 du code du travail : décompte de la durée du travail) et intérêt légitime pour la communication interne',
        'Salariés de la structure (permanents et salariés en parcours d''insertion) porteurs d''un badge',
        'Identifiant du salarié, nom et prénom (AFFICHAGE LIMITÉ AU PRÉNOM + INITIALE au point de passage), condensat cryptographique de l''identifiant technique du badge (HMAC-SHA256 — l''identifiant du badge n''est JAMAIS stocké en clair), horodatage et sens des passages, identifiant du poste et du site, motif de régularisation (LISTE FERMÉE). EXCLUSIONS ABSOLUES : aucune photographie, aucune donnée de santé, aucun motif d''absence, aucune géolocalisation, aucune mention du statut ou de la nature du parcours d''insertion.',
        'Le salarié (ses propres données), l''encadrant technique, le service RH/paie, la direction (données agrégées). Volumes d''heures uniquement pour l''ASP et les financeurs. Aucun transfert hors Union européenne.',
        'Pointages bruts et corrections, feuilles de temps : base active puis archivage intermédiaire selon les paramètres badgeuse.retention_* (défaut 60 mois) ; association badge-salarié : 90 jours après restitution ; journaux d''accès : 12 mois. Purge AUTOMATISÉE, planifiée et journalisée (job badgeusePurgeRetention).',
        'Pseudonymisation de l''identifiant de badge par HMAC-SHA256 à clé de site (clé chiffrée AES-256-GCM dans settings, jamais en clair ni dans les journaux), chaînage cryptographique des enregistrements garantissant l''inaltérabilité de la capture, corrections ADDITIVES conservant l''enregistrement d''origine, authentification des postes par clé à condensat comparé à temps constant, requêtes SQL paramétrées, habilitations par rôle (lecture ADMIN/RH/MANAGER, écriture ADMIN/RH), JOURNALISATION DE TOUTE CONSULTATION INDIVIDUELLE et de tout export dans rgpd_audit_log, accès permanent du salarié à ses propres pointages (droit d''accès satisfait par construction)'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Temps & Présence (badgeuse) — décompte du temps de travail'
      );
    `);
    console.log('[INIT-DB] Module 33 Temps & Présence (badgeuse) — 10 tables + écran v2 (opt-in festif, médias, social, presse, météo) + site LH + registre RGPD ✓');

    // ══════════════════════════════════════════
    // Module Achats responsables (RSEI-17) — 31e module
    //
    // Mini-module d'OUTILLAGE de la démarche d'achats responsables (critère RSEi
    // 1.7). Cadrage : rapports/rsei-2026-07-22/03-plan-action-rsei.md §2.3 (RSEI-17).
    //   (a) mini-référentiel FOURNISSEURS avec statut (local / inclusif ESS-SIAE-EA /
    //       démarche RSE / labellisé) — un fournisseur « responsable » = au moins un
    //       de ces 4 drapeaux à true (calcul APPLICATIF, cf. routes/achats.js) ;
    //   (b) CRITÈRES d'achat par famille (administrables, seed de départ) ;
    //   (c) registre des FDS (fiches de données de sécurité) des produits dangereux ;
    //   (d) rapprochement avec la CLASSE 60 du Grand Livre (financial_gl_entries,
    //       Pennylane pull) pour estimer la PART D'ACHATS RESPONSABLES — indicateur
    //       exemple du 1.7 N3. Le rapprochement est fait côté route (soft, « jamais
    //       de valeur inventée » : part en montant null si le total classe 60 est
    //       indisponible). La politique d'achats elle-même reste un acte de direction.
    //
    // CONFIDENTIALITÉ : données FOURNISSEURS (personnes morales), NON NOMINATIVES.
    // Aucune donnée de salarié/parcours. Entrée dédiée au registre RGPD.
    // ══════════════════════════════════════════

    // (a) Fournisseurs référencés. `categorie` = famille d'achat (contrainte).
    //     Les 4 drapeaux de responsabilité sont indépendants (un fournisseur peut
    //     être local ET inclusif). `local` est un mot-clé PG NON réservé → utilisable
    //     comme nom de colonne (les requêtes le qualifient par alias par prudence).
    await client.query(`
      CREATE TABLE IF NOT EXISTS achats_fournisseurs (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        siret VARCHAR(20),
        categorie VARCHAR(20) NOT NULL DEFAULT 'autre'
          CHECK (categorie IN ('fournitures', 'epi', 'transport', 'prestations', 'energie', 'alimentaire', 'autre')),
        local BOOLEAN NOT NULL DEFAULT false,
        inclusif BOOLEAN NOT NULL DEFAULT false,
        demarche_rse BOOLEAN NOT NULL DEFAULT false,
        labellise BOOLEAN NOT NULL DEFAULT false,
        label_detail VARCHAR(200),
        commune VARCHAR(120),
        actif BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_achats_fournisseurs_categorie ON achats_fournisseurs(categorie);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_achats_fournisseurs_actif ON achats_fournisseurs(actif);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_achats_fournisseurs_siret ON achats_fournisseurs(siret);');

    // (b) Critères d'achat par famille (administrable). UNIQUE(famille, critere) pour
    //     un seed idempotent ON CONFLICT DO NOTHING. `poids` facultatif (pondération).
    //     `famille` libre (peut valoir 'transverse' = s'applique à toutes les familles).
    await client.query(`
      CREATE TABLE IF NOT EXISTS achats_criteres (
        id SERIAL PRIMARY KEY,
        famille VARCHAR(30) NOT NULL DEFAULT 'transverse',
        critere TEXT NOT NULL,
        poids SMALLINT,
        actif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (famille, critere)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_achats_criteres_famille ON achats_criteres(famille);');
    // Seed de critères de départ raisonnables (idempotent). Éditables ensuite.
    await client.query(`
      INSERT INTO achats_criteres (famille, critere) VALUES
        ('fournitures', 'Privilégier un fournisseur local (circuit court, ancrage territorial)'),
        ('fournitures', 'Réduire les emballages et privilégier les produits réemployés, reconditionnés ou recyclés'),
        ('epi', 'Exiger les fiches de données de sécurité (FDS) des produits dangereux'),
        ('prestations', 'Préférer un ESAT / une entreprise adaptée (EA) ou une SIAE pour les prestations sous-traitées'),
        ('transport', 'Regrouper et optimiser les livraisons pour réduire les émissions'),
        ('energie', 'Rechercher une électricité d''origine renouvelable'),
        ('alimentaire', 'Privilégier des produits durables, de saison ou issus de circuits responsables'),
        ('transverse', 'Interroger l''engagement RSE ou le label du fournisseur au référencement')
      ON CONFLICT (famille, critere) DO NOTHING;
    `);

    // (c) Registre des FDS (fiches de données de sécurité) des produits dangereux.
    //     `fournisseur_id` en REFERENCES ... ON DELETE SET NULL (supprimer un
    //     fournisseur ne détruit pas la traçabilité FDS). Pièce jointe : pattern
    //     Refashion/rsei_preuves (fichier_path/original_name/mime). FK APRÈS
    //     achats_fournisseurs (table parente créée juste au-dessus).
    await client.query(`
      CREATE TABLE IF NOT EXISTS achats_fds (
        id SERIAL PRIMARY KEY,
        produit VARCHAR(200) NOT NULL,
        fournisseur_id INTEGER REFERENCES achats_fournisseurs(id) ON DELETE SET NULL,
        reference VARCHAR(120),
        date_fds DATE,
        date_revision DATE,
        fichier_path TEXT,
        fichier_original_name TEXT,
        fichier_mime VARCHAR(120),
        dangers VARCHAR(200),
        epi_requis TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_achats_fds_fournisseur ON achats_fds(fournisseur_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_achats_fds_revision ON achats_fds(date_revision);');

    // Registre RGPD — traitement « Achats responsables » (données NON nominatives).
    // Idempotent via WHERE NOT EXISTS. Aucune donnée de personne physique : le module
    // ne manipule que des fournisseurs (personnes morales) et des produits.
    await client.query(`
      INSERT INTO rgpd_registre
        (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
      SELECT
        'Achats responsables (données fournisseurs, non nominatives)',
        'Outiller la démarche d''achats responsables (critère RSEi 1.7) : référentiel des fournisseurs et de leur statut (local / inclusif / démarche RSE / labellisé), critères d''achat par famille, registre des FDS des produits dangereux, et estimation de la part d''achats responsables par rapprochement avec la classe 60 du Grand Livre.',
        'Intérêt légitime (démarche volontaire de RSE ; obligations de sécurité au travail pour les FDS)',
        'Aucune personne physique concernée : le module ne traite que des fournisseurs (personnes morales) et des produits.',
        'Données de fournisseurs (raison sociale, SIRET, commune, statut de responsabilité), critères d''achat, fiches de données de sécurité de produits. Le SIRET est une donnée d''entreprise, non un identifiant de personne physique. AUCUNE donnée de salarié ni de parcours.',
        'Référent RSE, direction, RH, QHSE (FDS)',
        'Relation fournisseur + archivage (labellisation) ; FDS tant que le produit est utilisé',
        'Données non nominatives, requêtes SQL paramétrées, habilitations par rôle (lecture ADMIN/MANAGER/RH/QHSE, écriture ADMIN/RH/MANAGER), journalisation applicative (autoLogActivity), pièces jointes FDS filtrées par type (documentFilter)'
      WHERE NOT EXISTS (
        SELECT 1 FROM rgpd_registre WHERE nom_traitement = 'Achats responsables (données fournisseurs, non nominatives)'
      );
    `);
    console.log('[INIT-DB] Module Achats responsables (RSEI-17) — 3 tables + 8 critères + registre RGPD ✓');

    // ══════════════════════════════════════════
    // MODULE « EFFECTIFS CONVENTIONNÉS (ETP) » — validation ASP mensuelle
    //
    // Suivi prévisionnel/réalisé des ETP d'insertion vs convention ACI
    // (routes/effectifs.js + services/effectifs-engine.js). La CIP saisit ici
    // le chiffre ASP mensuel officiel (états mensuels de présence) : validation
    // horodatée, journalisée dans rgpd_audit_log par la route — ce chiffre FAIT
    // FOI dans la synthèse. Les PARAMÈTRES DE CONVENTION (ETP conventionnés,
    // dont CDI Inclusion, heures/ETP, période) vivent dans `settings` sous la
    // clé `effectifs.convention_<annee>` (JSON) — AUCUN seed : jamais de valeur
    // inventée (repli lecture sur insertion.cible_etp_conventionnes).
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS etp_asp_mensuel (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
        etp_asp NUMERIC(6,2) NOT NULL,
        commentaire TEXT,
        saisi_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        valide_le TIMESTAMP DEFAULT NOW(),
        UNIQUE(annee, mois)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_etp_asp_annee ON etp_asp_mensuel(annee);');

    // ── Import des états mensuels de présence ASP (PDF) ──────────────────
    // Enrichissement de la validation mensuelle avec les en-têtes de l'état
    // officiel (heures déclarées / éligibles, ETP conventionnés de l'annexe,
    // taux, effectif déclaré, montant forfaitaire) + traçabilité de la source
    // ('saisie' manuelle vs 'import_pdf'). Colonnes NULLABLES : une validation
    // saisie à la main reste valide sans aucune de ces valeurs (jamais de
    // valeur inventée). Migration idempotente (ADD COLUMN IF NOT EXISTS).
    await client.query(`
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS heures_declarees NUMERIC(10,2);
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS heures_eligibles NUMERIC(10,2);
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS etp_conventionnes_asp NUMERIC(6,2);
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS taux_asp NUMERIC(6,2);
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS nb_salaries_asp INTEGER;
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS montant_forfaitaire NUMERIC(12,2);
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS source VARCHAR(20);
      ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS fichier_nom TEXT;
    `);

    // Détail salarié de l'état ASP : une ligne par salarié DÉCLARÉ et par mois.
    // C'est la matière du rapprochement d'écarts (routes/effectifs.js) :
    //   - `nom_asp` est le nom d'USAGE tel que déclaré à l'ASP — il diffère
    //     régulièrement du nom porté par la paie (nom marital, prénom composé
    //     tronqué), d'où la table de liaison manuelle ci-dessous ;
    //   - `employee_id` est le rapprochement RETENU (NULL = non rapproché :
    //     le salarié n'est pas dans l'ERP, le plus souvent parce que l'export
    //     de paie n'inclut pas les salariés sortis) ;
    //   - AUCUNE fiche salarié n'est jamais créée depuis un état ASP (RGPD :
    //     pas d'invention de fiche RH — on EXPLIQUE l'écart, on ne le comble
    //     pas artificiellement).
    await client.query(`
      CREATE TABLE IF NOT EXISTS etp_asp_salaries (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
        nom_asp TEXT NOT NULL,
        date_naissance DATE,
        forme_contrat VARCHAR(10),
        heures NUMERIC(8,2),
        salaire_brut NUMERIC(10,2),
        contrat_debut DATE,
        contrat_fin DATE,
        date_sortie DATE,
        motif_sortie VARCHAR(10),
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(annee, mois, nom_asp, date_naissance)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_etp_asp_salaries_periode ON etp_asp_salaries(annee, mois);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_etp_asp_salaries_employee ON etp_asp_salaries(employee_id);');

    // Liaisons manuelles nom ASP ↔ collaborateur : mémorise la correspondance
    // validée par un humain (nom d'usage différent, date de naissance divergente
    // entre l'ASP et la paie — la paie ramène parfois le jour au 01). Persistée
    // pour que le rapprochement des mois SUIVANTS soit automatique.
    await client.query(`
      CREATE TABLE IF NOT EXISTS etp_asp_liaisons (
        id SERIAL PRIMARY KEY,
        nom_asp TEXT NOT NULL,
        date_naissance DATE,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
        cree_le TIMESTAMP DEFAULT NOW(),
        UNIQUE(nom_asp, date_naissance)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_etp_asp_liaisons_employee ON etp_asp_liaisons(employee_id);');

    console.log('[INIT-DB] Module Effectifs conventionnés (ETP) — etp_asp_mensuel + import ASP (etp_asp_salaries, etp_asp_liaisons) ✓');


    // ══════════════════════════════════════════
    // HOTFIX 2026-05 — Resync des séquences SERIAL
    //
    // Symptôme observé en prod : INSERT INTO employees échoue avec
    //   "duplicate key value violates unique constraint employees_pkey
    //    Key (id)=(1) already exists."
    // Cause : import/seed avec IDs explicites n'ayant pas mis à jour
    // pg_get_serial_sequence. La séquence retourne 1 alors que les
    // lignes existantes occupent déjà 1, 2, 3, …
    //
    // setval(seq, max(id)) est idempotent et sans effet de bord si la
    // séquence est déjà cohérente.
    // ══════════════════════════════════════════
    const tablesAResyncer = [
      'employees', 'candidates', 'tours', 'cav', 'vehicles',
      'expeditions', 'commandes_exutoires', 'preparations_expedition',
      'factures_exutoires', 'clients_exutoires', 'tarifs_exutoires',
      'invoices', 'invoice_lines', 'stock_movements', 'tonnage_history',
      'production_daily', 'produits_finis', 'batch_tracking',
      'insertion_diagnostics', 'insertion_milestones', 'cip_action_plans',
      'recruitment_interviews', 'recruitment_documents', 'recruitment_plan',
      'mise_en_situation', 'pcm_sessions', 'pcm_reports',
      'employee_contracts', 'schedule', 'work_hours', 'positions', 'teams',
      'incidents', 'gps_positions', 'tour_cav', 'tour_weights',
      'partners', 'prescripteur_orgas', 'alert_thresholds',
      'boutiques', 'boutique_ventes', 'boutique_tickets',
      'boutique_commandes', 'boutique_commande_lignes',
      'boutique_objectifs', 'boutique_meteo_quotidien',
      'vaks', 'vak_import_batches', 'vak_tickets', 'vak_ventes',
      'vak_meteo_quotidien', 'vak_sumup_sync_log',
      'association_points', 'cav_sensor_readings', 'refashion_dpav',
      'refashion_communes', 'refashion_subventions', 'historique_mensuel',
      'rsei_criteres', 'rsei_actions', 'rsei_preuves', 'rsei_evaluations',
      'rsei_evaluation_items', 'rsei_parties_prenantes', 'rsei_interactions',
      'energie_sites', 'energie_compteurs', 'energie_releves',
      'carburant_pleins', 'ges_facteurs',
      'enquete_modeles', 'enquete_questions', 'enquete_campagnes', 'enquete_reponses',
      'achats_fournisseurs', 'achats_criteres', 'achats_fds',
      'qhse_documents', 'formation_actions', 'etp_asp_mensuel',
      'etp_asp_salaries', 'etp_asp_liaisons',
      // Module 33 — Temps & Présence (badgeuse). badgeuse_pointages est en
      // BIGSERIAL : pg_get_serial_sequence la couvre de la même façon.
      'badgeuse_sites', 'badgeuse_devices', 'badgeuse_badges',
      'badgeuse_badge_historique', 'badgeuse_pointages', 'badgeuse_corrections',
      'badgeuse_feuilles_temps', 'badgeuse_contenus', 'badgeuse_social_posts',
    ];
    // Garde-fou : seuls les noms de table snake_case ASCII sont acceptés
    // (la liste est statique, mais on protège quand même contre une
    // injection via un futur refactor).
    const SAFE_TABLE = /^[a-z_][a-z0-9_]*$/;
    let resyncCount = 0;
    for (const t of tablesAResyncer) {
      if (!SAFE_TABLE.test(t)) continue;
      try {
        await client.query(`
          DO $$
          DECLARE seq_name text;
          DECLARE max_id bigint;
          BEGIN
            seq_name := pg_get_serial_sequence('${t}', 'id');
            IF seq_name IS NOT NULL THEN
              EXECUTE 'SELECT COALESCE(MAX(id), 0) FROM ${t}' INTO max_id;
              PERFORM setval(seq_name, max_id + 1, false);
            END IF;
          EXCEPTION WHEN undefined_table OR undefined_column THEN
            -- Table absente ou pas de colonne id : ignorer.
            NULL;
          END $$;
        `);
        resyncCount++;
      } catch (_) {
        // Garde-fou supplémentaire : on continue silencieusement.
      }
    }
    console.log(`[INIT-DB] Séquences SERIAL resynchronisées (${resyncCount} tables) ✓`);

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
