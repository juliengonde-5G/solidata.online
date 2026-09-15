// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Dénominateur des taux de sortie (PR D lot 6, item 6.1)
//   backend/src/services/sorties-engine.js
//
// Moteur PUR : aucune base, aucune requête. Ce fichier tient ce que le contrat
// 25 § 5.2 et la décision 9 de la direction ont arrêté :
//   1. Le dénominateur de la MÉTHODE B est le nombre de PERSONNES dont le
//      parcours s'est terminé — pas le nombre de bilans rédigés.
//   2. La ligne « sortie non documentée » existe et se compte.
//   3. La méthode A n'est imprimée QUE l'année de la double méthode.
//   4. Aucun taux n'est rendu sur un dénominateur nul (« 0 % » serait un
//      résultat, l'absence de sortie n'en est pas un).
//   5. Une cible absente rend un écart nul, jamais une valeur inventée.
// ═══════════════════════════════════════════════════════════════════════════

const {
  calculerSorties, SORTIE_CLASSES, CLASSES_DYNAMIQUES, pct, ecart,
} = require('../../../src/services/sorties-engine');

const fin = (id, num = 1) => ({ employee_id: id, parcours_num: num, insertion_end_date: '2026-06-30' });
const bilan = (id, classification, type = null, num = 1) => ({
  employee_id: id, parcours_num: num, sortie_classification: classification, sortie_type: type,
});

describe('helpers', () => {
  it('pct : jamais 0 % sur un dénominateur nul', () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(3, 0)).toBeNull();
    expect(pct(0, 10)).toBe(0); // zéro sur dix EST un résultat
    expect(pct(1, 3)).toBe(33);
  });

  it('ecart : une cible absente ne produit aucun écart', () => {
    expect(ecart(50, null)).toBeNull();
    expect(ecart(null, 60)).toBeNull();
    expect(ecart(50, 'objectif')).toBeNull();
    expect(ecart(52, 60)).toBe(-8);
  });
});

