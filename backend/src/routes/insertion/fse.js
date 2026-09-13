/**
 * Questionnaires FSE+ d'un participant — PR A lot 2 (items 2.2 et 2.3 du plan).
 * Monté sur `/fse` AVANT routes.js ; hérite de `authenticate + requireMfa +
 * authorize('ADMIN','RH','MANAGER')` et RESSERRE tout à ADMIN/RH.
 *
 * POURQUOI ADMIN/RH STRICT, Y COMPRIS EN LECTURE. Le questionnaire d'entrée
 * porte la composition du foyer, la stabilité du logement et la nature des
 * ressources : ce sont des statuts sociaux, rangés par l'organisation (08 § 10)
 * au même niveau que BRSA et la catégorie France Travail — jamais en lecture
 * encadrant. Le MANAGER voit qu'un dossier est incomplet (dossier de
 * conformité), il ne voit pas ce qu'il contient.
 */
const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/validate');
const {
  FSE_ENTREE_ITEMS, FSE_SORTIE_ITEMS, SITUATIONS_SORTIE, SITUATIONS_6MOIS,
  completude, suggestionsEntree,
} = require('../../utils/fse-schema');
const fseParticipants = require('../../services/fse-participants');
const { readInsertionSetting } = require('../../utils/insertion-settings');

router.use(authorize('ADMIN', 'RH'));

/**
 * GET /api/insertion/fse/:employeeId — tout ce que l'écran du dossier doit
 * savoir : projets, questionnaire d'entrée (+ complétude + suggestions),
 * sortie (+ délai de saisie calculé) et relevé à six mois (+ échéance).
 */
router.get('/:employeeId', [param('employeeId').isInt().withMessage('ID employé invalide')], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const e = await pool.query(
      `SELECT id, first_name, last_name, contract_end, insertion_status, insertion_start_date,
              COALESCE(parcours_num, 1) AS parcours_num, france_travail_id, brsa
       FROM employees WHERE id = $1`,
      [empId]
    );
    if (e.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    const emp = e.rows[0];

    const [diag, projets, sortie, postSortieMois] = await Promise.all([
      pool.query(
        `SELECT fse_entree, fse_entree_complet, fse_entree_saisie_at, logement_statut,
                situation_familiale, enfants_a_charge, ressources
         FROM insertion_diagnostics WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2`,
        [empId, emp.parcours_num]
      ),
      pool.query(
        `SELECT pp.id, pp.projet_id, pp.date_entree, pp.date_sortie, pr.code, pr.nom, pr.type
         FROM insertion_projet_participants pp
         JOIN insertion_projets pr ON pr.id = pp.projet_id
         WHERE pp.employee_id = $1 ORDER BY pp.date_entree`,
        [empId]
      ),
      pool.query(
        'SELECT * FROM insertion_fse_sorties WHERE employee_id = $1 AND parcours_num = $2',
        [empId, emp.parcours_num]
      ),
      readInsertionSetting('insertion.post_sortie_mois'),
    ]);

    const d = diag.rows[0] || null;
    const items = (d && d.fse_entree) || {};
    const s = sortie.rows[0] || null;

    // Délai de saisie : la colonne que l'autorité regarde en premier (09 § 2
    // (a) colonne 26), dont la règle est DICTÉE — date de saisie moins DATE DE
    // SORTIE DE L'OPÉRATION. L'écran affiche donc exactement le nombre qui
    // partira dans l'export : deux bases de calcul produiraient deux « délais
    // de saisie » différents sous le même nom.
    let delaiSaisieJours = null;
    if (s) {
      delaiSaisieJours = Math.floor(
        (new Date(String(s.saisie_at).slice(0, 10)) - new Date(String(s.date_sortie).slice(0, 10))) / 86400000
      );
    }
    let echeance6mois = null;
    if (s && s.date_sortie) {
      const ech = new Date(s.date_sortie);
      ech.setMonth(ech.getMonth() + (Number(postSortieMois) || 6));
      echeance6mois = ech.toISOString().slice(0, 10);
    }

    res.json({
      employee_id: empId,
      contract_end: emp.contract_end,
      parcours_num: emp.parcours_num,
      // Un participant ASI a des obligations que les autres n'ont pas : l'écran
      // s'en sert pour marquer la rubrique en rouge, jamais pour bloquer.
      participant_asi: projets.rows.some((p) => p.type === 'asi' && !p.date_sortie),
      projets: projets.rows,
      entree: {
        items,
        completude: completude(items, FSE_ENTREE_ITEMS),
        complet: !!(d && d.fse_entree_complet),
        saisie_at: d ? d.fse_entree_saisie_at : null,
        suggestions: suggestionsEntree(d ? { ...d, fse_entree: items } : null, emp),
      },
      sortie: s ? {
        date_sortie: s.date_sortie,
        situation_sortie: s.situation_sortie,
        fse_sortie: s.fse_sortie,
        saisie_at: s.saisie_at,
        source: s.source,
        projet_id: s.projet_id,
        delai_saisie_jours: delaiSaisieJours,
      } : null,
      six_mois: s ? {
        situation_6mois: s.situation_6mois,
        date_releve_6mois: s.date_releve_6mois,
        echeance: echeance6mois,
      } : null,
      // Référentiel envoyé avec la donnée : l'écran n'a aucune liste en dur.
      referentiel: { entree: FSE_ENTREE_ITEMS, sortie: FSE_SORTIE_ITEMS },
    });
  } catch (err) {
    console.error('[INSERTION][FSE] GET :', err.message);
    const hint = err.code === '42703'
      ? 'Base non à jour (colonne manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
  }
});

