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

  // ── (c) Registre des traitements, article 30 (correctif m-09) ─────────────
  //
  // La feuille de temps traite des données du PERSONNEL — temps de travail
  // quotidien, jours d'absence de l'intervenant, signatures nominatives — et
  // elle est TRANSMISE à l'autorité de gestion comme pièce de justification
  // d'une dépense cofinancée. Deux raisons d'avoir sa propre entrée plutôt que
  // d'être rangée sous l'accompagnement : la finalité est le contrôle de
  // service fait (pas l'accompagnement), et le destinataire est extérieur.
  //
  // La durée de conservation suit la PISTE D'AUDIT du FSE+ et non la rétention
  // des dossiers d'insertion : une pièce de financement se conserve tant que
  // l'autorité peut la contrôler. C'est pourquoi l'anonymisation d'un salarié
  // vide l'`employee_id` du JSONB sans supprimer la feuille (contrat § 8).
  //
  // Le NOM DU SIGNATAIRE est figé dans la pièce et n'est pas anonymisé : il est
  // NÉCESSAIRE à sa valeur probante (une feuille sans signataire ne justifie
  // rien). C'est un choix, il est écrit ici plutôt que subi (constat m-11).
  await client.query(
    `INSERT INTO rgpd_registre
      (nom_traitement, finalite, base_legale, categories_personnes, categories_donnees, destinataires, duree_conservation, mesures_securite)
     SELECT
      'Justification du temps d''accompagnement cofinancé (feuilles de temps)',
      'Composition, signature et transmission des feuilles de temps mensuelles des intervenants (CIP, encadrants) affectés à une opération cofinancée : justification du service fait auprès de l''autorité de gestion (bilans d''exécution FSE+, contrôles de service fait, options de coûts simplifiés).',
      'Obligation légale et conventionnelle (règlement (UE) 2021/1060, conventions de cofinancement FSE+ et conventionnement IAE)',
      'Personnel de la structure affecté à une opération cofinancée (conseillères en insertion professionnelle, encadrants techniques, personnel d''appui)',
      'Identité de l''intervenant (nom, prénom, identifiant interne), date et durée de chaque temps d''accompagnement, opération de rattachement, quotité d''affectation, jours d''absence signalés en anomalie de cohérence SANS leur motif ni leur catégorie, horodatage et identité des deux signataires. AUCUN nom de bénéficiaire : les lignes ne portent que l''identifiant interne du salarié accompagné.',
      'Autorité de gestion FSE+ et service instructeur (DDETS), organismes de contrôle et d''audit, commissaire aux comptes. En interne : ADMIN et RH ; l''intervenant lui-même pour sa propre feuille.',
      'Cinq ans après la clôture de l''opération cofinancée (piste d''audit). La feuille survit à l''anonymisation du dossier d''un salarié accompagné : seul le lien nominatif vers lui disparaît (identifiants remplacés par NULL dans le détail), la pièce de financement reste justifiable.',
      'Périmètre serveur : ADMIN/RH sur tout, un intervenant uniquement sur sa propre feuille (comparaison numérique posée avant toute requête). Feuille FIGÉE au moment de la signature (snapshot des lignes, totaux et cohérence) : un fait ajouté ou corrigé après coup ne déplace plus un total signé. Double signature obligatoire, auto-validation refusée, réouverture réservée à un administrateur avec motif journalisé. Exports CSV et PDF journalisés au registre RGPD AVANT envoi, leur échec faisant échouer l''acte ; neutralisation des formules dans le CSV ; refus explicite d''un export sans aucune ligne.'
     WHERE NOT EXISTS (
      SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Justification du temps d''accompagnement cofinancé%'
     )`
  );

  console.log('[INIT-DB] Migration PR B lot 4 (temps d’accompagnement : saisies, feuilles de temps) ✓');
}

module.exports = { run, ACTIVITES_SAISIES, STATUTS_FEUILLE };
