// ══════════════════════════════════════════════════════════════════════════
// REPRISE D'UNE TOURNÉE TERMINÉE — surface d'administration (demande client)
// ──────────────────────────────────────────────────────────────────────────
// « Rajouter la possibilité pour un administrateur de modifier les données
//   d'une tournée réalisée (volume déclaré et rajouter des pesées). »
//
// POURQUOI UNE SURFACE À PART, ET NON UNE EXCEPTION DANS « COLLECTE EN DIRECT »
// L'écran de pilotage (`live-edit.js`) refuse délibérément (409) dès que la
// tournée est terminée, et ce refus reste entier : il protège le gestionnaire
// d'une correction dont il ne verrait pas les conséquences. Car à la clôture,
// le poids a DÉJÀ été réparti en tonnage par point et transformé en entrée de
// stock — corriger après coup n'est pas remplir un champ, c'est reprendre une
// journée close.
//
// La reprise est donc un acte distinct :
//   • réservé à l'ADMINISTRATEUR ;
//   • borné aux tournées TERMINÉES (une tournée en cours se corrige sur
//     « Collecte en direct », une tournée annulée n'a rien à reprendre) ;
//   • HORODATÉ par l'opérateur — une pesée oubliée a eu lieu avant-hier à 16 h,
//     pas maintenant, et `NOW()` la rangerait au mauvais jour ;
//   • qui reconstruit systématiquement ce qui dérive du chiffre corrigé ;
//   • qui RECENSE l'écart d'entrée de stock sans y toucher (doctrine 2.35.0 :
//     une écriture de stock se régularise par une écriture datée depuis le
//     module Stock, jamais par une réécriture silencieuse de l'historique) ;
//   • et entièrement journalisé.
//
// La mécanique (reconstruction du tonnage, écart de stock, paliers de
// remplissage) vit dans `reprise-service.js`, partagée avec le script de
// reprise en ligne de commande : aucune des deux voies ne peut dériver.
//
// Endpoints (ADMIN) :
//   GET    /api/tours/:id/reprise
//   POST   /api/tours/:id/reprise/pesees
//   PUT    /api/tours/:id/reprise/pesees/:peseeId
//   DELETE /api/tours/:id/reprise/pesees/:peseeId
//   PATCH  /api/tours/:id/reprise/points/:kind/:pointId
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { lirePoidsKg, lireTotalPeseTournee } = require('./poids');
const { estAssociation } = require('./completion-effects');
const { nbSacsValide, niveauDepuisSacs, lireBornesSacs, MAX_SACS } = require('./sacs');
const {
  SQL_INSTANT_PARIS, SQL_LIRE_HEURE_PARIS, lireInstantParis,
  PALIERS_REMPLISSAGE, lirePalier, palierDepuisStockage,
  reconstruireTonnage, lireEcartStock,
} = require('./reprise-service');

/** Les deux familles de points, et la table qui les porte. Table FIGÉE. */
const TABLE_PAR_KIND = Object.freeze({
  cav: { table: 'tour_cav', ref: 'cav_id' },
  association: { table: 'tour_association_point', ref: 'association_point_id' },
});

/** Journal : toute reprise laisse une trace nominative et datée. */
function journaliserReprise(req, action, tourId, details) {
  pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [req.user?.id ?? null, action, 'tours', tourId, JSON.stringify(details || {})]
  ).catch((err) => console.error(`[TOURS] Journalisation ${action} impossible :`, err.message));
}

