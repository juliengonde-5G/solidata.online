/**
 * Rappels de rendez-vous J-1 au salarié — PR C, lot 7.
 *
 * ═══ CE QUE FAIT CE MODULE, ET CE QU'IL S'INTERDIT ════════════════════════
 * La veille d'un entretien planifié, la personne reçoit un message court : vous
 * avez rendez-vous demain à telle heure avec telle conseillère. Rien d'autre.
 *
 * Ce « rien d'autre » est la règle centrale du fichier. Un SMS arrive sur un
 * écran que d'autres personnes voient — un conjoint, un colocataire, un
 * employeur qui regarde par-dessus l'épaule. Un rappel qui dirait « bilan de
 * sortie », « entretien de conciliation » ou « point avec votre référent RSA »
 * ferait sortir une information sur la situation de la personne vers son
 * entourage, sans qu'elle l'ait voulu. Le gabarit ne porte donc QUE quatre
 * variables — {prenom}, {date}, {heure}, {cip} — et le type d'entretien n'est
 * même pas LU par la requête de sélection : ce qu'on ne lit pas ne peut pas
 * fuir par une substitution oubliée.
 *
 * ═══ TROIS GARDES QUI NE SONT PAS DES FILTRES D'AFFICHAGE ═════════════════
 *  1. CONSENTEMENT. `rappel_rdv_consent = true` est dans le `WHERE` de la
 *     requête de sélection, pas dans un test applicatif après lecture : une
 *     personne qui n'a rien demandé n'est jamais chargée en mémoire.
 *  2. JOUR CIVIL DE PARIS. « Demain » est calculé PAR POSTGRESQL en
 *     Europe/Paris. Les conteneurs tournent en UTC : un entretien du 1er à
 *     00 h 30 heure de Paris appartient au 31 pour l'horloge du serveur, et le
 *     rappel serait parti la veille du bon jour — ou jamais.
 *  3. UN SEUL RAPPEL PAR RENDEZ-VOUS. Garanti par `UNIQUE(milestone_id)` en
 *     base, pas par un verrou applicatif : deux ticks qui se chevauchent se
 *     heurtent à un 23505, qu'on lit « déjà envoyé » et qu'on ignore.
 *
 * ═══ LIMITE ASSUMÉE ══════════════════════════════════════════════════════
 * Un entretien REPROGRAMMÉ ne reçoit pas de second rappel : la contrainte
 * d'unicité porte sur l'entretien, pas sur la date. C'est le prix de la
 * garantie « jamais deux messages » ; lever la contrainte au profit d'une clé
 * (entretien, date) est possible et documenté — c'est un arbitrage de la CIP,
 * pas une décision technique (contrat § 5.7).
 */

'use strict';

const pool = require('../config/database');
const { sendNotification } = require('./notification');
const { readInsertionSetting } = require('../utils/insertion-settings');
const { isoDate, heureMurale } = require('../utils/date-iso');

/** Fuseau de référence de la structure. */
const FUSEAU_PARIS = 'Europe/Paris';

/** Catégorie des gabarits Brevo de ce job (seedés par la migration). */
const CATEGORIE_GABARIT = 'insertion_rappel_rdv';

/**
 * FONCTION PURE — heure MURALE de Paris d'un instant, en 0-23.
 *
 * `now.getHours()` rendrait l'heure du conteneur, qui tourne en UTC : le job
 * partirait à 20 h l'été et 19 h l'hiver au lieu de 18 h. Même patron que
 * `shouldRunAutoBackup` (`services/db-backup.js`), et même raison : régler le
 * TZ du conteneur décalerait tous les autres jobs.
 */
function heureParis(now = new Date()) {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSEAU_PARIS, hour: '2-digit', hour12: false,
  }).format(now);
  // `en-GB` rend « 00 » à minuit (et non « 24 »), mais on borne quand même :
  // une valeur illisible ne doit pas se comparer par hasard à l'heure d'envoi.
  const n = Number(h);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
}

/**
 * FONCTION PURE — le job doit-il tourner à ce tick horaire ?
 * @param {Date} now
 * @param {number} heureEnvoi heure de Paris configurée (0-23)
 */
function doitEnvoyerRappels(now, heureEnvoi) {
  const h = heureParis(now);
  const cible = Math.round(Number(heureEnvoi));
  if (h == null || !Number.isInteger(cible) || cible < 0 || cible > 23) return false;
  return h === cible;
}

