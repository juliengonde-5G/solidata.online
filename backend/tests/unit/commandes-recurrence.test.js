// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — moteur des commandes exutoires récurrentes (lot L7)
// ───────────────────────────────────────────────────────────────────────────
// Toutes les fonctions éprouvées ici sont PURES : aucune base, aucun réseau.
// C'est le cœur de la règle métier « une commande hebdomadaire produit une
// commande PAR SEMAINE » — jusqu'à ce lot, la colonne `frequence` était saisie
// à l'écran et n'était lue par personne.
// ═══════════════════════════════════════════════════════════════════════════

const {
  calculerEcheances,
  avancerEcheance,
  ajouterJours,
  ajouterMois,
  normaliserDate,
  estModeleRecurrent,
  libelleFrequence,
  bornesPreparation,
  PAS_RECURRENCE,
  HORIZON_DEFAUT_JOURS,
} = require('../../src/services/commandes-recurrence');

// ───────────────────────────────────────────────────────────────────────────
// Le pas de récurrence doit coller EXACTEMENT au CHECK SQL
// ───────────────────────────────────────────────────────────────────────────
describe('Pas de récurrence — alignement sur le CHECK SQL', () => {
  it("n'expose QUE les valeurs réellement acceptées par commandes_exutoires.frequence", () => {
    // migrate-exutoires.js : CHECK (frequence IN ('unique','hebdomadaire','bi_mensuel','mensuel'))
    // Le défaut historique du calendrier logistique venait précisément d'une
    // liste divergente ('bimensuelle', 'mensuelle', 'trimestrielle').
    expect(Object.keys(PAS_RECURRENCE).sort()).toEqual(['bi_mensuel', 'hebdomadaire', 'mensuel']);
  });

  it('ne considère jamais « unique » comme récurrent', () => {
    expect(avancerEcheance('2026-09-01', 'unique')).toBeNull();
    expect(libelleFrequence('unique')).toBe('Unique');
  });

  it('rejette les fréquences fantômes de l\'ancien calendrier', () => {
    for (const fantome of ['bimensuelle', 'mensuelle', 'trimestrielle']) {
      expect(avancerEcheance('2026-09-01', fantome)).toBeNull();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Normalisation des dates — le piège du fuseau horaire
// ───────────────────────────────────────────────────────────────────────────
describe('normaliserDate — lecture des colonnes DATE de PostgreSQL', () => {
  it('lit une date PostgreSQL par ses composantes LOCALES, pas via toISOString()', () => {
    // node-postgres construit une colonne DATE à MINUIT LOCAL. Passer par
    // toISOString() renverrait la VEILLE dès que le serveur n'est pas en UTC
    // (Europe/Paris : 2026-09-01T00:00 local → 2026-08-31T22:00Z).
    // Conséquence si le défaut revenait : le curseur `prochaine_echeance`,
    // relu puis réécrit à chaque passage, reculerait d'un jour par exécution.
    const dateDuPilote = new Date(2026, 8, 1); // 1er septembre 2026, minuit local
    expect(normaliserDate(dateDuPilote)).toBe('2026-09-01');
    expect(normaliserDate(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(normaliserDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('accepte les chaînes ISO et les horodatages', () => {
    expect(normaliserDate('2026-09-01')).toBe('2026-09-01');
    expect(normaliserDate('2026-09-01T12:00:00.000Z')).toBe('2026-09-01');
  });

  it('renvoie null — jamais une date de remplacement — sur une valeur illisible', () => {
    expect(normaliserDate(null)).toBeNull();
    expect(normaliserDate('')).toBeNull();
    expect(normaliserDate('pas une date')).toBeNull();
    expect(normaliserDate('2026-02-31')).toBeNull();  // le 31 février n'existe pas
    expect(normaliserDate('2026-13-01')).toBeNull();
    expect(normaliserDate(new Date('invalide'))).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Bornes de mois
// ───────────────────────────────────────────────────────────────────────────
describe('ajouterMois — bornes de mois', () => {
  it('ramène au dernier jour du mois quand le quantième n\'existe pas', () => {
    // 31 janvier + 1 mois = 28 février (2026 n'est pas bissextile),
    // et surtout PAS le 3 mars comme le ferait setMonth() seul — un débordement
    // décalerait définitivement toutes les échéances suivantes.
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28');
    expect(ajouterMois('2026-03-31', 1)).toBe('2026-04-30');
    expect(ajouterMois('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('gère le 29 février des années bissextiles', () => {
    expect(ajouterMois('2028-01-31', 1)).toBe('2028-02-29'); // 2028 est bissextile
    expect(ajouterMois('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('franchit correctement la fin d\'année', () => {
    expect(ajouterMois('2026-12-15', 1)).toBe('2027-01-15');
    expect(ajouterMois('2026-12-31', 2)).toBe('2027-02-28');
  });

  it('ajouterJours ne dérive pas au changement d\'heure (arithmétique UTC)', () => {
    // Dernier dimanche d'octobre 2026 : passage à l'heure d'hiver en France.
    expect(ajouterJours('2026-10-24', 7)).toBe('2026-10-31');
    expect(ajouterJours('2026-10-31', 7)).toBe('2026-11-07');
    // Passage à l'heure d'été.
    expect(ajouterJours('2026-03-28', 7)).toBe('2026-04-04');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Modèle récurrent = statut DÉRIVÉ (aucune colonne « est_modele »)
// ───────────────────────────────────────────────────────────────────────────
describe('estModeleRecurrent — statut dérivé', () => {
  it('reconnaît un modèle : fréquence récurrente ET pas de parent', () => {
    expect(estModeleRecurrent({ frequence: 'hebdomadaire', commande_parent_id: null })).toBe(true);
    expect(estModeleRecurrent({ frequence: 'mensuel', commande_parent_id: null })).toBe(true);
  });

  it('exclut une OCCURRENCE générée (elle a un parent)', () => {
    // Suspendre la récurrence sur une fille n'aurait aucun effet : elle existe
    // déjà. Le refus 409 de la route s'appuie sur ce prédicat.
    expect(estModeleRecurrent({ frequence: 'hebdomadaire', commande_parent_id: 12 })).toBe(false);
  });

  it('exclut une commande unique et une entrée absente', () => {
    expect(estModeleRecurrent({ frequence: 'unique', commande_parent_id: null })).toBe(false);
    expect(estModeleRecurrent(null)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LE CŒUR : calcul des échéances
// ───────────────────────────────────────────────────────────────────────────
describe('calculerEcheances — hebdomadaire', () => {
  const AUJOURDHUI = '2026-09-01'; // un mardi

  it('produit UNE commande PAR SEMAINE sur 4 semaines (horizon 30 jours)', () => {
    const plan = calculerEcheances(
      { frequence: 'hebdomadaire', date_commande: '2026-09-01', prochaine_echeance: null, date_fin_recurrence: null },
      { aujourdhui: AUJOURDHUI, horizonJours: 30 }
    );
    // La commande d'origine EST la 1re occurrence : on part donc du 8.
    expect(plan.echeances).toEqual(['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
    // Toutes les échéances tombent le même jour de la semaine que l'origine.
    for (const d of plan.echeances) {
      expect(new Date(`${d}T12:00:00Z`).getUTCDay()).toBe(new Date('2026-09-01T12:00:00Z').getUTCDay());
    }
    // Le curseur laissé en base pointe la première échéance HORS horizon.
    expect(plan.prochaine_echeance).toBe('2026-10-06');
    expect(plan.motif).toBeNull();
  });

  it('reprend au curseur stocké plutôt qu\'à la date de commande', () => {
    const plan = calculerEcheances(
      { frequence: 'hebdomadaire', date_commande: '2026-01-05', prochaine_echeance: '2026-09-15', date_fin_recurrence: null },
      { aujourdhui: AUJOURDHUI, horizonJours: 30 }
    );
    expect(plan.echeances).toEqual(['2026-09-15', '2026-09-22', '2026-09-29']);
  });
});

describe('calculerEcheances — idempotence (pas de doublon)', () => {
  const AUJOURDHUI = '2026-09-01';
  const MODELE = { frequence: 'hebdomadaire', date_commande: '2026-09-01', prochaine_echeance: null, date_fin_recurrence: null };

  it('ne regénère JAMAIS une échéance déjà matérialisée', () => {
    const plan = calculerEcheances(MODELE, {
      aujourdhui: AUJOURDHUI,
      horizonJours: 30,
      datesExistantes: ['2026-09-08', '2026-09-22'],
    });
    expect(plan.echeances).toEqual(['2026-09-15', '2026-09-29']);
    // Ce qui est écarté est DIT, jamais escamoté.
    const dejaVues = plan.ignorees.filter((i) => i.motif === 'occurrence déjà générée').map((i) => i.date);
    expect(dejaVues).toEqual(['2026-09-08', '2026-09-22']);
  });

  it('rejoué à l\'identique, ne propose plus rien (le deuxième passage est vide)', () => {
    // 1er passage
    const premier = calculerEcheances(MODELE, { aujourdhui: AUJOURDHUI, horizonJours: 30 });
    expect(premier.echeances).toHaveLength(4);

    // 2e passage : l'état de la base après le 1er (filles créées + curseur avancé)
    const second = calculerEcheances(
      { ...MODELE, prochaine_echeance: premier.prochaine_echeance },
      { aujourdhui: AUJOURDHUI, horizonJours: 30, datesExistantes: premier.echeances }
    );
    expect(second.echeances).toEqual([]);
    expect(second.prochaine_echeance).toBe(premier.prochaine_echeance);
  });

  it('reconnaît les dates existantes quelle que soit leur forme (objets Date de PostgreSQL)', () => {
    const plan = calculerEcheances(MODELE, {
      aujourdhui: AUJOURDHUI,
      horizonJours: 30,
      datesExistantes: [new Date(2026, 8, 8), new Date(2026, 8, 15)], // minuit local
    });
    expect(plan.echeances).toEqual(['2026-09-22', '2026-09-29']);
  });
});

describe('calculerEcheances — bornes', () => {
  const AUJOURDHUI = '2026-09-01';

  it('s\'arrête à la date de fin de récurrence et clôt le curseur', () => {
    const plan = calculerEcheances(
      { frequence: 'hebdomadaire', date_commande: '2026-09-01', prochaine_echeance: null, date_fin_recurrence: '2026-09-20' },
      { aujourdhui: AUJOURDHUI, horizonJours: 30 }
    );
    expect(plan.echeances).toEqual(['2026-09-08', '2026-09-15']);
    // Récurrence terminée : plus aucune échéance à venir, le curseur le dit.
    expect(plan.prochaine_echeance).toBeNull();
  });

  it('ne matérialise pas rétroactivement les échéances passées, mais les signale', () => {
    const plan = calculerEcheances(
      { frequence: 'mensuel', date_commande: '2026-05-15', prochaine_echeance: null, date_fin_recurrence: null },
      { aujourdhui: AUJOURDHUI, horizonJours: 30 }
    );
    // Juin/juillet/août sont derrière nous : rien n'est créé pour eux.
    expect(plan.echeances).toEqual(['2026-09-15']);
    const passees = plan.ignorees.filter((i) => /passée/.test(i.motif)).map((i) => i.date);
    expect(passees).toEqual(['2026-06-15', '2026-07-15', '2026-08-15']);
  });

  it('respecte un horizon plus court (aucune échéance au-delà)', () => {
    const plan = calculerEcheances(
      { frequence: 'hebdomadaire', date_commande: '2026-09-01', prochaine_echeance: null, date_fin_recurrence: null },
      { aujourdhui: AUJOURDHUI, horizonJours: 10 }
    );
    expect(plan.echeances).toEqual(['2026-09-08']);
  });

  it('enchaîne les bornes de mois sur un modèle mensuel au 31 SANS se figer au 28', () => {
    const plan = calculerEcheances(
      { frequence: 'mensuel', date_commande: '2026-01-31', prochaine_echeance: '2026-01-31', date_fin_recurrence: null },
      { aujourdhui: '2026-01-01', horizonJours: 150 }
    );
    // Février est ramené au 28 (il n'a pas de 31), mais mars RETROUVE le 31 :
    // le ramenage est ponctuel, jamais définitif. Sans quantième d'ancrage, la
    // série serait devenue « le 28 de chaque mois » pour toujours.
    expect(plan.echeances).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('conserve le quantième d\'origine sur un mensuel ordinaire', () => {
    const plan = calculerEcheances(
      { frequence: 'mensuel', date_commande: '2026-09-15', prochaine_echeance: null, date_fin_recurrence: null },
      { aujourdhui: '2026-09-01', horizonJours: 120 }
    );
    expect(plan.echeances).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
  });

  it('applique le pas de 14 jours pour bi_mensuel', () => {
    const plan = calculerEcheances(
      { frequence: 'bi_mensuel', date_commande: '2026-09-01', prochaine_echeance: null, date_fin_recurrence: null },
      { aujourdhui: AUJOURDHUI, horizonJours: 30 }
    );
    expect(plan.echeances).toEqual(['2026-09-15', '2026-09-29']);
  });
});

describe('calculerEcheances — refus explicites (jamais de valeur inventée)', () => {
  it('refuse un modèle absent', () => {
    const plan = calculerEcheances(null, { aujourdhui: '2026-09-01' });
    expect(plan.echeances).toEqual([]);
    expect(plan.motif).toBe('modèle absent');
  });

  it('refuse une fréquence non récurrente', () => {
    const plan = calculerEcheances({ frequence: 'unique', date_commande: '2026-09-01' }, { aujourdhui: '2026-09-01' });
    expect(plan.echeances).toEqual([]);
    expect(plan.motif).toBe('fréquence non récurrente');
  });

  it('refuse — sans rien deviner — un modèle dont la date de commande est illisible', () => {
    const plan = calculerEcheances(
      { frequence: 'hebdomadaire', date_commande: null, prochaine_echeance: null },
      { aujourdhui: '2026-09-01' }
    );
    expect(plan.echeances).toEqual([]);
    expect(plan.motif).toMatch(/non calculables/);
  });

  it('retombe sur l\'horizon par défaut si la valeur fournie est absurde', () => {
    const avecZero = calculerEcheances(
      { frequence: 'hebdomadaire', date_commande: '2026-09-01', prochaine_echeance: null },
      { aujourdhui: '2026-09-01', horizonJours: 0 }
    );
    const parDefaut = calculerEcheances(
      { frequence: 'hebdomadaire', date_commande: '2026-09-01', prochaine_echeance: null },
      { aujourdhui: '2026-09-01', horizonJours: HORIZON_DEFAUT_JOURS }
    );
    // Un horizon à 0 figerait la génération EN SILENCE : c'est exactement ce
    // qu'il ne faut pas. On retombe sur le défaut documenté.
    expect(avecZero.echeances).toEqual(parDefaut.echeances);
    expect(avecZero.echeances.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Créneau de préparation
// ───────────────────────────────────────────────────────────────────────────
describe('bornesPreparation — créneau de la préparation d\'expédition', () => {
  it('expédie le jour de l\'échéance à 12:00, remorque livrée la veille à 12:00', () => {
    expect(bornesPreparation('2026-09-08')).toEqual({
      date_debut: '2026-09-07 12:00:00',
      date_fin: '2026-09-08 12:00:00',
    });
  });

  it('franchit correctement un début de mois', () => {
    expect(bornesPreparation('2026-09-01')).toEqual({
      date_debut: '2026-08-31 12:00:00',
      date_fin: '2026-09-01 12:00:00',
    });
  });

  it('renvoie null sur une échéance illisible plutôt qu\'un créneau inventé', () => {
    expect(bornesPreparation('pas-une-date')).toBeNull();
    expect(bornesPreparation(null)).toBeNull();
  });
});
