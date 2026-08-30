/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SolidataBot — outils de LECTURE des modules 26 à 34
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce service porte les outils ajoutés au bot pour les domaines apparus depuis
 * la vague 2 (VAK, RSE, énergie & GES, achats responsables, enquêtes, chaîne de
 * tri, saturation des bornes, arrêts GPS, commandes récurrentes, effectifs ETP,
 * purges RGPD, temps & présence). Il est séparé de `routes/chat.js` pour que la
 * boucle conversationnelle reste lisible : celle-ci ne connaît que deux tableaux
 * et une fonction d'exécution.
 *
 * ── LES CINQ RÈGLES QUI TIENNENT CE FICHIER ────────────────────────────────
 *
 * 1. LECTURE SEULE. Aucun handler n'écrit. La seule fonction appelée ici qui
 *    pourrait écrire (`genererCommandesRecurrentes`) est invoquée en mode
 *    `simulation: true`, branche prouvée sans écriture dans le service d'origine.
 *
 * 2. JAMAIS PLUS LARGE QUE L'ÉCRAN. Les rôles de chaque outil recopient
 *    EXACTEMENT le `READ` du routeur natif correspondant (rse.js, energie.js,
 *    achats.js, enquetes.js, effectifs.js, rgpd.js, vak.js, tours/…). Un outil
 *    ne doit jamais ouvrir par la conversation ce qu'un écran ferme au même
 *    rôle. Le double contrôle (liste envoyée au modèle + revérification à
 *    l'exécution) est assuré par `routes/chat.js` via `EXTENDED_TOOL_ROLES`.
 *
 * 3. AUCUNE DONNÉE PERSONNELLE. Aucun handler ne renvoie de nom, d'e-mail, de
 *    matricule, de salaire, de RQTH, de titre de séjour, de date de naissance,
 *    de profil PCM, de note de profil CIP, de frein de santé (art. 9) ou
 *    judiciaire (art. 10), ni le contenu d'un message de tiers. Les seuls
 *    « noms » qui sortent d'ici désignent des CHOSES : bornes, communes,
 *    véhicules, produits, postes de chaîne. Deux champs nominatifs disponibles
 *    dans les sources ont été délibérément ÉCARTÉS : `pilote_nom` du tableau de
 *    bord RSE et `asp_valide_par` de la synthèse ETP.
 *
 * 4. TRONCATURE CÔTÉ OUTIL, jamais côté modèle. Le tableau de bord RSE agrège
 *    27 critères, le plan de chaîne 63 blocs, une tournée peut avoir des
 *    dizaines d'arrêts : injecter ces objets entiers dans une conversation
 *    bornée à 10 tours consommerait le contexte pour rien. Chaque outil renvoie
 *    donc des COMPTEURS + au plus quelques éléments d'attention (`MAX_DETAIL`),
 *    et dit combien il en a laissés de côté. On ne compte pas sur le modèle
 *    pour « choisir de résumer ».
 *
 * 5. JAMAIS DE VALEUR INVENTÉE. Une source indisponible donne `null` et un
 *    motif, jamais 0. Chaque lecture passe par `soft()` : une table absente
 *    (base non migrée) dégrade le bloc concerné et laisse les autres répondre.
 *
 * ── CE QUI EST RÉUTILISÉ PLUTÔT QUE RÉÉCRIT ────────────────────────────────
 *   • `routes/enquetes.computeResultats`  — le seuil d'anonymat n ≥ 5 est SON
 *     calcul, jamais un contrôle refait ici ;
 *   • `routes/energie.computeAnnualGes` / `.resolveCA` / `.computeConsommation100km` ;
 *   • `routes/tours/analyse-gps.arretsPourAffichage` ;
 *   • `services/commandes-recurrence.genererCommandesRecurrentes({simulation:true})` ;
 *   • `services/rgpd-purges.PURGES_RGPD` / `.retentionEffective` ;
 *   • `services/sumup.sqlPerimetreCaisse` / `.normalizePaymentMethod` — sans quoi
 *     le bot annoncerait un CA de VAK différent de celui de l'écran.
 * Les `require` sont PARESSEUX (dans les handlers) : le bot ne doit pas faire
 * charger la moitié du backend au démarrage, ni tomber si un module change.
 */

const pool = require('../config/database');

/** Nombre maximal d'éléments détaillés renvoyés par un outil (règle 4). */
const MAX_DETAIL = 5;

/** Lecture résiliente : une source en échec vaut `repli`, jamais une exception. */
async function soft(fn, repli, etiquette) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[SolidataBot] ${etiquette} :`, err.code || err.message);
    return repli;
  }
}

const rd = (v, n = 2) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return null;
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

/** Année demandée par le modèle, bornée ; défaut = année en cours. */
function anneeOu(annee) {
  const a = parseInt(annee, 10);
  return Number.isInteger(a) && a >= 2000 && a <= 2100 ? a : new Date().getFullYear();
}

/** Tronque une liste et DIT ce qui n'est pas montré (règle 4). */
function extrait(liste, max = MAX_DETAIL) {
  const arr = Array.isArray(liste) ? liste : [];
  if (arr.length <= max) return { total: arr.length, montres: arr, non_montres: 0 };
  return { total: arr.length, montres: arr.slice(0, max), non_montres: arr.length - max };
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * VAK en cours (module 27). Les compteurs empruntent le MÊME filtre de
 * périmètre par caisse que l'écran (`sqlPerimetreCaisse`) : sans lui, une
 * seconde caisse encaissant pendant la VAK gonflerait le chiffre annoncé par
 * le bot par rapport à celui affiché en salle.
 */
async function resumeVakLive() {
  const sumup = require('./sumup');
  const perimetre = sumup.sqlPerimetreCaisse('vk', 't');
  // Jour civil de PARIS : la date UTC fait basculer sur la veille entre minuit
  // et 01:00/02:00 (même correctif que routes/vak.js).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const parisDay = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date`;

  const vak = await soft(async () => (await pool.query(
    `SELECT id, libelle, date_debut, date_fin, ca_objectif_ttc, poids_objectif_kg
       FROM vaks WHERE $1::DATE BETWEEN date_debut AND date_fin
      ORDER BY date_debut DESC LIMIT 1`, [today])).rows[0] || null, null, 'resume_vak_live/vak');

  if (!vak) {
    const suivante = await soft(async () => (await pool.query(
      `SELECT libelle, date_debut, date_fin FROM vaks WHERE date_debut > $1::DATE
        ORDER BY date_debut LIMIT 1`, [today])).rows[0] || null, null, 'resume_vak_live/next');
    return {
      vak_en_cours: false,
      prochaine_vak: suivante
        ? { libelle: suivante.libelle, du: suivante.date_debut, au: suivante.date_fin }
        : null,
      note: suivante
        ? 'Aucune Vente au Kilo aujourd\'hui.'
        : 'Aucune Vente au Kilo aujourd\'hui, et aucune n\'est programmée.',
    };
  }

  const c = await soft(async () => (await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN ${parisDay('t.date_ticket')} = $1::DATE THEN t.total_ttc END), 0)::float AS ca_jour,
            COALESCE(SUM(CASE WHEN ${parisDay('t.date_ticket')} = $1::DATE THEN t.poids_kg END), 0)::float AS poids_jour,
            COUNT(CASE WHEN ${parisDay('t.date_ticket')} = $1::DATE THEN 1 END)::int AS tickets_jour,
            COALESCE(SUM(t.total_ttc), 0)::float AS ca_vak,
            COALESCE(SUM(t.poids_kg), 0)::float AS poids_vak,
            COUNT(*)::int AS tickets_vak
       FROM vak_tickets t JOIN vaks vk ON vk.id = t.vak_id
      WHERE t.vak_id = $2 AND ${perimetre}`, [today, vak.id])).rows[0] || null, null, 'resume_vak_live/compteurs');

  // Mix de paiement : agrégé en SQL sur la valeur BRUTE, puis ramené aux
  // libellés métier par la fonction canonique (les tickets anciens portent
  // encore 'POS'/'VISA' — les classer ici garantit le même compte qu'à l'écran).
  const paiements = await soft(async () => {
    const r = await pool.query(
      `SELECT t.moyen_paiement AS brut, COUNT(*)::int AS n, COALESCE(SUM(t.total_ttc), 0)::float AS ca
         FROM vak_tickets t JOIN vaks vk ON vk.id = t.vak_id
        WHERE t.vak_id = $1 AND ${perimetre}
        GROUP BY t.moyen_paiement`, [vak.id]);
    const par = {};
    for (const row of r.rows) {
      const label = sumup.normalizePaymentMethod(row.brut);
      par[label] = par[label] || { tickets: 0, ca_ttc: 0 };
      par[label].tickets += row.n;
      par[label].ca_ttc += Number(row.ca) || 0;
    }
    for (const k of Object.keys(par)) par[k].ca_ttc = rd(par[k].ca_ttc);
    return par;
  }, null, 'resume_vak_live/paiements');

  const caVak = c ? rd(c.ca_vak) : null;
  const poidsVak = c ? rd(c.poids_vak, 1) : null;
  const objCa = vak.ca_objectif_ttc == null ? null : rd(vak.ca_objectif_ttc);
  const objPoids = vak.poids_objectif_kg == null ? null : rd(vak.poids_objectif_kg, 1);

  return {
    vak_en_cours: true,
    libelle: vak.libelle,
    du: vak.date_debut,
    au: vak.date_fin,
    aujourdhui: c ? { ca_ttc: rd(c.ca_jour), poids_kg: rd(c.poids_jour, 1), tickets: c.tickets_jour } : null,
    depuis_le_debut: c ? { ca_ttc: caVak, poids_kg: poidsVak, tickets: c.tickets_vak } : null,
    // Prix moyen au kilo : le poids peut être nul (aucune vente pesée encore
    // enregistrée) — dans ce cas la division n'a pas de sens, donc pas de valeur.
    prix_moyen_kg: caVak != null && poidsVak ? rd(caVak / poidsVak) : null,
    objectifs: {
      ca_ttc: objCa,
      poids_kg: objPoids,
      atteinte_ca_pct: objCa && caVak != null ? Math.round((caVak / objCa) * 100) : null,
      atteinte_poids_pct: objPoids && poidsVak != null ? Math.round((poidsVak / objPoids) * 100) : null,
      note: objCa == null && objPoids == null ? 'Aucun objectif saisi pour cette VAK.' : null,
    },
    mix_paiement: paiements,
    note: c ? null : 'Compteurs indisponibles (lecture en échec) — chiffres non communicables.',
  };
}

/**
 * Tableau de bord RSEi (module 28). Requête d'AGRÉGATS uniquement : on ne
 * charge pas les 27 critères pour en jeter 22 (règle 4), et on ne lit jamais le
 * pilote (`pilote_nom` du tableau de bord natif est une personne — règle 3).
 */
async function resumeRse() {
  const criteres = await soft(async () => (await pool.query(
    `WITH fraiches AS (
       SELECT code, COUNT(*) FILTER (
                WHERE date_preuve IS NOT NULL
                  AND date_preuve >= CURRENT_DATE - INTERVAL '12 months'
                  AND (echeance_fraicheur IS NULL OR echeance_fraicheur >= CURRENT_DATE))::int AS nb_fraiches
         FROM rsei_preuves, unnest(critere_codes) AS code GROUP BY code
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE c.niveau_auto_evalue IS NOT NULL)::int AS cotes,
            COUNT(*) FILTER (WHERE c.niveau_auto_evalue IS NOT NULL AND c.niveau_auto_evalue >= 2
                             AND COALESCE(f.nb_fraiches, 0) > 0)::int AS niveau2_demontrable,
            COUNT(*) FILTER (WHERE COALESCE(f.nb_fraiches, 0) = 0)::int AS sans_preuve_recente
       FROM rsei_criteres c LEFT JOIN fraiches f ON f.code = c.code`)).rows[0] || null, null, 'resume_rse/criteres');

  const actions = await soft(async () => (await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE statut = 'realise')::int AS realisees,
            COUNT(*) FILTER (WHERE statut IN ('a_faire','en_cours') AND echeance IS NOT NULL AND echeance < CURRENT_DATE)::int AS en_retard
       FROM rsei_actions`)).rows[0] || null, null, 'resume_rse/actions');

  const preuves = await soft(async () => (await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE echeance_fraicheur IS NOT NULL AND echeance_fraicheur < CURRENT_DATE)::int AS perimees
       FROM rsei_preuves`)).rows[0] || null, null, 'resume_rse/preuves');

  // Les seuls éléments détaillés : ce qui appelle une décision. Bornés à 5.
  const enRetard = await soft(async () => (await pool.query(
    `SELECT titre, echeance FROM rsei_actions
      WHERE statut IN ('a_faire','en_cours') AND echeance IS NOT NULL AND echeance < CURRENT_DATE
      ORDER BY echeance LIMIT $1`, [MAX_DETAIL])).rows, [], 'resume_rse/retard');

  const total = criteres ? criteres.total : null;
  const dem = criteres ? criteres.niveau2_demontrable : null;
  return {
    referentiel: 'RSEi-2026',
    criteres: criteres
      ? {
        total,
        cotes: criteres.cotes,
        non_cotes: total - criteres.cotes,
        niveau2_demontrable: dem,
        couverture_niveau2_pct: total ? Math.round((dem / total) * 100) : null,
        sans_preuve_recente: criteres.sans_preuve_recente,
      }
      : { disponible: false, note: 'Référentiel RSE illisible (module non initialisé ?).' },
    // PROJECTION EXPLICITE, jamais la ligne de base telle quelle. Défaut
    // débusqué par le test « aucun champ nominatif en sortie » : renvoyer
    // `actions` brut faisait ressortir TOUTE colonne que la requête rapporterait
    // un jour — exactement la classe de défaut corrigée en 2.43.0 sur
    // `GET /employees` (SELECT e.*). Un outil de bot énumère ce qu'il publie.
    actions: actions
      ? { total: actions.total, realisees: actions.realisees, en_retard: actions.en_retard }
      : { disponible: false },
    preuves: preuves
      ? { total: preuves.total, perimees: preuves.perimees }
      : { disponible: false },
    // Liste bornée par le SQL : le compte VRAI est `actions.en_retard` ci-dessus,
    // ceci n'en est qu'un échantillon — le champ le dit dans son nom, pour que
    // le modèle ne prenne pas 5 exemples pour un total.
    actions_en_retard_exemples: enRetard.map((a) => ({ titre: a.titre, echeance: a.echeance })),
    note: 'Compteurs seuls : le détail des 27 critères se lit sur l\'écran Pilotage RSE. '
      + 'C\'est la STRUCTURE qui se fait labelliser, pas le logiciel.',
  };
}

/**
 * Bilan GES annuel (module 29). Le calcul est INTÉGRALEMENT celui du module :
 * `computeAnnualGes` (facteurs ADEME paramétrables, poste sans facteur exclu du
 * total et signalé) et `resolveCA` (cascade honnête settings → GL → opérationnel
 * → null). Le bot ne recalcule aucune émission.
 */
async function resumeEnergieGes({ annee } = {}) {
  const an = anneeOu(annee);
  const energie = require('../routes/energie');

  const ges = await soft(() => energie.computeAnnualGes(an), null, 'resume_energie_ges/ges');
  if (!ges) {
    return { annee: an, disponible: false, note: 'Bilan GES illisible (module non initialisé ?).' };
  }

  const postes = [...(ges.energie || []), ...(ges.carburant || [])];
  // Un bilan « 0 tCO2e » sans le moindre relevé se lirait « nous n'émettons
  // rien » : on distingue le zéro MESURÉ de l'absence de mesure.
  const observations = postes.length;
  const sansFacteur = postes.filter((p) => p.facteur_manquant).map((p) => p.poste);

  const caRes = await soft(() => energie.resolveCA(an), { ca: null, source: null }, 'resume_energie_ges/ca');
  const total = ges.totaux ? ges.totaux.tco2e_total : null;

  const derives = await soft(async () => {
    const seuilRow = await pool.query('SELECT value FROM settings WHERE key = $1', ['energie.derive_seuil_pct']);
    const seuil = parseFloat(seuilRow.rows[0] && seuilRow.rows[0].value);
    const seuilPct = Number.isFinite(seuil) && seuil > 0 ? seuil : 20;
    const r = await pool.query(
      `SELECT p.vehicle_id, p.date_plein, p.litres::float AS litres, p.km_compteur, v.registration
         FROM carburant_pleins p LEFT JOIN vehicles v ON v.id = p.vehicle_id
        WHERE p.vehicle_id IS NOT NULL AND EXTRACT(YEAR FROM p.date_plein) = $1
        ORDER BY p.vehicle_id, p.km_compteur NULLS LAST, p.date_plein`, [an]);
    const parVehicule = new Map();
    for (const row of r.rows) {
      if (!parVehicule.has(row.vehicle_id)) parVehicule.set(row.vehicle_id, { registration: row.registration, pleins: [] });
      parVehicule.get(row.vehicle_id).pleins.push({ km_compteur: row.km_compteur, litres: row.litres, date_plein: row.date_plein });
    }
    const out = [];
    for (const v of parVehicule.values()) {
      // Méthode plein-à-plein du module, jamais réécrite.
      const conso = energie.computeConsommation100km(v.pleins);
      if (!conso || conso.moyenne_hors_derniere == null || conso.derniere_conso == null) continue;
      if (conso.moyenne_hors_derniere > 0 && conso.derniere_conso > conso.moyenne_hors_derniere * (1 + seuilPct / 100)) {
        out.push({
          // `registration` = plaque d'immatriculation : un objet, pas une personne.
          vehicule: v.registration || `#${v.vehicle_id}`,
          derniere_conso_l_100km: conso.derniere_conso,
          moyenne_l_100km: conso.moyenne_hors_derniere,
        });
      }
    }
    return { seuil_pct: seuilPct, liste: out };
  }, null, 'resume_energie_ges/derives');

  return {
    annee: an,
    mesure: observations > 0,
    tco2e: observations > 0
      ? {
        energie: ges.totaux.tco2e_energie,
        carburant: ges.totaux.tco2e_carburant,
        total,
      }
      : null,
    note_mesure: observations > 0 ? null
      : 'Aucun relevé d\'énergie ni plein de carburant saisi pour cette année : le bilan n\'est PAS nul, il n\'est pas mesuré.',
    intensite_tco2e_par_keuro_ca: caRes.ca && total != null ? rd(total / (caRes.ca / 1000), 4) : null,
    ca_reference: { montant: caRes.ca, source: caRes.source || 'indisponible' },
    postes_sans_facteur_emission: sansFacteur,
    vehicules_en_derive: derives
      ? { seuil_pct: derives.seuil_pct, ...extrait(derives.liste) }
      : { disponible: false },
    note: 'Les facteurs d\'émission sont des valeurs ADEME INDICATIVES et paramétrables — jamais des mesures exactes.',
  };
}

