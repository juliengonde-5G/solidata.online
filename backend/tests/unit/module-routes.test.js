// ═══════════════════════════════════════════════════════════════════════════
// GARDE — LA CARTE ROUTEUR → MODULE NE PEUT PAS PRENDRE DU RETARD
// ───────────────────────────────────────────────────────────────────────────
// Depuis la 2.56.0, la matrice d'habilitations peut ACCORDER un module à un
// rôle, et `authorize()` s'appuie sur `utils/module-routes.js` pour savoir de
// quel module relève la requête en cours.
//
// Cette carte a un défaut de naissance évident : elle vit à côté des montages
// d'`index.js` au lieu d'être portée par eux. Un routeur ajouté demain sans
// entrée ici ne casserait rien de visible — il serait simplement impossible de
// l'accorder, et l'exploitant qui coche « Opérations » verrait le lien sans
// obtenir l'accès. Silencieux, donc durable.
//
// La garde est STATIQUE (elle lit `index.js`) parce que c'est la seule façon de
// couvrir les routeurs qui n'existent pas encore. Même doctrine que
// `roles-retires.test.js` et `source-syntaxe.test.js`.
const fs = require('fs');
const path = require('path');
const {
  MODULE_PAR_ROUTEUR,
  MODULES_NON_ACCORDABLES,
  resoudreModules,
  modulesAccordables,
} = require('../../src/utils/module-routes');

const INDEX = path.join(__dirname, '../../src/index.js');

/** Préfixes réellement montés dans index.js (hors lignes commentées). */
function prefixesMontes() {
  const src = fs.readFileSync(INDEX, 'utf8');
  const prefixes = new Set();
  for (const ligne of src.split('\n')) {
    if (ligne.trim().startsWith('//')) continue; // montage désactivé (ex. billing)
    const m = ligne.match(/app\.use\(\s*'(\/api[^']*)'\s*,\s*require\(/);
    if (m) prefixes.add(m[1]);
  }
  return [...prefixes];
}

describe('Carte routeur → module', () => {
  test('tout routeur monté dans index.js a une réponse explicite', () => {
    const manquants = prefixesMontes().filter(
      (p) => !Object.prototype.hasOwnProperty.call(MODULE_PAR_ROUTEUR, p)
    );
    expect(manquants).toEqual([]);
  });

  test('aucune entrée de la carte ne désigne un routeur qui n’existe plus', () => {
    const montes = new Set(prefixesMontes());
    const orphelins = Object.keys(MODULE_PAR_ROUTEUR).filter((p) => !montes.has(p));
    expect(orphelins).toEqual([]);
  });

  test('les clés de module employées existent toutes au catalogue', () => {
    // Le catalogue est la source de vérité de routes/permissions.js. Une clé
    // inventée ici ne serait jamais cochable : l'accord serait inatteignable.
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/permissions.js'), 'utf8');
    const catalogue = new Set([...src.matchAll(/\{\s*key:\s*'([a-z-]+)'/g)].map((m) => m[1]));
    const employees = new Set();
    for (const v of Object.values(MODULE_PAR_ROUTEUR)) {
      if (v === null) continue;
      for (const k of Array.isArray(v) ? v : [v]) employees.add(k);
    }
    expect([...employees].filter((k) => !catalogue.has(k))).toEqual([]);
  });

  describe('résolution par préfixe le plus long', () => {
    test('un sous-chemin hérite du routeur qui le porte', () => {
      expect(resoudreModules('/api/cav/12/historique')).toEqual(['operations']);
    });

    test('le poste badgeuse reste hors matrice malgré le préfixe commun', () => {
      // '/api/badgeuse/device' est plus long que '/api/badgeuse' : sans le tri
      // par longueur, l'API du poste RFID deviendrait accordable.
      expect(resoudreModules('/api/badgeuse/device/lots')).toBeNull();
      expect(resoudreModules('/api/badgeuse/pointages')).toEqual(['badgeuse']);
    });

    test('la chaîne de requête ne fait pas partie du chemin', () => {
      expect(resoudreModules('/api/vak?annee=2026')).toEqual(['vak', 'frip']);
    });

    test('un préfixe voisin ne capture pas un autre routeur', () => {
      // '/api/boutiques' ne doit pas absorber '/api/boutique-ventes'.
      expect(resoudreModules('/api/boutique-ventes/import')).toEqual(['boutiques', 'frip']);
    });

    test('une route inconnue ne relève d’aucun module', () => {
      expect(resoudreModules('/api/inexistant')).toBeNull();
      expect(modulesAccordables('/api/inexistant')).toEqual([]);
    });
  });

  describe('bornes d’un accord', () => {
    test('l’administration du logiciel n’est jamais accordable', () => {
      // Le refus continue de fonctionner (resoudreModules la voit) ; c'est
      // l'ACCORD qui est refusé — une case à cocher ne fabrique pas un ADMIN.
      expect(MODULES_NON_ACCORDABLES.has('admin')).toBe(true);
      for (const chemin of ['/api/users', '/api/admin-db', '/api/settings', '/api/activity-log']) {
        expect(resoudreModules(chemin)).toContain('admin');
        expect(modulesAccordables(chemin)).toEqual([]);
      }
    });

    test('les surfaces RH / insertion / PCM ne sont pas accordables', () => {
      // Elles portent de la santé (art. 9), du judiciaire (art. 10), des
      // salaires et la RQTH, et leurs masquages sont écrits « masquer POUR
      // MANAGER » — donc à défaut TOUT MONTRER. Un accord les rendrait
      // atteignables et livrerait le dossier entier. Tant que ces gardes ne
      // sont pas inversées en « masquer SAUF ADMIN/RH », l'accord reste fermé.
      expect(MODULES_NON_ACCORDABLES.has('rh')).toBe(true);
      expect(MODULES_NON_ACCORDABLES.has('pcm')).toBe(true);
      for (const chemin of ['/api/insertion/cadre/5', '/api/employees', '/api/pcm/profiles', '/api/effectifs']) {
        expect(modulesAccordables(chemin)).toEqual([]);
      }
    });

    test('les surfaces d’exploitation, elles, restent accordables', () => {
      // C'est le besoin qui a motivé le lot : reconstruire un profil
      // d'exploitation sans donner ADMIN.
      expect(modulesAccordables('/api/cav')).toEqual(['operations']);
      expect(modulesAccordables('/api/production')).toEqual(['tri']);
      expect(modulesAccordables('/api/finance')).toEqual(['analyse']);
      expect(modulesAccordables('/api/vak')).toEqual(['vak', 'frip']);
    });

    test('un routeur à plusieurs modules garde ceux qui restent accordables', () => {
      // Refashion relève d'Audit, d'Analyse et d'Administration : accorder
      // « Analyse » doit l'ouvrir, sans que « Administration » devienne
      // accordable pour autant.
      expect(resoudreModules('/api/refashion')).toEqual(['audit', 'analyse', 'admin']);
      expect(modulesAccordables('/api/refashion')).toEqual(['audit', 'analyse']);
    });

    test('les routeurs hors matrice ne s’ouvrent par aucun accord', () => {
      for (const chemin of ['/api/auth/login', '/api/permissions/matrix', '/api/public/cav', '/api/webhooks/sumup']) {
        expect(modulesAccordables(chemin)).toEqual([]);
      }
    });
  });
});
