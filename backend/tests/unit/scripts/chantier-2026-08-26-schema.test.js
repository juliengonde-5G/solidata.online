/**
 * Chantier du 26/08/2026 — socle schéma commun (analyse statique d'init-db.js,
 * même approche que achats-schema.test.js / energie-schema.test.js : AUCUNE base
 * requise, la DDL réelle est rejouée séparément sur PostgreSQL 16).
 *
 * Ce fichier est une garde ANTI-DÉRIVE de la DDL figée au contrat
 * (rapports/evolutions-2026-08-26/CONTRATS.md §1) : sept lots consomment ces
 * tables en parallèle, une colonne renommée ou une contrainte perdue casserait
 * un lot voisin sans que rien ne le signale.
 *
 * Vérifie :
 * - §1.1 messagerie : 4 tables, double identité utilisateur/véhicule, et surtout
 *   les index UNIQUE PARTIELS (un UNIQUE composite avec NULL ne déduplique pas) ;
 * - §1.2 configurateur de chaîne : un seul layout actif, code unique par layout ;
 * - §1.3 arrêts GPS : unicité (tour_id, debut) qui rend le recalcul idempotent ;
 * - §1.4 colonnes additives sur des tables NON créées ici (jamais recréées) ;
 * - §1.5 réglages seedés — et le verrou du plan V7 délibérément NON seedé ;
 * - §1.6 entrée du registre RGPD, idempotente ;
 * - l'ordre d'apparition (FK après leurs tables parentes) et le rattachement au
 *   resync des séquences SERIAL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

// Le marqueur de fin est cherché APRÈS le marqueur de début : sans cela une
// borne banale (« ]; ») renverrait une tranche vide et le test passerait à vide.
const bloc = (debut, fin) => {
  const i = src.indexOf(debut);
  expect(i).toBeGreaterThan(-1);
  const j = src.indexOf(fin, i + debut.length);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};
const table = (nom) => {
  const start = src.indexOf(`CREATE TABLE IF NOT EXISTS ${nom} (`);
  return src.slice(start, src.indexOf(');', start));
};

// ══════════════════════════════════════════════════════════════════════════
// §1.1 — Messagerie interne
// ══════════════════════════════════════════════════════════════════════════
describe('§1.1 messagerie interne — 4 tables', () => {
  const TABLES = [
    'messagerie_conversations', 'messagerie_participants',
    'messagerie_messages', 'messagerie_mentions',
  ];

  test('chaque table est créée en CREATE TABLE IF NOT EXISTS', () => {
    for (const t of TABLES) {
      expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('conversations : CHECK type + cle_unique UNIQUE (déduplication serveur)', () => {
    const t = table('messagerie_conversations');
    expect(t).toContain("CHECK (type IN ('directe', 'bot', 'systeme'))");
    expect(t).toContain('cle_unique VARCHAR(120) UNIQUE');
    expect(t).toContain('created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
    expect(t).toContain('dernier_message_at TIMESTAMP');
  });

  test('participants : double identité utilisateur/véhicule, jamais aucune des deux', () => {
    const t = table('messagerie_participants');
    expect(t).toContain('conversation_id INTEGER NOT NULL REFERENCES messagerie_conversations(id) ON DELETE CASCADE');
    expect(t).toContain('user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
    expect(t).toContain('vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE');
    expect(t).toContain('CHECK (user_id IS NOT NULL OR vehicle_id IS NOT NULL)');
    // L'accusé de lecture n'a PAS de FK : il doit survivre à la purge RGPD du
    // message qu'il désigne (la purge recale les pointeurs orphelins).
    expect(t).toMatch(/dernier_lu_message_id INTEGER\s*,/);
    expect(t).not.toMatch(/dernier_lu_message_id INTEGER REFERENCES/);
  });

  test('participants : index UNIQUE PARTIELS (un UNIQUE composite avec NULL ne déduplique pas)', () => {
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_msgp_conv_user\s+ON messagerie_participants\(conversation_id, user_id\) WHERE user_id IS NOT NULL/);
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_msgp_conv_vehicule\s+ON messagerie_participants\(conversation_id, vehicle_id\) WHERE vehicle_id IS NOT NULL/);
    expect(src).toContain('idx_msgp_user ON messagerie_participants(user_id)');
    expect(src).toContain('idx_msgp_vehicule ON messagerie_participants(vehicle_id)');
  });

  test('messages : CHECK auteur_type et type, auteurs en SET NULL (l\'historique survit au compte)', () => {
    const t = table('messagerie_messages');
    expect(t).toContain("CHECK (auteur_type IN ('utilisateur', 'chauffeur', 'bot', 'systeme'))");
    expect(t).toContain("CHECK (type IN ('texte', 'notification'))");
    expect(t).toContain('auteur_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    expect(t).toContain('auteur_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL');
    expect(t).toContain('texte TEXT NOT NULL');
    expect(t).toContain('source VARCHAR(50)');
    expect(t).toContain('lien VARCHAR(300)');
    // Pas de pièce jointe en v1 : aucune colonne de fichier.
    expect(t).not.toMatch(/fichier_path|piece_jointe/);
    // Pagination du fil + balayage de la purge.
    expect(src).toContain('idx_msgm_conv ON messagerie_messages(conversation_id, id)');
    expect(src).toContain('idx_msgm_created ON messagerie_messages(created_at)');
  });

  test('mentions : cascade sur le message, même double identité', () => {
    const t = table('messagerie_mentions');
    expect(t).toContain('message_id INTEGER NOT NULL REFERENCES messagerie_messages(id) ON DELETE CASCADE');
    expect(t).toContain('CHECK (user_id IS NOT NULL OR vehicle_id IS NOT NULL)');
    expect(src).toContain('idx_msgmention_msg ON messagerie_mentions(message_id)');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// §1.2 — Configurateur 2D de la chaîne de tri
// ══════════════════════════════════════════════════════════════════════════
describe('§1.2 configurateur de chaîne — layouts et blocs', () => {
  test('chaine_layouts : CHECK source + UN SEUL layout actif garanti par la base', () => {
    const t = table('chaine_layouts');
    expect(t).toContain("CHECK (source IN ('seed_v7', 'manuel', 'duplication'))");
    expect(t).toContain('is_actif BOOLEAN NOT NULL DEFAULT false');
    expect(t).toContain('effectif_max INTEGER');
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_chaine_layouts_actif\s+ON chaine_layouts\(is_actif\) WHERE is_actif = true/);
  });

  test('chaine_layout_postes : 3 catégories, code unique par layout, positions en %', () => {
    const t = table('chaine_layout_postes');
    expect(t).toContain('layout_id INTEGER NOT NULL REFERENCES chaine_layouts(id) ON DELETE CASCADE');
    expect(t).toContain("CHECK (categorie IN ('poste', 'zone_depose', 'entree'))");
    expect(t).toContain('UNIQUE (layout_id, code)');
    // Pourcentages 0-100 du canevas : NUMERIC(6,2), pas des pixels entiers.
    expect(t).toContain('x NUMERIC(6,2) NOT NULL DEFAULT 0');
    expect(t).toContain('y NUMERIC(6,2) NOT NULL DEFAULT 0');
    expect(t).toContain('effectif_min INTEGER NOT NULL DEFAULT 0');
    expect(t).toContain('effectif_max INTEGER NOT NULL DEFAULT 1');
    // Le plan survit à une refonte du référentiel de production.
    expect(t).toContain('poste_operation_id INTEGER REFERENCES postes_operation(id) ON DELETE SET NULL');
    expect(t).toContain('proprietes JSONB');
    expect(src).toContain('idx_chaine_layout_postes_layout ON chaine_layout_postes(layout_id)');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// §1.3 — Arrêts GPS des tournées
// ══════════════════════════════════════════════════════════════════════════
describe('§1.3 arrêts GPS — tour_gps_stops', () => {
  test('rattachements facultatifs en SET NULL et types fermés', () => {
    const t = table('tour_gps_stops');
    expect(t).toContain('tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE');
    expect(t).toContain('vehicle_id INTEGER NOT NULL REFERENCES vehicles(id)');
    expect(t).toContain("CHECK (type IN ('cav', 'centre', 'association', 'inconnu'))");
    expect(t).toContain("CHECK (source IN ('cloture', 'recalcul'))");
    expect(t).toContain('cav_id INTEGER REFERENCES cav(id) ON DELETE SET NULL');
    expect(t).toContain('association_point_id INTEGER REFERENCES association_points(id) ON DELETE SET NULL');
    // duree_min au dixième de minute, jamais un entier arrondi.
    expect(t).toContain('duree_min NUMERIC(6,1)');
    // `fin` nullable : un arrêt encore ouvert ne se clôt pas par une valeur inventée.
    expect(t).toMatch(/fin TIMESTAMP\s*,/);
  });

  test('UNIQUE (tour_id, debut) : le recalcul ne peut pas doubler un arrêt', () => {
    expect(table('tour_gps_stops')).toContain('UNIQUE (tour_id, debut)');
  });

  test('index de lecture, dont l\'index partiel du croisement temps de vidage / CAV', () => {
    expect(src).toContain('idx_tour_gps_stops_tour ON tour_gps_stops(tour_id)');
    expect(src).toContain('idx_tour_gps_stops_cav ON tour_gps_stops(cav_id) WHERE cav_id IS NOT NULL');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// §1.4 — Colonnes additives (tables créées AILLEURS)
// ══════════════════════════════════════════════════════════════════════════
describe('§1.4 récurrence commandes + Pennylane — colonnes additives', () => {
  const section = bloc('// ── §1.4 — Récurrence commandes exutoires', '// ── §1.5 — Réglages par défaut');

  test('aucune de ces trois tables n\'est (re)créée ici — elles vivent ailleurs', () => {
    for (const t of ['commandes_exutoires', 'clients_exutoires', 'pennylane_config']) {
      expect(src).not.toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('présence testée avant ALTER : sur une base neuve, la migration est reportée et DITE', () => {
    // information_schema interrogé en requête PARAMÉTRÉE (jamais d'interpolation).
    expect(section).toMatch(/information_schema\.tables WHERE table_schema = 'public' AND table_name = \$1/);
    for (const t of ['commandes_exutoires', 'clients_exutoires', 'pennylane_config']) {
      expect(section).toContain(`tableExiste('${t}')`);
    }
    // Trois skips explicitement journalisés — jamais un échec silencieux.
    expect(section.match(/console\.warn\(/g) || []).toHaveLength(3);
    expect(section).toMatch(/reportées? au prochain init-db/);
  });

  test('commandes_exutoires : 2 colonnes + index anti-doublon de génération', () => {
    expect(section).toContain('ADD COLUMN IF NOT EXISTS prochaine_echeance DATE');
    expect(section).toContain('ADD COLUMN IF NOT EXISTS recurrence_suspendue BOOLEAN NOT NULL DEFAULT false');
    expect(section).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_cmd_exu_fille_unique\s+ON commandes_exutoires\(commande_parent_id, date_commande\) WHERE commande_parent_id IS NOT NULL/);
    // Statut de modèle DÉRIVÉ : aucune colonne de ce genre n'est ajoutée
    // (on teste les ADD COLUMN, pas les commentaires qui expliquent l'arbitrage).
    const colonnesAjoutees = section.match(/ADD COLUMN IF NOT EXISTS \w+/g) || [];
    expect(colonnesAjoutees.some((c) => /modele/i.test(c))).toBe(false);
    expect(colonnesAjoutees).toHaveLength(5);
    // Le CHECK `frequence` existant reste intouché.
    expect(section).not.toMatch(/frequence.*CHECK|DROP CONSTRAINT.*frequence/);
  });

  test('pennylane_config : curseur DÉDIÉ, last_sync_at partagé jamais touché', () => {
    expect(section).toContain('ALTER TABLE pennylane_config ADD COLUMN IF NOT EXISTS last_invoice_sync_at TIMESTAMP');
    expect(section).not.toMatch(/ALTER TABLE pennylane_config[\s\S]{0,120}last_sync_at\b(?!_)/);
  });

  test('clients_exutoires : liaison Pennylane unique, index partiel (les non liés restent libres)', () => {
    expect(section).toContain('ADD COLUMN IF NOT EXISTS pennylane_customer_id VARCHAR(60)');
    expect(section).toContain('ADD COLUMN IF NOT EXISTS pennylane_customer_name VARCHAR(255)');
    expect(section).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_exu_pennylane\s+ON clients_exutoires\(pennylane_customer_id\) WHERE pennylane_customer_id IS NOT NULL/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// §1.5 / §1.6 — Réglages et registre RGPD
// ══════════════════════════════════════════════════════════════════════════
describe('§1.5 réglages par défaut', () => {
  const section = bloc('// ── §1.5 — Réglages par défaut', '// ── §1.6 — Registre RGPD');

  test('les 5 réglages du contrat sont seedés avec leur catégorie', () => {
    const attendus = [
      ["messagerie.retention_jours", '365', 'messagerie'],
      ['collecte.arret_seuil_min', '5', 'collecte'],
      ['collecte.arret_rayon_m', '40', 'collecte'],
      ['collecte.arret_rattachement_m', '80', 'collecte'],
      ['exutoires.recurrence_horizon_jours', '30', 'exutoires'],
    ];
    for (const [cle, valeur, categorie] of attendus) {
      expect(section).toContain(`['${cle}', '${valeur}', '${categorie}']`);
    }
  });

  test('seed idempotent, paramétré, et castant $1 (42P08 sur PostgreSQL 16)', () => {
    expect(section).toMatch(/INSERT INTO settings \(key, value, category\)\s+SELECT \$1::VARCHAR, \$2::TEXT, \$3::VARCHAR\s+WHERE NOT EXISTS \(SELECT 1 FROM settings WHERE key = \$1::VARCHAR\)/);
    // Aucune valeur interpolée dans le SQL.
    expect(section).not.toMatch(/INSERT INTO settings[\s\S]{0,200}\$\{/);
  });

  test('le verrou du plan V7 n\'est PAS seedé (il est posé APRÈS une création réussie)', () => {
    expect(section).not.toMatch(/\['tri\.chaine_layout_v7_seed'/);
    expect(src).not.toMatch(/INSERT INTO settings[^;]*tri\.chaine_layout_v7_seed/);
  });
});

describe('§1.6 registre RGPD — messagerie interne', () => {
  test('entrée seedée une seule fois, au nom exact du contrat', () => {
    const nom = 'Messagerie interne (conversations, mentions et notifications)';
    expect(src).toContain(`'${nom}'`);
    const section = bloc('// ── §1.6 — Registre RGPD', '// HOTFIX 2026-05');
    expect(section).toContain('INSERT INTO rgpd_registre');
    expect(section).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM rgpd_registre WHERE nom_traitement = /);
    // Les points qui font la valeur de la fiche art. 30.
    expect(section).toMatch(/Intérêt légitime/);
    expect(section).toMatch(/messagerie\.retention_jours/);
    expect(section).toMatch(/AUTO_PURGE_MESSAGERIE/);
    expect(section).toMatch(/AUCUNE pièce jointe/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Placement dans le fichier
// ══════════════════════════════════════════════════════════════════════════
describe('placement du bloc dans init-db.js', () => {
  test('les tables parentes des FK sont créées AVANT', () => {
    const debutBloc = src.indexOf('// ── §1.1 — Messagerie interne');
    expect(debutBloc).toBeGreaterThan(0);
    for (const parent of ['users', 'vehicles', 'tours', 'cav', 'association_points', 'postes_operation', 'settings', 'rgpd_registre']) {
      const iParent = src.indexOf(`CREATE TABLE IF NOT EXISTS ${parent} (`);
      expect(iParent).toBeGreaterThan(0);
      expect(iParent).toBeLessThan(debutBloc);
    }
  });

  test('les 7 tables neuves sont rattachées au resync des séquences SERIAL', () => {
    const liste = bloc('const tablesAResyncer = [', '];');
    for (const t of [
      'messagerie_conversations', 'messagerie_participants', 'messagerie_messages',
      'messagerie_mentions', 'chaine_layouts', 'chaine_layout_postes', 'tour_gps_stops',
    ]) {
      expect(liste).toContain(`'${t}'`);
    }
  });

  test('l\'auto-seed du plan V7 dégrade proprement tant que son module n\'est pas livré', () => {
    const section = bloc('// Chantier 26/08/2026 — Auto-seed du plan de chaîne de tri V7', "console.log('\\n[INIT-DB] ══");
    expect(section).toContain("require('./seed-chaine-v7')");
    expect(section).toContain("e.code === 'MODULE_NOT_FOUND'");
    // Jamais bloquant pour le démarrage, et jamais silencieux.
    expect(section).toMatch(/console\.warn\(/);
  });
});