describe('méthode B — le dénominateur est le nombre de personnes parties', () => {
  it('compte les départs SANS bilan sur la ligne « non documentée »', () => {
    const r = calculerSorties({
      annee: 2026,
      finsParcours: [fin(1), fin(2), fin(3), fin(4), fin(5)],
      bilansClasses: [bilan(1, 'emploi_durable'), bilan(2, 'sortie_positive'), bilan(3, 'autre')],
    });
    expect(r.methode_b.denominateur).toBe(5);
    expect(r.methode_b.documentees).toBe(3);
    expect(r.methode_b.non_documentees).toBe(2);
    expect(r.methode_b.par_classification).toEqual({
      emploi_durable: 1, emploi_transition: 0, sortie_positive: 1, autre: 1, non_documentee: 2,
    });
    // 2 dynamiques sur 5 personnes parties = 40 %. La méthode historique aurait
    // dit 2 sur 3, soit 67 % — c'est toute la rupture de série.
    expect(r.methode_b.taux_pct.dynamiques).toBe(40);
  });

  it('les cinq lignes existent toujours, même à zéro (l’autorité lit les zéros)', () => {
    const r = calculerSorties({ annee: 2026, finsParcours: [fin(1)], bilansClasses: [] });
    for (const c of [...SORTIE_CLASSES, 'non_documentee']) {
      expect(r.methode_b.par_classification).toHaveProperty(c);
    }
    expect(r.methode_b.par_classification.non_documentee).toBe(1);
  });

  it('« dynamique » = emploi durable + transition + autre sortie positive', () => {
    expect(CLASSES_DYNAMIQUES).toEqual(['emploi_durable', 'emploi_transition', 'sortie_positive']);
    const r = calculerSorties({
      annee: 2026,
      finsParcours: [fin(1), fin(2), fin(3), fin(4)],
      bilansClasses: [bilan(1, 'emploi_durable'), bilan(2, 'emploi_transition'),
        bilan(3, 'sortie_positive'), bilan(4, 'autre')],
    });
    expect(r.methode_b.taux_pct.dynamiques).toBe(75);
    expect(r.methode_b.non_documentees).toBe(0);
  });

  it('une même personne comptée deux fois dans les fins ne gonfle pas le dénominateur', () => {
    const r = calculerSorties({
      annee: 2026, finsParcours: [fin(1), fin(1)], bilansClasses: [bilan(1, 'emploi_durable')],
    });
    expect(r.methode_b.denominateur).toBe(1);
  });

  it('le parcours_num distingue deux passages de la même personne', () => {
    const r = calculerSorties({
      annee: 2026,
      finsParcours: [fin(1, 1), fin(1, 2)],
      bilansClasses: [bilan(1, 'emploi_durable', null, 1)],
    });
    expect(r.methode_b.denominateur).toBe(2);
    expect(r.methode_b.documentees).toBe(1);
    expect(r.methode_b.non_documentees).toBe(1);
  });

  it('zéro fin de parcours → dénominateur 0 et AUCUN taux (jamais « 0 % »)', () => {
    const r = calculerSorties({ annee: 2026, finsParcours: [], bilansClasses: [] });
    expect(r.methode_b.denominateur).toBe(0);
    for (const v of Object.values(r.methode_b.taux_pct)) expect(v).toBeNull();
  });

  it('un bilan SANS fin de parcours datée n’entre pas dans la méthode B, et le nombre est DIT', () => {
    // C'est ce nombre qui explique à lui seul l'écart entre les deux
    // dénominateurs ; le taire laisserait croire à une erreur de comptage.
    const r = calculerSorties({
      annee: 2026,
      finsParcours: [fin(1)],
      bilansClasses: [bilan(1, 'emploi_durable'), bilan(99, 'sortie_positive')],
      annee_double_methode: 2026,
    });
    expect(r.methode_b.denominateur).toBe(1);
    expect(r.methode_b.bilans_sans_fin_parcours).toBe(1);
    expect(r.methode_a.denominateur).toBe(2);
    expect(r.regles.join(' ')).toMatch(/aucune fin de parcours datée/);
    // CORRECTIF B-01 — le NOMBRE ne figure plus dans la phrase : elle est
    // imprimée telle quelle dans un document soumis au k-anonymat, qui ne
    // protège que les champs. Un « 1 bilan(s) » glissé dans une chaîne
    // traverserait la passe de suppression sans être vu.
    expect(r.regles.join(' ')).not.toMatch(/1 bilan/);
  });

  it('une classification hors nomenclature est comptée mais NOMMÉE, jamais rangée en silence', () => {
    const r = calculerSorties({
      annee: 2026, finsParcours: [fin(1)], bilansClasses: [bilan(1, 'sortie_bidon')],
    });
    expect(r.methode_b.documentees).toBe(1);
    expect(r.methode_b.par_classification.autre).toBe(1);
    expect(r.methode_b.hors_nomenclature).toBe(1);
  });
});

describe('méthode A — imprimée UNIQUEMENT l’année de la double méthode', () => {
  const jeu = {
    finsParcours: [fin(1), fin(2), fin(3)],
    bilansClasses: [bilan(1, 'emploi_durable'), bilan(2, 'autre')],
  };

  it('2026 (année de la double méthode) → la méthode A est rendue', () => {
    const r = calculerSorties({ ...jeu, annee: 2026, annee_double_methode: 2026 });
    expect(r.methode_a).not.toBeNull();
    expect(r.methode_a.denominateur).toBe(2); // bilans classés seuls
    expect(r.methode_a.taux_pct.dynamiques).toBe(50);
    expect(r.regles.join(' ')).toMatch(/rupture de série/);
  });

  it('2027 → methode_a est null (le document de conventionnement n’imprime qu’une méthode)', () => {
    const r = calculerSorties({ ...jeu, annee: 2027, annee_double_methode: 2026 });
    expect(r.methode_a).toBeNull();
    // Elle reste CALCULÉE pour les surfaces internes, qui l'affichent encore.
    expect(r.methode_a_interne.denominateur).toBe(2);
  });

  it('sans réglage d’année de double méthode → methode_a est null', () => {
    const r = calculerSorties({ ...jeu, annee: 2026, annee_double_methode: null });
    expect(r.methode_a).toBeNull();
  });
});

