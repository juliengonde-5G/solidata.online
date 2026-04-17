import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDB, STORES, clearStore, countItems, getAllItems, getItem,
  putItem, deleteItem,
  addPendingScan, addPendingWeight, addPendingCollect, addPendingIncident,
  updatePendingIncident, newClientId,
  draftKey, saveDraft, readDraft, clearDraft,
} from '../src/services/db.js';

beforeEach(async () => {
  // fake-indexeddb garde la base en mémoire — on reset tous les stores
  // entre chaque test pour isoler.
  await Promise.all(Object.values(STORES).map(s => clearStore(s).catch(() => {})));
});

describe('openDB / migration', () => {
  it('ouvre la base et crée les 8 stores attendus', async () => {
    const db = await openDB();
    const names = Array.from(db.objectStoreNames);
    expect(names).toContain(STORES.tours);
    expect(names).toContain(STORES.cavs);
    expect(names).toContain(STORES.pendingScans);
    expect(names).toContain(STORES.pendingWeights);
    expect(names).toContain(STORES.gpsBuffer);
    expect(names).toContain(STORES.userData);
    expect(names).toContain(STORES.pendingIncidents);
    expect(names).toContain(STORES.pendingCollects);
    db.close();
  });
});

describe('newClientId', () => {
  it('produit un identifiant non vide et unique', () => {
    const a = newClientId();
    const b = newClientId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('addPending* helpers', () => {
  it('addPendingWeight stocke les champs idempotence + métier', async () => {
    const id = await addPendingWeight({
      tourId: 42, weightKg: 1200, tareKg: 3500, isIntermediate: false, finalize: true,
    });
    const row = await getItem(STORES.pendingWeights, id);
    expect(row).toMatchObject({
      tourId: 42, weightKg: 1200, tareKg: 3500, isIntermediate: false, finalize: true,
    });
    expect(typeof row.clientId).toBe('string');
    expect(row.createdAt).toBeTruthy();
  });

  it('addPendingCollect produit un clientId auto si absent', async () => {
    const id = await addPendingCollect({ tourId: 7, cavId: 99, fillLevel: 2 });
    const row = await getItem(STORES.pendingCollects, id);
    expect(row.clientId).toBeTruthy();
    expect(row.fillLevel).toBe(2);
  });

  it('addPendingIncident tolère une description absente', async () => {
    const id = await addPendingIncident({ tourId: 1, type: 'accident' });
    const row = await getItem(STORES.pendingIncidents, id);
    expect(row.type).toBe('accident');
    expect(row.description).toBe(null);
  });

  it('addPendingScan stocke aussi un clientId', async () => {
    const id = await addPendingScan({ tourId: 3, cavId: 10, scannedAt: '2026-04-17T10:00:00Z' });
    const row = await getItem(STORES.pendingScans, id);
    expect(row.clientId).toBeTruthy();
    expect(row.cavId).toBe(10);
  });
});

describe('updatePendingIncident', () => {
  it('met à jour la description sans casser la clé', async () => {
    const id = await addPendingIncident({ tourId: 1, type: 'cav_problem' });
    const updated = await updatePendingIncident(id, { description: 'Serrure cassée' });
    expect(updated.description).toBe('Serrure cassée');
    expect(updated.updatedAt).toBeTruthy();
    const row = await getItem(STORES.pendingIncidents, id);
    expect(row.description).toBe('Serrure cassée');
  });

  it('retourne null si l\u2019id n\u2019existe pas', async () => {
    const res = await updatePendingIncident(99999, { description: 'x' });
    expect(res).toBe(null);
  });
});

describe('CRUD générique', () => {
  it('putItem + getAllItems + deleteItem', async () => {
    await putItem(STORES.tours, { id: 1, name: 'T1' });
    await putItem(STORES.tours, { id: 2, name: 'T2' });
    let all = await getAllItems(STORES.tours);
    expect(all).toHaveLength(2);
    await deleteItem(STORES.tours, 1);
    all = await getAllItems(STORES.tours);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(2);
  });

  it('countItems retourne le bon total', async () => {
    expect(await countItems(STORES.tours)).toBe(0);
    await putItem(STORES.tours, { id: 1 });
    expect(await countItems(STORES.tours)).toBe(1);
  });
});

describe('drafts', () => {
  it('draftKey compose les parties', () => {
    expect(draftKey('collect', 10, 20)).toBe('draft:collect:10:20');
    expect(draftKey('incident', 5, null)).toBe('draft:incident:5');
  });

  it('save + read + clear roundtrip', async () => {
    const key = draftKey('collect', 1, 2);
    expect(await readDraft(key)).toBe(null);
    await saveDraft(key, { fillLevel: 3, anomaly: 'debordement' });
    const got = await readDraft(key);
    expect(got).toEqual({ fillLevel: 3, anomaly: 'debordement' });
    await clearDraft(key);
    expect(await readDraft(key)).toBe(null);
  });
});
