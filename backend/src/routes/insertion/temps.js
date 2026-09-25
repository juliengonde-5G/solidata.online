/**
 * PR B lot 4 — Temps d'accompagnement : feuille de temps mensuelle par
 * intervenant et par projet (export (c) de l'autorité, 09 § 2 (c)).
 * Monté par ./index.js sur `/api/insertion/temps`, AVANT routes.js ; hérite de
 * `authenticate + requireMfa + authorize` restreint à ADMIN/RH (le module
 * insertion entier depuis la fusion de main, 25/09/2026).
 *
 * QUI VOIT QUOI. ADMIN et RH voient tout (ils instruisent et contre-signent) ;
 * tout autre rôle ne verrait et ne signerait QUE SA PROPRE feuille. Le rôle
 * MANAGER visé par la PR B a été retiré de l'application le 10/09/2026 : cette
 * branche est donc INATTEIGNABLE aujourd'hui (le routeur parent refuse en 403
 * avant elle) — garde morte conservée, jamais retirée. Le refus est posé
 * AVANT toute lecture en base : un refus rendu après la requête serait un
 * refus d'AFFICHAGE, pas un refus d'accès — la donnée aurait déjà quitté la
 * base, et rien ne garantirait qu'elle ne fuite pas par un message d'erreur ou
 * un journal.
 *
 * LA SIGNATURE EST UN ACTE, PAS UNE CASE. Trois conséquences tenues ici :
 *  - transitions FORWARD-ONLY (brouillon → intervenant → RH) : on ne
 *    « dé-signe » pas, on ROUVRE, et une réouverture est un geste d'ADMIN,
 *    motivé et journalisé ;
 *  - la validation de l'intervenant FIGE les lignes : ce qui a été signé ne
 *    bouge plus quand un entretien est corrigé deux mois plus tard ;
 *  - deux signatures = deux personnes (409 `AUTO_VALIDATION`). Une feuille
 *    contre-signée par son propre auteur ne prouve rien.
 *
 * UNE ANOMALIE DE COHÉRENCE NE BLOQUE RIEN. Il n'existe volontairement aucun
 * 409 « cohérence non conforme » : l'anomalie s'IMPRIME (« à expliquer »).
 * Bloquer la signature laisserait la feuille non signée — c'est-à-dire la
 * dépense écartée, ce que l'anomalie voulait justement éviter.
 */
