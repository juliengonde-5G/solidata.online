/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SolidataBot — le périmètre du CHAUFFEUR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ARBITRAGE CLIENT (août 2026), mot pour mot : « Le module chauffeur autorise
 * l'accès à des informations sur la collecte, sur la circulation, sur la
 * navigation exclusivement. »
 *
 * CE QUE CE FICHIER CORRIGE. Le bot n'avait AUCUNE notion de chauffeur. Un
 * jeton chauffeur porte le rôle `COLLABORATEUR` en dur : il recevait donc les
 * outils « de base » — stock, planning, heures, bornes, plan de chaîne,
 * pointages — c'est-à-dire plus que l'arbitrage n'autorise, et il lui manquait
 * précisément les deux domaines qui lui sont utiles au volant : la circulation
 * et la navigation. Les deux moitiés du défaut se corrigent ici ensemble.
 *
 * ── LES QUATRE RÈGLES QUI TIENNENT CE FICHIER ──────────────────────────────
 *
 * 1. LISTE BLANCHE STRICTE. Ces trois outils sont TOUT ce qu'un chauffeur peut
 *    obtenir du bot ; aucun autre outil ne lui est ni proposé ni exécuté. Le
 *    contrôle a lieu DEUX fois (liste envoyée au modèle, puis revérification
 *    avant exécution), comme pour les outils de pilotage : c'est le second qui
 *    tient si le premier laisse un jour passer quelque chose.
 *
 * 2. PÉRIMÈTRE VÉHICULE. Aucun de ces outils n'accepte le moindre paramètre
 *    d'identité : ni numéro de tournée, ni véhicule, ni emprise de carte. La
 *    tournée, le véhicule et le secteur sont TOUJOURS déduits du jeton. La
 *    question « la tournée de qui ? » ne peut donc pas être posée — il n'y a
 *    rien à refuser, et rien à énumérer.
 *
 * 3. RIEN N'EST RECALCULÉ. La circulation vient de `services/traffic`
 *    (`getTrafficIncidents`, exactement la source de `GET /tours/trafic-public`)
 *    et l'itinéraire de `routes/tours/active-summary.itineraireChauffeur`
 *    (exactement celle de `GET /tours/:id/itineraire-public`). La tournée du
 *    jour vient de `driver-session.tourneeDuJourPourVehicule`, le tonnage de
 *    `poids.lireTotalPeseTournee`. Aucun appel HTTP interne, aucun second
 *    calcul de trajet : le bot doit annoncer la même distance restante que la
 *    carte du chauffeur, pas une autre.
 *
 * 4. JAMAIS DE VALEUR INVENTÉE, et jamais de géométrie. Une source muette
 *    renvoie son motif, pas un zéro rassurant. Et la polyligne de l'itinéraire
 *    (des centaines de coordonnées) n'est JAMAIS transmise au modèle : elle ne
 *    lui sert à rien et consommerait la conversation. Ce qui compte pour le
 *    chauffeur, c'est la distance, le temps et le prochain point.
 *
 * AUCUNE DONNÉE PERSONNELLE ne sort d'ici : les seuls noms renvoyés désignent
 * des choses (bornes, associations, communes, immatriculation).
 */

const pool = require('../config/database');

/** Aucun paramètre : tout est déduit du jeton (règle 2). */
const SANS_PARAM = { type: 'object', properties: {}, required: [] };

/** Nombre maximal d'éléments détaillés (mêmes bornes que bot-tools.js). */
const MAX_DETAIL = 5;

/**
 * Rayon du « secteur » du chauffeur pour la circulation, en kilomètres.
 * Un camion de collecte fait sa journée dans un rayon de cet ordre autour de
 * son point courant : au-delà, on lui montrerait des bouchons qu'il ne
 * rencontrera pas.
 */
const RAYON_SECTEUR_KM = 12;

/** Statuts de tournée, en clair. Le chauffeur ne lit pas « in_progress ». */
const LIBELLE_STATUT_TOURNEE = {
  planned: 'prévue',
  in_progress: 'en cours',
  returning: 'retour au centre',
  paused: 'en pause',
  completed: 'terminée',
  cancelled: 'annulée',
};

