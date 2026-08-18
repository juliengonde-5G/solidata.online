/**
 * Parseur des « États mensuels de présence » ASP (ACI — aide au poste).
 *
 * CONTEXTE MÉTIER
 * ───────────────
 * L'ASP renvoie chaque mois un état de présence PDF qui fait FOI pour le
 * conventionnement (module « Effectifs ETP », doctrine : le chiffre ASP prime
 * sur le calcul ERP). Ce service transforme le TEXTE de ce PDF en données
 * structurées, afin de rapprocher l'état ASP de la grille SOLIDATA et
 * d'expliquer les écarts salarié par salarié.
 *
 * DOCTRINE « JAMAIS DE VALEUR INVENTÉE »
 * ──────────────────────────────────────
 * Le parsing ne devine rien : un en-tête absent rend `null`, et la somme des
 * heures des salariés parsés DOIT égaler le total déclaré de l'état — sinon
 * l'import est REFUSÉ avec un message explicite (une ligne salarié manquée
 * fausserait silencieusement tout le rapprochement).
 *
 * FORMAT RÉEL (vérifié sur 7 états 2026 — janvier à juillet)
 * ──────────────────────────────────────────────────────────
 * En-tête (paires libellé : valeur, deux colonnes fusionnées à l'extraction) :
 *   « Mois d'effet : Janvier 2026 », « SIRET : … », « N° Annexe : … »,
 *   « Montant forfaitaire mensuel versé : 49357 »,
 *   « Nb total salariés déclarés : 38 »,
 *   « Nb total d'heure déclarées tous salariés confondus : 3942 »,
 *   « Nb total d'heures saisies éligibles à l'aide au poste : 3896 »,
 *   « Nb ETP réalisés : 25.99 », « Nb ETP conventionnés : 24.76 »,
 *   « Taux réalisation ETP : 104.97% », « Dont BRSA : 24 ».
 *
 * Détail par salarié — bloc de 2 à 3 lignes dont l'ORDRE dépend de l'extracteur
 * (pdf-parse ≠ pdftotext -layout) :
 *   NOM PRÉNOM (majuscules)
 *   « Période du contrat : 01/10/2025 - 31/01/2026 » + date de naissance +
 *   forme (CDDI « Classique » / CDII) + nb heures + salaire brut
 *   + optionnels : date de sortie définitive + code motif de sortie.
 *
 * Le parseur est donc volontairement AGNOSTIQUE à l'ordre des lignes : il
 * découpe le document en enregistrements ouverts par une ligne « NOM PRÉNOM »
 * en majuscules, ne retient dans chaque enregistrement que les lignes PORTEUSES
 * DE DONNÉES (whitelist : période, date, forme de contrat, nombres seuls) — ce
 * qui neutralise structurellement les en-têtes/pieds de page répétés à chaque
 * saut de page — puis lit les jetons dans leur ordre d'apparition.
 *
 * `parseAspText(text)` est PURE (aucune I/O) : elle est testée sur le texte
 * réel des 7 états sans dépendre du moteur PDF.
 */

/** Heures mensuelles d'un ETP à l'ASP : base annuelle 1 820 h / 12 mois. */
const HEURES_MENSUELLES_ETP = 1820 / 12;

/** Tolérance de contrôle de la formule ETP = heures déclarées / (1820/12). */
const TOLERANCE_ETP = 0.01;

const MOIS_FR = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

/** Erreur de parsing ASP — message destiné à l'utilisateur (renvoyé en 400). */
class AspParseError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'AspParseError';
    this.code = 'ASP_PARSE';
    this.details = details || null;
  }
}

// ── Normalisation ──────────────────────────────────────────────────────────

