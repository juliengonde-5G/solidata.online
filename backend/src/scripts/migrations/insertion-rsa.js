/**
 * Migration PR B — lot 3 « Cadre RSA (structure d'accueil) »
 * (contrats : rapports/cip-refonte-2026-09-12/15-contrats-techniques-PR-B.md § 3).
 *
 * Ce qu'elle pose, et pourquoi :
 *
 *  - DEUX TYPES D'ENTRETIEN qui manquaient au cadre de la loi pour le plein
 *    emploi. Solidarité Textiles est **structure d'accueil** et non référent
 *    unique (décision de direction du 12/09) : elle ALIMENTE un référent
 *    externe (CMS du Département, France Travail). Ce dialogue a un support —
 *    le « Point avec le référent » (`point_etape_referent`, tripartite ou
 *    bilatéral) — qui n'existait nulle part : il se tenait, et il ne laissait
 *    aucune trace exploitable. Et la réforme du RSA ouvre un droit de
 *    contestation avant sanction : l'« Entretien de conciliation (protection
 *    des droits) » (`conciliation`) le matérialise, avec ses MOTIFS LÉGITIMES
 *    en liste fermée de codes — jamais un texte libre, qui porterait par nature
 *    de la santé (art. 9) sans qu'aucune colonne ne l'annonce.
 *
 *  - LA DATE DE RÉALISATION D'UNE ACTION CIP (`cip_action_plans.date_realisation`).
 *    Le statut disait « réalisé », `updated_at` disait quand la LIGNE avait été
 *    touchée pour la dernière fois — jamais quand l'action avait eu lieu. Le
 *    compteur d'activité hebdomadaire et la feuille de temps ont besoin de la
 *    seconde, pas de la première.
 *
 *  - LA TRACE DE CE QUI SORT VERS LE TIERS (`insertion_alimentations_referent`).
 *    Une fiche transmise au référent est un document qui quitte la structure :
 *    on en garde le SNAPSHOT de contenu (liste blanche composée par
 *    `services/fiche-referent.js`) et la trace des deux remises — au référent
 *    et à la personne. Sans snapshot, « qu'avons-nous transmis le 12 mars ? »
 *    n'a pas de réponse, puisque le dossier a changé depuis.
 *
 *  - LE REGISTRE D'ACTUALISATION FRANCE TRAVAIL (`insertion_actualisations_ft`),
 *    un mois par ligne et non un booléen unique (amendement A3) : `honoree`
 *    reste NULL tant que rien n'a été CONSTATÉ — un « non » déduit du silence
 *    accuserait la personne d'un manquement qu'on n'a pas vérifié.
 *
 * Contrat d'exécution : `run(client)` est appelé par `init-db.js` DANS sa
 * transaction. Donc `client.query` uniquement, aucun BEGIN/COMMIT interne, et
 * chaque instruction rejouable (IF NOT EXISTS, DO-scan de `pg_constraint`,
 * entrée de registre gardée par NOT EXISTS).
 */

'use strict';

/**
 * Liste complète des types d'entretien APRÈS cette migration. Elle vit ici et
 * non dans `engine.js` parce que c'est la base qui doit la garantir : un type
 * accepté par le validateur applicatif mais refusé par le CHECK produirait un
 * 23514 à l'enregistrement, c'est-à-dire un entretien perdu en fin de saisie.
 */
const MILESTONE_TYPES_RSA = [
  'diagnostic_accueil', 'bilan_intermediaire', 'renouvellement', 'bilan_sortie',
  'suivi_post_sortie', 'periode_essai', 'point_etape_referent', 'conciliation',
];

/**
 * Motifs légitimes d'une conciliation — liste FERMÉE (codes). Le formulaire
 * COMMENCE par eux (08 § 10) : la question posée à la personne est « qu'est-ce
 * qui vous en a empêché ? », pas « pourquoi n'avez-vous pas obéi ? ». Aucun de
 * ces codes ne dit une nature médicale : `sante` signifie « un problème de
 * santé », jamais lequel.
 */
const CONCILIATION_MOTIFS = [
  'sante', 'garde_enfant', 'transport', 'demarche_administrative',
  'formation_emploi', 'deuil_famille', 'autre',
];

