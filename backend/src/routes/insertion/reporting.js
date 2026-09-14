/**
 * Reporting autorité — `/api/insertion/reporting` (PR D, lot 6).
 *
 * ═══ CE QUE CETTE SURFACE PRODUIT ═════════════════════════════════════════
 *
 * Un seul document : la **synthèse de dialogue de gestion** (export (e) de la
 * matrice de l'autorité), en quatre gestes distincts et volontairement séparés :
 *
 *   · `GET  /dialogue-gestion`            — APERÇU. On regarde avant d'envoyer.
 *     Journalisé (`…_APERCU`) mais TOLÉRANT : perdre la trace d'une lecture
 *     d'écran est regrettable, empêcher la direction de relire sa synthèse
 *     parce que le journal est indisponible serait pire.
 *   · `POST /dialogue-gestion`            — GÉNÉRATION ENREGISTRÉE (ADMIN/RH).
 *     Le contenu est figé en SNAPSHOT et la trace est BLOQUANTE : le document
 *     qui part vers l'autorité n'existe pas sans la ligne de journal qui dit
 *     qu'il a été produit. Snapshot et trace vivent dans la MÊME transaction.
 *   · `GET  /dialogue-gestion/historique` — la liste de ce qui a été produit.
 *   · `GET  /dialogue-gestion/:id`        — rejoue un snapshot TEL QU'IL ÉTAIT.
 *     C'est là toute la raison du snapshot : « qu'avons-nous transmis le
 *     15 janvier ? » n'a de réponse que si on l'a écrite, le dossier ayant
 *     changé depuis.
 *
 * ═══ POURQUOI LE MANAGER PEUT LIRE ════════════════════════════════════════
 *
 * Le contrat ouvre la synthèse à ADMIN/RH/MANAGER, et c'est tenable ici — et
 * ici SEULEMENT — parce qu'**aucune projection nominative n'existe dans ce
 * document** : pas de liste de personnes à retirer selon le rôle, pas de champ
 * à masquer. La composition elle-même est une liste blanche d'agrégats
 * (`services/dialogue-gestion.js`). L'ENREGISTREMENT, lui, reste ADMIN/RH : il
 * produit une pièce datée qui engage la structure vis-à-vis de son financeur.
 *
 * ═══ LE PDF EST COMPOSÉ CÔTÉ CLIENT, DEPUIS LE `contenu` ══════════════════
 * Le serveur ne rend jamais de PDF ici. Le navigateur compose le document à
 * partir de l'objet `contenu` — celui-là même qui a été enregistré — de sorte
 * qu'un snapshot rejoué imprime EXACTEMENT ce qui est parti, et non ce que le
 * dossier dit aujourd'hui.
 */

'use strict';

const express = require('express');
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { query, param, body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { composerDialogueGestion, aplatirEnLignes, MENTION, APP_VERSION } = require('../../services/dialogue-gestion');
const { escCsv } = require('../../utils/export-csv');
const { journalPour } = require('../../utils/insertion-journal');

const router = express.Router();

/**
 * Journal RGPD de la surface. `journaliser` est TOLÉRANT (consultation
 * d'écran) ; `journaliserDocument` est BLOQUANT — aucun try/catch : l'erreur
 * remonte au `catch` de la route, qui rend 500, et le document ne part pas sans
 * sa trace (même doctrine que les fiches transmises au référent, PR B).
 */
const { journaliser, journaliserDocument } = journalPour('insertion_reporting', '[INSERTION][REPORTING]');

const ANNEE_MIN = 2000;
const ANNEE_MAX = 2100;

const VALIDATEURS_PERIODE = [
  query('annee').optional().isInt({ min: ANNEE_MIN, max: ANNEE_MAX }).withMessage('annee invalide'),
  query('trimestre').optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1, max: 4 }).withMessage('trimestre invalide (1 à 4)'),
];

/** Année demandée, ou l'année civile en cours. */
const anneeDe = (req) => parseInt(req.query.annee, 10) || new Date().getFullYear();
const trimestreDe = (req) => {
  const t = parseInt(req.query.trimestre, 10);
  return Number.isFinite(t) && t >= 1 && t <= 4 ? t : null;
};

/**
 * Détails NON NOMINATIFS d'une trace. On dit QUE le document a été produit et
 * sur QUELLE période — jamais ce qu'il contient. Un journal qui recopierait le
 * contenu deviendrait une seconde copie de ce qu'il protège.
 */
