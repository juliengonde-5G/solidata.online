require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { Server } = require('socket.io');
const pool = require('./config/database');
const logger = require('./config/logger');

const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);

// CORS — origines autorisées
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['https://solidata.online', 'https://www.solidata.online', 'https://m.solidata.online'];
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:3002');
}

// Socket.io
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
});

// Redis adapter pour Socket.IO (multi-instance support)
(async () => {
  try {
    const { isRedisAvailable, createRedisClient } = require('./config/redis');
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pubClient = createRedisClient();
    const subClient = pubClient.duplicate();
    await Promise.all([
      new Promise((resolve, reject) => { pubClient.on('ready', resolve); pubClient.on('error', reject); }),
      new Promise((resolve, reject) => { subClient.on('ready', resolve); subClient.on('error', reject); }),
    ]);
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter activé (multi-instance OK)');
  } catch (err) {
    logger.warn('Socket.IO Redis non disponible, mode single-instance', { error: err.message });
  }
})();

// Trust proxy (derrière nginx)
app.set('trust proxy', 1);

// Middleware globaux
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
      connectSrc: ["'self'", 'wss:', 'ws:', 'https://api.open-meteo.com'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting global
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false }));
// Rate limiting strict pour auth
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Trop de tentatives, réessayez plus tard' } }));

// Créer dossiers uploads (évite 502 si multer ne peut pas créer)
const fs = require('fs');
const uploadsDir = path.join(__dirname, '..', 'uploads');
['', 'cv', 'photos', 'incidents', 'qrcodes', 'documents', 'vehicle-docs'].forEach((sub) => {
  const dir = sub ? path.join(uploadsDir, sub) : uploadsDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.warn('Impossible de créer le dossier', { dir, error: err.message });
  }
});
app.use('/uploads', express.static(uploadsDir));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// Rendre io accessible aux routes
app.set('io', io);

// ══════════════════════════════════════════
// ROUTES API
// ══════════════════════════════════════════
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));

