/**
 * BORDEREAU DE COLLECTE EN DÉCHÈTERIE — routes (chantier 2.50.0).
 *
 * Deux routeurs, montés à deux endroits DIFFÉRENTS de routes/tours/index.js et
 * pour deux raisons qui ne se confondent pas :
 *
 *   • `routerChauffeur` — la seule route `-public`. Montée AVANT
 *     `router.use(authenticate)`, elle hérite du middleware `MOBILE_DRIVER_PATH`
 *     qui authentifie le jeton chauffeur ET applique la garde de périmètre
 *     véhicule à tout chemin `-public`, sous-routeurs compris. Aucune garde
 *     n'est donc réécrite ici : la recopier, c'est se donner deux définitions du
 *     périmètre qui finiront par diverger.
 *
 *   • `routerBackOffice` — `authenticate` + `authorize('ADMIN','MANAGER')`.
 *     Monté juste APRÈS `router.use(authenticate)` et AVANT tout routeur à
 *     paramètre, sans quoi « /bordereaux/... » serait lu comme la tournée
 *     n° « bordereaux ».
 *
 * UNE DIFFÉRENCE DE DOCTRINE ASSUMÉE avec `collect-public` : ici une valeur mal
 * formée est refusée en 4xx AVEC son code. La file hors ligne du mobile purge
 * sur 4xx — c'est exactement ce qu'on veut : un bordereau que le serveur ne
 * peut pas accepter ne doit pas être rejoué indéfiniment. Le prix de ce choix
 * est que le mobile doit valider AVANT de mettre en file (il le fait).
 *
 * CE QUI N'ENTRE JAMAIS DANS LES CHIFFRES : le poids indicatif reste dans
 * `tour_decheterie_bordereaux`. Ni `tour_weights`, ni `tours.total_weight_kg`,
 * ni `tonnage_history`, ni l'apprentissage. C'est une estimation déclarée par
 * un chauffeur pour un formulaire, pas une pesée.
 */

'use strict';

const express = require('express');
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { autoLogActivity, logActivity } = require('../../middleware/activity-logger');
const { sendPushToRoles } = require('../../services/push-notifications');
const { notifierGestionnaires } = require('./notifier');
const { isDemoTour } = require('../../services/demo-mode');
const { SQL_TODAY_PARIS } = require('./driver-session');
const {
  DECHETERIES_METROPOLE,
  validerPoids,
  decoderSignature,
  motifAgentValide,
  validerClientId,
  libelleSnapshot,
  projeterResume,
  numeroSuivant,
  genererPdfDepuisLigne,
  COLONNES_RESUME,
  COLONNES_RESUME_NUES,
  COLONNES_COMPLETES,
} = require('../../services/bordereau-decheterie');

const routerChauffeur = express.Router();
const routerBackOffice = express.Router();

// ══════════════════════════════════════════
// JOURNALISATION
// ══════════════════════════════════════════

/**
 * Trace de consultation / validation dans `rgpd_audit_log`.
 *
 * Le document porte DEUX signatures manuscrites, dont celle d'un tiers (l'agent
 * de la déchèterie) : savoir qui l'a ouvert, et quand, est la contrepartie de
 * sa consultation en un clic. Best effort — un journal indisponible n'empêche
 * jamais la lecture d'une pièce qu'on a le droit de lire ; l'échec est logué.
 *
 * Codes écrits ici (visibles en littéral pour la garde anti-dérive des libellés
 * du journal RGPD) : 'BORDEREAU_DECHETERIE_CONSULTE', 'BORDEREAU_DECHETERIE_VALIDE'.
 */
function journaliserBordereau(req, action, bordereauId, details) {
  const uid = req.user && req.user.id != null ? req.user.id : null;
  pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [uid, action, 'tour_decheterie_bordereaux', bordereauId, JSON.stringify(details || {})]
  ).catch((err) => console.error(`[BORDEREAU] Journalisation ${action} impossible :`, err.message));
}

// ══════════════════════════════════════════
// 1. CÔTÉ CHAUFFEUR
// ══════════════════════════════════════════

/**
 * POST /api/tours/:id/cav/:cavId/bordereau-decheterie-public
 *
 * Dépose le bordereau d'un passage en déchèterie : poids indicatif + les deux
 * signatures. Le PDF est composé ici, à la création — le chauffeur repart avec
 * la certitude que le document existe.
 */
