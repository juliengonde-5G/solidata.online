/**
 * UNE NOTE AMPUTÉE NE PART PAS AU DOSSIER SANS LE DIRE.
 *
 * La note de profil est versée à la fiche personnelle du salarié et imprimée
 * pour le dossier. Quand la réponse du modèle a été coupée (2.45.1), certaines
 * rubriques n'existent pas : sans mention, le lecteur d'un dossier archivé
 * prendrait « rubrique absente » pour « rien à signaler ».
 *
 * Le générateur du front est LU DANS SON FICHIER et exécuté tel quel (même
 * procédé que `pcm-pdf-restitution.test.js`) : le test suit le code réel.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'insertion');

function chargerGenerateur() {
  const src = fs.readFileSync(path.join(DIR, 'pdf-insertion.js'), 'utf8');
  const ecrit = [];
  const fauxWindow = {
    open: () => ({
      document: { write: (html) => ecrit.push(html), close: () => {} },
      print: () => {},
    }),
  };
  const bloc = src
    .replace(/import[\s\S]*?from\s*'[^']+';/g, '')
    .replace(/export\s+(const|function)/g, '$1');
  // Dépendances des imports retirés, réduites au strict nécessaire au gabarit.
  const prelude = `
    const FREINS = []; const ENTRETIEN_STATUS_LABELS = {}; const ENTRETIEN_TYPE_LABELS = {};
    const SORTIE_CLASS_LABELS = {}; const ACTION_STATUS_LABELS = {}; const ACTION_CATEGORY_LABELS = {};
    const COMPETENCE_FILIERE_LABELS = {}; const entretienLabel = (m) => (m && m.title) || '';
    const formatEmployeeName = (n, p) => [String(n || '').toUpperCase(), p].filter(Boolean).join(' ');
  `;
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'setTimeout',
    `${prelude}\n${bloc}\n; return { exportNoteProfilPDF };`
  )(fauxWindow, () => {});
  return { ...api, ecrit };
}

const { exportNoteProfilPDF, ecrit } = chargerGenerateur();

const EMPLOYE = { first_name: 'Amel', last_name: 'ZEROUAL' };
const CONTENU_COMPLET = {
  synthese: 'Le dossier repose sur les données de recrutement et les repères PCM.',
  questions_suggerees_diagnostic: ['Qu\'attendez-vous de cet accompagnement ?'],
  limites: 'CV non disponible.',
};

function imprimer(contenu) {
  ecrit.length = 0;
  exportNoteProfilPDF({ employee: EMPLOYE, note: { contenu, sources: {}, generated_at: '2026-09-01T08:00:00.000Z' } });
  return ecrit.join('');
}

describe('PDF de la note de profil — réponse tronquée', () => {
  test('une note amputée porte la mention « Note incomplète »', () => {
    const html = imprimer({ ...CONTENU_COMPLET, _tronque: true });
    expect(html).toMatch(/Note incomplète/);
    expect(html).toMatch(/coupée avant la fin/);
    expect(html).toMatch(/retirées plutôt que devinées/);
  });

  test('une note entière ne porte AUCUNE mention d\'incomplétude', () => {
    const html = imprimer(CONTENU_COMPLET);
    expect(html).not.toMatch(/Note incomplète/);
    expect(html).toMatch(/Le dossier repose sur les données/);
  });

  test('le contenu conservé est bien imprimé malgré la troncature', () => {
    const html = imprimer({ ...CONTENU_COMPLET, _tronque: true });
    expect(html).toMatch(/Le dossier repose sur les données/);
    expect(html).toMatch(/ZEROUAL Amel/);
  });
});
