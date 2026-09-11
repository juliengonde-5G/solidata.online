/**
 * Conversion des objets de l'API Malibou vers les formes qu'attend SOLIDATA.
 *
 * Module PUR : aucune E/S, aucune base. Il se teste sans rien monter, et c'est
 * voulu — c'est ici que se décide ce qui entre dans les dossiers du personnel.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CE QUE L'API NE DONNE PAS, ET POURQUOI ÇA CHANGE LE PÉRIMÈTRE
 *
 * Établi sur la spécification OpenAPI v1.11.0 (lue le 11/09/2026), dont la
 * liste COMPLÈTE des propriétés a été extraite. Trois absences comptent :
 *
 *  1. AUCUNE heure hebdomadaire contractuelle. Le calcul des ETP conventionnés
 *     repose sur la quotité = heures hebdo / 35 (module 32). Sans elle, il n'y
 *     a pas d'ETP.
 *  2. AUCUN libellé de poste. Le périmètre d'insertion (`keepContractForInsertion`)
 *     reconnaît un CDDI au poste qui porte « … Cddi ». Sans poste, ni l'espace
 *     CIP ni le décompte ASP ne savent qui relève de l'insertion.
 *  3. `natureContrat` n'a PAS de valeur CDDI : son énumération s'arrête à
 *     `fixed_term`. Un contrat d'insertion y est un CDD comme un autre.
 *
 * Conséquence, dite sans détour : cette synchronisation COMPLÈTE l'export de
 * paie, elle ne le remplace pas. Elle apporte l'identité, le statut d'emploi,
 * les dates de contrat et surtout les ABSENCES (aujourd'hui disponibles une
 * fois par mois seulement) ; les heures, le poste et la nature réelle du
 * contrat continuent de venir du classeur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * LISTE BLANCHE, JAMAIS LISTE NOIRE
 *
 * Le convertisseur ne lit QUE les champs qu'il nomme. C'est structurel : si
 * Malibou ajoute demain un identifiant fiscal ou un RIB secondaire, il
 * n'entrera pas, sans qu'on ait eu à penser à l'exclure. Une liste noire
 * protège de ce qu'on a prévu ; une liste blanche protège aussi du reste.
 *
 * Jamais lus, et ils existent pourtant dans la réponse : `ssn`,
 * `socialSecurityNumber`, `bankAccount.iban`, `bankAccount.bic`. C'est la
 * doctrine de minimisation posée en 2.2.0 pour l'export, tenue ici à la
 * source. Un test le prouve sur une charge qui les contient.
 */

const { categoriserAbsence } = require('../utils/absences');

/**
 * `natureContrat` (Malibou) → `contract_type` (SOLIDATA).
 *
 * `fixed_term` devient CDD et JAMAIS CDDI : l'API ne distingue pas un contrat
 * d'insertion d'un CDD ordinaire. Le requalifier ici sur une intuition
 * ferait entrer dans le périmètre conventionné des personnes qui n'en
 * relèvent pas — c'est le poste, venu du classeur, qui tranche.
 */
const NATURE_VERS_TYPE = {
  permanent: 'CDI',
  fixed_term: 'CDD',
  internship: 'stage',
  internship_not_paid: 'stage',
  work_study: 'apprentissage',
  professionalization: 'apprentissage',
  // Les formes suivantes ne sont pas des contrats de travail salarié : on ne
  // leur invente pas d'équivalent, la valeur reste nulle et le champ n'écrase
  // rien (fusion COALESCE côté upsert).
  officer: null,
  freelance: null,
  founder: null,
  external_staff: null,
};

/**
 * Code d'absence Malibou → LIBELLÉ français, tel que Malibou l'écrit lui-même.
 *
 * POURQUOI CONVERTIR PLUTÔT QUE GARDER LE CODE : la clé naturelle de
 * `employee_leaves` est (salarié, LIBELLÉ, date de début). L'export de paie y
 * écrit le libellé de sa colonne « Type » (« Congés Payés ») ; une
 * synchronisation qui écrirait le code (« conge_paye ») créerait une SECONDE
 * ligne pour la même absence. Or le réalisé du calcul ETP additionne les jours
 * de chaque ligne — l'absence serait comptée deux fois, et nos ETP
 * sous-estimés d'autant devant le financeur.
 *
 * Ces libellés ne sont pas devinés : ils figurent dans la documentation
 * Malibou, en regard de chaque code. Un type propre à l'organisation
 * (préfixé `custom_`) n'y figure pas et garde son code — il n'a pas d'autre
 * nom connu, et en inventer un ne ferait que déplacer le problème.
 */
