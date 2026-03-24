const path = require('path');
const fs = require('fs');
const pool = require('../../config/database');

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

module.exports = {
  getSkillPatterns,
  invalidateSkillPatternsCache,
  parseCVFile,
  extractFromCV,
  extractName,
  escapeRegex,
  runOCR,
  SKILLS_PATTERNS,
};
