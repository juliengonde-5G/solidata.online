#!/usr/bin/env node
/**
 * IMPORT DU STOCK ACTUEL D'ÉTIQUETTES (chantier « Étiquettes v2 », 2.57.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTEXTE : le classeur « Dashboard 2026 — saisie » (feuille « SaisiesP (2) »)
 * porte l'historique réel des cartons étiquetés (~14 400 lignes), sous
 * l'ANCIENNE codification (P + poste + compteur base 24, ou P + poste +
 * horodatage AAMMJJhhmmss). Ce script verse cet historique dans
 * `produits_finis`, sans jamais réécrire une dimension déjà présente en base
 * ni effacer une sortie déjà connue — c'est un import de RATTRAPAGE, pas une
 * synchronisation qui ferait foi sur la base.
 *
 * CE QU'IL FAIT (transactionnel, --dry-run par défaut) :
 *   1. Ouvre la première feuille dont une ligne d'en-tête (dans les 20
 *      premières lignes) porte à la fois « ID » et « Produits » ; les colonnes
 *      sont retrouvées PAR NOM d'en-tête (jamais par lettre de colonne — le
 *      classeur porte des colonnes calculées avant/après le bloc utile).
 *   2. Pour chaque ligne : normalise le code (`normaliserScan`), l'analyse
 *      (`analyserCode`) — ligne ignorée si le code est vide, le format
 *      `inconnu`, le poids non numérique ou ≤ 0, ou si le code apparaît
 *      PLUSIEURS FOIS dans le fichier (dans ce dernier cas, TOUTES ses
 *      occurrences sont ignorées : rien ne dit laquelle serait la bonne).
 *   3. Absent en base → INSERT avec les valeurs TEXTE d'origine, SANS AUCUNE
 *      conversion (les correspondances anciennes→nouvelles valeurs de la
 *      2.57.0 sont pour les statistiques, jamais pour réécrire un carton) ;
 *      `codification` déduite du format (`ancien_base24`/`ancien_horodate` →
 *      'ancien', `balance` → 'balance', `v2` → 'v2') ; `status` = 'expedie' si
 *      une date de sortie est lisible, sinon 'en_stock' ; `source` =
 *      'import_excel' ; `created_by` NULL (aucun utilisateur n'a fait ce
 *      geste) ; AUCUN mouvement de stock n'est écrit (le stock historique vit
 *      hors grand livre, comme les imports précédents — cf import-excel.js).
 *   4. Présent en base → JAMAIS de modification des dimensions. Si la base n'a
 *      PAS de date de sortie et le fichier en a une → pose `date_sortie` +
 *      `status='expedie'`. Une sortie déjà en base n'est JAMAIS effacée. Les
 *      écarts de dimensions (produit/catégorie/genre/saison/gamme/poids)
 *      entre le fichier et la base sont comptés et listés (20 premiers) —
 *      SANS jamais être appliqués : c'est un signal pour un humain, pas une
 *      correction automatique.
 *   5. Idempotent : une seconde exécution après --apply ne produit plus aucune
 *      écriture (les écarts restent affichés, ils ne sont jamais des écritures).
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/import-stock-etiquettes.js --file=<chemin.xlsm|.xlsx>          # simulation
 *   node src/scripts/import-stock-etiquettes.js --file=<chemin.xlsm|.xlsx> --apply  # applique
 *
 * Le fichier réel du client N'EST JAMAIS versionné dans le dépôt (données
 * métier réelles) : --file pointe vers un chemin fourni à l'exécution.
 */

const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { normaliserScan, analyserCode } = require('../utils/codification-etiquettes');

// ── Colonnes attendues (par NOM d'en-tête, pas par position) ────────────────
const COLONNES_REQUISES = ['ID', 'Produits', 'Catégorie Eco-org.', 'Genre', 'Saison', 'Gamme', 'Poids', 'Date de fabrication'];
// « Date de sortie » et « Inventaire » sont lues si présentes, mais absentes
// elles ne bloquent rien : une feuille sans historique de sortie reste
// importable (tout entre en 'en_stock').
const COLONNES_OPTIONNELLES = ['Date de sortie', 'Inventaire'];

