#!/usr/bin/env node
/**
 * SOLIDATA — Smoke test API post-déploiement.
 *
 * Objectif : attraper les régressions de type « la requête SQL fait référence
 * à une colonne qui n'existe plus » AVANT que l'utilisateur les voie en prod.
 *
 * Ce script frappe une liste exhaustive d'endpoints critiques et fait
 * échouer le deploy (exit 1) dès qu'un seul retourne 5xx. Les 200/204 et
 * les 401/403 (rôle insuffisant = endpoint existe et fonctionne) sont OK.
 *
 * IDENTITÉ — CLÉ D'API DE SERVICE (2.45.0)
 * ─────────────────────────────────────────
 * Ce test ne se CONNECTE plus. Il ne possède ni identifiant, ni mot de passe,
 * ni secret de double authentification : il présente une CLÉ D'API dédiée
 * (en-tête `X-API-Key`), en LECTURE SEULE, révocable et expirable.
 *
 * Pourquoi ce changement : jusqu'ici le test ouvrait une vraie session avec un
 * compte ADMIN dont le mot de passe ET le secret TOTP vivaient côte à côte dans
 * le `.env` du serveur — soit les deux facteurs au même endroit, ce qui annule
 * le bénéfice de la double authentification. Une clé est un secret unique, à
 * portée limitée, qui n'ouvre aucune session humaine et ne peut rien écrire.
 *
 * Usage :
 *   node scripts/tests/api-smoke.js
 *   BASE_URL=https://solidata.online SMOKE_API_KEY=sol_xxx_yyy node scripts/tests/api-smoke.js
 *
 * Variables d'environnement :
 *   BASE_URL       — URL du backend (défaut: http://localhost:3001)
 *   SMOKE_API_KEY  — Clé d'API de service (format `sol_<prefix>_<secret>`).
 *                    Sans elle, les endpoints protégés sont SKIPpés et le smoke
 *                    est aveugle aux 500 derrière l'authentification.
 *                    Création : dans le conteneur backend,
 *                    `node src/scripts/creer-cle-api.js --apply`
 *   SMOKE_STRICT   — Si "true", traite aussi les SKIP comme des échecs
 *                    (utile en CI/deploy pour forcer la couverture)
 *
 * Codes de sortie :
 *   0 — Tout passe
 *   1 — Au moins un test a échoué (5xx, structure incohérente, etc.)
 *   2 — Erreur fatale (BASE_URL inaccessible, exception inattendue)
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
// Clé d'API de service (lecture seule). Remplace API_USER / API_PASSWORD /
// API_TOTP_SECRET, qui rangeaient les deux facteurs d'un compte ADMIN au même
// endroit. Ces trois variables ne sont PLUS lues : les laisser dans le .env
// n'a aucun effet, il faut les retirer.
const SMOKE_API_KEY = process.env.SMOKE_API_KEY;
const STRICT = process.env.SMOKE_STRICT === 'true';

// Identifiant RÉSERVÉ des deux sondes de sécurité ci-dessous. Il n'est créé
// nulle part et ne peut correspondre à personne : quand ces deux échecs de
// connexion apparaissent au journal depuis l'adresse du serveur, c'est
// l'autocontrôle du déploiement, jamais une tentative d'intrusion.
const IDENTIFIANT_SONDE = 'smoke-test-identifiant-invalide';

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function ok(id, desc, detail = '') {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${id} — ${desc}${detail ? ' (' + detail + ')' : ''}`);
}
function fail(id, desc, detail = '') {
  failed++;
  failures.push({ id, desc, detail });
  console.log(`  \x1b[31m✗\x1b[0m ${id} — ${desc}${detail ? ' : ' + detail : ''}`);
}
function skipMsg(id, desc) {
  skipped++;
  console.log(`  \x1b[33m⊘\x1b[0m ${id} — ${desc} [SKIP]`);
}

async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Traverse le mode maintenance : le smoke test vérifie l'application
      // APRÈS un déploiement, alors que la page de maintenance peut encore
      // être posée. Sans cet en-tête il se heurterait à elle et déclarerait en
      // panne un service parfaitement sain (cf. conf.d/maintenance-garde.inc).
      'X-Solidata-Bypass-Maintenance': '1',
      ...headers,
    },
  };
  if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch { data = null; }
  return { status: res.status, data };
}

// Test générique : vérifie qu'un GET ne renvoie PAS 5xx.
// 2xx → ok. 401/403 → ok (endpoint existe, simplement protégé).
// 404 → fail (un endpoint smoké doit exister). 5xx → fail.
async function checkEndpoint(id, path, desc, { authH = null, expect2xx = false } = {}) {
  try {
    const { status, data } = await request('GET', path, null, authH || {});
    if (expect2xx) {
      if (status >= 200 && status < 300) return ok(id, desc, `${status}`);
      return fail(id, desc, `attendu 2xx, reçu ${status}${data?.error ? ` (${data.error})` : ''}`);
    }
    if (status >= 500) {
      return fail(id, desc, `5xx ${status}${data?.error ? ` (${data.error})` : ''}`);
    }
    if (status === 404) {
      return fail(id, desc, `404 — endpoint introuvable`);
    }
    if (status >= 200 && status < 300) return ok(id, desc, `${status}`);
    if (status === 401 || status === 403) return ok(id, desc, `${status} protégé`);
    return fail(id, desc, `status inattendu ${status}`);
  } catch (e) {
    return fail(id, desc, `exception : ${e.message}`);
  }
}

async function run() {
  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║  SOLIDATA — Smoke test API                         ║`);
  console.log(`║  Cible : ${BASE_URL.padEnd(42)}║`);
  console.log(`║  Date  : ${TODAY.padEnd(42)}║`);
  console.log(`║  Mode  : ${(STRICT ? 'STRICT (SKIP = fail)' : 'normal').padEnd(42)}║`);
  console.log(`╚════════════════════════════════════════════════════╝\n`);

  // ═══ §1 Santé & disponibilité (pas d'auth) ═══
  console.log('─── §1 Santé & disponibilité ───');
  try {
    const { status, data } = await request('GET', '/api/health');
    if (status === 200 && data?.status === 'ok') {
      ok('T-HEALTH-01', 'Health check API', `PostGIS: ${data.database?.postgis || data.modules?.auth || 'N/A'}`);
    } else {
      fail('T-HEALTH-01', 'Health check API', `status=${status}`);
    }
  } catch (e) {
    console.error(`\n\x1b[31mFATAL : impossible de joindre ${BASE_URL}/api/health (${e.message})\x1b[0m`);
    process.exit(2);
  }

  // ═══ §2 Identité de service (clé d'API) ═══
  console.log("\n─── §2 Identité de service (clé d'API) ───");

  // Accès protégé sans aucune identité → 401 attendu
  try {
    const { status } = await request('GET', '/api/candidates/kanban');
    if (status === 401) ok('T-AUTH-01', 'Accès protégé sans identité (401)');
    else fail('T-AUTH-01', 'Accès protégé sans identité', `attendu 401, reçu ${status}`);
  } catch (e) { fail('T-AUTH-01', 'Accès protégé sans identité', e.message); }

  // Clé mal formée → 401 attendu (la porte de service est fermée par défaut)
  try {
    const { status } = await request('GET', '/api/candidates/kanban', null, { 'X-API-Key': 'sol_inexistante_zzz' });
    if (status === 401) ok('T-AUTH-02', "Clé d'API inconnue rejetée (401)");
    else fail('T-AUTH-02', "Clé d'API inconnue", `attendu 401, reçu ${status}`);
  } catch (e) { fail('T-AUTH-02', "Clé d'API inconnue", e.message); }

  // Une clé absente, expirée, révoquée ou mal configurée n'est PAS une
  // régression de l'application : c'est un test qu'on ne peut pas exécuter.
  // Confondre les deux ferait annuler par un rollback un déploiement
  // parfaitement sain (même doctrine que le « smoke non exécuté » de deploy.sh).
  // On dégrade donc en le DISANT fort. Seul un 5xx — le serveur qui tombe en
  // essayant de dire qui nous sommes — est un vrai échec.
  let authH = null;
  let motifDegradation = null;
  if (SMOKE_API_KEY) {
    try {
      const entetes = { 'X-API-Key': SMOKE_API_KEY };
      const { status, data } = await request('GET', '/api/auth/me', null, entetes);
      if (status === 200 && data?.is_service === true) {
        authH = entetes;
        ok('T-AUTH-03', "Clé d'API de service acceptée", `rôle : ${data.role || '?'}`);
      } else if (status >= 500) {
        fail('T-AUTH-03', "Clé d'API de service", `5xx ${status}${data?.error ? ` (${data.error})` : ''}`);
      } else if (status === 401) {
        motifDegradation = 'la clé est inconnue, révoquée ou expirée — en recréer une (creer-cle-api.js)';
      } else if (status === 403) {
        // Clé sans le scope de service, ou sans rôle : le serveur dit lequel.
        motifDegradation = `clé refusée — ${data?.error || 'scope ou rôle manquant'}`;
      } else if (status === 200) {
        motifDegradation = "le serveur a répondu sans identité de service : backend antérieur à la clé de service ?";
      } else {
        motifDegradation = `réponse inattendue ${status}${data?.error ? ` (${data.error})` : ''}`;
      }
    } catch (e) { motifDegradation = `injoignable : ${e.message}`; }
  } else {
    motifDegradation = 'SMOKE_API_KEY non définie';
  }

  if (!authH && motifDegradation) {
    if (STRICT) {
      fail('T-AUTH-03', "Clé d'API de service", `${motifDegradation} — couverture des endpoints protégés impossible`);
    } else {
      skipMsg('T-AUTH-03', `Clé d'API de service (${motifDegradation})`);
    }
  }

  if (!authH) {
    console.log("\n\x1b[33m⚠️  Pas de clé de service exploitable — seuls les endpoints publics sont testés. La majorité des bugs 500 derrière l'authentification ne seront pas attrapés.\x1b[0m");
    console.log("\x1b[33m   Pour la créer, dans le conteneur backend : node src/scripts/creer-cle-api.js --apply, puis SMOKE_API_KEY=... dans le .env du serveur.\x1b[0m");
  }

  // ═══ §3 Dashboard & Accueil (premier écran utilisateur) ═══
  if (authH) {
    console.log('\n─── §3 Dashboard & Accueil ───');
    await checkEndpoint('T-DASH-01', '/api/dashboard/kpis',      'KPIs dashboard (Promise.all × 20+ queries)', { authH });
    await checkEndpoint('T-DASH-02', '/api/dashboard/objectifs', 'Objectifs dashboard', { authH });
    await checkEndpoint('T-DASH-03', '/api/historique/kpi',      'Historique KPI mensuel', { authH });
    await checkEndpoint('T-DASH-04', '/api/news?limit=5',        'Fil actualités (widget home)', { authH });
  }

  // ═══ §4 Production (a planté — schema drift u.nom/u.prenom) ═══
  if (authH) {
    console.log('\n─── §4 Production ───');
    await checkEndpoint('T-PROD-01', '/api/production',                              'Production — listing', { authH });
    await checkEndpoint('T-PROD-02', `/api/production/feuille/${TODAY}`,             'Production — feuille du jour', { authH });
    await checkEndpoint('T-PROD-03', `/api/production/objectives?date=${TODAY}`,     'Production — objectifs du jour', { authH });
    await checkEndpoint('T-PROD-04', `/api/production/consignes?date=${TODAY}`,      'Production — consignes du jour', { authH });
    await checkEndpoint('T-PROD-05', `/api/production/commentaires/${TODAY}`,        'Production — commentaires (JOIN users)', { authH });
    await checkEndpoint('T-PROD-06', '/api/production/managers-tri',                 'Production — managers tri', { authH });
  }

  // ═══ §5 Reporting ═══
  if (authH) {
    console.log('\n─── §5 Reporting ───');
    await checkEndpoint('T-REP-01', '/api/reporting/collecte',           'Reporting collecte', { authH });
    // NB: reporting.js n'expose que /dashboard, /collecte, /cav-map. Les écrans
    // Reporting Production / RH / Métropole consomment d'autres routes réelles.
    await checkEndpoint('T-REP-02', '/api/production/dashboard',          'Reporting production (production/dashboard)', { authH });
    await checkEndpoint('T-REP-03', '/api/performance/industrial-kpis',   'Reporting RH (performance/industrial-kpis)', { authH });
    await checkEndpoint('T-REP-04', '/api/metropole/dashboard',           'Reporting Métropole Rouen (metropole/dashboard)', { authH });
  }

  // ═══ §6 Collecte ═══
  if (authH) {
    console.log('\n─── §6 Collecte ───');
    await checkEndpoint('T-COL-01', '/api/cav',                  'CAV — listing', { authH });
    await checkEndpoint('T-COL-02', '/api/cav/fill-rate',        'CAV — remplissage', { authH });
    await checkEndpoint('T-COL-03', '/api/cav/map',              'CAV — carte', { authH });
    await checkEndpoint('T-COL-04', '/api/tours',                'Tournées', { authH });
    await checkEndpoint('T-COL-05', '/api/tours/active-summary', 'Tournées actives (live)', { authH });
    await checkEndpoint('T-COL-06', '/api/vehicles',             'Véhicules', { authH });
    await checkEndpoint('T-COL-07', '/api/vehicles/available',   'Véhicules disponibles', { authH });
  }

  // ═══ §7 Stock & Tri ═══
  if (authH) {
    console.log('\n─── §7 Stock & Tri ───');
    await checkEndpoint('T-STO-01', '/api/stock',                       'Stock — listing', { authH });
    await checkEndpoint('T-STO-02', '/api/stock/summary',               'Stock — résumé', { authH });
    await checkEndpoint('T-STO-03', '/api/stock-original/ledger',       'Stock original — grand livre (ledger)', { authH });
    await checkEndpoint('T-STO-04', '/api/tri/chaines',                 'Chaînes de tri', { authH });
  }

  // ═══ §8 Logistique exutoires ═══
  if (authH) {
    console.log('\n─── §8 Logistique exutoires ───');
    await checkEndpoint('T-EXU-01', '/api/clients-exutoires',        'Clients exutoires', { authH });
    await checkEndpoint('T-EXU-02', '/api/commandes-exutoires',      'Commandes exutoires', { authH });
    await checkEndpoint('T-EXU-03', '/api/preparations',             'Préparations expédition', { authH });
    await checkEndpoint('T-EXU-04', '/api/tarifs-exutoires',         'Tarifs exutoires', { authH });
    await checkEndpoint('T-EXU-05', '/api/factures-exutoires/stats', 'Factures exutoires — stats', { authH });
  }

  // ═══ §9 RH & Insertion ═══
  if (authH) {
    console.log('\n─── §9 RH & Insertion ───');
    await checkEndpoint('T-RH-01', '/api/candidates/kanban',             'Candidats kanban', { authH });
    await checkEndpoint('T-RH-02', '/api/candidates/stats',              'Candidats stats', { authH });
    await checkEndpoint('T-RH-03', '/api/employees',                     'Employés', { authH });
    await checkEndpoint('T-RH-04', '/api/employees/kpi/formation',       'KPI formation', { authH });
    await checkEndpoint('T-RH-05', '/api/employees/kpi/etp',             'KPI ETP', { authH });
    await checkEndpoint('T-RH-06', '/api/employees/kpi/absenteisme',     'KPI absentéisme', { authH });
    await checkEndpoint('T-RH-07', '/api/insertion',                     'Parcours insertion', { authH });
    await checkEndpoint('T-RH-08', '/api/insertion/milestones-overview', 'Jalons insertion', { authH });
    await checkEndpoint('T-RH-09', '/api/teams',                         'Équipes', { authH });
    // Extension insertion 2026-07 (PR1 phase B) — lots 1-3
    await checkEndpoint('T-RH-10', '/api/insertion/actions-overview',    'Insertion — actions transversales', { authH });
    await checkEndpoint('T-RH-11', '/api/insertion/partenaires',         'Insertion — partenaires', { authH });
    await checkEndpoint('T-RH-12', '/api/insertion/cohorte/stats',       'Insertion — tableau de bord CIP', { authH });
    await checkEndpoint('T-RH-13', '/api/insertion/parametres',          'Insertion — réglages module (phase D)', { authH });
  }

  // ═══ §10 Finance ═══
  if (authH) {
    console.log('\n─── §10 Finance ───');
    await checkEndpoint('T-FIN-01', `/api/finance/gl/${YEAR}/pl`,         'Finance — P&L', { authH });
    await checkEndpoint('T-FIN-02', `/api/finance/gl/${YEAR}/tresorerie`, 'Finance — Trésorerie', { authH });
    await checkEndpoint('T-FIN-03', `/api/finance/operations/${YEAR}`,    'Finance — Opérations', { authH });
  }

  // ═══ §11 Boutiques ═══
  if (authH) {
    console.log('\n─── §11 Boutiques ───');
    await checkEndpoint('T-BTQ-01', '/api/boutiques', 'Boutiques — listing', { authH });
  }

  // ═══ §11bis Temps & Présence (badgeuse — module 33) ═══
  if (authH) {
    console.log('\n─── §11bis Temps & Présence (badgeuse) ───');
    // /parametres est le point d'entrée du module : il touche settings + les
    // défauts documentés. S'il répond, le routeur est monté et la grille lisible.
    await checkEndpoint('T-BDG-01', '/api/badgeuse/parametres', 'Badgeuse — grille de paramètres', { authH });
    await checkEndpoint('T-BDG-02', '/api/badgeuse/devices',    'Badgeuse — supervision des postes', { authH });
  }

  // ═══ §12 Référentiels & Admin (a planté — positions ORDER BY name) ═══
  if (authH) {
    console.log('\n─── §12 Référentiels & Admin ───');
    await checkEndpoint('T-REF-01', '/api/referentiels/positions', 'Référentiels — positions', { authH });
    await checkEndpoint('T-REF-02', '/api/settings',                'Paramètres', { authH });
    await checkEndpoint('T-REF-03', '/api/users',                   'Utilisateurs (ADMIN seul)', { authH });
  }

  // ═══ §13 Autocontrôles de sécurité ═══
  //
  // LIRE CECI SI VOUS VOYEZ DES ÉCHECS DE CONNEXION AU JOURNAL.
  // Les deux sondes ci-dessous provoquent VOLONTAIREMENT deux échecs de
  // connexion depuis l'adresse du serveur, à chaque déploiement. Ce ne sont pas
  // des tentatives d'intrusion : ce sont les autocontrôles du déploiement.
  // Elles portent toutes les deux l'identifiant réservé « smoke-test-identifiant-
  // invalide », qui n'existe dans aucun compte — le journal est donc
  // auto-explicatif. On les garde parce qu'elles vérifient une vraie propriété
  // de sécurité : la porte d'entrée refuse un identifiant inconnu, et elle ne se
  // laisse pas ouvrir par une chaîne d'injection SQL.
  console.log('\n─── §13 Autocontrôles de sécurité ───');
  try {
    const { status } = await request('POST', '/api/auth/login',
      { username: IDENTIFIANT_SONDE, password: 'mot-de-passe-volontairement-faux' });
    if (status === 401) ok('T-SEC-01', 'Identifiant inconnu refusé (401) — échec de connexion attendu au journal');
    else if (status === 429) ok('T-SEC-01', 'Identifiant inconnu rate-limité (429)');
    else fail('T-SEC-01', 'Identifiant inconnu refusé', `attendu 401, reçu ${status}`);
  } catch (e) { fail('T-SEC-01', 'Identifiant inconnu refusé', e.message); }

  try {
    const { status } = await request('POST', '/api/auth/login',
      { username: `${IDENTIFIANT_SONDE}' OR '1'='1`, password: `' OR '1'='1` });
    if (status === 401) ok('T-SEC-02', 'Injection SQL au login refusée (401) — échec de connexion attendu au journal');
    else if (status === 429) ok('T-SEC-02', 'Injection SQL au login rate-limitée (429)');
    else fail('T-SEC-02', 'Injection SQL au login', `attendu 401, reçu ${status}`);
  } catch (e) { fail('T-SEC-02', 'Injection SQL au login', e.message); }

  // La clé de service est-elle RÉELLEMENT en lecture seule ? On le vérifie sur
  // le serveur qui vient d'être déployé, pas seulement dans les tests unitaires.
  // C'est la garantie qui rend acceptable une clé portant un rôle élevé : si
  // elle cédait, une clé volée pourrait écrire.
  if (authH) {
    try {
      const { status, data } = await request('POST', '/api/news', { title: 'sonde', content: 'sonde' }, authH);
      if (status === 403 && data?.code === 'SERVICE_KEY_READ_ONLY') {
        ok('T-SEC-03', "Clé de service en lecture seule : écriture refusée (403)");
      } else if (status === 403) {
        ok('T-SEC-03', "Clé de service : écriture refusée (403)", data?.error || '');
      } else {
        fail('T-SEC-03', 'Clé de service en lecture seule',
          `ÉCRITURE NON REFUSÉE — attendu 403, reçu ${status}`);
      }
    } catch (e) { fail('T-SEC-03', 'Clé de service en lecture seule', e.message); }
  } else {
    skipMsg('T-SEC-03', 'Clé de service en lecture seule (pas de clé)');
  }

  // ═══ Résumé ═══
  const total = passed + failed + skipped;
  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║  Résultats : ${String(passed).padStart(3)} ✓   ${String(failed).padStart(3)} ✗   ${String(skipped).padStart(3)} ⊘   (${String(total).padStart(3)} total)  ║`);
  console.log(`╚════════════════════════════════════════════════════╝`);

  if (failures.length > 0) {
    console.log(`\n\x1b[31mÉchecs (${failures.length}) :\x1b[0m`);
    for (const f of failures) {
      console.log(`  ✗ ${f.id} ${f.desc}${f.detail ? ' — ' + f.detail : ''}`);
    }
  }

  if (failed > 0) {
    console.log(`\n\x1b[31m${failed} test(s) échoué(s). Deploy à arrêter / rollback à envisager.\x1b[0m\n`);
    process.exit(1);
  }
  console.log(`\n\x1b[32mTous les tests exécutés sont passés.\x1b[0m\n`);
  process.exit(0);
}

run().catch((err) => {
  console.error('\x1b[31mErreur fatale dans le smoke test :\x1b[0m', err);
  process.exit(2);
});
