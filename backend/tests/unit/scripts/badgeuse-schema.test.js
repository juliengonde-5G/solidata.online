/**
 * Module 33 « Temps & Présence » — socle schéma (analyse statique d'init-db.js,
 * même approche que enquetes-schema.test.js / achats-schema.test.js : aucune
 * base requise).
 *
 * Vérifie que le schéma PORTE LUI-MÊME les exigences bloquantes, plutôt que de
 * les laisser reposer sur la seule discipline du code applicatif :
 *  - les 8 tables du MODELE_DONNEES créées en CREATE TABLE IF NOT EXISTS ;
 *  - MINIMISATION : aucune colonne d'UID en clair, AUCUNE colonne photo ;
 *  - IDEMPOTENCE : uuid UNIQUE + index unique (device_id, sequence_device) ;
 *  - INALTÉRABILITÉ : colonnes de chaînage présentes ;
 *  - un seul badge ACTIF par salarié (index partiel unique) ;
 *  - liste FERMÉE des motifs de correction (aucun champ libre imposé) ;
 *  - COEXISTENCE (ADR-0003) : le module ne touche pas aux tables du module 25 ;
 *  - seed du site LH + entrée au registre RGPD (art. 30 : fiche obligatoire) ;
 *  - rattachement des 8 tables au resync des séquences SERIAL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

const BADGEUSE_TABLES = [
  'badgeuse_sites', 'badgeuse_devices', 'badgeuse_badges', 'badgeuse_badge_historique',
  'badgeuse_pointages', 'badgeuse_corrections', 'badgeuse_feuilles_temps', 'badgeuse_contenus',
];

/** Corps d'un CREATE TABLE (du nom de la table jusqu'au « ); » qui le ferme). */
function tableBody(nom) {
  const start = src.indexOf(`CREATE TABLE IF NOT EXISTS ${nom}`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf(');', start));
}

/**
 * Tranche de la section « Module 33 » d'init-db.js, bornée par son propre log de
 * clôture (et non par le bloc HOTFIX final) : le périmètre reste exact quelle que
 * soit la position de la section dans le fichier.
 */