const LIBELLE_PAR_CODE = {
  conge_paye: 'Congés Payés',
  rtt: 'RTT',
  rcr: 'Repos compensateur (h. sup.)',
  rco: 'Repos compensateur obligatoire',
  conge_sans_solde: 'Congés sans solde',
  maladie_non_professionnelle: 'Maladie',
  enfant_malade: 'Enfant malade',
  maternite: 'Maternité',
  conge_patho_prenatal_maternite: 'Congé pathologique pré-natal',
  conge_patho_postnatal: 'Congé pathologique post-natal',
  paternite: 'Paternité',
  conge_supplementaire_naissance: 'Congé supplémentaire de naissance',
  conge_parental: 'Congé parental',
  presence_parentale: 'Présence parentale',
  evenement_familial: 'Événement familial',
  accident_du_travail: 'Accident de travail',
  maladie_professionnelle: 'Maladie professionnelle',
  jour_ecole: 'Jour école',
  revision: 'Révisions',
  recuperation: 'Jour de récupération',
  repos: 'Jour de repos',
  absence_non_remuneree_autorisee: 'Absence non rémunérée autorisée',
  absence_non_remuneree_non_autorisee: 'Absence non rémunérée non autorisée',
  absence_remuneree: 'Autre absence rémunérée',
  mise_a_pied_conservatoire: 'Mise à pied conservatoire',
  mise_a_pied_disciplinaire: 'Mise à pied disciplinaire',
  representation_des_salaries: 'Représentation des salariés',
  autre: 'Autre',
};

/**
 * Libellé d'une absence : celui de Malibou quand il est connu, le code sinon.
 *
 * RÉSERVE DITE : la convergence suppose que l'export de paie emploie bien ces
 * libellés dans sa colonne « Type ». S'ils venaient à différer (une casse, un
 * accent), la même absence produirait deux lignes — c'est le risque que porte
 * une clé naturelle fondée sur du texte. La synchronisation SIGNALE donc les
 * libellés qu'elle a créés et qui ne correspondaient à rien d'existant.
 */
function libelleAbsence(code) {
  if (!code) return 'inconnu';
  const c = String(code).trim().toLowerCase();
  return LIBELLE_PAR_CODE[c] || String(code).trim();
}

/**
 * Code d'absence Malibou → catégorie SOLIDATA, DÉRIVÉE de la règle partagée.
 *
 * CETTE CLASSIFICATION A DES CONSÉQUENCES CHIFFRÉES : le réalisé du calcul ETP
 * déduit les catégories `sick` et `absence`, et ne déduit JAMAIS `holiday`.
 *
 * La table n'énonce donc AUCUNE règle propre : elle applique celle de
 * `utils/absences.js` au libellé de chaque code. C'est la même règle qui
 * catégorise l'import du classeur de paie, et ce n'est pas un raffinement
 * d'architecture : les deux voies écrivent la MÊME ligne (clé naturelle
 * salarié + libellé + date de début). Deux tables tenues en parallèle
 * auraient fini par diverger, et l'absence aurait alors changé de nature —
 * donc le réalisé ETP avec elle — selon l'import qui a tourné en dernier.
 *
 * Elle reste exposée parce qu'elle se lit d'un coup d'œil, et qu'un test la
 * confronte à la liste publiée par Malibou : un type ajouté chez eux fait
 * tomber la suite au lieu de passer inaperçu.
 */
const CATEGORIE_PAR_CODE = Object.freeze(
  Object.fromEntries(
    Object.entries(LIBELLE_PAR_CODE).map(([code, libelle]) => [code, categoriserAbsence(libelle)]),
  ),
);

