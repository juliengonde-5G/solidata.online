/**
 * Module 33 « Temps & Présence » — moteur de calcul PUR.
 *
 * Couvre les cas limites EXIGÉS par la spécification (SPEC §5.4, NOTE_RH §3,
 * ADR-0002) :
 *  - journée à cheval sur minuit ;
 *  - bascules d'heure d'ÉTÉ et d'HIVER (les durées portent sur des instants,
 *    donc la nuit « à 25 heures » est comptée telle qu'elle a duré) ;
 *  - temps partiel, séquence impaire, journée de 14 h ;
 *  - double pointage à 8 s (dédoublonné côté poste, toléré ici) ;
 *  - arrondi à l'avantage du salarié PROUVÉ dans les deux sens ;
 *  - tolérance de retard, déduction de pause (avec et sans pointage intermédiaire) ;
 *  - corrections additives : annulation / modification / ajout ;
 *  - AUCUNE RÈGLE EN DUR : le même jeu d'événements calculé avec deux grilles de
 *    paramètres différentes doit donner deux résultats différents.
 */
const engine = require('../../../src/services/badgeuse-engine');

// Grille de référence = défauts ADR-0002 (recommandations RH écrites).
const PARAMS = {
  pointages_par_jour: 4,
  arrondi_minutes: 5,
  arrondi_sens: 'avantage_salarie',
  tolerance_retard_minutes: 5,
  badge_avant_heure_compte: false,
  pause_deduite_minutes: 45,
  pause_deduite_seuil_heures: 6,
  journee_max_heures: 10,
  anti_rebond_sec: 8,
  plage_acceptation_debut: '05:00',
  plage_acceptation_fin: '21:00',
};

/** Événement effectif à partir d'un instant UTC ISO. */
const ev = (iso, sens) => ({ horodatage_utc: new Date(iso), sens, source: 'badge' });
/** Pointage brut « tel qu'en base ». */
const pt = (id, iso, sens, extra = {}) => ({
  id, employee_id: 5, horodatage_utc: iso, sens, source: 'badge', statut: 'brut', ...extra,
});
const types = (jour) => jour.anomalies.map((a) => a.type);

describe('journée nominale et déduction de pause (NOTE_RH §3)', () => {
  test('08:00→17:00 sans pointage intermédiaire : 9 h − 45 min de pause = 8,25 h', () => {
    // Été (Paris = UTC+2) : 06:00Z = 08:00 Paris.
    const j = engine.computeDay(
      [ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T15:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17' }
    );
    expect(j.minutes_brutes).toBe(540);
    expect(j.pause_deduite_minutes).toBe(45);
    expect(j.heures).toBe(8.25);
    expect(j.regles_appliquees).toContain('pause_deduite');
  });

  test('4 pointages : la pause badgée n\'est PAS déduite une seconde fois', () => {
    const j = engine.computeDay([
      ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie'),
      ev('2026-08-17T11:00:00Z', 'entree'), ev('2026-08-17T15:00:00Z', 'sortie'),
    ], PARAMS, { date: '2026-08-17' });
    expect(j.paires).toHaveLength(2);
    expect(j.pause_deduite_minutes).toBe(0);
    expect(j.heures).toBe(8);
    expect(j.regles_appliquees).not.toContain('pause_deduite');
  });

  test('journée SOUS le seuil de 6 h : aucune déduction', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T11:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17' }
    );
    expect(j.pause_deduite_minutes).toBe(0);
    expect(j.heures).toBe(5);
  });

  test('temps partiel (4 h le matin) : compté au réel, sans pause', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T07:00:00Z', 'entree'), ev('2026-08-17T11:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17' }
    );
    expect(j.heures).toBe(4);
    expect(j.anomalies).toHaveLength(0);
  });
});

