#!/usr/bin/env node
/**
 * SOLIDATA — Génération des QR codes manquants pour les CAV
 *
 * Usage (dans le conteneur backend) :
 *   node src/scripts/generate-missing-qr.js
 *
 * Trouve tous les CAV sans qr_code_data et génère :
 *   1. Un identifiant unique SOLIDATA-CAV-{id}-{timestamp}-{random}
 *   2. Un fichier PNG dans /app/uploads/qrcodes/
 *   3. Mise à jour en base (qr_code_data + qr_code_image_path)
 */
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function main() {
  try {
    // Trouver les CAV sans QR code
    const result = await pool.query(
      "SELECT id, name, commune FROM cav WHERE qr_code_data IS NULL OR qr_code_data = '' ORDER BY id"
    );

    if (result.rows.length === 0) {
      console.log('Tous les CAV ont déjà un QR code.');
      process.exit(0);
    }

    console.log(`${result.rows.length} CAV sans QR code trouvés. Génération en cours...`);

    // Créer le dossier si nécessaire
    const qrDir = path.join(__dirname, '..', '..', 'uploads', 'qrcodes');
    if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

    let generated = 0;
    for (const cav of result.rows) {
      const qrData = `SOLIDATA-CAV-${cav.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const qrFilename = `qr_${qrData}.png`;
      const qrPath = path.join(qrDir, qrFilename);

      await QRCode.toFile(qrPath, qrData, {
        width: 300,
        margin: 2,
        color: { dark: '#1A202C', light: '#FFFFFF' },
        errorCorrectionLevel: 'H',
      });

      await pool.query(
        'UPDATE cav SET qr_code_data = $1, qr_code_image_path = $2 WHERE id = $3',
        [qrData, `/uploads/qrcodes/${qrFilename}`, cav.id]
      );

      generated++;
      if (generated % 20 === 0) {
        console.log(`  ${generated}/${result.rows.length} générés...`);
      }
    }

    console.log(`Terminé : ${generated} QR codes générés avec succès.`);

    // Vérification finale
    const check = await pool.query(
      "SELECT COUNT(*) as total FROM cav WHERE qr_code_data IS NOT NULL AND qr_code_data != ''"
    );
    const missing = await pool.query(
      "SELECT COUNT(*) as total FROM cav WHERE qr_code_data IS NULL OR qr_code_data = ''"
    );
    console.log(`Total CAV avec QR : ${check.rows[0].total}`);
    console.log(`Total CAV sans QR : ${missing.rows[0].total}`);

    process.exit(0);
  } catch (err) {
    console.error('Erreur:', err);
    process.exit(1);
  }
}

main();