function stripAccents(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Texte PDF → lignes normalisées : fins de ligne unifiées, espaces insécables
 * et tabulations ramenés à l'espace simple, apostrophes typographiques
 * normalisées, espaces multiples compactés, lignes vides supprimées.
 */
function normalizeLines(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/[    ]/g, ' ')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

/** '12,34' | '12.34' → 12.34 ; null si non numérique. */
function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const n = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** 'JJ/MM/AAAA' → 'AAAA-MM-JJ' (null si date invalide — jamais de date inventée). */
function frDateToISO(raw) {
  const m = String(raw || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, jj, mm, aaaa] = m;
  const j = Number(jj); const mo = Number(mm); const a = Number(aaaa);
  if (mo < 1 || mo > 12 || j < 1 || j > 31 || a < 1900 || a > 2200) return null;
  const d = new Date(Date.UTC(a, mo - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;
  return `${aaaa}-${mm}-${jj}`;
}

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ── Lecture des en-têtes ───────────────────────────────────────────────────

const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/g;
const PERIODE_RE = /p[ée]riode du contrat\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i;

/**
 * Cherche la valeur numérique qui SUIT un libellé, sur le texte aplati
 * (désaccentué, minuscules) : l'extraction PDF fusionne les deux colonnes de
 * l'en-tête sur une même ligne et coupe parfois un libellé en deux — travailler
 * à plat rend la lecture indépendante de la mise en page.
 */
function readLabelledNumber(flatNorm, labelRe) {
  const m = flatNorm.match(labelRe);
  if (!m) return null;
  return toNumber(m[1]);
}

/**
 * Lit tous les en-têtes chiffrés de l'état. Un libellé absent rend `null`
 * (jamais 0 : l'absence d'information n'est pas une valeur nulle).
 */
function parseEntetes(flatNorm) {
  return {
    montant_forfaitaire: readLabelledNumber(flatNorm, /montant forfaitaire mensuel verse\s*:?\s*([\d.,]+)/),
    nb_salaries: readLabelledNumber(flatNorm, /nb total salaries declares\s*:?\s*([\d.,]+)/),
    heures_declarees: readLabelledNumber(flatNorm, /nb total d'?heures? declarees tous salaries confondus\s*:?\s*([\d.,]+)/),
    heures_eligibles: readLabelledNumber(flatNorm, /nb total d'?heures? saisies eligibles a l'?aide au poste\s*:?\s*([\d.,]+)/),
    etp_realises: readLabelledNumber(flatNorm, /nb etp realises\s*:?\s*([\d.,]+)/),
    etp_conventionnes: readLabelledNumber(flatNorm, /nb etp conventionnes\s*:?\s*([\d.,]+)/),
    taux: readLabelledNumber(flatNorm, /taux realisation etp\s*:?\s*([\d.,]+)\s*%?/),
    nb_brsa: readLabelledNumber(flatNorm, /dont brsa\s*:?\s*([\d.,]+)/),
  };
}

/** « Mois d'effet : Janvier 2026 » → { annee, mois, mois_libelle }. */
function parseMoisEffet(flatNorm, flat) {
  const m = flatNorm.match(/mois d'?effet\s*:?\s*([a-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mois = MOIS_FR[m[1]];
  if (!mois) return null;
  const libelle = (flat.match(/[Mm]ois d'?effet\s*:?\s*(\S+\s+\d{4})/) || [])[1] || null;
  return { annee: Number(m[2]), mois, mois_libelle: libelle };
}

// ── Découpage du détail par salarié ────────────────────────────────────────

/**
 * Une ligne « NOM PRÉNOM » : majuscules uniquement (accents admis), apostrophes
 * et traits d'union admis, AUCUN chiffre, au moins deux jetons. Les intitulés
 * en capitales de l'en-tête (raison sociale, « ATELIER ET CHANTIER
 * D'INSERTION ») passent aussi ce filtre : ils sont éliminés plus loin, car
 * l'enregistrement qu'ils ouvrent ne contient aucune « Période du contrat ».
 */
function isNameLine(line) {
  if (!/^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'\- .]*$/.test(line)) return false;
  const tokens = line.split(/\s+/).filter((t) => t.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length > 0);
  return tokens.length >= 2 && line.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length >= 4;
}

/**
 * Une ligne PORTEUSE DE DONNÉES dans un enregistrement salarié. Whitelist
 * volontaire (plutôt qu'une liste noire d'en-têtes, fragile et spécifique à
 * une structure) : seules les lignes contenant une période, une date, une
 * forme de contrat, ou uniquement des nombres, alimentent le parsing. Les
 * en-têtes/pieds répétés à chaque saut de page (« Identification : 2026-01 /
 * 11 2/4 », « SIRET : … », adresse, colonnes du tableau) sont ainsi ignorés
 * sans jamais nommer la structure.
 */
function isDataLine(line) {
  if (/p[ée]riode du contrat/i.test(line)) return true;
  if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(line)) return true;
  if (/\b(CDDI|CDII|Classique|CVG)\b/.test(line)) return true;
  return /^[\d.,\s]+$/.test(line);
}

/**
 * Enregistrement tenant sur UNE SEULE ligne : « NOM PRÉNOM 19/07/1964 CDII 152
 * 2000.00 ». C'est la forme des CDI Inclusion (CDII), dont l'ASP n'imprime pas
 * la mention « Classique » et qui tiennent donc sur une ligne. Sans ce cas, la
 * ligne est rejetée par isNameLine (elle contient des chiffres) ET par
 * isDataLine si aucun enregistrement n'est ouvert : le salarié était purement
 * et simplement perdu (constaté sur les états de février et mars 2026, un
 * CDII à 152 h manquant à chaque fois — la garde de cohérence de la somme des
 * heures a bien refusé l'import, ce qui a permis de le détecter).
 *
 * @returns {{ nom: string, data: string }|null}
 */
function splitInlineRecord(line) {
  // Nom = jetons EN CAPITALES uniquement, suivis d'une date de naissance puis
  // du reste des données. Les en-têtes en capitales (raison sociale, adresse)
  // ne comportent pas de date à cet endroit et ne matchent donc pas.
  const m = line.match(/^([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'\- .]*?)\s+(\d{2}\/\d{2}\/\d{4}\b.*)$/);
  if (!m) return null;
  const nom = m[1].trim();
  if (!isNameLine(nom)) return null;
  return { nom, data: m[2] };
}

/**
 * Découpe les lignes en enregistrements ouverts par une ligne « NOM PRÉNOM »
 * (forme courante, sur 2-3 lignes) ou par un enregistrement mono-ligne (CDII).
 * @returns {Array<{ nom: string, lignes: string[] }>}
 */
function splitRecords(lines) {
  const records = [];
  let current = null;
  for (const line of lines) {
    if (isNameLine(line)) {
      current = { nom: line, lignes: [] };
      records.push(current);
      continue;
    }
    const inline = splitInlineRecord(line);
    if (inline) {
      // La « Période du contrat » suit sur la ligne d'après : elle sera
      // rattachée à cet enregistrement par le test isDataLine ci-dessous.
      current = { nom: inline.nom, lignes: [inline.data] };
      records.push(current);
      continue;
    }
    if (current && isDataLine(line)) current.lignes.push(line);
  }
  return records;
}

/**
 * Parse un enregistrement salarié. Ordre des jetons garanti par le document,
 * quel que soit l'ordre des lignes :
 *   dates restantes (hors période) = [naissance, sortie?]
 *   nombres restants (hors dates)  = [heures, salaire brut, motif de sortie?]
 * @returns {Object|null} null si l'enregistrement n'est pas un salarié.
 */
function parseRecord(rec) {
  const blob = rec.lignes.join(' ');
  const per = blob.match(PERIODE_RE);
  if (!per) return null; // en-tête en capitales, pas un salarié

  const contratDebut = frDateToISO(per[1]);
  const contratFin = frDateToISO(per[2]);

  // Retire la période lue : les dates restantes sont naissance puis sortie.
  const reste = blob.replace(per[0], ' ');

  const dates = (reste.match(DATE_RE) || []).map((d) => d);
  const dateNaissance = dates.length > 0 ? frDateToISO(dates[0]) : null;
  const dateSortie = dates.length > 1 ? frDateToISO(dates[1]) : null;

  let forme = null;
  if (/\bCDII\b/.test(reste)) forme = 'CDII';
  else if (/\bCDDI\b/.test(reste)) forme = 'CDDI';

  // Nombres restants, dates retirées (sinon 01/10/2025 apporterait 3 jetons).
  const sansDates = reste.replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, ' ');
  const nombres = (sansDates.match(/\d+(?:[.,]\d+)?/g) || []).map(toNumber).filter((n) => n != null);

  return {
    nom_asp: rec.nom.replace(/\s+/g, ' ').trim(),
    date_naissance: dateNaissance,
    forme_contrat: forme,
    heures: nombres.length > 0 ? nombres[0] : null,
    salaire_brut: nombres.length > 1 ? nombres[1] : null,
    contrat_debut: contratDebut,
    contrat_fin: contratFin,
    date_sortie: dateSortie,
    // Code motif de sortie : présent uniquement avec une date de sortie
    // (l'ASP ne code jamais un motif sans sortie).
    motif_sortie: dateSortie && nombres.length > 2 ? String(nombres[2]).padStart(2, '0') : null,
  };
}

// ── API publique ───────────────────────────────────────────────────────────

/**
 * Parse le TEXTE d'un état mensuel de présence ASP (fonction PURE).
 *
 * @param {string} text  texte extrait du PDF (pdf-parse, pdftotext…)
 * @param {Object} [opts]
 * @param {boolean} [opts.tolerant=false]  n'échoue pas sur l'incohérence de la
 *   somme des heures (diagnostic / tests) — le drapeau `coherence` reste faux.
 * @returns {{
 *   annee:number, mois:number, mois_libelle:string|null,
 *   siret:string|null, num_annexe:string|null,
 *   entetes:Object, salaries:Array, coherence:Object, avertissements:string[]
 * }}
 * @throws {AspParseError} document non reconnu / incohérent.
 */
function parseAspText(text, opts = {}) {
  const tolerant = !!opts.tolerant;
  const lines = normalizeLines(text);
  if (lines.length === 0) throw new AspParseError('Le PDF ne contient aucun texte exploitable (document scanné ou vide ?).');

  const flat = lines.join(' ');
  const flatNorm = stripAccents(flat).toLowerCase();

  if (!/etat mensuel de presence/.test(flatNorm) && !/mois d'?effet/.test(flatNorm)) {
    throw new AspParseError("Ce document ne ressemble pas à un état mensuel de présence ASP (mention « Mois d'effet » introuvable).");
  }

  const periode = parseMoisEffet(flatNorm, flat);
  if (!periode) {
    throw new AspParseError("Mois d'effet illisible : impossible de déterminer le mois et l'année de l'état.");
  }

  const entetes = parseEntetes(flatNorm);
  const siret = (flat.match(/SIRET\s*:\s*(\d{9,14})/i) || [])[1] || null;
  const numAnnexe = (lines
    .map((l) => (l.match(/N[°ºo]?\s*Annexe\s*:\s*(.+)$/i) || [])[1])
    .find((v) => v) || null);

  // Le détail s'arrête avant la légende des codes motifs (qui contient des
  // lignes « 04 Embauche en CDI … » que le tokenizer prendrait pour des données).
  const finDetail = lines.findIndex((l) => /^liste des codes motifs de sortie/i.test(l));
  const lignesDetail = finDetail >= 0 ? lines.slice(0, finDetail) : lines;

  const salaries = [];
  const avertissements = [];
  for (const rec of splitRecords(lignesDetail)) {
    const s = parseRecord(rec);
    if (!s) continue;
    if (s.heures == null) {
      throw new AspParseError(
        `Ligne salarié illisible : « ${s.nom_asp} » — nombre d'heures travaillées introuvable.`,
        { nom_asp: s.nom_asp }
      );
    }
    if (!s.date_naissance) avertissements.push(`Date de naissance illisible pour « ${s.nom_asp} ».`);
    salaries.push(s);
  }

  if (salaries.length === 0) {
    throw new AspParseError('Aucune ligne salarié détectée dans cet état ASP.');
  }

  // ── Contrôles de cohérence ───────────────────────────────────────────────
  const sommeHeures = round2(salaries.reduce((a, s) => a + (s.heures || 0), 0));
  const heuresDeclarees = entetes.heures_declarees;
  const ecartHeures = heuresDeclarees != null ? round2(sommeHeures - heuresDeclarees) : null;
  const sommeHeuresOk = heuresDeclarees != null && Math.abs(ecartHeures) < 0.005;

  if (!sommeHeuresOk && !tolerant) {
    if (heuresDeclarees == null) {
      throw new AspParseError(
        "En-tête illisible : « Nb total d'heure déclarées tous salariés confondus » introuvable — "
        + 'le contrôle de cohérence de l\'état est impossible, import refusé.'
      );
    }
    throw new AspParseError(
      `Incohérence de l'état : la somme des heures des ${salaries.length} salariés lus (${sommeHeures} h) `
      + `ne correspond pas au total déclaré (${heuresDeclarees} h) — écart ${ecartHeures > 0 ? '+' : ''}${ecartHeures} h. `
      + 'Une ligne a probablement été mal lue : import refusé (aucune donnée écrite).',
      { somme_heures: sommeHeures, heures_declarees: heuresDeclarees, ecart: ecartHeures, nb_salaries_lus: salaries.length }
    );
  }

  // Formule ASP : ETP réalisés = heures déclarées / (1 820 / 12). Contrôle
  // NON bloquant (il porte sur les chiffres de l'ASP, pas sur notre lecture) :
  // une divergence est signalée, elle ne refuse pas l'import.
  let etpCalcule = null;
  let etpFormuleOk = false;
  if (heuresDeclarees != null && entetes.etp_realises != null) {
    etpCalcule = round2(heuresDeclarees / HEURES_MENSUELLES_ETP);
    etpFormuleOk = Math.abs(entetes.etp_realises - heuresDeclarees / HEURES_MENSUELLES_ETP) <= TOLERANCE_ETP + 1e-9;
    if (!etpFormuleOk) {
      avertissements.push(
        `ETP réalisés annoncés (${entetes.etp_realises}) ≠ heures déclarées / (1820/12) = ${etpCalcule}.`
      );
    }
  }

  if (entetes.nb_salaries != null && entetes.nb_salaries !== salaries.length) {
    avertissements.push(
      `Nombre de salariés déclaré (${entetes.nb_salaries}) ≠ lignes lues (${salaries.length}) — `
      + 'un salarié peut apparaître sur plusieurs lignes (avenant) dans cet état.'
    );
  }

  return {
    annee: periode.annee,
    mois: periode.mois,
    mois_libelle: periode.mois_libelle,
    siret,
    num_annexe: numAnnexe,
    entetes,
    salaries,
    coherence: {
      somme_heures_ok: sommeHeuresOk,
      etp_formule_ok: etpFormuleOk,
      somme_heures: sommeHeures,
      heures_declarees: heuresDeclarees,
      ecart_heures: ecartHeures,
      etp_calcule: etpCalcule,
      nb_salaries_lus: salaries.length,
    },
    avertissements,
  };
}

/**
 * Extrait le texte d'un PDF (pdf-parse v2 — même dépendance que le parsing de
 * CV). Isolé du parsing pour que `parseAspText` reste pure et testable.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractPdfText(buffer) {
  if (!buffer || !buffer.length) throw new AspParseError('Fichier vide.');
  let parser = null;
  try {
    const { PDFParse } = require('pdf-parse');
    parser = new PDFParse({ data: buffer });
    const res = await parser.getText();
    return String((res && res.text) || '');
  } catch (err) {
    if (err instanceof AspParseError) throw err;
    throw new AspParseError(`PDF illisible : ${err.message}`);
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      try { await parser.destroy(); } catch (_) { /* best effort */ }
    }
  }
}

/** Extrait puis parse un PDF d'état ASP. */
async function parseAspPdf(buffer, opts = {}) {
  return parseAspText(await extractPdfText(buffer), opts);
}

module.exports = {
  AspParseError,
  HEURES_MENSUELLES_ETP,
  MOIS_FR,
  parseAspText,
  parseAspPdf,
  extractPdfText,
  // Exports internes (tests unitaires ciblés / réutilisation)
  normalizeLines,
  stripAccents,
  frDateToISO,
  toNumber,
  isNameLine,
  isDataLine,
  splitRecords,
  splitInlineRecord,
  parseRecord,
};
