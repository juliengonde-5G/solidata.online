/**
 * Demandes de collecte des associations (rendez-vous) — RG-B du cahier des
 * charges du 26/08/2026.
 *
 * Une association demande un passage un jour donné, à une heure précise ou dans
 * un créneau. Le gestionnaire enregistre la demande (elles arrivent par
 * téléphone ou par mail — pas de portail association en v1), la planification
 * la rattache ensuite à un passage de tournée.
 *
 * LE STATUT N'EST JAMAIS STOCKÉ. Il est DÉRIVÉ en SQL des passages rattachés
 * (RG-B7) : stocker « planifiée » obligerait à le corriger à chaque suppression
 * de tournée, et la première désynchronisation ferait mentir l'écran.
 * `annulee_le` est le seul état posé à la main.
 *
 *   annulee_le renseigné .............................. annulee
 *   aucun passage rattaché ............................ a_planifier
 *   passage rattaché, tournée non close ............... planifiee
 *   tournée close, collecté dans la fenêtre effective .. honoree
 *   sinon (close hors fenêtre, sautée) ................ non_honoree
 *
 * Fenêtre effective = [heure_debut − tolérance ; (heure_fin ?? heure_debut) +
 * tolérance], la tolérance de la demande primant sur la tolérance par défaut
 * (arbitrage n° 4 : ±15 min).
 *
 * Lecture ET écriture : ADMIN / MANAGER.
 */
const express = require('express');

const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { autoLogActivity } = require('../middleware/activity-logger');
const { TOLERANCE_RDV_DEFAUT_MIN, minutesDepuisHHMM, jourDeDate } = require('../services/association-horaires');

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('association-demandes'));

const STATUTS = ['a_planifier', 'planifiee', 'honoree', 'non_honoree', 'annulee'];
// Statuts figés : la demande a été soldée par une tournée close, on ne réécrit
// plus ses termes (on garderait sinon la trace d'un rendez-vous qui n'a jamais
// été celui qui a été honoré).
const STATUTS_FIGES = ['honoree', 'non_honoree'];

// ══════════════════════════════════════════
// Requête commune — le statut dérivé vit ICI et nulle part ailleurs
// ══════════════════════════════════════════

/**
 * Construit la requête de lecture des demandes, statut dérivé compris.
 * @param {{ids?: number[], du?: string, au?: string, statut?: string, association_point_id?: number}} filtres
 * @returns {{text: string, values: any[]}}
 */
