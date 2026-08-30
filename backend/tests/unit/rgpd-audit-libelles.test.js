/**
 * Garde anti-dérive du journal d'audit RGPD.
 *
 * Symétrique de `activity-log-libelles.test.js` (même doctrine, table
 * différente) : la page /rgpd traduit les codes `rgpd_audit_log.action` en
 * français via `frontend/src/utils/rgpd-libelles.js`. Rien ne reliait ce
 * dictionnaire au backend — contrairement à `user_activity_log`, AUCUNE garde
 * n'existait pour `rgpd_audit_log` (constat de reconnaissance, chantier
 * « conformité RGPD outillée » 2.44.0, point 3 de la demande client).
 *
 * Ce test lit le code source des DEUX côtés (aucune exécution, aucune base) et
 * échoue dès qu'un code `action` écrit par le backend dans `rgpd_audit_log`
 * n'a pas son libellé côté écran.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const DICT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'utils', 'rgpd-libelles.js');

/** Concatène tout le code source backend (aucune exécution). */
function lireBackend(dir) {
  let out = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += lireBackend(p);
    else if (e.name.endsWith('.js')) out += fs.readFileSync(p, 'utf8') + '\n';
  }
  return out;
}

/**
 * Extrait tous les codes `action` (littéraux MAJUSCULES_SNAKE_CASE) écrits par
 * le backend dans `rgpd_audit_log`.
 *
 * Deux formes coexistent dans le code : le littéral directement dans le texte
 * SQL (`VALUES (NULL, 'AUTO_PURGE_MESSAGERIE', ...)`, jobs planifiés) ou dans
 * le tableau de paramètres qui suit la requête paramétrée (`[req.user.id,
 * 'CREATE', ...]`, routes). Dans les deux cas, le littéral apparaît quelque
 * part entre `INSERT INTO rgpd_audit_log` et la parenthèse fermante de l'appel
 * `pool.query(...)` / `client.query(...)` — d'où la fenêtre bornée par le
 * premier `);` rencontré (et non une fenêtre de taille fixe, qui capterait des
 * littéraux MAJUSCULES sans rapport, ex. `client.query('COMMIT')` juste après,
 * ou `authorize('ADMIN', ...)` plus loin dans le fichier — vérifié en pratique
 * lors de l'écriture de ce test).
 *
 * Une poignée de sites (ex. `logConsultation`, `journaliserNoteProfil`,
 * `journaliserSaisieBureau`) factorisent l'écriture dans une fonction locale
 * qui reçoit `action` en PARAMÈTRE — le littéral n'est donc pas à côté de
 * l'INSERT mais sur chacun de ses appels. On les retrouve en repérant les
 * fonctions locales dont la signature contient `action` et dont le corps
 * écrit dans `rgpd_audit_log`, puis en lisant leurs appels.
 */
function extraireActionsEcrites(texte) {
  const actions = new Set();

  // Forme directe : le littéral vit entre l'INSERT et la fin de l'appel.
  for (const m of texte.matchAll(/INSERT INTO rgpd_audit_log/g)) {
    const debut = m.index;
    const relatif = texte.slice(debut).indexOf(');');
    const longueur = relatif === -1 || relatif > 1000 ? 500 : relatif + 2;
    const fenetre = texte.slice(debut, debut + longueur);
    for (const m2 of fenetre.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) {
      actions.add(m2[1]);
    }
  }

  // Forme indirecte : fonctions locales qui reçoivent `action` en paramètre.
  const nomsFonctions = new Set();
  for (const m of texte.matchAll(/function\s+(\w+)\s*\([^)]*\baction\b[^)]*\)\s*\{/g)) {
    const corps = texte.slice(m.index, m.index + 700);
    if (/rgpd_audit_log/.test(corps)) nomsFonctions.add(m[1]);
  }
  for (const nom of nomsFonctions) {
    const re = new RegExp(`${nom}\\([^)]*?'([A-Z][A-Z0-9_]{2,})'`, 'g');
    for (const m of texte.matchAll(re)) actions.add(m[1]);
  }

  return actions;
}

/** Extrait les clés d'un objet littéral `export const NOM = { ... };` du dictionnaire front. */
function clesDuDictionnaire(source, nom) {
  const i = source.indexOf(`const ${nom} = {`);
  if (i === -1) throw new Error(`Table ${nom} introuvable dans rgpd-libelles.js`);
  const debut = source.indexOf('{', i);
  let profondeur = 0; let fin = debut;
  for (let k = debut; k < source.length; k++) {
    if (source[k] === '{') profondeur++;
    else if (source[k] === '}') { profondeur--; if (profondeur === 0) { fin = k; break; } }
  }
  const corps = source.slice(debut + 1, fin).replace(/\/\/[^\n]*/g, '');
  return new Set([...corps.matchAll(/(^|[,{\s])([A-Z][A-Z0-9_]*)\s*:/g)].map((m) => m[2]));
}

const backend = lireBackend(SRC);
const dictionnaire = fs.readFileSync(DICT, 'utf8');

const actionsEcrites = extraireActionsEcrites(backend);

describe('journal d’audit RGPD — libellés à jour', () => {
  test('le recensement du backend n’est pas vide (le test lui-même doit rester utile)', () => {
    // Si un jour le pattern `INSERT INTO rgpd_audit_log` disparaît (renommage
    // de table, passage à un ORM…), les expressions ci-dessus ne trouveraient
    // plus rien et le test passerait à vide sans rien garantir.
    expect(actionsEcrites.size).toBeGreaterThan(30);
  });

  test('chaque code action écrit par le backend a son libellé', () => {
    const connus = clesDuDictionnaire(dictionnaire, 'RGPD_ACTION_LABELS');
    const absents = [...actionsEcrites].filter((a) => !connus.has(a)).sort();
    expect(absents).toEqual([]);
  });
});
