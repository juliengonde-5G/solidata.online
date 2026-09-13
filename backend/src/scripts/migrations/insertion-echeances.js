/**
 * Migration PR C — lot 5 « Section CIP »
 * (contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md § 3.1).
 *
 * Ce qu'elle pose, et pourquoi :
 *
 *  - LE JETON DE L'ÉCRAN ETI (`insertion_milestones.eti_token` + son échéance
 *    + qui l'a produit). L'écran de renouvellement de l'encadrant technique
 *    existait déjà, mais derrière `/insertion/renouvellement/:milestoneId`,
 *    c'est-à-dire derrière un COMPTE : la CIP « copiait le lien » vers un écran
 *    que son destinataire ne pouvait pas ouvrir sans être connecté, et
 *    l'identifiant d'entretien y était énumérable. Un jeton hex 32 (espace
 *    2¹²⁸) rend le lien autoporteur, borné dans le temps, et RÉVOCABLE — le
 *    remplacer tue l'ancien, c'est le seul mode de révocation dont on ait
 *    besoin. L'index UNIQUE est PARTIEL (`WHERE eti_token IS NOT NULL`) : sans
 *    cela, les dizaines de milliers d'entretiens sans jeton entreraient en
 *    collision sur la valeur NULL dans certains moteurs, et l'index pèserait
 *    pour rien dans PostgreSQL.
 *
 *  - LE REPORT D'UNE OBLIGATION (`insertion_echeance_reports`). Les lignes du
 *    bloc « À traiter cette semaine » ne sont PAS acquittables sept jours comme
 *    les alertes de fiche : ce sont celles que l'autorité contrôle (sortie
 *    FSE+, Pass IAE, plafond CDDI, référent unique…). On ne peut donc que les
 *    REPORTER de 48 h, et le report LAISSE UNE LIGNE — une par report, jamais
 *    un compteur écrasé : c'est le NOMBRE de reports qui dit qu'un dossier
 *    tourne en rond, et c'est pour cela que le motif devient obligatoire à
 *    partir du deuxième (contrat § 5.1.3). `motif` reste donc NULLABLE : le
 *    premier report n'en exige pas, et un défaut 'autre' rendrait le compteur
 *    de motifs muet sur la différence entre « pas demandé » et « pas su ».
 *
 * Aucune entrée au registre art. 30 : les traitements existants couvrent (le
 * lien ETI est un MODE D'ACCÈS au traitement « accompagnement socio-
 * professionnel », pas un traitement de plus ; le report est une note de
 * gestion interne). Les quatre codes d'audit de la PR C sont, eux, déclarés
 * dans `frontend/src/utils/rgpd-libelles.js` (garde anti-dérive Jest).
 *
 * Contrat d'exécution : `run(client)` est appelé par `init-db.js` DANS sa
 * transaction. Donc `client.query` uniquement, aucun BEGIN/COMMIT interne, et
 * chaque instruction rejouable (IF NOT EXISTS, DO-scan de `pg_constraint`).
 */

'use strict';

/**
 * Motifs de report — liste FERMÉE de codes, obligatoire à partir du 2e report.
 * Vit ici plutôt que dans la route parce que c'est la BASE qui la garantit : un
 * motif accepté par le validateur applicatif mais refusé par le CHECK
 * produirait un 23514 au moment du clic, c'est-à-dire un report perdu.
 * Aucun de ces codes ne dit une nature médicale ni judiciaire : `personne_absente`
 * énonce un fait d'organisation, pas une raison.
 */
const MOTIFS_REPORT = ['attente_piece', 'attente_referent', 'personne_absente', 'rdv_planifie', 'autre'];

async function run(client) {
  // ── 1. Jeton public de l'écran ETI ──────────────────────────────────────
  await client.query('ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS eti_token VARCHAR(32)');
  await client.query('ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS eti_token_expires_at TIMESTAMP');
  await client.query('ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS eti_token_generated_by INTEGER REFERENCES users(id)');
  // UNIQUE PARTIEL : seuls les entretiens qui PORTENT un jeton entrent dans
  // l'index. La collision d'unicité doit exister pour les jetons, jamais pour
  // l'absence de jeton.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_insertion_milestones_eti_token
      ON insertion_milestones(eti_token) WHERE eti_token IS NOT NULL`);

  // ── 2. Reports d'obligation (48 h) ──────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_echeance_reports (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      echeance_type VARCHAR(40) NOT NULL,
      reporte_jusqu_au TIMESTAMP NOT NULL,
      motif VARCHAR(30),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_insertion_echeance_reports_emp
      ON insertion_echeance_reports(employee_id, echeance_type, reporte_jusqu_au DESC)`);

  // CHECK du motif posé APRÈS coup (la table peut préexister d'un déploiement
  // antérieur de cette même migration) : `ADD CONSTRAINT` n'accepte pas
  // IF NOT EXISTS, la seule façon de le rejouer est d'interroger pg_constraint.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         -- conrelid ajouté (correctif m-03) : sans lui, un homonyme sur une
         -- AUTRE table ferait croire la contrainte posée et le CHECK ne serait
         -- jamais créé. La migration jumelle du même lot le faisait déjà.
         WHERE conrelid = 'insertion_echeance_reports'::regclass
           AND conname = 'chk_insertion_echeance_reports_motif'
      ) THEN
        ALTER TABLE insertion_echeance_reports
          ADD CONSTRAINT chk_insertion_echeance_reports_motif
          CHECK (motif IS NULL OR motif IN (${MOTIFS_REPORT.map((m) => `'${m}'`).join(', ')}));
      END IF;
    END $$`);

  // `reporte_jusqu_au` désigne un INSTANT (« cette obligation ressort dans
  // 48 h »), pas un jour civil. Écrit en `TIMESTAMP WITHOUT TIME ZONE` par
  // `NOW() + make_interval`, il était stocké en heure du SERVEUR et relu dans
  // le fuseau du PROCESSUS : hors UTC, l'échéance affichée reculait de deux
  // heures (défaut D-05). La comparaison SQL restait juste — c'est l'affichage
  // qui mentait. Conversion idempotente, et les lignes déjà écrites sont
  // interprétées en UTC, qui est le fuseau du serveur qui les a produites.
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'insertion_echeance_reports'
           AND column_name = 'reporte_jusqu_au' AND data_type = 'timestamp without time zone'
      ) THEN
        ALTER TABLE insertion_echeance_reports
          ALTER COLUMN reporte_jusqu_au TYPE TIMESTAMPTZ USING reporte_jusqu_au AT TIME ZONE 'UTC';
      END IF;
    END $$`);

  console.log('[MIGRATION] insertion-echeances : jeton ETI + reports d\'obligation OK');
}

module.exports = { run, MOTIFS_REPORT };