function sectionBadgeuse() {
  const start = src.indexOf('MODULE 33 — TEMPS & PRÉSENCE');
  const end = src.indexOf("[INIT-DB] Module 33 Temps & Présence (badgeuse)");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('les 8 tables du module', () => {
  test('chaque table est créée en CREATE TABLE IF NOT EXISTS (idempotence)', () => {
    for (const t of BADGEUSE_TABLES) {
      expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('la section est placée AVANT le resync des séquences SERIAL', () => {
    expect(src.indexOf('CREATE TABLE IF NOT EXISTS badgeuse_sites'))
      .toBeLessThan(src.indexOf('const tablesAResyncer'));
  });

  test('les 8 tables sont rattachées au resync des séquences SERIAL', () => {
    const bloc = src.slice(src.indexOf('const tablesAResyncer'), src.indexOf('const SAFE_TABLE'));
    for (const t of BADGEUSE_TABLES) expect(bloc).toContain(`'${t}'`);
  });

  test('tous les index sont créés en CREATE INDEX IF NOT EXISTS', () => {
    const section = sectionBadgeuse();
    const creations = section.match(/CREATE (UNIQUE )?INDEX[^;]*/g) || [];
    expect(creations.length).toBeGreaterThanOrEqual(8);
    for (const c of creations) expect(c).toMatch(/IF NOT EXISTS/);
  });
});

describe('MINIMISATION — exigences NOTE_JURIDIQUE §3.4 portées par le schéma', () => {
  test('AUCUNE colonne photo nulle part dans le module (exclusion absolue)', () => {
    const section = sectionBadgeuse();
    // Le mot « photo » n'apparaît que dans le commentaire qui rappelle l'exclusion.
    const sql = section.replace(/\/\/[^\n]*/g, '');
    expect(sql).not.toMatch(/photo\w*\s+(VARCHAR|TEXT|BYTEA)/i);
    expect(sql).not.toMatch(/\bphoto_path\b/);
  });

  test('AUCUNE colonne d\'UID en clair : seul uid_hmac existe', () => {
    for (const t of ['badgeuse_badges', 'badgeuse_pointages']) {
      const body = tableBody(t);
      expect(body).toMatch(/uid_hmac VARCHAR\(64\)/);
      expect(body).not.toMatch(/\bbadge_uid\b|\buid_clair\b|\braw_uid\b/);
      // Pas de colonne nommée simplement « uid ».
      expect(body).not.toMatch(/^\s*uid\s+VARCHAR/m);
    }
  });

  test('badgeuse_badges.uid_hmac est UNIQUE et NOT NULL (le pseudonyme est la clé)', () => {
    expect(tableBody('badgeuse_badges')).toMatch(/uid_hmac VARCHAR\(64\) NOT NULL UNIQUE/);
  });

  test('aucune donnée de santé, de statut IAE ou de géolocalisation dans le module', () => {
    const section = sectionBadgeuse();
    const sql = section.replace(/--[^\n]*/g, '').replace(/\/\/[^\n]*/g, '');
    for (const interdit of [/\bsante\b/i, /\brqth\b/i, /latitude/i, /longitude/i, /\bnir\b/i]) {
      expect(sql).not.toMatch(interdit);
    }
  });

  test('les contenus d\'affichage n\'ont AUCUNE FK vers un salarié (finalité dissociée)', () => {
    const body = tableBody('badgeuse_contenus');
    expect(body).not.toMatch(/REFERENCES employees/);
    expect(body).not.toMatch(/\bemployee_id\b/);
    // Seul l'auteur (utilisateur back-office) est tracé.
    expect(body).toMatch(/cree_par INTEGER REFERENCES users\(id\)/);
  });
});

describe('INALTÉRABILITÉ et IDEMPOTENCE des pointages', () => {
  const body = () => tableBody('badgeuse_pointages');

  test('uuid UNIQUE : le rejeu d\'un lot ne peut pas dupliquer une heure', () => {
    expect(body()).toMatch(/uuid UUID NOT NULL UNIQUE/);
  });

  test('index unique partiel (device_id, sequence_device) : une séquence n\'est jamais réutilisée', () => {
    expect(src).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_badgeuse_pointages_device_sequence\s*\n?\s*ON badgeuse_pointages\(device_id, sequence_device\) WHERE device_id IS NOT NULL/
    );
  });

  test('colonnes de chaînage cryptographique présentes', () => {
    const b = body();
    expect(b).toMatch(/hash_precedent VARCHAR\(64\)/);
    expect(b).toMatch(/hash_courant VARCHAR\(64\)/);
    expect(b).toMatch(/chaine_valide BOOLEAN NOT NULL DEFAULT true/);
    expect(b).toMatch(/sequence_device BIGINT/);
  });

  test('horodatage_utc NOT NULL et TIMESTAMPTZ (instants, pas heures murales)', () => {
    expect(body()).toMatch(/horodatage_utc TIMESTAMPTZ NOT NULL/);
  });

  test('les énumérations de capture sont contraintes en base', () => {
    const b = body();
    expect(b).toMatch(/CHECK \(sens IN \('entree', 'sortie', 'inconnu'\)\)/);
    expect(b).toMatch(/CHECK \(source IN \('badge', 'manuel', 'import'\)\)/);
    expect(b).toMatch(/CHECK \(statut IN \('brut', 'traite', 'orphelin'\)\)/);
  });

  test('un orphelin est possible : employee_id et device_id sont NULLABLES', () => {
    const b = body();
    expect(b).toMatch(/employee_id INTEGER REFERENCES employees\(id\) ON DELETE SET NULL/);
    expect(b).not.toMatch(/employee_id INTEGER NOT NULL/);
    // La suppression d'un salarié ou d'un poste ne DÉTRUIT jamais un pointage
    // (SET NULL, jamais CASCADE) : la preuve de capture survit.
    expect(b).not.toMatch(/employee_id[^,]*ON DELETE CASCADE/);
    expect(b).not.toMatch(/device_id[^,]*ON DELETE CASCADE/);
  });

  test('index de lecture (employee_id, horodatage_utc) présent', () => {
    expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_badgeuse_pointages_employee_date ON badgeuse_pointages\(employee_id, horodatage_utc\)/);
  });
});

describe('badges, corrections et feuilles de temps', () => {
  test('un SEUL badge actif par salarié (index partiel unique)', () => {
    expect(src).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_badgeuse_badges_actif_unique\s*\n?\s*ON badgeuse_badges\(employee_id\) WHERE statut = 'actif'/
    );
  });

  test('cycle de vie du badge contraint (5 statuts) et historique à 6 événements', () => {
    expect(tableBody('badgeuse_badges'))
      .toMatch(/CHECK \(statut IN \('actif', 'perdu', 'vole', 'restitue', 'desactive'\)\)/);
    expect(tableBody('badgeuse_badge_historique'))
      .toMatch(/CHECK \(evenement IN \('attribution', 'perte', 'vol', 'restitution', 'desactivation', 'reactivation'\)\)/);
  });

  test('MOTIFS DE CORRECTION : liste FERMÉE contrainte en base (aucun champ libre)', () => {
    expect(tableBody('badgeuse_corrections')).toMatch(
      /CHECK \(motif_code IN \('oubli_badge', 'badge_defaillant', 'mission_exterieure', 'rdv_accompagnement', 'formation', 'autre'\)\)/
    );
  });

  test('les corrections sont ADDITIVES : pointage_id nullable (ajout) et SET NULL', () => {
    const b = tableBody('badgeuse_corrections');
    expect(b).toMatch(/pointage_id BIGINT REFERENCES badgeuse_pointages\(id\) ON DELETE SET NULL/);
    expect(b).toMatch(/CHECK \(type IN \('ajout', 'modification', 'annulation'\)\)/);
    // L'auteur d'une correction ne peut pas être effacé : RESTRICT, jamais SET NULL
    // (une correction sans auteur ne serait plus une piste d'audit).
    expect(b).toMatch(/auteur_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/);
  });

  test('feuilles de temps : UNIQUE(employee_id, periode) + circuit de validation à 3 états', () => {
    const b = tableBody('badgeuse_feuilles_temps');
    expect(b).toMatch(/UNIQUE\(employee_id, periode\)/);
    expect(b).toMatch(/CHECK \(statut IN \('brouillon', 'validee_encadrant', 'validee_rh'\)\)/);
    expect(b).toMatch(/valide_encadrant_par INTEGER REFERENCES users\(id\)/);
    expect(b).toMatch(/valide_rh_par INTEGER REFERENCES users\(id\)/);
  });

  test('contenus : durée bornée 5–60 s et types contraints', () => {
    const b = tableBody('badgeuse_contenus');
    expect(b).toMatch(/duree_sec INTEGER NOT NULL DEFAULT 10 CHECK \(duree_sec BETWEEN 5 AND 60\)/);
    expect(b).toMatch(/CHECK \(type IN \('message', 'image', 'planning', 'compte_a_rebours', 'meteo'\)\)/);
  });

  test('devices : code UNIQUE et clé stockée en CONDENSAT uniquement', () => {
    const b = tableBody('badgeuse_devices');
    expect(b).toMatch(/code VARCHAR\(30\) NOT NULL UNIQUE/);
    expect(b).toMatch(/api_key_hash VARCHAR\(64\)/);
    expect(b).not.toMatch(/api_key VARCHAR/); // jamais la clé en clair
  });
});

describe('ordre de création (dépendances de clés étrangères)', () => {
  test('les tables référencées existent avant leurs références', () => {
    const at = (t) => src.indexOf(`CREATE TABLE IF NOT EXISTS ${t}`);
    expect(at('badgeuse_sites')).toBeLessThan(at('badgeuse_devices'));
    expect(at('badgeuse_sites')).toBeLessThan(at('badgeuse_contenus'));
    expect(at('badgeuse_badges')).toBeLessThan(at('badgeuse_badge_historique'));
    expect(at('badgeuse_devices')).toBeLessThan(at('badgeuse_pointages'));
    expect(at('badgeuse_pointages')).toBeLessThan(at('badgeuse_corrections'));
    // employees et users préexistent largement dans le fichier.
    expect(src.indexOf('CREATE TABLE IF NOT EXISTS employees')).toBeLessThan(at('badgeuse_badges'));
    expect(src.indexOf('CREATE TABLE IF NOT EXISTS users')).toBeLessThan(at('badgeuse_devices'));
  });
});

describe('seeds idempotents et registre RGPD', () => {
  test('le site « LH » est seedé en WHERE NOT EXISTS (rejouable)', () => {
    const seed = src.slice(src.indexOf('INSERT INTO badgeuse_sites'));
    expect(seed.slice(0, 400)).toMatch(/SELECT 'LH', 'Le Houlme — atelier'/);
    expect(seed.slice(0, 400)).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM badgeuse_sites WHERE code = 'LH'\)/);
  });

  test('l\'entrée au registre des traitements est seedée (art. 30 — fiche obligatoire)', () => {
    const i = src.indexOf("'Temps & Présence (badgeuse) — décompte du temps de travail'");
    expect(i).toBeGreaterThan(-1);
    const entree = src.slice(src.lastIndexOf('INSERT INTO rgpd_registre', i), src.indexOf(';', i + 2000));
    expect(entree).toMatch(/WHERE NOT EXISTS/); // idempotent
    // La fiche doit refléter la réalité du traitement.
    expect(entree).toMatch(/L\.3171-2/);              // base légale citée
    expect(entree).toMatch(/HMAC-SHA256/);            // pseudonymisation
    expect(entree).toMatch(/PRÉNOM \+ INITIALE/);     // minimisation à l'écran
    expect(entree).toMatch(/aucune photographie/i);   // exclusion absolue
    expect(entree).toMatch(/purge/i);                 // durées réellement appliquées
    expect(entree).toMatch(/JOURNALISATION/i);        // traçabilité des consultations
  });

  test('un log de clôture annonce la section', () => {
    expect(src).toMatch(/\[INIT-DB\] Module 33 Temps & Présence \(badgeuse\) — 8 tables/);
  });
});

