#!/usr/bin/env node
/**
 * SOLIDATA — Génération de planches d'impression QR codes pour CAV
 *
 * Usage:
 *   node src/scripts/generate-qr-sheets.js [--format A7|A8] [--output fichier.pdf]
 *
 * Génère un PDF avec une étiquette par CAV, prête à imprimer et coller au fond du conteneur.
 * Format A7 (74×105mm) ou A8 (52×74mm) — étiquettes découpables sur feuilles A4.
 */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

// --- Dimensions en points PDF (1pt = 1/72 inch, 1mm = 2.8346pt) ---
const MM = 2.8346;
const FORMATS = {
  A4: { w: 210 * MM, h: 297 * MM },
  A7: { w: 74 * MM, h: 105 * MM },   // 74×105mm
  A8: { w: 52 * MM, h: 74 * MM },    // 52×74mm
};

// Couleurs Solidata
const GREEN = '#2D8C4E';
const GREEN_LIGHT = '#8BC540';
const DARK = '#1A202C';
const GRAY = '#6B7280';

/**
 * Génère le QR code en buffer PNG
 */
async function generateQRBuffer(data, size) {
  return QRCode.toBuffer(data, {
    width: size,
    margin: 1,
    color: { dark: DARK, light: '#FFFFFF' },
    errorCorrectionLevel: 'H', // High correction — résiste aux dégradations
  });
}

/**
 * Dessine une étiquette CAV sur le PDF à la position (x, y)
 * Format adaptatif selon la taille (A7 ou A8)
 */
