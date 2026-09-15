/**
 * Dossier de conformité FSE+ — PR A lot 2, item 2.5 du plan 07.
 * Monté sur `/conformite` AVANT routes.js. Resserré ADMIN/RH.
 *
 * DEUX VUES, UNE SEULE MÉCANIQUE. La colonne de droite du dossier d'un salarié
 * (9 pièces) et le tableau transversal par projet sont composés par LA MÊME
 * fonction (`services/fse-participants.composerPieces`) : deux implémentations
 * finiraient par diverger, et la CIP verrait une pièce verte dans un écran et
 * rouge dans l'autre — c'est exactement ce qui décrédibilise un outil de
 * conformité.
 */
const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/auth');
const { param, query } = require('express-validator');
const { validate } = require('../../middleware/validate');
const fseParticipants = require('../../services/fse-participants');

router.use(authorize('ADMIN', 'RH'));

/**
 * GET /api/insertion/conformite?projet=<id>&periode=<AAAA-Tn> — vue transversale.
 * Déclaré AVANT `/:employeeId` (un chemin racine ne peut pas être capturé par le
 * paramètre, mais l'ordre rend la lecture du fichier conforme à l'exécution).
 */
router.get('/', [
  query('projet').optional().isInt().withMessage('projet invalide'),
  query('periode').optional().matches(/^\d{4}-[Tt][1-4]$/).withMessage('periode invalide (format AAAA-Tn)'),
], validate, async (req, res) => {
  try {
    if (!req.query.projet) {
      return res.status(400).json({ error: 'Projet obligatoire (paramètre « projet »).', code: 'PROJET_REQUIS' });
    }
    const r = await fseParticipants.conformiteProjet(parseInt(req.query.projet, 10), req.query.periode || null);
    if (!r) return res.status(404).json({ error: 'Projet non trouvé' });
    res.json(r);
  } catch (err) {
    console.error('[INSERTION][CONFORMITE] projet :', err.message);
    const hint = err.code === '42703'
      ? 'Base non à jour (colonne manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
  }
});

/** GET /api/insertion/conformite/:employeeId — les 9 pièces d'un dossier. */
router.get('/:employeeId', [param('employeeId').isInt().withMessage('ID employé invalide')], validate, async (req, res) => {
  try {
    const r = await fseParticipants.dossierConformite(parseInt(req.params.employeeId, 10));
    if (!r) return res.status(404).json({ error: 'Salarié non trouvé' });
    res.json(r);
  } catch (err) {
    console.error('[INSERTION][CONFORMITE] salarié :', err.message);
    const hint = err.code === '42703'
      ? 'Base non à jour (colonne manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
  }
});

module.exports = router;
