#!/usr/bin/env node
/**
 * Sonde de découverte de l'API Malibou.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE SONDE PLUTÔT QU'UN MAPPAGE ÉCRIT D'AVANCE
 *
 * Brancher un import de paie suppose de connaître trois choses : l'hôte de
 * l'API, la façon dont la clé s'y présente, et le NOM des champs renvoyés.
 * Les inventer produirait un module qui « fonctionne » en test et se tait en
 * production — ou pire, qui écrit dans les fiches salariés un champ pris pour
 * un autre. Cette sonde va donc les CONSTATER sur l'API réelle, avec la vraie
 * clé, et ranger ce qu'elle a constaté dans `settings` (avec --apply).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE IMPRIME EST SÛR À TRANSMETTRE
 *
 * La réponse d'une API de paie, ce sont les dossiers du personnel. La sonde
 * n'imprime donc que la FORME : chemin du champ, type, nombre d'occurrences,
 * motif de format (`9999-99-99`). Les valeurs ne sortent que lorsqu'elles se
 * RÉPÈTENT d'un salarié à l'autre — c'est-à-dire pour les énumérations (type
 * de contrat, statut), jamais pour un patronyme, qui est unique par personne.
 * Voir `utils/schema-redige.js` pour la règle exacte.
 *
 * LECTURE SEULE : la sonde n'émet que des GET.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   node src/scripts/malibou-diagnostic.js                 # découverte, simulation
 *   node src/scripts/malibou-diagnostic.js --apply         # + enregistre base et mode
 *   node src/scripts/malibou-diagnostic.js --base=https://… --chemins=employees,contracts
 *
 * Si la documentation Malibou est sous vos yeux, `--base=` et `--chemins=`
 * évitent tout tâtonnement : la sonde n'essaie alors que ce que vous lui
 * donnez.
 */
const malibou = require('../services/malibou');
const { resumer } = require('../utils/schema-redige');
const pool = require('../config/database');

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const val = (n) => {
  const a = args.find((x) => x.startsWith(`${n}=`));
  return a ? a.slice(n.length + 1) : null;
};

/**
 * Hôtes essayés quand aucun n'est fourni. Ce ne sont QUE des candidats : la
 * sonde ne retient que celui qui répond réellement, et dit lesquels ont
 * échoué. Aucun n'est écrit en dur ailleurs dans l'application.
 */
const ORIGINES_CANDIDATES = [
  'https://api.malibou.com',
  'https://app.malibou.com',
  'https://public-api.malibou.com',
];
const PREFIXES_CANDIDATS = ['/api/public/v1', '/public/v1', '/v1', ''];

/** Ressources cherchées, par ordre de vraisemblance. */
const CHEMINS_CANDIDATS = [
  'employees', 'collaborators', 'salaries', 'people', 'users',
  'contracts', 'employment_contracts', 'companies', 'me',
];

const ligne = (c = '─') => console.log(c.repeat(78));

async function essayer(base, chemin, cle, mode, query) {
  const r = await malibou.appelBrut({ base, chemin, cle, modeAuth: mode, query, timeout: 12000 });
  return r;
}

/**
 * Phase 1 — trouver l'hôte et le mode d'authentification qui répondent.
 * Un 200 vaut découverte ; un 401/403 prouve que l'hôte EXISTE mais que le
 * mode est faux (information utile, on la garde) ; un 404 dit que le chemin
 * n'est pas le bon, pas que l'hôte est mauvais.
 */
async function decouvrir(cle, basesForcees, cheminsForces) {
  const bases = basesForcees
    || ORIGINES_CANDIDATES.flatMap((o) => PREFIXES_CANDIDATS.map((p) => `${o}${p}`));
  const chemins = cheminsForces || CHEMINS_CANDIDATS;
  const traces = [];

  for (const base of bases) {
    for (const chemin of chemins.slice(0, 3)) {
      for (const mode of malibou.MODES_AUTH) {
        const r = await essayer(base, chemin, cle, mode.id, { limit: 1 });
        traces.push({ base, chemin, mode: mode.id, status: r.status, ms: r.ms, erreur: r.erreur || null });
        if (r.ok) return { trouve: { base, chemin, mode: mode.id }, traces };
        // 401/403 : l'hôte répond, c'est le mode qui ne va pas — on continue
        // à faire tourner les modes sur CET hôte plutôt que de l'abandonner.
        if (r.status === 404 || r.status === 0) break;
      }
    }
  }
  return { trouve: null, traces };
}

