/**
 * SolidataBot — Route /api/chat
 * Agent conversationnel IA avec Claude API (tool use)
 * Requêtes DB read-only, filtrage RGPD par rôle/user
 */

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// ── Config ──────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_MSG_LENGTH = 500;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 min
const RATE_LIMIT_MAX = 20;

// In-memory rate limiting (simple, pas besoin de Redis pour ça)
const rateLimits = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimits.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Nettoyage périodique
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) rateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// ── In-memory session store (historique chat) ───────────────────────────

const sessions = new Map();
const SESSION_TTL = 60 * 60 * 1000; // 1h
const MAX_HISTORY = 10;

function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s && Date.now() - s.updatedAt < SESSION_TTL) return s.messages;
  sessions.delete(sessionId);
  return [];
}

function saveSession(sessionId, messages) {
  const trimmed = messages.slice(-(MAX_HISTORY * 2));
  sessions.set(sessionId, { messages: trimmed, updatedAt: Date.now() });
}

// Nettoyage sessions expirées
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (now - s.updatedAt > SESSION_TTL) sessions.delete(key);
  }
}, 10 * 60 * 1000);

// ── System prompt ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es SolidataBot, l'assistant amical de Solidarité Textiles à Rouen.

REGLES :
- Réponds TOUJOURS en français, de manière simple et courte (max 100 mots).
- Utilise des emojis pour rendre tes réponses visuelles : 📦 stock, 🚛 collecte, 📅 planning, 👋 salut, ✅ ok, ❌ erreur.
- Pour les utilisateurs en insertion (profil PCM, faible lecture) : langage très simple, phrases courtes, icônes.
- Tu as accès à la base de données via des outils (tools). N'invente JAMAIS de données.
- Si tu ne sais pas ou si la question sort du périmètre : "Désolé, je ne peux pas répondre à ça. Demande à un admin ! 🙋"
- Ne modifie JAMAIS la base de données. Lecture seule.
- Ne révèle jamais d'informations personnelles d'autres utilisateurs (sauf si ADMIN/RH).
- Exemples de réponses :
  * "Stock jeans Rouen : 150 kg 📦"
  * "Ta prochaine mission : collecte mardi 9h 🚛"
  * "Collecte du 25/03 : 2 340 kg récoltés ✅"