describe('QA-06 — la déduction de pause est MONOTONE (ADR-0002 addendum §1)', () => {
  // Journée d'une seule paire (pause NON badgée), démarrée à 08:00 Paris.
  const journeeDe = (minutes) => engine.computeDay([
    ev('2026-08-17T06:00:00Z', 'entree'),
    ev(new Date(Date.parse('2026-08-17T06:00:00Z') + minutes * 60000).toISOString(), 'sortie'),
  ], PARAMS, { date: '2026-08-17' });

  // Les 4 points chiffrés du rapport QA §4.4 — la « zone morte » de 45 min
  // (]6 h 00 ; 6 h 45]) doit avoir disparu.
  test.each([
    [360, 360], // 6 h 00 pile : sous le seuil, aucune déduction
    [361, 360], // 6 h 01 : AVANT le correctif, 316 min (44 min de moins que 6 h 00)
    [405, 360], // 6 h 45 : déduction plafonnée au dépassement
    [420, 375], // 7 h 00 : déduction complète possible sans passer sous le seuil
    [540, 495], // 9 h 00 : régime nominal, 45 min pleines
  ])('%i minutes travaillées → %i minutes payées', (brutes, payees) => {
    expect(journeeDe(brutes).minutes).toBe(payees);
  });

  test('la fonction de paie est CROISSANTE minute par minute autour du seuil', () => {
    let precedent = -1;
    for (let m = 350; m <= 430; m += 1) {
      const payees = journeeDe(m).minutes;
      expect(payees).toBeGreaterThanOrEqual(precedent);
      precedent = payees;
    }
  });

  test('la déduction ne fait JAMAIS passer la journée sous le seuil', () => {
    for (let m = 361; m <= 420; m += 1) {
      expect(journeeDe(m).minutes).toBeGreaterThanOrEqual(360);
    }
  });

  test('avec pause badgée (2 paires), aucune déduction — règle inchangée', () => {
    const j = engine.computeDay([
      ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie'),
      ev('2026-08-17T10:30:00Z', 'entree'), ev('2026-08-17T12:31:00Z', 'sortie'),
    ], PARAMS, { date: '2026-08-17' });
    expect(j.pause_deduite_minutes).toBe(0);
    expect(j.minutes).toBe(361);
  });
});

