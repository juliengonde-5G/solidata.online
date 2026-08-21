// ═══════════════════════════════════════════════════════════════════════════
// MODULE 33 « TEMPS & PRÉSENCE » — CONTRAT ÉCRAN ↔ API, POINT PAR POINT
// ───────────────────────────────────────────────────────────────────────────
// Le piège n° 1 du dépôt n'est pas le SQL : c'est la CLÉ QUI CHANGE DE NOM
// entre la réponse et le composant qui la lit. Rien ne casse, rien ne
// s'affiche en rouge — l'écran affiche simplement autre chose, en silence.
//
// Défaut réel qu'ils verrouillent : les quatre onglets du module lisaient le
// nom du salarié avec `employeeName(row)`, qui cherchait `employee_nom` /
// `employee_name`, alors que le back-office joint la clé `nom`. Résultat : le
// Journal, les Feuilles de temps, les Anomalies et les Badges affichaient
// « Salarié #7 » au lieu de « DURAND Amel ». Aucune suite ne le voyait, parce
// qu'aucune ne faisait dialoguer les deux moitiés.
//
// La fonction du front est LUE DANS SON FICHIER et exécutée telle quelle : le
// test suit donc le code réel, il ne réimplémente pas une copie qui pourrait
// diverger.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const SHARED = path.join(
  __dirname, '..', '..', '..', 'frontend', 'src', 'components', 'badgeuse', 'badgeuseShared.jsx'
);

/** Extrait et instancie les helpers de nom du composant partagé (source réelle). */
function chargerHelpersFront() {
  const src = fs.readFileSync(SHARED, 'utf8');
  const debut = src.indexOf('export function formatLastName');
  const fin = src.indexOf('// ── Badges de statut');
  if (debut < 0 || fin < 0 || fin <= debut) {
    throw new Error('badgeuseShared.jsx : bloc des helpers de nom introuvable (le test doit être remis en phase avec le fichier)');
  }
  const bloc = src.slice(debut, fin).replace(/export function/g, 'function');
  // eslint-disable-next-line no-new-func
  return new Function(`${bloc}; return { employeeName, formatEmployeeName, formatLastName };`)();
}

const { employeeName, formatEmployeeName, formatLastName } = chargerHelpersFront();

/**
 * Une ligne PAR endpoint, dans la forme EXACTE que produit routes/badgeuse.js
 * (`formatNom(last_name, first_name)` → « NOM Prénom » sous la clé `nom`).
 */
const LIGNES_API = [
  ['GET /badgeuse/pointages → colonne « Salarié » du Journal',
    { id: 1, uuid: 'u', employee_id: 7, nom: 'DURAND Amel', matricule: 'M001', sens: 'entree', statut: 'brut' }],
  ['GET /badgeuse/feuilles-temps → colonne « Salarié » des Feuilles de temps',
    { employee_id: 7, nom: 'DURAND Amel', matricule: 'M001', periode: '2026-07', statut: 'brouillon' }],
  ['GET /badgeuse/badges → colonne « Salarié » de l\'onglet Badges',
    { id: 3, employee_id: 7, nom: 'DURAND Amel', matricule: 'M001', statut: 'actif' }],
  ['GET /badgeuse/anomalies → colonne « Salarié » des Anomalies',
    { employee_id: 7, nom: 'DURAND Amel', date: '2026-07-15', type: 'oubli_sortie', severite: 'alerte' }],
  ['GET /badgeuse/corrections → colonne « Salarié » du journal des corrections',
    { id: 2, employee_id: 7, nom: 'DURAND Amel', type: 'ajout', motif_code: 'oubli_badge' }],
  ['GET /badgeuse/orphelins (hors plage) → colonne « Salarié » de l\'encart orphelins',
    { id: 9, employee_id: 7, nom: 'DURAND Amel', orphelin_raison: 'hors_plage', uid_hmac: 'a'.repeat(64) }],
];

