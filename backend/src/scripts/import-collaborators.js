require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

// Mapping des postes vers les équipes
const positionToTeamMap = {
  'Encadrante Technique': 'tri',
  'Conseillère En Insertion Principale / Référente': 'administration',
  'Salarie Polyvalent Cddi': 'tri',
  'Operateur De Tri Cddi': 'tri',
  'Operatrice De Tri Cddi': 'tri',
  'Chauffeur / Suiveur / Manutentionnaire Cddi': 'collecte',
  'Chauffeur Suiveur Polyvalent': 'collecte',
  'Chauffeur / Suiveur Cddi': 'collecte',
  'Operateur De Presse / Manutentionnaire Cddi': 'tri',
  'Conducteur De Presse / Manutentionnaire Cddi': 'tri',
  'Responsable Logistique': 'logistique',
  'Operatrice De Production': 'tri',
  'Cariste Manutentionnaire': 'logistique',
  'Assistant technique': 'administration',
  'Directeur des Opérations': 'administration',
  'Assistant Technique': 'administration',
  'Assistante Administrative': 'administration',
  'Apprenti CIP': 'administration',
};

// Mapping des types de contrat
const contractTypeMap = {
  'CDI': 'CDI',
  'CDD': 'CDD',
  'Apprentissage': 'apprentissage',
};

function parseDate(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split('/');
  return `${year}-${month}-${day}`;
}

async function importCollaborators() {
  const client = await pool.connect();
  try {
    console.log('[IMPORT] Lecture du fichier CSV...');

    const csvPath = path.join(__dirname, '../../..', 'collaborators_import.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');

    // Skip header
    const collaborators = lines.slice(1).map((line) => {
      const parts = line.split(',');
      return {
        malibou_id: parts[0],
        first_name: parts[1],
        last_name: parts[2],
        gender: parts[4] === 'F' ? 'female' : 'male',
        birth_date: parseDate(parts[5]),
        nationality: parts[6],
        position: parts[7],
        contract_type: parts[8],
      };
    });

    console.log(`[IMPORT] ${collaborators.length} collaborateurs trouvés`);

    await client.query('BEGIN');

    let created = 0;
    let failed = 0;

    for (const collab of collaborators) {
      try {
        // Déterminer l'équipe
        const teamType = positionToTeamMap[collab.position] || 'administration';

        // Récupérer l'ID de l'équipe
        const teamResult = await client.query(
          'SELECT id FROM teams WHERE type = $1 LIMIT 1',
          [teamType]
        );

        const team_id = teamResult.rows[0]?.id || null;

        // Déterminer le type de contrat
        const contractType = contractTypeMap[collab.contract_type] || 'CDD';

        // Créer l'employé
        const employeeResult = await client.query(
          `INSERT INTO employees (
            first_name, last_name, gender, team_id, position,
            contract_type, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
          RETURNING id`,
          [
            collab.first_name,
            collab.last_name,
            collab.gender,
            team_id,
            collab.position,
            contractType,
          ]
        );

        const employee_id = employeeResult.rows[0].id;

        // Créer le contrat
        const today = new Date().toISOString().split('T')[0];
        await client.query(
          `INSERT INTO employee_contracts (
            employee_id, contract_type, start_date, team_id,
            is_current, created_at
          ) VALUES ($1, $2, $3, $4, true, NOW())`,
          [employee_id, contractType, today, team_id]
        );

        console.log(`✓ ${collab.first_name} ${collab.last_name} (${collab.malibou_id})`);
        created++;
      } catch (err) {
        console.error(`✗ ${collab.first_name} ${collab.last_name}: ${err.message}`);
        failed++;
      }
    }

    await client.query('COMMIT');

    console.log(`\n[IMPORT] Résumé:`);
    console.log(`  ✓ Créés: ${created}`);
    console.log(`  ✗ Erreurs: ${failed}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[IMPORT] Erreur:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

async function deleteAllEmployees() {
  const client = await pool.connect();
  try {
    console.log('[DELETE] Suppression de tous les employés et contrats...');

    await client.query('BEGIN');

    // Supprimer les contrats d'abord (contrainte FK)
    await client.query('DELETE FROM employee_contracts');

    // Supprimer les employés
    await client.query('DELETE FROM employees');

    // Supprimer les pointages
    await client.query('DELETE FROM work_hours');

    // Supprimer les plannings
    await client.query('DELETE FROM schedule');

    // Supprimer les indisponibilités
    await client.query('DELETE FROM employee_availability');

    await client.query('COMMIT');

    console.log('[DELETE] ✓ Tous les employés ont été supprimés');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DELETE] Erreur:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    // Supprimer les employés existants
    await deleteAllEmployees();

    // Importer les nouveaux collaborateurs
    await importCollaborators();

    console.log('\n[IMPORT] Terminé avec succès');
  } catch (err) {
    console.error('[MAIN] Erreur:', err);
    process.exit(1);
  }
}

main();
