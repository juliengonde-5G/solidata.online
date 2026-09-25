/**
 * Reporting Convergence France (programme CVG) — « Outil de dialogue de
 * gestion » (lot 2.60.0 ; contrat `rapports/cip-refonte-2026-09-12/
 * 30-convergence-cvg-cartographie.md` § 2.3).
 *
 * ═══ CE QUE CE DOCUMENT EST ═══════════════════════════════════════════════
 *
 * Le formulaire que le réseau Convergence reçoit chaque semestre : quatre pages,
 * trois parties — le public accompagné sur la période (Partie 1), les moyens
 * humains de l'accompagnement (Partie 2), la situation des salariés sortis
 * (deux tableaux jumeaux « emploi ou formation » / « hors emploi »). La forme
 * composée ici suit l'ORDRE DES LIGNES du formulaire : la personne qui recopie
 * les chiffres doit retrouver ses cases au même endroit.
 *
 * ═══ FORME DES VALEURS (figée avec l'écran et le PDF) ═════════════════════
 *
 *  · Toute ligne de COMPTE d'un tableau est une cellule `{ nb, pct }` :
 *      - `nb` est un ENTIER, ou `null` quand la source est illisible ;
 *      - `pct` est calculé sur la BASE DU TABLEAU, arrondi au dixième, et vaut
 *        `null` quand la base est nulle ou inconnue (jamais « 0 % »).
 *    Bases : Partie 1 → `partie1.base` (salariés accueillis sur la période) ;
 *    catégories de sortie → `sorties.total` (« % du total sorties » du
 *    formulaire) ; freins, logement, santé et post-sortie d'un tableau jumeau →
 *    son `total` (« les % sont calculés sur le total des sorties en emploi »).
 *  · Les effectifs d'en-tête (`partie1.effectifs.*`, `partie1.base`,
 *    `sorties.total`, `sorties.<jumeau>.total`, `duree_moyenne_mois`) sont des
 *    NOMBRES simples.
 *  · Les « non renseigné » sont des ENTIERS rangés dans une clé
 *    `non_renseigne` du bloc — le document DIT combien de personnes manquent,
 *    il ne les range jamais dans une case au jugé.
 *  · Zéro est envoyé explicitement : une clé absente s'afficherait « — ».
 *
 * ═══ CE QU'IL NE FAIT JAMAIS ══════════════════════════════════════════════
 *  · Deviner une catégorie : `heberge` n'est ni collectif ni précaire tant que
 *    la CIP ne l'a pas dit ; un sortant sans catégorie saisie ni type de sortie
 *    transcodable est « non catégorisé ».
 *  · Recopier la règle des sorties : la liste des sortants vient de
 *    `sorties-engine.listerSortants`, alimenté par les MÊMES requêtes que la
 *    synthèse de dialogue de gestion (`chargerFinsEtBilans`).
 *  · Transmettre le frein `numerique`, sans équivalent dans le référentiel du
 *    réseau (la méthode le dit).
 *  · Transmettre le frein JUDICIAIRE (art. 10) sans décision du DPO : par
 *    défaut la colonne n'est pas lue et la ligne « Justice » s'imprime « non
 *    transmis » (correctif B-02, 2.60.0 — réglage
 *    `insertion.cvg_transmettre_justice`).
 *  · Publier la fiche d'une personne : un tableau des sortis comptant moins de
 *    `insertion.cvg_k_min` personnes (défaut 5, plancher 1) ne diffuse ni ses
 *    lignes santé et justice, ni son logement, ni « dont parcours de soin » ;
 *    sous 20 accueillis, la Partie 1 passe par la MÊME règle que la synthèse
 *    de dialogue de gestion (`appliquerKAnonymat`). Correctif B-01, 2.60.0 —
 *    voir `protegerJumeau` et `protegerPartie1`.
 */

'use strict';

const pool = require('../config/database');
const { readInsertionSetting } = require('../utils/insertion-settings');
const { isoDate, ecartJours } = require('../utils/date-iso');
const { escCsv } = require('../utils/export-csv');
const { listerSortants } = require('./sorties-engine');
const {
  chargerFinsEtBilans, lireConvention, APP_VERSION, appliquerKAnonymat,
} = require('./dialogue-gestion');
const R = require('../utils/convergence-cvg-referentiels');
const { rqthDepuisStatutHandicap } = require('../utils/rqth');

const STRUCTURE = 'Solidarité Textiles';
const MENTION = "Document destiné à Convergence France (programme CVG). Parties « Public » et « Sorties » : agrégats, sans nom ni identifiant de salarié en insertion. Partie 2 : nomme les permanents de l'accompagnement. Diffusion ADMIN/RH.";

/**
 * Mention de DIFFUSION RESTREINTE (correctif B-01) — imprimée en tête de
 * chaque page du PDF et en ligne `#` du CSV dès qu'une case publiée compte
 * entre 1 et 4 personnes. Seuil fixe à 5 : elle dit un fait du document
 * (« des effectifs très faibles y figurent »), pas le réglage `k`.
 */
const MENTION_DIFFUSION = 'Contient des effectifs inférieurs à 5 : données à diffusion restreinte, réservées au dialogue de gestion avec Convergence France — ne pas publier ni rediffuser.';
const SEUIL_MENTION = 5;

/** Axes SOLIDATA du formulaire, dans son ordre (`numerique` exclu). */
const AXES = R.DIFFICULTES.map((d) => d.frein);
/** Axe relevant de l'art. 10 RGPD — transmis seulement sur décision du DPO (B-02). */
const AXE_ART10 = 'judiciaire';
/** Axes dont un tableau des sortis sous le seuil ne diffuse pas les lignes (B-01). */
const AXES_SENSIBLES = ['sante', 'judiciaire'];
/** Axes effectivement lus et transmis selon le réglage `insertion.cvg_transmettre_justice`. */
const axesTransmis = (transmettreJustice) => (transmettreJustice ? AXES : AXES.filter((a) => a !== AXE_ART10));
const COL_AXE = (axe) => `frein_${axe}`;

/** Seuil de confidentialité par défaut (réglage `insertion.cvg_k_min`, plancher 1). */
const K_DEFAUT = 5;
/**
 * Effectif accueilli à partir duquel les marginales de la Partie 1 sont
 * publiées brutes : sur une base large, une marginale à 1 ne croise rien et ne
 * désigne personne ; en dessous, la passe de la synthèse s'applique.
 */
const BASE_MARGINALES_BRUTES = 20;

/** Critères d'éligibilité LUS — liste blanche (aucun critère art. 10 n'est lu). */
const CRITERES_LUS = ['brsa', 'ass', 'aah', 'rqth', 'refugie_bpi', 'detld'];

// ───────────────────────────────────────────────────────────────────────────
// Outils
// ───────────────────────────────────────────────────────────────────────────

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Pourcentage au dixième, `null` si la base est nulle ou inconnue. */
function pctDe(n, base) {
  if (n == null || base == null || !Number.isFinite(Number(base)) || Number(base) <= 0) return null;
  return Math.round((Number(n) / Number(base)) * 1000) / 10;
}

/** Cellule `{ nb, pct }`. */
const cellule = (n, base) => ({ nb: n == null ? null : n, pct: pctDe(n, base) });

/**
 * Cellule RETENUE au titre de la confidentialité (B-01) : vide comme une
 * source illisible, mais marquée — l'écran, le PDF et le CSV impriment « s »
 * (secret) et la légende, pour qu'aucune case vide ne reste inexpliquée.
 */
const celluleSecrete = () => ({ nb: null, pct: null, secret: true });

/** Compte `nb` d'une cellule, d'un nombre ou d'une valeur absente. */
function nbDe(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') return num(v.nb);
  return num(v);
}

function lireJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return null; }
}

const contient = (liste, valeur) => Array.isArray(liste)
  && liste.some((x) => String(x || '').trim().toLowerCase() === valeur);

/** Date JJ/MM/AAAA pour les phrases. */
function frDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const fr = (v, dec = 1) => (v == null ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: dec }));