describe('cibles conventionnelles', () => {
  it('aucune cible → ecart_cible null et la règle « objectif non paramétré » est écrite', () => {
    const r = calculerSorties({
      annee: 2026, finsParcours: [fin(1), fin(2)], bilansClasses: [bilan(1, 'emploi_durable')],
    });
    expect(r.methode_b.ecart_cible).toBeNull();
    expect(r.regles.join(' ')).toMatch(/objectif non paramétré/);
  });

  it('cibles saisies → écart en points sur le dénominateur B, jamais sur la méthode A', () => {
    const r = calculerSorties({
      annee: 2026,
      finsParcours: [fin(1), fin(2), fin(3), fin(4)],
      bilansClasses: [bilan(1, 'emploi_durable'), bilan(2, 'emploi_durable')],
      cibles: { cible_taux_dynamiques: 60, cible_taux_durable: 30 },
    });
    expect(r.methode_b.taux_pct.dynamiques).toBe(50); // 2 / 4
    expect(r.methode_b.ecart_cible.dynamiques).toBe(-10);
    expect(r.methode_b.ecart_cible.emploi_durable).toBe(20);
    // Une cible non saisie reste sans écart, même quand d'autres le sont.
    expect(r.methode_b.ecart_cible.emploi_transition).toBeNull();
  });
});

describe('rapprochement ASP', () => {
  it('aucun état importé → sorties_asp null, écart null, et la note le DIT', () => {
    const r = calculerSorties({ annee: 2026, finsParcours: [fin(1)], bilansClasses: [], sortiesAsp: null });
    expect(r.rapprochement_asp.sorties_asp).toBeNull();
    expect(r.rapprochement_asp.ecart).toBeNull();
    expect(r.rapprochement_asp.note).toMatch(/ne peut pas être fait/);
  });

  it('état importé → écart = fins de parcours de l’outil moins sorties déclarées', () => {
    const r = calculerSorties({
      annee: 2026, finsParcours: [fin(1), fin(2), fin(3)], bilansClasses: [], sortiesAsp: 2,
    });
    expect(r.rapprochement_asp.sorties_asp).toBe(2);
    expect(r.rapprochement_asp.ecart).toBe(1);
    expect(r.rapprochement_asp.note).toMatch(/n'est pas une anomalie/);
  });

  it('zéro sortie déclarée est une VALEUR, pas une absence', () => {
    const r = calculerSorties({ annee: 2026, finsParcours: [fin(1)], bilansClasses: [], sortiesAsp: 0 });
    expect(r.rapprochement_asp.sorties_asp).toBe(0);
    expect(r.rapprochement_asp.ecart).toBe(1);
  });
});

describe('robustesse — entrées dégradées', () => {
  it('appel sans argument ne jette pas et rend un document cohérent', () => {
    const r = calculerSorties();
    expect(r.methode_b.denominateur).toBe(0);
    expect(r.methode_a).toBeNull();
    expect(Array.isArray(r.regles)).toBe(true);
  });

  it('lignes sans identifiant ou sans classification sont écartées, jamais comptées à moitié', () => {
    const r = calculerSorties({
      annee: 2026,
      finsParcours: [fin(1), { employee_id: null }, {}],
      bilansClasses: [bilan(1, 'emploi_durable'), { employee_id: 2, sortie_classification: null }],
    });
    expect(r.methode_b.denominateur).toBe(1);
    expect(r.methode_b.documentees).toBe(1);
  });

  it('la règle « sortie non documentée » ne présente JAMAIS le départ comme une faute', () => {
    const r = calculerSorties({ annee: 2026, finsParcours: [fin(1)], bilansClasses: [] });
    const regle = r.regles.find((x) => /non documentée/.test(x));
    expect(regle).toMatch(/indicateur de qualité de la saisie, pas une faute/);
  });
});