/** Achats responsables (module 31) : part de fournisseurs responsables + FDS. */
async function resumeAchatsResponsables({ annee } = {}) {
  const an = anneeOu(annee);

  const f = await soft(async () => (await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE actif)::int AS actifs,
            COUNT(*) FILTER (WHERE local)::int AS local,
            COUNT(*) FILTER (WHERE inclusif)::int AS inclusif,
            COUNT(*) FILTER (WHERE demarche_rse)::int AS demarche_rse,
            COUNT(*) FILTER (WHERE labellise)::int AS labellise,
            COUNT(*) FILTER (WHERE local OR inclusif OR demarche_rse OR labellise)::int AS responsables
       FROM achats_fournisseurs`)).rows[0] || null, null, 'resume_achats/fournisseurs');

  // Seuil de fraîcheur des FDS : réglage partagé avec l'écran (défaut 365 j).
  const fds = await soft(async () => {
    const s = await pool.query('SELECT value FROM settings WHERE key = $1', ['achats.fds_fraicheur_jours']);
    const v = parseInt(s.rows[0] && s.rows[0].value, 10);
    const jours = Number.isInteger(v) && v > 0 ? v : 365;
    const agg = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE fichier_path IS NULL)::int AS manquantes,
              COUNT(*) FILTER (WHERE date_fds IS NOT NULL AND date_fds < CURRENT_DATE - ($1::int * INTERVAL '1 day'))::int AS perimees
         FROM achats_fds`, [jours]);
    const aTraiter = await pool.query(
      `SELECT produit, date_fds, (fichier_path IS NULL) AS sans_fichier
         FROM achats_fds
        WHERE fichier_path IS NULL
           OR (date_fds IS NOT NULL AND date_fds < CURRENT_DATE - ($1::int * INTERVAL '1 day'))
        ORDER BY date_fds NULLS FIRST LIMIT $2`, [jours, MAX_DETAIL]);
    return { fraicheur_jours: jours, ...agg.rows[0], a_traiter: aTraiter.rows };
  }, null, 'resume_achats/fds');

  const total = f ? f.total : 0;
  return {
    annee: an,
    fournisseurs: f
      ? {
        total: f.total,
        actifs: f.actifs,
        responsables: f.responsables,
        part_responsables_pct: total ? Math.round((f.responsables / total) * 100) : null,
        detail_statuts: { local: f.local, inclusif: f.inclusif, demarche_rse: f.demarche_rse, labellise: f.labellise },
      }
      : { disponible: false, note: 'Référentiel fournisseurs illisible.' },
    fds: fds
      ? {
        fraicheur_jours: fds.fraicheur_jours,
        total: fds.total,
        manquantes: fds.manquantes,
        perimees: fds.perimees,
        // Échantillon borné par le SQL ; les totaux qui font foi sont
        // `manquantes` et `perimees` juste au-dessus.
        a_traiter_exemples: (fds.a_traiter || []).map((d) => ({
          produit: d.produit,
          motif: d.sans_fichier ? 'fiche manquante' : 'fiche périmée',
          date_fds: d.date_fds,
        })),
      }
      : { disponible: false },
    note: 'La part d\'achats EN MONTANT (rapprochement classe 60 du Grand Livre) '
      + 'se lit sur l\'écran Achats responsables : c\'est une estimation par nom de tiers, pas un chiffre comptable.',
  };
}

