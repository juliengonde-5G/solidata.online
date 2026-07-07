/**
 * Filtres multer mutualisés (audit T1.1 — hardening uploads).
 *
 * Pourquoi : sans `fileFilter`, multer accepte n'importe quel type de fichier
 * (HTML, SVG avec script embarqué, exécutables, etc.). Couplé à un /uploads
 * servi en express.static qui détecte le Content-Type par sniffing, ça
 * ouvrait une chaîne stored XSS : upload d'un .svg malveillant → service
 * via /uploads/... → exécution dans le navigateur d'un admin.
 *
 * Stratégie : whitelist double (extension ET MIME) — chacune est faillible
 * isolément (l'extension peut mentir, le MIME aussi), mais la combinaison
 * relève fortement la barre.
 *
 * Usage :
 *   const multer = require('multer');
 *   const { imageFilter } = require('../utils/upload-filters');
 *   const upload = multer({ storage, limits: {...}, fileFilter: imageFilter });
 */

const path = require('path');

function makeFilter({ extensions, mimes, label }) {
  return function fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!extensions.includes(ext)) {
      return cb(new Error(`Extension non autorisée pour ${label} : ${ext || '(aucune)'}. Acceptées : ${extensions.join(', ')}`));
    }
    if (!mimes.includes(mime)) {
      return cb(new Error(`Type MIME non autorisé pour ${label} : ${mime || '(aucun)'}`));
    }
    cb(null, true);
  };
}

// Photos chauffeur, photos employés, photos incidents.
const imageFilter = makeFilter({
  label: 'image',
  extensions: ['.jpg', '.jpeg', '.png', '.webp', '.heic'],
  mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
});

// Import CSV caisse LogicS (boutiques) — accepte aussi text/plain car les
// exports Windows envoient parfois ce MIME pour les .csv.
const csvFilter = makeFilter({
  label: 'CSV',
  extensions: ['.csv'],
  mimes: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
});

// Documents administratifs (cartes grises, attestations, factures, etc.) —
// déjà utilisé dans routes/vehicles.js (uploadVehicleDoc).
const documentFilter = makeFilter({
  label: 'document',
  extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx'],
  mimes: [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
});

// Import RH — export tableur du logiciel de gestion (Malibou) : .xlsx / .xls / .csv.
// Accepte text/plain et octet-stream car certains navigateurs/OS envoient un
// MIME générique pour les .xlsx joints.
const spreadsheetFilter = makeFilter({
  label: 'tableur (xlsx/csv)',
  extensions: ['.xlsx', '.xls', '.csv'],
  mimes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv', 'application/csv', 'text/plain',
    'application/octet-stream',
  ],
});

module.exports = { imageFilter, csvFilter, documentFilter, spreadsheetFilter, makeFilter };