(async () => {
  const applique = has('--apply');
  const basesForcees = val('--base') ? [val('--base')] : null;
  const cheminsForces = val('--chemins') ? val('--chemins').split(',').map((s) => s.trim()).filter(Boolean) : null;
  const echantillon = Number(val('--echantillon') || 25);

  ligne('═');
  console.log('  SONDE DE DÉCOUVERTE — API MALIBOU (lecture seule)');
  ligne('═');

  const cle = await malibou.lireCle();
  if (!cle) {
    console.error("\n✗ Aucune clé API Malibou configurée.");
    console.error('  → node src/scripts/configurer-malibou.js --apply   (clé sur l\'entrée standard)');
    console.error('  → ou variable d\'environnement MALIBOU_API_KEY');
    await pool.end();
    process.exit(2);
  }
  console.log(`\nClé utilisée : ${malibou.masquerCle(cle)}`);

  // ── Phase 1 : hôte + mode d'authentification ──────────────────────────
  const config = await malibou.lireConfig();
  let base = basesForcees ? basesForcees[0] : config.base;
  let mode = config.auth;

  if (base && mode && !basesForcees) {
    console.log(`Configuration déjà enregistrée : ${base} (${mode})`);
  } else {
    console.log('\n▶ Recherche de l\'hôte et du mode d\'authentification…');
    const { trouve, traces } = await decouvrir(cle, basesForcees, cheminsForces);
    console.log(`  ${traces.length} tentative(s)`);
    // On n'imprime que les tentatives instructives : tout lister noierait le
    // signal sous des dizaines de 404 attendus.
    for (const t of traces.filter((x) => x.status && x.status !== 404)) {
      console.log(`    ${String(t.status).padStart(3)}  ${t.base}/${t.chemin}  [${t.mode}]  ${t.ms} ms${t.erreur ? `  — ${t.erreur}` : ''}`);
    }
    if (!trouve) {
      console.error('\n✗ Aucune combinaison n\'a répondu.');
      console.error('  La documentation Malibou donne l\'hôte exact et le chemin des ressources.');
      console.error('  Relancer en les fournissant :');
      console.error('    node src/scripts/malibou-diagnostic.js --base=https://<hote>/api/public/v1 --chemins=employees');
      console.error('\n  Un 401 ci-dessus signifierait que l\'hôte est bon mais la clé ou le mode non.');
      await pool.end();
      process.exit(1);
    }
    base = trouve.base;
    mode = trouve.mode;
    console.log(`\n  ✓ Hôte : ${base}`);
    console.log(`  ✓ Mode d'authentification : ${mode}`);
  }

  // ── Phase 2 : quelles ressources existent ─────────────────────────────
  console.log('\n▶ Ressources accessibles…');
  const chemins = cheminsForces || CHEMINS_CANDIDATS;
  const disponibles = [];
  for (const chemin of chemins) {
    const r = await essayer(base, chemin, cle, mode, { limit: 1 });
    const marque = r.ok ? '✓' : (r.status === 401 || r.status === 403 ? '⊘' : '·');
    console.log(`  ${marque} ${String(r.status).padStart(3)}  ${chemin}`);
    if (r.ok) disponibles.push(chemin);
  }

  if (disponibles.length === 0) {
    console.error('\n✗ Aucune ressource lisible avec cette clé.');
    console.error('  Si la documentation classe ces points d\'accès « Partners only »,');
    console.error('  une clé en libre-service ne peut pas les atteindre : il faut un accord de partenariat.');
    await pool.end();
    process.exit(1);
  }

  // ── Phase 3 : forme des données (EXPURGÉE) ────────────────────────────
  for (const chemin of disponibles) {
    ligne();
    console.log(`  FORME DE « ${chemin} »`);
    ligne();
    const r = await essayer(base, chemin, cle, mode, { limit: echantillon });
    const liste = malibou.extraireListe(r.json);

    // L'enveloppe elle-même est une information : savoir que la liste est sous
    // `data` et la pagination sous `meta.next_cursor` évite de le redécouvrir.
    if (!Array.isArray(r.json) && r.json && typeof r.json === 'object') {
      console.log(`  enveloppe : { ${Object.keys(r.json).join(', ')} }`);
    }
    console.log(`  ${liste.length} enregistrement(s) dans la page (limit=${echantillon})`);
    const suite = malibou.pageSuivante(r.json, 1);
    console.log(`  pagination : ${suite ? JSON.stringify(suite) : 'aucune page suivante annoncée'}`);

    if (liste.length === 0) {
      console.log('  (aucun enregistrement — rien à décrire)');
      continue;
    }
    if (liste.length < 5) {
      console.log('  ⚠ moins de 5 enregistrements : aucune valeur ne sera affichée');
      console.log('    (la règle d\'expurgation ne sait pas distinguer une énumération d\'une donnée sur un si petit échantillon)');
    }
    console.log('');
    console.log(resumer(liste).texte);
  }

  // ── Enregistrement ────────────────────────────────────────────────────
  ligne('═');
  if (applique) {
    await malibou.store.setSetting(malibou.CLE_BASE, base);
    await malibou.store.setSetting(malibou.CLE_AUTH, mode);
    console.log(`✓ Enregistré : ${malibou.CLE_BASE} = ${base}`);
    console.log(`✓ Enregistré : ${malibou.CLE_AUTH} = ${mode}`);
  } else {
    console.log('[SIMULATION] rien n\'a été écrit.');
    console.log(`  Relancer avec --apply pour enregistrer ${base} (${mode}).`);
  }
  console.log('\nLa sortie ci-dessus ne contient aucune donnée personnelle : elle peut être transmise telle quelle.');
  ligne('═');
  await pool.end();
})().catch((err) => {
  console.error('\n✗', err.message);
  if (err.detail) console.error('  détail :', err.detail);
  process.exit(1);
});
