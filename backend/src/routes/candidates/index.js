const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../../middleware/auth');

// ══════════════════════════════════════════
// CONFIG MULTER (partagée entre sub-modules)
// ══════════════════════════════════════════

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'cv');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `cv_${Date.now()}${ext}`);
  },
});
const ALLOWED_MIMES = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
};
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ALLOWED_MIMES[ext];
    if (!allowedMimes) return cb(null, false);
    // Vérification extension + MIME type pour éviter les fichiers déguisés
    if (!allowedMimes.includes(file.mimetype)) return cb(null, false);
    cb(null, true);
  },
});

// Export upload avant les require() des sub-modules pour éviter les dépendances circulaires
// (crud.js et individual.js font require('./index').upload)
module.exports = router;
module.exports.upload = upload;

// ══════════════════════════════════════════
// SUB-ROUTERS
// ══════════════════════════════════════════

const keywordsRouter = require('./keywords');
const crudRouter = require('./crud');
const positionsRouter = require('./positions');
const documentsRouter = require('./documents');
const individualRouter = require('./individual');
const conversionRouter = require('./conversion');

// Middleware auth pour toutes les routes
router.use(authenticate);

// IMPORTANT: L'ordre de montage compte !
// Les routes à chemin fixe (keywords, positions, documents, recruitment-plan,
// upload-cv-new, kanban, stats) doivent être montées AVANT les routes /:id
// pour éviter qu'Express ne matche ces noms comme un paramètre :id

// Keywords CRUD — /api/candidates/keywords/*
router.use('/keywords', keywordsRouter);

// Positions CRUD — /api/candidates/positions/*
router.use('/positions', positionsRouter);

// Documents — /api/candidates/documents/*
router.use('/documents', documentsRouter);

// Core CRUD routes — /api/candidates/ (GET /, GET /kanban, POST /, GET /stats, POST /upload-cv-new)
router.use('/', crudRouter);

// Conversion router contient /recruitment-plan (chemin fixe) ET /:id/* (paramétrique)
// Il doit être monté AVANT individualRouter car /recruitment-plan doit être résolu
// avant que /:id de individualRouter ne le capture
router.use('/', conversionRouter);

// Individual candidate routes — /api/candidates/:id, /:id/status, /:id/upload-cv, etc.
router.use('/', individualRouter);
