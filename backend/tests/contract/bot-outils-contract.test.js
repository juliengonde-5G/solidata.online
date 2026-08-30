// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — outils SolidataBot des modules 26 à 34
// ───────────────────────────────────────────────────────────────────────────
// CE QUE CES TESTS VERROUILLENT
//
//   • LE DOUBLE FILTRAGE, outil par outil : un rôle non habilité ne voit pas
//     l'outil dans la liste envoyée au modèle, ET se le voit refuser à
//     l'exécution — le second contrôle étant celui qui tient si le premier
//     laisse un jour passer quelque chose. On vérifie en prime qu'un REFUS
//     n'interroge PAS la base : un accès refusé ne doit rien lire du tout.
//
//   • LE SEUIL D'ANONYMAT n ≥ 5 des enquêtes, à travers le bot. Il est calculé
//     par la fonction du module, jamais recopiée ici ; ce test prouve que le
//     chemin conversationnel ne le contourne pas — et qu'il ne laisse pas non
//     plus filer les VERBATIMS, que l'agrégateur natif renvoie pourtant quand
//     le questionnaire est anonyme.
//
//   • LA TRONCATURE, réellement effective : le tableau de bord RSE agrège 27
//     critères, une tournée peut avoir des dizaines d'arrêts. Ces objets sont
//     bornés CÔTÉ OUTIL, sans compter sur le modèle pour « choisir de résumer ».
//
//   • LE FILET PII, exercé POUR DE VRAI. Jusqu'ici `sanitizeToolResult` n'avait
//     jamais rien intercepté : aucun outil ne renvoyait de champ nominatif, si
//     bien que le filet n'était testé que sur des objets synthétiques, hors du
//     chat. Ici il est éprouvé DANS la boucle conversationnelle réelle, sur ce
//     qui part effectivement vers le modèle.
//
//   • LA LECTURE SEULE, structurellement : aucun outil n'émet d'écriture SQL.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
// La clé doit être posée AVANT le require de chat.js (lue au chargement).
process.env.ANTHROPIC_API_KEY = 'test-key-solidatabot';

const mockQuery = jest.fn();
const mockClient = { query: (...a) => mockQuery(...a), release: jest.fn() };
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => mockClient),
}));

// Client Anthropic simulé : on ne teste pas le modèle, on teste CE QU'ON LUI ENVOIE.
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: (...a) => mockCreate(...a) },
})));

const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const chat = require('../../src/routes/chat');
const botTools = require('../../src/services/bot-tools');
const { toolsForRole, EXTENDED_TOOL_ROLES, executeTool } = chat;

const TOUS_LES_ROLES = ['ADMIN', 'MANAGER', 'RH', 'QHSE', 'DPO', 'FINANCE', 'RESP_BTQ', 'AUTORITE', 'COLLABORATEUR'];
const NOUVEAUX_ETENDUS = botTools.BOT_EXTENDED_TOOLS.map((t) => t.name);

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/chat', chat);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockCreate.mockReset();
});

const ctx = (role, userId = 1) => ({ role, userId, username: 'u' });

/** Toutes les clés d'un objet, à toute profondeur (inspection de structure). */
function clesProfondes(v, acc = []) {
  if (Array.isArray(v)) { v.forEach((x) => clesProfondes(x, acc)); return acc; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) { acc.push(k); clesProfondes(v[k], acc); }
  }
  return acc;
}

/**
 * Le message d'outil transmis au modèle.
 * On le CHERCHE au lieu de prendre le dernier : jest garde une RÉFÉRENCE vers
 * le tableau `messages`, que la boucle continue de faire grandir après l'appel.
 * Lire « le dernier » revenait donc à lire l'état final, pas ce qui a été envoyé.
 */
function chargeOutil(messages) {
  const m = messages.find((x) => Array.isArray(x.content)
    && x.content[0] && x.content[0].type === 'tool_result');
  return m ? m.content[0].content : null;
}
const json = async (nom, entree, role) => JSON.parse(await executeTool(nom, entree || {}, ctx(role)));

