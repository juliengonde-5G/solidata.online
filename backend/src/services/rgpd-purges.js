/**
 * PURGES RGPD — source UNIQUE des purges de rétention, partagée entre le job
 * planifié (services/scheduler.js) et le déclenchement manuel depuis l'écran
 * RGPD (routes/rgpd.js).
 *
 * POURQUOI CE FICHIER : la doctrine du projet (répétée dans
 * services/anonymization.js) veut qu'un même périmètre ne soit jamais écrit
 * deux fois — un bouton manuel et un job qui divergent silencieusement, c'est
 * une purge qu'on croit faite et qui ne l'est pas. Les corps de purge vivaient
 * dans le scheduler, où une route ne pouvait pas les atteindre : requérir le
 * scheduler depuis une route déclencherait ses effets de bord (timers, verrou
 * advisory). La dépendance va donc désormais dans un seul sens :
 *
 *      scheduler.js ─┐
 *                    ├─► services/rgpd-purges.js ─► pool
 *      routes/rgpd.js┘
 *
 * CE QUI N'A PAS CHANGÉ EN CHEMIN : les seuils, les tables, les replis et les
 * lignes de journal écrites en mode automatique sont ceux d'avant, à
 * l'identique. Le déplacement n'ajoute qu'un paramètre `{ trigger, userId }` et
 * un résumé de retour ; en `trigger: 'auto'` (défaut), chaque fonction se
 * comporte exactement comme la version qu'elle remplace.
 *
 * CONTRAT DE RETOUR (commun à toutes) :
 *   { cle, supprimes: { <table>: n, … }, total, retention_jours, journalise,
 *     items }        // `items` alimente job_runs.items_processed
 *
 * JOURNALISATION (rgpd_audit_log) :
 *   - mode AUTO    : identique à l'existant — lignes par personne pour les
 *     anonymisations (candidats, dossiers d'insertion), ligne de synthèse
 *     SEULEMENT si quelque chose a été supprimé pour les purges de masse (un
 *     journal qui se remplit de « 0 » chaque jour noie les vraies purges) ;
 *   - mode MANUEL  : la ligne de synthèse est écrite TOUJOURS, même à zéro
 *     ligne supprimée — c'est elle qui prouve qu'un humain a vérifié — avec
 *     son `user_id` et le code d'action sans préfixe `AUTO_`.
 *
 * Codes d'action écrits par ce fichier (repris à l'identique de l'existant pour
 * les quatre premiers) : AUTO_PURGE_PCM_90J, PURGE_PCM_NON_RECRUTE,
 * AUTO_PURGE_24M, PURGE_EXPIRED, AUTO_PURGE_INSERTION, PURGE_INSERTION,
 * AUTO_PURGE_GPS_90D, PURGE_GPS, AUTO_PURGE_ARRETS_GPS, PURGE_ARRETS_GPS,
 * PURGE_MESSAGERIE, PURGE_REFRESH_TOKENS, AUTO_PURGE_PCM_REPONSES,
 * PURGE_PCM_REPONSES.
 */
const pool = require('../config/database');

// ══════════════════════════════════════════
// CONSTANTES DE RÉTENTION (défauts EN CODE — aucun seed en base)
// ══════════════════════════════════════════

/** Tests PCM des personnes non recrutées (2.44.0, demande client). */
const PCM_RETENTION_DEFAUT_JOURS = 90;
/**
 * Réponses DÉTAILLÉES au questionnaire PCM (2.45.0, demande client).
 *
 * Bien plus court que la rétention du test lui-même, et sur un périmètre plus
 * LARGE : voir purgePcmReponses ci-dessous.
 */
const PCM_REPONSES_RETENTION_DEFAUT_JOURS = 30;
/** Rétention de gps_positions, en jours. Plafond de tout ce qui en dérive. */
const GPS_RETENTION_JOURS = 90;
/** Candidatures non recrutées (art. 5 RGPD, référentiel CNIL recrutement). */
const CANDIDATS_RETENTION_MOIS = 24;
/** Dossiers d'insertion clos — repli si `insertion.retention_months` est absent. */
const INSERTION_RETENTION_DEFAUT_MOIS = 24;

/**
 * Lecture d'un entier positif dans `settings`, avec repli sur le défaut du code.
 * Même pattern que services/messagerie.js (lireRetentionJours) — pas de nouvelle
 * dépendance, pas de valeur en dur ailleurs que dans les constantes ci-dessus.
 */
async function readSetting(cle, defaut) {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [cle]);
    const brut = r.rows[0] ? parseInt(r.rows[0].value, 10) : NaN;
    if (Number.isInteger(brut) && brut > 0) return brut;
  } catch (err) {
    console.warn(`[RGPD-PURGES] Réglage ${cle} illisible, repli ${defaut} :`, err.message);
  }
  return defaut;
}

/**
 * Écrit une ligne de synthèse dans rgpd_audit_log. Best effort : un journal
 * indisponible ne doit pas faire échouer une purge déjà appliquée (la donnée
 * est supprimée, la refaire échouer ne la ferait pas revenir).
 * Renvoie true si la ligne a bien été écrite.
 *
 * Le champ s'appelle `entiteAudit` et non `entityType` À DESSEIN : il désigne
 * l'entité du JOURNAL RGPD (`rgpd_audit_log`), qui n'est pas le journal
 * d'activité générique (`user_activity_log`). Les deux tables coexistent et
 * leurs vocabulaires diffèrent — la garde anti-dérive des libellés d'activité
 * les confondait en repérant `entityType:` par expression régulière, et
 * réclamait un libellé d'écran pour « pcm_sessions », qui n'apparaît jamais
 * sur cet écran-là.
 */