const detailsTrace = (annee, trimestre, extra = {}) => ({
  annee, trimestre, ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /dialogue-gestion — aperçu (ADMIN/RH/MANAGER), JSON ou CSV
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dialogue-gestion', [
  ...VALIDATEURS_PERIODE,
  query('format').optional().isIn(['json', 'csv']).withMessage('format invalide (json ou csv)'),
], validate, async (req, res) => {
  const annee = anneeDe(req);
  const trimestre = trimestreDe(req);
  const format = (req.query.format || 'json').toLowerCase();
  try {
    const synthese = await composerDialogueGestion({ annee, trimestre, user: req.user });

    if (format === 'csv') {
      // EXPORT : les trois règles communes de l'autorité s'appliquent ici et
      // non à l'aperçu JSON — c'est le FICHIER qui sort de la structure.
      //  1. zéro donnée → 409 motivé, jamais un fichier vide ;
      //  2. journal BLOQUANT écrit AVANT l'envoi ;
      //  3. en-tête de traçabilité, neutralisation des formules, cellule vide.
      const vide = estVide(synthese);
      if (vide) {
        return res.status(409).json({
          error: `Aucune donnée d'insertion sur ${libellePeriode(annee, trimestre)} — aucun fichier n'est produit.`,
          code: 'EXPORT_VIDE',
          hint: "Vérifiez l'année demandée, ou saisissez les fins de parcours et les dossiers de la période avant de générer la synthèse.",
        });
      }
      await journaliserDocument(pool, req, 'EXPORT_DIALOGUE_GESTION', null,
        detailsTrace(annee, trimestre, { format: 'csv', lignes: null }));
      return envoyerCsv(res, synthese, annee, trimestre, req);
    }

    await journaliser(pool, req, 'INSERTION_DIALOGUE_GESTION_APERCU', null,
      detailsTrace(annee, trimestre, { sous_seuil: synthese.sous_seuil.length }));
    return res.json(synthese);
  } catch (err) {
    console.error('[INSERTION][REPORTING] dialogue-gestion :', err.message, err.code || '');
    return res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /dialogue-gestion/historique — les générations enregistrées
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dialogue-gestion/historique', [
  query('annee').optional().isInt({ min: ANNEE_MIN, max: ANNEE_MAX }).withMessage('annee invalide'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit invalide'),
], validate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 25;
    const params = [limit];
    let filtre = '';
    if (req.query.annee) { params.push(parseInt(req.query.annee, 10)); filtre = ' WHERE d.annee = $2'; }
    // Le PRÉNOM et l'INITIALE du générateur, jamais le nom complet : l'autorité
    // veut savoir à quel titre le document a été produit, pas recevoir un
    // répertoire du personnel.
    const r = await pool.query(
      `SELECT d.id, d.annee, d.trimestre, d.genere_le, d.version_application,
              u.first_name AS genere_prenom, LEFT(COALESCE(u.last_name, ''), 1) AS genere_initiale,
              u.role AS genere_role
       FROM insertion_dialogues_gestion d
       LEFT JOIN users u ON u.id = d.genere_par${filtre}
       ORDER BY d.genere_le DESC
       LIMIT $1`, params
    );
    res.json(r.rows.map((row) => ({
      id: row.id,
      annee: row.annee,
      trimestre: row.trimestre,
      genere_le: row.genere_le,
      version: row.version_application,
      genere_par: row.genere_prenom
        ? `${row.genere_prenom} ${row.genere_initiale ? `${row.genere_initiale}.` : ''}`.trim()
        : null,
      genere_par_role: row.genere_role || null,
      type: row.trimestre ? 'trimestrielle_allegee' : 'annuelle',
    })));
  } catch (err) {
    console.error('[INSERTION][REPORTING] historique :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /dialogue-gestion/:id — rejoue un snapshot TEL QU'IL ÉTAIT
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dialogue-gestion/:id', [
  param('id').isInt().withMessage('Identifiant invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, annee, trimestre, contenu, genere_le, version_application
       FROM insertion_dialogues_gestion WHERE id = $1`, [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Synthèse introuvable' });
    const row = r.rows[0];
    await journaliser(pool, req, 'INSERTION_DIALOGUE_GESTION_CONSULTATION', null,
      detailsTrace(row.annee, row.trimestre, { snapshot_id: row.id }));
    res.json({
      id: row.id, annee: row.annee, trimestre: row.trimestre,
      genere_le: row.genere_le, version: row.version_application,
      ...(row.contenu || {}),
    });
  } catch (err) {
    console.error('[INSERTION][REPORTING] snapshot :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /dialogue-gestion — génération ENREGISTRÉE (ADMIN/RH)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/dialogue-gestion', authorize('ADMIN', 'RH'), [
  body('annee').optional().isInt({ min: ANNEE_MIN, max: ANNEE_MAX }).withMessage('annee invalide'),
  body('trimestre').optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1, max: 4 }).withMessage('trimestre invalide (1 à 4)'),
], validate, async (req, res) => {
  const annee = parseInt(req.body?.annee, 10) || new Date().getFullYear();
  const tRaw = parseInt(req.body?.trimestre, 10);
  const trimestre = Number.isFinite(tRaw) && tRaw >= 1 && tRaw <= 4 ? tRaw : null;

  // `pool.connect()` DANS le try : posé au-dessus, un pool indisponible laisse
  // la requête sans réponse et fuit une connexion (défaut D-04 de la PR A,
  // retrouvé à l'identique en PR B).
  let client;
  try {
    const synthese = await composerDialogueGestion({ annee, trimestre, user: req.user });
    if (estVide(synthese)) {
      return res.status(409).json({
        error: `Aucune donnée d'insertion sur ${libellePeriode(annee, trimestre)} — aucune synthèse n'est enregistrée.`,
        code: 'EXPORT_VIDE',
        hint: "Une synthèse vide classée dans un dossier se lit « aucune activité », ce qui serait faux. Vérifiez l'année demandée.",
      });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO insertion_dialogues_gestion (annee, trimestre, contenu, genere_par, version_application)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, genere_le`,
      [annee, trimestre, JSON.stringify(synthese), req.user?.id ?? null, APP_VERSION]
    );
    // Trace BLOQUANTE, DANS la transaction : le snapshot et sa preuve tombent
    // ou passent ensemble.
    await journaliserDocument(client, req, 'INSERTION_DIALOGUE_GESTION_GENERATION', null,
      detailsTrace(annee, trimestre, { snapshot_id: ins.rows[0].id, sous_seuil: synthese.sous_seuil.length }));
    await client.query('COMMIT');

    res.status(201).json({
      id: ins.rows[0].id,
      genere_le: ins.rows[0].genere_le,
      contenu: synthese,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION][REPORTING] génération :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  } finally {
    if (client) client.release();
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Outils locaux
// ───────────────────────────────────────────────────────────────────────────

/**
 * Une synthèse est VIDE quand la période ne porte ni cohorte ni fin de parcours
 * — c'est-à-dire quand le document ne dirait rien. Un fichier vide classé dans
 * un dossier se lit « aucune activité », ce qui serait faux : on refuse, avec
 * un motif.
 */
function estVide(synthese) {
  const b = (synthese && synthese.blocs) || {};
  const cohorte = b['2_publics_entree'] && !b['2_publics_entree'].indisponible
    ? Number(b['2_publics_entree'].effectif) || 0 : 0;
  const fins = b['6_sorties'] && b['6_sorties'].methode_b
    ? Number(b['6_sorties'].methode_b.denominateur) || 0 : 0;
  const bilans = b['6_sorties'] && b['6_sorties'].methode_a_interne
    ? Number(b['6_sorties'].methode_a_interne.denominateur) || 0 : 0;
  return cohorte === 0 && fins === 0 && bilans === 0;
}

const libellePeriode = (annee, trimestre) => (trimestre ? `le T${trimestre} ${annee}` : `l'année ${annee}`);

/**
 * CSV à trois colonnes (`Bloc ; Indicateur ; Valeur`), précédé de l'en-tête de
 * traçabilité en lignes commentées — même forme que l'export FSE+ participants,
 * pour que l'instructrice retrouve la même chose en tête de tous nos fichiers.
 */
function envoyerCsv(res, synthese, annee, trimestre, req) {
  const lignes = aplatirEnLignes(synthese);
  const e = synthese.en_tete || {};
  const meta = [
    `# Export;Synthèse de dialogue de gestion;Période;${trimestre ? `${annee} T${trimestre} (version allégée)` : `Année ${annee}`}`,
    `# Généré le;${new Date().toLocaleString('fr-FR')};Généré par (rôle);${escCsv(req.user?.role || '')}`,
    `# Périmètre;${escCsv(e.perimetre || '')}`,
    `# Nombre de lignes;${lignes.length};Version de l'outil;${escCsv(e.version || APP_VERSION)}`,
    `# Méthode;Les règles de calcul de chaque indicateur figurent dans le bloc « 9. Méthode » de ce fichier`,
    `# ${MENTION}`,
    "# Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE+) font foi",
    '',
  ].join('\n');

  const corps = lignes.map((l) => l.map((c) => escCsv(c)).join(';')).join('\n');
  const csv = '﻿' + meta + 'Bloc;Indicateur;Valeur\n' + corps + '\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="dialogue-gestion_${annee}${trimestre ? `_T${trimestre}` : ''}.csv"`);
  return res.send(csv);
}

module.exports = router;
module.exports.estVide = estVide;
