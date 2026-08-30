/**
 * SolidataBot — Route /api/chat
 * Agent conversationnel IA avec Claude API (tool use)
 * Requêtes DB read-only, filtrage RGPD par rôle/user
 */

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../config/database');
const { authenticate, authorize, resolveBaseRole } = require('../middleware/auth');
const { requireMfa } = require('../middleware/mfa');
const { createPseudonymizer, sanitizeToolResultJson } = require('../utils/pii-pseudonymize');
// Outils de lecture des modules 26 à 34 (VAK, RSE, GES, achats, enquêtes,
// chaîne, saturation, arrêts GPS, récurrence, ETP, purges, badgeuse).
const botTools = require('../services/bot-tools');

// ── Config ──────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
// Modèle par défaut à jour (claude-sonnet-4-20250514 était déprécié → 404).
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
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
- Ne révèle jamais d'informations personnelles d'autres utilisateurs. Ce à quoi un rôle a droit est décidé par les outils qui lui sont fournis, jamais par toi.
- Pour les questions de pilotage (finance, insertion, ventes), utilise les outils dédiés SI ils te sont fournis. S'ils ne sont pas disponibles, c'est que l'utilisateur n'y a pas droit : décline poliment.
- Les données d'insertion que tu communiques sont TOUJOURS agrégées (nombres, taux) — ne cite JAMAIS le nom d'un salarié en parcours.
- CHIFFRES : ne donne QUE des chiffres venus d'un outil. Tu n'estimes pas, tu n'extrapoles pas, tu n'arrondis pas « à peu près ». Si un outil ne renvoie pas la donnée demandée, DIS-LE ("je n'ai pas cette information") au lieu de combler.
- DONNÉE ABSENTE ≠ ZÉRO : quand un outil répond null, "disponible: false", « aucune donnée » ou « jamais exécuté », rapporte l'ABSENCE telle quelle. Ne la transforme jamais en 0, en « rien à signaler » ni en « tout va bien ».
- SEUIL D'ANONYMAT : si un résultat d'enquête est marqué "sous_seuil", dis qu'il y a trop peu de réponses pour restituer quoi que ce soit, et ne donne AUCUN détail ni aucune tendance.
- DONNÉES PERSONNELLES SENSIBLES — jamais, quelle que soit la question et quel que soit le rôle : profil PCM, note de profil d'un salarié, freins de santé ou judiciaires, salaire, RQTH, titre de séjour, date de naissance, adresse personnelle, contenu des messages d'autres personnes. Aucun outil ne te les donne : si on te les demande, renvoie vers l'écran concerné, où l'accès est tracé.
- Exemples de réponses :
  * "Stock jeans Rouen : 150 kg 📦"
  * "Ta prochaine mission : collecte mardi 9h 🚛"
  * "Collecte du 25/03 : 2 340 kg récoltés ✅"

