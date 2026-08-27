/**
 * chaine-config.js — Configurateur 2D de la chaîne de tri
 * ═══════════════════════════════════════════════════════════════════════════
 * Gère les LAYOUTS (plans versionnés) de la chaîne et leurs BLOCS : postes de
 * travail (avec opérateurs), zones de dépose (contenants/sorties) et entrées
 * (« Original entrant pour tri »).
 *
 * Doctrine :
 * - Un seul layout ACTIF à la fois — garanti par un index unique partiel en
 *   base, et non par le code seul : deux plans actifs feraient mentir tous les
 *   écrans qui liront « le » plan de la chaîne.
 * - Les positions sont des POURCENTAGES 0-100 du canevas (origine haut-gauche) :
 *   le plan est un schéma logique, pas une carte à l'échelle.
 * - L'effectif total est SIGNALÉ, jamais bloqué : un plan qui dépasse
 *   l'effectif de référence reste enregistrable (un atelier peut vouloir
 *   préparer une organisation à 17 avant d'arbitrer) — l'écran l'alerte.
 * - Jamais de valeur inventée : `effectif_max` du layout absent ⇒ pas d'alerte
 *   calculée (`alerte_effectif: false` + `effectif_reference: null`), et non un
 *   plafond de 15 supposé.
 *
 * Habilitations : lecture et écriture ADMIN/MANAGER, suppression ADMIN.
 * `GET /layout-actif` est ouvert à TOUT rôle authentifié : les autres écrans
 * (production, planning) doivent pouvoir lire le plan en vigueur.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const CATEGORIES = ['poste', 'zone_depose', 'entree'];
const CODE_MAX = 40;        // chaine_layout_postes.code VARCHAR(40)
const LIBELLE_MAX = 120;    // chaine_layout_postes.libelle VARCHAR(120)
const NOM_MAX = 120;        // chaine_layouts.nom VARCHAR(120)
const MAX_BLOCS = 300;      // garde-fou : un plan d'atelier, pas un import de masse

const erreur = (res, status, message, code) => res.status(status).json({ error: message, code });

function parseId(valeur) {
  const n = parseInt(valeur, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Nombre fini attendu ; renvoie `null` si la valeur n'en est pas un. */
