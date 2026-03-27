const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../../middleware/auth');

// Upload photos incidents
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'incidents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `incident_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Sub-routers
const crudRouter = require('./crud');
const proposalsRouter = require('./proposals');
const createExecutionRouter = require('./execution');
const eventsRouter = require('./events');
const eventsAutoRouter = require('./events-auto');
const statsRouter = require('./stats');

// All routes require authentication
router.use(authenticate);

// Mount execution routes (needs upload for incidents)
const executionRouter = createExecutionRouter(upload);
router.use('/', executionRouter);

// Mount events routes
router.use('/', eventsRouter);

// Mount auto-discovery events routes
router.use('/', eventsAutoRouter);

// Mount stats/reporting routes
router.use('/', statsRouter);

// Mount proposals routes
router.use('/', proposalsRouter);

// Mount CRUD routes (must be after more specific routes to avoid /:id catching everything)
router.use('/', crudRouter);

module.exports = router;
