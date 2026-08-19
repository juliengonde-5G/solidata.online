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
  // Écran d'information v2 (CDC_AFFICHAGE_V2, ADR-0004 §6)
  'badgeuse_social_posts',
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

describe('les tables du module', () => {
  test('chaque table est créée en CREATE TABLE IF NOT EXISTS (idempotence)', () => {
    for (const t of BADGEUSE_TABLES) {
      expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('la section est placée AVANT le resync des séquences SERIAL', () => {
    expect(src.indexOf('CREATE TABLE IF NOT EXISTS badgeuse_sites'))
      .toBeLessThan(src.indexOf('const tablesAResyncer'));
  });

  test('toutes les tables sont rattachées au resync des séquences SERIAL', () => {
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

  test('badgeuse_badges.uid_hmac : NOT NULL, et UNIQUE parmi les badges ACTIFS', () => {
    // Un badge physique survit aux personnes (reattribution apres un depart) :
    // l'unicite absolue de l'empreinte a ete remplacee par une unicite sur le
    // badge ACTIF — une seule personne porte une empreinte donnee a la fois,
    // l'historique conserve une ligne par periode de detention. Le pseudonyme
    // reste la cle du badge EN SERVICE ; l'ancienne contrainte de colonne est
    // levee par la migration DO-scan (contype 'u').
    expect(tableBody('badgeuse_badges')).toMatch(/uid_hmac VARCHAR\(64\) NOT NULL,/);
    expect(tableBody('badgeuse_badges')).not.toMatch(/uid_hmac[^\n]*UNIQUE/);
    const section = sectionBadgeuse();
    expect(section).toMatch(/idx_badgeuse_badges_uid_actif_unique\s*\n?\s*ON badgeuse_badges\(uid_hmac\) WHERE statut = 'actif'/);
  });

  test('aucune donnée de santé, de statut IAE ou de NIR dans le module', () => {
    const section = sectionBadgeuse();
    const sql = section.replace(/--[^\n]*/g, '').replace(/\/\/[^\n]*/g, '');
    for (const interdit of [/\bsante\b/i, /\brqth\b/i, /\bnir\b/i]) {
      expect(sql).not.toMatch(interdit);
    }
  });

  test('aucune GÉOLOCALISATION D\'UNE PERSONNE : les tables nominatives n\'ont pas de coordonnées', () => {
    // NOTE_JURIDIQUE §3.4 interdit la géolocalisation — c'est-à-dire celle
    // d'un SALARIÉ. L'assertion était initialement un « aucune latitude nulle
    // part » ; elle a été RESSERRÉE (août 2026, écran météo) sur ce qu'elle
    // protège réellement, plutôt que contournée :
    //   - une coordonnée posée sur un POINTAGE, un BADGE ou un POSTE
    //     localiserait une personne, ou permettrait de la suivre : interdit,
    //     et vérifié table par table ci-dessous ;
    //   - la coordonnée d'un SITE (adresse de l'établissement, déjà publique)
    //     et celle du cache météo ne désignent personne. Elles servent à
    //     afficher la météo du LIEU du poste sur l'écran de veille, et le
    //     cache météo n'a aucune clé étrangère vers une personne.
    for (const table of ['badgeuse_pointages', 'badgeuse_badges', 'badgeuse_badge_historique',
      'badgeuse_corrections', 'badgeuse_devices', 'badgeuse_feuilles_temps']) {
      const body = tableBody(table);
      expect(body).not.toMatch(/latitude|longitude|\bgps\b/i);
    }
    // Le cache météo ne référence NI salarié NI poste : c'est une prévision
    // pour des coordonnées, pas pour quelqu'un.
    const meteo = tableBody('badgeuse_meteo');
    expect(meteo).not.toMatch(/REFERENCES employees|REFERENCES badgeuse_devices|employee_id/);
  });

  test('les contenus d\'affichage n\'ont AUCUNE FK vers un salarié (finalité dissociée)', () => {
    const body = tableBody('badgeuse_contenus');
    expect(body).not.toMatch(/REFERENCES employees/);
    expect(body).not.toMatch(/\bemployee_id\b/);
    // Seul l'auteur (utilisateur back-office) est tracé.
    expect(body).toMatch(/cree_par INTEGER REFERENCES users\(id\)/);
  });
});

describe('APPAIRAGE PAR CODE COURT (ADR-0005)', () => {
  test('les deux colonnes sont ajoutées en migration IDEMPOTENTE', () => {
    // Elles arrivent sur des bases DÉJÀ déployées : un CREATE TABLE IF NOT
    // EXISTS ne re-colonne jamais une table existante.
    const section = sectionBadgeuse();
    expect(section).toMatch(/ALTER TABLE badgeuse_devices ADD COLUMN IF NOT EXISTS appairage_code_hash VARCHAR\(64\)/);
    expect(section).toMatch(/ALTER TABLE badgeuse_devices ADD COLUMN IF NOT EXISTS appairage_expire_le TIMESTAMPTZ/);
  });

  test('le code n\'est stocké QUE sous forme de condensat — jamais en clair', () => {
    // Un `appairage_code VARCHAR(8)` en base ferait du secret de mise en
    // service une donnée au repos, lisible par toute sauvegarde.
    const section = sectionBadgeuse().replace(/\/\/[^\n]*/g, '');
    expect(section).not.toMatch(/appairage_code\s+VARCHAR/);
    expect(section).not.toMatch(/appairage_code_clair|code_appairage\s+VARCHAR/);
    // La colonne porte la largeur d'un SHA-256 hex, pas celle d'un code court.
    expect(section).toMatch(/appairage_code_hash VARCHAR\(64\)/);
  });

  test('l\'échéance est un TIMESTAMPTZ : un code sans expiration est exclu par le schéma', () => {
    expect(sectionBadgeuse()).toMatch(/appairage_expire_le TIMESTAMPTZ/);
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

  // ══ ÉCRAN D'INFORMATION v2 (CDC_AFFICHAGE_V2, ADR-0004) ══
  describe('écran d\'information v2', () => {
    const section = () => sectionBadgeuse();

    test('le CONSENTEMENT festif est porté par employees, en 3 colonnes idempotentes', () => {
      const s = section();
      // Défaut false : l'absence de choix n'est JAMAIS un accord (ADR-0004 §4).
      expect(s).toMatch(/ALTER TABLE employees ADD COLUMN IF NOT EXISTS badgeuse_optin_festif BOOLEAN NOT NULL DEFAULT false/);
      // Un consentement se date et s'impute, sinon il ne prouve rien.
      expect(s).toMatch(/ADD COLUMN IF NOT EXISTS badgeuse_optin_festif_le TIMESTAMPTZ/);
      expect(s).toMatch(/ADD COLUMN IF NOT EXISTS badgeuse_optin_festif_par INTEGER REFERENCES users\(id\)/);
    });

    test('les colonnes média des contenus sont ajoutées en ADD COLUMN IF NOT EXISTS', () => {
      const s = section();
      for (const col of [
        'fichier VARCHAR\\(300\\)', 'media_type VARCHAR\\(10\\)', 'media_sha256 VARCHAR\\(64\\)',
        'source_url VARCHAR\\(500\\)', 'config JSONB',
      ]) {
        expect(s).toMatch(new RegExp(`ALTER TABLE badgeuse_contenus ADD COLUMN IF NOT EXISTS ${col}`));
      }
    });

    test('la CHECK des types est ÉLARGIE par DO-scan de pg_constraint (bases déjà déployées)', () => {
      const s = section();
      // CREATE TABLE IF NOT EXISTS ne re-contraint jamais une table existante :
      // sans ce scan, une base en production refuserait tout contenu v2.
      expect(s).toMatch(/FROM pg_constraint con/);
      expect(s).toMatch(/conrelid = 'badgeuse_contenus'::regclass/);
      expect(s).toMatch(/DROP CONSTRAINT/);
      expect(s).toMatch(/badgeuse_contenus_type_check/);
      for (const t of ['annonces', 'actus', 'tournees', 'social', 'media', 'lien', 'vak_live']) {
        expect(s).toMatch(new RegExp(`'${t}'`));
      }
    });

    test('badgeuse_social_posts : upsert idempotent par (réseau, post_id)', () => {
      const b = tableBody('badgeuse_social_posts');
      expect(b).toMatch(/reseau VARCHAR\(20\) NOT NULL CHECK \(reseau IN \('instagram', 'facebook'\)\)/);
      expect(b).toMatch(/post_id VARCHAR\(100\) NOT NULL/);
      expect(b).toMatch(/UNIQUE\(reseau, post_id\)/);
      expect(b).toMatch(/media_sha256 VARCHAR\(64\)/);
    });

    test('les posts sociaux ne portent AUCUNE donnée de salarié (publications publiques)', () => {
      const b = tableBody('badgeuse_social_posts');
      expect(b).not.toMatch(/REFERENCES employees/);
      expect(b).not.toMatch(/\bemployee_id\b/);
      expect(b).not.toMatch(/uid_hmac/);
    });

    test('aucune URL EXTERNE n\'est servie au poste : le média est un fichier LOCAL', () => {
      // `fichier` (chemin relatif côté serveur) et non une URL : le kiosque ne
      // contacte aucun domaine tiers (ADR-0004 §6, CSP 'self').
      const s = section();
      expect(s).toMatch(/ADD COLUMN IF NOT EXISTS fichier VARCHAR\(300\)/);
      expect(tableBody('badgeuse_social_posts')).toMatch(/media_fichier VARCHAR\(300\)/);
    });
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
    expect(src).toMatch(/\[INIT-DB\] Module 33 Temps & Présence \(badgeuse\) — 10 tables/);
  });

  // Hotfix prod v2.22.1 — la fiche art. 30 badgeuse porte une base légale de
  // 136 car. et une durée de conservation de 312 car. : le VARCHAR(100)
  // historique de rgpd_registre la refusait (« value too long ») sur les bases
  // ANCIENNES, que CREATE TABLE IF NOT EXISTS ne re-type jamais. Ce test
  // verrouille les deux verrous : définition moderne en TEXT ET migration
  // d'élargissement idempotente pour les bases déjà déployées.
  test('rgpd_registre accepte les fiches longues (TEXT + élargissement idempotent)', () => {
    const create = src.slice(
      src.indexOf('CREATE TABLE IF NOT EXISTS rgpd_registre'),
      src.indexOf(');', src.indexOf('CREATE TABLE IF NOT EXISTS rgpd_registre'))
    );
    expect(create).toMatch(/base_legale TEXT NOT NULL/);
    expect(create).toMatch(/duree_conservation TEXT/);
    expect(src).toMatch(/ALTER TABLE rgpd_registre ALTER COLUMN base_legale TYPE TEXT/);
    expect(src).toMatch(/ALTER TABLE rgpd_registre ALTER COLUMN duree_conservation TYPE TEXT/);
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

  test('les seuls UPDATE de badgeuse_pointages sont les DEUX rattachements d\'orphelins', () => {
    // Deux gestes RH, meme effet, meme trace : le rattachement manuel (modale)
    // et le rattachement a l'attribution d'un badge (les orphelins de cette
    // empreinte sont rattaches dans la meme transaction). Tout autre UPDATE de
    // cette table serait une atteinte a l'inalterabilite : chaque occurrence ne
    // peut toucher que employee_id + statut, et seulement des lignes ORPHELINES.
    const code = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'routes', 'badgeuse.js'), 'utf8');
    const updates = code.match(/UPDATE badgeuse_pointages[\s\S]*?RETURNING/g) || [];
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(u).toMatch(/SET employee_id = \$\d, statut = 'traite'/);
      expect(u).toMatch(/statut = 'orphelin'/);
      expect(u).not.toMatch(/horodatage_utc\s*=|uid_hmac\s*=\s*\$\d\s*,|hash_/);
    }
    // Le rattachement « a l'attribution » est borne : jamais les pointages d'un
    // porteur precedent (posterieurs a la derniere restitution du support).
    expect(updates.some((u) => u.includes("orphelin_raison = 'badge_inconnu'") && u.includes('restitue_le'))).toBe(true);
  });
});
