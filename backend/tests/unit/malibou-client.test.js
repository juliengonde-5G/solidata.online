/**
 * Client Malibou — la pagination et la temporisation, éprouvées contre un faux
 * serveur qui se comporte comme le vrai.
 *
 * POURQUOI CES TESTS EXISTENT : la pagination de Malibou n'a pas de curseur.
 * Chaque réponse de liste déclare `total`, `page` et `limit` (obligatoires
 * dans la spécification v1.11.0), et la documentation dit par ailleurs
 * d'incrémenter `page` jusqu'à ce qu'une page rende moins d'éléments que
 * `limit`. La première version du client cherchait un curseur ou un drapeau
 * « page suivante », n'en trouvait pas, et s'arrêtait : elle aurait importé la
 * PREMIÈRE PAGE en annonçant un succès. Un import tronqué qui ressemble à un
 * import complet ne se découvre qu'en comptant les salariés manquants, des
 * mois plus tard.
 *
 * Le faux serveur ci-dessous se comporte donc comme le vrai — enveloppe
 * `{data, total, page, limit}` comprise — et chaque condition d'arrêt est
 * éprouvée séparément, y compris le cas où l'enveloppe ne porterait rien.
 */
const http = require('http');

jest.mock('../../src/config/database', () => ({ query: jest.fn(async () => ({ rows: [] })), end: jest.fn() }));
jest.mock('../../src/config/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const malibou = require('../../src/services/malibou');

/**
 * Faux serveur Malibou : pagination page/limit, enveloppe conforme à la
 * spécification. `enveloppe: false` simule une API qui n'annoncerait plus son
 * total — on veut que le client survive à ce changement.
 * `totalMenteur` annonce un total FAUX, pour éprouver le signalement d'écart.
 */
function fauxMalibou({
  total = 0, exigeBearer = true, limiteDebit = 0, enveloppe = true, totalMenteur = null,
} = {}) {
  let appels = 0;
  let restantesLimite = limiteDebit;
  const serveur = http.createServer((req, rep) => {
    appels += 1;
    const url = new URL(req.url, 'http://x');

    if (exigeBearer && req.headers.authorization !== 'Bearer CLE-TEST') {
      rep.writeHead(401, { 'content-type': 'application/json' });
      return rep.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (restantesLimite > 0) {
      restantesLimite -= 1;
      rep.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
      return rep.end(JSON.stringify({ error: 'too many requests' }));
    }
    if (url.pathname.includes('/meal-vouchers')) {
      rep.writeHead(403, { 'content-type': 'application/json' });
      return rep.end(JSON.stringify({ error: 'forbidden' }));
    }

    const page = Number(url.searchParams.get('page') || 1);
    const limit = Number(url.searchParams.get('limit') || 100);
    if (page < 1 || limit < 1) {
      rep.writeHead(400, { 'content-type': 'application/json' });
      return rep.end(JSON.stringify({ error: 'page and limit must be positive' }));
    }
    const debut = (page - 1) * limit;
    const lot = [];
    for (let i = debut; i < Math.min(debut + limit, total); i += 1) lot.push({ id: `c${i}` });
    const charge = enveloppe
      ? { data: lot, total: totalMenteur === null ? total : totalMenteur, page, limit }
      : { data: lot };
    rep.writeHead(200, { 'content-type': 'application/json' });
    rep.end(JSON.stringify(charge));
  });
  return { serveur, appels: () => appels };
}

function demarrer(s) {
  return new Promise((res) => s.listen(0, '127.0.0.1', () => res(s.address().port)));
}

/**
 * Branche le client sur le faux serveur EN PASSANT PAR LES RÉGLAGES RÉELS.
 *
 * Remplacer `lireConfig` par un mock ne marchait pas — les fonctions internes
 * l'appellent par sa liaison locale, pas par la propriété exportée — et
 * surtout cela aurait court-circuité la lecture de configuration, c'est-à-dire
 * une partie de ce qu'on veut éprouver. On simule donc la BASE, et la vraie
 * cascade de configuration s'exécute.
 */
const db = require('../../src/config/database');

function brancher(port, { org = 'org-42', cle = 'CLE-TEST' } = {}) {
  const reglages = {
    'malibou.api_key': cle,  // en clair : le déchiffrement rend tel quel ce qui n'est pas préfixé
    'malibou.api_base': `http://127.0.0.1:${port}/api/public/v1`,
    'malibou.auth_mode': 'bearer',
    'malibou.organization_id': org,
  };
  db.query.mockImplementation(async (_sql, params) => {
    const v = reglages[params && params[0]];
    return { rows: v == null ? [] : [{ value: v }] };
  });
}

beforeEach(() => {
  // Les variables d'environnement sont des REPLIS dans la cascade : si elles
  // traînaient, un test « sans organisation » passerait sans rien prouver.
  delete process.env.MALIBOU_API_KEY;
  delete process.env.MALIBOU_API_BASE;
  delete process.env.MALIBOU_ORGANIZATION_ID;
});

afterEach(() => jest.restoreAllMocks());

describe('pagination — deux conditions d\'arrêt, et rien de perdu', () => {
  it.each([
    [0, 1],    // rien : une seule page, vide
    [7, 1],    // moins d'une page
    [10, 1],   // page EXACTEMENT pleine, mais le total dit que c'est fini
    [25, 3],
    [56, 6],
  ])('%i collaborateurs → %i appel(s), et tous sont rendus', async (total, appelsAttendus) => {
    const { serveur, appels } = fauxMalibou({ total });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      const lignes = await malibou.listerCollaborateurs({ limit: 10 });
      expect(lignes).toHaveLength(total);
      expect(appels()).toBe(appelsAttendus);
      // Aucun doublon : chaque page a bien décalé son offset.
      expect(new Set(lignes.map((l) => l.id)).size).toBe(total);
    } finally { serveur.close(); }
  });

  it('rend le dernier salarié — celui qu\'une pagination cassée perdrait', async () => {
    const { serveur } = fauxMalibou({ total: 56 });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      const lignes = await malibou.listerCollaborateurs({ limit: 10 });
      expect(lignes.map((l) => l.id)).toContain('c55');
    } finally { serveur.close(); }
  });

  it.each([[10, 2], [25, 3], [56, 6]])(
    'sans enveloppe annoncée, la règle « page incomplète » suffit (%i → %i appels)',
    async (total, appelsAttendus) => {
      // Si Malibou cessait un jour d'annoncer son total, l'import doit rester
      // complet — c'est toute la raison de garder les DEUX conditions d'arrêt.
      const { serveur, appels } = fauxMalibou({ total, enveloppe: false });
      const port = await demarrer(serveur);
      brancher(port);
      try {
        const lignes = await malibou.listerCollaborateurs({ limit: 10 });
        expect(lignes).toHaveLength(total);
        expect(appels()).toBe(appelsAttendus);
      } finally { serveur.close(); }
    },
  );

  it('SIGNALE l\'écart quand le compte ne tombe pas sur le total annoncé', async () => {
    // Le pire défaut d'un import n'est pas d'échouer, c'est de réussir à
    // moitié sans le dire. Ici le serveur annonce 40 et n'en livre que 25.
    const logger = require('../../src/config/logger');
    logger.warn.mockClear();
    const { serveur } = fauxMalibou({ total: 25, totalMenteur: 40 });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      const lignes = await malibou.listerCollaborateurs({ limit: 10 });
      expect(lignes).toHaveLength(25);
      const alerte = logger.warn.mock.calls.find(([msg]) => /total annoncé/.test(msg));
      expect(alerte).toBeDefined();
      expect(alerte[1]).toMatchObject({ recu: 25, annonce: 40 });
    } finally { serveur.close(); }
  });

  it('ne crie pas quand tout concorde', async () => {
    const logger = require('../../src/config/logger');
    logger.warn.mockClear();
    const { serveur } = fauxMalibou({ total: 25 });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      await malibou.listerCollaborateurs({ limit: 10 });
      expect(logger.warn.mock.calls.filter(([m]) => /total annoncé/.test(m))).toHaveLength(0);
    } finally { serveur.close(); }
  });

  it('demande toujours un `page` et un `limit` strictement positifs', async () => {
    const { serveur } = fauxMalibou({ total: 3 });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      // limit:0 serait refusé en 400 par l'API — le client le borne avant.
      await expect(malibou.listerCollaborateurs({ limit: 0 })).resolves.toHaveLength(3);
    } finally { serveur.close(); }
  });
});