function drawLabel(doc, cav, qrBuffer, x, y, labelW, labelH, format) {
  const margin = 6 * MM;
  const innerW = labelW - 2 * margin;

  // --- Cadre avec coins arrondis ---
  doc.save();
  doc.roundedRect(x + 2, y + 2, labelW - 4, labelH - 4, 8)
     .lineWidth(1.5)
     .strokeColor(GREEN)
     .stroke();

  // --- Barre supérieure verte ---
  const barH = format === 'A8' ? 12 * MM : 16 * MM;
  doc.roundedRect(x + 3, y + 3, labelW - 6, barH, 6)
     .fill(GREEN);

  // --- Logo texte "SOLIDATA" ---
  const logoSize = format === 'A8' ? 11 : 14;
  doc.font('Helvetica-Bold')
     .fontSize(logoSize)
     .fillColor('#FFFFFF')
     .text('SOLIDATA', x + margin, y + (format === 'A8' ? 5 : 6), {
       width: innerW,
       align: 'center',
     });

  // Sous-titre
  const subSize = format === 'A8' ? 5.5 : 7;
  doc.font('Helvetica')
     .fontSize(subSize)
     .fillColor('#FFFFFF')
     .text('Solidarité Textiles — Collecte & Valorisation', x + margin, y + (format === 'A8' ? 15 : 19), {
       width: innerW,
       align: 'center',
     });

  // --- QR Code centré ---
  const qrSize = format === 'A8' ? 28 * MM : 42 * MM;
  const qrX = x + (labelW - qrSize) / 2;
  const qrY = y + barH + (format === 'A8' ? 4 * MM : 6 * MM);

  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  // --- ID CAV sous le QR ---
  const idY = qrY + qrSize + (format === 'A8' ? 2 * MM : 3 * MM);
  const idSize = format === 'A8' ? 7 : 9;
  doc.font('Helvetica-Bold')
     .fontSize(idSize)
     .fillColor(DARK)
     .text(`CAV #${cav.id}`, x + margin, idY, {
       width: innerW,
       align: 'center',
     });

  // --- Commune ---
  const communeY = idY + (format === 'A8' ? 9 : 12);
  const communeSize = format === 'A8' ? 6 : 8;
  doc.font('Helvetica-Bold')
     .fontSize(communeSize)
     .fillColor(GREEN)
     .text((cav.commune || '').toUpperCase(), x + margin, communeY, {
       width: innerW,
       align: 'center',
     });

  // --- Adresse (tronquée si nécessaire) ---
  const addrY = communeY + (format === 'A8' ? 8 : 11);
  const addrSize = format === 'A8' ? 4.5 : 6;
  let address = cav.address || '';
  // Retirer le nom de commune du début de l'adresse si présent
  if (cav.commune && address.toLowerCase().startsWith(cav.commune.toLowerCase())) {
    address = address.substring(cav.commune.length).replace(/^\s*[-–—]\s*/, '').trim();
  }
  // Tronquer si trop long
  const maxLen = format === 'A8' ? 50 : 70;
  if (address.length > maxLen) address = address.substring(0, maxLen - 3) + '...';

  doc.font('Helvetica')
     .fontSize(addrSize)
     .fillColor(GRAY)
     .text(address, x + margin, addrY, {
       width: innerW,
       align: 'center',
     });

  // --- Nombre de conteneurs ---
  const nbY = addrY + (format === 'A8' ? 7 : 10);
  const nbSize = format === 'A8' ? 4.5 : 5.5;
  doc.font('Helvetica')
     .fontSize(nbSize)
     .fillColor(GRAY)
     .text(`${cav.nb_containers || 1} conteneur${(cav.nb_containers || 1) > 1 ? 's' : ''}`, x + margin, nbY, {
       width: innerW,
       align: 'center',
     });

  // --- Barre inférieure ---
  const footerH = format === 'A8' ? 7 * MM : 9 * MM;
  const footerY = y + labelH - footerH - 3;
  doc.roundedRect(x + 3, footerY, labelW - 6, footerH, 4)
     .fill('#F3F4F6');

  const footerTextSize = format === 'A8' ? 4 : 5;
  doc.font('Helvetica')
     .fontSize(footerTextSize)
     .fillColor(GRAY)
     .text('solidata.online — Ne pas retirer cette étiquette', x + margin, footerY + (format === 'A8' ? 2 : 3), {
       width: innerW,
       align: 'center',
     });

  // --- Repères de découpe (petits traits aux coins) ---
  const cutLen = 4 * MM;
  doc.strokeColor('#D1D5DB').lineWidth(0.3);
  // Coin haut-gauche
  doc.moveTo(x, y).lineTo(x + cutLen, y).stroke();
  doc.moveTo(x, y).lineTo(x, y + cutLen).stroke();
  // Coin haut-droite
  doc.moveTo(x + labelW, y).lineTo(x + labelW - cutLen, y).stroke();
  doc.moveTo(x + labelW, y).lineTo(x + labelW, y + cutLen).stroke();
  // Coin bas-gauche
  doc.moveTo(x, y + labelH).lineTo(x + cutLen, y + labelH).stroke();
  doc.moveTo(x, y + labelH).lineTo(x, y + labelH - cutLen).stroke();
  // Coin bas-droite
  doc.moveTo(x + labelW, y + labelH).lineTo(x + labelW - cutLen, y + labelH).stroke();
  doc.moveTo(x + labelW, y + labelH).lineTo(x + labelW, y + labelH - cutLen).stroke();

  doc.restore();
}

/**
 * Génère le PDF complet avec toutes les étiquettes
 */
