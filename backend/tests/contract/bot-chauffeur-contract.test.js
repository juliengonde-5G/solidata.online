// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — le PÉRIMÈTRE DU CHAUFFEUR dans le SolidataBot
// ───────────────────────────────────────────────────────────────────────────
// ARBITRAGE CLIENT (août 2026) : « Le module chauffeur autorise l'accès à des
// informations sur la collecte, sur la circulation, sur la navigation
// exclusivement. »
//
// CE QUE CES TESTS VERROUILLENT
//
//   • LA LISTE BLANCHE, dans les deux sens : la liste envoyée au modèle ne
//     contient QUE les trois outils du chauffeur, et les outils du chauffeur ne
//     sont proposés à personne d'autre.
//
//   • LA REVÉRIFICATION À L'EXÉCUTION, outil par outil : chaque outil hors
//     périmètre est refusé même invoqué directement — et le refus a lieu AVANT
//     toute requête. Un refus qui aurait déjà lu la base serait un refus
//     d'affichage, pas un refus d'accès.
//
//   • LE PÉRIMÈTRE VÉHICULE : la tournée lue est celle du véhicule DU JETON.
//     Aucun outil n'offre de paramètre permettant d'en désigner un autre, et un
//     paramètre inventé par le modèle ne change rien à la requête émise.
//
//   • LES JETONS HÉRITÉS : un jeton émis avant le claim `vehicle_id` n'encode
//     le véhicule que dans « driver_<id> », et reste valide 8 h. Il doit être
//     reconnu comme chauffeur, sans quoi la fermeture serait contournable en
//     attendant l'expiration.
//
//   • L'HONNÊTETÉ : pas de tournée ≠ tournée vide ; trafic indisponible ≠ route
//     dégagée ; itinéraire injoignable ≠ zéro kilomètre.
//
//   • LE TON : c'est bien le prompt du chauffeur qui part vers le modèle.
//
//   • LA NON-RÉGRESSION : un COLLABORATEUR ordinaire (sans véhicule) et les
//     rôles de pilotage ne perdent rien.
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
const botChauffeur = require('../../src/services/bot-chauffeur');
const { toolsForRole, EXTENDED_TOOL_ROLES, executeTool, estSessionChauffeur, systemPromptFor } = chat;
const activeSummary = require('../../src/routes/tours/active-summary');

const CHAUFFEUR_OUTILS = botChauffeur.CHAUFFEUR_TOOL_NAMES;
const TOUS_LES_ROLES = ['ADMIN', 'MANAGER', 'RH', 'QHSE', 'DPO', 'FINANCE', 'RESP_BTQ', 'AUTORITE', 'COLLABORATEUR'];

/** Tous les outils que le bot sait exécuter, hors périmètre chauffeur. */
const OUTILS_HORS_PERIMETRE = [
  ...toolsForRole('ADMIN').map((t) => t.name),
].filter((n) => !CHAUFFEUR_OUTILS.includes(n));

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
  activeSummary.resetTraceMemo();
});

/** Session chauffeur récente : le véhicule est un claim explicite du jeton. */
const ctxChauffeur = (vehicleId = 12) => ({
  role: 'COLLABORATEUR', userId: 9, username: 'chauffeur', vehicle_id: vehicleId,
});
/** Session chauffeur HÉRITÉE : le véhicule n'est que dans le nom de compte. */
const ctxChauffeurHerite = (vehicleId = 12) => ({
  role: 'COLLABORATEUR', userId: 9, username: `driver_${vehicleId}`,
});
/** Session de bureau ordinaire. */
const ctx = (role, userId = 1) => ({ role, userId, username: 'u' });

const json = async (nom, entree, contexte) => JSON.parse(await executeTool(nom, entree || {}, contexte));

/** Requêtes réellement émises, espaces normalisés (le SQL est indenté). */
const appels = () => mockQuery.mock.calls.map(([sql, params]) => ({
  sql: String(sql).replace(/\s+/g, ' '), params: params || [],
}));
/** Le premier appel dont le SQL correspond. */
const appelSur = (motif) => appels().find((a) => motif.test(a.sql));

