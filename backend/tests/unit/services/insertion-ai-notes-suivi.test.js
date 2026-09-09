/**
 * Le journal d'accompagnement entre dans le RAISONNEMENT de l'IA — et rien
 * d'autre n'en sort.
 *
 * Trois choses tenues ici :
 *   1. les notes de suivi figurent bien dans la charge utile envoyée au modèle
 *      (analyse de profil ET préparation d'entretien) ;
 *   2. elles sont PSEUDONYMISÉES comme le reste (aucun patronyme ne part) ;
 *   3. une note illisible est ÉCARTÉE plutôt que transmise en blob : faire
 *      raisonner un modèle sur du charabia serait pire que de ne rien lui dire.
 */
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: (...a) => mockCreate(...a) },
})));

const { encryptField, ENC_PREFIX } = require('../../../src/utils/field-crypto');

const NOTES = [
  { id: 3, date_note: '2026-09-02', categorie: 'echange',
    contenu_chiffre: encryptField('Jean Dupont dit vouloir passer le CACES. Joignable au 0612345678.') },
  { id: 2, date_note: '2026-08-20', categorie: 'alerte',
    contenu_chiffre: encryptField('Deux retards cette semaine, garde d\'enfant à régler.') },
  { id: 1, date_note: '2026-08-01', categorie: 'suivi',
    contenu_chiffre: `${ENC_PREFIX}blob-illisible` },
];

const mockQuery = jest.fn((sql) => {
  const s = String(sql);
  if (s.includes('LEFT JOIN teams')) {
    return Promise.resolve({ rows: [{
      id: 1, first_name: 'Jean', last_name: 'Dupont', position_name: 'Trieur', team_name: 'Tri',
      insertion_status: 'en_parcours', birth_date: '1990-01-01',
    }] });
  }
  if (s.includes('FROM insertion_notes_suivi')) return Promise.resolve({ rows: NOTES });
  return Promise.resolve({ rows: [] });
});
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';
const insertionAi = require('../../../src/services/insertion-ai');

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ synthese: 'ok', intro_conseillee: 'ok' }) }],
    stop_reason: 'end_turn',
  });
});

const chargeUtile = () => mockCreate.mock.calls[0][0].messages[0].content;

describe('analyseProfilComplet — le journal de suivi nourrit le raisonnement', () => {
  it('transmet les notes datées et catégorisées', async () => {
    await insertionAi.analyseProfilComplet(1);
    const payload = chargeUtile();
    expect(payload).toMatch(/notes_suivi/);
    expect(payload).toMatch(/2026-09-02/);
    expect(payload).toMatch(/CACES/);
    expect(payload).toMatch(/"categorie": "alerte"/);
  });

  it('les notes sont pseudonymisées comme le reste du dossier', async () => {
    await insertionAi.analyseProfilComplet(1);
    const payload = chargeUtile();
    expect(payload).not.toMatch(/Dupont/);
    expect(payload).not.toMatch(/0612345678/);
    expect(payload).toMatch(/Salarié A/);
  });

  it('une note illisible est écartée, jamais transmise en blob', async () => {
    await insertionAi.analyseProfilComplet(1);
    expect(chargeUtile()).not.toContain(ENC_PREFIX);
  });

  it('la consigne au modèle en fait des OBSERVATIONS datées, pas des conclusions', async () => {
    await insertionAi.analyseProfilComplet(1);
    const payload = chargeUtile();
    expect(payload).toMatch(/OBSERVATIONS DATÉES/);
    expect(payload).toMatch(/jamais comme des conclusions/);
  });
});

describe('preparerEntretien — les notes récentes ouvrent l\'entretien', () => {
  it('transmet les notes de suivi récentes et rappelle qu\'elles restent à vérifier', async () => {
    await insertionAi.preparerEntretien(1, 'bilan_intermediaire');
    const payload = chargeUtile();
    expect(payload).toMatch(/notes_suivi_recentes/);
    expect(payload).toMatch(/CACES/);
    expect(payload).not.toMatch(/Dupont/);
    expect(payload).toMatch(/c'est à l'entretien de le vérifier/);
  });
});
