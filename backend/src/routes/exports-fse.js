/**
 * Exports FSE+ — PR A « Conformité immédiate », lot 2 (item 2.6 du plan 07).
 * Monté sur `/api/exports` AVANT `./routes/exports` ; porte SA PROPRE chaîne
 * d'authentification (il n'hérite de rien) et ne définit que deux routes.
 *
 * DEUX EXPORTS, DEUX USAGES.
 *  (a) `/fse-plus`       — CSV NOMINATIF des participants, 29 colonnes dictées
 *                          par l'autorité (09 § 2 (a)) : une colonne par item,
 *                          en français, JAMAIS de JSON dans une cellule.
 *                          Réservé au contrôle ; journalisé.
 *  (b) `/fse-plus/bilan` — agrégat STRICTEMENT NON NOMINATIF servant le bilan
 *                          d'exécution signé par la direction.
 *
 * TROIS RÈGLES QUI NE SE NÉGOCIENT PAS (09 § 2, règles communes) :
 *  1. Zéro ligne → 409 motivé, JAMAIS un fichier vide. Un export vide se classe
 *     dans un dossier comme s'il disait « aucun participant », ce qui est faux.
 *  2. Le journal RGPD est écrit AVANT l'envoi : s'il échoue, l'export échoue —
 *     pas de fichier nominatif non tracé.
 *  3. Champ non renseigné = cellule VIDE. Jamais un zéro, jamais une valeur par
 *     défaut. (Seule exception, DICTÉE par l'autorité : la colonne BRSA écrit
 *     « Non renseigné » en toutes lettres, parce que l'absence de constat y est
 *     elle-même une information de gestion.)
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireMfa } = require('../middleware/mfa');
const { query } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  FSE_ENTREE_ITEMS, FSE_SORTIE_ITEMS, SITUATION_SORTIE_LABELS, libelleValeur, completude,
} = require('../utils/fse-schema');
const { chargerContextes, composerPieces, bornesPeriode } = require('../services/fse-participants');
const { readInsertionSetting } = require('../utils/insertion-settings');
const { ageBracket } = require('../utils/pii-pseudonymize');

const APP_VERSION = process.env.APP_VERSION || require('../../package.json').version;

// Données nominatives d'insertion → ADMIN/RH strict, second facteur exigé.
router.use(authenticate, requireMfa, authorize('ADMIN', 'RH'));

const MENTION_OFFICIELLE = "Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE+) font foi";

/** Nomenclature du niveau d'instruction (colonne 18) — libellés du diagnostic. */
const NIVEAU_FORMATION_LABELS = {
  infra3: 'Infra niveau 3 (sans diplôme)',
  niv3: 'Niveau 3 (CAP/BEP)',
  niv4: 'Niveau 4 (Bac)',
  niv5: 'Niveau 5 (Bac+2)',
  niv6plus: 'Niveau 6 et plus (Bac+3 et au-delà)',
};

/** Types de référent unique (colonne 13) — libellés attendus par l'autorité. */
const REFERENT_LABELS = {
  structure: 'Structure', cms: 'CMS', france_travail: 'France Travail',
  autre: 'Autre', non_determine: 'Non déterminé',
};

/** Les 29 intitulés, dans l'ORDRE dicté (09 § 2 (a)). Aucun n'est facultatif. */
const COLONNES = [
  'Identifiant interne', 'NOM', 'Prénom', 'Date de naissance', 'Sexe', 'Commune de résidence',
  'Projet', "Date d'entrée dans le projet", 'Date de sortie du projet',
  "Critères d'éligibilité IAE", 'BRSA', 'Catégorie France Travail', 'Référent unique (type)',
  "Date d'entrée en parcours", 'Date de fin de contrat',
  "Situation avant l'entrée", 'Durée sans emploi', "Niveau d'instruction",
  'Foyer monoparental', 'Sans domicile stable',
  "Date de recueil du questionnaire d'entrée", "Complétude du questionnaire d'entrée (%)",
  "Date de sortie de l'opération", 'Situation à la sortie',
  'Date de saisie de la sortie', 'Délai de saisie (jours)',
  'Situation à +6 mois', 'Date du relevé à +6 mois', 'Complétude du dossier participant (%)',
];

