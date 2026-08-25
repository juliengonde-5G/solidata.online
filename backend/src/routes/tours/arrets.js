// ══════════════════════════════════════════════════════════════
// ARRÊTS DE PROGRAMME — le retour au centre de tri est une ÉTAPE
// ──────────────────────────────────────────────────────────────
// Constat client (08/2026) : quand l'équipage déclarait « camion plein, retour
// au centre », l'application ouvrait DIRECTEMENT la page de pesée. Le trajet de
// retour — souvent le plus long de la journée — n'existait nulle part : pas
// d'étape à l'écran, pas d'itinéraire, pas une minute ni un kilomètre comptés.
//
// Un retour au centre est un déplacement réel. Il devient donc un arrêt du
// programme, au même titre qu'une borne : le chauffeur le voit, le suit, et
// déclare son arrivée — c'est seulement à ce moment que la pesée s'ouvre.
//
// Trois motifs distincts partagent le même lieu, d'où la colonne `motif` :
//   • vidage         — camion plein en cours de tournée, pesée intermédiaire ;
//   • pause_dejeuner — retour quotidien entre 12h et 13h ;
//   • fin_tournee    — dernier retour, pesée finale puis clôture.
//
// Ce module est la SOURCE UNIQUE de ces notions : le libellé montré au chauffeur,
// la position d'insertion, et le lieu du centre de tri. Les routes mobiles, la
// création de tournée et l'édition en direct s'appuient toutes dessus.
// ══════════════════════════════════════════════════════════════

const pool = require('../../config/database');

/** Motifs d'arrêt. `technique` = arrêt libre posé par le gestionnaire. */
const MOTIFS = ['technique', 'depart_centre', 'vidage', 'pause_dejeuner', 'fin_tournee'];

/** Les trois motifs qui ramènent au centre de tri. */
const MOTIFS_CENTRE = ['depart_centre', 'vidage', 'pause_dejeuner', 'fin_tournee'];

/**
 * Libellés destinés au CHAUFFEUR : phrases courtes, sans jargon, qui disent ce
 * qu'il y a à faire (doctrine FALC du parcours mobile).
 */
const LIBELLE_MOTIF = {
  depart_centre: 'Départ du centre de tri',
  vidage: 'Retour au centre — camion plein',
  pause_dejeuner: 'Pause déjeuner au centre',
  fin_tournee: 'Retour au centre — fin de tournée',
};

/** Ce qui attend le chauffeur une fois l'arrivée déclarée. */
const SUITE_MOTIF = {
  depart_centre: 'reprise_tournee',
  vidage: 'pesee_intermediaire',
  pause_dejeuner: 'reprise_tournee',
  fin_tournee: 'pesee_finale',
};

/**
 * Coordonnées de repli du centre de tri. Le lieu en base fait foi ; ces valeurs
 * ne servent que si le référentiel n'a pas encore été semé (base ancienne).
 */
const CENTRE_FALLBACK = {
  nom: 'Centre de tri',
  latitude: parseFloat(process.env.CENTRE_TRI_LAT) || 49.4231,
  longitude: parseFloat(process.env.CENTRE_TRI_LNG) || 1.0993,
  duree_min: 20,
};

/**
 * Le lieu « centre de tri » du référentiel. Renvoie toujours un objet
 * exploitable : si le référentiel est vide, on retombe sur les coordonnées
 * d'environnement plutôt que d'empêcher un retour au centre — mais `id` vaut
 * alors `null`, et l'arrêt n'est rattaché à aucun lieu.
 */
async function centreDeTri(db = pool) {
  try {
    const r = await db.query(
      `SELECT id, nom, adresse, latitude, longitude, duree_min
         FROM lieux_techniques
        WHERE categorie = 'centre_tri' AND is_active = true
        ORDER BY id LIMIT 1`
    );
    if (r.rows.length > 0) return r.rows[0];
  } catch (err) {
    // Base non migrée : on dégrade, on ne casse pas le parcours chauffeur.
    console.warn('[TOURS] Lieu « centre de tri » illisible :', err.message);
  }
  return { id: null, adresse: null, ...CENTRE_FALLBACK };
}

/** Prochaine position libre du programme (CAV et arrêts partagent l'échelle). */
async function positionSuivante(db, tourId) {
  const r = await db.query(
    `SELECT COALESCE(MAX(p), 0) + 1 AS suivante FROM (
       SELECT MAX(position) AS p FROM tour_cav WHERE tour_id = $1
       UNION ALL
       SELECT MAX(position) AS p FROM tour_arret_technique WHERE tour_id = $1
     ) x`,
    [tourId]
  );
  return parseInt(r.rows[0].suivante, 10) || 1;
}

