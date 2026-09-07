/**
 * BORDEREAU DE COLLECTE EN DÉCHÈTERIE — logique partagée.
 *
 * Source UNIQUE de tout ce qui touche au bordereau Métropole ailleurs que dans
 * le dessin du document (`utils/bordereau-decheterie-pdf.js`, module pur) :
 *   - validation des entrées du chauffeur (poids, signatures PNG, motif) ;
 *   - numérotation `BD-AAAA-NNNN` ;
 *   - composition des données du PDF depuis une LIGNE de la table, donc une
 *     règle unique pour la création, la validation par le manager et
 *     l'anonymisation — trois chemins qui régénèrent le même document ;
 *   - projection `BordereauResume` (jamais de BYTEA dans une liste) ;
 *   - retrait de la signature du chauffeur à l'anonymisation d'un salarié.
 *
 * POURQUOI CE FICHIER PLUTÔT QUE DU CODE DANS LA ROUTE : la régénération du PDF
 * est demandée par TROIS appelants (la route de validation, le service
 * d'anonymisation, et demain toute reprise) ; recopiée, elle produirait des
 * documents qui divergent — or c'est une pièce signée par un tiers.
 *
 * DOCTRINE DE STOCKAGE : signatures et PDF vivent en base (BYTEA), jamais sous
 * `/uploads` — ce dossier est servi statiquement, une signature manuscrite y
 * serait accessible par URL.
 */

'use strict';

const { analyserPng } = require('../utils/png-signature');

const {
  DECHETERIES_METROPOLE,
  MOTIFS_SIGNATURE_ABSENTE,
  estDecheterieConnue,
  libelleDecheterie,
  estPngValide,
  genererBordereauPdf,
} = require('../utils/bordereau-decheterie-pdf');

// ══════════════════════════════════════════
// BORNES ET LISTES FERMÉES
// ══════════════════════════════════════════

/**
 * Taille maximale d'une signature DÉCODÉE. Une signature est un tracé au doigt
 * sur ≤ 600 × 220 px : quelques dizaines de Ko. La borne existe pour qu'un
 * client mal réglé (ou hostile) ne dépose pas une photo en guise de signature —
 * c'est ce qui rend acceptable la mise en file hors ligne de ces blobs.
 */
const SIGNATURE_MAX_OCTETS = 200 * 1024;

/** Poids indicatif : borné comme la colonne (CHECK 0 … 60 000). */
const POIDS_MAX_KG = 60000;

/** Longueur maximale de `client_id` (colonne VARCHAR(64)). */
const CLIENT_ID_MAX = 64;

/**
 * Motif d'absence de la signature de l'AGENT, liste FERMÉE (arbitrage client
 * Q2 du 06/09/2026). `anonymisation` n'en fait pas partie : il est posé par le
 * serveur sur la signature du CHAUFFEUR, jamais déclaré par le mobile.
 */
const MOTIFS_AGENT_ABSENT = Object.freeze(['agent_indisponible']);

/** Motif posé par le serveur quand la signature du chauffeur est retirée. */
const MOTIF_ANONYMISATION = 'anonymisation';

// ══════════════════════════════════════════
// NORMALISATION DE COMMUNE (garde du seed)
// ══════════════════════════════════════════

/**
 * Ramène un nom de commune à une forme comparable : casse, accents, tirets et
 * espaces multiples, apostrophes typographiques. FONCTION PURE, exportée et
 * testée — c'est elle qui empêche le seed de marquer « Déchetterie » sur un CAV
 * dont l'identifiant serait décalé d'une base à l'autre.
 *
 *   « Caudebec-lès-Elbeuf » ≡ « CAUDEBEC LES ELBEUF » ≡ « caudebec lès elbeuf »
 *
 * Les tirets DEVIENNENT des espaces (le référentiel Métropole écrit « Caudebec
 * lès Elbeuf », le référentiel CAV « CAUDEBEC-LÈS-ELBEUF ») ; l'article initial
 * n'est jamais retiré (« Le Trait » reste « le trait »).
 */
