const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireModule } = require('../middleware/module-access');
const {
  composerCode, formeLisible, analyserCode, LIBELLES_FORMAT, REFERENCE_MAX,
} = require('../utils/codification-etiquettes');

router.use(authenticate);

// ══════════════════════════════════════════
// HABILITATION « ÉTIQUETTES »
// ──────────────────────────────────────────
// La clé 'etiquettes' de la matrice /admin/permissions gouverne l'écran
// /tri/etiquettes : `etiquettesHabilitees` est posé sur chaque route que cet
// écran appelle. Elle vient EN PLUS d'`authorize` : le rôle dit qui peut voir
// l'écran, l'habilitation dit si ce rôle-là l'a encore.
//
// La SORTIE DE CARTONS a quitté ce routeur (2.57.0) pour `routes/sortie-cartons.js`
// et sa propre habilitation `sortie_cartons` : scanner un carton pour le sortir
// du stock n'est pas fabriquer une étiquette.
//
// Les routes /admin/* restent réservées à l'ADMIN, que la matrice ne restreint
// jamais (anti-lockout).
// ══════════════════════════════════════════
const etiquettesHabilitees = requireModule('etiquettes');

// Rôles « opérateur » (contrat 2.57.0 § 2). OPERATEUR_STOCK n'apparaît dans
// AUCUNE autre liste d'habilitation que celles de l'étiquetage et de la sortie.
const ROLES_OPERATEUR = ['ADMIN', 'COLLABORATEUR', 'OPERATEUR_STOCK'];
const operateur = authorize(...ROLES_OPERATEUR);

const POIDS_MAX_KG = 1000;
const TYPES_DIMENSION = ['gamme', 'categorie_eco_org', 'genre', 'saison'];
// Bornes des codes par type : largeur du champ dans le code hexadécimal
// (gamme/catégorie/saison sur 1 caractère, genre sur 2). Gamme et catégorie
// commencent à 1 — le 0 y est réservé.
// Longueurs des colonnes de `produits_finis` (gamme 20, saison 20, genre 50,
// catégorie 100) — cf. POST /admin/dimensions.
const LONGUEUR_MAX_VALEUR = { gamme: 20, saison: 20, genre: 50, categorie_eco_org: 100 };
const BORNES_CODE = {
  gamme: [1, 15],
  categorie_eco_org: [1, 15],
  saison: [0, 15],
  genre: [0, 255],
};

// ══════════════════════════════════════════
// Combinaisons VALIDES — SOURCE UNIQUE de la jointure
// ──────────────────────────────────────────
// Une combinaison n'est servie (et n'est acceptée à la génération) que si elle
// est active ET si chacune de ses dimensions est active ET porte un code : sans
// code, on ne saurait pas composer le code-barres. Le même fragment sert le
// référentiel de l'écran et la validation serveur, pour qu'ils ne puissent pas
// diverger (un choix proposé à l'écran serait refusé, ou l'inverse).
// ══════════════════════════════════════════
const SQL_COMBINAISONS_VALIDES = `
  SELECT c.id AS combinaison_id, c.gamme, c.categorie_eco_org, c.produit_id, p.nom AS produit,
         c.genre, c.saison,
         dg.code AS gamme_code, dc.code AS categorie_code, p.code AS produit_code,
         dn.code AS genre_code, ds.code AS saison_code,
         dg.ordre AS gamme_ordre, dc.ordre AS categorie_ordre, dn.ordre AS genre_ordre, ds.ordre AS saison_ordre
  FROM etiquettes_combinaisons c
  JOIN etiquettes_produits p ON p.id = c.produit_id AND p.is_active = true
  JOIN ref_dimensions dg ON dg.type = 'gamme' AND dg.valeur = c.gamme
       AND dg.is_active = true AND dg.code IS NOT NULL
  JOIN ref_dimensions dc ON dc.type = 'categorie_eco_org' AND dc.valeur = c.categorie_eco_org
       AND dc.is_active = true AND dc.code IS NOT NULL
  JOIN ref_dimensions dn ON dn.type = 'genre' AND dn.valeur = c.genre
       AND dn.is_active = true AND dn.code IS NOT NULL
  JOIN ref_dimensions ds ON ds.type = 'saison' AND ds.valeur = c.saison
       AND ds.is_active = true AND ds.code IS NOT NULL
  WHERE c.is_active = true`;

/** Erreur métier traduite en HTTP par l'appelant. */
function erreurPf(status, message, code) {
  const e = new Error(message);
  e.pfStatus = status;
  if (code) e.pfCode = code;
  return e;
}