/**
 * Catégorie d'une absence d'après son code.
 *
 * UN CODE INCONNU EST COMPTÉ COMME UNE ABSENCE QUI DÉDUIT, et ce n'est pas
 * l'option neutre : c'est la PRUDENTE. Le tenir pour un congé reviendrait à
 * revendiquer devant l'ASP des heures qu'on n'a peut-être pas faites ; le
 * tenir pour une absence nous sous-estime, ce qui ne coûte qu'à nous. Les
 * types `custom_*` propres à l'organisation tombent ici — ils sont donc
 * SIGNALÉS par la synchronisation pour qu'on les classe explicitement.
 */
function categorieAbsence(code) {
  return categoriserAbsence(libelleAbsence(code));
}

/** Un code d'absence est-il connu de la table ? (sert au signalement) */
function codeAbsenceConnu(code) {
  return Boolean(code) && Object.hasOwn(LIBELLE_PAR_CODE, String(code).trim().toLowerCase());
}

/**
 * Extrait le JOUR d'un horodatage ISO, sans passer par `Date`.
 *
 * `new Date('1990-05-12T00:00:00Z')` relu dans un conteneur en UTC+2 donnerait
 * le 11 mai : une date de naissance décalée d'un jour, pour tout le monde, et
 * silencieusement. Le projet s'est déjà fait prendre sur ce piège (jour civil
 * des tournées 2.24.1, horaires VAK 2.20.0, pause déjeuner 2.47.0). On lit
 * donc les dix premiers caractères, après avoir vérifié que c'en est bien une.
 */