describe('ADR-0003 — coexistence avec le module 25 « Pointage » (aucune régression)', () => {
  test('la section badgeuse ne touche à aucune table du module legacy', () => {
    const section = sectionBadgeuse();
    for (const legacy of ['pointage_terminals', 'pointage_events']) {
      expect(section).not.toMatch(new RegExp(`(ALTER|DROP|DELETE FROM|UPDATE)\\s+${legacy}`));
    }
    // La table `badges` du module 25 ne doit être ni altérée ni supprimée ici.
    expect(section).not.toMatch(/(ALTER TABLE|DROP TABLE)\s+badges\b/);
  });

  test('aucun DROP ni TRUNCATE dans la section', () => {
    const section = sectionBadgeuse();
    expect(section).not.toMatch(/DROP TABLE|TRUNCATE/i);
  });

  test('le module n\'écrit ni dans work_hours ni dans employee_week_hours (ADR-0003 §3)', () => {
    for (const f of ['routes/badgeuse.js', 'routes/badgeuse-device.js', 'services/badgeuse-engine.js']) {
      const code = fs.readFileSync(path.join(BACKEND_ROOT, 'src', f), 'utf8')
        .replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/INSERT INTO work_hours|UPDATE work_hours/);
      expect(code).not.toMatch(/employee_week_hours/);
    }
  });
});