CONTEXTE METIER :
- Solidarité Textiles est une SIAE de collecte, tri et valorisation de textiles usagés en Normandie.
- CAV = Conteneur d'Apport Volontaire (point de collecte dans la rue).
- Filières : tri, collecte, logistique, boutique Frip & Co.
- Types textiles : crème (réemploi), catégorie 2 (recyclage), CSR (combustible), effilochage, VAK (export).
- Refashion = éco-organisme REP textile.`;

// ── Claude tools ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'query_stock',
    description: 'Interroge le stock de matières textiles. Retourne le poids total en kg par catégorie. Peut filtrer par catégorie (crème, CSR, effilochage, VAK...).',
    input_schema: {
      type: 'object',
      properties: {
        categorie: { type: 'string', description: "Catégorie de matière à filtrer. Vide = toutes." },
      },
      required: [],
    },
  },
  {
    name: 'query_planning',
    description: "Consulte le planning d'un employé pour la semaine en cours. Retourne les missions et postes jour par jour.",
    input_schema: {
      type: 'object',
      properties: {
        employee_id: { type: 'integer', description: "ID de l'employé. Si absent, utilise l'utilisateur connecté." },
      },
      required: [],
    },
  },
  {
    name: 'query_collecte',
    description: "Stats de collecte pour une date ou période. Retourne nombre de tournées, poids total, CAV visités.",
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date YYYY-MM-DD. Défaut: aujourd\'hui.' },
        periode: { type: 'string', enum: ['jour', 'semaine', 'mois'], description: 'Période. Défaut: jour.' },
      },
      required: [],
    },
  },
  {
    name: 'query_heures',
    description: "Heures travaillées d'un employé sur une période (semaine ou mois).",
    input_schema: {
      type: 'object',
      properties: {
        employee_id: { type: 'integer', description: "ID de l'employé. Si absent, utilise l'utilisateur connecté." },
        periode: { type: 'string', enum: ['semaine', 'mois'], description: 'Période. Défaut: semaine.' },
      },
      required: [],
    },
  },
  {
    name: 'query_cav',
    description: "Informations sur les CAV (Conteneurs d'Apport Volontaire). Filtrable par commune ou statut.",
    input_schema: {
      type: 'object',
      properties: {
        commune: { type: 'string', description: 'Commune pour filtrer.' },
        statut: { type: 'string', enum: ['active', 'unavailable'], description: 'Statut du CAV.' },
      },
      required: [],
    },
  },
];

// ── Tool execution (read-only) ──────────────────────────────────────────

async function executeTool(toolName, toolInput, userCtx) {
  try {
    switch (toolName) {
      case 'query_stock': return await queryStock(toolInput);
      case 'query_planning': return await queryPlanning(toolInput, userCtx);
      case 'query_collecte': return await queryCollecte(toolInput);
      case 'query_heures': return await queryHeures(toolInput, userCtx);
      case 'query_cav': return await queryCav(toolInput);
      default: return JSON.stringify({ error: `Outil inconnu : ${toolName}` });
    }
  } catch (err) {
    console.error(`[SolidataBot] Tool error (${toolName}):`, err.message);
    return JSON.stringify({ error: 'Erreur lors de la requête en base de données.' });
  }
}

async function queryStock({ categorie = '' }) {
  let result;
  if (categorie.trim()) {
    result = await pool.query(`
      SELECT m.categorie, m.sous_categorie,
             COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) AS stock_kg
      FROM matieres m
      LEFT JOIN stock_movements sm ON sm.matiere_id = m.id
      WHERE LOWER(m.categorie) LIKE $1
      GROUP BY m.categorie, m.sous_categorie
      ORDER BY stock_kg DESC
    `, [`%${categorie.toLowerCase()}%`]);
  } else {
    result = await pool.query(`
      SELECT m.categorie,
             COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) AS stock_kg
      FROM matieres m
      LEFT JOIN stock_movements sm ON sm.matiere_id = m.id
      GROUP BY m.categorie
      HAVING COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) > 0
      ORDER BY stock_kg DESC
    `);
  }
  return JSON.stringify(result.rows.length ? { data: result.rows } : { message: 'Aucun stock trouvé.', data: [] });
}

async function queryPlanning({ employee_id }, userCtx) {
  let empId = employee_id;
  if (!empId && userCtx.userId) {
    const r = await pool.query('SELECT id FROM employees WHERE user_id = $1 AND is_active = true', [userCtx.userId]);
    empId = r.rows[0]?.id;
  }
  if (!empId) return JSON.stringify({ error: "Impossible de déterminer l'employé." });

  // RGPD : COLLABORATEUR ne voit que son propre planning
  if (userCtx.role === 'COLLABORATEUR') {
    const own = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userCtx.userId]);
    if (!own.rows[0] || own.rows[0].id !== empId) {
      return JSON.stringify({ error: 'Tu ne peux consulter que ton propre planning.' });
    }
  }

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const result = await pool.query(`
    SELECT s.date, s.status, s.poste_code, s.is_provisional, p.name AS poste_name
    FROM schedule s
    LEFT JOIN positions p ON p.id = s.position_id
    WHERE s.employee_id = $1 AND s.date BETWEEN $2 AND $3
    ORDER BY s.date
  `, [empId, monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)]);

  return JSON.stringify({
    employee_id: empId,
    semaine: `${monday.toISOString().slice(0, 10)} → ${sunday.toISOString().slice(0, 10)}`,
    planning: result.rows,
  });
}

async function queryCollecte({ date, periode = 'jour' }) {
  const refDate = date ? new Date(date) : new Date();
  if (isNaN(refDate.getTime())) return JSON.stringify({ error: 'Format de date invalide.' });

  let start, end;
  if (periode === 'semaine') {
    start = new Date(refDate);
    start.setDate(refDate.getDate() - refDate.getDay() + (refDate.getDay() === 0 ? -6 : 1));
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (periode === 'mois') {
    start = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    end = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
  } else {
    start = end = refDate;
  }

  const result = await pool.query(`
    SELECT COUNT(*) AS nb_tournees,
           COALESCE(SUM(total_weight_kg), 0) AS poids_total_kg,
           COALESCE(SUM(nb_cav), 0) AS cav_visites,
           COUNT(CASE WHEN status = 'completed' THEN 1 END) AS terminees
    FROM tours
    WHERE date BETWEEN $1 AND $2
  `, [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]);

  const row = result.rows[0];
  row.periode = periode;
  row.du = start.toISOString().slice(0, 10);
  row.au = end.toISOString().slice(0, 10);
  return JSON.stringify(row);
}

async function queryHeures({ employee_id, periode = 'semaine' }, userCtx) {
  let empId = employee_id;
  if (!empId && userCtx.userId) {
    const r = await pool.query('SELECT id FROM employees WHERE user_id = $1 AND is_active = true', [userCtx.userId]);
    empId = r.rows[0]?.id;
  }
  if (!empId) return JSON.stringify({ error: "Impossible de déterminer l'employé." });

  if (userCtx.role === 'COLLABORATEUR') {
    const own = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userCtx.userId]);
    if (!own.rows[0] || own.rows[0].id !== empId) {
      return JSON.stringify({ error: 'Tu ne peux consulter que tes propres heures.' });
    }
  }

  const today = new Date();
  let start, end;
  if (periode === 'mois') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else {
    start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  }

  const result = await pool.query(`
    SELECT date, hours_worked, overtime_hours, type
    FROM work_hours
    WHERE employee_id = $1 AND date BETWEEN $2 AND $3
    ORDER BY date
  `, [empId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]);

  const total = result.rows.reduce((sum, r) => sum + (parseFloat(r.hours_worked) || 0), 0);
  return JSON.stringify({
    employee_id: empId,
    periode: `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
    total_heures: Math.round(total * 10) / 10,
    detail: result.rows,
  });
}