async function journaliserSynthese({ action, entiteAudit, userId = null, details }) {
  try {
    await pool.query(
      `INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 0, $4)`,
      // Vocabulaire écrit par cet INSERT. Le code arrive en paramètre $2 : il
      // n'est donc lisible NULLE PART dans le SQL, et la garde anti-dérive des
      // libellés du journal RGPD — qui lit le code source — ne le verrait pas.
      // Cette liste la lui rend visible ; l'y oublier, c'est laisser passer un
      // code brut à l'écran. Codes possibles : 'AUTO_PURGE_PCM_90J',
      // 'PURGE_PCM_NON_RECRUTE', 'AUTO_PURGE_GPS_90D', 'PURGE_GPS',
      // 'AUTO_PURGE_ARRETS_GPS', 'PURGE_ARRETS_GPS', 'PURGE_MESSAGERIE',
      // 'PURGE_REFRESH_TOKENS', 'PURGE_EXPIRED', 'PURGE_INSERTION',
      // 'AUTO_PURGE_PCM_REPONSES', 'PURGE_PCM_REPONSES'.
      [userId, action, entiteAudit, JSON.stringify(details)]
    );
    return true;
  } catch (err) {
    console.error(`[RGPD-PURGES] Journalisation ${action} impossible :`, err.message);
    return false;
  }
}

/** Résumé normalisé renvoyé par toutes les purges. */
function resume(cle, supprimes, retentionJours, journalise, extra = {}) {
  const total = Object.values(supprimes).reduce((a, b) => a + (Number(b) || 0), 0);
  return { cle, supprimes, total, retention_jours: retentionJours, journalise, items: total, ...extra };
}

// ══════════════════════════════════════════
// 1. TESTS PCM DES PERSONNES NON RECRUTÉES (nouveau — 2.44.0)
// ══════════════════════════════════════════

/**
 * Supprime DÉFINITIVEMENT les tests de personnalité des candidats dont le
 * statut n'est pas « recruté », passé le délai de rétention (défaut 90 jours,
 * réglable par `rgpd.pcm_non_recrute_retention_jours`).
 *
 * LE DÉLAI COURT DEPUIS LA PASSATION DU TEST (arbitrage client), pas depuis la
 * dernière activité du dossier candidat : `completed_at`, avec repli sur
 * `created_at` pour une session ouverte et jamais terminée — sans ce repli, un
 * lien de passation abandonné resterait en base indéfiniment.
 *
 * PÉRIMÈTRE : la session, et par CASCADE FK ses réponses (`pcm_answers`) et son
 * rapport chiffré (`pcm_reports`). La fiche candidat, elle, N'EST PAS touchée :
 * elle suit sa propre échéance à 24 mois (purgeExpiredCandidates). C'est bien
 * une purge plus courte et plus étroite que l'anonymisation du dossier.
 *
 * Un candidat « recruté » est épargné : son PCM suit désormais le dossier
 * salarié et disparaît à l'anonymisation de celui-ci (correctif 2.43.0).
 */
async function purgePcmNonRecrute({ trigger = 'auto', userId = null } = {}) {
  const retentionJours = await readSetting('rgpd.pcm_non_recrute_retention_jours', PCM_RETENTION_DEFAUT_JOURS);
  let sessionsSupprimees = 0;
  let echec = null;

  try {
    const result = await pool.query(
      `DELETE FROM pcm_sessions
        WHERE candidate_id IN (SELECT id FROM candidates WHERE status <> 'hired')
          AND COALESCE(completed_at, created_at) < NOW() - ($1 || ' days')::interval`,
      [String(retentionJours)]
    );
    sessionsSupprimees = result.rowCount || 0;
    if (sessionsSupprimees > 0) {
      console.log(`[RGPD-PURGES] PCM non recrutés : ${sessionsSupprimees} test(s) supprimé(s) (> ${retentionJours} jours)`);
    }
  } catch (err) {
    echec = err.message;
    console.error('[RGPD-PURGES] Erreur purgePcmNonRecrute :', err.message);
  }

  const manuel = trigger === 'manual';
  let journalise = false;
  if (manuel || sessionsSupprimees > 0) {
    journalise = await journaliserSynthese({
      action: manuel ? 'PURGE_PCM_NON_RECRUTE' : 'AUTO_PURGE_PCM_90J',
      entiteAudit: 'pcm_sessions',
      userId: manuel ? userId : null,
      details: {
        trigger,
        retention_jours: retentionJours,
        supprimes: { pcm_sessions: sessionsSupprimees },
        rows_deleted: sessionsSupprimees,
        critere: "candidats non recrutés, date de passation (completed_at, repli created_at)",
        ...(echec ? { echec } : {}),
      },
    });
  }

  return resume('pcm_non_recrute', { pcm_sessions: sessionsSupprimees }, retentionJours, journalise,
    echec ? { ok: false, motif: echec } : { ok: true });
}

// ══════════════════════════════════════════
// 1 bis. RÉPONSES DÉTAILLÉES AU QUESTIONNAIRE PCM (nouveau — 2.45.0)
// ══════════════════════════════════════════

