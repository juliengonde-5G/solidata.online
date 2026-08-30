/**
 * LES DEUX DOCUMENTS PCM, ÉPROUVÉS SUR LEUR SOURCE RÉELLE.
 *
 * Ils composent du HTML par concaténation de chaînes, sans React pour les
 * surveiller : personne ne voit ce qu'ils contiennent avant qu'ils ne sortent
 * de l'imprimante — et l'un d'eux est remis à la personne concernée.
 *
 * Le module du front est LU DANS SON FICHIER et exécuté tel quel (même procédé
 * que `badgeuse-ecrans-contract.test.js`) : le test suit le code réel, il n'en
 * réimplémente pas une copie qui divergerait au premier ajustement.
 *
 * Deux choses vérifiées ici, toutes deux conséquences du lot 2.45.0 :
 *   1. la FICHE TECHNIQUE dégrade proprement quand les réponses ont été purgées
 *      à 30 jours — elle NOMME l'absence au lieu d'afficher un tableau vide,
 *      qui se lit comme un défaut d'affichage ;
 *   2. la RESTITUTION AU CANDIDAT ne porte ni l'indicateur de cohérence des
 *      réponses (l'ex-« alerte RPS », artefact mesuré par l'audit) ni de
 *      vocabulaire clinique — c'est un document remis à quelqu'un.
 */
const fs = require('fs');
const path = require('path');

const UTILS = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'utils');

/**
 * Charge `pcm-pdf.js` ET sa source unique de mentions `pcm.js`, débarrassés de
 * leur syntaxe de module, dans un contexte où `window.open` est une fenêtre de
 * papier : elle mémorise le HTML écrit au lieu de l'imprimer.
 */
function chargerExports() {
  const pcm = fs.readFileSync(path.join(UTILS, 'pcm.js'), 'utf8');
  const pdf = fs.readFileSync(path.join(UTILS, 'pcm-pdf.js'), 'utf8');
  const ecrit = [];
  const fauxWindow = {
    open: () => ({
      document: { write: (html) => ecrit.push(html), close: () => {} },
      print: () => {},
    }),
  };
  const bloc = (pcm + '\n' + pdf)
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/pcm';/g, '')
    .replace(/export\s+(const|function)/g, '$1');
  // setTimeout : openPrintWindow diffère l'impression de 400 ms ; dans ce
  // contexte on n'a pas besoin d'attendre, et on ne veut pas de minuterie
  // ouverte à la fin de la suite.
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'setTimeout',
    `${bloc}; return { exportTechnicalPDF, exportRestitutionCandidatPDF, PCM_MENTION_CONSERVATION };`
  )(fauxWindow, () => {});
  return { ...api, ecrit };
}

const { exportTechnicalPDF, exportRestitutionCandidatPDF, PCM_MENTION_CONSERVATION, ecrit } = chargerExports();

const PROFIL = {
  candidate: { first_name: 'Amel', last_name: 'ZEROUAL' },
  createdAt: '2026-08-30T09:20:00.000Z',
  baseType: 'analyseur',
  phaseType: 'promoteur',
  riskAlert: true,
  report: { scores: { analyseur: 100, empathique: 62 } },
};

const REPONSES = [
  { question_number: 1, category: 'perception', question_text: 'Q1 ?', answer_value: 'analyseur', answer_label: 'Les faits' },
];

/** Charge utile réelle de GET /pcm/sessions/:token/restitution. */
const RESTITUTION = {
  prenom: 'Amel',
  date_passation: '2026-08-30T09:20:00.000Z',
  base: {
    type: 'analyseur', nom: 'Analyseur', perception: 'Pensées factuelles',
    canal: 'Interrogatif / Informatif', points_forts: ['Responsable', 'Logique'],
    besoin: 'Reconnaissance du travail',
    avec_les_autres: 'Privilégie la clarté et le respect des règles.',
    ce_qui_aide: 'Bureau organisé, tâches structurées, délais clairs',
  },
  phase: { type: 'promoteur', nom: 'Promoteur', besoin: 'Excitation, action' },
  immeuble: [{ etage: 1, nom: 'Analyseur', score: 100 }, { etage: 2, nom: 'Empathique', score: 62 }],
  profil_peu_marque: false,
  note_immeuble: null,
};

beforeEach(() => { ecrit.length = 0; });