routerChauffeur.post('/:id/cav/:cavId/bordereau-decheterie-public', async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const cavId = parseInt(req.params.cavId, 10);
  if (!Number.isInteger(tourId) || !Number.isInteger(cavId)) {
    return res.status(400).json({ error: 'Identifiants invalides', code: 'IDENTIFIANTS_INVALIDES' });
  }

  try {
    // ── Le contexte du passage, en une lecture ────────────────────────────
    // LEFT JOIN volontaire : la tournée doit exister (404 sinon) mais le point
    // peut ne PAS lui appartenir — c'est un refus métier (409), pas un 404 qui
    // laisserait croire que la tournée est introuvable.
    const ctx = await pool.query(
      `SELECT t.id AS tour_id, t.is_demo, t.vehicle_id, t.driver_employee_id,
              tc.id AS tour_cav_id,
              c.id AS cav_id, c.name AS cav_nom, c.is_decheterie, c.decheterie_code
         FROM tours t
         LEFT JOIN tour_cav tc ON tc.tour_id = t.id AND tc.cav_id = $2
         LEFT JOIN cav c ON c.id = tc.cav_id
        WHERE t.id = $1`,
      [tourId, cavId]
    );
    if (ctx.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    const row = ctx.rows[0];

    // 1. MODE DÉMO : le stagiaire va au bout de son parcours et voit sa
    //    confirmation, mais rien n'est écrit et PERSONNE n'est notifié — un
    //    exercice de formation ne réveille pas un gestionnaire un dimanche.
    if (isDemoTour(row)) {
      return res.json({ demo: true, bordereau: null });
    }

    // 2. IDEMPOTENCE : un rejeu de la file hors ligne ne crée jamais un second
    //    bordereau. Contrôlée AVANT toute validation métier : si le point a été
    //    démarqué entre-temps, le rejeu doit rendre le bordereau déjà déposé,
    //    pas un refus incompréhensible pour un travail déjà fait.
    const clientId = validerClientId(req.body && req.body.client_id);
    if (!clientId.ok) {
      return res.status(400).json({ error: 'Identifiant de dépôt requis (client_id)', code: 'CLIENT_ID_INVALIDE' });
    }
    //    Borné à CETTE tournée (C-06) : un client_id deviné ne peut pas faire
    //    remonter le bordereau d'un autre véhicule.
    const deja = await pool.query(
      'SELECT id, numero, statut FROM tour_decheterie_bordereaux WHERE client_id = $1 AND tour_id = $2',
      [clientId.valeur, tourId]
    );
    if (deja.rows.length > 0) {
      return res.json({ deja_enregistre: true, bordereau: deja.rows[0] });
    }
    //    UN bordereau par passage (tournée × point) — revue C-05 : un écran
    //    rechargé produit un nouveau client_id, il ne doit pas produire un
    //    second document signé. On rend l'existant, jamais un refus : le
    //    travail a été fait.
    const dejaPassage = await pool.query(
      'SELECT id, numero, statut FROM tour_decheterie_bordereaux WHERE tour_id = $1 AND cav_id = $2 ORDER BY id LIMIT 1',
      [tourId, cavId]
    );
    if (dejaPassage.rows.length > 0) {
      return res.json({ deja_enregistre: true, bordereau: dejaPassage.rows[0] });
    }

    // 3. Le point doit être DE CETTE TOURNÉE et marqué déchèterie.
    if (row.tour_cav_id == null || row.is_decheterie !== true) {
      return res.status(409).json({
        error: "Ce point n'est pas une déchèterie de cette tournée — aucun bordereau n'est attendu",
        code: 'POINT_NON_DECHETERIE',
      });
    }

    // 4. Validations de la charge. Ordre du contrat : poids, signature du
    //    chauffeur, puis motif d'absence de l'agent.
    const poids = validerPoids(req.body && req.body.poids_indicatif_kg);
    if (!poids.ok) {
      return res.status(400).json({ error: 'Poids indicatif invalide (0 à 60 000 kg)', code: 'POIDS_INVALIDE' });
    }

    const sigChauffeur = decoderSignature(req.body && req.body.signature_chauffeur);
    if (!sigChauffeur.ok) {
      return res.status(400).json({
        error: 'Signature du chauffeur absente ou illisible (PNG, 200 Ko maximum)',
        code: 'SIGNATURE_INVALIDE',
        motif: sigChauffeur.motif,
      });
    }

    // La signature de l'agent est FACULTATIVE — mais son absence doit être
    // MOTIVÉE (arbitrage Q2) : un bordereau sans signature d'agent et sans
    // explication ne serait pas défendable devant la Métropole.
    let sigAgentBuf = null;
    let agentMotif = null;
    const sigAgentBrut = req.body && req.body.signature_agent;
    if (sigAgentBrut) {
      const sigAgent = decoderSignature(sigAgentBrut);
      if (!sigAgent.ok) {
        return res.status(400).json({
          error: "Signature de l'agent illisible (PNG, 200 Ko maximum)",
          code: 'SIGNATURE_INVALIDE',
          motif: sigAgent.motif,
        });
      }
      sigAgentBuf = sigAgent.buffer;
    } else {
      agentMotif = req.body && req.body.agent_absent_motif;
      if (!motifAgentValide(agentMotif)) {
        return res.status(400).json({
          error: "Motif requis quand la signature de l'agent n'est pas recueillie",
          code: 'MOTIF_REQUIS',
        });
      }
    }

    // 5. Écriture transactionnelle.
    const decheterieCode = row.decheterie_code || null;
    const decheterieLibelle = libelleSnapshot(decheterieCode, row.cav_nom);
    const cree = await creerBordereau({
      tourId, cavId, row, clientId: clientId.valeur, poidsKg: poids.valeur,
      decheterieCode, decheterieLibelle,
      signatureAgent: sigAgentBuf, agentMotif,
      signatureChauffeur: sigChauffeur.buffer,
    });
    if (cree.deja_enregistre) {
      return res.json({ deja_enregistre: true, bordereau: cree.bordereau });
    }

    // 6. Réponse au chauffeur — AVANT toute notification.
    res.status(201).json({
      bordereau: {
        id: cree.bordereau.id,
        numero: cree.bordereau.numero,
        statut: cree.bordereau.statut,
        poids_indicatif_kg: Number(cree.bordereau.poids_indicatif_kg),
        date_enlevement: cree.bordereau.date_enlevement,
      },
    });

    // 7. APRÈS la réponse : le chauffeur n'attend jamais un canal de
    //    notification. Aucune de ces trois écritures n'est bloquante.
    const detail = `bordereau ${cree.bordereau.numero} à valider (${poids.valeur} kg indicatifs)`;
    const corps = `Tournée #${tourId} — ${decheterieLibelle} : ${detail}`;
    sendPushToRoles(['ADMIN', 'MANAGER'], {
      title: 'Collecte en déchèterie',
      body: corps,
      tag: `bordereau-${cree.bordereau.id}`,
      data: { url: `/tours?tour=${tourId}`, tourId },
    }).catch(() => {});
    notifierGestionnaires({
      texte: `Collecte en déchèterie ${decheterieLibelle} — tournée #${tourId} : ${detail}`,
      source: 'bordereau_decheterie',
      lien: `/tours?tour=${tourId}`,
    });
    logActivity({
      userId: req.user && req.user.id != null ? req.user.id : null,
      username: req.user && req.user.username,
      action: 'create',
      entityType: 'bordereau_decheterie',
      entityId: cree.bordereau.id,
      details: { numero: cree.bordereau.numero, tour_id: tourId, cav_id: cavId },
      ip: req.ip,
    });
  } catch (err) {
    console.error('[BORDEREAU] Erreur dépôt bordereau déchèterie :', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Insertion transactionnelle du bordereau, numéro + PDF compris.
 *
 * Le numéro est calculé DANS la transaction et la contrainte d'unicité en est
 * l'arbitre : deux dépôts simultanés obtiendraient le même `BD-AAAA-NNNN`, la
 * base en refuse un, et on recommence UNE fois. Au-delà, on remonte l'erreur
 * plutôt que de boucler — un numéro qu'on n'arrive pas à obtenir deux fois de
 * suite signale autre chose qu'une course.
 *
 * Un 23505 sur `client_id` n'est PAS une course de numérotation mais un rejeu
 * arrivé pendant qu'on écrivait : on rend le bordereau existant.
 */
async function creerBordereau(args) {
  for (let tentative = 0; tentative < 2; tentative += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const numero = await numeroSuivant(client);
      const pdf = await genererPdfDepuisLigne({
        numero,
        tour_id: args.tourId,
        date_enlevement: new Date(),
        decheterie_code: args.decheterieCode,
        decheterie_libelle: args.decheterieLibelle,
        cav_nom: args.row.cav_nom,
        poids_indicatif_kg: args.poidsKg,
        signature_agent: args.signatureAgent,
        signature_agent_absente_motif: args.agentMotif,
        signature_chauffeur: args.signatureChauffeur,
        signature_chauffeur_absente_motif: null,
        remarques: null,
        statut: 'a_valider',
      });

      const ins = await client.query(
        `INSERT INTO tour_decheterie_bordereaux
           (numero, tour_id, tour_cav_id, cav_id, vehicle_id, driver_employee_id, client_id,
            date_enlevement, decheterie_code, decheterie_libelle, cav_nom, poids_indicatif_kg,
            signature_agent, signature_agent_absente_motif, signature_chauffeur,
            statut, pdf)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 ${SQL_TODAY_PARIS}, $8, $9, $10, $11,
                 $12, $13, $14,
                 'a_valider', $15)
         RETURNING id, numero, statut, poids_indicatif_kg, date_enlevement`,
        [
          numero, args.tourId, args.row.tour_cav_id, args.cavId, args.row.vehicle_id,
          args.row.driver_employee_id, args.clientId,
          args.decheterieCode, args.decheterieLibelle, args.row.cav_nom, args.poidsKg,
          args.signatureAgent, args.agentMotif, args.signatureChauffeur, pdf,
        ]
      );
      await client.query('COMMIT');
      return { bordereau: ins.rows[0] };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connexion déjà perdue */ }
      if (err && err.code === '23505') {
        const surClientId = String(err.constraint || '').includes('client_id')
          || String(err.detail || '').includes('client_id');
        if (surClientId) {
          const r = await pool.query(
            'SELECT id, numero, statut FROM tour_decheterie_bordereaux WHERE client_id = $1',
            [args.clientId]
          );
          if (r.rows.length > 0) return { deja_enregistre: true, bordereau: r.rows[0] };
        }
        if (tentative === 0) continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  throw new Error('Numéro de bordereau introuvable après deux tentatives');
}

// ══════════════════════════════════════════
// 2. CÔTÉ BACK-OFFICE (ADMIN / MANAGER)
// ══════════════════════════════════════════

/**
 * L'habilitation est posée ROUTE PAR ROUTE, jamais par `routerBackOffice.use()`.
 *
 * Ce routeur est monté en `router.use('/', ...)` sur le routeur des tournées :
 * un middleware de routeur s'y exécuterait pour TOUTE requête qui le traverse,
 * y compris celles destinées aux routeurs montés APRÈS lui — un QHSE lisant une
 * tournée recevrait 403 avant d'atteindre son handler. Le piège est silencieux
 * (aucun test de ce lot ne l'aurait vu) et la régression aurait porté sur tout
 * le module Collecte.
 */
const gestionnaire = authorize('ADMIN', 'MANAGER');

/**
 * GET /api/tours/bordereaux/referentiel-decheteries
 * Les 7 cases du formulaire, dans l'ordre du document papier. Déclarée AVANT
 * `/bordereaux/:bid/pdf`, sinon « referentiel-decheteries » serait lu comme un
 * identifiant.
 */
routerBackOffice.get('/bordereaux/referentiel-decheteries', gestionnaire, (req, res) => {
  res.json({ decheteries: DECHETERIES_METROPOLE.map((d) => ({ code: d.code, libelle: d.libelle })) });
});

/**
 * GET /api/tours/bordereaux/:bid/pdf — le document courant.
 *
 * `no-store` et `nosniff` ne sont pas décoratifs : le PDF porte deux signatures
 * manuscrites, il n'a rien à faire dans un cache partagé, et il ne doit jamais
 * être ré-interprété comme autre chose qu'un PDF.
 */
routerBackOffice.get('/bordereaux/:bid/pdf', gestionnaire, async (req, res) => {
  try {
    const bid = parseInt(req.params.bid, 10);
    if (!Number.isInteger(bid)) return res.status(400).json({ error: 'Identifiant invalide' });

    const r = await pool.query(
      'SELECT id, numero, pdf, tour_id, cav_id FROM tour_decheterie_bordereaux WHERE id = $1',
      [bid]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Bordereau non trouvé' });
    const b = r.rows[0];
    if (!b.pdf) return res.status(404).json({ error: 'Document indisponible pour ce bordereau' });

    journaliserBordereau(req, 'BORDEREAU_DECHETERIE_CONSULTE', b.id,
      { numero: b.numero, tour_id: b.tour_id, cav_id: b.cav_id });
    logActivity({
      userId: req.user && req.user.id != null ? req.user.id : null,
      username: req.user && req.user.username,
      action: 'view',
      entityType: 'bordereau_decheterie',
      entityId: b.id,
      details: { numero: b.numero },
      ip: req.ip,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bordereau-${b.numero}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.isBuffer(b.pdf) ? b.pdf : Buffer.from(b.pdf));
  } catch (err) {
    console.error('[BORDEREAU] Erreur lecture PDF :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * POST /api/tours/bordereaux/:bid/valider — validation par le gestionnaire.
 *
 * Le PDF est RÉGÉNÉRÉ pour porter la mention « Validé par Solidarité textiles
 * sur Solidata le JJ/MM/AAAA » dans Remarque(s) : le document validé doit être
 * le document qu'on envoie, pas un fichier accompagné d'un statut en base.
 *
 * Ni le poids ni les signatures ne sont modifiables — le bordereau est une
 * pièce signée par un tiers ; la seule chose que la validation ajoute est cette
 * mention. Une seconde validation est refusée (409).
 */
routerBackOffice.post('/bordereaux/:bid/valider', gestionnaire, autoLogActivity('bordereau_decheterie'), async (req, res) => {
  const bid = parseInt(req.params.bid, 10);
  if (!Number.isInteger(bid)) return res.status(400).json({ error: 'Identifiant invalide' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT ${COLONNES_COMPLETES}, v.registration AS vehicule
         FROM tour_decheterie_bordereaux b
         LEFT JOIN vehicles v ON v.id = b.vehicle_id
        WHERE b.id = $1
          FOR UPDATE OF b`,
      [bid]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bordereau non trouvé' });
    }
    const ligne = r.rows[0];
    if (ligne.statut === 'valide') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Ce bordereau a déjà été validé',
        code: 'BORDEREAU_DEJA_VALIDE',
        valide_le: ligne.valide_le,
      });
    }

    const dateValidation = new Date();
    const pdf = await genererPdfDepuisLigne(ligne, { validation: { date: dateValidation } });

    const upd = await client.query(
      `UPDATE tour_decheterie_bordereaux
          SET statut = 'valide', valide_par = $1, valide_le = NOW(),
              pdf = $2, pdf_genere_le = NOW()
        WHERE id = $3
        RETURNING ${COLONNES_RESUME_NUES}`,
      [req.user && req.user.id != null ? req.user.id : null, pdf, bid]
    );
    await client.query('COMMIT');

    journaliserBordereau(req, 'BORDEREAU_DECHETERIE_VALIDE', bid,
      { numero: ligne.numero, tour_id: ligne.tour_id, cav_id: ligne.cav_id });

    const nom = req.user
      ? [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim() || req.user.username
      : null;
    res.json({ bordereau: projeterResume(upd.rows[0], { valide_par_nom: nom || null }) });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connexion déjà perdue */ }
    console.error('[BORDEREAU] Erreur validation :', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/tours/:id/bordereaux — les bordereaux d'une tournée (fiche de tournée).
 * Ordre `created_at` : celui du déroulé de la journée.
 */
routerBackOffice.get('/:id/bordereaux', gestionnaire, async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId)) return res.status(400).json({ error: 'Tournée invalide' });
    const r = await pool.query(
      `SELECT ${COLONNES_RESUME},
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS valide_par_nom
         FROM tour_decheterie_bordereaux b
         LEFT JOIN users u ON u.id = b.valide_par
        WHERE b.tour_id = $1
        ORDER BY b.created_at, b.id`,
      [tourId]
    );
    res.json({ bordereaux: r.rows.map((row) => projeterResume(row)) });
  } catch (err) {
    // Base non migrée : la fiche de tournée doit continuer de s'afficher.
    if (err && err.code === '42P01') {
      console.warn('[BORDEREAU] Table tour_decheterie_bordereaux absente (base non migrée).');
      return res.json({ bordereaux: [] });
    }
    console.error('[BORDEREAU] Erreur liste bordereaux de tournée :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = { routerChauffeur, routerBackOffice, journaliserBordereau };