async function queryCav({ commune = '', statut = '' }) {
  const conditions = [];
  const params = [];
  let idx = 1;
  if (commune.trim()) {
    conditions.push(`LOWER(commune) LIKE $${idx++}`);
    params.push(`%${commune.toLowerCase()}%`);
  }
  if (statut.trim()) {
    conditions.push(`status = $${idx++}`);
    params.push(statut);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const result = await pool.query(`
    SELECT name, address, commune, status, nb_containers,
           ROUND(avg_fill_rate::numeric, 1) AS taux_remplissage
    FROM cav ${where}
    ORDER BY commune, name LIMIT 20
  `, params);

  const countResult = await pool.query(`SELECT COUNT(*) FROM cav ${where}`, params);
  return JSON.stringify({
    total: parseInt(countResult.rows[0].count),
    affichage: result.rows.length,
    cav: result.rows,
  });
}

// ── Claude API interaction ──────────────────────────────────────────────

let anthropicClient = null;

function getClient() {
  if (!anthropicClient && ANTHROPIC_API_KEY) {
    anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

async function chatWithClaude(userMessage, sessionId, userCtx) {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY non configurée');

  const history = getSession(sessionId);
  history.push({ role: 'user', content: userMessage });

  const messages = [...history];
  const maxIterations = 5;

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const assistantContent = response.content;
    messages.push({ role: 'assistant', content: assistantContent });

    const toolUses = assistantContent.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) {
      const textParts = assistantContent.filter(b => b.type === 'text').map(b => b.text);
      const finalText = textParts.join('\n') || '🤔';
      history.push({ role: 'assistant', content: finalText });
      saveSession(sessionId, history);
      return finalText;
    }

    // Execute tools
    const toolResults = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input, userCtx);
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return "Désolé, je n'ai pas pu traiter ta demande. Réessaie ! 🔄";
}

// ── Routes ──────────────────────────────────────────────────────────────

// POST /api/chat
router.post('/', authenticate, async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message requis' });
    }

    const userMessage = message.trim().slice(0, MAX_MSG_LENGTH);
    const userId = req.user.userId;

    if (!checkRateLimit(userId)) {
      return res.status(429).json({ error: 'Trop de messages. Attends un peu ! ⏳' });
    }

    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Service IA non configuré. Contacte un admin. 🔧' });
    }

    const sessionId = session_id || `u${userId}_${Date.now().toString(36)}`;
    const userCtx = { userId, role: req.user.role, username: req.user.username };

    const reply = await chatWithClaude(userMessage, sessionId, userCtx);

    res.json({ reply, session_id: sessionId, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[SolidataBot] Chat error:', err.message);
    if (err.status === 429) {
      return res.status(503).json({ error: "L'IA est surchargée. Réessaie dans quelques secondes. ⏳" });
    }
    res.status(500).json({ error: 'Une erreur est survenue. Réessaie ! 🔄' });
  }
});

