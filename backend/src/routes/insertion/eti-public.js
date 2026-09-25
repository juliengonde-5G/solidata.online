/**
 * Écran de l'encadrant technique par LIEN PUBLIC — `/api/eti` (PR C, lot 5).
 * Contrat : rapports/cip-refonte-2026-09-12/20-contrats-techniques-PR-C.md § 5.3.
 *
 * ═══ POURQUOI UN LIEN SANS COMPTE ═════════════════════════════════════════
 *
 * L'écran de renouvellement existait déjà (`/insertion/renouvellement/:id`) et
 * la CIP avait un bouton « Copier le lien ». Mais ce lien menait derrière
 * l'authentification : son destinataire — un encadrant d'atelier qui n'a
 * souvent aucun compte, et jamais le réflexe d'en ouvrir un — tombait sur une
 * page de connexion. Le geste le plus fréquent du module était donc, dans les
 * faits, impraticable. Et l'identifiant d'entretien qui servait d'adresse était
 * un entier : énumérable.
 *
 * Le jeton (hex 32, espace 2¹²⁸) rend le lien AUTOPORTEUR, BORNÉ dans le temps
 * (`insertion.eti_token_validite_jours`, 60 j) et RÉVOCABLE — en régénérer un
 * tue le précédent. Même patron que `/api/enquetes/public/:token` : monté HORS
 * `authenticate`, rate-limité au montage (`index.js`).
 *
 * ═══ CE QUE LE PORTEUR DU LIEN VOIT, ET RIEN D'AUTRE ══════════════════════
 * Prénom, nom, poste, fin de contrat, et le formulaire de renouvellement. Pas
 * les freins, pas le statut social, pas le référent, pas les dates de parcours,
 * pas même `employee_id` — un identifiant rendu ici deviendrait la clé d'un
 * autre écran. La réponse du PUT est `{ ok: true }` et jamais la ligne : un
 * MANAGER connecté recevait `maskInsertionRow` (rôle retiré sur main le
 * 10/09/2026), un anonyme ne reçoit rien.
 *
 * ═══ TROIS ÉTATS, TROIS CODES ═════════════════════════════════════════════
 *   - jeton malformé ou inconnu → **404 uniforme**. Distinguer les deux
 *     transformerait la route en oracle d'existence de jetons.
 *   - jeton expiré → 410 `LIEN_EXPIRE` ; entretien clôturé (`locked_at`) →
 *     410 `ENTRETIEN_CLOTURE`. Deux situations différentes pour l'encadrant :
 *     l'une se règle en redemandant un lien, l'autre est close.
 */

'use strict';

const express = require('express');
const pool = require('../../config/database');
const { readInsertionSetting } = require('../../utils/insertion-settings');
const { ecrireJournal } = require('../../utils/insertion-journal');

const router = express.Router();

/** Jeton : 32 caractères hexadécimaux, produits par `crypto.randomBytes(16)`. */
const TOKEN_RE = /^[0-9a-f]{32}$/i;

/** Champs — et SEULS champs — inscriptibles par cet écran. */
const CHAMPS_FORMULAIRE = ['renouvellement_form', 'renouvellement_avis', 'renouvellement_duree_mois'];
const AVIS_VALIDES = ['favorable', 'favorable_reserves', 'defavorable'];

/**
 * ═══ CORRECTIF B-02 — LE BLOB N'EST PAS RENDU TEL QUEL ════════════════════
 *
 * `renouvellement_form` est écrit par DEUX formulaires : celui-ci (l'encadrant,
 * `rempli_par: 'eti'`) et la trame INTERNE de renouvellement que la CIP remplit
 * dans la fiche, dont le champ « Motifs / commentaires » est un texte libre
 * (« Arrêts maladie répétés ; suivi psy en cours. Ne pas renouveler. »). Le GET
 * public rendait le blob ENTIER — et le formulaire public le pré-remplissait à
 * l'écran — à qui détient un lien de 60 jours, transmissible, sans session.
 *
 * On projette donc les seules clés que CET écran sait écrire, et seulement
 * quand c'est l'encadrant qui les a écrites. Une liste blanche, jamais une
 * liste noire : le champ que la CIP ajoutera demain à sa trame ne sera pas
 * rendu par omission.
 */
