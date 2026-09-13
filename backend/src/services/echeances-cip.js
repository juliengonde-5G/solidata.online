/**
 * Échéances de la CIP — moteur de l'écran « Mes échéances » (PR C, lot 5).
 * Contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md § 5.1 / 5.2 / 5.5.
 *
 * ═══ CE QUE CE FICHIER DÉCIDE, ET POURQUOI IL EST SEUL À LE DÉCIDER ═══════
 *
 * L'espace CIP s'organisait par ENDROIT où la donnée est rangée (un onglet
 * Diagnostic, un onglet Freins, un onglet Assistant IA). Il s'organise
 * désormais par ce que la conseillère doit FAIRE aujourd'hui. Cela suppose une
 * distinction que l'outil ne faisait pas :
 *
 *   - une OBLIGATION (bloc « À traiter cette semaine ») est une ligne que
 *     l'autorité de tutelle contrôle : une sortie FSE+ qui ne se recueille plus
 *     passé un mois, un Pass IAE expiré, un cumul CDDI au plafond légal, un
 *     référent unique qu'on ne connaît pas. Elle n'est PAS acquittable sept
 *     jours comme une alerte de fiche : elle se reporte de 48 h, et le report
 *     laisse une ligne (§ 5.1.3) ;
 *
 *   - l'ORGANISATION DU SUIVI (bilans en retard, rendez-vous non planifié,
 *     renouvellements à préparer, actions critiques) reste acquittable : c'est
 *     du travail à faire, pas un manquement réglementaire.
 *
 * Les deux se calculent ICI et nulle part ailleurs. La raison tient en une
 * phrase : la pastille rouge de la barre latérale, le tri de la file active et
 * la liste de l'écran doivent dire la MÊME chose. Deux implémentations d'une
 * même règle, c'est le défaut que la PR B a payé deux fois (la tolérance de
 * rendez-vous en double exemplaire, l'alerte FSE+ décalée d'un jour entre le
 * job et l'écran). D'où `niveauRisque` exporté et consommé par `GET /insertion`
 * plutôt que recodé dans sa requête.
 *
 * ═══ DOCTRINES TENUES ICI ═════════════════════════════════════════════════
 *  - Refus AVANT lecture : le tri par rôle est fait par la ROUTE ; ici, les
 *    familles d'obligations réservées à ADMIN/RH ne sont même pas CALCULÉES
 *    pour un MANAGER (leurs requêtes ne partent pas). Un filtre appliqué après
 *    lecture serait un filtre d'affichage.
 *  - Jamais de valeur inventée : chaque source est `soft`. Une requête qui
 *    échoue VIDE son bloc et se NOMME dans `sources_indisponibles` — elle ne
 *    rend jamais zéro obligation en silence, ce qui se lirait « rien à faire ».
 *  - Dates civiles par `utils/date-iso.js`, comparaisons de jours faites par
 *    PostgreSQL quand c'est lui qui détient la date.
 */

'use strict';

const pool = require('../config/database');
const { readInsertionSetting } = require('../utils/insertion-settings');
const { aujourdhuiParis, isoDate, ecartJours, decalerJours } = require('../utils/date-iso');
const { activiteHebdoCohorte } = require('./activite-hebdo');
// Le cumul CDDI vit dans `routes/insertion/engine.js` depuis l'origine et il
// est déjà consommé par `routes/employees.js` et l'import de paie. Le RECOPIER
// ici pour « avoir un helper du lot » produirait exactement ce que cet en-tête
// interdit : deux règles pour un seul plafond légal.
const { computeCddiCumulativeMonths } = require('../routes/insertion/engine');
const SOCLE = require('../data/diagnostic-socle-champs.json');
const { MOTIFS_REPORT } = require('../scripts/migrations/insertion-echeances');

// ═══════════════════════════════════════════════════════════════════════════
// 1. Liste FERMÉE des types d'obligation (contrat § 5.1.2)
// ═══════════════════════════════════════════════════════════════════════════
//
// `social: true` marque les familles qui reposent sur un statut social (BRSA,
// catégorie France Travail, cofinancement, heures relevées) : elles sont ADMIN/
// RH strict, au même titre que le dossier administratif dont elles sortent.
// `agregee: true` marque une ligne qui ne nomme PERSONNE dans sa forme de base.
const TYPES_OBLIGATIONS = [
  { type: 'sortie_fse_a_saisir', social: true, onglet: 'dossier', champ: 'fse_sortie' },
  { type: 'pass_iae', social: false, onglet: 'dossier', champ: 'pass_iae' },
  { type: 'cddi_plafond', social: false, onglet: 'dossier', champ: 'cddi_derogation' },
  { type: 'diagnostic_socle', social: false, onglet: 'diagnostic', champ: null },
  { type: 'fse_entree_manquant', social: true, onglet: 'diagnostic', champ: 'fse_entree' },
  { type: 'categorie_g', social: true, onglet: 'dossier', champ: 'ft_categorie' },
  { type: 'suivi_6_mois', social: false, onglet: 'dossier', champ: 'situation_6mois' },
  { type: 'referent_unique', social: false, onglet: 'dossier', champ: 'referent_unique' },
  { type: 'sous_15h', social: true, agregee: true, onglet: 'situation', champ: null },
];
const TYPES_OBLIGATIONS_CLES = TYPES_OBLIGATIONS.map((t) => t.type);
const META_PAR_TYPE = new Map(TYPES_OBLIGATIONS.map((t) => [t.type, t]));

