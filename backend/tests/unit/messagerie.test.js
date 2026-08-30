// ═══════════════════════════════════════════════════════════════════════════
// MESSAGERIE INTERNE — tests unitaires (lot L1, contrat §2.1)
// ───────────────────────────────────────────────────────────────────────────
// Trois choses sont vérifiées ici, parce que ce sont les trois qui font mentir
// une messagerie sans qu'on s'en aperçoive :
//
//   1. LA CLÉ DE DÉDUPLICATION — si elle dépend de l'ordre des participants,
//      « écrire à Untel » ouvre une deuxième conversation et les messages se
//      répartissent entre deux fils que personne ne voit ensemble.
//   2. LE PARSING DES MENTIONS — une adresse électronique dans un message ne
//      doit JAMAIS notifier « gmail.com » ; une mention réelle ne doit jamais
//      être manquée à cause d'un point final.
//   3. LE CALCUL DES NON-LUS — la pastille est le seul signal qu'un message
//      attend. Un compteur muet vaut une consigne perdue.
//
// + la purge RGPD et les refus motivés du service (« jamais de valeur
//   inventée » : un destinataire introuvable se dit, il ne se remplace pas).
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const mockQuery = jest.fn();
const mockClient = { query: (...a) => mockQuery(...a), release: jest.fn() };
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => mockClient),
}));

const messagerie = require('../../src/services/messagerie');
const { refreshCustomRoles } = require('../../src/middleware/auth');

beforeEach(() => {
  mockQuery.mockReset();
  mockClient.release.mockReset();
  delete global.__io;
});

// ── 1. Clé de déduplication ────────────────────────────────────────────────
describe('calculerCleUnique — une conversation, une clé', () => {
  const { calculerCleUnique } = messagerie;

  it('conversation directe entre deux utilisateurs', () => {
    expect(calculerCleUnique('directe', [{ user_id: 3 }, { user_id: 7 }])).toBe('directe:u3:u7');
  });

  it("NE DÉPEND PAS de l'ordre des participants (sinon : deux fils pour une conversation)", () => {
    const a = calculerCleUnique('directe', [{ user_id: 3 }, { user_id: 7 }]);
    const b = calculerCleUnique('directe', [{ user_id: 7 }, { user_id: 3 }]);
    expect(a).toBe(b);
  });

  it('utilisateur ↔ véhicule : le véhicule est un participant à part entière', () => {
    expect(calculerCleUnique('directe', [{ user_id: 3 }, { vehicle_id: 1 }])).toBe('directe:u3:v1');
  });

  it('conversations à participant unique : bot et système', () => {
    expect(calculerCleUnique('bot', [{ user_id: 3 }])).toBe('bot:u3');
    expect(calculerCleUnique('systeme', [{ user_id: 3 }])).toBe('systeme:u3');
    expect(calculerCleUnique('systeme', [{ vehicle_id: 1 }])).toBe('systeme:v1');
  });

  it('un participant en double ne change pas la clé', () => {
    expect(calculerCleUnique('directe', [{ user_id: 3 }, { user_id: 7 }, { user_id: 3 }]))
      .toBe('directe:u3:u7');
  });

  it('un participant sans identité est ignoré, pas transformé en segment vide', () => {
    expect(calculerCleUnique('directe', [{ user_id: 3 }, {}, null])).toBe('directe:u3');
  });
});

