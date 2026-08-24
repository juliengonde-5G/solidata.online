/**
 * Garde anti-dérive du journal d'activité.
 *
 * La page /activity-log traduit les codes techniques (`entity_type`, `action`)
 * en libellés français via deux tables tenues à la main dans ActivityLog.jsx.
 * Rien ne les reliait au backend : chaque module ajouté depuis 2026 a écrit
 * dans le journal sans son libellé — 14 entités sur 35 étaient absentes, donc
 * introuvables au filtre par entité.
 *
 * Ce test lit le code source des DEUX côtés et échoue dès qu'un code écrit par
 * le backend n'a pas son libellé côté écran. Il n'a pas besoin de base.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const PAGE = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'pages', 'ActivityLog.jsx');

/** Concatène tout le code backend (aucune exécution). */
function lireBackend(dir) {
  let out = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += lireBackend(p);
    else if (e.name.endsWith('.js')) out += fs.readFileSync(p, 'utf8');
  }
  return out;
}

/** Extrait les clés d'un objet littéral `const NOM = { ... };` du fichier page. */
function clesDeTable(source, nom) {
  const i = source.indexOf(`const ${nom} = {`);
  if (i === -1) throw new Error(`Table ${nom} introuvable dans ActivityLog.jsx`);
  const debut = source.indexOf('{', i);
  let profondeur = 0; let fin = debut;
  for (let k = debut; k < source.length; k++) {
    if (source[k] === '{') profondeur++;
    else if (source[k] === '}') { profondeur--; if (profondeur === 0) { fin = k; break; } }
  }
  const corps = source.slice(debut + 1, fin).replace(/\/\/[^\n]*/g, '');
  return new Set([...corps.matchAll(/(^|[,{\s])([a-z_][a-z0-9_]*)\s*:/gi)].map((m) => m[2]));
}

const backend = lireBackend(SRC);
const page = fs.readFileSync(PAGE, 'utf8');

// Ce que le backend écrit RÉELLEMENT dans user_activity_log.
const entitesEcrites = new Set([
  ...[...backend.matchAll(/autoLogActivity\('([a-z_]+)'\)/g)].map((m) => m[1]),
  ...[...backend.matchAll(/entityType:\s*'([a-z_]+)'/g)].map((m) => m[1]),
]);
const actionsEcrites = new Set([
  ...[...backend.matchAll(/action:\s*'([a-z_]+)'/g)].map((m) => m[1]),
  // autoLogActivity dérive create/update/delete de la méthode HTTP.
  'create', 'update', 'delete',
]);

describe('journal d’activité — libellés à jour', () => {
  test('le recensement du backend n’est pas vide (le test lui-même doit rester utile)', () => {
    // Si un jour autoLogActivity est renommé, les expressions ci-dessus ne
    // trouveraient plus rien et le test passerait à vide sans rien garantir.
    expect(entitesEcrites.size).toBeGreaterThan(20);
    expect(actionsEcrites.size).toBeGreaterThan(8);
  });

  test('chaque entité écrite par le backend a son libellé', () => {
    const connues = clesDeTable(page, 'ENTITY_LABELS');
    const absentes = [...entitesEcrites].filter((e) => !connues.has(e)).sort();
    expect(absentes).toEqual([]);
  });

  test('chaque action écrite par le backend a son libellé', () => {
    const connues = clesDeTable(page, 'ACTION_LABELS');
    const absentes = [...actionsEcrites].filter((a) => !connues.has(a)).sort();
    expect(absentes).toEqual([]);
  });

  test('chaque action libellée a aussi une couleur', () => {
    const labels = clesDeTable(page, 'ACTION_LABELS');
    const couleurs = clesDeTable(page, 'ACTION_COLORS');
    const sansCouleur = [...labels].filter((a) => !couleurs.has(a)).sort();
    expect(sansCouleur).toEqual([]);
  });
});
