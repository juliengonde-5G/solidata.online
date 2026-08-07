/**
 * Tests du script repair-vak-from-report.js (v2.21.3 — réparation des VAK
 * depuis le « Rapport des ventes » SumUp, CSV 17 colonnes).
 *
 * CONTEXTE : en production l'API SumUp ne renvoie pas le détail produits →
 * tickets api_sumup/webhook_sumup à ligne globale synthétique quantité 1
 * (VAK juillet : 645 kg affichés au lieu de 2 786,9 kg). Le rapport CSV est
 * LA source de vérité (quantités décimales, unité kg/pce explicite, colonne
 * « Compte » de caisse) : le script remplace les lignes des tickets existants,
 * crée les tickets manquants et renseigne le compte.
 *
 * On teste les fonctions PURES exportées (aucune DB) :
 *  - parseReportCSV : groupage par Réf. transaction, kg/pce explicites,
 *    remboursements signés, compte extrait, quantités décimales ;
 *  - construireTicket : agrégats (poids signé, totaux, compte) ;
 *  - lignesIdentiques / ticketIdentique / decideAction : remplacement des
 *    lignes synthétiques, création des trous, idempotence (re-run = inchangé),
 *    mise à jour du compte seul ;
 *  - parseArgs : --dry-run par défaut, --apply, --file, --vak.
 */

const {
  parseArgs,
  parseReportCSV,
  construireTicket,
  lignesIdentiques,
  ticketIdentique,
  decideAction,
} = require('../../../src/scripts/repair-vak-from-report');

// ── Fixture : mini-rapport réaliste (en-tête + 12 lignes, 7 transactions) ──
// 2 transactions kilo multi/mono-lignes (dont chaussures au poids), 1
// remboursement, 2 tickets Vintiz (compte différent), des sacs à la pièce et
// 1 transaction « trou de sync » (inconnue en base côté decideAction).
const CSV = [
  'Date,Type,Réf. transaction,Moyen de paiement,Quantité,Unité,Description,Catégorie,SKU,Devise,Prix avant réduction,Réduction,Prix (TTC),Prix (HT),TVA,Taux de TVA,Compte',
  '"10 juil. 2026 10:15",Vente,TREPKILO01,Carte,"10,575",kg,Vente Plus de 5 kilos,VAK,,EUR,"15,86",0,"15,86","13,22","2,64",20 %,Caissier Frip & Co',
  '"10 juil. 2026 10:15",Vente,TREPKILO01,Carte,"1,595",kg,Chaussures,VAK,,EUR,"4,79",0,"4,79","3,99","0,80",20 %,Caissier Frip & Co',
  '"10 juil. 2026 10:15",Vente,TREPKILO01,Carte,2,pce,Sacs,VAK,,EUR,"0,30",0,"0,30","0,25","0,05",20 %,Caissier Frip & Co',
  '"10 juil. 2026 11:02",Vente,TREPKILO02,Espèces,"3,2",kg,Vente Moins de 5 Kg,VAK,,EUR,"8,00",0,"8,00","6,67","1,33",20 %,Caissier Frip & Co',
  '"10 juil. 2026 11:02",Vente,TREPKILO02,Espèces,1,pce,Sacs,VAK,,EUR,"0,15",0,"0,15","0,13","0,02",20 %,Caissier Frip & Co',
  '"11 juil. 2026 09:40",Remboursement,TREPREMB01,Carte,2,kg,Vente Moins de 5 Kg,VAK,,EUR,"5,00",0,"5,00","4,17","0,83",20 %,Caissier Frip & Co',
  '"10 juil. 2026 14:20",Vente,TVINTIZ001,Carte,1,pce,Vente Vintiz #12,Vintiz,,EUR,"12,00",0,"12,00","10,00","2,00",20 %,Caisse Vintiz',
  '"11 juil. 2026 15:05",Vente,TVINTIZ002,Espèces,1,pce,Vintiz Pantalon,Vintiz,,EUR,"9,50",0,"9,50","7,92","1,58",20 %,Caisse Vintiz',
  '"11 juil. 2026 16:30",Vente,TREPTROU01,Carte,"0,92",kg,Vente Moins de 5 Kg,VAK,,EUR,"2,30",0,"2,30","1,92","0,38",20 %,Caissier Frip & Co',
  '"11 juil. 2026 16:45",Vente,TREPTROU01,Carte,1,pce,Sacs,VAK,,EUR,"0,15",0,"0,15","0,13","0,02",20 %,Caissier Frip & Co',
  '"11 juil. 2026 17:00",Vente,TREPDELES1,Carte,1,pce,Article divers,Divers,,EUR,"3,00",0,"3,00","2,50","0,50",20 %,Delestre Antoine',
].join('\n');

