// Tests de la pseudonymisation PII avant envoi LLM (Vague 3 — item 3.C-5).
// Module PUR : aucun mock nécessaire.
const {
  letterLabel,
  ageBracket,
  redactContactInfo,
  createPseudonymizer,
  sanitizeToolResult,
  sanitizeToolResultJson,
} = require('../../../src/utils/pii-pseudonymize');

describe('letterLabel', () => {
  it('0→A, 1→B, 25→Z', () => {
    expect(letterLabel(0)).toBe('A');
    expect(letterLabel(1)).toBe('B');
    expect(letterLabel(25)).toBe('Z');
  });
  it('déborde en AA, AB… au-delà de 26', () => {
    expect(letterLabel(26)).toBe('AA');
    expect(letterLabel(27)).toBe('AB');
    expect(letterLabel(51)).toBe('AZ');
    expect(letterLabel(52)).toBe('BA');
  });
  it('valeurs invalides → A (borné)', () => {
    expect(letterLabel(-5)).toBe('A');
    expect(letterLabel(undefined)).toBe('A');
  });
});

describe('ageBracket', () => {
  const ref = new Date('2026-07-13T00:00:00Z');
  it('mappe une date de naissance vers une tranche (jamais la date exacte)', () => {
    expect(ageBracket('2005-01-01', ref)).toBe('moins de 26 ans'); // 21 ans
    expect(ageBracket('1998-01-01', ref)).toBe('26-29 ans');       // 28 ans
    expect(ageBracket('1990-01-01', ref)).toBe('30-39 ans');       // 36 ans
    expect(ageBracket('1980-01-01', ref)).toBe('40-49 ans');       // 46 ans
    expect(ageBracket('1970-01-01', ref)).toBe('50-59 ans');       // 56 ans
    expect(ageBracket('1955-01-01', ref)).toBe('60 ans et plus');  // 71 ans
  });
  it('gère la borne de 26 ans juste avant/après anniversaire', () => {
    expect(ageBracket('2000-08-01', ref)).toBe('moins de 26 ans'); // 25 (anniv pas atteint)
    expect(ageBracket('2000-06-01', ref)).toBe('26-29 ans');       // 26 (anniv passé)
  });
  it('null / invalide / futur → null', () => {
    expect(ageBracket(null)).toBeNull();
    expect(ageBracket('pas une date')).toBeNull();
    expect(ageBracket('2999-01-01', ref)).toBeNull();
  });
});

describe('redactContactInfo', () => {
  it('masque les emails', () => {
    expect(redactContactInfo('contact jean@exemple.fr svp')).toBe('contact [email masqué] svp');
  });
  it('masque les téléphones FR (avec ou sans séparateurs)', () => {
    expect(redactContactInfo('appeler au 06 12 34 56 78')).toBe('appeler au [numéro masqué]');
    expect(redactContactInfo('tel 0612345678')).toBe('tel [numéro masqué]');
  });
  it('masque les longues suites de chiffres (NIR, titre de séjour)', () => {
    expect(redactContactInfo('NIR 1 85 05 78 006 084')).toContain('[numéro masqué]');
  });
  it('préserve les années, petits effectifs et montants courants', () => {
    expect(redactContactInfo('en 2026, 3 salariés, base 1607 h')).toBe('en 2026, 3 salariés, base 1607 h');
    expect(redactContactInfo('CA de 1 800 € ce mois')).toBe('CA de 1 800 € ce mois');
  });
  it('non-chaîne → renvoyé tel quel', () => {
    expect(redactContactInfo(null)).toBeNull();
    expect(redactContactInfo(42)).toBe(42);
  });
});