CONTEXTE METIER :
- Solidarité Textiles est une SIAE de collecte, tri et valorisation de textiles usagés en Normandie.
- CAV = Conteneur d'Apport Volontaire (point de collecte dans la rue). Un CAV « saturé » déborde : c'est une urgence de collecte.
- Filières : tri, collecte, logistique, boutique Frip & Co.
- Types textiles : crème (réemploi), catégorie 2 (recyclage), CSR (combustible), effilochage, VAK (export).
- Refashion = éco-organisme REP textile. Exutoire = destinataire des produits triés.
- VAK = « Vente Au Kilo » : événement de vente de 2-3 jours par mois au siège, encaissé sur caisse SumUp. On y suit le CA, le POIDS vendu (kg) et le prix moyen au kilo.
- Boutiques : magasins de seconde main (caisse LogicS), suivis en CA, panier moyen, objectifs mensuels.
- RSEi : démarche de labellisation RSE (référentiel de 27 critères, preuves datées, plan d'action). C'est la STRUCTURE qui est labellisée, jamais le logiciel.
- Énergie & GES : relevés d'énergie et d'eau par site, pleins de carburant par véhicule, bilan carbone en tCO2e. Les facteurs d'émission sont INDICATIFS (ADEME), jamais exacts.
- Enquêtes : questionnaires ANONYMES (QVCT, satisfaction). Rien n'est restitué sous 5 réponses.
- Achats responsables : fournisseurs locaux / inclusifs / labellisés, et registre des FDS (fiches de données de sécurité des produits dangereux).
- Effectifs ETP : les ETP d'insertion conventionnés avec l'État (annexe financière ACI). Le chiffre validé à l'ASP FAIT FOI ; le calcul interne n'est qu'un contrôle.
- Temps & Présence : badgeuse par badge RFID (module distinct de l'ancien pointage). Le serveur fait foi, le poste n'est qu'un capteur.
- Messagerie interne : conversations privées, canal « SOLIDATA » des notifications, et toi-même en conversation « SolidataBot ».
- Chaîne de tri : le plan de chaîne ACTIF décrit les postes, leurs effectifs mini/maxi et les zones de dépose.
- Commandes exutoires RÉCURRENTES : elles se régénèrent seules à échéance, avec un créneau de chargement à poser.
- Arrêts GPS : les arrêts de plus de quelques minutes détectés pendant une tournée ; ceux qui ne correspondent à aucun point du programme sont dits « hors programme ».
- RGPD : les purges de rétention tournent en tâche de fond ; leur dernier passage est vérifiable.`;

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
  // Outils de base ajoutés par `services/bot-tools.js` : sûrs pour TOUS les
  // rôles, chauffeurs compris — ils ne renvoient que des données non
  // personnelles (plan de chaîne) ou les données PROPRES de l'appelant
  // (pointages), jamais celles d'un tiers.
  ...botTools.BOT_BASE_TOOLS,
];

// ── Outils de pilotage (Vague 2, item 60d) — LECTURE SEULE, réservés par rôle ─
// Chaque outil est filtré RGPD : seul un utilisateur ayant le rôle de base requis
// le voit dans la liste envoyée à Claude ET peut l'exécuter (double contrôle).
const EXTENDED_TOOLS = [
  {
    name: 'resume_finance',
    // Rôles autorisés (rôle de base résolu) : direction / contrôle de gestion.
    _roles: ['ADMIN', 'MANAGER', 'FINANCE'],
    tool: {
      name: 'resume_finance',
      description: "Synthèse financière de l'année en cours : chiffre d'affaires opérationnel par activité (exutoires, boutiques, vente au kilo) et P&L de synthèse (produits, charges, résultat). Réservé à la direction.",
      input_schema: {
        type: 'object',
        properties: {
          annee: { type: 'integer', description: "Année (défaut: année en cours)." },
        },
        required: [],
      },
    },
  },
  {
    name: 'kpis_insertion',
    // Agrégats non nominatifs de cohorte insertion.
    _roles: ['ADMIN', 'RH', 'MANAGER'],
    tool: {
      name: 'kpis_insertion',
      description: "Indicateurs AGRÉGÉS (non nominatifs) de la cohorte en insertion : nombre en parcours, jalons en retard et à venir, taux de sorties dynamiques de l'année. Ne retourne jamais de nom de salarié.",
      input_schema: {
        type: 'object',
        properties: {
          annee: { type: 'integer', description: "Année pour le taux de sorties (défaut: année en cours)." },
        },
        required: [],
      },
    },
  },
  {
    name: 'ventes_synthese',
    // Performance retail (boutiques + VAK).
    _roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'],
    tool: {
      name: 'ventes_synthese',
      description: "Synthèse des ventes : chiffre d'affaires HT des boutiques mois par mois (année en cours) et résumé de la dernière Vente au Kilo (CA HT, poids vendu). Réservé aux rôles commerce/direction.",
      input_schema: {
        type: 'object',
        properties: {
          annee: { type: 'integer', description: "Année (défaut: année en cours)." },
        },
        required: [],
      },
    },
  },
  // Outils des modules 26 à 34. Chacun porte la liste de rôles EXACTE du
  // `READ` de son routeur natif : le bot n'ouvre jamais plus large que l'écran.
  ...botTools.BOT_EXTENDED_TOOLS,
];

// Table { nom d'outil étendu → rôles de base autorisés } pour le contrôle
// d'exécution (défense en profondeur, indépendante de ce que voit Claude).
// Elle couvre AUTOMATIQUEMENT les outils de bot-tools.js : ils sont concaténés
// à EXTENDED_TOOLS ci-dessus, donc le double contrôle (liste + exécution)
// s'applique à eux sans une ligne de plus.
const EXTENDED_TOOL_ROLES = Object.fromEntries(EXTENDED_TOOLS.map((e) => [e.name, e._roles]));

// Construit la liste d'outils exposée à Claude selon le rôle de base de l'user :
// les 5 outils de base pour tous, + les outils de pilotage autorisés.
function toolsForRole(role) {
  const base = resolveBaseRole(role);
  const extended = EXTENDED_TOOLS.filter((e) => e._roles.includes(base)).map((e) => e.tool);
  return [...TOOLS, ...extended];
}

// ── Tool execution (read-only) ──────────────────────────────────────────

async function executeTool(toolName, toolInput, userCtx) {
  try {
    // Contrôle d'accès des outils de pilotage (défense en profondeur : même si
    // l'outil n'aurait pas dû être exposé, on refuse ici selon le rôle de base).
    if (EXTENDED_TOOL_ROLES[toolName]) {
      const base = resolveBaseRole(userCtx.role);
      if (!EXTENDED_TOOL_ROLES[toolName].includes(base)) {
        return JSON.stringify({ error: "Tu n'as pas accès à cette information." });
      }
    }
    switch (toolName) {
      case 'query_stock': return await queryStock(toolInput);
      case 'query_planning': return await queryPlanning(toolInput, userCtx);
      case 'query_collecte': return await queryCollecte(toolInput);
      case 'query_heures': return await queryHeures(toolInput, userCtx);
      case 'query_cav': return await queryCav(toolInput);
      case 'resume_finance': return await queryResumeFinance(toolInput);
      case 'kpis_insertion': return await queryKpisInsertion(toolInput);
      case 'ventes_synthese': return await queryVentesSynthese(toolInput);
      default: {
        // Outils des modules récents. Le contrôle de rôle a DÉJÀ eu lieu deux
        // fois : filtrage de la liste envoyée au modèle (toolsForRole) puis
        // revérification contre EXTENDED_TOOL_ROLES en tête de cette fonction.
        const res = await botTools.executeBotTool(toolName, toolInput, userCtx);
        if (res !== null) return res;
        return JSON.stringify({ error: `Outil inconnu : ${toolName}` });
      }
    }
  } catch (err) {
    console.error(`[SolidataBot] Tool error (${toolName}):`, err.message);
    return JSON.stringify({ error: 'Erreur lors de la requête en base de données.' });
  }
}

// ── Outils de pilotage (lecture seule) ───────────────────────────────────

// Synthèse finance : CA opérationnel par activité + P&L de synthèse (année en cours).
// Chaque source est résiliente (table absente → 0 + marqueur d'indisponibilité).
async function queryResumeFinance({ annee } = {}) {
  const year = parseInt(annee, 10) || new Date().getFullYear();
  const rd = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const soft = async (q, p) => { try { return (await pool.query(q, p)).rows; } catch (e) { console.error('[SolidataBot] resume_finance:', e.code || e.message); return null; } };

  const exutRows = await soft(`
    SELECT COALESCE(SUM(COALESCE(fx.montant_ht, cp.pesee_client * c.prix_tonne, c.tonnage_prevu * c.prix_tonne, 0)), 0) AS ca
    FROM commandes_exutoires c
    LEFT JOIN LATERAL (SELECT pesee_client FROM controles_pesee WHERE commande_id = c.id ORDER BY id DESC LIMIT 1) cp ON true
    LEFT JOIN LATERAL (SELECT montant_ht FROM factures_exutoires WHERE commande_id = c.id AND source = 'pennylane' AND montant_ht IS NOT NULL ORDER BY id DESC LIMIT 1) fx ON true
    WHERE EXTRACT(YEAR FROM c.date_commande) = $1 AND c.statut IN ('facturee', 'cloturee')`, [year]);
  const boutRows = await soft(`SELECT COALESCE(SUM(total_ht), 0) AS ca FROM boutique_ventes WHERE EXTRACT(YEAR FROM date_vente) = $1`, [year]);
  const vakRows = await soft(`SELECT COALESCE(SUM(total_ht), 0) AS ca FROM vak_ventes WHERE EXTRACT(YEAR FROM date_vente) = $1`, [year]);
  const plRows = await soft(`
    SELECT COALESCE(SUM(CASE WHEN g.account LIKE '7%' THEN g.credit - g.debit ELSE 0 END), 0) AS produits,
           COALESCE(SUM(CASE WHEN g.account LIKE '6%' THEN g.debit - g.credit ELSE 0 END), 0) AS charges
    FROM financial_gl_entries g JOIN financial_exercises e ON g.exercise_id = e.id
    WHERE e.year = $1 AND (g.account LIKE '6%' OR g.account LIKE '7%')`, [year]);

  const exut = rd(exutRows?.[0]?.ca);
  const bout = rd(boutRows?.[0]?.ca);
  const vak = rd(vakRows?.[0]?.ca);
  const plAvailable = plRows && plRows.length > 0 && (Number(plRows[0].produits) || Number(plRows[0].charges));
  const produits = rd(plRows?.[0]?.produits);
  const charges = rd(plRows?.[0]?.charges);

  return JSON.stringify({
    annee: year,
    ca_operationnel_ht: {
      exutoires: exut,
      boutiques: bout,
      vente_au_kilo: vak,
      total: rd(exut + bout + vak),
      note: 'Chiffre d\'affaires opérationnel HT (caisses + commandes exutoires clôturées).',
    },
    pl_synthese: plAvailable
      ? { produits, charges, resultat: rd(produits - charges), note: 'Comptes de classe 7 (produits) et 6 (charges) du Grand Livre.' }
      : { disponible: false, note: 'Aucune écriture comptable importée pour cette année (P&L indisponible).' },
  });
}

// Indicateurs AGRÉGÉS (non nominatifs) de la cohorte insertion.
async function queryKpisInsertion({ annee } = {}) {
  const year = parseInt(annee, 10) || new Date().getFullYear();
  const soft = async (q, p) => { try { return (await pool.query(q, p)).rows; } catch (e) { console.error('[SolidataBot] kpis_insertion:', e.code || e.message); return null; } };

  const cohorte = await soft(`SELECT COUNT(*)::int AS n FROM employees WHERE insertion_status = 'en_parcours' AND is_active = true`);
  const jalons = await soft(`
    SELECT COUNT(*) FILTER (WHERE im.status <> 'realise' AND im.due_date < CURRENT_DATE)::int AS retard,
           COUNT(*) FILTER (WHERE im.status <> 'realise' AND im.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days')::int AS avenir
    FROM insertion_milestones im JOIN employees e ON e.id = im.employee_id
    WHERE e.insertion_status = 'en_parcours' AND e.is_active = true`);
  const sorties = await soft(`
    SELECT COUNT(*) FILTER (WHERE sortie_classification IN ('emploi_durable', 'emploi_transition', 'sortie_positive'))::int AS pos,
           COUNT(*) FILTER (WHERE sortie_classification IS NOT NULL)::int AS tot
    FROM insertion_milestones
    WHERE milestone_type = 'bilan_sortie' AND status = 'realise'
      AND COALESCE(completed_date, updated_at::date) BETWEEN $1 AND $2`, [`${year}-01-01`, `${year}-12-31`]);

  const tot = sorties?.[0]?.tot || 0;
  const pos = sorties?.[0]?.pos || 0;
  return JSON.stringify({
    annee: year,
    nb_en_parcours: cohorte?.[0]?.n || 0,
    jalons_en_retard: jalons?.[0]?.retard || 0,
    jalons_a_venir_7j: jalons?.[0]?.avenir || 0,
    sorties_dynamiques: {
      positives: pos, total: tot,
      taux_pct: tot > 0 ? Math.round((pos / tot) * 100) : null,
    },
    note: 'Données agrégées et anonymes — aucun nom de salarié.',
  });
}

// Synthèse ventes : CA HT boutiques par mois (année en cours) + dernière VAK.
async function queryVentesSynthese({ annee } = {}) {
  const year = parseInt(annee, 10) || new Date().getFullYear();
  const rd = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const soft = async (q, p) => { try { return (await pool.query(q, p)).rows; } catch (e) { console.error('[SolidataBot] ventes_synthese:', e.code || e.message); return null; } };

  const moisRows = await soft(`
    SELECT EXTRACT(MONTH FROM date_vente)::int AS mois, COALESCE(SUM(total_ht), 0) AS ca_ht
    FROM boutique_ventes WHERE EXTRACT(YEAR FROM date_vente) = $1
    GROUP BY 1 ORDER BY 1`, [year]);
  const boutiquesMensuel = (moisRows || []).map((r) => ({ mois: r.mois, ca_ht: rd(r.ca_ht) }));
  const boutiquesTotal = rd(boutiquesMensuel.reduce((s, m) => s + m.ca_ht, 0));

  const vakRows = await soft(`
    SELECT v.libelle, v.date_debut, v.date_fin,
           COALESCE(SUM(vv.total_ht), 0) AS ca_ht,
           COALESCE(SUM(CASE WHEN vv.unite = 'kg' THEN vv.quantite ELSE 0 END), 0) AS poids_kg
    FROM vaks v LEFT JOIN vak_ventes vv ON vv.vak_id = v.id
    GROUP BY v.id, v.libelle, v.date_debut, v.date_fin
    ORDER BY v.date_debut DESC LIMIT 1`);
  const lastVak = vakRows && vakRows[0]
    ? { libelle: vakRows[0].libelle, du: vakRows[0].date_debut, au: vakRows[0].date_fin, ca_ht: rd(vakRows[0].ca_ht), poids_kg: rd(vakRows[0].poids_kg) }
    : null;

  return JSON.stringify({
    annee: year,
    boutiques: { mensuel_ht: boutiquesMensuel, total_ht: boutiquesTotal, note: 'CA HT boutiques (caisse LogicS).' },
    derniere_vak: lastVak || { note: 'Aucune Vente au Kilo enregistrée.' },
  });
}

async function queryStock({ categorie = '' }) {
  let result;
  if (categorie.trim()) {
    result = await pool.query(`
      SELECT m.nom AS categorie, m.famille AS sous_categorie,
             COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) AS stock_kg
      FROM categories_sortantes m
      LEFT JOIN stock_movements sm ON sm.matiere_id = m.id
      WHERE LOWER(m.nom) LIKE $1
      GROUP BY m.nom, m.famille
      ORDER BY stock_kg DESC
    `, [`%${categorie.toLowerCase()}%`]);
  } else {
    result = await pool.query(`
      SELECT m.nom AS categorie,
             COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) AS stock_kg
      FROM categories_sortantes m
      LEFT JOIN stock_movements sm ON sm.matiere_id = m.id
      GROUP BY m.nom
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

  // RGPD : COLLABORATEUR (y compris rôle personnalisé dérivé) ne voit que son propre planning
  if (resolveBaseRole(userCtx.role) === 'COLLABORATEUR') {
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

  if (resolveBaseRole(userCtx.role) === 'COLLABORATEUR') {
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
  // Outils filtrés RGPD selon le rôle de base de l'utilisateur (les outils de
  // pilotage finance/insertion/ventes ne sont exposés qu'aux rôles autorisés).
  const tools = toolsForRole(userCtx.role);
  // RGPD (item 3.C-5) — défense en profondeur : assainit les sorties d'outils
  // avant de les transmettre à Anthropic. Les outils actuels ne renvoient que des
  // données AGRÉGÉES ou les données PROPRES de l'utilisateur (aucun nom de tiers),
  // mais si un outil venait à exposer un champ nominatif (first_name, email…), il
  // serait pseudonymisé/masqué ici. Jeton stable pour la durée du message.
  const pseudo = createPseudonymizer();

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools,
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
      // Assainissement PII avant transmission au modèle (no-op sur les outils
      // actuels, filet de sécurité pour tout futur outil renvoyant une identité).
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: sanitizeToolResultJson(result, pseudo) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return "Désolé, je n'ai pas pu traiter ta demande. Réessaie ! 🔄";
}

// ── Traitement d'un message (partagé HTTP ↔ messagerie interne) ─────────
//
// EXTRACTION MÉCANIQUE (lot L1, contrat §2.5) : tout ce que faisait le corps de
// `POST /api/chat` — plafond de longueur, limitation de débit, contrôle de la
// clé, appel outillé à Claude, journalisation `chatbot_history` — vit ici, et
// l'endpoint HTTP se contente d'appeler cette fonction. Objectif : la
// conversation « SolidataBot » de la messagerie interne emprunte EXACTEMENT le
// même chemin, sans une ligne de logique dupliquée (deux implémentations
// divergeraient au premier correctif).
//
// Les refus sont portés par des erreurs à `code` stable, que chaque appelant
// traduit dans SON registre : statut HTTP pour le widget, message déposé dans
// le fil pour la messagerie. Aucun changement de comportement de l'endpoint.
//
// @param {object} args
// @param {number} args.userId    identifiant du demandeur (limitation de débit + outils self-scope)
// @param {string} args.role      rôle (filtre RGPD des outils de pilotage)
// @param {string} args.message   texte de l'utilisateur
// @param {string} args.sessionId fil de conversation ('msg-<conversation_id>' côté messagerie)
// @param {string} [args.username] identifiant de connexion, pour `chatbot_history`
//                 (optionnel : résolu en base s'il n'est pas fourni)
// @param {boolean} [args.journaliser] écrire dans `chatbot_history` (défaut true).
//
// `journaliser: false` — correctif du 27/08. Un échange passé par la MESSAGERIE
// est déjà stocké dans `messagerie_messages`, qui a une rétention réelle
// (`messagerie.retention_jours`, purge planifiée journalisée). L'écrire une
// seconde fois dans `chatbot_history`, table sans aucune purge, aurait fait
// survivre le contenu à la durée ANNONCÉE au registre RGPD — un écart créé par
// le nouveau flux d'alimentation, pas par la table elle-même.
// Le widget SolidataBot, lui, continue de journaliser : c'est sa seule trace.
// @returns {Promise<{reply: string, response_time_ms: number}>}
async function traiterMessageBot({ userId, role, message, sessionId, username = null, journaliser = true }) {
  const texte = typeof message === 'string' ? message.trim() : '';
  if (!texte) {
    const err = new Error('Message requis');
    err.code = 'MESSAGE_REQUIS';
    throw err;
  }
  const userMessage = texte.slice(0, MAX_MSG_LENGTH);

  if (!checkRateLimit(userId)) {
    const err = new Error('Trop de messages');
    err.code = 'RATE_LIMIT';
    throw err;
  }

  if (!ANTHROPIC_API_KEY) {
    const err = new Error('Service IA non configuré');
    err.code = 'IA_NON_CONFIGUREE';
    throw err;
  }

  const userCtx = { userId, role, username };

  const startTime = Date.now();
  const reply = await chatWithClaude(userMessage, sessionId, userCtx);
  const responseTimeMs = Date.now() - startTime;

  // Journal d'usage. `username` est résolu en base UNIQUEMENT s'il n'a pas été
  // fourni : les deux appelants le connaissent déjà (aucune requête en plus).
  // Rien de tout cela n'a lieu quand l'appelant ne journalise pas : la
  // résolution du nom de compte n'aurait alors aucune destination.
  if (journaliser) {
    let nomCompte = username;
    if (nomCompte == null) {
      try {
        const r = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        nomCompte = r.rows[0] ? r.rows[0].username : null;
      } catch (err) {
        console.error('[SolidataBot] Identifiant de compte illisible :', err.message);
      }
    }
    pool.query(
      `INSERT INTO chatbot_history (user_id, username, session_id, user_message, bot_reply, response_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, nomCompte, sessionId, userMessage, reply, responseTimeMs]
    ).catch(err => console.error('[SolidataBot] Log error:', err.message));
  }

  return { reply, response_time_ms: responseTimeMs };
}

// ── Routes ──────────────────────────────────────────────────────────────

// AUTHENTIFICATION + DOUBLE AUTHENTIFICATION — montées au niveau du ROUTEUR.
//
// Correctif : `/api/chat` était le seul point d'accès aux synthèses de pilotage
// (finance, insertion, ventes, et désormais VAK/RSE/GES/achats/ETP/purges) à
// n'être PAS gardé par `requireMfa`, alors que les 12 routeurs qui servent les
// MÊMES données le sont depuis 2.43.0 (/api/employees, /api/insertion,
// /api/effectifs, /api/rgpd…). Un compte ADMIN ou RH soumis à la double
// authentification mais NON ENROLÉ était refusé partout ailleurs et obtenait
// ici, par la conversation, des agrégats que ces routeurs lui fermaient : un
// contournement reproductible de la doctrine « aucun jeton complet avant le
// second facteur ». La porte se ferme au même endroit que les autres.
//
// PORTÉE : `requireMfa` est un NO-OP INTÉGRAL pour les rôles hors périmètre
// (défaut ADMIN/RH/DPO, réglage `securite.mfa_roles`). MANAGER, QHSE, FINANCE,
// RESP_BTQ, AUTORITE, COLLABORATEUR — et les jetons chauffeur, dont le rôle est
// COLLABORATEUR en dur — passent exactement comme avant : aucune régression sur
// l'assistant du parcours mobile, qui est précisément la surface qu'il ne faut
// pas fermer.
//
// L'ORDRE COMPTE : `requireMfa` lit `req.user`, il doit donc suivre
// `authenticate`. Les deux sont montés ici une seule fois plutôt que répétés
// route par route — un `authenticate` par route en PLUS de celui-ci ferait une
// seconde lecture de `users.token_version` pour rien.
router.use(authenticate);
router.use(requireMfa);


// POST /api/chat
router.post('/', async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message requis' });
    }

    // Le JWT porte `id` (cf. routes/auth.js). L'ancien `req.user.userId` était
    // toujours undefined → rate-limit partagé globalement + outils self-scope
    // (planning/heures) incapables de résoudre l'employé courant. On privilégie
    // `id`, avec repli `userId` pour tout autre format de jeton.
    const userId = req.user.id ?? req.user.userId;
    const sessionId = session_id || `u${userId}_${Date.now().toString(36)}`;

    const { reply } = await traiterMessageBot({
      userId, role: req.user.role, username: req.user.username,
      message, sessionId,
    });

    res.json({ reply, session_id: sessionId, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err.code === 'RATE_LIMIT') {
      return res.status(429).json({ error: 'Trop de messages. Attends un peu ! ⏳' });
    }
    if (err.code === 'IA_NON_CONFIGUREE') {
      return res.status(503).json({ error: 'Service IA non configuré. Contacte un admin. 🔧' });
    }
    console.error('[SolidataBot] Chat error:', err.message);
    if (err.status === 429) {
      return res.status(503).json({ error: "L'IA est surchargée. Réessaie dans quelques secondes. ⏳" });
    }
    res.status(500).json({ error: 'Une erreur est survenue. Réessaie ! 🔄' });
  }
});

// GET /api/chat/suggestions — suggestions contextuelles
router.get('/suggestions', async (req, res) => {
  const base = resolveBaseRole(req.user.role);
  const hour = new Date().getHours();

  // Suggestion contextuelle selon l'heure (une seule).
  const contextuelle = [];
  if (hour < 10) {
    contextuelle.push({ icon: '☀️', text: 'Quelles sont mes missions aujourd\'hui ?', category: 'planning' });
  } else if (hour >= 16) {
    contextuelle.push({ icon: '📊', text: 'Bilan collecte de la journée', category: 'collecte' });
  }

  // Suggestions de PILOTAGE (item 60d) — filtrées RGPD par rôle et priorisées :
  // ce sont précisément les usages (finance / insertion / ventes) que la Vague 2
  // veut rendre visibles au directeur. On les place AVANT les suggestions
  // génériques pour qu'elles survivent au plafonnement à 8 (bug corrigé : elles
  // étaient poussées en fin de liste puis coupées par slice(0, 8)).
  const pilotage = [];
  if (['ADMIN', 'MANAGER', 'FINANCE'].includes(base)) {
    pilotage.push({ icon: '💶', text: 'Résume la finance de cette année', category: 'finance' });
  }
  if (['ADMIN', 'RH', 'MANAGER'].includes(base)) {
    pilotage.push({ icon: '🤝', text: 'Où en est la cohorte insertion ?', category: 'insertion' });
  }
  if (['ADMIN', 'MANAGER', 'RESP_BTQ'].includes(base)) {
    pilotage.push({ icon: '🛍️', text: 'Synthèse des ventes boutiques', category: 'ventes' });
  }

  const baseSuggestions = [
    { icon: '📦', text: 'Quel est le stock actuel ?', category: 'stock' },
    { icon: '🚛', text: 'Stats collecte du jour', category: 'collecte' },
    { icon: '📅', text: 'Mon planning cette semaine', category: 'planning' },
    { icon: '⏰', text: 'Mes heures cette semaine', category: 'heures' },
    { icon: '📍', text: 'Liste des CAV actifs', category: 'cav' },
  ];

  // Extras admin/manager (moins prioritaires que le pilotage).
  const adminExtras = [];
  if (['ADMIN', 'MANAGER'].includes(base)) {
    adminExtras.push(
      { icon: '📈', text: 'Stats collecte cette semaine', category: 'collecte' },
      { icon: '🗺️', text: 'CAV indisponibles', category: 'cav' },
    );
  }

  // Ordre : contextuelle → pilotage (Vague 2) → base → extras admin, puis plafond à 8.
  const suggestions = [...contextuelle, ...pilotage, ...baseSuggestions, ...adminExtras].slice(0, 8);
  res.json({ suggestions });
});

// GET /api/chat/alerts/cav-uncollected — CAV non ramassés alors que prévus en tournée
router.get('/alerts/cav-uncollected', authorize('ADMIN', 'MANAGER'), async (req, res) => {
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
router.get('/alerts/cav-full', authorize('ADMIN', 'MANAGER'), async (req, res) => {
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

// GET /api/chat/history — Historique des conversations SolidataBot (ADMIN)
router.get('/history', authorize('ADMIN'), async (req, res) => {
  try {
    const { user_id, limit: lim, offset: off } = req.query;
    let query = `SELECT ch.*, u.first_name, u.last_name, u.role
                 FROM chatbot_history ch
                 LEFT JOIN users u ON ch.user_id = u.id
                 WHERE 1=1`;
    const params = [];
    if (user_id) { params.push(user_id); query += ` AND ch.user_id = $${params.length}`; }
    query += ' ORDER BY ch.created_at DESC';
    params.push(parseInt(lim) || 100);
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(off) || 0);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as count FROM chatbot_history WHERE 1=1';
    const countParams = [];
    if (user_id) { countParams.push(user_id); countQuery += ` AND user_id = $${countParams.length}`; }
    const countResult = await pool.query(countQuery, countParams);

    res.json({ rows: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error('[CHAT] Erreur history :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/chat/history/stats — Stats d'utilisation SolidataBot
router.get('/history/stats', authorize('ADMIN'), async (req, res) => {
  try {
    const [total, today, byUser, avgTime] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM chatbot_history'),
      pool.query("SELECT COUNT(*) as count FROM chatbot_history WHERE created_at::date = CURRENT_DATE"),
      pool.query(`SELECT ch.user_id, u.first_name, u.last_name, COUNT(*) as count
                  FROM chatbot_history ch LEFT JOIN users u ON ch.user_id = u.id
                  GROUP BY ch.user_id, u.first_name, u.last_name ORDER BY count DESC LIMIT 10`),
      pool.query('SELECT AVG(response_time_ms) as avg_ms FROM chatbot_history WHERE response_time_ms IS NOT NULL'),
    ]);
    res.json({
      total: parseInt(total.rows[0].count),
      today: parseInt(today.rows[0].count),
      by_user: byUser.rows,
      avg_response_ms: Math.round(parseFloat(avgTime.rows[0].avg_ms) || 0),
    });
  } catch (err) {
    console.error('[CHAT] Erreur history stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// GET /api/chat/insights/tour/:id — Observations SolidataBot (Niveau 3.4)
// ══════════════════════════════════════════════════════════════════════
// Génère 1 à N messages courts (texte + niveau + catégorie) synthétisant
// l'état d'une tournée en cours : météo défavorable, remplissage anormal,
// retards, incidents, rendement. Approche règles déterministes (pas
// d'appel LLM à chaque requête — budget et latence maîtrisés).
router.get('/insights/tour/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    const tour = await pool.query(
      `SELECT t.*, v.registration
         FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.id = $1`,
      [tourId]
    );
    if (tour.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    const t = tour.rows[0];

    const [pointsRes, weightsRes, incidentsRes, contextRes] = await Promise.all([
      pool.query(
        `SELECT status, fill_level, collected_at, planned_passage_time
           FROM tour_cav WHERE tour_id = $1`,
        [tourId]
      ).catch(() => ({ rows: [] })),
      // Toutes les pesées : une pesée intermédiaire est un chargement déposé au
      // centre, pas un relevé provisoire (correctif d'août 2026).
      pool.query(
        `SELECT COALESCE(SUM(weight_kg), 0)::float AS total
           FROM tour_weights WHERE tour_id = $1`,
        [tourId]
      ),
      pool.query(
        `SELECT type, status FROM incidents WHERE tour_id = $1`,
        [tourId]
      ),
      pool.query(
        `SELECT weather_label, temp_max, precip_mm FROM collection_context WHERE date = $1`,
        [t.date]
      ).catch(() => ({ rows: [] })),
    ]);

    const points = pointsRes.rows;
    const collected = points.filter(p => p.status === 'collected');
    const nbCollected = collected.length;
    const nbTotal = points.length;
    const avgFill = nbCollected > 0
      ? (collected.reduce((s, p) => s + (p.fill_level || 0), 0) / nbCollected) * 20
      : null;

    const delays = collected
      .filter(p => p.planned_passage_time && p.collected_at)
      .map(p => (new Date(p.collected_at) - new Date(p.planned_passage_time)) / 60000);
    const avgDelay = delays.length > 0 ? delays.reduce((s, d) => s + d, 0) / delays.length : null;

    const totalWeight = parseFloat(weightsRes.rows[0]?.total || 0);
    const openIncidents = incidentsRes.rows.filter(i => i.status === 'open').length;
    const weather = contextRes.rows[0] || null;

    const insights = [];

    if (weather) {
      const label = (weather.weather_label || '').toLowerCase();
      if (/pluie|orage|neige|averse/.test(label)) {
        insights.push({
          level: 'warn', category: 'weather',
          message: `Météo défavorable (${weather.weather_label}${weather.precip_mm ? `, ${weather.precip_mm} mm` : ''}) — vigilance glissance et retards.`,
        });
      } else if (weather.temp_max != null && weather.temp_max >= 25) {
        insights.push({
          level: 'info', category: 'weather',
          message: `Forte chaleur (${Math.round(weather.temp_max)}°C) — prévoir hydratation et pauses supplémentaires.`,
        });
      }
    }

    if (avgFill !== null) {
      if (avgFill >= 90) {
        insights.push({
          level: 'warn', category: 'fill',
          message: `Remplissage moyen très élevé (${Math.round(avgFill)} %) — risque de débordement, envisager un retour intermédiaire au centre.`,
        });
      } else if (avgFill <= 25 && nbCollected >= 5) {
        insights.push({
          level: 'info', category: 'fill',
          message: `Remplissage moyen faible (${Math.round(avgFill)} %) — la fréquence de collecte pourrait être réduite sur ce secteur.`,
        });
      }
    }

    if (avgDelay !== null && avgDelay > 20) {
      insights.push({
        level: 'warn', category: 'delay',
        message: `Retard moyen de ${Math.round(avgDelay)} min par CAV — envisager une ré-optimisation de l'ordre restant.`,
      });
    }

    if (openIncidents >= 2) {
      insights.push({
        level: 'error', category: 'incidents',
        message: `${openIncidents} incidents non résolus — priorité avant clôture.`,
      });
    }

    if (totalWeight > 0 && t.estimated_distance_km > 0) {
      const ratio = totalWeight / t.estimated_distance_km;
      if (nbCollected >= 10 && ratio < 8) {
        insights.push({
          level: 'info', category: 'efficiency',
          message: `Rendement bas : ${ratio.toFixed(1)} kg/km parcouru — revoir ciblage ou fréquence de passage.`,
        });
      }
    }

    if (nbTotal > 0 && nbCollected / nbTotal >= 0.8 && openIncidents === 0) {
      insights.push({
        level: 'info', category: 'progress',
        message: `Tournée bien avancée (${nbCollected}/${nbTotal}) sans incident — projection favorable.`,
      });
    }

    res.json({
      tour_id: tourId,
      generated_at: new Date().toISOString(),
      source: 'rules',
      insights,
    });
  } catch (err) {
    console.error('[CHAT] insights error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
// Exposés pour les tests (RGPD tool-gating). N'affecte pas le montage du routeur.
module.exports.toolsForRole = toolsForRole;
module.exports.EXTENDED_TOOL_ROLES = EXTENDED_TOOL_ROLES;
// Exposé pour les tests du DEUXIÈME contrôle d'accès : celui qui a lieu à
// l'EXÉCUTION, indépendamment de ce que le modèle a reçu comme liste d'outils.
// C'est la garde qui tient si un outil est un jour exposé par erreur.
module.exports.executeTool = executeTool;
// Consommé par la messagerie interne (routes/messages.js, conversation « bot ») :
// même logique conversationnelle que le widget, jamais recopiée.
module.exports.traiterMessageBot = traiterMessageBot;
