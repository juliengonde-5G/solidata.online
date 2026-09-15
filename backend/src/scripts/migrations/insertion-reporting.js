/**
 * Migration PR D — lot 6 « Reporting autorité »
 * (contrat : rapports/cip-refonte-2026-09-12/25-contrats-techniques-PR-D.md § 3).
 *
 * ═══ CE QU'ELLE POSE, ET POURQUOI ═════════════════════════════════════════
 *
 *  1. LE DÉBOUCHÉ D'UNE IMMERSION (`insertion_pmsmp.debouche`). L'autorité
 *     demande depuis son rapport 06 la ligne « PMSMP ayant donné lieu à une
 *     embauche chez l'accueillant » (S7) — « c'est la phrase qui justifie un
 *     financement ». L'outil connaissait les conventions et les jours ; il ne
 *     savait pas ce qu'elles étaient devenues. `embauche_accueillant` est un
 *     BOOLÉEN NULLABLE et non un défaut `false` : « on ne sait pas encore »
 *     n'est pas « non », et une immersion close la semaine dernière n'a pas
 *     encore de réponse.
 *
 *  2. L'ORIENTATION DORA ET L'AIDE MOBILISÉE sur une action CIP
 *     (`cip_action_plans.dora_*`, `aide_*`). Le Département finance des aides
 *     (mobilité, garde d'enfants, aide financière d'urgence) et demande ce
 *     qu'elles produisent (C5) ; DORA est l'annuaire par lequel la conseillère
 *     oriente vers un service de levée de frein, et l'autorité veut le RÉSULTAT
 *     de l'orientation, pas seulement le fait qu'elle ait eu lieu (P2).
 *     `aide_montant` est NULLABLE : une aide non chiffrée reste non chiffrée,
 *     elle ne vaut pas zéro euro — un total qui additionnerait des zéros
 *     inventés serait faux dans le sens qui dessert la structure.
 *
 *  3. LA CATÉGORIE D'ACTION « formation linguistique (FLE) » (amendement S5).
 *     La PR A a déjà élargi le CHECK à `job_dating` et `formation` ; il manquait
 *     la valeur qui permet de COMPTER les actions FLE séparément d'une
 *     formation qualifiante — c'est l'indicateur que l'autorité regarde sur un
 *     public dont le frein linguistique est le premier axe.
 *
 *  4. LE SNAPSHOT DES SYNTHÈSES GÉNÉRÉES (`insertion_dialogues_gestion`). Même
 *     doctrine que les fiches transmises au référent (PR B) et les documents du
 *     salarié (PR C) : « qu'avons-nous transmis le 15 janvier ? » n'a de
 *     réponse que si on l'a écrite, puisque le dossier a changé depuis. Le
 *     contenu est AGRÉGÉ et non nominatif — d'où l'absence d'entrée nouvelle au
 *     registre art. 30 et le fait que l'anonymisation d'un salarié n'a rien à y
 *     purger : aucune ligne de cette table ne désigne personne.
 *
 * Contrat d'exécution : `run(client)` est appelé par `init-db.js` DANS sa
 * transaction. Donc `client.query` uniquement, aucun BEGIN/COMMIT interne, et
 * chaque instruction rejouable (IF NOT EXISTS, DO-scan de `pg_constraint`,
 * seeds gardés par ON CONFLICT / NOT EXISTS).
 */

'use strict';

/** Débouchés d'une immersion — liste fermée (miroir du CHECK et du front). */
const PMSMP_DEBOUCHES = [
  'embauche_accueillant', 'embauche_autre', 'formation', 'poursuite_parcours', 'aucun', 'inconnu',
];

/** Résultat d'une orientation DORA — liste fermée. */
const DORA_RESULTATS = ['oriente', 'pris_en_charge', 'refuse', 'sans_suite'];

/** Nature d'une aide mobilisée — liste fermée (contrat § 5.6). */
const AIDE_NATURES = [
  'mobilite', 'logement', 'sante', 'numerique', 'garde_enfants',
  'formation', 'administrative', 'financiere_urgence', 'autre',
];

/**
 * Catégories d'action après cette migration. Les six premières viennent de la
 * PR A (`insertion-cadre.js` § 7) : elles sont REPRISES telles quelles, les
 * perdre invaliderait toutes les lignes déjà saisies.
 */
const ACTION_CATEGORIES = [
  'competence', 'insertion', 'socialisation', 'frein', 'job_dating', 'formation', 'formation_fle',
];

/** Liste en littéraux SQL, pour composer un CHECK lisible. */
const sqlList = (vals) => vals.map((v) => `'${v}'`).join(',');

