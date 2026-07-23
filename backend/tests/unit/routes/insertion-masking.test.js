/**
 * Extension insertion 2026-07 (PR1 phase B) — masquage par rôle (RGPD, plan 05 §4).
 *
 * Règle MANAGER : frein_judiciaire* (art. 10) toujours retirés, détails santé
 * (SENSITIVE_DIAG_FIELDS, art. 9) retirés, commentaire_budget retiré.
 * ADMIN/RH : aucune modification. Le masquage RETIRE les clés (absence =
 * « non habilité », ≠ null « non renseigné »).
 */
const { maskInsertionRow, maskInsertionRows, MANAGER_HIDDEN_FIELDS } = require('../../../src/routes/insertion/masking');
const { SENSITIVE_DIAG_FIELDS } = require('../../../src/utils/field-crypto');

const sampleRow = () => ({
  id: 1,
  frein_mobilite: 2,
  frein_sante: 4,
  frein_sante_detail: 'suivi médical',
  frein_sante_causes: 'causes santé',
  commentaire_sante: 'commentaire art. 9',
  frein_judiciaire: 3,
  frein_judiciaire_detail: 'contrainte planning',
  commentaire_budget: 'surendettement',
  commentaire_logement: 'recherche logement',
  bilan_professionnel: 'RAS',
});

describe('masking — maskInsertionRow', () => {
  test('MANAGER : retire frein_judiciaire* (préfixe), détails santé et commentaire_budget', () => {
    const row = maskInsertionRow(sampleRow(), 'MANAGER');
    for (const hidden of ['frein_judiciaire', 'frein_judiciaire_detail', 'frein_sante_detail', 'frein_sante_causes', 'commentaire_sante', 'commentaire_budget']) {
      expect(hidden in row).toBe(false);
    }
  });

  test('MANAGER : conserve les scores non sensibles, le score santé et les autres textes', () => {
    const row = maskInsertionRow(sampleRow(), 'MANAGER');
    expect(row.frein_mobilite).toBe(2);
    expect(row.frein_sante).toBe(4); // le SCORE santé reste (seuls les détails sont masqués)
    expect(row.commentaire_logement).toBe('recherche logement');
    expect(row.bilan_professionnel).toBe('RAS');
  });

  test('ADMIN et RH : aucune clé retirée', () => {
    for (const role of ['ADMIN', 'RH']) {
      const row = maskInsertionRow(sampleRow(), role);
      expect(Object.keys(row).sort()).toEqual(Object.keys(sampleRow()).sort());
    }
  });

  test('tolère null/undefined sans lever', () => {
    expect(maskInsertionRow(null, 'MANAGER')).toBeNull();
    expect(maskInsertionRow(undefined, 'MANAGER')).toBeUndefined();
  });

  test('la liste MANAGER_HIDDEN_FIELDS couvre TOUS les SENSITIVE_DIAG_FIELDS du chiffrement', () => {
    for (const f of SENSITIVE_DIAG_FIELDS) {
      expect(MANAGER_HIDDEN_FIELDS).toContain(f);
    }
    expect(MANAGER_HIDDEN_FIELDS).toContain('commentaire_budget');
    expect(MANAGER_HIDDEN_FIELDS).toContain('frein_judiciaire');
  });
});

describe('masking — maskInsertionRows', () => {
  test('masque chaque ligne pour MANAGER, aucune pour RH', () => {
    const rowsM = maskInsertionRows([sampleRow(), sampleRow()], 'MANAGER');
    for (const r of rowsM) expect('frein_judiciaire' in r).toBe(false);
    const rowsRh = maskInsertionRows([sampleRow()], 'RH');
    expect(rowsRh[0].frein_judiciaire).toBe(3);
  });
});
