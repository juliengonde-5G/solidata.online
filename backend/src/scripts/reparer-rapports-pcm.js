#!/usr/bin/env node
/**
 * Rapports PCM devenus illisibles — diagnostic, puis réparation.
 *
 * CE QUI S'EST PASSÉ. Un rapport est chiffré avec la clé en vigueur le jour du
 * test. Cette clé a changé au moins deux fois dans l'histoire du produit :
 * rotation du JWT_SECRET (v2.0.2), puis mise en service d'une clé PCM dédiée
 * (v2.0.5). Les tests passés avant ces bascules ne sont donc plus déchiffrables
 * avec la clé du jour — d'où des profils récents qui s'ouvrent et des profils
 * anciens qui refusent, sans que rien ne l'explique à l'écran.
 *
 * CE QUE FAIT CE SCRIPT.
 *   1. DIAGNOSTIC (par défaut, aucune écriture) : pour chaque rapport, dit avec
 *      quelle clé il se lit — celle du jour, une clé historique, ou aucune — et,
 *      dans ce dernier cas, s'il est reconstructible depuis les réponses.
 *   2. RÉPARATION (--apply) : ré-enregistre avec la clé DU JOUR tout rapport lu
 *      grâce à une clé historique (sans quoi le problème reviendra à la
 *      prochaine rotation), et reconstruit ceux qu'aucune clé n'ouvre.
 *
 * FENÊTRE DE RÉPARATION — À LIRE AVANT DE COMPTER SUR CE SCRIPT (2.45.0).
 * La reconstruction repose ENTIÈREMENT sur `pcm_answers`. Or ces réponses sont
 * désormais purgées 30 jours après la passation, pour tout le monde, recrutés
 * compris (settings « rgpd.pcm_reponses_retention_jours », service
 * services/rgpd-purges.js, job purgePcmReponses) : c'est la contrepartie du
 * maintien du test dans le parcours de recrutement, et c'est délibéré.
 * Passé ce délai, un rapport illisible reste illisible — ce script le dira, il
 * ne le réparera pas. Ce qui subsiste dans tous les cas : les types de base et
 * de phase, stockés EN CLAIR depuis toujours. Ce n'est donc pas le profil qui
 * se perd, c'est le rapport rédigé autour de lui.
 *
 * CE QU'IL NE FAIT PAS. Il n'invente jamais un profil : un rapport illisible
 * dont la session n'a plus de réponses est signalé et laissé tel quel. Et les
 * types Base/Phase enregistrés le jour du test ne sont JAMAIS réécrits — ils
 * sont en clair depuis toujours, ils font foi, et un moteur de calcul qui a
 * évolué depuis n'a pas à réécrire l'histoire.
 *
 * Usage :
 *   node src/scripts/reparer-rapports-pcm.js              # diagnostic
 *   node src/scripts/reparer-rapports-pcm.js --apply      # réparation
 *
 * Si l'ancienne clé est connue (ancien .env, sauvegarde), la fournir d'abord :
 *   PCM_ENCRYPTION_KEYS_LEGACY="ancienne-cle,encore-plus-ancienne" node ... --apply
 */
const pool = require('../config/database');
const { encryptReport, decryptReportDetaille, clesHistoriques } = require('../utils/pcm-crypto');
// Le moteur de calcul vit dans la route PCM et n'existe qu'à UN endroit : un
// second moteur divergerait au premier ajustement de pondération.
const { calculatePCMProfile } = require('../routes/pcm');

const APPLY = process.argv.includes('--apply');

async function main() {
  const historiques = clesHistoriques();
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Rapports PCM — ${APPLY ? 'RÉPARATION' : 'DIAGNOSTIC (aucune écriture)'}`);
  console.log(`  Clés historiques essayées : ${historiques.length}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const { rows } = await pool.query(
    `SELECT pr.id, pr.session_id, pr.candidate_id, pr.base_type, pr.phase_type,
            pr.encrypted_report, pr.created_at,
            c.first_name, c.last_name
       FROM pcm_reports pr
       LEFT JOIN candidates c ON c.id = pr.candidate_id
      ORDER BY pr.created_at`
  );
  if (rows.length === 0) {
    console.log('Aucun rapport PCM en base.\n');
    return;
  }

  const bilan = { courante: 0, historique: 0, reconstruit: 0, perdu: 0, divergent: 0 };

  for (const r of rows) {
    const qui = `#${r.id} ${r.last_name || '?'} ${r.first_name || ''}`.trim()
      + ` (${new Date(r.created_at).toLocaleDateString('fr-FR')})`;
    const { report, cle } = decryptReportDetaille(r.encrypted_report);

    if (cle === 'courante') {
      bilan.courante += 1;
      continue;   // rien à faire : lisible avec la clé du jour
    }

    if (report) {
      bilan.historique += 1;
      console.log(`  ⟳ ${qui} — lu avec une clé ${cle}, à ré-enregistrer`);
      if (APPLY) {
        await pool.query('UPDATE pcm_reports SET encrypted_report = $1 WHERE id = $2',
          [encryptReport(report), r.id]);
      }
      continue;
    }

    // Aucune clé ne l'ouvre : reste la reconstruction depuis les réponses, qui
    // n'ont jamais été chiffrées.
    const rep = await pool.query(
      'SELECT question_number, answer_value FROM pcm_answers WHERE session_id = $1 ORDER BY question_number',
      [r.session_id]
    );
    if (rep.rows.length === 0) {
      bilan.perdu += 1;
      console.log(`  ✗ ${qui} — illisible ET sans réponses : non reconstructible`);
      continue;
    }

    const rec = calculatePCMProfile(rep.rows);
    bilan.reconstruit += 1;
    const divergence = rec.baseType !== r.base_type || rec.phaseType !== r.phase_type;
    if (divergence) bilan.divergent += 1;
    console.log(
      `  ↻ ${qui} — reconstruit depuis ${rep.rows.length} réponses`
      + (divergence
        ? ` ⚠ profil recalculé ${rec.baseType}/${rec.phaseType} ≠ enregistré ${r.base_type}/${r.phase_type}`
        : ' (profil identique)')
    );
    if (APPLY) {
      // Le rapport est remplacé ; les types du jour du test ne sont PAS
      // réécrits — ils font foi, et le moteur a évolué depuis.
      await pool.query('UPDATE pcm_reports SET encrypted_report = $1 WHERE id = $2',
        [encryptReport(rec.report), r.id]);
    }
  }

  console.log('\n───────────────── Bilan ─────────────────');
  console.log(`  Lisibles avec la clé du jour ...... ${bilan.courante}`);
  console.log(`  Lus avec une clé historique ....... ${bilan.historique}${APPLY ? ' (ré-enregistrés)' : ''}`);
  console.log(`  Reconstruits depuis les réponses .. ${bilan.reconstruit}${APPLY ? ' (ré-enregistrés)' : ''}`);
  console.log(`     dont profil divergent .......... ${bilan.divergent}`);
  console.log(`  Perdus (ni clé, ni réponses) ...... ${bilan.perdu}`);
  console.log(`  Total ............................. ${rows.length}`);
  if (!APPLY && (bilan.historique + bilan.reconstruit) > 0) {
    console.log('\n  Aucune écriture effectuée. Relancer avec --apply pour réparer.');
  }
  if (bilan.perdu > 0) {
    console.log("\n  Les rapports perdus le restent tant que leur clé d'origine est inconnue.");
    console.log('  Si vous la retrouvez : PCM_ENCRYPTION_KEYS_LEGACY="ancienne-cle" node ... --apply');
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[PCM] Échec :', err.message); process.exit(1); });