async function generateSheets(options = {}) {
  const format = (options.format || 'A7').toUpperCase();
  const outputPath = options.output || path.join(__dirname, '..', '..', 'uploads', `planches-qr-cav-${format}.pdf`);

  if (!FORMATS[format]) {
    console.error(`Format inconnu: ${format}. Utilisez A7 ou A8.`);
    process.exit(1);
  }

  const labelSize = FORMATS[format];
  const pageSize = FORMATS.A4;

  // Calcul de la grille sur une page A4
  const pageMargin = 10 * MM;
  const gap = 3 * MM;
  const cols = Math.floor((pageSize.w - 2 * pageMargin + gap) / (labelSize.w + gap));
  const rows = Math.floor((pageSize.h - 2 * pageMargin + gap) / (labelSize.h + gap));
  const labelsPerPage = cols * rows;

  // Centrer la grille sur la page
  const gridW = cols * labelSize.w + (cols - 1) * gap;
  const gridH = rows * labelSize.h + (rows - 1) * gap;
  const offsetX = (pageSize.w - gridW) / 2;
  const offsetY = (pageSize.h - gridH) / 2;

  console.log(`[QR-SHEETS] Format étiquette: ${format} (${Math.round(labelSize.w / MM)}×${Math.round(labelSize.h / MM)}mm)`);
  console.log(`[QR-SHEETS] Grille: ${cols}×${rows} = ${labelsPerPage} étiquettes par page A4`);

  // Récupérer les CAV
  const result = await pool.query(
    'SELECT id, name, address, commune, nb_containers, qr_code_data FROM cav WHERE status = $1 ORDER BY commune, name',
    ['active']
  );
  const cavs = result.rows;
  console.log(`[QR-SHEETS] ${cavs.length} CAV actifs à traiter`);

  if (cavs.length === 0) {
    console.log('[QR-SHEETS] Aucun CAV trouvé, abandon.');
    await pool.end();
    return;
  }

  // S'assurer que le dossier de sortie existe
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Créer le PDF
  const doc = new PDFDocument({
    size: [pageSize.w, pageSize.h],
    margin: 0,
    info: {
      Title: `SOLIDATA — Planches QR Codes CAV (${format})`,
      Author: 'Solidarité Textiles',
      Subject: 'Étiquettes QR codes pour conteneurs d\'apport volontaire',
      Creator: 'SOLIDATA ERP',
    },
  });

  const writeStream = fs.createWriteStream(outputPath);
  doc.pipe(writeStream);

  let cavIndex = 0;
  const totalPages = Math.ceil(cavs.length / labelsPerPage);

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage();

    // En-tête discret de page
    doc.font('Helvetica').fontSize(6).fillColor('#9CA3AF')
       .text(`SOLIDATA — Planches QR CAV — Page ${page + 1}/${totalPages} — ${new Date().toLocaleDateString('fr-FR')}`,
         pageMargin, 4 * MM, { width: pageSize.w - 2 * pageMargin, align: 'center' });

    for (let row = 0; row < rows && cavIndex < cavs.length; row++) {
      for (let col = 0; col < cols && cavIndex < cavs.length; col++) {
        const cav = cavs[cavIndex];
        const x = offsetX + col * (labelSize.w + gap);
        const y = offsetY + row * (labelSize.h + gap);

        // Générer ou utiliser le QR existant
        let qrData = cav.qr_code_data;
        if (!qrData) {
          qrData = `SOLIDATA-CAV-${cav.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
          // Mettre à jour en BDD
          await pool.query('UPDATE cav SET qr_code_data = $1 WHERE id = $2', [qrData, cav.id]);
        }

        const qrBuffer = await generateQRBuffer(qrData, 600); // Haute résolution pour impression
        drawLabel(doc, cav, qrBuffer, x, y, labelSize.w, labelSize.h, format);

        cavIndex++;
      }
    }
  }

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  console.log(`[QR-SHEETS] PDF généré: ${outputPath}`);
  console.log(`[QR-SHEETS] ${cavs.length} étiquettes sur ${totalPages} pages`);

  return outputPath;
}

// --- CLI ---
if (require.main === module) {
  const args = process.argv.slice(2);
  const formatIdx = args.indexOf('--format');
  const outputIdx = args.indexOf('--output');

  const options = {
    format: formatIdx >= 0 ? args[formatIdx + 1] : 'A7',
    output: outputIdx >= 0 ? args[outputIdx + 1] : undefined,
  };

  generateSheets(options)
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch(err => {
      console.error('[QR-SHEETS] Erreur:', err);
      pool.end();
      process.exit(1);
    });
}

module.exports = { generateSheets };