/**
 * Supprime les 20 RÉPONSES du questionnaire (`pcm_answers`) passé un délai
 * court (défaut 30 jours, réglable par `rgpd.pcm_reponses_retention_jours`),
 * en laissant la synthèse exploitée : types de base et de phase, rapport
 * chiffré. C'est la contrepartie, demandée par le client, du maintien de la
 * passation dans le parcours de recrutement.
 *
 * POURQUOI. Une fois le profil calculé, les réponses item par item n'ont plus
 * AUCUN usage opérationnel : aucun écran ne les lit pour décider quoi que ce
 * soit — seul l'export PDF technique les affiche, et il se compose sans elles.
 * Les garder, c'est étendre la surface d'exposition d'un questionnaire de
 * personnalité sans contrepartie. C'est exactement ce que recommande la
 * recherche versée au dossier (rapports/pcm-insertion-2026-08-29/
 * 02-recherche-bibliographique.md §6.3 c : « ne pas conserver les réponses
 * item par item — seulement la synthèse exploitée »), et l'application du
 * principe de minimisation (art. 5-1-c RGPD).
 *
 * ELLE S'APPLIQUE À TOUT LE MONDE, RECRUTÉS COMPRIS — et c'est délibéré, écrit
 * ici pour que le choix se voie. La purge voisine (purgePcmNonRecrute) épargne
 * les personnes recrutées, parce que son fondement est la durée du dossier de
 * CANDIDATURE. Celle-ci ne repose pas sur l'issue du recrutement mais sur
 * l'inutilité de la donnée : elle ne devient pas utile parce que la personne a
 * été embauchée. Restreindre cette purge aux non-recrutés reviendrait à
 * conserver indéfiniment les réponses de ceux dont on a le plus de données par
 * ailleurs.
 *
 * MÊME COMPTAGE que la purge voisine — depuis la PASSATION (`completed_at`,
 * repli `created_at`) : deux délais comptés depuis deux dates différentes
 * seraient impossibles à expliquer à une personne concernée.
 *
 * CONSÉQUENCE ASSUMÉE, et dite à trois endroits (ici, dans la description du
 * registre des purges, et en tête de `scripts/reparer-rapports-pcm.js`) : le
 * script de réparation recalcule un rapport devenu illisible À PARTIR DES
 * RÉPONSES. Passé ce délai, il ne le peut plus — le rapport reste alors
 * illisible et l'écran le dit (422 PCM_ILLISIBLE). Les types de base et de
 * phase, eux, sont stockés EN CLAIR et survivent : ce n'est pas le profil qui
 * est perdu, c'est le rapport rédigé.
 */
async function purgePcmReponses({ trigger = 'auto', userId = null } = {}) {
  const retentionJours = await readSetting('rgpd.pcm_reponses_retention_jours', PCM_REPONSES_RETENTION_DEFAUT_JOURS);
  let reponsesSupprimees = 0;
  let echec = null;

  try {
    const result = await pool.query(
      // Aucun filtre sur le statut du candidat : voir le commentaire ci-dessus.
      `DELETE FROM pcm_answers
        WHERE session_id IN (
          SELECT id FROM pcm_sessions
           WHERE COALESCE(completed_at, created_at) < NOW() - ($1 || ' days')::interval
        )`,
      [String(retentionJours)]
    );
    reponsesSupprimees = result.rowCount || 0;
    if (reponsesSupprimees > 0) {
      console.log(`[RGPD-PURGES] Réponses PCM : ${reponsesSupprimees} réponse(s) supprimée(s) (> ${retentionJours} jours)`);
    }
  } catch (err) {
    echec = err.message;
    console.error('[RGPD-PURGES] Erreur purgePcmReponses :', err.message);
  }

  const manuel = trigger === 'manual';
  let journalise = false;
  if (manuel || reponsesSupprimees > 0) {
    journalise = await journaliserSynthese({
      action: manuel ? 'PURGE_PCM_REPONSES' : 'AUTO_PURGE_PCM_REPONSES',
      entiteAudit: 'pcm_answers',
      userId: manuel ? userId : null,
      details: {
        trigger,
        retention_jours: retentionJours,
        supprimes: { pcm_answers: reponsesSupprimees },
        rows_deleted: reponsesSupprimees,
        critere: "toutes les personnes (recrutées comprises), date de passation (completed_at, repli created_at)",
        ...(echec ? { echec } : {}),
      },
    });
  }

  return resume('pcm_reponses', { pcm_answers: reponsesSupprimees }, retentionJours, journalise,
    echec ? { ok: false, motif: echec } : { ok: true });
}

// ══════════════════════════════════════════
// 2. CANDIDATURES NON RECRUTÉES > 24 MOIS (déplacé de scheduler.js, inchangé)
// ══════════════════════════════════════════

/**
 * Anonymise les candidats non recrutés dont la fiche a été CRÉÉE il y a plus de
 * 24 mois (art. 5 RGPD). Une transaction par candidat + service mutualisé
 * `anonymizeCandidate` : couvre le MÊME périmètre que la route manuelle
 * historique (PCM, entretiens, mises en situation, documents).
 *
 * NOTE DE DIVERGENCE HÉRITÉE : la route historique POST /rgpd/purge-expired
 * compte le délai depuis `updated_at`, ce job depuis `created_at`. La règle est
 * documentée telle quelle dans GET /rgpd/politique. Le déplacement de ce code
 * ne l'a pas modifiée — la trancher est un arbitrage, pas un refactoring.
 */
