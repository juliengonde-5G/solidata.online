/**
 * Module Achats responsables (RSEI-17) — 31e module de l'ERP.
 *
 * Outille la démarche d'achats responsables (critère RSEi 1.7). Cadrage :
 * rapports/rsei-2026-07-22/03-plan-action-rsei.md §2.3 (RSEI-17).
 *   (a) mini-référentiel FOURNISSEURS + statut (local / inclusif / démarche RSE /
 *       labellisé) ; un fournisseur « responsable » = AU MOINS un des 4 drapeaux à
 *       true (calcul applicatif `isResponsable`, verrouillé par les tests) ;
 *   (b) CRITÈRES d'achat par famille (administrables) ;
 *   (c) registre des FDS (fiches de données de sécurité) des produits dangereux
 *       (upload/download, pattern Refashion / rsei_preuves) ;
 *   (d) rapprochement CLASSE 60 du Grand Livre (financial_gl_entries, Pennylane
 *       pull) pour estimer la PART D'ACHATS RESPONSABLES (1.7 N3).
 *
 * DOCTRINE « JAMAIS DE VALEUR INVENTÉE » : la part en MONTANT n'est calculée que si
 * le total classe 60 est disponible (Grand Livre synchronisé OU setting de
 * référence) ET qu'au moins un fournisseur responsable a pu être rapproché d'un
 * tiers du Grand Livre. Sinon `part_montant_pct: null` avec `part_source:
 * 'indisponible'`. La part en NOMBRE de fournisseurs reste toujours disponible.
 *
 * HABILITATIONS
 *  - Lecture  : ADMIN / MANAGER / RH / QHSE (le référent REF_RSE hérite de MANAGER ;
 *    QHSE consulte les FDS des produits dangereux qu'il pilote).
 *  - Écriture : ADMIN / RH / MANAGER (REF_RSE=MANAGER tient le référentiel).
 *  NB : QHSE est ajouté À LA LECTURE (cohérence avec le module Enquêtes) ; la
 *  visibilité fine se règle dans la matrice /admin/permissions (module 'achats').
 *
 * CONFIDENTIALITÉ : données FOURNISSEURS (personnes morales), NON NOMINATIVES —
 * aucune donnée de salarié/parcours. Registre RGPD « Achats responsables ».
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { documentFilter } = require('../utils/upload-filters');
const { autoLogActivity } = require('../middleware/activity-logger');

const CATEGORIES = ['fournitures', 'epi', 'transport', 'prestations', 'energie', 'alimentaire', 'autre'];
const FDS_FRAICHEUR_DEFAUT = 365; // jours ; setting `achats.fds_fraicheur_jours` surcharge.

// Stockage des pièces jointes FDS (pattern Refashion / rsei_preuves).
const fdsDir = path.join(__dirname, '..', '..', 'uploads', 'achats-fds');
try { fs.mkdirSync(fdsDir, { recursive: true }); } catch (e) { /* ignore */ }
const uploadFds = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, fdsDir),
    filename: (req, file, cb) => cb(null, `fds${req.params.id}-${Date.now()}${path.extname(file.originalname || '').toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: documentFilter,
});

router.use(authenticate);
router.use(autoLogActivity('achats'));

const READ = authorize('ADMIN', 'MANAGER', 'RH', 'QHSE');
const WRITE = authorize('ADMIN', 'RH', 'MANAGER');

// ───────────────────────────────────────────────────────────────────────────
// ORACLES DE CALCUL (spécifications exécutables, verrouillées par les tests) —
// exposés sur le router (comme energie.computeConsommation100km).
// ───────────────────────────────────────────────────────────────────────────

// Un fournisseur est « responsable » ssi AU MOINS un des 4 drapeaux est vrai.
function isResponsable(f) {
  return !!(f && (f.local || f.inclusif || f.demarche_rse || f.labellise));
}

// Normalise un libellé (fournisseur / tiers Grand Livre) pour un rapprochement
// par ÉGALITÉ (accents/casse/ponctuation/espaces neutralisés). Volontairement
// STRICT (égalité normalisée, pas de fuzzy) : sous-estime plutôt que de sur-compter
// → borne basse honnête, cohérent avec « jamais de valeur inventée ».
function normalizeName(s) {
  if (s == null) return '';
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Agrège le registre FDS : produits dangereux À TRAITER (document non joint, sans
// date, ou FDS périmée au regard du seuil de fraîcheur). Le module ne « connaît »
// que les FDS déclarées : il signale celles qui manquent d'une pièce ou d'une date,
// et celles périmées — il n'invente pas de produits dangereux non déclarés.
// @param {Array} rows lignes { id, produit, reference, date_fds, date_revision,
//   has_fichier, dangers, fournisseur_nom }
// @param {number} fraicheurJours seuil de fraîcheur (défaut 365)
function aggregateFds(rows, fraicheurJours, today = new Date()) {
  const seuilJours = Number(fraicheurJours) > 0 ? Number(fraicheurJours) : FDS_FRAICHEUR_DEFAUT;
  const limiteT = today.getTime() - seuilJours * 86400000;
  let total = 0, sansFichier = 0, sansDate = 0, perimees = 0;
  const aTraiter = [];
  for (const d of rows || []) {
    total += 1;
    const hasFichier = !!d.has_fichier;
    const refDate = d.date_revision || d.date_fds || null;
    const refT = refDate ? new Date(refDate).getTime() : null;
    const sf = !hasFichier;
    const sd = !d.date_fds && !d.date_revision;
    const pe = refT != null && Number.isFinite(refT) && refT < limiteT;
    if (sf) sansFichier += 1;
    if (sd) sansDate += 1;
    if (pe) perimees += 1;
    if (sf || sd || pe) {
      const motifs = [];
      if (sf) motifs.push('document FDS non joint');
      if (sd) motifs.push('aucune date de FDS/révision');
      if (pe) motifs.push('FDS périmée');
      aTraiter.push({
        id: d.id, produit: d.produit, fournisseur_nom: d.fournisseur_nom || null,
        reference: d.reference || null, dangers: d.dangers || null,
        date_fds: d.date_fds || null, date_revision: d.date_revision || null,
        has_fichier: hasFichier, motif: motifs.join(', '),
      });
    }
  }
  return {
    total, sans_fichier: sansFichier, sans_date: sansDate, perimees,
    a_traiter: aTraiter.length, fraicheur_jours: seuilJours,
    liste_a_traiter: aTraiter.slice(0, 100),
  };
}

// Exécute une sous-requête « best effort » : toute erreur (table/colonne absente
// sur une base non migrée) dégrade en fallback sans casser l'agrégat (dashboard).
async function soft(fn, fallback) {
  try { return await fn(); } catch (err) {
    console.error('[ACHATS] sous-requête ignorée :', err.message);
    return fallback;
  }
}

// Lit une valeur de la table settings (clé/valeur). Renvoie null si absente.
async function readSetting(key) {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return r.rows[0] ? r.rows[0].value : null;
  } catch (_) { return null; }
}

/**
 * Rapprochement CLASSE 60 du Grand Livre → part d'achats responsables en montant.
 *
 * DÉNOMINATEUR (total classe 60), par ordre de priorité :
 *   1. setting `achats.montant_reference_<annee>` (montant épinglé) ;
 *   2. setting `achats.montant_reference_annee` (générique) ;
 *   3. comptes 60 du Grand Livre (financial_gl_entries JOIN financial_exercises) ;
 *   sinon → total null, source 'indisponible'.
 *
 * NUMÉRATEUR (montant des fournisseurs responsables) : rapprochement des tiers de
 * la classe 60 du Grand Livre avec les noms des fournisseurs responsables du
 * référentiel (égalité normalisée). Tenté UNIQUEMENT si le total vient du GL (on a
 * alors accès aux montants par tiers). Sinon indisponible.
 *
 * PART : montant_responsables / total_classe_60 — calculée SEULEMENT si les deux
 * sont disponibles ET qu'au moins un fournisseur a été rapproché. Sinon null.
 */
async function computeMontantRapprochement(annee) {
  const parse = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : null; };

  let total = null;
  let totalSource = 'indisponible';
  const sPin = parse(await readSetting(`achats.montant_reference_${annee}`));
  const sGen = sPin == null ? parse(await readSetting('achats.montant_reference_annee')) : null;
  if (sPin != null) { total = sPin; totalSource = 'settings'; }
  else if (sGen != null) { total = sGen; totalSource = 'settings'; }
  else {
    const gl = await soft(async () => {
      const r = await pool.query(
        `SELECT COALESCE(SUM(g.debit - g.credit), 0)::float AS total
         FROM financial_gl_entries g JOIN financial_exercises e ON g.exercise_id = e.id
         WHERE e.year = $1 AND g.account LIKE '60%'`, [annee]);
      return parse(r.rows[0] && r.rows[0].total);
    }, null);
    if (gl != null && gl > 0) { total = gl; totalSource = 'gl'; }
  }

  let montantResp = null;
  let montantSource = 'indisponible';
  let nbRapproches = 0;
  if (totalSource === 'gl') {
    const data = await soft(async () => {
      const tiers = await pool.query(
        `SELECT g.third_party AS tiers, COALESCE(SUM(g.debit - g.credit), 0)::float AS montant
         FROM financial_gl_entries g JOIN financial_exercises e ON g.exercise_id = e.id
         WHERE e.year = $1 AND g.account LIKE '60%' AND g.third_party IS NOT NULL AND g.third_party <> ''
         GROUP BY g.third_party`, [annee]);
      const fournisseurs = await pool.query(
        `SELECT nom FROM achats_fournisseurs f
         WHERE (f.local OR f.inclusif OR f.demarche_rse OR f.labellise)`);
      return { tiers: tiers.rows, fournisseurs: fournisseurs.rows };
    }, null);
    if (data) {
      const montantParTiers = new Map();
      for (const t of data.tiers) {
        const k = normalizeName(t.tiers);
        if (k) montantParTiers.set(k, (montantParTiers.get(k) || 0) + (Number(t.montant) || 0));
      }
      let somme = 0;
      const rapproches = new Set();
      for (const f of data.fournisseurs) {
        const k = normalizeName(f.nom);
        if (k && montantParTiers.has(k) && !rapproches.has(k)) {
          somme += montantParTiers.get(k);
          rapproches.add(k);
        }
      }
      nbRapproches = rapproches.size;
      if (nbRapproches > 0) {
        montantResp = Math.round(somme * 100) / 100;
        montantSource = 'gl_tiers_match';
      }
    }
  }

  const partMontant = (total != null && total > 0 && montantResp != null)
    ? Math.round((montantResp / total) * 1000) / 10 // % à 1 décimale
    : null;

  let note;
  if (partMontant != null) {
    note = 'Estimation par rapprochement des tiers du Grand Livre (comptes 60) avec les noms des fournisseurs responsables du référentiel. Borne basse : un fournisseur dont le libellé de tiers diffère n\'est pas rapproché.';
  } else if (totalSource === 'indisponible') {
    note = 'Part en montant indisponible : total des achats (classe 60) non disponible. Synchronisez le Grand Livre (Pennylane) ou saisissez le setting achats.montant_reference_annee.';
  } else {
    note = 'Total des achats (classe 60) disponible, mais aucun fournisseur responsable n\'a pu être rapproché des tiers du Grand Livre : part en montant indisponible.';
  }

  return {
    annee,
    total_classe_60: total,
    total_source: totalSource, // 'settings' | 'gl' | 'indisponible'
    montant_responsables: montantResp,
    montant_source: montantSource, // 'gl_tiers_match' | 'indisponible'
    fournisseurs_rapproches: nbRapproches,
    part_montant_pct: partMontant, // null = jamais inventé
    part_source: partMontant != null ? 'estimation_gl' : 'indisponible',
    note,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLEAU DE BORD — déclaré AVANT les routes paramétrées.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dashboard', READ, [query('annee').optional().isInt({ min: 2000, max: 2100 })], validate, async (req, res) => {
  try {
    const annee = parseInt(req.query.annee, 10) || new Date().getFullYear();

    // Fournisseurs — comptages par statut.
    const DEF_F = { total: 0, actifs: 0, local: 0, inclusif: 0, demarche_rse: 0, labellise: 0, responsables: 0 };
    const fRow = await soft(async () => (await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE f.actif)::int AS actifs,
              COUNT(*) FILTER (WHERE f.local)::int AS local,
              COUNT(*) FILTER (WHERE f.inclusif)::int AS inclusif,
              COUNT(*) FILTER (WHERE f.demarche_rse)::int AS demarche_rse,
              COUNT(*) FILTER (WHERE f.labellise)::int AS labellise,
              COUNT(*) FILTER (WHERE f.local OR f.inclusif OR f.demarche_rse OR f.labellise)::int AS responsables
       FROM achats_fournisseurs f`)).rows[0] || DEF_F, DEF_F);
    const totalF = fRow.total || 0;
    const responsablesF = fRow.responsables || 0;

    const parFamille = await soft(async () => (await pool.query(
      `SELECT f.categorie AS famille, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE f.local OR f.inclusif OR f.demarche_rse OR f.labellise)::int AS responsables
       FROM achats_fournisseurs f
       GROUP BY f.categorie ORDER BY f.categorie`)).rows, []);

    // Critères d'achat actifs, regroupés par famille.
    const criteres = await soft(async () => (await pool.query(
      `SELECT id, famille, critere, poids FROM achats_criteres WHERE actif = true ORDER BY famille, id`)).rows, []);
    const criteresParFamille = {};
    for (const c of criteres) { (criteresParFamille[c.famille] = criteresParFamille[c.famille] || []).push(c); }

    // FDS — seuil de fraîcheur paramétrable, agrégat côté serveur (testable).
    const seuil = parseInt(await readSetting('achats.fds_fraicheur_jours'), 10);
    const fraicheur = Number.isFinite(seuil) && seuil > 0 ? seuil : FDS_FRAICHEUR_DEFAUT;
    const fdsRows = await soft(async () => (await pool.query(
      `SELECT d.id, d.produit, d.reference, d.date_fds, d.date_revision, d.dangers,
              (d.fichier_path IS NOT NULL) AS has_fichier, f.nom AS fournisseur_nom
       FROM achats_fds d LEFT JOIN achats_fournisseurs f ON f.id = d.fournisseur_id
       ORDER BY d.produit, d.id`)).rows, []);
    const fds = aggregateFds(fdsRows, fraicheur);

    // Rapprochement classe 60 (soft, jamais de valeur inventée).
    const montant = await computeMontantRapprochement(annee);

    res.json({
      generated_at: new Date().toISOString(),
      annee,
      fournisseurs: {
        total: totalF,
        actifs: fRow.actifs || 0,
        local: fRow.local || 0,
        inclusif: fRow.inclusif || 0,
        demarche_rse: fRow.demarche_rse || 0,
        labellise: fRow.labellise || 0,
        responsables: responsablesF,
        part_responsables_pct: totalF ? Math.round((responsablesF / totalF) * 100) : null,
        par_famille: parFamille,
      },
      criteres: { total: criteres.length, par_famille: criteresParFamille },
      fds,
      montant,
    });
  } catch (err) {
    console.error('[ACHATS] GET dashboard :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// FOURNISSEURS — ?famille=&responsable=1
// ───────────────────────────────────────────────────────────────────────────
router.get('/fournisseurs', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.famille && CATEGORIES.includes(req.query.famille)) {
      params.push(req.query.famille); conds.push(`f.categorie = $${params.length}`);
    }
    if (req.query.responsable === '1') {
      conds.push('(f.local OR f.inclusif OR f.demarche_rse OR f.labellise)');
    }
    if (req.query.actif === '1' || req.query.actif === '0') {
      params.push(req.query.actif === '1'); conds.push(`f.actif = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT f.*, (f.local OR f.inclusif OR f.demarche_rse OR f.labellise) AS responsable
       FROM achats_fournisseurs f ${where}
       ORDER BY f.actif DESC, f.nom`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ACHATS] GET fournisseurs :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/fournisseurs', WRITE, [
  body('nom').isString().trim().notEmpty(),
  body('siret').optional({ nullable: true }).isString().isLength({ max: 20 }),
  body('categorie').optional().isIn(CATEGORIES),
  body('local').optional().isBoolean(),
  body('inclusif').optional().isBoolean(),
  body('demarche_rse').optional().isBoolean(),
  body('labellise').optional().isBoolean(),
  body('label_detail').optional({ nullable: true }).isString(),
  body('commune').optional({ nullable: true }).isString(),
  body('actif').optional().isBoolean(),
  body('notes').optional({ nullable: true }).isString(),
], validate, async (req, res) => {
  try {
    const {
      nom, siret = null, categorie = 'autre', local = false, inclusif = false,
      demarche_rse = false, labellise = false, label_detail = null, commune = null,
      actif = true, notes = null,
    } = req.body;
    const r = await pool.query(
      `INSERT INTO achats_fournisseurs
         (nom, siret, categorie, local, inclusif, demarche_rse, labellise, label_detail, commune, actif, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *, (local OR inclusif OR demarche_rse OR labellise) AS responsable`,
      [nom.trim(), siret, categorie, local, inclusif, demarche_rse, labellise, label_detail, commune, actif, notes, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[ACHATS] POST fournisseur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/fournisseurs/:id', WRITE, [
  param('id').isInt(),
  body('nom').optional().isString().trim().notEmpty(),
  body('categorie').optional().isIn(CATEGORIES),
  body('local').optional().isBoolean(),
  body('inclusif').optional().isBoolean(),
  body('demarche_rse').optional().isBoolean(),
  body('labellise').optional().isBoolean(),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const fields = ['nom', 'siret', 'categorie', 'local', 'inclusif', 'demarche_rse', 'labellise', 'label_detail', 'commune', 'actif', 'notes'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE achats_fournisseurs SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING *, (local OR inclusif OR demarche_rse OR labellise) AS responsable`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Fournisseur introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ACHATS] PUT fournisseur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/fournisseurs/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    // Les FDS liées passent à fournisseur_id NULL (ON DELETE SET NULL) : la
    // traçabilité FDS survit à la suppression d'un fournisseur.
    const r = await pool.query('DELETE FROM achats_fournisseurs WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Fournisseur introuvable' });
    res.json({ message: 'Fournisseur supprimé', id: r.rows[0].id });
  } catch (err) {
    console.error('[ACHATS] DELETE fournisseur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// CRITÈRES D'ACHAT — ?famille=
// ───────────────────────────────────────────────────────────────────────────
router.get('/criteres', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.famille) {
      params.push(req.query.famille); conds.push(`famille = $${params.length}`);
    }
    if (req.query.actif === '1' || req.query.actif === '0') {
      params.push(req.query.actif === '1'); conds.push(`actif = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT * FROM achats_criteres ${where} ORDER BY famille, id`, params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ACHATS] GET criteres :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/criteres', WRITE, [
  body('famille').optional({ nullable: true }).isString().isLength({ max: 30 }),
  body('critere').isString().trim().notEmpty(),
  body('poids').optional({ nullable: true }).isInt({ min: 0, max: 100 }),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const { famille = 'transverse', critere, poids = null, actif = true } = req.body;
    const r = await pool.query(
      `INSERT INTO achats_criteres (famille, critere, poids, actif) VALUES ($1, $2, $3, $4) RETURNING *`,
      [(famille || 'transverse').trim() || 'transverse', critere.trim(), poids, actif]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce critère existe déjà pour cette famille' });
    console.error('[ACHATS] POST critere :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/criteres/:id', WRITE, [
  param('id').isInt(),
  body('critere').optional().isString().trim().notEmpty(),
  body('poids').optional({ nullable: true }).isInt({ min: 0, max: 100 }),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const fields = ['famille', 'critere', 'poids', 'actif'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE achats_criteres SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Critère introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce critère existe déjà pour cette famille' });
    console.error('[ACHATS] PUT critere :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/criteres/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM achats_criteres WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Critère introuvable' });
    res.json({ message: 'Critère supprimé', id: r.rows[0].id });
  } catch (err) {
    console.error('[ACHATS] DELETE critere :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// REGISTRE DES FDS — ?fournisseur_id=
// ───────────────────────────────────────────────────────────────────────────
router.get('/fds', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.fournisseur_id) {
      params.push(parseInt(req.query.fournisseur_id, 10)); conds.push(`d.fournisseur_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT d.id, d.produit, d.fournisseur_id, d.reference, d.date_fds, d.date_revision,
              d.dangers, d.epi_requis, d.created_at, d.updated_at,
              (d.fichier_path IS NOT NULL) AS has_fichier, d.fichier_original_name,
              f.nom AS fournisseur_nom
       FROM achats_fds d LEFT JOIN achats_fournisseurs f ON f.id = d.fournisseur_id
       ${where}
       ORDER BY d.produit, d.id`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ACHATS] GET fds :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/fds', WRITE, [
  body('produit').isString().trim().notEmpty(),
  body('fournisseur_id').optional({ nullable: true }).isInt(),
  body('reference').optional({ nullable: true }).isString(),
  body('date_fds').optional({ nullable: true }).isISO8601(),
  body('date_revision').optional({ nullable: true }).isISO8601(),
  body('dangers').optional({ nullable: true }).isString(),
  body('epi_requis').optional({ nullable: true }).isString(),
], validate, async (req, res) => {
  try {
    const {
      produit, fournisseur_id = null, reference = null, date_fds = null,
      date_revision = null, dangers = null, epi_requis = null,
    } = req.body;
    const r = await pool.query(
      `INSERT INTO achats_fds (produit, fournisseur_id, reference, date_fds, date_revision, dangers, epi_requis, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *, (fichier_path IS NOT NULL) AS has_fichier`,
      [produit.trim(), fournisseur_id, reference, date_fds, date_revision, dangers, epi_requis, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Fournisseur inconnu' });
    console.error('[ACHATS] POST fds :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/fds/:id', WRITE, [
  param('id').isInt(),
  body('produit').optional().isString().trim().notEmpty(),
  body('fournisseur_id').optional({ nullable: true }).isInt(),
  body('date_fds').optional({ nullable: true }).isISO8601(),
  body('date_revision').optional({ nullable: true }).isISO8601(),
], validate, async (req, res) => {
  try {
    const fields = ['produit', 'fournisseur_id', 'reference', 'date_fds', 'date_revision', 'dangers', 'epi_requis'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE achats_fds SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
       RETURNING *, (fichier_path IS NOT NULL) AS has_fichier`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'FDS introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Fournisseur inconnu' });
    console.error('[ACHATS] PUT fds :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/fds/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM achats_fds WHERE id = $1 RETURNING id, fichier_path', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'FDS introuvable' });
    if (r.rows[0].fichier_path) {
      try { fs.unlinkSync(path.join(fdsDir, path.basename(r.rows[0].fichier_path))); } catch (_) {}
    }
    res.json({ message: 'FDS supprimée', id: r.rows[0].id });
  } catch (err) {
    console.error('[ACHATS] DELETE fds :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/achats/fds/:id/fichier — joindre la FDS (upload, pattern Refashion).
router.post('/fds/:id/fichier', WRITE, uploadFds.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis (pdf, image ou document)' });
    const before = await pool.query('SELECT fichier_path FROM achats_fds WHERE id = $1', [req.params.id]);
    if (before.rowCount === 0) {
      try { fs.unlinkSync(path.join(fdsDir, req.file.filename)); } catch (_) {}
      return res.status(404).json({ error: 'FDS introuvable' });
    }
    const ancien = before.rows[0].fichier_path;
    let r;
    try {
      r = await pool.query(
        `UPDATE achats_fds
           SET fichier_path = $1, fichier_original_name = $2, fichier_mime = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING id, produit, fichier_original_name, fichier_mime`,
        [req.file.filename, req.file.originalname, req.file.mimetype, req.params.id]
      );
    } catch (dbErr) {
      try { fs.unlinkSync(path.join(fdsDir, req.file.filename)); } catch (_) {}
      throw dbErr;
    }
    // Remplacement réussi : supprime l'ancien fichier s'il différait du nouveau.
    if (ancien && path.basename(ancien) !== req.file.filename) {
      try { fs.unlinkSync(path.join(fdsDir, path.basename(ancien))); } catch (_) {}
    }
    res.status(201).json({ ...r.rows[0], has_fichier: true });
  } catch (err) {
    console.error('[ACHATS] upload fichier fds :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/achats/fds/:id/fichier — télécharger la FDS.
router.get('/fds/:id/fichier', READ, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT fichier_path, fichier_original_name, fichier_mime FROM achats_fds WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0 || !r.rows[0].fichier_path) {
      return res.status(404).json({ error: 'Aucune pièce jointe pour cette FDS' });
    }
    const doc = r.rows[0];
    const safeName = path.basename(doc.fichier_path);
    const filePath = path.join(fdsDir, safeName);
    if (!filePath.startsWith(fdsDir) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fichier_original_name || safeName}"`);
    res.setHeader('Content-Type', doc.fichier_mime || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    console.error('[ACHATS] download fichier fds :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Oracles exposés pour les tests (comme energie.computeConsommation100km).
router.isResponsable = isResponsable;
router.normalizeName = normalizeName;
router.aggregateFds = aggregateFds;
router.computeMontantRapprochement = computeMontantRapprochement;

module.exports = router;
