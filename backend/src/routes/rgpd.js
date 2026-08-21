const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { anonymizeCandidate, anonymizeEmployee } = require('../services/anonymization');

router.use(authenticate);

// ══════════════════════════════════════════
// REGISTRE DES TRAITEMENTS (Article 30 RGPD)
// ══════════════════════════════════════════

// GET /api/rgpd/registre — Registre des traitements de données
router.get('/registre', authorize('ADMIN', 'DPO'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rgpd_registre ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('[RGPD] Erreur registre :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rgpd/registre — Ajouter un traitement
router.post('/registre', authorize('ADMIN', 'DPO'), [
  body('nom_traitement').notEmpty().withMessage('Nom du traitement requis'),
  body('finalite').notEmpty().withMessage('Finalité requise'),
  body('base_legale').notEmpty().withMessage('Base légale requise'),
], validate, async (req, res) => {
  try {
    const { nom_traitement, finalite, base_legale, categories_personnes, categories_donnees,
      destinataires, duree_conservation, mesures_securite } = req.body;
    if (!nom_traitement || !finalite || !base_legale) {
      return res.status(400).json({ error: 'Nom, finalité et base légale requis' });
    }
    const result = await pool.query(
      `INSERT INTO rgpd_registre (nom_traitement, finalite, base_legale, categories_personnes,
       categories_donnees, destinataires, duree_conservation, mesures_securite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [nom_traitement, finalite, base_legale, categories_personnes, categories_donnees,
       destinataires, duree_conservation, mesures_securite]
    );
    // Log audit
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'CREATE', 'registre', result.rows[0].id, JSON.stringify({ nom_traitement })]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[RGPD] Erreur ajout traitement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// DROIT D'ACCÈS (Article 15 RGPD)
// ══════════════════════════════════════════

// GET /api/rgpd/export/:type/:id — Exporter toutes les données d'une personne
router.get('/export/:type/:id', authorize('ADMIN', 'RH', 'DPO'), async (req, res) => {
  try {
    const { type, id } = req.params;
    let data = {};

    if (type === 'candidate') {
      const candidate = await pool.query('SELECT * FROM candidates WHERE id = $1', [id]);
      if (candidate.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
      data.candidate = candidate.rows[0];
      data.skills = (await pool.query('SELECT * FROM candidate_skills WHERE candidate_id = $1', [id])).rows;
      data.history = (await pool.query('SELECT * FROM candidate_history WHERE candidate_id = $1', [id])).rows;
      // Le schéma PCM réel est pcm_sessions/pcm_reports (pas de table pcm_profiles)
      data.pcm = (await pool.query('SELECT id, base_type, phase_type, created_at FROM pcm_reports WHERE candidate_id = $1', [id])).rows;
    } else if (type === 'employee') {
      const employee = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
      if (employee.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
      data.employee = employee.rows[0];
      data.contracts = (await pool.query('SELECT * FROM employee_contracts WHERE employee_id = $1', [id])).rows;
    } else {
      return res.status(400).json({ error: 'Type invalide (candidate ou employee)' });
    }

    // Log audit
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'EXPORT_DATA', type, parseInt(id), JSON.stringify({ requested_by: req.user.id })]
    );

    res.json({ type, id: parseInt(id), exported_at: new Date().toISOString(), data });
  } catch (err) {
    console.error('[RGPD] Erreur export :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// DROIT À L'EFFACEMENT (Article 17 RGPD)
// ══════════════════════════════════════════

// POST /api/rgpd/anonymize/:type/:id — Anonymiser les données personnelles
router.post('/anonymize/:type/:id', authorize('ADMIN', 'DPO'), [
  body('reason').notEmpty().withMessage('Motif d\'anonymisation requis'),
], validate, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Motif d\'anonymisation requis' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (type === 'candidate') {
        const candidate = await client.query('SELECT first_name, last_name FROM candidates WHERE id = $1', [id]);
        if (candidate.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Candidat non trouvé' }); }
        // Service mutualisé : couvre identité + verbatims + PCM/entretiens/
        // mises en situation/documents (même périmètre que la purge auto).
        await anonymizeCandidate(client, id);

      } else if (type === 'employee') {
        const employee = await client.query('SELECT first_name, last_name FROM employees WHERE id = $1', [id]);
        if (employee.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Employé non trouvé' }); }
        // Service mutualisé : identité + santé/RQTH + naissance + titres de
        // séjour + salaire + verbatims d'insertion (diagnostics/jalons/actions),
        // en préservant les agrégats non nominatifs (KPI, cohortes).
        await anonymizeEmployee(client, id);

      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Type invalide' });
      }

      // Log audit
      await client.query(
        'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'ANONYMIZE', type, parseInt(id), JSON.stringify({ reason })]
      );

      await client.query('COMMIT');
      res.json({ message: `Données ${type} #${id} anonymisées`, anonymized_at: new Date().toISOString() });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[RGPD] Erreur anonymisation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GESTION DU CONSENTEMENT
// ══════════════════════════════════════════

// GET /api/rgpd/consent/:type/:id — Voir les consentements
router.get('/consent/:type/:id', authorize('ADMIN', 'RH', 'DPO'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM rgpd_consents WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC',
      [req.params.type, req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[RGPD] Erreur consentements :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rgpd/consent — Enregistrer un consentement
router.post('/consent', authorize('ADMIN', 'RH', 'DPO'), [
  body('entity_type').notEmpty().withMessage('Type d\'entité requis'),
  body('entity_id').isInt().withMessage('ID entité requis'),
  body('consent_type').notEmpty().withMessage('Type de consentement requis'),
], validate, async (req, res) => {
  try {
    const { entity_type, entity_id, consent_type, granted, comment } = req.body;
    if (!entity_type || !entity_id || !consent_type) {
      return res.status(400).json({ error: 'entity_type, entity_id et consent_type requis' });
    }
    const result = await pool.query(
      `INSERT INTO rgpd_consents (entity_type, entity_id, consent_type, granted, comment, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entity_type, entity_id, consent_type) DO UPDATE
       SET granted = $4, comment = $5, recorded_by = $6, updated_at = NOW()
       RETURNING *`,
      [entity_type, entity_id, consent_type, granted !== false, comment, req.user.id]
    );
    // Log
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, granted !== false ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED', entity_type, entity_id,
       JSON.stringify({ consent_type })]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[RGPD] Erreur consentement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// JOURNAL D'AUDIT
// ══════════════════════════════════════════

// GET /api/rgpd/audit — Journal des actions RGPD
router.get('/audit', authorize('ADMIN', 'DPO'), async (req, res) => {
  try {
    const { limit: lim, offset: off, action, entity_type } = req.query;
    let query = `SELECT a.*, u.first_name, u.last_name FROM rgpd_audit_log a
      LEFT JOIN users u ON a.user_id = u.id WHERE 1=1`;
    const params = [];
    if (action) { params.push(action); query += ` AND a.action = $${params.length}`; }
    if (entity_type) { params.push(entity_type); query += ` AND a.entity_type = $${params.length}`; }
    query += ' ORDER BY a.created_at DESC';
    params.push(parseInt(lim) || 50);
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(off) || 0);
    query += ` OFFSET $${params.length}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[RGPD] Erreur audit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// RAPPEL CODIFIÉ DES RÈGLES DE GESTION (Lot 5)
// ══════════════════════════════════════════

// GET /api/rgpd/politique — rappel, à destination des utilisateurs de l'écran
// RGPD, des règles de gestion des données personnelles RÉELLEMENT appliquées
// par le code (conservation/anonymisation, suppression/purge, chiffrement/
// masquage, droits des personnes, journalisation/traçabilité, sous-traitance
// IA). AUCUNE règle inventée : chaque entrée référence le fichier qui
// l'implémente réellement. Les valeurs paramétrables (table `settings`) sont
// lues en direct avec repli sur le défaut du code (même mécanisme que
// readInsertionSetting) — jamais une valeur figée qui divergerait du réglage
// effectif. Mêmes gardes que /registre et /audit (page RGPD = ADMIN/DPO).
router.get('/politique', authorize('ADMIN', 'DPO'), async (req, res) => {
  try {
    const { readInsertionSetting } = require('../utils/insertion-settings');
    const retentionInsertionMois = await readInsertionSetting('insertion.retention_months');

    let registreCount = null;
    try {
      const r = await pool.query('SELECT COUNT(*)::int AS c FROM rgpd_registre');
      registreCount = r.rows[0]?.c ?? null;
    } catch (_) { /* table absente sur une base ancienne : compteur omis */ }

    const categories = [
      {
        key: 'conservation',
        label: 'Conservation & anonymisation',
        description: 'Durées de conservation des données personnelles avant anonymisation automatique.',
        regles: [
          {
            titre: 'Candidatures non recrutées',
            description: "Un candidat dont le statut n'est pas « recruté » est anonymisé (identité, CV, notes d'entretien, PCM, mises en situation, documents) 24 mois après sa dernière mise à jour (déclenchement manuel depuis cet écran) ou sa date de création (job planifié quotidien) — même délai, colonne de référence différente selon le déclencheur.",
            valeur: '24 mois',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js (POST /purge-expired), backend/src/services/scheduler.js (purgeExpiredCandidates)',
          },
          {
            titre: "Dossiers d'insertion clos",
            description: "Le dossier d'un salarié dont le parcours d'insertion est terminé ou abandonné (fiche devenue inactive) est anonymisé automatiquement une fois ce délai écoulé après la fin du parcours (insertion_end_date). Les agrégats non nominatifs (scores de freins, classification de sortie, dates, heures) sont conservés pour le pilotage.",
            valeur: `${retentionInsertionMois} mois`,
            source: 'insertion.retention_months',
            reference: 'backend/src/services/scheduler.js (purgeInsertionDossiers), backend/src/utils/insertion-settings.js',
          },
          {
            titre: 'Données FSE+ (entrée/sortie)',
            description: "Les données FSE+ (fse_entree/fse_sortie, JSONB des jalons/diagnostics) constituent une piste d'audit du financement européen : elles sont VOLONTAIREMENT exclues de l'anonymisation du dossier d'insertion ci-dessus et conservées séparément au-delà.",
            valeur: '≥ 5 ans après le dernier paiement',
            source: 'code',
            reference: 'backend/src/services/anonymization.js (anonymizeEmployee), registre RGPD (backend/src/scripts/init-db.js)',
          },
          {
            titre: 'Positions GPS des véhicules',
            description: "Les relevés de géolocalisation des tournées de collecte sont supprimés DÉFINITIVEMENT (DELETE, pas d'anonymisation — aucune donnée exploitable à conserver) après ce délai.",
            valeur: '90 jours',
            source: 'code',
            reference: 'backend/src/services/scheduler.js (purgeOldGpsPositions)',
          },
        ],
      },
      {
        key: 'suppression',
        label: 'Suppression & purge',
        description: 'Mécanismes effectifs de suppression, de purge planifiée et de révocation.',
        regles: [
          {
            titre: 'Purge automatique quotidienne',
            description: "4 jobs planifiés tournent chaque jour et couvrent le MÊME périmètre que les actions manuelles de cet écran : anonymisation des candidatures expirées, anonymisation des dossiers d'insertion clos, suppression des positions GPS obsolètes, suppression des jetons de rafraîchissement expirés.",
            valeur: 'quotidien',
            source: 'code',
            reference: 'backend/src/services/scheduler.js',
          },
          {
            titre: 'Durée de vie des sessions (JWT)',
            description: "Le jeton d'accès expire après ce délai ; le jeton de rafraîchissement (cookie) après le second délai. Les jetons de rafraîchissement expirés sont supprimés chaque jour par le job planifié (ils ne s'accumulent pas en base entre deux redémarrages).",
            valeur: 'accès 8h / rafraîchissement 7j',
            source: 'code',
            reference: 'backend/src/routes/auth.js (JWT_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN), backend/src/services/scheduler.js (purgeExpiredRefreshTokens)',
          },
          {
            titre: 'Révocation immédiate de session',
            description: "Une déconnexion, une réinitialisation de mot de passe, une désactivation de compte ou une déconnexion forcée par un administrateur incrémente un compteur de version (users.token_version) : tout jeton émis avant devient invalide immédiatement, sans attendre son expiration naturelle (jusqu'à 8h).",
            valeur: 'immédiat',
            source: 'code',
            reference: 'backend/src/middleware/auth.js, backend/src/routes/auth.js',
          },
          {
            titre: "Anonymisation manuelle (droit à l'effacement, art. 17)",
            description: "Un ADMIN ou un DPO peut anonymiser à tout moment un candidat ou un salarié depuis cet écran, avec un motif obligatoire. Le même service (anonymizeCandidate / anonymizeEmployee) est utilisé par la purge automatique : aucun périmètre différent entre les deux voies.",
            valeur: 'à la demande, motif requis',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js (POST /anonymize/:type/:id), backend/src/services/anonymization.js',
          },
        ],
      },
      {
        key: 'chiffrement',
        label: 'Chiffrement & masquage',
        description: 'Protection technique des catégories de données les plus sensibles (art. 9/10 RGPD).',
        regles: [
          {
            titre: "Champs sensibles du diagnostic d'insertion",
            description: "Les champs texte relatifs à la santé (art. 9) et au judiciaire (art. 10) — commentaire_sante, frein_sante_detail, frein_sante_causes, frein_judiciaire_detail — sont chiffrés en base (préfixe encv2:, format encv1: encore lu), déchiffrés uniquement en couche route.",
            valeur: 'AES (crypto-js), clé PCM_ENCRYPTION_KEY',
            source: 'code',
            reference: 'backend/src/utils/field-crypto.js',
          },
          {
            titre: 'Rapports PCM (test de personnalité)',
            description: "Les rapports du test de personnalité (Process Communication Model) sont chiffrés en base avec le même mécanisme de clé que les champs sensibles d'insertion.",
            valeur: 'AES (crypto-js)',
            source: 'code',
            reference: 'backend/src/routes/pcm.js',
          },
          {
            titre: 'Masquage par rôle (MANAGER)',
            description: "Pour un utilisateur MANAGER, le frein judiciaire (score/détail/causes), les détails santé et le commentaire budget sont RETIRÉS des réponses API du module Insertion (la clé disparaît, elle n'est jamais mise à null — distingue « non habilité » de « non renseigné »). ADMIN et RH voient tout.",
            valeur: 'ADMIN/RH uniquement',
            source: 'code',
            reference: 'backend/src/routes/insertion/masking.js',
          },
          {
            titre: 'Anonymat structurel des enquêtes internes',
            description: "Les réponses aux enquêtes (QVCT, satisfaction, intégration…) ne portent AUCUNE clé étrangère vers un utilisateur ou un salarié. La restitution n'affiche jamais de distribution ni de moyenne par question en dessous de ce seuil de réponses.",
            valeur: 'n ≥ 5 réponses',
            source: 'code',
            reference: 'backend/src/routes/enquetes.js (SEUIL_ANONYMAT)',
          },
        ],
      },
      {
        key: 'droits',
        label: 'Droits des personnes',
        description: "Droits exercés depuis cet écran (accès, effacement, consentement) ou déclarés au registre.",
        regles: [
          {
            titre: "Droit d'accès (art. 15)",
            description: "Export JSON de toutes les données d'un candidat (identité, compétences, historique, rapports PCM) ou d'un salarié (identité, contrats), disponible depuis l'onglet « Droits des personnes » de cet écran.",
            valeur: 'export à la demande',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js (GET /export/:type/:id)',
          },
          {
            titre: "Droit à l'effacement (art. 17)",
            description: "Anonymisation manuelle avec motif obligatoire, disponible depuis cet écran (bouton « Anonymiser »).",
            valeur: 'à la demande, motif requis',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js (POST /anonymize/:type/:id)',
          },
          {
            titre: 'Gestion du consentement',
            description: "Chaque consentement (type, accordé/révoqué, commentaire) est horodaté et attribué à l'utilisateur qui l'a enregistré ; un nouvel enregistrement met à jour le précédent (une ligne par entité/type).",
            valeur: 'par personne et par type',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js (GET/POST /consent)',
          },
          {
            titre: 'Registre des traitements (art. 30)',
            description: "Chaque traitement de données déclaré précise finalité, base légale, catégories de personnes/données, destinataires, durée de conservation et mesures de sécurité. Consultable dans l'onglet « Registre des traitements ».",
            valeur: registreCount != null ? `${registreCount} traitement(s) déclaré(s)` : 'consultable dans l\'onglet Registre',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js (GET/POST /registre), backend/src/scripts/init-db.js (seed)',
          },
        ],
      },
      {
        key: 'journalisation',
        label: 'Journalisation & traçabilité',
        description: 'Traçabilité applicative des actions portant sur des données personnelles.',
        regles: [
          {
            titre: 'Journal RGPD',
            description: "Toute création de traitement, tout export, toute anonymisation, tout consentement et toute purge sont journalisés (utilisateur, action, type/ID d'entité, détail JSON), consultables dans l'onglet « Journal d'audit » de cet écran.",
            valeur: 'systématique',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js, table rgpd_audit_log',
          },
          {
            titre: 'Export du module Insertion (23 colonnes)',
            description: "La génération de l'export insertion (freins, situations) est journalisée AVANT l'envoi du fichier : un échec de journalisation fait échouer l'export — aucun fichier nominatif ne part sans trace.",
            valeur: 'avant envoi, bloquant',
            source: 'code',
            reference: 'backend/src/routes/exports.js (logExportFreins)',
          },
          {
            titre: 'Colonne « Frein judiciaire » exclue par défaut',
            description: "L'export insertion-freins n'inclut la colonne judiciaire (art. 10) que si le paramètre sensibles=1 est explicitement demandé — la colonne n'est alors même pas lue en SQL sinon (defense in depth). Réservé ADMIN/RH dans tous les cas.",
            valeur: 'sensibles=0 par défaut',
            source: 'code',
            reference: 'backend/src/routes/exports.js (fetchFreinsRows, GET /insertion-freins)',
          },
        ],
      },
      {
        key: 'sous_traitance_ia',
        label: 'Sous-traitance IA (Anthropic)',
        description: "Minimisation des données personnelles transmises au modèle Claude (analyses IA, SolidataBot).",
        regles: [
          {
            titre: "Pseudonymisation avant tout appel au modèle",
            description: "Avant chaque appel à l'API Anthropic (analyse d'insertion, assistant SolidataBot), les identités sont remplacées par un jeton stable (« Salarié A »…), la date de naissance par une tranche d'âge, et les coordonnées/identifiants (email, téléphone, matricule, NIR, IBAN) sont masqués dans les textes libres.",
            valeur: 'systématique',
            source: 'code',
            reference: 'backend/src/utils/pii-pseudonymize.js',
          },
          {
            titre: 'Ré-hydratation strictement interne',
            description: "Les jetons ne sont ré-substitués par le nom réel que côté serveur, pour l'affichage à l'utilisateur (CIP) — jamais transmis à Anthropic sous cette forme.",
            valeur: 'interne uniquement',
            source: 'code',
            reference: 'backend/src/utils/pii-pseudonymize.js (rehydrate)',
          },
          {
            titre: 'Accès restreint aux analyses IA',
            description: "Les endpoints d'analyse IA du module Insertion (profil, préparation d'entretien, bilan de cohorte) sont réservés ADMIN/RH.",
            valeur: 'ADMIN/RH',
            source: 'code',
            reference: 'backend/src/routes/insertion/routes.js',
          },
        ],
      },
    ];

    res.json({ generated_at: new Date().toISOString(), categories });
  } catch (err) {
    console.error('[RGPD] Erreur politique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// PURGE AUTOMATIQUE (Conservation limitée)
// ══════════════════════════════════════════

// POST /api/rgpd/purge-expired — Anonymiser les données expirées
router.post('/purge-expired', authorize('ADMIN', 'DPO'), async (req, res) => {
  try {
    // Candidats non recrutés > 24 mois (durée légale de conservation)
    const expired = await pool.query(
      `SELECT id FROM candidates
       WHERE status != 'hired' AND updated_at < NOW() - INTERVAL '24 months'
       AND first_name != 'ANONYME'`
    );

    let count = 0;
    for (const c of expired.rows) {
      // Une transaction par candidat : isole les échecs et couvre le MÊME
      // périmètre que l'anonymisation manuelle (entretiens, mises en situation…).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeCandidate(client, c.id);
        await client.query('COMMIT');
        count++;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[RGPD] purge candidat #${c.id} :`, e.message);
      } finally {
        client.release();
      }
    }

    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'PURGE_EXPIRED', 'candidates', 0, JSON.stringify({ count, threshold: '24 months' })]
    );

    res.json({ message: `${count} candidats anonymisés (> 24 mois)`, purged_at: new Date().toISOString() });
  } catch (err) {
    console.error('[RGPD] Erreur purge :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
