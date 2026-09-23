/**
 * GARDE — l'arbre de navigation doit S'ÉVALUER, pas seulement se lire.
 *
 * POURQUOI CE FICHIER EXISTE (2.56.2). Les tests qui touchaient `navTree.js` le
 * lisaient en TEXTE (`readFileSync` + `toContain`). Ils ne l'ont donc jamais
 * EXÉCUTÉ, et ont laissé passer une panne totale : lucide expose une icône
 * nommée `Map`, dont l'import MASQUE le `Map` du langage sur tout le module ;
 * le `new Map()` de l'index construisait alors l'icône — un objet React, pas un
 * constructeur. L'entrée du bundle mourait à l'évaluation et TOUTES les pages,
 * connexion comprise, restaient blanches. Aucun rempart React ne peut rattraper
 * cela : React n'a jamais démarré.
 *
 * Le module est donc évalué ICI comme le navigateur le fait, avec des icônes qui
 * sont ce qu'elles sont vraiment — des objets non constructibles. Un test qui
 * fournirait des fonctions à la place laisserait repasser exactement ce défaut.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE_FRONT = path.join(__dirname, '../../../frontend/src');
const CHEMIN_NAVTREE = path.join(RACINE_FRONT, 'navigation/navTree.js');

/**
 * Une icône lucide est un objet `forwardRef`, pas une fonction constructible.
 * `new` sur cet objet lève « is not a constructor » — exactement l'erreur de
 * production. C'est la fidélité de ce faux qui donne sa valeur au test.
 */
function faireIcone(nom) {
  return { $$typeof: Symbol.for('react.forward_ref'), displayName: nom, render: () => null };
}

const lucideFactice = new Proxy({}, {
  get: (_, nom) => (typeof nom === 'string' ? faireIcone(nom) : undefined),
  has: () => true,
});

/** Transforme le module ES en script évaluable, sans rien changer à sa logique. */
function evaluerModuleEs(source) {
  let code = source;

  // `import { A, B as C } from 'x'` → `const { A, B: C } = __import_x;`
  code = code.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, noms, spec) => {
      const destructure = noms.replace(/\s+as\s+/g, ': ');
      return `const {${destructure}} = __importer(${JSON.stringify(spec)});`;
    }
  );

  const exportes = [];
  code = code.replace(/export\s+(const|function|let|class)\s+([A-Za-z0-9_$]+)/g, (_, kind, nom) => {
    exportes.push(nom);
    return `${kind} ${nom}`;
  });
  code += `\n;__exports__ = { ${exportes.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ')} };`;
  return code;
}

function chargerNavTree() {
  const code = evaluerModuleEs(fs.readFileSync(CHEMIN_NAVTREE, 'utf8'));
  const bac = {
    __exports__: null,
    __importer: (spec) => {
      if (spec === 'lucide-react') return lucideFactice;
      throw new Error(`import non prévu par la garde : ${spec}`);
    },
  };
  vm.createContext(bac);
  new vm.Script(code, { filename: 'navTree.js' }).runInContext(bac);
  return bac.__exports__;
}

describe("Arbre de navigation — le module s'évalue vraiment", () => {
  test("navTree.js s'évalue avec des icônes lucide réalistes (non constructibles)", () => {
    // C'EST LE TEST QUI AURAIT ATTRAPÉ LA PAGE BLANCHE.
    expect(() => chargerNavTree()).not.toThrow();
  });

  test('NAV_TREE est bien un arbre exploitable', () => {
    const { NAV_TREE } = chargerNavTree();
    expect(Array.isArray(NAV_TREE)).toBe(true);
    expect(NAV_TREE.length).toBeGreaterThan(5);
    expect(NAV_TREE.every((n) => typeof n.label === 'string')).toBe(true);
  });

  test('modulesDuChemin fonctionne sur le module RÉELLEMENT évalué', () => {
    const { modulesDuChemin } = chargerNavTree();
    expect(typeof modulesDuChemin).toBe('function');
    // Un écran de collecte relève bien de la section Opérations.
    expect(modulesDuChemin('/fill-rate')).toContain('operations');
    // Le préfixe le plus long l'emporte, et un chemin inconnu ne prétend rien.
    expect(modulesDuChemin('/chemin/inexistant')).toEqual([]);
    expect(modulesDuChemin('')).toEqual([]);
  });
});

describe('Garde de classe — aucun import lucide ne doit masquer un constructeur du langage', () => {
  /**
   * Les noms d'icônes lucide qui sont AUSSI des constructeurs globaux. Importer
   * l'un d'eux sans alias le masque pour tout le fichier ; un `new` dessus plus
   * bas casse le module à l'évaluation, donc l'écran entier, en silence.
   */
  const CONSTRUCTEURS_GLOBAUX = [
    'Map', 'Set', 'Image', 'Audio', 'Range', 'Text', 'Option', 'Date',
    'Promise', 'Array', 'Object', 'Error', 'RegExp', 'Number', 'String',
    'Boolean', 'Function', 'WeakMap', 'WeakSet', 'Proxy', 'URL', 'Event',
    'File', 'Blob', 'Response', 'Request', 'Headers', 'Worker', 'Notification',
  ];

  function listerFichiers(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) listerFichiers(p, acc);
      else if (/\.(js|jsx)$/.test(e.name)) acc.push(p);
    }
    return acc;
  }

  test('aucun fichier front ou mobile ne combine un import masquant et un `new`', () => {
    const racines = [RACINE_FRONT, path.join(__dirname, '../../../mobile/src')]
      .filter((r) => fs.existsSync(r));

    const fautifs = [];
    for (const racine of racines) {
      for (const fichier of listerFichiers(racine)) {
        const srcBrut = fs.readFileSync(fichier, 'utf8');
        // Un commentaire JSDoc peut CITER l'import fautif en exemple (c'est le
        // cas ici même, dans ce fichier de garde) : le retirer avant de
        // chercher, sinon la garde se déclenche sur du texte, pas du code.
        // Les chaînes de caractères ne sont PAS retirées : un import réel ne
        // vit jamais dans une chaîne, et les retirer risquerait de couper une
        // portion de code légitime entre guillemets.
        const src = srcBrut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        const m = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"]lucide-react['"]/);
        if (!m) continue;

        // Un nom ALIASÉ (`Map as MapIcon`) ne masque rien : il est hors de cause.
        const importesSansAlias = m[1]
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !s.includes(' as '))
          .map((s) => s.replace(/\s+/g, ''));

        for (const nom of importesSansAlias) {
          if (!CONSTRUCTEURS_GLOBAUX.includes(nom)) continue;
          if (new RegExp(`new\\s+${nom}\\s*\\(`).test(src)) {
            fautifs.push(`${path.relative(path.join(__dirname, '../../..'), fichier)} : importe « ${nom} » de lucide sans alias ET fait « new ${nom}() »`);
          }
        }
      }
    }

    expect(fautifs).toEqual([]);
  });
});