/**
 * Résultats d'une campagne d'enquête (module 30).
 *
 * LE SEUIL D'ANONYMAT N'EST PAS RECALCULÉ ICI : l'agrégation est confiée à
 * `computeResultats`, la fonction même qu'utilise l'écran. Sous 5 réponses elle
 * renvoie `{ n, seuil, sous_seuil: true }` SANS aucune distribution, et le bot
 * transmet ce refus tel quel. Écrire un second contrôle ici, c'est se donner
 * deux seuils qui divergeront.
 *
 * PLUS STRICT que l'écran, volontairement : ni verbatims ni nuage de mots ne
 * sortent d'ici. Une réponse en texte libre peut identifier son auteur par ce
 * qu'elle raconte, et l'écran a un lecteur identifié quand le bot a un modèle.
 */
async function resultatsEnquete({ campagne_id, categorie } = {}) {
  const { computeResultats, SEUIL_ANONYMAT } = require('../routes/enquetes');

  const camp = await soft(async () => {
    const id = parseInt(campagne_id, 10);
    if (Number.isInteger(id) && id > 0) {
      const r = await pool.query(
        `SELECT c.id, c.titre, c.statut, c.public_cible, c.date_ouverture, c.date_cloture,
                c.modele_id, m.categorie AS modele_categorie, m.anonyme AS modele_anonyme
           FROM enquete_campagnes c JOIN enquete_modeles m ON m.id = c.modele_id
          WHERE c.id = $1`, [id]);
      return r.rows[0] || null;
    }
    // Sans identifiant : la dernière campagne CLOSE (éventuellement filtrée par
    // catégorie). Une campagne encore ouverte donnerait un résultat mouvant.
    const cat = typeof categorie === 'string' && categorie.trim() ? categorie.trim() : null;
    const r = await pool.query(
      `SELECT c.id, c.titre, c.statut, c.public_cible, c.date_ouverture, c.date_cloture,
              c.modele_id, m.categorie AS modele_categorie, m.anonyme AS modele_anonyme
         FROM enquete_campagnes c JOIN enquete_modeles m ON m.id = c.modele_id
        WHERE c.statut = 'close' AND ($1::text IS NULL OR m.categorie = $1)
        ORDER BY COALESCE(c.date_cloture, c.date_ouverture) DESC NULLS LAST, c.id DESC LIMIT 1`, [cat]);
    return r.rows[0] || null;
  }, null, 'resultats_enquete/campagne');

  if (!camp) {
    return {
      trouve: false,
      note: campagne_id
        ? 'Campagne introuvable.'
        : 'Aucune campagne close ne correspond — les résultats ne sont restitués qu\'une fois la campagne close.',
    };
  }

  const data = await soft(async () => {
    const q = await pool.query(
      'SELECT id, ordre, libelle, type, options FROM enquete_questions WHERE modele_id = $1 ORDER BY ordre, id',
      [camp.modele_id]);
    const rp = await pool.query('SELECT reponses FROM enquete_reponses WHERE campagne_id = $1', [camp.id]);
    return { questions: q.rows, reponses: rp.rows.map((x) => x.reponses || {}) };
  }, null, 'resultats_enquete/donnees');

  if (!data) return { trouve: true, campagne: camp.titre, disponible: false, note: 'Réponses illisibles.' };

  const agg = computeResultats(data.questions, data.reponses, camp.modele_anonyme);
  const entete = {
    trouve: true,
    campagne: camp.titre,
    categorie: camp.modele_categorie,
    public_cible: camp.public_cible,
    statut: camp.statut,
    close_le: camp.date_cloture,
    nb_reponses: agg.n,
    seuil_anonymat: agg.seuil != null ? agg.seuil : SEUIL_ANONYMAT,
  };

  if (agg.sous_seuil) {
    return {
      ...entete,
      sous_seuil: true,
      note: `Moins de ${entete.seuil_anonymat} réponses : AUCUN résultat n'est restituable, `
        + 'ni distribution, ni moyenne, ni tendance. Le dire est la seule réponse possible.',
    };
  }

  const questions = (agg.questions || []).slice(0, MAX_DETAIL).map((q) => ({
    question: q.libelle,
    type: q.type,
    nb_reponses: q.n_reponses,
    moyenne: q.moyenne != null ? q.moyenne : null,
    // Les questions ouvertes ne sortent pas d'ici : ni verbatim, ni nuage de mots.
    distribution: q.type === 'texte' ? null : (q.distribution || null),
    note: q.type === 'texte' ? 'Réponses libres non restituées par l\'assistant — voir l\'écran Enquêtes.' : null,
  }));

  return {
    ...entete,
    sous_seuil: false,
    questions,
    questions_non_montrees: Math.max(0, (agg.questions || []).length - questions.length),
  };
}