const rd = (v, n = 1) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return null;
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

/** Lecture résiliente : une source en échec vaut `repli`, jamais une exception. */
async function soft(fn, repli, etiquette) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[SolidataBot/chauffeur] ${etiquette} :`, err.code || err.message);
    return repli;
  }
}

/**
 * Le véhicule de la session. Détection par le helper PARTAGÉ du parcours
 * mobile : il couvre le claim `vehicle_id` ET la forme historique
 * « driver_<id> » du nom de compte, donc les jetons hérités encore valides.
 */
function vehiculeDeLaSession(userCtx) {
  const { driverVehicleIdFromToken } = require('../routes/tours/driver-session');
  return driverVehicleIdFromToken(userCtx);
}

/**
 * Points RESTANTS de la tournée, dans l'ordre de passage, quel que soit le
 * type de collecte (bornes de rue ou associations). Projection volontairement
 * courte : un nom, une commune, une adresse — de quoi se repérer, rien de plus.
 */
async function pointsDeLaTournee(tour) {
  if (tour.collection_type === 'association') {
    const r = await pool.query(
      `SELECT tap.position, tap.status,
              ap.name AS nom, ap.ville AS commune, ap.address AS adresse,
              ap.latitude, ap.longitude
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
        WHERE tap.tour_id = $1 ORDER BY tap.position`,
      [tour.id]
    );
    return r.rows;
  }
  const r = await pool.query(
    `SELECT tc.position, tc.status,
            c.name AS nom, c.commune, c.address AS adresse,
            c.latitude, c.longitude
       FROM tour_cav tc
       JOIN cav c ON c.id = tc.cav_id
      WHERE tc.tour_id = $1 ORDER BY tc.position`,
    [tour.id]
  );
  return r.rows;
}

/** Le point vers lequel le chauffeur roule : le premier encore à faire. */
function prochainPoint(points) {
  const p = points.find((x) => x.status === 'pending' || x.status === 'in_progress');
  if (!p) return null;
  return {
    nom: p.nom || null,
    commune: p.commune || null,
    adresse: p.adresse || null,
    numero_de_passage: p.position != null ? Number(p.position) : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. COLLECTE — « ma tournée »
// ═══════════════════════════════════════════════════════════════════════════

async function maTournee(_entree, userCtx) {
  const vehicleId = vehiculeDeLaSession(userCtx);
  if (vehicleId == null) {
    return { error: "Cet outil est réservé à l'application du véhicule." };
  }

  const { tourneeDuJourPourVehicule } = require('../routes/tours/driver-session');
  const tour = await soft(
    () => tourneeDuJourPourVehicule(pool, vehicleId), null, 'tournée du jour');

  if (!tour) {
    return {
      tournee: null,
      note: "Aucune tournée n'est prévue aujourd'hui pour ce véhicule. "
        + 'Le gestionnaire peut en programmer une.',
    };
  }

  const points = await soft(() => pointsDeLaTournee(tour), null, 'points de la tournée');
  const { lireTotalPeseTournee } = require('../routes/tours/poids');
  const poidsKg = await soft(() => lireTotalPeseTournee(pool, tour.id), null, 'pesées');

  const compte = (s) => (points || []).filter((p) => p.status === s).length;
  const suivant = points ? prochainPoint(points) : null;

  return {
    tournee: {
      numero: tour.id,
      vehicule: tour.registration || tour.vehicle_name || null,
      statut: LIBELLE_STATUT_TOURNEE[tour.status] || tour.status,
      type: tour.collection_type === 'association' ? 'associations' : 'bornes de rue',
      heure_de_depart: tour.started_at || null,
    },
    points: points === null
      // Une lecture en échec n'est pas une tournée sans point : on le dit.
      ? { disponible: false, note: 'La liste des points ne peut pas être lue pour le moment.' }
      : {
        total: points.length,
        collectes: compte('collected'),
        non_collectes: compte('skipped'),
        restants: compte('pending') + compte('in_progress'),
      },
    prochain_point: suivant,
    tonnage_collecte_kg: poidsKg === null ? null : rd(poidsKg),
    note_tonnage: poidsKg === null
      ? "Les pesées ne peuvent pas être lues pour le moment."
      : (poidsKg === 0
        ? "Aucune pesée n'a encore été enregistrée sur cette tournée."
        : 'Somme de toutes les pesées de la tournée, vidages en cours de journée compris.'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CIRCULATION — « le trafic sur mon secteur »
// ═══════════════════════════════════════════════════════════════════════════

/** Emprise de carte d'environ `RAYON_SECTEUR_KM` autour d'un point. */
function empriseAutour(lat, lng) {
  const dLat = RAYON_SECTEUR_KM / 111;
  const cos = Math.cos((lat * Math.PI) / 180);
  // Près des pôles, cos tend vers 0 : la borne évite une emprise démesurée que
  // `parseBbox` refuserait de toute façon.
  const dLng = RAYON_SECTEUR_KM / (111 * Math.max(cos, 0.2));
  return { sud: lat - dLat, ouest: lng - dLng, nord: lat + dLat, est: lng + dLng };
}

/**
 * Où regarder ? Cascade honnête, dont la provenance est RENVOYÉE :
 *   1. dernière position GPS fraîche de SON véhicule ;
 *   2. à défaut, le premier point restant de sa tournée du jour ;
 *   3. à défaut, le centre de tri.
 * Aucune position d'un autre véhicule n'est jamais consultée.
 */
async function secteurDuChauffeur(vehicleId) {
  const { GPS_FRAICHEUR_MIN } = require('../routes/tours/active-summary');
  const fraicheur = Number.isFinite(Number(GPS_FRAICHEUR_MIN)) ? Number(GPS_FRAICHEUR_MIN) : 15;

  const pos = await soft(async () => {
    const r = await pool.query(
      `SELECT latitude, longitude FROM gps_positions
        WHERE vehicle_id = $1
          AND recorded_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
        ORDER BY recorded_at DESC LIMIT 1`,
      [vehicleId, String(fraicheur)]
    );
    return r.rows[0] || null;
  }, null, 'dernière position GPS');
  if (pos && Number.isFinite(Number(pos.latitude)) && Number.isFinite(Number(pos.longitude))) {
    return {
      origine: 'position actuelle du véhicule',
      ...empriseAutour(Number(pos.latitude), Number(pos.longitude)),
    };
  }

  const { tourneeDuJourPourVehicule } = require('../routes/tours/driver-session');
  const tour = await soft(
    () => tourneeDuJourPourVehicule(pool, vehicleId), null, 'tournée du jour (secteur)');
  if (tour) {
    const points = await soft(() => pointsDeLaTournee(tour), null, 'points (secteur)');
    const suivant = (points || []).find(
      (p) => (p.status === 'pending' || p.status === 'in_progress')
        && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)));
    if (suivant) {
      return {
        origine: 'prochain point de la tournée',
        ...empriseAutour(Number(suivant.latitude), Number(suivant.longitude)),
      };
    }
  }

  const { CENTRE_TRI_LAT, CENTRE_TRI_LNG } = require('../routes/tours/context');
  return { origine: 'centre de tri', ...empriseAutour(CENTRE_TRI_LAT, CENTRE_TRI_LNG) };
}

async function traficSecteur(_entree, userCtx) {
  const vehicleId = vehiculeDeLaSession(userCtx);
  if (vehicleId == null) {
    return { error: "Cet outil est réservé à l'application du véhicule." };
  }

  const zone = await secteurDuChauffeur(vehicleId);
  const { getTrafficIncidents } = require('./traffic');
  const res = await soft(
    () => getTrafficIncidents(`${zone.sud},${zone.ouest},${zone.nord},${zone.est}`),
    null, 'événements de circulation');

  if (!res || res.disponible !== true) {
    return {
      secteur: zone.origine,
      disponible: false,
      // Le message de la source est repris TEL QUEL : « pas configuré »,
      // « quota dépassé » et « pas de réponse » ne sont pas la même chose, et
      // aucune des trois ne signifie « la route est dégagée ».
      note: (res && res.message)
        || "Les événements de circulation ne peuvent pas être consultés pour le moment.",
    };
  }

  const incidents = Array.isArray(res.incidents) ? res.incidents : [];
  // Les plus gênants d'abord : c'est ce qu'un chauffeur veut entendre en premier.
  const tries = [...incidents].sort((a, b) => (b.gravite || 0) - (a.gravite || 0));
  return {
    secteur: zone.origine,
    disponible: true,
    rayon_km: RAYON_SECTEUR_KM,
    nombre: incidents.length,
    evenements: tries.slice(0, MAX_DETAIL).map((i) => ({
      type: i.label || null,
      description: i.description || null,
      retard_min: Number.isFinite(Number(i.retard_sec))
        ? Math.round(Number(i.retard_sec) / 60) : null,
    })),
    non_detailles: Math.max(0, incidents.length - MAX_DETAIL),
    note: incidents.length === 0
      ? "Aucun événement de circulation signalé sur ce secteur."
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. NAVIGATION — « mon itinéraire »
// ═══════════════════════════════════════════════════════════════════════════

async function maNavigation(_entree, userCtx) {
  const vehicleId = vehiculeDeLaSession(userCtx);
  if (vehicleId == null) {
    return { error: "Cet outil est réservé à l'application du véhicule." };
  }

  const { tourneeDuJourPourVehicule } = require('../routes/tours/driver-session');
  const tour = await soft(
    () => tourneeDuJourPourVehicule(pool, vehicleId), null, 'tournée du jour');
  if (!tour) {
    return {
      itineraire: null,
      note: "Aucune tournée n'est prévue aujourd'hui pour ce véhicule : il n'y a pas d'itinéraire.",
    };
  }

  // MÊME calcul que la carte du chauffeur (GET /tours/:id/itineraire-public).
  const { itineraireChauffeur } = require('../routes/tours/active-summary');
  const it = await soft(() => itineraireChauffeur(tour.id), null, 'itinéraire');
  const points = await soft(() => pointsDeLaTournee(tour), null, 'points de la tournée');
  const suivant = points ? prochainPoint(points) : null;

  if (!it) {
    return {
      tournee: tour.id,
      itineraire: { disponible: false, note: "L'itinéraire ne peut pas être calculé pour le moment." },
      prochain_point: suivant,
    };
  }

  if (it.source === 'aucun_point_restant') {
    return {
      tournee: tour.id,
      itineraire: { termine: true },
      prochain_point: null,
      note: 'Tous les points de la tournée ont été traités : il ne reste que le retour au centre de tri.',
    };
  }

  const routier = it.source === 'routier';
  return {
    tournee: tour.id,
    itineraire: {
      // La géométrie du tracé n'est jamais transmise (règle 4) : elle ne sert
      // qu'à la carte, et pèserait des centaines de coordonnées.
      disponible: routier,
      points_restants: it.nb_points != null ? Number(it.nb_points) : null,
      distance_restante_km: routier ? it.distance_restante_km : null,
      duree_restante_min: routier ? it.duree_restante_min : null,
      note: routier
        ? 'Distance et durée jusqu\'au dernier point puis retour au centre de tri.'
        : "Le calcul d'itinéraire n'a pas répondu : la distance restante n'est pas connue.",
    },
    prochain_point: suivant,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DÉCLARATIONS
// ═══════════════════════════════════════════════════════════════════════════

const DEFINITIONS = [
  {
    name: 'ma_tournee',
    handler: maTournee,
    tool: {
      name: 'ma_tournee',
      description: "MA tournée d'aujourd'hui : son état, le nombre de points déjà collectés, "
        + 'ceux qui restent, le prochain point à faire et les kilos déjà pesés. '
        + "Toujours la tournée du véhicule de cette session — cet outil ne peut pas consulter celle d'un autre véhicule.",
      input_schema: SANS_PARAM,
    },
  },
  {
    name: 'trafic_secteur',
    handler: traficSecteur,
    tool: {
      name: 'trafic_secteur',
      description: 'Les événements de circulation (bouchons, accidents, routes fermées) autour du véhicule, '
        + "sur son secteur de travail. Si l'information n'est pas disponible, dis-le : "
        + "« pas d'information » ne veut pas dire « la route est dégagée ».",
      input_schema: SANS_PARAM,
    },
  },
  {
    name: 'ma_navigation',
    handler: maNavigation,
    tool: {
      name: 'ma_navigation',
      description: "MON itinéraire : combien de kilomètres et de minutes il reste à faire jusqu'à la fin de la tournée "
        + '(retour au centre de tri compris), et quel est le prochain point. '
        + "Toujours l'itinéraire du véhicule de cette session.",
      input_schema: SANS_PARAM,
    },
  },
];

/** Les outils du chauffeur, prêts pour l'API — et RIEN d'autre (règle 1). */
const CHAUFFEUR_TOOLS = DEFINITIONS.map((d) => d.tool);

/** La liste blanche, sous sa forme la plus simple à vérifier. */
const CHAUFFEUR_TOOL_NAMES = DEFINITIONS.map((d) => d.name);

const PAR_NOM = Object.fromEntries(DEFINITIONS.map((d) => [d.name, d]));

/**
 * Exécute un outil du chauffeur.
 * @returns {Promise<string|null>} JSON, ou `null` si le nom n'est pas des nôtres.
 *
 * Le contrôle « cette session est-elle bien une session chauffeur ? » a lieu en
 * amont dans `routes/chat.js` (filtrage de la liste, puis revérification avant
 * exécution) ET, en dernier recours, dans chaque handler, qui refuse net si le
 * jeton ne porte aucun véhicule : un outil de périmètre véhicule ne doit pas
 * pouvoir s'exécuter sans véhicule.
 */
async function executeChauffeurTool(nom, entree, userCtx) {
  const def = PAR_NOM[nom];
  if (!def) return null;
  try {
    return JSON.stringify(await def.handler(entree || {}, userCtx || {}));
  } catch (err) {
    console.error(`[SolidataBot/chauffeur] Outil ${nom} en échec :`, err.message);
    return JSON.stringify({ error: 'Impossible de lire cette information pour le moment.' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LE TON — variante de prompt pour le chauffeur
// ═══════════════════════════════════════════════════════════════════════════
//
// Le prompt général s'adresse à un gestionnaire : il parle de pilotage, de
// synthèses, de taux. Devant un chauffeur, au volant, avec des gants, ce
// registre n'a pas de sens. Cette variante applique la même règle FALC que le
// reste de l'application mobile : phrases courtes, mots simples, une idée par
// phrase, aucun tableau. Et elle NOMME le périmètre — sans quoi le modèle
// tenterait de répondre de mémoire aux questions dont on lui a retiré l'outil,
// ce qui est exactement la façon d'inventer un chiffre.

const SYSTEM_PROMPT_CHAUFFEUR = `Tu es SolidataBot, l'assistant du chauffeur de Solidarité Textiles.