// ── 2. Mentions ────────────────────────────────────────────────────────────
describe('extraireMentions — @identifiant, jamais une adresse électronique', () => {
  const { extraireMentions } = messagerie;

  it('mention simple', () => {
    expect(extraireMentions('Peux-tu voir avec @ctrieur ?')).toEqual(['ctrieur']);
  });

  it('mention en tout début de message', () => {
    expect(extraireMentions('@admin urgent')).toEqual(['admin']);
  });

  it('plusieurs mentions, dédoublonnées et en minuscules', () => {
    expect(extraireMentions('@Admin et @mchef, puis encore @ADMIN'))
      .toEqual(['admin', 'mchef']);
  });

  it('la ponctuation finale ne fait pas partie de l’identifiant', () => {
    expect(extraireMentions('préviens @admin.')).toEqual(['admin']);
    expect(extraireMentions('(@mchef)')).toEqual(['mchef']);
  });

  it("UNE ADRESSE ÉLECTRONIQUE NE MENTIONNE PERSONNE (le piège du @)", () => {
    expect(extraireMentions('écris à julien.gonde@gmail.com')).toEqual([]);
    expect(extraireMentions('contact@solidata.online et rh@exemple.fr')).toEqual([]);
  });

  it('identifiants avec point, tiret bas ou chiffre', () => {
    expect(extraireMentions('@julien.gonde @k_benali @user2'))
      .toEqual(['julien.gonde', 'k_benali', 'user2']);
  });

  it('identifiant accentué', () => {
    expect(extraireMentions('@émilie arrive')).toEqual(['émilie']);
  });

  it('plafonné pour qu’un message ne déclenche pas des dizaines de notifications', () => {
    const texte = Array.from({ length: 25 }, (_, i) => `@user${i}`).join(' ');
    expect(extraireMentions(texte)).toHaveLength(messagerie.MENTIONS_MAX);
  });

  it('entrées non textuelles : liste vide, jamais une exception', () => {
    expect(extraireMentions(null)).toEqual([]);
    expect(extraireMentions(undefined)).toEqual([]);
    expect(extraireMentions(42)).toEqual([]);
    expect(extraireMentions('')).toEqual([]);
  });

  it('appels répétés : pas d’état résiduel du `lastIndex` de la regex globale', () => {
    expect(extraireMentions('@admin')).toEqual(['admin']);
    expect(extraireMentions('@admin')).toEqual(['admin']);
  });
});

// ── 3. Calcul des non-lus ──────────────────────────────────────────────────
describe('non-lus — le prédicat « ce message n’est pas de moi »', () => {
  // Défaut RÉEL débusqué sur base PostgreSQL 16 pendant ce lot : écrit
  // `m.auteur_user_id = p.user_id`, la comparaison vaut NULL — pas false — dès
  // que la colonne d'auteur est NULL. `NOT NULL` étant NULL, la ligne était
  // écartée : les notifications SYSTÈME et tous les messages véhicule↔utilisateur
  // ne comptaient JAMAIS. Pastille à zéro, consigne en attente sur le téléphone.
  it('compare avec IS NOT DISTINCT FROM (jamais un « = » qui rendrait NULL)', () => {
    expect(messagerie.SQL_PAS_DE_MOI).toMatch(/IS NOT DISTINCT FROM/);
    expect(messagerie.SQL_PAS_DE_MOI).not.toMatch(/auteur_user_id = p\.user_id/);
    expect(messagerie.SQL_PAS_DE_MOI).not.toMatch(/auteur_vehicle_id = p\.vehicle_id/);
  });

  it('les TROIS lectures de non-lus partagent cette seule définition', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'routes', 'messages.js'), 'utf8');
    // Le service (nonLusParParticipant) + les deux endpoints (liste, /non-lus).
    const occurrences = route.match(/\$\{SQL_PAS_DE_MOI\}/g) || [];
    expect(occurrences).toHaveLength(2);
    expect(route).not.toMatch(/auteur_user_id = p\.user_id/);
  });

  it('un participant ne compte que ce qu’il n’a pas écrit', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ user_id: 2, vehicle_id: null, non_lus: 3 }, { user_id: null, vehicle_id: 1, non_lus: 0 }],
    });
    const rows = await messagerie.nonLusParParticipant({ query: mockQuery }, 12);
    expect(rows).toHaveLength(2);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/m\.id > COALESCE\(p\.dernier_lu_message_id, 0\)/);
    expect(mockQuery.mock.calls[0][1]).toEqual([12]);
  });
});

// ── 4. Libellés d'identité ─────────────────────────────────────────────────
describe('libellés — jamais « undefined », jamais une chaîne vide', () => {
  it('« Prénom NOM » (nom de famille en majuscules)', () => {
    expect(messagerie.nomUtilisateur({ first_name: 'Julien', last_name: 'Gondé', username: 'jg' }))
      .toBe('Julien GONDÉ');
  });

  it('repli sur l’identifiant de connexion quand l’état civil manque', () => {
    expect(messagerie.nomUtilisateur({ username: 'admin' })).toBe('admin');
    expect(messagerie.nomUtilisateur({ first_name: '  ', last_name: '', username: 'admin' })).toBe('admin');
  });

  it('véhicule : l’immatriculation d’abord, c’est elle qui identifie', () => {
    expect(messagerie.nomVehicule({ registration: 'AB-123-CD', name: 'Camion 1' }))
      .toBe('AB-123-CD — Camion 1');
    expect(messagerie.nomVehicule({ registration: 'AB-123-CD', name: null })).toBe('AB-123-CD');
    expect(messagerie.nomVehicule({ registration: null, name: null })).toBeNull();
  });
});