function normaliserCommune(valeur) {
  if (valeur == null) return '';
  return String(valeur)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')     // accents
    .replace(/[‘’']/g, ' ')    // apostrophes (typographiques comprises)
    .replace(/[-_/]+/g, ' ')             // tirets et séparateurs → espace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ══════════════════════════════════════════
// VALIDATION DES ENTRÉES DU CHAUFFEUR
// ══════════════════════════════════════════

/**
 * Poids indicatif déclaré. Renvoie `{ ok, valeur }` — jamais une valeur de
 * remplacement : un poids illisible est REFUSÉ (4xx), pas remplacé par zéro.
 * Zéro reste une valeur valide (« rien à charger, bordereau tout de même »).
 */
function validerPoids(brut) {
  if (brut === null || brut === undefined || brut === '') return { ok: false };
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0 || n > POIDS_MAX_KG) return { ok: false };
  // Une décimale : la colonne est NUMERIC(8,1).
  return { ok: true, valeur: Math.round(n * 10) / 10 };
}

/**
 * Décode une data URL PNG en Buffer.
 * @returns {{ok: true, buffer: Buffer} | {ok: false, motif: string}}
 *
 * Trois refus distincts, tous en 4xx : ce n'est pas une data URL PNG, le base64
 * est illisible, ou l'image dépasse la borne. Le contenu n'est jamais
 * « réparé » : un PNG douteux qui atterrirait dans le document signé serait
 * pire qu'un refus net que la file mobile purge.
 */
function decoderSignature(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) return { ok: false, motif: 'absente' };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) return { ok: false, motif: 'format' };
  const base64 = m[1].replace(/\s+/g, '');
  // Borne AVANT décodage : 4 caractères base64 ≈ 3 octets. Refuser tôt évite
  // d'allouer une image de plusieurs Mo pour la rejeter ensuite.
  if (base64.length > Math.ceil((SIGNATURE_MAX_OCTETS + 1) / 3) * 4 + 8) {
    return { ok: false, motif: 'taille' };
  }
  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch (_) {
    return { ok: false, motif: 'format' };
  }
  if (buf.length > SIGNATURE_MAX_OCTETS) return { ok: false, motif: 'taille' };
  if (!estPngValide(buf)) return { ok: false, motif: 'format' };
  // Analyse STRICTE (chunks, CRC, dimensions bornées, IDAT décompressé à la
  // taille exacte) : c'est elle, et non les 4 octets magiques, qui empêche un
  // PNG forgé de tuer le processus ou de saturer la mémoire dans pdfkit
  // (revue de sécurité 06/09/2026, C-01/C-02).
  const analyse = analyserPng(buf);
  if (!analyse.ok) return { ok: false, motif: analyse.motif };
  return { ok: true, buffer: buf };
}

/** true si le motif d'absence de signature d'agent est de la liste fermée. */
function motifAgentValide(motif) {
  return typeof motif === 'string' && MOTIFS_AGENT_ABSENT.includes(motif);
}

/** `client_id` d'idempotence : chaîne non vide, ≤ 64 caractères. */
function validerClientId(brut) {
  if (typeof brut !== 'string') return { ok: false };
  const v = brut.trim();
  if (!v || v.length > CLIENT_ID_MAX) return { ok: false };
  return { ok: true, valeur: v };
}

// ══════════════════════════════════════════
// NUMÉROTATION BD-AAAA-NNNN
// ══════════════════════════════════════════

/**
 * Prochain numéro de bordereau de l'année (MAX + 1, séquentiel).
 *
 * Le tri est fait sur le numéro complet : le suffixe étant à largeur FIXE
 * (4 chiffres, zéro-padding), l'ordre lexicographique et l'ordre numérique
 * coïncident — c'est ce que suppose `ORDER BY numero DESC`, et c'est pourquoi
 * le padding n'est pas cosmétique.
 *
 * La contrainte d'unicité de la colonne reste l'arbitre : deux dépôts
 * simultanés obtiendraient le même numéro, l'un des deux serait rejeté en
 * 23505 et l'appelant relance (retry unique côté route).
 */