/** Le message d'outil réellement transmis au modèle (cf. bot-outils-contract). */
function chargeOutil(messages) {
  const m = messages.find((x) => Array.isArray(x.content)
    && x.content[0] && x.content[0].type === 'tool_result');
  return m ? m.content[0].content : null;
}

/** Réponses de base : un véhicule, une tournée de bornes, trois points. */
function brancherTourneeSimple({ tourId = 77, vehicleId = 12, pesees = 815 } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM tours t JOIN vehicles v/.test(s)) {
      return Promise.resolve({
        rows: [{
          id: tourId, vehicle_id: vehicleId, status: 'in_progress',
          collection_type: 'cav', registration: 'AB-123-CD', vehicle_name: 'Camion 1',
          started_at: '2026-08-30T07:49:00Z', nb_cav: '3',
        }],
      });
    }
    if (/FROM tour_cav tc JOIN cav c/.test(s)) {
      return Promise.resolve({
        rows: [
          { position: 1, status: 'collected', nom: 'ROUEN - Rue Jeanne d\'Arc', commune: 'ROUEN', adresse: 'Rue Jeanne d\'Arc', latitude: 49.44, longitude: 1.09 },
          { position: 2, status: 'pending', nom: 'ELBEUF - Rue du Pont', commune: 'ELBEUF', adresse: 'Rue du Pont', latitude: 49.28, longitude: 1.00 },
          { position: 3, status: 'skipped', nom: 'DARNETAL - Place Mairie', commune: 'DARNETAL', adresse: 'Place Mairie', latitude: 49.44, longitude: 1.15 },
        ],
      });
    }
    if (/SUM\(weight_kg\)/.test(s)) return Promise.resolve({ rows: [{ total_kg: pesees }] });
    return Promise.resolve({ rows: [] });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA LISTE BLANCHE