function construireRequete(filtres = {}) {
  // $1 : tolérance par défaut, appliquée aux seules demandes qui n'en portent
  // pas. Paramètre et non littéral : la valeur reste unique et modifiable.
  const values = [TOLERANCE_RDV_DEFAUT_MIN];
  const where = [];

  if (Array.isArray(filtres.ids) && filtres.ids.length > 0) {
    values.push(filtres.ids);
    where.push(`d.id = ANY($${values.length}::int[])`);
  }
  if (filtres.du) { values.push(filtres.du); where.push(`d.date_souhaitee >= $${values.length}::date`); }
  if (filtres.au) { values.push(filtres.au); where.push(`d.date_souhaitee <= $${values.length}::date`); }
  if (filtres.association_point_id) {
    values.push(filtres.association_point_id);
    where.push(`d.association_point_id = $${values.length}::int`);
  }

  let statutFiltre = '';
  if (filtres.statut) {
    values.push(filtres.statut);
    statutFiltre = ` WHERE q.statut = $${values.length}`;
  }

  const text = `
    WITH base AS (
      SELECT d.id, d.association_point_id, ap.name AS association_nom,
             TO_CHAR(d.date_souhaitee, 'YYYY-MM-DD') AS date_souhaitee,
             d.heure_debut, d.heure_fin, d.tolerance_min, d.commentaire,
             d.annulee_le, d.created_at,
             -- Fenêtre effective, bornes comprises. La tolérance de la demande
             -- prime ; à défaut seulement, la tolérance par défaut s'applique.
             (d.date_souhaitee + d.heure_debut)
               - make_interval(mins => COALESCE(d.tolerance_min, $1::int)) AS fenetre_debut,
             (d.date_souhaitee + COALESCE(d.heure_fin, d.heure_debut))
               + make_interval(mins => COALESCE(d.tolerance_min, $1::int)) AS fenetre_fin
      FROM association_collecte_demandes d
      JOIN association_points ap ON ap.id = d.association_point_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ),
    q AS (
      SELECT b.id, b.association_point_id, b.association_nom, b.date_souhaitee,
             b.heure_debut, b.heure_fin, b.tolerance_min, b.commentaire,
             b.annulee_le, b.created_at, p.tour_id,
             CASE
               WHEN b.annulee_le IS NOT NULL THEN 'annulee'
               WHEN p.tour_id IS NULL THEN 'a_planifier'
               WHEN p.tournee_ouverte THEN 'planifiee'
               WHEN p.dans_fenetre THEN 'honoree'
               ELSE 'non_honoree'
             END AS statut
      FROM base b
      -- Un seul passage retenu quand plusieurs sont rattachés : la tournée
      -- encore ouverte d'abord (la demande est alors « planifiée »), puis le
      -- passage qui a honoré le rendez-vous, puis le plus récent.
      LEFT JOIN LATERAL (
        SELECT tap.tour_id,
               (t.status <> 'completed') AS tournee_ouverte,
               (tap.collected_at IS NOT NULL
                 AND tap.collected_at >= b.fenetre_debut
                 AND tap.collected_at <= b.fenetre_fin) AS dans_fenetre
        FROM tour_association_point tap
        JOIN tours t ON t.id = tap.tour_id
        WHERE tap.demande_id = b.id
        ORDER BY (t.status <> 'completed') DESC,
                 (tap.collected_at IS NOT NULL
                   AND tap.collected_at >= b.fenetre_debut
                   AND tap.collected_at <= b.fenetre_fin) DESC,
                 tap.id DESC
        LIMIT 1
      ) p ON TRUE
    )
    SELECT q.* FROM q${statutFiltre}
    ORDER BY q.date_souhaitee, q.heure_debut, q.id`;

  return { text, values };
}

/** Recharge une demande (statut dérivé compris) après écriture. */
async function chargerDemande(id) {
  const { text, values } = construireRequete({ ids: [id] });
  const r = await pool.query(text, values);
  return r.rows[0] || null;
}

// ══════════════════════════════════════════
// Validation de la saisie — aucune valeur devinée
// ══════════════════════════════════════════

/**
 * Lit et valide le corps d'une demande.
 * @param {object} corps
 * @param {boolean} partiel  true en modification : seules les clés présentes
 *                           sont lues (un PUT partiel ne remet rien à zéro).
 * @returns {{ok: true, champs: object} | {ok: false, erreurs: string[]}}
 */
function lireCorps(corps, partiel) {
  const erreurs = [];
  const champs = {};
  const present = (k) => Object.prototype.hasOwnProperty.call(corps || {}, k);
  const requis = (k) => (partiel ? present(k) : true);

  if (requis('association_point_id')) {
    const n = Number(corps.association_point_id);
    if (!Number.isInteger(n) || n <= 0) erreurs.push('association_point_id : identifiant de point association attendu.');
    else champs.association_point_id = n;
  }
  if (requis('date_souhaitee')) {
    // jourDeDate rejette aussi les dates qui n'existent pas au calendrier.
    if (typeof corps.date_souhaitee !== 'string' || !jourDeDate(corps.date_souhaitee)) {
      erreurs.push('date_souhaitee : date au format AAAA-MM-JJ attendue.');
    } else {
      champs.date_souhaitee = corps.date_souhaitee.trim().slice(0, 10);
    }
  }
  if (requis('heure_debut')) {
    if (minutesDepuisHHMM(corps.heure_debut) === null) erreurs.push('heure_debut : heure au format HH:MM attendue.');
    else champs.heure_debut = corps.heure_debut.trim();
  }
  if (present('heure_fin')) {
    if (corps.heure_fin === null || corps.heure_fin === '') {
      // Pas de fin = rendez-vous à heure exacte (la tolérance fait la fenêtre).
      champs.heure_fin = null;
    } else if (minutesDepuisHHMM(corps.heure_fin) === null) {
      erreurs.push('heure_fin : heure au format HH:MM attendue (ou vide pour un rendez-vous à heure exacte).');
    } else {
      champs.heure_fin = corps.heure_fin.trim();
    }
  }
  if (present('tolerance_min')) {
    if (corps.tolerance_min === null || corps.tolerance_min === '') {
      // Non renseignée : la tolérance par défaut s'appliquera à la lecture.
      champs.tolerance_min = null;
    } else {
      const n = Number(corps.tolerance_min);
      if (!Number.isInteger(n) || n < 0 || n > 240) erreurs.push('tolerance_min : entier de 0 à 240 minutes attendu (ou vide).');
      else champs.tolerance_min = n;
    }
  }
  if (present('commentaire')) {
    champs.commentaire = (corps.commentaire === null || corps.commentaire === '') ? null : String(corps.commentaire);
  }

  // Cohérence du créneau, une fois les deux heures lues.
  const dm = champs.heure_debut !== undefined ? minutesDepuisHHMM(champs.heure_debut) : null;
  const fm = champs.heure_fin ? minutesDepuisHHMM(champs.heure_fin) : null;
  if (dm !== null && fm !== null && fm < dm) {
    erreurs.push('La fin du créneau doit être après son début.');
  }

  return erreurs.length > 0 ? { ok: false, erreurs } : { ok: true, champs };
}

