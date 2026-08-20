import { describe, it, expect } from 'vitest';
import { computePhotoRequirement } from '../src/services/cavPhoto.js';

// Exigence 08/2026 — photo du point de collecte :
//  1. toujours possible d'en ajouter une ;
//  2. demandée (bloquante) si le point n'a aucune photo ;
//  3. demandée si la photo est périmée (décision serveur `photo_requise`) ;
//  4. rien n'est demandé si une photo fraîche existe ;
//  + hors ligne : jamais bloquante (doctrine offline de l'app).

const point = (over = {}) => ({ cav_id: 7, photo_requise: false, cav_photo_path: null, ...over });

describe('computePhotoRequirement — point sans photo', () => {
  it('photo demandée et bloquante en ligne', () => {
    const r = computePhotoRequirement({ point: point({ photo_requise: true }), online: true });
    expect(r.required).toBe(true);
    expect(r.blocking).toBe(true);
    expect(r.reason).toBe('absente');
    expect(r.hint).toMatch(/pas encore de photo/i);
  });
});

describe('computePhotoRequirement — photo périmée', () => {
  it('photo demandée, message indiquant le seuil paramétré', () => {
    const r = computePhotoRequirement({
      point: point({ photo_requise: true, cav_photo_path: '/uploads/cav-photos/cav_7.png' }),
      online: true,
      fraicheurMois: 6,
    });
    expect(r.reason).toBe('perimee');
    expect(r.blocking).toBe(true);
    expect(r.hint).toContain('6 mois');
  });

  it('reprend le seuil réellement paramétré (3 mois)', () => {
    const r = computePhotoRequirement({
      point: point({ photo_requise: true, cav_photo_path: '/p.png' }),
      fraicheurMois: 3,
    });
    expect(r.hint).toContain('3 mois');
  });
});

describe('computePhotoRequirement — photo fraîche', () => {
  it('rien n\'est demandé, la prise reste possible (libellé facultatif)', () => {
    const r = computePhotoRequirement({
      point: point({ photo_requise: false, cav_photo_path: '/p.png' }),
      online: true,
    });
    expect(r.required).toBe(false);
    expect(r.blocking).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.title).toMatch(/facultatif/i);
  });
});

describe('computePhotoRequirement — contrôle aléatoire (photo d\'audit)', () => {
  it('reste exigé même quand le CAV a une photo fraîche', () => {
    const r = computePhotoRequirement({
      point: point({ photo_requise: false, cav_photo_path: '/p.png' }),
      auditRequired: true,
      online: true,
    });
    expect(r.required).toBe(true);
    expect(r.blocking).toBe(true);
    expect(r.reason).toBe('audit');
  });

  it('l\'exigence du point prime sur le motif « audit » dans le message', () => {
    const r = computePhotoRequirement({
      point: point({ photo_requise: true }),
      auditRequired: true,
    });
    expect(r.reason).toBe('absente');
  });
});

describe('computePhotoRequirement — hors ligne', () => {
  it('la photo reste demandée mais NE BLOQUE JAMAIS la tournée', () => {
    const r = computePhotoRequirement({ point: point({ photo_requise: true }), online: false });
    expect(r.required).toBe(true);
    expect(r.blocking).toBe(false);
  });

  it('idem pour le contrôle aléatoire hors ligne', () => {
    const r = computePhotoRequirement({ point: point(), auditRequired: true, online: false });
    expect(r.required).toBe(true);
    expect(r.blocking).toBe(false);
  });
});

describe('computePhotoRequirement — robustesse', () => {
  it('sans point (payload non chargé) : rien n\'est exigé, jamais de blocage inventé', () => {
    const r = computePhotoRequirement({});
    expect(r.required).toBe(false);
    expect(r.blocking).toBe(false);
    expect(r.reason).toBeNull();
  });
});
