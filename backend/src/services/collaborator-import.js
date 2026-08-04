/**
 * Service d'import des collaborateurs (RH).
 *
 * Source : export du logiciel de gestion Malibou (classeur .xlsx multi-feuilles
 * ou copier-coller CSV d'une feuille).
 *
 * Deux points d'entrée publics :
 *   - parseWorkbookBuffer(buffer)  → lit un .xlsx Malibou (feuilles
 *     « Informations salariés » + « Contrats ») et renvoie une liste
 *     d'objets collaborateurs normalisés.
 *   - upsertCollaborators(client, collaborators, { userId }) → applique la
 *     liste en base de façon IDEMPOTENTE (met à jour l'existant, ne crée que
 *     les nouveaux). C'est ce qui remplace l'ancien « DELETE tout puis INSERT »
 *     qui générait un doublon inactif à chaque réimport.
 *
 * Clé d'appariement (dans l'ordre) :
 *   1. malibou_id (Matricule) — identifiant stable du logiciel de paie.
 *   2. À défaut, nom + prénom normalisés (insensible casse/accents) — permet
 *      de rattacher les fiches créées avant l'arrivée du Matricule et d'éviter
 *      un doublon quand le Matricule change.
 *
 * Fusion non destructive : une valeur vide dans l'import n'écrase JAMAIS une
 * valeur déjà saisie en base (COALESCE). Seul `is_active` (colonne « Contrat
 * actif ») est appliqué explicitement car c'est l'export qui fait foi.
 */

const ExcelJS = require('exceljs');
const { resyncMilestones, generateMilestones, computeCddiCumulativeMonths } = require('../routes/insertion/engine');

// ── Référentiels de mapping ────────────────────────────────────────────────

// Intitulé de poste (feuille Contrats / colonne Poste) → type d'équipe interne.
const POSITION_TO_TEAM = {
  'Encadrante Technique': 'tri',
  'Conseillère En Insertion Principale / Référente': 'administration',
  'Salarie Polyvalent Cddi': 'tri',
  'Operateur De Tri Cddi': 'tri',
  'Operatrice De Tri Cddi': 'tri',
  'Chauffeur / Suiveur / Manutentionnaire Cddi': 'collecte',
  'Chauffeur Suiveur Polyvalent': 'collecte',
  'Chauffeur / Suiveur Cddi': 'collecte',
  'Operateur De Presse / Manutentionnaire Cddi': 'tri',
  'Conducteur De Presse / Manutentionnaire Cddi': 'tri',
  'Responsable Logistique': 'logistique',
  'Operatrice De Production': 'tri',
  'Cariste Manutentionnaire': 'logistique',
  'Assistant technique': 'administration',
  'Directeur des Opérations': 'administration',
  'Assistant Technique': 'administration',
  'Assistante Administrative': 'administration',
  'Apprenti CIP': 'administration',
};

const CONTRACT_TYPE_MAP = {
  CDI: 'CDI',
  CDD: 'CDD',
  CDDI: 'CDDI',
  Apprentissage: 'apprentissage',
  Stage: 'stage',
  Interim: 'interim',
  'Intérim': 'interim',
};

// ── Helpers de normalisation ───────────────────────────────────────────────

function stripAccents(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeHeader(h) {
  return stripAccents(h).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Nettoie une valeur cellule → string trim, ou null si vide. */
function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Convertit une valeur de date hétérogène en 'YYYY-MM-DD' (ou null).
 * Gère : objet Date (exceljs), 'YYYY-MM-DD[ HH:MM:SS]', ISO, 'JJ/MM/AAAA'.
 * Les cellules Malibou sont datées à 12:00 → pas de dérive de fuseau.
 */
function toISODate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // Déjà en ISO (avec ou sans heure)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Format FR JJ/MM/AAAA ou J-M-AA
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/** « Oui »/« Non » (ou true/1/vrai) → booléen ; null si indéterminé. */
function toBool(v) {
  if (v == null || v === '') return null;
  const u = stripAccents(v).trim().toLowerCase();
  if (['oui', 'o', 'true', '1', 'vrai', 'yes', 'y'].includes(u)) return true;
  if (['non', 'n', 'false', '0', 'faux', 'no'].includes(u)) return false;
  return null;
}

/** Déduit F/M depuis la civilité (Mme/M.) puis un éventuel champ sexe. */
function normalizeGender(civility, genderRaw) {
  // Le SEXE DÉCLARÉ (colonne « Sexe »/« Genre » de l'export paie) prime sur la
  // civilité — la civilité (Mme/M.) n'est qu'un repli quand le sexe n'est pas
  // renseigné (revue Codex PR#83 : sinon un « Mme » avec « Sexe = M » stockait 'F',
  // et l'indicateur F/H perdait la déclaration explicite).
  const g = stripAccents(genderRaw || '').trim().toUpperCase();
  if (['F', 'FEMME', 'FEMININ'].includes(g)) return 'F';
  if (['M', 'H', 'HOMME', 'MASCULIN'].includes(g)) return 'M';
  const c = stripAccents(civility || '').trim().toLowerCase().replace(/\./g, '');
  if (c === 'mme' || c === 'mlle' || c === 'madame' || c === 'mademoiselle') return 'F';
  if (c === 'm' || c === 'mr' || c === 'monsieur') return 'M';
  return null;
}

/** Résout le type d'équipe depuis l'intitulé de poste puis le libellé « Équipe ». */
function resolveTeamType(position, equipeText) {
  if (position && POSITION_TO_TEAM[position]) return POSITION_TO_TEAM[position];
  const e = stripAccents(equipeText || '').toLowerCase();
  if (e.includes('tri')) return 'tri';
  if (e.includes('collecte')) return 'collecte';
  if (e.includes('logistique')) return 'logistique';
  if (e.includes('administ') || e.includes('direction') || e.includes('siege')) return 'administration';
  return null; // laisser NULL plutôt que de forcer 'administration'
}

function normalizeContractType(raw) {
  if (!raw) return null;
  return CONTRACT_TYPE_MAP[String(raw).trim()] || String(raw).trim();
}

// ── Visite médicale (item 43) ───────────────────────────────────────────────

/**
 * Convertit une périodicité de visite médicale texte en nombre de mois.
 * Ex. « 24 mois » → 24, « 2 ans » → 24, « 5 ans » → 60, « 60 » → 60.
 */
function parseMedicalFrequencyMonths(freq) {
  if (!freq) return null;
  const s = stripAccents(String(freq)).toLowerCase().trim();
  let m = s.match(/(\d+)\s*(mois|ans?|annees?|an)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (isNaN(n)) return null;
    return /an/.test(m[2]) ? n * 12 : n;
  }
  m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null; // nombre nu → interprété en mois
}

function addMonthsISO(iso, months) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  // UTC pour rester déterministe quel que soit le fuseau du conteneur.
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Calcule l'échéance de la prochaine visite médicale (item 43) :
 *  - si une visite (post-embauche ou périodique) est connue ET la périodicité
 *    est renseignée → dernière visite connue + périodicité ;
 *  - si une visite est connue mais sans périodicité → pas d'échéance calculable
 *    (null, on n'invente pas de date en retard) ;
 *  - si aucune visite → échéance de la visite d'information et de prévention :
 *    dans les 3 mois suivant le début de contrat.
 */
function computeMedicalDueDate({ contractStart, hireVisit, lastVisit, frequency }) {
  const freqM = parseMedicalFrequencyMonths(frequency);
  const known = [hireVisit, lastVisit].filter(Boolean).sort();
  const lastKnown = known.length ? known[known.length - 1] : null;
  if (lastKnown) return freqM ? addMonthsISO(lastKnown, freqM) : null;
  if (contractStart) return addMonthsISO(contractStart, 3);
  return null;
}

// ── Lecture du classeur .xlsx Malibou ──────────────────────────────────────

/** Valeur texte d'une cellule exceljs (gère richText / hyperlink / formule). */
function cellVal(cell) {
  const v = cell == null ? null : cell.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.text != null) return v.text; // hyperlink
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.result != null) return v.result; // formule
    return null;
  }
  return v;
}