/**
 * Bornes menacées de saturation (module 6). Le SEUIL est celui du moteur
 * (`saturationThresholdPct`), pas une constante réinventée ici.
 *
 * Périmètre volontairement plus étroit que l'écran `saturation-risks` : seule
 * la source PRÉDICTION est exploitée (la branche capteur et l'extrapolation
 * demandent des règles de fraîcheur que dupliquer ferait diverger). Le champ
 * `source` le dit, et la note renvoie à l'écran pour la vue complète.
 */
async function saturationCav({ jours } = {}) {
  let seuil = 90;
  try {
    const { getScoringConfig } = require('../routes/tours/predictions');
    const cfg = getScoringConfig() || {};
    const s = parseFloat(cfg.saturationThresholdPct);
    if (Number.isFinite(s) && s > 0) seuil = s;
  } catch (err) {
    console.error('[SolidataBot] saturation_cav/config :', err.message);
  }
  const j = parseInt(jours, 10);
  const horizon = Number.isInteger(j) && j >= 1 && j <= 60 ? j : 7;

  const rows = await soft(async () => (await pool.query(
    `WITH pred AS (
       SELECT p.cav_id, MIN(p.predicted_date) AS date_saturation
         FROM ml_fill_predictions p
        WHERE p.predicted_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($1::int))
          AND p.predicted_fill_rate >= $2
        GROUP BY p.cav_id
     )
     SELECT c.name, c.commune, pred.date_saturation,
            EXISTS (
              SELECT 1 FROM tour_cav tc JOIN tours t ON t.id = tc.tour_id
               WHERE tc.cav_id = c.id AND t.status IN ('planned','in_progress')
                 AND t.date >= CURRENT_DATE AND t.date <= pred.date_saturation
            ) AS couvert
       FROM cav c JOIN pred ON pred.cav_id = c.id
      WHERE c.status = 'active'
      ORDER BY pred.date_saturation, c.name`, [horizon, seuil])), null, 'saturation_cav');

  if (!rows) {
    return { disponible: false, note: 'Prédictions de remplissage illisibles.' };
  }

  const liste = rows.rows.map((r) => ({
    // Nom et commune d'une BORNE de rue : un objet public, pas une personne.
    borne: r.name,
    commune: r.commune || null,
    saturation_prevue_le: r.date_saturation,
    deja_couverte_par_une_tournee: r.couvert === true,
  }));
  const nonCouvertes = liste.filter((c) => !c.deja_couverte_par_une_tournee);

  return {
    seuil_pct: seuil,
    horizon_jours: horizon,
    nb_bornes_menacees: liste.length,
    nb_non_couvertes: nonCouvertes.length,
    // On montre en priorité ce qui appelle une décision : les non couvertes.
    a_planifier: extrait(nonCouvertes),
    source: 'prediction',
    note: liste.length === 0
      ? 'Aucune borne ne devrait franchir le seuil sur cet horizon d\'après les prédictions.'
      : 'Vue fondée sur les seules PRÉDICTIONS de remplissage. L\'écran Propositions de collecte '
        + 'y ajoute les relevés capteur et les extrapolations.',
  };
}

