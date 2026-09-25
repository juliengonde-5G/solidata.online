// Comment le chauffeur a désigné le point — et ce qu'on en garde.
//
// Ce que ces tests verrouillent (arbitrage client du 10/09/2026) :
//  1. une déclaration « QR indisponible » n'est JAMAIS bloquée, et emporte la
//     position du chauffeur au moment du geste ;
//  2. un GPS qui refuse ou traîne ne fait pas échouer la déclaration — la
//     position est simplement absente, jamais inventée ;
//  3. une position à moitié lue est écartée : « non relevée » est honnête,
//     une coordonnée partielle se lirait comme une mesure.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Le service lit le GPS par ../src/services/geo — on le pilote.
const getCurrentPosition = vi.fn();
vi.mock('../src/services/geo', () => ({
  getCurrentPosition: (...a) => getCurrentPosition(...a),
  distanceMeters: () => null,
}));

const {
  enregistrerScan, enregistrerQrIndisponible, relevePositionDeclaration,
  lireIdentification, oublierIdentification,
} = await import('../src/services/identification');

// Faux localStorage : l'environnement de test est `node`.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  getCurrentPosition.mockReset();
});
afterEach(() => { delete globalThis.localStorage; });

describe('scan du QR', () => {
  it('ne laisse aucune trace de déclaration derrière lui', () => {
    enregistrerQrIndisponible('CAV-1', 'manual', { lat: 49.4, lng: 1.09, at: 'x' });
    enregistrerScan('CAV-42');
    const id = lireIdentification();
    expect(id.qrScanne).toBe(true);
    expect(id.motif).toBeNull();
    expect(id.position).toBeNull();
  });
});

describe('déclaration « QR indisponible »', () => {
  it('conserve le motif et la position relevée', () => {
    enregistrerQrIndisponible('CAV-7', 'fallback', { lat: 49.4231, lng: 1.0993, accuracy: 12, at: '2026-09-10T08:00:00.000Z' });
    const id = lireIdentification();
    expect(id.qrScanne).toBe(false);
    expect(id.motif).toBe('fallback');
    expect(id.position).toEqual({ lat: 49.4231, lng: 1.0993, accuracy: 12, at: '2026-09-10T08:00:00.000Z' });
  });

  it('reste valable SANS position — un GPS muet ne bloque pas la déclaration', () => {
    enregistrerQrIndisponible('CAV-7', 'manual', null);
    const id = lireIdentification();
    expect(id.qrScanne).toBe(false);
    expect(id.motif).toBe('manual');
    expect(id.position).toBeNull();
  });

  it('écarte une position à moitié lue plutôt que de la rendre à moitié', () => {
    localStorage.setItem('qr_unavailable_reason', 'fallback');
    localStorage.setItem('qr_unavailable_position', JSON.stringify({ lat: 49.4 })); // lng manquante
    expect(lireIdentification().position).toBeNull();
  });

  it('écarte un stockage corrompu sans lever', () => {
    localStorage.setItem('qr_unavailable_reason', 'fallback');
    localStorage.setItem('qr_unavailable_position', '{ pas du json');
    expect(() => lireIdentification()).not.toThrow();
    expect(lireIdentification().position).toBeNull();
  });
});

describe('relevePositionDeclaration', () => {
  it('rend la position horodatée quand le GPS répond', async () => {
    getCurrentPosition.mockResolvedValue({ lat: 49.4231, lng: 1.0993, accuracy: 8 });
    const pos = await relevePositionDeclaration();
    expect(pos.lat).toBe(49.4231);
    expect(pos.lng).toBe(1.0993);
    expect(pos.accuracy).toBe(8);
    expect(Number.isNaN(Date.parse(pos.at))).toBe(false);
  });

  it('rend null — et ne lève pas — quand le GPS refuse ou expire', async () => {
    getCurrentPosition.mockRejectedValue(new Error('permission_denied'));
    await expect(relevePositionDeclaration()).resolves.toBeNull();
  });

  it('borne son attente : le chauffeur ne reste pas devant une borne inaccessible', async () => {
    getCurrentPosition.mockResolvedValue({ lat: 1, lng: 2, accuracy: null });
    await relevePositionDeclaration();
    const options = getCurrentPosition.mock.calls[0][0] || {};
    expect(options.timeout).toBeLessThanOrEqual(8000);
  });
});

describe('oublierIdentification', () => {
  it('efface les trois clés du passage', () => {
    enregistrerQrIndisponible('CAV-7', 'fallback', { lat: 1, lng: 2 });
    oublierIdentification();
    expect(localStorage.getItem('scanned_qr')).toBeNull();
    expect(localStorage.getItem('qr_unavailable_reason')).toBeNull();
    expect(localStorage.getItem('qr_unavailable_position')).toBeNull();
  });
});