const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize, resolveBaseRole } = require('../../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { readInsertionSetting } = require('../../utils/insertion-settings');
// Jour civil : cf. `utils/date-iso.js`. Les colonnes DATE reviennent en objets
// `Date` construits à minuit LOCAL — les lire en UTC les décale d'un jour dès
// que le fuseau est positif (correctif D-05).
const { isoDate, moisDe, anneeDe, aujourdhuiParis } = require('../../utils/date-iso');
const { escCsv, nomGenerateur } = require('../../utils/export-csv');
const { lireFeuille, composerFeuille, heuresAccompagnement } = require('../../services/temps-accompagnement');
const { ACTIVITES_SAISIES } = require('../../scripts/migrations/insertion-temps');
const { HORS_PROJET } = require('../../services/temps-engine');

const APP_VERSION = process.env.APP_VERSION || require('../../../package.json').version;
const MENTION_OFFICIELLE = "Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE+) font foi";

/** Libellés français des activités — l'export sort en français (09 § 2). */
const LIBELLES_ACTIVITE = {
  entretien: 'Entretien',
  action: 'Action',
  atelier_collectif: 'Atelier collectif',
  reunion_projet: 'Réunion de projet',
  autre: 'Autre',
};
const LIBELLES_ORIGINE = { composee: 'Composée automatiquement', saisie: 'Saisie manuelle' };
const LIBELLES_STATUT = {
  brouillon: 'Brouillon',
  validee_intervenant: "Validée par l'intervenant",
  validee_rh: 'Validée par la RH',
};

/**
 * Jour du mois suivant à partir duquel une feuille non contre-signée est
 * signalée. Défaut 10 EN CODE (l'autorité clôt la feuille au 10 du mois
 * suivant) : la clé est ajoutée au dictionnaire des réglages par le lot 3, et
 * tant qu'elle n'y est pas la lecture rend `null` — d'où le repli ici, jamais
 * une valeur aberrante.
 */
async function jourCloture() {
  const v = await readInsertionSetting('insertion.feuille_temps_cloture_jour');
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 28 ? n : 10;
}

/** Journal RGPD — écrit AVANT l'envoi d'un document ; son échec fait échouer l'acte. */
async function journaliser(db, { userId, action, entityId, details }) {
  await db.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [userId || null, action, 'insertion_temps', entityId == null ? null : entityId, JSON.stringify(details || {})]
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Garde de périmètre — posée AVANT tout validateur et toute requête
// ───────────────────────────────────────────────────────────────────────────

/**
 * ADMIN/RH : tout. Tout autre rôle (le MANAGER de la PR B — retiré sur main
 * le 10/09/2026, garde inatteignable depuis la fusion du 25/09/2026) :
 * uniquement sa propre feuille, comparaison NUMÉRIQUE — `'7'` issu
 * de l'URL et `7` du jeton doivent se reconnaître, et une comparaison de
 * chaînes laisserait passer `'07'`.
 */
function gardeProprietaire(req, res, next) {
  const base = resolveBaseRole(req.user && req.user.role);
  if (base === 'ADMIN' || base === 'RH') return next();
  const demande = Number(req.params.userId);
  const moi = Number(req.user && req.user.id);
  if (Number.isFinite(demande) && Number.isFinite(moi) && demande === moi) return next();
  return res.status(403).json({
    error: "Vous ne pouvez consulter que votre propre feuille de temps.",
    code: 'FEUILLE_HORS_PERIMETRE',
  });
}

/** Validateurs communs de la triade `:userId/:annee/:mois`. */
const PERIODE = [
  param('userId').isInt({ min: 1 }).withMessage('Intervenant invalide'),
  param('annee').isInt({ min: 2000, max: 2100 }).withMessage('Année invalide'),
  param('mois').isInt({ min: 1, max: 12 }).withMessage('Mois invalide'),
];

/** Lit (ou crée en mémoire) l'état de la feuille — sans jamais l'écrire. */
async function etatFeuille(userId, annee, mois) {
  const r = await pool.query(
    'SELECT * FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
    [userId, annee, mois]
  );
  return r.rows[0] || null;
}

/** Date limite de clôture (1er du mois suivant + jour − 1). */
function dateCloture(annee, mois, jour) {
  const d = new Date(Date.UTC(Number(annee), Number(mois), jour));
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /intervenants — ADMIN/RH
// ═══════════════════════════════════════════════════════════════════════════
// Un « intervenant » n'est pas un rôle : c'est quelqu'un qui a réellement mené
// un entretien dans l'année OU qui occupe un poste affecté à une opération.
// Lister tous les comptes RH/ADMIN/MANAGER produirait une liste de feuilles
// vides, où celle qui compte se perdrait.
router.get('/intervenants', authorize('ADMIN', 'RH'), [
  query('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('Année invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : new Date().getFullYear();
    const r = await pool.query(`
      SELECT u.id AS user_id, u.first_name, u.last_name, u.role,
             COALESCE(json_agg(DISTINCT jsonb_build_object(
               'projet_id', pp.projet_id, 'projet_code', p.code, 'quotite_pct', pp.quotite_pct
             )) FILTER (WHERE pp.id IS NOT NULL), '[]') AS postes
        FROM users u
        LEFT JOIN insertion_projet_postes pp ON pp.user_id = u.id
        LEFT JOIN insertion_projets p ON p.id = pp.projet_id
       WHERE u.is_active = true
         AND u.role IN ('ADMIN', 'RH')
         AND (
           pp.id IS NOT NULL
           OR EXISTS (SELECT 1 FROM insertion_milestones m
                       WHERE m.interviewer_id = u.id
                         AND m.completed_date >= $1::date AND m.completed_date < $2::date)
           OR EXISTS (SELECT 1 FROM insertion_temps_saisies s
                       WHERE s.user_id = u.id
                         AND s.date >= $1::date AND s.date < $2::date)
         )
       GROUP BY u.id
       ORDER BY u.last_name, u.first_name
    `, [`${annee}-01-01`, `${annee + 1}-01-01`]);

    res.json(r.rows.map((u) => ({
      user_id: u.user_id,
      nom: `${(u.last_name || '').toUpperCase()} ${u.first_name || ''}`.trim(),
      role: u.role,
      postes: Array.isArray(u.postes) ? u.postes : [],
    })));
  } catch (err) {
    console.error('[INSERTION][TEMPS] intervenants :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /synthese — ADMIN/RH (indicateur n° 14 de l'autorité)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/synthese', authorize('ADMIN', 'RH'), [
  query('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('Année invalide'),
  query('projet').optional().isInt({ min: 1 }).withMessage('Projet invalide'),
  query('employee').optional().isInt({ min: 1 }).withMessage('Salarié invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : new Date().getFullYear();
    const synthese = await heuresAccompagnement({
      annee,
      projetId: req.query.projet ? parseInt(req.query.projet, 10) : null,
      employeeId: req.query.employee ? parseInt(req.query.employee, 10) : null,
    });
    if (!synthese) {
      // `heuresAccompagnement` dégrade en `null` plutôt que de faire tomber le
      // tableau de bord qui l'appelle : ici, l'écran est fait POUR elle, donc
      // on le dit au lieu d'afficher des zéros qu'on ne peut pas justifier.
      return res.status(503).json({
        error: "La synthèse des heures d'accompagnement n'a pas pu être composée.",
        code: 'SYNTHESE_INDISPONIBLE',
        hint: 'Base non à jour (colonne manquante) — un redéploiement applique la migration.',
      });
    }
    res.json(synthese);
  } catch (err) {
    console.error('[INSERTION][TEMPS] synthese :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /saisies/:id — propriétaire ou ADMIN/RH
// ═══════════════════════════════════════════════════════════════════════════
// Déclarée AVANT `/:userId/:annee/:mois` : deux segments contre trois, aucune
// collision possible, mais l'ordre reste explicite pour qui relira.
router.delete('/saisies/:id', [
  param('id').isInt({ min: 1 }).withMessage('Saisie invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM insertion_temps_saisies WHERE id = $1', [req.params.id]);
    const saisie = r.rows[0];
    if (!saisie) return res.status(404).json({ error: 'Saisie non trouvée' });

    // CORRECTIF m-04 — anti-énumération. Il faut LIRE la ligne pour connaître
    // son propriétaire ; on ne peut donc pas poser la garde avant la requête.
    // Mais distinguer 404 (« n'existe pas ») de 403 (« existe, pas à vous »)
    // laissait un MANAGER énumérer les identifiants de saisie des autres. Pour
    // qui n'est ni ADMIN ni RH, les deux situations rendent désormais le MÊME
    // 404 — même doctrine que l'anti-énumération du parcours chauffeur (2.40.0).
    const base = resolveBaseRole(req.user.role);
    if (base !== 'ADMIN' && base !== 'RH' && Number(saisie.user_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Saisie non trouvée' });
    }

    // CORRECTIF D-05 — le mois était déduit par `new Date(saisie.date).getUTC*()`
    // alors que le pilote construit la colonne DATE à minuit LOCAL : sous
    // Europe/Paris, une saisie du 1er juillet était rattachée à la feuille de
    // JUIN, donc la garde de gel interrogeait la mauvaise feuille (et refusait
    // en 409 la suppression d'une saisie parfaitement modifiable).
    const jourSaisie = isoDate(saisie.date);
    const annee = anneeDe(jourSaisie);
    const mois = moisDe(jourSaisie);
    const feuille = await etatFeuille(saisie.user_id, annee, mois);
    if (feuille && feuille.statut !== 'brouillon') {
      return res.status(409).json({
        error: `La feuille de ${String(mois).padStart(2, '0')}/${annee} est ${LIBELLES_STATUT[feuille.statut].toLowerCase()} : elle ne peut plus être modifiée.`,
        code: 'FEUILLE_FIGEE',
        hint: 'Un administrateur peut la rouvrir, avec un motif.',
      });
    }

    await pool.query('DELETE FROM insertion_temps_saisies WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION][TEMPS] DELETE saisie :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:userId/:annee/:mois — la feuille
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:userId/:annee/:mois', gardeProprietaire, PERIODE, validate, async (req, res) => {
  try {
    const { userId, annee, mois } = req.params;
    const feuille = await lireFeuille({ userId: parseInt(userId, 10), annee: parseInt(annee, 10), mois: parseInt(mois, 10) });
    const jour = await jourCloture();
    const limite = dateCloture(annee, mois, jour);
    // Jour civil de PARIS : `cloture_depassee` bascule sinon deux heures trop
    // tôt en été, et une feuille du 10 serait annoncée en retard le 9 au soir.
    const aujourdhui = aujourdhuiParis();

    const u = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    res.json({
      ...feuille,
      intervenant: u.rows[0]
        ? { user_id: parseInt(userId, 10), nom: `${(u.rows[0].last_name || '').toUpperCase()} ${u.rows[0].first_name || ''}`.trim() }
        : null,
      date_cloture: limite,
      // « Non validée » au sens de l'autorité = pas contre-signée par la RH :
      // c'est la double signature qui rend la dépense justifiable.
      cloture_depassee: feuille.statut !== 'validee_rh' && aujourdhui > limite,
    });
  } catch (err) {
    console.error('[INSERTION][TEMPS] GET feuille :', err.message, err.code || '');
    const hint = err.code === '42703' || err.code === '42P01'
      ? 'Base non à jour (colonne ou table manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /:userId/:annee/:mois/saisies — temps hors salarié
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:userId/:annee/:mois/saisies', gardeProprietaire, [
  ...PERIODE,
  body('date').isISO8601().withMessage('Date invalide'),
  body('activite').isIn(ACTIVITES_SAISIES).withMessage(`Activité invalide (${ACTIVITES_SAISIES.join(', ')})`),
  body('duree_minutes').isInt({ min: 1, max: 600 }).withMessage('Durée attendue entre 1 et 600 minutes'),
  body('projet_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Projet invalide'),
  body('libelle').optional({ nullable: true }).isString().trim().isLength({ max: 200 }).withMessage('Libellé de 200 caractères maximum'),
], validate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const annee = parseInt(req.params.annee, 10);
    const mois = parseInt(req.params.mois, 10);

    const feuille = await etatFeuille(userId, annee, mois);
    if (feuille && feuille.statut !== 'brouillon') {
      return res.status(409).json({
        error: `La feuille de ${String(mois).padStart(2, '0')}/${annee} est ${LIBELLES_STATUT[feuille.statut].toLowerCase()} : elle ne peut plus être modifiée.`,
        code: 'FEUILLE_FIGEE',
        hint: 'Un administrateur peut la rouvrir, avec un motif.',
      });
    }

    // La date doit tomber DANS le mois de la feuille : une saisie du 3 octobre
    // rangée dans la feuille de septembre déplacerait une dépense d'un mois à
    // l'autre, donc d'un bilan d'exécution à l'autre.
    const jour = String(req.body.date).slice(0, 10);
    if (Number(jour.slice(0, 4)) !== annee || Number(jour.slice(5, 7)) !== mois) {
      return res.status(400).json({
        error: `La date doit appartenir au mois de la feuille (${String(mois).padStart(2, '0')}/${annee}).`,
        code: 'DATE_HORS_MOIS',
      });
    }

    const r = await pool.query(
      `INSERT INTO insertion_temps_saisies (user_id, date, projet_id, activite, duree_minutes, libelle, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, jour, req.body.projet_id || null, req.body.activite,
        req.body.duree_minutes, req.body.libelle || null, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Intervenant ou projet inconnu.' });
    console.error('[INSERTION][TEMPS] POST saisie :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /:userId/:annee/:mois/valider — transitions forward-only
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:userId/:annee/:mois/valider', gardeProprietaire, PERIODE, validate, async (req, res) => {
  // CORRECTIF M-04 — `pool.connect()` est DANS le `try`. Au-dehors, son rejet
  // (pool saturé, base momentanément injoignable) rejetait la promesse du
  // handler HORS de tout try/catch : Express 4 ne capture pas le rejet d'un
  // handler `async`, donc AUCUNE réponse n'était envoyée, la requête restait
  // ouverte jusqu'au délai du client et le rejet remontait en
  // `unhandledRejection`. Défaut déjà trouvé et corrigé en PR A (rapport 13).
  let client;
  try {
    client = await pool.connect();
    const userId = parseInt(req.params.userId, 10);
    const annee = parseInt(req.params.annee, 10);
    const mois = parseInt(req.params.mois, 10);
    const base = resolveBaseRole(req.user.role);

    await client.query('BEGIN');
    // Verrou pessimiste : deux validations concurrentes du même mois
    // produiraient deux snapshots, donc deux totaux signés.
    const r = await client.query(
      'SELECT * FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3 FOR UPDATE',
      [userId, annee, mois]
    );
    const feuille = r.rows[0] || null;
    const statut = feuille ? feuille.statut : 'brouillon';
    const maintenant = new Date().toISOString();

    // ── brouillon → validee_intervenant : FIGE la feuille ───────────────────
    if (statut === 'brouillon') {
      const composee = await composerFeuille({ userId, annee, mois, db: client });
      if (composee.lignes.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Aucun temps d'accompagnement sur ${String(mois).padStart(2, '0')}/${annee} : il n'y a rien à valider.`,
          code: 'FEUILLE_VIDE',
          hint: "Renseignez la durée des entretiens réalisés, ou ajoutez une saisie (atelier collectif, réunion de projet).",
        });
      }
      const validation = { user_id: req.user.id, nom: nomGenerateur(req.user), at: maintenant };
      const params = [userId, annee, mois, JSON.stringify(composee.lignes),
        JSON.stringify(composee.totaux), JSON.stringify(composee.coherence), JSON.stringify(validation)];
      const maj = await client.query(
        `INSERT INTO insertion_feuilles_temps (user_id, annee, mois, statut, lignes, totaux, coherence, validation_intervenant, updated_at)
         VALUES ($1, $2, $3, 'validee_intervenant', $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
         ON CONFLICT (user_id, annee, mois) DO UPDATE SET
           statut = 'validee_intervenant', lignes = EXCLUDED.lignes, totaux = EXCLUDED.totaux,
           coherence = EXCLUDED.coherence, validation_intervenant = EXCLUDED.validation_intervenant,
           validation_rh = NULL, updated_at = NOW()
         RETURNING *`,
        params
      );
      await journaliser(client, {
        userId: req.user.id, action: 'INSERTION_FEUILLE_TEMPS_VALIDATION', entityId: maj.rows[0].id,
        details: {
          geste: 'validation_intervenant', intervenant_id: userId, annee, mois,
          total_minutes: composee.totaux.total_minutes, nb_lignes: composee.lignes.length,
          coherence_conforme: composee.coherence.conforme,
        },
      });
      await client.query('COMMIT');
      return res.json({ ok: true, statut: 'validee_intervenant', feuille: maj.rows[0] });
    }

    // ── validee_intervenant → validee_rh : contre-signature ─────────────────
    if (statut === 'validee_intervenant') {
      if (base !== 'ADMIN' && base !== 'RH') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'La contre-signature de la feuille relève de la RH.',
          code: 'VALIDATION_RH_RESERVEE',
        });
      }
      // Deux signatures = deux personnes. L'intervenant lui-même (et, à plus
      // forte raison, celui qui a déjà signé le premier volet) ne contresigne
      // pas : une feuille validée deux fois par la même personne ne prouve
      // rien, et l'autorité écarte la dépense pour signature manquante.
      const signataire = feuille.validation_intervenant && feuille.validation_intervenant.user_id;
      if (Number(req.user.id) === userId || (signataire != null && Number(signataire) === Number(req.user.id))) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: "La feuille doit être contre-signée par une autre personne que celle qui l'a validée.",
          code: 'AUTO_VALIDATION',
        });
      }
      const validation = { user_id: req.user.id, nom: nomGenerateur(req.user), at: maintenant };
      const maj = await client.query(
        `UPDATE insertion_feuilles_temps
            SET statut = 'validee_rh', validation_rh = $4::jsonb, updated_at = NOW()
          WHERE user_id = $1 AND annee = $2 AND mois = $3 RETURNING *`,
        [userId, annee, mois, JSON.stringify(validation)]
      );
      await journaliser(client, {
        userId: req.user.id, action: 'INSERTION_FEUILLE_TEMPS_VALIDATION', entityId: maj.rows[0].id,
        details: { geste: 'validation_rh', intervenant_id: userId, annee, mois },
      });
      await client.query('COMMIT');
      return res.json({ ok: true, statut: 'validee_rh', feuille: maj.rows[0] });
    }

    await client.query('ROLLBACK');
    return res.status(409).json({
      error: 'Cette feuille est déjà validée par la RH : elle ne peut plus changer d’état.',
      code: 'TRANSITION_INVALIDE',
      hint: 'Un administrateur peut la rouvrir, avec un motif.',
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION][TEMPS] valider :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  } finally {
    if (client) client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /:userId/:annee/:mois/rouvrir — ADMIN, motif obligatoire
// ═══════════════════════════════════════════════════════════════════════════
// Périmètre volontairement plus large que le seul `validee_rh` du contrat :
// une feuille arrêtée à `validee_intervenant` serait autrement FIGÉE POUR
// TOUJOURS (plus de saisie possible, et aucune transition arrière). Ce serait
// une impasse, pas une garantie.
router.post('/:userId/:annee/:mois/rouvrir', authorize('ADMIN'), [
  ...PERIODE,
  body('motif').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Motif obligatoire (3 à 500 caractères)'),
], validate, async (req, res) => {
  // CORRECTIF M-04 — voir `valider` : la connexion se prend DANS le `try`.
  let client;
  try {
    client = await pool.connect();
    const userId = parseInt(req.params.userId, 10);
    const annee = parseInt(req.params.annee, 10);
    const mois = parseInt(req.params.mois, 10);

    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3 FOR UPDATE',
      [userId, annee, mois]
    );
    const feuille = r.rows[0] || null;
    if (!feuille) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aucune feuille de temps pour ce mois.' });
    }
    if (feuille.statut === 'brouillon') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Cette feuille est déjà au brouillon.', code: 'TRANSITION_INVALIDE' });
    }

    // Les validations TOMBENT. Une feuille rouverte n'est plus signée : la
    // conserver « signée » laisserait croire qu'un document modifié après coup
    // porte encore l'accord de ses signataires.
    const maj = await client.query(
      `UPDATE insertion_feuilles_temps
          SET statut = 'brouillon', lignes = NULL, totaux = NULL, coherence = NULL,
              validation_intervenant = NULL, validation_rh = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [feuille.id]
    );
    await journaliser(client, {
      userId: req.user.id, action: 'INSERTION_FEUILLE_TEMPS_REOUVERTURE', entityId: feuille.id,
      details: {
        intervenant_id: userId, annee, mois, statut_anterieur: feuille.statut,
        motif: req.body.motif,
        total_minutes_anterieur: feuille.totaux ? feuille.totaux.total_minutes : null,
      },
    });
    await client.query('COMMIT');
    res.json({ ok: true, statut: 'brouillon', feuille: maj.rows[0] });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION][TEMPS] rouvrir :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  } finally {
    if (client) client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:userId/:annee/:mois/export.pdf — la MÊME pièce, imprimée (M-05)
// ═══════════════════════════════════════════════════════════════════════════
//
// Le PDF est composé côté navigateur, à partir d'une réponse du serveur. Tant
// que cette réponse était celle du `GET /:userId/:annee/:mois` ordinaire, la
// feuille sortait **sans aucune trace** : le CSV était journalisé, le PDF non,
// alors que les deux portent le même contenu, la même mention « pièce de
// justification d'une dépense cofinancée » et vont au même destinataire. La
// question « qui a sorti la feuille de septembre ? » n'avait pas de réponse
// si elle était sortie en PDF.
//
// D'où une route DÉDIÉE plutôt qu'un appel de traçage que le front pourrait
// omettre : elle ne peut pas être contournée en appelant directement le GET,
// puisque c'est elle qui rend la feuille que le PDF imprime. Le journal est
// écrit AVANT la réponse et son échec fait échouer l'acte — même règle que le
// CSV.
//
// Refus sur zéro ligne, comme le CSV : un PDF vide classé dans un dossier
// affirmerait « aucun temps d'accompagnement ce mois-ci ».
router.get('/:userId/:annee/:mois/export.pdf', gardeProprietaire, PERIODE, validate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const annee = parseInt(req.params.annee, 10);
    const mois = parseInt(req.params.mois, 10);

    const feuille = await lireFeuille({ userId, annee, mois });
    if (!feuille.lignes || feuille.lignes.length === 0) {
      return res.status(409).json({
        error: `Aucune ligne de temps sur ${String(mois).padStart(2, '0')}/${annee} — aucun document n'est produit.`,
        code: 'EXPORT_VIDE',
        hint: "Renseignez la durée des entretiens réalisés, ou ajoutez une saisie (atelier collectif, réunion de projet).",
      });
    }

    const u = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    const intervenant = u.rows[0]
      ? { user_id: userId, nom: `${(u.rows[0].last_name || '').toUpperCase()} ${u.rows[0].first_name || ''}`.trim() }
      : null;

    const t = feuille.totaux || {};
    await journaliser(pool, {
      userId: req.user.id, action: 'EXPORT_FEUILLE_TEMPS', entityId: feuille.feuille_id || null,
      details: {
        format: 'pdf', intervenant_id: userId, annee, mois, statut: feuille.statut,
        lignes: feuille.lignes.length, total_minutes: t.total_minutes == null ? null : t.total_minutes,
      },
    });

    const jour = await jourCloture();
    const limite = dateCloture(annee, mois, jour);
    res.json({
      ...feuille,
      intervenant,
      date_cloture: limite,
      cloture_depassee: feuille.statut !== 'validee_rh' && aujourdhuiParis() > limite,
    });
  } catch (err) {
    console.error('[INSERTION][TEMPS] export pdf :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:userId/:annee/:mois/export.csv — export (c) de l'autorité
// ═══════════════════════════════════════════════════════════════════════════
// LE NOM DU BÉNÉFICIAIRE N'Y FIGURE JAMAIS (09 § 2 (c)). Ce n'est pas un
// masquage : les lignes ne portent que `employee_id` depuis leur composition,
// il n'y a donc rien à retirer — et rien qui puisse réapparaître un jour par
// inadvertance.
const COLONNES = ['Date', 'Projet', 'Activité', 'Bénéficiaire (identifiant interne)', 'Durée (min)', 'Origine'];

router.get('/:userId/:annee/:mois/export.csv', gardeProprietaire, PERIODE, validate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const annee = parseInt(req.params.annee, 10);
    const mois = parseInt(req.params.mois, 10);

    const feuille = await lireFeuille({ userId, annee, mois });

    // Zéro ligne → refus motivé, JAMAIS un fichier vide : classé dans un
    // dossier, il dirait « aucun temps d'accompagnement ce mois-ci », ce qui
    // est une affirmation que personne n'a faite.
    if (!feuille.lignes || feuille.lignes.length === 0) {
      return res.status(409).json({
        error: `Aucune ligne de temps sur ${String(mois).padStart(2, '0')}/${annee} — aucun fichier n'est produit.`,
        code: 'EXPORT_VIDE',
        hint: "Renseignez la durée des entretiens réalisés, ou ajoutez une saisie (atelier collectif, réunion de projet).",
      });
    }

    const u = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    const intervenant = u.rows[0]
      ? `${(u.rows[0].last_name || '').toUpperCase()} ${u.rows[0].first_name || ''}`.trim()
      : `Intervenant #${userId}`;

    const lignes = feuille.lignes.map((l) => [
      l.date,
      l.projet_code === HORS_PROJET ? 'Hors projet' : l.projet_code,
      LIBELLES_ACTIVITE[l.activite] || l.activite,
      l.employee_id == null ? '' : l.employee_id,
      l.duree_minutes,
      LIBELLES_ORIGINE[l.origine] || l.origine,
    ].map((v) => escCsv(v)).join(';'));

    // ── Pied imposé par l'autorité : total, par projet, quotité, taux
    // forfaitaire, et la LIGNE DE COHÉRENCE (son absence fait écarter la
    // dépense — 09 § 2 (c)).
    const t = feuille.totaux || { total_minutes: 0, par_projet: {}, quotites: {}, taux_forfaitaire: {} };
    const heures = (min) => (Math.round((Number(min) / 60) * 100) / 100).toString().replace('.', ',');
    const pied = [''];
    pied.push(`Total mensuel;${escCsv(t.total_minutes)};minutes;${escCsv(heures(t.total_minutes))};heures`);
    for (const [code, minutes] of Object.entries(t.par_projet || {})) {
      const libelle = code === HORS_PROJET ? 'Hors projet' : code;
      const q = t.quotites && t.quotites[code] != null ? `${t.quotites[code]} %` : 'non renseignée';
      const tf = t.taux_forfaitaire && t.taux_forfaitaire[code] != null ? `${t.taux_forfaitaire[code]} %` : 'non renseigné';
      pied.push([`Total ${libelle}`, minutes, 'minutes', `Quotité d'affectation : ${q}`, `Taux forfaitaire : ${tf}`]
        .map((v) => escCsv(v)).join(';'));
    }
    const coh = feuille.coherence || { conforme: true, anomalies: [] };
    pied.push(`Cohérence avec les congés;${coh.conforme ? 'conforme' : 'à expliquer'}`);
    for (const a of coh.anomalies || []) {
      pied.push(['', escCsv(a.date || ''), escCsv(a.type), escCsv(a.detail)].join(';'));
    }
    const sign = (v, quoi) => `Signature ${quoi};${v ? escCsv(v.nom || `utilisateur #${v.user_id}`) : 'MANQUANTE'};${v && v.at ? escCsv(new Date(v.at).toLocaleString('fr-FR')) : ''}`;
    pied.push(sign(feuille.validation_intervenant, "de l'intervenant"));
    pied.push(sign(feuille.validation_rh, 'de la RH'));
    pied.push("Durées déclarées par l'intervenant à la clôture des entretiens");

    // Journal RGPD AVANT l'envoi : son échec fait échouer l'export (règle
    // commune des exports de l'autorité).
    await journaliser(pool, {
      userId: req.user.id, action: 'EXPORT_FEUILLE_TEMPS', entityId: feuille.feuille_id || null,
      details: {
        format: 'csv', intervenant_id: userId, annee, mois, statut: feuille.statut,
        lignes: feuille.lignes.length, total_minutes: t.total_minutes,
      },
    });

    const meta = [
      `# Export;Feuille de temps d'accompagnement;Intervenant;${escCsv(intervenant)}`,
      `# Généré le;${new Date().toLocaleString('fr-FR')};Généré par;${escCsv(nomGenerateur(req.user))}`,
      `# Périmètre;Mois ${String(mois).padStart(2, '0')}/${annee} — statut : ${LIBELLES_STATUT[feuille.statut] || feuille.statut}`,
      `# Nombre de lignes;${feuille.lignes.length};Version de l'outil;${APP_VERSION}`,
      `# ${MENTION_OFFICIELLE}`,
      '',
    ].join('\n');

    const csv = '﻿' + meta + COLONNES.join(';') + '\n' + lignes.join('\n') + '\n' + pied.join('\n') + '\n';
    const nomFichier = `temps_${intervenant.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || `intervenant-${userId}`}_${annee}-${String(mois).padStart(2, '0')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
    res.send(csv);
  } catch (err) {
    console.error('[INSERTION][TEMPS] export :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

module.exports = router;
module.exports.LIBELLES_ACTIVITE = LIBELLES_ACTIVITE;
module.exports.COLONNES = COLONNES;