/**
 * Arrêts GPS d'une tournée (module 6). L'analyse elle-même est celle du module
 * (`arretsPourAffichage`) : elle lit la table pour une tournée close et calcule
 * à la volée pour une tournée en cours, sans jamais rien écrire.
 */
async function arretsGpsTournee({ tour_id } = {}) {
  const id = parseInt(tour_id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Indique le numéro de la tournée.' };
  }

  const tour = await soft(async () => (await pool.query(
    'SELECT id, date, status FROM tours WHERE id = $1', [id])).rows[0] || null, null, 'arrets_gps/tour');
  if (!tour) return { trouve: false, note: `Aucune tournée numéro ${id}.` };

  const analyse = require('../routes/tours/analyse-gps');
  const res = await soft(() => analyse.arretsPourAffichage(id, tour.status, pool), null, 'arrets_gps/analyse');
  if (!res) return { trouve: true, tour_id: id, disponible: false, note: 'Analyse des arrêts indisponible.' };

  if (res.source === 'indisponible') {
    return {
      trouve: true, tour_id: id, date: tour.date, statut: tour.status,
      disponible: false,
      // Le motif du module est plus utile qu'un « 0 arrêt » qui laisserait
      // croire que la tournée n'a fait aucune pause.
      note: res.motif || 'Aucun relevé GPS exploitable pour cette tournée.',
    };
  }

  const arrets = Array.isArray(res.arrets) ? res.arrets : [];
  // « Hors programme » = arrêt rattaché à aucun point connu (ni borne, ni
  // centre, ni association). C'est LA question du gestionnaire.
  const horsProgramme = arrets.filter((a) => a.type === 'inconnu');
  const totalMin = horsProgramme.reduce((s, a) => s + (Number(a.duree_min) || 0), 0);

  return {
    trouve: true,
    tour_id: id,
    date: tour.date,
    statut: tour.status,
    seuil_detection_min: res.seuil_min,
    nb_arrets_detectes: arrets.length,
    nb_hors_programme: horsProgramme.length,
    duree_totale_hors_programme_min: Math.round(totalMin),
    plus_longs_hors_programme: extrait(
      horsProgramme
        .slice()
        .sort((a, b) => (Number(b.duree_min) || 0) - (Number(a.duree_min) || 0))
        .map((a) => ({ debut: a.debut, duree_min: a.duree_min }))
    ),
    note: res.source === 'live'
      ? 'Tournée non close : arrêts calculés à la volée, le dernier arrêt peut être encore en cours.'
      : null,
  };
}

/**
 * Commandes exutoires récurrentes (module 11). Appelle le moteur en SIMULATION :
 * il énumère les échéances dues et les créneaux de chargement qu'il ne peut pas
 * poser, sans écrire une seule ligne (branche `simulation` du service).
 */
async function echeancesCommandesRecurrentes({ jours } = {}) {
  const moteur = require('./commandes-recurrence');
  const j = parseInt(jours, 10);
  const options = { simulation: true };
  if (Number.isInteger(j) && j >= 1 && j <= 365) options.horizonJours = j;

  const res = await soft(() => moteur.genererCommandesRecurrentes(options), null, 'echeances_recurrentes');
  if (!res || res.ok === false) {
    return { disponible: false, note: (res && res.motif) || 'Moteur de récurrence indisponible.' };
  }

  // Une « ignorée » sans créneau posable = un chargement à caler à la main :
  // c'est l'alerte utile, on la distingue des autres motifs.
  const ignorees = Array.isArray(res.ignorees) ? res.ignorees : [];
  const creneaux = ignorees.filter((i) => i.date);

  return {
    horizon_jours: res.horizon_jours,
    simulation: true,
    nb_echeances_dues: (res.generees || []).length,
    echeances: extrait((res.generees || []).map((g) => ({
      // `reference_parent` est une référence de COMMANDE, pas un nom de personne.
      modele: g.reference_parent,
      date: g.date_commande,
    }))),
    nb_creneaux_de_chargement_a_poser: creneaux.length,
    creneaux_a_poser: extrait(creneaux.map((i) => ({
      modele: i.reference_parent, date: i.date, motif: i.motif,
    }))),
    note: 'Simulation : aucune commande n\'a été créée par cette consultation. '
      + 'La génération réelle est faite par le travail quotidien planifié.',
  };
}

