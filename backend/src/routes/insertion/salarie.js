/**
 * Documents du salarié et rappels de rendez-vous (`/api/insertion/salarie`) — PR C, lot 7.
 *
 * ═══ CE QUE CETTE SURFACE TIENT ═══════════════════════════════════════════
 *
 *  1. DEUX DOCUMENTS COMPOSÉS POUR LA PERSONNE, en liste blanche côté serveur
 *     (`services/mon-parcours.js`) : « Mon parcours en une page » et « Mon
 *     Récap ». L'aperçu ne crée rien ; la génération enregistre un SNAPSHOT —
 *     ce qui a été remis le 12 mars reste ce qu'il était le 12 mars, alors que
 *     le dossier, lui, a changé depuis. Le front imprime DEPUIS ce snapshot et
 *     jamais depuis une recomposition : deux chemins produiraient deux
 *     documents qui divergeraient.
 *
 *  2. LA REMISE TRACÉE. Un document généré n'est pas un document remis. La
 *     trace dit quand et comment il l'a été, et refuse une seconde remise (409)
 *     — retracer, c'est réécrire l'histoire d'un geste déjà accompli ; un
 *     nouveau document se génère, il ne se re-remet pas.
 *
 *  3. LE CONSENTEMENT AUX RAPPELS, recueilli et RÉVOCABLE. Il vit à deux
 *     endroits qui ne se contredisent pas : les colonnes `employees.rappel_rdv_*`
 *     que le job lit, et `rgpd_consents` où l'écran RGPD les trouve avec tous
 *     les autres. Écrits dans la MÊME transaction : un consentement présent d'un
 *     côté et absent de l'autre serait pire que pas de consentement du tout.
 *
 * ═══ HABILITATIONS — ADMIN/RH STRICT ══════════════════════════════════════
 * Le routeur parent impose ADMIN/RH/MANAGER ; celui-ci resserre dès sa première
 * ligne, AVANT tout validateur et donc avant toute lecture en base. Ce n'est pas
 * de la prudence de principe : « Mon parcours » porte le référent unique (donc
 * l'orientation sociale de la personne) et ses heures hebdomadaires, le
 * consentement porte son numéro de téléphone PERSONNEL. C'est la même famille
 * de données que le dossier administratif de la PR A et le cadre RSA de la PR B.
 *
 * ═══ JOURNALISATION ═══════════════════════════════════════════════════════
 * Les lectures sont tracées en best-effort ; les gestes qui font SORTIR un
 * document (génération, remise) et le recueil du consentement sont BLOQUANTS et
 * écrits dans la transaction : si la trace échoue, le document n'existe pas.
 */

'use strict';

const express = require('express');
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { param } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { composerMonParcours, composerMonRecap } = require('../../services/mon-parcours');
const { masquerDestinataire } = require('../../services/rappels-rdv');
const { isoDate, aujourdhuiParis, decalerJours } = require('../../utils/date-iso');

const router = express.Router();
router.use(authorize('ADMIN', 'RH'));

const ID = [param('employeeId').isInt().withMessage('Identifiant de salarié invalide')];
const DOC_ID = [param('id').isInt().withMessage('Identifiant de document invalide')];
const JOUR_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Types de documents et modes de remise — miroirs des CHECK de la migration. */
const TYPES = { mon_parcours: composerMonParcours, mon_recap: composerMonRecap };
const MODES_REMISE = ['main_propre', 'email', 'courrier'];
const CANAUX = ['sms', 'email'];

/**
 * Numéro mobile français ou E.164. On accepte les séparateurs usuels (espaces,
 * points, tirets) : refuser « 06 12 34 56 78 » parce qu'il porte des espaces
 * ferait ressaisir la CIP sans rien protéger. `services/notification.js`
 * normalise ensuite en +33 avant l'appel à Brevo.
 */
