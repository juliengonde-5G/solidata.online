/**
 * Synchronisation Malibou → SOLIDATA.
 *
 * CE QUE CES TESTS PROTÈGENT. Une synchronisation automatique qui écrit dans
 * les dossiers du personnel a deux façons de mal tourner, et la seconde est de
 * loin la pire :
 *
 *  — échouer bruyamment : on le voit, on corrige ;
 *  — réussir à moitié en silence : un salarié désactivé parce qu'une page
 *    n'est pas revenue, une absence rattachée au mauvais matricule, un type
 *    d'absence propre à l'organisation compté comme un congé. Personne ne
 *    s'en aperçoit avant que les ETP déclarés ne tombent faux.
 *
 * Chaque test ci-dessous fige une garde contre la seconde famille.
 */
jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../src/config/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../../src/services/malibou', () => ({
  listerCollaborateurs: jest.fn(),
  lireCollaborateur: jest.fn(),
  listerAbsences: jest.fn(),
}));
jest.mock('../../src/services/collaborator-import', () => ({ upsertCollaborators: jest.fn() }));

const pool = require('../../src/config/database');
const malibou = require('../../src/services/malibou');
const { upsertCollaborators } = require('../../src/services/collaborator-import');
const sync = require('../../src/services/malibou-sync');

/** Client de transaction simulé : enregistre tout ce qui est exécuté. */
function fauxClient({ echecSur = null } = {}) {
  const executes = [];
  const client = {
    executes,
    released: false,
    query: jest.fn(async (sql, params) => {
      executes.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (echecSur && echecSur(sql, params)) {
        const e = new Error('valeur trop longue pour la colonne'); e.code = '22001'; throw e;
      }
      if (/RETURNING \(xmax = 0\)/.test(sql)) return { rows: [{ creee: true }] };
      return { rows: [] };
    }),
    release: jest.fn(function () { this.released = true; }),
  };
  return client;
}

const collaborateur = (n, extra = {}) => ({
  id: `clb_${n}`, status: 'active', personnelNumber: `0000${n}`,
  firstName: 'Alex', lastName: `Nom${n}`, email: `a${n}@ex.fr`,
  currentContract: { id: `ctr_${n}`, startDate: '2026-01-05T00:00:00.000Z', natureContrat: 'fixed_term' },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  upsertCollaborators.mockResolvedValue({ created: [], updated: [], errors: [], warnings: [] });
});

describe('simulation — par défaut, elle ne touche à rien', () => {
  it('lit, convertit, rend le compte rendu, et n\'ouvre AUCUNE transaction', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1), collaborateur(2)]);
    malibou.lireCollaborateur.mockResolvedValue({ ...collaborateur(1), contracts: [] });

    const r = await sync.synchroniserCollaborateurs();

    expect(r.applique).toBe(false);
    expect(r.lus).toBe(2);
    expect(r.convertis).toBe(2);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(upsertCollaborators).not.toHaveBeenCalled();
  });

  it('les absences se comptent aussi sans rien écrire', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([
      { id: 'a1', collaboratorId: 'clb_1', startDate: '2026-03-02', endDate: '2026-03-06', type: 'conge_paye', status: 'approved' },
    ]);
    pool.query.mockResolvedValue({ rows: [{ id: 7, malibou_id: '00001' }] });

    const r = await sync.synchroniserAbsences();

    expect(r.applique).toBe(false);
    expect(r.a_ecrire).toBe(1);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('un salarié absent de la réponse n\'est JAMAIS désactivé', () => {
  it('seuls les salariés VUS sont transmis à l\'upsert', async () => {
    // Le scénario redouté : l'API filtre par établissement, ou une page
    // manque. Désactiver « ceux qu'on n'a pas vus » ferait disparaître des
    // personnes des effectifs sur un incident réseau.
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.lireCollaborateur.mockResolvedValue({ ...collaborateur(1), contracts: [] });
    const client = fauxClient();
    pool.connect.mockResolvedValue(client);

    await sync.synchroniserCollaborateurs({ appliquer: true });

    const [, charge] = upsertCollaborators.mock.calls[0];
    expect(charge).toHaveLength(1);
    expect(charge[0].malibou_id).toBe('00001');
    // Aucune écriture de masse : la transaction ne contient que BEGIN/COMMIT.
    const sqls = client.executes.map((e) => e.sql);
    expect(sqls).toEqual(['BEGIN', 'COMMIT']);
    expect(sqls.join(' ')).not.toMatch(/UPDATE employees SET is_active|DELETE FROM employees/i);
  });

  it('un salarié sans matricule est COMPTÉ, pas apparié au jugé', async () => {
    // Apparier sur le nom créerait un doublon au premier homonyme. On préfère
    // le signaler pour qu'il soit corrigé dans Malibou.
    const liste = [collaborateur(1), collaborateur(2, { personnelNumber: null })];
    malibou.listerCollaborateurs.mockResolvedValue(liste);
    malibou.lireCollaborateur.mockImplementation(
      async (id) => ({ ...liste.find((c) => c.id === id), contracts: [] }),
    );

    const r = await sync.synchroniserCollaborateurs();

    expect(r.lus).toBe(2);
    expect(r.convertis).toBe(1);
    expect(r.sans_matricule).toBe(1);
  });
});

describe('permission manquante — on le dit, on ne collectionne pas les 403', () => {
  it('sonde UNE fiche, et renonce aux contrats en le nommant', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1), collaborateur(2), collaborateur(3)]);
    // Sans le scope, la fiche revient sans tableau `contracts`.
    malibou.lireCollaborateur.mockResolvedValue({ ...collaborateur(1) });

    const r = await sync.synchroniserCollaborateurs();

    expect(malibou.lireCollaborateur).toHaveBeenCalledTimes(1); // et pas 3
    expect(r.avertissements.join(' ')).toMatch(/org:contract:details:read/);
    expect(r.convertis).toBe(3); // les salariés passent quand même
  });

  it('une fiche illisible n\'emporte pas les autres — elle est nommée', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1), collaborateur(2), collaborateur(3)]);
    malibou.lireCollaborateur.mockImplementation(async (id) => {
      if (id === 'clb_2') throw new Error('500 serveur');
      return { ...collaborateur(id.slice(-1)), contracts: [] };
    });

    const r = await sync.synchroniserCollaborateurs();

    expect(r.convertis).toBe(3);
    expect(r.avertissements.join(' ')).toMatch(/00002.*illisible/);
  });
});