/**
 * Heure d'envoi configurée, bornée [0 ; 23] — hors bornes ou illisible → 18 h.
 *
 * L'ABSENCE est testée AVANT la conversion : `Number(null)` vaut 0, et 0 est
 * ici une heure parfaitement valide (minuit). Sans ce test, un réglage absent
 * ferait partir les rappels à minuit — même piège que le point de départ dans
 * le golfe de Guinée (2.42.0) et la tolérance de rendez-vous à zéro minute
 * (2.38.0).
 */
async function lireHeureEnvoi() {
  const v = await readInsertionSetting('insertion.rappel_rdv_heure_envoi');
  if (v == null || v === '') return 18;
  const n = Math.round(Number(v));
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 18;
}

/**
 * Masque un destinataire pour la trace : « 06 ** ** ** 12 », « j***@gmail.com ».
 * La trace prouve qu'un message est parti et vers quel canal ; elle ne
 * constitue pas un second répertoire de coordonnées.
 */
function masquerDestinataire(canal, valeur) {
  const v = String(valeur == null ? '' : valeur).trim();
  if (!v) return '—';
  if (canal === 'email') {
    const at = v.indexOf('@');
    if (at <= 0) return '***';
    // CORRECTIF m-09 : sur un local-part d'une ou deux lettres, « a***@x.fr »
    // le révélait INTÉGRALEMENT. Sous trois caractères, on ne montre rien.
    return (at < 3 ? `***${v.slice(at)}` : `${v.charAt(0)}***${v.slice(at)}`).slice(0, 60);
  }
  let chiffres = v.replace(/\D/g, '');
  // Le numéro est stocké en E.164 (+33612345678) depuis le correctif M-04 : on
  // le REPRÉSENTE en forme française, parce que la conseillère vérifie de vive
  // voix (« c'est bien le 06 qui finit par 78 ? ») et que « 33 ** ** ** 78 » ne
  // ressemble à rien de ce que la personne connaît de son propre numéro.
  if (/^33\d{9}$/.test(chiffres)) chiffres = `0${chiffres.slice(2)}`;
  if (chiffres.length < 4) return '***';
  return `${chiffres.slice(0, 2)} ** ** ** ${chiffres.slice(-2)}`;
}

/** Prénom + initiale — jamais le nom complet de la conseillère dans un SMS. */
function prenomInitiale(prenom, nom) {
  const p = String(prenom || '').trim();
  const n = String(nom || '').trim();
  if (!p && !n) return null;
  if (!n) return p;
  return `${p} ${n.charAt(0).toUpperCase()}.`;
}

/** Les deux gabarits actifs, indexés par type. Aucun gabarit → aucun envoi. */
async function lireGabarits() {
  try {
    const r = await pool.query(
      `SELECT id, name, type, subject, body FROM message_templates
        WHERE category = $1 AND is_active = true`,
      [CATEGORIE_GABARIT]
    );
    const parType = {};
    for (const t of r.rows) parType[t.type] = t;
    return parType;
  } catch (err) {
    console.error('[RAPPELS-RDV] Gabarits illisibles :', err.message);
    return {};
  }
}

/**
 * Entretiens de DEMAIN (jour civil de Paris) dont la personne a consenti.
 *
 * Le type d'entretien n'est PAS sélectionné : il n'a aucune raison d'exister
 * dans la mémoire de ce job. `interview_date` est obligatoire — un entretien
 * dont on ne connaît que l'échéance (`due_date`) n'a pas de rendez-vous fixé,
 * il n'y a donc rien à rappeler.
 */
async function selectionnerRendezVous() {
  const r = await pool.query(
    `SELECT m.id AS milestone_id, m.interview_date,
            to_char(m.interview_date, 'DD/MM/YYYY') AS rdv_date,
            to_char(m.interview_date, 'HH24:MI') AS rdv_heure,
            e.id AS employee_id, e.first_name,
            e.rappel_rdv_canal AS canal, e.rappel_rdv_destinataire AS destinataire,
            ui.first_name AS int_prenom, ui.last_name AS int_nom,
            uc.first_name AS cip_prenom, uc.last_name AS cip_nom
       FROM insertion_milestones m
       JOIN employees e ON e.id = m.employee_id
       LEFT JOIN users ui ON ui.id = m.interviewer_id
       LEFT JOIN users uc ON uc.id = e.cip_referent_user_id
      WHERE m.status = 'planifie'
        AND m.interview_date IS NOT NULL
        -- « Demain » à Paris, comparé au JOUR de la valeur STOCKÉE.
        -- CORRECTIF D-03 : interview_date est un timestamp WITHOUT time zone
        -- qui porte déjà l'heure murale de Paris. La convertir
        -- (AT TIME ZONE UTC puis Europe/Paris) lui ajoutait deux heures : un
        -- rendez-vous de 23:30 basculait au surlendemain et ne recevait AUCUN
        -- rappel — ni ce soir-là, ni jamais.
        AND m.interview_date::date = ((NOW() AT TIME ZONE 'Europe/Paris')::date + 1)
        AND e.rappel_rdv_consent = true
        AND e.is_active = true
        AND e.rappel_rdv_canal IS NOT NULL
        AND COALESCE(TRIM(e.rappel_rdv_destinataire), '') <> ''
        AND NOT EXISTS (SELECT 1 FROM insertion_rappels_rdv r WHERE r.milestone_id = m.id)
      ORDER BY m.interview_date, m.id`
  );
  return r.rows;
}