// GET /api/chat/suggestions — suggestions contextuelles
router.get('/suggestions', authenticate, async (req, res) => {
  const role = req.user.role;
  const hour = new Date().getHours();

  const baseSuggestions = [
    { icon: '📦', text: 'Quel est le stock actuel ?', category: 'stock' },
    { icon: '🚛', text: 'Stats collecte du jour', category: 'collecte' },
    { icon: '📅', text: 'Mon planning cette semaine', category: 'planning' },
    { icon: '⏰', text: 'Mes heures cette semaine', category: 'heures' },
    { icon: '📍', text: 'Liste des CAV actifs', category: 'cav' },
  ];

  // Suggestions contextuelles selon l'heure
  if (hour < 10) {
    baseSuggestions.unshift({ icon: '☀️', text: 'Quelles sont mes missions aujourd\'hui ?', category: 'planning' });
  } else if (hour >= 16) {
    baseSuggestions.unshift({ icon: '📊', text: 'Bilan collecte de la journée', category: 'collecte' });
  }

  // Suggestions selon le rôle
  if (['ADMIN', 'MANAGER'].includes(role)) {
    baseSuggestions.push(
      { icon: '📈', text: 'Stats collecte cette semaine', category: 'collecte' },
      { icon: '🗺️', text: 'CAV indisponibles', category: 'cav' },
      { icon: '📦', text: 'Stock crème disponible', category: 'stock' },
    );
  }

  res.json({ suggestions: baseSuggestions.slice(0, 8) });
});

// GET /api/chat/alerts/cav-uncollected — CAV non ramassés alors que prévus en tournée
router.get('/alerts/cav-uncollected', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tc.cav_id, c.name as cav_name, c.commune, t.id as tour_id, t.date,
             v.registration as vehicle
      FROM tour_cav tc
      JOIN tours t ON t.id = tc.tour_id
      JOIN cav c ON c.id = tc.cav_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.date = CURRENT_DATE
        AND t.status IN ('completed', 'cancelled')
        AND tc.status != 'collected'
      ORDER BY c.commune, c.name
    `);
    res.json({ alerts: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ALERTS] Erreur CAV non ramassés:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/chat/alerts/cav-full — CAV avec taux remplissage > 80%
router.get('/alerts/cav-full', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, commune, address, avg_fill_rate,
             nb_containers, status
      FROM cav
      WHERE status = 'active' AND avg_fill_rate >= 80
      ORDER BY avg_fill_rate DESC
    `);
    res.json({ alerts: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ALERTS] Erreur CAV pleins:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
