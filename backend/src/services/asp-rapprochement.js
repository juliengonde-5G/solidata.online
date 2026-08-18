/**
 * Rapprochement « état ASP ↔ collaborateurs SOLIDATA » — fonctions PURES.
 *
 * POURQUOI CE SERVICE
 * ───────────────────
 * Les états mensuels de présence ASP et la base RH de SOLIDATA ne parlent pas
 * tout à fait la même langue :
 *   - le NOM D'USAGE déclaré à l'ASP diffère régulièrement du nom porté par la
 *     paie (nom marital, nom de naissance, prénom composé tronqué) ;
 *   - une dizaine de DATES DE NAISSANCE divergent entre les deux systèmes
 *     (jour ramené au 01 côté paie) ;
 *   - surtout, l'export de paie ne contient JAMAIS les salariés SORTIS, même
 *     pour un mois passé : une part importante des lignes ASP des mois anciens
 *     n'a aucune contrepartie dans l'ERP. Ce n'est ni une erreur de saisie, ni
 *     une erreur de l'utilisateur : c'est une limite de la source.
 *
 * D'où un appariement en CASCADE, du plus sûr au plus approchant, qui expose
 * TOUJOURS le mode retenu (`mode_appariement`) et un score, pour que l'écran
 * affiche la fiabilité du rapprochement plutôt que de la masquer :
 *   1. 'liaison'    — correspondance validée par un humain (table persistée) ;
 *   2. 'nom'        — mêmes jetons de nom (ordre indifférent, casse/accents
 *                     /ponctuation normalisés) ;
 *   3. 'naissance'  — date de naissance exacte NE DÉSIGNANT QU'UN SEUL salarié ;
 *   4. 'approchant' — nom de famille + initiale du prénom, appariement unique.
 * Toute ambiguïté (plusieurs candidats à égalité) ne rapproche RIEN : elle est
 * renvoyée à la liaison manuelle. Aucune fiche RH n'est jamais créée depuis un
 * état ASP (RGPD) : on EXPLIQUE l'écart, on ne le comble pas artificiellement.
 */

