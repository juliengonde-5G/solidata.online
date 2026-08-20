// ═══════════════════════════════════════════════════════════════════════════
// GARDE DE SYNTAXE — tout fichier .js de backend/src doit COMPILER
//
// Pourquoi ce test existe (passe de debug du 20/08/2026) :
// `src/scripts/init-db.js` a été livré avec une faute de syntaxe bloquante —
// un commentaire SQL contenant des `back-quotes` À L'INTÉRIEUR d'un littéral
// de gabarit JS, qui refermait la chaîne prématurément. Conséquence : le script
// de création du schéma ne se chargeait plus du tout, donc `deploy.sh update`
// aurait échoué en production dès l'étape init-db.
//
// Cette faute était STRUCTURELLEMENT INVISIBLE de la batterie existante :
// les suites `tests/unit/scripts/*-schema.test.js` lisent init-db.js en TEXTE
// (`fs.readFileSync` + expressions régulières) pour vérifier la présence des
// CREATE TABLE — elles ne l'exécutent ni ne le compilent jamais. Aucun test
// n'en faisait le `require`. 2047 tests étaient donc verts sur un dépôt dont le
// script de schéma ne démarrait pas.
//
// Le test compile chaque fichier avec `vm.Script` : la compilation VALIDE la
// syntaxe SANS EXÉCUTER le code — aucune connexion base, aucun effet de bord,
// aucun démarrage de scheduler. C'est ce qui permet de couvrir aussi les
// scripts (init-db, migrations, seeds) qui, eux, ne doivent surtout pas tourner
// dans une suite de tests.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_ROOT = path.join(__dirname, '..', '..', 'src');

/** Tous les fichiers .js sous backend/src, chemins relatifs à src/. */
function listSourceFiles(dir = SRC_ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      listSourceFiles(full, acc);
    } else if (full.endsWith('.js')) {
      acc.push(path.relative(SRC_ROOT, full));
    }
  }
  return acc;
}

const sourceFiles = listSourceFiles();

describe('Syntaxe des sources backend', () => {
  test('des fichiers .js sont bien découverts sous src/', () => {
    // Garde-fou : si l'arborescence bouge, le test ne doit pas devenir vert
    // en ne vérifiant plus rien.
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  test.each(sourceFiles)('%s compile sans erreur de syntaxe', (relative) => {
    const full = path.join(SRC_ROOT, relative);
    const source = fs.readFileSync(full, 'utf8');
    // new vm.Script() compile sans exécuter : une erreur de syntaxe lève ici.
    expect(() => new vm.Script(source, { filename: full })).not.toThrow();
  });

  test('init-db.js est chargeable par Node (require du script de schéma)', () => {
    // Défense en profondeur sur LE fichier qui a cassé : la compilation seule
    // ne garantit pas que les require internes résolvent. `require` est sûr ici
    // car init-db.js n'exécute son initialisation que s'il est lancé
    // directement (garde `require.main === module`).
    expect(() => require(path.join(SRC_ROOT, 'scripts', 'init-db.js'))).not.toThrow();
  });
});
