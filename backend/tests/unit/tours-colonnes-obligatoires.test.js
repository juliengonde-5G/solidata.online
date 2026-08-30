// ═══════════════════════════════════════════════════════════════════════════
// GARDE — toute création de tournée doit renseigner les colonnes OBLIGATOIRES
//
// Pourquoi ce test existe (incident du 30/08/2026) :
// `POST /api/tours/claim-vehicle` — le départ d'un chauffeur sur un véhicule
// LIBRE, donc le camion école entre deux stagiaires — répondait « Erreur
// serveur » (500). Cause : son `INSERT INTO tours` ne nommait pas la colonne
// `mode`, qui est NOT NULL SANS VALEUR PAR DÉFAUT (src/scripts/init-db.js).
// PostgreSQL refusait la ligne en 23502 et aucune tournée n'était créée.
//
// Cette faute était STRUCTURELLEMENT INVISIBLE de la batterie existante : les
// tests de contrat qui exercent cette route (`mobile-driver-session`) simulent
// le module `pg`. Or la contrainte n'existe que dans PostgreSQL — un mock
// accepte n'importe quel INSERT, si bien que la route était « verte » sur sept
// assertions tout en étant incapable d'écrire une seule ligne en production.
//
// La garde lit les sources en TEXTE, sans base ni exécution : elle recense les
// `INSERT INTO tours (...)` du backend et exige que chacun nomme les colonnes
// que la base rendrait obligatoires. Une neuvième création de tournée écrite
// demain hérite du contrôle sans que personne ait à y penser.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', '..', 'src');

/**
 * Colonnes de `tours` que PostgreSQL exige à l'insertion : NOT NULL et sans
 * DEFAULT. `vehicle_id` et `date` le sont aussi, mais aucune création ne les
 * a jamais oubliées — les inclure garde le contrôle honnête plutôt que taillé
 * sur le seul défaut constaté.
 */
const COLONNES_OBLIGATOIRES = ['date', 'vehicle_id', 'mode'];

function listSourceFiles(dir = SRC_ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) listSourceFiles(full, acc);
    else if (full.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** Chaque `INSERT INTO tours (col, col, ...)` du backend, avec sa provenance. */
function collectTourInserts() {
  const found = [];
  for (const file of listSourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /INSERT\s+INTO\s+tours\s*\(([^)]*)\)/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
      found.push({
        fichier: path.relative(SRC_ROOT, file),
        ligne: src.slice(0, m.index).split('\n').length,
        colonnes: m[1].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean),
      });
    }
  }
  return found;
}

describe('INSERT INTO tours — colonnes obligatoires en base', () => {
  const inserts = collectTourInserts();

  it('le dépôt contient bien des créations de tournée à contrôler', () => {
    // Sans ce garde-fou, une expression régulière devenue inopérante rendrait
    // la suite verte en ne contrôlant plus rien.
    expect(inserts.length).toBeGreaterThanOrEqual(8);
  });

  it.each(COLONNES_OBLIGATOIRES)(
    'toute création de tournée renseigne « %s » (NOT NULL sans défaut)',
    (colonne) => {
      const manquantes = inserts
        .filter((i) => !i.colonnes.includes(colonne))
        .map((i) => `${i.fichier}:${i.ligne}`);
      expect(manquantes).toEqual([]);
    }
  );

  it('les modes employés appartiennent au CHECK de la colonne', () => {
    // `mode VARCHAR(20) NOT NULL CHECK (mode IN ('intelligent','standard','manual'))`
    const autorises = ["'intelligent'", "'standard'", "'manual'"];
    const src = fs.readFileSync(path.join(SRC_ROOT, 'routes', 'tours', 'execution.js'), 'utf8');
    const litteraux = src.match(/'(intelligent|standard|manual)'/g) || [];
    litteraux.forEach((v) => expect(autorises).toContain(v));
  });
});

module.exports = { collectTourInserts, COLONNES_OBLIGATOIRES };