// ═══════════════════════════════════════════════════════════════════════════
describe('liste blanche — ce que le modèle reçoit pour un chauffeur', () => {
  it('les trois outils du périmètre, et EXACTEMENT ceux-là', () => {
    expect(CHAUFFEUR_OUTILS).toEqual(['ma_tournee', 'trafic_secteur', 'ma_navigation']);
    expect(toolsForRole('COLLABORATEUR', ctxChauffeur()).map((t) => t.name))
      .toEqual(['ma_tournee', 'trafic_secteur', 'ma_navigation']);
  });

  it('un jeton HÉRITÉ (« driver_12 », sans claim vehicle_id) est reconnu de la même façon', () => {
    expect(estSessionChauffeur(ctxChauffeurHerite())).toBe(true);
    expect(toolsForRole('COLLABORATEUR', ctxChauffeurHerite()).map((t) => t.name))
      .toEqual(['ma_tournee', 'trafic_secteur', 'ma_navigation']);
  });

  it.each(OUTILS_HORS_PERIMETRE)('%s : jamais proposé à un chauffeur', (nom) => {
    expect(toolsForRole('COLLABORATEUR', ctxChauffeur()).map((t) => t.name)).not.toContain(nom);
    expect(toolsForRole('ADMIN', ctxChauffeur()).map((t) => t.name)).not.toContain(nom);
  });

  it('ni stock, ni planning, ni heures, ni plan de chaîne, ni pointages', () => {
    const n = toolsForRole('COLLABORATEUR', ctxChauffeur()).map((t) => t.name);
    for (const retire of ['query_stock', 'query_planning', 'query_heures', 'query_cav',
      'query_collecte', 'layout_chaine_actif', 'mes_pointages_badgeuse']) {
      expect(n).not.toContain(retire);
    }
  });

  it('aucun outil de PILOTAGE ne lui est ouvert, quel que soit le rôle porté par son jeton', () => {
    for (const role of TOUS_LES_ROLES) {
      const n = toolsForRole(role, ctxChauffeur()).map((t) => t.name);
      for (const reserve of Object.keys(EXTENDED_TOOL_ROLES)) expect(n).not.toContain(reserve);
    }
  });

  it.each(CHAUFFEUR_OUTILS)('%s : proposé à personne d\'autre qu\'un chauffeur', (nom) => {
    for (const role of TOUS_LES_ROLES) {
      expect(toolsForRole(role).map((t) => t.name)).not.toContain(nom);
      expect(toolsForRole(role, ctx(role)).map((t) => t.name)).not.toContain(nom);
    }
  });

  it.each(CHAUFFEUR_OUTILS)('%s : n\'offre AUCUN paramètre au modèle', (nom) => {
    const outil = botChauffeur.CHAUFFEUR_TOOLS.find((t) => t.name === nom);
    // La question « la tournée de QUI ? » ne peut pas être posée : il n'y a
    // aucun champ pour la poser, donc rien à refuser et rien à énumérer.
    expect(Object.keys(outil.input_schema.properties)).toEqual([]);
    expect(outil.input_schema.required).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LA REVÉRIFICATION À L'EXÉCUTION
// ═══════════════════════════════════════════════════════════════════════════
describe('revérification à l\'exécution — le contrôle qui tient', () => {
  it.each(OUTILS_HORS_PERIMETRE)(
    '%s : REFUSÉ à un chauffeur même invoqué directement, sans lire la base',
    async (nom) => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await json(nom, { employee_id: 1, tour_id: 1, campagne_id: 1 }, ctxChauffeur());
      expect(res.error).toBeTruthy();
      // Un refus qui aurait déjà lu la donnée serait un refus d'affichage.
      expect(mockQuery).not.toHaveBeenCalled();
    });

  it('le refus est compréhensible et dit quoi faire, il ne plante pas', async () => {
    const res = await json('query_stock', {}, ctxChauffeur());
    expect(res.error).toMatch(/ne peux pas répondre/i);
    expect(res.perimetre).toEqual(['la collecte', 'la circulation', 'la navigation']);
    expect(String(res.a_dire)).toMatch(/gestionnaire/i);
  });

  it('le refus vaut aussi pour le jeton HÉRITÉ', async () => {
    mockQuery.mockReset();
    const res = await json('mes_pointages_badgeuse', {}, ctxChauffeurHerite());
    expect(res.error).toMatch(/ne peux pas répondre/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(CHAUFFEUR_OUTILS)(
    '%s : refusé hors session chauffeur (un ADMIN n\'a pas de véhicule)',
    async (nom) => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await json(nom, {}, ctx('ADMIN'));
      expect(res.error).toMatch(/application du véhicule/i);
      expect(mockQuery).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LE PÉRIMÈTRE VÉHICULE
// ═══════════════════════════════════════════════════════════════════════════
describe('périmètre véhicule — sa tournée, et seulement la sienne', () => {
  it('ma_tournee interroge la tournée du VÉHICULE DU JETON', async () => {
    brancherTourneeSimple({ vehicleId: 12 });
    const res = await json('ma_tournee', {}, ctxChauffeur(12));
    expect(res.tournee.numero).toBe(77);
    const appel = appelSur(/FROM tours t JOIN vehicles v/);
    expect(appel).toBeDefined();
    // Le véhicule interrogé est celui du jeton, jamais un autre.
    expect(appel.params).toEqual([12]);
  });

  it('un véhicule glissé dans les paramètres par le modèle N\'A AUCUN EFFET', async () => {
    brancherTourneeSimple({ vehicleId: 12 });
    // Le modèle invente des paramètres que le schéma n'expose pas.
    await json('ma_tournee', { vehicle_id: 99, tour_id: 4242, employee_id: 7 }, ctxChauffeur(12));
    const params = appels().map((a) => JSON.stringify(a.params)).join('|');
    expect(params).not.toContain('99');
    expect(params).not.toContain('4242');
    expect(appelSur(/FROM tours t JOIN vehicles v/).params).toEqual([12]);
  });

  it('deux chauffeurs différents ne lisent pas la même tournée', async () => {
    brancherTourneeSimple({ vehicleId: 12 });
    await json('ma_tournee', {}, ctxChauffeur(12));
    const a = appelSur(/FROM tours t JOIN vehicles v/).params;
    mockQuery.mockClear();
    await json('ma_tournee', {}, ctxChauffeur(31));
    const b = appelSur(/FROM tours t JOIN vehicles v/).params;
    expect(a).toEqual([12]);
    expect(b).toEqual([31]);
  });

  it('trafic_secteur ne consulte que la position de SON véhicule', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/FROM gps_positions/.test(s)) {
        expect(params[0]).toBe(12);
        return Promise.resolve({ rows: [{ latitude: 49.42, longitude: 1.10 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await json('trafic_secteur', {}, ctxChauffeur(12));
    expect(res.secteur).toBe('position actuelle du véhicule');
    const gps = mockQuery.mock.calls.filter(([sql]) => /FROM gps_positions/.test(String(sql)));
    expect(gps).toHaveLength(1);
    expect(gps[0][1][0]).toBe(12);
  });

  it('ma_navigation part de la tournée du jour de SON véhicule', async () => {
    brancherTourneeSimple({ tourId: 77, vehicleId: 12 });
    await json('ma_navigation', { tour_id: 5150 }, ctxChauffeur(12));
    expect(appelSur(/FROM tours t JOIN vehicles v/).params).toEqual([12]);
    // Et l'itinéraire est calculé sur CETTE tournée, pas sur celle du paramètre.
    expect(appels().map((a) => JSON.stringify(a.params)).join('|')).not.toContain('5150');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. L'HONNÊTETÉ — jamais de valeur inventée
// ═══════════════════════════════════════════════════════════════════════════
describe('jamais de valeur inventée', () => {
  it('aucune tournée aujourd\'hui → la note le dit, aucun compteur à zéro', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json('ma_tournee', {}, ctxChauffeur());
    expect(res.tournee).toBeNull();
    expect(res.note).toMatch(/aucune tournée/i);
    expect(res.points).toBeUndefined();
    expect(res.tonnage_collecte_kg).toBeUndefined();
  });

  it('aucune pesée → 0 kg DIT comme une absence de pesée, pas comme un camion vide', async () => {
    brancherTourneeSimple({ pesees: 0 });
    const res = await json('ma_tournee', {}, ctxChauffeur());
    expect(res.tonnage_collecte_kg).toBe(0);
    expect(res.note_tonnage).toMatch(/aucune pesée/i);
  });

  it('compteurs de points justes (collectés / non collectés / restants)', async () => {
    brancherTourneeSimple();
    const res = await json('ma_tournee', {}, ctxChauffeur());
    expect(res.points).toEqual({ total: 3, collectes: 1, non_collectes: 1, restants: 1 });
    expect(res.prochain_point.commune).toBe('ELBEUF');
    expect(res.tournee.statut).toBe('en cours');
  });

  it('trafic indisponible → le MOTIF de la source, jamais « aucun incident »', async () => {
    const traffic = require('../../src/services/traffic');
    const espion = jest.spyOn(traffic, 'getTrafficIncidents').mockResolvedValue({
      disponible: false,
      message: 'Les événements de circulation ne sont pas configurés.',
      configuration_requise: true,
    });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json('trafic_secteur', {}, ctxChauffeur());
    expect(res.disponible).toBe(false);
    expect(res.note).toMatch(/ne sont pas configurés/);
    expect(res.nombre).toBeUndefined();
    expect(res.evenements).toBeUndefined();
    espion.mockRestore();
  });

  it('secteur en cascade honnête : sans position GPS, on retombe sur le centre de tri et on le DIT', async () => {
    const traffic = require('../../src/services/traffic');
    const espion = jest.spyOn(traffic, 'getTrafficIncidents')
      .mockResolvedValue({ disponible: true, source: 'tomtom', incidents: [] });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json('trafic_secteur', {}, ctxChauffeur());
    expect(res.secteur).toBe('centre de tri');
    expect(res.nombre).toBe(0);
    expect(res.note).toMatch(/aucun événement/i);
    espion.mockRestore();
  });

  it('trafic : les plus gênants d\'abord, et ce qui n\'est pas montré est annoncé', async () => {
    const traffic = require('../../src/services/traffic');
    const incidents = Array.from({ length: 9 }, (_, i) => ({
      label: `Incident ${i}`, description: `desc ${i}`, gravite: i, retard_sec: 60 * i,
    }));
    const espion = jest.spyOn(traffic, 'getTrafficIncidents')
      .mockResolvedValue({ disponible: true, source: 'tomtom', incidents });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await json('trafic_secteur', {}, ctxChauffeur());
    expect(res.nombre).toBe(9);
    expect(res.evenements).toHaveLength(botChauffeur.MAX_DETAIL);
    expect(res.evenements[0].type).toBe('Incident 8');
    expect(res.evenements[0].retard_min).toBe(8);
    expect(res.non_detailles).toBe(4);
    espion.mockRestore();
  });

  it('emprise de secteur : bornée, et acceptée par le contrôle de la source', () => {
    const { parseBbox } = require('../../src/services/traffic');
    const z = botChauffeur.empriseAutour(49.4231, 1.0993);
    expect(parseBbox(`${z.sud},${z.ouest},${z.nord},${z.est}`)).not.toBeNull();
    // Rayon de l'ordre annoncé, jamais « le monde entier ».
    expect(z.nord - z.sud).toBeCloseTo((2 * botChauffeur.RAYON_SECTEUR_KM) / 111, 2);
  });

  it('itinéraire injoignable → distance et durée à null, jamais zéro', async () => {
    brancherTourneeSimple();
    const espion = jest.spyOn(activeSummary, 'itineraireChauffeur').mockResolvedValue({
      tour_id: 77, geometry: null, distance_restante_km: null,
      duree_restante_min: null, source: 'indisponible', nb_points: 1, tronque: false,
    });
    const res = await json('ma_navigation', {}, ctxChauffeur());
    expect(res.itineraire.disponible).toBe(false);
    expect(res.itineraire.distance_restante_km).toBeNull();
    expect(res.itineraire.duree_restante_min).toBeNull();
    expect(res.itineraire.note).toMatch(/n'a pas répondu/i);
    espion.mockRestore();
  });

  it('itinéraire disponible → distance, durée, prochain point… et JAMAIS la géométrie', async () => {
    brancherTourneeSimple();
    const espion = jest.spyOn(activeSummary, 'itineraireChauffeur').mockResolvedValue({
      tour_id: 77, geometry: [[49.4, 1.0], [49.5, 1.1], [49.6, 1.2]],
      distance_restante_km: 23.4, duree_restante_min: 41,
      source: 'routier', nb_points: 1, tronque: false,
    });
    const res = await json('ma_navigation', {}, ctxChauffeur());
    expect(res.itineraire.distance_restante_km).toBe(23.4);
    expect(res.itineraire.duree_restante_min).toBe(41);
    expect(res.prochain_point.commune).toBe('ELBEUF');
    // La polyligne ne part JAMAIS vers le modèle : elle ne lui sert à rien et
    // consommerait la conversation.
    expect(JSON.stringify(res)).not.toContain('geometry');
    expect(JSON.stringify(res)).not.toContain('49.5');
    espion.mockRestore();
  });

  it('tous les points faits → « il ne reste que le retour au centre », pas 0 km', async () => {
    brancherTourneeSimple();
    const espion = jest.spyOn(activeSummary, 'itineraireChauffeur').mockResolvedValue({
      tour_id: 77, geometry: null, distance_restante_km: null, duree_restante_min: null,
      source: 'aucun_point_restant', nb_points: 0, tronque: false,
    });
    const res = await json('ma_navigation', {}, ctxChauffeur());
    expect(res.itineraire).toEqual({ termine: true });
    expect(res.note).toMatch(/retour au centre/i);
    espion.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LECTURE SEULE ET ABSENCE DE DONNÉE PERSONNELLE
// ═══════════════════════════════════════════════════════════════════════════
describe('lecture seule, et rien de nominatif', () => {
  it.each(CHAUFFEUR_OUTILS)('%s : n\'émet aucune écriture SQL', async (nom) => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    await executeTool(nom, {}, ctxChauffeur());
    for (const [sql] of mockQuery.mock.calls) {
      expect(String(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    }
  });

  it.each(CHAUFFEUR_OUTILS)('%s : ne ressort aucun champ nominatif, même si la base en renvoie', async (nom) => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({
      rows: [{
        id: 1, first_name: 'Karim', last_name: 'Benali', email: 'x@y.z',
        driver_name: 'Karim Benali', matricule: 'M-0042', latitude: 49.4, longitude: 1.1,
      }],
    });
    const res = await json(nom, {}, ctxChauffeur());
    const texte = JSON.stringify(res);
    expect(texte).not.toContain('Karim');
    expect(texte).not.toContain('Benali');
    expect(texte).not.toContain('M-0042');
    expect(texte).not.toContain('x@y.z');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LE TON — le prompt réellement envoyé
// ═══════════════════════════════════════════════════════════════════════════
describe('le registre du chauffeur', () => {
  const TOKEN_CHAUFFEUR = jwt.sign(
    { id: 9, userId: 9, username: 'chauffeur', role: 'COLLABORATEUR', vehicle_id: 12 },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  const TOKEN_ADMIN = jwt.sign(
    { id: 1, userId: 1, username: 'admin', role: 'ADMIN', mfa: true },
    process.env.JWT_SECRET, { expiresIn: '1h' });

  it('le prompt du chauffeur nomme son périmètre et interdit le hors-périmètre', () => {
    const p = botChauffeur.SYSTEM_PROMPT_CHAUFFEUR;
    expect(p).toMatch(/COLLECTE/);
    expect(p).toMatch(/CIRCULATION/);
    expect(p).toMatch(/NAVIGATION/);
    expect(p).toMatch(/gestionnaire/i);
    expect(p).toMatch(/jamais de mémoire|JAMAIS de mémoire/);
    // Langage simple : le registre de pilotage est explicitement écarté.
    expect(p).toMatch(/phrases courtes/i);
    expect(p).toMatch(/KPI/); // …cité pour être interdit
  });

  it('c\'est bien LE PROMPT DU CHAUFFEUR qui part vers le modèle', async () => {
    brancherTourneeSimple();
    mockCreate
      .mockResolvedValueOnce({ content: [{ type: 'tool_use', id: 'tu_1', name: 'ma_tournee', input: {} }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Il te reste 1 point. 🚛' }] });

    const res = await request(app).post('/api/chat')
      .set('Authorization', `Bearer ${TOKEN_CHAUFFEUR}`)
      .send({ message: 'Où en est ma tournée ?', session_id: 'chauffeur-1' });
    expect(res.status).toBe(200);

    const envoi = mockCreate.mock.calls[0][0];
    expect(envoi.system).toBe(botChauffeur.SYSTEM_PROMPT_CHAUFFEUR);
    // Et la liste d'outils envoyée est bien la liste blanche.
    expect(envoi.tools.map((t) => t.name)).toEqual(['ma_tournee', 'trafic_secteur', 'ma_navigation']);
    // Ce qui remonte au modèle est bien la tournée de SON véhicule.
    const charge = chargeOutil(mockCreate.mock.calls[1][0].messages);
    expect(charge).toContain('AB-123-CD');
  });

  it('un jeton HÉRITÉ passe par le même chemin (prompt et liste blanche)', async () => {
    const herite = jwt.sign(
      { id: 9, userId: 9, username: 'driver_12', role: 'COLLABORATEUR' },
      process.env.JWT_SECRET, { expiresIn: '1h' });
    brancherTourneeSimple();
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Ok 🚛' }] });
    const res = await request(app).post('/api/chat')
      .set('Authorization', `Bearer ${herite}`)
      .send({ message: 'Salut', session_id: 'chauffeur-herite' });
    expect(res.status).toBe(200);
    expect(mockCreate.mock.calls[0][0].system).toBe(botChauffeur.SYSTEM_PROMPT_CHAUFFEUR);
    expect(mockCreate.mock.calls[0][0].tools.map((t) => t.name))
      .toEqual(['ma_tournee', 'trafic_secteur', 'ma_navigation']);
  });

  it('un gestionnaire garde le prompt et les outils du bureau', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Bonjour 👋' }] });
    const res = await request(app).post('/api/chat')
      .set('Authorization', `Bearer ${TOKEN_ADMIN}`)
      .send({ message: 'Bonjour', session_id: 'admin-1' });
    expect(res.status).toBe(200);
    const envoi = mockCreate.mock.calls[0][0];
    expect(envoi.system).not.toBe(botChauffeur.SYSTEM_PROMPT_CHAUFFEUR);
    expect(envoi.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['query_stock', 'resume_finance']));
  });

  it('systemPromptFor : chauffeur ↔ bureau, sans ambiguïté', () => {
    expect(systemPromptFor(ctxChauffeur())).toBe(botChauffeur.SYSTEM_PROMPT_CHAUFFEUR);
    expect(systemPromptFor(ctxChauffeurHerite())).toBe(botChauffeur.SYSTEM_PROMPT_CHAUFFEUR);
    expect(systemPromptFor(ctx('ADMIN'))).not.toBe(botChauffeur.SYSTEM_PROMPT_CHAUFFEUR);
    expect(systemPromptFor(null)).not.toBe(botChauffeur.SYSTEM_PROMPT_CHAUFFEUR);
  });

  it('les suggestions du chauffeur restent DANS son périmètre', async () => {
    const r = await request(app).get('/api/chat/suggestions')
      .set('Authorization', `Bearer ${TOKEN_CHAUFFEUR}`);
    expect(r.status).toBe(200);
    const cats = r.body.suggestions.map((s) => s.category);
    expect(cats.every((c) => ['collecte', 'circulation', 'navigation'].includes(c))).toBe(true);
    const textes = r.body.suggestions.map((s) => s.text).join(' ').toLowerCase();
    // Proposer une question à laquelle on vient de retirer l'outil, ce serait
    // fabriquer un refus.
    expect(textes).not.toMatch(/stock|planning|heures|pointage/);
  });

  it('les suggestions d\'un gestionnaire ne changent pas', async () => {
    const r = await request(app).get('/api/chat/suggestions')
      .set('Authorization', `Bearer ${TOKEN_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.suggestions.map((s) => s.category))
      .toEqual(expect.arrayContaining(['finance', 'insertion', 'ventes']));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. NON-RÉGRESSION — personne d'autre ne perd rien
// ═══════════════════════════════════════════════════════════════════════════
describe('non-régression hors périmètre chauffeur', () => {
  it('un COLLABORATEUR ORDINAIRE (sans véhicule) garde exactement ses outils de base', () => {
    const n = toolsForRole('COLLABORATEUR', ctx('COLLABORATEUR')).map((t) => t.name);
    expect(n).toEqual(toolsForRole('COLLABORATEUR').map((t) => t.name));
    expect(n).toEqual(expect.arrayContaining([
      'query_stock', 'query_planning', 'query_collecte', 'query_heures', 'query_cav',
      'layout_chaine_actif', 'mes_pointages_badgeuse']));
    expect(estSessionChauffeur(ctx('COLLABORATEUR'))).toBe(false);
  });

  it('un nom de compte qui ressemble à un chauffeur SANS l\'être n\'ouvre rien', () => {
    // « driverX », « driver_ », « driver_abc » ne sont pas des sessions véhicule.
    for (const username of ['driverX', 'driver_', 'driver_abc', 'chauffeur', 'admin']) {
      expect(estSessionChauffeur({ role: 'COLLABORATEUR', username })).toBe(false);
    }
  });

  it('ADMIN et MANAGER conservent l\'intégralité de leurs outils', () => {
    const admin = toolsForRole('ADMIN').map((t) => t.name);
    expect(admin).toEqual(toolsForRole('ADMIN', ctx('ADMIN')).map((t) => t.name));
    for (const reserve of Object.keys(EXTENDED_TOOL_ROLES)) expect(admin).toContain(reserve);
    const manager = toolsForRole('MANAGER', ctx('MANAGER')).map((t) => t.name);
    expect(manager).toEqual(expect.arrayContaining(['resume_finance', 'kpis_insertion', 'ventes_synthese']));
  });

  it('les outils réservés restent exécutables par les rôles habilités', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    for (const nom of botTools.BOT_EXTENDED_TOOLS.map((t) => t.name)) {
      const role = EXTENDED_TOOL_ROLES[nom][0];
      const res = await json(nom, { tour_id: 1 }, ctx(role));
      expect(String(res.error || '')).not.toMatch(/n'as pas accès|application du véhicule/i);
    }
  });
});
