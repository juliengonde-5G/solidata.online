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
 *
 * 4e colonne — `sensible_art10` : le critère relève de l'article 10 du RGPD
 * (condamnations et infractions). C'est une PROPRIÉTÉ DU RÉFÉRENTIEL, jamais
 * un code écrit en dur dans une route : le jour où la direction ajoute ou
 * retire un critère judiciaire, elle le fait dans l'écran de réglages et les
 * trois surfaces protégées (export, projection encadrant, bloc de report) la
 * suivent sans redéploiement. Un critère ainsi marqué :
 *   - ne sort JAMAIS dans un export nominatif (colonne 10 du fichier FSE+) ;
 *   - n'est JAMAIS rendu à un encadrant technique, ni par son libellé ni dans
 *     le COMPTE de critères qui lui est servi ;
 *   - est remplacé dans le bloc « Les Emplois de l'inclusion » — qui se copie
 *     hors de l'outil — par une mention neutre renvoyant à la fiche.
 * Il reste en revanche saisissable et lisible par ADMIN/RH : il FONDE une
 * éligibilité IAE, le retirer du référentiel ferait disparaître le motif réel
 * d'entrée en parcours de certaines personnes (décision de l'orchestrateur du
 * 13/09, à confirmer par la direction et le DPO — voir le rapport 14 § M-06).
 */
const CRITERES_ELIGIBILITE = [
  ['brsa', 'Bénéficiaire du RSA', 1, false],
  ['ass', 'Allocataire ASS', 2, false],
  ['aah', 'Allocataire AAH', 3, false],
  ['deld', "Demandeur d'emploi de longue durée (12-24 mois)", 4, false],
  ['detld', "Demandeur d'emploi de très longue durée (> 24 mois)", 5, false],
  ['jeune_26', 'Jeune de moins de 26 ans', 6, false],
  ['senior_50', 'Senior (50 ans et plus)', 7, false],
  ['rqth', 'Reconnaissance RQTH', 8, false],
  ['qpv', 'Résident en QPV', 9, false],
  ['zrr', 'Résident en ZRR', 10, false],
  ['refugie_bpi', 'Réfugié / bénéficiaire de la protection internationale', 11, false],
  ['sortant_detention', 'Sortant de détention', 12, true],
  ['parent_isole', 'Parent isolé', 13, false],
  ['sans_domicile', 'Sans domicile stable', 14, false],
];

