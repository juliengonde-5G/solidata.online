/**
 * Migration PR C — lot 7 « Le salarié »
 * (contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md § 3.2).
 *
 * ═══ CE QU'ELLE POSE, ET POURQUOI ═════════════════════════════════════════
 *
 *  1. LE CONSENTEMENT AUX RAPPELS DE RENDEZ-VOUS (colonnes `employees.rappel_rdv_*`).
 *     Un SMS la veille d'un rendez-vous n'est ni une obligation contractuelle
 *     ni une mission d'intérêt public : c'est un service rendu à la personne,
 *     donc un traitement fondé sur son CONSENTEMENT (art. 6-1-a), qu'elle doit
 *     pouvoir retirer aussi facilement qu'elle l'a donné. D'où quatre exigences
 *     traduites en colonnes : l'accord lui-même (`rappel_rdv_consent`, NULL tant
 *     que rien n'a été demandé — « jamais demandé » n'est pas « refusé »), le
 *     canal et le destinataire CHOISIS par la personne (son numéro personnel
 *     n'est pas forcément celui de la paie), et la trace datée de qui a recueilli
 *     l'accord. L'écriture symétrique dans `rgpd_consents` (faite par le routeur)
 *     range ce consentement au même endroit que les autres.
 *
 *  2. LES DOCUMENTS COMPOSÉS POUR LA PERSONNE (`insertion_documents_salarie`).
 *     « Mon parcours en une page » et « Mon Récap » sont composés côté serveur
 *     en LISTE BLANCHE (`services/mon-parcours.js`) : le contenu n'est pas une
 *     vue du dossier, c'est une énumération de rubriques. On en garde le
 *     SNAPSHOT — même doctrine que les fiches transmises au référent (PR B) :
 *     « qu'avons-nous remis le 12 mars ? » n'a de réponse que si on l'a écrite,
 *     puisque le dossier a changé depuis. `remis_le` / `remis_mode` /
 *     `remis_par` matérialisent la remise EFFECTIVE : un document généré n'est
 *     pas un document remis.
 *
 *  3. LA TRACE DES RAPPELS ENVOYÉS (`insertion_rappels_rdv`), avec deux partis
 *     pris. Le destinataire y est MASQUÉ (« 06 ** ** ** 12 ») : la trace sert à
 *     prouver qu'un message est parti, pas à constituer un second répertoire de
 *     coordonnées. Et `UNIQUE(milestone_id)` garantit qu'un entretien ne reçoit
 *     jamais deux rappels, même si deux ticks du planificateur se chevauchent —
 *     la contrainte fait le travail que des verrous applicatifs feraient mal.
 *
 *  4. LES GABARITS BREVO (`message_templates`, catégorie `insertion_rappel_rdv`).
 *     Leur texte est la pièce la plus sensible de ce lot : un SMS arrive sur un
 *     écran que d'autres personnes voient. Il ne nomme donc JAMAIS le type
 *     d'entretien, ni le motif, ni rien du parcours — « vous avez rendez-vous
 *     demain à 14 h avec Claire M. » et rien d'autre. Un gabarit qui dirait
 *     « bilan de sortie » ou « entretien de conciliation » ferait sortir une
 *     information sur la situation de la personne vers son entourage.
 *
 * Contrat d'exécution : `run(client)` est appelé par `init-db.js` DANS sa
 * transaction. Donc `client.query` uniquement, aucun BEGIN/COMMIT interne, et
 * chaque instruction rejouable (IF NOT EXISTS, DO-scan de `pg_constraint`,
 * seeds gardés par NOT EXISTS).
 */

'use strict';

/** Canaux de rappel possibles — miroir du CHECK posé plus bas. */
const CANAUX_RAPPEL = ['sms', 'email'];

/** Types de documents composés pour la personne (CHECK de la table). */
const TYPES_DOCUMENT_SALARIE = ['mon_parcours', 'mon_recap'];

/** Modes de remise tracés (CHECK de la table). */
const MODES_REMISE_SALARIE = ['main_propre', 'email', 'courrier'];

/**
 * Corps du SMS et de l'e-mail de rappel.
 *
 * Exportés pour qu'un test puisse vérifier ce qu'ils NE disent pas : aucun type
 * d'entretien, aucun motif, aucun élément de parcours. Les variables sont les
 * quatre seules que le job substitue ({prenom}, {date}, {heure}, {cip}) — `cip`
 * étant un prénom suivi d'une initiale, jamais un nom complet.
 */