const CLES_FORMULAIRE_ETI = ['assiduite', 'motivation', 'autonomie', 'participation_actions',
  'competences_acquises', 'projet_professionnel', 'motifs', 'commentaires', 'rempli_par'];

/** Le formulaire a-t-il été rempli par l'encadrant (et non par la CIP) ? */
const remplParEti = (f) => !!(f && typeof f === 'object' && !Array.isArray(f) && f.rempli_par === 'eti');

/** Projection publique : les clés de l'encadrant, ou un écran vierge. */
function projeterFormulaire(f) {
  if (!remplParEti(f)) return {};
  return Object.fromEntries(Object.entries(f).filter(([k]) => CLES_FORMULAIRE_ETI.includes(k)));
}

/**
 * ═══ CORRECTIF M-02 — LA VALEUR EST BORNÉE AVANT D'ÊTRE STOCKÉE ═══════════
 *
 * La liste blanche ne portait que sur les NOMS des trois champs : la valeur de
 * `renouvellement_form` partait en `JSON.stringify` vers une colonne JSONB sans
 * type, sans taille, sans profondeur et sans contrôle de clés. Mesuré sur le
 * routeur réel, SANS authentification : 2 Mo écrits sur une ligne (la seule
 * limite étant `express.json({ limit: '10mb' })`), et 20 000 niveaux
 * d'imbrication faisaient lever « Maximum call stack size exceeded » dans le
 * sérialiseur. Le rate limit borne le débit, pas la taille.
 */
const TAILLE_MAX_TEXTE = 2000;
const TAILLE_MAX_LISTE = 20;
const TAILLE_MAX_ELEMENT = 100;

function formulaireValide(v) {
  if (v == null) return true;
  if (typeof v !== 'object' || Array.isArray(v)) return false;
  const cles = Object.keys(v);
  if (cles.length > CLES_FORMULAIRE_ETI.length) return false;
  if (cles.some((k) => !CLES_FORMULAIRE_ETI.includes(k))) return false;
  return cles.every((k) => {
    const x = v[k];
    if (x == null) return true;
    if (typeof x === 'string') return x.length <= TAILLE_MAX_TEXTE;
    if (Array.isArray(x)) {
      return x.length <= TAILLE_MAX_LISTE
        && x.every((e) => typeof e === 'string' && e.length <= TAILLE_MAX_ELEMENT);
    }
    return typeof x === 'number' || typeof x === 'boolean';
  });
}

/** 404 UNIFORME — jeton malformé, inconnu, entretien disparu : même réponse. */
const inconnu = (res) => res.status(404).json({ error: "Ce lien n'est pas valide.", code: 'LIEN_INCONNU' });

/**
 * Charge l'entretien porté par un jeton et tranche son état.
 * @returns {Promise<{etat:'ok'|'inconnu'|'expire'|'cloture', row?:object}>}
 */
async function chargerParJeton(token) {
  if (!TOKEN_RE.test(String(token || ''))) return { etat: 'inconnu' };
  const r = await pool.query(
    `SELECT m.id, m.employee_id, m.milestone_type, m.status, m.locked_at,
            m.eti_token_expires_at, m.renouvellement_form, m.renouvellement_avis,
            m.renouvellement_duree_mois, m.validations,
            e.first_name, e.last_name, e.position, e.contract_end
       FROM insertion_milestones m
       JOIN employees e ON e.id = m.employee_id
      WHERE m.eti_token = $1`,
    [String(token)]
  );
  if (r.rows.length === 0) return { etat: 'inconnu' };
  const row = r.rows[0];
  if (row.milestone_type !== 'renouvellement') return { etat: 'inconnu' };
  if (row.locked_at) return { etat: 'cloture', row };
  const exp = row.eti_token_expires_at ? new Date(row.eti_token_expires_at) : null;
  if (!exp || Number.isNaN(exp.getTime()) || exp <= new Date()) return { etat: 'expire', row };
  return { etat: 'ok', row };
}

