/**
 * Migration idempotente — PR A « Conformité immédiate », LOT 2 « FSE+ ».
 *
 * Appelée par init-db.js DANS sa transaction, juste après `insertion-cadre`
 * (l'ordre compte : rien ici ne dépend du lot 1, mais le dossier de conformité
 * lit ses colonnes à l'exécution). `client.query` uniquement, aucun BEGIN /
 * COMMIT : la transaction appartient à l'appelant.
 *
 * CE QU'ELLE POSE, ET POURQUOI.
 *  - `insertion_projets` / `insertion_projet_participants` : le rattachement
 *    d'une personne à une opération cofinancée est SAISI et DATÉ, jamais déduit
 *    d'un statut (un BRSA n'est pas automatiquement participant ASI). C'est la
 *    demande S3 de l'autorité — un rattachement déduit ne se justifie pas au
 *    contrôle de service fait.
 *  - `insertion_projet_postes` : quotité d'affectation d'un poste au projet
 *    (amendement F2) — sans elle, la feuille de temps ne se rattache à aucun
 *    plan de financement.
 *  - `insertion_fse_sorties` : la sortie FSE+ sort du jalon de bilan pour vivre
 *    dans sa propre table. Raison de fond : la personne qui part SANS entretien
 *    de sortie est précisément celle dont la donnée manque, et tant que la
 *    sortie n'existait que dans un `bilan_sortie` elle était INSAISISSABLE.
 *    `saisie_at` est la colonne que l'autorité regarde en premier (délai de
 *    saisie, 09 § 2 (a) colonne 26).
 *  - `duree_minutes` / `presence` / `absence_motif` sur les entretiens : la
 *    durée alimente l'agrégat d'heures d'accompagnement promis aux
 *    certificateurs (RES-04 / B5) ; le motif d'absence est FACULTATIF (08 § 10)
 *    — une absence sans motif ne s'imprime jamais « injustifiée ».
 */

/** Valeurs du CHECK `alert_type` après cette migration (alertes FSE+ ajoutées). */
const ALERT_TYPES = [
  'planification', 'rappel_j7', 'rappel_j1', 'retard', 'pass_iae_7m', 'pass_iae_2m',
  'fse_sortie_j15', 'fse_sortie_j25', 'fse_entree_manquante', 'suivi_6mois',
];