/** Texte non vide, sinon null. */
function texte(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Entier strictement positif, sinon null. */
function entierPositif(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Validation du corps de génération — partagée par /generer et la voie manuelle
 * (POST /api/produits-finis). Pure : ne touche pas la base.
 * @returns {{ ok: true, valeurs: object } | { ok: false, error: string }}
 */
function validerCorpsGeneration(body) {
  const b = body || {};
  const valeurs = {
    poste_id: entierPositif(b.poste_id),
    gamme: texte(b.gamme),
    categorie_eco_org: texte(b.categorie_eco_org),
    produit_id: entierPositif(b.produit_id),
    genre: texte(b.genre),
    saison: texte(b.saison),
    poids_kg: Number(b.poids_kg),
    batch_id: (b.batch_id === undefined || b.batch_id === null || b.batch_id === '') ? null : b.batch_id,
  };
  const manquants = ['poste_id', 'gamme', 'categorie_eco_org', 'produit_id', 'genre', 'saison']
    .filter((k) => valeurs[k] === null);
  if (manquants.length) {
    return { ok: false, error: `Champ(s) manquant(s) ou invalide(s) : ${manquants.join(', ')}` };
  }
  if (b.poids_kg === null || b.poids_kg === undefined || b.poids_kg === ''
      || !Number.isFinite(valeurs.poids_kg) || valeurs.poids_kg <= 0 || valeurs.poids_kg > POIDS_MAX_KG) {
    return { ok: false, error: `poids_kg doit être un nombre strictement positif et au plus ${POIDS_MAX_KG} kg` };
  }
  if (valeurs.batch_id !== null && entierPositif(valeurs.batch_id) === null) {
    return { ok: false, error: 'batch_id invalide' };
  }
  return { ok: true, valeurs };
}

/**
 * Cherche la combinaison ACTIVE et entièrement codifiée. Toujours côté serveur :
 * l'écran ne propose que des combinaisons valides, mais ce n'est pas lui qui
 * décide — une requête forgée ne doit pas pouvoir imprimer un code bâtard.
 */
async function trouverCombinaison(db, { gamme, categorie_eco_org, produit_id, genre, saison }) {
  const r = await db.query(
    `${SQL_COMBINAISONS_VALIDES}
       AND c.gamme = $1 AND c.categorie_eco_org = $2 AND c.produit_id = $3
       AND c.genre = $4 AND c.saison = $5
     LIMIT 1`,
    [gamme, categorie_eco_org, produit_id, genre, saison]
  );
  return r.rows[0] || null;
}

/** Forme « carton » renvoyée par /generer, /reimprimer et /carton/:code. */
function formaterCarton(row, extra = {}) {
  return {
    id: row.id,
    code_barre: row.code_barre,
    code_lisible: row.code_barre ? formeLisible(row.code_barre) : row.code_barre,
    codification: row.codification || null,
    reference_colis: row.reference_colis ?? null,
    produit: row.produit ?? null,
    categorie_eco_org: row.categorie_eco_org ?? null,
    genre: row.genre ?? null,
    saison: row.saison ?? null,
    gamme: row.gamme ?? null,
    poids_kg: row.poids_kg !== undefined && row.poids_kg !== null ? Number(row.poids_kg) : null,
    date_fabrication: row.date_fabrication ?? null,
    batch_id: row.batch_id ?? null,
    poste_label: row.numero_poste !== undefined && row.numero_poste !== null ? `Poste ${row.numero_poste}` : (row.poste_label ?? null),
    poste_etiquetage_id: row.poste_etiquetage_id ?? null,
    nb_impressions: row.nb_impressions !== undefined && row.nb_impressions !== null ? Number(row.nb_impressions) : null,
    ...extra,
  };
}

// ══════════════════════════════════════════
// Générateur de produit fini — SOURCE UNIQUE
// Réutilisé par la voie « étiquette » (/generer) ET la voie « manuel »
// (routes/produits-finis.js). Doit être appelé DANS une transaction (client).
// Lève une erreur enrichie { pfStatus, pfCode } que l'appelant traduit en HTTP.
//
// Code-barres v2 (2.57.0) : Gamme → Catégorie → Produit → Genre → Saison +
// référence unique de colis tirée d'une séquence PostgreSQL. Le compteur base24
// du poste n'est plus incrémenté : l'unicité ne dépend plus du poste.
// `codification = 'v2'` est TOUJOURS écrit explicitement — le filet de la
// migration (classement d'après la forme du code) n'est qu'un filet.
// ══════════════════════════════════════════
async function generateProduitFini(client, {
  poste_id, gamme, categorie_eco_org, produit_id, genre, saison, poids_kg,
  batch_id, created_by, source = 'etiquette',
}) {
  const combi = await trouverCombinaison(client, { gamme, categorie_eco_org, produit_id, genre, saison });
  if (!combi) {
    throw erreurPf(400, 'Combinaison invalide : ce produit n’est pas autorisé dans cette gamme, catégorie, genre et saison (ou une valeur a été désactivée).', 'COMBINAISON_INVALIDE');
  }

  const poste = await client.query(
    `SELECT id, numero_poste FROM postes_etiquetage WHERE id = $1 AND is_active = true FOR UPDATE`,
    [poste_id]
  );
  if (poste.rowCount === 0) throw erreurPf(404, 'Poste introuvable ou inactif', 'POSTE_INTROUVABLE');

  // Traçabilité carton → lot (optionnel) : uniquement un lot ouvert.
  let linkedBatchId = null;
  if (batch_id !== undefined && batch_id !== null && batch_id !== '') {
    const batch = await client.query(
      `SELECT id FROM batch_tracking WHERE id = $1 AND status IN ('en_attente', 'en_cours')`,
      [batch_id]
    );
    if (batch.rowCount === 0) throw erreurPf(400, 'Lot introuvable ou déjà clôturé (batch_id)', 'LOT_FERME');
    linkedBatchId = batch.rows[0].id;
  }

  let reference;
  try {
    const seq = await client.query(`SELECT nextval('produits_finis_reference_seq') AS ref`);
    reference = Number(seq.rows[0].ref);
  } catch (e) {
    // 2200H : séquence arrivée à son MAXVALUE (16 777 215 cartons).
    if (e.code === '2200H') throw erreurPf(409, 'Références de colis épuisées', 'REFERENCES_EPUISEES');
    throw e;
  }
  if (!Number.isInteger(reference) || reference < 1 || reference > REFERENCE_MAX) {
    throw erreurPf(409, 'Références de colis épuisées', 'REFERENCES_EPUISEES');
  }

  const code_barre = composerCode({
    gamme: Number(combi.gamme_code),
    categorie: Number(combi.categorie_code),
    produit: Number(combi.produit_code),
    genre: Number(combi.genre_code),
    saison: Number(combi.saison_code),
    reference,
  });

  // Le tuple est toujours complet désormais (nom, catégorie, genre, saison,
  // gamme) : le rattachement au catalogue historique est donc toujours possible.
  let catalogue_id = null;
  const catParams = [combi.produit, combi.categorie_eco_org, combi.genre, combi.saison, combi.gamme];
  const cat = await client.query(
    `SELECT id FROM produits_catalogue
     WHERE nom = $1 AND categorie_eco_org = $2 AND genre = $3 AND saison = $4 AND gamme = $5
     LIMIT 1`,
    catParams
  );
  if (cat.rowCount > 0) {
    catalogue_id = cat.rows[0].id;
  } else {
    const ins = await client.query(
      `INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT DO NOTHING RETURNING id`,
      catParams
    );
    if (ins.rowCount > 0) {
      catalogue_id = ins.rows[0].id;
    } else {
      const again = await client.query(
        `SELECT id FROM produits_catalogue
         WHERE nom = $1 AND categorie_eco_org = $2 AND genre = $3 AND saison = $4 AND gamme = $5
         LIMIT 1`,
        catParams
      );
      catalogue_id = again.rows[0]?.id ?? null;
    }
  }

  const insert = await client.query(
    `INSERT INTO produits_finis
       (code_barre, catalogue_id, produit, categorie_eco_org, genre, saison, gamme,
        poids_kg, date_fabrication, poste_etiquetage_id, status, batch_id, created_by, source,
        codification, reference_colis, combinaison_id, nb_impressions, derniere_impression_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, 'en_stock', $10, $11, $12,
             'v2', $13, $14, 1, NOW())
     RETURNING id, code_barre, codification, reference_colis, produit, categorie_eco_org, genre,
               saison, gamme, poids_kg, date_fabrication, batch_id, poste_etiquetage_id, nb_impressions`,
    [code_barre, catalogue_id, combi.produit, combi.categorie_eco_org, combi.genre, combi.saison, combi.gamme,
      Number(poids_kg), poste_id, linkedBatchId, created_by ?? null, source,
      reference, combi.combinaison_id]
  );
  const row = insert.rows[0];

  await client.query(
    `INSERT INTO etiquettes_impressions (produit_fini_id, type, poste_etiquetage_id)
     VALUES ($1, 'creation', $2)`,
    [row.id, poste_id]
  );

  await client.query(
    `UPDATE postes_etiquetage SET derniere_etiquette_at = NOW() WHERE id = $1`,
    [poste_id]
  );

  return {
    row,
    carton: formaterCarton({ ...row, numero_poste: poste.rows[0].numero_poste }),
    poste_label: `Poste ${poste.rows[0].numero_poste}`,
    numero_poste: poste.rows[0].numero_poste,
  };
}

/** Traduit une erreur du générateur en réponse HTTP. */
function repondreErreurGeneration(res, err) {
  if (err.pfStatus) {
    return res.status(err.pfStatus).json({ error: err.message, ...(err.pfCode ? { code: err.pfCode } : {}) });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Code-barres déjà existant', code: 'DUPLICATE' });
  }
  console.error('[ETIQUETTES] Erreur génération :', err);
  return res.status(500).json({ error: 'Erreur serveur' });
}

// ══════════════════════════════════════════
// Lecture
// ══════════════════════════════════════════

// Audit 2.57.0 : ces trois lectures n'avaient que l'habilitation de module, pas
// de rôle — n'importe quel compte connecté (RH, DPO, AUTORITE…) les lisait.
// Contrat § 2 : « toutes les routes : rôles opérateur ». Aucune surface ne se
// ferme pour les écrans (étiquetage : opérateur ; produits finis : ADMIN).
router.get('/postes', operateur, etiquettesHabilitees, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, numero_poste, nom, compteur_actuel, is_active, derniere_etiquette_at
       FROM postes_etiquetage WHERE is_active = true ORDER BY numero_poste`
    );
    res.json(rows);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur postes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Compatibilité : plus appelée par les écrans depuis la 2.57.0.
router.get('/options', operateur, etiquettesHabilitees, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT MIN(id) AS id, nom, categorie_eco_org
       FROM produits_catalogue WHERE is_active = true
       GROUP BY nom, categorie_eco_org
       ORDER BY categorie_eco_org, nom`
    );
    res.json(rows);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur options :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lots ouverts (en_attente/en_cours) pour le sélecteur d'étiquetage.
router.get('/lots-actifs', operateur, etiquettesHabilitees, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT bt.id, bt.code, bt.status, ct.nom AS chaine_nom
       FROM batch_tracking bt
       LEFT JOIN chaines_tri ct ON bt.chaine_id = ct.id
       WHERE bt.status IN ('en_attente', 'en_cours')
       ORDER BY bt.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur lots actifs :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Compatibilité : plus appelée par les écrans depuis la 2.57.0.
// `categories_sans_declinaison` est désormais vide : l'Upcycling est une
// combinaison ordinaire (gamme UP, produit « Upcycling », Sans Genre, Sans
// Saison) — il n'y a plus de catégorie qui se passe de déclinaisons à la saisie.
router.get('/dimensions', operateur, etiquettesHabilitees, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, valeur, ordre FROM ref_dimensions
       WHERE is_active = true ORDER BY type, ordre, valeur`
    );
    const out = { categorie_eco_org: [], genre: [], saison: [], gamme: [] };
    for (const r of rows) if (out[r.type]) out[r.type].push(r.valeur);
    out.categories_sans_declinaison = [];
    res.json(out);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur dimensions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Référentiel de saisie (2.57.0) : uniquement ce qui est actif ET codifié.
router.get('/referentiel', operateur, etiquettesHabilitees, async (req, res) => {
  try {
    const [dims, produits, combis] = await Promise.all([
      pool.query(
        `SELECT type, valeur, code, definition FROM ref_dimensions
         WHERE is_active = true AND code IS NOT NULL
         ORDER BY type, ordre, valeur`
      ),
      pool.query(
        `SELECT id, nom, code FROM etiquettes_produits WHERE is_active = true ORDER BY nom`
      ),
      pool.query(
        `${SQL_COMBINAISONS_VALIDES}
         ORDER BY gamme_ordre, c.gamme, categorie_ordre, c.categorie_eco_org, p.nom, genre_ordre, c.genre, saison_ordre, c.saison`
      ),
    ]);
    const out = { gammes: [], categories: [], genres: [], saisons: [], produits: [], combinaisons: [] };
    for (const d of dims.rows) {
      const code = Number(d.code);
      if (d.type === 'gamme') out.gammes.push({ valeur: d.valeur, code, definition: d.definition ?? null });
      else if (d.type === 'categorie_eco_org') out.categories.push({ valeur: d.valeur, code });
      else if (d.type === 'genre') out.genres.push({ valeur: d.valeur, code });
      else if (d.type === 'saison') out.saisons.push({ valeur: d.valeur, code });
    }
    out.produits = produits.rows.map((p) => ({ id: p.id, nom: p.nom, code: Number(p.code) }));
    out.combinaisons = combis.rows.map((c) => ({
      id: c.combinaison_id,
      gamme: c.gamme,
      categorie_eco_org: c.categorie_eco_org,
      produit_id: c.produit_id,
      produit: c.produit,
      genre: c.genre,
      saison: c.saison,
    }));
    res.json(out);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur référentiel :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// Génération
// ══════════════════════════════════════════
router.post('/generer', operateur, etiquettesHabilitees, async (req, res) => {
  const v = validerCorpsGeneration(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error, code: 'PARAMETRES' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { carton } = await generateProduitFini(client, {
      ...v.valeurs, created_by: req.user.id ?? null, source: 'etiquette',
    });
    await client.query('COMMIT');
    res.status(201).json(carton);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreurGeneration(res, err);
  } finally {
    client.release();
  }
});

/** Candidats de recherche d'un code lu : forme normalisée, puis forme brute (filet). */
function candidatsCode(brut, normalise) {
  const brutPropre = String(brut ?? '').trim();
  return [...new Set([normalise, brutPropre].filter(Boolean))];
}

const COLONNES_CARTON = `pf.id, pf.code_barre, pf.codification, pf.reference_colis, pf.produit,
  pf.categorie_eco_org, pf.genre, pf.saison, pf.gamme, pf.poids_kg, pf.date_fabrication,
  pf.batch_id, pf.poste_etiquetage_id, pf.nb_impressions, pf.status, pf.date_sortie,
  pf.sortie_commande_type, pe.numero_poste`;

/** Un carton est considéré comme sorti s'il a quitté le stock (même règle que la sortie). */
function estSorti(c) {
  return Boolean(c.date_sortie) || c.status !== 'en_stock';
}

router.get('/carton/:code', operateur, etiquettesHabilitees, async (req, res) => {
  const analyse = analyserCode(req.params.code);
  const format_libelle = LIBELLES_FORMAT[analyse.format] || analyse.format;
  try {
    const cands = candidatsCode(req.params.code, analyse.normalise);
    const r = cands.length ? await pool.query(
      `SELECT ${COLONNES_CARTON}
       FROM produits_finis pf LEFT JOIN postes_etiquetage pe ON pe.id = pf.poste_etiquetage_id
       WHERE pf.code_barre = ANY($1::varchar[])
       ORDER BY (pf.code_barre = $2) DESC LIMIT 1`,
      [cands, analyse.normalise]
    ) : { rows: [] };
    if (r.rows.length === 0) {
      return res.status(404).json({
        error: 'Carton introuvable', code: 'NOT_FOUND',
        format: analyse.format, format_libelle, code_normalise: analyse.normalise,
      });
    }
    const c = r.rows[0];
    res.json({
      carton: formaterCarton(c, { status: c.status, date_sortie: c.date_sortie ?? null }),
      format: analyse.format,
      format_libelle,
    });
  } catch (err) {
    console.error('[ETIQUETTES] Erreur carton :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Réimpression : MÊME code, tracée (journal + compteur). Refusée pour un carton
// déjà sorti — réimprimer l'étiquette d'un carton parti ouvrirait la porte à un
// double. Les anciens codes se réimpriment tels quels.
router.post('/reimprimer', operateur, etiquettesHabilitees, async (req, res) => {
  const { code_barre, motif, poste_id } = req.body || {};
  const analyse = analyserCode(code_barre);
  if (!analyse.normalise) return res.status(400).json({ error: 'code_barre requis', code: 'PARAMETRES' });
  const motifTexte = texte(motif);
  if (motifTexte && motifTexte.length > 200) {
    return res.status(400).json({ error: 'Le motif ne peut dépasser 200 caractères', code: 'PARAMETRES' });
  }
  const posteId = entierPositif(poste_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT pf.id, pf.status, pf.date_sortie, pf.code_barre FROM produits_finis pf
       WHERE pf.code_barre = ANY($1::varchar[])
       ORDER BY (pf.code_barre = $2) DESC LIMIT 1 FOR UPDATE`,
      [candidatsCode(code_barre, analyse.normalise), analyse.normalise]
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Carton introuvable', code: 'NOT_FOUND',
        format: analyse.format, format_libelle: LIBELLES_FORMAT[analyse.format], code_normalise: analyse.normalise,
      });
    }
    const c = r.rows[0];
    if (estSorti(c)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Carton déjà sorti du stock : réimpression refusée', code: 'DEJA_SORTI' });
    }
    let posteImpression = null;
    if (posteId) {
      const p = await client.query('SELECT id FROM postes_etiquetage WHERE id = $1', [posteId]);
      posteImpression = p.rows[0]?.id ?? null;
    }
    await client.query(
      `UPDATE produits_finis SET nb_impressions = COALESCE(nb_impressions, 1) + 1, derniere_impression_at = NOW()
       WHERE id = $1`,
      [c.id]
    );
    await client.query(
      `INSERT INTO etiquettes_impressions (produit_fini_id, type, motif, poste_etiquetage_id)
       VALUES ($1, 'reimpression', $2, $3)`,
      [c.id, motifTexte, posteImpression]
    );
    const full = await client.query(
      `SELECT ${COLONNES_CARTON}
       FROM produits_finis pf LEFT JOIN postes_etiquetage pe ON pe.id = pf.poste_etiquetage_id
       WHERE pf.id = $1`,
      [c.id]
    );
    await client.query('COMMIT');
    res.json(formaterCarton(full.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ETIQUETTES] Erreur réimpression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════
// Administration (ADMIN)
// ══════════════════════════════════════════
const admin = authorize('ADMIN');

/** Plus petit code libre dans [min, max] parmi `pris`, ou null. */
function plusPetitCodeLibre(pris, min, max) {
  const set = new Set(pris.map(Number));
  for (let c = min; c <= max; c += 1) if (!set.has(c)) return c;
  return null;
}

router.get('/admin/referentiel', admin, async (req, res) => {
  try {
    const [dims, produits, combis] = await Promise.all([
      pool.query(
        `SELECT id, type, valeur, code, definition, ordre, is_active FROM ref_dimensions
         ORDER BY type, ordre, valeur`
      ),
      pool.query(
        `SELECT p.id, p.nom, p.code, p.is_active,
                COALESCE((SELECT COUNT(*) FROM produits_finis pf
                          JOIN etiquettes_combinaisons c ON c.id = pf.combinaison_id
                          WHERE c.produit_id = p.id), 0)::int AS nb_cartons
         FROM etiquettes_produits p ORDER BY p.nom`
      ),
      pool.query(
        `SELECT c.id, c.gamme, c.categorie_eco_org, c.produit_id, p.nom AS produit, c.genre, c.saison,
                c.is_active, c.source, COALESCE(n.nb, 0)::int AS nb_cartons
         FROM etiquettes_combinaisons c
         JOIN etiquettes_produits p ON p.id = c.produit_id
         LEFT JOIN (SELECT combinaison_id, COUNT(*) AS nb FROM produits_finis
                    WHERE combinaison_id IS NOT NULL GROUP BY combinaison_id) n ON n.combinaison_id = c.id
         ORDER BY c.gamme, c.categorie_eco_org, p.nom, c.genre, c.saison`
      ),
    ]);
    res.json({
      dimensions: dims.rows.map((d) => ({ ...d, code: d.code === null ? null : Number(d.code) })),
      produits: produits.rows.map((p) => ({ ...p, code: Number(p.code) })),
      combinaisons: combis.rows,
    });
  } catch (err) {
    console.error('[ETIQUETTES] Erreur admin référentiel :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/admin/produits-v2', admin, async (req, res) => {
  const nom = texte(req.body?.nom);
  if (!nom) return res.status(400).json({ error: 'nom requis', code: 'PARAMETRES' });
  if (nom.length > 255) return res.status(400).json({ error: 'nom trop long (255 caractères max.)', code: 'PARAMETRES' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verrou de table : deux créations simultanées ne doivent pas se disputer le même code.
    await client.query('LOCK TABLE etiquettes_produits IN SHARE ROW EXCLUSIVE MODE');
    const existe = await client.query(
      'SELECT id FROM etiquettes_produits WHERE lower(nom) = lower($1)', [nom]
    );
    if (existe.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Un produit porte déjà ce nom', code: 'PRODUIT_EXISTANT' });
    }
    const codes = await client.query('SELECT code FROM etiquettes_produits');
    const code = plusPetitCodeLibre(codes.rows.map((r) => r.code), 1, 255);
    if (code === null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Plus aucun code produit libre (1 à 255)', code: 'CODES_EPUISES' });
    }
    const ins = await client.query(
      'INSERT INTO etiquettes_produits (nom, code) VALUES ($1, $2) RETURNING id, nom, code, is_active',
      [nom, code]
    );
    await client.query('COMMIT');
    res.status(201).json({ ...ins.rows[0], code: Number(ins.rows[0].code) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Un produit porte déjà ce nom', code: 'PRODUIT_EXISTANT' });
    console.error('[ETIQUETTES] Erreur création produit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.patch('/admin/produits-v2/:id', admin, async (req, res) => {
  const id = entierPositif(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide', code: 'PARAMETRES' });
  const { is_active } = req.body || {};
  const nom = req.body && 'nom' in req.body ? texte(req.body.nom) : undefined;
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active doit être un booléen', code: 'PARAMETRES' });
  }
  if (nom === null) return res.status(400).json({ error: 'nom vide', code: 'PARAMETRES' });
  if (is_active === undefined && nom === undefined) {
    return res.status(400).json({ error: 'Aucun champ à modifier', code: 'PARAMETRES' });
  }
  try {
    const cur = await pool.query('SELECT id, nom FROM etiquettes_produits WHERE id = $1', [id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Produit introuvable', code: 'NOT_FOUND' });
    if (nom !== undefined && nom !== cur.rows[0].nom) {
      // Renommer un produit déjà imprimé changerait ce que désigne un code déjà
      // collé sur des cartons : refusé.
      const util = await pool.query(
        `SELECT 1 FROM produits_finis pf JOIN etiquettes_combinaisons c ON c.id = pf.combinaison_id
         WHERE c.produit_id = $1 LIMIT 1`,
        [id]
      );
      if (util.rowCount > 0) {
        return res.status(409).json({ error: 'Nom non modifiable : des cartons ont déjà été imprimés avec ce produit', code: 'PRODUIT_UTILISE' });
      }
    }
    const sets = []; const vals = [];
    if (is_active !== undefined) { vals.push(is_active); sets.push(`is_active = $${vals.length}`); }
    if (nom !== undefined) { vals.push(nom); sets.push(`nom = $${vals.length}`); }
    vals.push(id);
    const r = await pool.query(
      `UPDATE etiquettes_produits SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, nom, code, is_active`,
      vals
    );
    res.json({ ...r.rows[0], code: Number(r.rows[0].code) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un produit porte déjà ce nom', code: 'PRODUIT_EXISTANT' });
    console.error('[ETIQUETTES] Erreur modification produit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/admin/combinaisons', admin, async (req, res) => {
  const b = req.body || {};
  const val = {
    gamme: texte(b.gamme), categorie_eco_org: texte(b.categorie_eco_org),
    produit_id: entierPositif(b.produit_id), genre: texte(b.genre), saison: texte(b.saison),
  };
  const manquants = Object.entries(val).filter(([, v]) => v === null).map(([k]) => k);
  if (manquants.length) {
    return res.status(400).json({ error: `Champ(s) manquant(s) : ${manquants.join(', ')}`, code: 'PARAMETRES' });
  }
  try {
    const dims = await pool.query(
      `SELECT type, valeur FROM ref_dimensions
       WHERE is_active = true AND code IS NOT NULL
         AND ((type = 'gamme' AND valeur = $1) OR (type = 'categorie_eco_org' AND valeur = $2)
           OR (type = 'genre' AND valeur = $3) OR (type = 'saison' AND valeur = $4))`,
      [val.gamme, val.categorie_eco_org, val.genre, val.saison]
    );
    const presents = new Set(dims.rows.map((d) => d.type));
    const prod = await pool.query(
      'SELECT id FROM etiquettes_produits WHERE id = $1 AND is_active = true', [val.produit_id]
    );
    const invalides = TYPES_DIMENSION.filter((t) => !presents.has(t));
    if (prod.rowCount === 0) invalides.push('produit_id');
    if (invalides.length) {
      return res.status(400).json({
        error: `Valeur(s) inactive(s), inconnue(s) ou sans code : ${invalides.join(', ')}`,
        code: 'COMBINAISON_INVALIDE',
      });
    }
    const ins = await pool.query(
      `INSERT INTO etiquettes_combinaisons (gamme, categorie_eco_org, produit_id, genre, saison, source)
       VALUES ($1, $2, $3, $4, $5, 'admin')
       ON CONFLICT (gamme, categorie_eco_org, produit_id, genre, saison) DO NOTHING
       RETURNING *`,
      [val.gamme, val.categorie_eco_org, val.produit_id, val.genre, val.saison]
    );
    if (ins.rowCount === 0) {
      const ex = await pool.query(
        `SELECT id, is_active FROM etiquettes_combinaisons
         WHERE gamme = $1 AND categorie_eco_org = $2 AND produit_id = $3 AND genre = $4 AND saison = $5`,
        [val.gamme, val.categorie_eco_org, val.produit_id, val.genre, val.saison]
      );
      return res.status(409).json({
        error: 'Cette combinaison existe déjà (la réactiver si elle est désactivée)',
        code: 'COMBINAISON_EXISTANTE', id: ex.rows[0]?.id ?? null, is_active: ex.rows[0]?.is_active ?? null,
      });
    }
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur création combinaison :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Jamais de DELETE d'une combinaison : on la désactive (elle a pu servir).
router.patch('/admin/combinaisons/:id', admin, async (req, res) => {
  const id = entierPositif(req.params.id);
  const { is_active } = req.body || {};
  if (!id || typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'Identifiant et is_active (booléen) requis', code: 'PARAMETRES' });
  }
  try {
    const r = await pool.query(
      `UPDATE etiquettes_combinaisons SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [is_active, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Combinaison introuvable', code: 'NOT_FOUND' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur modification combinaison :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === Admin catalogue historique (conservé) ===
router.get('/admin/produits', admin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT MIN(id) AS id, nom, categorie_eco_org, bool_or(is_active) AS is_active
       FROM produits_catalogue
       GROUP BY nom, categorie_eco_org
       ORDER BY categorie_eco_org, nom`
    );
    res.json(rows);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur admin produits :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/admin/produits', admin, async (req, res) => {
  const { nom, categorie_eco_org } = req.body || {};
  if (!nom || !categorie_eco_org) return res.status(400).json({ error: 'nom et categorie_eco_org requis' });
  try {
    const r = await pool.query(
      `INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme, is_active)
       VALUES ($1, $2, 'Sans Genre', 'Sans Saison', 'VAK', true)
       ON CONFLICT DO NOTHING
       RETURNING id, nom, categorie_eco_org`,
      [String(nom).trim(), String(categorie_eco_org).trim()]
    );
    res.status(201).json(r.rows[0] || { ok: true });
  } catch (err) {
    console.error('[ETIQUETTES] Erreur admin produit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/admin/produits', admin, async (req, res) => {
  const { nom, categorie_eco_org, is_active } = req.body || {};
  if (!nom || !categorie_eco_org || typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'nom, categorie_eco_org, is_active (boolean) requis' });
  }
  try {
    const r = await pool.query(
      `UPDATE produits_catalogue SET is_active = $1
       WHERE nom = $2 AND categorie_eco_org = $3 RETURNING id`,
      [is_active, nom, categorie_eco_org]
    );
    res.json({ updated: r.rowCount });
  } catch (err) {
    console.error('[ETIQUETTES] Erreur admin produit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/admin/dimensions', admin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, valeur, code, definition, ordre, is_active FROM ref_dimensions ORDER BY type, ordre, valeur`
    );
    res.json(rows);
  } catch (err) {
    console.error('[ETIQUETTES] Erreur admin dimensions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Création d'une valeur : un code est attribué d'office (plus petit libre du
// type). Une valeur existante est réactivée, et reçoit un code si elle n'en a pas.
router.post('/admin/dimensions', admin, async (req, res) => {
  const { type, ordre } = req.body || {};
  const valeur = texte(req.body?.valeur);
  const definition = texte(req.body?.definition);
  if (!type || !valeur) return res.status(400).json({ error: 'type et valeur requis', code: 'PARAMETRES' });
  if (!TYPES_DIMENSION.includes(type)) return res.status(400).json({ error: 'type invalide', code: 'PARAMETRES' });
  // Bornée à la colonne de `produits_finis` qui recevra la valeur : une valeur
  // plus longue passerait au référentiel puis ferait échouer chaque impression.
  const longueurMax = LONGUEUR_MAX_VALEUR[type];
  if (valeur.length > longueurMax) {
    return res.status(400).json({ error: `valeur trop longue (${longueurMax} caractères max. pour ce type)`, code: 'PARAMETRES' });
  }
  if (definition && definition.length > 120) return res.status(400).json({ error: 'définition trop longue (120 caractères max.)', code: 'PARAMETRES' });
  const ordreNum = Number.isFinite(Number(ordre)) && ordre !== null && ordre !== '' ? Math.trunc(Number(ordre)) : 100;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE ref_dimensions IN SHARE ROW EXCLUSIVE MODE');
    const ex = await client.query(
      'SELECT id, code FROM ref_dimensions WHERE type = $1 AND valeur = $2', [type, valeur]
    );
    let code = ex.rows[0]?.code ?? null;
    if (code === null) {
      const pris = await client.query(
        'SELECT code FROM ref_dimensions WHERE type = $1 AND code IS NOT NULL', [type]
      );
      const [min, max] = BORNES_CODE[type];
      code = plusPetitCodeLibre(pris.rows.map((r) => r.code), min, max);
      if (code === null) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Plus aucun code libre pour ce type (${min} à ${max})`, code: 'CODES_EPUISES' });
      }
    }
    const r = await client.query(
      `INSERT INTO ref_dimensions (type, valeur, ordre, code, definition) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (type, valeur) DO UPDATE SET
         is_active = true,
         code = COALESCE(ref_dimensions.code, EXCLUDED.code),
         definition = COALESCE(EXCLUDED.definition, ref_dimensions.definition)
       RETURNING id, type, valeur, ordre, code, definition, is_active`,
      [type, valeur, ordreNum, code, definition]
    );
    await client.query('COMMIT');
    res.status(201).json({ ...r.rows[0], code: r.rows[0].code === null ? null : Number(r.rows[0].code) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ETIQUETTES] Erreur création dimension :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.patch('/admin/dimensions/:id', admin, async (req, res) => {
  const id = entierPositif(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide', code: 'PARAMETRES' });
  const { is_active, ordre } = req.body || {};
  const valeur = req.body && typeof req.body.valeur === 'string' ? texte(req.body.valeur) : undefined;
  const definition = req.body && 'definition' in req.body ? texte(req.body.definition) : undefined;
  try {
    const cur = await pool.query('SELECT id, valeur, code FROM ref_dimensions WHERE id = $1', [id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Dimension introuvable', code: 'NOT_FOUND' });
    const sets = []; const vals = [];
    if (typeof is_active === 'boolean') { vals.push(is_active); sets.push(`is_active = $${vals.length}`); }
    if (Number.isFinite(ordre)) { vals.push(Math.trunc(ordre)); sets.push(`ordre = $${vals.length}`); }
    if (definition !== undefined) {
      if (definition && definition.length > 120) return res.status(400).json({ error: 'définition trop longue (120 caractères max.)', code: 'PARAMETRES' });
      vals.push(definition); sets.push(`definition = $${vals.length}`);
    }
    if (valeur && valeur !== cur.rows[0].valeur) {
      // Renommer une valeur codifiée changerait la signification de codes déjà
      // imprimés sur des cartons : refusé. Créer une nouvelle valeur à la place.
      if (cur.rows[0].code !== null) {
        return res.status(409).json({ error: 'Valeur codifiée : elle ne peut pas être renommée (créer une nouvelle valeur puis désactiver celle-ci)', code: 'VALEUR_CODIFIEE' });
      }
      vals.push(valeur); sets.push(`valeur = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier', code: 'PARAMETRES' });
    vals.push(id);
    const r = await pool.query(
      `UPDATE ref_dimensions SET ${sets.join(', ')} WHERE id = $${vals.length}
       RETURNING id, type, valeur, ordre, code, definition, is_active`,
      vals
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette valeur existe déjà pour ce type', code: 'VALEUR_EXISTANTE' });
    console.error('[ETIQUETTES] Erreur modification dimension :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
// Générateur partagé (voie manuelle produits-finis.js) et utilitaires réutilisés
// par le routeur de sortie de cartons.
module.exports.generateProduitFini = generateProduitFini;
module.exports.validerCorpsGeneration = validerCorpsGeneration;
module.exports.repondreErreurGeneration = repondreErreurGeneration;
module.exports.formaterCarton = formaterCarton;
module.exports.ROLES_OPERATEUR = ROLES_OPERATEUR;
module.exports.SQL_COMBINAISONS_VALIDES = SQL_COMBINAISONS_VALIDES;