/** Jetons du nom : sans accents, en capitales, ponctuation → espace. */
function normalizeNom(value) {
  return String(value == null ? '' : value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ['DE','JESUS','NUNES','ANTONIO'] */
function tokensNom(value) {
  const n = normalizeNom(value);
  return n === '' ? [] : n.split(' ');
}

/** Clé d'ENSEMBLE de jetons (ordre indifférent : « NOM Prénom » ≡ « Prénom NOM »). */
function cleNom(value) {
  return tokensNom(value).slice().sort().join(' ');
}

/** Date pg (Date | 'YYYY-MM-DD') → 'YYYY-MM-DD' | null. */
function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** « NOM Prénom » (règle de nommage 2.20.0). */
function formatEmployeeNom(emp) {
  return [String(emp.last_name || '').toUpperCase(), String(emp.first_name || '').trim()]
    .filter(Boolean).join(' ').trim();
}

/**
 * Index de recherche construit une fois pour toute la campagne d'appariement.
 * @param {Array} employees [{ id, first_name, last_name, birth_date }]
 */
function buildEmployeeIndex(employees) {
  const items = (employees || []).map((e) => {
    const last = tokensNom(e.last_name);
    const first = tokensNom(e.first_name);
    return {
      id: e.id,
      nom: formatEmployeeNom(e),
      last_tokens: last,
      first_tokens: first,
      cle_nom: [...last, ...first].slice().sort().join(' '),
      naissance: isoDate(e.birth_date),
      jetons: new Set([...last, ...first]),
    };
  });

  const parCleNom = new Map();
  const parNaissance = new Map();
  for (const it of items) {
    if (it.cle_nom) {
      if (!parCleNom.has(it.cle_nom)) parCleNom.set(it.cle_nom, []);
      parCleNom.get(it.cle_nom).push(it);
    }
    if (it.naissance) {
      if (!parNaissance.has(it.naissance)) parNaissance.set(it.naissance, []);
      parNaissance.get(it.naissance).push(it);
    }
  }
  return { items, parCleNom, parNaissance };
}

/** Index des liaisons manuelles : clé « nom normalisé | naissance ». */
function buildLiaisonIndex(liaisons) {
  const map = new Map();
  for (const l of liaisons || []) {
    const nom = normalizeNom(l.nom_asp);
    const naiss = isoDate(l.date_naissance);
    // Deux entrées : avec ET sans date, pour tolérer une naissance illisible
    // sur un état (la liaison reste utilisable, le nom fait alors seul foi).
    map.set(`${nom}|${naiss || ''}`, l);
    if (!map.has(`${nom}|`)) map.set(`${nom}|`, l);
  }
  return map;
}

/**
 * Candidats « approchants » : le nom ASP commence (ou finit) par les jetons du
 * nom de famille du salarié, et le jeton suivant partage l'initiale du prénom.
 * Couvre « GERVAIS MARIE LINDSAY » (prénom composé) et « DE JESUS NUNES
 * ANTONIO » (nom de famille en 3 jetons).
 */
function candidatsApprochants(aspTokens, index) {
  const out = [];
  for (const it of index.items) {
    const lt = it.last_tokens;
    const ft = it.first_tokens;
    if (lt.length === 0 || ft.length === 0 || aspTokens.length <= lt.length) continue;
    const initiale = ft[0][0];

    const debutOk = lt.every((t, i) => aspTokens[i] === t);
    if (debutOk && aspTokens[lt.length] && aspTokens[lt.length][0] === initiale) { out.push(it); continue; }

    const offset = aspTokens.length - lt.length;
    const finOk = lt.every((t, i) => aspTokens[offset + i] === t);
    if (finOk && aspTokens[0] && aspTokens[0][0] === initiale) out.push(it);
  }
  return out;
}

/**
 * Apparie UNE ligne ASP.
 * @param {Object} asp   { nom_asp, date_naissance }
 * @param {Object} index buildEmployeeIndex(...)
 * @param {Map}    liaisonIndex buildLiaisonIndex(...)
 * @returns {{ employee_id:number|null, employee_nom:string|null,
 *            mode_appariement:'liaison'|'nom'|'naissance'|'approchant'|null,
 *            score:number, ambigu:boolean, candidats:Array }}
 */
function matchAspLine(asp, index, liaisonIndex) {
  const nomNorm = normalizeNom(asp && asp.nom_asp);
  const naissance = isoDate(asp && asp.date_naissance);
  const tokens = tokensNom(asp && asp.nom_asp);
  const vide = { employee_id: null, employee_nom: null, mode_appariement: null, score: 0, ambigu: false, candidats: [] };
  if (!nomNorm) return vide;

  // 1. Liaison manuelle — fait foi, y compris contre un homonyme.
  const liaison = liaisonIndex && (liaisonIndex.get(`${nomNorm}|${naissance || ''}`) || liaisonIndex.get(`${nomNorm}|`));
  if (liaison) {
    const it = index.items.find((x) => x.id === liaison.employee_id);
    return {
      employee_id: liaison.employee_id,
      employee_nom: it ? it.nom : null,
      mode_appariement: 'liaison', score: 1, ambigu: false, candidats: [],
    };
  }

  // 2. Nom (ensemble de jetons). Homonymes → départage par date de naissance.
  const parNom = index.parCleNom.get(cleNom(asp && asp.nom_asp)) || [];
  if (parNom.length === 1) {
    return { employee_id: parNom[0].id, employee_nom: parNom[0].nom, mode_appariement: 'nom', score: 0.95, ambigu: false, candidats: [] };
  }
  if (parNom.length > 1) {
    const exact = naissance ? parNom.filter((x) => x.naissance === naissance) : [];
    if (exact.length === 1) {
      return { employee_id: exact[0].id, employee_nom: exact[0].nom, mode_appariement: 'nom', score: 1, ambigu: false, candidats: [] };
    }
    return { ...vide, ambigu: true, candidats: parNom.map((x) => ({ employee_id: x.id, nom: x.nom })) };
  }

  // 3. Date de naissance exacte, si elle ne désigne qu'un seul salarié.
  if (naissance) {
    const parNaiss = index.parNaissance.get(naissance) || [];
    if (parNaiss.length === 1) {
      return { employee_id: parNaiss[0].id, employee_nom: parNaiss[0].nom, mode_appariement: 'naissance', score: 0.8, ambigu: false, candidats: [] };
    }
    if (parNaiss.length > 1) {
      // Plusieurs salariés nés le même jour : on ne tranche que si le nom
      // recoupe (au moins un jeton commun) et de façon unique.
      const recoupe = parNaiss.filter((x) => tokens.some((t) => x.jetons.has(t)));
      if (recoupe.length === 1) {
        return { employee_id: recoupe[0].id, employee_nom: recoupe[0].nom, mode_appariement: 'naissance', score: 0.75, ambigu: false, candidats: [] };
      }
      if (recoupe.length > 1) {
        return { ...vide, ambigu: true, candidats: recoupe.map((x) => ({ employee_id: x.id, nom: x.nom })) };
      }
    }
  }

  // 4. Nom de famille + initiale du prénom (nom d'usage, prénom tronqué).
  const approchants = candidatsApprochants(tokens, index);
  if (approchants.length === 1) {
    const it = approchants[0];
    // La naissance connue et DIFFÉRENTE ne disqualifie pas (le jour est parfois
    // ramené au 01 côté paie) mais fait baisser le score.
    const memeNaissance = naissance && it.naissance === naissance;
    return { employee_id: it.id, employee_nom: it.nom, mode_appariement: 'approchant', score: memeNaissance ? 0.85 : 0.6, ambigu: false, candidats: [] };
  }
  if (approchants.length > 1) {
    return { ...vide, ambigu: true, candidats: approchants.map((x) => ({ employee_id: x.id, nom: x.nom })) };
  }

  return vide;
}

/**
 * Motif honnête d'une ligne ASP NON rapprochée :
 *   'non_apparie'        — un collaborateur PLAUSIBLE existe dans l'ERP (jeton
 *                          de nom commun, ou même date de naissance) mais le
 *                          rapprochement automatique n'a pas tranché → la
 *                          liaison manuelle règle le cas ;
 *   'absent_import_paie' — aucun collaborateur plausible : le salarié n'est pas
 *                          dans l'ERP. Cas MAJORITAIRE sur les mois passés :
 *                          l'export de paie ne contient pas les salariés
 *                          sortis. Ce n'est ni une erreur de l'ASP ni une
 *                          erreur de saisie de l'utilisateur.
 */
function motifAspSeul(asp, index, match) {
  if (match && match.ambigu) return 'non_apparie';
  const tokens = tokensNom(asp && asp.nom_asp);
  const naissance = isoDate(asp && asp.date_naissance);
  const plausible = index.items.some((it) => {
    if (naissance && it.naissance === naissance) return true;
    // Un jeton de nom d'au moins 3 lettres en commun (évite « DE », « LE »).
    return tokens.some((t) => t.length >= 3 && it.jetons.has(t));
  });
  return plausible ? 'non_apparie' : 'absent_import_paie';
}

const MOTIF_LIBELLES = {
  absent_import_paie: "Salarié absent de l'export de paie (l'export n'inclut pas les salariés sortis)",
  non_apparie: 'Présent en paie mais non rapproché (nom d\'usage différent) — à lier manuellement',
};

/**
 * Apparie toutes les lignes d'un état.
 * @returns {Array} lignes enrichies { ...asp, employee_id, employee_nom,
 *   mode_appariement, score, ambigu, motif (si non rapproché) }
 */
function rapprocherSalaries(aspLines, employees, liaisons) {
  const index = buildEmployeeIndex(employees);
  const liaisonIndex = buildLiaisonIndex(liaisons);
  return (aspLines || []).map((asp) => {
    const m = matchAspLine(asp, index, liaisonIndex);
    return {
      ...asp,
      employee_id: m.employee_id,
      employee_nom: m.employee_nom,
      mode_appariement: m.mode_appariement,
      score: m.score,
      ambigu: m.ambigu,
      candidats: m.candidats,
      motif: m.employee_id ? null : motifAspSeul(asp, index, m),
    };
  });
}

module.exports = {
  MOTIF_LIBELLES,
  normalizeNom,
  tokensNom,
  cleNom,
  isoDate,
  formatEmployeeNom,
  buildEmployeeIndex,
  buildLiaisonIndex,
  candidatsApprochants,
  matchAspLine,
  motifAspSeul,
  rapprocherSalaries,
};
