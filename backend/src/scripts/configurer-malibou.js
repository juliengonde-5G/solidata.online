#!/usr/bin/env node
/**
 * Enregistre la clé d'API Malibou, chiffrée, dans `settings`.
 *
 * LA CLÉ NE PASSE PAS PAR LA LIGNE DE COMMANDE, et c'est délibéré : un
 * `--cle=...` se retrouve dans l'historique du shell, dans la sortie de `ps`
 * le temps de l'exécution, et dans les journaux d'audit du serveur. Elle se
 * lit sur l'entrée standard, où rien ne la conserve.
 *
 *   docker compose -f docker-compose.prod.yml exec -T backend \
 *     node src/scripts/configurer-malibou.js --apply <<< 'LA_CLE'
 *
 * (la forme `<<<` laisse la clé dans l'historique du shell appelant ; pour
 * l'éviter, préfixer la commande d'une espace si le shell est configuré avec
 * HISTCONTROL=ignorespace, ou la coller au clavier après avoir lancé la
 * commande sans redirection.)
 *
 * Options :
 *   --apply            écrit réellement (sans ce drapeau : simulation)
 *   --base=<url>       fixe l'URL de base sans passer par le diagnostic
 *   --auth=<mode>      fixe le mode d'authentification (bearer, x-api-key…)
 *   --supprimer        efface clé, base et mode
 */
const malibou = require('../services/malibou');
const pool = require('../config/database');

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const val = (n) => {
  const a = args.find((x) => x.startsWith(`${n}=`));
  return a ? a.slice(n.length + 1) : null;
};

/**
 * Lit la clé sur l'entrée standard. Sur un vrai terminal la saisie est
 * VISIBLE : on le dit plutôt que de bricoler un masquage en mode brut, dont
 * l'échec silencieux afficherait la clé en croyant la cacher.
 */
function lireStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdout.write("Collez la clé API Malibou puis Entrée (elle sera visible à l'écran) : ");
    }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
      buf += d;
      if (process.stdin.isTTY && buf.includes('\n')) {
        process.stdin.pause();
        resolve(buf.trim());
      }
    });
    process.stdin.on('end', () => resolve(buf.trim()));
  });
}

(async () => {
  const applique = has('--apply');

  if (args.some((a) => a.startsWith('--cle'))) {
    console.error("✗ La clé ne se passe pas en argument (historique du shell, ps, journaux). Passez-la sur l'entrée standard.");
    process.exit(2);
  }

  if (has('--supprimer')) {
    if (!applique) {
      console.log("[SIMULATION] effacerait la clé, l'URL de base et le mode d'authentification Malibou.");
    } else {
      await malibou.store.setSetting(malibou.CLE_API, null);
      await malibou.store.setSetting(malibou.CLE_BASE, null);
      await malibou.store.setSetting(malibou.CLE_AUTH, null);
      console.log('✓ Configuration Malibou effacée');
    }
    await pool.end();
    return;
  }

  const base = val('--base');
  const auth = val('--auth');
  const cle = await lireStdin();

  if (!cle) {
    console.error("✗ Aucune clé lue sur l'entrée standard.");
    process.exit(2);
  }
  if (auth && !malibou.MODES_AUTH.some((m) => m.id === auth)) {
    console.error(`✗ Mode d'authentification inconnu : ${auth} (attendus : ${malibou.MODES_AUTH.map((m) => m.id).join(', ')})`);
    process.exit(2);
  }

  console.log(`Clé lue : ${malibou.masquerCle(cle)}`);
  if (base) console.log(`URL de base : ${base}`);
  if (auth) console.log(`Mode d'authentification : ${auth}`);

  if (!applique) {
    console.log("\n[SIMULATION] rien n'a été écrit. Relancer avec --apply pour enregistrer.");
    await pool.end();
    return;
  }

  await malibou.store.setEncryptedSetting(malibou.CLE_API, cle);
  if (base) await malibou.store.setSetting(malibou.CLE_BASE, base);
  if (auth) await malibou.store.setSetting(malibou.CLE_AUTH, auth);

  const st = await malibou.statut();
  console.log('\n✓ Clé enregistrée (chiffrée AES-256-GCM dans settings)');
  if (st.manques.length) {
    console.log(`⚠ Il manque encore : ${st.manques.join(', ')}`);
    console.log('  → lancer : node src/scripts/malibou-diagnostic.js --apply');
  } else {
    console.log('✓ Configuration complète.');
  }
  await pool.end();
})().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