async function numeroSuivant(db, annee = new Date().getFullYear()) {
  const r = await db.query(
    'SELECT numero FROM tour_decheterie_bordereaux WHERE numero LIKE $1 ORDER BY numero DESC LIMIT 1',
    [`BD-${annee}-%`]
  );
  let seq = 1;
  const dernier = r.rows[0] && r.rows[0].numero;
  if (dernier) {
    const m = /-(\d+)$/.exec(String(dernier));
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `BD-${annee}-${String(seq).padStart(4, '0')}`;
}

// ══════════════════════════════════════════
// COMPOSITION ET GÉNÉRATION DU PDF
// ══════════════════════════════════════════

/**
 * Libellé de déchèterie retenu au moment de la collecte (SNAPSHOT).
 * Un code connu prend le libellé du formulaire ; hors liste, on garde le nom du
 * point tel qu'il est au référentiel — jamais une case cochée au hasard.
 */
function libelleSnapshot(decheterieCode, cavNom) {
  const l = decheterieCode ? libelleDecheterie(decheterieCode) : null;
  return l || (cavNom ? String(cavNom).slice(0, 255) : 'Déchèterie');
}

/**
 * Données du PDF composées depuis une LIGNE de `tour_decheterie_bordereaux`
 * (jointe à la tournée/au véhicule pour le pied de page). Fonction PURE.
 *
 * Le bloc Remarque(s) reçoit le nom en clair de la déchèterie UNIQUEMENT quand
 * elle est hors des 7 cases du formulaire : dans ce cas le document ne peut
 * désigner le lieu autrement, et le laisser muet rendrait le bordereau
 * inexploitable par la Métropole.
 */
function composerDonneesPdf(ligne, options = {}) {
  const code = estDecheterieConnue(ligne.decheterie_code) ? ligne.decheterie_code : null;
  const horsListe = code ? null : (ligne.decheterie_libelle || ligne.cav_nom || null);
  const valide = ligne.statut === 'valide' || options.validation != null;
  const dateValidation = (options.validation && options.validation.date) || ligne.valide_le || null;

  return {
    date_enlevement: ligne.date_enlevement,
    decheterie_code: code,
    decheterie_libelle_libre: horsListe,
    tlc_kg: ligne.poids_indicatif_kg,
    signature_agent: ligne.signature_agent || null,
    signature_agent_absente_motif: ligne.signature_agent_absente_motif || null,
    signature_chauffeur: ligne.signature_chauffeur || null,
    signature_chauffeur_absente_motif: ligne.signature_chauffeur_absente_motif || null,
    remarques: ligne.remarques || null,
    validation: valide && dateValidation ? { date: dateValidation } : null,
    meta: {
      numero: ligne.numero,
      tour_id: ligne.tour_id,
      vehicule: ligne.vehicule || ligne.registration || null,
      cav_nom: ligne.cav_nom || null,
      genere_le: options.genereLe || new Date(),
    },
  };
}

/** Génère (ou régénère) le PDF d'une ligne de bordereau. */
async function genererPdfDepuisLigne(ligne, options = {}) {
  return genererBordereauPdf(composerDonneesPdf(ligne, options));
}

/**
 * Colonnes nécessaires pour composer un PDF ET un résumé. Écrites une fois : un
 * SELECT qui oublierait `signature_agent` régénérerait un document où la
 * signature d'un tiers aurait DISPARU sans que rien ne le dise.
 */
const COLONNES_COMPLETES = `b.id, b.numero, b.tour_id, b.tour_cav_id, b.cav_id, b.vehicle_id,
       b.driver_employee_id, b.client_id, b.date_enlevement, b.decheterie_code,
       b.decheterie_libelle, b.cav_nom, b.poids_indicatif_kg,
       b.signature_agent, b.signature_agent_absente_motif,
       b.signature_chauffeur, b.signature_chauffeur_absente_motif,
       b.remarques, b.statut, b.pdf_genere_le, b.valide_par, b.valide_le, b.created_at`;

/**
 * Idem, SANS les BYTEA — pour les listes (contrat : jamais de blob dans une
 * liste). Deux formes du MÊME jeu de colonnes : préfixée `b.` pour les SELECT
 * joints, nue pour les clauses RETURNING (où l'alias de table n'existe pas).
 * Écrire la seconde par substitution textuelle de la première serait joli et
 * fragile — un jour une colonne s'appellera « web.…» et la substitution la
 * mangera.
 */
const COLONNES_RESUME_NUES = `id, numero, tour_id, tour_cav_id, cav_id, vehicle_id,
       date_enlevement, decheterie_code, decheterie_libelle, cav_nom,
       poids_indicatif_kg,
       (signature_agent IS NOT NULL) AS signature_agent_presente,
       signature_agent_absente_motif,
       (signature_chauffeur IS NOT NULL) AS signature_chauffeur_presente,
       signature_chauffeur_absente_motif,
       statut, valide_le, pdf_genere_le, created_at`;

const COLONNES_RESUME = `b.id, b.numero, b.tour_id, b.tour_cav_id, b.cav_id, b.vehicle_id,
       b.date_enlevement, b.decheterie_code, b.decheterie_libelle, b.cav_nom,
       b.poids_indicatif_kg,
       (b.signature_agent IS NOT NULL) AS signature_agent_presente,
       b.signature_agent_absente_motif,
       (b.signature_chauffeur IS NOT NULL) AS signature_chauffeur_presente,
       b.signature_chauffeur_absente_motif,
       b.statut, b.valide_le, b.pdf_genere_le, b.created_at`;

/**
 * Projection `BordereauResume` (contrat §2.3). Le poids repasse en NOMBRE :
 * PostgreSQL rend un NUMERIC en chaîne, et un écran qui compare des chaînes
 * finit par afficher « 1000 » avant « 185 ».
 */
function projeterResume(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    numero: row.numero,
    tour_id: row.tour_id,
    cav_id: row.cav_id,
    cav_nom: row.cav_nom || null,
    decheterie_code: row.decheterie_code || null,
    decheterie_libelle: row.decheterie_libelle,
    date_enlevement: row.date_enlevement,
    poids_indicatif_kg: row.poids_indicatif_kg == null ? null : Number(row.poids_indicatif_kg),
    signature_agent_presente: row.signature_agent_presente === true
      || (row.signature_agent != null && row.signature_agent_presente === undefined),
    signature_agent_absente_motif: row.signature_agent_absente_motif || null,
    signature_chauffeur_presente: row.signature_chauffeur_presente === true
      || (row.signature_chauffeur != null && row.signature_chauffeur_presente === undefined),
    signature_chauffeur_absente_motif: row.signature_chauffeur_absente_motif || null,
    statut: row.statut,
    valide_par_nom: row.valide_par_nom || null,
    valide_le: row.valide_le || null,
    pdf_genere_le: row.pdf_genere_le || null,
    created_at: row.created_at || null,
    ...extra,
  };
}