/** Plan de chaîne de tri ACTIF (module 7) : postes et capacités, sans le plan 2D. */
async function layoutChaineActif() {
  const layout = await soft(async () => (await pool.query(
    'SELECT id, nom, description, effectif_max FROM chaine_layouts WHERE is_actif = true ORDER BY id LIMIT 1')
  ).rows[0] || null, null, 'layout_chaine/layout');

  if (!layout) {
    return { actif: false, note: 'Aucun plan de chaîne actif — il s\'en active un dans le configurateur.' };
  }

  const blocs = await soft(async () => (await pool.query(
    `SELECT categorie, COUNT(*)::int AS n,
            COALESCE(SUM(CASE WHEN categorie = 'poste' AND actif THEN effectif_max ELSE 0 END), 0)::int AS effectif
       FROM chaine_layout_postes WHERE layout_id = $1 GROUP BY categorie`, [layout.id])).rows, [], 'layout_chaine/blocs');

  const postes = await soft(async () => (await pool.query(
    `SELECT libelle, obligatoire, effectif_min, effectif_max
       FROM chaine_layout_postes
      WHERE layout_id = $1 AND categorie = 'poste' AND actif = true
      ORDER BY obligatoire DESC, effectif_max DESC NULLS LAST, libelle`, [layout.id])).rows, [], 'layout_chaine/postes');

  const parCategorie = Object.fromEntries(blocs.map((b) => [b.categorie, b.n]));
  const effectifTotal = blocs.reduce((s, b) => s + (Number(b.effectif) || 0), 0);
  const reference = layout.effectif_max == null ? null : Number(layout.effectif_max);

  return {
    actif: true,
    plan: layout.nom,
    description: layout.description || null,
    nb_postes: parCategorie.poste || 0,
    nb_zones_depose: parCategorie.zone_depose || 0,
    nb_entrees: parCategorie.entree || 0,
    effectif_total_max: effectifTotal,
    effectif_reference: reference,
    alerte_effectif: reference !== null && effectifTotal > reference,
    postes: extrait(postes.map((p) => ({
      poste: p.libelle,
      obligatoire: p.obligatoire === true,
      effectif_min: p.effectif_min,
      effectif_max: p.effectif_max,
    })), 12),
    note: 'Un dépassement d\'effectif est SIGNALÉ, jamais bloquant.',
  };
}

/**
 * Effectifs conventionnés ETP (module 32).
 *
 * DOCTRINE DU MODULE, respectée telle quelle : quand un état ASP existe pour un
 * mois, LE CHIFFRE ASP FAIT FOI. Le bot ne rejoue donc PAS la grille
 * prévisionnelle/réalisée (moteur lourd, semaines ISO à pivot jeudi,
 * renouvellements présumés) : il lit le chiffre qui fait foi et la cible
 * conventionnelle, et renvoie à l'écran pour le prévisionnel. Rejouer ce moteur
 * ici, c'est se donner deux calculs d'ETP qui finiront par se contredire.
 */
async function resumeEffectifsEtp({ annee, mois } = {}) {
  const an = anneeOu(annee);
  const m = parseInt(mois, 10);
  const moisDemande = Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;

  // Cible conventionnelle : réglage annuel, repli sur la cible d'insertion,
  // sinon null — jamais une valeur inventée (miroir de effectifs.readConvention).
  const convention = await soft(async () => {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [`effectifs.convention_${an}`]);
    if (r.rows[0] && r.rows[0].value) {
      try {
        const j = JSON.parse(r.rows[0].value);
        const n = Number(j.etp_conventionnes);
        if (Number.isFinite(n)) {
          return { etp_conventionnes: n, heures_annuelles_etp: Number(j.heures_annuelles_etp) || null, source: 'annexe_financiere' };
        }
      } catch (_) { /* JSON illisible → repli comme si absent */ }
    }
    const c = await pool.query('SELECT value FROM settings WHERE key = $1', ['insertion.cible_etp_conventionnes']);
    const cible = Number(c.rows[0] && c.rows[0].value);
    if (Number.isFinite(cible) && cible > 0) return { etp_conventionnes: cible, heures_annuelles_etp: null, source: 'cible_insertion' };
    return { etp_conventionnes: null, heures_annuelles_etp: null, source: null };
  }, { etp_conventionnes: null, heures_annuelles_etp: null, source: null }, 'effectifs_etp/convention');

  const asp = await soft(async () => (await pool.query(
    `SELECT mois, etp_asp::float AS etp_asp, valide_le
       FROM etp_asp_mensuel WHERE annee = $1 ORDER BY mois`, [an])).rows, null, 'effectifs_etp/asp');

  if (asp === null) {
    return { annee: an, disponible: false, note: 'Validations ASP illisibles (module non initialisé ?).' };
  }

  const conv = convention.etp_conventionnes;
  const ligne = (r) => ({
    mois: r.mois,
    etp_asp: rd(r.etp_asp),
    ecart_convention: conv != null ? rd(Number(r.etp_asp) - conv) : null,
    valide_le: r.valide_le,
  });

  const cible = moisDemande ? asp.find((r) => Number(r.mois) === moisDemande) : asp[asp.length - 1];

  return {
    annee: an,
    convention: {
      etp_conventionnes: conv,
      heures_annuelles_etp: convention.heures_annuelles_etp,
      source: convention.source,
      note: conv == null
        ? 'Aucune convention paramétrée pour cette année : l\'écart ne peut pas être calculé.'
        : null,
    },
    mois_demande: moisDemande,
    mois_retenu: cible ? ligne(cible) : null,
    note_mois: cible
      ? null
      : (moisDemande
        ? `Le mois ${moisDemande} n'a pas encore d'état ASP validé — le prévisionnel se lit sur l'écran Effectifs.`
        : 'Aucun état ASP validé pour cette année.'),
    mois_valides: asp.map((r) => ({ mois: r.mois, etp_asp: rd(r.etp_asp) })),
    note: 'Chiffres ASP VALIDÉS, qui font foi. Le prévisionnel et le réalisé calculés par le logiciel '
      + 'sont un CONTRÔLE et se consultent sur l\'écran Effectifs ETP.',
  };
}

/**
 * État des purges de rétention RGPD (2.44.0). Le registre `PURGES_RGPD` et le
 * calcul de rétention effective sont ceux du service partagé : le bot lit la
 * MÊME source que l'écran RGPD et que le travail planifié.
 *
 * JAMAIS le détail de ce qui a été purgé : une purge se prouve par son passage,
 * pas en réexposant ce qu'elle a effacé.
 */
