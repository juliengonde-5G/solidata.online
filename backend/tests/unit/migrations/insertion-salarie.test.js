// ═══════════════════════════════════════════════════════════════════════════
// MIGRATION « Le salarié » (PR C, lot 7) — forme et IDEMPOTENCE
// ───────────────────────────────────────────────────────────────────────────
// `init-db.js` appelle `run(client)` DANS sa transaction : la migration ne peut
// donc ni ouvrir de transaction, ni utiliser autre chose que `client.query`, et
// chaque instruction doit être rejouable. Ce test rejoue `run` DEUX FOIS sur un
// client simulé et vérifie que les deux passes émettent exactement les mêmes
// instructions, toutes gardées.
//
// Il vérifie aussi ce que la DDL n'a PAS le droit de contenir : un défaut
// `false` sur le consentement (qui ferait passer « jamais demandé » pour un
// refus), un gabarit de message qui nommerait le type d'entretien.
// ═══════════════════════════════════════════════════════════════════════════
const migration = require('../../../src/scripts/migrations/insertion-salarie');

/** Client simulé : enregistre le SQL, ne décide de rien. */
function clientSimule() {
  const requetes = [];
  return {
    requetes,
    query: (sql, params) => { requetes.push({ sql: String(sql), params: params || null }); return Promise.resolve({ rows: [], rowCount: 0 }); },
  };
}

const sqlDe = (c) => c.requetes.map((r) => r.sql).join('\n');