describe('createPseudonymizer — jetons stables', () => {
  it('même personne (même clé) → même jeton', () => {
    const p = createPseudonymizer();
    const t1 = p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' });
    const t2 = p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' });
    expect(t1).toBe('Salarié A');
    expect(t2).toBe('Salarié A');
  });
  it('personnes distinctes → jetons distincts et ordonnés', () => {
    const p = createPseudonymizer();
    expect(p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' })).toBe('Salarié A');
    expect(p.person({ key: 'emp-2', first: 'Marie', last: 'Martin' })).toBe('Salarié B');
    expect(p.person({ key: 'emp-3', first: 'Ali', last: 'Ben' })).toBe('Salarié C');
  });
  it('libellé de jeton personnalisable', () => {
    const p = createPseudonymizer({ label: 'Personne' });
    expect(p.person({ key: 'x', first: 'A', last: 'B' })).toBe('Personne A');
  });
  it('identité vide → null (pas de jeton fantôme)', () => {
    const p = createPseudonymizer();
    expect(p.person({})).toBeNull();
    expect(p.person({ first: '', last: '' })).toBeNull();
  });
  it('alias (candidat = même salarié) partagent un seul jeton', () => {
    const p = createPseudonymizer();
    const t = p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont', names: [{ first: 'Jean', last: 'Dupond' }] });
    expect(t).toBe('Salarié A');
    // Les deux orthographes doivent être scrubbées vers le MÊME jeton.
    expect(p.scrubText('Jean Dupont et Jean Dupond')).toBe('Salarié A et Salarié A');
  });
});

describe('createPseudonymizer — scrubText', () => {
  it('remplace nom complet, prénom seul et nom seul (insensible casse/accents)', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Amélie', last: 'Léveque' });
    expect(p.scrubText('Amélie Léveque est arrivée.')).toBe('Salarié A est arrivée.');
    expect(p.scrubText('AMELIE a progressé')).toBe('Salarié A a progressé');
    expect(p.scrubText('Voir avec leveque')).toBe('Voir avec Salarié A');
  });
  it('ne coupe pas au milieu d’un mot (frontières)', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Ali', last: 'Ben' });
    // "Ali" ne doit PAS matcher dans "Alizée" ni "Benoit".
    expect(p.scrubText('Alizée et Benoit')).toBe('Alizée et Benoit');
    expect(p.scrubText('Ali est là')).toBe('Salarié A est là');
  });
  it('masque aussi les coordonnées dans le texte libre', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' });
    expect(p.scrubText('Jean joignable au 06 12 34 56 78')).toBe('Salarié A joignable au [numéro masqué]');
  });
  it('idempotence : re-scrubber un texte déjà nettoyé ne change rien', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' });
    const once = p.scrubText('Jean Dupont ok');
    expect(p.scrubText(once)).toBe(once);
  });
  it('null / non-chaîne → renvoyé tel quel', () => {
    const p = createPseudonymizer();
    expect(p.scrubText(null)).toBeNull();
    expect(p.scrubText(undefined)).toBeUndefined();
  });
  it('ne scrubbe pas les fragments trop courts (< 3 car.)', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Bo', last: 'Li' }); // parties < 3 : non scrubbées seules
    // Le nom complet (≥ 3) reste couvert ; les fragments courts seuls non.
    expect(p.scrubText('Bo Li est là')).toBe('Salarié A est là');
    expect(p.scrubText('un bon bol de Li')).toBe('un bon bol de Li');
  });
});

describe('createPseudonymizer — rehydrate', () => {
  it('re-substitue le jeton par le nom réel dans les chaînes', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' });
    const out = p.rehydrate({ synthese: 'Salarié A progresse', alertes: [{ salarie: 'Salarié A' }] });
    expect(out.synthese).toBe('Jean Dupont progresse');
    expect(out.alertes[0].salarie).toBe('Jean Dupont');
  });
  it('ne confond pas "Salarié A" avec "Salarié AA" (frontière de jeton)', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' }); // Salarié A
    // "Salarié AA" n'est pas un jeton enregistré → doit rester intact.
    expect(p.rehydrate('Salarié A vu, Salarié AA inconnu')).toBe('Jean Dupont vu, Salarié AA inconnu');
  });
  it('laisse les textes génériques ("le salarié") inchangés', () => {
    const p = createPseudonymizer();
    p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont' });
    expect(p.rehydrate('le salarié progresse')).toBe('le salarié progresse');
  });
});