function tx(parsed, ref) {
  return parsed.transactions.find((t) => t.ref === ref);
}

describe('repair-vak-from-report — parseReportCSV (rapport 17 colonnes)', () => {
  const parsed = parseReportCSV(CSV);

  test('groupe les lignes par Réf. transaction (7 transactions, 0 erreur)', () => {
    expect(parsed.erreurs).toHaveLength(0);
    expect(parsed.transactions).toHaveLength(7);
    expect(tx(parsed, 'TREPKILO01').lignes).toHaveLength(3);
    expect(tx(parsed, 'TREPKILO02').lignes).toHaveLength(2);
    expect(tx(parsed, 'TREPTROU01').lignes).toHaveLength(2);
  });

  test('transaction kilo multi-lignes : poids = textile + CHAUSSURES (12,17 kg), sacs à la pièce', () => {
    const t = tx(parsed, 'TREPKILO01');
    expect(t.poids_kg).toBeCloseTo(12.17, 3); // 10,575 + 1,595 — les chaussures pèsent
    expect(t.total_ttc).toBeCloseTo(20.95, 2);
    expect(t.nb_articles).toBe(3);
    expect(t.compte).toBe('Caissier Frip & Co');
    expect(t.moyen_paiement).toBe('CB'); // « Carte » normalisé
    const chaussures = t.lignes.find((l) => l.description === 'Chaussures');
    expect(chaussures.unite).toBe('kg');
    expect(chaussures.quantite).toBeCloseTo(1.595, 3);
    expect(chaussures.segment).toBe('chaussures');
    const sacs = t.lignes.find((l) => l.description === 'Sacs');
    expect(sacs.unite).toBe('pce');
    expect(sacs.segment).toBe('consommables');
  });

  test('quantités décimales à virgule préservées (3,2 kg — jamais de parseInt)', () => {
    const t = tx(parsed, 'TREPKILO02');
    expect(t.poids_kg).toBeCloseTo(3.2, 3);
    expect(t.moyen_paiement).toBe('Espèces');
    const kg = t.lignes.find((l) => l.unite === 'kg');
    expect(kg.quantite).toBeCloseTo(3.2, 3);
    expect(kg.segment).toBe('textile_vrac');
  });

  test('remboursement : lignes, poids et totaux NÉGATIFS', () => {
    const t = tx(parsed, 'TREPREMB01');
    expect(t.poids_kg).toBeCloseTo(-2, 3);
    expect(t.total_ttc).toBeCloseTo(-5, 2);
    expect(t.lignes[0].quantite).toBeCloseTo(-2, 3);
    expect(t.lignes[0].total_ttc).toBeCloseTo(-5, 2);
  });

  test('colonne « Compte » extraite (Vintiz ≠ Frip & Co ≠ Delestre)', () => {
    expect(tx(parsed, 'TVINTIZ001').compte).toBe('Caisse Vintiz');
    expect(tx(parsed, 'TVINTIZ002').compte).toBe('Caisse Vintiz');
    expect(tx(parsed, 'TREPDELES1').compte).toBe('Delestre Antoine');
    expect(tx(parsed, 'TREPKILO01').compte).toBe('Caissier Frip & Co');
    // Vintiz : descriptions hors segments VAK → 'autre', à la pièce, poids 0
    const v = tx(parsed, 'TVINTIZ001');
    expect(v.poids_kg).toBe(0);
    expect(v.lignes[0].segment).toBe('autre');
  });

  test('dates : heure murale Paris convertie en UTC (juillet = UTC+2), date du ticket = 1re ligne', () => {
    const t = tx(parsed, 'TREPKILO01');
    expect(t.date_ticket.toISOString()).toBe('2026-07-10T08:15:00.000Z');
    // TREPTROU01 : 2 lignes 16:30 et 16:45 → le ticket prend 16:30
    expect(tx(parsed, 'TREPTROU01').date_ticket.toISOString()).toBe('2026-07-11T14:30:00.000Z');
  });
});

