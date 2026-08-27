// ═══════════════════════════════════════════════════════════════════════════
// COMMANDES EXUTOIRES RÉCURRENTES — moteur de génération des occurrences
// ───────────────────────────────────────────────────────────────────────────
// CONSTAT À L'ORIGINE DE CE MODULE : la colonne `commandes_exutoires.frequence`
// existait depuis la création de la table (migrate-exutoires.js) avec ses
// quatre valeurs `unique | hebdomadaire | bi_mensuel | mensuel`, elle était
// saisie à l'écran… et RIEN ne la lisait. Aucune commande n'a jamais été
// générée, aucune préparation n'a jamais été posée : une commande déclarée
// « hebdomadaire » se comportait exactement comme une commande unique.
// (Le seul consommateur, `calendrier-logistique.js`, testait des valeurs qui
// n'existent pas dans le CHECK — « bimensuelle », « mensuelle »,
// « trimestrielle » — donc seul l'hebdomadaire était même PROJETÉ, et jamais
// matérialisé. Ce défaut est corrigé dans le même lot.)
//
// DOCTRINE (contrat §8.1, arbitrage §12.7)
//  - Le modèle récurrent EST la commande d'origine : `frequence <> 'unique'`
//    ET `commande_parent_id IS NULL`. Aucune colonne « est_modele » : un statut
//    DÉRIVÉ ne peut pas mentir.
//  - Les occurrences sont MATÉRIALISÉES (vraies lignes filles) : elles sont
//    donc visibles au kanban, au calendrier, et traçables.
//  - Idempotence STRUCTURELLE : l'index unique partiel
//    `(commande_parent_id, date_commande) WHERE commande_parent_id IS NOT NULL`
//    interdit deux filles pour la même échéance. Le service la vérifie AVANT
//    (lecture des filles existantes) et la RATTRAPE APRÈS (SAVEPOINT + 23505),
//    pour qu'une concurrence ne fasse jamais échouer tout un modèle.
//  - JAMAIS DE DATE INVENTÉE : la préparation d'expédition n'est posée que si
//    un vrai gabarit existe (préparation déjà saisie sur le modèle ou une
//    fille) ET si le créneau est libre. Sinon la commande est créée seule et
//    le motif est dit — pas de transporteur ni de lieu devinés.
//
// Les fonctions de calcul d'échéances sont PURES (aucune E/S) et exportées
// pour être testées sans base : voir backend/tests/unit/commandes-recurrence.test.js
// ═══════════════════════════════════════════════════════════════════════════

const pool = require('../config/database');

// Pas de récurrence — les clés sont EXACTEMENT les valeurs du CHECK SQL de
// `commandes_exutoires.frequence` (migrate-exutoires.js). Toute divergence ici
// reproduirait le défaut du calendrier logistique.
const PAS_RECURRENCE = {
  hebdomadaire: { jours: 7, libelle: 'Hebdomadaire' },
  bi_mensuel: { jours: 14, libelle: 'Bi-mensuel' },
  mensuel: { mois: 1, libelle: 'Mensuel' },
};

const HORIZON_DEFAUT_JOURS = 30;
// Garde-fou : un modèle très ancien ne doit pas produire une avalanche
// d'occurrences en un seul passage (le curseur avance quand même).
const MAX_ITERATIONS = 500;

// ───────────────────────────────────────────────────────────────────────────
// FONCTIONS PURES (aucune E/S — testées sans base)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normalise une date (Date, string ISO, 'YYYY-MM-DD') en 'YYYY-MM-DD'.
 * Renvoie null si la valeur est absente ou illisible — jamais une date de
 * remplacement (« jamais de valeur inventée »).
 */