/** Traduction du doublon PostgreSQL (contrainte d'unicité) en refus lisible. */
function estDoublon(err) {
  return err && err.code === '23505';
}

// ══════════════════════════════════════════
// GET /api/association-demandes — liste filtrée
// ══════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const { du, au, statut, association_point_id } = req.query;
    if (statut && !STATUTS.includes(statut)) {
      return res.status(400).json({ error: `statut inconnu : ${statut}`, statuts: STATUTS });
    }
    for (const [cle, valeur] of [['du', du], ['au', au]]) {
      if (valeur && !jourDeDate(valeur)) {
        return res.status(400).json({ error: `${cle} : date au format AAAA-MM-JJ attendue.` });
      }
    }
    let pointId = null;
    if (association_point_id) {
      pointId = Number(association_point_id);
      if (!Number.isInteger(pointId) || pointId <= 0) {
        return res.status(400).json({ error: 'association_point_id : identifiant attendu.' });
      }
    }

    const { text, values } = construireRequete({ du, au, statut, association_point_id: pointId });
    const r = await pool.query(text, values);
    res.json(r.rows);
  } catch (err) {
    console.error('[ASSO-DEMANDES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// POST /api/association-demandes — enregistrer une demande
// ══════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const lu = lireCorps(req.body || {}, false);
    if (!lu.ok) return res.status(400).json({ error: 'Demande invalide', code: 'DEMANDE_INVALIDE', erreurs: lu.erreurs });
    const c = lu.champs;

    const point = await pool.query('SELECT id FROM association_points WHERE id = $1', [c.association_point_id]);
    if (point.rows.length === 0) return res.status(404).json({ error: 'Point association introuvable' });

    const inserted = await pool.query(
      `INSERT INTO association_collecte_demandes
         (association_point_id, date_souhaitee, heure_debut, heure_fin, tolerance_min, commentaire, created_by)
       VALUES ($1, $2::date, $3::time, $4::time, $5, $6, $7) RETURNING id`,
      [c.association_point_id, c.date_souhaitee, c.heure_debut,
        c.heure_fin === undefined ? null : c.heure_fin,
        c.tolerance_min === undefined ? null : c.tolerance_min,
        c.commentaire === undefined ? null : c.commentaire,
        req.user.id]
    );
    res.status(201).json(await chargerDemande(inserted.rows[0].id));
  } catch (err) {
    if (estDoublon(err)) {
      return res.status(409).json({
        error: 'Une demande existe déjà pour cette association à cette date.',
        code: 'DEMANDE_DOUBLON',
      });
    }
    console.error('[ASSO-DEMANDES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// PUT /api/association-demandes/:id — modifier une demande
// ══════════════════════════════════════════
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide' });

    const actuelle = await chargerDemande(id);
    if (!actuelle) return res.status(404).json({ error: 'Demande introuvable' });
    if (STATUTS_FIGES.includes(actuelle.statut)) {
      return res.status(409).json({
        error: 'Cette demande a été soldée par une tournée close : elle ne peut plus être modifiée.',
        code: 'DEMANDE_CLOTUREE',
        statut: actuelle.statut,
      });
    }

    const lu = lireCorps(req.body || {}, true);
    if (!lu.ok) return res.status(400).json({ error: 'Demande invalide', code: 'DEMANDE_INVALIDE', erreurs: lu.erreurs });
    const c = lu.champs;

    // Contrôle de cohérence du créneau contre les valeurs CONSERVÉES quand la
    // modification ne porte que sur l'une des deux heures.
    const debutFinal = c.heure_debut !== undefined ? c.heure_debut : actuelle.heure_debut;
    const finFinale = c.heure_fin !== undefined ? c.heure_fin : actuelle.heure_fin;
    const dm = minutesDepuisHHMM(debutFinal);
    const fm = finFinale ? minutesDepuisHHMM(finFinale) : null;
    if (dm !== null && fm !== null && fm < dm) {
      return res.status(400).json({
        error: 'Demande invalide', code: 'DEMANDE_INVALIDE',
        erreurs: ['La fin du créneau doit être après son début.'],
      });
    }

    if (c.association_point_id !== undefined) {
      const point = await pool.query('SELECT id FROM association_points WHERE id = $1', [c.association_point_id]);
      if (point.rows.length === 0) return res.status(404).json({ error: 'Point association introuvable' });
    }

    const sets = [];
    const values = [];
    const poser = (colonne, valeur, cast = '') => {
      values.push(valeur);
      sets.push(`${colonne} = $${values.length}${cast}`);
    };
    if (c.association_point_id !== undefined) poser('association_point_id', c.association_point_id);
    if (c.date_souhaitee !== undefined) poser('date_souhaitee', c.date_souhaitee, '::date');
    if (c.heure_debut !== undefined) poser('heure_debut', c.heure_debut, '::time');
    if (c.heure_fin !== undefined) poser('heure_fin', c.heure_fin, '::time');
    if (c.tolerance_min !== undefined) poser('tolerance_min', c.tolerance_min);
    if (c.commentaire !== undefined) poser('commentaire', c.commentaire);
    if (sets.length === 0) return res.json(actuelle); // rien à modifier : la demande est renvoyée telle quelle

    sets.push('updated_at = NOW()');
    values.push(id);
    await pool.query(
      `UPDATE association_collecte_demandes SET ${sets.join(', ')} WHERE id = $${values.length}`,
      values
    );
    res.json(await chargerDemande(id));
  } catch (err) {
    if (estDoublon(err)) {
      return res.status(409).json({
        error: 'Une demande existe déjà pour cette association à cette date.',
        code: 'DEMANDE_DOUBLON',
      });
    }
    console.error('[ASSO-DEMANDES] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// POST /api/association-demandes/:id/annuler — seul état posé à la main
// ══════════════════════════════════════════
router.post('/:id/annuler', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide' });

    const actuelle = await chargerDemande(id);
    if (!actuelle) return res.status(404).json({ error: 'Demande introuvable' });
    // Annulation idempotente : une demande déjà annulée garde sa date
    // d'annulation d'origine (on ne réécrit pas l'histoire).
    if (actuelle.statut === 'annulee') return res.json(actuelle);

    const motif = typeof req.body?.motif === 'string' ? req.body.motif.trim() : '';
    // La table ne porte pas de colonne de motif (schéma figé par le contrat) :
    // le motif est journalisé dans le commentaire, préfixé pour rester lisible.
    await pool.query(
      `UPDATE association_collecte_demandes
       SET annulee_le = NOW(),
           commentaire = CASE WHEN $2::text <> '' THEN
             CASE WHEN commentaire IS NULL OR commentaire = '' THEN $2::text
                  ELSE commentaire || E'\\n' || $2::text END
             ELSE commentaire END,
           updated_at = NOW()
       WHERE id = $1`,
      [id, motif ? `Annulation : ${motif}` : '']
    );
    res.json(await chargerDemande(id));
  } catch (err) {
    console.error('[ASSO-DEMANDES] Erreur annulation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