// ── 5. envoyerMessageSysteme — refus motivés ───────────────────────────────
describe('envoyerMessageSysteme — un refus se DIT, il ne se remplace pas', () => {
  it('aucun destinataire', async () => {
    const r = await messagerie.envoyerMessageSysteme({ texte: 'Alerte' });
    expect(r).toEqual({ ok: false, motif: 'aucun destinataire' });
  });

  it('plusieurs destinataires : refus (on ne choisit pas à la place de l’appelant)', async () => {
    const r = await messagerie.envoyerMessageSysteme({
      destinataire_user_id: 1, destinataire_vehicle_id: 2, texte: 'Alerte',
    });
    expect(r.ok).toBe(false);
    expect(r.motif).toMatch(/plusieurs/);
  });

  it('texte vide', async () => {
    const r = await messagerie.envoyerMessageSysteme({ destinataire_user_id: 1, texte: '   ' });
    expect(r).toEqual({ ok: false, motif: 'texte vide' });
  });

  it('salarié SANS compte utilisateur : motif explicite, aucun repli inventé', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: null }] });
    const r = await messagerie.envoyerMessageSysteme({
      destinataire_employee_id: 42, texte: 'Fin de contrat dans 30 jours',
    });
    expect(r).toEqual({ ok: false, motif: 'employé sans compte utilisateur' });
    // Aucune conversation n'a été ouverte pour personne.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('salarié inconnu', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await messagerie.envoyerMessageSysteme({ destinataire_employee_id: 999, texte: 'x' });
    expect(r).toEqual({ ok: false, motif: 'salarié inconnu' });
  });

  it('une panne de base NE LÈVE PAS : l’action métier appelante ne doit pas tomber', async () => {
    mockQuery.mockRejectedValue(new Error('connexion perdue'));
    const r = await messagerie.envoyerMessageSysteme({ destinataire_user_id: 1, texte: 'Alerte' });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('connexion perdue');
  });

  it('dépôt nominal : conversation « SOLIDATA », message de type notification', async () => {
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO messagerie_conversations/.test(t)) return Promise.resolve({ rows: [{ id: 12 }] });
      if (/INSERT INTO messagerie_participants/.test(t)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO messagerie_messages/.test(t)) {
        return Promise.resolve({ rows: [{ id: 77, conversation_id: 12, created_at: '2026-08-26T10:00:00Z' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await messagerie.envoyerMessageSysteme({
      destinataire_vehicle_id: 1, texte: 'Programme modifié', source: 'programme', lien: '/tours',
    });
    expect(r).toEqual({ ok: true, conversation_id: 12, message_id: 77 });

    const conv = mockQuery.mock.calls.find((c) => /INSERT INTO messagerie_conversations/.test(String(c[0])));
    expect(conv[1]).toEqual(['systeme', 'SOLIDATA', 'systeme:v1', null]);
    const msg = mockQuery.mock.calls.find((c) => /INSERT INTO messagerie_messages/.test(String(c[0])));
    expect(msg[1]).toEqual([12, 'systeme', null, null, 'Programme modifié', 'notification', 'programme', '/tours']);
  });
});

// ── 6. envoyerMessageSystemeRoles — rôles PERSONNALISÉS compris ────────────
describe('envoyerMessageSystemeRoles — resolveBaseRole, pas le rôle brut', () => {
  it('un rôle personnalisé dérivé de MANAGER reçoit ce que reçoit un MANAGER', async () => {
    // Chargement du référentiel des rôles personnalisés (REF_RSE → MANAGER).
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'REF_RSE', base_role: 'MANAGER' }] });
    await refreshCustomRoles();

    const destinataires = [];
    mockQuery.mockImplementation((sql, params) => {
      const t = String(sql);
      if (/SELECT id, role FROM users WHERE is_active = true/.test(t)) {
        return Promise.resolve({
          rows: [
            { id: 1, role: 'ADMIN' }, { id: 2, role: 'MANAGER' },
            { id: 3, role: 'COLLABORATEUR' }, { id: 4, role: 'REF_RSE' },
          ],
        });
      }
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO messagerie_conversations/.test(t)) {
        destinataires.push(params[2]);   // cle_unique = systeme:u<id>
        return Promise.resolve({ rows: [{ id: 50 + destinataires.length }] });
      }
      if (/INSERT INTO messagerie_messages/.test(t)) {
        return Promise.resolve({ rows: [{ id: 900, conversation_id: 50, created_at: new Date() }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const r = await messagerie.envoyerMessageSystemeRoles(['MANAGER'], { texte: 'Anomalie checklist' });
    expect(r.ok).toBe(true);
    expect(r.envoyes).toBe(2);
    expect(r.echecs).toEqual([]);
    expect(destinataires.sort()).toEqual(['systeme:u2', 'systeme:u4']);
  });

  it('aucun rôle visé : refus motivé', async () => {
    expect(await messagerie.envoyerMessageSystemeRoles([], { texte: 'x' }))
      .toEqual({ ok: false, motif: 'aucun rôle visé' });
    expect(await messagerie.envoyerMessageSystemeRoles(null, { texte: 'x' }))
      .toEqual({ ok: false, motif: 'aucun rôle visé' });
  });
});

// ── 7. Purge RGPD ──────────────────────────────────────────────────────────
describe('purgeMessagerieRetention — rétention paramétrée, journal honnête', () => {
  function mockPurge({ setting = '365', messages = 0, conversations = 0, pointeurs = 0 } = {}) {
    const appels = [];
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      appels.push(t);
      if (/FROM settings WHERE key = 'messagerie.retention_jours'/.test(t)) {
        return Promise.resolve({ rows: setting === null ? [] : [{ value: setting }] });
      }
      if (/DELETE FROM messagerie_messages/.test(t)) return Promise.resolve({ rowCount: messages });
      if (/UPDATE messagerie_participants/.test(t)) return Promise.resolve({ rowCount: pointeurs });
      if (/DELETE FROM messagerie_conversations/.test(t)) return Promise.resolve({ rowCount: conversations });
      if (/INSERT INTO rgpd_audit_log/.test(t)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    return appels;
  }

  it('lit la rétention dans les réglages (jamais une durée en dur)', async () => {
    mockPurge({ setting: '90', messages: 4 });
    const r = await messagerie.purgeMessagerieRetention();
    expect(r.retention_jours).toBe(90);
    const del = mockQuery.mock.calls.find((c) => /DELETE FROM messagerie_messages/.test(String(c[0])));
    expect(del[1]).toEqual(['90']);
  });

  it('réglage absent → 365 jours par défaut', async () => {
    mockPurge({ setting: null });
    expect((await messagerie.purgeMessagerieRetention()).retention_jours).toBe(365);
  });

  // Déclenchement MANUEL depuis la page RGPD : le service rgpd-purges écrit
  // lui-même la ligne de journal, sous le code manuel et avec l'utilisateur qui
  // a cliqué. Sans ce drapeau, la purge écrivait EN PLUS son propre
  // « AUTO_PURGE_MESSAGERIE » : deux lignes, dont une qui affirmait faussement
  // qu'un job planifié était passé.
  it('journaliser:false → aucune ligne AUTO_ (le déclencheur manuel écrit la sienne)', async () => {
    mockPurge({ setting: '365', messages: 7, conversations: 2 });
    const r = await messagerie.purgeMessagerieRetention({ journaliser: false });
    expect(r.messages_supprimes).toBe(7);           // la purge a bien eu lieu
    const journal = mockQuery.mock.calls.filter((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])));
    expect(journal).toHaveLength(0);
  });

  it('par défaut (job planifié), la ligne AUTO_ est bien écrite', async () => {
    mockPurge({ setting: '365', messages: 7, conversations: 2 });
    await messagerie.purgeMessagerieRetention();
    const journal = mockQuery.mock.calls.filter((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])));
    expect(journal).toHaveLength(1);
    expect(String(journal[0][0])).toContain('AUTO_PURGE_MESSAGERIE');
  });

  it('réglage illisible → défaut, sans exception', async () => {
    mockPurge({ setting: 'beaucoup' });
    expect((await messagerie.purgeMessagerieRetention()).retention_jours).toBe(365);
  });

  it('rien à purger → AUCUNE écriture dans rgpd_audit_log', async () => {
    mockPurge({ messages: 0, conversations: 0 });
    const r = await messagerie.purgeMessagerieRetention();
    expect(r).toMatchObject({ ok: true, messages_supprimes: 0, conversations_supprimees: 0 });
    expect(mockQuery.mock.calls.some((c) => /rgpd_audit_log/.test(String(c[0])))).toBe(false);
  });

  it('purge effective → journalisée, SANS aucun contenu de message', async () => {
    mockPurge({ messages: 12, conversations: 2, pointeurs: 3 });
    const r = await messagerie.purgeMessagerieRetention();
    expect(r).toMatchObject({
      ok: true, messages_supprimes: 12, conversations_supprimees: 2, pointeurs_recales: 3,
    });
    const log = mockQuery.mock.calls.find((c) => /rgpd_audit_log/.test(String(c[0])));
    expect(String(log[0])).toMatch(/AUTO_PURGE_MESSAGERIE/);
    const details = JSON.parse(log[1][0]);
    expect(details).toEqual({
      messages_supprimes: 12, conversations_supprimees: 2, pointeurs_recales: 3, retention_jours: 365,
    });
    expect(Object.keys(details)).not.toContain('texte');
  });

  it('les accusés de lecture orphelins sont RECALÉS, jamais avancés', async () => {
    mockPurge({ messages: 5, pointeurs: 2 });
    await messagerie.purgeMessagerieRetention();
    const upd = mockQuery.mock.calls.find((c) => /UPDATE messagerie_participants/.test(String(c[0])));
    const sql = String(upd[0]);
    // Le pointeur ne peut que reculer vers un message ENCORE présent (m.id <= …)
    // ou tomber à NULL : jamais marquer « lu » un message jamais ouvert.
    expect(sql).toMatch(/MAX\(m\.id\)/);
    expect(sql).toMatch(/m\.id <= p\.dernier_lu_message_id/);
    expect(sql).toMatch(/NOT EXISTS/);
  });

  it('panne de base : { ok:false, motif }, jamais une exception qui tue le job', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM settings/.test(String(sql))) return Promise.resolve({ rows: [{ value: '365' }] });
      return Promise.reject(new Error('table absente'));
    });
    const r = await messagerie.purgeMessagerieRetention();
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('table absente');
    expect(r.retention_jours).toBe(365);
  });
});