function jourIso(valeur) {
  if (valeur == null || valeur === '') return null;
  const s = String(valeur);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Chaîne nettoyée, ou null — jamais une chaîne vide qui écraserait une valeur. */
function texte(valeur) {
  if (valeur == null) return null;
  const s = String(valeur).trim();
  return s === '' ? null : s;
}

/**
 * Civilité Malibou (`mr` / `mrs`) → sexe SOLIDATA.
 * Toute autre valeur rend `null` : « non reconnu » n'est pas « masculin ».
 */
function sexeDepuisTitre(title) {
  const t = String(title || '').trim().toLowerCase();
  if (t === 'mr') return 'M';
  if (t === 'mrs') return 'F';
  return null;
}

/**
 * Convertit un collaborateur de l'API vers la forme qu'attend
 * `upsertCollaborators`.
 *
 * @param {object} brut        l'objet rendu par l'API
 * @param {object} options
 * @param {Map}    options.matriculeParId  id Malibou → matricule, pour résoudre
 *        le manager : l'API le désigne par son identifiant interne, alors que
 *        SOLIDATA relie les managers par MATRICULE. Sans cet index, le lien
 *        hiérarchique serait posé sur une clé qui ne correspond à rien.
 * @param {object[]} options.contrats  tableau `contracts[]` de la fiche
 *        détaillée, quand il a été chargé.
 */
function mapperCollaborateur(brut, { matriculeParId = new Map(), contrats = null } = {}) {
  if (!brut || typeof brut !== 'object') return null;
  const matricule = texte(brut.personnelNumber);
  const adresse = brut.address && typeof brut.address === 'object' ? brut.address : {};

  // Fin du contrat courant : l'API ne la porte PAS sur `currentContract`, elle
  // n'existe que dans le tableau de la fiche détaillée. On retient la fin la
  // plus tardive parmi les contrats non terminés — un CDD renouvelé en a
  // plusieurs, et c'est la dernière échéance qui intéresse les alertes.
  let finContrat = null;
  if (Array.isArray(contrats)) {
    for (const c of contrats) {
      const fin = jourIso(c && c.endDate);
      if (fin && (!finContrat || fin > finContrat)) finContrat = fin;
    }
  }

  return {
    // ── Identité ────────────────────────────────────────────────────────
    malibou_id: matricule,
    first_name: texte(brut.firstName),
    last_name: texte(brut.lastName),
    birth_name: texte(brut.birthName),
    email: texte(brut.email),
    personal_email: texte(brut.secondaryEmail),
    phone: texte(brut.phoneNumber),
    gender: sexeDepuisTitre(brut.title),
    birth_date: jourIso(brut.birthDate),
    birth_city: texte(brut.birthCity),
    seniority_date: jourIso(brut.seniorityDate),

    // ── Adresse ─────────────────────────────────────────────────────────
    address: texte(adresse.street),
    city: texte(adresse.city),
    postal_code: texte(adresse.zipCode),
    // `country` et `nationality` sont DÉLIBÉRÉMENT laissés de côté : l'API les
    // rend en code ISO minuscule (« fr »), là où le classeur écrit un libellé
    // (« FRANÇAISE »). La fusion écrasant toute valeur non vide, importer le
    // code remplacerait une information lisible par un code — et traduire le
    // code en libellé serait inventer. Ils restent au classeur.

    // ── Rattachements ───────────────────────────────────────────────────
    // L'API désigne le manager par son identifiant interne ; SOLIDATA relie
    // par matricule. Un manager absent de l'index (hors périmètre, ou sans
    // matricule renseigné) rend `null` plutôt qu'un identifiant inexploitable.
    manager_malibou_id: brut.manager && brut.manager.collaboratorId
      ? (matriculeParId.get(brut.manager.collaboratorId) || null)
      : null,
    equipe_label: brut.team && typeof brut.team === 'object' ? texte(brut.team.name) : null,

    // ── Emploi ──────────────────────────────────────────────────────────
    // `status` est calculé par Malibou relativement à AUJOURD'HUI : `active`
    // s'il existe au moins un contrat en cours. Une embauche `future` n'est
    // pas encore dans les effectifs — elle ne doit compter ni aux ETP ni au
    // portefeuille de la CIP avant son premier jour.
    is_active: brut.status === 'active',
    contract_type: NATURE_VERS_TYPE[
      brut.currentContract && brut.currentContract.natureContrat
    ] ?? null,
    contract_start: jourIso(brut.currentContract && brut.currentContract.startDate),
    contract_end: finContrat,
    // weekly_hours et qualification : ABSENTS de l'API (voir l'en-tête). Ne
    // pas les nommer ici les laisse à `null`, donc la fusion COALESCE conserve
    // ce que le classeur a posé — au lieu de l'effacer.
  };
}

/**
 * Convertit une absence de l'API vers la forme de `employee_leaves`.
 * L'identifiant de salarié n'est pas résolu ici : le convertisseur est pur,
 * c'est l'appelant qui connaît la base.
 */
function mapperAbsence(brut) {
  if (!brut || typeof brut !== 'object') return null;
  const debut = jourIso(brut.startDate);
  if (!debut) return null; // sans date de début, la ligne n'a aucun sens
  return {
    collaborator_id_malibou: texte(brut.collaboratorId),
    absence_id_malibou: texte(brut.id),
    // Libellé (clé naturelle partagée avec l'export), et code conservé à côté
    // pour le diagnostic — il ne participe à aucune clé.
    leave_type: libelleAbsence(brut.type),
    code_malibou: texte(brut.type),
    type_category: categorieAbsence(brut.type),
    type_connu: codeAbsenceConnu(brut.type),
    start_date: debut,
    end_date: jourIso(brut.endDate),
    half_day_start: brut.startHalfDay === true,
    half_day_end: brut.endHalfDay === true,
    statut: texte(brut.status),
    request_date: jourIso(brut.createdAt),
    source: 'malibou_api',
  };
}

/** Index id Malibou → matricule, construit sur la liste complète. */
function indexerMatricules(collaborateursBruts) {
  const index = new Map();
  for (const c of collaborateursBruts || []) {
    if (c && c.id && c.personnelNumber) index.set(c.id, String(c.personnelNumber).trim());
  }
  return index;
}

module.exports = {
  NATURE_VERS_TYPE,
  CATEGORIE_PAR_CODE,
  LIBELLE_PAR_CODE,
  libelleAbsence,
  categorieAbsence,
  codeAbsenceConnu,
  jourIso,
  sexeDepuisTitre,
  mapperCollaborateur,
  mapperAbsence,
  indexerMatricules,
};