async function purgeExpiredCandidates({ trigger = 'auto', userId = null } = {}) {
  const manuel = trigger === 'manual';
  const actionPersonne = manuel ? 'PURGE_EXPIRED' : 'AUTO_PURGE_24M';
  let anonymises = 0;
  let candidats = 0;
  let echec = null;

  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - CANDIDATS_RETENTION_MOIS);

    const expired = await pool.query(
      `SELECT id, first_name, last_name FROM candidates
       WHERE status != 'hired' AND created_at < $1
       AND first_name != 'ANONYME'`,
      [cutoff.toISOString()]
    );
    candidats = expired.rows.length;

    const { anonymizeCandidate } = require('./anonymization');
    for (const candidate of expired.rows) {
      // Transaction par candidat + service mutualisé : couvre le MÊME
      // périmètre que la route manuelle (PCM, entretiens, mises en situation,
      // documents) — la purge auto n'est pas moins complète que le manuel.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeCandidate(client, candidate.id);
        await client.query(
          `INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details)
           VALUES ($1, $2, 'candidate', $3, $4)`,
          // Codes possibles en $2 — cf. actionPersonne ci-dessus, et la note de
          // journaliserSynthese sur la garde de libellés :
          // 'AUTO_PURGE_24M' en automatique, 'PURGE_EXPIRED' en manuel.
          [userId, actionPersonne, candidate.id, JSON.stringify({
            reason: `Purge ${manuel ? 'manuelle' : 'automatique'} RGPD ${CANDIDATS_RETENTION_MOIS} mois`,
            original_name: `${candidate.first_name} ${candidate.last_name}`,
          })]
        );
        await client.query('COMMIT');
        anonymises += 1;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[RGPD-PURGES] purge candidat #${candidate.id} :`, e.message);
      } finally {
        client.release();
      }
    }

    if (candidats > 0) {
      console.log(`[RGPD-PURGES] RGPD: ${anonymises}/${candidats} candidat(s) anonymisé(s) (> ${CANDIDATS_RETENTION_MOIS} mois)`);
    }
  } catch (err) {
    echec = err.message;
    console.error('[RGPD-PURGES] Erreur purgeExpiredCandidates :', err.message);
  }

  // Synthèse : uniquement en manuel (l'automatique conserve son journal ligne à
  // ligne, celui d'avant — ajouter une synthèse en auto changerait le journal).
  let journalise = false;
  if (manuel) {
    journalise = await journaliserSynthese({
      action: 'PURGE_EXPIRED',
      entiteAudit: 'candidates',
      userId,
      details: {
        trigger, count: anonymises, candidats_concernes: candidats,
        threshold: `${CANDIDATS_RETENTION_MOIS} months`,
        critere: 'candidats non recrutés, date de création de la fiche',
        ...(echec ? { echec } : {}),
      },
    });
  }

  // retention_jours volontairement `null` : le seuil de cette purge s'exprime en
  // MOIS civils (calcul par setMonth). Le convertir en jours fabriquerait un
  // chiffre que le code n'applique pas.
  return resume('candidats_expires', { candidates: anonymises }, null, journalise,
    { retention_mois: CANDIDATS_RETENTION_MOIS, candidats_concernes: candidats, ok: !echec, ...(echec ? { motif: echec } : {}) });
}

// ══════════════════════════════════════════
// 3. DOSSIERS D'INSERTION CLOS (déplacé de scheduler.js, inchangé)
// ══════════════════════════════════════════

/**
 * Purge RGPD des dossiers d'insertion (EXG-40, PR 2) — rétention paramétrable.
 *
 * ANONYMISE (jamais de DELETE de lignes : passe par
 * services/anonymization.anonymizeEmployee qui nullifie/placeholde) les
 * dossiers des salariés :
 *   - parcours CLOS (insertion_status 'termine' ou 'abandon') — jamais un
 *     parcours en cours ni un dossier sans parcours ;
 *   - fiche INACTIVE (is_active=false — un salarié réembauché est épargné) ;
 *   - fin de parcours antérieure à `insertion.retention_months` (défaut
 *     24 mois — référentiel CNIL secteur social 2023).
 *
 * Le service d'anonymisation PRÉSERVE fse_entree/fse_sortie (piste d'audit
 * FSE+ ≥ 5 ans) et les agrégats statistiques. Chaque dossier est traité dans sa
 * propre transaction + entrée rgpd_audit_log ; le log ne porte pas le nom
 * (minimisation), seulement l'id et les paramètres.
 */