async function etatPurgesRgpd() {
  const { PURGES_RGPD, retentionEffective } = require('./rgpd-purges');

  const noms = PURGES_RGPD.map((p) => p.jobName);
  const derniers = await soft(async () => (await pool.query(
    `SELECT DISTINCT ON (job_name) job_name, started_at, status, items_processed
       FROM job_runs WHERE job_name = ANY($1) ORDER BY job_name, started_at DESC`, [noms])), null, 'purges/job_runs');

  const parJob = derniers ? Object.fromEntries(derniers.rows.map((r) => [r.job_name, r])) : {};
  const purges = [];
  for (const p of PURGES_RGPD) {
    const d = parJob[p.jobName] || null;
    const retention = await soft(() => retentionEffective(p), null, `purges/retention/${p.cle}`);
    purges.push({
      purge: p.libelle,
      retention,
      jamais_execute: !d,
      dernier_passage: d ? d.started_at : null,
      dernier_statut: d ? d.status : null,
      lignes_traitees: d ? d.items_processed : null,
    });
  }

  const jamais = purges.filter((p) => p.jamais_execute);
  const enEchec = purges.filter((p) => p.dernier_statut && p.dernier_statut !== 'success');

  return {
    journal_disponible: derniers !== null,
    nb_purges: purges.length,
    nb_jamais_executees: jamais.length,
    nb_en_echec_au_dernier_passage: enEchec.length,
    purges,
    note: derniers === null
      ? 'Journal des travaux illisible : impossible de dire quand ces purges sont passées. '
        + '« Jamais exécuté » ci-dessus ne vaut donc PAS constat d\'absence de passage.'
      : 'Aucun détail des lignes supprimées n\'est consultable ici — seulement la preuve du passage.',
  };
}

/**
 * Mes pointages de badgeuse (module 33) — PORTÉE STRICTEMENT PERSONNELLE.
 *
 * Aucun paramètre d'identité n'est exposé au modèle : le salarié est résolu par
 * `employees.user_id = <appelant>` et rien d'autre. C'est plus strict que
 * `query_heures`, qui accepte un `employee_id` puis le refuse : ici il n'y a
 * rien à refuser, la question « les pointages de qui ? » ne peut pas être posée.
 *
 * PÉRIMÈTRE VOLONTAIREMENT COURT : la feuille de temps validée (le chiffre qui
 * fait foi) et un comptage brut. Le calcul des heures — appariement
 * entrée/sortie, corrections additives, pause monotone, fuseau — appartient au
 * moteur `badgeuse-engine` tel qu'il est appelé par le module ; le rejouer ici
 * donnerait un second décompte du temps de travail, et deux décomptes qui
 * divergent sur une paie, c'est pire que pas de bot du tout.
 */
async function mesPointagesBadgeuse({ periode } = {}, userCtx = {}) {
  const engine = require('./badgeuse-engine');
  const p = typeof periode === 'string' && /^\d{4}-\d{2}$/.test(periode.trim())
    ? periode.trim()
    : engine.parisDateStr(new Date()).slice(0, 7);

  return await soft(async () => {
    const emp = await pool.query(
      'SELECT id FROM employees WHERE user_id = $1 AND is_active = true', [userCtx.userId]);
    if (emp.rows.length === 0) {
      return {
        disponible: false,
        note: 'Aucune fiche salarié n\'est liée à ce compte : impossible de retrouver des pointages.',
      };
    }
    const employeeId = emp.rows[0].id;

    const feuille = await pool.query(
      `SELECT statut, heures_pointees::float AS heures_pointees, heures_validees::float AS heures_validees,
              heures_theoriques::float AS heures_theoriques, valide_rh_le
         FROM badgeuse_feuilles_temps WHERE employee_id = $1 AND periode = $2`, [employeeId, p]);

    const brut = await pool.query(
      `SELECT COUNT(*)::int AS n, MAX(horodatage_utc) AS dernier
         FROM badgeuse_pointages
        WHERE employee_id = $1
          AND ((horodatage_utc AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date
              BETWEEN ($2 || '-01')::date AND (($2 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')`,
      [employeeId, p]);

    const f = feuille.rows[0] || null;
    return {
      periode: p,
      nb_pointages: brut.rows[0].n,
      dernier_pointage: brut.rows[0].dernier,
      feuille_de_temps: f
        ? {
          statut: f.statut,
          heures_pointees: rd(f.heures_pointees),
          heures_validees: rd(f.heures_validees),
          heures_theoriques: rd(f.heures_theoriques),
          validee_rh_le: f.valide_rh_le,
        }
        : null,
      note_feuille: f ? null : 'Aucune feuille de temps établie pour cette période.',
      note: 'Le décompte qui fait foi est celui de l\'écran Temps & Présence : c\'est là que se lisent '
        + 'le détail jour par jour, les corrections et leur motif.',
    };
  }, { disponible: false, note: 'Pointages illisibles (module Temps & Présence non initialisé ?).' },
  'mes_pointages');
}

// ═══════════════════════════════════════════════════════════════════════════
// DÉFINITIONS EXPOSÉES AU MODÈLE
// ═══════════════════════════════════════════════════════════════════════════
//
// `roles: null` = outil de BASE (tout rôle authentifié) : il ne renvoie que des
// données non personnelles (plan de chaîne) ou les données PROPRES de
// l'appelant (pointages). Les autres portent la liste EXACTE du `READ` de leur
// routeur natif — cf. règle 2.

const SANS_PARAM = { type: 'object', properties: {}, required: [] };
const PARAM_ANNEE = {
  type: 'object',
  properties: { annee: { type: 'integer', description: 'Année (défaut : année en cours).' } },
  required: [],
};

