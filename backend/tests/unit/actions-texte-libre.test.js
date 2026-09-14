// ═══════════════════════════════════════════════════════════════════════════
// GARDE STATIQUE — le dictionnaire de masquage des actions CIP suit la table
//   backend/src/routes/insertion/routes.js  (`ACTIONS_TEXTE_LIBRE`)
//
// ═══ POURQUOI CETTE GARDE EXISTE ═══════════════════════════════════════════
//
// `maskActionPlansForRole` retire, pour un MANAGER, les champs LIBRES d'une
// action rattachée à l'axe santé (art. 9) : `notes` et `resultat`. La PR D a
// ajouté à `cip_action_plans` trois colonnes de texte libre — `dora_service`,
// `dora_url`, `aide_organisme` — sans les ajouter au dictionnaire. Sur une
// action de l'axe santé, l'encadrant perdait donc `notes` et recevait
// « CSAPA de Rouen — addictologie » (constat B-03 de la revue de sécurité).
//
// C'est le mécanisme EXACT du `SELECT im.*` de la PR C et du `SELECT e.*` de
// la 2.43.0 : un dictionnaire de champs sensibles qui ne suit pas les colonnes
// qu'on ajoute à la table. Une liste tenue à la main redevient fausse à la
// colonne suivante ; celle-ci est donc confrontée au SCHÉMA, et toute colonne
// de texte libre non classée fait TOMBER la suite plutôt que de fuir en
// silence. Classer une nouvelle colonne coûte une ligne ; l'oublier coûte une
// fuite d'article 9.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..', 'src');
const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8');

/**
 * Colonnes de `cip_action_plans` de type texte, relevées dans TOUTES les
 * sources qui la font grandir (la table de `init-db.js` et les migrations).
 */
function colonnesTexte() {
  const sources = [
    lire('scripts/init-db.js'),
    lire('scripts/migrations/insertion-cadre.js'),
    lire('scripts/migrations/insertion-rsa.js'),
    lire('scripts/migrations/insertion-reporting.js'),
  ].join('\n');

  const cols = new Set();
  // 1. Les `ALTER TABLE cip_action_plans ADD COLUMN [IF NOT EXISTS] <col> <type>`
  const re = /ALTER TABLE cip_action_plans\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)\s+(TEXT|VARCHAR\s*\(\s*\d+\s*\))/gi;
  let m;
  while ((m = re.exec(sources)) !== null) cols.add(m[1]);

  // 2. Le corps du `CREATE TABLE` d'origine.
  const creation = sources.match(/CREATE TABLE IF NOT EXISTS cip_action_plans \(([\s\S]*?)\n\s*\);/);
  if (creation) {
    for (const ligne of creation[1].split('\n')) {
      const c = ligne.trim().match(/^(\w+)\s+(TEXT|VARCHAR\s*\(\s*\d+\s*\))/i);
      if (c) cols.add(c[1]);
    }
  }
  return [...cols];
}

/**
 * Colonnes de texte réputées NON sensibles — chacune argumentée. Une valeur de
 * liste fermée (contrôlée par un CHECK ou un validateur) ne peut pas porter de
 * phrase libre : c'est ce qui la rend inoffensive, et c'est la seule raison
 * recevable de ne pas la masquer.
 */
const NON_SENSIBLES = {
  action_label: "libellé de l'action — affiché à l'encadrant par conception (il doit pouvoir suivre l'action) ; l'axe judiciaire, lui, disparaît en entier, libellé compris.",
  category: 'liste fermée (CHECK) — sept valeurs, aucune saisie libre.',
  frein_type: "clé d'axe issue du registre des freins, jamais du texte saisi.",
  priority: 'liste fermée (CHECK).',
  status: 'liste fermée (CHECK).',
  dora_resultat: 'liste fermée (CHECK) : orienté / pris en charge / refusé / sans suite.',
  aide_nature: "liste fermée (CHECK) : la NATURE de l'aide, jamais l'organisme ni le motif.",
};

describe('garde statique — masquage des actions CIP', () => {
  const src = lire('routes/insertion/routes.js');
  const decl = src.match(/const ACTIONS_TEXTE_LIBRE = \[([^\]]*)\];/);

  it('le dictionnaire est déclaré et contient les trois champs de la PR D', () => {
    expect(decl).toBeTruthy();
    const liste = decl[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    for (const c of ['notes', 'resultat', 'dora_service', 'dora_url', 'aide_organisme']) {
      expect(liste).toContain(c);
    }
  });

  it('AUCUNE colonne de texte de la table n’échappe au classement', () => {
    const liste = decl[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    const nonClassees = colonnesTexte()
      .filter((c) => !liste.includes(c) && !(c in NON_SENSIBLES));
    // Le message nomme la colonne ET la décision à prendre : une suite qui
    // tombe sans dire quoi faire se contourne en ajoutant la colonne à la
    // mauvaise liste.
    expect({ colonnes_non_classees: nonClassees }).toEqual({ colonnes_non_classees: [] });
  });

  it('la garde voit réellement le schéma (sinon elle ne prouverait rien)', () => {
    const cols = colonnesTexte();
    expect(cols).toEqual(expect.arrayContaining(
      ['notes', 'action_label', 'category', 'resultat', 'dora_service', 'dora_url', 'aide_organisme']
    ));
  });
});