function normaliserDate(valeur) {
  if (valeur == null) return null;
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    // Composantes LOCALES, jamais `toISOString()`. node-postgres construit les
    // colonnes DATE et TIMESTAMP (sans fuseau) en heure LOCALE : une date du
    // 1er septembre arrive donc à minuit local, et `toISOString()` la
    // renverrait au 31 août dès que le serveur n'est pas en UTC. Le curseur
    // `prochaine_echeance`, relu à chaque passage, reculerait d'un jour à
    // chaque exécution — et la vérification anti-doublon chercherait la
    // veille de la date réellement enregistrée.
    const y = valeur.getFullYear();
    const mo = String(valeur.getMonth() + 1).padStart(2, '0');
    const d = String(valeur.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const s = String(valeur).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const annee = Number(y); const mois = Number(mo); const jour = Number(d);
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  // Vérification de réalité du jour (31 février → refusé, pas ramené au 03/03)
  const dt = new Date(Date.UTC(annee, mois - 1, jour));
  if (dt.getUTCFullYear() !== annee || dt.getUTCMonth() !== mois - 1 || dt.getUTCDate() !== jour) return null;
  return `${y}-${mo}-${d}`;
}

/** Ajoute n jours à une date 'YYYY-MM-DD' (arithmétique UTC : pas de dérive DST). */
function ajouterJours(dateStr, n) {
  const base = normaliserDate(dateStr);
  if (base == null) return null;
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Quantième d'une date 'YYYY-MM-DD' (1-31), ou null si elle est illisible. */
function jourDuMois(dateStr) {
  const base = normaliserDate(dateStr);
  return base ? Number(base.slice(8, 10)) : null;
}

/**
 * Ajoute n mois CALENDAIRES à une date 'YYYY-MM-DD'.
 *
 * Deux pièges, tous deux traités ici :
 *  1. Le quantième peut ne pas exister dans le mois cible : le 31 janvier + 1
 *     mois vaut le 28 (ou 29) février. `setUTCMonth` seul déborderait sur le
 *     3 mars, décalant définitivement toute la série.
 *  2. Le ramenage ne doit pas être DÉFINITIF. En repartant du résultat ramené,
 *     une commande mensuelle du 31 deviendrait « le 28 de chaque mois » pour
 *     toujours après un seul mois de février. `jourAncre` — le quantième de la
 *     commande d'origine — est donc réappliqué à chaque pas : février est
 *     ramené au 28, mars retrouve le 31.
 */
function ajouterMois(dateStr, n, jourAncre = null) {
  const base = normaliserDate(dateStr);
  if (base == null) return null;
  const [y, m, d] = base.split('-').map(Number);
  const ancre = Number.isFinite(Number(jourAncre)) && Number(jourAncre) >= 1 && Number(jourAncre) <= 31
    ? Math.floor(Number(jourAncre))
    : d;
  const cible = new Date(Date.UTC(y, m - 1 + n, 1));
  const anneeCible = cible.getUTCFullYear();
  const moisCible = cible.getUTCMonth();
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate();
  const jour = Math.min(ancre, dernierJour);
  return new Date(Date.UTC(anneeCible, moisCible, jour)).toISOString().slice(0, 10);
}

/**
 * Échéance suivante à partir d'une date, selon la fréquence.
 * `jourAncre` (quantième de la commande d'origine) n'a de sens que pour le pas
 * mensuel ; il est ignoré pour les pas en jours.
 * Renvoie null si la fréquence n'est pas récurrente ou la date illisible.
 */
function avancerEcheance(dateStr, frequence, jourAncre = null) {
  const pas = PAS_RECURRENCE[frequence];
  if (!pas) return null;
  if (pas.jours) return ajouterJours(dateStr, pas.jours);
  return ajouterMois(dateStr, pas.mois, jourAncre);
}

/** Libellé français d'une fréquence (pour les messages et l'UI). */
function libelleFrequence(frequence) {
  return PAS_RECURRENCE[frequence] ? PAS_RECURRENCE[frequence].libelle : 'Unique';
}

/** Vrai si la commande est un MODÈLE récurrent (statut dérivé, jamais stocké). */
function estModeleRecurrent(commande) {
  if (!commande) return false;
  return Boolean(PAS_RECURRENCE[commande.frequence]) && commande.commande_parent_id == null;
}

/**
 * Calcule les échéances à générer pour UN modèle. FONCTION PURE.
 *
 * @param {object} modele  { frequence, date_commande, prochaine_echeance, date_fin_recurrence }
 * @param {object} options { aujourdhui:'YYYY-MM-DD', horizonJours:number, datesExistantes?:string[] }
 * @returns {{ echeances: string[], prochaine_echeance: string|null,
 *             ignorees: Array<{date:string, motif:string}>, motif: string|null }}
 *
 * `prochaine_echeance` renvoyée = curseur À ÉCRIRE après ce passage :
 *  - la première échéance au-delà de l'horizon si la récurrence continue ;
 *  - `null` si la date de fin de récurrence est dépassée (récurrence terminée).
 *
 * Les échéances antérieures à `aujourdhui` ne sont PAS générées (un modèle
 * ancien ne doit pas matérialiser rétroactivement des mois de commandes) mais
 * elles ne sont pas escamotées : elles ressortent dans `ignorees` avec leur
 * motif, et le curseur avance quand même.
 */
function calculerEcheances(modele, options = {}) {
  const vide = { echeances: [], prochaine_echeance: null, ignorees: [], motif: null };
  if (!modele) return { ...vide, motif: 'modèle absent' };

  const frequence = modele.frequence;
  if (!PAS_RECURRENCE[frequence]) {
    return { ...vide, motif: 'fréquence non récurrente' };
  }

  const aujourdhui = normaliserDate(options.aujourdhui) || normaliserDate(new Date());
  const horizonJours = Number.isFinite(Number(options.horizonJours)) && Number(options.horizonJours) > 0
    ? Math.floor(Number(options.horizonJours))
    : HORIZON_DEFAUT_JOURS;
  const datesExistantes = new Set((options.datesExistantes || []).map(normaliserDate).filter(Boolean));

  const dateCommande = normaliserDate(modele.date_commande);
  const finRecurrence = normaliserDate(modele.date_fin_recurrence);

  // Quantième de référence d'un modèle MENSUEL : celui de la commande
  // d'origine. Sans lui, un mensuel du 31 « collerait » au 28 dès le premier
  // février traversé, et n'en repartirait jamais (voir ajouterMois).
  const jourAncre = jourDuMois(dateCommande) ?? jourDuMois(modele.prochaine_echeance);

  // Curseur de départ : la prochaine échéance stockée, sinon « date de la
  // commande d'origine + un pas » (le modèle lui-même EST la 1re occurrence).
  let curseur = normaliserDate(modele.prochaine_echeance);
  if (curseur == null) {
    if (dateCommande == null) {
      return { ...vide, motif: 'date de commande illisible — échéances non calculables' };
    }
    curseur = avancerEcheance(dateCommande, frequence, jourAncre);
    if (curseur == null) return { ...vide, motif: 'échéance de départ non calculable' };
  }

  const limiteHorizon = ajouterJours(aujourdhui, horizonJours);
  const echeances = [];
  const ignorees = [];
  let iterations = 0;

  while (curseur != null && curseur <= limiteHorizon) {
    if (finRecurrence != null && curseur > finRecurrence) {
      curseur = null;
      break;
    }
    if (++iterations > MAX_ITERATIONS) {
      ignorees.push({ date: curseur, motif: `plus de ${MAX_ITERATIONS} échéances en attente — génération interrompue, relancez` });
      break;
    }
    if (curseur < aujourdhui) {
      ignorees.push({ date: curseur, motif: 'échéance passée — non matérialisée rétroactivement' });
    } else if (datesExistantes.has(curseur)) {
      ignorees.push({ date: curseur, motif: 'occurrence déjà générée' });
    } else {
      echeances.push(curseur);
    }
    curseur = avancerEcheance(curseur, frequence, jourAncre);
  }

  // Récurrence arrivée à son terme → plus aucune échéance à venir.
  if (curseur != null && finRecurrence != null && curseur > finRecurrence) curseur = null;

  return { echeances, prochaine_echeance: curseur, ignorees, motif: null };
}

// ───────────────────────────────────────────────────────────────────────────
// ACCÈS BASE
// ───────────────────────────────────────────────────────────────────────────

/**
 * Horizon de génération, lu dans `settings` (clé `exutoires.recurrence_horizon_jours`).
 * Jamais en dur : une valeur absente, vide ou illisible retombe sur le défaut
 * documenté (30 jours) — et non sur 0, qui figerait la génération en silence.
 */
async function lireHorizonJours(executor = pool) {
  try {
    const r = await executor.query(
      "SELECT value FROM settings WHERE key = 'exutoires.recurrence_horizon_jours' LIMIT 1"
    );
    const brut = r.rows[0] && r.rows[0].value;
    if (brut == null || String(brut).trim() === '') return HORIZON_DEFAUT_JOURS;
    const n = parseInt(String(brut).trim(), 10);
    if (!Number.isFinite(n) || n <= 0) return HORIZON_DEFAUT_JOURS;
    return Math.min(n, 365);
  } catch (err) {
    console.warn('[RECURRENCE] Horizon non lisible en settings, défaut appliqué :', err.message);
    return HORIZON_DEFAUT_JOURS;
  }
}

/**
 * Gabarit de préparation d'expédition d'un modèle : la dernière préparation
 * saisie sur le modèle LUI-MÊME ou sur l'une de ses filles.
 * Aucun gabarit → aucune préparation posée (on n'invente ni transporteur ni lieu).
 */
async function chargerGabaritPreparation(executor, modeleId) {
  const r = await executor.query(
    `SELECT p.transporteur, p.lieu_chargement, p.notes_preparation
       FROM preparations_expedition p
       JOIN commandes_exutoires c ON c.id = p.commande_id
      WHERE c.id = $1 OR c.commande_parent_id = $1
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1`,
    [modeleId]
  );
  return r.rows[0] || null;
}

/**
 * Contrôle de chevauchement — MÊME prédicat que POST /api/preparations
 * (routes/preparations.js) : deux créneaux se chevauchent sur un même lieu si
 * `debut_existant < fin_nouvelle` ET `fin_existante > debut_nouveau`.
 * Réécrire une variante ici ferait diverger la règle des deux chemins.
 */
async function creneauOccupe(executor, { lieu_chargement, date_debut, date_fin }) {
  const r = await executor.query(
    `SELECT c.reference
       FROM preparations_expedition p
       JOIN commandes_exutoires c ON c.id = p.commande_id
      WHERE p.lieu_chargement = $1
        AND p.date_livraison_remorque < $3
        AND p.date_expedition > $2
      LIMIT 1`,
    [lieu_chargement, date_debut, date_fin]
  );
  return r.rows[0] ? r.rows[0].reference : null;
}

/**
 * Signale aux responsables d'exploitation les commandes créées SANS créneau de
 * chargement — correctif du 27/08.
 *
 * DÉFAUT CORRIGÉ : le refus de poser une préparation (aucun gabarit, créneau
 * occupé) est une décision saine, et son motif était bien renvoyé dans
 * `ignorees`. Mais `ignorees` n'était rendu QUE dans la modale de génération
 * manuelle. Dans le chemin réellement automatique — le job, trois fois par
 * jour — le motif n'allait que dans `job_runs` : personne ne le voyait.
 *
 * Cas nominal du client : une commande hebdomadaire toute neuve n'a, par
 * construction, aucun gabarit de préparation. Semaine après semaine, la fille
 * était créée en `en_attente` et son créneau n'était jamais posé, sans que le
 * responsable logistique en soit averti — et au kanban, elle est
 * indiscernable d'une commande en attente ordinaire.
 *
 * Require PARESSEUX sous try/catch : la messagerie est un canal de CONFORT.
 * Son absence (module non déployé, table non migrée) ne doit jamais faire
 * échouer une génération de commandes. Même pattern que `notifierGestionnaires`
 * de routes/tours/index.js.
 */
function signalerPreparationsNonPosees(ignorees) {
  // Ne remontent QUE les échéances réellement matérialisées sans créneau : un
  // modèle en échec ou une occurrence déjà générée n'appelle aucune action de
  // la logistique.
  const sansCreneau = (ignorees || []).filter((i) => i && i.date && MOTIFS_PREPARATION.some((m) => String(i.motif || '').startsWith(m)));
  if (sansCreneau.length === 0) return;
  try {
    const { envoyerMessageSystemeRoles } = require('./messagerie');
    if (typeof envoyerMessageSystemeRoles !== 'function') return;
    // Une ligne par commande concernée : le responsable doit savoir LAQUELLE
    // ouvrir, pas seulement qu'« il y a un problème quelque part ».
    const lignes = sansCreneau.slice(0, 10).map(
      (i) => `• ${i.reference_parent || 'commande récurrente'} du ${i.date} — ${i.motif}`
    );
    const reste = sansCreneau.length - lignes.length;
    const texte = `${sansCreneau.length} commande(s) récurrente(s) créée(s) sans créneau de chargement :\n`
      + lignes.join('\n')
      + (reste > 0 ? `\n• … et ${reste} autre(s)` : '')
      + '\nLa commande reste en attente : le créneau est à poser à la main.';
    Promise.resolve(envoyerMessageSystemeRoles(['ADMIN', 'MANAGER'], {
      texte, source: 'recurrence', lien: '/exutoires-commandes',
    })).catch((err) => console.warn('[RECURRENCE] Messagerie interne indisponible :', err.message));
  } catch (err) {
    console.warn('[RECURRENCE] Service de messagerie absent, signalement non doublé :', err.message);
  }
}

/** Préfixes des motifs qui relèvent de la PRÉPARATION (et pas de la commande). */
const MOTIFS_PREPARATION = ['aucun gabarit', 'gabarit incomplet', 'créneau occupé', 'créneau non calculable'];

/**
 * Génère les occurrences dues de tous les modèles récurrents actifs.
 *
 * @param {object} options
 *   - horizonJours : force l'horizon (sinon settings, sinon 30)
 *   - simulation   : true → AUCUNE écriture, mêmes listes en réponse
 *   - notifier     : true → signale par la messagerie interne les commandes
 *                    créées sans créneau de chargement. Le job planifié le
 *                    demande ; la génération MANUELLE ne le fait pas — l'écran
 *                    montre déjà `ignorees` dans sa modale, un message en plus
 *                    ferait doublon avec ce que l'utilisateur vient de lire.
 * @returns {Promise<{ok:boolean, generees:Array, preparations:Array,
 *                     ignorees:Array, horizon_jours:number, modeles_examines:number,
 *                     simulation:boolean}>}
 *
 * Une transaction PAR MODÈLE : l'échec d'un modèle (client supprimé, conflit
 * de créneau, contrainte) n'empêche jamais les autres d'aboutir.
 */
async function genererCommandesRecurrentes(options = {}) {
  const simulation = options.simulation === true;
  const notifier = options.notifier === true && !simulation;
  const resultat = {
    ok: true,
    generees: [],
    preparations: [],
    ignorees: [],
    horizon_jours: HORIZON_DEFAUT_JOURS,
    modeles_examines: 0,
    simulation,
  };

  try {
    const horizonJours = Number.isFinite(Number(options.horizonJours)) && Number(options.horizonJours) > 0
      ? Math.min(Math.floor(Number(options.horizonJours)), 365)
      : await lireHorizonJours();
    resultat.horizon_jours = horizonJours;

    const aujourdhui = normaliserDate(options.aujourdhui) || normaliserDate(new Date());

    // Modèles éligibles — définition dérivée du contrat §8.1.
    // `recurrence_suspendue` peut ne pas exister sur une base non migrée : la
    // requête est retentée sans elle plutôt que de faire échouer le job.
    let modeles;
    try {
      modeles = await pool.query(
        `SELECT id, reference, client_id, type_produit, prix_tonne, tonnage_prevu,
                frequence, date_commande, date_fin_recurrence, prochaine_echeance,
                recurrence_suspendue, notes
           FROM commandes_exutoires
          WHERE frequence <> 'unique'
            AND commande_parent_id IS NULL
            AND statut <> 'annulee'
            AND COALESCE(recurrence_suspendue, false) = false
          ORDER BY id`
      );
    } catch (err) {
      if (err && err.code === '42703') {
        console.warn('[RECURRENCE] Colonnes de récurrence absentes (base non migrée) — génération ignorée.');
        return { ...resultat, ok: false, motif: 'base non migrée (colonnes de récurrence absentes)' };
      }
      throw err;
    }

    resultat.modeles_examines = modeles.rows.length;

    for (const modele of modeles.rows) {
      // Occurrences déjà matérialisées : lues AVANT pour ne pas provoquer la
      // violation d'unicité dans le cas courant (l'index reste le garde-fou).
      const filles = await pool.query(
        'SELECT date_commande FROM commandes_exutoires WHERE commande_parent_id = $1',
        [modele.id]
      );
      const datesExistantes = filles.rows.map((r) => normaliserDate(r.date_commande)).filter(Boolean);

      const plan = calculerEcheances(modele, { aujourdhui, horizonJours, datesExistantes });
      for (const ign of plan.ignorees) {
        resultat.ignorees.push({ parent_id: modele.id, reference_parent: modele.reference, date: ign.date, motif: ign.motif });
      }
      if (plan.motif) {
        resultat.ignorees.push({ parent_id: modele.id, reference_parent: modele.reference, date: null, motif: plan.motif });
        continue;
      }

      const curseurAEcrire = plan.prochaine_echeance;
      const curseurActuel = normaliserDate(modele.prochaine_echeance);
      if (plan.echeances.length === 0 && curseurAEcrire === curseurActuel) continue;

      const gabarit = await chargerGabaritPreparation(pool, modele.id);

      if (simulation) {
        for (const echeance of plan.echeances) {
          resultat.generees.push({
            commande_id: null, parent_id: modele.id, date_commande: echeance,
            reference: '(simulation)', reference_parent: modele.reference,
          });
          const bilan = await simulerPreparation(pool, { gabarit, echeance, modeleId: modele.id, reference: modele.reference });
          if (bilan.ok) resultat.preparations.push({ preparation_id: null, commande_id: null, date_expedition: bilan.date_expedition });
          else resultat.ignorees.push({ parent_id: modele.id, reference_parent: modele.reference, date: echeance, motif: bilan.motif });
        }
        continue;
      }

      // ── Écriture : une transaction par modèle ──────────────────────────
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { generateReference } = require('../routes/commandes-exutoires');

        for (const echeance of plan.echeances) {
          // SAVEPOINT par occurrence : une collision (23505 sur l'index
          // d'unicité de fille) ou un refus ponctuel n'avorte pas le modèle.
          await client.query('SAVEPOINT occurrence');
          try {
            const reference = await generateReference(client);
            const ins = await client.query(
              `INSERT INTO commandes_exutoires
                 (reference, client_id, type_produit, date_commande, prix_tonne, tonnage_prevu,
                  frequence, date_fin_recurrence, commande_parent_id, notes, statut)
               VALUES ($1, $2, $3, $4, $5, $6, 'unique', NULL, $7, $8, 'en_attente')
               RETURNING id, reference, date_commande`,
              [
                reference, modele.client_id, modele.type_produit, echeance,
                modele.prix_tonne, modele.tonnage_prevu, modele.id, modele.notes || null,
              ]
            );
            const fille = ins.rows[0];

            await client.query(
              `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire)
               VALUES ($1, NULL, 'en_attente', $2)`,
              [fille.id, `Générée automatiquement depuis la commande récurrente ${modele.reference} (${libelleFrequence(modele.frequence)})`]
            );

            const prep = await poserPreparation(client, {
              gabarit, echeance, commandeId: fille.id, modeleId: modele.id, reference: modele.reference,
            });
            if (prep.ok) {
              resultat.preparations.push({ preparation_id: prep.preparation_id, commande_id: fille.id, date_expedition: prep.date_expedition });
            } else {
              resultat.ignorees.push({ parent_id: modele.id, reference_parent: modele.reference, date: echeance, motif: prep.motif });
            }

            await client.query('RELEASE SAVEPOINT occurrence');
            resultat.generees.push({
              commande_id: fille.id, parent_id: modele.id,
              date_commande: normaliserDate(fille.date_commande) || echeance,
              reference: fille.reference, reference_parent: modele.reference,
            });
          } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT occurrence');
            const motif = err && err.code === '23505'
              ? 'occurrence déjà générée (générée en parallèle)'
              : `échec de création : ${err.message}`;
            resultat.ignorees.push({ parent_id: modele.id, reference_parent: modele.reference, date: echeance, motif });
          }
        }

        // Curseur avancé même quand tout a été ignoré : sans cela, une échéance
        // passée serait réexaminée à chaque passage, pour rien.
        await client.query(
          'UPDATE commandes_exutoires SET prochaine_echeance = $1, updated_at = NOW() WHERE id = $2',
          [curseurAEcrire, modele.id]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[RECURRENCE] Modèle ${modele.reference} (#${modele.id}) en échec :`, err.message);
        resultat.ignorees.push({ parent_id: modele.id, reference_parent: modele.reference, date: null, motif: `modèle en échec : ${err.message}` });
      } finally {
        client.release();
      }
    }

    // Best effort, APRÈS toutes les transactions : un canal de confort ne
    // s'intercale jamais dans une écriture métier.
    if (notifier) signalerPreparationsNonPosees(resultat.ignorees);

    return resultat;
  } catch (err) {
    console.error('[RECURRENCE] Erreur génération :', err);
    return { ...resultat, ok: false, motif: err.message };
  }
}

/**
 * Bornes du créneau de préparation d'une échéance.
 * Convention (contrat §8.1) : expédition le jour de l'échéance à 12:00,
 * remorque livrée la veille à 12:00. Aucune heure « négociée » ailleurs.
 */
function bornesPreparation(echeance) {
  const veille = ajouterJours(echeance, -1);
  if (!veille) return null;
  return { date_debut: `${veille} 12:00:00`, date_fin: `${echeance} 12:00:00` };
}

/** Vérifie qu'une préparation serait posable (simulation — aucune écriture). */
async function simulerPreparation(executor, { gabarit, echeance }) {
  if (!gabarit) return { ok: false, motif: 'aucun gabarit de préparation' };
  const bornes = bornesPreparation(echeance);
  if (!bornes) return { ok: false, motif: 'créneau non calculable' };
  const occupePar = await creneauOccupe(executor, {
    lieu_chargement: gabarit.lieu_chargement, date_debut: bornes.date_debut, date_fin: bornes.date_fin,
  });
  if (occupePar) return { ok: false, motif: `créneau occupé (${occupePar})` };
  return { ok: true, date_expedition: bornes.date_fin };
}

/**
 * Pose la préparation d'expédition de l'occurrence et bascule la commande en
 * `en_preparation` — MÊME effet que POST /api/preparations.
 * Refus explicite (jamais silencieux) si aucun gabarit ou créneau occupé :
 * la commande reste `en_attente` et le motif remonte à l'appelant.
 */
async function poserPreparation(client, { gabarit, echeance, commandeId }) {
  if (!gabarit) return { ok: false, motif: 'aucun gabarit de préparation' };
  if (!gabarit.transporteur || !gabarit.lieu_chargement) {
    return { ok: false, motif: 'gabarit incomplet (transporteur ou lieu de chargement absent)' };
  }
  const bornes = bornesPreparation(echeance);
  if (!bornes) return { ok: false, motif: 'créneau non calculable' };

  const occupePar = await creneauOccupe(client, {
    lieu_chargement: gabarit.lieu_chargement, date_debut: bornes.date_debut, date_fin: bornes.date_fin,
  });
  if (occupePar) return { ok: false, motif: `créneau occupé (${occupePar})` };

  const prep = await client.query(
    `INSERT INTO preparations_expedition
       (commande_id, transporteur, date_livraison_remorque, date_expedition, lieu_chargement, notes_preparation, statut_preparation)
     VALUES ($1, $2, $3, $4, $5, $6, 'planifiee')
     RETURNING id, date_expedition`,
    [commandeId, gabarit.transporteur, bornes.date_debut, bornes.date_fin, gabarit.lieu_chargement, gabarit.notes_preparation || null]
  );

  await client.query(
    "UPDATE commandes_exutoires SET statut = 'en_preparation', updated_at = NOW() WHERE id = $1",
    [commandeId]
  );
  await client.query(
    `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire)
     VALUES ($1, 'en_attente', 'en_preparation', 'Préparation d''expédition positionnée automatiquement (commande récurrente)')`,
    [commandeId]
  );

  return { ok: true, preparation_id: prep.rows[0].id, date_expedition: prep.rows[0].date_expedition };
}

module.exports = {
  genererCommandesRecurrentes,
  // Purs (testés sans base)
  calculerEcheances,
  avancerEcheance,
  jourDuMois,
  ajouterJours,
  ajouterMois,
  normaliserDate,
  estModeleRecurrent,
  libelleFrequence,
  bornesPreparation,
  PAS_RECURRENCE,
  HORIZON_DEFAUT_JOURS,
  // Signalement des commandes créées sans créneau (correctif 27/08) — exporté
  // pour que le tri des motifs soit testable sans passer par tout le moteur.
  signalerPreparationsNonPosees,
  MOTIFS_PREPARATION,
  // Accès base (exposés pour les routes)
  lireHorizonJours,
};