/**
 * Position à laquelle intercaler un arrêt pour qu'il vienne JUSTE APRÈS le
 * dernier point déjà traité — c'est-à-dire immédiatement devant le chauffeur,
 * sans réécrire ce qu'il a déjà fait ni sauter ce qui lui reste.
 *
 * Les positions restantes sont décalées d'un cran. Renvoie la position occupée.
 */
async function insererApresDernierPointTraite(client, tourId) {
  const r = await client.query(
    `SELECT COALESCE(MAX(position), 0) AS derniere FROM (
       SELECT position FROM tour_cav
        WHERE tour_id = $1 AND status IN ('collected', 'skipped', 'incident')
       UNION ALL
       SELECT position FROM tour_arret_technique
        WHERE tour_id = $1 AND status IN ('done', 'skipped')
     ) x`,
    [tourId]
  );
  const position = (parseInt(r.rows[0].derniere, 10) || 0) + 1;
  // Décalage des points encore à venir : le retour s'insère devant eux.
  await client.query(
    'UPDATE tour_cav SET position = position + 1 WHERE tour_id = $1 AND position >= $2',
    [tourId, position]
  );
  await client.query(
    'UPDATE tour_arret_technique SET position = position + 1 WHERE tour_id = $1 AND position >= $2',
    [tourId, position]
  );
  return position;
}

/**
 * Un arrêt du même motif est-il DÉJÀ en attente sur cette tournée ? Garde
 * d'idempotence : un double appui sur « camion plein » ne doit pas empiler deux
 * retours, et la pause du jour ne doit être posée qu'une fois.
 */
async function arretEnAttente(db, tourId, motif) {
  const r = await db.query(
    `SELECT id, position FROM tour_arret_technique
      WHERE tour_id = $1 AND motif = $2 AND status = 'pending'
      ORDER BY position LIMIT 1`,
    [tourId, motif]
  );
  return r.rows[0] || null;
}

/**
 * Crée un arrêt « retour au centre » sur une tournée.
 * @returns {Promise<{id:number, position:number, deja_present:boolean}>}
 */
async function creerRetourCentre(client, { tourId, motif, centre, enFin = false }) {
  if (!MOTIFS_CENTRE.includes(motif)) {
    throw new Error(`Motif de retour au centre inconnu : ${motif}`);
  }
  const existant = await arretEnAttente(client, tourId, motif);
  if (existant) return { ...existant, deja_present: true };

  const lieu = centre || (await centreDeTri(client));
  const position = enFin
    ? await positionSuivante(client, tourId)
    : await insererApresDernierPointTraite(client, tourId);

  const r = await client.query(
    `INSERT INTO tour_arret_technique (tour_id, lieu_id, libelle, position, motif, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id, position`,
    [tourId, lieu.id, LIBELLE_MOTIF[motif], position, motif]
  );
  return { ...r.rows[0], deja_present: false };
}

/**
 * Amène un retour au centre JUSTE DEVANT le chauffeur — qu'il faille le créer
 * ou déplacer celui qui était déjà prévu plus loin dans la journée.
 *
 * C'est le geste du chauffeur qui déclare « je rentre maintenant ». Sans ce
 * déplacement, le retour de fin de tournée posé automatiquement en queue de
 * programme resterait derrière les bornes non collectées : l'appui sur « Fin »
 * n'afficherait rien, puisque l'étape courante est toujours le point le plus
 * proche devant le chauffeur.
 *
 * @returns {Promise<{id:number, position:number, deja_present:boolean}>}
 */
async function avancerRetourCentre(client, { tourId, motif, centre }) {
  const existant = await arretEnAttente(client, tourId, motif);
  if (!existant) {
    const cree = await creerRetourCentre(client, { tourId, motif, centre, enFin: false });
    await abandonnerArretsRestants(client, tourId, motif, cree.id);
    return cree;
  }

  // On sort d'abord l'arrêt de la file (position sentinelle), on referme le
  // trou, puis on l'insère à sa nouvelle place. Faire l'inverse décalerait
  // l'arrêt lui-même et le rendrait introuvable.
  await client.query(
    'UPDATE tour_arret_technique SET position = -1 WHERE id = $1', [existant.id]
  );
  await client.query(
    'UPDATE tour_cav SET position = position - 1 WHERE tour_id = $1 AND position > $2',
    [tourId, existant.position]
  );
  await client.query(
    'UPDATE tour_arret_technique SET position = position - 1 WHERE tour_id = $1 AND position > $2 AND id <> $3',
    [tourId, existant.position, existant.id]
  );

  const position = await insererApresDernierPointTraite(client, tourId);
  await client.query(
    'UPDATE tour_arret_technique SET position = $2 WHERE id = $1', [existant.id, position]
  );
  await abandonnerArretsRestants(client, tourId, motif, existant.id);
  return { id: existant.id, position, deja_present: true };
}

