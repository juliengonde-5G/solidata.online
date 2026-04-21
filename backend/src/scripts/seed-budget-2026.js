require('dotenv').config();
const pool = require('../config/database');

// ══════════════════════════════════════════
// SEED BUDGET 2026
// Budget prévisionnel Solidarité Textiles avec hiérarchie Niveau 1 / Niveau 2.
// Convention de signe : charges positives, produits/aides/ventes négatifs.
// Total annuel budgété (résultat) : 9 050,33 EUR
// ══════════════════════════════════════════

// Ordre des mois : 0 = Janvier … 11 = Décembre
const BUDGET_2026 = [
  // Achat de Matière
  ['Achat de Matière', 'Achat de Matière',        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['Achat de Matière', 'Traitement CSR',          [0, 0, 0, 0, 0, 4000, 0, 0, 0, 4000, 0, 4000]],
  ['Achat de Matière', 'Transport sur achats',    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],

  // Aides et Subventions Publiques (produits → négatif)
  ['Aides et Subventions Publiques', 'Aide au poste',           [-49357, -49357, -49357, -49357, -49357, -49357, -86725.08, -49357, -49357, -49357, -49357, -49357]],
  ['Aides et Subventions Publiques', 'Autres soutiens publics', [0, 0, 0, -90000, 0, -86642, 0, 0, -27902, 0, 0, -44402]],
  ['Aides et Subventions Publiques', 'Soutien au tri',          [0, 0, -27581.60, 0, 0, -31070, 0, 0, -30386.24, -4250, -6470, -35324.25]],

  // Autres revenus (produits → négatif)
  ['Autres revenus', 'Autres revenus', [-3100, -3100, -3100, -3100, -3100, -3960, -3100, -3100, -3950, -3100, -3100, -5968]],

  // Bâtiment et Infrastructures
  ['Bâtiment et Infrastructures', 'Audit et Vérification', [0, 650, 0, 184, 650, 0, 415, 650, 0, 0, 650, 323]],
  ['Bâtiment et Infrastructures', 'Energies',              [2701.22, 1801.22, 2701.22, 1801.22, 2701.22, 1801.22, 2701.22, 1801.22, 2701.22, 1801.22, 2701.22, 1801.22]],
  ['Bâtiment et Infrastructures', 'Entretien Batiment',    [0, 0, 1800, 0, 0, 0, 0, 800, 0, 0, 0, 0]],
  ['Bâtiment et Infrastructures', 'Location Batiment',     [7208.41, 7208.41, 7208.41, 7208.41, 7208.41, 7208.41, 7208.41, 7208.41, 7208.41, 7208.41, 7208.41, 7208.41]],

  // Déplacements
  ['Déplacements Missions Réceptions', 'Déplacements Missions Réceptions', [2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000]],

  // Emprunts
  ['Emprunts', 'Emprunts', [23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12]],

  // Fiscalité
  ['Fiscalité', 'Fiscalité', [1969, 1969, 1969, 1969, 1969, 1969, 1969, 1969, 1969, 1969, 1969, 4469]],

  // Flux Interne et Intragroupe
  ['Flux Interne et Intragroupe', 'Flux Interne et Intragroupe', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],

  // Frais Généraux
  ['Frais Généraux', 'Abonnements & Logiciels',               [306.60, 146.60, 176.60, 143, 143, 143, 143, 143, 143, 143, 143, 143]],
  ['Frais Généraux', 'Assurances',                            [1244.78, 1114.09, 1114.09, 1114.09, 1114.09, 1114.09, 1114.09, 1114.09, 1114.09, 1114.09, 1114.09, 1114.09]],
  ['Frais Généraux', 'Copieurs',                              [260, 260, 260, 260, 260, 260, 250, 250, 250, 250, 250, 250]],
  ['Frais Généraux', 'Fournitures administratives / Bureau',  [700, 700, 1700, 700, 700, 1700, 700, 700, 1700, 700, 700, 1700]],
  ['Frais Généraux', 'Frais Bancaires',                       [136.54, 136.54, 136.54, 136.54, 136.54, 136.54, 136.54, 136.54, 136.54, 336.54, 136.54, 136.54]],
  ['Frais Généraux', 'Infogérance',                           [512, 512, 512, 512, 512, 512, 512, 512, 512, 512, 512, 512]],
  ['Frais Généraux', 'Marketing',                             [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80]],
  ['Frais Généraux', 'Télécoms',                              [611, 520, 520, 611, 520, 520, 611, 520, 520, 611, 520, 520]],

  // Honoraires et Prestations
  ['Honoraires et Prestations', 'Honoraires et Prestations', [2956.67, 2956.67, 2956.67, 6356.67, 2956.67, 3706.67, 2956.67, 2956.67, 2956.67, 2956.67, 2956.67, 2956.67]],

  // Masse Salariale
  ['Masse Salariale', 'Formations / Insertion',  [4583.33, 4583.33, 4583.33, 4583.33, 4583.33, 4583.33, 4583.33, 4583.33, 4583.33, 4583.33, 4583.33, 4583.33]],
  ['Masse Salariale', 'Médecine du travail',     [120, 120, 120, 120, 120, 1620, 120, 120, 120, 120, 120, 120]],
  ['Masse Salariale', 'Salaire et Charges',      [67332.83, 67332.83, 67332.83, 75212.83, 75212.83, 75212.83, 75212.83, 75212.83, 75212.83, 75212.83, 75212.83, 112055.17]],

  // Matériel de tri et de collecte
  ['Matériel de tri et de collecte', 'Consommable de collecte (Sacs...)', [500, 800, 1400, 0, 0, 1400, 500, 0, 1400, 800, 0, 1400]],
  ['Matériel de tri et de collecte', 'Location CAV',                      [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200]],
  ['Matériel de tri et de collecte', 'Location Equipements Entrepot',     [997, 192, 192, 2687, 182, 182, 987, 182, 182, 987, 182, 182]],

  // Matériels et Equipements
  ['Matériels et Equipements', 'Entretien Matériel', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['Matériels et Equipements', 'EPI',                [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],

  // Transports
  ['Transports', 'Transports', [3300, 2200, 2200, 0, 0, 700, 0, 0, 0, 0, 2750, 3450]],

  // Véhicules
  ['Véhicules', 'Carburant',            [2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150]],
  ['Véhicules', 'Location Véhicules',   [4859.27, 4859.27, 4565, 4565, 4565, 4565, 4565, 4565, 4565, 4565, 4565, 4565]],
  ['Véhicules', 'Maintenance Véhicules',[400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400]],
  ['Véhicules', 'Réparation Véhicules', [1800, 0, 0, 1800, 0, 0, 1800, 0, 0, 1800, 0, 0]],

  // Ventes (produits → négatif)
  ['Vente Interne',  'Vente Interne',  [-15066, -9300, -11850, -13200, -13850, -15800, -13850, -8000, -15900, -16800, -19000, -16750]],
  ['Vente Original', 'Vente Original', [-19235.20, -13760, -13620, -7460, -7460, -7460, -7360, -7360, -7360, -7460, -16850, -16750]],
  ['Vente Trié',     'Vente Trié',     [-467.80, 0, 0, -250, 0, 0, -250, 0, 0, -250, 0, 0]],
];

async function getOrCreateExercise(client, year) {
  const r = await client.query('SELECT id FROM financial_exercises WHERE year = $1', [year]);
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await client.query(
    'INSERT INTO financial_exercises (year, status) VALUES ($1, $2) RETURNING id',
    [year, 'open']
  );
  return ins.rows[0].id;
}

async function seedBudget2026() {
  const YEAR = 2026;
  const client = await pool.connect();
  try {
    console.log(`[SEED-BUDGET] Démarrage du seed budget ${YEAR}...`);
    await client.query('BEGIN');

    const exerciseId = await getOrCreateExercise(client, YEAR);
    console.log(`[SEED-BUDGET] Exercice ${YEAR} id=${exerciseId}`);

    const del = await client.query(
      'DELETE FROM financial_budgets WHERE exercise_id = $1',
      [exerciseId]
    );
    console.log(`[SEED-BUDGET] ${del.rowCount} lignes existantes supprimées`);

    let inserted = 0;
    let totalAnnuel = 0;
    for (const [niveau1, niveau2, months] of BUDGET_2026) {
      const category = `${niveau1} ${niveau2}`;
      for (let m = 0; m < 12; m++) {
        const amount = months[m];
        totalAnnuel += amount;
        await client.query(
          `INSERT INTO financial_budgets
             (exercise_id, niveau_1, niveau_2, category, month, amount)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (exercise_id, category, month)
           DO UPDATE SET amount = EXCLUDED.amount,
                         niveau_1 = EXCLUDED.niveau_1,
                         niveau_2 = EXCLUDED.niveau_2,
                         updated_at = NOW()`,
          [exerciseId, niveau1, niveau2, category, m, amount]
        );
        inserted++;
      }
    }

    await client.query('COMMIT');
    console.log(`[SEED-BUDGET] ${inserted} lignes insérées ✓`);
    console.log(`[SEED-BUDGET] Total annuel budgété : ${totalAnnuel.toFixed(2)} EUR`);
    console.log(`[SEED-BUDGET] Seed ${YEAR} terminé avec succès`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED-BUDGET] ERREUR :', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedBudget2026()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  module.exports = { seedBudget2026 };
}
