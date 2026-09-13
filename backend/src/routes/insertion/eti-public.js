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
 * MANAGER connecté reçoit `maskInsertionRow`, un anonyme ne reçoit rien.
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
      formulaire: formulaire && typeof formulaire === 'object' ? formulaire : {},
      avis: row.renouvellement_avis || null,
      duree_mois: row.renouvellement_duree_mois == null ? null : Number(row.renouvellement_duree_mois),
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

    // Historisation d'une modification sur un entretien déjà réalisé (RES-02) —
    // la MÊME fonction que les écrans authentifiés, jamais une seconde copie du
    // même INSERT (chargée à l'appel : le routeur public ne doit pas dépendre
    // du chargement du module authentifié au démarrage).
    if (row.status === 'realise') {
      try {
        const { snapshotMilestone } = require('./routes');
        if (typeof snapshotMilestone === 'function') {
          await snapshotMilestone(pool, row, 'update', null);
        }
      } catch (e) {
        console.error('[ETI] Historisation impossible :', e.message);
      }
    }

    const sets = [];
    const vals = [];
    for (const champ of present) {
      let v = corps[champ] === '' ? null : corps[champ];
      if (champ === 'renouvellement_form' && v != null) v = JSON.stringify(v);
      vals.push(v);
      sets.push(`${champ} = $${vals.length}`);
    }
    vals.push(JSON.stringify(validations));
    sets.push(`validations = $${vals.length}`);
    vals.push(row.id);
    await pool.query(
      `UPDATE insertion_milestones SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
      vals
    );

    // Journal RGPD — `user_id` NULL (personne n'est connecté), l'adresse IP et
    // le préfixe du jeton disent d'où l'écriture vient. Jamais le contenu de
    // l'avis : la trace dit qu'un avis est entré, pas ce qu'il juge.
    try {
      await ecrireJournal(pool, { user: null }, 'INSERTION_ETI_FORMULAIRE_JETON', row.employee_id, {
        milestone_id: row.id, token_prefix: prefixe, ip: req.ip || null,
      }, 'insertion_eti');
    } catch (e) {
      console.error('[ETI] Journalisation impossible :', e.message);
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