QUI TE PARLE :
- Un chauffeur-collecteur, dans son camion, souvent en train de rouler ou de charger.
- Il n'a pas le temps de lire. Il a parfois des gants. L'écran est petit.

COMMENT TU PARLES :
- Toujours en français. Très court : 40 mots maximum, 2 ou 3 phrases.
- Des phrases courtes. Des mots simples. Une idée par phrase.
- Pas de tableau, pas de liste à puces longue, pas de pourcentage compliqué.
- Pas de mots de bureau : ni « KPI », ni « indicateur », ni « synthèse », ni « optimisation ».
- Un emoji par réponse, pas plus : 🚛 tournée, 🚦 circulation, 🗺️ route, 📦 kilos, ✅ ok, ❌ souci.
- Tutoie-le. Exemples : « Il te reste 4 points. » « Bouchon sur la N31, 12 min de retard. 🚦 »

CE QUE TU PEUX FAIRE — ET RIEN D'AUTRE :
1. LA COLLECTE : sa tournée du jour, ce qu'il a déjà fait, ce qui reste, les kilos pesés.
2. LA CIRCULATION : les bouchons et accidents sur son secteur.
3. LA NAVIGATION : son itinéraire, les kilomètres et le temps qui restent, le prochain point.

CE QUE TU NE PEUX PAS FAIRE :
- Tout le reste : stock, planning, heures de travail, pointages, paie, salariés, finances, ventes, boutiques, insertion, réglages.
- Tu n'as AUCUN outil pour ça, et tu ne réponds JAMAIS de mémoire.
- Dans ce cas, réponds exactement dans cet esprit : « Je ne peux pas répondre à ça. Demande à ton gestionnaire. 🙋 »
- Ne dis pas pourquoi, ne propose pas de contourner, n'invente pas de réponse partielle.

