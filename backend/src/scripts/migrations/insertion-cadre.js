/**
 * Migration « Dossier administratif d'insertion » — PR A « Conformité
 * immédiate », lot 1 (contrats : rapports/cip-refonte-2026-09-12/
 * 10-contrats-techniques-PR-A.md § 3).
 *
 * Ce qu'elle pose :
 *  - le référentiel ADMINISTRABLE des critères d'éligibilité IAE
 *    (`insertion_eligibilite_criteres`, 14 critères seedés) et leur
 *    rattachement daté à une personne (`employee_eligibilite`) — jusqu'ici
 *    l'éligibilité vivait dans un TEXTE LIBRE (`employees.eligibilite_criteres`)
 *    qu'aucun export ne pouvait compter ;
 *  - les colonnes du cadre 2026 sur `employees` : statut BRSA, catégorie
 *    France Travail, orienteur (distinct du prescripteur), RÉFÉRENT UNIQUE
 *    (loi Plein Emploi — la structure est « structure d'accueil », décision de
 *    direction du 12/09), actualisation mensuelle FT, statut du Pass IAE ;
 *  - l'historique des événements du Pass (`insertion_pass_iae_evenements` :
 *    suspension, prolongation) — sans lui, un Pass suspendu est indiscernable
 *    d'un Pass actif ;
 *  - les PIÈCES dont la structure est SEULE dépositaire (`insertion_pieces`).
 *    ⚠ Aucun justificatif d'éligibilité n'y entre (plan 07 § 9) : ces pièces
 *    vivent sur les Emplois de l'inclusion, l'outil n'en garde que la
 *    RÉFÉRENCE. Le CHECK sur `type` verrouille cette décision dans la base, pas
 *    seulement dans l'écran ;
 *  - `etp_asp_mensuel.nb_brsa` : le parseur ASP lisait déjà « Dont BRSA » et
 *    JETAIT la valeur ; elle est désormais conservée pour rapprocher le compte
 *    déclaré à l'ASP du compte BRSA de l'outil.
 *
 * Contrat d'exécution : `run(client)` est appelé par `init-db.js` DANS sa
 * transaction. Donc : `client.query` uniquement, aucun BEGIN/COMMIT interne,
 * et chaque instruction rejouable (IF NOT EXISTS, DO-scan de `pg_constraint`,
 * seeds `ON CONFLICT DO NOTHING`, entrée de registre gardée par NOT ILIKE).
 */

'use strict';

/**
 * Les 14 critères d'éligibilité IAE seedés (ordre = ordre d'affichage des
 * pastilles de l'écran, repris de la maquette « Dossier administratif »).
 * Le référentiel est ADMINISTRABLE : ce seed ne pose que l'état initial, et
 * `ON CONFLICT DO NOTHING` garantit qu'un libellé retouché par l'ADMIN ou un
 * critère désactivé ne revient JAMAIS au redémarrage (doctrine 2.26.4).
 */
const CRITERES_ELIGIBILITE = [
  ['brsa', 'Bénéficiaire du RSA', 1],
  ['ass', 'Allocataire ASS', 2],
  ['aah', 'Allocataire AAH', 3],
  ['deld', "Demandeur d'emploi de longue durée (12-24 mois)", 4],
  ['detld', "Demandeur d'emploi de très longue durée (> 24 mois)", 5],
  ['jeune_26', 'Jeune de moins de 26 ans', 6],
  ['senior_50', 'Senior (50 ans et plus)', 7],
  ['rqth', 'Reconnaissance RQTH', 8],
  ['qpv', 'Résident en QPV', 9],
  ['zrr', 'Résident en ZRR', 10],
  ['refugie_bpi', 'Réfugié / bénéficiaire de la protection internationale', 11],
  ['sortant_detention', 'Sortant de détention', 12],
  ['parent_isole', 'Parent isolé', 13],
  ['sans_domicile', 'Sans domicile stable', 14],
];