/**
 * Quand l'équipage déclare la FIN de sa tournée, les arrêts encore prévus plus
 * loin dans la journée n'auront pas lieu : ils sont marqués « non effectués ».
 *
 * Sans cela, la pause du midi restée en attente derrière le retour de fin
 * deviendrait l'étape courante du mobile juste après la pesée finale — on
 * proposerait un déjeuner à une équipe qui rentre. Constaté en vérification sur
 * base réelle, pas déduit.
 *
 * Les points de collecte, eux, ne sont PAS touchés : leur statut « pending »
 * est la trace de ce qui n'a pas été collecté, et cette trace a de la valeur.
 */
async function abandonnerArretsRestants(client, tourId, motif, sauf) {
  if (motif !== 'fin_tournee') return;
  await client.query(
    `UPDATE tour_arret_technique
        SET status = 'skipped'
      WHERE tour_id = $1 AND status = 'pending' AND id <> $2`,
    [tourId, sauf]
  );
}

/**
 * Pose la PAUSE DÉJEUNER au centre de tri (demande client : un retour au centre
 * chaque jour entre 12 h et 13 h, sur toutes les tournées).
 *
 * Le moteur de temps décide DÉJÀ de cette pause et la place dans sa chronologie
 * — c'est lui qui connaît l'heure de départ, le temps de travail cumulé et les
 * trajets. On ne la recalcule donc pas : on PROJETTE sa décision dans le
 * programme visible. La compter deux fois — une fois dans le moteur, une fois
 * comme point supplémentaire — gonflerait la durée estimée d'un trajet fictif.
 *
 * Le moteur ne juge pas la pause due (tournée courte finissant avant midi) ?
 * Aucun arrêt n'est posé, et c'est le bon comportement : on n'impose pas un
 * retour au centre à une équipe déjà rentrée.
 *
 * @returns {Promise<{id:number, position:number}|null>}
 */
async function poserPauseDejeuner(client, tourId, estimation, centre) {
  const timeline = (estimation && Array.isArray(estimation.timeline)) ? estimation.timeline : [];
  const index = timeline.findIndex((e) => e && e.type === 'pause_dejeuner');
  if (index < 0) return null;

  const existant = await arretEnAttente(client, tourId, 'pause_dejeuner');
  if (existant) return existant;

  // La pause se glisse après les points déjà traversés dans la chronologie.
  const nbPointsAvant = timeline.slice(0, index).filter((e) => e && e.type === 'point').length;
  const position = nbPointsAvant + 1;

  await client.query(
    'UPDATE tour_cav SET position = position + 1 WHERE tour_id = $1 AND position >= $2',
    [tourId, position]
  );
  await client.query(
    'UPDATE tour_arret_technique SET position = position + 1 WHERE tour_id = $1 AND position >= $2',
    [tourId, position]
  );

  const lieu = centre || (await centreDeTri(client));
  const r = await client.query(
    `INSERT INTO tour_arret_technique (tour_id, lieu_id, libelle, position, motif, status)
     VALUES ($1, $2, $3, $4, 'pause_dejeuner', 'pending')
     RETURNING id, position`,
    [tourId, lieu.id, LIBELLE_MOTIF.pause_dejeuner, position]
  );
  return r.rows[0];
}

/**
 * Pose les TROIS passages au centre de tri d'une journée type (demande client) :
 * le départ du matin, la pause du midi, et le retour de fin de tournée. Le
 * programme raconte alors la journée entière, et non les seules bornes.
 *
 * L'ordre des opérations n'est pas indifférent : chaque insertion décale les
 * positions suivantes. On pose donc la fin d'abord (en queue), puis la pause
 * (qui décale la fin), puis le départ (qui décale tout le reste). Calculer les
 * trois positions d'avance sur l'état initial les rendrait toutes fausses dès
 * la première écriture.
 *
 * @returns {Promise<{depart:object|null, pause:object|null, fin:object|null}>}
 */