/**
 * Date (JJ/MM/AAAA) et heure (HH:MM) du rendez-vous, TELLES QU'ELLES SONT
 * STOCKÉES.
 *
 * ═══ CORRECTIF D-01 — LE DÉFAUT LE PLUS VISIBLE DE LA PR C ════════════════
 * `interview_date` est un `TIMESTAMP WITHOUT TIME ZONE` : le formulaire saisit
 * un `<input type="datetime-local">` (chaîne naïve, l'heure que la conseillère
 * lit sur sa montre) et la route l'écrit telle quelle. La valeur EST déjà
 * l'heure de Paris. `Intl(Europe/Paris)` lui ajoutait donc l'offset une SECONDE
 * fois, et le SMS annonçait **16:00 pour un rendez-vous saisi à 14:00** — un
 * écart de deux heures, sur la seule fonction de la PR qui parle directement à
 * la personne, et exactement de nature à lui faire manquer son rendez-vous.
 *
 * La requête demande désormais les deux valeurs à PostgreSQL (`to_char`) ; ce
 * repli PUR sert quand elles manquent (appelant de test, colonne absente).
 */
function formaterRdv(instant) {
  const jour = isoDate(instant);
  const heure = heureMurale(instant);
  if (!jour) return { date: null, heure: null };
  return { date: `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`, heure };
}

/**
 * Trace l'envoi ET sa journalisation RGPD.
 *
 * La trace est écrite APRÈS l'appel (et non avant, avec un statut provisoire) :
 * une ligne « en cours » qu'un crash laisserait en place bloquerait
 * définitivement le rappel — l'unicité porte sur l'entretien. Le doublon, lui,
 * est impossible par la contrainte : deux ticks concurrents voient le second
 * échouer en 23505, qui vaut « déjà envoyé ».
 *
 * Le journal RGPD est best-effort ICI, contrairement aux documents remis :
 * le message est DÉJÀ parti quand on écrit la ligne ; faire échouer l'opération
 * ne le rattraperait pas, et empêcherait seulement la trace de l'envoi
 * d'exister. La trace `insertion_rappels_rdv`, elle, reste la preuve.
 */
async function tracerEnvoi({ milestoneId, employeeId, canal, destinataire, statut, erreur = null }) {
  const masque = masquerDestinataire(canal, destinataire);
  try {
    await pool.query(
      `INSERT INTO insertion_rappels_rdv (milestone_id, employee_id, canal, destinataire_masque, statut, erreur)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [milestoneId, employeeId, canal, masque, statut, erreur ? String(erreur).slice(0, 200) : null]
    );
  } catch (err) {
    if (err && err.code === '23505') {
      console.warn(`[RAPPELS-RDV] Rappel déjà tracé pour l'entretien #${milestoneId} — ignoré.`);
      return false;
    }
    console.error(`[RAPPELS-RDV] Trace impossible pour l'entretien #${milestoneId} :`, err.message);
    return false;
  }
  try {
    await pool.query(
      `INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (NULL, 'INSERTION_RAPPEL_ENVOI', 'insertion_rappel_rdv', $1, $2)`,
      [employeeId, JSON.stringify({ milestone_id: milestoneId, canal, destinataire_masque: masque, statut })]
    );
  } catch (err) {
    console.error('[RAPPELS-RDV] Journalisation INSERTION_RAPPEL_ENVOI impossible :', err.message);
  }
  return true;
}

/**
 * Job — envoie les rappels des rendez-vous de demain.
 * @returns {Promise<{envoyes:number, echecs:number, dry_run:number, candidats:number}>}
 */