const DEFINITIONS = [
  {
    name: 'layout_chaine_actif',
    roles: null,
    handler: layoutChaineActif,
    tool: {
      name: 'layout_chaine_actif',
      description: "Plan de la chaîne de tri actuellement ACTIF : nombre de postes, zones de dépose, entrées, et l'effectif mini/maxi de chaque poste. Aucune donnée personnelle.",
      input_schema: SANS_PARAM,
    },
  },
  {
    name: 'mes_pointages_badgeuse',
    roles: null,
    handler: mesPointagesBadgeuse,
    tool: {
      name: 'mes_pointages_badgeuse',
      description: "MES pointages de badgeuse (Temps & Présence) pour un mois : nombre de pointages, dernier pointage, et feuille de temps si elle est établie. Strictement personnel à l'utilisateur connecté — cet outil ne peut pas consulter les pointages de quelqu'un d'autre.",
      input_schema: {
        type: 'object',
        properties: { periode: { type: 'string', description: 'Mois au format AAAA-MM (défaut : mois en cours).' } },
        required: [],
      },
    },
  },
  {
    name: 'resume_vak_live',
    roles: ['ADMIN', 'MANAGER'],
    handler: resumeVakLive,
    tool: {
      name: 'resume_vak_live',
      description: "Vente Au Kilo EN COURS aujourd'hui : chiffre d'affaires du jour et depuis le début, poids vendu en kg, prix moyen au kilo, mix de paiement CB/espèces, atteinte des objectifs. Si aucune VAK n'a lieu aujourd'hui, indique la prochaine.",
      input_schema: SANS_PARAM,
    },
  },
  {
    name: 'resume_rse',
    roles: ['ADMIN', 'MANAGER', 'RH'],
    handler: resumeRse,
    tool: {
      name: 'resume_rse',
      description: "Avancement de la démarche de labellisation RSEi : critères cotés et démontrables au niveau 2, critères sans preuve récente, actions en retard, preuves périmées. Compteurs agrégés, jamais de nom de pilote.",
      input_schema: SANS_PARAM,
    },
  },
  {
    name: 'resume_energie_ges',
    roles: ['ADMIN', 'MANAGER', 'RH', 'QHSE'],
    handler: resumeEnergieGes,
    tool: {
      name: 'resume_energie_ges',
      description: "Bilan carbone annuel : tCO2e par poste (énergie des bâtiments, carburant de la flotte), intensité par millier d'euros de chiffre d'affaires, véhicules dont la consommation dérive. Précise si rien n'a été mesuré plutôt que d'annoncer zéro.",
      input_schema: PARAM_ANNEE,
    },
  },
  {
    name: 'resume_achats_responsables',
    roles: ['ADMIN', 'MANAGER', 'RH', 'QHSE'],
    handler: resumeAchatsResponsables,
    tool: {
      name: 'resume_achats_responsables',
      description: "Achats responsables : part de fournisseurs responsables (locaux, inclusifs, en démarche RSE, labellisés) et fiches de données de sécurité (FDS) manquantes ou périmées à renouveler.",
      input_schema: PARAM_ANNEE,
    },
  },
  {
    name: 'resultats_enquete',
    roles: ['ADMIN', 'MANAGER', 'RH', 'QHSE'],
    handler: resultatsEnquete,
    tool: {
      name: 'resultats_enquete',
      description: "Résultats AGRÉGÉS d'une campagne d'enquête anonyme close (QVCT, satisfaction…). Sans identifiant, prend la dernière campagne close. Sous 5 réponses, aucun résultat n'est restitué : c'est le seuil d'anonymat, il faut le dire tel quel.",
      input_schema: {
        type: 'object',
        properties: {
          campagne_id: { type: 'integer', description: "Identifiant de la campagne. Absent = la dernière campagne close." },
          categorie: { type: 'string', description: "Catégorie de questionnaire pour choisir la dernière campagne close de ce type." },
        },
        required: [],
      },
    },
  },
  {
    name: 'saturation_cav',
    roles: ['ADMIN', 'MANAGER'],
    handler: saturationCav,
    tool: {
      name: 'saturation_cav',
      description: "Bornes (CAV) que les prédictions annoncent proches de la saturation, avec la date de franchissement prévue et le fait qu'une tournée déjà planifiée les couvre ou non.",
      input_schema: {
        type: 'object',
        properties: { jours: { type: 'integer', description: "Horizon en jours (1 à 60, défaut 7)." } },
        required: [],
      },
    },
  },
  {
    name: 'arrets_gps_tournee',
    roles: ['ADMIN', 'MANAGER'],
    handler: arretsGpsTournee,
    tool: {
      name: 'arrets_gps_tournee',
      description: "Arrêts détectés par le GPS pendant une tournée donnée, en particulier ceux HORS PROGRAMME (rattachés à aucun point prévu) et leur durée cumulée. Utile pour comprendre pourquoi une tournée a duré longtemps.",
      input_schema: {
        type: 'object',
        properties: { tour_id: { type: 'integer', description: 'Numéro de la tournée.' } },
        required: ['tour_id'],
      },
    },
  },
  {
    name: 'echeances_commandes_recurrentes',
    roles: ['ADMIN', 'MANAGER'],
    handler: echeancesCommandesRecurrentes,
    tool: {
      name: 'echeances_commandes_recurrentes',
      description: "Commandes exutoires récurrentes arrivant à échéance, et créneaux de chargement qui restent à poser à la main. Simulation en lecture : rien n'est créé.",
      input_schema: {
        type: 'object',
        properties: { jours: { type: 'integer', description: "Horizon en jours (défaut : horizon paramétré, 30 j)." } },
        required: [],
      },
    },
  },
  {
    name: 'resume_effectifs_etp',
    roles: ['ADMIN', 'RH', 'MANAGER'],
    handler: resumeEffectifsEtp,
    tool: {
      name: 'resume_effectifs_etp',
      description: "Effectifs d'insertion conventionnés : ETP validés à l'ASP (le chiffre qui fait foi) mois par mois, cible de la convention et écart. Agrégats mensuels, aucun nom de salarié.",
      input_schema: {
        type: 'object',
        properties: {
          annee: { type: 'integer', description: 'Année (défaut : année en cours).' },
          mois: { type: 'integer', description: 'Mois 1-12 (défaut : le dernier mois validé).' },
        },
        required: [],
      },
    },
  },
  {
    name: 'etat_purges_rgpd',
    roles: ['ADMIN', 'DPO'],
    handler: etatPurgesRgpd,
    tool: {
      name: 'etat_purges_rgpd',
      description: "État des purges de rétention RGPD : durée de conservation appliquée, date du dernier passage de chaque purge, purges jamais exécutées ou en échec. Ne donne jamais le détail des données supprimées.",
      input_schema: SANS_PARAM,
    },
  },
];

/** Outils de base (tout rôle authentifié) — schémas prêts pour l'API. */
const BOT_BASE_TOOLS = DEFINITIONS.filter((d) => d.roles === null).map((d) => d.tool);

/** Outils filtrés par rôle — même forme que `EXTENDED_TOOLS` de chat.js. */
const BOT_EXTENDED_TOOLS = DEFINITIONS
  .filter((d) => d.roles !== null)
  .map((d) => ({ name: d.name, _roles: d.roles, tool: d.tool }));

const PAR_NOM = Object.fromEntries(DEFINITIONS.map((d) => [d.name, d]));

/**
 * Exécute un outil de ce service.
 *
 * @returns {Promise<string|null>} le résultat JSON, ou `null` si le nom n'est
 *   pas l'un des nôtres — auquel cas l'appelant garde la main (« outil inconnu »).
 *
 * Le contrôle de rôle N'EST PAS refait ici : il est fait deux fois en amont par
 * `routes/chat.js` (filtrage de la liste envoyée au modèle, puis revérification
 * indépendante contre `EXTENDED_TOOL_ROLES` avant l'exécution). Un troisième
 * contrôle avec sa propre table serait une troisième vérité à maintenir.
 */
async function executeBotTool(nom, entree, userCtx) {
  const def = PAR_NOM[nom];
  if (!def) return null;
  try {
    // Le contexte appelant est le SECOND argument : les outils à portée
    // personnelle (mes_pointages_badgeuse) y lisent l'identité, qui n'est
    // JAMAIS un paramètre offert au modèle.
    const res = await def.handler(entree || {}, userCtx || {});
    return JSON.stringify(res);
  } catch (err) {
    console.error(`[SolidataBot] Outil ${nom} en échec :`, err.message);
    return JSON.stringify({ error: 'Erreur lors de la requête en base de données.' });
  }
}

module.exports = {
  BOT_BASE_TOOLS,
  BOT_EXTENDED_TOOLS,
  executeBotTool,
  // Exposés pour les tests (contrat des outils, troncature).
  DEFINITIONS,
  MAX_DETAIL,
  extrait,
};
