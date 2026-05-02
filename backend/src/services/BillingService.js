/**
 * BillingService — logique métier facturation centralisée.
 *
 * Issue de l'audit Architecte (V5.4) — extrait la logique partageable
 * entre `routes/billing.js` (factures internes) et `routes/factures-exutoires.js`
 * (factures reçues d'exutoires) :
 *   - numérotation automatique avec préfixe annuel
 *   - calcul HT/TVA/TTC à partir d'un tableau de lignes
 *   - validation des transitions de statut
 *
 * Les routes restent thin controllers : elles parsent req, appellent ce
 * service, et renvoient la réponse. Aucune logique métier ne devrait
 * dupliquer ce qui est ici.
 */

const TVA_RATE_DEFAULT = 0.20; // 20% taux normal France métropolitaine
const STATUTS_FACTURE = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

const TRANSITIONS_FACTURE = {
  draft:     ['sent', 'cancelled'],
  sent:      ['paid', 'overdue', 'cancelled'],
  overdue:   ['paid', 'cancelled'],
  paid:      [],
  cancelled: [],
};

/**
 * Génère un numéro de facture unique au format `<PREFIX>-<YYYY>-<NNNN>`.
 *
 * @param {object} pool      Le pool pg
 * @param {string} prefix    Préfixe (ex: 'FAC' pour facture interne, 'FAE' pour facture exutoire)
 * @param {string} table     Nom de la table à scanner (ex: 'invoices')
 * @param {string} column    Nom de la colonne (ex: 'invoice_number', 'numero_facture')
 * @param {number} [year]    Année (par défaut année courante)
 * @returns {Promise<string>} Le numéro généré
 */
async function generateInvoiceNumber(pool, prefix, table, column, year = null) {
  const y = year || new Date().getFullYear();
  // Garde-fou injection : prefix/table/column doivent être des identifiants
  // simples (lettres/chiffres/_) — ils ne viennent jamais de req.body.
  const SAFE = /^[A-Za-z][A-Za-z0-9_]*$/;
  if (!SAFE.test(prefix) || !SAFE.test(table) || !SAFE.test(column)) {
    throw new Error('Identifiants invalides pour generateInvoiceNumber');
  }
  const result = await pool.query(
    `SELECT MAX(${column}) AS last FROM ${table} WHERE ${column} LIKE $1`,
    [`${prefix}-${y}-%`]
  );
  const last = result.rows[0]?.last;
  if (!last) return `${prefix}-${y}-0001`;
  const parts = String(last).split('-');
  const num = parseInt(parts[2], 10);
  if (isNaN(num)) return `${prefix}-${y}-0001`;
  return `${prefix}-${y}-${String(num + 1).padStart(4, '0')}`;
}

/**
 * Calcule les totaux HT / TVA / TTC à partir d'un tableau de lignes.
 *
 * @param {Array<{quantity?: number, unit_price?: number}>} lines
 * @param {number} [tvaRate=0.20]
 * @returns {{totalHT: number, totalTVA: number, totalTTC: number, lineDetails: Array}}
 *   Tous les montants sont arrondis au centime.
 */
function calculateTotals(lines = [], tvaRate = TVA_RATE_DEFAULT) {
  const lineDetails = (lines || []).map((l) => {
    const quantity = Number(l.quantity ?? 1);
    const unitPrice = Number(l.unit_price ?? 0);
    const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
    return { ...l, quantity, unit_price: unitPrice, total: lineTotal };
  });
  const rawHT = lineDetails.reduce((sum, l) => sum + l.total, 0);
  const totalHT = Math.round(rawHT * 100) / 100;
  const totalTVA = Math.round(totalHT * tvaRate * 100) / 100;
  const totalTTC = Math.round((totalHT + totalTVA) * 100) / 100;
  return { totalHT, totalTVA, totalTTC, lineDetails };
}

/**
 * Vérifie si une transition de statut est autorisée.
 * Plus simple que le moteur state-machine global (pas de rôles, pas
 * d'audit), pour usage interne dans les routes facturation.
 *
 * @returns {{ok: boolean, reason?: string}}
 */
function canTransitionStatus(fromStatus, toStatus) {
  if (!STATUTS_FACTURE.includes(toStatus)) {
    return { ok: false, reason: `Statut invalide : ${toStatus}` };
  }
  if (!fromStatus) {
    // Création : seul 'draft' est accepté en initial
    return toStatus === 'draft'
      ? { ok: true }
      : { ok: false, reason: `Statut initial doit être 'draft', reçu '${toStatus}'` };
  }
  const allowed = TRANSITIONS_FACTURE[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      reason: `Transition ${fromStatus} → ${toStatus} non autorisée. Valides : ${allowed.join(', ') || '(état terminal)'}`,
    };
  }
  return { ok: true };
}

module.exports = {
  TVA_RATE_DEFAULT,
  STATUTS_FACTURE,
  TRANSITIONS_FACTURE,
  generateInvoiceNumber,
  calculateTotals,
  canTransitionStatus,
};