describe('validité SQL PostgreSQL des requêtes de route (garde anti-régression)', () => {
  // Régression réelle attrapée en exécutant les requêtes sur un PostgreSQL 16 :
  // « SELECT DISTINCT … ORDER BY UPPER(col) » est REFUSÉ par PostgreSQL
  // (les expressions du ORDER BY doivent figurer dans la liste de sélection).
  // Les tests à base de mock DB ne peuvent pas voir ce défaut : cette garde
  // statique le rattrape. Correctif retenu : filtrer par sous-requête sur la
  // clé primaire, ce qui rend le DISTINCT inutile.
  test('aucun SELECT DISTINCT combiné à un ORDER BY UPPER(...)', () => {
    for (const f of ['routes/badgeuse.js', 'routes/badgeuse-device.js']) {
      // Commentaires retirés d'abord : seul le SQL réellement exécuté est inspecté
      // (les commentaires du fichier citent ce motif pour l'expliquer).
      const code = fs.readFileSync(path.join(BACKEND_ROOT, 'src', f), 'utf8')
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/[^\n]*$/gm, '');
      const requetes = code.match(/SELECT DISTINCT[\s\S]*?`/g) || [];
      for (const r of requetes) expect(r).not.toMatch(/ORDER BY[\s\S]*UPPER\(/);
    }
  });
});

describe('INALTÉRABILITÉ côté code — aucun DELETE de pointage hors purge planifiée', () => {
  test('les routes du module ne contiennent AUCUN DELETE sur badgeuse_pointages', () => {
    for (const f of ['routes/badgeuse.js', 'routes/badgeuse-device.js']) {
      const code = fs.readFileSync(path.join(BACKEND_ROOT, 'src', f), 'utf8');
      expect(code).not.toMatch(/DELETE FROM badgeuse_pointages/);
      expect(code).not.toMatch(/DELETE FROM badgeuse_corrections/);
    }
  });

  test('la seule suppression de pointages vit dans le job de purge RGPD', () => {
    const scheduler = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'services', 'scheduler.js'), 'utf8');
    expect(scheduler).toMatch(/badgeusePurgeRetention/);
    expect(scheduler).toMatch(/DELETE FROM \$\{table\}|DELETE FROM \$\{/); // suppression paramétrée du job
  });

  test('le seul UPDATE de badgeuse_pointages est le rattachement d\'un orphelin', () => {
    const code = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'routes', 'badgeuse.js'), 'utf8');
    const updates = code.match(/UPDATE badgeuse_pointages[\s\S]*?RETURNING/g) || [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/SET employee_id = \$2, statut = 'traite'/);
  });
});
