import { describe, it, expect } from 'vitest';
import {
  DAMAGE_VUES, DAMAGE_TYPES, vueLabel, typeLabel,
  clamp01, normalizeDamage, addDamage, removeDamage, updateDamage,
  countByVue, toApiPayload, newDamageId,
} from '../src/services/vehicleDamage.js';

// Schéma dégâts véhicule (Checklist.jsx / VehicleDamageMap.jsx) — logique
// pure : normalisation, ajout/retrait/mise à jour immuables, sérialisation
// pour le payload API `degats`.

describe('clamp01', () => {
  it('laisse passer une valeur déjà dans [0,1]', () => {
    expect(clamp01(0.42)).toBe(0.42);
  });

  it('plafonne au-delà de 1', () => {
    expect(clamp01(1.7)).toBe(1);
  });

  it('plafonne en-deçà de 0', () => {
    expect(clamp01(-0.3)).toBe(0);
  });

  it('retombe sur 0 pour une valeur non finie (NaN, undefined, texte)', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(undefined)).toBe(0);
    expect(clamp01('abc')).toBe(0);
  });

  it('accepte les bornes exactes 0 et 1', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
});

describe('newDamageId', () => {
  it('produit un identifiant non vide et unique', () => {
    const a = newDamageId();
    const b = newDamageId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('normalizeDamage', () => {
  it('conserve une vue/un type valides tels quels', () => {
    const d = normalizeDamage({ vue: 'arriere', x: 0.3, y: 0.6, type: 'choc', commentaire: 'pare-chocs' });
    expect(d.vue).toBe('arriere');
    expect(d.type).toBe('choc');
    expect(d.x).toBe(0.3);
    expect(d.y).toBe(0.6);
    expect(d.commentaire).toBe('pare-chocs');
    expect(typeof d.id).toBe('string');
  });

  it('retombe sur la première vue connue si la vue est invalide/absente', () => {
    const d = normalizeDamage({ vue: 'dessus', x: 0.1, y: 0.1, type: 'rayure' });
    expect(d.vue).toBe(DAMAGE_VUES[0]);
  });

  it("retombe sur 'autre' si le type est invalide/absent", () => {
    const d = normalizeDamage({ vue: 'avant', x: 0.5, y: 0.5, type: 'inconnu' });
    expect(d.type).toBe('autre');
    const d2 = normalizeDamage({ vue: 'avant', x: 0.5, y: 0.5 });
    expect(d2.type).toBe('autre');
  });

  it('clampe x/y hors bornes', () => {
    const d = normalizeDamage({ vue: 'gauche', x: 1.4, y: -0.2, type: 'bris' });
    expect(d.x).toBe(1);
    expect(d.y).toBe(0);
  });

  it('réduit un commentaire blanc/vide à null (jamais une chaîne vide)', () => {
    expect(normalizeDamage({ vue: 'droit', commentaire: '   ' }).commentaire).toBeNull();
    expect(normalizeDamage({ vue: 'droit', commentaire: '' }).commentaire).toBeNull();
    expect(normalizeDamage({ vue: 'droit' }).commentaire).toBeNull();
  });

  it('rogne les espaces superflus du commentaire', () => {
    expect(normalizeDamage({ vue: 'droit', commentaire: '  portière  ' }).commentaire).toBe('portière');
  });

  it('conserve un id déjà fourni (édition d’un point existant)', () => {
    const d = normalizeDamage({ id: 'abc-123', vue: 'avant', type: 'choc' });
    expect(d.id).toBe('abc-123');
  });
});

describe('addDamage / removeDamage / updateDamage — immutabilité', () => {
  it('addDamage retourne une NOUVELLE liste sans muter l’originale', () => {
    const original = [];
    const next = addDamage(original, { vue: 'avant', x: 0.2, y: 0.3, type: 'rayure' });
    expect(original).toHaveLength(0);
    expect(next).toHaveLength(1);
    expect(next[0].vue).toBe('avant');
  });

  it('addDamage tolère une liste absente (undefined/null)', () => {
    expect(addDamage(undefined, { vue: 'avant' })).toHaveLength(1);
    expect(addDamage(null, { vue: 'avant' })).toHaveLength(1);
  });

  it('removeDamage retire uniquement l’id demandé', () => {
    let list = addDamage([], { id: 'a', vue: 'avant', type: 'choc' });
    list = addDamage(list, { id: 'b', vue: 'arriere', type: 'bris' });
    const next = removeDamage(list, 'a');
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('b');
    // La liste d'origine n'est pas mutée.
    expect(list).toHaveLength(2);
  });

  it('removeDamage est un no-op si l’id est absent', () => {
    const list = addDamage([], { id: 'a', vue: 'avant' });
    const next = removeDamage(list, 'inexistant');
    expect(next).toHaveLength(1);
    expect(next).not.toBe(list); // nouvelle liste malgré tout
  });

  it('updateDamage modifie le type/commentaire en conservant id/position/vue', () => {
    const list = addDamage([], { id: 'a', vue: 'gauche', x: 0.4, y: 0.5, type: 'rayure' });
    const next = updateDamage(list, 'a', { type: 'bris', commentaire: 'vitre' });
    expect(next[0]).toMatchObject({ id: 'a', vue: 'gauche', x: 0.4, y: 0.5, type: 'bris', commentaire: 'vitre' });
  });

  it('updateDamage est un no-op si l’id est absent', () => {
    const list = addDamage([], { id: 'a', vue: 'gauche' });
    const next = updateDamage(list, 'zzz', { type: 'bris' });
    expect(next[0].type).not.toBe('bris');
  });
});

describe('countByVue', () => {
  it('compte les dégâts par vue, 0 pour les vues sans dégât', () => {
    let list = addDamage([], { vue: 'avant', type: 'choc' });
    list = addDamage(list, { vue: 'avant', type: 'rayure' });
    list = addDamage(list, { vue: 'droit', type: 'bris' });
    const counts = countByVue(list);
    expect(counts.avant).toBe(2);
    expect(counts.droit).toBe(1);
    expect(counts.arriere).toBe(0);
    expect(counts.gauche).toBe(0);
  });

  it('tolère une liste vide/absente', () => {
    expect(countByVue([])).toEqual({ avant: 0, arriere: 0, gauche: 0, droit: 0 });
    expect(countByVue(undefined)).toEqual({ avant: 0, arriere: 0, gauche: 0, droit: 0 });
  });
});

describe('toApiPayload', () => {
  it('dépouille l’id local et ne garde que vue/x/y/type/commentaire', () => {
    const list = addDamage([], { vue: 'avant', x: 0.25, y: 0.75, type: 'choc', commentaire: 'aile avant' });
    const out = toApiPayload(list);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ vue: 'avant', x: 0.25, y: 0.75, type: 'choc', commentaire: 'aile avant' });
    expect(out[0].id).toBeUndefined();
  });

  it('omet la clé commentaire quand elle est vide (jamais une chaîne vide envoyée)', () => {
    const list = addDamage([], { vue: 'avant', x: 0.1, y: 0.1, type: 'rayure' });
    const out = toApiPayload(list);
    expect(out[0]).toEqual({ vue: 'avant', x: 0.1, y: 0.1, type: 'rayure' });
    expect('commentaire' in out[0]).toBe(false);
  });

  it('liste vide → tableau vide', () => {
    expect(toApiPayload([])).toEqual([]);
    expect(toApiPayload(undefined)).toEqual([]);
  });
});

describe('vueLabel / typeLabel', () => {
  it('renvoie un libellé FR connu pour chaque vue/type', () => {
    DAMAGE_VUES.forEach((v) => expect(typeof vueLabel(v)).toBe('string'));
    DAMAGE_TYPES.forEach((t) => expect(typeof typeLabel(t)).toBe('string'));
    expect(vueLabel('avant')).toBe('Avant');
    expect(typeLabel('choc')).toBe('Choc');
  });

  it('retombe sur la valeur brute si inconnue (jamais undefined)', () => {
    expect(vueLabel('dessus')).toBe('dessus');
    expect(typeLabel('exotique')).toBe('exotique');
  });
});