async function run(client) {
  // ── (a) Projets cofinancés ────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_projets (
      id SERIAL PRIMARY KEY,
      code VARCHAR(30) UNIQUE NOT NULL,
      nom VARCHAR(150) NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('asi', 'ocs', 'autre')),
      financeur VARCHAR(120),
      date_debut DATE,
      date_fin DATE,
      convention_ref VARCHAR(80),
      taux_forfaitaire_pct NUMERIC(5,2),
      cofinancement_ue_pct NUMERIC(5,2),
      actif BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Seed des DEUX projets décidés par la direction le 12/09/2026 (plan 07 § 8
  // décision 2). ON CONFLICT (code) DO NOTHING : un projet retouché à l'écran
  // (dates, convention, taux) n'est jamais réécrit au redémarrage.
  await client.query(`
    INSERT INTO insertion_projets (code, nom, type, financeur, date_debut, date_fin, convention_ref, taux_forfaitaire_pct, cofinancement_ue_pct)
    VALUES
      ('ASI-2026-2027', 'Accompagnement Social Intensif 2026-2027', 'asi', 'FSE+ / Département 76', '2026-01-01', '2027-12-31', NULL, NULL, 60),
      ('OCS-CIP-2026-2027', 'Postes CIP en OCS 2026-2027', 'ocs', 'FSE+ / DDETS 76', '2026-01-01', '2027-12-31', NULL, 40, 60)
    ON CONFLICT (code) DO NOTHING;
  `);

  // ── (b) Participants (rattachement daté) ──────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_projet_participants (
      id SERIAL PRIMARY KEY,
      projet_id INTEGER NOT NULL REFERENCES insertion_projets(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      date_entree DATE NOT NULL,
      date_sortie DATE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(projet_id, employee_id, date_entree)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_projet_participants_emp ON insertion_projet_participants(employee_id);');
  await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_projet_participants_projet ON insertion_projet_participants(projet_id, date_entree);');

  // ── (c) Postes affectés au projet (OCS — amendement F2) ───────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_projet_postes (
      id SERIAL PRIMARY KEY,
      projet_id INTEGER NOT NULL REFERENCES insertion_projets(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quotite_pct NUMERIC(5,2) NOT NULL CHECK (quotite_pct > 0 AND quotite_pct <= 100),
      date_debut DATE,
      date_fin DATE,
      UNIQUE(projet_id, user_id)
    );
  `);

  // ── (d) Sorties FSE+ ──────────────────────────────────────────────────────
  // UNIQUE(employee_id, parcours_num) : UNE sortie par parcours. La saisie sans
  // bilan puis la clôture du bilan de sortie écrivent donc la MÊME ligne (upsert
  // côté service) — jamais deux vérités concurrentes pour une même sortie.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_fse_sorties (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      parcours_num SMALLINT NOT NULL DEFAULT 1,
      projet_id INTEGER REFERENCES insertion_projets(id) ON DELETE SET NULL,
      milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL,
      source VARCHAR(12) NOT NULL CHECK (source IN ('bilan', 'sans_bilan')),
      date_sortie DATE NOT NULL,
      situation_sortie VARCHAR(30) NOT NULL CHECK (situation_sortie IN ('emploi_durable', 'emploi_transition', 'formation', 'autre_sortie_positive', 'inactivite', 'chomage', 'inconnue')),
      fse_sortie JSONB,
      saisie_at TIMESTAMP NOT NULL DEFAULT NOW(),
      saisie_par INTEGER REFERENCES users(id),
      situation_6mois VARCHAR(30) CHECK (situation_6mois IN ('emploi_durable', 'emploi_transition', 'formation', 'autre_sortie_positive', 'inactivite', 'chomage', 'inconnue', 'injoignable')),
      date_releve_6mois DATE,
      releve_6mois_par INTEGER REFERENCES users(id),
      UNIQUE(employee_id, parcours_num)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_fse_sorties_date ON insertion_fse_sorties(date_sortie);');

  // ── (e) Entretiens : durée et assiduité ───────────────────────────────────
  // Le CHECK de `duree_minutes` est porté par la colonne (ADD COLUMN IF NOT
  // EXISTS le crée avec elle) ; celui de `presence` est reconstruit par DO-scan
  // plus bas, parce qu'une valeur de liste peut avoir à s'élargir plus tard.
  await client.query(`
    ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS duree_minutes SMALLINT CHECK (duree_minutes IS NULL OR (duree_minutes >= 0 AND duree_minutes <= 600));
    ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS presence VARCHAR(10);
    ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS absence_motif VARCHAR(20);
    ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS absence_piece_ref VARCHAR(200);
  `);

  // CHECK `presence` posé par DO-scan (la colonne est créée nue ci-dessus pour
  // que la contrainte reste modifiable sans toucher à la colonne). Marqueur
  // 'excuse' : une exécution suivante ne refait rien.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_milestones'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%presence%'
          AND pg_get_constraintdef(oid) ILIKE '%excuse%'
      ) THEN
        ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_presence_check
          CHECK (presence IS NULL OR presence IN ('present', 'absent', 'excuse'));
      END IF;
    END $$;
  `);

  // Motif d'absence : liste FERMÉE (exigence A6 de l'autorité) et volontairement
  // GROSSIÈRE — « santé » ne dit rien d'un état de santé, et c'est le but : un
  // document destiné au référent externe ne doit jamais porter de nature
  // médicale. Le motif reste FACULTATIF (08 § 10) : une absence sans motif
  // n'est jamais imprimée « injustifiée ».
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_milestones'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%absence_motif%'
      ) THEN
        ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_absence_motif_check
          CHECK (absence_motif IS NULL OR absence_motif IN ('sante', 'administratif', 'garde', 'transport', 'autre'));
      END IF;
    END $$;
  `);

  // ── (f) Diagnostic : traçabilité du questionnaire d'entrée ────────────────
  await client.query(`
    ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS fse_entree_saisie_at TIMESTAMP;
    ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS fse_entree_complet BOOLEAN NOT NULL DEFAULT false;
  `);

  // ── (g) Alertes FSE+ : élargissement du CHECK alert_type ──────────────────
  // Même pattern DROP-scan + ADD que les alertes Pass IAE (init-db) : le
  // marqueur 'fse_sortie_j15' épargne la reconstruction aux exécutions
  // suivantes. Sans cet élargissement le job d'alerte échouerait en 23514.
  await client.query(`
    DO $$
    DECLARE cname text;
    BEGIN
      FOR cname IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'insertion_interview_alerts'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%alert_type%'
          AND pg_get_constraintdef(oid) NOT ILIKE '%fse_sortie_j15%'
      LOOP
        EXECUTE 'ALTER TABLE insertion_interview_alerts DROP CONSTRAINT ' || quote_ident(cname);
      END LOOP;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_interview_alerts'::regclass AND conname = 'insertion_interview_alerts_alert_type_check'
      ) THEN
        ALTER TABLE insertion_interview_alerts ADD CONSTRAINT insertion_interview_alerts_alert_type_check
          CHECK (alert_type IN (${ALERT_TYPES.map((t) => `'${t}'`).join(', ')}));
      END IF;
    END $$;
  `);

  // ── (h) Registre RGPD (art. 30) ───────────────────────────────────────────
  // Traitement DISTINCT de l'accompagnement : finalité propre (justifier une
  // dépense européenne), destinataire propre (autorité de gestion), et surtout
  // DURÉE propre — la piste d'audit FSE+ survit à l'anonymisation à 2 ans du
  // dossier d'insertion. Garde NOT ILIKE : idempotent sans clé fonctionnelle.
  await client.query(`
    INSERT INTO rgpd_registre
      (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
    SELECT
      'Cofinancement FSE+ — suivi des participants',
      'Justification des dépenses cofinancées par le Fonds social européen+ : rattachement daté des participants aux opérations (ASI, postes CIP en OCS), questionnaire d''entrée dans l''opération, situation à la sortie et relevé de situation à six mois, complétude du dossier de conformité, bilans d''exécution et contrôle de service fait.',
      'Obligation légale (règlement UE 2021/1060, piste d''audit) et mission d''intérêt public',
      'Salariés en parcours d''insertion rattachés à une opération cofinancée',
      'Identité, commune de résidence, dates de contrat et de parcours, critères d''éligibilité IAE, situation avant l''entrée, durée sans emploi, composition du foyer (foyer monoparental), stabilité du logement, nature des ressources principales, situation à la sortie et à six mois. AUCUNE donnée de santé ni judiciaire : les freins et leurs commentaires sont exclus de tout export FSE+.',
      'Autorité de gestion FSE+ et organismes de contrôle (Ma Démarche FSE+, Département 76, DDETS 76) ; en interne : ADMIN et RH uniquement',
      'Piste d''audit FSE+ : au moins 5 ans après le dernier paiement de l''opération. Ces données sont volontairement CONSERVÉES lors de l''anonymisation du dossier d''insertion à 2 ans — l''effacement priverait la structure de sa capacité à justifier une dépense déjà perçue.',
      'Accès ADMIN/RH strict, double authentification exigée, journalisation RGPD de chaque saisie de sortie, de chaque relevé à six mois et de chaque export (l''échec du journal fait échouer l''export), aucune donnée art. 9/10 dans les fichiers transmis, une génération à zéro ligne est refusée plutôt que de produire un fichier vide.'
    WHERE NOT EXISTS (
      SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Cofinancement FSE+%'
    );
  `);

  console.log('[INIT-DB] Migration PR A lot 2 (FSE+ : projets, participants, sorties, durée des entretiens) ✓');
}

module.exports = { run, ALERT_TYPES };