/**
 * POST /api/insertion/fse/:employeeId/sortie — SAISIE DIRECTE de la sortie,
 * sans bilan.
 *
 * C'est le point décisif de la PR A (09 § 1.4 F7) : la personne qui part sans
 * entretien de sortie est précisément celle dont la donnée manquait, parce que
 * la sortie ne vivait que dans le formulaire de bilan. Ici elle se saisit en
 * trois champs depuis le dossier de conformité.
 */
router.post('/:employeeId/sortie', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
  body('date_sortie').isISO8601().withMessage('date_sortie obligatoire'),
  body('situation_sortie').isIn(SITUATIONS_SORTIE).withMessage(`situation_sortie invalide (${SITUATIONS_SORTIE.join(', ')})`),
  body('projet_id').optional({ nullable: true }).isInt().withMessage('projet_id invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const emp = await pool.query('SELECT id FROM employees WHERE id = $1', [empId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });

    const { ligne, source } = await fseParticipants.enregistrerSortie({
      employeeId: empId,
      milestone: null,
      payload: {
        date_sortie: req.body.date_sortie,
        situation_sortie: req.body.situation_sortie,
        fse_sortie: req.body.fse_sortie,
        projet_id: req.body.projet_id || null,
      },
      userId: req.user.id,
    });
    res.status(201).json({ ...ligne, source });
  } catch (err) {
    if (err.code === 'FSE_SORTIE_INVALIDE') {
      return res.status(400).json({ error: err.message, erreurs: err.erreurs });
    }
    console.error('[INSERTION][FSE] sortie POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

/**
 * POST /api/insertion/fse/:employeeId/six-mois — relevé de situation à six mois.
 * Se pose SUR une sortie existante : sans sortie enregistrée, 409 explicite
 * plutôt qu'une ligne de sortie fabriquée dont personne n'aurait constaté la date.
 */
router.post('/:employeeId/six-mois', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
  body('situation_6mois').isIn(SITUATIONS_6MOIS).withMessage(`situation_6mois invalide (${SITUATIONS_6MOIS.join(', ')})`),
  body('date_releve_6mois').optional({ nullable: true }).isISO8601().withMessage('date_releve_6mois invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const ligne = await fseParticipants.enregistrerSixMois({
      employeeId: empId,
      situation6mois: req.body.situation_6mois,
      dateReleve: req.body.date_releve_6mois || null,
      userId: req.user.id,
    });
    res.json(ligne);
  } catch (err) {
    if (err.code === 'SORTIE_ABSENTE') return res.status(409).json({ error: err.message, code: 'SORTIE_ABSENTE' });
    if (err.code === 'SIX_MOIS_INVALIDE') return res.status(400).json({ error: err.message, erreurs: err.erreurs });
    console.error('[INSERTION][FSE] six-mois POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

module.exports = router;
