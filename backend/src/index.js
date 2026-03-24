require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { Server } = require('socket.io');
const pool = require('./config/database');

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
    console.log('[SOCKET.IO] Redis adapter activé (multi-instance OK)');
  } catch (err) {
    console.warn('[SOCKET.IO] Redis non disponible, mode single-instance :', err.message);
  }
})();

// Trust proxy (derrière nginx)
app.set('trust proxy', 1);

// Middleware globaux
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting global
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false }));
// Rate limiting strict pour auth
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Trop de tentatives, réessayez plus tard' } }));

// Créer dossiers uploads (évite 502 si multer ne peut pas créer)
const fs = require('fs');
const uploadsDir = path.join(__dirname, '..', 'uploads');
['', 'cv', 'photos', 'incidents', 'qrcodes'].forEach((sub) => {
  const dir = sub ? path.join(uploadsDir, sub) : uploadsDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn('[INIT] Impossible de créer le dossier', dir, ':', err.message);
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

// Lot 6 : Pointage / Badgeage
app.use('/api/pointage', require('./routes/pointage'));

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
  console.log(`[SOCKET] Client connecté : ${socket.id} (user: ${socket.user?.id})`);

  // Le chauffeur rejoint la room de sa tournée
  socket.on('join-tour', (tourId) => {
    socket.join(`tour-${tourId}`);
    console.log(`[SOCKET] ${socket.id} rejoint tour-${tourId}`);
  });

  // Position GPS du chauffeur
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
    } catch (err) {
      console.error('[SOCKET] Erreur GPS :', err);
    }
  });

  // Mise à jour statut CAV collecté
  socket.on('cav-collected', (data) => {
    io.to(`tour-${data.tourId}`).emit('cav-status-update', data);
  });

  // Mise à jour statut tournée
  socket.on('tour-status', (data) => {
    io.to(`tour-${data.tourId}`).emit('tour-status-update', data);
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] Client déconnecté : ${socket.id}`);
  });
});

// ══════════════════════════════════════════
// INITIALISATION BASE DE DONNÉES AU DÉMARRAGE
// ══════════════════════════════════════════
async function initOnStartup() {
  try {
    // Vérifier la connexion
    await pool.query('SELECT 1');
    console.log('[DB] Connexion PostgreSQL établie');

    // Vérifier si les tables existent
    const tables = await pool.query(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    if (parseInt(tables.rows[0].count) < 5) {
      console.log('[DB] Tables manquantes, lancement init-db...');
      const { initDatabase } = require('./scripts/init-db');
      await initDatabase();
    } else {
      console.log(`[DB] ${tables.rows[0].count} tables trouvées`);
      // Toujours appliquer les migrations de colonnes (idempotent)
      try {
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN estimated_distance_km DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN estimated_duration_min INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN nb_cav INTEGER DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tours ADD COLUMN ai_explanation TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE tour_cav ADD COLUMN predicted_fill_rate DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        console.log('[DB] Migrations de colonnes vérifiées ✓');
      } catch (e) { console.warn('[DB] Migration warning:', e.message); }

      // Migration module Exutoires (idempotent)
      try {
        const { migrateExutoires } = require('./scripts/migrate-exutoires');
        await migrateExutoires();
        console.log('[DB] Migration Exutoires vérifiée ✓');
      } catch (e) { console.warn('[DB] Migration Exutoires warning:', e.message); }
    }

    // Seed CAV si la table est vide
    try {
      const cavCount = await pool.query('SELECT COUNT(*) FROM cav');
      if (parseInt(cavCount.rows[0].count) === 0) {
        console.log('[DB] Table CAV vide, lancement du seed...');
        const { seedCAV } = require('./scripts/seed-cav');
        await seedCAV(pool);
      } else {
        console.log(`[DB] ${cavCount.rows[0].count} CAV déjà en base`);
      }
    } catch (err) {
      console.error('[DB] Erreur seed CAV :', err.message);
    }

    // Cleanup expired refresh tokens
    try {
      const cleaned = await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
      if (cleaned.rowCount > 0) console.log(`[DB] ${cleaned.rowCount} refresh tokens expires purges`);
    } catch (err) { /* table may not exist yet */ }

    // Seed historique si la table est vide
    try {
      const histCount = await pool.query('SELECT COUNT(*) FROM historique_mensuel');
      if (parseInt(histCount.rows[0].count) === 0) {
        console.log('[DB] Table historique_mensuel vide, lancement du seed...');
        const { seedHistorique } = require('./scripts/seed-historique');
        await seedHistorique(pool);
      } else {
        console.log(`[DB] ${histCount.rows[0].count} entrées historiques déjà en base`);
      }
    } catch (err) {
      console.error('[DB] Erreur seed historique :', err.message);
    }
  } catch (err) {
    console.error('[DB] Erreur connexion :', err.message);
    console.log('[DB] Nouvelle tentative dans 5s...');
    setTimeout(initOnStartup, 5000);
    return;
  }
}

// Démarrage serveur
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  SOLIDATA ERP - API Backend`);
  console.log(`  Port : ${PORT}`);
  console.log(`  Env  : ${process.env.NODE_ENV || 'development'}`);
  console.log(`══════════════════════════════════════════\n`);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-in-production') {
    console.warn('[SECURITE] ATTENTION : JWT_SECRET non configure ! Definissez JWT_SECRET dans .env');
  }
  await initOnStartup();

  // Démarrer le scheduler CRON
  try {
    const { startScheduler } = require('./services/scheduler');
    startScheduler();
  } catch (err) {
    console.error('[SCHEDULER] Erreur démarrage :', err.message);
  }

  // Initialiser les queues BullMQ (optionnel, dépend de Redis)
  try {
    const { initQueues } = require('./services/job-queue');
    await initQueues();
  } catch (err) {
    console.warn('[JOB-QUEUE] Initialisation optionnelle échouée :', err.message);
  }
});

module.exports = { app, server, io };
