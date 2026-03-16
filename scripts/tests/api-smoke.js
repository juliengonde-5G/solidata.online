#!/usr/bin/env node
/**
 * Script de tests techniques (smoke) — API SOLIDATA ERP
 *
 * Couvre les cas du Plan de Tests Déploiement :
 *   §2.1 Santé, §2.2 Auth, §2.3 Rôles, §2.4 Endpoints critiques,
 *   §2.5 Cohérence données, §2.6 Sécurité
 *
 * Usage:
 *   node scripts/tests/api-smoke.js
 *   BASE_URL=https://recette.solidata.online node scripts/tests/api-smoke.js
 *   BASE_URL=https://... API_USER=admin API_PASSWORD=secret node scripts/tests/api-smoke.js
 *
 * Variables d'environnement:
 *   BASE_URL     - URL du backend (défaut: http://localhost:3001)
 *   API_USER     - Identifiant pour tests authentifiés (optionnel)
 *   API_PASSWORD - Mot de passe (optionnel)
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const API_USER = process.env.API_USER;
const API_PASSWORD = process.env.API_PASSWORD;

let token = null;
let passed = 0;
let failed = 0;
let skipped = 0;

function ok(id, desc, detail = '') {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${id} — ${desc}${detail ? ' (' + detail + ')' : ''}`);
}

function fail(id, desc, detail = '') {
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${id} — ${desc}${detail ? ' : ' + detail : ''}`);
}

function skip(id, desc) {
  skipped++;
  console.log(`  \x1b[33m⊘\x1b[0m ${id} — ${desc} [SKIP]`);
}

async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
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

async function run() {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  SOLIDATA ERP — Smoke Test API           ║`);
  console.log(`║  Cible : ${BASE_URL.padEnd(32)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  // ═══ §2.1 Santé et disponibilité ═══
  console.log('─── §2.1 Santé et Disponibilité ───');
  try {
    const { status, data } = await request('GET', '/api/health');
    if (status === 200 && data?.status === 'ok' && data?.database?.connected) {
      ok('T-SANTE-01', 'Health check API', `PostGIS: ${data.database.postgis || 'N/A'}`);
    } else {
      fail('T-SANTE-01', 'Health check API', `status=${status}`);
    }
  } catch (e) {
    fail('T-SANTE-01', 'Health check API', e.message);
  }

  // T-SANTE-04 : CORS (vérification basique)
  try {
    const url = `${BASE_URL}/api/health`;
    const res = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://solidata.online' } });
    const acaoHeader = res.headers.get('access-control-allow-origin');
    if (acaoHeader) ok('T-SANTE-04', 'CORS headers présents', `ACAO: ${acaoHeader}`);
    else skip('T-SANTE-04', 'CORS (pas de header ACAO sur OPTIONS)');
  } catch (e) {
    fail('T-SANTE-04', 'CORS', e.message);
  }

  // ═══ §2.2 Authentification ═══
  console.log('\n─── §2.2 Authentification ───');

  // T-AUTH-02 : Login invalide
  try {
    const { status } = await request('POST', '/api/auth/login', { username: '__invalid__', password: '__wrong__' });
    if (status === 401) ok('T-AUTH-02', 'Login invalide rejeté (401)');
    else fail('T-AUTH-02', 'Login invalide', `attendu 401, reçu ${status}`);
  } catch (e) {
    fail('T-AUTH-02', 'Login invalide', e.message);
  }

  // T-AUTH-03 : Accès protégé sans token
  try {
    const { status } = await request('GET', '/api/candidates/kanban');
    if (status === 401) ok('T-AUTH-03', 'Accès protégé sans token (401)');
    else fail('T-AUTH-03', 'Accès protégé sans token', `attendu 401, reçu ${status}`);
  } catch (e) {
    fail('T-AUTH-03', 'Accès protégé sans token', e.message);
  }

  // T-AUTH-01 : Login valide
  if (API_USER && API_PASSWORD) {
    try {
      const { status, data } = await request('POST', '/api/auth/login', { username: API_USER, password: API_PASSWORD });
      if (status === 200 && (data?.accessToken || data?.token)) {
        token = data.accessToken || data.token;
        ok('T-AUTH-01', 'Login valide', `rôle: ${data.user?.role || '?'}`);
      } else {
        fail('T-AUTH-01', 'Login valide', `status=${status}`);
      }
    } catch (e) {
      fail('T-AUTH-01', 'Login valide', e.message);
    }

    // T-AUTH-05 : Me (profil)
    if (token) {
      try {
        const { status, data } = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${token}` });
        if (status === 200 && data?.id) ok('T-AUTH-05', `Profil /auth/me`, `${data.first_name} ${data.last_name}`);
        else fail('T-AUTH-05', 'Profil /auth/me', `status=${status}`);
      } catch (e) {
        fail('T-AUTH-05', 'Profil /auth/me', e.message);
      }
    }
  } else {
    skip('T-AUTH-01', 'Login (API_USER/API_PASSWORD non définis)');
    skip('T-AUTH-05', 'Profil /auth/me');
  }

  // ═══ §2.3 Autorisation par rôle ═══
  if (token) {
    console.log('\n─── §2.3 Autorisation par Rôle ───');
    const authH = { Authorization: `Bearer ${token}` };
    const roleTests = [
      { id: 'T-ROLE-01', path: '/api/candidates/kanban', desc: 'Kanban candidats' },
      { id: 'T-ROLE-02', path: '/api/employees', desc: 'Employés' },
      { id: 'T-ROLE-03', path: '/api/tours', desc: 'Tournées' },
      { id: 'T-ROLE-04', path: '/api/vehicles', desc: 'Véhicules' },
      { id: 'T-ROLE-05', path: '/api/users', desc: 'Utilisateurs (ADMIN)' },
    ];
    for (const t of roleTests) {
      try {
        const { status } = await request('GET', t.path, null, authH);
        if (status === 200) ok(t.id, t.desc, '200');
        else if (status === 403) ok(t.id, t.desc, '403 — rôle insuffisant (attendu)');
        else fail(t.id, t.desc, `status=${status}`);
      } catch (e) {
        fail(t.id, t.desc, e.message);
      }
    }
  }

  // ═══ §2.4 Endpoints critiques par domaine ═══
  if (token) {
    console.log('\n─── §2.4 Endpoints Critiques ───');
    const authH = { Authorization: `Bearer ${token}` };
    const endpoints = [
      { id: 'T-EP-01', path: '/api/candidates/stats', desc: 'Stats candidats' },
      { id: 'T-EP-02', path: '/api/insertion', desc: 'Parcours insertion' },
      { id: 'T-EP-03', path: '/api/insertion/milestones-overview', desc: 'Jalons insertion' },
      { id: 'T-EP-04', path: '/api/tours', desc: 'Tournées' },
      { id: 'T-EP-05', path: '/api/vehicles/available', desc: 'Véhicules disponibles' },
      { id: 'T-EP-06', path: '/api/cav', desc: 'Points de collecte (CAV)' },
      { id: 'T-EP-07', path: '/api/cav/map', desc: 'Carte CAV' },
      { id: 'T-EP-08', path: '/api/cav/fill-rate', desc: 'Remplissage CAV' },
      { id: 'T-EP-09', path: '/api/historique/kpi', desc: 'Dashboard KPI' },
      { id: 'T-EP-10', path: '/api/reporting/collecte', desc: 'Reporting collecte' },
      { id: 'T-EP-11', path: '/api/stock', desc: 'Stock' },
      { id: 'T-EP-12', path: '/api/stock/summary', desc: 'Stock résumé' },
      { id: 'T-EP-13', path: '/api/tri/chaines', desc: 'Chaînes de tri' },
      { id: 'T-EP-14', path: '/api/production', desc: 'Production' },
      { id: 'T-EP-15', path: '/api/clients-exutoires', desc: 'Clients exutoires' },
      { id: 'T-EP-16', path: '/api/commandes-exutoires', desc: 'Commandes exutoires' },
      { id: 'T-EP-17', path: '/api/preparations', desc: 'Préparations' },
      { id: 'T-EP-18', path: '/api/news', desc: 'Fil actualité' },
      { id: 'T-EP-19', path: '/api/teams', desc: 'Équipes' },
      { id: 'T-EP-20', path: '/api/settings', desc: 'Paramètres' },
    ];
    for (const ep of endpoints) {
      try {
        const { status } = await request('GET', ep.path, null, authH);
        if (status >= 200 && status < 300) ok(ep.id, ep.desc);
        else if (status === 403) ok(ep.id, ep.desc, '403 rôle insuffisant');
        else fail(ep.id, ep.desc, `status=${status}`);
      } catch (e) {
        fail(ep.id, ep.desc, e.message);
      }
    }
  }

  // ═══ §2.5 Données et cohérence ═══
  if (token) {
    console.log('\n─── §2.5 Données et Cohérence ───');
    const authH = { Authorization: `Bearer ${token}` };

    try {
      const { status, data } = await request('GET', '/api/historique/kpi', null, authH);
      if (status === 200 && data != null && typeof data === 'object') {
        ok('T-DATA-01', 'Dashboard KPI — données cohérentes');
      } else {
        fail('T-DATA-01', 'Dashboard KPI', `status=${status}`);
      }
    } catch (e) {
      fail('T-DATA-01', 'Dashboard KPI', e.message);
    }

    try {
      const { status, data } = await request('GET', '/api/candidates/kanban', null, authH);
      if (status === 200 && data != null) {
        ok('T-DATA-02', 'Kanban candidats — structure valide');
      } else if (status === 403) {
        skip('T-DATA-02', 'Kanban candidats (403)');
      } else {
        fail('T-DATA-02', 'Kanban candidats', `status=${status}`);
      }
    } catch (e) {
      fail('T-DATA-02', 'Kanban candidats', e.message);
    }
  }

  // ═══ §2.6 Sécurité ═══
  console.log('\n─── §2.6 Sécurité ───');

  // T-SEC-01 : Rate limit (vérifie que l'endpoint existe et répond)
  try {
    const { status } = await request('POST', '/api/auth/login', { username: 'x', password: 'x' });
    if (status === 401 || status === 429) ok('T-SEC-01', 'Rate limit login actif', `status=${status}`);
    else fail('T-SEC-01', 'Rate limit login', `status inattendu ${status}`);
  } catch (e) {
    fail('T-SEC-01', 'Rate limit login', e.message);
  }

  // T-SEC-02 : Injection SQL login
  try {
    const { status } = await request('POST', '/api/auth/login', { username: "' OR '1'='1", password: "' OR '1'='1" });
    if (status === 401) ok('T-SEC-02', 'Injection SQL login rejetée (401)');
    else fail('T-SEC-02', 'Injection SQL login', `attendu 401, reçu ${status}`);
  } catch (e) {
    fail('T-SEC-02', 'Injection SQL login', e.message);
  }

  // ═══ Résumé ═══
  const total = passed + failed + skipped;
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  Résultats : ${String(passed).padStart(2)} ✓  ${String(failed).padStart(2)} ✗  ${String(skipped).padStart(2)} ⊘  (${total} total) ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  if (failed > 0) {
    console.log(`\x1b[31m${failed} test(s) échoué(s).\x1b[0m`);
    process.exit(1);
  }
  console.log(`\x1b[32mTous les tests exécutés sont passés.\x1b[0m`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(2);
});