// CORRECTIF M-05 — le PRÉNOM est retiré du gabarit. Un chiffre de trop dans le
// numéro saisi par la conseillère, et ce message — prénom + nom de la structure
// d'insertion + fait d'un rendez-vous — partait chez un inconnu, une fois par
// rendez-vous. Le message reste parfaitement clair pour son destinataire : il
// arrive sur SON téléphone, ou dans SA boîte. La direction peut rétablir
// « Bonjour {prenom} » depuis l'écran des gabarits si elle le décide.
const RAPPEL_SMS_BODY = 'Bonjour, rappel : vous avez rendez-vous demain {date} à {heure} '
  + 'avec {cip} à Solidarité Textiles. En cas d\'empêchement, prévenez-nous.';
const RAPPEL_EMAIL_SUBJECT = 'Rappel de votre rendez-vous de demain';
const RAPPEL_EMAIL_BODY = RAPPEL_SMS_BODY;

/** Gabarit historique (avec prénom) — repère de la mise à jour non destructive. */
const RAPPEL_SMS_BODY_V1 = 'Bonjour {prenom}, rappel : vous avez rendez-vous demain {date} à {heure} '
  + 'avec {cip} à Solidarité Textiles. En cas d\'empêchement, prévenez-nous.';

/**
 * MESSAGE DE VÉRIFICATION envoyé au moment du recueil du consentement (M-05).
 *
 * Rien ne garantissait que le contact saisi appartienne à la personne : le
 * premier message qu'elle aurait dû recevoir partait chez un inconnu, et
 * personne ne pouvait le savoir. Ce message part PENDANT l'entretien, de sorte
 * que la conseillère puisse demander « vous l'avez reçu ? » tant que la
 * personne est devant elle. Il ne nomme personne et ne dit rien du parcours.
 */
const CATEGORIE_VERIFICATION = 'insertion_rappel_verification';
const VERIFICATION_SMS_BODY = 'Solidarité Textiles : ce message confirme que vous recevrez un rappel '
  + 'la veille de vos rendez-vous. Vous pouvez arrêter quand vous voulez, dites-le à votre conseillère.';
const VERIFICATION_EMAIL_SUBJECT = 'Confirmation : rappels de vos rendez-vous';
const VERIFICATION_EMAIL_BODY = VERIFICATION_SMS_BODY;