/** Verrou du marquage initial art. 10 — voir la section 1 de `run`. */
const CLE_VERROU_ART10 = 'insertion.eligibilite_art10_seed';

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
  // Le drapeau art. 10 est une colonne du RÉFÉRENTIEL et non une liste de codes
  // dans le code : ajouté séparément pour que les bases déjà migrées le
  // reçoivent aussi. `NOT NULL DEFAULT false` — un critère dont on n'a rien dit
  // n'est pas judiciaire, c'est la seule valeur par défaut sûre dans ce sens-là
  // (le défaut inverse masquerait des critères ordinaires à l'encadrement).
  await client.query('ALTER TABLE insertion_eligibilite_criteres ADD COLUMN IF NOT EXISTS sensible_art10 BOOLEAN NOT NULL DEFAULT false;');

  // Seed idempotent : un INSERT ... ON CONFLICT DO NOTHING, valeurs
  // paramétrées (les libellés portent des apostrophes typographiques).
  for (const [code, libelle, ordre, art10] of CRITERES_ELIGIBILITE) {
    await client.query(
      `INSERT INTO insertion_eligibilite_criteres (code, libelle, ordre, actif, sensible_art10)
       VALUES ($1, $2, $3, true, $4) ON CONFLICT (code) DO NOTHING`,
      [code, libelle, ordre, art10 === true]
    );
  }

  // MARQUAGE INITIAL art. 10 sur une base DÉJÀ SEEDÉE.
  //
  // Sans lui, le correctif serait inopérant précisément là où il compte : sur
  // les bases de recette et de production, `ON CONFLICT DO NOTHING` ne touche
  // pas les lignes existantes et « Sortant de détention » resterait à `false`,
  // donc exporté et servi à l'encadrement comme avant.
  //
  // Doctrine 2.26.4 (verrou de seed) : on marque UNE fois, puis la clé
  // `insertion.eligibilite_art10_seed` interdit toute réapparition. Si la
  // direction décide demain qu'un critère n'est plus traité comme art. 10, elle
  // le décoche dans l'écran de réglages et un redémarrage ne le recochera pas.
  try {
    const verrou = await client.query('SELECT value FROM settings WHERE key = $1', [CLE_VERROU_ART10]);
    if (verrou.rows.length === 0) {
      const codesArt10 = CRITERES_ELIGIBILITE.filter(([, , , a]) => a === true).map(([c]) => c);
      const maj = await client.query(
        `UPDATE insertion_eligibilite_criteres SET sensible_art10 = true
          WHERE code = ANY($1::text[]) AND sensible_art10 IS NOT TRUE
        RETURNING code`,
        [codesArt10]
      );
      await client.query(
        `INSERT INTO settings (key, value, category) VALUES ($1, $2, 'insertion')
         ON CONFLICT (key) DO NOTHING`,
        [CLE_VERROU_ART10, new Date().toISOString()]
      );
      console.log(`[INIT-DB] Critères d'éligibilité art. 10 marqués : ${maj.rowCount} (verrou posé) ✓`);
    }
  } catch (err) {
    // Table `settings` absente (base en cours de construction) : on ne pose pas
    // de verrou — la tentative aura lieu au démarrage suivant. Jamais de
    // marquage sans verrou : il reviendrait à chaque redémarrage.
    if (err.code !== '42P01') throw err;
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
  // la loi Plein Emploi).
  //
  // Les textes sont passés en PARAMÈTRES et non inlinés : ils sont longs, ils
  // portent des apostrophes, et surtout ils servent DEUX fois — à la création
  // de l'entrée et à sa mise en conformité sur une base déjà seedée (correctif
  // de sécurité du 13/09 : le registre promettait une protection que le code ne
  // tenait pas, ce qui est une non-conformité en soi).
  const CATEGORIES_DONNEES_CADRE = "Critères d'éligibilité IAE constatés et date de constat — CERTAINS RELÈVENT DE CATÉGORIES PARTICULIÈRES : santé au sens de l'art. 9 (reconnaissance RQTH, allocataire AAH) et infractions au sens de l'art. 10 (sortant de détention, marqué « sensible art. 10 » dans le référentiel administrable) —, référence (localisation) des justificatifs conservés hors de l'outil, numéro et dates du Pass IAE, statut et événements du Pass, orienteur et prescripteur, référent unique (organisme, nom, coordonnées professionnelles), STATUTS SOCIAUX (bénéficiaire du RSA et date de constat, catégorie d'inscription France Travail et date, identifiant France Travail), motif de dérogation à la durée maximale de CDDI, pièces signées numérisées";

  const MESURES_SECURITE_CADRE = "Statuts sociaux (BRSA, catégorie France Travail) réservés aux rôles ADMIN/RH — jamais rendus en lecture à l'encadrement technique, y compris par l'API : la LISTE DES CRITÈRES d'éligibilité elle-même ne lui est pas servie (il reçoit la date de vérification, la source et un NOMBRE de critères, jamais leurs codes ni leurs libellés), et les données qu'il n'a pas le droit de voir ne sont même pas lues en base pour lui. Les critères marqués « sensible art. 10 » dans le référentiel (condamnations et infractions) ne sont ni comptés pour l'encadrement technique, ni exportés dans un fichier nominatif, ni recopiés dans le bloc de report vers « Les Emplois de l'inclusion » (une mention neutre y renvoie à la fiche) ; pièces stockées EN BASE (jamais sous un répertoire servi statiquement), servies authentifiées avec en-têtes « no-store » et « nosniff », type de fichier vérifié par ses octets d'en-tête et non par le type déclaré ; consultation, dépôt et suppression d'une pièce journalisés deux fois (registre RGPD et journal d'activité — une trace indisponible ne doit pas effacer la preuve de la consultation) ; chaque consultation et chaque modification du dossier administratif journalisées (la trace dit quels champs ont changé, jamais leurs valeurs) ; AUCUN justificatif d'éligibilité n'est stocké dans l'outil (principe de minimisation : seule la référence est conservée)";

  // Création (base neuve). Garde NOT EXISTS sur le nom : rejouable sans effet.
  await client.query(
    `INSERT INTO rgpd_registre
      (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
     SELECT
      'Dossier administratif d''insertion (éligibilité IAE, Pass IAE, référent unique, statuts sociaux, pièces signées)',
      'Tenue du dossier administratif exigé par le conventionnement IAE et la loi pour le plein emploi : constat des critères d''éligibilité (référencés sur la plateforme « Les Emplois de l''inclusion », jamais recopiés dans l''outil), suivi du Pass IAE et de ses événements (suspension, prolongation), identification de l''orienteur, du prescripteur habilité et du RÉFÉRENT UNIQUE externe, suivi de l''actualisation mensuelle France Travail, conservation des pièces dont la structure est SEULE dépositaire (exemplaire signé d''un entretien, convention PMSMP, accusé de remise de document).',
      'Obligation légale (art. L5132-1 s. Code du travail ; loi n° 2023-1196 pour le plein emploi) et mission d''intérêt public',
      'Salariés en parcours d''insertion (CDDI)',
      $1,
      'CIP et service RH (nominatif) ; le bloc de report vers « Les Emplois de l''inclusion » est composé à l''écran pour saisie manuelle par l''utilisateur habilité — aucune transmission automatique depuis l''outil',
      'Parcours + 24 mois après dernier contact (anonymisation : suppression des critères d''éligibilité, des événements du Pass et des pièces ; effacement des noms et coordonnées de l''orienteur et du référent)',
      $2
     WHERE NOT EXISTS (
      SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Dossier administratif d''insertion%'
     )`,
    [CATEGORIES_DONNEES_CADRE, MESURES_SECURITE_CADRE]
  );

  // MISE EN CONFORMITÉ d'une entrée déjà écrite par une version antérieure de
  // cette migration. Elle affirmait que les statuts sociaux n'étaient « jamais
  // rendus en lecture à l'encadrement technique » alors que la liste des
  // critères — qui porte le RSA, la RQTH et le fait d'être sortant de détention
  // — lui était servie en toutes lettres. Un registre qui promet ce que le code
  // ne tient pas est une non-conformité : il doit être repris, pas seulement le
  // code.
  //
  // Double garde, pour ne JAMAIS écraser un texte retouché par le DPO :
  //  - la reprise ne s'applique qu'à une entrée qui porte encore la phrase de
  //    la version d'origine (donc non retouchée) ;
  //  - et seulement si elle ne mentionne pas déjà la protection art. 10 (donc
  //    une seule fois ; une seconde exécution ne fait rien).
  await client.query(
    `UPDATE rgpd_registre
        SET categories_donnees = $1, mesures_securite = $2
      WHERE nom_traitement ILIKE 'Dossier administratif d''insertion%'
        AND mesures_securite LIKE '%AUCUN justificatif d''éligibilité n''est stocké dans l''outil%'
        AND mesures_securite NOT LIKE '%sensible art. 10%'`,
    [CATEGORIES_DONNEES_CADRE, MESURES_SECURITE_CADRE]
  );

  console.log('[INIT-DB] Migration « Dossier administratif d\'insertion » (PR A lot 1) ✓');
}

module.exports = { run, CRITERES_ELIGIBILITE };