async function run(client) {
  // ── (a) Types d'entretien : point avec le référent, conciliation ──────────
  //
  // Colonnes d'abord (le CHECK de `conciliation_motifs` n'existe pas : c'est un
  // JSONB, sa liste fermée est tenue par le routeur — un CHECK sur le contenu
  // d'un tableau JSON serait illisible et indébogable en production).
  await client.query(`
    ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS referent_modalite VARCHAR(12);
    ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS conciliation_motifs JSONB;
    ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS conciliation_issue VARCHAR(20);
  `);

  // CHECK `milestone_type` : même mécanique que le lot 8 de la PR3 (init-db
  // section 8a) — on DROP les contraintes qui portent sur `milestone_type` et
  // ne connaissent PAS encore 'conciliation', puis on repose la liste complète.
  // Le marqueur rend l'opération rejouable : une seconde exécution ne trouve
  // plus rien à supprimer et l'ADD gardé ne recrée rien.
  await client.query(`
    DO $$
    DECLARE cname text;
    BEGIN
      FOR cname IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'insertion_milestones'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%milestone_type%'
          AND pg_get_constraintdef(oid) NOT ILIKE '%conciliation%'
      LOOP
        EXECUTE 'ALTER TABLE insertion_milestones DROP CONSTRAINT ' || quote_ident(cname);
      END LOOP;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_milestones'::regclass AND conname = 'insertion_milestones_milestone_type_check'
      ) THEN
        ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_milestone_type_check
          CHECK (milestone_type IN (${MILESTONE_TYPES_RSA.map((t) => `'${t}'`).join(', ')}));
      END IF;
    END $$;
  `);

  // Modalité du point avec le référent : tripartite (la personne est présente)
  // ou bilatérale (deux professionnels parlent d'elle sans elle). La distinction
  // n'est pas cosmétique — c'est elle que l'autorité regarde quand elle demande
  // si la personne est associée à son propre suivi. NULL reste licite : le
  // champ ne vaut que pour ce type d'entretien.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_milestones'::regclass
          AND conname = 'insertion_milestones_referent_modalite_check'
      ) THEN
        ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_referent_modalite_check
          CHECK (referent_modalite IS NULL OR referent_modalite IN ('tripartite', 'bilaterale'));
      END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_milestones'::regclass
          AND conname = 'insertion_milestones_conciliation_issue_check'
      ) THEN
        ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_conciliation_issue_check
          CHECK (conciliation_issue IS NULL OR conciliation_issue IN ('maintien', 'reprise', 'orientation', 'sans_suite'));
      END IF;
    END $$;
  `);

  // ── (b) Date de réalisation d'une action CIP ──────────────────────────────
  //
  // La reprise ne s'exécute qu'UNE fois par ligne (`WHERE date_realisation IS
  // NULL`) et l'approximation est assumée et documentée ici : pour les actions
  // déjà marquées « réalisé » avant cette migration, la seule date disponible
  // est `updated_at`, c'est-à-dire la date de la dernière écriture sur la ligne
  // et non celle de l'action. Elle vaut mieux que rien — sans elle, ces actions
  // seraient définitivement absentes des compteurs d'activité — mais elle n'est
  // pas une date de réalisation constatée. Les actions saisies à partir
  // d'aujourd'hui portent la vraie date (routes.js pose CURRENT_DATE au passage
  // au statut « réalisé », et la CIP peut la corriger).
  await client.query('ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS date_realisation DATE;');
  await client.query(`
    UPDATE cip_action_plans SET date_realisation = updated_at::date
     WHERE date_realisation IS NULL AND status = 'realise' AND updated_at IS NOT NULL;
  `);

  // ── (c) Fiches transmises au référent : la preuve de ce qui est SORTI ─────
  //
  // `contenu` est un SNAPSHOT et non une vue : le dossier vit, la fiche du 12
  // mars doit rester ce qu'elle était le 12 mars. `destinataire_type` et
  // `destinataire_nom` sont eux aussi recopiés au moment de la génération —
  // rattacher la fiche au référent ACTUEL ferait mentir l'historique le jour où
  // le référent change.
  //
  // `remis_salarie_le` matérialise l'exigence « un exemplaire remis à la
  // personne » (matrice autorité 09 (f)) : ce qu'on dit d'elle à un tiers, elle
  // doit pouvoir le lire.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_alimentations_referent (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      parcours_num INTEGER NOT NULL DEFAULT 1,
      moment VARCHAR(15) NOT NULL CHECK (moment IN ('entree','renouvellement','sortie','demande')),
      periode_debut DATE NOT NULL,
      periode_fin DATE NOT NULL,
      destinataire_type VARCHAR(20) NOT NULL,
      destinataire_nom VARCHAR(150),
      contenu JSONB NOT NULL,
      genere_par INTEGER REFERENCES users(id),
      genere_le TIMESTAMP NOT NULL DEFAULT NOW(),
      remis_referent_le DATE,
      remis_referent_mode VARCHAR(15) CHECK (remis_referent_mode IS NULL OR remis_referent_mode IN ('mail','courrier','main_propre','plateforme')),
      remis_salarie_le DATE,
      remise_par INTEGER REFERENCES users(id)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_alim_referent_employee ON insertion_alimentations_referent(employee_id, genere_le DESC);');

  // ── (d) Actualisation mensuelle France Travail ────────────────────────────
  //
  // `honoree BOOLEAN` NULLABLE : trois états, et c'est le point de la table.
  // NULL = on ne sait pas (aucun constat) ; true = constaté fait ; false =
  // constaté non fait. Un défaut `false` transformerait chaque mois non vérifié
  // en manquement de la personne — exactement ce qu'une structure d'accueil ne
  // doit pas produire, puisque c'est ce constat qui peut fonder une suspension
  // de droits.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_actualisations_ft (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      mois DATE NOT NULL,
      rappel_le DATE,
      rappel_par INTEGER REFERENCES users(id),
      honoree BOOLEAN,
      constat_le DATE,
      UNIQUE(employee_id, mois)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_actualisations_ft_mois ON insertion_actualisations_ft(mois);');

  // ── (e) Registre RGPD (art. 30) ───────────────────────────────────────────
  //
  // Entrée DISTINCTE du dossier administratif et de l'accompagnement : la
  // finalité est une TRANSMISSION À UN TIERS, et c'est ce qui fait la
  // différence. Les destinataires sont extérieurs à la structure, la durée de
  // conservation est celle de la preuve de ce qu'on a transmis, et les mesures
  // de sécurité décrivent une LISTE BLANCHE — ce qui entre dans la fiche est
  // énuméré côté serveur ; santé et judiciaire n'y ont aucune clé, et leur
  // absence n'est pas mentionnée non plus (dire « rubrique retirée » désignerait
  // la personne comme ayant quelque chose à cacher).
  const CATEGORIES_DONNEES_REFERENT = "Identité et identifiant interne, coordonnées professionnelles du référent unique destinataire, situation d'emploi (type et dates de contrat, quotité hebdomadaire, Pass IAE), ACTIVITÉ HEBDOMADAIRE (heures travaillées relevées par la paie, minutes d'accompagnement, jours d'immersion PMSMP), assiduité aux rendez-vous (rendez-vous proposés, honorés, absences regroupées par MOTIF CATÉGORISÉ), niveaux de freins périphériques NON SENSIBLES uniquement (mobilité, administratif, finances, logement, linguistique, famille, numérique), actions d'accompagnement et orientations vers des partenaires, objectifs en cours, prochaines échéances. AUCUNE donnée de santé (art. 9) et AUCUNE donnée judiciaire (art. 10) : ni le niveau du frein santé, ni celui du frein judiciaire, ni aucun commentaire, ni aucune action rattachée à l'un de ces deux freins n'entre dans le document — et son absence n'y est pas signalée. Le motif d'absence transmis est une CATÉGORIE grossière (santé, administratif, garde, transport, autre), jamais le libellé de paie ni un texte.";

  const MESURES_SECURITE_REFERENT = "Composition du document en LISTE BLANCHE côté serveur (les rubriques transmises sont énumérées dans le code : une donnée ajoutée demain au dossier ne part pas par défaut), accès et génération réservés aux rôles ADMIN/RH avec double authentification, journalisation RGPD de l'aperçu, de la génération, de la consultation et de la remise, conservation d'un SNAPSHOT du contenu transmis (la preuve de ce qui est sorti ne dépend pas de l'état actuel du dossier), refus de générer une fiche quand aucun référent n'est déterminé (un document sans destinataire ne doit pas exister), trace datée de la remise au référent ET de la remise d'un exemplaire à la personne concernée, absence sans motif imprimée « motif non renseigné » et jamais « injustifiée », indicateur d'activité hebdomadaire présenté sans vocabulaire de seuil ni d'obligation sur les documents destinés à la personne.";

  await client.query(
    `INSERT INTO rgpd_registre
      (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
     SELECT
      'Transmission d''informations au référent unique (RSA) — fiche pour le référent',
      'Alimentation du référent unique externe (centre médico-social du Département, France Travail) par la structure d''accueil : point de situation périodique sur le déroulement du parcours, activité hebdomadaire, assiduité aux rendez-vous, actions d''accompagnement engagées et échéances à venir. Solidarité Textiles est structure d''accueil et non référent unique (décision de direction du 12 septembre 2026) : elle ALIMENTE le contrat d''engagements réciproques tenu par le référent, elle ne le rédige pas.',
      'Mission d''intérêt public (loi n° 2023-1196 pour le plein emploi ; conventionnement IAE) — base légale à confirmer par le DPO',
      'Salariés en parcours d''insertion bénéficiaires du RSA ou suivis par un référent unique externe',
      $1,
      'Référent unique externe désigné par l''orienteur : centre médico-social du Département de Seine-Maritime, France Travail ou structure partenaire ; un exemplaire est remis à la personne concernée. En interne : ADMIN et RH uniquement.',
      'Durée du parcours + 2 ans (preuve de ce qui a été transmis et à qui) ; suppression intégrale à l''anonymisation du dossier du salarié',
      $2
     WHERE NOT EXISTS (
      SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Transmission d''informations au référent unique%'
     )`,
    [CATEGORIES_DONNEES_REFERENT, MESURES_SECURITE_REFERENT]
  );

  console.log('[INIT-DB] Migration « Cadre RSA (structure d\'accueil) » (PR B lot 3) ✓');
}

module.exports = { run, MILESTONE_TYPES_RSA, CONCILIATION_MOTIFS };