/**
 * Construit un index { header normalisé → n° colonne (1-based) } depuis la
 * ligne d'en-tête d'une worksheet exceljs.
 */
function buildHeaderIndex(worksheet, headerRowNumber = 1) {
  const index = {};
  const row = worksheet.getRow(headerRowNumber);
  row.eachCell((cell, colNumber) => {
    const h = normalizeHeader(cellVal(cell));
    if (h) index[h] = colNumber;
  });
  return index;
}

/** Lit une worksheet en tableau d'objets { headerNormalisé: valeur }. */
function sheetToObjects(worksheet) {
  if (!worksheet) return [];
  const headerIndex = buildHeaderIndex(worksheet, 1);
  const headers = Object.keys(headerIndex);
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // en-tête
    const obj = {};
    let hasData = false;
    for (const h of headers) {
      const val = cellVal(row.getCell(headerIndex[h]));
      obj[h] = val;
      if (val != null && String(val).trim() !== '') hasData = true;
    }
    if (hasData) rows.push(obj);
  });
  return rows;
}

/** Retrouve une worksheet par nom normalisé (tolérant accents/casse). */
function findSheet(workbook, ...candidates) {
  const wanted = candidates.map(normalizeHeader);
  for (const ws of workbook.worksheets) {
    if (wanted.includes(normalizeHeader(ws.name))) return ws;
  }
  return null;
}