async function purgeInsertionDossiers({ trigger = 'auto', userId = null } = {}) {
  const manuel = trigger === 'manual';
  const actionPersonne = manuel ? 'PURGE_INSERTION' : 'AUTO_PURGE_INSERTION';
  let months = INSERTION_RETENTION_DEFAUT_MOIS;
  let done = 0;
  let concernes = 0;
  let echec = null;

  try {
    const { readInsertionSetting } = require('../utils/insertion-settings');
    const raw = Number(await readInsertionSetting('insertion.retention_months'));
    months = Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : INSERTION_RETENTION_DEFAUT_MOIS;

    const expired = await pool.query(
      `SELECT id, insertion_status, insertion_end_date
       FROM employees
       WHERE insertion_status IN ('termine', 'abandon')
         AND is_active = false
         AND insertion_end_date IS NOT NULL
         AND insertion_end_date < NOW() - make_interval(months => $1)
         AND first_name <> 'ANONYME'`,
      [months]
    );
    concernes = expired.rows.length;

    if (concernes > 0) {
      const { anonymizeEmployee } = require('./anonymization');
      for (const e of expired.rows) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await anonymizeEmployee(client, e.id);
          await client.query(
            `INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, 'employee', $3, $4)`,
            // Codes possibles en $2 : 'AUTO_PURGE_INSERTION' en automatique,
            // 'PURGE_INSERTION' en manuel.
            [userId, actionPersonne, e.id, JSON.stringify({
              reason: `Purge RGPD insertion — parcours ${e.insertion_status} clos depuis plus de ${months} mois`,
              retention_months: months,
              insertion_end_date: e.insertion_end_date,
            })]
          );
          await client.query('COMMIT');
          done += 1;
          console.log(`[RGPD-PURGES] RGPD insertion : dossier employé #${e.id} anonymisé (${e.insertion_status}, fin ${e.insertion_end_date ? new Date(e.insertion_end_date).toISOString().slice(0, 10) : '?'})`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`[RGPD-PURGES] purge dossier insertion #${e.id} :`, err.message);
        } finally {
          client.release();
        }
      }
      console.log(`[RGPD-PURGES] RGPD insertion : ${done}/${concernes} dossier(s) anonymisé(s) (rétention ${months} mois)`);
    }
  } catch (err) {
    echec = err.message;
    console.error('[RGPD-PURGES] Erreur purgeInsertionDossiers :', err.message);
  }

  let journalise = false;
  if (manuel) {
    journalise = await journaliserSynthese({
      action: 'PURGE_INSERTION',
      entiteAudit: 'insertion',
      userId,
      details: {
        trigger, count: done, dossiers_concernes: concernes, retention_months: months,
        critere: "parcours clos (terminé/abandon), fiche inactive, fin de parcours antérieure au délai",
        ...(echec ? { echec } : {}),
      },
    });
  }

  // Seuil exprimé en MOIS (make_interval(months => …)) : pas de conversion en
  // jours, qui donnerait une durée que la requête n'utilise pas.
  return resume('insertion_dossiers', { employees: done }, null, journalise,
    { retention_mois: months, dossiers_concernes: concernes, ok: !echec, ...(echec ? { motif: echec } : {}) });
}

// ══════════════════════════════════════════
// 4. POSITIONS GPS > 90 JOURS (déplacé de scheduler.js, inchangé)
// ══════════════════════════════════════════

/**
 * Purge automatique GPS — supprime les positions > 90 jours (rétention RGPD).
 * DELETE définitif, pas d'anonymisation : il n'y a rien d'exploitable à garder
 * dans un relevé de position.
 */
async function purgeOldGpsPositions({ trigger = 'auto', userId = null } = {}) {
  const manuel = trigger === 'manual';
  let supprimes = 0;
  let echec = null;

  try {
    const result = await pool.query(
      `DELETE FROM gps_positions WHERE recorded_at < NOW() - INTERVAL '90 days'`
    );
    supprimes = result.rowCount || 0;
    if (supprimes > 0) {
      console.log(`[RGPD-PURGES] GPS: ${supprimes} position(s) supprimée(s) (> ${GPS_RETENTION_JOURS} jours)`);
    }
  } catch (err) {
    echec = err.message;
    console.error('[RGPD-PURGES] Erreur purgeOldGpsPositions :', err.message);
  }

  let journalise = false;
  if (manuel || supprimes > 0) {
    journalise = await journaliserSynthese({
      action: manuel ? 'PURGE_GPS' : 'AUTO_PURGE_GPS_90D',
      entiteAudit: 'gps_positions',
      userId: manuel ? userId : null,
      details: {
        trigger, rows_deleted: supprimes, retention_days: GPS_RETENTION_JOURS,
        supprimes: { gps_positions: supprimes },
        ...(echec ? { echec } : {}),
      },
    });
  }

  return resume('gps_positions', { gps_positions: supprimes }, GPS_RETENTION_JOURS, journalise,
    { ok: !echec, ...(echec ? { motif: echec } : {}) });
}

// ══════════════════════════════════════════
// 5. ARRÊTS DE TOURNÉE DÉRIVÉS DU GPS (déplacé de scheduler.js, inchangé)
// ══════════════════════════════════════════

/**
 * Purge des arrêts de tournée détectés (`tour_gps_stops`).
 *
 * Ses lignes sont DÉRIVÉES de `gps_positions`, purgée à 90 jours ci-dessus au
 * titre de la proportionnalité. Sans ce job, la trace brute disparaissait
 * pendant que les arrêts qu'on en avait extraits — position, heure, durée,
 * tournée, véhicule, donc conducteur affecté — se conservaient indéfiniment.
 * Une purge de source qui ne protège rien n'est pas une purge.
 *
 * RÈGLE : la rétention est paramétrable (`collecte.arrets_retention_jours`)
 * mais BORNÉE à celle de la source. On peut la raccourcir, jamais l'allonger
 * au-delà de 90 jours.
 */