/** Marque laissée dans les notes d'une pesée reprise : qui, quand. */
function marqueReprise(req) {
  const qui = [req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ')
    || req.user?.username || 'un administrateur';
  return `Reprise après clôture par ${qui} le ${new Date().toISOString().slice(0, 10)}.`;
}

/**
 * Charge la tournée et refuse tôt tout ce qui ne relève pas d'une reprise.
 * Renvoie `null` après avoir répondu si la tournée ne convient pas.
 */
async function chargerTourneeReprise(tourId, res) {
  if (!Number.isInteger(tourId) || tourId <= 0) {
    res.status(400).json({ error: 'Identifiant de tournée invalide' });
    return null;
  }
  const r = await pool.query(
    `SELECT id, date, status, collection_type, is_demo,
            COALESCE(total_weight_kg, 0) AS total_weight_kg
       FROM tours WHERE id = $1`,
    [tourId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: 'Tournée non trouvée' });
    return null;
  }
  const tour = r.rows[0];
  if (tour.is_demo) {
    // Une tournée d'exercice ne produit ni tonnage, ni stock, ni apprentissage :
    // il n'y a rien à y reprendre, et une correction y ferait croire le contraire.
    res.status(409).json({
      error: 'Cette tournée est une démonstration de formation : elle ne produit '
        + 'aucun tonnage ni mouvement de stock, il n\'y a rien à y corriger.',
      code: 'TOURNEE_DEMO',
    });
    return null;
  }
  if (tour.status !== 'completed') {
    res.status(409).json({
      error: tour.status === 'cancelled'
        ? 'Cette tournée est annulée : elle n\'a produit aucune collecte à corriger.'
        : 'Cette tournée n\'est pas terminée. Ses pesées et ses points se corrigent '
          + 'depuis « Collecte en direct », tant que la journée est en cours.',
      code: 'TOURNEE_NON_TERMINEE',
      status: tour.status,
    });
    return null;
  }
  return tour;
}

/**
 * Ce qui suit TOUTE correction : le total pesé est recalculé par la règle
 * unique, le tonnage dérivé reconstruit, l'écart de stock recensé.
 *
 * Le tout dans la transaction de la correction : une reconstruction qui
 * échouerait à mi-chemin laisserait une répartition effacée sans remplaçante,
 * c'est-à-dire des kilos collectés qui auraient disparu de l'historique.
 */
async function reconstruireApresCorrection(client, tour, tourId) {
  const total = await client.query(
    'UPDATE tours SET total_weight_kg = (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) WHERE id = $1 RETURNING total_weight_kg',
    [tourId]
  );
  const totalKg = Number(total.rows[0]?.total_weight_kg) || 0;
  const tonnage = await reconstruireTonnage({ ...tour, status: 'completed' }, tourId, client);
  return { total_pese_kg: totalKg, tonnage };
}

/** Complète le bilan d'une correction par l'écart de stock (hors transaction). */
async function bilanAvecStock(tourId, effets) {
  return { ...effets, stock: await lireEcartStock(tourId, effets.total_pese_kg) };
}