const TEL_FR_RE = /^0[1-9](?:[\s.-]?\d{2}){4}$/;
const TEL_E164_RE = /^\+[1-9]\d{7,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/**
 * Journal RGPD — helper PARTAGÉ du module (utils/insertion-journal.js, contrat
 * 20 § 7) : `journaliser` tolérant pour les consultations d'écran,
 * `ecrireJournal(client, …)` bloquant, appelé DANS la transaction du geste qu'il
 * trace (génération, remise, consentement). Dédoublonné à l'intégration PR C.
 */
const { ecrireJournal: ecrireJournalPartage, journalPour } = require('../../utils/insertion-journal');
const journalSalarie = journalPour('insertion_salarie', '[INSERTION][SALARIE]');
const ecrireJournal = (db, req, action, employeeId, details) =>
  ecrireJournalPartage(db, req, action, employeeId, details, 'insertion_salarie');
const journaliser = (req, action, employeeId, details) =>
  journalSalarie.journaliser(pool, req, action, employeeId, details);

/** Parcours courant du salarié (repli 1), comme `cadre.js` et `rsa.js`. */
async function parcoursNum(employeeId) {
  try {
    const r = await pool.query('SELECT COALESCE(parcours_num, 1) AS n FROM employees WHERE id = $1', [employeeId]);
    return r.rows[0] ? Number(r.rows[0].n) || 1 : 1;
  } catch (_) { return 1; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Documents — aperçu, génération, historique, consultation, remise
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aperçu — compose à la volée et n'écrit RIEN dans la table des documents.
 * La journalisation reste tolérante : regarder ce qui SERAIT remis n'est pas
 * une remise (la doctrine bloquante vaut pour ce qui sort).
 */
function routeApercu(type, action) {
  return async (req, res) => {
    const employeeId = parseInt(req.params.employeeId, 10);
    try {
      const contenu = await TYPES[type]({ employeeId });
      if (!contenu) return res.status(404).json({ error: 'Salarié non trouvé' });
      await journaliser(req, action, employeeId, { type });
      res.json({ employee_id: employeeId, apercu: true, type, contenu });
    } catch (err) {
      console.error(`[INSERTION][SALARIE] Erreur aperçu ${type} :`, err.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

/**
 * Génération enregistrée — snapshot + trace, dans la MÊME transaction.
 *
 * `pool.connect()` est DANS le `try` (doctrine PR A constat M-04, reproduite en
 * PR B) : au-dehors, son rejet laisserait la requête sans réponse et finirait
 * par figer l'application.
 */
function routeGeneration(type) {
  return async (req, res) => {
    const employeeId = parseInt(req.params.employeeId, 10);
    try {
      const contenu = await TYPES[type]({ employeeId });
      if (!contenu) return res.status(404).json({ error: 'Salarié non trouvé' });
      const parcours = await parcoursNum(employeeId);

      let client;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        const ins = await client.query(
          `INSERT INTO insertion_documents_salarie (employee_id, parcours_num, type, contenu, genere_par)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, genere_le`,
          [employeeId, parcours, type, JSON.stringify(contenu), req.user.id]
        );
        // BLOQUANT : aucun try/catch. Un document remis à une personne sans
        // trace de sa production n'est pas un document, c'est une fuite.
        await ecrireJournal(client, req, 'INSERTION_DOC_SALARIE_GENERATION', employeeId, {
          document_id: ins.rows[0].id, type,
        });
        await client.query('COMMIT');
        res.status(201).json({ id: ins.rows[0].id, type, genere_le: ins.rows[0].genere_le, contenu });
      } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        if (client) client.release();
      }
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Documents du salarié indisponibles : base non migrée.' });
      }
      console.error(`[INSERTION][SALARIE] Erreur génération ${type} :`, err.message, err.code || '');
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

router.get('/:employeeId/mon-parcours', ID, validate, routeApercu('mon_parcours', 'INSERTION_DOC_SALARIE_APERCU'));
router.post('/:employeeId/mon-parcours', ID, validate, routeGeneration('mon_parcours'));
router.get('/:employeeId/mon-recap', ID, validate, routeApercu('mon_recap', 'INSERTION_DOC_SALARIE_APERCU'));
router.post('/:employeeId/mon-recap', ID, validate, routeGeneration('mon_recap'));

/**
 * Historique — SANS le contenu. Afficher la liste des documents produits ne
 * suppose pas de relire chacun d'eux, et dix snapshots complets à chaque
 * ouverture du panneau seraient payés pour rien.
 */
router.get('/:employeeId/documents', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const r = await pool.query(
      `SELECT d.id, d.type, d.parcours_num, d.genere_le, d.remis_le, d.remis_mode,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS genere_par_nom
         FROM insertion_documents_salarie d
         LEFT JOIN users u ON u.id = d.genere_par
        WHERE d.employee_id = $1
        ORDER BY d.genere_le DESC, d.id DESC`,
      [employeeId]
    );
    res.json(r.rows.map((d) => ({ ...d, remis_le: isoDate(d.remis_le) })));
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    console.error('[INSERTION][SALARIE] Erreur liste documents :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Contenu d'un document déjà produit — pour le réimprimer à l'identique.
 * Le `AND employee_id = $2` n'est pas décoratif : un identifiant de document
 * d'un autre salarié rend 404, jamais le document d'à côté.
 */
router.get('/:employeeId/documents/:id', [...ID, ...DOC_ID], validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const r = await pool.query(
      `SELECT id, type, parcours_num, contenu, genere_le, remis_le, remis_mode
         FROM insertion_documents_salarie
        WHERE id = $1 AND employee_id = $2`,
      [parseInt(req.params.id, 10), employeeId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Document non trouvé' });
    await journaliser(req, 'INSERTION_DOC_SALARIE_CONSULTATION', employeeId, {
      document_id: r.rows[0].id, type: r.rows[0].type,
    });
    res.json({ ...r.rows[0], remis_le: isoDate(r.rows[0].remis_le) });
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Document non trouvé' });
    console.error('[INSERTION][SALARIE] Erreur consultation document :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Trace de remise — BLOQUANTE et unique.
 *
 * Une date future est refusée : une remise à venir est une intention, pas une
 * remise. Le « demain » de la comparaison est le jour civil de PARIS (correctif
 * m-07 de la PR B) — sur un conteneur en UTC, une saisie faite le 1er à 01 h du
 * matin serait sinon refusée comme future.
 */
router.put('/:employeeId/documents/:id/remise', [...ID, ...DOC_ID], validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const documentId = parseInt(req.params.id, 10);
  const b = req.body || {};
  const remisLe = String(b.remis_le || '').trim();
  const mode = String(b.remis_mode || '').trim();

  if (!JOUR_RE.test(remisLe)) {
    return res.status(400).json({ error: 'Date de remise attendue au format AAAA-MM-JJ.' });
  }
  if (remisLe >= decalerJours(aujourdhuiParis(), 1)) {
    return res.status(400).json({ error: "Une date future ne peut pas attester d'une remise." });
  }
  if (!MODES_REMISE.includes(mode)) {
    return res.status(400).json({ error: `Mode de remise invalide (attendu : ${MODES_REMISE.join(', ')}).` });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const existant = await client.query(
      'SELECT id, type, remis_le FROM insertion_documents_salarie WHERE id = $1 AND employee_id = $2 FOR UPDATE',
      [documentId, employeeId]
    );
    if (existant.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document non trouvé' });
    }
    if (existant.rows[0].remis_le != null) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'La remise de ce document est déjà tracée.',
        code: 'REMISE_DEJA_TRACEE',
        hint: 'Pour une nouvelle remise, générez un document à jour — un document remis ne se re-remet pas.',
      });
    }
    const upd = await client.query(
      `UPDATE insertion_documents_salarie
          SET remis_le = $1::date, remis_mode = $2, remis_par = $3
        WHERE id = $4 AND employee_id = $5
        RETURNING id, type, remis_le, remis_mode`,
      [remisLe, mode, req.user.id, documentId, employeeId]
    );
    await ecrireJournal(client, req, 'INSERTION_DOC_SALARIE_REMISE', employeeId, {
      document_id: documentId, type: existant.rows[0].type, remis_mode: mode, remis_le: remisLe,
    });
    await client.query('COMMIT');
    res.json({ ...upd.rows[0], remis_le: isoDate(upd.rows[0].remis_le) });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err.code === '42P01') return res.status(404).json({ error: 'Document non trouvé' });
    console.error('[INSERTION][SALARIE] Erreur remise document :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    if (client) client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Consentement aux rappels de rendez-vous
// ═══════════════════════════════════════════════════════════════════════════

/**
 * État du consentement et contacts disponibles, tous MASQUÉS.
 *
 * L'écran propose de choisir parmi les contacts connus sans les afficher en
 * clair : la CIP vérifie de vive voix avec la personne (« c'est bien le 06 qui
 * finit par 12 ? »), ce qui suffit à choisir et évite de faire d'un écran de
 * consentement un annuaire de plus.
 */
router.get('/:employeeId/rappels-consentement', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const r = await pool.query(
      `SELECT e.rappel_rdv_consent AS consent, e.rappel_rdv_canal AS canal,
              e.rappel_rdv_destinataire AS destinataire, e.rappel_rdv_consent_at AS consent_at,
              e.phone, e.email, e.personal_email,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS consent_par_nom
         FROM employees e
         LEFT JOIN users u ON u.id = e.rappel_rdv_consent_by
        WHERE e.id = $1`,
      [employeeId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    const row = r.rows[0];
    res.json({
      consent: row.consent == null ? null : !!row.consent,
      canal: row.canal || null,
      destinataire_masque: row.destinataire ? masquerDestinataire(row.canal || 'sms', row.destinataire) : null,
      consent_at: row.consent_at || null,
      consent_par_nom: row.consent_par_nom || null,
      contacts_disponibles: {
        phone_masque: row.phone ? masquerDestinataire('sms', row.phone) : null,
        email_masque: row.email ? masquerDestinataire('email', row.email) : null,
        personal_email_masque: row.personal_email ? masquerDestinataire('email', row.personal_email) : null,
      },
    });
  } catch (err) {
    // Base non migrée : la colonne manque, l'écran doit pouvoir s'afficher et
    // dire « jamais demandé » plutôt que de tomber.
    if (err.code === '42703') {
      return res.json({
        consent: null, canal: null, destinataire_masque: null, consent_at: null, consent_par_nom: null,
        contacts_disponibles: { phone_masque: null, email_masque: null, personal_email_masque: null },
      });
    }
    console.error('[INSERTION][SALARIE] Erreur lecture consentement :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Recueil ou RETRAIT du consentement.
 *
 * Le retrait doit être aussi simple que l'accord (art. 7-3) : `{ consent: false }`
 * suffit, et il EFFACE le destinataire — garder un numéro dont on n'a plus le
 * droit de se servir n'aurait aucun fondement.
 *
 * Les colonnes `employees` et la ligne `rgpd_consents` sont écrites dans la
 * MÊME transaction, avec le journal : un consentement enregistré d'un côté et
 * pas de l'autre produirait un envoi sans preuve, ou une preuve sans envoi.
 */
router.put('/:employeeId/rappels-consentement', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  if (typeof b.consent !== 'boolean') {
    return res.status(400).json({ error: 'Le consentement doit valoir true (accord) ou false (retrait).' });
  }

  let canal = null;
  let destinataire = null;
  if (b.consent === true) {
    canal = String(b.canal || '').trim();
    if (!CANAUX.includes(canal)) {
      return res.status(400).json({ error: `Canal invalide (attendu : ${CANAUX.join(', ')}).` });
    }
    destinataire = String(b.destinataire == null ? '' : b.destinataire).trim();
    if (!destinataire) {
      return res.status(400).json({ error: 'Indiquez le numéro ou l’adresse choisis par la personne.' });
    }
    if (destinataire.length > 255) {
      return res.status(400).json({ error: 'Destinataire trop long.' });
    }
    const valide = canal === 'sms'
      ? (TEL_FR_RE.test(destinataire) || TEL_E164_RE.test(destinataire))
      : EMAIL_RE.test(destinataire);
    if (!valide) {
      return res.status(400).json({
        error: canal === 'sms'
          ? 'Numéro de téléphone invalide (attendu : 06 12 34 56 78 ou +33612345678).'
          : 'Adresse e-mail invalide.',
      });
    }
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE employees
          SET rappel_rdv_consent = $1, rappel_rdv_canal = $2, rappel_rdv_destinataire = $3,
              rappel_rdv_consent_at = NOW(), rappel_rdv_consent_by = $4
        WHERE id = $5
        RETURNING id, rappel_rdv_consent AS consent, rappel_rdv_canal AS canal, rappel_rdv_consent_at AS consent_at`,
      [b.consent, canal, destinataire, req.user.id, employeeId]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Salarié non trouvé' });
    }
    await client.query(
      `INSERT INTO rgpd_consents (entity_type, entity_id, consent_type, granted, recorded_by, updated_at)
       VALUES ('employee', $1, 'rappel_rdv', $2, $3, NOW())
       ON CONFLICT (entity_type, entity_id, consent_type)
       DO UPDATE SET granted = EXCLUDED.granted, recorded_by = EXCLUDED.recorded_by, updated_at = NOW()`,
      [employeeId, b.consent, req.user.id]
    );
    // BLOQUANT — c'est la preuve du recueil (ou du retrait) : sans elle, rien
    // n'atteste que la personne a été consultée.
    await ecrireJournal(client, req, 'INSERTION_RAPPEL_CONSENTEMENT', employeeId, {
      granted: b.consent,
      canal: canal || null,
      destinataire_masque: destinataire ? masquerDestinataire(canal, destinataire) : null,
    });
    await client.query('COMMIT');
    res.json({
      consent: upd.rows[0].consent,
      canal: upd.rows[0].canal || null,
      destinataire_masque: destinataire ? masquerDestinataire(canal, destinataire) : null,
      consent_at: upd.rows[0].consent_at,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err.code === '42703') {
      return res.status(503).json({ error: 'Rappels de rendez-vous indisponibles : base non migrée.' });
    }
    console.error('[INSERTION][SALARIE] Erreur consentement :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    if (client) client.release();
  }
});

/** Historique des rappels envoyés — destinataire masqué, jamais le contact. */
router.get('/:employeeId/rappels', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const r = await pool.query(
      `SELECT r.id, r.milestone_id, r.canal, r.destinataire_masque, r.statut, r.envoye_le
         FROM insertion_rappels_rdv r
        WHERE r.employee_id = $1
        ORDER BY r.envoye_le DESC, r.id DESC
        LIMIT 50`,
      [employeeId]
    );
    res.json(r.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    console.error('[INSERTION][SALARIE] Erreur historique rappels :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.MODES_REMISE = MODES_REMISE;
module.exports.CANAUX = CANAUX;