// ── 8. Poussée temps réel : dégradation silencieuse ────────────────────────
describe('emettreNouveauMessage — le socket est un confort, pas une dépendance', () => {
  it('sans serveur temps réel : motif exposé, aucune erreur levée', async () => {
    delete global.__io;
    const r = await messagerie.emettreNouveauMessage(1, { id: 1, conversation_id: 1 }, 'SOLIDATA');
    expect(r).toEqual({ ok: false, motif: 'temps réel indisponible' });
  });

  it('une salle par participant, chacun avec SON compteur', async () => {
    const emis = [];
    global.__io = { to: (salle) => ({ emit: (nom, charge) => emis.push({ salle, nom, charge }) }) };
    mockQuery.mockResolvedValue({
      rows: [
        { user_id: 2, vehicle_id: null, non_lus: 3 },
        { user_id: null, vehicle_id: 7, non_lus: 0 },
      ],
    });
    await messagerie.emettreNouveauMessage(12, {
      id: 99, conversation_id: 12, auteur_type: 'systeme', auteur_user_id: null,
      auteur_vehicle_id: null, texte: 'Alerte', type: 'notification', source: 'checklist',
      lien: '/vehicles', created_at: '2026-08-26T10:00:00Z',
    }, 'SOLIDATA');

    expect(emis.map((e) => e.salle)).toEqual(['user:2', 'vehicule:7']);
    expect(emis.every((e) => e.nom === 'messagerie:nouveau')).toBe(true);
    expect(emis[0].charge.non_lus_conversation).toBe(3);
    expect(emis[1].charge.non_lus_conversation).toBe(0);
    expect(emis[0].charge.message).toMatchObject({ id: 99, auteur_nom: 'SOLIDATA', lien: '/vehicles' });
  });
});