async function purgeArretsGps({ trigger = 'auto', userId = null } = {}) {
  const manuel = trigger === 'manual';
  let retentionJours = GPS_RETENTION_JOURS;
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key = 'collecte.arrets_retention_jours'");
    const brut = r.rows[0] ? parseInt(r.rows[0].value, 10) : NaN;
    if (Number.isInteger(brut) && brut > 0) {
      retentionJours = Math.min(brut, GPS_RETENTION_JOURS);
      if (brut > GPS_RETENTION_JOURS) {
        console.warn(`[RGPD-PURGES] Arrêts GPS : rétention réglée à ${brut} j, ramenée à ${GPS_RETENTION_JOURS} j `
          + '(plafond de la source gps_positions — une donnée dérivée ne survit pas à son relevé).');
      }
    }
  } catch (err) {
    console.warn('[RGPD-PURGES] Réglage collecte.arrets_retention_jours illisible, repli 90 j :', err.message);
  }

  try {
    const result = await pool.query(
      "DELETE FROM tour_gps_stops WHERE debut < NOW() - ($1 || ' days')::interval",
      [String(retentionJours)]
    );
    const supprimes = result.rowCount || 0;
    if (supprimes > 0) {
      console.log(`[RGPD-PURGES] Arrêts GPS : ${supprimes} arrêt(s) supprimé(s) (> ${retentionJours} jours)`);
    }
    let journalise = false;
    if (manuel || supprimes > 0) {
      journalise = await journaliserSynthese({
        action: manuel ? 'PURGE_ARRETS_GPS' : 'AUTO_PURGE_ARRETS_GPS',
        entiteAudit: 'tour_gps_stops',
        userId: manuel ? userId : null,
        details: {
          trigger, rows_deleted: supprimes, retention_days: retentionJours,
          plafond_source_days: GPS_RETENTION_JOURS,
          supprimes: { tour_gps_stops: supprimes },
        },
      });
    }
    return resume('arrets_gps', { tour_gps_stops: supprimes }, retentionJours, journalise,
      { ok: true, arrets_supprimes: supprimes });
  } catch (err) {
    // Base non migrée (table absente) : on le dit, on ne fait pas échouer le
    // tour de jobs pour autant.
    const absente = err && err.code === '42P01';
    if (absente) {
      console.warn('[RGPD-PURGES] Table tour_gps_stops absente (base non migrée) — purge des arrêts ignorée.');
    } else {
      console.error('[RGPD-PURGES] Erreur purgeArretsGps :', err.message);
    }
    const motif = absente ? 'table tour_gps_stops absente' : err.message;
    let journalise = false;
    if (manuel) {
      journalise = await journaliserSynthese({
        action: 'PURGE_ARRETS_GPS', entiteAudit: 'tour_gps_stops', userId,
        details: { trigger, rows_deleted: 0, retention_days: retentionJours, echec: motif },
      });
    }
    return resume('arrets_gps', { tour_gps_stops: 0 }, retentionJours, journalise,
      { ok: false, motif, arrets_supprimes: 0 });
  }
}

// ══════════════════════════════════════════
// 6. MESSAGERIE INTERNE (délègue à services/messagerie.js — propriétaire)
// ══════════════════════════════════════════

/**
 * Purge de rétention de la messagerie interne.
 *
 * L'implémentation reste dans services/messagerie.js (elle recale aussi les
 * accusés de lecture orphelins et supprime les conversations vides — logique
 * qui appartient à ce module). Ici on ne fait que l'appeler et, en déclenchement
 * MANUEL, ajouter la ligne de journal nominative qui dit qu'un humain l'a
 * lancée : `purgeMessagerieRetention()` n'accepte aucun paramètre et écrit
 * son propre `AUTO_PURGE_MESSAGERIE` quand elle a supprimé quelque chose — sauf
 * en déclenchement MANUEL, où elle reçoit `{ journaliser: false }` : la ligne est
 * alors écrite ici, sous le code manuel et avec l'utilisateur qui a agi. Le job
 * planifié, lui, est strictement inchangé.
 *
 * Require PARESSEUX obligatoire : services/messagerie charge middleware/auth,
 * dont le cache des rôles personnalisés interroge la base DÈS le require — la
 * première requête émise par le scheduler doit rester son verrou advisory.
 */
async function purgeMessagerie({ trigger = 'auto', userId = null } = {}) {
  const manuel = trigger === 'manual';
  // En manuel, on coupe la journalisation interne : c'est nous qui écrivons la
  // ligne, avec l'utilisateur qui a cliqué (sinon deux lignes, dont une « AUTO_ »).
  const r = await require('./messagerie').purgeMessagerieRetention({ journaliser: !manuel });
  const supprimes = {
    messagerie_messages: r.messages_supprimes || 0,
    messagerie_conversations: r.conversations_supprimees || 0,
  };

  let journalise = false;
  if (manuel) {
    journalise = await journaliserSynthese({
      action: 'PURGE_MESSAGERIE',
      entiteAudit: 'messagerie_messages',
      userId,
      details: {
        trigger, supprimes, retention_jours: r.retention_jours,
        pointeurs_recales: r.pointeurs_recales || 0,
        ...(r.ok === false ? { echec: r.motif } : {}),
      },
    });
  }

  return resume('messagerie', supprimes, r.retention_jours, journalise,
    { ok: r.ok !== false, pointeurs_recales: r.pointeurs_recales || 0, ...(r.ok === false ? { motif: r.motif } : {}) });
}

// ══════════════════════════════════════════
// 7. JETONS DE RAFRAÎCHISSEMENT EXPIRÉS (déplacé de scheduler.js, inchangé)
// ══════════════════════════════════════════