describe('chemins scopés à l\'organisation', () => {
  it('refuse clairement quand l\'identifiant d\'organisation manque', async () => {
    brancher(1, { org: null });
    await expect(malibou.listerCollaborateurs()).rejects.toMatchObject({ code: 'MALIBOU_ORG_MANQUANTE' });
  });

  it('place l\'organisation dans le chemin', async () => {
    brancher(1);
    await expect(malibou.cheminOrg('collaborators')).resolves.toBe('organizations/org-42/collaborators');
  });
});

describe('erreurs — un refus doit expliquer ce qu\'il faut faire', () => {
  it('un 403 sur un point d\'accès « Partners only » dit que la clé n\'y peut rien', async () => {
    const { serveur } = fauxMalibou({ total: 1 });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      await expect(malibou.malibouGet('organizations/org-42/meal-vouchers'))
        .rejects.toThrow(/partenaires conventionnés/);
    } finally { serveur.close(); }
  });

  it('une clé refusée rend un code exploitable', async () => {
    const { serveur } = fauxMalibou({ total: 1 });
    const port = await demarrer(serveur);
    brancher(port, { cle: 'MAUVAISE' });
    try {
      await expect(malibou.listerCollaborateurs()).rejects.toMatchObject({ code: 'MALIBOU_AUTH', status: 401 });
    } finally { serveur.close(); }
  });
});

describe('temporisation — la documentation demande un retrait sur 429', () => {
  it('réessaie après un 429 plutôt que de faire échouer tout l\'import', async () => {
    const { serveur, appels } = fauxMalibou({ total: 3, limiteDebit: 2 });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      const lignes = await malibou.listerCollaborateurs({ limit: 10 });
      expect(lignes).toHaveLength(3);
      expect(appels()).toBe(3); // 2 refus temporisés, puis le bon
    } finally { serveur.close(); }
  });

  it('abandonne en le nommant si la limite ne retombe jamais', async () => {
    const { serveur } = fauxMalibou({ total: 3, limiteDebit: 99 });
    const port = await demarrer(serveur);
    brancher(port);
    try {
      await expect(malibou.listerCollaborateurs()).rejects.toMatchObject({ status: 429 });
    } finally { serveur.close(); }
  });
});

describe('lecture seule', () => {
  it('aucune méthode d\'écriture n\'est exposée', () => {
    const noms = Object.keys(malibou).join(' ');
    expect(noms).not.toMatch(/post|put|patch|delete|creer|ecrire/i);
  });
});