// ── GET /api/tours/:id/reprise ─────────────────────────────────────────────
// L'état complet d'une tournée close, tel qu'il faut le voir pour décider
// d'une correction : ses pesées à l'heure de Paris, ses points collectés avec
// le volume déclaré et les kilos qui leur ont été attribués, et l'écart de
// stock qui restera à régulariser à la main.
router.get('/:id/reprise', authorize('ADMIN'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const tour = await chargerTourneeReprise(tourId, res);
  if (!tour) return;
  try {
    const association = estAssociation(tour);

    const pesees = await pool.query(
      `SELECT id, weight_kg, tare_kg, is_intermediate, notes, recorded_at,
              ${SQL_LIRE_HEURE_PARIS('recorded_at')} AS heure_paris
         FROM tour_weights WHERE tour_id = $1 ORDER BY recorded_at, id`,
      [tourId]
    );
    const totalPese = await lireTotalPeseTournee(pool, tourId);

    // Points de la tournée + kilos qui leur ont été attribués à la clôture.
    // Les deux historiques ne se rattachent pas de la même façon : celui des
    // associations porte l'identifiant de tournée, celui des bornes non — il se
    // retrouve par la date et le point, exactement comme la reconstruction.
    const points = association
      ? await pool.query(
        `SELECT tap.id, tap.association_point_id AS point_id, tap.position, tap.status,
                tap.fill_level, tap.nb_sacs, ap.name AS nom,
                (SELECT COALESCE(SUM(th.weight_kg), 0) FROM tonnage_history_association th
                  WHERE th.tour_id = tap.tour_id
                    AND th.association_point_id = tap.association_point_id) AS tonnage_kg
           FROM tour_association_point tap
           LEFT JOIN association_points ap ON ap.id = tap.association_point_id
          WHERE tap.tour_id = $1 ORDER BY tap.position, tap.id`,
        [tourId]
      )
      : await pool.query(
        `SELECT tc.id, tc.cav_id AS point_id, tc.position, tc.status,
                tc.fill_level, tc.fill_percent, c.name AS nom,
                (SELECT COALESCE(SUM(th.weight_kg), 0) FROM tonnage_history th
                  WHERE th.cav_id = tc.cav_id AND th.date = $2 AND th.source = 'mobile') AS tonnage_kg
           FROM tour_cav tc
           LEFT JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1 ORDER BY tc.position, tc.id`,
        [tourId, tour.date]
      );

    const bornesSacs = association ? await lireBornesSacs(pool) : null;

    res.json({
      tour: {
        id: tour.id,
        date: tour.date,
        statut: tour.status,
        collection_type: tour.collection_type,
        association,
      },
      pesees: pesees.rows,
      total_pese_kg: totalPese,
      // La colonne stockée est DÉRIVÉE : l'écran doit pouvoir dire qu'elle est
      // périmée plutôt que d'afficher un total que les lignes contredisent.
      total_stocke_kg: Number(tour.total_weight_kg) || 0,
      points: points.rows.map((p) => {
        const correspondance = association
          ? { palier: null, exact: false }
          : palierDepuisStockage(p.fill_level, p.fill_percent);
        return {
          kind: association ? 'association' : 'cav',
          id: p.id,
          point_id: p.point_id,
          position: p.position,
          nom: p.nom,
          status: p.status,
          fill_level: p.fill_level,
          fill_percent: association ? null : (p.fill_percent ?? null),
          palier: correspondance.palier ? correspondance.palier.code : null,
          palier_exact: correspondance.exact,
          nb_sacs: association ? (p.nb_sacs ?? null) : null,
          tonnage_kg: Math.round((Number(p.tonnage_kg) || 0) * 100) / 100,
        };
      }),
      // Le vocabulaire de la correction est celui du chauffeur : l'écran
      // propose les paliers qu'il a vus, jamais deux nombres à saisir.
      paliers: PALIERS_REMPLISSAGE,
      sacs: association ? { max: MAX_SACS, bornes: bornesSacs } : null,
      stock: await lireEcartStock(tourId, totalPese),
    });
  } catch (err) {
    console.error('[TOURS] Erreur lecture de reprise :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** Champs d'une pesée reprise. `{ error }` si la saisie ne tient pas. */
function lirePeseeReprise(body) {
  const poids = lirePoidsKg(body?.weight_kg, { champ: 'Le poids collecté' });
  if (poids.error) return { error: poids.error };
  const tare = lirePoidsKg(body?.tare_kg, { obligatoire: false, champ: 'La tare' });
  if (tare.error) return { error: tare.error };
  const instant = lireInstantParis(body?.recorded_at, { champ: 'La date et l\'heure de pesée' });
  if (instant.error) return { error: instant.error };
  return {
    valeurs: {
      weight_kg: poids.valeur,
      tare_kg: tare.valeur,
      is_intermediate: body?.is_intermediate === true || body?.is_intermediate === 'true',
      notes: body?.notes ? String(body.notes).trim().slice(0, 500) : null,
      instant: instant.valeur,
      jour: instant.jour,
    },
  };
}

// ── POST /api/tours/:id/reprise/pesees ─────────────────────────────────────
router.post('/:id/reprise/pesees', authorize('ADMIN'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const lu = lirePeseeReprise(req.body);
  if (lu.error) return res.status(400).json({ error: lu.error, code: 'PESEE_INVALIDE' });
  const tour = await chargerTourneeReprise(tourId, res);
  if (!tour) return;

  const jourTournee = (tour.date instanceof Date ? tour.date : new Date(tour.date))
    .toISOString().slice(0, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Idempotence : même tournée, même poids, même instant → déjà enregistrée.
    // Un double envoi ne doit jamais pouvoir doubler les kilos qu'il rattrape.
    const doublon = await client.query(
      `SELECT id FROM tour_weights
        WHERE tour_id = $2 AND weight_kg = $3 AND recorded_at = ${SQL_INSTANT_PARIS}`,
      [lu.valeurs.instant, tourId, lu.valeurs.weight_kg]
    );
    if (doublon.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cette pesée est déjà enregistrée (${lu.valeurs.weight_kg} kg le ${lu.valeurs.instant}).`,
        code: 'PESEE_DEJA_ENREGISTREE',
        pesee_id: doublon.rows[0].id,
      });
    }
    const ins = await client.query(
      `INSERT INTO tour_weights (tour_id, weight_kg, tare_kg, is_intermediate, notes, recorded_at)
       VALUES ($2, $3, $4, $5, $6, ${SQL_INSTANT_PARIS})
       RETURNING id, weight_kg, tare_kg, is_intermediate, notes, recorded_at,
                 ${SQL_LIRE_HEURE_PARIS('recorded_at')} AS heure_paris`,
      [lu.valeurs.instant, tourId, lu.valeurs.weight_kg, lu.valeurs.tare_kg,
        lu.valeurs.is_intermediate,
        [lu.valeurs.notes, marqueReprise(req)].filter(Boolean).join(' ').slice(0, 500)]
    );
    const effets = await reconstruireApresCorrection(client, tour, tourId);
    await client.query('COMMIT');

    journaliserReprise(req, 'TOURNEE_REPRISE_PESEE_AJOUTEE', tourId, {
      pesee_id: ins.rows[0].id, poids_kg: lu.valeurs.weight_kg,
      horodatage_paris: lu.valeurs.instant, intermediaire: lu.valeurs.is_intermediate,
      total_kg: effets.total_pese_kg,
    });
    res.status(201).json({
      ok: true,
      pesee: ins.rows[0],
      ...(await bilanAvecStock(tourId, effets)),
      // Contrôle de vraisemblance, jamais bloquant : une pesée se rattache à la
      // journée de la tournée. Un écart de date est presque toujours une erreur
      // de saisie — on le DIT, l'administrateur décide.
      avertissement: lu.valeurs.jour !== jourTournee
        ? `L'horodatage saisi (${lu.valeurs.jour}) ne tombe pas le jour de la tournée (${jourTournee}).`
        : null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur reprise — ajout de pesée :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── PUT /api/tours/:id/reprise/pesees/:peseeId ─────────────────────────────
router.put('/:id/reprise/pesees/:peseeId', authorize('ADMIN'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const peseeId = parseInt(req.params.peseeId, 10);
  if (!Number.isInteger(peseeId)) return res.status(400).json({ error: 'Identifiant de pesée invalide' });
  const lu = lirePeseeReprise(req.body);
  if (lu.error) return res.status(400).json({ error: lu.error, code: 'PESEE_INVALIDE' });
  const tour = await chargerTourneeReprise(tourId, res);
  if (!tour) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const avant = await client.query(
      'SELECT weight_kg, recorded_at FROM tour_weights WHERE id = $1 AND tour_id = $2 FOR UPDATE',
      [peseeId, tourId]
    );
    if (avant.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pesée non trouvée sur cette tournée' });
    }
    const maj = await client.query(
      `UPDATE tour_weights
          SET weight_kg = $3, tare_kg = $4, is_intermediate = $5, notes = $6,
              recorded_at = ${SQL_INSTANT_PARIS}
        WHERE id = $2 AND tour_id = $7
        RETURNING id, weight_kg, tare_kg, is_intermediate, notes, recorded_at,
                  ${SQL_LIRE_HEURE_PARIS('recorded_at')} AS heure_paris`,
      [lu.valeurs.instant, peseeId, lu.valeurs.weight_kg, lu.valeurs.tare_kg,
        lu.valeurs.is_intermediate,
        [lu.valeurs.notes, marqueReprise(req)].filter(Boolean).join(' ').slice(0, 500),
        tourId]
    );
    const effets = await reconstruireApresCorrection(client, tour, tourId);
    await client.query('COMMIT');

    journaliserReprise(req, 'TOURNEE_REPRISE_PESEE_MODIFIEE', tourId, {
      pesee_id: peseeId,
      poids_avant_kg: Number(avant.rows[0].weight_kg),
      poids_apres_kg: lu.valeurs.weight_kg,
      horodatage_paris: lu.valeurs.instant,
      total_kg: effets.total_pese_kg,
    });
    res.json({ ok: true, pesee: maj.rows[0], ...(await bilanAvecStock(tourId, effets)) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur reprise — correction de pesée :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/tours/:id/reprise/pesees/:peseeId ──────────────────────────
router.delete('/:id/reprise/pesees/:peseeId', authorize('ADMIN'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const peseeId = parseInt(req.params.peseeId, 10);
  if (!Number.isInteger(peseeId)) return res.status(400).json({ error: 'Identifiant de pesée invalide' });
  const tour = await chargerTourneeReprise(tourId, res);
  if (!tour) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sup = await client.query(
      'DELETE FROM tour_weights WHERE id = $1 AND tour_id = $2 RETURNING weight_kg, is_intermediate',
      [peseeId, tourId]
    );
    if (sup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pesée non trouvée sur cette tournée' });
    }
    const effets = await reconstruireApresCorrection(client, tour, tourId);
    await client.query('COMMIT');

    journaliserReprise(req, 'TOURNEE_REPRISE_PESEE_SUPPRIMEE', tourId, {
      pesee_id: peseeId, poids_kg: Number(sup.rows[0].weight_kg), total_kg: effets.total_pese_kg,
    });
    res.json({ ok: true, ...(await bilanAvecStock(tourId, effets)) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur reprise — suppression de pesée :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/tours/:id/reprise/points/:kind/:pointId ─────────────────────
// LE VOLUME DÉCLARÉ, corrigé après coup.
//
// Ce que « volume déclaré » recouvre, et pourquoi les deux familles diffèrent :
//   • BORNE : le chauffeur coche un PALIER (« un fond », « à moitié »…), dont
//     le mobile déduit deux colonnes — `fill_level` sur l'échelle 0-4 que lit
//     le moteur historique, et `fill_percent`, plus fidèle. La correction se
//     fait donc sur le palier, jamais sur deux nombres qui pourraient se
//     contredire (« niveau 4 » avec « 10 % » ne veut rien dire).
//   • ASSOCIATION : l'équipage déclare un NOMBRE DE SACS, et le niveau s'en
//     déduit par les bornes paramétrées (`sacs.niveauDepuisSacs`) — la même
//     fonction que le parcours chauffeur, jamais une seconde règle.
//
// Effet sur le tonnage, et il n'est pas le même des deux côtés :
//   • le nombre de sacs EST la clé de répartition du poids entre associations
//     (2.41.0) : le corriger redistribue les kilos, le tonnage est reconstruit ;
//   • le palier d'une borne, lui, n'entre PAS dans la répartition (le camion
//     est pesé au centre, le poids se partage à parts égales entre les bornes
//     collectées). Le tonnage n'est donc pas reconstruit — et la réponse le
//     DIT, plutôt que de laisser croire à un recalcul qui n'a pas eu lieu.
//
// Dans les deux cas, l'APPRENTISSAGE est corrigé sur la même observation : la
// ligne de feedback écrite à la clôture porte ce que le chauffeur avait
// déclaré ; la laisser telle quelle apprendrait au moteur une valeur qu'on
// vient justement de reconnaître fausse.
router.patch('/:id/reprise/points/:kind/:pointId', authorize('ADMIN'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const pointId = parseInt(req.params.pointId, 10);
  const kind = String(req.params.kind || '');
  if (!Number.isInteger(pointId)) return res.status(400).json({ error: 'Identifiant de point invalide' });
  if (!Object.prototype.hasOwnProperty.call(TABLE_PAR_KIND, kind)) {
    return res.status(400).json({ error: 'Type de point inconnu', code: 'KIND_INCONNU' });
  }
  const tour = await chargerTourneeReprise(tourId, res);
  if (!tour) return;

  const association = estAssociation(tour);
  if ((kind === 'association') !== association) {
    return res.status(400).json({
      error: association
        ? 'Cette tournée collecte des associations : ses points se corrigent en nombre de sacs.'
        : 'Cette tournée collecte des bornes : ses points se corrigent par palier de remplissage.',
      code: 'KIND_INADAPTE',
    });
  }

  // Lecture de la consigne AVANT toute écriture — jamais de valeur devinée.
  let valeurs;
  if (association) {
    const brut = req.body?.nb_sacs;
    if (brut === null || brut === undefined || brut === '') {
      // Effacer la déclaration est un choix légitime : « non déclaré » et
      // « zéro sac » ne se confondent jamais (CHECK de la 2.41.0).
      valeurs = { nb_sacs: null, fill_level: null };
    } else {
      const n = nbSacsValide(brut);
      if (n === null) {
        return res.status(400).json({
          error: `Le nombre de sacs doit être un entier entre 0 et ${MAX_SACS}.`,
          code: 'SACS_INVALIDE',
        });
      }
      valeurs = { nb_sacs: n, fill_level: niveauDepuisSacs(n, await lireBornesSacs(pool)) };
    }
  } else {
    const code = req.body?.palier;
    if (code === null || code === undefined || code === '') {
      valeurs = { fill_level: null, fill_percent: null };
    } else {
      const palier = lirePalier(code);
      if (!palier) {
        return res.status(400).json({
          error: 'Palier de remplissage inconnu.',
          code: 'PALIER_INCONNU',
          paliers: PALIERS_REMPLISSAGE.map((p) => p.code),
        });
      }
      valeurs = { fill_level: palier.fill_level, fill_percent: palier.fill_percent, palier: palier.code };
    }
  }

  const { table, ref } = TABLE_PAR_KIND[kind];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const avant = await client.query(
      `SELECT id, ${ref} AS point_id, status, fill_level${association ? ', nb_sacs' : ', fill_percent'}
         FROM ${table} WHERE id = $1 AND tour_id = $2 FOR UPDATE`,
      [pointId, tourId]
    );
    if (avant.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Point non trouvé sur cette tournée' });
    }
    const point = avant.rows[0];
    if (point.status !== 'collected') {
      await client.query('ROLLBACK');
      // Un point non collecté n'a pas de volume : lui en attribuer un
      // inscrirait dans l'historique une collecte qui n'a pas eu lieu.
      return res.status(409).json({
        error: `Ce point n'a pas été collecté (état « ${point.status} ») : il n'a pas de volume à corriger. `
          + 'Un point réellement collecté mais non déclaré se marque d\'abord comme collecté.',
        code: 'POINT_NON_COLLECTE',
        status: point.status,
      });
    }

    if (association) {
      await client.query(
        'UPDATE tour_association_point SET nb_sacs = $3, fill_level = $4 WHERE id = $1 AND tour_id = $2',
        [pointId, tourId, valeurs.nb_sacs, valeurs.fill_level]
      );
    } else {
      await client.query(
        'UPDATE tour_cav SET fill_level = $3, fill_percent = $4 WHERE id = $1 AND tour_id = $2',
        [pointId, tourId, valeurs.fill_level, valeurs.fill_percent]
      );
    }

    // Apprentissage : la même observation, corrigée. Best effort explicite —
    // une table de feedback absente ne doit pas faire échouer la correction du
    // volume, qui est la donnée métier ; l'échec est journalisé, jamais avalé.
    let apprentissage = 0;
    try {
      const fb = association
        ? await client.query(
          'UPDATE association_learning_feedback SET observed_fill_level = $3 WHERE tour_id = $1 AND association_point_id = $2',
          [tourId, point.point_id, valeurs.fill_level]
        )
        : await client.query(
          'UPDATE collection_learning_feedback SET observed_fill_level = $3, observed_fill_percent = $4 WHERE tour_id = $1 AND cav_id = $2',
          [tourId, point.point_id, valeurs.fill_level, valeurs.fill_percent]
        );
      apprentissage = fb.rowCount || 0;
    } catch (err) {
      console.warn(`[TOURS] Reprise #${tourId} : apprentissage non corrigé — ${err.message}`);
      apprentissage = null;
    }

    // Le tonnage ne se reconstruit que si la clé de répartition a bougé.
    const effets = association
      ? await reconstruireApresCorrection(client, tour, tourId)
      : {
        total_pese_kg: await lireTotalPeseTournee(client, tourId),
        tonnage: { reconstruit: false, motif: 'palier_sans_effet_sur_la_repartition' },
      };
    await client.query('COMMIT');

    journaliserReprise(req, 'TOURNEE_REPRISE_VOLUME_MODIFIE', tourId, {
      kind, point_ligne_id: pointId, point_id: point.point_id,
      avant: association
        ? { nb_sacs: point.nb_sacs ?? null, fill_level: point.fill_level ?? null }
        : { fill_level: point.fill_level ?? null, fill_percent: point.fill_percent ?? null },
      apres: valeurs,
      apprentissage_lignes: apprentissage,
    });
    res.json({
      ok: true,
      point: { id: pointId, kind, ...valeurs },
      apprentissage_lignes: apprentissage,
      ...(await bilanAvecStock(tourId, effets)),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur reprise — volume déclaré :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
// Exportés pour les tests : ce sont des RÈGLES (ce qui autorise une reprise,
// ce qu'une pesée reprise doit porter), vérifiables sans base.
module.exports.lirePeseeReprise = lirePeseeReprise;
module.exports.TABLE_PAR_KIND = TABLE_PAR_KIND;
