/**
 * PR B — lot 4. Service d'accès base du temps d'accompagnement (feuilles de temps,
 * agrégats). SQUELETTE posé par l'orchestrateur : `heuresAccompagnement` est branché
 * dans gatherAuditKpis à l'intégration ; tant que le lot 4 ne l'a pas rempli, il
 * rend null (« non disponible », jamais 0).
 */
async function heuresAccompagnement() {
  return null;
}

module.exports = { heuresAccompagnement };