RÈGLES ABSOLUES :
- Tu ne donnes QUE des chiffres qui viennent d'un outil. Tu n'estimes rien, tu n'arrondis rien « à peu près ».
- Si un outil dit qu'une information n'est pas disponible, tu le dis. « Pas d'information » n'est PAS « tout va bien » : un trafic non consulté n'est pas une route dégagée, une pesée absente n'est pas zéro kilo.
- Tu ne parles jamais d'une autre tournée que la sienne, ni d'un autre véhicule, ni d'un autre chauffeur.
- Tu ne cites jamais le nom d'une personne.
- Tu ne modifies jamais rien. Tu lis, tu réponds.
- LA ROUTE D'ABORD : s'il te demande quelque chose de long, réponds court et dis-lui de regarder son écran à l'arrêt.

CE QU'IL FAUT SAVOIR :
- Une tournée = la journée de collecte de son camion.
- Un point = une borne de rue (CAV) ou une association où il charge du textile.
- Le centre de tri, c'est là qu'il vide le camion et qu'il pèse.
- Les kilos sont pesés au centre, pas point par point : le total de la journée inclut les vidages du midi.`;

/**
 * Suggestions proposées au chauffeur à l'ouverture du chat.
 * Elles doivent rester DANS le périmètre : proposer « Quel est le stock ? » à
 * quelqu'un à qui l'outil est retiré, c'est fabriquer un refus.
 */
const SUGGESTIONS_CHAUFFEUR = [
  { icon: '🚛', text: 'Où en est ma tournée ?', category: 'collecte' },
  { icon: '🗺️', text: 'Quel est mon prochain point ?', category: 'navigation' },
  { icon: '🚦', text: 'Y a-t-il des bouchons sur mon secteur ?', category: 'circulation' },
  { icon: '📦', text: 'Combien de kilos j\'ai déjà pesés ?', category: 'collecte' },
];

/** Refus opposé à un chauffeur qui demande un outil hors périmètre. */
const REFUS_HORS_PERIMETRE = {
  error: "Je ne peux pas répondre à ça depuis l'application du véhicule.",
  perimetre: ['la collecte', 'la circulation', 'la navigation'],
  a_dire: 'Dis simplement que tu ne peux pas répondre à cette question et renvoie vers le gestionnaire.',
};

/** Refus opposé à une session SANS véhicule qui viserait un outil chauffeur. */
const REFUS_HORS_VEHICULE = {
  error: "Cet outil appartient à l'application du véhicule : il n'a pas de sens hors d'une session chauffeur.",
};

module.exports = {
  CHAUFFEUR_TOOLS,
  CHAUFFEUR_TOOL_NAMES,
  executeChauffeurTool,
  vehiculeDeLaSession,
  SYSTEM_PROMPT_CHAUFFEUR,
  SUGGESTIONS_CHAUFFEUR,
  REFUS_HORS_PERIMETRE,
  REFUS_HORS_VEHICULE,
  // Exposés pour les tests (périmètre, troncature, emprise).
  DEFINITIONS,
  MAX_DETAIL,
  RAYON_SECTEUR_KM,
  empriseAutour,
};
