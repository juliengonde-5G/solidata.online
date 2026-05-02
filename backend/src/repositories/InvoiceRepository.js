/**
 * InvoiceRepository — accès données pour le domaine facturation interne.
 *
 * Pilote du pattern Repository (V6.3) — extrait toutes les requêtes SQL
 * du module `routes/billing.js` dans une couche dédiée. Chaque méthode
 * accepte un argument optionnel `client` (un client pg en transaction)
 * et retombe sur le pool global sinon. Cela permet à `create()` et
 * `updateStatus()` d'être appelés depuis l'intérieur d'une transaction
 * sans réécriture.
 *
 * Convention :
 *   - Méthodes en lecture : retournent le row brut (ou null si absent).
 *   - Méthodes en écriture : retournent le row inséré/mis à jour.
 *   - Aucune validation métier ici (c'est le rôle de BillingService).
 *
 * Pattern destiné à être répliqué sur d'autres domaines en V6.5+ :
 * EmployeeRepository, CommandeExutoireRepository, etc.
 */

const pool = require('../config/database');

function exec(client) {
  return client || pool;
}

/**
 * Liste les factures avec filtres optionnels (status, date_from, date_to).
 * @returns {Promise<Array>}
 */
async function findAll(filters = {}, { client } = {}) {
  const { status, date_from, date_to } = filters;
  let query = 'SELECT * FROM invoices WHERE 1=1';
  const params = [];

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  if (date_from) {
    params.push(date_from);
    query += ` AND date >= $${params.length}`;
  }
  if (date_to) {
    params.push(date_to);
    query += ` AND date <= $${params.length}`;
  }

  query += ' ORDER BY date DESC';
  const result = await exec(client).query(query, params);
  return result.rows;
}

/**
 * Récupère une facture par ID (sans les lignes).
 * @returns {Promise<object|null>}
 */
async function findById(id, { client } = {}) {
  const result = await exec(client).query(
    'SELECT * FROM invoices WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Récupère les lignes d'une facture, triées par position.
 * @returns {Promise<Array>}
 */
async function findLinesByInvoiceId(invoiceId, { client } = {}) {
  const result = await exec(client).query(
    'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY position',
    [invoiceId]
  );
  return result.rows;
}

/**
 * Récupère une facture + ses lignes en 2 requêtes séquentielles.
 * Utile pour GET /:id et pour la réponse de POST/PUT.
 * @returns {Promise<{invoice: object, lines: Array}|null>}
 */
async function findByIdWithLines(id, { client } = {}) {
  const invoice = await findById(id, { client });
  if (!invoice) return null;
  const lines = await findLinesByInvoiceId(id, { client });
  return { ...invoice, lines };
}

/**
 * Insère une facture avec son entête + ses lignes.
 * REQUIERT un `client` en transaction (parce qu'il y a 1+N inserts).
 * @param {object} invoice  Données entête déjà validées et numérotées
 * @param {Array}  lines    Lignes déjà calculées (par BillingService.calculateTotals)
 * @returns {Promise<object>}  La facture insérée (entête seule)
 */
async function create(invoice, lines, { client }) {
  if (!client) {
    throw new Error('InvoiceRepository.create requiert un client en transaction');
  }

  const {
    invoice_number, client_name, client_address, client_email,
    date, due_date, total_ht, total_tva, total_ttc, notes, created_by,
  } = invoice;

  const headerResult = await client.query(
    `INSERT INTO invoices (invoice_number, client_name, client_address, client_email,
       date, due_date, total_ht, total_tva, total_ttc, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [invoice_number, client_name, client_address, client_email,
      date, due_date, total_ht, total_tva, total_ttc, notes, created_by]
  );
  const inserted = headerResult.rows[0];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(
      `INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit_price, total)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inserted.id, i + 1, l.description, l.quantity, l.unit_price, l.total]
    );
  }

  return inserted;
}

/**
 * Met à jour le statut d'une facture (et `paid_at` si status='paid').
 * @returns {Promise<object|null>}  La facture mise à jour, ou null si absente
 */
async function updateStatus(id, status, { client } = {}) {
  const updates = ['status = $1', 'updated_at = NOW()'];
  if (status === 'paid') updates.push('paid_at = NOW()');

  const result = await exec(client).query(
    `UPDATE invoices SET ${updates.join(', ')} WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return result.rows[0] || null;
}

module.exports = {
  findAll,
  findById,
  findLinesByInvoiceId,
  findByIdWithLines,
  create,
  updateStatus,
};