describe('absences — le rattachement ne s\'invente pas', () => {
  const absence = (n, extra = {}) => ({
    id: `abs_${n}`, collaboratorId: 'clb_1', startDate: '2026-03-02', endDate: '2026-03-06',
    createdAt: '2026-02-25T08:00:00.000Z', status: 'approved', type: 'conge_paye',
    startHalfDay: false, endHalfDay: false, ...extra,
  });

  it('compte, sans l\'écrire, une absence dont le salarié est inconnu de SOLIDATA', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([absence(1)]);
    pool.query.mockResolvedValue({ rows: [] }); // aucun salarié ne porte ce matricule

    const r = await sync.synchroniserAbsences();

    expect(r.converties).toBe(1);
    expect(r.a_ecrire).toBe(0);
    expect(r.salarie_absent_de_solidata).toBe(1);
    expect(r.avertissements.join(' ')).toMatch(/absent de SOLIDATA/);
  });

  it('compte une absence dont le collaborateur n\'est pas dans la liste Malibou', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([absence(1, { collaboratorId: 'clb_fantome' })]);
    pool.query.mockResolvedValue({ rows: [] });

    const r = await sync.synchroniserAbsences();
    expect(r.sans_salarie_malibou).toBe(1);
    expect(r.a_ecrire).toBe(0);
  });

  it('SIGNALE les types propres à l\'organisation, qui déduisent du réalisé ETP', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([absence(1, { type: 'custom_journee_solidarite' })]);
    pool.query.mockResolvedValue({ rows: [{ id: 7, malibou_id: '00001' }] });

    const r = await sync.synchroniserAbsences();

    expect(r.codes_inconnus).toEqual(['custom_journee_solidarite']);
    expect(r.avertissements.join(' ')).toMatch(/déduisent du réalisé ETP/);
  });

  it('n\'annonce rien quand tous les types sont connus', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([absence(1), absence(2, { type: 'maladie_non_professionnelle', startDate: '2026-04-01' })]);
    pool.query.mockResolvedValue({ rows: [{ id: 7, malibou_id: '00001' }] });

    const r = await sync.synchroniserAbsences();
    expect(r.codes_inconnus).toEqual([]);
    expect(r.avertissements).toEqual([]);
  });

  it('écrit le LIBELLÉ, pas le code — la clé naturelle est partagée avec le classeur', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([absence(1)]);
    pool.query.mockResolvedValue({ rows: [{ id: 7, malibou_id: '00001' }] });
    const client = fauxClient();
    pool.connect.mockResolvedValue(client);

    const r = await sync.synchroniserAbsences({ appliquer: true });

    const insert = client.executes.find((e) => /INSERT INTO employee_leaves/.test(e.sql));
    expect(insert).toBeDefined();
    expect(insert.params[0]).toBe(7);            // identifiant SOLIDATA résolu
    expect(insert.params[1]).toBe('Congés Payés'); // et NON « conge_paye »
    expect(insert.params[2]).toBe('holiday');
    expect(r.crees).toBe(1);
  });

  it('une ligne fautive ne fait pas tomber les suivantes (savepoint par absence)', async () => {
    // C'est le défaut de cascade corrigé en 2.3.1 : sans savepoint, une seule
    // ligne refusée avorte la transaction et emporte tout l'import.
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([
      absence(1, { startDate: '2026-03-02' }),
      absence(2, { startDate: '2026-04-02' }),
      absence(3, { startDate: '2026-05-02' }),
    ]);
    pool.query.mockResolvedValue({ rows: [{ id: 7, malibou_id: '00001' }] });
    const client = fauxClient({
      echecSur: (sql, params) => /INSERT INTO employee_leaves/.test(sql) && params[4] === '2026-04-02',
    });
    pool.connect.mockResolvedValue(client);

    const r = await sync.synchroniserAbsences({ appliquer: true });

    expect(r.crees).toBe(2);
    expect(r.avertissements.join(' ')).toMatch(/abs_2 ignorée/);
    const sqls = client.executes.map((e) => e.sql);
    expect(sqls).toContain('ROLLBACK TO SAVEPOINT abs_sp');
    expect(sqls).toContain('COMMIT');       // la transaction va à son terme
    expect(sqls).not.toContain('ROLLBACK'); // et n'est PAS annulée en bloc
  });

  it('rend le client à la fin, même quand tout échoue', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.listerAbsences.mockResolvedValue([absence(1)]);
    pool.query.mockResolvedValue({ rows: [{ id: 7, malibou_id: '00001' }] });
    const client = fauxClient({ echecSur: (sql) => sql === 'COMMIT' });
    pool.connect.mockResolvedValue(client);

    await expect(sync.synchroniserAbsences({ appliquer: true })).rejects.toThrow();
    expect(client.release).toHaveBeenCalled();
  });
});

