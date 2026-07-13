/**
 * Pseudonymisation des données personnelles AVANT envoi à un LLM tiers (Anthropic).
 * ─────────────────────────────────────────────────────────────────────────────
 * Vague 3 / item 3.C-5 (RGPD-IA). Objectif : MINIMISER, pas neutraliser l'utilité.
 *
 * Le principe : un « pseudonymiseur » est instancié PAR REQUÊTE (par analyse IA
 * ou par tour de chat). Il attribue à chaque personne un jeton STABLE et opaque
 * (« Salarié A », « Salarié B »…) qui remplace le nom réel dans le prompt. La
 * table de correspondance jeton→nom réel ne quitte jamais le serveur : Anthropic
 * ne reçoit que les jetons. À la réception, `rehydrate()` peut re-substituer le
 * nom réel dans la réponse (usage interne, RGPD-neutre — la donnée est déjà chez
 * nous) pour préserver le confort du CIP côté écran.
 *
 * Ce module est PUR (aucune dépendance, aucun accès base ou réseau) → testable.
 *
 * Champs couverts :
 *   - identité directe (prénom/nom, alias candidat↔salarié) → jeton stable
 *   - date de naissance exacte → tranche d'âge (`ageBracket`)
 *   - identifiants (matricule, titre de séjour, NIR, IBAN/BIC) → masqués
 *   - coordonnées (email, téléphone) dans du texte libre → masquées
 *   - mentions du nom réel à l'intérieur d'un texte libre (observations CIP,
 *     bilans, commentaire d'entretien) → remplacées par le jeton
 */