describe('fiche technique — dégradation quand les réponses ont été purgées', () => {
  test('avec les réponses : le tableau détaillé est bien là', () => {
    expect(exportTechnicalPDF(PROFIL, REPONSES)).toBe(true);
    const html = ecrit[0];
    expect(html).toMatch(/Reponses detaillees \(1 questions\)/);
    expect(html).toMatch(/Q1 \?/);
  });

  test('sans réponses : l’absence est NOMMÉE, et le reste de la fiche est intact', () => {
    // Cas produit après la purge à 30 jours : le serveur répond 200 avec une
    // liste vide (la session existe toujours). Un tableau vide surmonté de
    // « 0 question » se lirait comme un bug ; on dit pourquoi il est vide.
    expect(exportTechnicalPDF(PROFIL, [])).toBe(true);
    const html = ecrit[0];
    expect(html).toMatch(/non conservees/);
    expect(html).toMatch(/n'est plus conservé/);
    expect(html).not.toMatch(/\(0 questions\)/);
    // Ce qui subsiste subsiste : scores, base et phase.
    expect(html).toMatch(/Scores normalises/);
    expect(html).toMatch(/Analyseur/);
  });

  test('réponses absentes (null) : même dégradation, aucune exception', () => {
    expect(exportTechnicalPDF(PROFIL, null)).toBe(true);
    expect(ecrit[0]).toMatch(/non conservees/);
  });
});

describe('restitution au candidat — ce qu’elle porte, et ce qu’elle ne portera jamais', () => {
  test('elle rend à la personne sa manière de communiquer, en clair', () => {
    expect(exportRestitutionCandidatPDF(RESTITUTION)).toBe(true);
    const html = ecrit[0];
    expect(html).toMatch(/Votre résultat/);
    expect(html).toMatch(/Amel/);
    expect(html).toMatch(/Analyseur/);
    expect(html).toMatch(/Responsable/);
    expect(html).toMatch(/Votre manière de communiquer/);
  });

  test('aucun indicateur de cohérence, aucun vocabulaire clinique, aucun guide manager', () => {
    exportRestitutionCandidatPDF(RESTITUTION);
    // On inspecte le CORPS, pas le document entier : la feuille de style est
    // partagée avec les exports internes et déclare une classe `.stress-badge`
    // que ce document n'utilise pas. Chercher le mot dans tout le fichier
    // ferait échouer le test sur du CSS mort — et, pire, ferait croire plus
    // tard qu'on peut lever l'interdit.
    const corps = ecrit[0].slice(ecrit[0].indexOf('<body>'));
    for (const interdit of ['cohérent', 'stress', 'dépress', 'driver', 'masque',
      'Guide Manager', 'Niveaux de stress', 'risque']) {
      expect(corps.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
  });

  test('elle porte les mentions de méthode ET de conservation — un document se lit seul', () => {
    exportRestitutionCandidatPDF(RESTITUTION);
    const html = ecrit[0];
    expect(html).toMatch(/aide au dialogue/i);        // mention de méthode partagée
    expect(html).toMatch(/30 jours après le test/);    // durée réelle, dérivée de la notice
    expect(PCM_MENTION_CONSERVATION).toMatch(/30 jours/);
    expect(html).toMatch(/demander à le corriger/);    // droits
  });

  test('immeuble indisponible : l’absence est dite, aucun classement n’est fabriqué', () => {
    exportRestitutionCandidatPDF({
      ...RESTITUTION, immeuble: null,
      note_immeuble: "Le détail de votre profil n'est plus disponible : seuls votre type principal et vos repères de communication vous sont remis.",
    });
    const html = ecrit[0];
    expect(html).toMatch(/n&#039;est plus disponible|n'est plus disponible/);
    expect(html).not.toMatch(/Ce qui vous ressemble aussi/);
  });

  test('une fenêtre bloquée rend la main (false) au lieu d’un alert() natif', () => {
    const { exportRestitutionCandidatPDF: bloque } = (() => {
      const pcm = fs.readFileSync(path.join(UTILS, 'pcm.js'), 'utf8');
      const pdf = fs.readFileSync(path.join(UTILS, 'pcm-pdf.js'), 'utf8');
      const bloc = (pcm + '\n' + pdf)
        .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/pcm';/g, '')
        .replace(/export\s+(const|function)/g, '$1');
      // eslint-disable-next-line no-new-func
      return new Function('window', 'setTimeout',
        `${bloc}; return { exportRestitutionCandidatPDF };`)({ open: () => null }, () => {});
    })();
    expect(bloque(RESTITUTION)).toBe(false);
  });
});