// Lot 2 : Recrutement + PCM + Équipes
app.use('/api/candidates', require('./routes/candidates'));
app.use('/api/pcm', require('./routes/pcm'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/employees', require('./routes/employees'));

// Lot 3 : Collecte + Tournées IA + GPS
app.use('/api/cav', require('./routes/cav'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/tours', require('./routes/tours'));
app.use('/api/association-points', require('./routes/association-points'));
// Lot 4 : Tri + Stock + Production + Facturation + Reporting + Refashion
app.use('/api/stock', require('./routes/stock'));
app.use('/api/production', require('./routes/production'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/reporting', require('./routes/reporting'));
app.use('/api/exports', require('./routes/exports'));
app.use('/api/tri', require('./routes/tri'));
app.use('/api/produits-finis', require('./routes/produits-finis'));
app.use('/api/expeditions', require('./routes/expeditions'));
app.use('/api/refashion', require('./routes/refashion'));
app.use('/api/stock-original', require('./routes/stock-original'));
app.use('/api/referentiels', require('./routes/referentiels'));
app.use('/api/insertion', require('./routes/insertion'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/historique', require('./routes/historique'));
app.use('/api/metropole', require('./routes/metropole'));
app.use('/api/rgpd', require('./routes/rgpd'));
app.use('/api/admin-db', require('./routes/admin-db'));
app.use('/api/activity-log', require('./routes/activity-log'));
app.use('/api/news', require('./routes/newsfeed'));

// Lot 5 : Logistique Exutoires
app.use('/api/clients-exutoires', require('./routes/clients-exutoires'));
app.use('/api/tarifs-exutoires', require('./routes/tarifs-exutoires'));
app.use('/api/commandes-exutoires', require('./routes/commandes-exutoires'));
app.use('/api/preparations', require('./routes/preparations'));
app.use('/api/controles-pesee', require('./routes/controles-pesee'));
app.use('/api/factures-exutoires', require('./routes/factures-exutoires'));
app.use('/api/calendrier-logistique', require('./routes/calendrier-logistique'));
app.use('/api/planning-hebdo', require('./routes/planning-hebdo'));
app.use('/api/dashboard', require('./routes/dashboard'));

// Module Finances / Pennylane
app.use('/api/pennylane', require('./routes/pennylane'));

// Module ML : prédiction remplissage CAV
app.use('/api/ml', require('./routes/ml'));

// Lot 6 : Pointage / Badgeage
app.use('/api/pointage', require('./routes/pointage'));

// Module Finance : Tableau de bord financier (GL Pennylane, budget, KPIs)
app.use('/api/finance', require('./routes/finance'));

// SolidataBot : Agent conversationnel IA (Claude API)
app.use('/api/chat', require('./routes/chat'));

// Performance : Dashboard KPI consolide et indicateurs industriels
app.use('/api/performance', require('./routes/performance'));

// Module Boutiques : gestion de la performance des boutiques retail 2nde main
app.use('/api/boutiques', require('./routes/boutiques'));
app.use('/api/boutique-ventes', require('./routes/boutique-ventes'));
app.use('/api/boutique-commandes', require('./routes/boutique-commandes'));
app.use('/api/boutique-objectifs', require('./routes/boutique-objectifs'));
app.use('/api/boutique-meteo', require('./routes/boutique-meteo'));

// 404 handler pour les routes API non trouvées
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW() as time, version() as version');
    const postgis = await pool.query("SELECT PostGIS_Version() as postgis_version");
    res.json({
      status: 'ok',
      timestamp: dbResult.rows[0].time,
      database: {
        connected: true,
        version: dbResult.rows[0].version,
        postgis: postgis.rows[0].postgis_version,
      },
      modules: {
        auth: true,
        users: true,
        settings: true,
        candidates: true,
        pcm: true,
        teams: true,
        employees: true,
        cav: true,
        vehicles: true,
        tours: true,
        stock: true,
        production: true,
        billing: true,
        reporting: true,
        tri: true,
        refashion: true,
        metropole: true,
        rgpd: true,
        adminDb: true,
        exutoires: true,
        pennylane: true,
        associationPoints: true,
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: 'Service indisponible' });
  }
});

// 404 + Global error handler (DOIT être après toutes les routes)
app.use('/api', notFoundHandler);
app.use(errorHandler);

// ══════════════════════════════════════════
// SOCKET.IO - Auth & GPS temps réel
// ══════════════════════════════════════════
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'change-this-in-production') {
  logger.error('FATAL: JWT_SECRET non configuré en production. Arrêt immédiat.');
  process.exit(1);
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentification requise'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    return next(new Error('Token invalide'));
  }
});

io.on('connection', (socket) => {
  logger.debug(`Socket client connecté: ${socket.id}`, { userId: socket.user?.id });

  // Le chauffeur rejoint la room de sa tournée
  socket.on('join-tour', (tourId) => {
    socket.join(`tour-${tourId}`);
    logger.debug(`Socket ${socket.id} rejoint tour-${tourId}`);
  });

  // Position GPS du chauffeur — avec détection proximité CAV pour historiser le temps de collecte
  const cavProximity = new Map(); // clé: `${tourId}-${cavId}`, valeur: { arrivedAt }

  socket.on('gps-update', async (data) => {
    const { tourId, vehicleId, latitude, longitude, speed } = data;
    try {
      await pool.query(
        'INSERT INTO gps_positions (tour_id, vehicle_id, latitude, longitude, speed) VALUES ($1, $2, $3, $4, $5)',
        [tourId, vehicleId, latitude, longitude, speed]
      );
      // Broadcast aux managers qui suivent cette tournée
      io.to(`tour-${tourId}`).emit('vehicle-position', {
        tourId, vehicleId, latitude, longitude, speed, timestamp: new Date(),
      });

      // ── Détection proximité CAV pour mesurer le temps de collecte réel ──
      if (tourId && latitude && longitude) {
        try {
          const tourCavs = await pool.query(
            `SELECT tc.cav_id, c.latitude as cav_lat, c.longitude as cav_lng
             FROM tour_cav tc JOIN cav c ON tc.cav_id = c.id
             WHERE tc.tour_id = $1 AND c.latitude IS NOT NULL`,
            [tourId]
          );
          const PROXIMITY_RADIUS = 0.1; // 100m en km
          for (const tc of tourCavs.rows) {
            const dist = haversineDistanceSimple(latitude, longitude, parseFloat(tc.cav_lat), parseFloat(tc.cav_lng));
            const key = `${tourId}-${tc.cav_id}`;
            if (dist <= PROXIMITY_RADIUS) {
              // Arrivée près du CAV
              if (!cavProximity.has(key)) {
                cavProximity.set(key, { arrivedAt: new Date() });
              }
            } else if (cavProximity.has(key)) {
              // Départ du CAV — enregistrer le temps de collecte
              const entry = cavProximity.get(key);
              const duration = Math.round((Date.now() - entry.arrivedAt.getTime()) / 1000);
              if (duration > 30 && duration < 3600) { // entre 30s et 1h
                pool.query(
                  `INSERT INTO cav_collection_times (cav_id, tour_id, vehicle_id, arrived_at, departed_at, duration_seconds)
                   VALUES ($1, $2, $3, $4, NOW(), $5)`,
                  [tc.cav_id, tourId, vehicleId, entry.arrivedAt, duration]
                ).catch(err => logger.error('Erreur enregistrement temps collecte:', err.message));
              }
              cavProximity.delete(key);
            }
          }
        } catch (_) { /* table pas encore créée, pas grave */ }
      }
    } catch (err) {
      logger.error('Erreur GPS Socket.IO', { error: err.message });
    }
  });

  // Fonction haversine simplifiée pour la détection de proximité (en km)
  function haversineDistanceSimple(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Mise à jour statut CAV collecté
  socket.on('cav-collected', (data) => {
    io.to(`tour-${data.tourId}`).emit('cav-status-update', data);
  });

  // Mise à jour statut tournée
  socket.on('tour-status', (data) => {
    io.to(`tour-${data.tourId}`).emit('tour-status-update', data);
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket client déconnecté: ${socket.id}`);
  });
});

// ══════════════════════════════════════════
// INITIALISATION BASE DE DONNÉES AU DÉMARRAGE
// ══════════════════════════════════════════
async function initOnStartup() {
  try {
    // Vérifier la connexion
    await pool.query('SELECT 1');
    logger.info('Connexion PostgreSQL établie');

    // Vérifier si les tables existent
    const tables = await pool.query(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    if (parseInt(tables.rows[0].count) < 5) {
      logger.info('Tables manquantes, lancement init-db...');
      const { initDatabase } = require('./scripts/init-db');
      await initDatabase();
    } else {
      logger.info(`${tables.rows[0].count} tables trouvées`);
      // Toujours appliquer les migrations de colonnes (idempotent)
      try {
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN estimated_distance_km DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN estimated_duration_min INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN nb_cav INTEGER DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN ai_explanation TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tour_cav ADD COLUMN predicted_fill_rate DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        logger.info('Migrations de colonnes vérifiées');
      } catch (e) { logger.warn('Migration warning', { error: e.message }); }

      // Migration module Exutoires (idempotent)
      try {
        const { migrateExutoires } = require('./scripts/migrate-exutoires');
        await migrateExutoires();
        logger.info('Migration Exutoires vérifiée');
      } catch (e) { logger.warn('Migration Exutoires warning', { error: e.message }); }

      // Migration module Finance (idempotent)
      try {
        const { migrateFinance } = require('./scripts/migrate-finance');
        await migrateFinance();
        logger.info('Migration Finance vérifiée');
      } catch (e) { logger.warn('Migration Finance warning', { error: e.message }); }

      // Migration module Collecte Association (idempotent — création tables si absentes)
      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
        await pool.query(`
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
          )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_association_points_geom ON association_points USING GIST(geom)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_association_points_status ON association_points(status)');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS tour_association_point (
            id SERIAL PRIMARY KEY,
            tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
            association_point_id INTEGER REFERENCES association_points(id),
            position INTEGER NOT NULL,
            status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'collected', 'skipped', 'incident')),
            fill_level INTEGER CHECK (fill_level BETWEEN 0 AND 5),
            collected_at TIMESTAMP,
            notes TEXT
          )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_tour_assoc_tour ON tour_association_point(tour_id)');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS standard_route_association (
            id SERIAL PRIMARY KEY,
            route_id INTEGER REFERENCES standard_routes(id) ON DELETE CASCADE,
            association_point_id INTEGER REFERENCES association_points(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            UNIQUE(route_id, association_point_id)
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS tonnage_history_association (
            id SERIAL PRIMARY KEY,
            association_point_id INTEGER REFERENCES association_points(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            weight_kg DOUBLE PRECISION NOT NULL,
            tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
            route_name VARCHAR(100),
            source VARCHAR(20) DEFAULT 'manual',
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_tonnage_assoc_point ON tonnage_history_association(association_point_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_tonnage_assoc_date ON tonnage_history_association(date DESC)');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS association_learning_feedback (
            id SERIAL PRIMARY KEY,
            tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL,
            association_point_id INTEGER REFERENCES association_points(id) ON DELETE CASCADE,
            predicted_fill_rate DOUBLE PRECISION NOT NULL,
            observed_fill_level INTEGER CHECK (observed_fill_level BETWEEN 0 AND 5),
            predicted_weight_kg DOUBLE PRECISION,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN collection_type VARCHAR(20) DEFAULT 'pav'; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE stock_movements ADD COLUMN origine_type VARCHAR(20) DEFAULT 'pav'; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        logger.info('Migration Collecte Association vérifiée');
      } catch (e) { logger.warn('Migration Association warning', { error: e.message }); }
    }

    // Seed CAV si la table est vide
    try {
      const cavCount = await pool.query('SELECT COUNT(*) FROM cav');
      if (parseInt(cavCount.rows[0].count) === 0) {
        logger.info('Table CAV vide, lancement du seed...');
        const { seedCAV } = require('./scripts/seed-cav');
        await seedCAV(pool);
      } else {
        logger.info(`${cavCount.rows[0].count} CAV déjà en base`);
      }
    } catch (err) {
      logger.error('Erreur seed CAV', { error: err.message });
    }

    // Seed associations si la table est vide
    try {
      const assoCount = await pool.query('SELECT COUNT(*) FROM association_points');
      if (parseInt(assoCount.rows[0].count) === 0) {
        logger.info('Table association_points vide, lancement du seed...');
        const { seedAssociations } = require('./scripts/seed-associations');
        await seedAssociations();
      } else {
        logger.info(`${assoCount.rows[0].count} points association déjà en base`);
      }
    } catch (err) {
      logger.error('Erreur seed associations', { error: err.message });
    }

    // Cleanup expired refresh tokens
    try {
      const cleaned = await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
      if (cleaned.rowCount > 0) logger.info(`${cleaned.rowCount} refresh tokens expirés purgés`);
    } catch (err) { /* table may not exist yet */ }

    // Seed historique si la table est vide
    try {
      const histCount = await pool.query('SELECT COUNT(*) FROM historique_mensuel');
      if (parseInt(histCount.rows[0].count) === 0) {
        logger.info('Table historique_mensuel vide, lancement du seed...');
        const { seedHistorique } = require('./scripts/seed-historique');
        await seedHistorique(pool);
      } else {
        logger.info(`${histCount.rows[0].count} entrées historiques déjà en base`);
      }
    } catch (err) {
      logger.error('Erreur seed historique', { error: err.message });
    }
  } catch (err) {
    logger.error('Erreur connexion DB', { error: err.message });
    logger.info('Nouvelle tentative dans 5s...');
    setTimeout(initOnStartup, 5000);
    return;
  }
}

// Démarrage serveur
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  logger.info(`SOLIDATA ERP - API Backend démarré`, { port: PORT, env: process.env.NODE_ENV || 'development' });
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-in-production') {
    logger.warn('SECURITE: JWT_SECRET non configuré ! Définissez JWT_SECRET dans .env');
  }
  await initOnStartup();

  // Démarrer le scheduler CRON
  try {
    const { startScheduler } = require('./services/scheduler');
    startScheduler();
  } catch (err) {
    logger.error('Scheduler erreur démarrage', { error: err.message });
  }

  // Initialiser les queues BullMQ (optionnel, dépend de Redis)
  try {
    const { initQueues } = require('./services/job-queue');
    await initQueues();
  } catch (err) {
    logger.warn('Job-queue initialisation optionnelle échouée', { error: err.message });
  }
});

module.exports = { app, server, io };
