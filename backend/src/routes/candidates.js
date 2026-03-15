const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Config multer pour upload CV
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'cv');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `cv_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ══════════════════════════════════════════
// MOTEUR D'ANALYSE CV
// ══════════════════════════════════════════

// Hardcoded default patterns (fallback si la table skill_keywords est vide ou absente)
const SKILLS_PATTERNS = {
  'permis_b': /permis\s*b|permis\s*de\s*conduire|cat[ée]gorie\s*b/i,
  'permis_c': /permis\s*c|poids\s*lourds?/i,
  'caces': /caces|cariste|chariot\s*[ée]l[ée]vateur/i,
  'tri_textile': /tri\s*(de\s*)?textiles?|tri\s*v[êe]tements?|triage/i,
  'controle_qualite': /contr[ôo]le\s*(de\s*)?qualit[ée]|qualit[ée]|inspection/i,
  'gestion_equipe': /gestion\s*(d[''\u2019]?)?[ée]quipe|management|encadrement|chef\s*d[''\u2019]?[ée]quipe/i,
  'sst': /sst|secouriste|premiers?\s*secours|sauveteur/i,
  'habilitation_electrique': /habilitation\s*[ée]lectrique|[ée]lectricit[ée]/i,
  'logistique': /logistique|supply\s*chain|approvisionnement|magasinier/i,
  'manutention': /manutention|port\s*de\s*charges|manutentionnaire/i,
  'collecte': /collecte|ramassage|enlèvement|benne/i,
  'environnement': /environnement|d[ée]veloppement\s*durable|[ée]cologie|recyclage/i,
  'couture': /couture|retouche|confection|machine\s*[àa]\s*coudre/i,
  'vente': /vente|commerce|commercial|relation\s*client/i,
  'informatique': /informatique|ordinateur|excel|word|logiciel/i,
};

// Cache pour les patterns DB (invalidé toutes les 5 min)
let _dbPatternsCache = null;
let _dbPatternsCacheTime = 0;
const DB_PATTERNS_CACHE_TTL = 5 * 60 * 1000;

/**
 * Charge les skill keywords depuis la table skill_keywords et les fusionne
 * avec les patterns hardcodés. Les entrées DB sont prioritaires.
 */
async function getSkillPatterns() {
  const now = Date.now();
  if (_dbPatternsCache && (now - _dbPatternsCacheTime) < DB_PATTERNS_CACHE_TTL) {
    return _dbPatternsCache;
  }

  // Commencer avec les patterns hardcodés
  const merged = { ...SKILLS_PATTERNS };

  try {
    const result = await pool.query(
      'SELECT skill_name, keyword, synonyms FROM skill_keywords WHERE is_active = true'
    );

    if (result.rows.length > 0) {
      // Regrouper par skill_name
      const dbSkills = {};
      for (const row of result.rows) {
        if (!dbSkills[row.skill_name]) {
          dbSkills[row.skill_name] = [];
        }
        // Ajouter le keyword principal
        dbSkills[row.skill_name].push(escapeRegex(row.keyword));
        // Ajouter les synonymes
        if (row.synonyms && row.synonyms.length > 0) {
          for (const syn of row.synonyms) {
            if (syn.trim()) dbSkills[row.skill_name].push(escapeRegex(syn.trim()));
          }
        }
      }

      // Construire les regex et fusionner (DB overrides hardcoded pour le meme skill_name)
      for (const [skillName, terms] of Object.entries(dbSkills)) {
        merged[skillName] = new RegExp(terms.join('|'), 'i');
      }
    }
  } catch (err) {
    // Table n'existe pas encore ou erreur DB : on utilise les patterns hardcodés
    console.warn('[CV] skill_keywords table non disponible, utilisation des patterns par défaut :', err.message);
  }

  _dbPatternsCache = merged;
  _dbPatternsCacheTime = now;
  return merged;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Invalider le cache des patterns (appelé après CRUD sur skill_keywords)
 */
function invalidateSkillPatternsCache() {
  _dbPatternsCache = null;
  _dbPatternsCacheTime = 0;
}

// ══════════════════════════════════════════
// OCR via Tesseract.js
// ══════════════════════════════════════════
let _tesseractWorker = null;

async function getOCRWorker() {
  if (_tesseractWorker) return _tesseractWorker;
  const Tesseract = require('tesseract.js');
  _tesseractWorker = await Tesseract.createWorker('fra+eng');
  return _tesseractWorker;
}

async function runOCR(filePath) {
  try {
    const worker = await getOCRWorker();
    const { data: { text } } = await worker.recognize(filePath);
    return text || '';
  } catch (err) {
    console.error('[CV] Erreur OCR Tesseract :', err.message);
    return '';
  }
}

// Seuil minimum de texte extrait d'un PDF avant de basculer en OCR (scanned PDF)
const MIN_PDF_TEXT_LENGTH = 50;

/**
 * Parser le texte du CV (PDF avec fallback OCR, images via OCR).
 * Ne lance jamais : retourne '' en cas d'erreur pour éviter 502.
 */
async function parseCVFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
      try {
        const buffer = await fs.promises.readFile(filePath);
        const mod = require('pdf-parse');
        let text = '';
        if (mod.PDFParse) {
          const parser = new mod.PDFParse({ data: buffer });
          const result = await parser.getText();
          text = (result && result.text ? result.text : '').trim();
        } else {
          const fn = typeof mod === 'function' ? mod : (mod && (mod.default || mod.pdf));
          if (typeof fn === 'function') {
            const data = await fn(buffer);
            text = (data && data.text ? data.text : '').trim();
          }
        }
        if (text.length >= MIN_PDF_TEXT_LENGTH) return text;
        return '';
      } catch (err) {
        console.error('[CV] Erreur parsing PDF :', err.message);
        return '';
      }
    }

    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      try {
        console.log('[CV] Fichier image détecté, lancement OCR...');
        return await runOCR(filePath);
      } catch (err) {
        console.error('[CV] Erreur OCR :', err.message);
        return '';
      }
    }

    return '';
  } catch (err) {
    console.error('[CV] parseCVFile erreur :', err.message);
    return '';
  }
}

// ══════════════════════════════════════════
// EXTRACTION NOM / PRÉNOM AMÉLIORÉE
// ══════════════════════════════════════════

/**
 * Détecte si un mot est entièrement en majuscules (nom de famille typique dans les CV français)
 * Gère les caractères accentués : À-Ö, Ø-Þ
 */
function isUpperCase(word) {
  return word.length >= 2 && word === word.toUpperCase() && /^[A-ZÀ-ÖØ-Þ\-']+$/u.test(word);
}

/**
 * Détecte si un mot est capitalisé (Prénom typique)
 */
function isCapitalized(word) {
  return word.length >= 2 && /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+$/u.test(word);
}

function extractName(rawText) {
  if (!rawText) return { firstName: null, lastName: null };

  // Travailler sur les 500 premiers caractères pour la recherche de nom
  const header = rawText.substring(0, 500);

  let firstName = null;
  let lastName = null;

  // Stratégie 1 : Labels explicites "Nom :" / "Prénom :" / "Name:" / "Surname:"
  const labelPatterns = [
    // "Prénom : Jean" et "Nom : DUPONT"
    { first: /(?:pr[ée]nom|first\s*name|given\s*name)\s*[:]\s*([A-ZÀ-ÖØ-Þa-zà-öø-ÿ\-']+)/i,
      last:  /(?:nom(?:\s*de\s*famille)?|last\s*name|surname|family\s*name)\s*[:]\s*([A-ZÀ-ÖØ-Þa-zà-öø-ÿ\-']+)/i },
    // "Nom, Prénom : DUPONT, Jean"
    { combined: /(?:nom\s*[,&]\s*pr[ée]nom|nom\s+et\s+pr[ée]nom)\s*[:]\s*([A-ZÀ-ÖØ-Þa-zà-öø-ÿ\-']+)\s*[,\s]\s*([A-ZÀ-ÖØ-Þa-zà-öø-ÿ\-']+)/i,
      order: 'last_first' },
    // "Prénom Nom : Jean DUPONT"
    { combined: /(?:pr[ée]nom\s*[,&]\s*nom|pr[ée]nom\s+et\s+nom)\s*[:]\s*([A-ZÀ-ÖØ-Þa-zà-öø-ÿ\-']+)\s*[,\s]\s*([A-ZÀ-ÖØ-Þa-zà-öø-ÿ\-']+)/i,
      order: 'first_last' },
  ];

  for (const lp of labelPatterns) {
    if (lp.combined) {
      const m = header.match(lp.combined);
      if (m) {
        if (lp.order === 'last_first') {
          lastName = m[1];
          firstName = m[2];
        } else {
          firstName = m[1];
          lastName = m[2];
        }
        return { firstName, lastName };
      }
    } else {
      const firstMatch = header.match(lp.first);
      const lastMatch = header.match(lp.last);
      if (firstMatch) firstName = firstMatch[1];
      if (lastMatch) lastName = lastMatch[1];
      if (firstName && lastName) return { firstName, lastName };
    }
  }

  // Réinitialiser si seul l'un des deux a été trouvé via labels
  if (!firstName || !lastName) {
    firstName = null;
    lastName = null;
  }

  // Stratégie 2 : "Prénom NOM" ou "NOM Prénom" dans les premières lignes
  const lines = header.split(/\n|\r\n?/).map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines.slice(0, 10)) {
    // Ignorer les lignes qui ressemblent à des adresses, emails, téléphones
    if (/@/.test(line) || /^\+?\d/.test(line) || /rue|avenue|boulevard|cedex/i.test(line)) continue;

    const words = line.split(/\s+/).filter(w => w.length >= 2 && /^[A-ZÀ-ÖØ-Þa-zà-öø-ÿ\-']+$/u.test(w));

    if (words.length === 2) {
      const [w1, w2] = words;

      // "Prénom NOM" : capitalized + UPPERCASE
      if (isCapitalized(w1) && isUpperCase(w2)) {
        return { firstName: w1, lastName: w2 };
      }
      // "NOM Prénom" : UPPERCASE + capitalized
      if (isUpperCase(w1) && isCapitalized(w2)) {
        return { firstName: w2, lastName: w1 };
      }
    }

    if (words.length === 3) {
      const [w1, w2, w3] = words;

      // "Prénom NOM NOM" (nom composé)
      if (isCapitalized(w1) && isUpperCase(w2) && isUpperCase(w3)) {
        return { firstName: w1, lastName: w2 + ' ' + w3 };
      }
      // "NOM Prénom Prénom" (prénom composé)
      if (isUpperCase(w1) && isCapitalized(w2) && isCapitalized(w3)) {
        return { firstName: w2 + ' ' + w3, lastName: w1 };
      }
      // "NOM NOM Prénom" (nom composé)
      if (isUpperCase(w1) && isUpperCase(w2) && isCapitalized(w3)) {
        return { firstName: w3, lastName: w1 + ' ' + w2 };
      }
      // "Prénom Prénom NOM"
      if (isCapitalized(w1) && isCapitalized(w2) && isUpperCase(w3)) {
        return { firstName: w1 + ' ' + w2, lastName: w3 };
      }
    }
  }

  // Stratégie 3 : Fallback - ancien regex adapté (cherche en début de texte)
  const text = rawText.replace(/\s+/g, ' ');
  const nameMatch = text.match(/^[^a-z]*?([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+)\s+([A-ZÀ-ÖØ-Þ]{2,})/m);
  if (nameMatch) {
    firstName = nameMatch[1];
    lastName = nameMatch[2];
    return { firstName, lastName };
  }

  // Stratégie 4 : Deux mots capitalisés côte-à-côte dans le header (dernier recours)
  const twoCapMatch = header.match(/\b([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{1,})\s+([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{1,})\b/);
  if (twoCapMatch) {
    firstName = twoCapMatch[1];
    lastName = twoCapMatch[2];
  }

  return { firstName, lastName };
}

/**
 * Extraction complète des données du CV
 */
async function extractFromCV(rawText, skillPatterns) {
  if (!rawText) return { skills: {}, email: null, phone: null, firstName: null, lastName: null };

  const text = rawText.replace(/\s+/g, ' ');

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;

  // Téléphone (formats français)
  const phoneMatch = text.match(/(?:0|\+33\s?)[1-9](?:[\s.-]?\d{2}){4}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[\s.-]/g, '') : null;

  // Nom/Prénom (extraction améliorée)
  const { firstName, lastName } = extractName(rawText);

  // Charger les patterns (hardcodés + DB)
  const patterns = skillPatterns || await getSkillPatterns();

  // Compétences détectées
  const skills = {};
  for (const [skill, pattern] of Object.entries(patterns)) {
    skills[skill] = pattern.test(text) ? 'detected' : 'not_mentioned';
  }

  return { skills, email, phone, firstName, lastName };
}

// Middleware auth pour toutes les routes
router.use(authenticate);

// ══════════════════════════════════════════
// CRUD Skill Keywords (ADMIN only)
// ══════════════════════════════════════════

// GET /api/candidates/keywords — Liste tous les keywords
router.get('/keywords', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM skill_keywords ORDER BY skill_name, keyword'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur liste keywords :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/keywords — Créer un keyword
router.post('/keywords', authorize('ADMIN'), async (req, res) => {
  try {
    const { skill_name, keyword, synonyms } = req.body;

    if (!skill_name || !keyword) {
      return res.status(400).json({ error: 'skill_name et keyword sont requis' });
    }

    const result = await pool.query(
      `INSERT INTO skill_keywords (skill_name, keyword, synonyms)
       VALUES ($1, $2, $3) RETURNING *`,
      [skill_name, keyword, synonyms || []]
    );

    invalidateSkillPatternsCache();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce keyword existe déjà pour cette compétence' });
    }
    console.error('[CANDIDATES] Erreur création keyword :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/keywords/:id — Modifier un keyword
router.put('/keywords/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { skill_name, keyword, synonyms, is_active } = req.body;

    const setClauses = [];
    const values = [];
    let i = 1;

    if (skill_name !== undefined) { setClauses.push(`skill_name = $${i}`); values.push(skill_name); i++; }
    if (keyword !== undefined) { setClauses.push(`keyword = $${i}`); values.push(keyword); i++; }
    if (synonyms !== undefined) { setClauses.push(`synonyms = $${i}`); values.push(synonyms); i++; }
    if (is_active !== undefined) { setClauses.push(`is_active = $${i}`); values.push(is_active); i++; }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE skill_keywords SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Keyword non trouvé' });
    }

    invalidateSkillPatternsCache();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur modification keyword :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/candidates/keywords/:id — Supprimer un keyword
router.delete('/keywords/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM skill_keywords WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Keyword non trouvé' });
    }

    invalidateSkillPatternsCache();
    res.json({ message: 'Keyword supprimé' });
  } catch (err) {
    console.error('[CANDIDATES] Erreur suppression keyword :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ROUTES CANDIDATES
// ══════════════════════════════════════════

// GET /api/candidates — Liste avec filtres
router.get('/', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { status, search, team_id } = req.query;
    let query = `SELECT c.*, t.name as team_name FROM candidates c LEFT JOIN teams t ON c.assigned_team_id = t.id WHERE 1=1`;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`;
    }
    if (team_id) {
      params.push(team_id);
      query += ` AND c.assigned_team_id = $${params.length}`;
    }

    query += ' ORDER BY c.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/kanban — Groupé par statut