/**
 * Purge des refresh tokens expirés (audit vague 3, item 3.C-4).
 * Jusqu'ici, les jetons expirés n'étaient supprimés qu'au démarrage (init-db) ;
 * la table grossissait entre deux redémarrages.
 *
 * Aucun journal RGPD en mode automatique (comportement d'origine : ce n'est pas
 * une donnée personnelle conservée mais un jeton techniquement mort) ; en
 * déclenchement manuel la ligne est écrite, comme pour les autres purges, parce
 * qu'un humain a agi.
 */
async function purgeExpiredRefreshTokens({ trigger = 'auto', userId = null } = {}) {
  const manuel = trigger === 'manual';
  let supprimes = 0;
  let echec = null;

  try {
    const result = await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
    supprimes = result.rowCount || 0;
    if (supprimes > 0) {
      console.log(`[RGPD-PURGES] Refresh tokens: ${supprimes} jeton(s) expiré(s) supprimé(s)`);
    }
  } catch (err) {
    echec = err.message;
    console.error('[RGPD-PURGES] Erreur purgeExpiredRefreshTokens :', err.message);
  }

  let journalise = false;
  if (manuel) {
    journalise = await journaliserSynthese({
      action: 'PURGE_REFRESH_TOKENS',
      entiteAudit: 'refresh_tokens',
      userId,
      details: { trigger, rows_deleted: supprimes, supprimes: { refresh_tokens: supprimes }, ...(echec ? { echec } : {}) },
    });
  }

  return resume('refresh_tokens', { refresh_tokens: supprimes }, null, journalise,
    { ok: !echec, ...(echec ? { motif: echec } : {}) });
}

// ══════════════════════════════════════════
// REGISTRE — source unique consommée par le scheduler, la route de
// déclenchement manuel et la liste affichée à l'écran RGPD.
//
// `entiteAudit` = valeur écrite dans rgpd_audit_log.entity_type (exposée telle
// quelle par l'API sous le nom `entity_type`). Voir journaliserSynthese pour la
// raison du nom.
// ══════════════════════════════════════════

