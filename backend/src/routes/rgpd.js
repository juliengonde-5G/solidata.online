const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireMfa } = require('../middleware/mfa');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { anonymizeCandidate, anonymizeEmployee } = require('../services/anonymization');
// Purges de rétention — SOURCE UNIQUE partagée avec le job planifié. On requiert
// le service, jamais services/scheduler.js : requérir le scheduler depuis une
// route déclencherait ses effets de bord (timers, verrou advisory).
const { PURGES_RGPD, trouverPurge, retentionEffective } = require('../services/rgpd-purges');
const { logActivity } = require('../middleware/activity-logger');

router.use(authenticate);
// Double authentification (2.43.0) : pour les rôles soumis (settings
// « securite.mfa_roles », défaut ADMIN/RH/DPO), la session doit avoir
// franchi le défi TOTP. No-op intégral pour les autres rôles.
router.use(requireMfa);

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
    const { trouverPurge, retentionEffective } = require('../services/rgpd-purges');
    const purgeBordereaux = trouverPurge('bordereaux_decheterie');
    const retentionBordereaux = purgeBordereaux ? await retentionEffective(purgeBordereaux) : { valeur: 1095, source: 'code' };
    const retentionBordereauxJours = retentionBordereaux.valeur;
    const retentionBordereauxSource = retentionBordereaux.source === 'code' ? 'code' : 'rgpd.bordereaux_decheterie_retention_jours';
    // Seuil RÉELLEMENT appliqué par la purge des tests PCM (défaut 90 j en code,
    // réglable) — lu au même endroit que le job pour que l'écran ne puisse pas
    // annoncer une durée que le code n'applique pas.
    const {
      readSetting, PCM_RETENTION_DEFAUT_JOURS, PCM_REPONSES_RETENTION_DEFAUT_JOURS,
    } = require('../services/rgpd-purges');
    const retentionPcmJours = await readSetting('rgpd.pcm_non_recrute_retention_jours', PCM_RETENTION_DEFAUT_JOURS);
    // Second seuil PCM (2.45.0), plus court et sur un périmètre plus large : les
    // réponses détaillées au questionnaire. Lu au même endroit que le job, pour
    // la même raison — cet écran sert à PROUVER la conformité ; s'il annonçait
    // une durée que le code n'applique pas, il ferait le contraire.
    const retentionPcmReponsesJours = await readSetting('rgpd.pcm_reponses_retention_jours', PCM_REPONSES_RETENTION_DEFAUT_JOURS);

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
            titre: 'Tests de personnalité (PCM) des personnes non recrutées',
            description: "Le test de personnalité d'un candidat dont le statut n'est pas « recruté » (session, réponses et rapport chiffré) est SUPPRIMÉ définitivement passé ce délai, sans attendre l'échéance de 24 mois du dossier de candidature. Le délai court depuis la PASSATION du test (date de fin du questionnaire ; à défaut, date de création de la session, pour qu'un lien de passation abandonné ne reste pas indéfiniment) — et non depuis la dernière activité sur le dossier, qu'une simple relance repousserait. La fiche du candidat, elle, suit sa propre échéance à 24 mois. Le test d'une personne recrutée n'est PAS concerné : il suit le dossier du salarié et disparaît à l'anonymisation de celui-ci.",
            valeur: `${retentionPcmJours} jours`,
            source: retentionPcmJours === PCM_RETENTION_DEFAUT_JOURS ? 'code' : 'rgpd.pcm_non_recrute_retention_jours',
            reference: 'backend/src/services/rgpd-purges.js (purgePcmNonRecrute), job planifié purgePcmNonRecrute',
          },
          {
            titre: 'Réponses détaillées au questionnaire PCM (toutes les personnes)',
            description: "Les 20 réponses au questionnaire sont supprimées passé ce délai, compté depuis la PASSATION comme ci-dessus. Seule la synthèse exploitée est conservée au-delà : types de base et de phase, et rapport d'analyse chiffré. Cette purge s'applique à TOUTES LES PERSONNES, y compris celles qui ont été RECRUTÉES — son fondement n'est pas l'issue du recrutement mais la minimisation (art. 5-1-c) : une fois le profil calculé, les réponses item par item n'ont plus d'usage opérationnel, aucun écran ne s'en sert pour décider quoi que ce soit. Conséquence assumée : passé ce délai, un rapport chiffré devenu illisible (rotation de clé) n'est plus reconstructible depuis les réponses ; les types de base et de phase, eux, sont stockés en clair et subsistent.",
            valeur: `${retentionPcmReponsesJours} jours`,
            source: retentionPcmReponsesJours === PCM_REPONSES_RETENTION_DEFAUT_JOURS ? 'code' : 'rgpd.pcm_reponses_retention_jours',
            reference: 'backend/src/services/rgpd-purges.js (purgePcmReponses), job planifié purgePcmReponses',
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
          {
            titre: 'Bordereaux de collecte en déchèterie (signatures manuscrites)',
            description: "Le bordereau Métropole d'un passage en déchèterie porte deux signatures manuscrites (agent de la déchèterie — un tiers — et chauffeur) et un poids indicatif. La ligne et son PDF sont supprimés DÉFINITIVEMENT après ce délai, compté depuis le dépôt. Indépendamment de ce délai, la signature du chauffeur est retirée du bordereau (et le PDF régénéré) dès l'anonymisation de sa fiche ; celle de l'agent, qui appartient à un tiers, est conservée avec la pièce.",
            valeur: `${retentionBordereauxJours} jours`,
            source: retentionBordereauxSource,
            reference: 'backend/src/services/rgpd-purges.js (purgeBordereauxDecheterie), backend/src/services/anonymization.js',
          },
        ],
      },
      {
        key: 'suppression',
        label: 'Suppression & purge',
        description: 'Mécanismes effectifs de suppression, de purge planifiée et de révocation.',
        regles: [
          {
            titre: 'Purges automatiques planifiées',
            description: "9 purges de rétention tournent plusieurs fois par jour : tests PCM des personnes non recrutées, réponses détaillées au questionnaire PCM, anonymisation des candidatures expirées, anonymisation des dossiers d'insertion clos, positions GPS, arrêts de tournée dérivés du GPS, bordereaux de collecte en déchèterie (signatures manuscrites), messagerie interne, jetons de rafraîchissement expirés. Chaque passage est horodaté et son résultat conservé (journal des jobs), consultable dans l'onglet « Automatisations & purges ».",
            valeur: '9 purges, 3×/jour',
            source: 'code',
            reference: 'backend/src/services/rgpd-purges.js (registre PURGES_RGPD), backend/src/services/scheduler.js (runAllJobs)',
          },
          {
            titre: 'Déclenchement manuel des purges',
            description: "Chaque purge planifiée peut être lancée à la demande depuis l'onglet « Automatisations & purges » de cet écran. Le bouton exécute EXACTEMENT le même code que le job : il n'existe qu'une implémentation par purge, pour que les deux voies ne puissent pas diverger. Un déclenchement manuel est toujours journalisé, même s'il n'a rien eu à supprimer — c'est cette trace qui prouve qu'on a vérifié.",
            valeur: 'à la demande, ADMIN/DPO',
            source: 'code',
            reference: 'backend/src/routes/rgpd.js (GET /purges, POST /purges/:cle/executer), backend/src/services/rgpd-purges.js',
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
            titre: 'Information préalable du candidat (test PCM)',
            description: "Avant la première question du test de personnalité, l'écran de passation affiche une notice en langage simple : à quoi sert le questionnaire et à quoi il ne sert pas (il n'est jamais un critère de sélection), qui voit le résultat, les DEUX durées de conservation ci-dessus, les droits de la personne et comment les exercer. Le candidat confirme l'avoir lue ; la confirmation est horodatée sur sa session (pcm_sessions.notice_acceptee_at) et la soumission des réponses est REFUSÉE sans elle — la garde est côté serveur, pas seulement à l'écran. Une personne qui ne souhaite pas répondre ne peut pas commencer, et l'écran lui indique vers qui se tourner.",
            valeur: 'bloquante, tracée par passation',
            source: 'code',
            reference: 'backend/src/routes/pcm.js (POST /sessions/:token/notice, garde de POST /submit), frontend/src/pages/PCMTest.jsx',
          },
          {
            titre: 'Restitution de son résultat au candidat (art. 15)',
            description: "Depuis l'écran de fin de test, la personne peut éditer et imprimer son propre résultat, par son seul jeton de passation (elle n'a pas de compte). Le document lui rend ce que le questionnaire dit de sa manière de communiquer, avec la mention de méthode et les mentions de conservation ; il exclut l'indicateur de cohérence des réponses et tout vocabulaire clinique. Chaque restitution est journalisée (action PCM_RESTITUTION_CANDIDAT), et le jeton ne donne accès qu'au résultat de SA propre passation.",
            valeur: 'à la demande, par jeton de session',
            source: 'code',
            reference: 'backend/src/routes/pcm.js (GET /sessions/:token/restitution), frontend/src/utils/pcm-pdf.js',
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

// ══════════════════════════════════════════
// AUTOMATISATIONS & PURGES DE RÉTENTION (2.44.0)
// ──────────────────────────────────────────
// Les purges de rétention tournaient toutes en tâche de fond, sans vitrine :
// impossible de savoir depuis l'écran RGPD si elles tournaient encore, ni d'en
// relancer une à la demande. Ces deux routes exposent le registre partagé
// (services/rgpd-purges.js) — le MÊME code que le job planifié, jamais une
// seconde implémentation qui divergerait en silence.
// ══════════════════════════════════════════

// GET /api/rgpd/purges — liste des purges + dernier passage du job correspondant.
// Une purge dont le job n'a JAMAIS tourné renvoie `dernier_passage: null` et
// `jamais_execute: true` : l'écran doit dire « jamais exécuté », pas afficher
// une date vide qu'on prendrait pour une exécution muette.
router.get('/purges', authorize('ADMIN', 'DPO'), async (req, res) => {
  try {
    const jobNames = PURGES_RGPD.map((p) => p.jobName);

    // job_runs peut être absente (base neuve non migrée) : on dégrade en
    // « jamais exécuté » plutôt que de renvoyer 500.
    let derniers = [];
    let succes = [];
    let journalDisponible = true;
    try {
      const r = await pool.query(
        `SELECT DISTINCT ON (job_name) job_name, started_at, finished_at, status,
                error_message, items_processed, duration_ms
           FROM job_runs WHERE job_name = ANY($1) ORDER BY job_name, started_at DESC`,
        [jobNames]
      );
      derniers = r.rows;
      const s = await pool.query(
        `SELECT DISTINCT ON (job_name) job_name, started_at AS last_success_at
           FROM job_runs WHERE job_name = ANY($1) AND status = 'success'
          ORDER BY job_name, started_at DESC`,
        [jobNames]
      );
      succes = s.rows;
    } catch (_) {
      journalDisponible = false;
    }
    const parJob = Object.fromEntries(derniers.map((r) => [r.job_name, r]));
    const succesParJob = Object.fromEntries(succes.map((r) => [r.job_name, r.last_success_at]));

    const purges = [];
    for (const p of PURGES_RGPD) {
      const dernier = parJob[p.jobName] || null;
      purges.push({
        cle: p.cle,
        libelle: p.libelle,
        description: p.description,
        job_name: p.jobName,
        entity_type: p.entiteAudit,
        action_auto: p.actionAuto,
        action_manuelle: p.actionManuelle,
        retention: await retentionEffective(p),
        jamais_execute: !dernier,
        dernier_passage: dernier
          ? {
              started_at: dernier.started_at,
              finished_at: dernier.finished_at,
              status: dernier.status,
              error_message: dernier.error_message,
              items_processed: dernier.items_processed,
              duration_ms: dernier.duration_ms,
            }
          : null,
        dernier_succes_at: succesParJob[p.jobName] || null,
      });
    }

    res.json({ generated_at: new Date().toISOString(), journal_disponible: journalDisponible, purges });
  } catch (err) {
    console.error('[RGPD] Erreur liste des purges :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rgpd/purges/:cle/executer — déclenchement MANUEL d'une purge.
// Liste blanche par clé (404 sur une clé inconnue : on n'exécute jamais une
// fonction désignée par l'appelant). La purge journalise elle-même son action
// manuelle dans rgpd_audit_log — TOUJOURS, même à zéro ligne supprimée : c'est
// cette trace qui prouve qu'un humain a vérifié. On double la trace dans le
// journal d'activité générique (`user_activity_log`), qui est une table
// DISTINCTE : sans cet appel, l'action serait invisible depuis /activity-log.
router.post('/purges/:cle/executer', authorize('ADMIN', 'DPO'), async (req, res) => {
  const purge = trouverPurge(req.params.cle);
  if (!purge) {
    return res.status(404).json({ error: 'Purge inconnue', cle: req.params.cle });
  }
  try {
    const resultat = await purge.fn({ trigger: 'manual', userId: req.user.id });
    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'purge',
      entityType: 'rgpd',
      entityId: null,
      details: { purge: purge.cle, libelle: purge.libelle, total: resultat.total, supprimes: resultat.supprimes },
      ip: req.ip,
    });
    res.json({
      message: `Purge « ${purge.libelle} » exécutée`,
      cle: purge.cle,
      libelle: purge.libelle,
      action_journalisee: purge.actionManuelle,
      executed_at: new Date().toISOString(),
      resultat,
    });
  } catch (err) {
    console.error(`[RGPD] Erreur exécution manuelle de la purge ${purge.cle} :`, err);
    res.status(500).json({ error: 'Erreur serveur', cle: purge.cle });
  }
});

module.exports = router;
