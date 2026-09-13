/**
 * Migration idempotente — PR B « Cadre RSA et temps d'accompagnement »,
 * LOT 4 « Temps d'accompagnement ».
 *
 * Appelée par init-db.js DANS sa transaction, après `insertion-rsa`.
 * `client.query` uniquement, aucun BEGIN / COMMIT : la transaction appartient
 * à l'appelant.
 *
 * CE QU'ELLE POSE, ET POURQUOI.
 *
 *  - `insertion_temps_saisies` : le temps d'accompagnement qui ne passe par
 *    AUCUN salarié nommé — un atelier collectif, une réunion de projet. La
 *    feuille de temps se compose sinon des seuls entretiens et actions
 *    individuels, et l'intervenant y apparaîtrait à mi-temps alors qu'il a
 *    travaillé la journée entière. Sans cette table, l'export (c) ne se
 *    raccorde pas au plan de financement (09 § 2 (c)).
 *    `employee_id` est VOLONTAIREMENT absent : ces activités n'en ont pas.
 *
 *  - `insertion_feuilles_temps` : la feuille se COMPOSE à la lecture (elle
 *    dérive des entretiens, des actions et des saisies) et se FIGE à la
 *    validation de l'intervenant. Les deux comportements sont nécessaires et
 *    ils s'excluent : tant que la feuille est ouverte, corriger la durée d'un
 *    entretien doit se voir dans la feuille ; une fois signée, elle est une
 *    PIÈCE DE FINANCEMENT — ce que l'intervenant a signé ne peut plus changer
 *    parce qu'on a retouché un entretien deux mois plus tard. D'où le snapshot
 *    `lignes`/`totaux`/`coherence`, NULL tant que le statut vaut 'brouillon'.
 *
 *  - Aucune donnée nominative de salarié dans `lignes` au-delà de
 *    l'identifiant interne (09 § 2 (c) : « jamais le nom en clair dans la
 *    version transmise »). Le nom n'est donc pas figé ici : il n'y entre pas.
 *
 * Anonymisation : le retrait des `employee_id` du JSONB `lignes` (la feuille
 * survit ≥ 5 ans au titre de la piste d'audit, le lien nominatif non) est
 * porté par `services/anonymization.js` — lot 3, contrat 15 § 8.
 */

/** Activités saisissables à la main (les autres lignes sont COMPOSÉES). */
const ACTIVITES_SAISIES = ['atelier_collectif', 'reunion_projet', 'autre'];

/** Statuts de la feuille — transition FORWARD-ONLY, cf. routes/insertion/temps.js. */
const STATUTS_FEUILLE = ['brouillon', 'validee_intervenant', 'validee_rh'];

async function run(client) {
  // ── (a) Temps hors salarié, saisi par l'intervenant ───────────────────────
  // `duree_minutes > 0` : une ligne de zéro minute n'est pas une donnée, c'est
  // une ligne à supprimer. Plafond 600 min (10 h) : au-delà, c'est une erreur
  // de saisie, et une erreur de saisie sur une pièce de financement se paie au
  // contrôle de service fait.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_temps_saisies (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      projet_id INTEGER REFERENCES insertion_projets(id) ON DELETE SET NULL,
      activite VARCHAR(20) NOT NULL CHECK (activite IN (${ACTIVITES_SAISIES.map((a) => `'${a}'`).join(', ')})),
      duree_minutes SMALLINT NOT NULL CHECK (duree_minutes > 0 AND duree_minutes <= 600),
      libelle VARCHAR(200),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_temps_saisies_user_date ON insertion_temps_saisies(user_id, date);');

  // ── (b) Feuille de temps mensuelle ────────────────────────────────────────
  // UNIQUE(user_id, annee, mois) : une feuille par intervenant et par mois.
  // C'est la clé de l'upsert de validation — deux feuilles concurrentes pour
  // le même mois produiraient deux totaux, donc deux dépenses justifiées.
  await client.query(`
    CREATE TABLE IF NOT EXISTS insertion_feuilles_temps (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      annee SMALLINT NOT NULL,
      mois SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
      statut VARCHAR(22) NOT NULL DEFAULT 'brouillon' CHECK (statut IN (${STATUTS_FEUILLE.map((s) => `'${s}'`).join(', ')})),
      lignes JSONB,
      totaux JSONB,
      coherence JSONB,
      validation_intervenant JSONB,
      validation_rh JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, annee, mois)
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_feuilles_temps_periode ON insertion_feuilles_temps(annee, mois);');

  console.log('[INIT-DB] Migration PR B lot 4 (temps d’accompagnement : saisies, feuilles de temps) ✓');
}

module.exports = { run, ACTIVITES_SAISIES, STATUTS_FEUILLE };