const PURGES_RGPD = [
  {
    cle: 'pcm_non_recrute',
    libelle: 'Tests PCM des personnes non recrutées',
    description: "Supprime définitivement le test de personnalité (session, réponses et rapport chiffré) des candidats dont le statut n'est pas « recruté », passé le délai. Le délai court depuis la PASSATION du test (repli : sa création si la session n'a jamais été terminée), pas depuis la dernière activité du dossier. La fiche candidat n'est pas touchée : elle suit sa propre échéance à 24 mois.",
    fn: purgePcmNonRecrute,
    actionAuto: 'AUTO_PURGE_PCM_90J',
    actionManuelle: 'PURGE_PCM_NON_RECRUTE',
    jobName: 'purgePcmNonRecrute',
    entiteAudit: 'pcm_sessions',
    retentionSetting: 'rgpd.pcm_non_recrute_retention_jours',
    retentionDefaut: PCM_RETENTION_DEFAUT_JOURS,
    retentionUnite: 'jours',
  },
  {
    cle: 'pcm_reponses',
    libelle: 'Réponses détaillées au questionnaire PCM',
    description: "Supprime les 20 réponses au questionnaire passé un délai court, en conservant la synthèse exploitée (types de base et de phase, rapport chiffré). Une fois le profil calculé, les réponses item par item n'ont plus d'usage opérationnel : les garder étend la surface d'exposition sans contrepartie (minimisation, art. 5-1-c). Contrairement à la purge ci-dessus, elle s'applique à TOUTES LES PERSONNES, y compris celles qui ont été recrutées — le fondement n'est pas l'issue du recrutement mais l'inutilité de la donnée. Conséquence assumée : passé ce délai, un rapport chiffré devenu illisible n'est plus reconstructible depuis les réponses (le script reparer-rapports-pcm.js le dit).",
    fn: purgePcmReponses,
    actionAuto: 'AUTO_PURGE_PCM_REPONSES',
    actionManuelle: 'PURGE_PCM_REPONSES',
    jobName: 'purgePcmReponses',
    entiteAudit: 'pcm_answers',
    retentionSetting: 'rgpd.pcm_reponses_retention_jours',
    retentionDefaut: PCM_REPONSES_RETENTION_DEFAUT_JOURS,
    retentionUnite: 'jours',
  },
  {
    cle: 'candidats_expires',
    libelle: 'Candidatures non recrutées de plus de 24 mois',
    description: "Anonymise (identité, CV, notes d'entretien, PCM, mises en situation, documents) les candidats non recrutés dont la fiche a été CRÉÉE il y a plus de 24 mois. Le bouton historique « Purge auto (24 mois) » de l'onglet Droits compte le même délai depuis la dernière modification de la fiche — divergence héritée, documentée dans la politique.",
    fn: purgeExpiredCandidates,
    actionAuto: 'AUTO_PURGE_24M',
    actionManuelle: 'PURGE_EXPIRED',
    jobName: 'purgeExpiredCandidates',
    entiteAudit: 'candidates',
    retentionSetting: null,
    retentionDefaut: CANDIDATS_RETENTION_MOIS,
    retentionUnite: 'mois',
  },
  {
    cle: 'insertion_dossiers',
    libelle: "Dossiers d'insertion clos",
    description: "Anonymise le dossier des salariés dont le parcours est terminé ou abandonné, dont la fiche est inactive, et dont la fin de parcours dépasse le délai de rétention. Les agrégats non nominatifs (scores de freins, classification de sortie) et les données FSE+ sont conservés.",
    fn: purgeInsertionDossiers,
    actionAuto: 'AUTO_PURGE_INSERTION',
    actionManuelle: 'PURGE_INSERTION',
    jobName: 'purgeInsertionDossiers',
    entiteAudit: 'insertion',
    retentionSetting: 'insertion.retention_months',
    retentionDefaut: INSERTION_RETENTION_DEFAUT_MOIS,
    retentionUnite: 'mois',
  },
  {
    cle: 'gps_positions',
    libelle: 'Positions GPS des véhicules',
    description: "Supprime définitivement les relevés de géolocalisation des tournées de collecte de plus de 90 jours (DELETE, pas d'anonymisation : rien d'exploitable à conserver dans un relevé de position).",
    fn: purgeOldGpsPositions,
    actionAuto: 'AUTO_PURGE_GPS_90D',
    actionManuelle: 'PURGE_GPS',
    jobName: 'purgeOldGpsPositions',
    entiteAudit: 'gps_positions',
    retentionSetting: null,
    retentionDefaut: GPS_RETENTION_JOURS,
    retentionUnite: 'jours',
  },
  {
    cle: 'arrets_gps',
    libelle: 'Arrêts de tournée détectés',
    description: "Supprime les arrêts extraits des relevés GPS. Rétention paramétrable mais BORNÉE à celle de sa source (90 jours) : une donnée dérivée ne survit pas au relevé dont elle est tirée.",
    fn: purgeArretsGps,
    actionAuto: 'AUTO_PURGE_ARRETS_GPS',
    actionManuelle: 'PURGE_ARRETS_GPS',
    jobName: 'purgeArretsGps',
    entiteAudit: 'tour_gps_stops',
    retentionSetting: 'collecte.arrets_retention_jours',
    retentionDefaut: GPS_RETENTION_JOURS,
    retentionUnite: 'jours',
  },
  {
    cle: 'messagerie',
    libelle: 'Messagerie interne',
    description: "Supprime les messages plus vieux que la rétention, recale les accusés de lecture devenus orphelins et supprime les conversations vides et sans activité depuis le même délai.",
    fn: purgeMessagerie,
    actionAuto: 'AUTO_PURGE_MESSAGERIE',
    actionManuelle: 'PURGE_MESSAGERIE',
    jobName: 'purgeMessagerieRetention',
    entiteAudit: 'messagerie_messages',
    retentionSetting: 'messagerie.retention_jours',
    retentionDefaut: 365,
    retentionUnite: 'jours',
  },
  {
    cle: 'refresh_tokens',
    libelle: 'Jetons de rafraîchissement expirés',
    description: "Supprime les jetons de session expirés, qui s'accumulaient sinon en base entre deux redémarrages. Aucune donnée personnelle exploitable : ce sont des jetons techniquement morts.",
    fn: purgeExpiredRefreshTokens,
    actionAuto: null,
    actionManuelle: 'PURGE_REFRESH_TOKENS',
    jobName: 'purgeExpiredRefreshTokens',
    entiteAudit: 'refresh_tokens',
    retentionSetting: null,
    retentionDefaut: null,
    retentionUnite: null,
  },
];

/** Retrouve une purge par sa clé (liste blanche — jamais de fn arbitraire). */
function trouverPurge(cle) {
  return PURGES_RGPD.find((p) => p.cle === cle) || null;
}

/**
 * Seuil de rétention RÉELLEMENT appliqué par une purge : la valeur du réglage
 * si elle existe, sinon le défaut du code — et le plafond de la source pour les
 * arrêts GPS, qui ne peuvent pas survivre au relevé dont ils dérivent.
 * Une purge sans seuil temporel (jetons expirés) renvoie `valeur: null` : l'écran
 * doit le dire, pas afficher un zéro.
 */
async function retentionEffective(purge) {
  const base = {
    unite: purge.retentionUnite,
    defaut: purge.retentionDefaut,
    parametrable: purge.retentionSetting,
  };
  if (purge.retentionDefaut == null) return { ...base, valeur: null, source: null };
  if (!purge.retentionSetting) return { ...base, valeur: purge.retentionDefaut, source: 'code' };
  const lu = await readSetting(purge.retentionSetting, purge.retentionDefaut);
  const valeur = purge.cle === 'arrets_gps' ? Math.min(lu, GPS_RETENTION_JOURS) : lu;
  return { ...base, valeur, source: valeur === purge.retentionDefaut ? 'code' : purge.retentionSetting };
}

module.exports = {
  PURGES_RGPD,
  trouverPurge,
  retentionEffective,
  purgePcmNonRecrute,
  purgePcmReponses,
  purgeExpiredCandidates,
  purgeInsertionDossiers,
  purgeOldGpsPositions,
  purgeArretsGps,
  purgeMessagerie,
  purgeExpiredRefreshTokens,
  // Exposés pour les tests et pour la politique affichée à l'écran.
  readSetting,
  PCM_RETENTION_DEFAUT_JOURS,
  PCM_REPONSES_RETENTION_DEFAUT_JOURS,
  GPS_RETENTION_JOURS,
  CANDIDATS_RETENTION_MOIS,
  INSERTION_RETENTION_DEFAUT_MOIS,
};