function nombre(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

function entierPositif(valeur, defaut) {
  const n = nombre(valeur);
  if (n === null) return defaut;
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Borne une coordonnée dans le canevas (0-100). Une position hors canevas
 *  rendrait le bloc inatteignable à la souris : on la ramène, sans refuser. */
function borner(valeur, min, max, defaut) {
  const n = nombre(valeur);
  if (n === null) return defaut;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

/**
 * Valide et normalise un bloc reçu du configurateur.
 * @returns {{ valeur: object } | { erreur: string }}
 */
function normaliserBloc(brut, index) {
  const ou = `bloc n° ${index + 1}`;
  if (!brut || typeof brut !== 'object') return { erreur: `${ou} : format invalide` };

  const code = typeof brut.code === 'string' ? brut.code.trim().toUpperCase() : '';
  if (!code) return { erreur: `${ou} : code obligatoire` };
  if (code.length > CODE_MAX) return { erreur: `${ou} : code trop long (${CODE_MAX} caractères maximum)` };
  if (!/^[A-Z0-9_]+$/.test(code)) {
    return { erreur: `${ou} : le code n'accepte que des lettres, chiffres et « _ »` };
  }

  const libelle = typeof brut.libelle === 'string' ? brut.libelle.trim() : '';
  if (!libelle) return { erreur: `${ou} (${code}) : libellé obligatoire` };
  if (libelle.length > LIBELLE_MAX) {
    return { erreur: `${ou} (${code}) : libellé trop long (${LIBELLE_MAX} caractères maximum)` };
  }

  const categorie = typeof brut.categorie === 'string' ? brut.categorie.trim() : 'poste';
  if (!CATEGORIES.includes(categorie)) {
    return { erreur: `${ou} (${code}) : catégorie inconnue « ${categorie} »` };
  }

  const effectifMin = entierPositif(brut.effectif_min, 0);
  const effectifMax = entierPositif(brut.effectif_max, categorie === 'poste' ? 1 : 0);
  if (effectifMin === null || effectifMax === null) {
    return { erreur: `${ou} (${code}) : les effectifs doivent être des entiers positifs ou nuls` };
  }
  if (effectifMin > effectifMax) {
    return { erreur: `${ou} (${code}) : l'effectif minimum (${effectifMin}) dépasse le maximum (${effectifMax})` };
  }

  const largeur = brut.largeur === null || brut.largeur === undefined || brut.largeur === ''
    ? null : borner(brut.largeur, 1, 100, null);
  const hauteur = brut.hauteur === null || brut.hauteur === undefined || brut.hauteur === ''
    ? null : borner(brut.hauteur, 1, 100, null);

  let posteOperationId = null;
  if (brut.poste_operation_id !== null && brut.poste_operation_id !== undefined && brut.poste_operation_id !== '') {
    posteOperationId = parseId(brut.poste_operation_id);
    if (posteOperationId === null) return { erreur: `${ou} (${code}) : poste de production invalide` };
  }

  let proprietes = null;
  if (brut.proprietes !== null && brut.proprietes !== undefined) {
    if (typeof brut.proprietes !== 'object' || Array.isArray(brut.proprietes)) {
      return { erreur: `${ou} (${code}) : les propriétés doivent être un objet` };
    }
    proprietes = brut.proprietes;
  }

  return {
    valeur: {
      code,
      libelle,
      categorie,
      x: borner(brut.x, 0, 100, 0),
      y: borner(brut.y, 0, 100, 0),
      largeur,
      hauteur,
      obligatoire: brut.obligatoire === true,
      actif: brut.actif !== false,
      effectif_min: effectifMin,
      effectif_max: effectifMax,
      poste_operation_id: posteOperationId,
      proprietes,
    },
  };
}

/**
 * Effectif mobilisé par un plan : somme des effectifs MAXIMUM des postes de
 * travail actifs. Les zones de dépose et les entrées ne portent personne.
 */
function effectifTotal(postes) {
  return (postes || [])
    .filter((p) => p.categorie === 'poste' && p.actif !== false)
    .reduce((somme, p) => somme + (Number(p.effectif_max) || 0), 0);
}

/**
 * Complète un layout de ses indicateurs. `effectif_reference` NULL (aucun
 * plafond saisi) ⇒ aucune alerte : on ne suppose pas un plafond qui n'a pas
 * été décidé.
 */
function resumerLayout(layout, postes) {
  const reference = layout.effectif_max == null ? null : Number(layout.effectif_max);
  const total = effectifTotal(postes);
  return {
    ...layout,
    nb_postes: (postes || []).filter((p) => p.categorie === 'poste').length,
    nb_blocs: (postes || []).length,
    effectif_total: total,
    effectif_reference: reference,
    alerte_effectif: reference !== null && total > reference,
  };
}

const SELECT_POSTES = `
  SELECT id, layout_id, code, libelle, categorie,
         x::float AS x, y::float AS y,
         largeur::float AS largeur, hauteur::float AS hauteur,
         obligatoire, actif, effectif_min, effectif_max, poste_operation_id, proprietes
    FROM chaine_layout_postes
   WHERE layout_id = $1
   ORDER BY CASE categorie WHEN 'entree' THEN 0 WHEN 'poste' THEN 1 ELSE 2 END, y, x, id`;

// ══════════════════════════════════════════════════════════════════════════
// LECTURE LÉGÈRE — plan en vigueur (tout rôle authentifié)
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/chaine-config/layout-actif
 * Le plan que suit l'atelier, pour les écrans qui l'affichent sans le modifier.
 * Aucun plan actif → `{ layout: null, postes: [] }` + motif : un écran doit
 * pouvoir dire « aucun plan actif » plutôt que d'afficher une chaîne vide.
 */
router.get('/layout-actif', async (req, res) => {
  try {
    const l = await pool.query(
      'SELECT * FROM chaine_layouts WHERE is_actif = true ORDER BY id LIMIT 1'
    );
    if (l.rows.length === 0) {
      return res.json({
        layout: null, postes: [],
        motif: 'Aucun plan de chaîne actif — activez-en un dans le configurateur.',
      });
    }
    const postes = await pool.query(SELECT_POSTES, [l.rows[0].id]);
    res.json({ layout: resumerLayout(l.rows[0], postes.rows), postes: postes.rows });
  } catch (err) {
    console.error('[CHAINE-CONFIG] Erreur layout actif :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// LAYOUTS
// ══════════════════════════════════════════════════════════════════════════

/** GET /api/chaine-config/layouts — liste des plans avec leurs indicateurs. */
router.get('/layouts', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT l.*,
             COALESCE(SUM(CASE WHEN p.categorie = 'poste' AND p.actif THEN p.effectif_max ELSE 0 END), 0)::int AS effectif_total,
             COUNT(p.id) FILTER (WHERE p.categorie = 'poste')::int AS nb_postes,
             COUNT(p.id)::int AS nb_blocs
        FROM chaine_layouts l
        LEFT JOIN chaine_layout_postes p ON p.layout_id = l.id
       GROUP BY l.id
       ORDER BY l.is_actif DESC, l.updated_at DESC NULLS LAST, l.id DESC`);
    const layouts = r.rows.map((row) => {
      const reference = row.effectif_max == null ? null : Number(row.effectif_max);
      return {
        ...row,
        effectif_reference: reference,
        alerte_effectif: reference !== null && Number(row.effectif_total) > reference,
      };
    });
    res.json({ layouts });
  } catch (err) {
    console.error('[CHAINE-CONFIG] Erreur liste layouts :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  }
});

/**
 * POST /api/chaine-config/layouts — créer un plan.
 * `depuis_layout_id` duplique le plan source, blocs compris (source
 * « duplication ») : c'est la manœuvre normale pour essayer une variante sans
 * toucher au plan en vigueur.
 */
router.post('/layouts', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const nom = typeof req.body?.nom === 'string' ? req.body.nom.trim() : '';
    if (!nom) return erreur(res, 400, 'Le nom du plan est obligatoire', 'NOM_REQUIS');
    if (nom.length > NOM_MAX) {
      return erreur(res, 400, `Nom trop long (${NOM_MAX} caractères maximum)`, 'NOM_TROP_LONG');
    }
    const description = typeof req.body?.description === 'string' && req.body.description.trim()
      ? req.body.description.trim() : null;

    let source = 'manuel';
    let depuis = null;
    if (req.body?.depuis_layout_id !== undefined && req.body?.depuis_layout_id !== null
        && req.body?.depuis_layout_id !== '') {
      depuis = parseId(req.body.depuis_layout_id);
      if (depuis === null) return erreur(res, 400, 'Plan source invalide', 'SOURCE_INVALIDE');
      source = 'duplication';
    }

    const effectifMax = req.body?.effectif_max === undefined || req.body?.effectif_max === null
      || req.body?.effectif_max === '' ? null : entierPositif(req.body.effectif_max, null);
    if (req.body?.effectif_max !== undefined && req.body?.effectif_max !== null
        && req.body?.effectif_max !== '' && effectifMax === null) {
      return erreur(res, 400, "L'effectif de référence doit être un entier positif ou nul", 'EFFECTIF_INVALIDE');
    }

    await client.query('BEGIN');

    let sourceLayout = null;
    if (depuis !== null) {
      const s = await client.query('SELECT * FROM chaine_layouts WHERE id = $1', [depuis]);
      if (s.rows.length === 0) {
        await client.query('ROLLBACK');
        return erreur(res, 404, 'Plan source introuvable', 'SOURCE_INTROUVABLE');
      }
      sourceLayout = s.rows[0];
    }

    const ins = await client.query(
      `INSERT INTO chaine_layouts (nom, description, effectif_max, source, is_actif, created_by)
       VALUES ($1, $2, $3, $4, false, $5) RETURNING *`,
      [
        nom,
        description !== null ? description : (sourceLayout ? sourceLayout.description : null),
        effectifMax !== null ? effectifMax : (sourceLayout ? sourceLayout.effectif_max : null),
        source,
        req.user?.id || null,
      ]
    );
    const layoutId = ins.rows[0].id;

    if (depuis !== null) {
      await client.query(
        `INSERT INTO chaine_layout_postes
           (layout_id, code, libelle, categorie, x, y, largeur, hauteur, obligatoire, actif,
            effectif_min, effectif_max, poste_operation_id, proprietes)
         SELECT $1, code, libelle, categorie, x, y, largeur, hauteur, obligatoire, actif,
                effectif_min, effectif_max, poste_operation_id, proprietes
           FROM chaine_layout_postes WHERE layout_id = $2`,
        [layoutId, depuis]
      );
    }

    const postes = await client.query(SELECT_POSTES, [layoutId]);
    await client.query('COMMIT');
    res.status(201).json({ layout: resumerLayout(ins.rows[0], postes.rows), postes: postes.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CHAINE-CONFIG] Erreur création layout :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  } finally {
    client.release();
  }
});

/** GET /api/chaine-config/layouts/:id — un plan et tous ses blocs. */
router.get('/layouts/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return erreur(res, 400, 'Identifiant invalide', 'ID_INVALIDE');
    const l = await pool.query('SELECT * FROM chaine_layouts WHERE id = $1', [id]);
    if (l.rows.length === 0) return erreur(res, 404, 'Plan introuvable', 'LAYOUT_INTROUVABLE');
    const postes = await pool.query(SELECT_POSTES, [id]);
    res.json({ layout: resumerLayout(l.rows[0], postes.rows), postes: postes.rows });
  } catch (err) {
    console.error('[CHAINE-CONFIG] Erreur détail layout :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  }
});

/** PUT /api/chaine-config/layouts/:id — identité du plan (pas ses blocs). */
router.put('/layouts/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return erreur(res, 400, 'Identifiant invalide', 'ID_INVALIDE');

    let nom = null;
    if (req.body?.nom !== undefined) {
      nom = typeof req.body.nom === 'string' ? req.body.nom.trim() : '';
      if (!nom) return erreur(res, 400, 'Le nom du plan est obligatoire', 'NOM_REQUIS');
      if (nom.length > NOM_MAX) {
        return erreur(res, 400, `Nom trop long (${NOM_MAX} caractères maximum)`, 'NOM_TROP_LONG');
      }
    }

    // `null` explicite = « je retire le plafond » ; absent = « ne touche à rien ».
    let effectifMax;
    if (req.body?.effectif_max !== undefined) {
      if (req.body.effectif_max === null || req.body.effectif_max === '') {
        effectifMax = null;
      } else {
        effectifMax = entierPositif(req.body.effectif_max, null);
        if (effectifMax === null) {
          return erreur(res, 400, "L'effectif de référence doit être un entier positif ou nul", 'EFFECTIF_INVALIDE');
        }
      }
    }

    const r = await pool.query(
      // Casts EXPLICITES : dans un CASE/COALESCE, PostgreSQL ne déduit pas
      // toujours le type d'un paramètre depuis la colonne cible (42P08 déjà
      // rencontré sur ce dépôt) — on le lui dit.
      `UPDATE chaine_layouts
          SET nom = COALESCE($2::varchar, nom),
              description = CASE WHEN $3::boolean THEN $4::text ELSE description END,
              effectif_max = CASE WHEN $5::boolean THEN $6::int ELSE effectif_max END,
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        id, nom,
        req.body?.description !== undefined,
        typeof req.body?.description === 'string' && req.body.description.trim()
          ? req.body.description.trim() : null,
        req.body?.effectif_max !== undefined,
        effectifMax === undefined ? null : effectifMax,
      ]
    );
    if (r.rows.length === 0) return erreur(res, 404, 'Plan introuvable', 'LAYOUT_INTROUVABLE');
    const postes = await pool.query(SELECT_POSTES, [id]);
    res.json({ layout: resumerLayout(r.rows[0], postes.rows), postes: postes.rows });
  } catch (err) {
    console.error('[CHAINE-CONFIG] Erreur modification layout :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  }
});

/**
 * PUT /api/chaine-config/layouts/:id/postes — REMPLACEMENT COMPLET des blocs.
 * Transactionnel (pattern `PUT /tours/routes/:id`) : le plan enregistré est
 * exactement celui affiché, jamais un mélange de l'ancien et du nouveau.
 * Le dépassement d'effectif est SIGNALÉ dans la réponse, jamais refusé.
 */
router.put('/layouts/:id/postes', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (id === null) return erreur(res, 400, 'Identifiant invalide', 'ID_INVALIDE');
    if (!Array.isArray(req.body?.postes)) {
      return erreur(res, 400, 'La liste des blocs est attendue', 'POSTES_REQUIS');
    }
    if (req.body.postes.length > MAX_BLOCS) {
      return erreur(res, 400, `Trop de blocs (${MAX_BLOCS} maximum)`, 'TROP_DE_BLOCS');
    }

    const blocs = [];
    const codes = new Set();
    for (let i = 0; i < req.body.postes.length; i++) {
      const norm = normaliserBloc(req.body.postes[i], i);
      if (norm.erreur) return erreur(res, 400, norm.erreur, 'BLOC_INVALIDE');
      if (codes.has(norm.valeur.code)) {
        return erreur(res, 400, `Code en double dans le plan : « ${norm.valeur.code} »`, 'CODE_DUPLIQUE');
      }
      codes.add(norm.valeur.code);
      blocs.push(norm.valeur);
    }

    await client.query('BEGIN');
    const l = await client.query('SELECT * FROM chaine_layouts WHERE id = $1 FOR UPDATE', [id]);
    if (l.rows.length === 0) {
      await client.query('ROLLBACK');
      return erreur(res, 404, 'Plan introuvable', 'LAYOUT_INTROUVABLE');
    }

    await client.query('DELETE FROM chaine_layout_postes WHERE layout_id = $1', [id]);
    for (const b of blocs) {
      await client.query(
        `INSERT INTO chaine_layout_postes
           (layout_id, code, libelle, categorie, x, y, largeur, hauteur, obligatoire, actif,
            effectif_min, effectif_max, poste_operation_id, proprietes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, b.code, b.libelle, b.categorie, b.x, b.y, b.largeur, b.hauteur,
          b.obligatoire, b.actif, b.effectif_min, b.effectif_max, b.poste_operation_id,
          b.proprietes ? JSON.stringify(b.proprietes) : null]
      );
    }
    const maj = await client.query(
      'UPDATE chaine_layouts SET updated_at = NOW() WHERE id = $1 RETURNING *', [id]
    );
    const postes = await client.query(SELECT_POSTES, [id]);
    await client.query('COMMIT');

    const layout = resumerLayout(maj.rows[0], postes.rows);
    res.json({
      layout,
      postes: postes.rows,
      // Message d'alerte prêt à afficher — l'enregistrement, lui, a bien eu lieu.
      avertissement: layout.alerte_effectif
        ? `Le plan mobilise ${layout.effectif_total} personnes pour un effectif de référence de `
          + `${layout.effectif_reference}.`
        : null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CHAINE-CONFIG] Erreur enregistrement des blocs :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  } finally {
    client.release();
  }
});

/**
 * POST /api/chaine-config/layouts/:id/activer — rendre un plan actif.
 * Transactionnel : tous à false, puis celui-ci à true. L'ordre est imposé par
 * l'index unique partiel de la base (deux plans actifs, même une fraction de
 * transaction, sont refusés).
 */
router.post('/layouts/:id/activer', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (id === null) return erreur(res, 400, 'Identifiant invalide', 'ID_INVALIDE');

    await client.query('BEGIN');
    const l = await client.query('SELECT id FROM chaine_layouts WHERE id = $1 FOR UPDATE', [id]);
    if (l.rows.length === 0) {
      await client.query('ROLLBACK');
      return erreur(res, 404, 'Plan introuvable', 'LAYOUT_INTROUVABLE');
    }
    await client.query('UPDATE chaine_layouts SET is_actif = false WHERE is_actif = true');
    const maj = await client.query(
      'UPDATE chaine_layouts SET is_actif = true, updated_at = NOW() WHERE id = $1 RETURNING *', [id]
    );
    const postes = await client.query(SELECT_POSTES, [id]);
    await client.query('COMMIT');
    res.json({ layout: resumerLayout(maj.rows[0], postes.rows), postes: postes.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CHAINE-CONFIG] Erreur activation layout :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/chaine-config/layouts/:id — supprimer un plan (ADMIN).
 * Refus 409 sur le plan ACTIF : la bonne manœuvre est d'en activer un autre
 * d'abord — supprimer celui en vigueur laisserait la chaîne sans plan sans que
 * personne l'ait décidé. Les blocs partent en cascade (FK ON DELETE CASCADE).
 */
router.delete('/layouts/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return erreur(res, 400, 'Identifiant invalide', 'ID_INVALIDE');
    const l = await pool.query('SELECT id, is_actif FROM chaine_layouts WHERE id = $1', [id]);
    if (l.rows.length === 0) return erreur(res, 404, 'Plan introuvable', 'LAYOUT_INTROUVABLE');
    if (l.rows[0].is_actif) {
      return erreur(
        res, 409,
        "Ce plan est le plan actif : activez un autre plan avant de le supprimer",
        'LAYOUT_ACTIF'
      );
    }
    await pool.query('DELETE FROM chaine_layouts WHERE id = $1', [id]);
    res.json({ message: 'Plan supprimé', id });
  } catch (err) {
    console.error('[CHAINE-CONFIG] Erreur suppression layout :', err.message);
    erreur(res, 500, 'Erreur serveur', 'ERREUR_SERVEUR');
  }
});

module.exports = router;
module.exports.normaliserBloc = normaliserBloc;
module.exports.effectifTotal = effectifTotal;
module.exports.resumerLayout = resumerLayout;
