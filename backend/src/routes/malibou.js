/**
 * Administration de la synchronisation Malibou (logiciel de préparation de la
 * paie) — LECTURE SEULE côté Malibou, écriture côté SOLIDATA.
 *
 * ADMIN STRICT, et pas seulement par prudence : ces routes déclenchent une
 * écriture dans les dossiers du personnel et exposent l'état de configuration
 * d'une clé d'API. La clé elle-même n'en sort JAMAIS — `statut()` n'en rend
 * qu'un aperçu masqué —, et aucune route ne permet de la lire ni de l'écrire :
 * elle se pose par le script `configurer-malibou.js`, sur l'entrée standard,
 * pour qu'elle ne traîne ni dans un historique de shell, ni dans `ps`, ni dans
 * un journal de requêtes.
 */
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../config/logger');
const malibou = require('../services/malibou');
const sync = require('../services/malibou-sync');
const { autoLogActivity } = require('../middleware/activity-logger');

const router = express.Router();
router.use(authenticate, authorize('ADMIN'));

/** État de la configuration — jamais la clé, seulement son aperçu masqué. */
router.get('/statut', async (req, res) => {
  try {
    res.json(await malibou.statut());
  } catch (err) {
    logger.error('[MALIBOU] statut', { message: err.message });
    res.status(500).json({ error: 'Impossible de lire la configuration Malibou' });
  }
});

/**
 * Essai de connexion : un seul appel, la première page des collaborateurs.
 *
 * Il rend le NOMBRE de collaborateurs visibles et rien d'autre — pas la liste.
 * Vérifier qu'une clé fonctionne ne demande pas d'exposer un annuaire du
 * personnel dans une réponse de diagnostic.
 */
router.get('/essai', async (req, res) => {
  try {
    const { configure, manques } = await malibou.statut();
    if (!configure) {
      return res.status(400).json({
        error: 'Configuration Malibou incomplète',
        code: 'MALIBOU_NON_CONFIGURE',
        manques,
      });
    }
    const lignes = await malibou.listerCollaborateurs({ limit: 1 });
    res.json({ ok: true, collaborateurs_visibles: lignes.length >= 1 });
  } catch (err) {
    // Le message du client porte déjà la marche à suivre (clé refusée, scope
    // manquant, organisation absente) : le relayer vaut mieux qu'un « erreur ».
    res.status(err.status && err.status < 500 ? 400 : 502).json({
      error: err.message, code: err.code || 'MALIBOU_ERREUR', status: err.status || null,
    });
  }
});

/**
 * Déclenchement manuel.
 *
 * SIMULATION PAR DÉFAUT : il faut `{ appliquer: true }` pour écrire. Une
 * synchronisation qui écrirait sur un simple appel serait trop facile à
 * déclencher par erreur — et son compte rendu de simulation est précisément
 * ce qu'on veut lire avant de se décider.
 */
router.post('/synchroniser', autoLogActivity('malibou'), async (req, res) => {
  const appliquer = req.body && req.body.appliquer === true;
  try {
    const { configure, manques } = await malibou.statut();
    if (!configure) {
      return res.status(400).json({
        error: 'Configuration Malibou incomplète', code: 'MALIBOU_NON_CONFIGURE', manques,
      });
    }
    const bilan = await sync.synchroniserTout({ appliquer });
    logger.info('[MALIBOU] synchronisation déclenchée manuellement', {
      par: req.user && req.user.username, applique: appliquer,
    });
    res.json(bilan);
  } catch (err) {
    logger.error('[MALIBOU] synchronisation manuelle en échec', { message: err.message, code: err.code });
    res.status(502).json({ error: err.message, code: err.code || 'MALIBOU_ERREUR' });
  }
});

module.exports = router;