const FORMAT_VERS_CODIFICATION = {
  v2: 'v2',
  ancien_base24: 'ancien',
  ancien_horodate: 'ancien',
  balance: 'balance',
};

const CHAMPS_COMPARES = ['produit', 'categorie_eco_org', 'genre', 'saison', 'gamme', 'poids_kg'];

// ══════════════════════════════════════════
// Résolution de valeurs de cellule — PUR, prend `cell.value` directement
// (jamais l'objet cellule exceljs), donc testable avec des valeurs forgées.
// ══════════════════════════════════════════

/** Base Excel 1900 (avec le bug du 29/02/1900 qu'Excel perpétue) : jour 0 = 1899-12-30 UTC. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function serialExcelVersDate(n) {
  if (!Number.isFinite(n)) return null;
  const ms = EXCEL_EPOCH_MS + Math.round(n * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Déballe une valeur de cellule exceljs (formule, texte enrichi, hyperlien)
 * vers une valeur JS « nue » : string | number | boolean | Date | null.
 * Une formule SANS résultat mis en cache (référence rompue « #REF! » jamais
 * recalculée) ou dont le résultat est une erreur devient `null` — exactement
 * ce que le classeur affiche à l'écran dans ce cas.
 */
function resolverValeurCellule(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('formula' in value) {
      if (!('result' in value)) return null; // jamais recalculé (référence rompue)
      const res = value.result;
      if (res && typeof res === 'object' && 'error' in res) return null;
      return resolverValeurCellule(res);
    }
    if ('text' in value) return value.text; // hyperlien { text, hyperlink }
  }
  return null;
}

/**
 * Vrai si la cellule est une FORMULE dont le texte porte « #REF! » — une
 * référence rompue (table ou feuille supprimée). Constaté sur le classeur réel
 * du client : les 14 387 cellules « Date de sortie » et « Inventaire » sont
 * `VLOOKUP(ID, #REF!, 2, FALSE)` — la table des sorties n'est plus jointe au
 * classeur. Excel affiche alors « » (IFERROR), et l'import lit « pas de date »
 * donc « en stock » : une ABSENCE de date de sortie ne prouve plus rien. Ce
 * n'est pas à l'import de deviner — mais il doit le DIRE, en tête du
 * récapitulatif, plutôt que d'annoncer 13 740 cartons en stock comme un fait.
 */
function estFormuleRompue(value) {
  if (!value || typeof value !== 'object' || value instanceof Date) return false;
  const f = value.formula ?? value.sharedFormula;
  return typeof f === 'string' && f.includes('#REF!');
}