describe('QA-05 — pointages incomplets et taux de pointages complets', () => {
  const journeeLongue2Pointages = [ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T15:00:00Z', 'sortie')];
  const journeeLongue4Pointages = [
    ev('2026-08-18T06:00:00Z', 'entree'), ev('2026-08-18T10:00:00Z', 'sortie'),
    ev('2026-08-18T11:00:00Z', 'entree'), ev('2026-08-18T15:00:00Z', 'sortie'),
  ];

  test('journée > seuil de pause avec 2 pointages sur 4 attendus → anomalie `pointages_incomplets`', () => {
    const jours = engine.computeDays(journeeLongue2Pointages, PARAMS);
    const anomalies = engine.detectAnomalies(jours, PARAMS, { employee_id: 5 });
    const a = anomalies.find((x) => x.type === 'pointages_incomplets');
    expect(a).toMatchObject({ employee_id: 5, date: '2026-08-17', severite: 'info' });
    expect(a.detail).toContain('4 attendus');
  });

  test('journée > seuil avec les 4 pointages attendus → aucune anomalie', () => {
    const jours = engine.computeDays(journeeLongue4Pointages, PARAMS);
    expect(engine.detectAnomalies(jours, PARAMS, {}).map((x) => x.type))
      .not.toContain('pointages_incomplets');
  });

  test('demi-journée SOUS le seuil de pause : jamais signalée (aucune règle inventée)', () => {
    const jours = engine.computeDays([ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')], PARAMS);
    expect(engine.detectAnomalies(jours, PARAMS, {}).map((x) => x.type))
      .not.toContain('pointages_incomplets');
  });

  test('le seuil vient du PARAMÈTRE : à pointages_par_jour = 2, la journée redevient complète', () => {
    const jours = engine.computeDays(journeeLongue2Pointages, PARAMS);
    expect(engine.detectAnomalies(jours, { ...PARAMS, pointages_par_jour: 2 }, {}).map((x) => x.type))
      .not.toContain('pointages_incomplets');
    // Paramètre absent → aucun signalement (règle non arbitrée = pas de règle).
    expect(engine.detectAnomalies(jours, { ...PARAMS, pointages_par_jour: 0 }, {}).map((x) => x.type))
      .not.toContain('pointages_incomplets');
  });

  test('computeMonth expose le taux de pointages complets (indicateur NOTE_RH §9)', () => {
    const jours = engine.computeDays([...journeeLongue2Pointages, ...journeeLongue4Pointages], PARAMS);
    const mois = engine.computeMonth(jours, PARAMS, { periode: '2026-08' });
    expect(mois.jours_pointage_attendu).toBe(2);
    expect(mois.jours_pointage_complet).toBe(1);
    expect(mois.taux_pointages_complets_pct).toBe(50);
  });

  test('aucune journée soumise → taux null, JAMAIS 0 %', () => {
    const jours = engine.computeDays([ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T09:00:00Z', 'sortie')], PARAMS);
    const mois = engine.computeMonth(jours, PARAMS, { periode: '2026-08' });
    expect(mois.jours_pointage_attendu).toBe(0);
    expect(mois.taux_pointages_complets_pct).toBeNull();
  });
});

describe('QA-03 — heures théoriques du mois (ADR-0002 addendum §3)', () => {
  test('jours ouvrés du mois : lun→ven, même définition que le moteur ETP', () => {
    expect(engine.joursOuvresDuMois('2026-08')).toBe(21); // août 2026
    expect(engine.joursOuvresDuMois('2026-02')).toBe(20); // février 2026
    expect(engine.joursOuvresDuMois('2024-02')).toBe(21); // bissextile
    expect(engine.joursOuvresDuMois('pas-une-periode')).toBeNull();
    expect(engine.joursOuvresDuMois('2026-13')).toBeNull();
  });

  test('35 h hebdo × 21 jours ouvrés ÷ 5 = 147 h (août 2026)', () => {
    expect(engine.heuresTheoriquesMois(35, '2026-08')).toBe(147);
  });

  test('temps partiel : 26 h hebdo → 109,2 h, arrondi 2 décimales', () => {
    expect(engine.heuresTheoriquesMois(26, '2026-08')).toBe(109.2);
    expect(engine.heuresTheoriquesMois(28, '2026-02')).toBe(112);
  });

  test('aucune heure contractuelle connue → null, JAMAIS 0 (« jamais de valeur inventée »)', () => {
    expect(engine.heuresTheoriquesMois(null, '2026-08')).toBeNull();
    expect(engine.heuresTheoriquesMois(undefined, '2026-08')).toBeNull();
    expect(engine.heuresTheoriquesMois(0, '2026-08')).toBeNull();
    expect(engine.heuresTheoriquesMois('', '2026-08')).toBeNull();
    expect(engine.heuresTheoriquesMois(35, 'invalide')).toBeNull();
  });

  test('computeMonth calcule l\'écart dès que le théorique est fourni', () => {
    const jours = engine.computeDays([ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')], PARAMS);
    const mois = engine.computeMonth(jours, PARAMS, { periode: '2026-08', heures_theoriques: engine.heuresTheoriquesMois(35, '2026-08') });
    expect(mois.heures_theoriques).toBe(147);
    expect(mois.ecart_heures).toBe(-143);
  });
});

describe('QA-05 — délai de signalement en jours OUVRÉS', () => {
  test('compte les jours ouvrés, départ exclu et arrivée incluse', () => {
    // Lundi 17/08/2026 → vendredi 21/08 = 4 jours ouvrés.
    expect(engine.joursOuvresEcoules('2026-08-17', '2026-08-21')).toBe(4);
    // Le week-end ne compte pas : vendredi 21 → lundi 24 = 1 jour ouvré.
    expect(engine.joursOuvresEcoules('2026-08-21', '2026-08-24')).toBe(1);
    // Même jour, ou arrivée antérieure → 0, jamais un nombre négatif.
    expect(engine.joursOuvresEcoules('2026-08-17', '2026-08-17')).toBe(0);
    expect(engine.joursOuvresEcoules('2026-08-21', '2026-08-17')).toBe(0);
  });

  test('un mois plus tard dépasse largement le délai de 5 jours ouvrés', () => {
    expect(engine.joursOuvresEcoules('2026-07-17', '2026-08-17')).toBeGreaterThan(5);
  });

  test('borne illisible → null (aucun avertissement inventé)', () => {
    expect(engine.joursOuvresEcoules('pas-une-date', '2026-08-17')).toBeNull();
    expect(engine.joursOuvresEcoules('2026-08-17', null)).toBeNull();
  });
});

describe('arrondi : entrée au pas INFÉRIEUR, sortie AU RÉEL (ADR-0002 add. §2, QA-10)', () => {
  test('l\'entrée recule au pas inférieur, la sortie est comptée telle qu\'elle a été badgée', () => {
    // Exemple chiffré de l'addendum : entrée 08:03 au pas de 5 min → 08:00 ;
    // sortie 16:58 → 16:58 (AUCUN arrondi, lettre de NOTE_RH §3).
    const j = engine.computeDay(
      [ev('2026-08-17T06:03:00Z', 'entree'), ev('2026-08-17T14:58:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17' }
    );
    expect(j.paires[0].entree_comptee_utc).toBe('2026-08-17T06:00:00.000Z');
    expect(j.paires[0].sortie_comptee_utc).toBe('2026-08-17T14:58:00.000Z');
    // 8 h 55 réelles → 8 h 58 comptées avant pause : l'arrondi d'entrée ne
    // retire jamais de temps, et la sortie n'en ajoute plus.
    expect(j.minutes_brutes).toBe(538);
  });

  test('QA-10 : la sortie n\'est JAMAIS remontée au pas supérieur', () => {
    // Régression du défaut : 12:03 était compté 12:05 (+2 min offertes).
    const j = engine.computeDay(
      [ev('2026-08-17T06:02:00Z', 'entree'), ev('2026-08-17T10:03:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17' }
    );
    expect(j.paires[0].entree_comptee_utc).toBe('2026-08-17T06:00:00.000Z');
    expect(j.paires[0].sortie_comptee_utc).toBe('2026-08-17T10:03:00.000Z');
    expect(j.minutes).toBe(243);
    expect(j.regles_appliquees).toContain('arrondi');
  });

  test('arrondirInstant : la borne « sortie » est l\'identité en grille arbitrée', () => {
    const ms = Date.parse('2026-08-17T10:03:00Z');
    expect(engine.arrondirInstant(ms, 'sortie', PARAMS)).toBe(ms);
    expect(engine.arrondirInstant(ms, 'entree', PARAMS)).toBe(Date.parse('2026-08-17T10:00:00Z'));
  });

  test('l\'arrondi ne peut jamais réduire le temps compté (invariant)', () => {
    for (const [entree, sortie] of [
      ['2026-08-17T06:01:00Z', '2026-08-17T10:01:00Z'],
      ['2026-08-17T06:04:00Z', '2026-08-17T10:04:00Z'],
      ['2026-08-17T06:00:00Z', '2026-08-17T10:00:00Z'],
    ]) {
      const reel = (new Date(sortie) - new Date(entree)) / 60000;
      const j = engine.computeDay([ev(entree, 'entree'), ev(sortie, 'sortie')], PARAMS, { date: '2026-08-17' });
      expect(j.minutes_brutes).toBeGreaterThanOrEqual(reel);
    }
  });

  test('arrondi_sens = « proche » : arrondi au plus proche (règle alternative paramétrable)', () => {
    const params = { ...PARAMS, arrondi_sens: 'proche' };
    const j = engine.computeDay(
      [ev('2026-08-17T06:02:00Z', 'entree'), ev('2026-08-17T10:01:00Z', 'sortie')],
      params, { date: '2026-08-17' }
    );
    expect(j.paires[0].entree_comptee_utc).toBe('2026-08-17T06:00:00.000Z');
    expect(j.paires[0].sortie_comptee_utc).toBe('2026-08-17T10:00:00.000Z');
  });

  test('arrondi_minutes = 0 : aucun arrondi, décompte au réel', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T06:02:00Z', 'entree'), ev('2026-08-17T10:03:00Z', 'sortie')],
      { ...PARAMS, arrondi_minutes: 0 }, { date: '2026-08-17' }
    );
    expect(j.minutes_brutes).toBe(241);
    expect(j.regles_appliquees).not.toContain('arrondi');
  });
});

describe('heure planifiée, badgeage en avance et tolérance de retard', () => {
  test('arrivée en avance → ramenée à l\'heure planifiée (temps d\'attente non travaillé)', () => {
    // 07:40 Paris pour une prise de poste à 08:00.
    const j = engine.computeDay(
      [ev('2026-08-17T05:40:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17', heure_planifiee_debut: '08:00' }
    );
    expect(j.heures).toBe(4);
    expect(j.regles_appliquees).toContain('entree_avant_heure_non_comptee');
  });

  test('badge_avant_heure_compte = true : l\'avance EST comptée (règle inverse paramétrable)', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T05:40:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')],
      { ...PARAMS, badge_avant_heure_compte: true },
      { date: '2026-08-17', heure_planifiee_debut: '08:00' }
    );
    expect(j.heures).toBe(4.33);
  });

  test('retard DANS la tolérance (3 min ≤ 5) : sans effet paie', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T06:03:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17', heure_planifiee_debut: '08:00' }
    );
    expect(j.heures).toBe(4);
    expect(j.regles_appliquees).toContain('tolerance_retard');
  });

  test('retard AU-DELÀ de la tolérance (20 min) : décompte réel', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T06:20:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17', heure_planifiee_debut: '08:00' }
    );
    expect(j.heures).toBe(3.67);
    expect(j.regles_appliquees).not.toContain('tolerance_retard');
  });

  test('la tolérance ne s\'applique qu\'à la PRISE DE POSTE, pas aux retours de pause', () => {
    const j = engine.computeDay([
      ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie'),
      ev('2026-08-17T11:03:00Z', 'entree'), ev('2026-08-17T15:00:00Z', 'sortie'),
    ], PARAMS, { date: '2026-08-17', heure_planifiee_debut: '08:00' });
    // Le retour de pause à 13:03 est arrondi au pas (13:00), pas recalé sur 08:00.
    expect(j.paires[1].entree_comptee_utc).toBe('2026-08-17T11:00:00.000Z');
  });
});

describe('passage à minuit et bascules d\'heure (fuseau Europe/Paris)', () => {
  test('journée à cheval sur minuit : la durée est continue', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T20:00:00Z', 'entree'), ev('2026-08-18T00:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17' }
    );
    expect(j.heures).toBe(4);
    expect(j.anomalies).toHaveLength(0);
  });

  test('la paire à cheval est rattachée au jour civil de son ENTRÉE', () => {
    const jours = engine.computeDays([
      ev('2026-08-17T20:00:00Z', 'entree'), ev('2026-08-18T00:00:00Z', 'sortie'),
      ev('2026-08-18T20:00:00Z', 'entree'), ev('2026-08-19T00:00:00Z', 'sortie'),
    ], PARAMS);
    expect(jours.map((j) => j.date)).toEqual(['2026-08-17', '2026-08-18']);
    expect(jours.map((j) => j.heures)).toEqual([4, 4]);
  });

  test('passage à l\'heure d\'HIVER (26/10/2025) : la nuit dure une heure de PLUS que l\'horloge murale', () => {
    // 01:00 Paris (UTC+2) → 05:00 Paris (UTC+1) : 4 h au mur, 5 h réellement.
    const j = engine.computeDay(
      [ev('2025-10-25T23:00:00Z', 'entree'), ev('2025-10-26T04:00:00Z', 'sortie')],
      PARAMS, { date: '2025-10-26' }
    );
    expect(engine.parisTimeStr(new Date('2025-10-25T23:00:00Z'))).toBe('01:00');
    expect(engine.parisTimeStr(new Date('2025-10-26T04:00:00Z'))).toBe('05:00');
    expect(j.minutes_brutes).toBe(300); // 5 h travaillées, et non 4
  });

  test('passage à l\'heure d\'ÉTÉ (29/03/2026) : la nuit dure une heure de MOINS', () => {
    // 00:30 Paris (UTC+1) → 06:00 Paris (UTC+2) : 5 h 30 au mur, 4 h 30 réellement.
    const j = engine.computeDay(
      [ev('2026-03-28T23:30:00Z', 'entree'), ev('2026-03-29T04:00:00Z', 'sortie')],
      PARAMS, { date: '2026-03-29' }
    );
    expect(engine.parisTimeStr(new Date('2026-03-28T23:30:00Z'))).toBe('00:30');
    expect(engine.parisTimeStr(new Date('2026-03-29T04:00:00Z'))).toBe('06:00');
    expect(j.minutes_brutes).toBe(270); // 4 h 30, et non 5 h 30
  });

  test('l\'heure planifiée est résolue en heure MURALE Paris, DST comprise', () => {
    // 08:00 Paris le 26/10/2025 (UTC+1) = 07:00Z ; le 17/08/2026 (UTC+2) = 06:00Z.
    expect(engine.parisDateTimeToUTC('2025-10-26', '08:00').toISOString()).toBe('2025-10-26T07:00:00.000Z');
    expect(engine.parisDateTimeToUTC('2026-08-17', '08:00').toISOString()).toBe('2026-08-17T06:00:00.000Z');
  });
});

