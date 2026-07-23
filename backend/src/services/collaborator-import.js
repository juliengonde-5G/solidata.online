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
const { resyncMilestones, generateMilestones } = require('../routes/insertion/engine');

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
  const c = stripAccents(civility || '').trim().toLowerCase().replace(/\./g, '');
  if (c === 'mme' || c === 'mlle' || c === 'madame' || c === 'mademoiselle') return 'F';
  if (c === 'm' || c === 'mr' || c === 'monsieur') return 'M';
  const g = stripAccents(genderRaw || '').trim().toUpperCase();
  if (['F', 'FEMME', 'FEMININ'].includes(g)) return 'F';
  if (['M', 'H', 'HOMME', 'MASCULIN'].includes(g)) return 'M';
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

/**
 * Parse un buffer .xlsx (export complet Malibou) → liste de collaborateurs
 * normalisés, en fusionnant « Informations salariés » (identité/coordonnées)
 * et « Contrats » (poste / type / dates / horaires — dernier contrat).
 */
async function parseWorkbookBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const infoSheet = findSheet(wb, 'Informations salariés', 'Informations salaries', 'Salariés', 'Salaries');
  const contractSheet = findSheet(wb, 'Contrats', 'Contrat');

  if (!infoSheet) {
    throw new Error("Feuille « Informations salariés » introuvable dans le classeur.");
  }

  // Index des contrats par matricule → on garde le plus récent
  // (max date d'avenant, sinon date de début).
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

  return collaborators;
}

// ── Upsert idempotent en base ──────────────────────────────────────────────

/**
 * Applique une liste de collaborateurs normalisés.
 * @param {import('pg').PoolClient|import('pg').Pool} db  client OU pool
 * @param {Array<object>} collaborators
 * @param {{ userId?: number }} opts
 * @returns {{ created: [], updated: [], errors: [] }}
 */
async function upsertCollaborators(db, collaborators, { userId = null } = {}) {
  const created = [];
  const updated = [];
  const errors = [];

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
          ]
        );
        await upsertCurrentContract(db, existing.id, { contractType, teamId, c });
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
             team_id, is_active, insertion_status, insertion_start_date
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41
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
          ]
        );
        const newId = ins.rows[0].id;
        await upsertCurrentContract(db, newId, { contractType, teamId, c });
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

  return { created, updated, errors };
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
};