async function run(client) {
  // ── (a) Consentement aux rappels de rendez-vous ──────────────────────────
  //
  // `rappel_rdv_consent` est NULLABLE À DESSEIN : trois états, et la distinction
  // porte. NULL = la question n'a jamais été posée ; false = la personne a
  // refusé (ou a retiré son accord) ; true = elle a accepté. Un défaut `false`
  // ferait passer « pas encore demandé » pour un refus, et personne ne penserait
  // plus à poser la question.
  await client.query(`
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_consent BOOLEAN;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_canal VARCHAR(5);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_destinataire VARCHAR(255);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_consent_at TIMESTAMP;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_consent_by INTEGER REFERENCES users(id);
  `);

  // CHECK par DO-scan (pattern du dépôt) : `ADD CONSTRAINT` n'accepte pas
  // `IF NOT EXISTS`, une seconde exécution échouerait en 42710.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'employees'::regclass AND conname = 'employees_rappel_rdv_canal_check'
      ) THEN
        ALTER TABLE employees ADD CONSTRAINT employees_rappel_rdv_canal_check
          CHECK (rappel_rdv_canal IS NULL OR rappel_rdv_canal IN (${CANAUX_RAPPEL.map((c) => `'${c}'`).join(', ')}));
      END IF;
    END $$;
  `);

  // ── (b) Documents composés pour la personne ──────────────────────────────
  //
  // `contenu` est un SNAPSHOT, pas une vue : ce qui a été remis reste ce qui a
  // été remis. `parcours_num` parce qu'une personne peut revenir en parcours —
  // le récapitulatif du premier ne raconte pas le second.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_documents_salarie (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      parcours_num INTEGER NOT NULL DEFAULT 1,
      type VARCHAR(20) NOT NULL CHECK (type IN (${TYPES_DOCUMENT_SALARIE.map((t) => `'${t}'`).join(', ')})),
      contenu JSONB NOT NULL,
      genere_par INTEGER REFERENCES users(id),
      genere_le TIMESTAMP NOT NULL DEFAULT NOW(),
      remis_le DATE,
      remis_mode VARCHAR(15) CHECK (remis_mode IS NULL OR remis_mode IN (${MODES_REMISE_SALARIE.map((m) => `'${m}'`).join(', ')})),
      remis_par INTEGER REFERENCES users(id)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_documents_salarie_emp ON insertion_documents_salarie(employee_id, type, genere_le DESC);');

  // ── (c) Trace des rappels envoyés ────────────────────────────────────────
  //
  // `destinataire_masque` et non le contact : la trace prouve qu'un message est
  // parti et vers quel canal, elle ne constitue pas un second répertoire.
  // `UNIQUE(milestone_id)` : un entretien, un rappel au plus. C'est la
  // contrainte qui rend le job idempotent — deux ticks qui se chevauchent se
  // heurtent à un 23505 (« déjà envoyé »), là où un verrou applicatif laisserait
  // passer un doublon un jour de lenteur.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_rappels_rdv (
      id SERIAL PRIMARY KEY,
      milestone_id INTEGER NOT NULL REFERENCES insertion_milestones(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      canal VARCHAR(5) NOT NULL,
      destinataire_masque VARCHAR(60) NOT NULL,
      statut VARCHAR(10) NOT NULL CHECK (statut IN ('envoye','echec','dry_run')),
      erreur TEXT,
      envoye_le TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(milestone_id)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_insertion_rappels_rdv_emp ON insertion_rappels_rdv(employee_id, envoye_le DESC);');

  // ── (d) Gabarits Brevo ───────────────────────────────────────────────────
  //
  // Seedés inactifs ? Non : actifs. Le job ne peut rien envoyer sans
  // consentement individuel, et le gabarit n'a aucun effet tant qu'aucune
  // personne n'a accepté — le désactiver ajouterait une seconde condition à
  // vérifier le jour où un rappel ne part pas.
  await client.query(
    `INSERT INTO message_templates (name, type, category, subject, body, variables)
     SELECT 'Rappel rendez-vous salarié', 'sms', 'insertion_rappel_rdv', NULL, $1,
            ARRAY['date','heure','cip']
      WHERE NOT EXISTS (
        SELECT 1 FROM message_templates WHERE category = 'insertion_rappel_rdv' AND type = 'sms'
      )`,
    [RAPPEL_SMS_BODY]
  );
  await client.query(
    `INSERT INTO message_templates (name, type, category, subject, body, variables)
     SELECT 'Rappel rendez-vous salarié', 'email', 'insertion_rappel_rdv', $1, $2,
            ARRAY['date','heure','cip']
      WHERE NOT EXISTS (
        SELECT 1 FROM message_templates WHERE category = 'insertion_rappel_rdv' AND type = 'email'
      )`,
    [RAPPEL_EMAIL_SUBJECT, RAPPEL_EMAIL_BODY]
  );

  // Retrait du prénom sur un gabarit DÉJÀ SEEDÉ et JAMAIS MODIFIÉ : la
  // comparaison porte sur le texte d'origine mot pour mot, donc un gabarit
  // qu'un administrateur a retouché n'est jamais réécrit (M-05).
  await client.query(
    `UPDATE message_templates
        SET body = $1, variables = ARRAY['date','heure','cip']
      WHERE category = 'insertion_rappel_rdv' AND body = $2`,
    [RAPPEL_SMS_BODY, RAPPEL_SMS_BODY_V1]
  );

  // Gabarits du message de vérification (M-05).
  await client.query(
    // Casts explicites : le même paramètre sert de VALEUR insérée et de
    // critère de comparaison — sans eux, PostgreSQL refuse en 42P08
    // « inconsistent types deduced for parameter $1 » (le piège de 2.25.0).
    `INSERT INTO message_templates (name, type, category, subject, body, variables)
     SELECT 'Vérification du contact — rappels de rendez-vous', 'sms', $1::varchar, NULL, $2::text, ARRAY[]::text[]
      WHERE NOT EXISTS (SELECT 1 FROM message_templates WHERE category = $1::varchar AND type = 'sms')`,
    [CATEGORIE_VERIFICATION, VERIFICATION_SMS_BODY]
  );
  await client.query(
    `INSERT INTO message_templates (name, type, category, subject, body, variables)
     SELECT 'Vérification du contact — rappels de rendez-vous', 'email', $1::varchar, $2::varchar, $3::text, ARRAY[]::text[]
      WHERE NOT EXISTS (SELECT 1 FROM message_templates WHERE category = $1::varchar AND type = 'email')`,
    [CATEGORIE_VERIFICATION, VERIFICATION_EMAIL_SUBJECT, VERIFICATION_EMAIL_BODY]
  );

  // ── (e) Registre RGPD (art. 30) ──────────────────────────────────────────
  //
  // Entrée DISTINCTE de l'accompagnement socio-professionnel, parce que la base
  // légale l'est : ici, le CONSENTEMENT de la personne, et lui seul. Le
  // destinataire est un sous-traitant (Brevo), le contenu du message est
  // volontairement pauvre, et la durée de conservation est celle de la trace —
  // pas celle du dossier.
  const CATEGORIES_DONNEES_RAPPEL = "Prénom de la personne, date et heure du rendez-vous, prénom et initiale de la conseillère, "
    + "et le seul contact QU'ELLE A CHOISI pour être prévenue (numéro de téléphone mobile ou adresse e-mail). "
    + "Le message ne nomme JAMAIS le type de rendez-vous, son motif, ni aucun élément du parcours : un SMS arrive sur un "
    + "écran que d'autres personnes peuvent voir. La trace conservée après l'envoi ne porte que le canal utilisé et un "
    + "destinataire MASQUÉ (« 06 ** ** ** 12 »), jamais le contact en clair.";

  const MESURES_SECURITE_RAPPEL = "Consentement individuel recueilli par la conseillère, HORODATÉ et nominativement attribué, "
    + "révocable à tout moment d'un seul geste (le retrait est tracé au même titre que l'accord) ; aucun envoi possible sans "
    + "`rappel_rdv_consent = true` — la condition est dans la requête de sélection, pas dans un filtre d'affichage ; un seul "
    + "rappel par rendez-vous garanti par une contrainte d'unicité en base ; contenu du message composé depuis un gabarit "
    + "administré, sans aucune donnée de parcours ; journalisation RGPD de chaque recueil, de chaque retrait et de chaque "
    + "envoi ; accès au recueil du consentement et à l'historique réservé aux rôles ADMIN/RH avec double authentification ; "
    + "trace purgée automatiquement (purge `purgeRappelsRdv` du registre des purges) et supprimée à l'anonymisation du dossier.";

  await client.query(
    `INSERT INTO rgpd_registre
      (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
     SELECT
      'Insertion — rappels de rendez-vous au salarié (SMS / e-mail)',
      'Prévenir la personne accompagnée, la veille, qu''elle a un rendez-vous le lendemain, afin de réduire les rendez-vous manqués. Service rendu à la personne, à sa demande : aucun rappel n''est envoyé sans son accord, et le message ne dit jamais de quel rendez-vous il s''agit.',
      'Consentement de la personne concernée (art. 6-1-a du RGPD) — recueilli, horodaté et révocable à tout moment',
      'Salariés suivis au titre d''un parcours d''insertion — y compris après la sortie, pour le rendez-vous de suivi à +6 mois — ayant expressément accepté de recevoir ces rappels',
      $1,
      'La personne concernée elle-même. Sous-traitant technique d''acheminement : Brevo (envoi SMS et e-mail). En interne : ADMIN et RH uniquement.',
      'Trace de l''envoi (canal et destinataire masqué) : 365 jours par défaut, paramétrable (insertion.rappels_retention_jours) ; suppression intégrale à l''anonymisation du dossier du salarié. Le contenu des messages n''est jamais conservé.',
      $2
     WHERE NOT EXISTS (
      SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Insertion — rappels de rendez-vous au salarié%'
     )`,
    [CATEGORIES_DONNEES_RAPPEL, MESURES_SECURITE_RAPPEL]
  );

  // Alignement du libellé du registre sur ce que le code fait réellement
  // (correctif m-06) : la version d'origine disait « en parcours » alors que le
  // recueil est ouvert aux parcours terminés (relevé à +6 mois). Mise à jour
  // NON DESTRUCTIVE : seule la phrase d'origine, mot pour mot, est remplacée.
  await client.query(
    `UPDATE rgpd_registre
        SET categories_personnes = $1
      WHERE nom_traitement ILIKE 'Insertion — rappels de rendez-vous au salarié%'
        AND categories_personnes = $2`,
    ['Salariés suivis au titre d\'un parcours d\'insertion — y compris après la sortie, pour le rendez-vous de suivi à +6 mois — ayant expressément accepté de recevoir ces rappels',
      'Salariés en parcours d\'insertion ayant expressément accepté de recevoir ces rappels']
  );

  console.log('[INIT-DB] Migration « Le salarié — documents et rappels de rendez-vous » (PR C lot 7) ✓');
}

module.exports = {
  run,
  CANAUX_RAPPEL,
  TYPES_DOCUMENT_SALARIE,
  MODES_REMISE_SALARIE,
  RAPPEL_SMS_BODY,
  RAPPEL_EMAIL_SUBJECT,
  RAPPEL_EMAIL_BODY,
  CATEGORIE_VERIFICATION,
  VERIFICATION_SMS_BODY,
  VERIFICATION_EMAIL_SUBJECT,
  VERIFICATION_EMAIL_BODY,
};