// ═══════════════════════════════════════════════════════════════════════════
// 1. DOUBLE FILTRAGE PAR RÔLE
// ═══════════════════════════════════════════════════════════════════════════
describe('double filtrage — liste ET exécution, outil par outil', () => {
  it('les 12 nouveaux outils sont bien déclarés (2 de base + 10 réservés)', () => {
    expect(botTools.BOT_BASE_TOOLS.map((t) => t.name)).toEqual(
      ['layout_chaine_actif', 'mes_pointages_badgeuse']);
    expect(NOUVEAUX_ETENDUS).toHaveLength(10);
    // Chaque outil réservé figure dans la table d'exécution : sans cette ligne,
    // un outil ajouté à la liste sans y être ne serait gardé QU'à l'exposition.
    for (const nom of NOUVEAUX_ETENDUS) {
      expect(EXTENDED_TOOL_ROLES[nom]).toEqual(expect.any(Array));
      expect(EXTENDED_TOOL_ROLES[nom].length).toBeGreaterThan(0);
    }
  });

  // Les habilitations recopient le `READ` du routeur natif : le bot ne doit
  // jamais ouvrir plus large que l'écran équivalent au même rôle.
  it.each([
    ['resume_vak_live', ['ADMIN', 'MANAGER']],
    ['resume_rse', ['ADMIN', 'MANAGER', 'RH']],
    ['resume_energie_ges', ['ADMIN', 'MANAGER', 'RH', 'QHSE']],
    ['resume_achats_responsables', ['ADMIN', 'MANAGER', 'RH', 'QHSE']],
    ['resultats_enquete', ['ADMIN', 'MANAGER', 'RH', 'QHSE']],
    ['saturation_cav', ['ADMIN', 'MANAGER']],
    ['arrets_gps_tournee', ['ADMIN', 'MANAGER']],
    ['echeances_commandes_recurrentes', ['ADMIN', 'MANAGER']],
    ['resume_effectifs_etp', ['ADMIN', 'RH', 'MANAGER']],
    ['etat_purges_rgpd', ['ADMIN', 'DPO']],
  ])('%s : habilitations conformes à l\'écran natif', (nom, attendus) => {
    expect(EXTENDED_TOOL_ROLES[nom].slice().sort()).toEqual(attendus.slice().sort());
  });

  it.each(NOUVEAUX_ETENDUS)('%s : ABSENT de la liste pour tout rôle non habilité', (nom) => {
    const autorises = EXTENDED_TOOL_ROLES[nom];
    for (const role of TOUS_LES_ROLES.filter((r) => !autorises.includes(r))) {
      expect(toolsForRole(role).map((t) => t.name)).not.toContain(nom);
    }
  });

  it.each(NOUVEAUX_ETENDUS)('%s : REFUSÉ à l\'exécution pour un rôle non habilité, sans lire la base', async (nom) => {
    const autorises = EXTENDED_TOOL_ROLES[nom];
    const interdit = TOUS_LES_ROLES.find((r) => !autorises.includes(r));
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json(nom, { tour_id: 1 }, interdit);
    expect(res.error).toMatch(/n'as pas accès/i);
    // Un refus qui aurait déjà lu la base serait un refus d'affichage, pas
    // d'accès : la donnée aurait quitté sa table.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Titre corrigé : « chauffeur compris » était devenu FAUX. Le périmètre du
  // chauffeur est désormais une liste blanche (collecte / circulation /
  // navigation) qui ne contient aucun outil de base — ce test parle des RÔLES,
  // et le rôle d'un chauffeur (COLLABORATEUR) ne décide plus de rien pour lui.
  // Le cas chauffeur est verrouillé dans bot-chauffeur-contract.test.js.
  it('les outils de base restent accessibles à tous les rôles (hors session véhicule)', () => {
    for (const role of TOUS_LES_ROLES) {
      const n = toolsForRole(role).map((t) => t.name);
      expect(n).toContain('layout_chaine_actif');
      expect(n).toContain('mes_pointages_badgeuse');
    }
  });

  it("mes_pointages_badgeuse n'offre AUCUN paramètre d'identité au modèle", () => {
    const outil = botTools.BOT_BASE_TOOLS.find((t) => t.name === 'mes_pointages_badgeuse');
    const props = Object.keys(outil.input_schema.properties);
    expect(props).toEqual(['periode']);
    // La question « les pointages de qui ? » ne peut pas être posée : il n'y a
    // pas de champ pour la poser, donc rien à refuser.
    expect(props).not.toContain('employee_id');
  });

  it('un rôle personnalisé hérite du filtrage de son rôle de base', async () => {
    mockQuery.mockResolvedValue({ rows: [{ role_key: 'REF_RSE', base_role: 'MANAGER' }] });
    await require('../../src/middleware/auth').refreshCustomRoles();
    const n = toolsForRole('REF_RSE').map((t) => t.name);
    expect(n).toContain('resume_rse');       // MANAGER y a droit
    expect(n).not.toContain('etat_purges_rgpd'); // MANAGER n'y a pas droit
    mockQuery.mockResolvedValue({ rows: [] });
    await require('../../src/middleware/auth').refreshCustomRoles();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SEUIL D'ANONYMAT DES ENQUÊTES — préservé à travers le bot
// ═══════════════════════════════════════════════════════════════════════════
describe('resultats_enquete — le seuil n ≥ 5 tient par le chemin conversationnel', () => {
  const CAMPAGNE = {
    id: 7, titre: 'QVCT 2026', statut: 'close', public_cible: 'Salariés',
    date_ouverture: '2026-01-05', date_cloture: '2026-02-05',
    modele_id: 3, modele_categorie: 'qvct', modele_anonyme: true,
  };
  const QUESTIONS = [
    { id: 11, ordre: 1, libelle: 'Vous sentez-vous soutenu ?', type: 'echelle', options: null },
    { id: 12, ordre: 2, libelle: 'Un mot libre ?', type: 'texte', options: null },
  ];

  const brancher = (reponses) => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM enquete_campagnes/.test(s)) return Promise.resolve({ rows: [CAMPAGNE] });
      if (/FROM enquete_questions/.test(s)) return Promise.resolve({ rows: QUESTIONS });
      if (/FROM enquete_reponses/.test(s)) return Promise.resolve({ rows: reponses.map((r) => ({ reponses: r })) });
      return Promise.resolve({ rows: [] });
    });
  };

  it('4 réponses → sous_seuil, AUCUNE distribution, aucune moyenne', async () => {
    brancher([
      { 11: 4, 12: 'ça va' }, { 11: 5, 12: 'bien' },
      { 11: 2, 12: 'bof' }, { 11: 3, 12: 'moyen' },
    ]);
    const res = await json('resultats_enquete', {}, 'RH');
    expect(res.sous_seuil).toBe(true);
    expect(res.nb_reponses).toBe(4);
    expect(res.seuil_anonymat).toBe(5);
    expect(res.questions).toBeUndefined();
    // Aucune CLÉ de résultat ne doit traîner dans la charge utile. On inspecte
    // les clés, pas le texte : la note du refus emploie les mots « distribution »
    // et « moyenne » précisément pour les nier.
    expect(clesProfondes(res)).not.toContain('distribution');
    expect(clesProfondes(res)).not.toContain('moyenne');
    expect(clesProfondes(res)).not.toContain('nuage_mots');
  });

  it('5 réponses (le seuil EXACT) → restitution agrégée', async () => {
    brancher([
      { 11: 4 }, { 11: 5 }, { 11: 2 }, { 11: 3 }, { 11: 4 },
    ]);
    const res = await json('resultats_enquete', {}, 'ADMIN');
    expect(res.sous_seuil).toBe(false);
    expect(res.nb_reponses).toBe(5);
    expect(res.questions[0].moyenne).toBe(3.6);
    expect(res.questions[0].distribution).toEqual({ 2: 1, 3: 1, 4: 2, 5: 1 });
  });

  it('les VERBATIMS ne sortent jamais par le bot, même sur un questionnaire anonyme', async () => {
    brancher([
      { 11: 4, 12: 'mon chef Dupont me harcèle' }, { 11: 5, 12: 'rien à dire' },
      { 11: 2, 12: 'ambiance tendue' }, { 11: 3, 12: 'ok' },
      { 11: 4, 12: 'correct' }, { 11: 1, 12: 'difficile' },
    ]);
    const res = await json('resultats_enquete', {}, 'QHSE');
    expect(res.sous_seuil).toBe(false);
    const brut = JSON.stringify(res);
    // L'agrégateur natif renvoie `reponses_texte` ET `nuage_mots` quand le
    // modèle est anonyme : le bot est PLUS strict que l'écran, car un texte
    // libre peut identifier son auteur par ce qu'il raconte.
    expect(brut).not.toContain('harcèle');
    expect(brut).not.toContain('Dupont');
    expect(brut).not.toContain('nuage_mots');
    expect(brut).not.toContain('reponses_texte');
    const libre = res.questions.find((q) => q.type === 'texte');
    expect(libre.distribution).toBeNull();
  });

  it('aucune campagne close → le dit, sans inventer de résultat', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json('resultats_enquete', {}, 'RH');
    expect(res.trouve).toBe(false);
    expect(res.note).toMatch(/close/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TRONCATURE EFFECTIVE (piège 6 : les sorties riches saturent le contexte)
// ═══════════════════════════════════════════════════════════════════════════
describe('troncature — les sorties riches sont bornées CÔTÉ OUTIL', () => {
  it('saturation_cav : 12 bornes menacées → 5 montrées, 7 annoncées non montrées', async () => {
    const bornes = Array.from({ length: 12 }, (_, i) => ({
      name: `Borne ${i + 1}`, commune: 'ROUEN',
      date_saturation: '2026-09-05', couvert: false,
    }));
    mockQuery.mockImplementation((sql) => (/FROM cav c JOIN pred/.test(String(sql))
      ? Promise.resolve({ rows: bornes })
      : Promise.resolve({ rows: [] })));
    const res = await json('saturation_cav', {}, 'MANAGER');
    expect(res.nb_bornes_menacees).toBe(12);
    expect(res.a_planifier.total).toBe(12);
    expect(res.a_planifier.montres).toHaveLength(botTools.MAX_DETAIL);
    expect(res.a_planifier.non_montres).toBe(12 - botTools.MAX_DETAIL);
    // Le compteur global reste JUSTE malgré la troncature : c'est tout l'intérêt.
    expect(res.a_planifier.montres.length + res.a_planifier.non_montres).toBe(12);
  });

  it('arrets_gps_tournee : les arrêts hors programme sont bornés, la durée totale reste complète', async () => {
    const arrets = Array.from({ length: 9 }, (_, i) => ({
      debut: `2026-08-20T09:0${i}:00Z`, fin: null, duree_min: 10 + i, type: 'inconnu',
    }));
    arrets.push({ debut: '2026-08-20T12:00:00Z', duree_min: 30, type: 'centre' });
    mockQuery.mockImplementation((sql) => (/FROM tours WHERE id/.test(String(sql))
      ? Promise.resolve({ rows: [{ id: 42, date: '2026-08-20', status: 'completed' }] })
      : Promise.resolve({ rows: [] })));
    jest.spyOn(require('../../src/routes/tours/analyse-gps'), 'arretsPourAffichage')
      .mockResolvedValue({ arrets, source: 'table', seuil_min: 5, rayon_m: 40 });

    const res = await json('arrets_gps_tournee', { tour_id: 42 }, 'ADMIN');
    expect(res.nb_arrets_detectes).toBe(10);
    expect(res.nb_hors_programme).toBe(9); // l'arrêt « centre » n'en est pas un
    // Somme des 9 arrêts hors programme (10..18) = 126 min : la DURÉE n'est pas
    // tronquée, seule la liste l'est.
    expect(res.duree_totale_hors_programme_min).toBe(126);
    expect(res.plus_longs_hors_programme.total).toBe(9);
    expect(res.plus_longs_hors_programme.montres).toHaveLength(botTools.MAX_DETAIL);
    expect(res.plus_longs_hors_programme.montres[0].duree_min).toBe(18); // le plus long d'abord
    require('../../src/routes/tours/analyse-gps').arretsPourAffichage.mockRestore();
  });

  it('layout_chaine_actif : le plan V7 (63 blocs) ne part pas entier dans la conversation', async () => {
    const postes = Array.from({ length: 20 }, (_, i) => ({
      libelle: `Poste ${i + 1}`, obligatoire: i < 5, effectif_min: 1, effectif_max: 2,
    }));
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM chaine_layouts/.test(s)) return Promise.resolve({ rows: [{ id: 1, nom: 'Plan V7', description: null, effectif_max: 15 }] });
      if (/GROUP BY categorie/.test(s)) {
        return Promise.resolve({ rows: [
          { categorie: 'poste', n: 11, effectif: 15 },
          { categorie: 'zone_depose', n: 50, effectif: 0 },
          { categorie: 'entree', n: 2, effectif: 0 },
        ] });
      }
      if (/categorie = 'poste'/.test(s)) return Promise.resolve({ rows: postes });
      return Promise.resolve({ rows: [] });
    });
    const res = await json('layout_chaine_actif', {}, 'COLLABORATEUR');
    expect(res.actif).toBe(true);
    expect(res.nb_zones_depose).toBe(50);
    expect(res.postes.montres.length).toBeLessThanOrEqual(12);
    expect(res.postes.total).toBe(20);
    expect(res.postes.non_montres).toBe(8);
  });

  it('la charge utile d\'un outil riche reste de taille raisonnable', async () => {
    const bornes = Array.from({ length: 200 }, (_, i) => ({
      name: `Borne très longuement nommée numéro ${i}`, commune: 'GRAND-QUEVILLY',
      date_saturation: '2026-09-05', couvert: false,
    }));
    mockQuery.mockImplementation((sql) => (/FROM cav c JOIN pred/.test(String(sql))
      ? Promise.resolve({ rows: bornes })
      : Promise.resolve({ rows: [] })));
    const brut = await executeTool('saturation_cav', {}, ctx('ADMIN'));
    // 200 bornes non tronquées feraient plusieurs dizaines de milliers de
    // caractères injectés dans une conversation bornée à 10 tours.
    expect(brut.length).toBeLessThan(2000);
    expect(JSON.parse(brut).nb_bornes_menacees).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. « JAMAIS DE VALEUR INVENTÉE » — l'absence est dite, pas convertie en zéro
// ═══════════════════════════════════════════════════════════════════════════
describe('doctrine — une donnée absente n\'est jamais un zéro', () => {
  it('resume_energie_ges : aucun relevé → « non mesuré », pas « 0 tCO2e »', async () => {
    jest.spyOn(require('../../src/routes/energie'), 'computeAnnualGes').mockResolvedValue({
      annee: 2026, energie: [], carburant: [], totaux: { tco2e_energie: 0, tco2e_carburant: 0, tco2e_total: 0 },
    });
    jest.spyOn(require('../../src/routes/energie'), 'resolveCA').mockResolvedValue({ ca: null, source: null });
    const res = await json('resume_energie_ges', { annee: 2026 }, 'QHSE');
    expect(res.mesure).toBe(false);
    expect(res.tco2e).toBeNull();
    expect(res.note_mesure).toMatch(/pas mesuré/i);
    expect(res.ca_reference.source).toBe('indisponible');
    require('../../src/routes/energie').computeAnnualGes.mockRestore();
    require('../../src/routes/energie').resolveCA.mockRestore();
  });

  it('resume_effectifs_etp : convention non paramétrée → écart null et motif', async () => {
    mockQuery.mockImplementation((sql) => (/FROM etp_asp_mensuel/.test(String(sql))
      ? Promise.resolve({ rows: [{ mois: 3, etp_asp: 24.5, valide_le: '2026-04-02' }] })
      : Promise.resolve({ rows: [] })));
    const res = await json('resume_effectifs_etp', { annee: 2026 }, 'RH');
    expect(res.convention.etp_conventionnes).toBeNull();
    expect(res.convention.note).toMatch(/aucune convention/i);
    expect(res.mois_retenu.etp_asp).toBe(24.5);
    expect(res.mois_retenu.ecart_convention).toBeNull(); // jamais 0
  });

  it('resume_vak_live : aucune VAK aujourd\'hui → le dit, sans compteurs à zéro', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json('resume_vak_live', {}, 'MANAGER');
    expect(res.vak_en_cours).toBe(false);
    expect(res.depuis_le_debut).toBeUndefined();
    expect(res.note).toMatch(/aucune vente au kilo/i);
  });

  it('etat_purges_rgpd : journal illisible → l\'incertitude est dite', async () => {
    mockQuery.mockImplementation((sql) => (/FROM job_runs/.test(String(sql))
      ? Promise.reject(Object.assign(new Error('relation "job_runs" does not exist'), { code: '42P01' }))
      : Promise.resolve({ rows: [] })));
    const res = await json('etat_purges_rgpd', {}, 'DPO');
    expect(res.journal_disponible).toBe(false);
    expect(res.note).toMatch(/ne vaut donc PAS constat/i);
    expect(res.nb_purges).toBeGreaterThan(0);
  });

  it('arrets_gps_tournee : tournée inexistante → dit non trouvée, n\'invente pas 0 arrêt', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json('arrets_gps_tournee', { tour_id: 999 }, 'ADMIN');
    expect(res.trouve).toBe(false);
    expect(res.nb_hors_programme).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LECTURE SEULE — structurellement, pas par confiance
// ═══════════════════════════════════════════════════════════════════════════
describe('lecture seule — aucun outil n\'émet d\'écriture', () => {
  it('les 12 nouveaux outils n\'exécutent que des SELECT', async () => {
    const sqls = [];
    mockQuery.mockImplementation((sql) => { sqls.push(String(sql)); return Promise.resolve({ rows: [] }); });
    for (const d of botTools.DEFINITIONS) {
      await executeTool(d.name, { tour_id: 1, campagne_id: 1 }, ctx('ADMIN'));
    }
    expect(sqls.length).toBeGreaterThan(0);
    const ecritures = sqls.filter((s) => /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(s));
    expect(ecritures).toEqual([]);
  });

  it('echeances_commandes_recurrentes appelle le moteur en SIMULATION (aucune transaction)', async () => {
    const moteur = require('../../src/services/commandes-recurrence');
    const spy = jest.spyOn(moteur, 'genererCommandesRecurrentes')
      .mockResolvedValue({ ok: true, horizon_jours: 30, generees: [], preparations: [], ignorees: [], simulation: true });
    await json('echeances_commandes_recurrentes', {}, 'MANAGER');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ simulation: true }));
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LE FILET PII, ÉPROUVÉ DANS LA BOUCLE RÉELLE
// ───────────────────────────────────────────────────────────────────────────
// Aucun outil livré ne renvoie de champ nominatif — c'est précisément la règle.
// Le filet `sanitizeToolResult` existe pour le jour où l'un d'eux le ferait, et
// il n'avait donc JAMAIS rien intercepté en conditions réelles. On simule ici
// cette fuite au niveau de la BASE (une requête qui rapporte une colonne
// nominative) et on regarde ce qui part effectivement vers le modèle.
// ═══════════════════════════════════════════════════════════════════════════
describe('filet PII — ce qui part vers le modèle est assaini', () => {
  const TOKEN = jwt.sign(
    { id: 1, userId: 1, username: 'admin', role: 'ADMIN', mfa: true },
    process.env.JWT_SECRET, { expiresIn: '1h' });

  it('un champ nominatif renvoyé par un outil est masqué avant l\'envoi', async () => {
    // La requête de planning rapporte, par accident, des colonnes nominatives.
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees WHERE user_id/.test(s)) return Promise.resolve({ rows: [{ id: 42 }] });
      if (/FROM schedule/.test(s)) {
        return Promise.resolve({
          rows: [{
            date: '2026-08-31', status: 'planned', poste_code: 'TRI',
            first_name: 'Karim', last_name: 'Benali',
            email: 'karim.benali@example.org', phone: '0612345678',
            matricule: 'M-0042', birth_date: '1988-05-14',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    mockCreate
      .mockResolvedValueOnce({ content: [{ type: 'tool_use', id: 'tu_1', name: 'query_planning', input: {} }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Voici le planning 📅' }] });

    const res = await request(app).post('/api/chat')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ message: 'Mon planning ?', session_id: 'test-pii-1' });
    expect(res.status).toBe(200);

    // Ce que le SECOND appel au modèle transporte : le résultat de l'outil.
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const charge = chargeOutil(mockCreate.mock.calls[1][0].messages);
    expect(charge).toEqual(expect.any(String));

    // Le patronyme réel n'atteint pas le modèle ; il est remplacé par un jeton.
    expect(charge).not.toContain('Karim');
    expect(charge).not.toContain('Benali');
    expect(charge).toMatch(/Salari|Personne/i);
    // Contacts et identifiants directs : masqués.
    expect(charge).not.toContain('karim.benali@example.org');
    expect(charge).not.toContain('0612345678');
    expect(charge).not.toContain('M-0042');
    expect(charge).toContain('[masqué]');
    // Date de naissance : remplacée par une tranche d'âge, jamais la date.
    expect(charge).not.toContain('1988-05-14');

    // Ce qui n'est PAS personnel traverse intact : le filet cible des clés
    // précises, il ne mutile pas la donnée métier.
    expect(charge).toContain('TRI');
    expect(charge).toContain('2026-08-31');
  });

  it('un nom de BORNE ou de commune n\'est pas confondu avec un nom de personne', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM cav /.test(s) && /COUNT/.test(s)) return Promise.resolve({ rows: [{ count: '1' }] });
      if (/FROM cav /.test(s)) {
        return Promise.resolve({
          rows: [{ name: 'CAUDEBEC-LÈS-ELBEUF - 67 Rue de Strasbourg', address: '67 Rue de Strasbourg', commune: 'CAUDEBEC-LÈS-ELBEUF', status: 'active', nb_containers: 2, taux_remplissage: 45 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    mockCreate
      .mockResolvedValueOnce({ content: [{ type: 'tool_use', id: 'tu_2', name: 'query_cav', input: {} }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Voici les bornes 📍' }] });

    const res = await request(app).post('/api/chat')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ message: 'Les CAV de Caudebec ?', session_id: 'test-pii-2' });
    expect(res.status).toBe(200);

    const charge = chargeOutil(mockCreate.mock.calls[1][0].messages);
    expect(charge).toContain('67 Rue de Strasbourg');
    expect(charge).toContain('CAUDEBEC-LÈS-ELBEUF');
  });

  it('AUCUN outil livré ne déclare de champ nominatif en sortie (l\'état sûr par défaut)', async () => {
    // Contrôle de non-régression : on exécute chaque nouvel outil sur une base
    // qui répondrait des colonnes nominatives, et on vérifie qu'aucune ne
    // ressort — parce qu'aucun handler ne les sélectionne.
    mockQuery.mockResolvedValue({
      rows: [{
        first_name: 'Karim', last_name: 'Benali', email: 'x@y.z',
        pilote_nom: 'Claire Renaud', asp_valide_par: 'Paul Marchand',
      }],
    });
    for (const d of botTools.DEFINITIONS) {
      const brut = await executeTool(d.name, { tour_id: 1 }, ctx('ADMIN', 1));
      expect(brut).not.toContain('Benali');
      expect(brut).not.toContain('pilote_nom');
      expect(brut).not.toContain('asp_valide_par');
    }
  });
});
