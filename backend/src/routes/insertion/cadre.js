/**
 * Dossier administratif d'insertion (`/api/insertion/cadre`) — PR A, lot 1.
 *
 * Ce que cette surface tient, et pourquoi elle existe :
 *   - l'ÉLIGIBILITÉ IAE devient une liste de critères typés et datés, là où
 *     elle vivait dans un texte libre qu'aucun export ne pouvait compter. Les
 *     JUSTIFICATIFS, eux, ne sont PAS déposés ici : ils restent sur « Les
 *     Emplois de l'inclusion » et l'outil n'en garde que la RÉFÉRENCE
 *     (amendement du plan 07 § 9 — une notification de droits porte bien plus
 *     que le critère qu'elle prouve) ;
 *   - le PASS IAE devient saisissable et son statut CALCULÉ (utils/pass-iae.js)
 *     à partir de ses événements : sans cela, un Pass suspendu était
 *     indiscernable d'un Pass actif ;
 *   - l'ORIENTEUR, le PRESCRIPTEUR habilité et le RÉFÉRENT UNIQUE externe sont
 *     trois personnes différentes que l'outil confondait. Solidarité Textiles
 *     est « structure d'accueil » (décision de direction du 12/09) : le
 *     référent unique est externe, et « non déterminé » est un SIGNALEMENT, pas
 *     un champ vide ;
 *   - les STATUTS SOCIAUX (BRSA, catégorie France Travail) sont ADMIN/RH
 *     STRICT. Ce n'est pas un masquage par champ mais une projection : pour un
 *     MANAGER la clé `statuts` est ABSENTE de la réponse — une clé présente à
 *     null dirait déjà « cette personne a un statut social quelque part ».
 *
 * Habilitations : le routeur parent impose ADMIN/RH/MANAGER. Toute ÉCRITURE est
 * restreinte ici à ADMIN/RH. Toute lecture ADMIN/RH est journalisée au registre
 * RGPD ; la trace dit QUI a ouvert le dossier de QUI, jamais ce qu'il contient.
 */

'use strict';

const express = require('express');

const router = express.Router();
const pool = require('../../config/database');
const { authorize, resolveBaseRole } = require('../../middleware/auth');
const { param } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { calculerStatutPassIae, PASS_IAE_EVENEMENT_TYPES } = require('../../utils/pass-iae');

const ADMIN_RH = authorize('ADMIN', 'RH');
const ID = [param('employeeId').isInt().withMessage('Identifiant de salarié invalide')];

// ── Listes fermées ─────────────────────────────────────────────────────────
// Elles sont DOUBLÉES par des CHECK en base (migration insertion-cadre.js) :
// la validation applicative donne un message français exploitable (400), la
// contrainte garantit qu'aucune autre voie d'écriture ne puisse les contourner.
const ORIENTEUR_TYPES = ['departement_cms', 'france_travail', 'mission_locale', 'cap_emploi', 'ccas', 'autre'];
const REFERENT_TYPES = ['structure', 'france_travail', 'cms', 'autre', 'non_determine'];
const FT_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const ELIGIBILITE_SOURCES = ['auto_prescription', 'prescripteur_habilite', 'inconnu'];
const DEROGATION_MOTIFS = ['formation_en_cours', 'senior_50', 'rqth', 'cdi_inclusion'];

const baseRoleOf = (req) => resolveBaseRole(req.user && req.user.role);
const estAdminRh = (req) => ['ADMIN', 'RH'].includes(baseRoleOf(req));

/**
 * Journal RGPD du dossier administratif. Ne reçoit JAMAIS de valeur : sur une
 * modification, la trace porte la LISTE DES CHAMPS touchés, jamais ce qu'ils
 * sont devenus — le journal d'audit n'a pas à devenir une seconde copie des
 * statuts sociaux qu'il est censé protéger.
 */
async function journaliser(req, action, employeeId, details) {
  try {
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user && req.user.id != null ? req.user.id : null, action, 'insertion_cadre', employeeId,
        JSON.stringify({ employee_id: employeeId, ...(details || {}) })]
    );
  } catch (e) {
    console.error(`[INSERTION] Journalisation ${action} impossible :`, e.message);
  }
}