async function poserRetoursAutomatiques(client, tourId, estimation, centre) {
  const lieu = centre || (await centreDeTri(client));

  // 1. Fin de tournée, en queue de programme.
  const fin = await creerRetourCentre(client, {
    tourId, motif: 'fin_tournee', centre: lieu, enFin: true,
  });

  // 2. Pause du midi, à la place que le moteur lui a donnée dans sa chronologie.
  const pause = await poserPauseDejeuner(client, tourId, estimation, lieu);

  // 3. Départ du matin, en tête. Il est marqué « fait » au démarrage de la
  //    tournée : le chauffeur EST au centre à ce moment-là, lui demander de
  //    déclarer son arrivée à son propre point de départ n'aurait aucun sens.
  const existantDepart = await arretEnAttente(client, tourId, 'depart_centre');
  let depart = existantDepart;
  if (!existantDepart) {
    await client.query(
      'UPDATE tour_cav SET position = position + 1 WHERE tour_id = $1', [tourId]
    );
    await client.query(
      'UPDATE tour_arret_technique SET position = position + 1 WHERE tour_id = $1', [tourId]
    );
    const r = await client.query(
      `INSERT INTO tour_arret_technique (tour_id, lieu_id, libelle, position, motif, status)
       VALUES ($1, $2, $3, 1, 'depart_centre', 'pending')
       RETURNING id, position`,
      [tourId, lieu.id, LIBELLE_MOTIF.depart_centre]
    );
    depart = r.rows[0];
  }

  return { depart, pause, fin };
}

/**
 * Marque le départ du centre comme fait. Appelé au démarrage de la tournée :
 * l'équipage est au centre, il n'a rien à déclarer de plus.
 */
async function cloturerDepartCentre(db, tourId) {
  try {
    await db.query(
      `UPDATE tour_arret_technique
          SET status = 'done', arrived_at = COALESCE(arrived_at, NOW()), completed_at = NOW()
        WHERE tour_id = $1 AND motif = 'depart_centre' AND status = 'pending'`,
      [tourId]
    );
  } catch (err) {
    console.warn(`[TOURS] Départ du centre non clôturé (tournée ${tourId}) :`, err.message);
  }
}

/**
 * Enveloppe « best effort » de la pose de pause à la création d'une tournée :
 * une pause qui ne s'inscrit pas ne doit JAMAIS faire échouer la création de la
 * tournée elle-même — mais l'échec est journalisé, jamais avalé en silence.
 */
async function poserPauseDejeunerSansBloquer(db, tourId, estimation) {
  try {
    return await poserRetoursAutomatiques(db, tourId, estimation, null);
  } catch (err) {
    console.warn(`[TOURS] Passages au centre non posés sur la tournée ${tourId} :`, err.message);
    return null;
  }
}

/**
 * Arrêts d'une tournée, mis en forme POUR LE MOBILE : mêmes clés que les points
 * de collecte là où c'est possible (`name`, `latitude`, `longitude`, `position`,
 * `status`), pour que la carte chauffeur les traite sans cas particulier.
 */
async function arretsPourMobile(tourId, db = pool) {
  try {
    const r = await db.query(
      `SELECT ta.id, ta.position, ta.status, ta.motif, ta.notes,
              ta.arrived_at, ta.completed_at,
              COALESCE(ta.libelle, lt.nom, 'Arrêt') AS name,
              lt.adresse AS address, lt.latitude, lt.longitude,
              lt.categorie, COALESCE(lt.duree_min, 15) AS duree_min
         FROM tour_arret_technique ta
         LEFT JOIN lieux_techniques lt ON lt.id = ta.lieu_id
        WHERE ta.tour_id = $1
        ORDER BY ta.position`,
      [tourId]
    );
    const centre = await centreDeTri(db);
    return r.rows.map((a) => ({
      ...a,
      // Un arrêt de retour dont le lieu a été supprimé du référentiel garderait
      // des coordonnées nulles : le chauffeur n'aurait aucun itinéraire. On
      // retombe alors sur le centre de tri, qui est bien sa destination.
      latitude: a.latitude ?? (MOTIFS_CENTRE.includes(a.motif) ? centre.latitude : null),
      longitude: a.longitude ?? (MOTIFS_CENTRE.includes(a.motif) ? centre.longitude : null),
      est_retour_centre: MOTIFS_CENTRE.includes(a.motif),
      suite: SUITE_MOTIF[a.motif] || null,
    }));
  } catch (err) {
    // Base non migrée (colonne `motif` absente) : le parcours de collecte doit
    // continuer sans arrêts plutôt que de renvoyer une erreur au chauffeur.
    console.warn('[TOURS] Arrêts de programme illisibles :', err.message);
    return [];
  }
}

module.exports = {
  MOTIFS,
  MOTIFS_CENTRE,
  LIBELLE_MOTIF,
  SUITE_MOTIF,
  CENTRE_FALLBACK,
  centreDeTri,
  positionSuivante,
  insererApresDernierPointTraite,
  arretEnAttente,
  creerRetourCentre,
  avancerRetourCentre,
  abandonnerArretsRestants,
  poserRetoursAutomatiques,
  cloturerDepartCentre,
  poserPauseDejeuner,
  poserPauseDejeunerSansBloquer,
  arretsPourMobile,
};