describe('sanitizeToolResult (SolidataBot — défense en profondeur)', () => {
  it('pseudonymise les champs identifiants, masque les coordonnées, tranche la naissance', () => {
    const p = createPseudonymizer();
    const out = sanitizeToolResult({
      first_name: 'Jean', last_name: 'Dupont', email: 'j@x.fr', phone: '0612345678',
      birth_date: '1990-01-01', poste: 'Trieur',
    }, p);
    expect(out.first_name).toMatch(/^Salarié /);
    expect(out.email).toBe('[masqué]');
    expect(out.phone).toBe('[masqué]');
    expect(out.birth_date).toMatch(/ans/);
    expect(out.poste).toBe('Trieur'); // champ non personnel conservé
  });
  it('NE touche PAS les champs légitimes non personnels (nom de CAV, adresse, commune)', () => {
    const p = createPseudonymizer();
    // Reproduit la sortie réelle de l'outil query_cav du chatbot.
    const cav = { total: 2, affichage: 2, cav: [
      { name: 'CAV Mairie', address: '1 rue des Fleurs', commune: 'Rouen', status: 'active', nb_containers: 3, taux_remplissage: 82.5 },
    ] };
    expect(sanitizeToolResult(cav, p)).toEqual(cav); // aucune régression query_cav
  });
  it('récursif sur objets et tableaux ; null préservé', () => {
    const p = createPseudonymizer();
    const out = sanitizeToolResult({ data: [{ prenom: 'Marie', email: null }] }, p);
    expect(out.data[0].prenom).toMatch(/^Salarié /);
    expect(out.data[0].email).toBeNull();
  });
});

describe('sanitizeToolResultJson', () => {
  it('assainit un JSON d’outil valide', () => {
    const p = createPseudonymizer();
    const out = sanitizeToolResultJson(JSON.stringify({ first_name: 'Jean', email: 'j@x.fr' }), p);
    const parsed = JSON.parse(out);
    expect(parsed.first_name).toMatch(/^Salarié /);
    expect(parsed.email).toBe('[masqué]');
  });
  it('JSON invalide → renvoyé tel quel (ne casse jamais le chat)', () => {
    const p = createPseudonymizer();
    expect(sanitizeToolResultJson('pas du json', p)).toBe('pas du json');
  });
  it('sorties agrégées actuelles (kpis_insertion) inchangées', () => {
    const p = createPseudonymizer();
    const kpi = JSON.stringify({ annee: 2026, nb_en_parcours: 12, jalons_en_retard: 3, note: 'Données agrégées et anonymes.' });
    expect(sanitizeToolResultJson(kpi, p)).toBe(kpi);
  });
});

describe('scénario insertion (bout-en-bout logique)', () => {
  it('le payload ne contient plus le nom réel, la réponse re-mappe le jeton', () => {
    const p = createPseudonymizer();
    const ref = p.person({ key: 'emp-1', first: 'Jean', last: 'Dupont', names: [{ first: 'Jean', last: 'Dupont' }] });
    // Payload construit comme dans analyseProfilComplet.
    const payload = {
      salarie: { reference: ref, poste: 'Trieur', tranche_age: ageBracket('1990-01-01', new Date('2026-07-13')) },
      observations: { difficultes: p.scrubText('Jean a des soucis de mobilité, tel 0612345678') },
    };
    const asJson = JSON.stringify(payload);
    expect(asJson).not.toMatch(/Dupont/);
    expect(asJson).not.toMatch(/0612345678/);
    expect(payload.salarie.reference).toBe('Salarié A');
    expect(payload.salarie.tranche_age).toBe('30-39 ans');
    // Réponse simulée du modèle, puis ré-hydratation pour le CIP.
    const modelResp = { synthese: 'Salarié A doit lever le frein mobilité.' };
    expect(p.rehydrate(modelResp).synthese).toBe('Jean Dupont doit lever le frein mobilité.');
  });
});
