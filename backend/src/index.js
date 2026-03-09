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
const uploadsDir = path.join(__dirname, '..', 'uploads');
['', 'cv', 'photos', 'incidents', 'qrcodes'].forEach((sub) => {
  const dir = sub ? path.join(uploadsDir, sub) : uploadsDir;
  try {
    require('fs').mkdirSync(dir, { recursive: true });
  } catch (_) {}
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
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: 'Service indisponible' });
  }
});

// ══════════════════════════════════════════
// SOCKET.IO - GPS & Tournées temps réel
// ══════════════════════════════════════════
io.on('connection', (socket) => {
  console.log(`[SOCKET] Client connecté : ${socket.id}`);

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
  await initOnStartup();
});

module.exports = { app, server, io };