/** Résout spécifiquement une cellule censée porter une date : Date directe, texte ISO, ou numéro de série Excel. */
function resolverValeurDate(value) {
  const v = resolverValeurCellule(value);
  if (v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return serialExcelVersDate(v);
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ══════════════════════════════════════════
// Décision par ligne — PURE, opère sur des valeurs déjà résolues (pas sur
// exceljs). Testable sans base de données ET sans fichier.
// ══════════════════════════════════════════

/**
 * @param {object} brut { id, produit, categorie, genre, saison, gamme, poids, dateFabrication, dateSortie, dateInventaire }
 *   — valeurs déjà déballées par resolverValeurCellule/resolverValeurDate.
 * @returns {{ ok: true, record: object } | { ok: false, motif: string }}
 */
function analyserLigne(brut) {
  const code = normaliserScan(brut?.id);
  if (!code) return { ok: false, motif: 'code_vide' };

  const { format } = analyserCode(code);
  if (format === 'inconnu') return { ok: false, motif: 'format_inconnu' };

  const poids = Number(brut?.poids);
  if (!Number.isFinite(poids) || poids <= 0) return { ok: false, motif: 'poids_invalide' };

  const dateFabrication = brut?.dateFabrication instanceof Date && !Number.isNaN(brut.dateFabrication.getTime())
    ? brut.dateFabrication
    : null;
  // `date_fabrication` est NOT NULL en base : une ligne qui n'en porte aucune
  // n'est pas décrite par le contrat, mais ne peut structurellement pas
  // s'insérer — on l'écarte plutôt que d'inventer une date, en le nommant.
  if (!dateFabrication) return { ok: false, motif: 'date_fabrication_invalide' };

  const dateSortie = brut?.dateSortie instanceof Date && !Number.isNaN(brut.dateSortie.getTime())
    ? brut.dateSortie
    : null;
  const dateInventaire = brut?.dateInventaire instanceof Date && !Number.isNaN(brut.dateInventaire.getTime())
    ? brut.dateInventaire
    : null;

  const trim = (v) => (v === null || v === undefined ? null : String(v).trim() || null);

  return {
    ok: true,
    record: {
      code,
      format,
      codification: FORMAT_VERS_CODIFICATION[format] || 'ancien',
      produit: trim(brut?.produit),
      categorie_eco_org: trim(brut?.categorie),
      genre: trim(brut?.genre),
      saison: trim(brut?.saison),
      gamme: trim(brut?.gamme),
      poids_kg: poids,
      date_fabrication: dateFabrication,
      date_sortie: dateSortie,
      date_inventaire: dateInventaire,
      status: dateSortie ? 'expedie' : 'en_stock',
    },
  };
}

/**
 * Repère les codes qui apparaissent plusieurs fois dans le fichier. Un code
 * dupliqué ne dit pas laquelle de ses lignes est la bonne : TOUTES ses
 * occurrences sont écartées (motif 'doublon_fichier'), jamais seulement la
 * seconde — décision assumée, documentée dans le récapitulatif.
 * @param {Array<{code:string}>} records
 * @returns {{ uniques: Array, doublons: Set<string> }}
 */
function reperocherDoublons(records) {
  const occurrences = new Map();
  for (const r of records) occurrences.set(r.code, (occurrences.get(r.code) || 0) + 1);
  const doublons = new Set([...occurrences.entries()].filter(([, n]) => n > 1).map(([c]) => c));
  const uniques = records.filter((r) => !doublons.has(r.code));
  return { uniques, doublons };
}

/**
 * Décide de l'action à mener pour UN carton du fichier face à la ligne
 * existante en base (ou `null` si absente). PURE — ne touche à rien.
 * @param {object|null} existant Ligne `produits_finis` déjà en base (ou null).
 * @param {object} record Sortie de `analyserLigne(...).record`.
 * @returns {{ verdict: 'insert'|'update_sortie'|'none', ecarts: Array }}
 */
function decidercAction(existant, record) {
  if (!existant) return { verdict: 'insert', ecarts: [] };

  const ecarts = [];
  for (const champ of CHAMPS_COMPARES) {
    const valFichier = record[champ];
    const valBase = existant[champ];
    const normFichier = champ === 'poids_kg' ? Number(valFichier) : (valFichier ?? null);
    const normBase = champ === 'poids_kg' ? Number(valBase) : (valBase ?? null);
    const egal = champ === 'poids_kg'
      ? Math.abs((normFichier || 0) - (normBase || 0)) < 1e-9
      : String(normFichier ?? '') === String(normBase ?? '');
    if (!egal) ecarts.push({ code: record.code, champ, valeur_fichier: valFichier, valeur_base: valBase });
  }

  const baseADejaSortie = !!existant.date_sortie;
  const fichierADateSortie = !!record.date_sortie;

  if (!baseADejaSortie && fichierADateSortie) {
    return { verdict: 'update_sortie', ecarts };
  }
  return { verdict: 'none', ecarts };
}

// ══════════════════════════════════════════
// Lecture du classeur
// ══════════════════════════════════════════

function trouverEnTete(worksheet) {
  const maxScan = Math.min(worksheet.rowCount, 20);
  for (let r = 1; r <= maxScan; r++) {
    const row = worksheet.getRow(r);
    const valeurs = [];
    for (let c = 1; c <= worksheet.columnCount; c++) {
      valeurs.push(resolverValeurCellule(row.getCell(c).value));
    }
    if (valeurs.includes('ID') && valeurs.includes('Produits')) {
      const parColonne = {};
      valeurs.forEach((v, i) => { if (v) parColonne[v] = i + 1; });
      return { rowIndex: r, colonnes: parColonne };
    }
  }
  return null;
}

async function trouverFeuille(workbook) {
  for (const ws of workbook.worksheets) {
    const entete = trouverEnTete(ws);
    if (entete) return { worksheet: ws, ...entete };
  }
  return null;
}

/** Lit toutes les lignes de données de la feuille, déjà résolues (valeurs nues). */
function lireLignes(worksheet, colonnes, rowIndexEntete) {
  const lignes = [];
  for (let r = rowIndexEntete + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cell = (nom) => (colonnes[nom] ? row.getCell(colonnes[nom]).value : undefined);
    const id = resolverValeurCellule(cell('ID'));
    const produitBrut = resolverValeurCellule(cell('Produits'));
    // Une ligne entièrement vide (fin de plage exceljs au-delà des données
    // réelles) n'est ni lue ni comptée — elle ne correspond à aucune saisie.
    if (id === null && produitBrut === null) continue;
    // Ligne d'en-tête RÉPÉTÉE au milieu des données (constatée sur le fichier
    // réel de saisie manuelle) : comptée, mais jamais traitée comme un carton.
    if (id === 'ID' && produitBrut === 'Produits') {
      lignes.push({ rowNum: r, enteteRepetee: true });
      continue;
    }
    lignes.push({
      rowNum: r,
      enteteRepetee: false,
      id,
      produit: produitBrut,
      categorie: resolverValeurCellule(cell('Catégorie Eco-org.')),
      genre: resolverValeurCellule(cell('Genre')),
      saison: resolverValeurCellule(cell('Saison')),
      gamme: resolverValeurCellule(cell('Gamme')),
      poids: resolverValeurCellule(cell('Poids')),
      dateFabrication: resolverValeurDate(cell('Date de fabrication')),
      dateSortie: resolverValeurDate(cell('Date de sortie')),
      dateInventaire: resolverValeurDate(cell('Inventaire')),
      // Signal, pas décision : la valeur lue reste celle du classeur.
      sortieFormuleRompue: estFormuleRompue(cell('Date de sortie')),
      inventaireFormuleRompue: estFormuleRompue(cell('Inventaire')),
    });
  }
  return lignes;
}

// ══════════════════════════════════════════
// Programme principal
// ══════════════════════════════════════════

function parseArgs(argv) {
  const args = { apply: false, file: null };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a.startsWith('--file=')) args.file = a.slice('--file='.length) || null;
  }
  return args;
}