describe('repair-vak-from-report — decideAction (réparation, idempotence)', () => {
  const parsed = parseReportCSV(CSV);
  const calcule = tx(parsed, 'TREPKILO02'); // 3,2 kg + 1 sac, 8,15 € TTC

  // Ticket api_sumup typique de prod : ligne globale SYNTHÉTIQUE quantité 1.
  const ticketSynthetique = {
    id: 42, vak_id: 3, source: 'api_sumup', ref_transaction: 'TREPKILO02',
    compte: null, nb_articles: 1, poids_kg: 1, total_ttc: 8.15, total_ht: 6.8, total_tva: 1.35,
  };
  const lignesSynthetiques = [
    { description: 'Vente', segment: 'autre', unite: 'kg', quantite: 1, total_ttc: 8.15, compte: null },
  ];

  test('lignes synthétiques ≠ lignes CSV → REPLACE (reconstruction du poids réel)', () => {
    expect(decideAction(ticketSynthetique, lignesSynthetiques, calcule)).toBe('replace');
  });

  test('aucun ticket en base → CREATE (trou de sync comblé)', () => {
    expect(decideAction(null, [], tx(parsed, 'TREPTROU01'))).toBe('create');
  });

  test('IDempotence : lignes ET agrégats identiques → inchangé (re-run = 0 changement)', () => {
    // État de la base APRÈS un 1er passage du script : lignes = lignes CSV,
    // agrégats recalculés, compte posé.
    const ticketRepare = {
      ...ticketSynthetique,
      compte: 'Caissier Frip & Co',
      nb_articles: calcule.nb_articles,
      poids_kg: calcule.poids_kg,
      total_ttc: calcule.total_ttc,
      total_ht: calcule.total_ht,
      total_tva: calcule.total_tva,
    };
    expect(decideAction(ticketRepare, calcule.lignes, calcule)).toBe('inchange');
  });

  test('garde anti-dégradation : ticket csv_manuel déjà détaillé ET identique → jamais réécrit', () => {
    const t1 = tx(parsed, 'TREPKILO01');
    const ticketCsv = {
      id: 7, vak_id: 3, source: 'csv_manuel', ref_transaction: 'TREPKILO01',
      compte: 'Caissier Frip & Co', nb_articles: 3, poids_kg: 12.17,
      total_ttc: 20.95, total_ht: 17.46, total_tva: 3.49,
    };
    expect(decideAction(ticketCsv, t1.lignes, t1)).toBe('inchange');
  });

  test('lignes identiques mais compte absent → MAJ_TICKET (compte renseigné sans réécrire les lignes)', () => {
    const t1 = tx(parsed, 'TREPKILO01');
    const ticketSansCompte = {
      id: 7, vak_id: 3, source: 'csv_manuel', ref_transaction: 'TREPKILO01',
      compte: null, nb_articles: 3, poids_kg: 12.17,
      total_ttc: 20.95, total_ht: 17.46, total_tva: 3.49,
    };
    expect(decideAction(ticketSansCompte, t1.lignes, t1)).toBe('maj_ticket');
  });

  test('lignesIdentiques : comparaison en multiset (ordre indifférent), sensible au poids', () => {
    const t1 = tx(parsed, 'TREPKILO01');
    const inversees = [...t1.lignes].reverse();
    expect(lignesIdentiques(inversees, t1.lignes)).toBe(true);
    const poidsFaux = t1.lignes.map((l) => (l.description === 'Chaussures' ? { ...l, quantite: 1 } : l));
    expect(lignesIdentiques(poidsFaux, t1.lignes)).toBe(false);
  });

  test('ticketIdentique : tolérance au centime / au gramme, compte insensible à la casse', () => {
    const t1 = tx(parsed, 'TREPKILO01');
    const stored = {
      compte: 'caissier frip & co', nb_articles: 3, poids_kg: 12.1701,
      total_ttc: 20.951, total_ht: 17.46, total_tva: 3.49,
    };
    expect(ticketIdentique({ ...stored, total_ht: t1.total_ht, total_tva: t1.total_tva }, t1)).toBe(true);
    expect(ticketIdentique({ ...stored, poids_kg: 1, total_ht: t1.total_ht, total_tva: t1.total_tva }, t1)).toBe(false);
  });
});

describe('repair-vak-from-report — parseArgs', () => {
  test('--dry-run par défaut, --file requis, --apply et --vak reconnus', () => {
    expect(parseArgs([])).toEqual({ apply: false, file: null, vakId: null });
    expect(parseArgs(['--file=/tmp/r.csv'])).toEqual({ apply: false, file: '/tmp/r.csv', vakId: null });
    expect(parseArgs(['--file=/tmp/r.csv', '--apply', '--vak=12']))
      .toEqual({ apply: true, file: '/tmp/r.csv', vakId: 12 });
    expect(parseArgs(['--apply', '--dry-run']).apply).toBe(false);
  });
});