describe('séquences anormales (BO-05)', () => {
  test('double pointage à 8 s : dédoublonné, la journée reste juste', () => {
    const j = engine.computeDay([
      ev('2026-08-17T06:00:00Z', 'entree'),
      ev('2026-08-17T06:00:08Z', 'entree'), // rebond du lecteur
      ev('2026-08-17T10:00:00Z', 'sortie'),
    ], PARAMS, { date: '2026-08-17' });
    expect(j.heures).toBe(4);
    expect(types(j)).toContain('double_pointage');
    expect(j.anomalies.find((a) => a.type === 'double_pointage').severite).toBe('info');
  });

  test('au-delà de l\'anti-rebond, une seconde entrée est une SÉQUENCE IMPAIRE', () => {
    const j = engine.computeDay([
      ev('2026-08-17T06:00:00Z', 'entree'),
      ev('2026-08-17T09:00:00Z', 'entree'), // 3 h plus tard : oubli de sortie
      ev('2026-08-17T15:00:00Z', 'sortie'),
    ], PARAMS, { date: '2026-08-17' });
    expect(types(j)).toContain('sequence_impaire');
    // La PREMIÈRE entrée reste ouverte : lecture à l'avantage du salarié.
    expect(j.paires[0].entree_utc).toBe('2026-08-17T06:00:00.000Z');
  });

  test('sortie sans entrée : signalée, aucune heure fantôme', () => {
    const j = engine.computeDay([ev('2026-08-17T15:00:00Z', 'sortie')], PARAMS, { date: '2026-08-17' });
    expect(types(j)).toContain('sortie_sans_entree');
    expect(j.heures).toBe(0);
  });

  test('oubli de sortie : la dernière entrée ouverte est signalée', () => {
    const j = engine.computeDay([ev('2026-08-17T06:00:00Z', 'entree')], PARAMS, { date: '2026-08-17' });
    expect(types(j)).toContain('oubli_sortie');
    expect(j.session_ouverte).toBe(true);
    expect(j.heures).toBe(0);
  });

  test('sens indéterminé (orphelin rattaché) : signalé, jamais deviné par le moteur', () => {
    const j = engine.computeDay([ev('2026-08-17T06:00:00Z', 'inconnu')], PARAMS, { date: '2026-08-17' });
    expect(types(j)).toContain('sens_indetermine');
  });

  test('journée de 14 h : alerte « journee_longue », mais les heures sont conservées', () => {
    const j = engine.computeDay(
      [ev('2026-08-17T04:00:00Z', 'entree'), ev('2026-08-17T18:00:00Z', 'sortie')],
      PARAMS, { date: '2026-08-17' }
    );
    expect(types(j)).toContain('journee_longue');
    expect(j.minutes_brutes).toBe(840);   // 14 h capturées
    expect(j.heures).toBe(13.25);          // − 45 min de pause, rien n'est perdu
  });

  test('l\'alerte de journée longue suit le paramètre, pas une constante', () => {
    const evs = [ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T15:00:00Z', 'sortie')];
    expect(types(engine.computeDay(evs, PARAMS, { date: '2026-08-17' }))).not.toContain('journee_longue');
    expect(types(engine.computeDay(evs, { ...PARAMS, journee_max_heures: 8 }, { date: '2026-08-17' }))).toContain('journee_longue');
  });
});

describe('corrections additives (BO-03) — le brut n\'est jamais modifié', () => {
  const brut = [pt(1, '2026-08-17T06:00:00Z', 'entree'), pt(2, '2026-08-17T15:00:00Z', 'sortie')];

  test('ANNULATION : l\'événement est exclu du calcul (l\'enregistrement reste en base)', () => {
    const events = engine.buildEffectiveEvents(brut, [
      { id: 1, pointage_id: 2, type: 'annulation', motif_code: 'badge_defaillant' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].pointage_id).toBe(1);
    // Le pointage source est intact dans l'entrée fournie : le moteur ne mute rien.
    expect(brut).toHaveLength(2);
  });

  test('MODIFICATION : horodatage et sens sont remplacés, l\'origine est tracée', () => {
    const events = engine.buildEffectiveEvents(brut, [
      { id: 1, pointage_id: 2, type: 'modification', horodatage_corrige: '2026-08-17T16:00:00Z', sens_corrige: 'sortie', motif_code: 'oubli_badge' },
    ]);
    const sortie = events.find((e) => e.sens === 'sortie');
    expect(sortie.horodatage_utc.toISOString()).toBe('2026-08-17T16:00:00.000Z');
    expect(sortie.corrige).toBe(true);
    expect(sortie.motif_code).toBe('oubli_badge');
    expect(engine.computeDay(events, PARAMS, { date: '2026-08-17' }).minutes_brutes).toBe(600);
  });

  test('AJOUT : un événement sans pointage d\'origine est inséré au bon rang', () => {
    const events = engine.buildEffectiveEvents([pt(1, '2026-08-17T06:00:00Z', 'entree')], [
      { id: 1, pointage_id: null, type: 'ajout', horodatage_corrige: '2026-08-17T15:00:00Z', sens_corrige: 'sortie', motif_code: 'oubli_badge' },
    ]);
    expect(events).toHaveLength(2);
    expect(events[1].origine).toBe('correction');
    expect(engine.computeDay(events, PARAMS, { date: '2026-08-17' }).heures).toBe(8.25);
  });

  test('corrections successives sur le même pointage : la DERNIÈRE fait foi', () => {
    const events = engine.buildEffectiveEvents(brut, [
      { id: 1, pointage_id: 2, type: 'modification', horodatage_corrige: '2026-08-17T16:00:00Z', sens_corrige: 'sortie', motif_code: 'autre' },
      { id: 2, pointage_id: 2, type: 'modification', horodatage_corrige: '2026-08-17T17:00:00Z', sens_corrige: 'sortie', motif_code: 'autre' },
    ]);
    expect(events.find((e) => e.sens === 'sortie').horodatage_utc.toISOString()).toBe('2026-08-17T17:00:00.000Z');
  });

  test('un orphelin non rattaché n\'entre pas dans le calcul des heures', () => {
    const events = engine.buildEffectiveEvents(
      [pt(1, '2026-08-17T06:00:00Z', 'entree'), { id: 2, employee_id: null, horodatage_utc: '2026-08-17T15:00:00Z', sens: 'inconnu', statut: 'orphelin' }],
      []
    );
    expect(events).toHaveLength(1);
  });

  test('les événements ressortent TOUJOURS triés chronologiquement', () => {
    const events = engine.buildEffectiveEvents(
      [pt(1, '2026-08-17T15:00:00Z', 'sortie'), pt(2, '2026-08-17T06:00:00Z', 'entree')],
      [{ id: 1, pointage_id: null, type: 'ajout', horodatage_corrige: '2026-08-17T10:00:00Z', sens_corrige: 'sortie', motif_code: 'autre' }]
    );
    const t = events.map((e) => e.horodatage_utc.getTime());
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });
});

describe('feuille de temps mensuelle (BO-04)', () => {
  test('agrège les journées de la période et compte les jours travaillés', () => {
    const jours = engine.computeDays([
      ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T15:00:00Z', 'sortie'),
      ev('2026-08-18T06:00:00Z', 'entree'), ev('2026-08-18T15:00:00Z', 'sortie'),
    ], PARAMS);
    const mois = engine.computeMonth(jours, PARAMS, { periode: '2026-08' });
    expect(mois.jours_travailles).toBe(2);
    expect(mois.heures_pointees).toBe(16.5);
    expect(mois.heures_hms).toBe('16:30');
    expect(mois.detail).toHaveLength(2);
  });

  test('les journées hors période sont exclues', () => {
    const jours = engine.computeDays([
      ev('2026-07-31T06:00:00Z', 'entree'), ev('2026-07-31T10:00:00Z', 'sortie'),
      ev('2026-08-03T06:00:00Z', 'entree'), ev('2026-08-03T10:00:00Z', 'sortie'),
    ], PARAMS);
    expect(engine.computeMonth(jours, PARAMS, { periode: '2026-08' }).heures_pointees).toBe(4);
  });

  test('heures théoriques NON fournies → null (jamais de valeur inventée), écart null aussi', () => {
    const mois = engine.computeMonth([], PARAMS, { periode: '2026-08' });
    expect(mois.heures_theoriques).toBeNull();
    expect(mois.ecart_heures).toBeNull();
    expect(mois.heures_pointees).toBe(0);
  });

  test('heures théoriques fournies → écart calculé', () => {
    const jours = engine.computeDays([ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')], PARAMS);
    const mois = engine.computeMonth(jours, PARAMS, { periode: '2026-08', heures_theoriques: 151.67 });
    expect(mois.ecart_heures).toBe(-147.67);
  });
});

describe('anomalies et plage d\'acceptation', () => {
  test('detectAnomalies aplatit les anomalies des journées et y joint les orphelins', () => {
    const jours = engine.computeDays([ev('2026-08-17T06:00:00Z', 'entree')], PARAMS);
    const anomalies = engine.detectAnomalies(jours, PARAMS, {
      employee_id: 5,
      orphelins: [{ id: 42, horodatage_utc: '2026-08-18T06:00:00Z', orphelin_raison: 'badge_inconnu' }],
    });
    expect(anomalies.find((a) => a.type === 'oubli_sortie').employee_id).toBe(5);
    const orph = anomalies.find((a) => a.type === 'orphelin');
    expect(orph).toMatchObject({ employee_id: null, pointage_id: 42, detail: 'badge_inconnu', date: '2026-08-18' });
  });

  test('la plage d\'acceptation est évaluée en heure MURALE Paris', () => {
    const p = { plage_acceptation_debut: '05:00', plage_acceptation_fin: '21:00' };
    expect(engine.estHorsPlage('2026-08-17T01:00:00Z', p)).toBe(true);  // 03:00 Paris
    expect(engine.estHorsPlage('2026-08-17T07:00:00Z', p)).toBe(false); // 09:00 Paris
    expect(engine.estHorsPlage('2026-08-17T20:00:00Z', p)).toBe(true);  // 22:00 Paris
    // Bornes inclusives.
    expect(engine.estHorsPlage('2026-08-17T03:00:00Z', p)).toBe(false); // 05:00 Paris
    expect(engine.estHorsPlage('2026-08-17T19:00:00Z', p)).toBe(false); // 21:00 Paris
  });

  test('la plage suit le paramètre (élargie → plus rien hors plage)', () => {
    const large = { plage_acceptation_debut: '00:00', plage_acceptation_fin: '23:59' };
    expect(engine.estHorsPlage('2026-08-17T01:00:00Z', large)).toBe(false);
  });

  test('plage non paramétrée : aucun pointage n\'est écarté (jamais de rejet par défaut)', () => {
    expect(engine.estHorsPlage('2026-08-17T01:00:00Z', {})).toBe(false);
  });
});

describe('ADR-0002 — AUCUNE règle de gestion en dur dans le moteur', () => {
  // Entrée à 08:07 (hors pas) : la sortie étant désormais comptée au réel
  // (QA-10), c'est la borne d'ENTRÉE qui témoigne du pas d'arrondi.
  const EVENTS = [ev('2026-08-17T06:07:00Z', 'entree'), ev('2026-08-17T15:07:00Z', 'sortie')];

  test('changer CHAQUE paramètre change le résultat (aucune constante figée)', () => {
    const reference = engine.computeDay(EVENTS, PARAMS, { date: '2026-08-17' });

    // Pas d'arrondi : 15 min → 5 min change la borne d'ENTRÉE comptée
    // (08:07 → 08:05 au pas de 5 ; → 08:00 au pas de 15).
    expect(engine.computeDay(EVENTS, { ...PARAMS, arrondi_minutes: 15 }, { date: '2026-08-17' })
      .paires[0].entree_comptee_utc).not.toBe(reference.paires[0].entree_comptee_utc);

    // Durée de pause.
    expect(engine.computeDay(EVENTS, { ...PARAMS, pause_deduite_minutes: 30 }, { date: '2026-08-17' })
      .heures).not.toBe(reference.heures);

    // Seuil de déclenchement de la pause (relevé au-dessus de la journée).
    expect(engine.computeDay(EVENTS, { ...PARAMS, pause_deduite_seuil_heures: 12 }, { date: '2026-08-17' })
      .pause_deduite_minutes).toBe(0);

    // Seuil d'alerte de journée longue.
    expect(types(engine.computeDay(EVENTS, { ...PARAMS, journee_max_heures: 6 }, { date: '2026-08-17' })))
      .toContain('journee_longue');

    // Sens de l'arrondi.
    expect(engine.computeDay(EVENTS, { ...PARAMS, arrondi_sens: 'reel' }, { date: '2026-08-17' })
      .minutes_brutes).not.toBe(reference.minutes_brutes);
  });

  test('tolérance de retard et badgeage en avance sont pilotés par les paramètres', () => {
    const tardif = [ev('2026-08-17T06:08:00Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')];
    const opts = { date: '2026-08-17', heure_planifiee_debut: '08:00' };
    // 8 min de retard : HORS tolérance à 5 min → décompte réel, mais l'arrondi
    // à l'avantage ramène quand même l'entrée de 08:08 à 08:05 (3 h 55 = 3,92 h).
    expect(engine.computeDay(tardif, PARAMS, opts).heures).toBe(3.92);
    // DANS la tolérance à 10 min → recalé sur l'heure planifiée, 4 h pleines.
    expect(engine.computeDay(tardif, { ...PARAMS, tolerance_retard_minutes: 10 }, opts).heures).toBe(4);
  });

  test('l\'anti-rebond est paramétré : à 0, le doublon devient une séquence impaire', () => {
    const evs = [ev('2026-08-17T06:00:00Z', 'entree'), ev('2026-08-17T06:00:08Z', 'entree'), ev('2026-08-17T10:00:00Z', 'sortie')];
    expect(types(engine.computeDay(evs, PARAMS, { date: '2026-08-17' }))).toContain('double_pointage');
    expect(types(engine.computeDay(evs, { ...PARAMS, anti_rebond_sec: 0 }, { date: '2026-08-17' }))).toContain('sequence_impaire');
  });

  test('une grille de paramètres VIDE ne fait pas planter le moteur (dégradation honnête)', () => {
    const j = engine.computeDay(EVENTS, {}, { date: '2026-08-17' });
    expect(j.minutes_brutes).toBe(540); // décompte au réel, aucune règle appliquée
    expect(j.pause_deduite_minutes).toBe(0);
    expect(j.regles_appliquees).toHaveLength(0);
  });

  test('le code source du moteur ne contient aucun littéral des seuils RH', () => {
    // Garde-fou anti-régression : si quelqu'un réintroduisait « 45 » ou « 0.75 »
    // dans une expression de calcul, ce test attirerait l'attention dessus.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'services', 'badgeuse-engine.js'), 'utf8'
    );
    // On retire commentaires et chaînes avant d'inspecter le code exécutable.
    const code = src
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'[^']*'/g, "''");
    for (const seuil of ['45', '0.75', '10 *', '* 10)']) {
      expect(code).not.toContain(seuil);
    }
  });
});

describe('utilitaires de format', () => {
  test('minutesToHms et minutesToDecimal', () => {
    expect(engine.minutesToHms(495)).toBe('08:15');
    expect(engine.minutesToHms(0)).toBe('00:00');
    expect(engine.minutesToHms(1440)).toBe('24:00');
    expect(engine.minutesToDecimal(495)).toBe(8.25);
    expect(engine.minutesToDecimal(0)).toBe(0);
  });

  test('parisDateStr donne le jour civil Paris, pas le jour UTC', () => {
    // 23:30 UTC un 17/08 = 01:30 Paris le 18/08.
    expect(engine.parisDateStr(new Date('2026-08-17T23:30:00Z'))).toBe('2026-08-18');
  });
});
