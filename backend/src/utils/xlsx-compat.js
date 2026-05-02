/**
 * Wrapper de compatibilité xlsx → exceljs.
 *
 * Imite le sous-ensemble de l'API xlsx utilisé par les scripts d'import/seed
 * de SOLIDATA, pour permettre la migration xlsx → exceljs sans réécrire
 * la logique des scripts. Élimine la dépendance xlsx (CVE Prototype Pollution
 * + ReDoS, GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9 sans fix amont).
 *
 * Pattern de migration :
 *   const XLSX = require('xlsx')                    →  const XLSX = require('../utils/xlsx-compat');
 *   const wb = XLSX.readFile(path)                  →  const wb = await XLSX.readFile(path);
 *   const ws = wb.Sheets[wb.SheetNames[0]]          →  inchangé
 *   const rows = XLSX.utils.sheet_to_json(ws, opts) →  inchangé
 *
 * Seul changement signature : readFile devient async (await).
 *
 * NOTE : ne fonctionne qu'en lecture (.xlsx). Pour écrire, utiliser exceljs
 * directement (ou cf code de exports.js qui le fait déjà).
 */

const ExcelJS = require('exceljs');

/**
 * Lit un fichier .xlsx et retourne un objet workbook au format compatible xlsx :
 *   { SheetNames: ['Feuil1', ...], Sheets: { Feuil1: <opaque>, ... } }
 *
 * Le contenu de chaque sheet est conservé en interne (pas exposé directement).
 */
async function readFile(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const SheetNames = [];
  const Sheets = {};

  wb.worksheets.forEach((ws) => {
    SheetNames.push(ws.name);
    // On stocke un wrapper qui contient la référence pour le sheet_to_json
    Sheets[ws.name] = { __exceljsSheet: ws };
  });

  return { SheetNames, Sheets };
}

const utils = {
  /**
   * Convertit une worksheet exceljs en tableau de lignes/objets, comme xlsx.
   * Options supportées :
   *   - header: 1   → retourne des arrays de valeurs (mode array of arrays)
   *   - header: undefined → retourne des objets {colA: val, colB: val} avec
   *     la première ligne comme clés
   *   - defval: any → valeur par défaut pour les cellules vides
   */
  sheet_to_json(sheet, options = {}) {
    const ws = sheet?.__exceljsSheet;
    if (!ws) return [];

    const { header, defval = undefined, range } = options;
    const result = [];
    let headerRow = null;

    // range : on ignore pour simplifier (les scripts n'en utilisent pas)
    if (range !== undefined) {
      // Pour compat ; non utilisé par les scripts SOLIDATA actuels.
    }

    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      // values est un Array indexé à partir de 1 (ExcelJS convention)
      // On normalise en index 0 et on retire le premier élément (vide).
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cleaned = values.map((v) => {
        if (v === null || v === undefined) return defval;
        // Cellules date : ExcelJS retourne Date, xlsx retourne string ou Date
        if (v instanceof Date) return v;
        // Hyperlinks et formules : on prend le résultat
        if (typeof v === 'object' && v !== null) {
          if ('result' in v) return v.result;
          if ('text' in v) return v.text;
          if ('hyperlink' in v) return v.text || v.hyperlink;
          if ('richText' in v) return v.richText.map((rt) => rt.text).join('');
        }
        return v;
      });
      rows.push(cleaned);
    });

    if (header === 1) {
      // Mode array of arrays
      return rows;
    }

    // Mode objects : 1ère ligne = headers
    if (rows.length === 0) return [];
    headerRow = rows[0].map((h) => (h == null ? '' : String(h).trim()));
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};
      headerRow.forEach((key, idx) => {
        if (key) obj[key] = row[idx] !== undefined ? row[idx] : defval;
      });
      result.push(obj);
    }
    return result;
  },

  /**
   * Conversion A1 → {r,c} et inverse — implémentation minimale au cas où
   * un script en aurait besoin. Pas utilisé actuellement par SOLIDATA.
   */
  encode_cell({ r, c }) {
    let col = '';
    let n = c;
    while (n >= 0) {
      col = String.fromCharCode((n % 26) + 65) + col;
      n = Math.floor(n / 26) - 1;
    }
    return col + (r + 1);
  },

  decode_cell(addr) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) return { r: 0, c: 0 };
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { r: parseInt(m[2]) - 1, c: c - 1 };
  },
};

module.exports = { readFile, utils };