/** Requête résiliente — une source illisible est NOMMÉE dans `sources`. */
function faireSoft(db, sources) {
  return async function soft(label, text, params = []) {
    try {
      const r = await db.query(text, params);
      return r.rows;
    } catch (err) {
      console.error(`[INSERTION][CVG] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
      sources.push(label);
      return null;
    }
  };
}

/** Valide une période 'AAAA-MM-JJ'. Renvoie un message d'erreur ou null. */
function erreurPeriode(debut, fin) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(debut || '')) || !re.test(String(fin || ''))) return 'Période invalide : dates attendues au format AAAA-MM-JJ.';
  const existe = (v) => {
    const [y, m, j] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, j));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === j;
  };
  if (!existe(debut) || !existe(fin)) return 'Période invalide : date inexistante.';
  const jours = ecartJours(debut, fin);
  if (jours == null || jours < 0) return 'Période invalide : la date de fin précède la date de début.';
  const { ajouterMois } = require('../utils/date-iso');
  if (fin > ajouterMois(debut, 24)) return 'Période invalide : 24 mois au plus.';
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Profil d'une personne — PUR
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tout ce que le document dit d'une personne, dérivé de SA ligne de cohorte
 * et de ses critères d'éligibilité. Aucune E/S.
 */
function profilPersonne(row, criteres = new Set(), dateRef, axes = AXES) {
  const fse = lireJson(row.fse_entree) || {};
  const ressources = Array.isArray(row.ressources) ? row.ressources : [];
  const ressFse = String(fse.ressources_principales || '').toLowerCase();

  const habitatSaisi = R.HABITAT_TYPES.includes(row.habitat_type) ? row.habitat_type : null;
  const habitat = habitatSaisi || R.transcoderHabitat(row.logement_statut);

  // CORRECTIF M-02 — la fiche de paie porte un TEXTE LIBRE (« Statut
  // handicap ») : seule une valeur qui DIT une reconnaissance compte (liste
  // blanche partagée `utils/rqth.js`) ; « Non concerné », « En cours »… ne
  // valent jamais RQTH.
  const rqth = criteres.has('rqth') || row.rqth === true || rqthDepuisStatutHandicap(row.disability_status) === true;
  const aah = criteres.has('aah') || contient(ressources, 'aah') || ressFse === 'aah';

  const difficultes = {};
  for (const axe of axes) difficultes[axe] = num(row[`entree_${COL_AXE(axe)}`]);

  const orienteurBrut = row.orienteur_type == null ? null : String(row.orienteur_type);

  return {
    id: Number(row.id),
    sexe: R.sexeCvg({ gender: row.gender, civility: row.civility }),
    age: R.trancheAgeCvg(row.birth_date, dateRef),
    niveau: R.niveauFormationCvg(row.niveau_formation),
    sans_emploi_2ans: criteres.has('detld') || fse.duree_sans_emploi === 'gt_24m',
    rsa: row.brsa === true || criteres.has('brsa') || contient(ressources, 'rsa') || ressFse === 'rsa',
    ass: criteres.has('ass') || contient(ressources, 'ass') || ressFse === 'ass',
    rth: rqth,
    aah,
    refugie: criteres.has('refugie_bpi'),
    habitat,
    habitat_transcode: !habitatSaisi && habitat != null,
    parcours_rue: row.parcours_rue === true,
    difficultes,
    diagnostic: row.diag_id != null,
    orienteur: R.transcoderOrienteur(orienteurBrut),
    orienteur_brut: orienteurBrut,
    pension_invalidite: row.pension_invalidite === true,
    medecin_traitant: row.medecin_traitant === true,
    couverture: row.mutuelle_statut != null && String(row.mutuelle_statut).trim() !== ''
      && String(row.mutuelle_statut).trim().toLowerCase() !== 'aucune',
    debut: isoDate(row.insertion_start_date),
    fin: isoDate(row.insertion_end_date),
  };
}

/** Manques d'une personne, en phrases FALC. `sortant` : situation de sortie. */
function manquesDe(p, sortant = null) {
  const m = [];
  if (!p) return m;
  if (p.sexe == null) m.push(['sexe', 'Sexe non renseigné sur la fiche du salarié']);
  if (p.age == null) m.push(['date_naissance', 'Date de naissance non renseignée']);
  if (p.niveau == null) m.push(['niveau_formation', 'Niveau de formation non renseigné (diagnostic)']);
  if (p.habitat == null) m.push(['habitat', "Type d'habitat à l'entrée à préciser (diagnostic, rubrique Logement)"]);
  if (p.orienteur == null) {
    m.push(['orienteur', p.orienteur_brut === 'autre'
      ? 'Orienteur à préciser : l\'ancienne valeur « Autre » ne correspond à aucune case Convergence'
      : 'Orienteur non renseigné (dossier administratif)']);
  }
  if (Object.values(p.difficultes).every((v) => v == null)) m.push(['freins', "Freins non évalués au diagnostic d'accueil"]);
  if (sortant) {
    if (!sortant.situation) m.push(['situation_sortie', 'Situation de sortie Convergence non saisie (bilan de sortie)']);
    if (!sortant.categorie) m.push(['categorie_sortie', 'Catégorie de sortie Convergence à préciser']);
  }
  return m;
}

// ───────────────────────────────────────────────────────────────────────────
// Chargement — toutes les sources, en une passe par source
// ───────────────────────────────────────────────────────────────────────────

async function chargerDonnees({ debut, fin, db = pool }) {
  const sources = [];
  const soft = faireSoft(db, sources);
  const annee = Number(String(fin).slice(0, 4));

  // Réglages lus AVANT toute requête : le réglage art. 10 décide des COLONNES
  // lues (retrait à la source, comme `AXES_BLOC3` de la synthèse).
  const [seuilBrut, sansBilanBrut, kBrut, justiceBrut] = await Promise.all([
    readInsertionSetting('insertion.cvg_frein_seuil'),
    readInsertionSetting('insertion.cvg_sans_bilan_est_sans_nouvelles'),
    readInsertionSetting('insertion.cvg_k_min'),
    readInsertionSetting('insertion.cvg_transmettre_justice'),
  ]);
  const seuilNum = num(seuilBrut);
  const seuil = seuilNum != null && seuilNum >= 1 && seuilNum <= 5 ? Math.round(seuilNum) : 3;
  const sansBilanSansNouvelles = sansBilanBrut == null ? true : sansBilanBrut === true;
  // B-01 — PLANCHER DE CODE 1 : une valeur illisible, nulle ou négative ne
  // désactive pas la protection, elle retombe sur le défaut.
  const kNum = num(kBrut);
  const kMin = kNum != null && kNum >= 1 ? Math.round(kNum) : K_DEFAUT;
  // B-02 — seul un `true` explicite (décision du DPO) fait lire le frein judiciaire.
  const transmettreJustice = justiceBrut === true;
  const axes = axesTransmis(transmettreJustice);

  const colsEntree = axes.map((a) => `d.${COL_AXE(a)} AS entree_${COL_AXE(a)}`).join(', ');
  const cohorte = await soft('cohorte', `
    SELECT e.id, e.gender, e.civility, e.birth_date, e.brsa, e.orienteur_type, e.disability_status,
           e.insertion_status, e.insertion_start_date, e.insertion_end_date,
           COALESCE(e.parcours_num, 1) AS parcours_num,
           d.id AS diag_id, d.niveau_formation, d.habitat_type, d.logement_statut, d.parcours_rue,
           d.rqth, d.pension_invalidite, d.medecin_traitant, d.mutuelle_statut, d.ressources, d.fse_entree,
           ${colsEntree}
      FROM employees e
      LEFT JOIN insertion_diagnostics d
        ON d.employee_id = e.id AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
     WHERE COALESCE(e.insertion_status, 'none') <> 'none'
       AND (e.insertion_start_date IS NULL OR e.insertion_start_date <= $2::date)
       AND (e.insertion_end_date IS NULL OR e.insertion_end_date >= $1::date)`, [debut, fin]);

  const ids = (cohorte || []).map((r) => Number(r.id)).filter(Number.isFinite);

  const criteresRows = ids.length ? await soft('criteres_eligibilite', `
    SELECT employee_id, critere_code FROM employee_eligibilite
     WHERE employee_id = ANY($1::int[]) AND critere_code = ANY($2::text[])`, [ids, CRITERES_LUS]) : [];
  const criteres = new Map();
  for (const c of criteresRows || []) {
    const k = Number(c.employee_id);
    if (!criteres.has(k)) criteres.set(k, new Set());
    criteres.get(k).add(String(c.critere_code));
  }

  const enContratRows = ids.length ? await soft('en_contrat_fin', `
    SELECT e.id FROM employees e
     WHERE e.id = ANY($1::int[])
       AND (e.insertion_end_date IS NULL OR e.insertion_end_date >= $2::date)
       AND (
         EXISTS (SELECT 1 FROM employee_contracts ec
                  WHERE ec.employee_id = e.id AND ec.start_date <= $2::date
                    AND (ec.end_date IS NULL OR ec.end_date >= $2::date))
         OR (NOT EXISTS (SELECT 1 FROM employee_contracts ec2 WHERE ec2.employee_id = e.id)
             AND e.contract_start <= $2::date
             AND (e.contract_end IS NULL OR e.contract_end >= $2::date))
       )`, [ids, fin]) : [];

  const { fins, bilans } = await chargerFinsEtBilans(soft, { debut, fin, annee });
  const sortantsBruts = listerSortants({ finsParcours: fins || [], bilansClasses: bilans || [] });
  const idsSortants = sortantsBruts.map((s) => s.employee_id);

  // CORRECTIF D-01 (debug sur base réelle, rapport 31) — le bilan de sortie se
  // rédige AVANT la fin du parcours : l'échéancier de l'outil le pose à
  // fin − 15 jours. `chargerFinsEtBilans` ne rend que les bilans RÉDIGÉS dans
  // la période (c'est la méthode A de la synthèse, qui compte des bilans) ; pour
  // un sortant des quinze premiers jours d'un semestre, le bilan tombe donc
  // dans le semestre PRÉCÉDENT, n'est pas apparié, et la personne sortait
  // « sans bilan » — donc « sans nouvelles », hors emploi — alors que son bilan
  // dit « CDI ». Le dénominateur (les fins de parcours) ne change pas : seul
  // l'APPARIEMENT d'un sortant non apparié va chercher le bilan de SON
  // parcours, quelle que soit la date où il a été rédigé.
  const sansBilan = sortantsBruts.filter((s) => !s.bilan).map((s) => s.employee_id);
  const bilansHorsPeriode = sansBilan.length && bilans != null ? await soft('bilans_sortie_hors_periode', `
    SELECT DISTINCT ON (im.employee_id, COALESCE(im.parcours_num, 1))
           im.employee_id, COALESCE(im.parcours_num, 1) AS parcours_num,
           im.sortie_classification, im.sortie_type
      FROM insertion_milestones im
     WHERE im.employee_id = ANY($1::int[])
       AND im.milestone_type = 'bilan_sortie' AND im.status = 'realise'
       AND im.sortie_classification IS NOT NULL
     ORDER BY im.employee_id, COALESCE(im.parcours_num, 1),
              COALESCE(im.completed_date, im.updated_at::date) DESC, im.id DESC`, [sansBilan]) : [];
  const bilanHorsPeriodeParCle = new Map((bilansHorsPeriode || []).map((b) => [
    `${Number(b.employee_id)}#${b.parcours_num == null ? 1 : Number(b.parcours_num)}`, b,
  ]));
  for (const s of sortantsBruts) {
    if (!s.bilan) s.bilan = bilanHorsPeriodeParCle.get(`${s.employee_id}#${s.parcours_num}`) || null;
  }

  const colsLm = axes.map((a) => `im.${COL_AXE(a)}`).join(', ');
  const colsSortie = axes.map((a) => `lm.${COL_AXE(a)} AS sortie_${COL_AXE(a)}`).join(', ');
  const derniereEval = idsSortants.length ? await soft('derniere_evaluation', `
    SELECT e.id, ${colsSortie}
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT ${colsLm}
          FROM insertion_milestones im
         WHERE im.employee_id = e.id
           AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
           AND im.status = 'realise'
           AND COALESCE(${colsLm}) IS NOT NULL
         ORDER BY COALESCE(im.completed_date, im.due_date) DESC, im.id DESC
         LIMIT 1
      ) lm ON true
     WHERE e.id = ANY($1::int[])`, [idsSortants]) : [];

  const situations = idsSortants.length ? await soft('situations_sortie_cvg', `
    SELECT employee_id, parcours_num, categorie, parcours_de_soin, habitat_type_sortie,
           rqth_sortie, aah_sortie, pension_invalidite_sortie, medecin_traitant_sortie,
           couverture_sante_amelioree, accompagnement_post_sortie
      FROM insertion_sortie_cvg WHERE employee_id = ANY($1::int[])`, [idsSortants]) : [];

  const debutsContrat = idsSortants.length ? await soft('debut_contrats_sortants', `
    SELECT employee_id, to_char(MIN(start_date), 'YYYY-MM-DD') AS debut
      FROM employee_contracts WHERE employee_id = ANY($1::int[]) GROUP BY employee_id`, [idsSortants]) : [];

  const ressources = await soft('ressources_cvg', `
    SELECT id, type, nom, fonction, employeur,
           etp_total::float AS etp_total, etp_accompagnement::float AS etp_accompagnement,
           etp_encadrement::float AS etp_encadrement
      FROM insertion_cvg_ressources
     WHERE actif = true
       AND (date_debut IS NULL OR date_debut <= $2::date)
       AND (date_fin IS NULL OR date_fin >= $1::date)
     ORDER BY type, UPPER(nom), id`, [debut, fin]);

  let convention = { etp_conventionnes: null, source: 'non_parametre' };
  try { convention = await lireConvention(db, annee); } catch (_) { /* reste non paramétrée */ }

  // ── Profils ───────────────────────────────────────────────────────────────
  const profils = new Map();
  for (const row of cohorte || []) {
    profils.set(Number(row.id), profilPersonne(row, criteres.get(Number(row.id)) || new Set(), fin, axes));
  }

  const evalParId = new Map((derniereEval || []).map((r) => [Number(r.id), r]));
  const situationParCle = new Map((situations || []).map((s) => [
    `${Number(s.employee_id)}#${s.parcours_num == null ? 1 : Number(s.parcours_num)}`, s,
  ]));
  const debutContratParId = new Map((debutsContrat || []).map((r) => [Number(r.employee_id), isoDate(r.debut)]));

  const sortants = sortantsBruts.map((s) => {
    const p = profils.get(s.employee_id) || null;
    const situation = situationParCle.get(`${s.employee_id}#${s.parcours_num}`) || null;
    let categorie = null;
    let provenance = null;
    if (situation && R.SORTIE_CATEGORIES.includes(situation.categorie)) {
      categorie = situation.categorie; provenance = 'saisie';
    } else if (s.bilan && R.transcoderSortieType(s.bilan.sortie_type)) {
      categorie = R.transcoderSortieType(s.bilan.sortie_type); provenance = 'bilan';
    } else if (!s.bilan && sansBilanSansNouvelles) {
      categorie = 'sans_nouvelles'; provenance = 'sans_bilan';
    }
    const ev = evalParId.get(s.employee_id) || {};
    const sortieFreins = {};
    for (const axe of axes) sortieFreins[axe] = num(ev[`sortie_${COL_AXE(axe)}`]);

    const debutParcours = (p && p.debut) || debutContratParId.get(s.employee_id) || null;
    const finParcours = p && p.fin;
    const jours = debutParcours && finParcours ? ecartJours(debutParcours, finParcours) : null;

    return {
      employee_id: s.employee_id,
      parcours_num: s.parcours_num,
      profil: p,
      bilan: s.bilan,
      situation,
      categorie,
      provenance,
      sortieFreins,
      duree_mois: jours != null && jours >= 0 ? jours / (365.25 / 12) : null,
    };
  });

  return {
    debut, fin, annee, sources, seuil, sansBilanSansNouvelles,
    kMin, kSource: kMin === K_DEFAUT ? 'defaut' : 'reglage', transmettreJustice, axes,
    cohorteLisible: cohorte != null,
    // CORRECTIF M-01 — deux sources secondaires des tableaux des sortis. Une
    // source illisible rend `null` (voir `faireSoft`) ; sans drapeau, les
    // comptages la lisaient comme « personne » et imprimaient 0 %.
    situationsLisibles: situations != null,
    evaluationsLisibles: derniereEval != null,
    profils,
    enContrat: enContratRows == null ? null : enContratRows.length,
    convention,
    sortants,
    sortiesLisibles: fins != null,
    // « Sans bilan de sortie » : compté sur l'appariement ci-dessus (bilan du
    // parcours, quelle que soit sa date de rédaction) — et non plus sur les
    // seuls bilans rédigés dans la période (correctif D-01).
    nonDocumentees: fins == null || bilans == null ? null : sortantsBruts.filter((s) => !s.bilan).length,
    ressources,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Composition
// ───────────────────────────────────────────────────────────────────────────

function composerPartie1(d) {
  const ok = d.cohorteLisible;
  const liste = [...d.profils.values()];
  const base = ok ? liste.length : null;
  const compte = (pred) => (ok ? liste.filter(pred).length : null);
  const c = (pred) => cellule(compte(pred), base);

  const publics = {
    hommes: c((p) => p.sexe === 'H'),
    femmes: c((p) => p.sexe === 'F'),
    moins_26: c((p) => p.age === 'moins_26'),
    de_26_a_49: c((p) => p.age === 'de_26_a_49'),
    plus_50: c((p) => p.age === 'plus_50'),
  };
  for (const n of R.NIVEAUX_FORMATION_CVG) {
    const cel = c((p) => p.niveau === n);
    if (n === 'niv6plus' && !(cel.nb > 0)) continue; // ligne de rattrapage, rendue seulement si utile
    publics[n] = cel;
  }
  publics.total_formation = c((p) => p.niveau != null);
  publics.sans_emploi_2ans = c((p) => p.sans_emploi_2ans);
  publics.rsa_socle = c((p) => p.rsa);
  publics.ass = c((p) => p.ass);
  publics.rth = c((p) => p.rth);
  publics.aah = c((p) => p.aah);
  publics.refugies = c((p) => p.refugie);
  publics.non_renseigne = {
    sexe: compte((p) => p.sexe == null),
    age: compte((p) => p.age == null),
    formation: compte((p) => p.niveau == null),
  };

  const habitat_entree = {};
  for (const h of R.HABITAT_TYPES) habitat_entree[h] = c((p) => p.habitat === h);
  habitat_entree.total = c((p) => p.habitat != null);
  habitat_entree.parcours_rue = c((p) => p.parcours_rue);
  habitat_entree.non_renseigne = compte((p) => p.habitat == null);

  const difficultes_entree = {};
  for (const axe of d.axes) difficultes_entree[axe] = c((p) => p.difficultes[axe] != null && p.difficultes[axe] >= d.seuil);
  difficultes_entree.non_evalue = compte((p) => d.axes.every((a) => p.difficultes[a] == null));

  const orienteurs = {};
  for (const o of R.ORIENTEURS_CVG) orienteurs[o] = c((p) => p.orienteur === o);
  orienteurs.total = c((p) => p.orienteur != null);
  orienteurs.non_renseigne = compte((p) => p.orienteur == null);

  return {
    effectifs: {
      etp_conventionnes: d.convention ? d.convention.etp_conventionnes : null,
      accueillis: base,
      en_contrat_fin: d.enContrat,
    },
    base,
    publics,
    habitat_entree,
    difficultes_entree,
    orienteurs,
  };
}

/**
 * B-01 — Partie 1 d'un PETIT effectif (moins de 20 accueillis, ou moins que
 * `k` si le DPO l'a relevé au-delà) : sur 5 accueillis, « Femmes : 1 » désigne
 * la seule femme du chantier, et avec elle tout ce que les autres lignes à
 * 100 % disent de la cohorte. La protection est celle de la synthèse de
 * dialogue de gestion, RÉUTILISÉE et non recopiée : `appliquerKAnonymat`
 * reçoit une projection de la Partie 1 (des comptes, sans les pourcentages)
 * et les tables de règles propres à ce formulaire — les cinq ventilations qui
 * somment à l'effectif accueilli (sexe, âge, formation, habitat, orienteur)
 * reçoivent la suppression complémentaire ; les marginales (minima sociaux,
 * RTH, parcours de rue, difficultés) ne somment à rien et sont traitées case
 * par case. Au-delà de 20 accueillis, les marginales sont publiées brutes :
 * elles ne croisent rien et ne désignent personne.
 *
 * @returns {number} nombre de valeurs retenues
 */
function protegerPartie1(p1, k) {
  const base = p1 && p1.base;
  if (!(k > 1) || base == null || base >= Math.max(BASE_MARGINALES_BRUTES, k)) return 0;
  const pub = p1.publics;
  const nr = pub.non_renseigne || {};
  const nb = (cel) => (cel && typeof cel === 'object' ? cel.nb : cel);
  const cles = (bloc, liste) => Object.fromEntries(liste.filter((c) => bloc[c] !== undefined).map((c) => [c, nb(bloc[c])]));

  const niveaux = R.NIVEAUX_FORMATION_CVG.filter((n) => pub[n] !== undefined);
  const blocs = {
    base,
    sexe: { ...cles(pub, ['hommes', 'femmes']), non_renseigne: nr.sexe },
    age: { ...cles(pub, ['moins_26', 'de_26_a_49', 'plus_50']), non_renseigne: nr.age },
    formation: { ...cles(pub, niveaux), non_renseigne: nr.formation },
    marginales: {
      ...cles(pub, ['sans_emploi_2ans', 'rsa_socle', 'ass', 'rth', 'aah', 'refugies']),
      parcours_rue: nb(p1.habitat_entree.parcours_rue),
    },
    habitat: { ...cles(p1.habitat_entree, R.HABITAT_TYPES), non_renseigne: p1.habitat_entree.non_renseigne },
    difficultes: { ...cles(p1.difficultes_entree, Object.keys(p1.difficultes_entree)) },
    orienteurs: { ...cles(p1.orienteurs, R.ORIENTEURS_CVG), non_renseigne: p1.orienteurs.non_renseigne },
  };
  const avant = JSON.parse(JSON.stringify(blocs));
  const repartitions = ['sexe', 'age', 'formation', 'habitat', 'orienteurs']
    .map((b) => ({ chemin: `blocs.${b}`, total: 'blocs.base' }));
  appliquerKAnonymat({ blocs }, k, {
    effectifsPublies: new Map([['blocs.base', "effectif accueilli : tête de chapitre de la Partie 1, base de tous ses pourcentages."]]),
    mesures: new Set(),
    dependancesFratrie: {},
    taux: [],
    distributions: repartitions,
    libelles: {},
  });

  let n = 0;
  const retenu = (bloc, cle) => avant[bloc][cle] != null && blocs[bloc][cle] == null;
  const secret = (obj, cle) => { obj[cle] = celluleSecrete(); n += 1; };
  const reporter = (bloc, cible, ventilation) => {
    for (const cle of Object.keys(blocs[bloc])) {
      if (!retenu(bloc, cle)) continue;
      if (cle === 'non_renseigne') { ventilation(); n += 1; continue; }
      if (bloc === 'marginales' && cle === 'parcours_rue') secret(p1.habitat_entree, 'parcours_rue');
      else secret(cible, cle);
    }
  };
  reporter('sexe', pub, () => { nr.sexe = null; });
  reporter('age', pub, () => { nr.age = null; });
  reporter('formation', pub, () => { nr.formation = null; });
  reporter('marginales', pub, () => {});
  reporter('habitat', p1.habitat_entree, () => { p1.habitat_entree.non_renseigne = null; });
  reporter('difficultes', p1.difficultes_entree, () => {});
  reporter('orienteurs', p1.orienteurs, () => { p1.orienteurs.non_renseigne = null; });
  // Un total égale l'effectif moins le « non renseigné » : quand celui-ci est
  // retenu, le publier le rendrait par soustraction.
  if (retenu('formation', 'non_renseigne') && pub.total_formation) secret(pub, 'total_formation');
  if (retenu('habitat', 'non_renseigne') && p1.habitat_entree.total) secret(p1.habitat_entree, 'total');
  if (retenu('orienteurs', 'non_renseigne') && p1.orienteurs.total) secret(p1.orienteurs, 'total');
  if (n > 0) p1.confidentialite = { marginales_protegees: true, k, base_marginales_brutes: BASE_MARGINALES_BRUTES, valeurs_retenues: n };
  return n;
}

/** Vrai si une case PUBLIÉE du document compte entre 1 et 4 personnes. */
function contientEffectifsFaibles(contenu) {
  let trouve = false;
  const faible = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v < SEUIL_MENTION;
  const parcourir = (x) => {
    if (trouve || x == null) return;
    if (Array.isArray(x)) { x.forEach((y) => parcourir(y)); return; }
    if (typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) {
        // Ni les pourcentages, ni les mesures, ni les méta-données de
        // confidentialité ne comptent des personnes.
        if (['pct', 'duree_moyenne_mois', 'etp_conventionnes', 'confidentialite'].includes(k)) continue;
        parcourir(v);
      }
      return;
    }
    if (faible(x)) trouve = true;
  };
  parcourir(contenu.partie1);
  parcourir(contenu.sorties);
  return trouve;
}

function composerPartie2(d) {
  const lignes = d.ressources || [];
  const r2 = (v) => (num(v) == null ? null : Math.round(num(v) * 100) / 100);
  const internes = lignes.filter((r) => r.type === 'interne').map((r) => ({
    nom: r.nom, fonction: r.fonction || null,
    etp_total: r2(r.etp_total), etp_accompagnement: r2(r.etp_accompagnement), etp_encadrement: r2(r.etp_encadrement),
  }));
  const mutualisees = lignes.filter((r) => r.type === 'mutualisee').map((r) => ({
    nom: r.nom, fonction: r.fonction || null, employeur: r.employeur || null, etp_total: r2(r.etp_total),
  }));
  const somme = (liste, champ) => {
    const v = liste.map((x) => x[champ]).filter((x) => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  const ti = somme(internes, 'etp_total');
  const tm = somme(mutualisees, 'etp_total');
  return {
    internes,
    mutualisees,
    totaux: {
      internes: {
        etp_total: ti,
        etp_accompagnement: somme(internes, 'etp_accompagnement'),
        etp_encadrement: somme(internes, 'etp_encadrement'),
      },
      mutualisees: { etp_total: tm },
      cvg: ti == null && tm == null ? null : Math.round(((ti || 0) + (tm || 0)) * 100) / 100,
    },
    registre_lisible: d.ressources != null,
  };
}

/**
 * B-01 — un tableau des sortis de 1 à k−1 personnes n'est plus un agrégat :
 * c'est la fiche d'une personne que tout l'atelier sait nommer (sa catégorie
 * de sortie la désigne). Ses lignes SENSIBLES sont retenues, zéros compris —
 * sur trois personnes, « 0 % en difficulté de santé » est un attribut des
 * trois autant que « 100 % » (attaque d'homogénéité) :
 *   · freins santé et justice (entrée et résolution) ;
 *   · tout le logement entrée / sortie — rue et hébergement précaire en
 *     premier, mais retenir ces deux lignes seules les laisserait se
 *     reconstituer par soustraction des trois autres et du « non renseigné » ;
 *   · toute la santé (RQTH, AAH, pension, médecin traitant, couverture) ;
 *   · « dont sortie en parcours de soin ».
 * Restent publiés : le total, les catégories de sortie et les autres freins —
 * ce que le réseau lit en premier.
 *
 * POURQUOI PAS `appliquerKAnonymat` ICI : cette passe garde les ZÉROS
 * (« personne dans cette catégorie ne désigne personne »), ce qui est juste sur
 * une base large et faux sur un tableau plus petit que le seuil, où le zéro
 * est le complément exact d'une personne nommable. La règle est donc « tableau
 * sous le seuil → lignes sensibles retenues », et non « case sous le seuil ».
 *
 * @returns {number} nombre de cellules retenues (0 si le tableau est diffusé)
 */
function protegerJumeau(j, k) {
  if (!(k > 1) || !(j.total >= 1) || j.total >= k) return 0;
  let n = 0;
  const retenir = (obj, cle) => { if (obj && obj[cle] !== undefined) { obj[cle] = celluleSecrete(); n += 1; } };
  for (const axe of AXES_SENSIBLES) {
    if (j.freins[axe]) { retenir(j.freins[axe], 'entree'); retenir(j.freins[axe], 'resolution'); }
  }
  for (const h of Object.keys(j.logement)) { retenir(j.logement[h], 'entree'); retenir(j.logement[h], 'sortie'); }
  for (const l of Object.keys(j.sante)) { retenir(j.sante[l], 'entree'); retenir(j.sante[l], 'sortie'); }
  retenir(j.categories, 'parcours_de_soin');
  j.confidentialite = { lignes_retenues: true, k, cellules_retenues: n };
  return n;
}

/** Un tableau jumeau (emploi ou hors emploi) à partir de SES sortants. */
function composerSousPopulation(d, sortants, categories, totalSorties, nonCategorises) {
  const n = sortants.length;
  const base = n;
  const cptSortants = (pred) => sortants.filter(pred).length;
  // CORRECTIF M-01 — une source illisible rend la cellule VIDE, jamais 0 :
  // la situation de sortie porte logement / santé à la sortie, post-sortie et
  // parcours de soin ; la dernière évaluation porte la résolution des freins.
  const siSituations = (x) => (d.situationsLisibles ? x : null);
  const siEvaluations = (x) => (d.evaluationsLisibles ? x : null);

  const cats = {};
  for (const k of categories) cats[k] = cellule(cptSortants((s) => s.categorie === k), totalSorties);
  if (categories.includes('autre_positive')) {
    // CORRECTIF m-04 — « DONT » parcours de soin : un sous-ensemble de la
    // sortie « autre reconnue positive », jamais au-delà.
    cats.parcours_de_soin = cellule(siSituations(cptSortants((s) => s.categorie === 'autre_positive'
      && s.situation && s.situation.parcours_de_soin === true)), totalSorties);
  }

  const freins = {};
  for (const axe of d.axes) {
    const entree = cptSortants((s) => s.profil && s.profil.difficultes[axe] != null && s.profil.difficultes[axe] >= d.seuil);
    const resolution = cptSortants((s) => {
      const e = s.profil ? s.profil.difficultes[axe] : null;
      const f = s.sortieFreins[axe];
      return e != null && f != null && f < e;
    });
    freins[axe] = { entree: cellule(entree, base), resolution: cellule(siEvaluations(resolution), base) };
  }

  const logement = {};
  for (const h of R.HABITAT_TYPES) {
    logement[h] = {
      entree: cellule(cptSortants((s) => s.profil && s.profil.habitat === h), base),
      sortie: cellule(siSituations(cptSortants((s) => s.situation && s.situation.habitat_type_sortie === h)), base),
    };
  }

  const bool = (s, champ) => !!(s.situation && s.situation[champ] === true);
  const sortie = (champ) => cellule(siSituations(cptSortants((s) => bool(s, champ))), base);
  const sante = {
    rqth: { entree: cellule(cptSortants((s) => s.profil && s.profil.rth), base), sortie: sortie('rqth_sortie') },
    aah: { entree: cellule(cptSortants((s) => s.profil && s.profil.aah), base), sortie: sortie('aah_sortie') },
    pension_invalidite: {
      entree: cellule(cptSortants((s) => s.profil && s.profil.pension_invalidite), base),
      sortie: sortie('pension_invalidite_sortie'),
    },
    medecin_traitant: {
      entree: cellule(cptSortants((s) => s.profil && s.profil.medecin_traitant), base),
      sortie: sortie('medecin_traitant_sortie'),
    },
    couverture_sante_amelioree: {
      // À l'entrée : personnes DÉJÀ couvertes (complémentaire santé déclarée) —
      // repère pour lire l'amélioration saisie à la sortie.
      entree: cellule(cptSortants((s) => s.profil && s.profil.couverture), base),
      sortie: sortie('couverture_sante_amelioree'),
    },
  };

  const j = {
    total: n,
    categories: cats,
    non_categorises: nonCategorises,
    freins,
    logement,
    sante,
    post_sortie: sortie('accompagnement_post_sortie'),
    non_renseigne: {
      habitat_entree: cptSortants((s) => !s.profil || s.profil.habitat == null),
      habitat_sortie: siSituations(cptSortants((s) => !s.situation || !s.situation.habitat_type_sortie)),
      freins_non_evalues: cptSortants((s) => !s.profil || d.axes.every((a) => s.profil.difficultes[a] == null)),
      situation_sortie: siSituations(cptSortants((s) => !s.situation)),
    },
  };
  protegerJumeau(j, d.kMin);
  return j;
}

function composerSorties(d) {
  if (!d.sortiesLisibles) {
    return {
      total: null, non_documentees: null, duree_moyenne_mois: null,
      emploi: null, hors_emploi: null, non_categorises: null,
    };
  }
  const total = d.sortants.length;
  const emploi = d.sortants.filter((s) => R.SORTIE_CATEGORIES_EMPLOI.includes(s.categorie));
  const horsEmploi = d.sortants.filter((s) => R.SORTIE_CATEGORIES_HORS_EMPLOI.includes(s.categorie));
  const nonCat = d.sortants.filter((s) => !s.categorie);
  // Un sortant non catégorisé n'entre dans AUCUN des deux tableaux : on ne
  // devine pas son côté. Sa classification DREETS, quand elle existe, suffit
  // pourtant à dire s'il relève de l'emploi (durable / de transition) ou non
  // (« autre ») : il est alors compté dans le `non_categorises` de ce côté,
  // pour que la CIP sache où le chercher. `sortie_positive` reste ambiguë
  // (formation ou « autre reconnue positive ») et n'est rangée d'aucun côté.
  const cote = (s) => {
    const c = s.bilan && s.bilan.sortie_classification;
    if (c === 'emploi_durable' || c === 'emploi_transition') return 'emploi';
    if (c === 'autre') return 'hors_emploi';
    return null;
  };
  const durees = d.sortants.map((s) => s.duree_mois).filter((v) => v != null);
  return {
    total,
    non_documentees: d.nonDocumentees,
    duree_moyenne_mois: durees.length
      ? Math.round((durees.reduce((a, b) => a + b, 0) / durees.length) * 10) / 10 : null,
    non_categorises: nonCat.length,
    emploi: composerSousPopulation(d, emploi, R.SORTIE_CATEGORIES_EMPLOI, total,
      nonCat.filter((s) => cote(s) === 'emploi').length),
    hors_emploi: composerSousPopulation(d, horsEmploi, R.SORTIE_CATEGORIES_HORS_EMPLOI, total,
      nonCat.filter((s) => cote(s) === 'hors_emploi').length),
  };
}

function composerCompletudeInterne(d) {
  const manquesParType = {};
  let incomplets = 0;
  const sortantParId = new Map(d.sortants.map((s) => [s.employee_id, s]));
  const ids = new Set([...d.profils.keys(), ...sortantParId.keys()]);
  const parPersonne = [];
  for (const id of ids) {
    const m = manquesDe(d.profils.get(id), sortantParId.get(id) || null);
    if (m.length) {
      incomplets += 1;
      for (const [type] of m) manquesParType[type] = (manquesParType[type] || 0) + 1;
      parPersonne.push({ employee_id: id, manques: m.map(([, t]) => t) });
    }
  }
  return { nb_incomplets: incomplets, manques_par_type: manquesParType, parPersonne };
}

function composerMethode(d, contenu) {
  const m = [
    `Période : du ${frDate(d.debut)} au ${frDate(d.fin)}. « Salariés accueillis » : toute personne en parcours d'insertion (hors permanents) dont le parcours chevauche la période, au moins un jour — c'est aussi la base des pourcentages de la Partie 1.`,
    "« En contrat à la date de fin » : salarié de la cohorte dont le parcours n'est pas terminé à cette date et dont un contrat (historique des contrats, à défaut la fiche) couvre cette date.",
    "ETP conventionnés : annexe financière saisie dans le module Effectifs ETP (repli : cible « insertion »). Non paramétré → cellule vide, jamais une valeur estimée.",
    "Sexe : la donnée déclarée de la fiche fait foi, la civilité n'est qu'un repli ; une civilité non reconnue est comptée « non renseigné ». Âge : calculé à la date de fin de période (moins de 26 ans, 26 à 49 ans, 50 ans et plus).",
    "Niveau de formation : celui du diagnostic d'accueil. La ligne « 6 et plus (niveau non détaillé) » regroupe les fiches saisies avant la distinction des niveaux 6, 7 et 8 ; elle n'est imprimée que si elle compte quelqu'un.",
    "N'ayant pas travaillé depuis 2 ans et plus : critère d'éligibilité « chômage de très longue durée » OU réponse « plus de 24 mois » au questionnaire d'entrée. RSA socle : statut BRSA de la fiche, critère d'éligibilité ou ressource déclarée. ASS, AAH, réfugiés : critère d'éligibilité ou ressource déclarée. RTH : critère RQTH, RQTH du diagnostic ou reconnaissance portée par la fiche de paie — pour celle-ci, seul un libellé qui DIT une reconnaissance compte (« RQTH », « Travailleur handicapé », « Reconnu »…) ; « Non concerné », « En cours », « Pas de RQTH » ou tout texte inconnu ne sont jamais comptés. L'AAH est comptée qu'il y ait ou non une RQTH saisie.",
    "Type d'habitat à l'entrée : celui saisi au diagnostic dans la nomenclature Convergence ; à défaut, déduit du statut de logement quand la correspondance est univoque (locataire ou propriétaire → logement autonome ; sans abri → rue). « Hébergé » ne se range dans aucune case sans saisie : il est compté « non renseigné ».",
    `Difficulté à l'entrée : niveau du frein au diagnostic d'accueil supérieur ou égal à ${d.seuil} sur l'échelle 1 (pas de difficulté) à 5 (bloquant). Le frein « numérique » de l'outil n'a pas d'équivalent Convergence : il n'est pas transmis.`,
    d.transmettreJustice
      ? "Frein « Justice » : donnée relevant de l'article 10 du RGPD (infractions et condamnations), transmise en agrégat sur décision de la structure (réglage insertion.cvg_transmettre_justice, réservé à une décision du DPO)."
      : "Frein « Justice » : non transmis — donnée relevant de l'article 10 du RGPD (infractions et condamnations), que la structure ne communique pas à un tiers privé sans décision du DPO. La ligne figure au formulaire avec la mention « non transmis », à l'entrée comme dans les tableaux des sortis ; cette mention est la même quelle que soit la situation des personnes.",
    "Orienteur : les anciennes saisies « Département — CMS » et « CCAS » sont rangées respectivement en « Services sociaux du Département » et « Autre acteur local d'accompagnement » ; l'ancienne valeur « Autre » ne dit pas lequel des acteurs : elle est comptée « non renseigné » jusqu'à ce qu'elle soit précisée.",
    "Moyens humains : registre tenu dans l'outil (ressources actives sur la période) ; un registre vide rend des totaux vides, jamais zéro.",
    "Salariés sortis : TOUTES les fins de parcours de la période, qu'un bilan de sortie ait été rédigé ou non — même dénominateur que la synthèse de dialogue de gestion. Durée moyenne : de l'entrée à la fin du parcours (à défaut de date d'entrée, le premier contrat), en mois moyens de 30,4 jours.",
    "Catégorie de sortie Convergence : celle saisie dans la situation de sortie ; à défaut, déduite du type de sortie du bilan (CDI, CDD, intérim, création → emploi ; autre structure d'insertion → suite de parcours ; formation → formation ; fin de contrat → sans solution emploi ; sans suite → sans nouvelles, approximation à valider).",
    d.sansBilanSansNouvelles
      ? 'Un salarié parti sans bilan de sortie est compté « sans nouvelles » (réglage de la structure) ; sa catégorie reste saisissable.'
      : "Un salarié parti sans bilan de sortie n'est rangé dans aucune catégorie : il est compté « non catégorisé ».",
    "Un sortant dont la catégorie n'est ni saisie ni déductible est « non catégorisé » : il n'entre dans aucun des deux tableaux, et le nombre de ces personnes est donné à part.",
    `Évolution des freins d'un tableau : « difficultés à l'entrée » = niveau au diagnostic ≥ ${d.seuil} ; « résolution totale ou partielle » = niveau à la DERNIÈRE évaluation (dernier entretien réalisé portant une cotation) strictement inférieur au niveau d'entrée, quel que soit ce niveau d'entrée.`,
    "Logement et santé à la sortie, accompagnement post-sortie : saisis dans la situation de sortie Convergence ; non saisis → non comptés, et le nombre de situations non saisies est donné à part. Couverture santé à l'entrée : complémentaire santé déclarée au diagnostic (tout statut autre que « aucune »).",
    "Les pourcentages sont calculés sur l'effectif accueilli (Partie 1), sur le total des sorties (catégories de sortie) ou sur le total du tableau (freins, logement, santé, post-sortie) ; une base nulle ne donne jamais « 0 % ».",
    "« Dont sortie en parcours de soin » : sous-ensemble des sorties « autre reconnue positive », jamais au-delà.",
    d.kMin > 1
      ? `Seuil de confidentialité k = ${d.kMin} (${d.kSource === 'defaut' ? 'défaut de l\'outil' : 'réglage de la structure'}, insertion.cvg_k_min — arbitrage du DPO). Un tableau des sortis comptant moins de ${d.kMin} personnes ne diffuse pas ses lignes santé et justice, son logement entrée / sortie ni « dont parcours de soin » : sa catégorie de sortie désigne les personnes, et ces lignes deviendraient leur fiche. Sous ${Math.max(BASE_MARGINALES_BRUTES, d.kMin)} accueillis, les cases de la Partie 1 comptant de 1 à ${d.kMin - 1} personnes sont retenues, ainsi qu'une case complémentaire par ventilation (même règle que la synthèse de dialogue de gestion). Une case retenue s'imprime « s » (secret), jamais 0. À k = 5, avec 3 à 4 sortants par semestre, les lignes santé / justice des tableaux des sortis sont vides — c'est le prix de la protection, arbitrage DPO.`
      : "Aucun seuil de confidentialité n'est appliqué (k = 1, décision de la structure — insertion.cvg_k_min) : le document reproduit le format brut du réseau, effectifs de 1 et 2 compris.",
    "Réservé aux rôles ADMIN et RH ; chaque production est journalisée. Aucun nom de personne accompagnée n'y figure — mais des effectifs très faibles peuvent désigner une personne : diffusion restreinte au dialogue de gestion avec Convergence France.",
  ];
  if (!d.situationsLisibles) {
    m.push("Situations de sortie Convergence illisibles lors de la composition : logement et santé à la sortie, accompagnement post-sortie et parcours de soin sont vides, jamais à zéro.");
  }
  if (!d.evaluationsLisibles) {
    m.push("Évaluations de sortie illisibles lors de la composition : la résolution des freins est vide, jamais à zéro.");
  }
  if (d.sources.length) {
    m.push(`Sources illisibles lors de la composition (${d.sources.join(', ')}) : les cellules concernées sont vides, jamais à zéro.`);
  }
  if (contenu.completude && contenu.completude.nb_incomplets > 0) {
    m.push("Des dossiers sont incomplets : la liste nominative (réservée à l'outil) indique, personne par personne, ce qui reste à saisir.");
  }
  return m;
}

/**
 * Compose le document Convergence d'une période.
 *
 * @param {object} p
 * @param {string} p.debut 'AAAA-MM-JJ'
 * @param {string} p.fin   'AAAA-MM-JJ'
 * @param {{query: Function}} [p.db] pool ou client
 * @param {object} [p.user] générateur (prénom + initiale et rôle imprimés)
 */
async function composerCvg({ debut, fin, db = pool, user = null } = {}) {
  const erreur = erreurPeriode(debut, fin);
  if (erreur) throw Object.assign(new Error(erreur), { code: 'PERIODE_INVALIDE' });
  const d = await chargerDonnees({ debut, fin, db });

  const contenu = {
    en_tete: {
      structure: STRUCTURE,
      periode_debut: debut,
      periode_fin: fin,
      genere_le: new Date().toISOString(),
      genere_par_nom: user && user.first_name
        ? `${user.first_name} ${user.last_name ? `${String(user.last_name).charAt(0)}.` : ''}`.trim()
        : null,
      genere_par_role: user && user.role ? String(user.role) : null,
      version: APP_VERSION,
      mention: MENTION,
      // CORRECTIF m-08 — la méthode est ENREGISTRÉE avec le document : la
      // comparaison de deux instantanés vérifie qu'ils ont été composés avec
      // les mêmes réglages avant de rédiger une « hausse ».
      parametres: {
        seuil_frein: d.seuil,
        sans_bilan_sans_nouvelles: d.sansBilanSansNouvelles,
        k_min: d.kMin,
        transmettre_justice: d.transmettreJustice,
      },
    },
    partie1: composerPartie1(d),
    partie2: composerPartie2(d),
    sorties: composerSorties(d),
  };
  // ── B-01 : protection APRÈS composition, AVANT la méthode et la mention ──
  const retenuesP1 = protegerPartie1(contenu.partie1, d.kMin);
  const sousSeuil = [];
  if (retenuesP1 > 0) sousSeuil.push({ bloc: 'partie1', libelle: 'Partie 1 — le public', nb: retenuesP1 });
  for (const [cle, libelle] of [['emploi', 'Sortis en emploi ou formation'], ['hors_emploi', 'Sortis hors emploi']]) {
    const j = contenu.sorties && contenu.sorties[cle];
    if (j && j.confidentialite) sousSeuil.push({ bloc: cle, libelle, nb: j.confidentialite.cellules_retenues });
  }
  const diffusionRestreinte = contientEffectifsFaibles(contenu);
  contenu.en_tete.diffusion_restreinte = diffusionRestreinte;
  contenu.en_tete.mention_diffusion = diffusionRestreinte ? MENTION_DIFFUSION : null;
  contenu.confidentialite = {
    k_min: d.kMin,
    k_source: d.kSource,
    base_marginales_brutes: BASE_MARGINALES_BRUTES,
    transmettre_justice: d.transmettreJustice,
    sous_seuil: sousSeuil,
    sous_seuil_total: sousSeuil.reduce((a, b) => a + b.nb, 0),
  };
  const comp = composerCompletudeInterne(d);
  contenu.completude = { nb_incomplets: comp.nb_incomplets, manques_par_type: comp.manques_par_type };
  contenu.methode = composerMethode(d, contenu);
  return contenu;
}

/**
 * Liste nominative des dossiers incomplets (écran interne ADMIN/RH — jamais
 * dans le document transmis).
 * @returns {Promise<Array<{employee_id:number, nom:string, manques:string[], lien:string}>>}
 */
async function composerCompletude({ debut, fin, db = pool } = {}) {
  const erreur = erreurPeriode(debut, fin);
  if (erreur) throw Object.assign(new Error(erreur), { code: 'PERIODE_INVALIDE' });
  const d = await chargerDonnees({ debut, fin, db });
  const { parPersonne } = composerCompletudeInterne(d);
  if (!parPersonne.length) return [];
  const r = await db.query(
    'SELECT id, first_name, last_name FROM employees WHERE id = ANY($1::int[])',
    [parPersonne.map((p) => p.employee_id)]
  );
  const noms = new Map(r.rows.map((x) => [Number(x.id),
    `${String(x.last_name || '').toUpperCase()} ${x.first_name || ''}`.trim()]));
  return parPersonne
    .map((p) => ({
      employee_id: p.employee_id,
      nom: noms.get(p.employee_id) || `Salarié n° ${p.employee_id}`,
      manques: p.manques,
      lien: `/insertion?employee=${p.employee_id}`,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
}

/**
 * Le document est VIDE quand la période n'a ni accueilli ni sorti.
 *
 * CORRECTIF m-07 — `null` (INCONNU) quand ni l'un ni l'autre n'a pu être lu
 * et qu'aucun des deux n'est positif : « aucun salarié accueilli ni sorti »
 * serait alors une affirmation fausse ; la route répond 503 en le disant.
 * @returns {true|false|null}
 */
function cvgEstVide(contenu) {
  const lire = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const acc = lire(contenu && contenu.partie1 && contenu.partie1.effectifs ? contenu.partie1.effectifs.accueillis : null);
  const so = lire(contenu && contenu.sorties ? contenu.sorties.total : null);
  if ((acc || 0) > 0 || (so || 0) > 0) return false;
  if (acc === 0 && so === 0) return true;
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Comparaison — PURE
// ───────────────────────────────────────────────────────────────────────────

const LIBELLES_FREINS = Object.fromEntries(R.DIFFICULTES.map((x) => [x.frein, x.libelle]));

/**
 * Indicateurs comparés. `polarite` : +1 une hausse est favorable, −1
 * défavorable, 0 neutre (structure du public : ni bien ni mal).
 */
/**
 * Axes « résolution » comparés : hors santé et justice. Ces deux lignes sont
 * retenues dans tout tableau des sortis sous le seuil de confidentialité (B-01)
 * et la justice n'est transmise que sur décision du DPO (B-02) : les inclure
 * rendrait l'indicateur non comparable presque chaque semestre, ou le ferait
 * varier au gré d'un réglage plutôt que des parcours.
 */
const AXES_RESOLUTION_COMPARES = AXES.filter((a) => !AXES_SENSIBLES.includes(a));

/** Axes présents dans l'un au moins des deux documents (union, ordre du formulaire). */
function axesDe(...docs) {
  const presents = new Set();
  for (const c of docs) {
    const dif = (c && c.partie1 && c.partie1.difficultes_entree) || null;
    if (!dif) continue;
    for (const a of AXES) if (Object.prototype.hasOwnProperty.call(dif, a)) presents.add(a);
  }
  return presents.size ? AXES.filter((a) => presents.has(a)) : AXES;
}

function indicateurs(c, axes = AXES) {
  const p1 = (c && c.partie1) || {};
  const pub = p1.publics || {};
  const hab = p1.habitat_entree || {};
  const dif = p1.difficultes_entree || {};
  const so = (c && c.sorties) || {};
  const base1 = num(p1.base ?? p1.effectifs?.accueillis);
  const tot = num(so.total);
  const somme = (...vals) => (vals.some((v) => v == null) ? null : vals.reduce((a, b) => a + b, 0));
  const resol = () => {
    if (!so.emploi || !so.hors_emploi) return null;
    const v = [];
    for (const j of [so.emploi, so.hors_emploi]) {
      for (const axe of AXES_RESOLUTION_COMPARES) v.push(nbDe(j.freins && j.freins[axe] && j.freins[axe].resolution));
    }
    return somme(...v);
  };
  const liste = [
    { bloc: 'Public', indicateur: 'accueillis', libelle: 'Salariés accueillis sur la période', nb: num(p1.effectifs?.accueillis), base: null, polarite: 0 },
    { bloc: 'Public', indicateur: 'en_contrat_fin', libelle: 'Salariés en contrat à la date de fin', nb: num(p1.effectifs?.en_contrat_fin), base: null, polarite: 0 },
    { bloc: 'Public', indicateur: 'femmes', libelle: 'Part de femmes', nb: nbDe(pub.femmes), base: base1, polarite: 0 },
    { bloc: 'Public', indicateur: 'moins_26', libelle: 'Part des moins de 26 ans', nb: nbDe(pub.moins_26), base: base1, polarite: 0 },
    { bloc: 'Public', indicateur: 'plus_50', libelle: 'Part des 50 ans et plus', nb: nbDe(pub.plus_50), base: base1, polarite: 0 },
    { bloc: 'Public', indicateur: 'rsa_socle', libelle: 'Part des bénéficiaires du RSA', nb: nbDe(pub.rsa_socle), base: base1, polarite: 0 },
    { bloc: 'Public', indicateur: 'rth', libelle: 'Part des demandeurs d’emploi RTH', nb: nbDe(pub.rth), base: base1, polarite: 0 },
    { bloc: 'Public', indicateur: 'sans_emploi_2ans', libelle: 'Part sans emploi depuis 2 ans et plus', nb: nbDe(pub.sans_emploi_2ans), base: base1, polarite: 0 },
    { bloc: 'Public', indicateur: 'refugies', libelle: 'Part des réfugiés', nb: nbDe(pub.refugies), base: base1, polarite: 0 },
    { bloc: 'Habitat', indicateur: 'precaire_ou_rue', libelle: 'Part en hébergement précaire ou à la rue à l’entrée', nb: somme(nbDe(hab.hebergement_precaire), nbDe(hab.rue)), base: base1, polarite: 0 },
    { bloc: 'Habitat', indicateur: 'parcours_rue', libelle: 'Part ayant connu un parcours de rue', nb: nbDe(hab.parcours_rue), base: base1, polarite: 0 },
    ...axes.map((axe) => ({
      bloc: 'Difficultés à l’entrée', indicateur: `difficulte_${axe}`, libelle: `Difficulté à l’entrée — ${LIBELLES_FREINS[axe]}`,
      nb: nbDe(dif[axe]), base: base1, polarite: 0,
    })),
    { bloc: 'Sorties', indicateur: 'sorties_total', libelle: 'Salariés sortis sur la période', nb: tot, base: null, polarite: 0 },
    { bloc: 'Sorties', indicateur: 'acces_emploi_formation', libelle: 'Part des sortants en emploi ou en formation', nb: so.emploi ? num(so.emploi.total) : null, base: tot, polarite: 1 },
    { bloc: 'Sorties', indicateur: 'hors_emploi', libelle: 'Part des sortants hors emploi', nb: so.hors_emploi ? num(so.hors_emploi.total) : null, base: tot, polarite: 0 },
    { bloc: 'Sorties', indicateur: 'non_documentees', libelle: 'Part des sorties sans bilan de sortie', nb: num(so.non_documentees), base: tot, polarite: -1 },
    { bloc: 'Sorties', indicateur: 'post_sortie', libelle: 'Part des sortants accompagnés après la sortie', nb: somme(nbDe(so.emploi && so.emploi.post_sortie), nbDe(so.hors_emploi && so.hors_emploi.post_sortie)), base: tot, polarite: 1 },
    { bloc: 'Sorties', indicateur: 'freins_resolus', libelle: 'Freins résolus totalement ou partiellement à la sortie (hors santé et justice)', nb: resol(), base: null, polarite: 1 },
    { bloc: 'Sorties', indicateur: 'duree_moyenne_mois', libelle: 'Durée moyenne du parcours (mois)', nb: num(so.duree_moyenne_mois), base: null, polarite: 0, duree: true },
  ];
  return liste;
}

const SEUIL_STABLE_PTS = 2;

function sensDe(ind, aNb, aPct, bNb, bPct) {
  if (aNb == null || bNb == null) return { sens: 'neutre', comparable: false };
  if (aPct != null && bPct != null) {
    const d = bPct - aPct;
    if (Math.abs(d) <= SEUIL_STABLE_PTS) return { sens: 'stable', comparable: true };
    if (ind.polarite === 0) return { sens: 'neutre', comparable: true };
    return { sens: (d > 0) === (ind.polarite > 0) ? 'favorable' : 'defavorable', comparable: true };
  }
  if (ind.base != null) return { sens: 'neutre', comparable: false }; // base nulle d'un côté
  const d = bNb - aNb;
  if (ind.duree ? Math.abs(d) <= 0.5 : d === 0) return { sens: 'stable', comparable: true };
  if (ind.polarite === 0) return { sens: 'neutre', comparable: true };
  return { sens: (d > 0) === (ind.polarite > 0) ? 'favorable' : 'defavorable', comparable: true };
}

function periodeDe(c) {
  const e = (c && c.en_tete) || {};
  return { debut: e.periode_debut || null, fin: e.periode_fin || null };
}

const libellePeriode = (p) => `du ${frDate(p.debut)} au ${frDate(p.fin)}`;

/**
 * Compare deux contenus composés : `a` est la période de référence, `b` la
 * période comparée. Les phrases décrivent ce qui CHANGE, jamais pourquoi.
 */
/**
 * CORRECTIF m-08 — réglages de méthode qui changent les comptes. Deux
 * documents composés avec des réglages différents ne se comparent pas sur les
 * indicateurs que ces réglages touchent : la « hausse » ne serait que l'effet
 * du réglage.
 */
const PARAMETRES_METHODE = [
  { cle: 'seuil_frein', libelle: "le seuil de difficulté à l'entrée", blocs: ['Difficultés à l’entrée'], indicateurs: [] },
  { cle: 'sans_bilan_sans_nouvelles', libelle: 'le rangement des sortis sans bilan en « sans nouvelles »', blocs: [], indicateurs: ['acces_emploi_formation', 'hors_emploi'] },
  { cle: 'transmettre_justice', libelle: 'la transmission du frein « Justice »', blocs: [], indicateurs: ['difficulte_judiciaire'] },
  { cle: 'k_min', libelle: 'le seuil de confidentialité', blocs: [], indicateurs: [] },
];

function differencesDeMethode(a, b) {
  const pa = a && a.en_tete && a.en_tete.parametres;
  const pb = b && b.en_tete && b.en_tete.parametres;
  if (!pa || !pb) return { connues: false, differences: [] };
  return {
    connues: true,
    differences: PARAMETRES_METHODE.filter((p) => JSON.stringify(pa[p.cle]) !== JSON.stringify(pb[p.cle]))
      .map((p) => ({ ...p, a: pa[p.cle], b: pb[p.cle] })),
  };
}

function comparerCvg(a, b) {
  const axes = axesDe(a, b);
  const ia = indicateurs(a, axes);
  const ib = indicateurs(b, axes);
  const methode = differencesDeMethode(a, b);
  const touche = (x) => methode.differences.some((p) => p.blocs.includes(x.bloc) || p.indicateurs.includes(x.indicateur));
  const deltas = ia.map((x, i) => {
    const y = ib[i];
    const aPct = x.base == null ? null : pctDe(x.nb, x.base);
    const bPct = y.base == null ? null : pctDe(y.nb, y.base);
    if (touche(x)) {
      return {
        bloc: x.bloc, indicateur: x.indicateur, libelle: x.libelle,
        a_nb: x.nb, a_pct: aPct, b_nb: y.nb, b_pct: bPct,
        delta_nb: null, delta_pts: null, sens: 'neutre', non_comparable: true, motif: 'methode',
      };
    }
    const { sens, comparable } = sensDe(x, x.nb, aPct, y.nb, bPct);
    const deltaNb = comparable ? Math.round((y.nb - x.nb) * 10) / 10 : null;
    const deltaPts = comparable && aPct != null && bPct != null ? Math.round((bPct - aPct) * 10) / 10 : null;
    return {
      bloc: x.bloc, indicateur: x.indicateur, libelle: x.libelle,
      a_nb: x.nb, a_pct: aPct, b_nb: y.nb, b_pct: bPct,
      delta_nb: deltaNb, delta_pts: deltaPts, sens,
      ...(comparable ? {} : { non_comparable: true }),
    };
  });
  const pa = periodeDe(a);
  const pb = periodeDe(b);
  const trouver = (k) => deltas.find((d) => d.indicateur === k);

  const evolutionPts = (d) => {
    if (d.delta_pts == null) return '';
    if (Math.abs(d.delta_pts) <= SEUIL_STABLE_PTS) return ` (stable : écart de ${fr(Math.abs(d.delta_pts))} point${Math.abs(d.delta_pts) >= 2 ? 's' : ''})`;
    return d.delta_pts > 0 ? ` (en hausse de ${fr(d.delta_pts)} points)` : ` (en baisse de ${fr(-d.delta_pts)} points)`;
  };
  const cote = (d) => (d.a_nb == null ? `la période ${libellePeriode(pa)}` : `la période ${libellePeriode(pb)}`);
  const phrasePart = (k, sujet) => {
    const d = trouver(k);
    if (!d) return null;
    if (d.non_comparable) return `${sujet} ne peut pas être comparée : donnée non renseignée ou effectif nul sur ${cote(d)}.`;
    return `${sujet} passe de ${fr(d.a_pct)} % à ${fr(d.b_pct)} %${evolutionPts(d)}.`;
  };

  const lecture = [
    `Comparaison de la période ${libellePeriode(pa)} (référence) avec la période ${libellePeriode(pb)}. Les écarts de ${SEUIL_STABLE_PTS} points ou moins sont lus comme stables ; les phrases décrivent les variations, elles n'en donnent pas la cause.`,
  ];
  const lireParam = (v) => (v === true ? 'oui' : v === false ? 'non' : v == null ? 'non renseigné' : String(v));
  for (const p of methode.differences) {
    lecture.push(`La méthode a changé entre les deux périodes : ${p.libelle} valait « ${lireParam(p.a)} » puis « ${lireParam(p.b)} ».${
      p.blocs.length || p.indicateurs.length ? ' Les indicateurs concernés ne sont pas comparés : leur écart serait l’effet du réglage, pas celui des parcours.' : ' Les cases retenues d’un côté seulement ne sont pas comparées.'}`);
  }
  if (!methode.connues) {
    lecture.push("Les réglages de méthode ne sont pas enregistrés pour l'une des deux périodes (document antérieur à la version 2.60.0) : un changement de réglage entre les deux ne peut pas être vérifié.");
  }
  const acc = trouver('accueillis');
  if (acc.non_comparable) lecture.push(`L'effectif accueilli ne peut pas être comparé : donnée non renseignée sur ${cote(acc)}.`);
  else {
    const dn = acc.delta_nb;
    lecture.push(dn === 0
      ? `L'effectif accueilli est stable : ${fr(acc.a_nb, 0)} personnes sur chacune des deux périodes.`
      : `L'effectif accueilli passe de ${fr(acc.a_nb, 0)} à ${fr(acc.b_nb, 0)} personnes (${dn > 0 ? '+' : ''}${fr(dn, 0)}).`);
  }
  for (const [k, s] of [['femmes', 'La part de femmes'], ['rsa_socle', 'La part des bénéficiaires du RSA'],
    ['precaire_ou_rue', "La part des personnes en hébergement précaire ou à la rue à l'entrée"]]) {
    const ph = phrasePart(k, s);
    if (ph) lecture.push(ph);
  }

  const dominante = (c) => {
    const dif = (c && c.partie1 && c.partie1.difficultes_entree) || {};
    let best = null;
    for (const axe of AXES) {
      const n = nbDe(dif[axe]);
      if (n != null && n > 0 && (!best || n > best.n)) best = { axe, n, pct: pctDe(n, num(c.partie1.base)) };
    }
    return best;
  };
  const da = dominante(a);
  const db = dominante(b);
  if (da && db) {
    lecture.push(da.axe === db.axe
      ? `La difficulté la plus fréquente à l'entrée reste « ${LIBELLES_FREINS[da.axe]} » (${fr(da.pct)} % puis ${fr(db.pct)} % des personnes accueillies).`
      : `La difficulté la plus fréquente à l'entrée était « ${LIBELLES_FREINS[da.axe]} » (${fr(da.pct)} %) ; c'est désormais « ${LIBELLES_FREINS[db.axe]} » (${fr(db.pct)} %).`);
  } else {
    lecture.push("Les difficultés à l'entrée ne peuvent pas être comparées : aucune difficulté évaluée sur l'une des deux périodes.");
  }

  const ph = phrasePart('acces_emploi_formation', "Le taux d'accès à l'emploi ou à la formation des sortants");
  if (ph) lecture.push(ph);

  const fz = trouver('freins_resolus');
  if (fz.non_comparable) lecture.push('Les freins résolus à la sortie ne peuvent pas être comparés : données de sortie non disponibles sur l’une des deux périodes.');
  else lecture.push(`Freins résolus totalement ou partiellement à la sortie : ${fr(fz.a_nb, 0)} sur la période de référence, ${fr(fz.b_nb, 0)} sur la période comparée — à rapporter au nombre de sortants (${fr(trouver('sorties_total').a_nb, 0)} puis ${fr(trouver('sorties_total').b_nb, 0)}).`);

  const du = trouver('duree_moyenne_mois');
  if (du.non_comparable) lecture.push('La durée moyenne du parcours ne peut pas être comparée : aucun sortant daté sur l’une des deux périodes.');
  else lecture.push(du.sens === 'stable'
    ? `La durée moyenne du parcours est stable (${fr(du.a_nb)} puis ${fr(du.b_nb)} mois).`
    : `La durée moyenne du parcours passe de ${fr(du.a_nb)} à ${fr(du.b_nb)} mois.`);

  const nc = deltas.filter((d) => d.non_comparable).length;
  if (nc > 0) lecture.push(`${nc} indicateur(s) ne peuvent pas être comparés (donnée non renseignée ou effectif nul d'un côté) : ils sont signalés dans le tableau, sans écart calculé.`);

  return {
    a: { periode: pa }, b: { periode: pb }, deltas, lecture,
    methode_identique: methode.connues ? methode.differences.length === 0 : null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CSV
// ───────────────────────────────────────────────────────────────────────────

const LIBELLES_PUBLICS = {
  hommes: 'Hommes', femmes: 'Femmes', moins_26: 'Moins de 26 ans', de_26_a_49: '26 et moins de 50 ans',
  // CORRECTIF m-10 — la règle compte 50 ans révolus à la date de fin : le
  // libellé le dit (« Plus de 50 ans » excluait la personne de 50 ans pile).
  plus_50: '50 ans et plus', ...R.NIVEAUX_FORMATION_CVG_LABELS, total_formation: 'Total formation',
  sans_emploi_2ans: "Personnes n'ayant pas travaillé depuis 2 ans et plus", rsa_socle: 'Bénéficiaires du RSA socle',
  ass: "Bénéficiaires de l'ASS", rth: "Demandeurs d'emploi (RTH)", aah: "Dont bénéficiaires de l'AAH", refugies: 'Réfugiés',
};
const LIBELLES_SANTE = {
  rqth: 'RQTH', aah: 'AAH', pension_invalidite: "Pension d'invalidité", medecin_traitant: 'Médecin traitant',
  couverture_sante_amelioree: 'Amélioration de la couverture santé',
};

/**
 * CSV `;` à quatre colonnes (Partie ; Indicateur ; Nombre ; %), précédé de
 * l'en-tête de traçabilité en lignes commentées. Une valeur non rendue
 * s'écrit cellule VIDE, jamais 0.
 */
function cvgVersCsv(contenu, { generePar = null } = {}) {
  const lignes = [];
  let secrets = 0;
  const push = (partie, indicateur, v, pctForce) => {
    // B-01 — une case retenue s'écrit « s » (secret), jamais vide ni 0 :
    // une cellule vide dit « donnée non disponible », ce qui serait faux.
    if (v && typeof v === 'object' && v.secret === true) {
      secrets += 1;
      lignes.push([partie, indicateur, 's', 's']);
      return;
    }
    const nb = nbDe(v);
    const pct = pctForce !== undefined ? pctForce : (v && typeof v === 'object' ? v.pct : null);
    lignes.push([partie, indicateur, nb == null ? '' : String(nb).replace('.', ','), pct == null ? '' : String(pct).replace('.', ',')]);
  };
  const c = contenu || {};
  // B-02 — la justice non transmise s'écrit comme une ligne du formulaire,
  // avec une mention STRUCTURELLE (identique quelles que soient les données).
  const justiceNonTransmise = c.en_tete && c.en_tete.parametres && c.en_tete.parametres.transmettre_justice === false;
  const NON_TRANSMIS = "Justice — non transmis (donnée relevant de l'article 10 du RGPD)";
  const p1 = c.partie1 || {};
  const eff = p1.effectifs || {};
  push('Partie 1 — Effectifs', "Nombre d'ETP conventionnés à la date de fin", eff.etp_conventionnes, null);
  push('Partie 1 — Effectifs', 'Salariés en insertion accueillis sur la période', eff.accueillis, null);
  push('Partie 1 — Effectifs', 'Salariés en insertion en contrat à la date de fin', eff.en_contrat_fin, null);
  for (const [k, v] of Object.entries(p1.publics || {})) {
    if (k === 'non_renseigne') {
      for (const [nk, nv] of Object.entries(v || {})) push('Partie 1 — Publics', `Non renseigné — ${nk}`, nv, null);
    } else push('Partie 1 — Publics', LIBELLES_PUBLICS[k] || k, v);
  }
  for (const [k, v] of Object.entries(p1.habitat_entree || {})) {
    const lib = R.HABITAT_LABELS[k] || (k === 'total' ? 'Total habitat' : k === 'parcours_rue' ? 'Personnes ayant connu un parcours de rue' : 'Non renseigné');
    push("Partie 1 — Habitat à l'entrée", lib, v, typeof v === 'object' ? undefined : null);
  }
  for (const [k, v] of Object.entries(p1.difficultes_entree || {})) {
    push("Partie 1 — Difficultés à l'entrée", LIBELLES_FREINS[k] || 'Non évalué', v, v && typeof v === 'object' ? undefined : null);
  }
  if (justiceNonTransmise) lignes.push(["Partie 1 — Difficultés à l'entrée", NON_TRANSMIS, '', '']);
  for (const [k, v] of Object.entries(p1.orienteurs || {})) {
    const lib = R.ORIENTEUR_LABELS[k] || (k === 'total' ? 'Total orienteurs' : 'Non renseigné');
    push('Partie 1 — Orienteurs', lib, v, typeof v === 'object' ? undefined : null);
  }
  const p2 = c.partie2 || {};
  for (const r of p2.internes || []) {
    lignes.push(['Partie 2 — Ressources internes', `${r.nom}${r.fonction ? ` — ${r.fonction}` : ''}`,
      r.etp_total == null ? '' : String(r.etp_total).replace('.', ','), '']);
  }
  for (const r of p2.mutualisees || []) {
    lignes.push(['Partie 2 — Ressources mutualisées', `${r.nom}${r.fonction ? ` — ${r.fonction}` : ''}${r.employeur ? ` (${r.employeur})` : ''}`,
      r.etp_total == null ? '' : String(r.etp_total).replace('.', ','), '']);
  }
  push('Partie 2 — Total', 'Total ressources CVG (ETP)', p2.totaux ? p2.totaux.cvg : null, null);
  const so = c.sorties || {};
  push('Sorties', 'Nombre de salariés sortis sur la période', so.total, null);
  push('Sorties', 'Dont sorties sans bilan de sortie', so.non_documentees, null);
  push('Sorties', 'Durée moyenne du parcours (mois)', so.duree_moyenne_mois, null);
  push('Sorties', 'Sortants non catégorisés', so.non_categorises, null);
  for (const [cle, titre] of [['emploi', 'Sorties en emploi ou formation'], ['hors_emploi', 'Sorties hors emploi']]) {
    const j = so[cle];
    if (!j) continue;
    push(titre, 'Total', j.total, pctDe(j.total, so.total));
    for (const [k, v] of Object.entries(j.categories || {})) push(titre, k === 'parcours_de_soin' ? 'Dont sortie en parcours de soin' : (R.SORTIE_LABELS[k] || k), v);
    push(titre, 'Non catégorisés (côté connu par la classification)', j.non_categorises, null);
    for (const [k, v] of Object.entries(j.freins || {})) {
      push(titre, `Frein « ${LIBELLES_FREINS[k] || k} » — difficulté à l'entrée`, v.entree);
      push(titre, `Frein « ${LIBELLES_FREINS[k] || k} » — résolution totale ou partielle`, v.resolution);
    }
    if (justiceNonTransmise) lignes.push([titre, `Frein « ${NON_TRANSMIS} »`, '', '']);
    for (const [k, v] of Object.entries(j.logement || {})) {
      push(titre, `Logement à l'entrée — ${R.HABITAT_LABELS[k] || k}`, v.entree);
      push(titre, `Logement à la sortie — ${R.HABITAT_LABELS[k] || k}`, v.sortie);
    }
    for (const [k, v] of Object.entries(j.sante || {})) {
      push(titre, `Santé à l'entrée — ${LIBELLES_SANTE[k] || k}`, v.entree);
      push(titre, `Santé à la sortie — ${LIBELLES_SANTE[k] || k}`, v.sortie);
    }
    push(titre, 'Accompagnement post-sortie', j.post_sortie);
    for (const [k, v] of Object.entries(j.non_renseigne || {})) push(titre, `Non renseigné — ${k}`, v, null);
    if (j.confidentialite) {
      lignes.push([titre, `Tableau de moins de ${j.confidentialite.k} personnes : lignes santé, justice, logement et parcours de soin non diffusées (s)`, '', '']);
    }
  }
  for (const m of c.methode || []) lignes.push(['Méthode', m, '', '']);

  const e = c.en_tete || {};
  const conf = c.confidentialite || {};
  const meta = [
    `# Export;Outil de dialogue de gestion — programme CVG (Convergence France);Période;du ${frDate(e.periode_debut)} au ${frDate(e.periode_fin)}`,
    ...(e.mention_diffusion ? [`# DIFFUSION RESTREINTE;${escCsv(e.mention_diffusion)}`] : []),
    `# Généré le;${new Date().toLocaleString('fr-FR')};Généré par;${escCsv(generePar || e.genere_par_nom || '')};Rôle;${escCsv(e.genere_par_role || '')}`,
    `# Périmètre;${escCsv("parcours d'insertion (hors permanents) ; Partie 2 : moyens humains de l'accompagnement")}`,
    `# Nombre de lignes;${lignes.length};Version de l'outil;${escCsv(e.version || APP_VERSION)}`,
    `# ${escCsv(e.mention || MENTION)}`,
    '# Une cellule vide signifie « donnée non disponible » — jamais zéro',
    ...(secrets > 0 || conf.k_min > 1
      ? [`# Une cellule « s » signifie « secret » : effectif inférieur au seuil de confidentialité (k = ${conf.k_min || K_DEFAUT}) — ni vide ni zéro`]
      : []),
    '',
  ].join('\n');
  const corps = lignes.map((l) => l.map((x) => escCsv(x)).join(';')).join('\n');
  return '﻿' + meta + 'Partie;Indicateur;Nombre;%\n' + corps + '\n';
}

/**
 * Réglages de confidentialité en vigueur — pour l'encadré de l'écran, AVANT la
 * génération (le chargé de reporting doit savoir ce qui sortira).
 */
async function lireParametresCvg() {
  const [kBrut, justiceBrut] = await Promise.all([
    readInsertionSetting('insertion.cvg_k_min'),
    readInsertionSetting('insertion.cvg_transmettre_justice'),
  ]);
  const kNum = num(kBrut);
  const kMin = kNum != null && kNum >= 1 ? Math.round(kNum) : K_DEFAUT;
  return {
    k_min: kMin,
    k_source: kMin === K_DEFAUT ? 'defaut' : 'reglage',
    base_marginales_brutes: BASE_MARGINALES_BRUTES,
    transmettre_justice: justiceBrut === true,
  };
}

module.exports = {
  composerCvg,
  composerCompletude,
  comparerCvg,
  cvgVersCsv,
  cvgEstVide,
  erreurPeriode,
  profilPersonne,
  manquesDe,
  pctDe,
  lireParametresCvg,
  axesTransmis,
  AXES,
  AXES_SENSIBLES,
  K_DEFAUT,
  BASE_MARGINALES_BRUTES,
  MENTION,
  MENTION_DIFFUSION,
};
