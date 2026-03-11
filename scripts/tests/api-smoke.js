#!/usr/bin/env node
/**
 * Script de tests techniques (smoke) — API SOLIDATA ERP
 * Usage:
 *   node scripts/tests/api-smoke.js
 *   BASE_URL=https://recette.solidata.online node scripts/tests/api-smoke.js
 *   BASE_URL=https://... API_USER=admin API_PASSWORD=secret node scripts/tests/api-smoke.js
 *
 * Variables d'environnement:
 *   BASE_URL  - URL du backend (défaut: http://localhost:5000)
 *   API_USER - Identifiant pour tests authentifiés (optionnel)
 *   API_PASSWORD - Mot de passe (optionnel)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const API_USER = process.env.API_USER;
const API_PASSWORD = process.env.API_PASSWORD;

let token = null;
let failed = 0;

function log(name, ok, detail = '') {
  const status = ok ? 'OK' : 'FAIL';
  if (!ok) failed++;
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function request(method, path, body = null, auth = false) {
  const url = `${BASE_URL.replace(/\/$/, '')}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (auth && token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function run() {
  console.log('--- Tests techniques API SOLIDATA ---');
  console.log(`BASE_URL: ${BASE_URL}\n`);

  // 1. Health check
  try {
    const { status, data } = await request('GET', '/api/health');
    const ok = status === 200 && data && data.status === 'ok';
    log('Health check', ok, ok ? '' : `status=${status}`);
    if (data && data.database) {
      log('  DB connectée', data.database.connected === true);
    }
  } catch (e) {
    log('Health check', false, e.message);
  }

  // 2. Login (si identifiants fournis)
  if (API_USER && API_PASSWORD) {
    try {
      const { status, data } = await request('POST', '/api/auth/login', {
        username: API_USER,
        password: API_PASSWORD,
      });
      const ok = status === 200 && data && (data.accessToken || data.token);
      if (ok) {
        token = data.accessToken || data.token;
      }
      log('Login', ok, ok ? `role=${data.user?.role}` : `status=${status}`);
    } catch (e) {
      log('Login', false, e.message);
    }
  } else {
    console.log('[SKIP] Login (API_USER / API_PASSWORD non fournis)');
  }

  // 3. Endpoints protégés (si token)
  if (token) {
    try {
      const { status } = await request('GET', '/api/auth/me', null, true);
      log('GET /api/auth/me', status === 200);
    } catch (e) {
      log('GET /api/auth/me', false, e.message);
    }

    try {
      const { status, data } = await request('GET', '/api/historique/kpi', null, true);
      const ok = status === 200 && data != null;
      log('GET /api/historique/kpi (dashboard)', ok, ok ? '' : `status=${status}`);
    } catch (e) {
      log('GET /api/historique/kpi', false, e.message);
    }

    try {
      const { status } = await request('GET', '/api/candidates/kanban', null, true);
      // 200 ou 403 si rôle insuffisant
      log('GET /api/candidates/kanban', status === 200 || status === 403, `status=${status}`);
    } catch (e) {
      log('GET /api/candidates/kanban', false, e.message);
    }

    try {
      const { status } = await request('GET', '/api/tours', null, true);
      log('GET /api/tours', status === 200 || status === 403, `status=${status}`);
    } catch (e) {
      log('GET /api/tours', false, e.message);
    }

    try {
      const { status } = await request('GET', '/api/vehicles', null, true);
      log('GET /api/vehicles', status === 200 || status === 403, `status=${status}`);
    } catch (e) {
      log('GET /api/vehicles', false, e.message);
    }

    try {
      const { status } = await request('GET', '/api/employees', null, true);
      log('GET /api/employees', status === 200 || status === 403, `status=${status}`);
    } catch (e) {
      log('GET /api/employees', false, e.message);
    }
  }

  console.log('\n--- Fin des tests ---');
  if (failed > 0) {
    console.log(`Résultat: ${failed} échec(s).`);
    process.exit(1);
  }
  console.log('Résultat: tous les tests exécutés sont passés.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
