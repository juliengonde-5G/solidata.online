import { describe, it, expect } from 'vitest';
import { pickAuditCavId } from '../src/services/auditPhoto.js';

const cavs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

describe('pickAuditCavId', () => {
  it('est déterministe pour une même tournée (même point à chaque appel)', () => {
    const a = pickAuditCavId('123', cavs);
    const b = pickAuditCavId('123', cavs);
    expect(a).toBe(b);
    expect(cavs.some((c) => c.id === a)).toBe(true);
  });

  it('choisit un point différent selon la tournée (pas de constante cachée)', () => {
    const picks = new Set();
    for (let t = 0; t < 30; t++) picks.add(pickAuditCavId(`tour-${t}`, cavs));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('lit cav_id en priorité, id en repli', () => {
    const mixed = [{ cav_id: 10, id: 999 }];
    expect(pickAuditCavId('t', mixed)).toBe(10);
    expect(pickAuditCavId('t', [{ id: 42 }])).toBe(42);
  });

  it('renvoie null sans liste ou sans tourId (jamais de valeur inventée)', () => {
    expect(pickAuditCavId('t', [])).toBeNull();
    expect(pickAuditCavId('t', null)).toBeNull();
    expect(pickAuditCavId(null, cavs)).toBeNull();
  });
});