/** Types qu'un rôle a le droit de voir. Le tri est fait AVANT toute requête. */
function typesPourRole(baseRole) {
  const adminRh = baseRole === 'ADMIN' || baseRole === 'RH';
  return TYPES_OBLIGATIONS.filter((t) => adminRh || !t.social).map((t) => t.type);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Socle du diagnostic — une seule liste de champs (contrat § 5.5)
// ═══════════════════════════════════════════════════════════════════════════
const CHAMPS_SOCLE = SOCLE.champs;

/**
 * Fragment SQL booléen « le socle est complet » pour un alias de
 * `insertion_diagnostics`. Écrit à partir du MÊME fichier que le front : la
 * complétude affichée dans le stepper et celle qui déclenche l'obligation
 * `diagnostic_socle` ne peuvent pas désigner deux jeux de champs différents —
 * sinon la CIP voit « socle terminé » et l'écran d'échéances la contredit.
 */
function sqlSocleComplet(alias = 'd') {
  const conditions = CHAMPS_SOCLE.map((c) => {
    const col = `${alias}.${c.colonne}`;
    if (c.type === 'liste') return `COALESCE(array_length(${col}, 1), 0) > 0`;
    if (c.type === 'texte') return `NULLIF(TRIM(COALESCE(${col}::text, '')), '') IS NOT NULL`;
    return `${col} IS NOT NULL`; // booleen, date
  });
  return `(${conditions.join(' AND ')})`;
}

/** Miroir JS du fragment ci-dessus — même fichier de champs, même verdict. */
function socleComplet(diag) {
  if (!diag || typeof diag !== 'object') return false;
  return CHAMPS_SOCLE.every((c) => {
    const v = diag[c.colonne];
    if (v === null || v === undefined) return false;
    if (c.type === 'liste') return Array.isArray(v) ? v.length > 0 : false;
    if (c.type === 'texte') return String(v).trim() !== '';
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Périmètre de la file active (contrat § 5.2)
// ═══════════════════════════════════════════════════════════════════════════
//
// Deux corrections d'un coup par rapport à l'ancien `GET /insertion` :
//  - les PERMANENTS (`insertion_status = 'none'`) sortent — ils n'ont pas de
//    parcours, ils encombraient une liste qui sert à en suivre ;
//  - `is_active` n'est PLUS un filtre. Une personne SORTIE est inactive, et
//    c'est précisément à ce moment-là que la sortie FSE+ et le relevé à +6 mois
//    sont dus. La faire disparaître de l'écran le jour où le travail commence
//    était la meilleure façon de ne jamais le faire.
/**
 * @param {object} o
 * @param {string} o.alias alias de la table employees
 * @param {number} o.moisTermines fenêtre de rémanence des parcours terminés
 * @param {boolean} o.tous `?inclure=tous` — tous les parcours, même anciens
 */
function sqlPerimetreFileActive({ alias = 'e', moisTermines = 7, tous = false } = {}) {
  if (tous) return `${alias}.insertion_status IS NOT NULL AND ${alias}.insertion_status <> 'none'`;
  const mois = Number.isFinite(Number(moisTermines)) && Number(moisTermines) > 0 ? Math.round(Number(moisTermines)) : 7;
  return `(
    ${alias}.insertion_status = 'en_parcours'
    OR (${alias}.insertion_status = 'termine'
        AND ${alias}.insertion_end_date IS NOT NULL
        AND ${alias}.insertion_end_date >= CURRENT_DATE - make_interval(months => ${mois}))
  )`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Chargement et calcul des obligations
// ═══════════════════════════════════════════════════════════════════════════

const nomDe = (r) => `${String(r.last_name || '').toUpperCase()} ${r.first_name || ''}`.trim();

/** Fabrique une ligne d'échéance à la forme figée du § 5.1.1. */
function ligne({ type, niveau, employeeId, nom, libelle, echeance = null, jours = null, detail = null }) {
  const meta = META_PAR_TYPE.get(type) || {};
  return {
    id: `${type}:${employeeId == null ? 'agregee' : employeeId}`,
    type,
    niveau,
    employee_id: employeeId ?? null,
    nom: nom ?? null,
    libelle,
    echeance: echeance ? isoDate(echeance) : null,
    jours: jours == null ? null : Number(jours),
    cible: { onglet: meta.onglet || 'situation', champ: meta.champ || null },
    nb_reports: 0,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Charge la cohorte et en dérive les obligations, par salarié.
 *
 * Toutes les sources sont chargées EN UNE PASSE pour toute la cohorte (jamais
 * une requête par dossier : c'est le défaut D-07 de la PR B, 325 requêtes pour
 * 40 dossiers). Les familles réservées à ADMIN/RH ne sont pas interrogées du
 * tout pour un MANAGER.
 *
 * @returns {Promise<{parEmploye: Map<number, object[]>, agregees: object[], salaries: object[], sources: string[]}>}
 */
async function chargerObligations({ db = pool, baseRole = 'ADMIN', userId = null, mine = false, tous = false } = {}) {
  const sources = [];
  const soft = async (label, texte, params = []) => {
    try { return (await db.query(texte, params)).rows; }
    catch (err) {
      console.error(`[INSERTION][ECHEANCES] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
      sources.push(label);
      return null; // `null` ≠ `[]` : le bloc est INDISPONIBLE, pas vide.
    }
  };

  const autorises = new Set(typesPourRole(baseRole));
  const adminRh = autorises.has('sortie_fse_a_saisir');

  const [moisTermines, delaiDiag, moisPass, j1, j2, joursG] = await Promise.all([
    readInsertionSetting('insertion.file_active_terminees_mois'),
    readInsertionSetting('insertion.delai_diagnostic_jours'),
    readInsertionSetting('insertion.alerte_pass_iae_mois'),
    readInsertionSetting('insertion.alerte_sortie_fse_j1'),
    readInsertionSetting('insertion.alerte_sortie_fse_j2'),
    readInsertionSetting('insertion.categorie_g_alerte_jours'),
  ]);

  const perimetre = sqlPerimetreFileActive({ alias: 'e', moisTermines, tous });
  const params = [];
  let filtreMine = '';
  if (mine && userId != null) { params.push(userId); filtreMine = ` AND e.cip_referent_user_id = $${params.length}`; }

  // ── Cohorte : une ligne par salarié, avec tout ce qui se lit sur `employees`
  //    et sur les tables à cardinalité 1 (diagnostic du parcours courant,
  //    sortie FSE+, participation ASI). Le `brsa` n'est PAS projeté : aucune
  //    obligation ne s'y adosse (le référent unique est attendu pour tous), et
  //    ne pas le lire vaut mieux que le masquer après coup.
  const cohorte = await soft('cohorte', `
    SELECT e.id, e.first_name, e.last_name, e.insertion_status, e.insertion_start_date,
           e.insertion_end_date, COALESCE(e.parcours_num, 1) AS parcours_num,
           e.cip_referent_user_id, e.contract_end,
           e.pass_iae_number, e.pass_iae_end, e.pass_iae_statut,
           e.cddi_derogation_motif, e.referent_unique_type,
           ${adminRh ? 'e.ft_categorie, e.ft_categorie_date,' : 'NULL::varchar AS ft_categorie, NULL::date AS ft_categorie_date,'}
           (SELECT ec.end_date FROM employee_contracts ec
             WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) AS contrat_fin
      FROM employees e
     WHERE ${perimetre}${filtreMine}
     ORDER BY UPPER(e.last_name), UPPER(e.first_name)`, params);

  if (!cohorte) return { parEmploye: new Map(), agregees: [], salaries: [], sources };
  const ids = cohorte.map((c) => Number(c.id));
  const parEmploye = new Map(ids.map((id) => [id, []]));
  const agregees = [];
  if (ids.length === 0) return { parEmploye, agregees, salaries: cohorte, sources };

  // ── Sources complémentaires, chacune en UNE requête pour toute la cohorte ──
  const [diags, contrats, suivis, fse, participants] = await Promise.all([
    soft('diagnostics', `
      SELECT d.employee_id, COALESCE(d.parcours_num, 1) AS parcours_num,
             ${sqlSocleComplet('d')} AS socle_complet,
             COALESCE(d.fse_entree_complet, false) AS fse_entree_complet
        FROM insertion_diagnostics d
       WHERE d.employee_id = ANY($1::int[])`, [ids]),
    soft('contrats_cddi', `
      SELECT employee_id, contract_type, start_date, end_date
        FROM employee_contracts
       WHERE employee_id = ANY($1::int[]) AND UPPER(contract_type) = 'CDDI'`, [ids]),
    soft('suivi_post_sortie', `
      SELECT employee_id, MIN(due_date) AS due_date
        FROM insertion_milestones
       WHERE employee_id = ANY($1::int[]) AND milestone_type = 'suivi_post_sortie'
         AND status <> 'realise' AND due_date < CURRENT_DATE
       GROUP BY employee_id`, [ids]),
    adminRh ? soft('sorties_fse', `
      SELECT employee_id, parcours_num, date_sortie, situation_6mois
        FROM insertion_fse_sorties
       WHERE employee_id = ANY($1::int[])`, [ids]) : Promise.resolve([]),
    adminRh ? soft('participants_asi', `
      SELECT pp.employee_id, pp.date_sortie
        FROM insertion_projet_participants pp
        JOIN insertion_projets pr ON pr.id = pp.projet_id AND pr.type = 'asi'
       WHERE pp.employee_id = ANY($1::int[])`, [ids]) : Promise.resolve([]),
  ]);

  const diagParEmp = new Map();
  for (const d of diags || []) diagParEmp.set(Number(d.employee_id), d);
  const contratsParEmp = new Map();
  for (const c of contrats || []) {
    const k = Number(c.employee_id);
    if (!contratsParEmp.has(k)) contratsParEmp.set(k, []);
    contratsParEmp.get(k).push(c);
  }
  const suiviParEmp = new Map((suivis || []).map((s) => [Number(s.employee_id), s]));
  const fseParEmp = new Map((fse || []).map((s) => [Number(s.employee_id), s]));
  const asiParEmp = new Map((participants || []).map((p) => [Number(p.employee_id), p]));

  const jour = aujourdhuiParis();
  const seuilJ1 = Number(j1) > 0 ? Number(j1) : 15;
  const seuilJ2 = Number(j2) > 0 ? Number(j2) : 25;
  const seuilDiag = Number(delaiDiag) > 0 ? Number(delaiDiag) : 30;
  const seuilPass = Number(moisPass) > 0 ? Number(moisPass) : 7;
  const seuilG = Number(joursG) > 0 ? Number(joursG) : 30;

  const pousser = (empId, l) => { if (parEmploye.has(empId)) parEmploye.get(empId).push(l); };

  for (const e of cohorte) {
    const id = Number(e.id);
    const nom = nomDe(e);
    const enParcours = e.insertion_status === 'en_parcours';

    // (a) Pass IAE — le STATUT prime sur la date : un Pass suspendu a une fin
    //     lointaine et n'en autorise pas moins rien.
    if (autorises.has('pass_iae')) {
      const statut = String(e.pass_iae_statut || 'inconnu');
      const fin = isoDate(e.pass_iae_end);
      if (statut === 'expire' || statut === 'suspendu') {
        pousser(id, ligne({
          type: 'pass_iae', niveau: 'rouge', employeeId: id, nom,
          libelle: statut === 'suspendu' ? 'Pass IAE suspendu' : 'Pass IAE expiré',
          echeance: fin, jours: fin ? ecartJours(jour, fin) : null,
        }));
      } else if (enParcours && fin) {
        const restants = ecartJours(jour, fin);
        if (restants != null && restants < 0) {
          pousser(id, ligne({
            type: 'pass_iae', niveau: 'rouge', employeeId: id, nom,
            libelle: 'Pass IAE expiré', echeance: fin, jours: restants,
          }));
        } else if (restants != null && restants <= 62) {
          // « moins de 2 mois » : 62 jours, borne haute d'un intervalle de deux
          // mois calendaires — jamais 60, qui retirerait deux jours à la CIP
          // sur un couple de mois longs.
          pousser(id, ligne({
            type: 'pass_iae', niveau: 'orange', employeeId: id, nom,
            libelle: `Pass IAE : fin dans ${restants} jour(s)`, echeance: fin, jours: restants,
          }));
        }
      } else if (enParcours && !e.pass_iae_number && seuilPass > 0) {
        // Pas de numéro = aucune alerte d'échéance possible. Ce n'est pas une
        // obligation réglementaire en soi, donc ORANGE : c'est une pièce du
        // dossier administratif qui manque.
        pousser(id, ligne({
          type: 'pass_iae', niveau: 'orange', employeeId: id, nom,
          libelle: 'Pass IAE non renseigné — aucune échéance ne peut être suivie',
        }));
      }
    }

    // (b) Plafond CDDI (L.5132-15-1) — 23 mois cumulés sans motif de dérogation.
    if (autorises.has('cddi_plafond')) {
      const lignes = contratsParEmp.get(id) || [];
      if (lignes.length > 0) {
        const cumul = computeCddiCumulativeMonths(lignes);
        if (cumul.months_total >= 23 && !e.cddi_derogation_motif) {
          pousser(id, ligne({
            type: 'cddi_plafond', niveau: 'rouge', employeeId: id, nom,
            libelle: `Cumul CDDI ${cumul.months_total} mois sur 24 — motif de dérogation à saisir`,
          }));
        }
      }
    }

    // (c) Socle du diagnostic au-delà du délai cible.
    if (autorises.has('diagnostic_socle') && enParcours && e.insertion_start_date) {
      const debut = isoDate(e.insertion_start_date);
      const jours = debut ? ecartJours(debut, jour) : null;
      if (jours != null && jours > seuilDiag) {
        const d = diagParEmp.get(id);
        if (!d || d.socle_complet !== true) {
          pousser(id, ligne({
            type: 'diagnostic_socle', niveau: 'rouge', employeeId: id, nom,
            libelle: d ? `Socle du diagnostic incomplet (${jours} j depuis l'entrée)`
              : `Aucun diagnostic d'accueil (${jours} j depuis l'entrée)`,
            echeance: debut ? decalerJours(debut, seuilDiag) : null, jours,
          }));
        }
      }
    }

    // (d) Référent unique non déterminé — la structure est structure d'ACCUEIL :
    //     sans référent, aucune fiche ne peut partir, et l'absence se signale.
    if (autorises.has('referent_unique') && enParcours) {
      const t = e.referent_unique_type;
      if (!t || t === 'non_determine') {
        pousser(id, ligne({
          type: 'referent_unique', niveau: 'rouge', employeeId: id, nom,
          libelle: 'Référent unique non déterminé — à signaler au prescripteur',
        }));
      }
    }

    if (!adminRh) continue; // les familles suivantes sont toutes sociales

    const estAsi = asiParEmp.has(id);
    const sortieFse = fseParEmp.get(id);

    // (e) Questionnaire FSE+ d'entrée (participant ASI).
    if (autorises.has('fse_entree_manquant') && estAsi && enParcours) {
      const d = diagParEmp.get(id);
      if (!d || d.fse_entree_complet !== true) {
        const debut = isoDate(e.insertion_start_date);
        const jours = debut ? ecartJours(debut, jour) : null;
        const enRetard = jours != null && jours > seuilDiag;
        pousser(id, ligne({
          type: 'fse_entree_manquant', niveau: enRetard ? 'rouge' : 'orange', employeeId: id, nom,
          libelle: "Questionnaire FSE+ d'entrée incomplet (participant d'une opération cofinancée)",
          jours,
        }));
      }
    }

    // (f) Sortie FSE+ à saisir. Le délai court depuis la SORTIE DE L'OPÉRATION
    //     quand elle est datée, sinon depuis la fin de parcours, sinon depuis
    //     la fin de contrat (la règle historique). La provenance n'est pas un
    //     détail : sur une rupture anticipée, compter depuis la fin de contrat
    //     prévue imprimait 12 jours pour 43 réels (défaut D de la PR A).
    if (autorises.has('sortie_fse_a_saisir') && estAsi && !sortieFse) {
      const asi = asiParEmp.get(id);
      const reference = isoDate(asi && asi.date_sortie)
        || isoDate(e.insertion_end_date)
        || isoDate(e.contrat_fin)
        || isoDate(e.contract_end);
      if (reference && reference <= jour) {
        const jours = ecartJours(reference, jour);
        if (jours != null && jours >= seuilJ1) {
          pousser(id, ligne({
            type: 'sortie_fse_a_saisir', niveau: jours >= seuilJ2 ? 'rouge' : 'orange',
            employeeId: id, nom,
            libelle: `Sortie FSE+ non renseignée — ${jours} jour(s) depuis la sortie de l'opération`,
            echeance: decalerJours(reference, seuilJ2), jours,
          }));
        }
      }
    }

    // (g) Relevé de situation à +6 mois échu (indicateur de RÉSULTAT du FSE+).
    if (autorises.has('suivi_6_mois')) {
      const jalon = suiviParEmp.get(id);
      const sixMoisDu = sortieFse && !sortieFse.situation_6mois;
      if (jalon) {
        const due = isoDate(jalon.due_date);
        pousser(id, ligne({
          type: 'suivi_6_mois', niveau: 'rouge', employeeId: id, nom,
          libelle: 'Suivi à +6 mois échu et non réalisé',
          echeance: due, jours: due ? ecartJours(due, jour) : null,
        }));
      } else if (sixMoisDu) {
        // Pas de jalon posé mais une sortie FSE+ enregistrée sans relevé : la
        // même obligation, vue depuis l'autre bout. On ne l'invente pas — on la
        // date sur `date_sortie` + le délai paramétré.
        const echeance = isoDate(sortieFse.date_sortie);
        const ech = echeance ? decalerJours(echeance, 183) : null;
        if (ech && ech <= jour) {
          pousser(id, ligne({
            type: 'suivi_6_mois', niveau: 'rouge', employeeId: id, nom,
            libelle: 'Situation à +6 mois non relevée', echeance: ech, jours: ecartJours(ech, jour),
          }));
        }
      }
    }

    // (h) Catégorie France Travail « G » (en attente d'orientation) qui dure.
    //     ORANGE et jamais rouge : seul le référent peut la changer — mettre la
    //     CIP en faute d'une décision qui ne lui appartient pas serait faux.
    if (autorises.has('categorie_g') && enParcours && String(e.ft_categorie || '') === 'G') {
      const depuis = isoDate(e.ft_categorie_date);
      const jours = depuis ? ecartJours(depuis, jour) : null;
      if (jours == null || jours > seuilG) {
        pousser(id, ligne({
          type: 'categorie_g', niveau: 'orange', employeeId: id, nom,
          libelle: jours == null
            ? "Catégorie France Travail « G » (en attente d'orientation) — date de constat inconnue"
            : `Catégorie France Travail « G » depuis ${jours} jour(s)`,
          jours,
        }));
      }
    }
  }

  // ── (i) Ligne AGRÉGÉE « N salariés sous 15 h » ───────────────────────────
  //     Agrégée par décision (amendement CIP § 10) : une ligne nominative par
  //     personne ferait de l'activité basse un reproche individuel affiché en
  //     tête d'écran, alors que c'est un signal à porter au référent.
  if (autorises.has('sous_15h')) {
    try {
      const enParcoursIds = cohorte.filter((c) => c.insertion_status === 'en_parcours').map((c) => Number(c.id));
      if (enParcoursIds.length > 0) {
        const annee = Number(jour.slice(0, 4));
        const activites = await activiteHebdoCohorte({ employeeIds: enParcoursIds, annee });
        const concernes = [];
        for (const c of cohorte) {
          const a = activites.get(Number(c.id));
          if (a && a.alerte && a.alerte.active) concernes.push({ employee_id: Number(c.id), nom: nomDe(c) });
        }
        if (concernes.length > 0) {
          agregees.push(ligne({
            type: 'sous_15h', niveau: 'rouge', employeeId: null, nom: null,
            libelle: `${concernes.length} salarié(s) sous 15 h par semaine (2 semaines relevées consécutives, hors arrêt)`,
            detail: concernes,
          }));
        }
      }
    } catch (err) {
      console.error(`[INSERTION][ECHEANCES] « activite_hebdo » ignorée : ${err.message}`);
      sources.push('activite_hebdo');
    }
  }

  return { parEmploye, agregees, salaries: cohorte, sources };
}

/**
 * Niveau de risque d'UN salarié, dérivé de SES obligations.
 * `GET /insertion` l'appelle avec les obligations chargées par la fonction
 * ci-dessus : la pastille de la file active et la liste des échéances ne
 * peuvent donc pas se contredire.
 * @returns {'rouge'|'orange'|null}
 */
function niveauRisque(obligations) {
  if (!Array.isArray(obligations) || obligations.length === 0) return null;
  if (obligations.some((o) => o.niveau === 'rouge')) return 'rouge';
  if (obligations.some((o) => o.niveau === 'orange')) return 'orange';
  return null;
}

/**
 * Carte `employee_id → 'rouge'|'orange'|null` pour toute la file active.
 * Résiliente : toute erreur rend une carte VIDE (la liste s'affiche sans
 * pastille) plutôt que de faire échouer `GET /insertion`.
 */
async function niveauxRisqueCohorte(opts = {}) {
  try {
    const { parEmploye } = await chargerObligations(opts);
    const m = new Map();
    for (const [id, obls] of parEmploye.entries()) m.set(id, niveauRisque(obls));
    return m;
  } catch (err) {
    console.error('[INSERTION][ECHEANCES] Niveaux de risque indisponibles :', err.message);
    return new Map();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Reports (48 h) — ce qui sort des obligations et entre dans `reportees`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reports EN COURS par (employee_id, type), avec le NOMBRE TOTAL de reports.
 * Le nombre compte TOUS les reports du parcours, pas seulement ceux en cours :
 * c'est lui qui rend le motif obligatoire au deuxième, et un dossier reporté
 * cinq fois doit se voir même si les quatre premiers sont expirés.
 */
async function chargerReports(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const r = await db.query(`
    SELECT employee_id, echeance_type,
           COUNT(*)::int AS nb,
           MAX(reporte_jusqu_au) FILTER (WHERE reporte_jusqu_au > NOW()) AS en_cours_jusqu_au,
           (ARRAY_AGG(motif ORDER BY created_at DESC) FILTER (WHERE motif IS NOT NULL))[1] AS dernier_motif
      FROM insertion_echeance_reports
     WHERE employee_id = ANY($1::int[])
     GROUP BY employee_id, echeance_type`, [ids]);
  const m = new Map();
  for (const row of r.rows) {
    m.set(`${row.employee_id}:${row.echeance_type}`, {
      nb: Number(row.nb) || 0,
      jusqu_au: row.en_cours_jusqu_au || null,
      motif: row.dernier_motif || null,
    });
  }
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Bloc « Organisation du suivi » (acquittable 7 j — l'ack existant)
// ═══════════════════════════════════════════════════════════════════════════

async function chargerOrganisation({ db, mine, userId, soft, anticipationJours }) {
  const params = [];
  let filtreMine = '';
  if (mine && userId != null) { params.push(userId); filtreMine = ` AND e.cip_referent_user_id = $${params.length}`; }

  const [retards, aPlanifier, renouvellements, actions] = await Promise.all([
    soft('bilans_en_retard', `
      SELECT im.id, im.employee_id, im.milestone_type, im.titre, im.due_date,
             (CURRENT_DATE - im.due_date) AS jours, e.first_name, e.last_name
        FROM insertion_milestones im
        JOIN employees e ON e.id = im.employee_id
       WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
         AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
         AND im.status <> 'realise' AND im.due_date < CURRENT_DATE${filtreMine}
       ORDER BY im.due_date`, params),
    soft('rdv_non_planifie', `
      SELECT im.id, im.employee_id, im.milestone_type, im.titre, im.due_date,
             (im.due_date - CURRENT_DATE) AS jours, e.first_name, e.last_name
        FROM insertion_milestones im
        JOIN employees e ON e.id = im.employee_id
       WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
         AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
         AND im.status = 'a_planifier' AND im.due_date >= CURRENT_DATE
         AND im.due_date < CURRENT_DATE + 30${filtreMine}
       ORDER BY im.due_date`, params),
    soft('renouvellements', `
      SELECT e.id AS employee_id, e.first_name, e.last_name,
             ec.end_date AS contract_end, (ec.end_date - CURRENT_DATE) AS jours,
             m.id AS milestone_id, m.eti_token, m.eti_token_expires_at,
             (m.renouvellement_form IS NOT NULL) AS formulaire_rempli,
             (m.locked_at IS NOT NULL) AS verrouille
        FROM employees e
        JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
        LEFT JOIN LATERAL (
          SELECT im.* FROM insertion_milestones im
           WHERE im.employee_id = e.id AND im.milestone_type = 'renouvellement'
             AND (im.contract_id = ec.id OR im.status <> 'realise')
           ORDER BY (im.contract_id = ec.id) DESC, im.due_date DESC LIMIT 1
        ) m ON true
       WHERE e.is_active = true AND e.insertion_status = 'en_parcours'
         AND UPPER(ec.contract_type) = 'CDDI' AND ec.end_date IS NOT NULL
         AND ec.end_date >= CURRENT_DATE
         AND ec.end_date < CURRENT_DATE + make_interval(days => $${params.length + 1})${filtreMine}
       ORDER BY ec.end_date`, [...params, anticipationJours]),
    soft('actions_critiques', `
      SELECT a.id, a.employee_id, a.echeance, (CURRENT_DATE - a.echeance) AS jours,
             e.first_name, e.last_name
        FROM cip_action_plans a
        JOIN employees e ON e.id = a.employee_id
       WHERE a.priority = 'haute' AND a.echeance < CURRENT_DATE
         AND a.status IN ('a_faire', 'en_cours')
         AND e.insertion_status = 'en_parcours'${filtreMine}
       ORDER BY a.echeance`, params),
  ]);

  const items = [];
  const jour = aujourdhuiParis();
  for (const r of retards || []) {
    items.push({
      id: `bilan_en_retard:${r.id}`, sous_type: 'bilan_en_retard', niveau: 'rouge',
      employee_id: r.employee_id, nom: nomDe(r), milestone_id: r.id,
      libelle: `${r.titre || r.milestone_type} en retard de ${r.jours} jour(s)`,
      echeance: isoDate(r.due_date), jours: Number(r.jours),
      cible: { onglet: 'suivi', champ: null },
    });
  }
  for (const r of aPlanifier || []) {
    items.push({
      id: `rdv_non_planifie:${r.id}`, sous_type: 'rdv_non_planifie', niveau: 'orange',
      employee_id: r.employee_id, nom: nomDe(r), milestone_id: r.id,
      libelle: `${r.titre || r.milestone_type} : aucune date planifiée`,
      echeance: isoDate(r.due_date), jours: Number(r.jours),
      cible: { onglet: 'suivi', champ: null },
    });
  }
  for (const r of renouvellements || []) {
    // Le lien public n'est rendu que s'il EXISTE ET n'est pas expiré : afficher
    // une adresse qui répondra 410 vaudrait moins que ne rien afficher.
    const expire = r.eti_token_expires_at ? new Date(r.eti_token_expires_at) : null;
    const vivant = !!r.eti_token && expire instanceof Date && !Number.isNaN(expire.getTime()) && expire > new Date();
    items.push({
      id: `renouvellement:${r.employee_id}`, sous_type: 'renouvellement',
      niveau: Number(r.jours) <= 15 ? 'rouge' : 'orange',
      employee_id: r.employee_id, nom: nomDe(r), milestone_id: r.milestone_id || null,
      libelle: r.milestone_id == null
        ? `Renouvellement à préparer — fin de contrat dans ${r.jours} jour(s), entretien à créer`
        : r.formulaire_rempli
          ? `Renouvellement — avis de l'encadrant reçu (fin de contrat dans ${r.jours} j)`
          : `Renouvellement — avis de l'encadrant attendu (fin de contrat dans ${r.jours} j)`,
      echeance: isoDate(r.contract_end), jours: Number(r.jours),
      a_creer: r.milestone_id == null,
      formulaire_rempli: r.formulaire_rempli === true,
      verrouille: r.verrouille === true,
      lien_eti: vivant ? lienEti(r.eti_token) : null,
      eti_expire_le: vivant ? r.eti_token_expires_at : null,
      cible: { onglet: 'suivi', champ: null },
    });
  }
  for (const r of actions || []) {
    items.push({
      id: `action_critique:${r.id}`, sous_type: 'action_critique', niveau: 'rouge',
      employee_id: r.employee_id, nom: nomDe(r), action_id: r.id,
      // Le LIBELLÉ de l'action n'est pas repris : il est libre, et cet écran
      // s'affiche à tous les rôles du module. La catégorie suffit à agir.
      libelle: `Action critique en retard de ${r.jours} jour(s)`,
      echeance: isoDate(r.echeance), jours: Number(r.jours),
      cible: { onglet: 'suivi', champ: null },
    });
  }
  items.sort((a, b) => {
    if (a.niveau !== b.niveau) return a.niveau === 'rouge' ? -1 : 1;
    return String(a.echeance || '9999').localeCompare(String(b.echeance || '9999'));
  });
  return { items, jour };
}

/** URL publique de l'écran ETI. Une seule composition pour tout le module. */
function lienEti(token) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.MOBILE_BASE_URL || 'https://solidata.online')
    .replace(/\/+$/, '');
  return `${base}/eti/renouvellement/${token}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. « Rendez-vous réguliers et rappels » — extrait de routes/insertion/rsa.js
// ═══════════════════════════════════════════════════════════════════════════
//
// Déplacé ici SANS CHANGER SA FORME DE RÉPONSE : `GET /insertion/rsa/
// echeances-periodiques` continue de la servir telle quelle (ses tests de la
// PR B restent verts), et l'écran « Mes échéances » la reçoit dans le MÊME
// appel que le reste — un bloc de plus ne doit pas coûter un aller-retour de
// plus au chargement du lundi matin.
async function composerEcheancesPeriodiques({ db = pool } = {}) {
  const soft = async (label, text, params = []) => {
    try { return (await db.query(text, params)).rows; }
    catch (err) {
      console.error(`[INSERTION][RSA] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
      return [];
    }
  };

  const moisMin = Math.max(1, Math.round(Number(await readInsertionSetting('insertion.point_etape_referent_mois')) || 3));
  const jour = aujourdhuiParis();
  const mois = `${jour.slice(0, 7)}-01`;

  const [actualisations, points, referentsNd] = await Promise.all([
    soft('actualisations_ft', `
      SELECT e.id AS employee_id, e.first_name, e.last_name,
             a.rappel_le, a.honoree
        FROM employees e
        LEFT JOIN insertion_actualisations_ft a ON a.employee_id = e.id AND a.mois = $1::date
       WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
         AND (e.actualisation_ft_requise = true OR e.referent_unique_type = 'france_travail')
       ORDER BY UPPER(e.last_name), UPPER(e.first_name)`, [mois]),
    soft('points_referent', `
      SELECT e.id AS employee_id, e.first_name, e.last_name,
             to_char(GREATEST(MAX(m.completed_date), MAX(a.remis_referent_le)), 'YYYY-MM-DD') AS dernier_le
        FROM employees e
        LEFT JOIN insertion_milestones m
               ON m.employee_id = e.id AND m.milestone_type = 'point_etape_referent' AND m.status = 'realise'
        LEFT JOIN insertion_alimentations_referent a
               ON a.employee_id = e.id AND a.remis_referent_le IS NOT NULL
       WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
       GROUP BY e.id, e.first_name, e.last_name
       ORDER BY UPPER(e.last_name), UPPER(e.first_name)`),
    soft('referents_non_determines', `
      SELECT id AS employee_id, first_name, last_name
        FROM employees
       WHERE insertion_status = 'en_parcours' AND is_active = true
         AND COALESCE(referent_unique_type, 'non_determine') = 'non_determine'
       ORDER BY UPPER(last_name), UPPER(first_name)`),
  ]);

  const pointsDus = [];
  for (const p of points) {
    const dernier = isoDate(p.dernier_le);
    const depuis = dernier ? ecartJours(dernier, jour) : null;
    if (dernier && depuis < moisMin * 30) continue; // dans les clous
    pointsDus.push({
      employee_id: p.employee_id,
      nom: nomDe(p),
      dernier_le: dernier,
      du_depuis_jours: depuis,
    });
  }

  const cohorte = await soft('cohorte', `
    SELECT id, first_name, last_name FROM employees
     WHERE insertion_status = 'en_parcours' AND is_active = true
     ORDER BY UPPER(last_name), UPPER(first_name)`);
  const annee = Number(jour.slice(0, 4));
  const employesSousSeuil = [];
  try {
    const activites = await activiteHebdoCohorte({ employeeIds: cohorte.map((c) => c.id), annee });
    for (const c of cohorte) {
      const a = activites.get(Number(c.id));
      if (a && a.alerte && a.alerte.active) {
        employesSousSeuil.push({ employee_id: c.id, nom: nomDe(c), nb_semaines: a.nb_semaines_sous_seuil });
      }
    }
  } catch (err) {
    console.error(`[INSERTION][RSA] Activité de la cohorte illisible : ${err.message}`);
  }

  const anneeJour = Number(jour.slice(0, 4));
  const trimestre = Math.floor((Number(jour.slice(5, 7)) - 1) / 3) + 1;
  const finTrimestre = new Date(Date.UTC(anneeJour, trimestre * 3, 0));

  return {
    actualisations_ft_du_mois: actualisations.map((a) => ({
      employee_id: a.employee_id,
      nom: nomDe(a),
      rappel_le: isoDate(a.rappel_le),
      honoree: a.honoree == null ? null : a.honoree === true,
    })),
    points_referent_dus: pointsDus,
    semaines_sous_seuil: { nb_salaries: employesSousSeuil.length, employes: employesSousSeuil },
    dtr: { trimestre: `T${trimestre} ${anneeJour}`, echeance: finTrimestre.toISOString().slice(0, 10) },
    referents_non_determines: referentsNd.map((r) => ({ employee_id: r.employee_id, nom: nomDe(r) })),
    periodicite_point_referent_mois: moisMin,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. KPI de la file active
// ═══════════════════════════════════════════════════════════════════════════

async function chargerKpiFileActive({ db, soft, salaries, obligationsParEmploye, adminRh }) {
  const jour = aujourdhuiParis();
  const annee = Number(jour.slice(0, 4));
  const enParcours = salaries.filter((s) => s.insertion_status === 'en_parcours').length;

  const [jalons, sorties, objectif, asi] = await Promise.all([
    soft('jalons', `
      SELECT (im.due_date - CURRENT_DATE) AS jours
        FROM insertion_milestones im
        JOIN employees e ON e.id = im.employee_id
       WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
         AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
         AND im.status <> 'realise'`),
    soft('sorties', `
      SELECT sortie_classification, COUNT(*)::int AS n
        FROM insertion_milestones
       WHERE milestone_type = 'bilan_sortie' AND status = 'realise'
         AND sortie_classification IS NOT NULL
         AND COALESCE(completed_date, updated_at::date) BETWEEN $1 AND $2
       GROUP BY sortie_classification`, [`${annee}-01-01`, `${annee}-12-31`]),
    soft('objectif_sorties', "SELECT value FROM settings WHERE key = 'insertion.objectif_sorties_dynamiques'"),
    adminRh ? soft('completude_asi', `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE d.fse_entree_complet = true)::int AS complets
        FROM insertion_projet_participants pp
        JOIN insertion_projets pr ON pr.id = pp.projet_id AND pr.type = 'asi'
        JOIN employees e ON e.id = pp.employee_id
        LEFT JOIN insertion_diagnostics d
               ON d.employee_id = e.id AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
       WHERE pp.date_sortie IS NULL`) : Promise.resolve(null),
  ]);

  const DYNAMIQUES = ['emploi_durable', 'emploi_transition', 'sortie_positive'];
  let dynamiques = 0; let totalSorties = 0;
  for (const s of sorties || []) {
    totalSorties += s.n;
    if (DYNAMIQUES.includes(s.sortie_classification)) dynamiques += s.n;
  }
  const obj = objectif && objectif[0] && objectif[0].value != null ? parseFloat(objectif[0].value) : null;

  // Aucun participant → `null`, jamais 0 % : 0 se lirait « rien de fait »
  // alors qu'il n'y a rien à mesurer.
  let completude = null;
  if (asi && asi[0] && Number(asi[0].total) > 0) {
    completude = Math.round((Number(asi[0].complets) / Number(asi[0].total)) * 100);
  }

  const rougesParSalarie = [...obligationsParEmploye.values()]
    .filter((obls) => obls.some((o) => o.niveau === 'rouge')).length;

  return {
    en_parcours: enParcours,
    retards: (jalons || []).filter((j) => Number(j.jours) < 0).length,
    a_venir_7j: (jalons || []).filter((j) => Number(j.jours) >= 0 && Number(j.jours) <= 7).length,
    sorties_dynamiques_pct: totalSorties > 0 ? Math.round((dynamiques / totalSorties) * 100) : null,
    sorties: { dynamiques, total: totalSorties },
    objectif_sorties: Number.isFinite(obj) ? obj : null,
    completude_fse_asi_pct: completude,
    salaries_en_risque: rougesParSalarie,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Composition de l'écran (contrat § 5.1)
// ═══════════════════════════════════════════════════════════════════════════

async function composerEcheances({ db = pool, baseRole = 'ADMIN', userId = null, mine = false } = {}) {
  const sources = [];
  const soft = async (label, texte, params = []) => {
    try { return (await db.query(texte, params)).rows; }
    catch (err) {
      console.error(`[INSERTION][ECHEANCES] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
      sources.push(label);
      return null;
    }
  };

  const adminRh = baseRole === 'ADMIN' || baseRole === 'RH';
  const anticipation = Math.round(Number(await readInsertionSetting('insertion.renouvellement_anticipation_jours')) || 42);

  const [charge, organisation, periodiques] = await Promise.all([
    chargerObligations({ db, baseRole, userId, mine }),
    chargerOrganisation({ db, mine, userId, soft, anticipationJours: anticipation }),
    // Le bloc RSA est ADMIN/RH strict côté route dédiée : un MANAGER ne le
    // reçoit pas du tout — il vaut mieux ne rien montrer qu'annoncer une panne
    // là où il n'y a qu'une habilitation.
    adminRh ? composerEcheancesPeriodiques({ db }).catch((err) => {
      console.error('[INSERTION][ECHEANCES] Rendez-vous réguliers indisponibles :', err.message);
      sources.push('rendez_vous_reguliers');
      return null;
    }) : Promise.resolve(null),
  ]);

  sources.push(...charge.sources);

  // ── Reports : ce qui est reporté sort d'`obligations` et du compteur ──
  const ids = charge.salaries.map((s) => Number(s.id));
  let reports = new Map();
  try { reports = await chargerReports(db, ids); }
  catch (err) {
    console.error(`[INSERTION][ECHEANCES] Reports illisibles (${err.code || '?'}) : ${err.message}`);
    sources.push('reports');
  }

  const obligations = [];
  const reportees = [];
  const toutes = [...[...charge.parEmploye.values()].flat(), ...charge.agregees];
  for (const o of toutes) {
    const r = o.employee_id == null ? null : reports.get(`${o.employee_id}:${o.type}`);
    if (r) o.nb_reports = r.nb;
    if (r && r.jusqu_au) {
      reportees.push({ ...o, reporte_jusqu_au: r.jusqu_au, motif_report: r.motif });
    } else {
      obligations.push(o);
    }
  }

  // Tri : rouge avant orange, puis échéance croissante (les lignes sans
  // échéance en dernier — elles ne sont pas en retard, elles sont sans date).
  const rang = (n) => (n === 'rouge' ? 0 : 1);
  obligations.sort((a, b) => (rang(a.niveau) - rang(b.niveau))
    || String(a.echeance || '9999-12-31').localeCompare(String(b.echeance || '9999-12-31'))
    || String(a.nom || '').localeCompare(String(b.nom || '')));

  const fileActive = await chargerKpiFileActive({
    db, soft, salaries: charge.salaries, obligationsParEmploye: charge.parEmploye, adminRh,
  });

  return {
    genere_le: new Date().toISOString(),
    obligations,
    organisation: organisation.items,
    rendez_vous_reguliers: periodiques,
    file_active: fileActive,
    compteur_rouges: obligations.filter((o) => o.niveau === 'rouge').length,
    reportees,
    sources_indisponibles: [...new Set(sources)],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Compteur de la barre latérale — cache mémoire 60 s
// ═══════════════════════════════════════════════════════════════════════════
//
// La barre latérale l'appelle à CHAQUE montage de page. Sans cache, naviguer
// dans l'application relancerait le calcul de toute la cohorte à chaque clic.
// Cache par (rôle, utilisateur, périmètre) : deux CIP n'ont pas le même
// compteur quand le filtre « mes salariés » est actif.
const CACHE_MS = 60000;
const cacheCompteur = new Map();

async function compteurRouges({ db = pool, baseRole = 'ADMIN', userId = null, mine = false } = {}) {
  const cle = `${baseRole}:${userId ?? '-'}:${mine ? 'mine' : 'tous'}`;
  const hit = cacheCompteur.get(cle);
  if (hit && Date.now() - hit.at < CACHE_MS) return { rouges: hit.rouges, cache: true };

  const charge = await chargerObligations({ db, baseRole, userId, mine });
  const ids = charge.salaries.map((s) => Number(s.id));
  let reports = new Map();
  try { reports = await chargerReports(db, ids); } catch (_) { /* sans report : compteur brut */ }

  const toutes = [...[...charge.parEmploye.values()].flat(), ...charge.agregees];
  const rouges = toutes.filter((o) => {
    if (o.niveau !== 'rouge') return false;
    const r = o.employee_id == null ? null : reports.get(`${o.employee_id}:${o.type}`);
    return !(r && r.jusqu_au);
  }).length;

  cacheCompteur.set(cle, { at: Date.now(), rouges });
  return { rouges, cache: false };
}

/** Invalide le cache (appelé après un report — le compteur doit retomber). */
function viderCacheCompteur() { cacheCompteur.clear(); }

module.exports = {
  TYPES_OBLIGATIONS,
  TYPES_OBLIGATIONS_CLES,
  MOTIFS_REPORT,
  CHAMPS_SOCLE,
  sqlSocleComplet,
  socleComplet,
  sqlPerimetreFileActive,
  typesPourRole,
  chargerObligations,
  niveauRisque,
  niveauxRisqueCohorte,
  composerEcheances,
  composerEcheancesPeriodiques,
  compteurRouges,
  viderCacheCompteur,
  lienEti,
};
