import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Garde anti-écran-blanc : un helper de `src/services/` APPELÉ sans être
 * IMPORTÉ dans le fichier qui l'appelle.
 *
 * Le 27/08/2026, `TourMap.jsx` appelait `lireArrivee(...)` sans l'importer. Rien
 * ne l'a vu : `vite build` compile sans broncher (un identifiant inconnu reste
 * une référence globale légale en JavaScript), le mobile n'a pas de linter, et
 * les 175 tests ne montaient pas cet écran. En production, l'appel n'avait lieu
 * que sur une tournée ASSOCIATION — le rendu levait « lireArrivee is not
 * defined », React démontait tout l'arbre, et le chauffeur se retrouvait devant
 * une PAGE BLANCHE au lancement de sa tournée.
 *
 * Ce test rejoue ce raisonnement sur TOUT le code mobile, sans dépendance
 * ajoutée : il ne remplace pas un linter, il ferme la porte par laquelle ce
 * défaut-là est passé.
 *
 * Périmètre volontairement ÉTROIT pour rester sans faux positif :
 *   - seuls les noms réellement exportés par `src/services/**` sont surveillés ;
 *   - seuls les usages en APPEL de fonction (`nom(`) sont comptés ;
 *   - les commentaires et les chaînes sont retirés avant analyse (sans quoi le
 *     commentaire qui documente le correctif déclencherait lui-même l'alerte).
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ICI, '..', 'src');

/** Tous les fichiers source du mobile. */
function fichiersSource(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return fichiersSource(p);
    return /\.jsx?$/.test(e.name) ? [p] : [];
  });
}

/**
 * Retire commentaires et littéraux de chaîne : on ne veut analyser que du code
 * exécutable. Approximation suffisante ici (aucune regex littérale contenant
 * un guillemet dans ce code source).
 */
function codeSeul(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // commentaires blocs
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // commentaires ligne (hors https://)
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');
}

/** Noms exportés nommément par les modules de `src/services/`. */
function exportsDesServices() {
  const noms = new Map(); // nom -> module d'origine
  const dir = path.join(SRC, 'services');
  for (const f of fichiersSource(dir)) {
    const code = codeSeul(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(SRC, f);
    for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
      noms.set(m[1], rel);
    }
    for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
      noms.set(m[1], rel);
    }
    for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const brut of m[1].split(',')) {
        const nom = brut.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(nom) && nom !== 'default') noms.set(nom, rel);
      }
    }
  }
  return noms;
}

/** Noms disponibles dans la portée d'un fichier : importés OU déclarés sur place. */
function nomsDisponibles(code) {
  const dispo = new Set();
  // import X, { a, b as c } from '...'
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s+/g)) {
    for (const brut of m[1].replace(/[{}]/g, ',').split(',')) {
      const nom = brut.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nom)) dispo.add(nom);
    }
  }
  // déclarations locales (y compris destructuration : const { a, b } = ...)
  for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) dispo.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) dispo.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const brut of m[1].split(',')) {
      const nom = brut.trim().split(/[:=]/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nom)) dispo.add(nom);
    }
  }
  return dispo;
}

describe('Intégrité des imports du mobile', () => {
  const exportsServices = exportsDesServices();

  it('expose bien des helpers de services à surveiller', () => {
    expect(exportsServices.size).toBeGreaterThan(10);
    // Le helper à l'origine du défaut du 27/08/2026 doit être dans le périmètre.
    expect(exportsServices.has('lireArrivee')).toBe(true);
  });

  it("n'appelle jamais un helper de services sans l'avoir importé", () => {
    const manquants = [];

    for (const fichier of fichiersSource(SRC)) {
      const code = codeSeul(fs.readFileSync(fichier, 'utf8'));
      const dispo = nomsDisponibles(code);
      const rel = path.relative(SRC, fichier);

      for (const [nom, origine] of exportsServices) {
        if (dispo.has(nom)) continue;                       // importé ou déclaré ici
        if (path.relative(SRC, fichier) === origine) continue; // sa propre définition
        // Usage en APPEL uniquement, et jamais en accès de propriété (`o.nom(`).
        const appel = new RegExp(`(^|[^.\\w$])${nom}\\s*\\(`);
        if (appel.test(code)) {
          manquants.push(`${rel} appelle ${nom}() sans l'importer (défini dans ${origine})`);
        }
      }
    }

    expect(manquants).toEqual([]);
  });

  it('détecte le défaut quand il est réintroduit (contre-épreuve)', () => {
    // Le fichier réel, privé de son import : la garde doit le voir.
    const reel = fs.readFileSync(path.join(SRC, 'pages', 'TourMap.jsx'), 'utf8');
    const mutant = codeSeul(
      reel.replace(/import\s*\{\s*lireArrivee\s*\}\s*from\s*[^\n]*\n/, '')
    );
    expect(nomsDisponibles(mutant).has('lireArrivee')).toBe(false);
    expect(/(^|[^.\w$])lireArrivee\s*\(/.test(mutant)).toBe(true);
  });
});
