// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — statut du Pass IAE (module PUR utils/pass-iae.js)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests tiennent :
//   1. les 5 statuts, dans l'ORDRE de priorité du contrat (§ 6.1) ;
//   2. les BORNES de jour : un Pass qui finit « aujourd'hui » court encore,
//      une suspension qui finit « aujourd'hui » couvre encore ;
//   3. l'absence n'est JAMAIS interprétée : pas de numéro → « inconnu », pas
//      de date de fin → jamais « expiré », pas de fin de suspension → la
//      suspension est réputée EN COURS (l'erreur coûteuse est dans l'autre sens).
// ═══════════════════════════════════════════════════════════════════════════
const { calculerStatutPassIae, PASS_IAE_STATUTS, jourCivil } = require('../../../src/utils/pass-iae');

const TODAY = '2026-09-13';
const calc = (p) => calculerStatutPassIae({ today: TODAY, ...p });

describe('calculerStatutPassIae — les 6 cas du contrat', () => {
  test('1. sans numéro de Pass → inconnu (même avec des dates renseignées)', () => {
    expect(calc({ numero: null, debut: '2025-07-15', fin: '2027-03-14' })).toBe('inconnu');
    expect(calc({ numero: '   ', fin: '2027-03-14' })).toBe('inconnu');
    expect(calculerStatutPassIae()).toBe('inconnu'); // appel sans argument
  });

  test('2. date de fin dépassée → expire', () => {
    expect(calc({ numero: '2025-07-0918', fin: '2026-09-12' })).toBe('expire');
  });

  test('3. une suspension couvre aujourd’hui → suspendu', () => {
    expect(calc({
      numero: '2025-07-0918', fin: '2027-03-14',
      evenements: [{ type: 'suspension', date_debut: '2026-09-01', date_fin: '2026-09-30' }],
    })).toBe('suspendu');
  });

  test('4. une prolongation enregistrée et un Pass qui court → prolonge', () => {
    expect(calc({
      numero: '2025-07-0918', fin: '2027-03-14',
      evenements: [{ type: 'prolongation', date_debut: '2026-07-15', date_fin: '2027-03-14' }],
    })).toBe('prolonge');
  });

  test('5. rien de particulier → actif', () => {
    expect(calc({ numero: '2025-07-0918', debut: '2025-07-15', fin: '2027-03-14' })).toBe('actif');
  });

  test('6. un Pass sans date de fin n’expire JAMAIS (l’absence n’est pas une échéance)', () => {
    expect(calc({ numero: '2025-07-0918', fin: null })).toBe('actif');
  });
});

describe('ordre de priorité — il est load-bearing', () => {
  test('expiré prime sur une suspension en cours (c’est l’échéance qui commande la prolongation)', () => {
    expect(calc({
      numero: 'P1', fin: '2026-08-01',
      evenements: [{ type: 'suspension', date_debut: '2026-09-01', date_fin: null }],
    })).toBe('expire');
  });

  test('suspension en cours prime sur une prolongation passée', () => {
    expect(calc({
      numero: 'P1', fin: '2027-03-14',
      evenements: [
        { type: 'prolongation', date_debut: '2026-01-01', date_fin: '2027-03-14' },
        { type: 'suspension', date_debut: '2026-09-10', date_fin: '2026-09-20' },
      ],
    })).toBe('suspendu');
  });

  test('une suspension TERMINÉE ne suspend plus (et laisse voir la prolongation)', () => {
    expect(calc({
      numero: 'P1', fin: '2027-03-14',
      evenements: [
        { type: 'suspension', date_debut: '2026-02-03', date_fin: '2026-02-28' },
        { type: 'prolongation', date_debut: '2026-07-15', date_fin: '2027-03-14' },
      ],
    })).toBe('prolonge');
  });

  test('un événement « autre » ne change rien', () => {
    expect(calc({
      numero: 'P1', fin: '2027-03-14',
      evenements: [{ type: 'autre', date_debut: '2026-09-01', date_fin: null }],
    })).toBe('actif');
  });
});

describe('bornes de jour', () => {
  test('un Pass qui finit AUJOURD’HUI court encore (il n’expire que demain)', () => {
    expect(calc({ numero: 'P1', fin: TODAY })).toBe('actif');
    expect(calculerStatutPassIae({ numero: 'P1', fin: TODAY, today: '2026-09-14' })).toBe('expire');
  });

  test('une suspension qui commence aujourd’hui suspend déjà', () => {
    expect(calc({ numero: 'P1', evenements: [{ type: 'suspension', date_debut: TODAY, date_fin: TODAY }] })).toBe('suspendu');
  });

  test('une suspension qui commence DEMAIN ne suspend pas encore', () => {
    expect(calc({ numero: 'P1', evenements: [{ type: 'suspension', date_debut: '2026-09-14', date_fin: '2026-09-30' }] })).toBe('actif');
  });

  test('une suspension SANS date de fin est réputée en cours', () => {
    expect(calc({ numero: 'P1', evenements: [{ type: 'suspension', date_debut: '2026-01-01', date_fin: null }] })).toBe('suspendu');
  });
});

describe('robustesse des entrées', () => {
  test('les colonnes DATE de pg (objets Date) sont acceptées telles quelles', () => {
    // pg rend une colonne DATE en Date à minuit LOCAL : la lecture doit passer
    // par les composantes locales, sinon le jour glisse à l’est de UTC.
    expect(calc({ numero: 'P1', fin: new Date(2026, 8, 12) })).toBe('expire'); // 12/09/2026
    expect(calc({ numero: 'P1', fin: new Date(2026, 8, 13) })).toBe('actif');
  });

  test('`evenements` absent, non tableau ou contenant des trous ne casse rien', () => {
    expect(calc({ numero: 'P1' })).toBe('actif');
    expect(calc({ numero: 'P1', evenements: 'oops' })).toBe('actif');
    expect(calc({ numero: 'P1', evenements: [null, undefined, {}] })).toBe('actif');
  });

  test('une date illisible est ignorée plutôt qu’interprétée', () => {
    expect(calc({ numero: 'P1', fin: 'pas une date' })).toBe('actif');
    expect(jourCivil('pas une date')).toBeNull();
    expect(jourCivil(null)).toBeNull();
    expect(jourCivil('2026-09-13T08:00:00.000Z')).toBe('2026-09-13');
  });

  test('le statut rendu appartient toujours à la liste fermée', () => {
    const cas = [
      {}, { numero: 'P1' }, { numero: 'P1', fin: '2000-01-01' },
      { numero: 'P1', evenements: [{ type: 'suspension', date_debut: '2020-01-01' }] },
      { numero: 'P1', evenements: [{ type: 'prolongation', date_debut: '2020-01-01' }] },
    ];
    for (const c of cas) expect(PASS_IAE_STATUTS).toContain(calc(c));
  });
});
