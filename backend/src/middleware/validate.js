/**
 * Middleware standardisé de validation
 * Utilise express-validator de manière cohérente
 */
const { validationResult } = require('express-validator');

/**
 * Vérifie les résultats de validation et renvoie 400 si erreurs
 * Usage: router.post('/', [body('name').notEmpty()], validate, handler)
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Erreur de validation',
      details: errors.array().map(e => ({
        field: e.path,
        message: e.msg,
        value: e.value,
      })),
    });
  }
  next();
}

module.exports = { validate };