const jour = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const joursEntre = (a, b) => Math.floor((new Date(jour(b)) - new Date(jour(a))) / 86400000);
const esc = (v) => {
  const s = String(v === null || v === undefined ? '' : v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Résout le projet demandé. Le paramètre `projet` est facultatif pour ne pas
 * casser les appels existants : à défaut, l'unique opération ASI active fait
 * foi (c'est elle qui porte des participants ; l'OCS porte des postes). S'il y
 * a ambiguïté, on refuse en NOMMANT les candidats plutôt que d'en choisir un.
 */
async function resoudreProjet(req) {
  if (req.query.projet) {
    const r = await pool.query('SELECT * FROM insertion_projets WHERE id = $1', [parseInt(req.query.projet, 10)]);
    return { projet: r.rows[0] || null, erreur: r.rows[0] ? null : { status: 404, body: { error: 'Projet non trouvé' } } };
  }
  const r = await pool.query("SELECT * FROM insertion_projets WHERE actif = true AND type = 'asi' ORDER BY date_debut DESC NULLS LAST");
  if (r.rows.length === 1) return { projet: r.rows[0], erreur: null };
  return {
    projet: null,
    erreur: {
      status: 400,
      body: {
        error: r.rows.length === 0
          ? "Aucune opération cofinancée active de type ASI — précisez le projet (paramètre « projet »)."
          : 'Plusieurs opérations actives : précisez le projet (paramètre « projet »).',
        code: 'PROJET_REQUIS',
        projets: r.rows.map((p) => ({ id: p.id, code: p.code, nom: p.nom })),
      },
    },
  };
}

/** Période demandée : `annee`/`trimestre`, sinon le trimestre courant. */
function resoudrePeriode(req) {
  const annee = req.query.annee ? parseInt(req.query.annee, 10) : new Date().getFullYear();
  const trimestre = req.query.trimestre
    ? parseInt(req.query.trimestre, 10)
    : Math.ceil((new Date().getMonth() + 1) / 3);
  return { annee, trimestre, ...bornesPeriode(`${annee}-T${trimestre}`) };
}

/**
 * Population de l'export : les participants RATTACHÉS au projet, croisés avec
 * leur dossier. Un participant entré après la fin de la période ou sorti avant
 * son début n'en fait pas partie.
 */
async function chargerParticipants(projetId, periode) {
  const { rows } = await pool.query(`
    SELECT pp.employee_id, pp.date_entree, pp.date_sortie,
           e.id, e.first_name, e.last_name, e.birth_date, e.gender, e.city,
           e.insertion_start_date, e.contract_end,
           e.brsa, e.ft_categorie, e.referent_unique_type,
           COALESCE(e.parcours_num, 1) AS parcours_num,
           prem.premier_cddi,
           d.fse_entree, d.fse_entree_saisie_at, d.niveau_formation,
           s.date_sortie AS fse_date_sortie, s.situation_sortie, s.saisie_at,
           s.situation_6mois, s.date_releve_6mois,
           crit.codes AS criteres
    FROM insertion_projet_participants pp
    JOIN employees e ON e.id = pp.employee_id
    LEFT JOIN LATERAL (
      SELECT MIN(ec.start_date) AS premier_cddi FROM employee_contracts ec
      WHERE ec.employee_id = e.id AND UPPER(ec.contract_type) = 'CDDI'
    ) prem ON true
    LEFT JOIN insertion_diagnostics d
      ON d.employee_id = e.id AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
    LEFT JOIN insertion_fse_sorties s
      ON s.employee_id = e.id AND s.parcours_num = COALESCE(e.parcours_num, 1)
    LEFT JOIN LATERAL (
      SELECT string_agg(ee.critere_code, ', ' ORDER BY ee.critere_code) AS codes
      FROM employee_eligibilite ee WHERE ee.employee_id = e.id
    ) crit ON true
    WHERE pp.projet_id = $1
      AND pp.date_entree < $2::date
      AND (pp.date_sortie IS NULL OR pp.date_sortie >= $3::date)
    ORDER BY e.last_name, e.first_name
  `, [projetId, periode.fin, periode.debut]);
  return rows;
}

/**
 * Complétude du dossier (colonne 29). Règle ÉCRITE, et écrite aussi dans le
 * bilan (b) § Méthode : pièces « complet » rapportées aux pièces EXIGIBLES,
 * c'est-à-dire les 9 moins celles qui sont « sans objet » à cette date. Une
 * personne en début de parcours n'est pas à 44 % parce que quatre pièces de
 * sortie ne la concernent pas encore.
 */
function completudeDossier(pieces) {
  const exigibles = pieces.filter((p) => p.etat !== 'sans_objet');
  if (exigibles.length === 0) return null; // rien d'exigible → cellule vide
  return Math.round((exigibles.filter((p) => p.etat === 'complet').length / exigibles.length) * 100);
}

/** Compose la ligne de 29 cellules d'un participant. */
function ligneParticipant(r, projet, pieces) {
  const fse = r.fse_entree && typeof r.fse_entree === 'object' ? r.fse_entree : {};
  const comp = completude(fse, FSE_ENTREE_ITEMS);
  const delai = r.saisie_at ? joursEntre(r.contract_end || r.fse_date_sortie, r.saisie_at) : '';
  const dossierPct = completudeDossier(pieces);
  return [
    r.id,
    (r.last_name || '').toUpperCase(),
    r.first_name || '',
    jour(r.birth_date),
    r.gender || '',
    r.city || '',
    projet.nom,
    jour(r.date_entree),
    jour(r.date_sortie),
    r.criteres || '',
    // Exception DICTÉE : « Non renseigné » en toutes lettres (voir l'en-tête).
    r.brsa === true ? 'Oui' : (r.brsa === false ? 'Non' : 'Non renseigné'),
    r.ft_categorie || '',
    r.referent_unique_type ? (REFERENT_LABELS[r.referent_unique_type] || r.referent_unique_type) : '',
    jour(r.premier_cddi || r.insertion_start_date),
    jour(r.contract_end),
    libelleValeur('statut_avant_entree', fse.statut_avant_entree, FSE_ENTREE_ITEMS),
    libelleValeur('duree_sans_emploi', fse.duree_sans_emploi, FSE_ENTREE_ITEMS),
    r.niveau_formation ? (NIVEAU_FORMATION_LABELS[r.niveau_formation] || r.niveau_formation) : '',
    libelleValeur('foyer_monoparental', fse.foyer_monoparental, FSE_ENTREE_ITEMS),
    libelleValeur('sans_domicile_stable', fse.sans_domicile_stable, FSE_ENTREE_ITEMS),
    jour(r.fse_entree_saisie_at),
    comp.renseignes === 0 ? '' : comp.pct,
    jour(r.fse_date_sortie),
    r.situation_sortie ? (SITUATION_SORTIE_LABELS[r.situation_sortie] || r.situation_sortie) : '',
    jour(r.saisie_at),
    r.saisie_at ? delai : '',
    // « Non relevée » seulement quand une sortie existe : sans sortie, la
    // question ne se pose pas encore et la cellule reste vide.
    r.situation_6mois
      ? (SITUATION_SORTIE_LABELS[r.situation_6mois] || r.situation_6mois)
      : (r.fse_date_sortie ? 'Non relevée' : ''),
    jour(r.date_releve_6mois),
    dossierPct === null ? '' : dossierPct,
  ];
}

/** Journal RGPD — écrit AVANT l'envoi ; son échec fait échouer l'export. */
async function journaliserExport(req, { action, projet, periode, lignes, format }) {
  await pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, action, 'insertion_fse', null,
      JSON.stringify({
        format, lignes, projet_id: projet.id, projet_code: projet.code,
        annee: periode.annee, trimestre: periode.trimestre, requested_by: req.user.id,
      })]
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) GET /api/exports/fse-plus — participants, 29 colonnes
// ═══════════════════════════════════════════════════════════════════════════
router.get('/fse-plus', [
  query('projet').optional().isInt().withMessage('projet invalide'),
  query('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
  query('trimestre').optional().isInt({ min: 1, max: 4 }).withMessage('trimestre invalide'),
], validate, async (req, res) => {
  try {
    const { projet, erreur } = await resoudreProjet(req);
    if (erreur) return res.status(erreur.status).json(erreur.body);
    const periode = resoudrePeriode(req);

    const rows = await chargerParticipants(projet.id, periode);

    // Refus explicite AVANT toute écriture : un fichier vide ne part jamais.
    if (rows.length === 0) {
      return res.status(409).json({
        error: `Aucun participant rattaché à « ${projet.nom} » sur la période ${periode.annee} T${periode.trimestre} — aucun fichier n'est produit.`,
        code: 'EXPORT_VIDE',
        hint: "Rattachez les participants au projet (Réglages insertion → Projets cofinancés) ou changez de période.",
      });
    }

    // Dossier de conformité de chaque participant (colonne 29), composé par la
    // MÊME fonction que l'écran — l'export et l'écran ne peuvent pas diverger.
    const ctxs = await chargerContextes(pool, rows.map((r) => r.id));
    const reglages = {
      today: new Date(),
      delaiDiagnosticJours: await readInsertionSetting('insertion.delai_diagnostic_jours'),
      postSortieMois: await readInsertionSetting('insertion.post_sortie_mois'),
    };

    const lignes = rows.map((r) => {
      const ctx = ctxs.get(r.id);
      const pieces = ctx ? composerPieces(ctx, reglages) : [];
      return ligneParticipant(r, projet, pieces).map(esc).join(';');
    });

    await journaliserExport(req, { action: 'EXPORT_FSE_PLUS', projet, periode, lignes: rows.length, format: 'csv' });

    // En-tête de traçabilité — 5 lignes commentées `#`, hors du tableau.
    const meta = [
      `# Export;Participants FSE+;Projet;${projet.nom} (${projet.code})`,
      `# Généré le;${new Date().toLocaleString('fr-FR')};Généré par;${req.user.username || req.user.id}`,
      `# Périmètre;Participants rattachés à l'opération, période ${periode.annee} T${periode.trimestre} (du ${periode.debut} au ${periode.fin} exclu)`,
      `# Nombre de lignes;${rows.length};Version de l'outil;${APP_VERSION}`,
      `# ${MENTION_OFFICIELLE}`,
      '',
    ].join('\n');

    const csv = '﻿' + meta + COLONNES.join(';') + '\n' + lignes.join('\n') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="fse-participants_${projet.code}_${periode.annee}_T${periode.trimestre}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[EXPORTS-FSE] fse-plus :', err.message, err.code || '');
    const hint = err.code === '42703'
      ? 'Base non à jour (colonne manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) GET /api/exports/fse-plus/bilan — agrégat NON nominatif
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Heures d'activité de la période — REMPLACE la requête fautive de l'ancien
 * export (`SUM(EXTRACT(EPOCH FROM (end_time - start_time)))` sur `work_hours`,
 * table qui n'a NI `start_time` NI `end_time` : l'erreur était avalée par un
 * `.catch(() => ({rows:[]}))` et la colonne affichait 0 pour tout le monde).
 * Source réelle : `work_hours.hours_worked` (types travaillés : normal et
 * training — une absence n'est pas du temps d'activité), avec repli sur les
 * heures HEBDOMADAIRES importées de la paie pour les périodes où la saisie
 * journalière n'existe pas. Aucune ligne trouvée → `null`, jamais 0.
 */
async function heuresPeriode(employeeIds, periode) {
  if (!employeeIds.length) return { total: null, source: 'aucune donnée' };
  const wh = await pool.query(
    `SELECT COALESCE(SUM(hours_worked), 0)::numeric(12,2) AS h
     FROM work_hours
     WHERE employee_id = ANY($1::int[]) AND date >= $2::date AND date < $3::date
       AND type IN ('normal', 'training')`,
    [employeeIds, periode.debut, periode.fin]
  );
  const h = Number(wh.rows[0]?.h || 0);
  if (h > 0) return { total: h, source: 'saisies journalières (work_hours)' };

  const ewh = await pool.query(
    `SELECT COALESCE(SUM(hours_worked), 0)::numeric(12,2) AS h
     FROM employee_week_hours
     WHERE employee_id = ANY($1::int[])
       AND week_start IS NOT NULL AND week_start >= $2::date AND week_start < $3::date`,
    [employeeIds, periode.debut, periode.fin]
  );
  const h2 = Number(ewh.rows[0]?.h || 0);
  if (h2 > 0) return { total: h2, source: 'heures hebdomadaires importées de la paie (employee_week_hours)' };
  return { total: null, source: 'aucune heure enregistrée sur la période' };
}

/** Compte les occurrences d'une valeur (ou `null` → clé « non renseigné »). */
function distribution(valeurs, libelle = (v) => v) {
  const m = {};
  for (const v of valeurs) {
    const k = (v === null || v === undefined || v === '') ? 'Non renseigné' : libelle(v);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

router.get('/fse-plus/bilan', [
  query('projet').optional().isInt().withMessage('projet invalide'),
  query('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
  query('trimestre').optional().isInt({ min: 1, max: 4 }).withMessage('trimestre invalide'),
], validate, async (req, res) => {
  try {
    const { projet, erreur } = await resoudreProjet(req);
    if (erreur) return res.status(erreur.status).json(erreur.body);
    // Un bilan d'exécution se lit sur l'ANNÉE quand aucun trimestre n'est
    // demandé (c'est la maille de la convention), alors que l'export nominatif
    // est trimestriel.
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : new Date().getFullYear();
    const periode = req.query.trimestre
      ? resoudrePeriode(req)
      : { annee, trimestre: null, debut: `${annee}-01-01`, fin: `${annee + 1}-01-01` };

    const rows = await chargerParticipants(projet.id, periode);
    if (rows.length === 0) {
      return res.status(409).json({
        error: `Aucun participant rattaché à « ${projet.nom} » sur la période demandée — aucun bilan n'est produit.`,
        code: 'EXPORT_VIDE',
      });
    }

    const ids = rows.map((r) => r.id);
    const ctxs = await chargerContextes(pool, ids);
    const reglages = {
      today: new Date(),
      delaiDiagnosticJours: await readInsertionSetting('insertion.delai_diagnostic_jours'),
      postSortieMois: await readInsertionSetting('insertion.post_sortie_mois'),
    };

    // § 6 — complétude PAR PIÈCE (et non un taux global qui masquerait quelle
    // pièce manque) + nombre de dossiers incomplets.
    const parPiece = {};
    let dossiersIncomplets = 0;
    for (const r of rows) {
      const ctx = ctxs.get(r.id);
      if (!ctx) continue;
      const pieces = composerPieces(ctx, reglages);
      if (pieces.some((p) => p.etat === 'a_faire')) dossiersIncomplets += 1;
      for (const p of pieces) {
        parPiece[p.cle] = parPiece[p.cle] || { libelle: p.libelle, complet: 0, partiel: 0, a_faire: 0, sans_objet: 0 };
        parPiece[p.cle][p.etat] += 1;
      }
    }
    for (const k of Object.keys(parPiece)) {
      const v = parPiece[k];
      const exigibles = v.complet + v.partiel + v.a_faire;
      v.exigibles = exigibles;
      v.taux_pct = exigibles === 0 ? null : Math.round((v.complet / exigibles) * 100);
    }

    const fses = rows.map((r) => (r.fse_entree && typeof r.fse_entree === 'object' ? r.fse_entree : {}));
    const postes = await pool.query(
      `SELECT pp.quotite_pct, pp.date_debut, pp.date_fin, u.first_name, u.last_name
       FROM insertion_projet_postes pp JOIN users u ON u.id = pp.user_id
       WHERE pp.projet_id = $1 ORDER BY u.last_name`,
      [projet.id]
    );
    const heures = await heuresPeriode(ids, periode);

    await journaliserExport(req, { action: 'EXPORT_FSE_PLUS', projet, periode, lignes: rows.length, format: 'bilan' });

    res.json({
      // § 1 Identification
      identification: {
        projet: { code: projet.code, nom: projet.nom, type: projet.type, financeur: projet.financeur,
          convention_ref: projet.convention_ref, date_debut: projet.date_debut, date_fin: projet.date_fin,
          taux_forfaitaire_pct: projet.taux_forfaitaire_pct, cofinancement_ue_pct: projet.cofinancement_ue_pct },
        periode: { annee: periode.annee, trimestre: periode.trimestre, debut: periode.debut, fin: periode.fin },
        genere_le: new Date().toISOString(),
        genere_par: req.user.username || String(req.user.id),
        version_outil: APP_VERSION,
        mention: MENTION_OFFICIELLE,
        nominatif: false,
      },
      // § 2 Participants
      participants: {
        total: rows.length,
        entres_dans_la_periode: rows.filter((r) => r.date_entree && jour(r.date_entree) >= periode.debut).length,
        sortis_dans_la_periode: rows.filter((r) => r.fse_date_sortie && jour(r.fse_date_sortie) >= periode.debut && jour(r.fse_date_sortie) < periode.fin).length,
        presents_fin_de_periode: rows.filter((r) => !r.date_sortie).length,
        par_sexe: distribution(rows.map((r) => r.gender)),
        par_tranche_age: distribution(rows.map((r) => ageBracket(r.birth_date))),
        par_critere_eligibilite: rows.reduce((acc, r) => {
          const codes = (r.criteres || '').split(',').map((c) => c.trim()).filter(Boolean);
          if (codes.length === 0) acc['Aucun critère saisi'] = (acc['Aucun critère saisi'] || 0) + 1;
          for (const c of codes) acc[c] = (acc[c] || 0) + 1;
          return acc;
        }, {}),
        brsa: {
          oui: rows.filter((r) => r.brsa === true).length,
          non: rows.filter((r) => r.brsa === false).length,
          non_renseigne: rows.filter((r) => r.brsa === null || r.brsa === undefined).length,
        },
        par_referent_unique: distribution(rows.map((r) => r.referent_unique_type), (v) => REFERENT_LABELS[v] || v),
      },
      // § 3 Indicateurs d'entrée — distribution de CHAQUE item
      indicateurs_entree: Object.fromEntries(
        FSE_ENTREE_ITEMS.filter((i) => i.obligatoire).map((i) => [
          i.cle,
          { libelle: i.libelle, distribution: distribution(fses.map((f) => f[i.cle]), (v) => libelleValeur(i.cle, v, FSE_ENTREE_ITEMS) || 'Non renseigné') },
        ])
      ),
      // § 4 Indicateurs de sortie — avec la ligne « sortie non renseignée »
      indicateurs_sortie: {
        par_situation: distribution(
          rows.filter((r) => r.situation_sortie).map((r) => r.situation_sortie),
          (v) => SITUATION_SORTIE_LABELS[v] || v
        ),
        sortie_non_renseignee: rows.filter((r) => !r.situation_sortie && (r.date_sortie || (r.contract_end && jour(r.contract_end) < jour(new Date())))).length,
        delai_saisie_jours_moyen: (() => {
          const d = rows.filter((r) => r.saisie_at).map((r) => joursEntre(r.contract_end || r.fse_date_sortie, r.saisie_at));
          return d.length === 0 ? null : Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10;
        })(),
        saisies_dans_le_mois: rows.filter((r) => r.saisie_at && joursEntre(r.contract_end || r.fse_date_sortie, r.saisie_at) <= 30).length,
      },
      // § 5 Résultat à +6 mois — avec la ligne « non relevée »
      indicateurs_six_mois: {
        par_situation: distribution(
          rows.filter((r) => r.situation_6mois).map((r) => r.situation_6mois),
          (v) => SITUATION_SORTIE_LABELS[v] || v
        ),
        non_relevee: rows.filter((r) => r.fse_date_sortie && !r.situation_6mois).length,
      },
      // § 6 Complétude par pièce
      completude: {
        par_piece: parPiece,
        dossiers_incomplets: dossiersIncomplets,
        dossiers_complets: rows.length - dossiersIncomplets,
        taux_pct: Math.round(((rows.length - dossiersIncomplets) / rows.length) * 100),
      },
      // § 7 Moyens
      moyens: {
        postes_affectes: postes.rows.map((p) => ({
          intervenant: `${p.last_name} ${p.first_name}`.trim(),
          quotite_pct: p.quotite_pct, date_debut: p.date_debut, date_fin: p.date_fin,
        })),
        taux_forfaitaire_pct: projet.taux_forfaitaire_pct,
        heures_activite_participants: heures.total,
        heures_activite_source: heures.source,
        // La feuille de temps par intervenant arrive en PR B : son absence est
        // NOMMÉE, jamais remplacée par un zéro qui se lirait « aucune heure ».
        feuilles_de_temps: { validees: null, dues: null, note: "Écran « Temps d'accompagnement » non déployé (PR B) — les feuilles de temps ne sont pas encore comptabilisables." },
      },
      // § 8 Méthode — exigée en toutes lettres par l'autorité (09 § 2 (b))
      methode: {
        population: "Participants dont le rattachement au projet est SAISI et daté (jamais déduit d'un statut), entrés avant la fin de la période et non sortis avant son début.",
        completude_questionnaire: `Items obligatoires renseignés / ${FSE_ENTREE_ITEMS.filter((i) => i.obligatoire).length} (le commentaire libre n'est pas compté).`,
        completude_dossier: "Pièces à l'état « complet » rapportées aux pièces EXIGIBLES à la date de génération, c'est-à-dire les 9 pièces moins celles qui sont « sans objet » (pièces de sortie d'un parcours en cours). Une pièce « partielle » n'est pas comptée comme complète.",
        delai_saisie: "Date de saisie de la sortie moins date de fin de contrat (à défaut, moins la date de sortie). L'horodatage retenu est celui du PREMIER recueil : une correction ultérieure ne crée pas de retard rétroactif.",
        situation_sortie: "Réponse explicite de la conseillère ; à défaut, déduction depuis la catégorie de sortie IAE (emploi durable, emploi de transition, sortie positive). La catégorie IAE « autre » n'a pas d'équivalent FSE+ et donne « Non renseignée » — aucune situation n'est inventée.",
        heures: `Heures d'activité des participants sur la période, source : ${heures.source}. Absence de saisie → valeur nulle, jamais zéro.`,
        cibles: "Objectif non paramétré : aucune cible conventionnelle n'est enregistrée pour ce projet.",
      },
    });
  } catch (err) {
    console.error('[EXPORTS-FSE] bilan :', err.message, err.code || '');
    const hint = err.code === '42703'
      ? 'Base non à jour (colonne manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
  }
});

module.exports = router;
module.exports.COLONNES = COLONNES;
