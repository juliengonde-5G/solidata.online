/**
 * Middleware global de gestion d'erreurs
 * Capture toutes les erreurs non gérées dans les routes
 */

function errorHandler(err, req, res, _next) {
  // Log l'erreur avec contexte
  const errorContext = {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id || 'anonymous',
    timestamp: new Date().toISOString(),
  };

  // Erreurs de validation express-validator
  if (err.type === 'entity.parse.failed') {
    console.error('[ERROR] JSON parse failed:', errorContext);
    return res.status(400).json({ error: 'JSON invalide dans le corps de la requête' });
  }

  // Erreurs Multer (upload fichier)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Fichier trop volumineux' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Champ de fichier inattendu' });
  }

  // Erreurs PostgreSQL courantes
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Enregistrement en doublon' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Référence invalide (clé étrangère)' });
  }
  if (err.code === '23502') {
    return res.status(400).json({ error: `Champ obligatoire manquant: ${err.column || 'inconnu'}` });
  }

  // Erreur générique
  console.error('[ERROR] Unhandled error:', { ...errorContext, message: err.message, stack: err.stack });

  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Erreur serveur interne'
    : err.message || 'Erreur serveur interne';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

/**
 * Middleware pour capturer les routes non trouvées (404)
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.originalUrl,
  });
}

module.exports = { errorHandler, notFoundHandler };