async function run(client) {
  // ── 1. Débouché des PMSMP (S1 / S7) ──────────────────────────────────────
  await client.query(`
    ALTER TABLE insertion_pmsmp ADD COLUMN IF NOT EXISTS debouche VARCHAR(25);
    ALTER TABLE insertion_pmsmp ADD COLUMN IF NOT EXISTS debouche_date DATE;
    ALTER TABLE insertion_pmsmp ADD COLUMN IF NOT EXISTS embauche_accueillant BOOLEAN;
  `);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_pmsmp'::regclass AND conname = 'insertion_pmsmp_debouche_check'
      ) THEN
        ALTER TABLE insertion_pmsmp ADD CONSTRAINT insertion_pmsmp_debouche_check
          CHECK (debouche IS NULL OR debouche IN (${sqlList(PMSMP_DEBOUCHES)}));
      END IF;
    END $$;
  `);

  // ── 2. Orientation DORA et aide mobilisée sur une action CIP (P2 / C5) ───
  await client.query(`
    ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS dora_service VARCHAR(150);
    ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS dora_url TEXT;
    ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS dora_resultat VARCHAR(20);
    ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS aide_nature VARCHAR(40);
    ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS aide_organisme VARCHAR(150);
    ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS aide_montant NUMERIC(9,2);
  `);
  const checksAction = [
    ['cip_action_plans_dora_resultat_check',
      `dora_resultat IS NULL OR dora_resultat IN (${sqlList(DORA_RESULTATS)})`],
    ['cip_action_plans_aide_nature_check',
      `aide_nature IS NULL OR aide_nature IN (${sqlList(AIDE_NATURES)})`],
    // Un montant NÉGATIF n'a aucun sens ici et fausserait un total transmis au
    // Département. Zéro reste accepté (une aide instruite puis ramenée à zéro
    // se saisit telle quelle) ; c'est l'ABSENCE qui s'écrit NULL.
    ['cip_action_plans_aide_montant_check', 'aide_montant IS NULL OR aide_montant >= 0'],
  ];
  for (const [nom, expr] of checksAction) {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'cip_action_plans'::regclass AND conname = '${nom}'
        ) THEN
          ALTER TABLE cip_action_plans ADD CONSTRAINT ${nom} CHECK (${expr});
        END IF;
      END $$;
    `);
  }

  // ── 3. Catégorie d'action « formation FLE » (amendement S5) ──────────────
  //
  // Le CHECK est RECONSTRUIT (DROP puis ADD) et non complété : PostgreSQL ne
  // sait pas « étendre » une contrainte. Idempotent par relecture de
  // `pg_get_constraintdef` — on ne reconstruit que si la définition ne couvre
  // pas déjà `formation_fle`, donc rejouer ne verrouille pas la table pour rien.
  await client.query(`
    DO $$
    DECLARE def TEXT;
    BEGIN
      SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
       WHERE conrelid = 'cip_action_plans'::regclass
         AND conname = 'cip_action_plans_category_check';
      IF def IS NULL OR def NOT LIKE '%formation_fle%' THEN
        IF def IS NOT NULL THEN
          ALTER TABLE cip_action_plans DROP CONSTRAINT cip_action_plans_category_check;
        END IF;
        ALTER TABLE cip_action_plans ADD CONSTRAINT cip_action_plans_category_check
          CHECK (category IN (${sqlList(ACTION_CATEGORIES)}));
      END IF;
    END $$;
  `);

  // ── 4. Référentiel partenaires : le CMS du Département ───────────────────
  //
  // ÉCART ASSUMÉ AU CONTRAT § 3 : la PR A (`insertion-cadre.js` § 8) seede DÉJÀ
  // « Centre médico-social (CMS) — Département 76 ». Ajouter une seconde ligne
  // « CMS (Département 76) » mettrait DEUX CMS dans le référentiel de la
  // conseillère et éclaterait les statistiques par partenaire entre les deux —
  // exactement ce que l'amendement A5 cherche à éviter. Le seed est donc
  // conservé et seule sa CATÉGORIE est normalisée vers `cms`, et uniquement si
  // elle porte encore la valeur posée par le seed (`social`) : un partenaire
  // recatégorisé à la main n'est jamais réécrit.
  await client.query(`
    INSERT INTO insertion_partenaires (nom, categorie)
    VALUES ('Centre médico-social (CMS) — Département 76', 'cms')
    ON CONFLICT (nom) DO NOTHING;
  `);
  await client.query(`
    UPDATE insertion_partenaires SET categorie = 'cms'
     WHERE nom = 'Centre médico-social (CMS) — Département 76' AND categorie = 'social';
  `);

  // ── 5. Snapshot des synthèses de dialogue de gestion générées ────────────
  //
  // `contenu` est un SNAPSHOT, pas une vue : ce qui a été transmis reste ce qui
  // a été transmis. `trimestre` NULL = version annuelle complète ; 1-4 = version
  // trimestrielle allégée (blocs 2 et 8 seulement, ceux que l'autorité relit
  // quatre fois par an). Aucune donnée nominative : le document est agrégé, d'où
  // l'absence d'entrée nouvelle au registre art. 30 et le fait que
  // l'anonymisation d'un salarié n'a rien à y purger.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_dialogues_gestion (
      id SERIAL PRIMARY KEY,
      annee INTEGER NOT NULL,
      trimestre SMALLINT,
      contenu JSONB NOT NULL,
      genere_par INTEGER REFERENCES users(id),
      genere_le TIMESTAMP NOT NULL DEFAULT NOW(),
      version_application VARCHAR(20)
    );
  `);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'insertion_dialogues_gestion'::regclass
          AND conname = 'insertion_dialogues_gestion_trimestre_check'
      ) THEN
        ALTER TABLE insertion_dialogues_gestion ADD CONSTRAINT insertion_dialogues_gestion_trimestre_check
          CHECK (trimestre IS NULL OR trimestre BETWEEN 1 AND 4);
      END IF;
    END $$;
  `);
  await client.query(
    'CREATE INDEX IF NOT EXISTS idx_insertion_dialogues_gestion_periode '
    + 'ON insertion_dialogues_gestion(annee, trimestre, genere_le DESC);'
  );
}

module.exports = {
  run,
  PMSMP_DEBOUCHES,
  DORA_RESULTATS,
  AIDE_NATURES,
  ACTION_CATEGORIES,
};