async function chargerExistants(client, codes) {
  if (codes.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT id, code_barre, produit, categorie_eco_org, genre, saison, gamme, poids_kg, date_sortie, date_inventaire
     FROM produits_finis WHERE code_barre = ANY($1::varchar[])`,
    [codes]
  );
  const map = new Map();
  for (const row of rows) map.set(row.code_barre, row);
  return map;
}

async function main() {
  const { apply, file } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('Usage : node src/scripts/import-stock-etiquettes.js --file=<chemin.xlsm|.xlsx> [--apply]');
    process.exit(1);
  }

  console.log(`\n=== Import du stock d'étiquettes — ${apply ? 'APPLICATION' : 'SIMULATION (--dry-run)'} ===`);
  console.log(`Fichier : ${file}\n`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);

  const feuille = await trouverFeuille(workbook);
  if (!feuille) {
    console.error(`Aucune feuille ne porte les colonnes « ID » et « Produits » dans ses 20 premières lignes.`);
    console.error(`Feuilles présentes : ${workbook.worksheets.map((w) => w.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`Feuille retenue : « ${feuille.worksheet.name} » (en-tête ligne ${feuille.rowIndex})`);

  const manquantes = COLONNES_REQUISES.filter((c) => !feuille.colonnes[c]);
  if (manquantes.length > 0) {
    console.error(`Colonnes requises absentes : ${manquantes.join(', ')}`);
    process.exit(1);
  }
  for (const c of COLONNES_OPTIONNELLES) {
    if (!feuille.colonnes[c]) console.log(`(colonne optionnelle absente : « ${c} » — tout entre sans elle)`);
  }

  const lignesBrutes = lireLignes(feuille.worksheet, feuille.colonnes, feuille.rowIndex);

  const recap = {
    lus: lignesBrutes.length,
    crees: 0,
    mis_a_jour: 0,
    inchanges: 0,
    ignores: { code_vide: 0, format_inconnu: 0, poids_invalide: 0, date_fabrication_invalide: 0, doublon_fichier: 0, ligne_entete_repetee: 0 },
    par_format: {},
    par_gamme: {},
    en_stock: 0,
    sortis: 0,
    poids_en_stock_kg: 0,
    ecarts: [],
    nb_ecarts_total: 0,
    // Cellules « Date de sortie » / « Inventaire » calculées par une formule à
    // référence rompue (#REF!) : la source des sorties n'est plus dans le
    // classeur. Compté pour être DIT — jamais corrigé en silence.
    formules_rompues: { date_sortie: 0, date_sortie_avec_resultat: 0, inventaire: 0 },
    sortie_avant_fabrication: 0,
    exemples_sortie_avant_fab: [],
  };

  const candidats = [];
  for (const l of lignesBrutes) {
    if (l.enteteRepetee) { recap.ignores.ligne_entete_repetee++; continue; }
    if (l.sortieFormuleRompue) {
      recap.formules_rompues.date_sortie++;
      if (l.dateSortie) recap.formules_rompues.date_sortie_avec_resultat++;
    }
    if (l.inventaireFormuleRompue) recap.formules_rompues.inventaire++;
    const decision = analyserLigne(l);
    if (!decision.ok) { recap.ignores[decision.motif] = (recap.ignores[decision.motif] || 0) + 1; continue; }
    candidats.push(decision.record);
  }

  const { uniques, doublons } = reperocherDoublons(candidats);
  recap.ignores.doublon_fichier = doublons.size > 0
    ? candidats.filter((r) => doublons.has(r.code)).length
    : 0;

  for (const r of uniques) {
    recap.par_format[r.format] = (recap.par_format[r.format] || 0) + 1;
    const gammeKey = r.gamme || '(sans gamme)';
    recap.par_gamme[gammeKey] = (recap.par_gamme[gammeKey] || 0) + 1;
    if (r.status === 'en_stock') { recap.en_stock++; recap.poids_en_stock_kg += r.poids_kg; }
    else recap.sortis++;
    // Sortie datée AVANT la fabrication : le classeur du 24/09/2026 en porte
    // (dates de convention 31/12/2015, 01/01/2020 pour des sorties anciennes
    // non datées). La date est importée TELLE QUELLE — c'est une sortie — mais
    // l'écart est nommé : un carton ne sort pas avant d'avoir été fabriqué.
    if (r.date_sortie && r.date_fabrication && r.date_sortie < r.date_fabrication) {
      recap.sortie_avant_fabrication++;
      if (recap.exemples_sortie_avant_fab.length < 5) recap.exemples_sortie_avant_fab.push(r.code);
    }
  }

  const client = await pool.connect();
  try {
    const existants = await chargerExistants(client, uniques.map((r) => r.code));

    if (apply) await client.query('BEGIN');

    for (const record of uniques) {
      const existant = existants.get(record.code) || null;
      const decision = decidercAction(existant, record);

      if (decision.ecarts.length > 0) {
        recap.nb_ecarts_total += decision.ecarts.length;
        if (recap.ecarts.length < 20) recap.ecarts.push(...decision.ecarts.slice(0, 20 - recap.ecarts.length));
      }

      if (decision.verdict === 'insert') {
        recap.crees++;
        if (apply) {
          await client.query(
            `INSERT INTO produits_finis
               (code_barre, produit, categorie_eco_org, genre, saison, gamme, poids_kg,
                date_fabrication, date_sortie, date_inventaire, codification, source, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'import_excel',$12,NULL)
             ON CONFLICT (code_barre) DO NOTHING`,
            [
              record.code, record.produit, record.categorie_eco_org, record.genre, record.saison, record.gamme,
              record.poids_kg, record.date_fabrication, record.date_sortie, record.date_inventaire,
              record.codification, record.status,
            ]
          );
        }
      } else if (decision.verdict === 'update_sortie') {
        recap.mis_a_jour++;
        if (apply) {
          await client.query(
            `UPDATE produits_finis SET date_sortie = $1, status = 'expedie' WHERE code_barre = $2 AND date_sortie IS NULL`,
            [record.date_sortie, record.code]
          );
        }
      } else {
        recap.inchanges++;
      }
    }

    if (apply) await client.query('COMMIT');
  } catch (err) {
    if (apply) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── Récapitulatif ──────────────────────────────────────────────────────
  console.log('\n--- Récapitulatif ---');
  const fr = recap.formules_rompues;
  if (fr.date_sortie > 0 || fr.inventaire > 0) {
    console.log('');
    console.log('!! AVERTISSEMENT — SORTIES NON FIABLES DANS CE CLASSEUR !!');
    console.log(`   « Date de sortie » : ${fr.date_sortie} cellule(s) sont une formule à référence rompue (#REF!)`);
    console.log(`   — la table des sorties n'est plus jointe au classeur. Seules ${fr.date_sortie_avec_resultat} de ces`);
    console.log(`   lignes portent encore une date (résultat que la formule calcule sans la table, p. ex. Pvak).`);
    console.log(`   Pour les ${fr.date_sortie - fr.date_sortie_avec_resultat} autres, l'ABSENCE de date ne prouve PAS que le carton est en stock :`);
    console.log(`   il sera importé « en_stock » faute de mieux, et devra être sorti au scan ou corrigé à la main.`);
    if (fr.inventaire > 0) console.log(`   « Inventaire » : ${fr.inventaire} cellule(s) dans le même cas (date d'inventaire ignorée).`);
    console.log('   Demander au client un classeur où ces colonnes sont des VALEURS, ou la table des sorties elle-même.');
    console.log('');
  }
  console.log(`Lignes lues                    : ${recap.lus}`);
  console.log(`Cartons créés                  : ${recap.crees}`);
  console.log(`Cartons mis à jour (sortie)    : ${recap.mis_a_jour}`);
  console.log(`Cartons inchangés              : ${recap.inchanges}`);
  console.log('Ignorés par motif :');
  for (const [motif, n] of Object.entries(recap.ignores)) {
    if (n > 0) console.log(`  - ${motif} : ${n}`);
  }
  console.log('Répartition par format :');
  for (const [f, n] of Object.entries(recap.par_format)) console.log(`  - ${f} : ${n}`);
  console.log('Répartition par gamme :');
  for (const [g, n] of Object.entries(recap.par_gamme)) console.log(`  - ${g} : ${n}`);
  console.log(`Cartons en stock               : ${recap.en_stock} (${recap.poids_en_stock_kg.toFixed(1)} kg)`);
  console.log(`Cartons sortis                 : ${recap.sortis}`);
  if (recap.sortie_avant_fabrication > 0) {
    console.log(`  dont sortie datée AVANT la fabrication : ${recap.sortie_avant_fabrication} (importées telles quelles ; ex. ${recap.exemples_sortie_avant_fab.join(', ')})`);
  }
  console.log(`Écarts de dimensions détectés  : ${recap.nb_ecarts_total} (${recap.ecarts.length} affichés)`);
  for (const e of recap.ecarts) {
    console.log(`  - ${e.code} / ${e.champ} : fichier="${e.valeur_fichier}" ≠ base="${e.valeur_base}"`);
  }

  if (!apply) {
    console.log('\nSimulation — aucune écriture. Relancer avec --apply pour appliquer.');
  } else {
    console.log('\nAppliqué.');
  }

  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Erreur :', err);
    process.exit(1);
  });
}

module.exports = {
  resolverValeurCellule,
  estFormuleRompue,
  resolverValeurDate,
  serialExcelVersDate,
  analyserLigne,
  reperocherDoublons,
  decidercAction,
  trouverEnTete,
  lireLignes,
};
