/**
 * Service de traitement des CV
 * Extraction du texte, OCR, et analyse des compétences
 */
const fs = require('fs').promises;
const path = require('path');
const pool = require('../config/database');

// Hardcoded default patterns (fallback si la table skill_keywords est vide)
const SKILLS_PATTERNS = {
  'permis_b': /permis\s*b|permis\s*de\s*conduire|cat[ée]gorie\s*b/i,
  'permis_c': /permis\s*c|poids\s*lourds?/i,
  'caces': /caces|cariste|chariot\s*[ée]l[ée]vateur/i,
  'tri_textile': /tri\s*(de\s*)?textiles?|tri\s*v[êe]tements?|triage/i,
  'controle_qualite': /contr[ôo]le\s*(de\s*)?qualit[ée]|qualit[ée]|inspection/i,
  'gestion_equipe': /gestion\s*(d['''\u2019]?)?[ée]quipe|management|encadrement|chef\s*d['''\u2019]?[ée]quipe/i,
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

// Cache pour les patterns DB
let _dbPatternsCache = null;
let _dbPatternsCacheTime = 0;
const DB_PATTERNS_CACHE_TTL = 5 * 60 * 1000;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getSkillPatterns() {
  const now = Date.now();
  if (_dbPatternsCache && (now - _dbPatternsCacheTime) < DB_PATTERNS_CACHE_TTL) {
    return _dbPatternsCache;
  }

  const merged = { ...SKILLS_PATTERNS };

  try {
    const result = await pool.query(
      'SELECT skill_name, keyword, synonyms FROM skill_keywords WHERE is_active = true'
    );

    if (result.rows.length > 0) {
      const dbSkills = {};
      for (const row of result.rows) {
        if (!dbSkills[row.skill_name]) dbSkills[row.skill_name] = [];
        dbSkills[row.skill_name].push(escapeRegex(row.keyword));
        if (row.synonyms && row.synonyms.length > 0) {
          for (const syn of row.synonyms) {
            if (syn.trim()) dbSkills[row.skill_name].push(escapeRegex(syn.trim()));
          }
        }
      }
      for (const [skillName, terms] of Object.entries(dbSkills)) {
        merged[skillName] = new RegExp(terms.join('|'), 'i');
      }
    }
  } catch (err) {
    console.warn('[CV] skill_keywords table non disponible, utilisation des patterns par défaut :', err.message);
  }

  _dbPatternsCache = merged;
  _dbPatternsCacheTime = now;
  return merged;
}

function invalidateSkillPatternsCache() {
  _dbPatternsCache = null;
  _dbPatternsCacheTime = 0;
}

module.exports = {
  SKILLS_PATTERNS,
  getSkillPatterns,
  invalidateSkillPatternsCache,
  escapeRegex,
};
