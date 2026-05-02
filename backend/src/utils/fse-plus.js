/**
 * Visuel UE / FSE+ pour éditions PDF.
 * Conformité graphique : règlement 2021/1060 — chaque document financé
 * par le FSE+ doit afficher l'emblème de l'Union européenne et la mention
 * "Cofinancé par l'Union européenne".
 *
 * Le drapeau étant un asset, on génère ici uniquement la mention textuelle
 * standardisée et un placeholder pour le logo. L'image officielle doit être
 * fournie dans backend/assets/eu-flag.png (téléchargement :
 *   https://commission.europa.eu/funding-tenders/managing-your-project/communicating-and-raising-eu-visibility/use-eu-emblem_fr).
 */

const path = require('path');
const fs = require('fs');

const EU_FLAG_PATH = path.join(__dirname, '..', '..', 'assets', 'eu-flag.png');

const FSE_PLUS_MENTION = 'Cofinancé par l\'Union européenne — FSE+';
const FSE_PLUS_FOOTER_LINE_1 = 'Cofinancé par l\'Union européenne';
const FSE_PLUS_FOOTER_LINE_2 = 'Fonds Social Européen Plus (FSE+) — règlement (UE) 2021/1057';

/**
 * Ajoute un footer FSE+ au PDF en cours (pdfkit).
 * À appeler avant doc.end().
 */
function addFsePlusFooterPdf(doc, options = {}) {
  const {
    yOffset = 50,           // distance du bas
    showFlag = true,
    fontSize = 8,
  } = options;

  const pageHeight = doc.page.height;
  const pageWidth = doc.page.width;
  const margin = doc.page.margins.left;
  const y = pageHeight - yOffset;

  // Ligne séparatrice
  doc.moveTo(margin, y - 5)
     .lineTo(pageWidth - margin, y - 5)
     .lineWidth(0.5)
     .strokeColor('#94a3b8')
     .stroke();

  // Logo UE si dispo (sinon mention seule)
  let textX = margin;
  if (showFlag && fs.existsSync(EU_FLAG_PATH)) {
    try {
      doc.image(EU_FLAG_PATH, margin, y, { width: 30 });
      textX = margin + 38;
    } catch (_) { /* fallback texte seul */ }
  }

  doc.fontSize(fontSize)
     .fillColor('#475569')
     .text(FSE_PLUS_FOOTER_LINE_1, textX, y, { align: 'left' })
     .text(FSE_PLUS_FOOTER_LINE_2, textX, y + fontSize + 1, { align: 'left' });
}

/**
 * Ajoute un en-tête FSE+ à un classeur Excel (ExcelJS).
 * Insère 2 lignes de mention en haut du worksheet.
 */
function addFsePlusHeaderXlsx(worksheet, options = {}) {
  const { startRow = 1 } = options;
  worksheet.spliceRows(startRow, 0, ['']);
  worksheet.spliceRows(startRow, 0, [FSE_PLUS_FOOTER_LINE_2]);
  worksheet.spliceRows(startRow, 0, [FSE_PLUS_FOOTER_LINE_1]);
  // 3 lignes vides ajoutées : style discret
  for (let r = startRow; r < startRow + 3; r++) {
    const row = worksheet.getRow(r);
    row.font = { italic: true, size: 9, color: { argb: 'FF475569' } };
  }
}

module.exports = {
  EU_FLAG_PATH,
  FSE_PLUS_MENTION,
  FSE_PLUS_FOOTER_LINE_1,
  FSE_PLUS_FOOTER_LINE_2,
  addFsePlusFooterPdf,
  addFsePlusHeaderXlsx,
};