// ══════════════════════════════════════════
// ANONYMISATION
// ══════════════════════════════════════════

/**
 * Retire la signature du CHAUFFEUR des bordereaux d'un salarié anonymisé.
 *
 * La ligne est CONSERVÉE : le bordereau est une pièce contractuelle remise à la
 * Métropole, et la signature de l'AGENT de déchèterie appartient à un tiers
 * dont le droit à l'effacement ne s'exerce pas ici. Ce qui disparaît, c'est la
 * signature manuscrite du salarié et son rattachement (`driver_employee_id`).
 * Le PDF est RÉGÉNÉRÉ pour que le document stocké dise « Signature retirée
 * (anonymisation du salarié) » plutôt que de continuer à porter le tracé.
 *
 * Résilient comme le reste du service d'anonymisation : table absente (base non
 * migrée) → on passe, sans faire échouer toute l'anonymisation.
 *
 * @param {import('pg').PoolClient} client  client dans une transaction ouverte
 * @param {number|string} employeeId
 * @returns {Promise<{traites: number, pdf_regeneres: number}>}
 */
async function retirerSignatureChauffeur(client, employeeId) {
  const bilan = { traites: 0, pdf_regeneres: 0 };
  try {
    const presente = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tour_decheterie_bordereaux'`
    );
    if (presente.rows.length === 0) return bilan;
  } catch (_) {
    return bilan;
  }

  const r = await client.query(
    `SELECT ${COLONNES_COMPLETES}, v.registration AS vehicule
       FROM tour_decheterie_bordereaux b
       LEFT JOIN vehicles v ON v.id = b.vehicle_id
      WHERE b.driver_employee_id = $1`,
    [employeeId]
  );

  for (const ligne of r.rows) {
    bilan.traites += 1;
    const neutralisee = {
      ...ligne,
      signature_chauffeur: null,
      signature_chauffeur_absente_motif: MOTIF_ANONYMISATION,
    };
    let pdf = null;
    try {
      pdf = await genererPdfDepuisLigne(neutralisee);
    } catch (err) {
      // Un PDF non régénérable ne doit pas empêcher le RETRAIT de la signature :
      // l'effacement prime, le document sera régénéré à la prochaine validation.
      console.warn(`[BORDEREAU] PDF non régénéré pour ${ligne.numero} : ${err.message}`);
    }
    if (pdf) {
      await client.query(
        `UPDATE tour_decheterie_bordereaux
            SET signature_chauffeur = NULL,
                signature_chauffeur_absente_motif = $1,
                driver_employee_id = NULL,
                pdf = $2, pdf_genere_le = NOW()
          WHERE id = $3`,
        [MOTIF_ANONYMISATION, pdf, ligne.id]
      );
      bilan.pdf_regeneres += 1;
    } else {
      await client.query(
        `UPDATE tour_decheterie_bordereaux
            SET signature_chauffeur = NULL,
                signature_chauffeur_absente_motif = $1,
                driver_employee_id = NULL
          WHERE id = $2`,
        [MOTIF_ANONYMISATION, ligne.id]
      );
    }
  }
  return bilan;
}

module.exports = {
  // Référentiel (ré-exporté pour que les appelants n'aient pas à connaître le
  // module de dessin du PDF).
  DECHETERIES_METROPOLE,
  MOTIFS_SIGNATURE_ABSENTE,
  MOTIFS_AGENT_ABSENT,
  MOTIF_ANONYMISATION,
  estDecheterieConnue,
  libelleDecheterie,
  // Bornes
  SIGNATURE_MAX_OCTETS,
  POIDS_MAX_KG,
  CLIENT_ID_MAX,
  // Fonctions pures
  normaliserCommune,
  validerPoids,
  decoderSignature,
  motifAgentValide,
  validerClientId,
  libelleSnapshot,
  composerDonneesPdf,
  projeterResume,
  // Accès base
  numeroSuivant,
  genererPdfDepuisLigne,
  retirerSignatureChauffeur,
  COLONNES_COMPLETES,
  COLONNES_RESUME,
  COLONNES_RESUME_NUES,
};