describe('migration insertion-salarie — contrat d’exécution', () => {
  test('n’ouvre AUCUNE transaction (elle vit dans celle d’init-db)', async () => {
    const c = clientSimule();
    await migration.run(c);
    // On teste l'INSTRUCTION, pas le texte : le `BEGIN` d'un bloc PL/pgSQL
    // (`DO $$ ... BEGIN ... END $$`) n'ouvre aucune transaction, et une
    // recherche par expression régulière sur tout le SQL le confondrait avec
    // un vrai `BEGIN` — c'est-à-dire échouerait sur du code correct.
    for (const { sql } of c.requetes) {
      expect(sql.trim().toUpperCase()).not.toMatch(/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/);
    }
  });

  test('chaque instruction est rejouable (IF NOT EXISTS, DO-scan, NOT EXISTS)', async () => {
    const c = clientSimule();
    await migration.run(c);
    for (const { sql } of c.requetes) {
      const s = sql.trim();
      if (/^\s*ALTER TABLE/i.test(s)) expect(s).toMatch(/ADD COLUMN IF NOT EXISTS/i);
      else if (/^\s*CREATE TABLE/i.test(s)) expect(s).toMatch(/CREATE TABLE IF NOT EXISTS/i);
      else if (/^\s*CREATE INDEX/i.test(s)) expect(s).toMatch(/CREATE INDEX IF NOT EXISTS/i);
      else if (/^\s*DO \$\$/i.test(s)) expect(s).toMatch(/IF NOT EXISTS \(\s*\n?\s*SELECT 1 FROM pg_constraint/i);
      else if (/^\s*INSERT INTO/i.test(s)) expect(s).toMatch(/WHERE NOT EXISTS/i);
      // La mise à jour du gabarit historique (retrait du prénom, correctif
      // M-05) est gardée AUTREMENT : elle ne s'applique qu'au texte d'origine
      // MOT POUR MOT, donc elle est idempotente et ne réécrit jamais un gabarit
      // qu'un administrateur a retouché.
      else if (/^\s*UPDATE message_templates/i.test(s)) expect(s).toMatch(/WHERE category = 'insertion_rappel_rdv' AND body = \$2/);
      // Alignement du libellé du registre (m-06) : même garde — seule la
      // phrase d'origine, mot pour mot, est remplacée.
      else if (/^\s*UPDATE rgpd_registre/i.test(s)) expect(s).toMatch(/AND categories_personnes = \$2/);
      else throw new Error(`Instruction non gardée : ${s.slice(0, 80)}`);
    }
  });

  test('rejouée deux fois, elle émet exactement les mêmes instructions', async () => {
    const a = clientSimule();
    const b = clientSimule();
    await migration.run(a);
    await migration.run(b);
    expect(b.requetes.map((r) => r.sql)).toEqual(a.requetes.map((r) => r.sql));
  });
});

describe('migration insertion-salarie — ce que la DDL pose', () => {
  let sql;
  beforeAll(async () => {
    const c = clientSimule();
    await migration.run(c);
    sql = sqlDe(c);
  });

  test('les cinq colonnes de consentement, sans aucun DEFAULT', () => {
    for (const col of ['rappel_rdv_consent', 'rappel_rdv_canal', 'rappel_rdv_destinataire',
      'rappel_rdv_consent_at', 'rappel_rdv_consent_by']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
    // LE point : `rappel_rdv_consent BOOLEAN` sans DEFAULT. Un `DEFAULT false`
    // ferait passer « la question n'a jamais été posée » pour un refus, et
    // personne ne penserait plus à la poser.
    expect(sql).toMatch(/rappel_rdv_consent BOOLEAN;/);
    expect(sql).not.toMatch(/rappel_rdv_consent BOOLEAN[^;]*DEFAULT/);
  });

  test('CHECK du canal posé par DO-scan (rejouable) et borné à sms/email', () => {
    expect(sql).toContain('employees_rappel_rdv_canal_check');
    expect(sql).toMatch(/rappel_rdv_canal IN \('sms', 'email'\)/);
  });

  test('table des documents : snapshot, parcours, remise tracée', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS insertion_documents_salarie');
    expect(sql).toMatch(/type IN \('mon_parcours', 'mon_recap'\)/);
    expect(sql).toContain('contenu JSONB NOT NULL');
    expect(sql).toContain('parcours_num INTEGER NOT NULL DEFAULT 1');
    expect(sql).toMatch(/remis_mode IN \('main_propre', 'email', 'courrier'\)/);
    expect(sql).toContain('ON DELETE CASCADE');
  });

  test('table des rappels : UNIQUE(milestone_id) et destinataire MASQUÉ', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS insertion_rappels_rdv');
    // C'est cette contrainte, et non un verrou applicatif, qui garantit qu'un
    // rendez-vous ne reçoit jamais deux messages.
    expect(sql).toContain('UNIQUE(milestone_id)');
    expect(sql).toContain('destinataire_masque VARCHAR(60) NOT NULL');
    // La colonne du contact EN CLAIR n'existe pas dans cette table.
    expect(sql).not.toMatch(/insertion_rappels_rdv[\s\S]*?destinataire VARCHAR/);
    expect(sql).toMatch(/statut IN \('envoye','echec','dry_run'\)/);
  });

  test('les gabarits sont seedés une seule fois, pour les deux canaux', () => {
    // Quatre depuis le correctif M-05 : les deux du rappel J-1 et les deux du
    // message de VÉRIFICATION du contact, envoyé au recueil du consentement.
    const inserts = sql.split('INSERT INTO message_templates').length - 1;
    expect(inserts).toBe(4);
    expect(sql).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM message_templates WHERE category = 'insertion_rappel_rdv'/);
  });

  test('le message de vérification ne nomme personne et ne dit rien du parcours', () => {
    const textes = [migration.VERIFICATION_SMS_BODY, migration.VERIFICATION_EMAIL_BODY,
      migration.VERIFICATION_EMAIL_SUBJECT].join(' ').toLowerCase();
    for (const interdit of ['bilan', 'diagnostic', 'renouvellement', 'sortie', 'conciliation',
      'référent', 'insertion', 'rsa', 'sanction', 'convocation']) {
      expect(textes).not.toContain(interdit);
    }
    // Aucune variable du tout : ce message ne porte aucune donnée de dossier.
    expect([...migration.VERIFICATION_SMS_BODY.matchAll(/\{(\w+)\}/g)]).toHaveLength(0);
  });

  test('LE gabarit ne nomme JAMAIS le rendez-vous', () => {
    // Un SMS arrive sur un écran que d'autres voient. Le texte ne porte que
    // quatre variables, et aucun mot du vocabulaire du parcours.
    const textes = [migration.RAPPEL_SMS_BODY, migration.RAPPEL_EMAIL_BODY, migration.RAPPEL_EMAIL_SUBJECT].join(' ').toLowerCase();
    for (const interdit of ['bilan', 'diagnostic', 'renouvellement', 'sortie', 'conciliation',
      'référent', 'insertion', 'rsa', 'sanction', 'convocation']) {
      expect(textes).not.toContain(interdit);
    }
    // CORRECTIF M-05 — le PRÉNOM a quitté le gabarit : un chiffre de trop dans
    // le numéro saisi, et ce message (prénom + nom de la structure d'insertion
    // + fait d'un rendez-vous) partait chez un inconnu, une fois par
    // rendez-vous. Le message reste clair pour son destinataire : il arrive sur
    // SON téléphone.
    expect(migration.RAPPEL_SMS_BODY).not.toContain('{prenom}');
    expect(migration.RAPPEL_SMS_BODY).toContain('{date}');
    expect(migration.RAPPEL_SMS_BODY).toContain('{heure}');
    expect(migration.RAPPEL_SMS_BODY).toContain('{cip}');
    // Aucune variable en dehors de ces trois-là.
    const variables = [...migration.RAPPEL_SMS_BODY.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    expect(new Set(variables)).toEqual(new Set(['date', 'heure', 'cip']));
  });

  test('entrée au registre art. 30, gardée, fondée sur le CONSENTEMENT', () => {
    expect(sql).toContain('INSERT INTO rgpd_registre');
    expect(sql).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM rgpd_registre WHERE nom_traitement ILIKE 'Insertion — rappels/);
    expect(sql).toContain('Consentement de la personne concernée (art. 6-1-a du RGPD)');
    expect(sql).toContain('Brevo');
  });
});