/** Réponses 410 — deux situations distinctes, deux messages utiles. */
function refusPerime(res, etat) {
  if (etat === 'cloture') {
    return res.status(410).json({
      error: "Cet entretien de renouvellement est clôturé : votre avis a été enregistré ou l'entretien s'est tenu.",
      code: 'ENTRETIEN_CLOTURE',
    });
  }
  return res.status(410).json({
    error: 'Ce lien a expiré. Demandez un nouveau lien à la conseillère en insertion.',
    code: 'LIEN_EXPIRE',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/eti/renouvellement/:token
// ═══════════════════════════════════════════════════════════════════════════
router.get('/renouvellement/:token', async (req, res) => {
  try {
    const { etat, row } = await chargerParJeton(req.params.token);
    if (etat === 'inconnu') return inconnu(res);
    if (etat !== 'ok') return refusPerime(res, etat);

    let formulaire = row.renouvellement_form;
    if (typeof formulaire === 'string') { try { formulaire = JSON.parse(formulaire); } catch (_) { formulaire = null; } }

    res.json({
      prenom: row.first_name,
      nom: row.last_name,
      poste: row.position || null,
      contract_end: row.contract_end || null,
      // Les seules clés que cet écran écrit, et seulement si c'est l'encadrant
      // qui les a écrites (B-02) : la trame interne de la CIP ne s'affiche pas.
      formulaire: projeterFormulaire(formulaire),
      // L'avis n'est rendu que s'il vient de l'encadrant. Rendre celui de la
      // structure AVANT qu'il ait donné le sien fausse le recueil — et il dit,
      // à lui seul, ce que la CIP pense du renouvellement.
      avis: remplParEti(formulaire) ? (row.renouvellement_avis || null) : null,
      duree_mois: remplParEti(formulaire) && row.renouvellement_duree_mois != null
        ? Number(row.renouvellement_duree_mois) : null,
      expire_le: row.eti_token_expires_at,
      lecture_seule: false,
    });
  } catch (err) {
    console.error('[ETI] Erreur lecture par jeton :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/eti/renouvellement/:token
// ═══════════════════════════════════════════════════════════════════════════
router.put('/renouvellement/:token', async (req, res) => {
  try {
    const corps = req.body && typeof req.body === 'object' ? req.body : {};
    // La liste blanche est vérifiée AVANT toute lecture en base : un corps mal
    // formé n'a pas à consommer une requête, et la réponse ne doit rien
    // apprendre sur l'existence du jeton.
    const refuses = Object.keys(corps).filter((k) => !CHAMPS_FORMULAIRE.includes(k));
    if (refuses.length > 0) {
      return res.status(400).json({
        error: 'Champs refusés sur cette route (formulaire encadrant limité au bloc renouvellement).',
        champs_refuses: refuses,
        champs_acceptes: CHAMPS_FORMULAIRE,
      });
    }
    const present = CHAMPS_FORMULAIRE.filter((f) => f in corps);
    if (present.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    // Forme du formulaire vérifiée AVANT la lecture en base (M-02) : un corps
    // que la base n'a aucune raison d'accepter ne consomme pas une requête.
    if ('renouvellement_form' in corps && !formulaireValide(corps.renouvellement_form)) {
      return res.status(400).json({
        error: 'Formulaire invalide : réponses attendues, texte de 2 000 caractères au plus.',
        code: 'FORMULAIRE_INVALIDE',
        champs_acceptes: CLES_FORMULAIRE_ETI,
      });
    }

    if ('renouvellement_avis' in corps && corps.renouvellement_avis != null && corps.renouvellement_avis !== ''
      && !AVIS_VALIDES.includes(corps.renouvellement_avis)) {
      return res.status(400).json({ error: `renouvellement_avis invalide (${AVIS_VALIDES.join(', ')})` });
    }
    if ('renouvellement_duree_mois' in corps && corps.renouvellement_duree_mois != null && corps.renouvellement_duree_mois !== '') {
      const d = Number(corps.renouvellement_duree_mois);
      if (!Number.isInteger(d) || d < 1 || d > 24) {
        return res.status(400).json({ error: 'renouvellement_duree_mois invalide (1-24)' });
      }
    }

    const { etat, row } = await chargerParJeton(req.params.token);
    if (etat === 'inconnu') return inconnu(res);
    if (etat !== 'ok') return refusPerime(res, etat);

    const token = String(req.params.token);
    const prefixe = token.slice(0, 6);

    // Validation « eti » horodatée. `mode: 'jeton'` la distingue de la
    // signature d'un encadrant CONNECTÉ (`mode: 'compte'`) : sur une pièce qui
    // peut fonder un renouvellement de contrat, savoir par quelle porte l'avis
    // est entré n'est pas un détail d'exploitation.
    let validations = row.validations;
    if (typeof validations === 'string') { try { validations = JSON.parse(validations); } catch (_) { validations = null; } }
    if (!Array.isArray(validations)) validations = [];
    validations = validations.filter((v) => v && v.role !== 'eti');
    validations.push({ role: 'eti', mode: 'jeton', at: new Date().toISOString(), token_prefix: prefixe });

    // ═══ CORRECTIF M-09 — UNE ÉCRITURE ANONYME, UNE SEULE TRANSACTION ════
    //
    // Le snapshot d'historisation, l'UPDATE et le journal RGPD étaient trois
    // gestes indépendants dont deux avalaient leurs erreurs : une écriture sur
    // un dossier, faite SANS COMPTE, pouvait aboutir sans une seule ligne au
    // registre — et, sur un entretien déjà réalisé, sans l'état antérieur que
    // `insertion_milestones_history` est censé conserver. La doctrine réserve
    // le journal bloquant à ce qui « SORT » ; l'écriture anonyme est
    // précisément le cas où la trace est la seule chose qui reste. Le coût d'un
    // échec (l'encadrant renvoie son avis) est sans commune mesure avec celui
    // d'une écriture non tracée sur une pièce qui fonde un renouvellement.
    //
    // `pool.connect()` DANS le `try` (doctrine § 2.3, corrigée deux fois).
    const sets = [];
    const vals = [];
    for (const champ of present) {
      let v = corps[champ] === '' ? null : corps[champ];
      if (champ === 'renouvellement_form' && v != null) {
        // `rempli_par` est posé PAR LE SERVEUR : c'est lui qui décide ce que le
        // GET public rendra ensuite. Un client qui l'omettrait — ou qui
        // prétendrait autre chose — ne doit pas pouvoir faire passer sa
        // réponse pour la trame interne, ni l'inverse.
        v = JSON.stringify({ ...v, rempli_par: 'eti' });
      }
      vals.push(v);
      sets.push(`${champ} = $${vals.length}`);
    }
    vals.push(JSON.stringify(validations));
    sets.push(`validations = $${vals.length}`);
    vals.push(row.id);

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      if (row.status === 'realise') {
        // La MÊME fonction que les écrans authentifiés, jamais une seconde
        // copie du même INSERT (chargée à l'appel : le routeur public ne doit
        // pas dépendre du chargement du module authentifié au démarrage).
        const { snapshotMilestone } = require('./routes');
        if (typeof snapshotMilestone === 'function') {
          await snapshotMilestone(client, row, 'update', null);
        }
      }
      await client.query(
        `UPDATE insertion_milestones SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
        vals
      );
      // Journal RGPD BLOQUANT — `user_id` NULL (personne n'est connecté),
      // l'adresse IP et le PRÉFIXE du jeton disent d'où l'écriture vient.
      // Jamais le contenu de l'avis : la trace dit qu'un avis est entré, pas ce
      // qu'il juge.
      await ecrireJournal(client, { user: null }, 'INSERTION_ETI_FORMULAIRE_JETON', row.employee_id, {
        milestone_id: row.id, token_prefix: prefixe, ip: req.ip || null,
      }, 'insertion_eti');
      await client.query('COMMIT');
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      if (client) client.release();
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Valeur rejetée par une contrainte de la base' });
    console.error('[ETI] Erreur écriture par jeton :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Toute autre adresse sous /api/eti : 404 uniforme (aucune énumération).
router.all('*', (_req, res) => inconnu(res));

module.exports = router;
module.exports.TOKEN_RE = TOKEN_RE;
module.exports.CHAMPS_FORMULAIRE = CHAMPS_FORMULAIRE;