describe('fenêtre de lecture des absences', () => {
  it('encadre aujourd\'hui, et se laisse borner explicitement', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([]);
    malibou.listerAbsences.mockResolvedValue([]);

    await sync.synchroniserAbsences();
    const [auto] = malibou.listerAbsences.mock.calls[0];
    expect(auto.startDate < auto.endDate).toBe(true);
    expect(auto.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await sync.synchroniserAbsences({ debut: '2026-01-01', fin: '2026-12-31' });
    expect(malibou.listerAbsences.mock.calls[1][0]).toMatchObject({ startDate: '2026-01-01', endDate: '2026-12-31' });
  });
});

describe('enchaînement', () => {
  it('synchronise les collaborateurs AVANT les absences', async () => {
    // Une absence ne peut se rattacher qu'à un salarié déjà connu de SOLIDATA :
    // l'ordre inverse laisserait la toute première synchronisation d'un
    // nouvel embauché sans rattachement, et ses jours d'absence hors du
    // réalisé ETP jusqu'au lendemain.
    //
    // L'ordre s'observe sur les ÉCRITURES, pas sur les lectures : les deux
    // fonctions lisent la liste des collaborateurs (la seconde en a besoin
    // pour l'index des matricules), si bien qu'un test fondé sur l'ordre des
    // lectures passerait quel que soit l'ordre réel — c'est le piège dans
    // lequel la première version de ce test est tombée.
    const ordre = [];
    malibou.listerCollaborateurs.mockResolvedValue([collaborateur(1)]);
    malibou.lireCollaborateur.mockResolvedValue({ ...collaborateur(1), contracts: [] });
    malibou.listerAbsences.mockResolvedValue([{
      id: 'abs_1', collaboratorId: 'clb_1', startDate: '2026-03-02', endDate: '2026-03-06',
      createdAt: '2026-02-25T08:00:00.000Z', status: 'approved', type: 'conge_paye',
    }]);
    pool.query.mockResolvedValue({ rows: [{ id: 7, malibou_id: '00001' }] });
    upsertCollaborators.mockImplementation(async () => {
      ordre.push('ecriture:collaborateurs');
      return { created: [], updated: [{ id: 7 }], errors: [], warnings: [] };
    });
    const client = fauxClient();
    client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO employee_leaves/.test(sql)) ordre.push('ecriture:absences');
      if (/RETURNING \(xmax = 0\)/.test(sql)) return { rows: [{ creee: true }] };
      return { rows: [] };
    });
    pool.connect.mockResolvedValue(client);

    const bilan = await sync.synchroniserTout({ appliquer: true });

    expect(ordre).toEqual(['ecriture:collaborateurs', 'ecriture:absences']);
    expect(bilan).toMatchObject({ applique: true });
    expect(bilan.collaborateurs.maj).toBe(1);
    expect(bilan.absences.crees).toBe(1);
  });

  it('rend un bilan complet même quand il n\'y a rien à faire', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([]);
    malibou.listerAbsences.mockResolvedValue([]);
    const bilan = await sync.synchroniserTout();
    expect(bilan).toMatchObject({ applique: false });
    expect(bilan.collaborateurs.lus).toBe(0);
    expect(bilan.absences.lues).toBe(0);
    expect(typeof bilan.duree_ms).toBe('number');
  });
});
