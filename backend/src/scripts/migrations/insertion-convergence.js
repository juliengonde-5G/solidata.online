/**
 * Migration — lot 2.58.0 « Suivi Convergence (CVG) »
 * (contrat : rapports/cip-refonte-2026-09-12/30-convergence-cvg-cartographie.md § 2.2).
 *
 * ═══ CE QU'ELLE POSE, ET POURQUOI ═════════════════════════════════════════
 *
 *  1. LE DIAGNOSTIC GAGNE QUATRE RÉPONSES que Convergence demande et que
 *     l'outil ne savait pas dire : le type d'habitat dans la nomenclature du
 *     réseau (`heberge` ne distingue ni collectif, ni précaire, ni
 *     semi-durable), le parcours de rue, la pension d'invalidité et le médecin
 *     traitant. Tous NULLABLES : « pas encore demandé » n'est pas « non ».
 *
 *  2. LES ORIENTEURS passent de 6 à 12 + 6 : les douze valeurs du formulaire,
 *     les anciennes (`departement_cms`, `ccas`, `autre`) restant ACCEPTÉES —
 *     les perdre invaliderait toutes les fiches déjà saisies. La colonne passe
 *     de VARCHAR(20) à VARCHAR(40) : `services_sociaux_departement` compte 28
 *     caractères, un CHECK qui l'accepte sur une colonne qui le tronque ne
 *     servirait à rien.
 *
 *  3. LA SITUATION DE SORTIE CONVERGENCE (`insertion_sortie_cvg`) : une ligne
 *     par parcours, saisie au bilan de sortie ou dans les 30 jours qui suivent
 *     (obligation `sortie_cvg`). Elle porte des données de SANTÉ (RQTH, AAH,
 *     pension, médecin traitant) : ADMIN/RH strict, purgée à l'anonymisation.
 *
 *  4. LE REGISTRE DES MOYENS HUMAINS (`insertion_cvg_ressources`) — la Partie 2
 *     du formulaire, qui n'avait aucune source : `users` ne porte ni fonction
 *     ni quotité, et `insertion_projet_postes` ne connaît que les postes
 *     cofinancés FSE+.
 *
 *  5. LES INSTANTANÉS CVG réutilisent `insertion_dialogues_gestion` avec un
 *     `type` : une seule table de pièces transmises, une seule purge (11ᵉ,
 *     six ans), et l'historique de la synthèse de dialogue de gestion filtre
 *     désormais sur `type = 'dialogue'` pour que les deux ne se mélangent pas.
 *
 *  6. UNE ENTRÉE AU REGISTRE ART. 30 : contrairement à la synthèse de
 *     dialogue de gestion, ce document n'est pas soumis au k-anonymat (le
 *     format du réseau porte des effectifs de 1 et 2 — arbitrage DPO ouvert)
 *     et sa Partie 2 NOMME des salariés permanents.
 *
 * Contrat d'exécution : `run(client)` est appelé par `init-db.js` DANS sa
 * transaction, juste après `insertion-reporting`. `client.query` uniquement,
 * chaque instruction rejouable.
 */

'use strict';

const {
  HABITAT_TYPES, SORTIE_CATEGORIES, ORIENTEURS_ACCEPTES,
} = require('../../utils/convergence-cvg-referentiels');

const sqlList = (vals) => vals.map((v) => `'${v}'`).join(',');