router.get('/kanban', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, t.name as team_name FROM candidates c
       LEFT JOIN teams t ON c.assigned_team_id = t.id
       ORDER BY c.updated_at DESC`
    );

    const kanban = {
      received: [],
      interview: [],
      hired: [],
      rejected: [],
    };

    result.rows.forEach(c => {
      // Migrer les anciens statuts supprimés
      const status = c.status === 'preselected' ? 'received' : c.status === 'test' ? 'interview' : c.status;
      if (kanban[status]) kanban[status].push({ ...c, status });
    });

    res.json(kanban);
  } catch (err) {
    console.error('[CANDIDATES] Erreur kanban :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates — Créer
router.post('/', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, gender, has_permis_b, has_caces, source_email, assigned_team_id } = req.body;

    const result = await pool.query(
      `INSERT INTO candidates (first_name, last_name, email, phone, gender, has_permis_b, has_caces, source_email, assigned_team_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [first_name, last_name, email, phone, gender, has_permis_b || false, has_caces || false, source_email, assigned_team_id]
    );

    // Historique
    await pool.query(
      'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
      [result.rows[0].id, 'received', 'Candidature créée', req.user.id]
    );

    // Compétences initiales (hardcodés + DB)
    const patterns = await getSkillPatterns();
    for (const skill of Object.keys(patterns)) {
      await pool.query(
        'INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [result.rows[0].id, skill, 'not_mentioned', req.user.id]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/stats — KPIs recrutement
router.get('/stats', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const counts = await pool.query(
      `SELECT status, COUNT(*)::int as count FROM candidates GROUP BY status`
    );
    const total = await pool.query('SELECT COUNT(*)::int as count FROM candidates');
    const thisMonth = await pool.query(
      `SELECT COUNT(*)::int as count FROM candidates WHERE created_at >= date_trunc('month', NOW())`
    );
    const withPCM = await pool.query(
      `SELECT COUNT(DISTINCT candidate_id)::int as count FROM pcm_reports`
    );

    const byStatus = {};
    counts.rows.forEach(r => { byStatus[r.status] = r.count; });

    res.json({
      total: total.rows[0].count,
      thisMonth: thisMonth.rows[0].count,
      withPCM: withPCM.rows[0].count,
      byStatus,
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// POSITIONS (Postes) — declared before /:id routes
// ══════════════════════════════════════════

router.get('/positions/list', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const queries = [
      `SELECT p.*, (SELECT COUNT(*)::int FROM candidates c WHERE c.position_id = p.id AND c.status = 'hired') as filled
       FROM positions p WHERE p.is_active = true ORDER BY p.created_at DESC`,
      `SELECT p.*, 0 as filled FROM positions p WHERE p.is_active = true ORDER BY p.id DESC`,
      `SELECT p.*, 0 as filled FROM positions p ORDER BY p.id DESC`,
    ];
    let result;
    for (const sql of queries) {
      try {
        result = await pool.query(sql);
        break;
      } catch (colErr) {
        if (colErr.code !== '42703') throw colErr;
      }
    }
    if (!result) throw new Error('positions list failed');
    res.json(result.rows);
  } catch (err) {
    console.error('[POSITIONS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/positions', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { title, type, month, slots_open, team_type, required_skills } = req.body;
    const result = await pool.query(
      `INSERT INTO positions (title, type, month, slots_open, team_type, required_skills)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, type, month, slots_open || 1, team_type, required_skills || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POSITIONS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/positions/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { title, type, month, slots_open, team_type, required_skills } = req.body;
    const result = await pool.query(
      `UPDATE positions SET title = COALESCE($1, title), type = COALESCE($2, type),
       month = COALESCE($3, month), slots_open = COALESCE($4, slots_open),
       team_type = COALESCE($5, team_type), required_skills = COALESCE($6, required_skills)
       WHERE id = $7 RETURNING *`,
      [title, type, month, slots_open, team_type, required_skills, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Poste non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[POSITIONS] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/positions/:id', authorize('ADMIN'), async (req, res) => {
  try {
    await pool.query('UPDATE candidates SET position_id = NULL WHERE position_id = $1', [req.params.id]);
    const result = await pool.query('DELETE FROM positions WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Poste non trouvé' });
    res.json({ message: 'Poste supprimé' });
  } catch (err) {
    console.error('[POSITIONS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// DOCUMENTS RECRUTEMENT (livret, charte, procédure, fiches)
// IMPORTANT: declared BEFORE /:id routes to avoid Express matching "documents" as :id
// ══════════════════════════════════════════

const RECRUITMENT_DOCS = {
  livret_accueil: { filename: "Livret d'accueil collaborateur.pdf", label: "Livret d'accueil" },
  charte_insertion: { filename: "Charte d'insertion.pdf", label: "Charte d'insertion" },
  procedure_recrutement: { filename: 'Procédure recrutement.pdf', label: 'Procédure de recrutement' },
  fiche_mise_en_situation_collecte: { filename: 'Fiche de mise en situation - Collecte  Manutention.pdf', label: 'Fiche mise en situation - Collecte/Manutention' },
  fiche_mise_en_situation_craquage: { filename: 'Fiche de mise en situation - Craquage.pdf', label: 'Fiche mise en situation - Craquage' },
  fiche_mise_en_situation_qualite: { filename: 'Fiche de mise en situation - Qualité.pdf', label: 'Fiche mise en situation - Qualité' },
};

// GET /api/candidates/documents/list — Liste des documents disponibles
router.get('/documents/list', authorize('ADMIN', 'RH', 'MANAGER'), (req, res) => {
  const docs = Object.entries(RECRUITMENT_DOCS).map(([key, doc]) => ({
    key,
    label: doc.label,
    url: `/uploads/documents/${doc.filename}`,
  }));
  res.json(docs);
});

// GET /api/candidates/documents/download/:docKey — Télécharger un document
router.get('/documents/download/:docKey', authorize('ADMIN', 'RH', 'MANAGER'), (req, res) => {
  const doc = RECRUITMENT_DOCS[req.params.docKey];
  if (!doc) return res.status(404).json({ error: 'Document non trouvé' });
  const filePath = path.join(__dirname, '..', '..', 'uploads', 'documents', doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.download(filePath, doc.filename);
});

// GET /api/candidates/documents/livret-content — Contenu du livret en texte structuré
router.get('/documents/livret-content', authorize('ADMIN', 'RH', 'MANAGER'), (req, res) => {
  res.json({
    title: "Livret d'accueil collaborateur",
    sections: [
      { title: "Bienvenue !", content: "Merci de rejoindre Solidarité Textiles et Frip and Co, nos entreprises d'insertion. Ensemble nous allons construire le monde de demain et bouleverser les habitudes d'aujourd'hui. En rejoignant notre aventure, vous devenez un acteur privilégié de l'économie sociale et solidaire. Vous participez à réduire le gaspillage textile (activité Réemploi), préserver l'extraction de ressources naturelles et innover pour la production de nouveaux matériaux (activité Recyclage). Vous êtes la force de Solidarité Textiles et de Frip and Co." },
      { title: "Qui sommes-nous ?", content: "Solidarité Textiles est une association Loi 1901 agréée « Chantier d'insertion », ayant pour mission de favoriser le retour à l'emploi par le recyclage et la valorisation du textile. Créée en 1995, elle a pour support d'activité la collecte, le tri, le conditionnement et la valorisation des textiles usagés. L'association compte 42 salariés en parcours d'insertion et 7 salariés permanents. Frip & Co, entreprise filiale, se charge de la vente des textiles valorisables." },
      { title: "La filière TLC", content: "La collecte et le négoce des TLC usagés sont des activités économiques de longue date. Solidarité Textiles fait partie de la filière TLC en qualité de collecteur et opérateur de tri, répondant aux objectifs de Refashion (éco-organisme). Chaque trimestre, nous rendons compte des volumes collectés, triés, recyclés et revendus." },
      { title: "Vos premiers pas", content: "Vous devenez Opérateur de Tri TLC. Vos cinq sens seront mis à rude épreuve. Il faut environ 3 mois pour trouver le bon rythme et 6 mois pour que tous vos sens soient en éveil. Les 5R : un moyen mnémotechnique pour lutter contre le gaspillage et réduire notre empreinte environnementale." },
      { title: "Notre rôle", content: "4 camions sillonnent l'agglomération de Rouen. Nos chauffeurs font leurs tournées en binômes dès 7h30, récoltant plus de 5 tonnes de TLC par jour dans 240 collecteurs d'apport volontaire. Au total, 1600 tonnes de déchets textiles par an." },
      { title: "Frip & Co", content: "Les vêtements collectés en bon état sont triés et conditionnés pour les boutiques Frip and Co (Centre-Ville, rue de l'Hôpital — 100 clients/jour) et Frip and Co Family (quartier Saint-Sever, rue Lafayette). En 2026 : ouverture du Vinted Pro et développement de l'upcycling." },
      { title: "Votre contrat (CDDI)", content: "Contrat à Durée Déterminée d'Insertion — 1 mois de période d'essai, 5 mois renouvelable (24 mois max). 26 heures/semaine. 1 jour non travaillé par semaine. 1h de pause déjeuner. 15 jours de congés pour 5 mois." },
      { title: "Vos interlocuteurs", content: "Conseillère d'Insertion Professionnelle pour votre projet professionnel. Encadrement technique : responsable des opérations, responsable logistique, responsable des boutiques et leurs adjoints." },
      { title: "Cadre de vie professionnelle", content: "Convention collective « Atelier Chantier d'Insertion ». Mutuelle obligatoire. Prise en charge 50% transports en commun. Avantage : 1 carton de 5 kg de textiles/mois (sous condition d'assiduité)." },
      { title: "Contact", content: "Solidarité Textiles : 02.32.10.34.81 — contact@solidarite-textiles.fr. CIP Aline ROIX : 06.61.01.10.41 — asp@solidarite-textiles.fr. Bureau technique : 02.32.10.38.79" },
    ],
  });
});

// POST /api/candidates/upload-cv-new — Upload CV → créer nouveau candidat
// IMPORTANT: must be declared BEFORE /:id routes to avoid Express matching "upload-cv-new" as :id
router.post('/upload-cv-new', authorize('ADMIN', 'RH'), (req, res, next) => {
  upload.single('cv')(req, res, (err) => {
    if (err) {
      console.error('[CANDIDATES] Multer upload-cv-new :', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop volumineux (max 10 Mo)' });
      return res.status(400).json({ error: err.message || 'Erreur upload fichier' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier CV requis' });

    const filePath = `/uploads/cv/${req.file.filename}`;
    const rawText = await parseCVFile(req.file.path);
    const skillPatterns = await getSkillPatterns();
    const extracted = await extractFromCV(rawText, skillPatterns);

    const result = await pool.query(
      `INSERT INTO candidates (first_name, last_name, email, phone, cv_file_path, cv_raw_text,
       has_permis_b, has_caces, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'received') RETURNING *`,
      [
        extracted.firstName, extracted.lastName, extracted.email, extracted.phone,
        filePath, rawText,
        extracted.skills.permis_b === 'detected',
        extracted.skills.caces === 'detected',
      ]
    );

    const candidateId = result.rows[0].id;

    // Historique
    await pool.query(
      'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
      [candidateId, 'received', 'Candidature créée depuis upload CV', req.user.id]
    );

    // Compétences
    for (const [skill, status] of Object.entries(extracted.skills)) {
      await pool.query(
        'INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [candidateId, skill, status, req.user.id]
      );
    }

    res.status(201).json({
      candidate: result.rows[0],
      extracted: {
        email: extracted.email,
        phone: extracted.phone,
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        skills: extracted.skills,
      },
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur upload-cv-new :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id
router.get('/:id', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, t.name as team_name FROM candidates c
       LEFT JOIN teams t ON c.assigned_team_id = t.id WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/:id
router.put('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const setClauses = [];
    const values = [];
    let i = 1;

    const allowedFields = [
      'first_name', 'last_name', 'email', 'phone', 'gender',
      'has_permis_b', 'has_caces', 'appointment_date', 'appointment_location',
      'sms_response', 'interviewer_name', 'interview_comment',
      'practical_test_done', 'practical_test_result', 'practical_test_comment',
      'assigned_team_id', 'position_id', 'comment',
    ];

    // Champs qui doivent être NULL au lieu de '' pour PostgreSQL (date, FK, CHECK constraints)
    const nullableFields = ['appointment_date', 'position_id', 'assigned_team_id', 'practical_test_result', 'sms_response', 'gender'];

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        setClauses.push(`${field} = $${i}`);
        const val = nullableFields.includes(field) && fields[field] === '' ? null : fields[field];
        values.push(val);
        i++;
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE candidates SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/:id/status — Déplacer dans le Kanban
router.put('/:id/status', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;
    const validStatuses = ['received', 'interview', 'hired', 'rejected'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const current = await pool.query('SELECT status FROM candidates WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });

    const fromStatus = current.rows[0].status;

    const result = await pool.query(
      'UPDATE candidates SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );

    await pool.query(
      'INSERT INTO candidate_history (candidate_id, from_status, to_status, comment, changed_by) VALUES ($1, $2, $3, $4, $5)',
      [id, fromStatus, status, comment, req.user.id]
    );

    // Auto-délivrer le livret d'accueil + charte d'insertion quand le candidat est embauché
    if (status === 'hired') {
      for (const docType of ['livret_accueil', 'charte_insertion']) {
        await pool.query(
          `INSERT INTO recruitment_documents (candidate_id, document_type, delivered_by, delivery_method)
           VALUES ($1, $2, $3, 'email')
           ON CONFLICT (candidate_id, document_type) DO NOTHING`,
          [id, docType, req.user.id]
        ).catch(() => {}); // Ignore si table n'existe pas encore
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/upload-cv — Upload CV existant
router.post('/:id/upload-cv', authorize('ADMIN', 'RH'), upload.single('cv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier CV requis' });

    const { id } = req.params;
    const filePath = `/uploads/cv/${req.file.filename}`;

    // Parser le CV (avec OCR si nécessaire)
    const rawText = await parseCVFile(req.file.path);
    const skillPatterns = await getSkillPatterns();
    const extracted = await extractFromCV(rawText, skillPatterns);

    // Mettre à jour le candidat
    const updates = { cv_file_path: filePath, cv_raw_text: rawText };
    if (extracted.email) updates.email = extracted.email;
    if (extracted.phone) updates.phone = extracted.phone;

    await pool.query(
      `UPDATE candidates SET cv_file_path = $1, cv_raw_text = $2,
       email = COALESCE($3, email), phone = COALESCE($4, phone),
       has_permis_b = COALESCE($5, has_permis_b),
       has_caces = COALESCE($6, has_caces),
       updated_at = NOW() WHERE id = $7`,
      [
        filePath, rawText, extracted.email, extracted.phone,
        extracted.skills.permis_b === 'detected' ? true : null,
        extracted.skills.caces === 'detected' ? true : null,
        id,
      ]
    );

    // Mettre à jour les compétences détectées
    for (const [skill, status] of Object.entries(extracted.skills)) {
      await pool.query(
        `INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (candidate_id, skill_name) DO UPDATE SET status = $3, updated_by = $4, updated_at = NOW()`,
        [id, skill, status, req.user.id]
      );
    }

    res.json({
      message: 'CV uploadé et analysé',
      filePath,
      extracted: {
        email: extracted.email,
        phone: extracted.phone,
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        skills: extracted.skills,
      },
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur upload CV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/download-cv
router.get('/:id/download-cv', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query('SELECT cv_file_path FROM candidates WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0 || !result.rows[0].cv_file_path) {
      return res.status(404).json({ error: 'CV non trouvé' });
    }
    const filePath = path.join(__dirname, '..', '..', result.rows[0].cv_file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
    res.download(filePath);
  } catch (err) {
    console.error('[CANDIDATES] Erreur download CV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/skills
router.get('/:id/skills', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM candidate_skills WHERE candidate_id = $1 ORDER BY skill_name',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur compétences :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/:id/skills/:skillName
router.put('/:id/skills/:skillName', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id, skillName } = req.params;
    const { status } = req.body;

    if (!['not_mentioned', 'detected', 'confirmed'].includes(status)) {
      return res.status(400).json({ error: 'Statut de compétence invalide' });
    }

    const result = await pool.query(
      `INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (candidate_id, skill_name) DO UPDATE SET status = $3, updated_by = $4, updated_at = NOW()
       RETURNING *`,
      [id, skillName, status, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur modification compétence :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/history
router.get('/:id/history', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ch.*, u.first_name as changed_by_name, u.last_name as changed_by_lastname
       FROM candidate_history ch
       LEFT JOIN users u ON ch.changed_by = u.id
       WHERE ch.candidate_id = $1 ORDER BY ch.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur historique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/convert-to-employee — Convertir candidat en employé
router.post('/:id/convert-to-employee', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const { team_id, position, contract_type, contract_start, weekly_hours } = req.body;

    // Vérifier que le candidat existe et est au statut 'hired'
    const candidate = await pool.query('SELECT * FROM candidates WHERE id = $1', [id]);
    if (candidate.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    if (candidate.rows[0].status !== 'hired') {
      return res.status(400).json({ error: 'Le candidat doit être au statut "hired" pour être converti' });
    }

    // Vérifier qu'il n'est pas déjà converti
    const existing = await pool.query('SELECT id FROM employees WHERE candidate_id = $1', [id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ce candidat a déjà été converti en employé', employee_id: existing.rows[0].id });
    }

    const c = candidate.rows[0];

    // Vérifier que le candidat a un nom/prénom
    if (!c.first_name || !c.last_name) {
      return res.status(400).json({ error: 'Le candidat doit avoir un prénom et un nom avant d\'être converti. Complétez sa fiche.' });
    }

    // Récupérer les compétences confirmées du candidat
    const skillsResult = await pool.query(
      "SELECT skill_name FROM candidate_skills WHERE candidate_id = $1 AND status IN ('confirmed', 'detected')",
      [id]
    );
    const skills = skillsResult.rows.map(r => r.skill_name);

    // Créer l'employé avec les données du candidat
    const employee = await pool.query(
      `INSERT INTO employees (candidate_id, first_name, last_name, phone, email,
       team_id, position, contract_type, contract_start, has_permis_b, has_caces,
       weekly_hours, skills)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [id, c.first_name, c.last_name, c.phone, c.email,
       team_id || null, position || null, contract_type || 'CDD',
       contract_start || new Date().toISOString().split('T')[0],
       c.has_permis_b || false, c.has_caces || false,
       weekly_hours || 35, skills]
    );

    // Logger dans l'historique du candidat
    await pool.query(
      'INSERT INTO candidate_history (candidate_id, from_status, to_status, comment, changed_by) VALUES ($1, $2, $3, $4, $5)',
      [id, 'hired', 'converted', `Converti en employé #${employee.rows[0].id}`, req.user.id]
    );

    res.status(201).json({
      message: 'Candidat converti en employé avec succès',
      employee: employee.rows[0],
      skills_transferred: skills.length,
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur conversion :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// TRAME ENTRETIEN DE RECRUTEMENT
// ══════════════════════════════════════════

// GET /api/candidates/:id/interview-form — Récupérer l'entretien structuré
router.get('/:id/interview-form', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM recruitment_interviews WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('[CANDIDATES] Erreur récup entretien :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/interview-form — Sauvegarder l'entretien structuré
router.post('/:id/interview-form', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const f = req.body;

    // Vérifier que le candidat existe
    const candidate = await pool.query('SELECT id FROM candidates WHERE id = $1', [id]);
    if (candidate.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });

    // Upsert: supprimer l'ancien si existe, puis insérer
    await pool.query('DELETE FROM recruitment_interviews WHERE candidate_id = $1', [id]);

    const result = await pool.query(
      `INSERT INTO recruitment_interviews (
        candidate_id, interview_date, interviewer_id,
        presentation_mots, parcours_professionnel, experiences_marquantes,
        situation_actuelle, situation_actuelle_autre,
        duree_sans_emploi, difficultes_recherche, difficultes_recherche_autre,
        freins_emploi, freins_emploi_autre,
        contraintes_horaires, contraintes_horaires_detail,
        structure_accompagnement, structure_accompagnement_autre,
        motivation_integration, motivation_reprise, attentes, attentes_autre,
        experience_activite, comportement_equipe, reaction_consigne, travail_physique,
        disponibilite_horaires, disponibilite_autre, organisation_ponctualite,
        idee_metier, idee_metier_detail, amelioration_souhaitee, question_ouverte,
        evaluation_globale, commentaire_evaluateur
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
      ) RETURNING *`,
      [
        id, f.interview_date || new Date(), req.user.id,
        f.presentation_mots, f.parcours_professionnel, f.experiences_marquantes,
        f.situation_actuelle || null, f.situation_actuelle_autre,
        f.duree_sans_emploi || null, f.difficultes_recherche || [], f.difficultes_recherche_autre,
        f.freins_emploi || [], f.freins_emploi_autre,
        f.contraintes_horaires || null, f.contraintes_horaires_detail,
        f.structure_accompagnement || [], f.structure_accompagnement_autre,
        f.motivation_integration, f.motivation_reprise, f.attentes || [], f.attentes_autre,
        f.experience_activite || [], f.comportement_equipe, f.reaction_consigne, f.travail_physique || null,
        f.disponibilite_horaires || null, f.disponibilite_autre, f.organisation_ponctualite,
        f.idee_metier || null, f.idee_metier_detail, f.amelioration_souhaitee, f.question_ouverte,
        f.evaluation_globale || null, f.commentaire_evaluateur,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur sauvegarde entretien :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// FICHES DE MISE EN SITUATION
// ══════════════════════════════════════════

// GET /api/candidates/:id/mise-en-situation — Récupérer les évaluations
router.get('/:id/mise-en-situation', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.first_name as evaluator_name, u.last_name as evaluator_lastname
       FROM mise_en_situation m
       LEFT JOIN users u ON m.evaluator_id = u.id
       WHERE m.candidate_id = $1 ORDER BY m.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur récup mise en situation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/mise-en-situation — Sauvegarder une évaluation
router.post('/:id/mise-en-situation', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { id } = req.params;
    const f = req.body;

    const validTypes = ['collecte_manutention', 'craquage', 'qualite'];
    if (!validTypes.includes(f.type)) {
      return res.status(400).json({ error: 'Type invalide. Types valides : ' + validTypes.join(', ') });
    }

    // Upsert par type : une seule évaluation par type par candidat
    await pool.query('DELETE FROM mise_en_situation WHERE candidate_id = $1 AND type = $2', [id, f.type]);

    const result = await pool.query(
      `INSERT INTO mise_en_situation (
        candidate_id, type, evaluator_id, evaluation_date,
        respect_consignes, capacite_physique, endurance, comprehension,
        qualite_travail, rapidite, securite, autonomie,
        resultat, points_forts, points_amelioration, commentaire, duree_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
        id, f.type, req.user.id, f.evaluation_date || new Date(),
        f.respect_consignes, f.capacite_physique, f.endurance, f.comprehension,
        f.qualite_travail, f.rapidite, f.securite, f.autonomie,
        f.resultat || null, f.points_forts, f.points_amelioration, f.commentaire, f.duree_minutes,
      ]
    );

    // Mettre à jour le test pratique du candidat si au moins une évaluation est faite
    await pool.query(
      `UPDATE candidates SET practical_test_done = true, updated_at = NOW() WHERE id = $1`,
      [id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur sauvegarde mise en situation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/documents/deliver — Enregistrer la remise d'un document
router.post('/:id/documents/deliver', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { document_type, delivery_method } = req.body;
    if (!RECRUITMENT_DOCS[document_type]) {
      return res.status(400).json({ error: 'Type de document invalide' });
    }

    const result = await pool.query(
      `INSERT INTO recruitment_documents (candidate_id, document_type, delivered_by, delivery_method)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (candidate_id, document_type) DO UPDATE SET delivered_at = NOW(), delivered_by = $3, delivery_method = $4
       RETURNING *`,
      [req.params.id, document_type, req.user.id, delivery_method || 'telechargement']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur remise document :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/documents — Documents remis au candidat
router.get('/:id/documents', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.first_name as delivered_by_name, u.last_name as delivered_by_lastname
       FROM recruitment_documents d
       LEFT JOIN users u ON d.delivered_by = u.id
       WHERE d.candidate_id = $1 ORDER BY d.delivered_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur liste documents :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/candidates/:id
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM candidates WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    res.json({ message: 'Candidat supprimé' });
  } catch (err) {
    console.error('[CANDIDATES] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
