// ═══════════════════════════════════════════════════════════════════════════
// MODULE PUR — HORAIRES D'ACCESSIBILITÉ DES ASSOCIATIONS
// ───────────────────────────────────────────────────────────────────────────
// Verrouille les règles du cahier des charges du 26/08/2026 (RG-A, RG-B) et,
// surtout, la SÉMANTIQUE DE L'ABSENCE D'INFORMATION, qui est le cœur du sujet :
//   horaires null  → INCONNUS  → on ne bloque pas (RG-A2)
//   jour à []      → FERMÉ     → on bloque (RG-A5)
// Confondre les deux, c'est soit paralyser le module au premier jour, soit
// envoyer un camion devant une porte close.
//
// Aucune base, aucune horloge : le module est pur, ces tests le prouvent en le
// chargeant seul.
// ═══════════════════════════════════════════════════════════════════════════
const {
  JOURS, TOLERANCE_RDV_DEFAUT_MIN,
  minutesDepuisHHMM, hhmmDepuisMinutes, jourDeDate,
  validerHoraires, plagesDuJour, joursFermes,
  tientDansPlages, premierCreneauCompatible, fenetreEffective,
} = require('../../src/services/association-horaires');

describe('constantes', () => {
  test('la semaine commence au lundi et porte 7 jours', () => {
    expect(JOURS).toEqual(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']);
  });
  test('tolérance de rendez-vous par défaut : ±15 min (arbitrage n° 4)', () => {
    expect(TOLERANCE_RDV_DEFAUT_MIN).toBe(15);
  });
});

describe('minutesDepuisHHMM', () => {
  test.each([['00:00', 0], ['09:30', 570], ['23:59', 1439], ['10:15:00', 615], [' 09:30 ', 570]])(
    '%s → %s', (entree, attendu) => expect(minutesDepuisHHMM(entree)).toBe(attendu),
  );
  test.each([['9:30'], ['24:00'], ['12:60'], ['0930'], [''], ['midi'], [null], [undefined], [930], [{}]])(
    'format invalide %p → null (jamais une heure devinée)', (entree) => {
      expect(minutesDepuisHHMM(entree)).toBeNull();
    },
  );
});

describe('hhmmDepuisMinutes', () => {
  test.each([[0, '00:00'], [570, '09:30'], [1439, '23:59']])('%s → %s', (m, attendu) => {
    expect(hhmmDepuisMinutes(m)).toBe(attendu);
  });
  test('au-delà de minuit, le débordement est DIT et non replié en silence', () => {
    expect(hhmmDepuisMinutes(1440)).toBe('00:00 (+1 j)');
    expect(hhmmDepuisMinutes(1445)).toBe('00:05 (+1 j)');
    expect(hhmmDepuisMinutes(2885)).toBe('00:05 (+2 j)');
  });
  test('une valeur sans représentation horaire vaut null', () => {
    expect(hhmmDepuisMinutes(-10)).toBeNull();
    expect(hhmmDepuisMinutes(NaN)).toBeNull();
    expect(hhmmDepuisMinutes('570')).toBeNull();
  });
});

describe('jourDeDate — parsing UTC strict', () => {
  test.each([
    ['2026-08-31', 'lundi'], ['2026-08-30', 'dimanche'], ['2026-09-05', 'samedi'],
    ['2026-03-29', 'dimanche'], ['2026-10-25', 'dimanche'], // bascules d'heure d'été/hiver
  ])('%s → %s', (date, jour) => expect(jourDeDate(date)).toBe(jour));

  test('accepte un horodatage ISO et un objet Date', () => {
    expect(jourDeDate('2026-08-31T23:30:00.000Z')).toBe('lundi');
    expect(jourDeDate(new Date(Date.UTC(2026, 7, 31)))).toBe('lundi');
  });

  test('une date qui n’existe pas au calendrier vaut null (aucun report silencieux)', () => {
    expect(jourDeDate('2026-02-31')).toBeNull();
    expect(jourDeDate('2026-13-01')).toBeNull();
    expect(jourDeDate('31/08/2026')).toBeNull();
    expect(jourDeDate(null)).toBeNull();
  });

  test('400 jours consécutifs : aucune dérive, le cycle reste de 7', () => {
    const depart = Date.UTC(2026, 7, 31); // lundi
    for (let i = 0; i < 400; i++) {
      const d = new Date(depart + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      expect(jourDeDate(iso)).toBe(JOURS[i % 7]);
    }
  });
});

describe('validerHoraires', () => {
  test('non renseigné est une réponse VALIDE, pas une erreur de saisie', () => {
    for (const brut of [null, undefined]) {
      expect(validerHoraires(brut)).toEqual({ valide: true, erreurs: [], normalise: null });
    }
  });

  test('normalise porte toujours les 7 jours et trie les plages', () => {
    const r = validerHoraires({
      lundi: [{ debut: '14:00', fin: '17:00' }, { debut: '09:00', fin: '12:00' }],
    });
    expect(r.valide).toBe(true);
    expect(Object.keys(r.normalise)).toEqual(JOURS);
    expect(r.normalise.lundi).toEqual([{ debut: '09:00', fin: '12:00' }, { debut: '14:00', fin: '17:00' }]);
    expect(r.normalise.mardi).toEqual([]); // jour absent = fermé, rendu explicite
  });

  test('objet vide = fermé toute la semaine (et c’est une information, pas un trou)', () => {
    const r = validerHoraires({});
    expect(r.valide).toBe(true);
    expect(JOURS.every((j) => r.normalise[j].length === 0)).toBe(true);
  });

  test('les champs superflus d’une plage ne sont pas stockés', () => {
    const r = validerHoraires({ lundi: [{ debut: '09:00', fin: '12:00', couleur: 'rouge' }] });
    expect(r.normalise.lundi[0]).toEqual({ debut: '09:00', fin: '12:00' });
  });

  test('plages chevauchantes refusées, les deux plages nommées', () => {
    const r = validerHoraires({ lundi: [{ debut: '09:00', fin: '12:00' }, { debut: '11:00', fin: '15:00' }] });
    expect(r.valide).toBe(false);
    expect(r.normalise).toBeNull();
    expect(r.erreurs.join(' ')).toMatch(/chevauchent/);
  });

  test('plages jointives acceptées (12:00–14:00 puis 14:00–17:00)', () => {
    expect(validerHoraires({ lundi: [{ debut: '12:00', fin: '14:00' }, { debut: '14:00', fin: '17:00' }] }).valide).toBe(true);
  });

  test('fin avant début refusée', () => {
    const r = validerHoraires({ mardi: [{ debut: '17:00', fin: '09:00' }] });
    expect(r.valide).toBe(false);
    expect(r.erreurs.join(' ')).toMatch(/après le début/);
  });

  test('plage nulle refusée (début = fin)', () => {
    expect(validerHoraires({ mardi: [{ debut: '09:00', fin: '09:00' }] }).valide).toBe(false);
  });

  test('format HH:MM STRICT — ni « 9:00 », ni secondes, ni 24:00', () => {
    for (const heure of ['9:00', '09:00:00', '24:00', '09h00']) {
      const r = validerHoraires({ lundi: [{ debut: heure, fin: '12:00' }] });
      expect(r.valide).toBe(false);
      expect(r.erreurs.join(' ')).toMatch(/format HH:MM/);
    }
  });

  test('jour inconnu refusé, la clé fautive est nommée', () => {
    const r = validerHoraires({ lundi: [], lundu: [] });
    expect(r.valide).toBe(false);
    expect(r.erreurs[0]).toMatch(/lundu/);
  });

  test('structures aberrantes refusées sans exception', () => {
    expect(validerHoraires([]).valide).toBe(false);
    expect(validerHoraires('lundi 9h-12h').valide).toBe(false);
    expect(validerHoraires({ lundi: '09:00-12:00' }).valide).toBe(false);
    expect(validerHoraires({ lundi: ['09:00-12:00'] }).valide).toBe(false);
    expect(validerHoraires({ lundi: [null] }).valide).toBe(false);
  });

  test('plusieurs erreurs sont toutes remontées (l’utilisateur corrige en une fois)', () => {
    const r = validerHoraires({ lundi: [{ debut: '9h', fin: '12:00' }, { debut: '14:00', fin: '13:00' }] });
    expect(r.erreurs).toHaveLength(2);
  });
});

describe('plagesDuJour', () => {
  const horaires = {
    lundi: [{ debut: '09:00', fin: '12:00' }, { debut: '14:00', fin: '17:00' }],
    mardi: [],
  };
  test('jour ouvert → minutes d’horloge', () => {
    expect(plagesDuJour(horaires, '2026-08-31')).toEqual([[540, 720], [840, 1020]]);
  });
  test('jour fermé → [] (information connue)', () => {
    expect(plagesDuJour(horaires, '2026-09-01')).toEqual([]);
  });
  test('jour absent de l’objet → [] : absent vaut fermé', () => {
    expect(plagesDuJour(horaires, '2026-09-02')).toEqual([]);
  });
  test('horaires non renseignés → null (inconnu, à ne pas confondre avec fermé)', () => {
    expect(plagesDuJour(null, '2026-08-31')).toBeNull();
    expect(plagesDuJour(undefined, '2026-08-31')).toBeNull();
  });
  test('horaires illisibles ou date illisible → null, jamais une plage inventée', () => {
    expect(plagesDuJour({ lundi: 'ouvert' }, '2026-08-31')).toBeNull();
    expect(plagesDuJour(horaires, 'demain')).toBeNull();
  });
});

describe('joursFermes', () => {
  test('les jours sans plage, dans l’ordre de la semaine', () => {
    expect(joursFermes({ lundi: [{ debut: '09:00', fin: '12:00' }], mardi: [] }))
      .toEqual(['mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']);
  });
  test('horaires inconnus → [] : on ne déclare pas fermé ce qu’on ignore', () => {
    expect(joursFermes(null)).toEqual([]);
    expect(joursFermes({ lundi: 'ouvert' })).toEqual([]);
  });
  test('objet vide → les 7 jours fermés', () => {
    expect(joursFermes({})).toEqual(JOURS);
  });
});

describe('tientDansPlages', () => {
  const plages = [[540, 720], [840, 1020]];
  test('service entièrement contenu dans une plage', () => {
    expect(tientDansPlages(600, 620, plages)).toBe(true);
  });
  test('bornes incluses : arrivée à l’ouverture, fin à la fermeture', () => {
    expect(tientDansPlages(540, 720, plages)).toBe(true);
  });
  test('un service ne se coupe pas en deux morceaux de part et d’autre de midi', () => {
    expect(tientDansPlages(700, 850, plages)).toBe(false);
  });
  test('débordement d’une minute refusé', () => {
    expect(tientDansPlages(700, 721, plages)).toBe(false);
  });
  test('horaires inconnus (null) → true : inconnu n’est pas interdit', () => {
    expect(tientDansPlages(600, 620, null)).toBe(true);
    expect(tientDansPlages(600, 620, undefined)).toBe(true);
  });
  test('jour fermé ([]) → false quelle que soit l’heure', () => {
    expect(tientDansPlages(600, 620, [])).toBe(false);
    expect(tientDansPlages(0, 1439, [])).toBe(false);
  });
  test('minutes illisibles → false (on n’affirme rien sur une entrée fausse)', () => {
    expect(tientDansPlages(NaN, 620, plages)).toBe(false);
  });
});

describe('premierCreneauCompatible', () => {
  const plages = [[540, 720], [840, 1020]];
  test('au plus tôt dans la journée', () => {
    expect(premierCreneauCompatible(30, plages)).toBe(540);
  });
  test('après une heure donnée, dans la même plage', () => {
    expect(premierCreneauCompatible(30, plages, 600)).toBe(600);
  });
  test('bascule sur la plage suivante quand la durée ne tient plus', () => {
    expect(premierCreneauCompatible(30, plages, 700)).toBe(840);
  });
  test('aucun créneau après la dernière fermeture', () => {
    expect(premierCreneauCompatible(30, plages, 1010)).toBeNull();
  });
  test('durée plus longue que toutes les plages → null', () => {
    expect(premierCreneauCompatible(400, plages)).toBeNull();
  });
  test('jour fermé ou horaires inconnus → null (rien à suggérer)', () => {
    expect(premierCreneauCompatible(30, [])).toBeNull();
    expect(premierCreneauCompatible(30, null)).toBeNull();
  });
  test('plages non triées : le premier créneau reste le plus tôt', () => {
    expect(premierCreneauCompatible(30, [[840, 1020], [540, 720]])).toBe(540);
  });
});

describe('fenetreEffective', () => {
  test('créneau + tolérance par défaut appliquée des deux côtés', () => {
    expect(fenetreEffective({ heure_debut: '10:15', heure_fin: '10:45', tolerance_min: null }))
      .toEqual({ debutMin: 600, finMin: 660 });
  });
  test('heure exacte : la fenêtre se réduit à la seule tolérance', () => {
    expect(fenetreEffective({ heure_debut: '10:30', heure_fin: null }))
      .toEqual({ debutMin: 615, finMin: 645 });
  });
  test('la tolérance de la demande prime sur celle par défaut', () => {
    expect(fenetreEffective({ heure_debut: '10:30', tolerance_min: 5 }))
      .toEqual({ debutMin: 625, finMin: 635 });
  });
  test('tolérance nulle acceptée : rendez-vous à la minute', () => {
    expect(fenetreEffective({ heure_debut: '10:30', tolerance_min: 0 }))
      .toEqual({ debutMin: 630, finMin: 630 });
  });
  test('accepte les TIME de PostgreSQL (HH:MM:SS)', () => {
    expect(fenetreEffective({ heure_debut: '10:15:00', heure_fin: '10:45:00', tolerance_min: 15 }))
      .toEqual({ debutMin: 600, finMin: 660 });
  });
  test('tolérance par défaut surchargeable par l’appelant (réglage global)', () => {
    expect(fenetreEffective({ heure_debut: '10:30' }, 30)).toEqual({ debutMin: 600, finMin: 660 });
  });
  test('sans heure de début lisible, il n’y a pas de rendez-vous — surtout pas une fenêtre par défaut', () => {
    expect(fenetreEffective({ heure_debut: null })).toBeNull();
    expect(fenetreEffective({ heure_debut: 'matin' })).toBeNull();
    expect(fenetreEffective(null)).toBeNull();
  });
  test('une fenêtre qui déborde avant minuit garde sa valeur négative, sans repli', () => {
    expect(fenetreEffective({ heure_debut: '00:05', tolerance_min: 15 }).debutMin).toBe(-10);
  });
});