async function envoyerRappelsRdvSalaries() {
  const bilan = { candidats: 0, envoyes: 0, echecs: 0, dry_run: 0 };
  let rdvs;
  try {
    rdvs = await selectionnerRendezVous();
  } catch (err) {
    // Base non migrée : on le dit, on ne fait pas échouer le tour de jobs.
    if (err && err.code === '42P01') {
      console.warn('[RAPPELS-RDV] Table insertion_rappels_rdv absente (base non migrée) — aucun rappel.');
      return bilan;
    }
    if (err && err.code === '42703') {
      console.warn('[RAPPELS-RDV] Colonnes de consentement absentes (base non migrée) — aucun rappel.');
      return bilan;
    }
    throw err;
  }
  bilan.candidats = rdvs.length;
  if (rdvs.length === 0) return bilan;

  const gabarits = await lireGabarits();
  if (!gabarits.sms && !gabarits.email) {
    console.warn('[RAPPELS-RDV] Aucun gabarit actif de catégorie « insertion_rappel_rdv » — aucun rappel envoyé.');
    return bilan;
  }

  for (const rdv of rdvs) {
    const canal = rdv.canal === 'email' ? 'email' : 'sms';
    const gabarit = gabarits[canal];
    if (!gabarit) {
      console.warn(`[RAPPELS-RDV] Gabarit « ${canal} » absent — entretien #${rdv.milestone_id} ignoré (aucune trace posée : le rappel reste dû).`);
      continue;
    }
    const formate = formaterRdv(rdv.interview_date);
    const date = rdv.rdv_date || formate.date;
    const heure = rdv.rdv_heure || formate.heure;
    const variables = {
      prenom: rdv.first_name || '',
      date: date || '',
      // Une heure illisible ne produit pas « à  » : le message le dit.
      heure: heure || '(heure à confirmer avec votre conseillère)',
      cip: prenomInitiale(rdv.int_prenom, rdv.int_nom)
        || prenomInitiale(rdv.cip_prenom, rdv.cip_nom)
        || 'votre conseillère',
    };
    try {
      const res = await sendNotification(
        gabarit,
        canal === 'email' ? rdv.destinataire : null,
        canal === 'sms' ? rdv.destinataire : null,
        variables
      );
      // ═══ CORRECTIF M-04 — un envoi n'est réussi que sur PREUVE ═══════════
      // `sendNotification` rendait le JSON de Brevo sans regarder le statut
      // HTTP, et on concluait « envoyé » dès qu'aucune exception n'était levée.
      // Un 400 (numéro invalide), un 401 (clé révoquée) ou un 402 (crédits
      // épuisés) étaient donc inscrits « envoyé » — définitivement, l'unicité
      // interdisant toute nouvelle tentative. La personne n'était pas prévenue,
      // et la trace, qui EST la preuve du service rendu, affirmait le contraire.
      const succes = !!(res && (res.ok === true
        || res.messageId || res.reference || Array.isArray(res.messageIds)));
      const statut = res && res.dryRun ? 'dry_run' : (succes ? 'envoye' : 'echec');
      const motif = succes ? null
        : `Refus du service d'envoi${res && res.status ? ` (HTTP ${res.status})` : ''}${res && res.message ? ` : ${res.message}` : ''}`;
      const trace = await tracerEnvoi({
        milestoneId: rdv.milestone_id, employeeId: rdv.employee_id,
        canal, destinataire: rdv.destinataire, statut, erreur: motif,
      });
      if (statut === 'echec') {
        console.error(`[RAPPELS-RDV] Rappel REFUSÉ par le service d'envoi (entretien #${rdv.milestone_id}) : ${motif}`);
      }
      if (trace) bilan[statut === 'dry_run' ? 'dry_run' : (statut === 'echec' ? 'echecs' : 'envoyes')] += 1;
    } catch (err) {
      console.error(`[RAPPELS-RDV] Envoi impossible (entretien #${rdv.milestone_id}) :`, err.message);
      await tracerEnvoi({
        milestoneId: rdv.milestone_id, employeeId: rdv.employee_id,
        canal, destinataire: rdv.destinataire, statut: 'echec', erreur: err.message,
      });
      bilan.echecs += 1;
    }
  }
  console.log(`[RAPPELS-RDV] ${bilan.envoyes} rappel(s) envoyé(s), ${bilan.dry_run} simulé(s), ${bilan.echecs} échec(s) sur ${bilan.candidats} rendez-vous.`);
  return bilan;
}

module.exports = {
  envoyerRappelsRdvSalaries,
  doitEnvoyerRappels,
  heureParis,
  lireHeureEnvoi,
  masquerDestinataire,
  prenomInitiale,
  formaterRdv,
  CATEGORIE_GABARIT,
};
