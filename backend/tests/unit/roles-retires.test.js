// ═══════════════════════════════════════════════════════════════════════════
// GARDE — LES RÔLES RETIRÉS NE REVIENNENT PAS PAR LA PETITE PORTE
// ───────────────────────────────────────────────────────────────────────────
// MANAGER, QHSE et FINANCE ont été supprimés le 10/09/2026 (demande client).
// Ce fichier existe parce qu'une CONTRE-ÉPREUVE l'a réclamé : remettre MANAGER
// dans `utils/roles.js` ne faisait tomber AUCUN test. Le rôle redevenait donc
// assignable en silence — sans qu'aucun `authorize` ne le reconnaisse, ce qui
// est le pire des deux mondes : un compte qu'on croit habilité et qui n'ouvre
// rien, jusqu'à ce que quelqu'un « répare » en le remettant dans une liste
// d'habilitation, et rouvre alors une surface qu'on croyait fermée.
//
// La garde est STATIQUE (elle lit le code source) parce que c'est la seule
// façon de couvrir les fichiers qui n'existent pas encore : une route écrite
// demain qui nommerait MANAGER tombe ici, sans que personne ait pensé à elle.
// Même doctrine que `source-syntaxe.test.js` et `tours-colonnes-obligatoires`.
const fs = require('fs');
const path = require('path');
const { BUILTIN_ROLES } = require('../../src/utils/roles');

const RETIRES = ['MANAGER', 'QHSE', 'FINANCE'];
const RACINE = path.join(__dirname, '../../src');

/** Tous les .js du backend, sauf ce qui ne décide d'aucun accès. */
function fichiersSource(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') fichiersSource(p, acc); }
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

describe('rôles retirés — la liste des rôles intégrés', () => {
  test.each(RETIRES)('%s n’est plus un rôle assignable', (role) => {
    expect(BUILTIN_ROLES).not.toContain(role);
  });

  test('les rôles qui subsistent sont intacts (aucun dommage collatéral)', () => {
    for (const garde of ['ADMIN', 'RH', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ', 'DPO', 'PCM', 'COMMUNICATION']) {
      expect(BUILTIN_ROLES).toContain(garde);
    }
  });
});

describe('rôles retirés — plus aucun appel authorize() ne les nomme', () => {
  // On lit les APPELS, pas les commentaires : les branches de masquage
  // conservées (insertion/masking.js, employees.js) mentionnent encore le rôle
  // à dessein — elles protègent une donnée sensible si le rôle revenait un
  // jour. Ce qui est interdit, c'est de lui RENDRE un accès.
  const fichiers = fichiersSource(RACINE);

  test('aucun fichier ne fait authorize(… MANAGER/QHSE/FINANCE …)', () => {
    const coupables = [];
    for (const f of fichiers) {
      const src = fs.readFileSync(f, 'utf8');
      for (const appel of src.match(/authorize\([^()]*\)/g) || []) {
        if (RETIRES.some((r) => appel.includes(`'${r}'`) || appel.includes(`"${r}"`))) {
          coupables.push(`${path.relative(RACINE, f)} → ${appel}`);
        }
      }
    }
    expect(coupables).toEqual([]);
  });

  test('la surface de la messagerie ne les compte plus parmi les rôles restreints', () => {
    // `messagerie.roles_perimetre_restreint` bornait AUTORITE/FINANCE/DPO à
    // l'annuaire des responsables. FINANCE n'existant plus, le laisser dans le
    // défaut ferait porter la règle à un rôle fantôme — et masquerait le fait
    // que la règle ne s'applique plus qu'à deux rôles.
    const src = fs.readFileSync(path.join(RACINE, 'routes/messages.js'), 'utf8');
    const m = /const ROLES_RESTREINTS_DEFAUT = \[([^\]]*)\]/.exec(src);
    expect(m).not.toBeNull();
    for (const role of RETIRES) expect(m[1]).not.toContain(`'${role}'`);
  });
});