/** « 15/07/2025 » — format des documents français ; null → « non renseigné ». */
function frDate(v) {
  if (!v) return null;
  const s = v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/**
 * Bloc de report vers « Les Emplois de l'inclusion » (décision 6 : pas d'API en
 * v1, copier-coller structuré). Le gabarit est figé par le contrat § 6.1 ; un
 * champ absent s'écrit « non renseigné » et JAMAIS vide — sur un formulaire
 * officiel, un blanc se lit comme un oubli de l'agent, pas comme une donnée
 * manquante.
 */
function composerBlocEmploisInclusion({ criteres, prescripteur, pass }) {
  const NR = 'non renseigné';
  const libelles = (criteres || []).map((c) => c.libelle).filter(Boolean);
  const presc = prescripteur && prescripteur.nom
    ? `${prescripteur.nom}${prescripteur.type ? ` (${prescripteur.type})` : ''}`
    : NR;
  return [
    `Critères : ${libelles.length ? libelles.join(' ; ') : NR}`,
    `Prescripteur : ${presc}`,
    `Pass IAE : ${pass.numero || NR}`,
    `début ${frDate(pass.debut) || NR}`,
    `fin ${frDate(pass.fin) || NR}`,
    `Statut : ${pass.statut || NR}`,
  ].join(' · ');
}

/**
 * Rattachements à des projets cofinancés (tables du lot 2). Elles peuvent ne
 * pas exister encore : on rend `[]` plutôt qu'un 500 — le dossier administratif
 * doit s'ouvrir même sur une base où la migration FSE+ n'est pas passée.
 */
async function lireProjets(employeeId) {
  try {
    const r = await pool.query(
      `SELECT p.id, p.code, p.nom, p.type, pp.id AS participant_id, pp.date_entree, pp.date_sortie
         FROM insertion_projet_participants pp
         JOIN insertion_projets p ON p.id = pp.projet_id
        WHERE pp.employee_id = $1
        ORDER BY pp.date_entree DESC, p.code`,
      [employeeId]
    );
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    console.error('[INSERTION] Projets cofinancés illisibles :', err.message);
    return [];
  }
}

/** Événements du Pass, du plus récent au plus ancien. */
async function lireEvenementsPass(employeeId) {
  try {
    const r = await pool.query(
      `SELECT id, type, date_debut, date_fin, motif, reference_externe
         FROM insertion_pass_iae_evenements
        WHERE employee_id = $1
        ORDER BY date_debut DESC, id DESC`,
      [employeeId]
    );
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

/** Critères constatés, joints au référentiel pour porter leur libellé. */
async function lireCriteres(employeeId) {
  try {
    const r = await pool.query(
      `SELECT e.critere_code AS code, c.libelle, e.date_constat
         FROM employee_eligibilite e
         JOIN insertion_eligibilite_criteres c ON c.code = e.critere_code
        WHERE e.employee_id = $1
        ORDER BY c.ordre, c.code`,
      [employeeId]
    );
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

/** Métadonnées des pièces (jamais le contenu — voir routes/insertion/pieces.js). */
async function lirePieces(employeeId) {
  try {
    const r = await pool.query(
      `SELECT p.id, p.type, p.nom_fichier, p.mime, p.taille, p.milestone_id, p.pmsmp_id, p.created_at,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS depose_par_nom
         FROM insertion_pieces p
         LEFT JOIN users u ON u.id = p.depose_par
        WHERE p.employee_id = $1
        ORDER BY p.created_at DESC, p.id DESC`,
      [employeeId]
    );
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

/**
 * Recalcule et persiste `employees.pass_iae_statut`.
 *
 * La colonne n'est qu'un CACHE de `calculerStatutPassIae` : elle sert aux
 * listes, aux filtres et aux alertes, qui ne peuvent pas rejouer le
 * raisonnement ligne par ligne. Elle est donc réécrite à CHAQUE lecture du
 * dossier et à chaque écriture — le jour passe, un Pass expire sans que
 * personne n'ait rien saisi.
 */
async function recalculerStatutPass(db, employeeId, emp, evenements) {
  const statut = calculerStatutPassIae({
    numero: emp.pass_iae_number,
    debut: emp.pass_iae_start,
    fin: emp.pass_iae_end,
    evenements,
  });
  if (statut !== emp.pass_iae_statut) {
    try {
      await db.query('UPDATE employees SET pass_iae_statut = $1 WHERE id = $2', [statut, employeeId]);
    } catch (err) {
      // Colonne absente (base non migrée) : le statut reste juste dans la
      // réponse, il n'est simplement pas mémorisé.
      if (err.code !== '42703') throw err;
    }
  }
  return statut;
}

/** Compose la réponse complète du dossier (projection par rôle appliquée après). */
async function composerCadre(employeeId) {
  const empRes = await pool.query(
    `SELECT e.id, e.pass_iae_number, e.pass_iae_start, e.pass_iae_end, e.pass_iae_statut,
            e.orienteur_type, e.orienteur_nom, e.prescripteur_id, e.date_prescription,
            e.referent_unique_type, e.referent_unique_nom, e.referent_unique_contact,
            e.actualisation_ft_requise, e.actualisation_ft_derniere_date, e.actualisation_ft_rappels_non_honores,
            e.brsa, e.brsa_date_constat, e.ft_categorie, e.ft_categorie_date, e.france_travail_id,
            e.eligibilite_verifiee_le, e.eligibilite_source, e.eligibilite_justificatifs_ref,
            e.cddi_derogation_motif, e.cddi_derogation_date, e.parcours_num,
            po.nom AS prescripteur_nom, po.type AS prescripteur_type
       FROM employees e
       LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id
      WHERE e.id = $1`,
    [employeeId]
  );
  if (empRes.rows.length === 0) return null;
  const emp = empRes.rows[0];

  const [criteres, evenements, projets, pieces] = await Promise.all([
    lireCriteres(employeeId),
    lireEvenementsPass(employeeId),
    lireProjets(employeeId),
    lirePieces(employeeId),
  ]);

  const statut = await recalculerStatutPass(pool, employeeId, emp, evenements);

  // RQTH : LECTURE SEULE depuis le diagnostic — la reconnaissance se constate
  // en entretien, elle ne se ressaisit pas ici (deux saisies divergeraient).
  let rqth = null;
  try {
    const d = await pool.query(
      'SELECT rqth FROM insertion_diagnostics WHERE employee_id = $1 ORDER BY parcours_num DESC LIMIT 1',
      [employeeId]
    );
    rqth = d.rows[0] ? d.rows[0].rqth : null;
  } catch (err) { if (err.code !== '42P01' && err.code !== '42703') throw err; }

  const prescripteur = emp.prescripteur_id
    ? { id: emp.prescripteur_id, nom: emp.prescripteur_nom, type: emp.prescripteur_type }
    : null;

  return {
    employee_id: employeeId,
    eligibilite: {
      criteres,
      verifiee_le: emp.eligibilite_verifiee_le,
      source: emp.eligibilite_source,
      justificatifs_ref: emp.eligibilite_justificatifs_ref,
    },
    pass_iae: {
      numero: emp.pass_iae_number,
      debut: emp.pass_iae_start,
      fin: emp.pass_iae_end,
      statut,
      evenements,
    },
    orientation: {
      orienteur_type: emp.orienteur_type,
      orienteur_nom: emp.orienteur_nom,
      prescripteur,
      date_prescription: emp.date_prescription,
      referent_unique: {
        type: emp.referent_unique_type || 'non_determine',
        nom: emp.referent_unique_nom,
        contact: emp.referent_unique_contact,
      },
      actualisation_ft: {
        requise: emp.actualisation_ft_requise === true,
        derniere_date: emp.actualisation_ft_derniere_date,
        rappels_non_honores: emp.actualisation_ft_rappels_non_honores == null
          ? 0 : Number(emp.actualisation_ft_rappels_non_honores),
      },
    },
    statuts: {
      brsa: emp.brsa,
      brsa_date_constat: emp.brsa_date_constat,
      ft_categorie: emp.ft_categorie,
      ft_categorie_date: emp.ft_categorie_date,
      france_travail_id: emp.france_travail_id,
      rqth,
    },
    derogation_cddi: { motif: emp.cddi_derogation_motif, date: emp.cddi_derogation_date },
    projets,
    pieces,
    bloc_emplois_inclusion: composerBlocEmploisInclusion({
      criteres,
      prescripteur,
      pass: { numero: emp.pass_iae_number, debut: emp.pass_iae_start, fin: emp.pass_iae_end, statut },
    }),
  };
}

/**
 * Projection pour un MANAGER : les trois surfaces interdites sont RETIRÉES,
 * pas nullifiées. Une clé `statuts: null` dirait déjà « il y a un statut social
 * ici que vous n'avez pas le droit de voir » — et le bloc de report contient à
 * lui seul les critères d'éligibilité, qui sont la donnée la plus sensible du
 * dossier.
 */
function projeterPourManager(cadre) {
  const { statuts, pieces, bloc_emplois_inclusion, ...reste } = cadre; // eslint-disable-line no-unused-vars
  return reste;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/insertion/cadre/:employeeId
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:employeeId', ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const cadre = await composerCadre(employeeId);
    if (!cadre) return res.status(404).json({ error: 'Salarié non trouvé' });

    if (!estAdminRh(req)) return res.json(projeterPourManager(cadre));

    // Une consultation ADMIN/RH = une ligne au registre. C'est ce que
    // l'autorité demande pour les données de statut social (§ 6.1).
    await journaliser(req, 'INSERTION_CADRE_CONSULTATION', employeeId, {
      nb_criteres: cadre.eligibilite.criteres.length,
      pass_statut: cadre.pass_iae.statut,
    });
    res.json(cadre);
  } catch (err) {
    console.error('[INSERTION] Erreur cadre GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/insertion/cadre/:employeeId — corps PARTIEL
// ═══════════════════════════════════════════════════════════════════════════
//
// Chaque bloc absent du corps est laissé intact : l'écran enregistre section par
// section, et un formulaire qui n'affiche pas les statuts (MANAGER) ne doit
// jamais pouvoir les effacer par omission.
router.put('/:employeeId', ADMIN_RH, ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const body = req.body || {};

  const sets = [];
  const vals = [];
  const champs = []; // pour le journal : les NOMS, jamais les valeurs
  const erreurs = [];

  const set = (col, valeur) => { vals.push(valeur); sets.push(`${col} = $${vals.length}`); champs.push(col); };
  /** '' et undefined ≠ null : seule une valeur EXPLICITEMENT nulle efface. */
  const vide = (v) => v === '' || v === null;
  const dateOuNull = (v, libelle) => {
    if (vide(v)) return null;
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { erreurs.push(`${libelle} : date attendue au format AAAA-MM-JJ.`); return undefined; }
    return s;
  };
  const listeFermee = (v, liste, libelle) => {
    if (vide(v)) return null;
    const s = String(v).trim();
    if (!liste.includes(s)) { erreurs.push(`${libelle} : valeur « ${s} » hors de la liste autorisée.`); return undefined; }
    return s;
  };
  const texte = (v, max) => (vide(v) ? null : String(v).trim().slice(0, max));

  // ── Bloc éligibilité (hors la liste des critères, traitée en transaction) ──
  const elig = body.eligibilite;
  if (elig && typeof elig === 'object') {
    if ('verifiee_le' in elig) { const d = dateOuNull(elig.verifiee_le, 'Date de vérification de l\'éligibilité'); if (d !== undefined) set('eligibilite_verifiee_le', d); }
    if ('source' in elig) { const s = listeFermee(elig.source, ELIGIBILITE_SOURCES, 'Source de l\'éligibilité'); if (s !== undefined) set('eligibilite_source', s); }
    if ('justificatifs_ref' in elig) set('eligibilite_justificatifs_ref', texte(elig.justificatifs_ref, 500));
  }

  // ── Bloc Pass IAE (le STATUT n'est jamais accepté du client : il est calculé) ──
  const pass = body.pass_iae;
  if (pass && typeof pass === 'object') {
    if ('numero' in pass) set('pass_iae_number', texte(pass.numero, 30));
    if ('debut' in pass) { const d = dateOuNull(pass.debut, 'Début du Pass IAE'); if (d !== undefined) set('pass_iae_start', d); }
    if ('fin' in pass) { const d = dateOuNull(pass.fin, 'Fin du Pass IAE'); if (d !== undefined) set('pass_iae_end', d); }
  }

  // ── Bloc orientation ──
  const orient = body.orientation;
  if (orient && typeof orient === 'object') {
    if ('orienteur_type' in orient) { const v = listeFermee(orient.orienteur_type, ORIENTEUR_TYPES, 'Orienteur'); if (v !== undefined) set('orienteur_type', v); }
    if ('orienteur_nom' in orient) set('orienteur_nom', texte(orient.orienteur_nom, 150));
    if ('prescripteur_id' in orient) {
      const v = orient.prescripteur_id;
      if (vide(v)) set('prescripteur_id', null);
      else if (!Number.isInteger(Number(v))) erreurs.push('Prescripteur habilité : identifiant invalide.');
      else set('prescripteur_id', Number(v));
    }
    if ('date_prescription' in orient) { const d = dateOuNull(orient.date_prescription, 'Date de prescription'); if (d !== undefined) set('date_prescription', d); }
    const ref = orient.referent_unique;
    if (ref && typeof ref === 'object') {
      // Le référent unique n'est JAMAIS nul : l'absence de décision est une
      // valeur à part entière (« non déterminé »), parce qu'elle doit être
      // signalée au Département et non se confondre avec un champ oublié.
      if ('type' in ref) {
        const v = vide(ref.type) ? 'non_determine' : listeFermee(ref.type, REFERENT_TYPES, 'Référent unique');
        if (v !== undefined) set('referent_unique_type', v);
      }
      if ('nom' in ref) set('referent_unique_nom', texte(ref.nom, 150));
      if ('contact' in ref) set('referent_unique_contact', texte(ref.contact, 200));
    }
    const act = orient.actualisation_ft;
    if (act && typeof act === 'object' && 'requise' in act) set('actualisation_ft_requise', act.requise === true);
  }

  // ── Bloc statuts sociaux (ADMIN/RH — la route entière l'est déjà) ──
  const st = body.statuts;
  if (st && typeof st === 'object') {
    // `brsa` a TROIS états : true / false / null (non renseigné). Un `false`
    // par défaut ferait disparaître des personnes du compte déclaré au
    // Département — d'où la distinction explicite ici.
    if ('brsa' in st) {
      const v = st.brsa;
      if (vide(v)) set('brsa', null);
      else if (v === true || v === 'true' || v === 'oui') set('brsa', true);
      else if (v === false || v === 'false' || v === 'non') set('brsa', false);
      else erreurs.push('Bénéficiaire du RSA : valeur attendue « oui », « non » ou vide.');
    }
    if ('brsa_date_constat' in st) { const d = dateOuNull(st.brsa_date_constat, 'Date de constat BRSA'); if (d !== undefined) set('brsa_date_constat', d); }
    if ('ft_categorie' in st) { const v = listeFermee(st.ft_categorie, FT_CATEGORIES, 'Catégorie France Travail'); if (v !== undefined) set('ft_categorie', v); }
    if ('ft_categorie_date' in st) { const d = dateOuNull(st.ft_categorie_date, 'Date de la catégorie France Travail'); if (d !== undefined) set('ft_categorie_date', d); }
    if ('france_travail_id' in st) set('france_travail_id', texte(st.france_travail_id, 30));
    // `rqth` est volontairement ignoré : il se saisit au diagnostic.
  }

  // ── Bloc dérogation CDDI ──
  const der = body.derogation_cddi;
  if (der && typeof der === 'object') {
    if ('motif' in der) { const v = listeFermee(der.motif, DEROGATION_MOTIFS, 'Motif de dérogation CDDI'); if (v !== undefined) set('cddi_derogation_motif', v); }
    if ('date' in der) { const d = dateOuNull(der.date, 'Date de dérogation CDDI'); if (d !== undefined) set('cddi_derogation_date', d); }
  }

  // ── Liste complète des critères d'éligibilité (remplacement) ──
  let criteresDemandes; // undefined = bloc absent = on ne touche à rien
  if (elig && typeof elig === 'object' && 'criteres' in elig) {
    if (!Array.isArray(elig.criteres)) {
      erreurs.push('Critères d\'éligibilité : une liste est attendue.');
    } else {
      criteresDemandes = [];
      for (const c of elig.criteres) {
        const code = typeof c === 'string' ? c : (c && c.code);
        if (!code || typeof code !== 'string') { erreurs.push('Critères d\'éligibilité : code manquant.'); continue; }
        const dc = (c && typeof c === 'object' && 'date_constat' in c)
          ? dateOuNull(c.date_constat, `Date de constat du critère « ${code} »`) : null;
        criteresDemandes.push({ code: code.trim(), date_constat: dc === undefined ? null : dc });
      }
    }
  }

  if (erreurs.length > 0) return res.status(400).json({ error: erreurs[0], erreurs });
  if (sets.length === 0 && criteresDemandes === undefined) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }

  // La connexion est rendue dans un `finally` UNIQUE. Les deux refus métier
  // ci-dessous (salarié introuvable, critère inconnu) sortaient auparavant par
  // un `return` nu, sans `client.release()` : chaque refus retirait
  // définitivement une connexion du pool, et vingt formulaires mal remplis
  // suffisaient à figer TOUTE l'application (plus aucune requête, quel que soit
  // le module, ne pouvait obtenir de connexion). Reproduit puis corrigé —
  // preuve sur PostgreSQL réel, `tests/e2e-pr-a/pr-a-cadre-e2e.test.js`.
  const client = await pool.connect();
  let libere = false;
  const rendre = () => { if (!libere) { libere = true; client.release(); } };
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
    if (exists.rows.length === 0) { await client.query('ROLLBACK'); rendre(); return res.status(404).json({ error: 'Salarié non trouvé' }); }

    if (sets.length > 0) {
      vals.push(employeeId);
      await client.query(`UPDATE employees SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }

    if (criteresDemandes !== undefined) {
      // Remplacement : ce que l'écran envoie EST la liste des critères
      // constatés. Les codes retirés disparaissent, les codes conservés
      // gardent leur date de constat (un `date_constat` absent du corps ne
      // remet jamais la date à NULL — c'est la date d'un constat passé).
      const codes = criteresDemandes.map((c) => c.code);
      const verif = await client.query(
        'SELECT code FROM insertion_eligibilite_criteres WHERE code = ANY($1::varchar[])',
        [codes.length ? codes : ['']]
      );
      const connus = new Set(verif.rows.map((r) => r.code));
      const inconnus = codes.filter((c) => !connus.has(c));
      if (inconnus.length > 0) {
        await client.query('ROLLBACK');
        rendre();
        return res.status(400).json({ error: `Critère d'éligibilité inconnu : ${inconnus.join(', ')}` });
      }
      await client.query(
        'DELETE FROM employee_eligibilite WHERE employee_id = $1 AND NOT (critere_code = ANY($2::varchar[]))',
        [employeeId, codes.length ? codes : ['']]
      );
      for (const c of criteresDemandes) {
        await client.query(
          `INSERT INTO employee_eligibilite (employee_id, critere_code, date_constat, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (employee_id, critere_code) DO UPDATE
             SET date_constat = COALESCE(EXCLUDED.date_constat, employee_eligibilite.date_constat)`,
          [employeeId, c.code, c.date_constat, req.user.id]
        );
      }
      champs.push('eligibilite.criteres');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    rendre();
    if (err.code === '23503') return res.status(400).json({ error: 'Référence invalide (prescripteur ou critère inexistant).' });
    if (err.code === '23514') return res.status(400).json({ error: 'Valeur refusée par la base : vérifiez les listes déroulantes.' });
    if (err.code === '42703') return res.status(503).json({ error: 'Dossier administratif indisponible : base non migrée.' });
    console.error('[INSERTION] Erreur cadre PUT :', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    rendre();
  }

  try {
    await journaliser(req, 'INSERTION_CADRE_MODIFICATION', employeeId, { champs });
    const cadre = await composerCadre(employeeId);
    res.json(cadre);
  } catch (err) {
    console.error('[INSERTION] Erreur cadre PUT (relecture) :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Événements du Pass IAE
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:employeeId/pass-iae/evenements', ADMIN_RH, ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  const type = String(b.type || '').trim();
  if (!PASS_IAE_EVENEMENT_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Type d\'événement invalide (suspension, prolongation ou autre).' });
  }
  const debut = String(b.date_debut || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) return res.status(400).json({ error: 'Date de début requise (AAAA-MM-JJ).' });
  const fin = b.date_fin ? String(b.date_fin).trim() : null;
  if (fin && !/^\d{4}-\d{2}-\d{2}$/.test(fin)) return res.status(400).json({ error: 'Date de fin invalide (AAAA-MM-JJ).' });
  if (fin && fin < debut) return res.status(400).json({ error: 'La date de fin précède la date de début.' });

  try {
    const ins = await pool.query(
      `INSERT INTO insertion_pass_iae_evenements
         (employee_id, type, date_debut, date_fin, motif, reference_externe, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [employeeId, type, debut, fin,
        b.motif ? String(b.motif).trim().slice(0, 2000) : null,
        b.reference_externe ? String(b.reference_externe).trim().slice(0, 60) : null,
        req.user.id]
    );
    await journaliser(req, 'INSERTION_CADRE_MODIFICATION', employeeId, {
      champs: ['pass_iae.evenements'], evenement_id: ins.rows[0].id, type,
    });
    const cadre = await composerCadre(employeeId); // recalcule et persiste le statut
    res.status(201).json(cadre);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Salarié non trouvé' });
    if (err.code === '42P01') return res.status(503).json({ error: 'Dossier administratif indisponible : base non migrée.' });
    console.error('[INSERTION] Erreur événement Pass POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:employeeId/pass-iae/evenements/:id', ADMIN_RH, [
  ...ID, param('id').isInt().withMessage('Identifiant d\'événement invalide'),
], validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  try {
    const del = await pool.query(
      'DELETE FROM insertion_pass_iae_evenements WHERE id = $1 AND employee_id = $2 RETURNING id',
      [parseInt(req.params.id, 10), employeeId]
    );
    if (del.rows.length === 0) return res.status(404).json({ error: 'Événement non trouvé' });
    await journaliser(req, 'INSERTION_CADRE_MODIFICATION', employeeId, {
      champs: ['pass_iae.evenements'], evenement_id: del.rows[0].id, suppression: true,
    });
    const cadre = await composerCadre(employeeId);
    res.json(cadre);
  } catch (err) {
    console.error('[INSERTION] Erreur événement Pass DELETE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /:employeeId/actualisation-ft — « l'actualisation du mois est faite »
// ═══════════════════════════════════════════════════════════════════════════
//
// Le compteur de rappels NON honorés retombe à 0 : c'est lui qui alimentera
// l'indicateur « ruptures de droits évitées » (amendement indicateur 12), et un
// compteur qu'on n'apure jamais ne mesure plus rien.
router.post('/:employeeId/actualisation-ft', ADMIN_RH, ID, validate, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const d = req.body && req.body.date ? String(req.body.date).trim() : null;
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Date invalide (AAAA-MM-JJ).' });
  try {
    const r = await pool.query(
      `UPDATE employees
          SET actualisation_ft_derniere_date = COALESCE($1::date, CURRENT_DATE),
              actualisation_ft_rappels_non_honores = 0
        WHERE id = $2 RETURNING id`,
      [d, employeeId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    await journaliser(req, 'INSERTION_CADRE_MODIFICATION', employeeId, { champs: ['actualisation_ft_derniere_date'] });
    const cadre = await composerCadre(employeeId);
    res.json(cadre);
  } catch (err) {
    if (err.code === '42703') return res.status(503).json({ error: 'Dossier administratif indisponible : base non migrée.' });
    console.error('[INSERTION] Erreur actualisation FT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
