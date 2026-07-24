/**
 * Module Pilotage RSE (RSEI-10) — socle schéma (analyse statique d'init-db.js,
 * même approche que insertion-schema-v2.test.js : aucune base requise).
 *
 * Vérifie :
 * - les 7 tables du module créées en CREATE TABLE IF NOT EXISTS ;
 * - le seed idempotent des 27 critères EXACTS (ON CONFLICT (referentiel, code)
 *   DO NOTHING) — niveaux laissés NULL (doctrine « jamais de valeur inventée ») ;
 * - les CHECK de niveaux (1-4) et d'enums (statut/priorité/type) ;
 * - l'ordre des FK (rsei_evaluation_items.action_id APRÈS rsei_actions) ;
 * - le seed de l'entrée registre RGPD « Pilotage RSE » (WHERE NOT EXISTS) ;
 * - le rattachement des 7 tables au resync des séquences SERIAL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

const RSE_TABLES = [
  'rsei_criteres', 'rsei_actions', 'rsei_preuves', 'rsei_evaluations',
  'rsei_evaluation_items', 'rsei_parties_prenantes', 'rsei_interactions',
];

// Les 27 critères EXACTS du référentiel RSEi-2026 (code → intitulé attendu).
const CRITERES = {
  '1.1': "Projet d''entreprise et modèle d''affaires",
  '1.2': 'Identification et dialogue avec les parties prenantes',
  '1.3': 'Gouvernance et instances de décisions stratégiques',
  '1.4': 'Ancrage territorial',
  '1.5': "Pilotage du projet d''entreprise et plan d''action RSE",
  '1.6': 'Veille technologique et concurrentielle',
  '1.7': 'Achats durables et socialement responsables',
  '1.8': 'Indicateurs économiques et de gouvernance responsables',
  '2.1': 'Emplois et compétences',
  '2.2': "Promotion de l''égalité et de la diversité",
  '2.3': 'Dialogue social',
  '2.4': 'Santé et sécurité au travail',
  '2.5': 'Organisation, contenu et réalisation du travail',
  '2.6': 'Indicateurs liés aux ressources humaines',
  '3.1': "Mission d''inclusion",
  '3.2': 'Accueil, recrutement et intégration',
  '3.3': 'Accompagnement durant le parcours',
  '3.4': 'Préparation à la sortie',
  '4.1': 'Démarche environnementale',
  '4.2': 'Énergies et GES',
  '4.3': "Préservation de la ressource et contribution à l''économie circulaire",
  '4.4': 'Sensibilisation aux enjeux environnementaux et partenariats',
  '4.5': 'Indicateurs environnementaux',
  '5.1': 'Évaluations internes',
  '5.2': 'Analyse des résultats',
  '5.3': 'Évaluation de la satisfaction des parties prenantes',
  '5.4': "Bilan et amélioration du plan d''action RSE",
};

describe('schéma RSE — les 7 tables du module', () => {
  test('chaque table est créée en CREATE TABLE IF NOT EXISTS', () => {
    for (const t of RSE_TABLES) {
      expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('rsei_criteres : niveaux 1-4 NULLABLES (aucun DEFAULT), UNIQUE(referentiel, code)', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS rsei_criteres'));
    expect(tbl.slice(0, 900)).toMatch(/niveau_vise SMALLINT CHECK \(niveau_vise BETWEEN 1 AND 4\)/);
    expect(tbl.slice(0, 900)).toMatch(/niveau_auto_evalue SMALLINT CHECK \(niveau_auto_evalue BETWEEN 1 AND 4\)/);
    expect(tbl.slice(0, 900)).not.toMatch(/niveau_vise SMALLINT[^,]*DEFAULT/);
    expect(tbl.slice(0, 900)).toContain('UNIQUE (referentiel, code)');
    expect(tbl.slice(0, 900)).toContain("referentiel VARCHAR(30) NOT NULL DEFAULT 'RSEi-2026'");
  });

  test('rsei_actions : statut + priorité contraints, critere_codes TEXT[]', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS rsei_actions'));
    expect(tbl.slice(0, 1000)).toMatch(/CHECK \(statut IN \('a_faire', 'en_cours', 'realise', 'abandonne'\)\)/);
    expect(tbl.slice(0, 1000)).toMatch(/CHECK \(priorite IN \('haute', 'moyenne', 'basse'\)\)/);
    expect(tbl.slice(0, 1000)).toContain('critere_codes TEXT[]');
  });

  test('rsei_preuves : reference UNIQUE + péremption (echeance_fraicheur)', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS rsei_preuves'));
    expect(tbl.slice(0, 900)).toMatch(/reference VARCHAR\(20\) NOT NULL UNIQUE/);
    expect(tbl.slice(0, 900)).toContain('echeance_fraicheur DATE');
    expect(tbl.slice(0, 900)).toContain('fichier_path TEXT');
    expect(tbl.slice(0, 900)).toContain('lien_interne TEXT');
  });

  test('rsei_evaluations / items : enums + UNIQUE(evaluation_id, critere_code)', () => {
    const ev = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS rsei_evaluations'));
    expect(ev.slice(0, 800)).toMatch(/CHECK \(type IN \('auto_evaluation', 'audit_interne'\)\)/);
    expect(ev.slice(0, 800)).toMatch(/CHECK \(statut IN \('en_cours', 'cloturee'\)\)/);
    const it = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS rsei_evaluation_items'));
    expect(it.slice(0, 900)).toContain('UNIQUE (evaluation_id, critere_code)');
    expect(it.slice(0, 900)).toMatch(/niveau_constate SMALLINT CHECK \(niveau_constate BETWEEN 1 AND 4\)/);
  });

  test('la FK action_id est déclarée APRÈS la création de rsei_actions', () => {
    const actionsIdx = src.indexOf('CREATE TABLE IF NOT EXISTS rsei_actions');
    const fkIdx = src.indexOf('action_id INTEGER REFERENCES rsei_actions(id)');
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(fkIdx).toBeGreaterThan(actionsIdx);
  });

  test('rsei_parties_prenantes / rsei_interactions : matrice + journal contraint', () => {
    const pp = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS rsei_parties_prenantes'));
    expect(pp.slice(0, 700)).toMatch(/influence SMALLINT CHECK \(influence BETWEEN 1 AND 4\)/);
    expect(pp.slice(0, 700)).toMatch(/interet SMALLINT CHECK \(interet BETWEEN 1 AND 4\)/);
    const it = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS rsei_interactions'));
    expect(it.slice(0, 800)).toContain('partie_prenante_id INTEGER NOT NULL REFERENCES rsei_parties_prenantes(id) ON DELETE CASCADE');
    expect(it.slice(0, 800)).toMatch(/CHECK \(type IN \('dialogue', 'demande', 'reclamation', 'information'\)\)/);
  });
});

describe('schéma RSE — seed idempotent des 27 critères', () => {
  const seed = src.slice(
    src.indexOf('INSERT INTO rsei_criteres (referentiel, chapitre, code, intitule, ordre) VALUES'),
    src.indexOf('ON CONFLICT (referentiel, code) DO NOTHING;') + 60
  );

  test('le seed existe et est idempotent (ON CONFLICT (referentiel, code) DO NOTHING)', () => {
    expect(seed).toContain('ON CONFLICT (referentiel, code) DO NOTHING');
    expect(seed).toContain("'RSEi-2026'");
  });

  test('les 27 codes et intitulés EXACTS sont présents', () => {
    const codes = Object.keys(CRITERES);
    expect(codes).toHaveLength(27);
    for (const [code, intitule] of Object.entries(CRITERES)) {
      expect(seed).toContain(`'${code}', '${intitule}'`);
    }
  });

  test('les niveaux ne sont PAS seedés (colonnes limitées à referentiel/chapitre/code/intitulé/ordre)', () => {
    expect(seed).toMatch(/INSERT INTO rsei_criteres \(referentiel, chapitre, code, intitule, ordre\) VALUES/);
    expect(seed).not.toContain('niveau_vise');
    expect(seed).not.toContain('niveau_auto_evalue');
  });
});

describe('schéma RSE — registre RGPD + resync séquences', () => {
  test("entrée registre RGPD « Pilotage RSE (agrégats non nominatifs) » (WHERE NOT EXISTS)", () => {
    const idx = src.indexOf("'Pilotage RSE (agrégats non nominatifs)'");
    expect(idx).toBeGreaterThan(-1);
    const seg = src.slice(idx - 200, idx + 2500);
    expect(seg).toContain('INSERT INTO rgpd_registre');
    expect(seg).toContain('WHERE NOT EXISTS');
    // Minimisation explicitement documentée (aucune donnée de parcours).
    expect(seg).toMatch(/AUCUNE donnée individuelle de salarié en parcours/);
  });

  test('les 7 tables RSE sont ajoutées au resync des séquences SERIAL', () => {
    const arr = src.slice(src.indexOf('const tablesAResyncer = ['), src.indexOf('const tablesAResyncer = [') + 1800);
    for (const t of RSE_TABLES) {
      expect(arr).toContain(`'${t}'`);
    }
  });
});