// 0→A, 1→B, … 25→Z, 26→AA, 27→AB … (étiquettes courtes, illimitées).
function letterLabel(n) {
  let x = Math.max(0, Math.floor(Number(n) || 0));
  let s = '';
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAccentsLower(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Familles de lettres accentuées (le texte métier omet souvent les accents :
// « AMELIE » pour « Amélie »). Sert à bâtir un motif tolérant aux accents.
const ACCENT_CLASS = {
  a: 'aàâäáãå', c: 'cç', e: 'eéèêëẽ', i: 'iîïíì',
  o: 'oôöóòõ', u: 'uûüùú', y: 'yÿý', n: 'nñ',
};

// Construit une source de regex insensible aux accents et aux espaces multiples
// à partir d'un nom : chaque lettre de base couvre sa famille accentuée, l'espace
// devient `\s+`, les métacaractères sont échappés.
function accentInsensitiveSource(str) {
  const base = String(str).normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of base) {
    const lower = ch.toLowerCase();
    if (ACCENT_CLASS[lower]) out += `[${ACCENT_CLASS[lower]}]`;
    else if (/\s/.test(ch)) out += '\\s+';
    else if (/[.*+?^${}()|[\]\\]/.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return out;
}

/**
 * Tranche d'âge à partir d'une date de naissance (minimisation : jamais la date
 * exacte). Renvoie null si non exploitable. Bornes pensées IAE (jeunes < 26 ans,
 * seniors 50+).
 */
function ageBracket(birthDate, ref = new Date()) {
  if (!birthDate) return null;
  const d = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  let age = ref.getFullYear() - d.getFullYear();
  const m = ref.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age -= 1;
  if (age < 0 || age > 120) return null;
  if (age < 26) return 'moins de 26 ans';
  if (age < 30) return '26-29 ans';
  if (age < 40) return '30-39 ans';
  if (age < 50) return '40-49 ans';
  if (age < 60) return '50-59 ans';
  return '60 ans et plus';
}

/**
 * Masque les coordonnées présentes dans un texte libre : emails, numéros de
 * téléphone (format FR + international), longues suites de chiffres (NIR, titre
 * de séjour, IBAN). Conservateur : n'attaque pas les années (2026), les petits
 * effectifs ni les montants courants (≤ 8 chiffres) afin de ne pas dénaturer le
 * verbatim métier.
 */
function redactContactInfo(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  // Emails
  out = out.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email masqué]');
  // Téléphones FR / international (0X XX XX XX XX, +33 …)
  out = out.replace(/(?:\+\d{1,3}[ .\-]?)?0?\s?[1-9](?:[ .\-]?\d{2}){4}/g, (m) =>
    (m.replace(/\D/g, '').length >= 9 ? '[numéro masqué]' : m));
  // Longues suites de chiffres (≥ 9 chiffres réels : NIR, titre de séjour, IBAN…)
  out = out.replace(/\d[\d .\-]{7,}\d/g, (m) =>
    (m.replace(/\D/g, '').length >= 9 ? '[numéro masqué]' : m));
  return out;
}

/**
 * Fabrique un pseudonymiseur à durée de vie d'UNE requête.
 * @param {object} [opts]
 * @param {string} [opts.label='Salarié'] libellé des jetons (« Salarié », « Personne »…)
 */
function createPseudonymizer(opts = {}) {
  const label = opts.label || 'Salarié';
  const byKey = new Map();      // clé de dédup → jeton
  const displayByToken = new Map(); // jeton → nom réel (ré-hydratation)
  const namePatterns = [];      // [{ str, token }] pour scrubber le texte libre
  let counter = 0;

  function pushNamePattern(str, token) {
    const s = String(str || '').trim();
    if (s.length < 3) return; // évite les faux positifs sur fragments trop courts
    if (namePatterns.some((p) => p.token === token && stripAccentsLower(p.str) === stripAccentsLower(s))) return;
    namePatterns.push({ str: s, token });
  }

  function registerNamesForToken(token, pairs) {
    for (const pair of pairs) {
      const first = (pair.first || '').trim();
      const last = (pair.last || '').trim();
      const full = `${first} ${last}`.trim();
      const rev = `${last} ${first}`.trim();
      pushNamePattern(full, token);
      if (rev !== full) pushNamePattern(rev, token);
      pushNamePattern(first, token);
      pushNamePattern(last, token);
    }
  }

  /**
   * Enregistre (ou retrouve) une personne et renvoie son jeton stable.
   * @param {object} identity
   * @param {string} [identity.key] clé de dédup explicite (ex. `emp-42`). À défaut,
   *                                dérivée de first+last.
   * @param {string} [identity.first] / [identity.first_name]
   * @param {string} [identity.last]  / [identity.last_name]
   * @param {Array<{first,last}>} [identity.names] alias supplémentaires (même personne)
   * @param {string} [identity.display] nom d'affichage pour la ré-hydratation
   * @returns {string} jeton (« Salarié A »)
   */
  function person(identity = {}) {
    const first = identity.first != null ? identity.first : identity.first_name;
    const last = identity.last != null ? identity.last : identity.last_name;
    const pairs = [{ first: first || '', last: last || '' }, ...(identity.names || [])]
      .filter((p) => (p.first && String(p.first).trim()) || (p.last && String(p.last).trim()));

    const key = identity.key
      ? `k:${identity.key}`
      : `n:${stripAccentsLower(`${first || ''} ${last || ''}`)}`;
    if (key === 'n:') return null; // aucune identité exploitable

    let token = byKey.get(key);
    if (!token) {
      token = `${label} ${letterLabel(counter)}`;
      counter += 1;
      byKey.set(key, token);
      const display = (identity.display || `${first || ''} ${last || ''}`).trim();
      displayByToken.set(token, display || token);
    }
    registerNamesForToken(token, pairs);
    return token;
  }

  /**
   * Nettoie un texte libre : masque les coordonnées puis remplace toute mention
   * d'un nom déjà enregistré par son jeton. Motifs les plus longs (nom complet)
   * traités avant les fragments (prénom/nom seuls).
   */
  function scrubText(text) {
    if (text == null || typeof text !== 'string') return text;
    let out = redactContactInfo(text);
    const ordered = [...namePatterns].sort((a, b) => b.str.length - a.str.length);
    for (const { str, token } of ordered) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${accentInsensitiveSource(str)}(?![\\p{L}\\p{N}])`, 'giu');
      out = out.replace(re, token);
    }
    return out;
  }

  /**
   * Ré-hydrate : remplace les jetons par le nom réel dans toutes les chaînes d'une
   * valeur (récursif sur objets/tableaux). Usage INTERNE (la donnée est déjà chez
   * nous) pour restituer au CIP des noms lisibles. Ne jamais appeler sur un canal
   * accessible à un tiers non habilité.
   */
  function rehydrate(value) {
    const tokens = [...displayByToken.keys()].sort((a, b) => b.length - a.length);
    const replaceIn = (str) => {
      let out = str;
      for (const token of tokens) {
        const display = displayByToken.get(token);
        if (!display || display === token) continue;
        const re = new RegExp(`${escapeRegExp(token)}(?![A-Za-z])`, 'g');
        out = out.replace(re, display);
      }
      return out;
    };
    const walk = (v) => {
      if (typeof v === 'string') return replaceIn(v);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v)) o[k] = walk(v[k]);
        return o;
      }
      return v;
    };
    return walk(value);
  }

  return {
    person,
    tokenFor: person,
    scrubText,
    rehydrate,
    ageBracket: (bd, ref) => ageBracket(bd, ref),
    // Introspection (tests / debug) — ne pas sérialiser vers un tiers.
    _size: () => byKey.size,
  };
}

// ── Assainisseur générique de sorties d'outils (SolidataBot / chat) ──────────
// Défense en profondeur : si un outil renvoie un jour un champ nominatif, il est
// pseudonymisé/masqué AVANT d'atteindre le modèle. Ciblage par NOM DE CLÉ précis
// pour NE PAS toucher les champs légitimes non personnels (`name`/`nom` = nom de
// CAV, `address`/`commune` = adresse d'un point de collecte, etc.).
const NAME_KEYS = new Set([
  'first_name', 'last_name', 'firstname', 'lastname', 'prenom', 'nom_complet',
  'full_name', 'fullname', 'salarie', 'salarie_nom', 'employee_name', 'driver_name',
  'nom_salarie', 'username',
]);
const CONTACT_KEYS = new Set([
  'email', 'mail', 'phone', 'telephone', 'mobile', 'residence_permit_number',
  'numero_titre_sejour', 'matricule', 'malibou_id', 'nir', 'iban', 'bic',
]);
const BIRTH_KEYS = new Set(['birth_date', 'date_naissance', 'birthdate']);

/**
 * Assainit récursivement une valeur (objet/tableau/scalaire) issue d'un outil
 * avant transmission au LLM. `pseudo` est un pseudonymiseur partagé (stabilité
 * intra-requête). Les clés hors listes sont laissées telles quelles (récursion).
 */
function sanitizeToolResult(value, pseudo) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) {
        const lk = k.toLowerCase();
        const val = v[k];
        if (val == null) { o[k] = val; continue; }
        if (NAME_KEYS.has(lk) && typeof val === 'string' && val.trim()) {
          // Découpe « Prénom Nom » de façon best-effort pour un jeton stable.
          const parts = val.trim().split(/\s+/);
          const first = parts[0] || '';
          const last = parts.slice(1).join(' ') || '';
          o[k] = pseudo.person({ key: `tool:${stripAccentsLower(val)}`, first, last, display: val.trim() });
        } else if (CONTACT_KEYS.has(lk)) {
          o[k] = '[masqué]';
        } else if (BIRTH_KEYS.has(lk)) {
          o[k] = ageBracket(val) || '[masqué]';
        } else {
          o[k] = walk(val);
        }
      }
      return o;
    }
    return v;
  };
  return walk(value);
}

/**
 * Variante chaîne : parse un résultat d'outil JSON, l'assainit, ré-sérialise.
 * Tolérante : si le parse échoue, renvoie la chaîne d'origine (ne casse jamais
 * le flux de chat).
 */
function sanitizeToolResultJson(jsonStr, pseudo) {
  if (typeof jsonStr !== 'string') return jsonStr;
  try {
    const parsed = JSON.parse(jsonStr);
    return JSON.stringify(sanitizeToolResult(parsed, pseudo));
  } catch {
    return jsonStr;
  }
}

module.exports = {
  letterLabel,
  ageBracket,
  redactContactInfo,
  createPseudonymizer,
  sanitizeToolResult,
  sanitizeToolResultJson,
};