describe('contrat écran ↔ API : le nom du salarié s\'affiche vraiment', () => {
  test.each(LIGNES_API)('%s', (_libelle, ligne) => {
    expect(employeeName(ligne)).toBe('DURAND Amel');
    // Le repli « Salarié #id » existe pour les lignes SANS nom — il ne doit
    // jamais s'appliquer à une ligne qui en porte un.
    expect(employeeName(ligne)).not.toMatch(/^Salarié #/);
  });

  test('badge non reconnu : aucun nom n\'est inventé (repli identifiant technique)', () => {
    // Un orphelin `badge_inconnu` n'a PAS de salarié : le contrat renvoie
    // `nom: null`. L'écran affiche alors « — (badge non reconnu) », et
    // `employeeName` ne doit surtout pas fabriquer un nom.
    expect(employeeName({ id: 4, employee_id: null, nom: null, orphelin_raison: 'badge_inconnu' })).toBe('—');
  });

  test('les clés PRÉFIXÉES gardent la priorité (lignes à plusieurs personnes)', () => {
    // Une ligne de correction porte le salarié ET son auteur : le préfixe
    // départage. `nom` ne doit pas écraser un `<prefix>_nom` explicite.
    const ligne = { employee_id: 7, employee_nom: 'DURAND Amel', nom: 'AUTRE Personne', auteur_nom: 'MARTIN Luc' };
    expect(employeeName(ligne)).toBe('DURAND Amel');
    expect(employeeName(ligne, 'auteur')).toBe('MARTIN Luc');
  });

  test('repli first_name/last_name conservé (lignes venant de /employees)', () => {
    expect(employeeName({ id: 1, first_name: 'Amel', last_name: 'Durand' })).toBe('DURAND Amel');
  });

  test('règle de nom 2.20.0 : nom de famille en MAJUSCULES, prénom ensuite', () => {
    expect(formatEmployeeName('Durand', 'Amel')).toBe('DURAND Amel');
    expect(formatLastName('durand')).toBe('DURAND');
    expect(formatEmployeeName(null, 'Amel')).toBe('Amel'); // jamais de « null »
    expect(formatEmployeeName('Durand', null)).toBe('DURAND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L'écran doit CONSOMMER ce que l'API PRODUIT : on vérifie que la projection
// de la route porte bien les clés lues par les composants. La liste est tirée
// des composants eux-mêmes ; si une projection change de nom de champ, ce test
// tombe avant la mise en production, pas devant l'utilisateur.
// ═══════════════════════════════════════════════════════════════════════════
const ROUTES_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'badgeuse.js'), 'utf8');

describe('projections de routes/badgeuse.js : les clés attendues par les écrans existent', () => {
  /** Corps d'UNE route : du marqueur jusqu'à la déclaration de route suivante. */
  const extraireBloc = (marqueur) => {
    const i = ROUTES_SRC.indexOf(marqueur);
    expect(i).toBeGreaterThan(-1);
    const suivant = ROUTES_SRC.indexOf('\nrouter.', i + marqueur.length);
    return ROUTES_SRC.slice(i, suivant > i ? suivant : ROUTES_SRC.length);
  };

  test('GET /orphelins expose salarié + motif + empreinte + poste (encart Journal)', () => {
    const bloc = extraireBloc("router.get('/orphelins'");
    for (const cle of ['id:', 'uuid:', 'uid_hmac:', 'horodatage_utc:', 'orphelin_raison:', 'device_code:', 'employee_id:', 'nom:']) {
      expect(bloc).toContain(cle);
    }
    // Le filtre `employee_id IS NULL` masquait les orphelins « hors plage ».
    expect(bloc).not.toMatch(/statut = 'orphelin'\s+AND p\.employee_id IS NULL/);
  });

  test('GET /pointages expose nom, statut, chaîne et pagination', () => {
    const bloc = extraireBloc("router.get('/pointages'");
    for (const cle of ['total,', 'nom:', 'statut:', 'orphelin_raison:', 'chaine_valide:', 'anomalie:', 'device_code:']) {
      expect(bloc).toContain(cle);
    }
  });

  test('GET /feuilles-temps expose le trio théorique/pointé/écart et le circuit', () => {
    const bloc = extraireBloc("router.get('/feuilles-temps',");
    for (const cle of ['nom:', 'statut:', 'source_theorique:', 'heures_validees:', 'valide_encadrant_le:', 'valide_rh_le:']) {
      expect(bloc).toContain(cle);
    }
    // Le trio arrive par `trioHeures` : théorique inconnu → null, jamais 0.
    expect(bloc).toContain('trioHeures(feuille, mois)');
    expect(ROUTES_SRC).toMatch(/ecart_heures: theoriques == null \|\| pointees == null \? null/);
  });

  test('GET /devices expose online + alerte + seuil, jamais la clé du poste', () => {
    const bloc = extraireBloc("router.get('/devices'");
    expect(bloc).toContain('silence_minutes:');
    expect(bloc).toContain('online:');
    expect(bloc).toContain('alerte:');
    expect(bloc).not.toContain('api_key_hash,');
  });

  test('GET /anomalies nomme le salarié d\'un orphelin « hors plage »', () => {
    const bloc = extraireBloc("router.get('/anomalies'");
    // Le nom vient d'un JOIN, jamais d'une invention : `nom` reste null quand
    // le badge est inconnu.
    expect(bloc).toContain('LEFT JOIN employees e ON e.id = p.employee_id');
    expect(bloc).toMatch(/nom: a\.employee_id == null \? null/);
  });

  test('GET /parametres expose parametres + defauts + regles_validees + motifs', () => {
    const bloc = extraireBloc("router.get('/parametres'");
    for (const cle of ['parametres:', 'defauts:', 'regles_validees:', 'motifs_correction:']) {
      expect(bloc).toContain(cle);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ONGLET ANOMALIES : les types comptés par l'écran doivent être ceux que le
// MOTEUR émet. La table de l'écran attendait `journee_max` et `hors_plage`,
// deux clés inexistantes côté serveur : les cartes correspondantes affichaient
// un zéro permanent (une journée de 12 h existait, la carte disait « 0 »), et
// quatre types réels sortaient en clé technique (« sortie_sans_entree ») dans
// une interface qui doit être en français.
// ═══════════════════════════════════════════════════════════════════════════
const engine = require('../../src/services/badgeuse-engine');

/** Types d'anomalies que le moteur peut réellement produire (par exécution). */
function typesEmisParLeMoteur() {
  const params = {
    anti_rebond_sec: 8, arrondi_minutes: 5, arrondi_sens: 'avantage_salarie',
    journee_max_heures: 10, pause_deduite_minutes: 45, pause_deduite_seuil_heures: 6,
    pointages_par_jour: 4,
  };
  const ev = (hhmm, sens) => ({ horodatage_utc: new Date(`2026-07-06T${hhmm}:00.000Z`), sens, source: 'badge', pointage_id: null });
  const scenarios = [
    [ev('05:00', 'entree'), ev('17:00', 'sortie')],                       // journee_longue
    [ev('06:00', 'entree')],                                              // oubli_sortie
    [ev('15:00', 'sortie')],                                              // sortie_sans_entree
    [ev('06:00', 'entree'), ev('09:00', 'entree'), ev('15:00', 'sortie')], // sequence_impaire
    [ev('06:00', 'inconnu')],                                             // sens_indetermine
    [ev('06:00', 'entree'),                                               // double_pointage
      { horodatage_utc: new Date('2026-07-06T06:00:03.000Z'), sens: 'entree', source: 'badge', pointage_id: null },
      ev('15:00', 'sortie')],
    [ev('06:00', 'entree'), ev('13:00', 'sortie')],                       // pointages_incomplets
  ];
  const types = new Set();
  for (const events of scenarios) {
    engine.detectAnomalies(engine.computeDays(events, params), params, { employee_id: 1 })
      .forEach((a) => types.add(a.type));
  }
  engine.detectAnomalies([], params, { orphelins: [{ id: 1, horodatage_utc: new Date(), orphelin_raison: 'hors_plage' }] })
    .forEach((a) => types.add(a.type));
  return types;
}

describe('onglet Anomalies : cartes et libellés alignés sur le moteur', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'badgeuse', 'AnomaliesBadgeuse.jsx'),
    'utf8'
  );
  const blocMeta = SRC.slice(SRC.indexOf('const TYPE_META'), SRC.indexOf('// Cartes de synthèse'));
  const libelles = [...blocMeta.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]);
  const blocCartes = SRC.slice(SRC.indexOf('const CARTES'), SRC.indexOf('const TONE_CLASSES'));
  const cartes = [...blocCartes.matchAll(/cle: '(\w+)'(?:.*?type: '(\w+)')?/g)].map((m) => m[2] || m[1]);
  const emis = typesEmisParLeMoteur();

  test('le moteur produit bien les 8 types attendus', () => {
    expect([...emis].sort()).toEqual([
      'double_pointage', 'journee_longue', 'orphelin', 'oubli_sortie',
      'pointages_incomplets', 'sens_indetermine', 'sequence_impaire', 'sortie_sans_entree',
    ]);
  });

  test('aucune carte ne compte un type que le serveur n\'émet jamais (faux zéro)', () => {
    const fantomes = cartes.filter((t) => !emis.has(t));
    expect(fantomes).toEqual([]);
  });

  test('tout type émis a un libellé français (jamais de clé technique à l\'écran)', () => {
    const sansLibelle = [...emis].filter((t) => !libelles.includes(t));
    expect(sansLibelle).toEqual([]);
  });

  test('le hors-plage se compte sur le DÉTAIL de l\'orphelin, pas sur un type', () => {
    // Le serveur ne connaît pas de type `hors_plage` : c'est un orphelin dont
    // `detail` vaut « hors_plage ». La carte doit donc filtrer sur le détail.
    expect(blocCartes).toMatch(/cle: 'hors_plage'.*detail: 'hors_plage'.*type: 'orphelin'/);
    expect(SRC).toMatch(/!carte\.detail \|\| a\.detail === carte\.detail/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DÉRIVE ÉCRAN ↔ SERVEUR sur les types de contenu
//
// Née d'un trou réel : le type « presse » a été ajouté côté serveur (générateur
// opérationnel, accepté par l'API) mais oublié dans le sélecteur du back-office
// — l'écran existait et était INCRÉABLE autrement qu'en appelant l'API à la
// main. Le défaut n'était visible d'aucun test : chaque moitié était cohérente
// avec elle-même. Ce contrat lie les deux listes.
// ═══════════════════════════════════════════════════════════════════════════
describe('types de contenu : le back-office et le serveur parlent de la même chose', () => {
  const FRONT = SHARED;
  const DEVICE = path.join(__dirname, '..', '..', 'src', 'routes', 'badgeuse-device.js');

  const listeJs = (src, nom) => {
    const m = src.match(new RegExp(`${nom}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!m) throw new Error(`liste ${nom} introuvable`);
    return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  };

  const front = fs.readFileSync(FRONT, 'utf8');
  const device = fs.readFileSync(DEVICE, 'utf8');

  test('tout générateur proposé à l\'écran est réellement produit par le serveur', () => {
    const proposes = listeJs(front, 'TYPES_GENERATEURS');
    const produits = listeJs(device, 'TYPES_GENERES');
    // Un type proposé mais non produit donnerait un écran vide en salle, sans
    // erreur nulle part : c'est le sens de marche le plus dangereux.
    for (const t of proposes) expect(produits).toContain(t);
  });

  test('tout générateur du serveur est créable au back-office (ou explicitement legacy)', () => {
    const produits = listeJs(device, 'TYPES_GENERES');
    const proposes = listeJs(front, 'TYPES_GENERATEURS');
    const legacy = listeJs(front, 'TYPES_LEGACY');
    for (const t of produits) {
      // « meteo » est le seul cas mixte assumé : générée côté serveur, elle
      // garde son corps de texte en repli, donc son formulaire legacy.
      expect(proposes.concat(legacy)).toContain(t);
    }
  });

  test('chaque type proposé porte un libellé ET une aide contextuelle', () => {
    for (const t of listeJs(front, 'TYPES_GENERATEURS')) {
      expect(front).toMatch(new RegExp(`\\b${t}:\\s*['"\`]`));
    }
  });
});
