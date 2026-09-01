/**
 * NOTE DE PROFIL — une réponse TRONQUÉE ne doit plus jeter la note entière.
 *
 * Constat du 01/09/2026 (capture client) : l'écran affichait « Le modèle n'a
 * pas renvoyé une note structurée — texte brut ci-dessous » suivi du JSON brut,
 * alors que huit rubriques sur neuf étaient complètes. Cause : la réponse était
 * coupée en pleine chaîne (`…Commentaire libre de l'entret`), donc invalide
 * pour `JSON.parse`, et le service se rabattait sur le texte brut.
 *
 * Deux gardes ici :
 *  1. les rubriques COMPLÈTES sont conservées (`analyserJsonModele`) ;
 *  2. la rubrique coupée est RETIRÉE, jamais complétée au jugé, et la
 *     réparation est SIGNALÉE (`repare`) pour que l'écran le dise.
 */
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: jest.fn() },
})));

const { analyserJsonModele, reparerJsonTronque } = require('../../../src/services/insertion-ai');

// Réponse réelle reproduite d'après la capture : fence markdown ouvrante,
// coupure en plein milieu de la valeur de « limites ».
const REPONSE_TRONQUEE = '```json\n' + `{
  "synthese": "Le dossier repose sur les données administratives de recrutement et les repères PCM.",
  "expression_de_la_personne": [],
  "structure_personnalite": {
    "type_pcm_base": "Persévérant",
    "phase": "Empathique",
    "points_forts": ["Engagé", "Observateur", "Consciencieux"],
    "signaux_stress_a_observer": ["Signal : dit oui à toutes les demandes → Ce qui aide : solliciter son opinion."]
  },
  "freins_pressentis": [],
  "questions_suggerees_diagnostic": [
    "Qu'est-ce qui vous a donné envie de rejoindre Solidata ?",
    "Comment décririez-vous votre parcours, dans vos propres mots ?"
  ],
  "limites": "Cette note ne permet pas d'affirmer l'absence de freins : CV non disponible ; Commentaire libre de l'entret`;

describe('Réponse IA tronquée — note de profil', () => {
  test('les rubriques complètes sont conservées', () => {
    const { valeur } = analyserJsonModele(REPONSE_TRONQUEE);
    expect(valeur).not.toBeNull();
    expect(valeur.synthese).toMatch(/^Le dossier repose/);
    expect(valeur.structure_personnalite.type_pcm_base).toBe('Persévérant');
    expect(valeur.structure_personnalite.signaux_stress_a_observer).toHaveLength(1);
    expect(valeur.questions_suggerees_diagnostic).toHaveLength(2);
  });

  test('la rubrique coupée est retirée, jamais devinée', () => {
    const { valeur } = analyserJsonModele(REPONSE_TRONQUEE);
    expect(valeur).not.toHaveProperty('limites');
  });

  test('la réparation est signalée (l\'écran doit annoncer une note incomplète)', () => {
    expect(analyserJsonModele(REPONSE_TRONQUEE).repare).toBe(true);
  });

  test('un JSON complet n\'est jamais marqué comme réparé', () => {
    const net = analyserJsonModele('{"synthese":"ok","freins_pressentis":[]}');
    expect(net.repare).toBe(false);
    expect(net.valeur.synthese).toBe('ok');
  });

  test('les fences markdown et un préambule restent tolérés sans réparation', () => {
    expect(analyserJsonModele('```json\n{"synthese":"ok"}\n```').repare).toBe(false);
    expect(analyserJsonModele('Voici la note :\n```json\n{"synthese":"ok"}\n```').valeur.synthese).toBe('ok');
  });

  test('rien d\'exploitable → null (le repli texte brut reste possible)', () => {
    expect(analyserJsonModele('').valeur).toBeNull();
    expect(analyserJsonModele('une phrase sans json').valeur).toBeNull();
    expect(analyserJsonModele('{{{{').valeur).toBeNull();
  });

  test('la structure n\'est pas confondue avec le CONTENU des chaînes', () => {
    // Accolade, crochet, virgule et guillemet échappé à l'intérieur d'une
    // valeur : les prendre pour des délimiteurs produirait un JSON faux.
    const t = '{"a":"une } accolade, un ] crochet et un \\" guillemet","b":"tron';
    expect(reparerJsonTronque(t).a).toBe('une } accolade, un ] crochet et un " guillemet');
  });

  test('coupure dans un tableau et dans un objet imbriqué', () => {
    expect(reparerJsonTronque('{"a":[1,2,3')).toEqual({ a: [1, 2] });
    expect(reparerJsonTronque('{"a":{"b":"c","d":"tronq')).toEqual({ a: { b: 'c' } });
  });
});