async function run(client) {
  // ── 1. Référentiel des critères d'éligibilité IAE ────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_eligibilite_criteres (
      code VARCHAR(30) PRIMARY KEY,
      libelle VARCHAR(120) NOT NULL,
      ordre SMALLINT NOT NULL DEFAULT 0,
      actif BOOLEAN NOT NULL DEFAULT true
    );
  `);

  // Seed idempotent : un INSERT ... SELECT ... ON CONFLICT DO NOTHING, valeurs
  // paramétrées (les libellés portent des apostrophes typographiques).
  for (const [code, libelle, ordre] of CRITERES_ELIGIBILITE) {
    await client.query(
      `INSERT INTO insertion_eligibilite_criteres (code, libelle, ordre, actif)
       VALUES ($1, $2, $3, true) ON CONFLICT (code) DO NOTHING`,
      [code, libelle, ordre]
    );
  }

  // ── 2. Rattachement daté d'un critère à une personne ─────────────────────
  // UNIQUE(employee_id, critere_code) : un critère est constaté une fois ; le
  // ré-enregistrer met à jour la date de constat, il ne crée pas de doublon.
  await client.query(`
    CREATE TABLE IF NOT EXISTS employee_eligibilite (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      critere_code VARCHAR(30) NOT NULL REFERENCES insertion_eligibilite_criteres(code),
      date_constat DATE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(employee_id, critere_code)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_employee_eligibilite_employee ON employee_eligibilite(employee_id);');

  // ── 3. Colonnes du cadre 2026 sur `employees` ────────────────────────────
  // Toutes NULLABLES sans défaut (hors les trois compteurs/drapeaux techniques
  // ci-dessous) : « non renseigné » doit rester distinct de « non » — un BRSA
  // à `false` par défaut ferait disparaître des personnes du compte déclaré au
  // Département.
  await client.query(`
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS brsa BOOLEAN;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS brsa_date_constat DATE;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS ft_categorie VARCHAR(1);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS ft_categorie_date DATE;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS orienteur_type VARCHAR(20);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS orienteur_nom VARCHAR(150);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS referent_unique_type VARCHAR(20) NOT NULL DEFAULT 'non_determine';
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS referent_unique_nom VARCHAR(150);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS referent_unique_contact VARCHAR(200);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS actualisation_ft_requise BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS actualisation_ft_derniere_date DATE;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS actualisation_ft_rappels_non_honores SMALLINT NOT NULL DEFAULT 0;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS pass_iae_statut VARCHAR(12) NOT NULL DEFAULT 'inconnu';
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS eligibilite_verifiee_le DATE;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS eligibilite_source VARCHAR(30);
  `);

  // CHECK par DO-scan de `pg_constraint` : `ALTER TABLE ... ADD CONSTRAINT`
  // n'accepte pas IF NOT EXISTS, et la contrainte doit pouvoir être ÉLARGIE un
  // jour sans casser la base (même mécanique que `milestone_type`).
  // Chacun tolère NULL — « non renseigné » est une valeur légitime partout ici.
  const checks = [
    ['employees', 'employees_ft_categorie_check',
      "ft_categorie IS NULL OR ft_categorie IN ('A','B','C','D','E','F','G')"],
    ['employees', 'employees_orienteur_type_check',
      "orienteur_type IS NULL OR orienteur_type IN ('departement_cms','france_travail','mission_locale','cap_emploi','ccas','autre')"],
    ['employees', 'employees_referent_unique_type_check',
      "referent_unique_type IN ('structure','france_travail','cms','autre','non_determine')"],
    ['employees', 'employees_pass_iae_statut_check',
      "pass_iae_statut IN ('actif','suspendu','prolonge','expire','inconnu')"],
    ['employees', 'employees_eligibilite_source_check',
      "eligibilite_source IS NULL OR eligibilite_source IN ('auto_prescription','prescripteur_habilite','inconnu')"],
  ];
  for (const [table, nom, expr] of checks) {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '${table}'::regclass AND conname = '${nom}'
        ) THEN
          ALTER TABLE ${table} ADD CONSTRAINT ${nom} CHECK (${expr});
        END IF;
      END $$;
    `);
  }

  // ── 4. Événements du Pass IAE (suspension / prolongation) ────────────────
  // Sans cette table, `pass_iae_end` seule ne dit rien d'un Pass suspendu
  // pendant un arrêt maladie, ni d'une prolongation obtenue — et le statut
  // affiché en tête de fiche serait faux dans les deux cas.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_pass_iae_evenements (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      type VARCHAR(15) NOT NULL CHECK (type IN ('suspension','prolongation','autre')),
      date_debut DATE NOT NULL,
      date_fin DATE,
      motif TEXT,
      reference_externe VARCHAR(60),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_pass_iae_evenements_employee ON insertion_pass_iae_evenements(employee_id);');

  // ── 5. Pièces dont la structure est SEULE dépositaire ────────────────────
  //
  // Le CHECK sur `type` est la traduction en base de l'amendement du plan 07
  // § 9 : entretien signé (RES-03), convention PMSMP, accusé de remise, autre.
  // PAS de « justificatif d'éligibilité » — ces pièces restent sur les Emplois
  // de l'inclusion ; les recopier ici créerait une seconde copie de documents
  // qui portent bien plus que le critère (une notification de droits dit le
  // montant, la composition du foyer, parfois la santé).
  //
  // Contenu en BYTEA et non sous `/uploads` : ce dossier est servi
  // statiquement — un entretien signé y serait accessible par simple URL
  // (même arbitrage que les signatures de bordereaux de déchèterie, 2.50.0).
  // Taille bornée à 5 Mo par un CHECK, pas seulement par multer : la borne doit
  // tenir même si un futur appelant oublie la limite côté route.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_pieces (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL CHECK (type IN ('entretien_signe','convention_pmsmp','accuse_remise','autre')),
      milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL,
      pmsmp_id INTEGER REFERENCES insertion_pmsmp(id) ON DELETE SET NULL,
      nom_fichier VARCHAR(200) NOT NULL,
      mime VARCHAR(80) NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png')),
      taille INTEGER NOT NULL CHECK (taille > 0 AND taille <= 5242880),
      contenu BYTEA NOT NULL,
      sha256 CHAR(64) NOT NULL,
      depose_par INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_pieces_employee ON insertion_pieces(employee_id);');

  // ── 6. Compte BRSA déclaré à l'ASP ───────────────────────────────────────
  // `asp-parser.js` lit « Dont BRSA : N » depuis l'état mensuel depuis toujours,
  // et `effectifs.js` jetait la valeur au moment d'écrire la ligne. Elle sert à
  // rapprocher ce qui est DÉCLARÉ de ce que l'outil COMPTE (employees.brsa).
  await client.query('ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS nb_brsa INTEGER;');

  // ── 7. Catégories d'actions CIP : + job dating, + formation ──────────────
  // Amendement A5/S5/S6 de la matrice autorité. Le CHECK existant est
  // RECONSTRUIT (DROP puis ADD) et non complété : PostgreSQL ne sait pas
  // « étendre » une contrainte. Les 4 valeurs historiques sont reprises telles
  // quelles — les perdre invaliderait toutes les lignes déjà saisies.
  // Idempotent : on ne reconstruit que si la contrainte ne couvre pas déjà
  // 'job_dating' (relecture de `pg_get_constraintdef`), donc rejouer ne fait
  // rien et ne verrouille pas la table pour rien.
  await client.query(`
    DO $$
    DECLARE def TEXT;
    BEGIN
      SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
       WHERE conrelid = 'cip_action_plans'::regclass
         AND conname = 'cip_action_plans_category_check';
      IF def IS NULL OR def NOT LIKE '%job_dating%' THEN
        IF def IS NOT NULL THEN
          ALTER TABLE cip_action_plans DROP CONSTRAINT cip_action_plans_category_check;
        END IF;
        ALTER TABLE cip_action_plans ADD CONSTRAINT cip_action_plans_category_check
          CHECK (category IN ('competence','insertion','socialisation','frein','job_dating','formation'));
      END IF;
    END $$;
  `);

  // ── 8. Référentiel partenaires : le CMS du Département ───────────────────
  // Le référent unique d'un BRSA est le plus souvent un travailleur social du
  // centre médico-social : sans l'organisme au référentiel, les actions prises
  // avec lui restent rattachées à « aucun partenaire » et disparaissent des
  // statistiques par partenaire (amendement A5).
  await client.query(`
    INSERT INTO insertion_partenaires (nom, categorie)
    VALUES ('Centre médico-social (CMS) — Département 76', 'social')
    ON CONFLICT (nom) DO NOTHING;
  `);

  // ── 9. Registre RGPD (art. 30) ───────────────────────────────────────────
  // Entrée DISTINCTE de « Accompagnement socio-professionnel » : les données
  // ajoutées ici sont d'une autre nature (statuts sociaux — BRSA, catégorie
  // France Travail —, critères d'éligibilité, pièces signées), elles ont
  // d'autres destinataires (Département, DDETS via les Emplois de l'inclusion)
  // et une autre base légale (obligation légale du conventionnement IAE et de
  // la loi Plein Emploi). Garde NOT ILIKE sur le nom : rejouable sans effet,
  // et un texte retouché par le DPO n'est jamais écrasé.
  await client.query(`
    INSERT INTO rgpd_registre
      (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
    SELECT
      'Dossier administratif d''insertion (éligibilité IAE, Pass IAE, référent unique, statuts sociaux, pièces signées)',
      'Tenue du dossier administratif exigé par le conventionnement IAE et la loi pour le plein emploi : constat des critères d''éligibilité (référencés sur la plateforme « Les Emplois de l''inclusion », jamais recopiés dans l''outil), suivi du Pass IAE et de ses événements (suspension, prolongation), identification de l''orienteur, du prescripteur habilité et du RÉFÉRENT UNIQUE externe, suivi de l''actualisation mensuelle France Travail, conservation des pièces dont la structure est SEULE dépositaire (exemplaire signé d''un entretien, convention PMSMP, accusé de remise de document).',
      'Obligation légale (art. L5132-1 s. Code du travail ; loi n° 2023-1196 pour le plein emploi) et mission d''intérêt public',
      'Salariés en parcours d''insertion (CDDI)',
      'Critères d''éligibilité IAE constatés et date de constat, référence (localisation) des justificatifs conservés hors de l''outil, numéro et dates du Pass IAE, statut et événements du Pass, orienteur et prescripteur, référent unique (organisme, nom, coordonnées professionnelles), STATUTS SOCIAUX (bénéficiaire du RSA et date de constat, catégorie d''inscription France Travail et date, identifiant France Travail), motif de dérogation à la durée maximale de CDDI, pièces signées numérisées',
      'CIP et service RH (nominatif) ; le bloc de report vers « Les Emplois de l''inclusion » est composé à l''écran pour saisie manuelle par l''utilisateur habilité — aucune transmission automatique depuis l''outil',
      'Parcours + 24 mois après dernier contact (anonymisation : suppression des critères d''éligibilité, des événements du Pass et des pièces ; effacement des noms et coordonnées de l''orienteur et du référent)',
      'Statuts sociaux (BRSA, catégorie France Travail) réservés aux rôles ADMIN/RH — jamais rendus en lecture à l''encadrement technique, y compris par l''API ; pièces stockées EN BASE (jamais sous un répertoire servi statiquement), servies authentifiées avec en-têtes « no-store » et « nosniff », type de fichier vérifié par ses octets d''en-tête et non par le type déclaré ; consultation, dépôt et suppression d''une pièce journalisés (rgpd_audit_log) ; chaque consultation et chaque modification du dossier administratif journalisées (la trace dit quels champs ont changé, jamais leurs valeurs) ; AUCUN justificatif d''éligibilité n''est stocké dans l''outil (principe de minimisation : seule la référence est conservée)'
    WHERE NOT EXISTS (
      SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Dossier administratif d''insertion%'
    );
  `);

  console.log('[INIT-DB] Migration « Dossier administratif d\'insertion » (PR A lot 1) ✓');
}

module.exports = { run, CRITERES_ELIGIBILITE };