/** Pose un CHECK s'il n'existe pas encore (ADD CONSTRAINT n'a pas d'IF NOT EXISTS). */
async function poserCheck(client, table, nom, expr) {
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = '${table}'::regclass AND conname = '${nom}'
      ) THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${nom} CHECK (${expr});
      END IF;
    END $$;
  `);
}

async function run(client) {
  // ── 1. Diagnostic : habitat CVG, parcours de rue, pension, médecin traitant ──
  await client.query(`
    ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS habitat_type VARCHAR(30);
    ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS parcours_rue BOOLEAN;
    ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS pension_invalidite BOOLEAN;
    ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS medecin_traitant BOOLEAN;
  `);
  await poserCheck(client, 'insertion_diagnostics', 'insertion_diagnostics_habitat_type_check',
    `habitat_type IS NULL OR habitat_type IN (${sqlList(HABITAT_TYPES)})`);

  // ── 2. Orienteurs : colonne élargie, CHECK RECONSTRUIT ─────────────────────
  //
  // Idempotent par relecture de `pg_get_constraintdef` : on ne reconstruit que
  // si la définition ne couvre pas déjà la dernière valeur ajoutée, donc
  // rejouer ne verrouille pas la table pour rien.
  await client.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'employees' AND column_name = 'orienteur_type'
           AND character_maximum_length IS NOT NULL AND character_maximum_length < 40
      ) THEN
        ALTER TABLE employees ALTER COLUMN orienteur_type TYPE VARCHAR(40);
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    DECLARE def TEXT;
    BEGIN
      SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
       WHERE conrelid = 'employees'::regclass AND conname = 'employees_orienteur_type_check';
      IF def IS NULL OR def NOT LIKE '%candidature_spontanee%' THEN
        IF def IS NOT NULL THEN
          ALTER TABLE employees DROP CONSTRAINT employees_orienteur_type_check;
        END IF;
        ALTER TABLE employees ADD CONSTRAINT employees_orienteur_type_check
          CHECK (orienteur_type IS NULL OR orienteur_type IN (${sqlList(ORIENTEURS_ACCEPTES)}));
      END IF;
    END $$;
  `);

  // ── 3. Situation de sortie Convergence ────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_sortie_cvg (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      parcours_num INTEGER NOT NULL DEFAULT 1,
      categorie VARCHAR(30),
      parcours_de_soin BOOLEAN,
      habitat_type_sortie VARCHAR(30),
      rqth_sortie BOOLEAN,
      aah_sortie BOOLEAN,
      pension_invalidite_sortie BOOLEAN,
      medecin_traitant_sortie BOOLEAN,
      couverture_sante_amelioree BOOLEAN,
      accompagnement_post_sortie BOOLEAN,
      saisi_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
      saisi_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (employee_id, parcours_num)
    );
  `);
  await poserCheck(client, 'insertion_sortie_cvg', 'insertion_sortie_cvg_categorie_check',
    `categorie IS NULL OR categorie IN (${sqlList(SORTIE_CATEGORIES)})`);
  await poserCheck(client, 'insertion_sortie_cvg', 'insertion_sortie_cvg_habitat_check',
    `habitat_type_sortie IS NULL OR habitat_type_sortie IN (${sqlList(HABITAT_TYPES)})`);

  // ── 4. Registre des moyens humains (Partie 2) ─────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_cvg_ressources (
      id SERIAL PRIMARY KEY,
      type VARCHAR(15) NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
      nom VARCHAR(150) NOT NULL,
      fonction VARCHAR(150),
      employeur VARCHAR(150),
      etp_total NUMERIC(4,2),
      etp_accompagnement NUMERIC(4,2),
      etp_encadrement NUMERIC(4,2),
      date_debut DATE,
      date_fin DATE,
      actif BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await poserCheck(client, 'insertion_cvg_ressources', 'insertion_cvg_ressources_type_check',
    "type IN ('interne','mutualisee')");
  for (const col of ['etp_total', 'etp_accompagnement', 'etp_encadrement']) {
    await poserCheck(client, 'insertion_cvg_ressources', `insertion_cvg_ressources_${col}_check`,
      `${col} IS NULL OR (${col} >= 0 AND ${col} <= 2)`);
  }
  await poserCheck(client, 'insertion_cvg_ressources', 'insertion_cvg_ressources_dates_check',
    'date_debut IS NULL OR date_fin IS NULL OR date_fin >= date_debut');

  // ── 5. Instantanés CVG dans la table des pièces transmises ────────────────
  await client.query(`
    ALTER TABLE insertion_dialogues_gestion ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'dialogue';
    ALTER TABLE insertion_dialogues_gestion ADD COLUMN IF NOT EXISTS periode_debut DATE;
    ALTER TABLE insertion_dialogues_gestion ADD COLUMN IF NOT EXISTS periode_fin DATE;
  `);
  await poserCheck(client, 'insertion_dialogues_gestion', 'insertion_dialogues_gestion_type_check',
    "type IN ('dialogue','cvg')");
  await client.query(
    'CREATE INDEX IF NOT EXISTS idx_insertion_dialogues_gestion_type '
    + 'ON insertion_dialogues_gestion(type, genere_le DESC);'
  );

  // ── 6. Registre art. 30 — posé UNE fois ───────────────────────────────────
  await client.query(
    `INSERT INTO rgpd_registre
      (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
     SELECT
      'Reporting Convergence (programme CVG)',
      'Production de l''outil de dialogue de gestion du programme Convergence France : public accompagné sur la période (sexe, tranche d''âge, niveau de formation, minima sociaux, reconnaissance de handicap, habitat, difficultés à l''entrée, orienteur), situation des salariés sortis (catégorie de sortie, évolution des freins, du logement et de la santé, accompagnement post-sortie) et moyens humains dédiés à l''accompagnement.',
      'Exécution de la convention avec le réseau Convergence France / intérêt légitime — base légale à confirmer par le DPO',
      'Salariés en parcours d''insertion (données agrégées) ; salariés permanents de l''accompagnement socioprofessionnel et technique (Partie 2, nominatif)',
      'Parties 1 et Sorties : AGRÉGATS uniquement (comptes par catégorie), comprenant des catégories de santé (RQTH, AAH, pension d''invalidité, médecin traitant, couverture santé) et le frein judiciaire en agrégat ; aucun nom ni identifiant de salarié en insertion. Le document n''applique PAS le seuil de k-anonymat de la synthèse de dialogue de gestion (le format du réseau porte des effectifs de 1 et 2) — arbitrage à confirmer par le DPO. Partie 2 : nom, fonction, employeur et quotités (ETP) des personnes affectées à l''accompagnement. Saisie de la situation de sortie : catégorie, habitat et situation de santé à la sortie, par salarié (ADMIN/RH).',
      'Convergence France (réseau), sur transmission par la direction. En interne : ADMIN et RH uniquement.',
      'Instantanés enregistrés : six ans (11ᵉ purge, rgpd.dialogues_gestion_retention_jours). Situation de sortie par salarié : durée du dossier, supprimée à l''anonymisation.',
      'Accès ADMIN/RH avec double authentification, refus posé avant toute lecture, journalisation RGPD bloquante de l''aperçu, de la génération, de la consultation, de la comparaison, de l''export et de chaque saisie de situation de sortie (la trace ne recopie jamais le contenu), instantané figé du document transmis, cellule vide jamais zéro pour une donnée non renseignée.'
     WHERE NOT EXISTS (
      SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Reporting Convergence%'
     )`
  );

  console.log('[INIT-DB] Migration « Suivi Convergence (CVG) » (2.58.0) ✓');
}

module.exports = { run };