/** Récupère la 1re valeur non vide parmi plusieurs en-têtes possibles. */
function pick(obj, ...headers) {
  for (const h of headers) {
    const v = obj[normalizeHeader(h)];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

// ── Lot 3 (2026-08) — Historique des contrats, planning, heures, congés ────

/** Nombre décimal tolérant (virgule FR) → number ou null. */
function toNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Heure 'HH:MM' normalisée (gère string '8:30'/'08h30' et objet Date exceljs). */
function cleanTime(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  const m = String(v).trim().match(/^(\d{1,2})[:hH](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** Veille d'une date ISO (YYYY-MM-DD), en UTC (déterministe). */
function dayBeforeISO(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const DAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const DAY_LABELS = { lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi', vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche' };

/**
 * Planning hebdomadaire contractuel depuis les 28 colonnes horaires de la
 * feuille « Contrats ». RÈGLE MÉTIER : une colonne VIDE = demi-journée NON
 * travaillée → le jour/la demi-journée est simplement ABSENT du JSON.
 * Forme : { lundi: { matin: {debut,fin}, apres_midi: {debut,fin} }, ... }
 * Renvoie null si aucun horaire n'est renseigné (ex. forfait jours).
 */
function parseWeeklySchedule(rowObj) {
  const sched = {};
  let any = false;
  for (const day of DAYS_FR) {
    const label = DAY_LABELS[day];
    const periods = {};
    for (const [key, periodLabel] of [['matin', 'Matin'], ['apres_midi', 'Après-midi']]) {
      const debut = cleanTime(pick(rowObj, `${label} - ${periodLabel} - Heure de début`, `${label} - ${periodLabel} - Heure de debut`));
      const fin = cleanTime(pick(rowObj, `${label} - ${periodLabel} - Heure de fin`));
      if (debut || fin) {
        periods[key] = { debut, fin };
        any = true;
      }
    }
    if (Object.keys(periods).length > 0) sched[day] = periods;
  }
  return any ? sched : null;
}

/** Normalise une ligne brute de la feuille « Contrats » (un avenant). */
function normalizeContractRow(c) {
  const position = cleanStr(pick(c, 'Intitulé de poste', 'Intitule de poste', 'Poste'));
  const rawType = normalizeContractType(pick(c, 'Type de contrat'));
  // Item 41 : un poste « … Cddi » sous type Malibou « CDD » est un CDDI — objet
  // métier central du suivi d'insertion (cumul 24 mois), on ne le perd plus.
  const contractType = (/cddi/i.test(position || '') && String(rawType || '').toUpperCase() === 'CDD')
    ? 'CDDI' : rawType;
  const officialStart = toISODate(pick(c, 'Date de début', 'Date de debut'));
  return {
    matricule: cleanStr(pick(c, 'Matricule')),
    contract_uid: cleanStr(pick(c, 'ID contrat')),
    official_start: officialStart,
    official_end: toISODate(pick(c, 'Date de fin')),
    // Date d'avenant absente (contrat mono-ligne) → la ligne vaut depuis le début.
    avenant_date: toISODate(pick(c, "Date d'avenant")) || officialStart,
    trial_period_end: toISODate(pick(c, "Fin de période d'essai effective", "Fin de période d'essai")),
    dpae_reference: cleanStr(pick(c, 'Référence DPAE', 'Reference DPAE')),
    dpae_date: toISODate(pick(c, 'Date DPAE', "Date d'envoi DPAE")),
    position,
    contract_type: contractType,
    motif_cdd: cleanStr(pick(c, 'Motif du CDD')),
    statut_cadre: toBool(pick(c, 'Statut cadre')),
    qualification: cleanStr(pick(c, 'Qualification')),
    gross_salary: cleanStr(pick(c, 'Salaire brut')),
    work_time_type: cleanStr(pick(c, 'Type de temps de travail')),
    work_time_category: cleanStr(pick(c, 'Temps plein / Temps partiel')),
    days_per_week: toNum(pick(c, 'Nombre de jours par semaine')),
    weekly_hours: toNum(pick(c, "Nombre d'heures par semaine")),
    days_per_year: toNum(pick(c, 'Nombre de jours par an')),
    hours_per_year: toNum(pick(c, "Nombre d'heures par an")),
    weekly_schedule: parseWeeklySchedule(c),
    siret: cleanStr(pick(c, 'SIRET')),
    establishment: cleanStr(pick(c, 'Établissement', 'Etablissement')),
  };
}

/**
 * Chaînage des avenants d'un même matricule (RÈGLE MÉTIER client) :
 *  - tri par Date d'avenant (à défaut Date de début) ;
 *  - période effective d'une ligne = [date d'avenant → date de fin], la ligne
 *    précédente s'arrêtant LA VEILLE de la date d'avenant suivante (sans jamais
 *    dépasser sa propre date de fin officielle — cas de deux contrats disjoints) ;
 *  - la date d'embauche du contrat = Date de début officielle (unique, répétée
 *    sur chaque ligne d'avenant) ;
 *  - origin : 1re ligne du salarié = 'embauche', 1re ligne d'un NOUVEAU contrat
 *    (ID contrat différent) = 'renouvellement', autres lignes = 'avenant'.
 */
function buildContractChain(rows) {
  const sorted = [...rows].sort((a, b) => {
    const ka = a.avenant_date || a.official_start || '';
    const kb = b.avenant_date || b.official_start || '';
    if (ka !== kb) return ka < kb ? -1 : 1;
    const sa = a.official_start || '';
    const sb = b.official_start || '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return sorted.map((row, i) => {
    const effectiveStart = row.avenant_date || row.official_start || null;
    let effectiveEnd = row.official_end || null;
    const next = sorted[i + 1];
    if (next) {
      const nextStart = next.avenant_date || next.official_start;
      const eve = dayBeforeISO(nextStart);
      if (eve && (effectiveEnd == null || eve < effectiveEnd)) effectiveEnd = eve;
      // Deux avenants le même jour (donnée dégénérée) : ne pas inverser la période.
      if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) effectiveEnd = effectiveStart;
    }
    let origin = 'avenant';
    if (i === 0) origin = 'embauche';
    else if (row.contract_uid && sorted[i - 1].contract_uid && row.contract_uid !== sorted[i - 1].contract_uid) origin = 'renouvellement';
    return { ...row, effective_start: effectiveStart, effective_end: effectiveEnd, origin };
  });
}

/**
 * Dédoublonnage de la feuille « Heures travaillées » : Malibou émet UNE ligne
 * par CONTRAT et par semaine, les heures étant DUPLIQUÉES sur chaque ligne
 * (constaté sur l'export réel : 262/277 doublons strictement identiques,
 * les autres portant 0 ou l'ancienne quotité). On retient donc la ligne du
 * contrat à la quotité la plus élevée (dernier avenant) — JAMAIS de somme,
 * qui doublerait les heures.
 */
function pickBetterWeekRow(a, b) {
  const ka = [a.hours_contract || 0, a.hours_expected || 0, a.hours_worked || 0];
  const kb = [b.hours_contract || 0, b.hours_expected || 0, b.hours_worked || 0];
  for (let i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return ka[i] > kb[i] ? a : b;
  }
  return b;
}

/** Feuille « Heures travaillées » → { matricule: [semaines dédoublonnées] }. */
function parseWeekHoursSheet(sheet) {
  const byMat = {};
  for (const r of sheetToObjects(sheet)) {
    const mat = cleanStr(pick(r, 'Matricule'));
    const isoYear = toNum(pick(r, 'Année (ISO)', 'Annee (ISO)'));
    const isoWeek = toNum(pick(r, 'Semaine (ISO)'));
    if (!mat || !isoYear || !isoWeek) continue;
    const row = {
      iso_year: isoYear,
      iso_week: isoWeek,
      week_start: toISODate(pick(r, 'Date de début', 'Date de debut')),
      week_end: toISODate(pick(r, 'Date de fin')),
      statut: cleanStr(pick(r, 'Statut')),
      hours_worked: toNum(pick(r, 'Heures travaillées', 'Heures travaillees')),
      hours_expected: toNum(pick(r, 'Heures attendues')),
      hours_contract: toNum(pick(r, 'Heures contractuelles')),
      hours_absence: toNum(pick(r, "Heures d'absence")),
      hs_0: toNum(pick(r, 'HS 0%')),
      hs_25: toNum(pick(r, 'HS 25%')),
      hs_50: toNum(pick(r, 'HS 50%')),
      h_inf: toNum(pick(r, 'H inf.')),
      hc_0: toNum(pick(r, 'HC 0%')),
      hc_10: toNum(pick(r, 'HC 10%')),
      hours_exc_sunday: toNum(pick(r, 'Heures exceptionnelles (dimanche)')),
      hours_exc_holiday: toNum(pick(r, 'Heures exceptionnelles (jour férié)', 'Heures exceptionnelles (jour ferie)')),
      hours_exc_night: toNum(pick(r, 'Heures exceptionnelles (nuit)')),
    };
    const weeks = (byMat[mat] = byMat[mat] || {});
    const key = `${isoYear}-${isoWeek}`;
    weeks[key] = weeks[key] ? pickBetterWeekRow(row, weeks[key]) : row;
  }
  const out = {};
  for (const [mat, weeks] of Object.entries(byMat)) out[mat] = Object.values(weeks);
  return out;
}

/** Catégorie ERP d'un libellé d'absence Malibou (aligné enum work_hours). */
function categorizeLeaveType(label) {
  const s = stripAccents(label || '').toLowerCase();
  if (/conges? paye|rtt|repos compensateur/.test(s)) return 'holiday';
  if (/maladie|enfant malade/.test(s)) return 'sick';
  return 'absence';
}

/** Feuille « Congés & Télétravail » → { matricule: [absences] }. */
function parseLeavesSheet(sheet) {
  const byMat = {};
  for (const r of sheetToObjects(sheet)) {
    const mat = cleanStr(pick(r, 'Matricule'));
    const leaveType = cleanStr(pick(r, 'Type'));
    const startDate = toISODate(pick(r, 'Date de début', 'Date de debut'));
    if (!mat || !leaveType || !startDate) continue;
    const validator = [cleanStr(pick(r, 'Prénom du validateur', 'Prenom du validateur')), cleanStr(pick(r, 'Nom du validateur'))]
      .filter(Boolean).join(' ') || null;
    (byMat[mat] = byMat[mat] || []).push({
      leave_type: leaveType,
      type_category: categorizeLeaveType(leaveType),
      request_date: toISODate(pick(r, 'Date de la demande')),
      start_date: startDate,
      end_date: toISODate(pick(r, 'Date de fin')),
      half_day_start: toBool(pick(r, 'Demi-journée début', 'Demi-journee debut')),
      half_day_end: toBool(pick(r, 'Demi-journée fin', 'Demi-journee fin')),
      duration_days: toNum(pick(r, 'Durée', 'Duree')),
      duration_working_days: toNum(pick(r, 'Durée (jour ouvré)', 'Duree (jour ouvre)')),
      statut: cleanStr(pick(r, 'Statut')),
      validator_name: validator,
      validated_at: toISODate(pick(r, 'Date de validation')),
    });
  }
  return byMat;
}

/**
 * Parse un buffer .xlsx (export complet Malibou) → toutes les données
 * exploitables du classeur :
 *   { collaborators, contractsByMatricule, weekHoursByMatricule, leavesByMatricule }
 *  - collaborators : fusion « Informations salariés » + dernier avenant « Contrats » ;
 *  - contractsByMatricule : HISTORIQUE COMPLET des contrats/avenants chaînés
 *    (buildContractChain — périodes effectives reconstituées) ;
 *  - weekHoursByMatricule : feuille « Heures travaillées » (hebdo ISO, dédoublonnée) ;
 *  - leavesByMatricule : feuille « Congés & Télétravail ».
 * NB : la feuille « Jours travaillés » de l'export est vide (en-tête seule) —
 * elle sera lue le jour où Malibou l'alimentera (forfait jours).
 */
async function parseWorkbookFull(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const infoSheet = findSheet(wb, 'Informations salariés', 'Informations salaries', 'Salariés', 'Salaries');
  const contractSheet = findSheet(wb, 'Contrats', 'Contrat');
  const hoursSheet = findSheet(wb, 'Heures travaillées', 'Heures travaillees');
  const leavesSheet = findSheet(wb, 'Congés & Télétravail', 'Conges & Teletravail', 'Congés', 'Conges');

  if (!infoSheet) {
    throw new Error("Feuille « Informations salariés » introuvable dans le classeur.");
  }

  // Historique complet des contrats par matricule (chaîné par date d'avenant).
  const contractRowsByMat = {};
  if (contractSheet) {
    for (const c of sheetToObjects(contractSheet)) {
      const row = normalizeContractRow(c);
      if (!row.matricule) continue;
      (contractRowsByMat[row.matricule] = contractRowsByMat[row.matricule] || []).push(row);
    }
  }
  const contractsByMatricule = {};
  for (const [mat, rows] of Object.entries(contractRowsByMat)) {
    contractsByMatricule[mat] = buildContractChain(rows);
  }

  // Index « dernier contrat » par matricule (lignes brutes) pour la fiche
  // collaborateur — comportement historique conservé (max date d'avenant).
  const contractByMatricule = {};
  if (contractSheet) {
    for (const c of sheetToObjects(contractSheet)) {
      const mat = cleanStr(pick(c, 'Matricule'));
      if (!mat) continue;
      const dateRef = toISODate(pick(c, "Date d'avenant", 'Date de début', 'Date de debut')) || '0000-00-00';
      const prev = contractByMatricule[mat];
      if (!prev || dateRef >= prev.__dateRef) {
        contractByMatricule[mat] = { __dateRef: dateRef, raw: c };
      }
    }
  }

  const weekHoursByMatricule = hoursSheet ? parseWeekHoursSheet(hoursSheet) : {};
  const leavesByMatricule = leavesSheet ? parseLeavesSheet(leavesSheet) : {};

  const collaborators = [];
  for (const r of sheetToObjects(infoSheet)) {
    const matricule = cleanStr(pick(r, 'Matricule'));
    const firstName = cleanStr(pick(r, 'Prénom', 'Prenom'));
    const lastName = cleanStr(pick(r, 'Nom'));
    if (!firstName || !lastName) continue; // ligne inexploitable

    const contract = contractByMatricule[matricule]?.raw || {};
    const civility = cleanStr(pick(r, 'Civilité', 'Civilite'));
    const position = cleanStr(pick(contract, 'Intitulé de poste', 'Intitule de poste', 'Poste'))
      || cleanStr(pick(r, 'Poste'));

    collaborators.push({
      malibou_id: matricule,
      first_name: firstName,
      last_name: lastName,
      birth_name: cleanStr(pick(r, 'Nom de naissance')),
      // Coordonnées
      email: cleanStr(pick(r, 'Email', 'Adresse mail professionnelle')),
      personal_email: cleanStr(pick(r, 'Email secondaire', 'Adresse mail personnelle', 'Mail personnel')),
      phone: cleanStr(pick(r, 'Téléphone', 'Telephone')),
      address: cleanStr(pick(r, 'Adresse')),
      city: cleanStr(pick(r, 'Ville')),
      postal_code: cleanStr(pick(r, 'Code postal')),
      country: cleanStr(pick(r, 'Pays')),
      // Identité / naissance
      civility,
      gender: normalizeGender(civility, pick(r, 'Sexe', 'Genre')),
      birth_date: toISODate(pick(r, 'Date de naissance')),
      birth_city: cleanStr(pick(r, 'Ville de naissance')),
      birth_country: cleanStr(pick(r, 'Pays de naissance')),
      birth_department: cleanStr(pick(r, 'Dép. de naissance', 'Dep. de naissance', 'Departement de naissance')),
      nationality: cleanStr(pick(r, 'Nationalité', 'Nationalite')),
      // Conformité IAE / RH
      disability_status: cleanStr(pick(r, 'Statut handicap')),
      residence_permit_type: cleanStr(pick(r, 'Titre de séjour', 'Titre de sejour')),
      residence_permit_number: cleanStr(pick(r, 'N° de titre de séjour', 'N° de titre de sejour')),
      residence_permit_renewal: cleanStr(pick(r, 'Renouvellement titre de séjour', 'Renouvellement titre de sejour')),
      // Item 43 : deux dates distinctes si l'export les fournit —
      //  • « Dernière visite médicale » = visite périodique la plus récente
      //  • « Visite médicale d'embauche / d'information et de prévention » =
      //    visite post-embauche (celle qui alimente visite_medicale_date).
      last_medical_visit: toISODate(pick(r, 'Dernière visite médicale', 'Derniere visite medicale')),
      medical_visit_hire_date: toISODate(pick(r,
        "Visite médicale d'embauche", "Visite medicale d'embauche",
        "Visite d'information et de prévention", "Visite d'information et de prevention",
        'Visite post-embauche', 'Visite post embauche', "Visite d'embauche")),
      medical_visit_frequency: cleanStr(pick(r, 'Fréquence visite médicale', 'Frequence visite medicale')),
      seniority_date: toISODate(pick(r, 'Ancienneté', 'Anciennete')),
      manager_malibou_id: cleanStr(pick(r, 'Matricule du responsable')),
      manager_name: [cleanStr(pick(r, 'Prénom du responsable', 'Prenom du responsable')), cleanStr(pick(r, 'Nom du responsable'))]
        .filter(Boolean).join(' ') || null,
      // Lot 3 — contacts d'urgence (obligation de sécurité employeur)
      emergency_contact_name: [cleanStr(pick(r, "Prénom contact d'urgence 1", "Prenom contact d'urgence 1")), cleanStr(pick(r, "Nom contact d'urgence 1"))]
        .filter(Boolean).join(' ') || null,
      emergency_contact_phone: cleanStr(pick(r, "Téléphone contact d'urgence 1", "Telephone contact d'urgence 1")),
      emergency_contact_email: cleanStr(pick(r, "Email contact d'urgence 1")),
      emergency_contact2_name: [cleanStr(pick(r, "Prénom contact d'urgence 2", "Prenom contact d'urgence 2")), cleanStr(pick(r, "Nom contact d'urgence 2"))]
        .filter(Boolean).join(' ') || null,
      emergency_contact2_phone: cleanStr(pick(r, "Téléphone contact d'urgence 2", "Telephone contact d'urgence 2")),
      emergency_contact2_email: cleanStr(pick(r, "Email contact d'urgence 2")),
      is_active: toBool(pick(r, 'Contrat actif')),
      equipe_label: cleanStr(pick(r, 'Équipe', 'Equipe')),
      // Contrat (dernier connu)
      position,
      contract_type: normalizeContractType(pick(contract, 'Type de contrat')),
      qualification: cleanStr(pick(contract, 'Qualification')),
      contract_start: toISODate(pick(contract, 'Date de début', 'Date de debut')),
      contract_end: toISODate(pick(contract, 'Date de fin')),
      weekly_hours: (() => {
        const h = cleanStr(pick(contract, "Nombre d'heures par semaine"));
        const n = h ? parseFloat(String(h).replace(',', '.')) : NaN;
        return isNaN(n) ? null : n;
      })(),
      work_time_type: cleanStr(pick(contract, 'Temps plein / Temps partiel')),
      gross_salary: cleanStr(pick(contract, 'Salaire brut')),
      siret: cleanStr(pick(contract, 'SIRET')),
      establishment: cleanStr(pick(contract, 'Établissement', 'Etablissement')),
    });
  }

  return { collaborators, contractsByMatricule, weekHoursByMatricule, leavesByMatricule };
}

/** Rétro-compatibilité : renvoie la seule liste de collaborateurs (voie historique). */
async function parseWorkbookBuffer(buffer) {
  const { collaborators } = await parseWorkbookFull(buffer);
  return collaborators;
}

// ── Upsert idempotent en base ──────────────────────────────────────────────

/**
 * Garde de dérogation CDDI à l'import (EXG-03 / RES-08, PR 2) — NON bloquante.
 *
 * La voie d'import paie ne doit JAMAIS échouer sur un dépassement du plafond
 * légal de 24 mois (bloquer casserait la chaîne RH — réserve auditeur RES-08) :
 * on signale un AVERTISSEMENT « dérogation à régulariser » dans le canal de
 * retour de l'import quand le cumul CDDI dépasse 24 mois SANS motif de
 * dérogation saisi (employees.cddi_derogation_motif — L.5132-15-1 : formation
 * en cours, 50 ans et plus, RQTH, CDI inclusion). La saisie MANUELLE d'un
 * contrat (POST /employees/:id/contracts) reste, elle, bloquante (409).
 *
 * Savepoint dédié : une base ancienne sans la colonne cddi_derogation_motif ne
 * doit ni casser l'import ni avorter la transaction.
 */
async function checkCddiDerogationWarning(db, employeeId, label, warnings) {
  await db.query('SAVEPOINT cddi_warn_sp');
  try {
    const r = await db.query(
      `SELECT e.cddi_derogation_motif,
              (SELECT json_agg(json_build_object(
                 'contract_type', ec.contract_type,
                 'start_date', ec.start_date,
                 'end_date', ec.end_date))
               FROM employee_contracts ec WHERE ec.employee_id = e.id) AS contrats
       FROM employees e WHERE e.id = $1`,
      [employeeId]
    );
    await db.query('RELEASE SAVEPOINT cddi_warn_sp');
    const row = r.rows[0];
    if (!row) return;
    const cumul = computeCddiCumulativeMonths(row.contrats || []);
    if (cumul.months_total > 24 && !row.cddi_derogation_motif) {
      warnings.push({
        collaborator: label,
        employee_id: employeeId,
        code: 'cddi_derogation_requise',
        months_total: cumul.months_total,
        warning: `Cumul CDDI ${cumul.months_total} mois > plafond légal de 24 mois (L.5132-15-1) sans motif de dérogation — import NON bloqué : régulariser sur la fiche (motif + date de décision).`,
      });
    }
  } catch (e) {
    try { await db.query('ROLLBACK TO SAVEPOINT cddi_warn_sp'); } catch (_) { /* tx close */ }
    console.warn('[IMPORT] garde dérogation CDDI ignorée :', e.message);
  }
}

/**
 * Applique une liste de collaborateurs normalisés.
 * @param {import('pg').PoolClient|import('pg').Pool} db  client OU pool
 * @param {Array<object>} collaborators
 * @param {{ userId?: number, contracts?: object, weekHours?: object, leaves?: object }} opts
 *   contracts/weekHours/leaves : données Lot 3 par matricule (parseWorkbookFull) —
 *   absentes sur la voie CSV historique, l'import garde alors son comportement
 *   « contrat courant » d'origine.
 * @returns {{ created: [], updated: [], errors: [], warnings: [], historique: object }}
 *   warnings = signalements non bloquants (ex. dérogation CDDI à régulariser)
 *   historique = compteurs Lot 3 { contracts, week_hours, leaves } (created/updated)
 */
async function upsertCollaborators(db, collaborators, { userId = null, contracts = null, weekHours = null, leaves = null } = {}) {
  const created = [];
  const updated = [];
  const errors = [];
  const warnings = [];
  const historique = {
    contracts: { created: 0, updated: 0 },
    week_hours: { created: 0, updated: 0 },
    leaves: { created: 0, updated: 0 },
  };

  // Cache des équipes (type → id)
  const teamRows = await db.query('SELECT id, type FROM teams');
  const teamIdByType = {};
  for (const t of teamRows.rows) teamIdByType[t.type] = t.id;

  for (const c of collaborators) {
    if (!c.first_name || !c.last_name) {
      errors.push({ collaborator: `${c.first_name || '?'} ${c.last_name || '?'}`, error: 'Prénom/Nom manquant' });
      continue;
    }

    // SAVEPOINT par collaborateur : isole les échecs (ex. valeur trop longue)
    // pour qu'UNE ligne fautive n'avorte pas toute la transaction — sinon tous
    // les collaborateurs suivants échouent en cascade (« current transaction is
    // aborted, commands ignored until end of transaction block »).
    await db.query('SAVEPOINT collab_sp');
    try {
      const teamType = resolveTeamType(c.position, c.equipe_label);
      const teamId = teamType ? teamIdByType[teamType] || null : null;
      const contractType = c.contract_type || 'CDD';
      const isActive = c.is_active == null ? true : c.is_active;

      // 1. Appariement : malibou_id d'abord, puis nom+prénom (casse-insensible).
      let existing = null;
      if (c.malibou_id) {
        const r = await db.query('SELECT id, is_active FROM employees WHERE malibou_id = $1 LIMIT 1', [c.malibou_id]);
        existing = r.rows[0] || null;
      }
      if (!existing) {
        // Préférer une fiche active, puis la plus récente, pour ne pas
        // ressusciter un ancien fantôme quand un homonyme actif existe.
        const r = await db.query(
          `SELECT id, is_active FROM employees
           WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2)
           ORDER BY is_active DESC, id DESC LIMIT 1`,
          [c.first_name, c.last_name]
        );
        existing = r.rows[0] || null;
      }

      if (existing) {
        // ── UPDATE non destructif (COALESCE : ne pas écraser avec du vide) ──
        await db.query(
          `UPDATE employees SET
             malibou_id = COALESCE($2, malibou_id),
             birth_name = COALESCE($3, birth_name),
             email = COALESCE($4, email),
             personal_email = COALESCE($5, personal_email),
             phone = COALESCE($6, phone),
             address = COALESCE($7, address),
             city = COALESCE($8, city),
             postal_code = COALESCE($9, postal_code),
             country = COALESCE($10, country),
             civility = COALESCE($11, civility),
             gender = COALESCE($12, gender),
             birth_date = COALESCE($13, birth_date),
             birth_city = COALESCE($14, birth_city),
             birth_country = COALESCE($15, birth_country),
             birth_department = COALESCE($16, birth_department),
             nationality = COALESCE($17, nationality),
             disability_status = COALESCE($18, disability_status),
             residence_permit_type = COALESCE($19, residence_permit_type),
             residence_permit_number = COALESCE($20, residence_permit_number),
             residence_permit_renewal = COALESCE($21, residence_permit_renewal),
             visite_medicale_date = COALESCE($22, visite_medicale_date),
             medical_visit_frequency = COALESCE($23, medical_visit_frequency),
             seniority_date = COALESCE($24, seniority_date),
             manager_malibou_id = COALESCE($25, manager_malibou_id),
             manager_name = COALESCE($26, manager_name),
             position = COALESCE($27, position),
             qualification = COALESCE($28, qualification),
             contract_type = COALESCE($29, contract_type),
             contract_start = COALESCE($30, contract_start),
             contract_end = COALESCE($31, contract_end),
             weekly_hours = COALESCE($32, weekly_hours),
             work_time_type = COALESCE($33, work_time_type),
             gross_salary = COALESCE($34, gross_salary),
             siret = COALESCE($35, siret),
             establishment = COALESCE($36, establishment),
             team_id = COALESCE($37, team_id),
             is_active = $38,
             emergency_contact_name = COALESCE($39, emergency_contact_name),
             emergency_contact_phone = COALESCE($40, emergency_contact_phone),
             emergency_contact_email = COALESCE($41, emergency_contact_email),
             emergency_contact2_name = COALESCE($42, emergency_contact2_name),
             emergency_contact2_phone = COALESCE($43, emergency_contact2_phone),
             emergency_contact2_email = COALESCE($44, emergency_contact2_email),
             updated_at = NOW()
           WHERE id = $1`,
          [
            existing.id, c.malibou_id, c.birth_name, c.email, c.personal_email, c.phone,
            c.address, c.city, c.postal_code, c.country, c.civility, c.gender,
            c.birth_date, c.birth_city, c.birth_country, c.birth_department, c.nationality,
            c.disability_status, c.residence_permit_type, c.residence_permit_number, c.residence_permit_renewal,
            c.medical_visit_hire_date, c.medical_visit_frequency, c.seniority_date,
            c.manager_malibou_id, c.manager_name,
            c.position, c.qualification, contractType, c.contract_start, c.contract_end,
            c.weekly_hours, c.work_time_type, c.gross_salary, c.siret, c.establishment,
            teamId, isActive,
            c.emergency_contact_name, c.emergency_contact_phone, c.emergency_contact_email,
            c.emergency_contact2_name, c.emergency_contact2_phone, c.emergency_contact2_email,
          ]
        );
        const chain = contracts ? contracts[c.malibou_id] : null;
        await applyContractData(db, existing.id, { contractType, teamId, c }, chain, historique);
        if (weekHours && weekHours[c.malibou_id]) await upsertWeekHours(db, existing.id, weekHours[c.malibou_id], historique.week_hours);
        if (leaves && leaves[c.malibou_id]) await upsertLeaves(db, existing.id, leaves[c.malibou_id], historique.leaves);
        await applyMedicalVisit(db, existing.id, c);
        // Item 41 : si l'échéance de contrat a été prolongée, recaler les jalons
        // d'insertion non réalisés (no-op si parcours non initialisé/terminé).
        // Savepoint imbriqué : un échec de recalage ne doit PAS annuler l'import
        // du collaborateur (ni avorter la transaction pour les suivants).
        await db.query('SAVEPOINT resync_sp');
        try {
          await resyncMilestones(db, existing.id, { userId });
          await db.query('RELEASE SAVEPOINT resync_sp');
        } catch (e) {
          try { await db.query('ROLLBACK TO SAVEPOINT resync_sp'); } catch (_) { /* tx close */ }
          console.warn('[IMPORT] resyncMilestones ignoré :', e.message);
        }
        // EXG-03 / RES-08 : signaler (sans bloquer) un cumul CDDI > 24 mois
        // sans motif de dérogation saisi sur la fiche (Lot 3 : les CDDI sont
        // aussi détectés depuis l'historique de contrats — poste « … Cddi »).
        if (String(contractType).toUpperCase() === 'CDDI'
            || (chain || []).some((r) => String(r.contract_type || '').toUpperCase() === 'CDDI')) {
          await checkCddiDerogationWarning(db, existing.id, `${c.first_name} ${c.last_name}`, warnings);
        }
        updated.push({ id: existing.id, malibou_id: c.malibou_id, first_name: c.first_name, last_name: c.last_name, position: c.position, contract_type: contractType });
      } else {
        // ── INSERT nouveau collaborateur ──
        // Contrat d'insertion (poste « … Cddi ») → démarre le parcours pour
        // qu'il apparaisse directement dans le suivi CIP (les jalons sont posés
        // juste après l'INSERT — l'auto-init en lecture a été supprimée).
        // Uniquement à la création : on ne réactive jamais un parcours clôturé
        // au réimport.
        const isInsertion = /cddi/i.test(c.position || '');
        const insertionStatus = isInsertion ? 'en_parcours' : 'none';
        const insertionStart = isInsertion ? (c.contract_start || null) : null;
        const ins = await db.query(
          `INSERT INTO employees (
             first_name, last_name, malibou_id, birth_name, email, personal_email, phone,
             address, city, postal_code, country, civility, gender,
             birth_date, birth_city, birth_country, birth_department, nationality,
             disability_status, residence_permit_type, residence_permit_number, residence_permit_renewal,
             visite_medicale_date, medical_visit_frequency, seniority_date,
             manager_malibou_id, manager_name,
             position, qualification, contract_type, contract_start, contract_end,
             weekly_hours, work_time_type, gross_salary, siret, establishment,
             team_id, is_active, insertion_status, insertion_start_date,
             emergency_contact_name, emergency_contact_phone, emergency_contact_email,
             emergency_contact2_name, emergency_contact2_phone, emergency_contact2_email
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
             $42,$43,$44,$45,$46,$47
           ) RETURNING id`,
          [
            c.first_name, c.last_name, c.malibou_id, c.birth_name, c.email, c.personal_email, c.phone,
            c.address, c.city, c.postal_code, c.country, c.civility, c.gender,
            c.birth_date, c.birth_city, c.birth_country, c.birth_department, c.nationality,
            c.disability_status, c.residence_permit_type, c.residence_permit_number, c.residence_permit_renewal,
            c.medical_visit_hire_date, c.medical_visit_frequency, c.seniority_date,
            c.manager_malibou_id, c.manager_name,
            c.position, c.qualification, contractType, c.contract_start, c.contract_end,
            c.weekly_hours, c.work_time_type, c.gross_salary, c.siret, c.establishment,
            teamId, isActive, insertionStatus, insertionStart,
            c.emergency_contact_name, c.emergency_contact_phone, c.emergency_contact_email,
            c.emergency_contact2_name, c.emergency_contact2_phone, c.emergency_contact2_email,
          ]
        );
        const newId = ins.rows[0].id;
        const chain = contracts ? contracts[c.malibou_id] : null;
        await applyContractData(db, newId, { contractType, teamId, c }, chain, historique);
        if (weekHours && weekHours[c.malibou_id]) await upsertWeekHours(db, newId, weekHours[c.malibou_id], historique.week_hours);
        if (leaves && leaves[c.malibou_id]) await upsertLeaves(db, newId, leaves[c.malibou_id], historique.leaves);
        await applyMedicalVisit(db, newId, c);
        // Extension 2026-07 (PR1) : l'initialisation des jalons se fait au
        // DÉCLENCHEUR (import paie / liaison candidat), plus en lecture — les
        // nouveaux CDDI en parcours reçoivent leurs entretiens dès l'import.
        // Savepoint imbriqué : un échec de pose n'annule pas l'import.
        if (insertionStatus === 'en_parcours') {
          await db.query('SAVEPOINT genms_sp');
          try {
            await generateMilestones(db, newId, userId);
            await db.query('RELEASE SAVEPOINT genms_sp');
          } catch (e) {
            try { await db.query('ROLLBACK TO SAVEPOINT genms_sp'); } catch (_) { /* tx close */ }
            console.warn('[IMPORT] generateMilestones ignoré :', e.message);
          }
        }
        // EXG-03 / RES-08 : même signalement sur une fiche créée (cas d'un
        // historique de contrats CDDI repris par l'export paie).
        if (String(contractType).toUpperCase() === 'CDDI'
            || (chain || []).some((r) => String(r.contract_type || '').toUpperCase() === 'CDDI')) {
          await checkCddiDerogationWarning(db, newId, `${c.first_name} ${c.last_name}`, warnings);
        }
        created.push({ id: newId, malibou_id: c.malibou_id, first_name: c.first_name, last_name: c.last_name, position: c.position, contract_type: contractType });
      }
      await db.query('RELEASE SAVEPOINT collab_sp');
    } catch (err) {
      // Rollback ciblé : la transaction reste utilisable pour les suivants.
      try { await db.query('ROLLBACK TO SAVEPOINT collab_sp'); } catch (_) { /* transaction déjà close */ }
      errors.push({ collaborator: `${c.first_name} ${c.last_name}`, error: err.message });
    }
  }

  // 2e passe : résoudre le lien hiérarchique (manager_id) via le matricule.
  try {
    await db.query(`
      UPDATE employees e
      SET manager_id = m.id
      FROM employees m
      WHERE e.manager_malibou_id IS NOT NULL
        AND m.malibou_id = e.manager_malibou_id
        AND e.id <> m.id
        AND (e.manager_id IS DISTINCT FROM m.id)
    `);
  } catch (err) { /* colonne éventuellement absente sur ancienne base — non bloquant */ }

  return { created, updated, errors, warnings, historique };
}

// ── Lot 3 — application des données de contrat (historique ou voie legacy) ──

/**
 * Applique les données de contrat d'un collaborateur :
 *  - historique complet disponible (voie .xlsx, feuille « Contrats ») →
 *    upsertContractHistory (toutes les lignes d'avenant, périodes chaînées) +
 *    déduction des indisponibilités hebdo depuis le planning contractuel courant ;
 *  - sinon (voie CSV historique, sans feuille Contrats) → comportement d'origine
 *    « un contrat courant » (upsertCurrentContract).
 */
async function applyContractData(db, employeeId, { contractType, teamId, c }, chain, historique) {
  if (chain && chain.length > 0) {
    await upsertContractHistory(db, employeeId, chain, teamId, historique.contracts);
    const current = chain[chain.length - 1];
    if (current.weekly_schedule) await applyScheduleAvailability(db, employeeId, current.weekly_schedule);
  } else {
    await upsertCurrentContract(db, employeeId, { contractType, teamId, c });
  }
}

/**
 * Upsert IDEMPOTENT de l'historique des contrats/avenants d'un salarié.
 * Clé d'appariement : (malibou_contract_id, avenant_date) — index unique partiel.
 * Adoption : une ligne héritée de l'ancien mécanisme « contrat courant » (sans
 * identifiant Malibou, même date de début) est REQUALIFIÉE plutôt que doublée.
 * start_date/end_date reçoivent la PÉRIODE EFFECTIVE chaînée et sont ÉCRASÉES
 * au réimport (un nouvel avenant recale la fin effective de la ligne précédente).
 * Termine en recalculant is_current : EXACTEMENT UNE ligne par salarié (les
 * JOIN `is_current = true` de l'application en dépendent) = dernier avenant
 * dont la date d'effet est <= aujourd'hui.
 */
async function upsertContractHistory(db, employeeId, chain, teamId, counters) {
  const adopted = new Set();
  for (const row of chain) {
    if (!row.effective_start) continue; // ligne inexploitable (aucune date)
    const ecType = safeContractType(row.contract_type);
    const weekly = resolveWeeklyHours(row.weekly_hours);

    let existingId = null;
    if (row.contract_uid && row.avenant_date) {
      const r = await db.query(
        'SELECT id FROM employee_contracts WHERE malibou_contract_id = $1 AND avenant_date = $2 LIMIT 1',
        [row.contract_uid, row.avenant_date]
      );
      existingId = r.rows[0] ? r.rows[0].id : null;
    }
    if (!existingId) {
      const r = await db.query(
        `SELECT id FROM employee_contracts
         WHERE employee_id = $1 AND malibou_contract_id IS NULL AND start_date = $2
         ORDER BY is_current DESC, id DESC LIMIT 1`,
        [employeeId, row.official_start || row.effective_start]
      );
      if (r.rows[0] && !adopted.has(r.rows[0].id)) {
        existingId = r.rows[0].id;
        adopted.add(existingId);
      }
    }

    const params = [
      employeeId, ecType, row.effective_start, row.effective_end, row.origin, weekly, teamId,
      row.contract_uid, row.avenant_date, row.official_start, row.official_end,
      row.trial_period_end, row.motif_cdd, row.statut_cadre, row.qualification,
      row.position, row.gross_salary, row.work_time_type, row.work_time_category,
      row.days_per_week, row.hours_per_year, row.days_per_year,
      row.weekly_schedule ? JSON.stringify(row.weekly_schedule) : null,
      row.dpae_reference, row.dpae_date, row.siret, row.establishment,
    ];

    if (existingId) {
      await db.query(
        `UPDATE employee_contracts SET
           employee_id = $1, contract_type = $2, start_date = $3, end_date = $4, origin = $5,
           weekly_hours = $6, team_id = COALESCE($7, team_id),
           malibou_contract_id = $8, avenant_date = $9,
           official_start_date = $10, official_end_date = $11,
           trial_period_end = $12, motif_cdd = $13, statut_cadre = $14, qualification = $15,
           position_title = $16, gross_salary = $17, work_time_type = $18, work_time_category = $19,
           days_per_week = $20, hours_per_year = $21, days_per_year = $22,
           weekly_schedule = $23, dpae_reference = $24, dpae_date = $25,
           siret = $26, establishment = $27, source = 'malibou', updated_at = NOW()
         WHERE id = $28`,
        [...params, existingId]
      );
      counters.updated++;
    } else {
      await db.query(
        `INSERT INTO employee_contracts (
           employee_id, contract_type, start_date, end_date, origin, weekly_hours, team_id,
           malibou_contract_id, avenant_date, official_start_date, official_end_date,
           trial_period_end, motif_cdd, statut_cadre, qualification,
           position_title, gross_salary, work_time_type, work_time_category,
           days_per_week, hours_per_year, days_per_year, weekly_schedule,
           dpae_reference, dpae_date, siret, establishment, source, is_current
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27,'malibou',false
         )`,
        params
      );
      counters.created++;
    }
  }

  // « Contrat courant » = dernier avenant à date d'effet <= aujourd'hui ;
  // si tout est futur, la 1re ligne. Toujours EXACTEMENT une ligne is_current.
  await db.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (
         ORDER BY (start_date <= CURRENT_DATE) DESC,
                  CASE WHEN start_date <= CURRENT_DATE THEN start_date END DESC NULLS LAST,
                  CASE WHEN start_date > CURRENT_DATE THEN start_date END ASC NULLS LAST,
                  id DESC
       ) AS rn
       FROM employee_contracts WHERE employee_id = $1
     )
     UPDATE employee_contracts ec SET is_current = (r.rn = 1)
     FROM ranked r WHERE ec.id = r.id`,
    [employeeId]
  );
}

/**
 * Indisponibilités hebdomadaires déduites du planning contractuel courant
 * (RÈGLE MÉTIER : jour absent du planning = jour non travaillé → day_off).
 * FILL-IF-EMPTY strict : ne s'applique QUE si le salarié n'a AUCUNE
 * indisponibilité déjà saisie (on n'écrase jamais une saisie RH manuelle).
 */
async function applyScheduleAvailability(db, employeeId, weeklySchedule) {
  const existing = await db.query('SELECT 1 FROM employee_availability WHERE employee_id = $1 LIMIT 1', [employeeId]);
  if (existing.rows.length > 0) return;
  for (const day of DAYS_FR) {
    if (!weeklySchedule[day]) {
      await db.query(
        'INSERT INTO employee_availability (employee_id, day_off) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [employeeId, day]
      );
    }
  }
}

/** Upsert idempotent des semaines d'heures (clé employé + année + semaine ISO). */
async function upsertWeekHours(db, employeeId, weeks, counters) {
  for (const w of weeks) {
    const r = await db.query(
      `INSERT INTO employee_week_hours (
         employee_id, iso_year, iso_week, week_start, week_end, statut,
         hours_worked, hours_expected, hours_contract, hours_absence,
         hs_0, hs_25, hs_50, h_inf, hc_0, hc_10,
         hours_exc_sunday, hours_exc_holiday, hours_exc_night, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'malibou')
       ON CONFLICT (employee_id, iso_year, iso_week) DO UPDATE SET
         week_start = EXCLUDED.week_start, week_end = EXCLUDED.week_end, statut = EXCLUDED.statut,
         hours_worked = EXCLUDED.hours_worked, hours_expected = EXCLUDED.hours_expected,
         hours_contract = EXCLUDED.hours_contract, hours_absence = EXCLUDED.hours_absence,
         hs_0 = EXCLUDED.hs_0, hs_25 = EXCLUDED.hs_25, hs_50 = EXCLUDED.hs_50,
         h_inf = EXCLUDED.h_inf, hc_0 = EXCLUDED.hc_0, hc_10 = EXCLUDED.hc_10,
         hours_exc_sunday = EXCLUDED.hours_exc_sunday, hours_exc_holiday = EXCLUDED.hours_exc_holiday,
         hours_exc_night = EXCLUDED.hours_exc_night, source = EXCLUDED.source, updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        employeeId, w.iso_year, w.iso_week, w.week_start, w.week_end, w.statut,
        w.hours_worked, w.hours_expected, w.hours_contract, w.hours_absence,
        w.hs_0, w.hs_25, w.hs_50, w.h_inf, w.hc_0, w.hc_10,
        w.hours_exc_sunday, w.hours_exc_holiday, w.hours_exc_night,
      ]
    );
    if (r.rows[0] && r.rows[0].inserted) counters.created++;
    else counters.updated++;
  }
}

/** Upsert idempotent des absences/congés (clé employé + type + date de début). */
async function upsertLeaves(db, employeeId, leaveRows, counters) {
  for (const l of leaveRows) {
    const r = await db.query(
      `INSERT INTO employee_leaves (
         employee_id, leave_type, type_category, request_date, start_date, end_date,
         half_day_start, half_day_end, duration_days, duration_working_days,
         statut, validator_name, validated_at, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'malibou')
       ON CONFLICT (employee_id, leave_type, start_date) DO UPDATE SET
         type_category = EXCLUDED.type_category, request_date = EXCLUDED.request_date,
         end_date = EXCLUDED.end_date,
         half_day_start = EXCLUDED.half_day_start, half_day_end = EXCLUDED.half_day_end,
         duration_days = EXCLUDED.duration_days, duration_working_days = EXCLUDED.duration_working_days,
         statut = EXCLUDED.statut, validator_name = EXCLUDED.validator_name,
         validated_at = EXCLUDED.validated_at, source = EXCLUDED.source, updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        employeeId, l.leave_type, l.type_category, l.request_date, l.start_date, l.end_date,
        l.half_day_start, l.half_day_end, l.duration_days, l.duration_working_days,
        l.statut, l.validator_name, l.validated_at,
      ]
    );
    if (r.rows[0] && r.rows[0].inserted) counters.created++;
    else counters.updated++;
  }
}

/**
 * Maintient UN contrat courant par employé (pas de doublon au réimport) :
 * met à jour le contrat is_current existant, ou en crée un si aucun.
 */
// Valeurs admises par le CHECK de employee_contracts.contract_type. Un type
// hors liste (ex. « CDDI », libellé exotique) est ramené à 'CDD' pour la ligne
// de contrat — la colonne employees.contract_type, elle, conserve la valeur
// exacte de l'export.
// Item 41 : 'CDDI' est désormais admis par le CHECK de employee_contracts
// (migration init-db) → on cesse de le rabattre sur 'CDD' pour ne plus perdre
// l'objet métier central (le CDDI) dans la table de contrats normalisée.
const EC_CONTRACT_TYPES = ['CDI', 'CDD', 'CDDI', 'interim', 'stage', 'apprentissage'];
function safeContractType(t) {
  return EC_CONTRACT_TYPES.includes(t) ? t : 'CDD';
}

// v1-5 — Résout la quotité hebdomadaire à insérer dans employee_contracts.
// Auparavant l'import coerçait toute valeur ≠ 26/35 vers 35 (à cause du CHECK
// weekly_hours IN (26,35)), écrasant les temps réels 24/28/30. Le CHECK est
// désormais une plage 0 < h <= 48 : on CONSERVE la quotité réelle et on ne
// retombe sur le défaut (35) que si la valeur est absente ou hors plage
// (donnée inexploitable) — jamais pour un simple 24/28/30.
function resolveWeeklyHours(raw, fallback = 35) {
  const n = Number(raw);
  return (raw != null && Number.isFinite(n) && n > 0 && n <= 48) ? n : fallback;
}

/**
 * Item 43 — Renseigne les champs de visite médicale de façon NON destructive :
 *  - visite_medicale_date (post-embauche) : fill-if-empty depuis l'export ;
 *  - last_medical_visit_date (visite périodique la plus récente) : fill-if-empty ;
 *  - visite_medicale_due_date : recalculée à la CRÉATION selon la périodicité,
 *    mais on ne l'écrase jamais si une échéance a déjà été posée à la main
 *    (COALESCE(existant, calculé)).
 */
async function applyMedicalVisit(db, employeeId, c) {
  const due = computeMedicalDueDate({
    contractStart: c.contract_start,
    hireVisit: c.medical_visit_hire_date,
    lastVisit: c.last_medical_visit,
    frequency: c.medical_visit_frequency,
  });
  await db.query(
    `UPDATE employees SET
       visite_medicale_date = COALESCE($2, visite_medicale_date),
       last_medical_visit_date = COALESCE($3, last_medical_visit_date),
       visite_medicale_due_date = COALESCE(visite_medicale_due_date, $4)
     WHERE id = $1`,
    [employeeId, c.medical_visit_hire_date || null, c.last_medical_visit || null, due]
  );
}

async function upsertCurrentContract(db, employeeId, { contractType, teamId, c }) {
  const ecType = safeContractType(contractType);
  const startDate = c.contract_start || new Date().toISOString().split('T')[0];
  const existing = await db.query(
    'SELECT id FROM employee_contracts WHERE employee_id = $1 AND is_current = true LIMIT 1',
    [employeeId]
  );
  const weekly = resolveWeeklyHours(c.weekly_hours); // v1-5 : quotité réelle conservée
  if (existing.rows.length > 0) {
    await db.query(
      `UPDATE employee_contracts SET
         contract_type = $2, start_date = COALESCE($3, start_date), end_date = COALESCE($4, end_date),
         weekly_hours = $5, team_id = COALESCE($6, team_id)
       WHERE id = $1`,
      [existing.rows[0].id, ecType, c.contract_start, c.contract_end, weekly, teamId]
    );
  } else {
    await db.query(
      `INSERT INTO employee_contracts (employee_id, contract_type, start_date, end_date, weekly_hours, team_id, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [employeeId, ecType, startDate, c.contract_end, weekly, teamId]
    );
  }
}

module.exports = {
  parseWorkbookBuffer,
  parseWorkbookFull,
  upsertCollaborators,
  // exportés pour tests / réutilisation
  toISODate,
  toBool,
  normalizeGender,
  resolveTeamType,
  normalizeContractType,
  parseMedicalFrequencyMonths,
  computeMedicalDueDate,
  resolveWeeklyHours,
  POSITION_TO_TEAM,
  // Lot 3 (2026-08) — historique contrats / planning / heures / congés
  buildContractChain,
  normalizeContractRow,
  parseWeeklySchedule,
  pickBetterWeekRow,
  categorizeLeaveType,
  cleanTime,
  dayBeforeISO,
  toNum,
};
